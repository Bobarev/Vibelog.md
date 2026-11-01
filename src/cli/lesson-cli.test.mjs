/**
 * Тесты VL-153 — CLI vibelog lesson (все подкоманды).
 *
 * Спавнят CLI (bin/vibelog.mjs) во временном каталоге с backlog/.
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
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-cli-lesson-test-'));
const backlogDir = join(testRoot, 'backlog');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8',
    env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'vl',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-153 CLI — create/view/list/search', () => {
  it('create без backlog → ошибка', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vl153-empty-'));
    try {
      const res = spawnSync('node', [cliPath, 'lesson', 'list'], {
        cwd: empty, encoding: 'utf-8',
        env: testSpawnEnv(),
      });
      assert.notEqual(res.status, 0);
      assert.match((res.stdout ?? '') + (res.stderr ?? ''), /Backlog не найден/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('create → view → list → search', () => {
    const create = runCli(['lesson', 'create', 'Тесты батчами', '--tags', 'tests,ci', '--source-tasks', 'VL-1,VL-2', '-d', 'Запускай батчами']);
    assert.equal(create.status, 0, create.stderr);
    assert.match(create.stdout, /Lesson lesson-1 создан/);

    const view = runCli(['lesson', 'view', 'lesson-1']);
    assert.equal(view.status, 0);
    assert.match(view.stdout, /Тесты батчами/);
    assert.match(view.stdout, /теги: tests, ci/);
    assert.match(view.stdout, /source_tasks: VL-1, VL-2/);
    assert.match(view.stdout, /Запускай батчами/);

    const list = runCli(['lesson', 'list']);
    assert.match(list.stdout, /lesson-1\s+Тесты батчами/);

    const search = runCli(['lesson', 'search', 'батчами']);
    assert.match(search.stdout, /lesson-1/);
  });

  it('list --status и --tags фильтруют; view несуществующего → exit 1', () => {
    runCli(['lesson', 'create', 'Другой урок', '--tags', 'old']);
    const listActive = runCli(['lesson', 'list', '--status', 'active']);
    assert.match(listActive.stdout, /lesson-1/);

    const listTags = runCli(['lesson', 'list', '--tags', 'ci']);
    assert.match(listTags.stdout, /lesson-1/);
    assert.doesNotMatch(listTags.stdout, /Другой урок/);

    const missing = runCli(['lesson', 'view', 'lesson-999']);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout + missing.stderr, /не найден/);
  });

  it('create без заголовка → подсказка (exit 0, error-сообщение)', () => {
    const res = runCli(['lesson', 'create']);
    // printError без заголовка: строка «Укажите заголовок»
    assert.match(res.stdout + res.stderr, /Укажите заголовок/);
  });
});

describe('VL-153 CLI — link и supersede', () => {
  it('link: двусторонняя связь с задачей; --remove отвязывает', () => {
    runCli(['task', 'create', 'Задача CLI-связи']);
    const list = runCli(['task', 'list', '--json']);
    const tasks = JSON.parse(list.stdout).data;
    const taskId = tasks.find(t => t.title === 'Задача CLI-связи').id;

    const link = runCli(['lesson', 'link', 'lesson-1', taskId]);
    assert.equal(link.status, 0, link.stderr);
    assert.match(link.stdout, /связан/);

    const view = runCli(['lesson', 'view', 'lesson-1']);
    assert.match(view.stdout, new RegExp(`linked_tasks: ${taskId}`));

    const unlink = runCli(['lesson', 'link', 'lesson-1', taskId, '--remove']);
    assert.equal(unlink.status, 0);
    const view2 = runCli(['lesson', 'view', 'lesson-1']);
    assert.match(view2.stdout, /linked_tasks: \(нет\)/);
  });

  it('link несуществующего lesson → exit 1', () => {
    const res = runCli(['lesson', 'link', 'lesson-999', 'VL-1']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /не найден/);
  });

  it('supersede: newId заменяет oldId', () => {
    runCli(['lesson', 'create', 'Старый CLI-урок']);
    runCli(['lesson', 'create', 'Новый CLI-урок']);
    // Достаём реальные ID по заголовкам из вывода list (формат: «  lesson-N  Заголовок ...»)
    const list = runCli(['lesson', 'list']).stdout;
    const idByTitle = (title) => {
      const line = list.split('\n').find(l => l.includes(title));
      return line.trim().split(/\s+/)[0];
    };
    const oldId = idByTitle('Старый CLI-урок');
    const newId = idByTitle('Новый CLI-урок');

    const res = runCli(['lesson', 'supersede', oldId, newId]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /заменяет/);

    const oldView = runCli(['lesson', 'view', oldId]);
    assert.match(oldView.stdout, /статус: superseded/);
    const newView = runCli(['lesson', 'view', newId]);
    assert.match(newView.stdout, new RegExp(`заменяет: ${oldId}`));
  });

  it('supersede несуществующего → exit 1', () => {
    const res = runCli(['lesson', 'supersede', 'lesson-999', 'lesson-1']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /не найден/);
  });
});
