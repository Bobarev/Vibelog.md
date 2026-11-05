/**
 * Тесты VL-342 — CLI `vibelog task check` (целостность ссылок задач).
 *
 * Спавнит CLI (bin/vibelog.mjs) во временном каталоге с backlog/:
 * человекочитаемый вывод, `--json` и код возврата (1 при находках).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';

import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-cli-task-check-'));
const backlogDir = join(testRoot, 'backlog');
const tasksPath = join(backlogDir, 'tasks');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8',
    env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Пишет файл задачи с заданным фронтматтером. */
function writeTask(id, fields = {}) {
  const frontmatter = {
    id,
    title: `Задача ${id}`,
    status: 'To Do',
    assignee: [],
    reporter: '',
    created_date: '2026-01-01',
    updated_date: '2026-01-01',
    due_date: '',
    labels: [],
    dependencies: [],
    milestone: '',
    references: [],
    priority: '',
    type: '',
    project: '',
    parent_task_id: '',
    ordinal: 0,
    documentation: [],
    modified_files: [],
    lessons: [],
    ...fields,
  };
  writeFileSync(
    join(tasksPath, `${id} - Задача ${id}.md`),
    ['---', stringifyYaml(frontmatter).trimEnd(), '---', '', '## Description', '', 'x', ''].join('\n'),
    'utf-8',
  );
}

beforeAll(() => {
  mkdirSync(tasksPath, { recursive: true });
  // Каталог lessons существует (пустой) — секция читается, ссылки на уроки
  // проверяются; иначе отсутствующий каталог = «уроки не используются».
  mkdirSync(join(backlogDir, 'lessons'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'vl',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  // Чистый корпус: ссылок нет вовсе
  writeTask('VL-1');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-342 CLI — task check', () => {
  it('без находок: «Битых ссылок нет», код 0', () => {
    const res = runCli(['task', 'check']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Битых ссылок нет/);
    assert.match(res.stdout, /проверено задач: 1/);
  });

  it('--json без находок: kind=task-integrity, findings пуст, код 0', () => {
    const res = runCli(['task', 'check', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const json = JSON.parse(res.stdout);
    assert.equal(json.kind, 'task-integrity');
    assert.equal(json.data.total, 1);
    assert.deepEqual(json.data.findings, []);
  });

  it('с находками: таблица, счётчик и код 1', () => {
    writeTask('VL-2', { dependencies: ['XX-999'], parent_task_id: 'VL-2' });
    try {
      const res = runCli(['task', 'check']);
      assert.equal(res.status, 1, 'код возврата 1 при находках');
      assert.match(res.stdout, /ТИП/);
      assert.match(res.stdout, /ЗАДАЧА/);
      assert.match(res.stdout, /ССЫЛКА/);
      assert.match(res.stdout, /СООБЩЕНИЕ/);
      assert.match(res.stdout, /dangling_dependency/);
      assert.match(res.stdout, /self_link/);
      assert.match(res.stdout, /XX-999/);
      assert.match(res.stdout, /Находок: 2 \(проверено задач: 2\)/);
    } finally {
      rmSync(join(tasksPath, 'VL-2 - Задача VL-2.md'), { force: true });
    }
  });

  it('--json с находками: типизированные findings и код 1', () => {
    writeTask('VL-3', { lessons: ['lesson-999'] });
    try {
      const res = runCli(['task', 'check', '--json']);
      assert.equal(res.status, 1);
      const json = JSON.parse(res.stdout);
      const found = json.data.findings.find(f => f.taskId === 'VL-3');
      assert.ok(found, 'находка по VL-3');
      assert.equal(found.type, 'dangling_lesson');
      assert.equal(found.ref, 'lesson-999');
      assert.ok(found.message.includes('lesson-999'));
      assert.equal(json.data.summary.dangling_lesson, 1);
    } finally {
      rmSync(join(tasksPath, 'VL-3 - Задача VL-3.md'), { force: true });
    }
  });
});
