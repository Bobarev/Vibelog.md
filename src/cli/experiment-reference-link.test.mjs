/**
 * Тесты VL-301 — связь «эксперимент ↔ задача» через `reference type: experiment`.
 *
 * Схема lesson НЕ расширяется (doc-21 §16, AC3): ссылка «урок/задача ↔
 * эксперимент» делается reference-ом с типом `experiment` и `reference link`,
 * которая обновляет обе стороны (`reference.linked_tasks` ↔ `task.references`).
 *
 * Спавнит реальный CLI в mkdtemp; env — только через testSpawnEnv().
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { testSpawnEnv } from '../test-env.mjs';
import { REFERENCE_TYPES } from '../../dist/core/reference.js';
import { createLesson, lessonToMarkdown } from '../../dist/core/lesson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-ref-'));
const backlogDir = join(testRoot, 'backlog');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8', env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
    acceptance_criteria: [],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-301 — reference type: experiment', () => {
  it('тип experiment входит в REFERENCE_TYPES (VL-294), схема lesson не расширена', () => {
    assert.ok(REFERENCE_TYPES.includes('experiment'));
    // AC3: у lesson нет поля references — связь идёт через reference.linked_tasks
    const lesson = createLesson({ title: 'проверка', status: 'active' });
    assert.equal(Object.prototype.hasOwnProperty.call(lesson, 'references'), false);
    assert.doesNotMatch(lessonToMarkdown(lesson, ''), /^references:/m);
  });

  it('reference на карточку эксперимента связывается с задачей двусторонне', () => {
    // Задача и эксперимент — обычные артефакты проекта
    let res = runCli(['task', 'create', 'Задача с экспериментом']);
    assert.equal(res.status, 0, res.stderr);
    const taskFile = readdirSync(join(backlogDir, 'tasks')).find(f => f.endsWith('.md'));
    assert.ok(taskFile, 'файл задачи должен появиться');
    const taskId = taskFile.replace(/\.md$/, '');

    res = runCli(['experiment', 'create', 'Связь с задачей']);
    assert.equal(res.status, 0, res.stderr);

    res = runCli([
      'reference', 'add', 'Эксперимент exp-1', '--type', 'experiment',
      '--path', 'backlog/experiments/exp-1.md',
    ]);
    assert.equal(res.status, 0, res.stderr);

    res = runCli(['reference', 'link', 'ref-1', taskId]);
    assert.equal(res.status, 0, res.stderr);

    // Сторона reference: linked_tasks
    const refFile = readdirSync(join(backlogDir, 'references')).find(f => f.startsWith('ref-1'));
    const refText = readFileSync(join(backlogDir, 'references', refFile), 'utf-8');
    assert.match(refText, /^type: experiment$/m);
    assert.match(refText, new RegExp(`- ${taskId}`));

    // Сторона задачи: references
    const taskText = readFileSync(join(backlogDir, 'tasks', taskFile), 'utf-8');
    assert.match(taskText, /references:/);
    assert.match(taskText, /- ref-1/);

    // Повторный link не дублирует (идемпотентность core-функции)
    res = runCli(['reference', 'link', 'ref-1', taskId]);
    assert.equal(res.status, 0, res.stderr);
    const refAgain = readFileSync(join(backlogDir, 'references', refFile), 'utf-8');
    assert.equal(refAgain.match(new RegExp(`- ${taskId}`, 'g')).length, 1);
  });
});
