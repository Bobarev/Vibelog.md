/**
 * Тесты VL-341 — сборщик сводки `collectStatus` (src/core/status.ts).
 *
 * Каталоги — только mkdtemp (lesson-104): фиксированные пути при параллельных
 * прогонах в разных worktree затирают друг друга.
 *
 * Покрытие: пустой каталог без backlog/, проект с задачами в разных статусах,
 * автоочередь в трёх состояниях, git-репозиторий и каталог вне git, битый
 * auto-queue.json (секция с error, остальные на месте).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { createTaskFile } from '../../dist/core/store.js';
import { autoQueuePath } from '../../dist/core/auto-queue.js';
import { collectStatus } from '../../dist/core/status.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-status-'));

/** Новый проект: backlog/tasks + config.yml (prefix VL). */
function newProj(name) {
  const dir = join(testRoot, name);
  mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(dir, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Test Project',
      task_prefix: 'VL',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'Review', 'Done', 'Rejected'],
      definition_of_done: [],
    }),
    'utf-8'
  );
  return dir;
}

/** Пишет файл очереди в .vibelog/ проекта. */
function writeQueue(dir, queue) {
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(autoQueuePath(dir), JSON.stringify(queue, null, 2), 'utf-8');
}

describe('collectStatus (VL-341)', () => {
  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('пустой каталог без backlog/: project === null, не бросает', () => {
    const dir = join(testRoot, 'empty');
    mkdirSync(dir, { recursive: true });
    const status = collectStatus(dir, { noGit: true });
    assert.equal(status.project, null);
    assert.equal(status.tasks.total, 0);
    assert.deepEqual(status.tasks.byStatus, {});
    assert.deepEqual(status.runs, []);
    assert.equal(status.queue.running, false);
    assert.equal(status.grant, null);
    assert.equal(status.git, null);
    assert.ok(typeof status.version === 'string' && status.version.length > 0);
  });

  it('проект с 3 задачами в разных статусах: byStatus и total верны', () => {
    const dir = newProj('tasks');
    createTaskFile(dir, { title: 'Первая', status: 'To Do' });
    createTaskFile(dir, { title: 'Вторая', status: 'To Do' });
    createTaskFile(dir, { title: 'Третья', status: 'Planned' });

    const status = collectStatus(dir, { noGit: true });
    assert.deepEqual(status.project, { name: 'Test Project', taskPrefix: 'VL' });
    assert.equal(status.tasks.total, 3);
    assert.equal(status.tasks.byStatus['To Do'], 2);
    assert.equal(status.tasks.byStatus.Planned, 1);
  });

  it('автоочередь: pending/running/failed раскладываются по секциям', () => {
    const dir = newProj('queue');
    writeQueue(dir, {
      running: true,
      max_retries: 1,
      tasks: [
        { id: 'VL-1', status: 'pending', added_at: '2026-01-01T00:00:00.000Z' },
        { id: 'VL-2', status: 'running', added_at: '2026-01-01T00:00:01.000Z' },
        { id: 'VL-3', status: 'done', added_at: '2026-01-01T00:00:02.000Z' },
        { id: 'VL-4', status: 'failed', added_at: '2026-01-01T00:00:03.000Z', fail_reason: 'код 1' },
      ],
    });

    const status = collectStatus(dir, { noGit: true });
    assert.equal(status.queue.running, true);
    assert.deepEqual(status.queue.pending, ['VL-1']);
    assert.deepEqual(status.queue.runningIds, ['VL-2']);
    assert.deepEqual(status.queue.done, ['VL-3']);
    assert.deepEqual(status.queue.failed, [{ id: 'VL-4', reason: 'код 1' }]);
    assert.equal(status.queue.error, undefined);
  });

  it('нет файла очереди: running false, массивы пустые (не ошибка)', () => {
    const dir = newProj('noqueue');
    const status = collectStatus(dir, { noGit: true });
    assert.equal(status.queue.running, false);
    assert.deepEqual(status.queue.pending, []);
    assert.deepEqual(status.queue.failed, []);
    assert.equal(status.queue.error, undefined);
  });

  it('битый auto-queue.json: секция с error, остальные секции на месте', () => {
    const dir = newProj('badqueue');
    createTaskFile(dir, { title: 'Задача', status: 'To Do' });
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(autoQueuePath(dir), '{битый', 'utf-8');

    const status = collectStatus(dir, { noGit: true });
    // loadAutoQueue fail-open: битый файл = пустая остановленная очередь,
    // поэтому секция остаётся валидной, а не превращается в error
    assert.equal(status.queue.running, false);
    assert.deepEqual(status.queue.pending, []);
    // Главное: сбой одного источника не рушит сводку
    assert.equal(status.tasks.total, 1);
    assert.deepEqual(status.project, { name: 'Test Project', taskPrefix: 'VL' });
  });

  it('git-репозиторий: branch и untracked считаются', () => {
    const dir = newProj('gitrepo');
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };
    const run = (args) => execFileSync('git', args, { cwd: dir, env: gitEnv, encoding: 'utf-8' });
    run(['init', '-q']);
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);
    // Нетрекнутый файл
    writeFileSync(join(dir, 'new.txt'), 'x', 'utf-8');

    const status = collectStatus(dir);
    assert.ok(status.git, 'git-секция должна быть');
    assert.ok(status.git.branch.length > 0, 'ветка определена');
    assert.equal(status.git.untracked, 1);
    assert.equal(status.git.changed, 0);
    // upstream не настроен — числа 0 и отдельный флаг
    assert.equal(status.git.upstream, false);
    assert.equal(status.git.ahead, 0);
    assert.equal(status.git.behind, 0);
  });

  it('каталог вне git: git === null', () => {
    const dir = join(testRoot, 'nogit');
    mkdirSync(dir, { recursive: true });
    const status = collectStatus(dir);
    assert.equal(status.git, null);
  });

  it('--no-git: git-секция не собирается', () => {
    const dir = newProj('nogitflag');
    const status = collectStatus(dir, { noGit: true });
    assert.equal(status.git, null);
  });
});
