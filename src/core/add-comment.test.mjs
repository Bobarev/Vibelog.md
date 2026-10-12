/**
 * Тесты VL-35 — addComment в core (автор из git config user.name).
 *
 * Каталоги — в /tmp; git-окружение изолируется через GIT_CONFIG_GLOBAL.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addComment, createTaskFile, getTask } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

describe('addComment (VL-35)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-addcomment-test-'));
  // GIT_CONFIG_GLOBAL=/dev/null изолирует тест от глобального git-конфига
  const ISO_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  let taskId;

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function setupProject() {
    mkdirSync(join(testRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(
      join(testRoot, 'backlog', 'config.yml'),
      stringifyYaml({
        project_name: 'Test',
        task_prefix: 'tt',
        default_status: 'To Do',
        statuses: ['To Do', 'In Progress', 'Done'],
        definition_of_done: [],
      }),
      'utf-8'
    );
  }

  it('addComment: комментарий с явным автором → в файле', () => {
    setupProject();
    const task = createTaskFile(testRoot, { title: 'Задача для комментария', status: 'To Do' });
    taskId = task.id;
    const updated = addComment(testRoot, task.id, 'Первый комментарий', '@tester');

    assert.equal(updated.comments.length, 1);
    assert.equal(updated.comments[0].author, '@tester');
    assert.equal(updated.comments[0].text, 'Первый комментарий');
    assert.match(updated.comments[0].created, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    // Roundtrip: читаем с диска
    const reloaded = getTask(testRoot, task.id);
    assert.equal(reloaded.comments.length, 1);
    assert.equal(reloaded.comments[0].author, '@tester');
  });

  it('addComment без автора → git config user.name', () => {
    // Локальный git-конфиг проекта
    spawnSync('git', ['init'], { cwd: testRoot, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test Git User'], { cwd: testRoot, stdio: 'pipe' });

    const updated = addComment(testRoot, taskId, 'От имени git-пользователя');
    assert.equal(updated.comments.length, 2);
    // GIT_CONFIG_GLOBAL изолирован — имя берётся из локального конфига
    assert.equal(updated.comments[1].author, 'Test Git User');
  });

  it('addComment: неизвестная задача → throw', () => {
    assert.throws(() => addComment(testRoot, 'TT-999', 'текст'), /не найдена/);
  });
});
