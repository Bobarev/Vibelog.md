/**
 * Тесты VL-277 — автокоммит файла задачи после записи token_usage
 * (src/agent/task-commit.ts).
 *
 * AC задачи: файл задачи коммитится после записи usage (грязного остатка
 * после close нет), --amend только для HEAD-коммита этой задачи и только
 * если он не запушен, пустых коммитов нет, git-ошибка не бросает исключение.
 * Всё на временных git-репозиториях в mkdtemp (AGENTS.md: фиксированные
 * пути запрещены).
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commitTaskFile, isTaskCommitPhase, TASK_COMMIT_PHASES } from '../../dist/agent/task-commit.js';
import { createTaskFile, addTaskTokenUsage } from '../../dist/core/store.js';

/** git в тестовом каталоге. */
function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Число коммитов в репозитории. */
function commitCount(cwd) {
  return Number(git(cwd, 'rev-list', '--count', 'HEAD'));
}

/** Содержимое файла из указанного коммита. */
function fileAt(cwd, rev, path) {
  return git(cwd, 'show', `${rev}:${path}`);
}

describe('VL-277 — автокоммит файла задачи после close', () => {
  let root;
  let taskPath;
  let relPath;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vibelog-taskcommit-'));
    execFileSync('/usr/bin/git', ['init', '-q'], { cwd: root });
    execFileSync('/usr/bin/git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('/usr/bin/git', ['config', 'user.name', 'Test'], { cwd: root });
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: Task Commit Test\n', 'utf-8');
    const task = createTaskFile(root, { id: 'VL-500', title: 'Задача автокоммита' });
    writeFileSync(join(root, 'README.md'), 'init', 'utf-8');
    void task;
    // Путь файла задачи: имя строит slug, поэтому берём его из реального списка
    // (readdirSync, а не git ls-files — тот квотирует кириллицу при quotePath)
    const taskFile = readdirSync(join(root, 'backlog', 'tasks')).find((f) => f.startsWith('VL-500') && f.endsWith('.md'));
    assert.ok(taskFile, 'файл задачи найден');
    relPath = `backlog/tasks/${taskFile}`;
    taskPath = join(root, relPath);
    // Файл задачи — в начальном коммите: тесты проверяют правку уже
    // отслеживаемого файла (в жизни файл задачи давно закоммичен)
    git(root, 'add', 'README.md', 'backlog/config.yml', relPath);
    git(root, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('гейт по фазе: коммитит только close (AC7)', () => {
    assert.deepEqual([...TASK_COMMIT_PHASES], ['close']);
    assert.equal(isTaskCommitPhase('close'), true);
    for (const phase of ['spec', 'plan', 'code', 'comment', undefined]) {
      assert.equal(isTaskCommitPhase(phase), false, `фаза ${phase} коммит не делает`);
    }
  });

  it('грязный файл задачи → коммит создан, только путь задачи (AC1, AC4)', () => {
    // Имитируем запись usage: frontmatter задачи меняется, файл грязный
    addTaskTokenUsage(root, 'VL-500', 'code', { input: 10, output: 5, total: 15, requests: 1 }, 1000);
    // Чужой грязный файл (references/data и пр.) в коммит попасть не должен
    mkdirSync(join(root, 'backlog', 'references', 'data'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'references', 'data', 'clone.txt'), 'x', 'utf-8');

    const before = commitCount(root);
    const hash = commitTaskFile(root, 'VL-500', 'close');

    assert.ok(hash, 'хелпер вернул хэш коммита');
    assert.equal(commitCount(root), before + 1, 'создан ровно один коммит');
    const files = git(root, '-c', 'core.quotePath=false', 'show', '--name-only', '--pretty=format:', 'HEAD')
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(files, [relPath], 'в коммите только файл задачи (не references/data)');
    assert.match(git(root, 'log', '-1', '--pretty=%s'), /^docs\(task\): VL-500 — token_usage \(close\)$/);
    assert.equal(git(root, 'status', '--porcelain', '--', taskPath), '', 'файл задачи чист (AC1)');
  });

  it('HEAD — docs(task)-коммит этой задачи и не запушен → --amend, тема сохранена (AC2, AC6)', () => {
    // Комментарий finish_phase появляется в файле задачи ДО коммита
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf-8')}\nКомментарий фазы.\n`, 'utf-8');
    git(root, 'add', '--', relPath);
    git(root, 'commit', '-q', '-m', 'docs(task): VL-500 — закрытие задачи (Done)');
    const before = commitCount(root);

    // usage дописан ПОСЛЕ docs(task)-коммита — ровно инцидент задачи
    addTaskTokenUsage(root, 'VL-500', 'close', { input: 7, output: 3, total: 10, requests: 1 }, 500);
    const hash = commitTaskFile(root, 'VL-500', 'close');

    assert.ok(hash);
    assert.equal(commitCount(root), before, 'amend не добавляет коммит');
    assert.equal(git(root, 'log', '-1', '--pretty=%s'), 'docs(task): VL-500 — закрытие задачи (Done)',
      'тема docs(task)-коммита сохранена (--no-edit)');
    const content = fileAt(root, 'HEAD', relPath);
    assert.match(content, /token_usage/, 'в коммите есть правка token_usage');
    assert.equal(git(root, 'status', '--porcelain', '--', taskPath), '', 'грязного остатка нет');
  });

  it('HEAD — чужой коммит (refs и lessons) → новый коммит, чужой не переписан (AC6)', () => {
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf-8')}\nКомментарий фазы.\n`, 'utf-8');
    git(root, 'add', '--', relPath);
    git(root, 'commit', '-q', '-m', 'docs(task): VL-500 — закрытие задачи (Done)');
    writeFileSync(join(root, 'README.md'), 'refs', 'utf-8');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-q', '-m', 'docs(task): VL-500 — refs и lessons');
    const before = commitCount(root);

    addTaskTokenUsage(root, 'VL-500', 'close', { input: 1, output: 2, total: 3, requests: 1 }, 100);
    const hash = commitTaskFile(root, 'VL-500', 'close');

    assert.ok(hash);
    assert.equal(commitCount(root), before + 1, 'создан новый коммит, а не amend');
    assert.equal(git(root, 'log', '-1', '--pretty=%s'), 'docs(task): VL-500 — token_usage (close)');
    assert.equal(git(root, 'log', '-2', '--pretty=%s').split('\n')[1], 'docs(task): VL-500 — refs и lessons',
      'предыдущий коммит цел');
  });

  it('чистый файл → null, коммитов не добавилось (AC6: пустых коммитов нет)', () => {
    const before = commitCount(root);
    const hash = commitTaskFile(root, 'VL-500', 'close');
    assert.equal(hash, null);
    assert.equal(commitCount(root), before);
  });

  it('нет git-репозитория → null без исключения (AC5)', () => {
    const plain = mkdtempSync(join(tmpdir(), 'vibelog-taskcommit-nogit-'));
    try {
      mkdirSync(join(plain, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(plain, 'backlog', 'config.yml'), 'project_name: No Git\n', 'utf-8');
      createTaskFile(plain, { id: 'VL-501', title: 'Задача без git' });
      assert.doesNotThrow(() => commitTaskFile(plain, 'VL-501', 'close'));
      assert.equal(commitTaskFile(plain, 'VL-501', 'close'), null, 'ошибка git → null, exit-код не меняется');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('несуществующий ID → null (ничего не коммитится)', () => {
    assert.equal(commitTaskFile(root, 'VL-999', 'close'), null);
  });

  // ── VL-302: трейлер Co-authored-by ──
  it('новый коммит содержит трейлер Co-authored-by (VL-302)', () => {
    addTaskTokenUsage(root, 'VL-500', 'close', { input: 1, output: 1, total: 2, requests: 1 }, 100);
    assert.ok(commitTaskFile(root, 'VL-500', 'close'));
    const body = git(root, 'log', '-1', '--pretty=%B');
    assert.match(body, /^docs\(task\): VL-500 — token_usage \(close\)\n\nCo-authored-by: vibelog-agent <vb@xw2\.ru>\n?$/);
  });

  it('amend сохраняет тело коммита и дописывает трейлер (VL-302, риск R1)', () => {
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf-8')}\nКомментарий фазы.\n`, 'utf-8');
    git(root, 'add', '--', relPath);
    git(root, 'commit', '-q', '-m', 'docs(task): VL-500 — закрытие задачи (Done)', '-m', 'Тело коммита.');
    addTaskTokenUsage(root, 'VL-500', 'close', { input: 7, output: 3, total: 10, requests: 1 }, 500);
    assert.ok(commitTaskFile(root, 'VL-500', 'close'));
    const body = git(root, 'log', '-1', '--pretty=%B');
    assert.match(body, /^docs\(task\): VL-500 — закрытие задачи \(Done\)/, 'тема сохранена');
    assert.match(body, /Тело коммита\./, 'тело коммита не потеряно');
    assert.match(body, /Co-authored-by: vibelog-agent <vb@xw2\.ru>/, 'трейлер добавлен');
  });

  it('commit_coauthor: false → коммит без трейлера (VL-302)', () => {
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(join(root, '.vibelog', 'settings.json'), '{"commit_coauthor": false}\n', 'utf-8');
    addTaskTokenUsage(root, 'VL-500', 'close', { input: 1, output: 1, total: 2, requests: 1 }, 100);
    assert.ok(commitTaskFile(root, 'VL-500', 'close'));
    assert.doesNotMatch(git(root, 'log', '-1', '--pretty=%B'), /Co-authored-by/);
  });

  it('повторный amend не дублирует трейлер (VL-302, риск R2)', () => {
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf-8')}\nКомментарий фазы.\n`, 'utf-8');
    git(root, 'add', '--', relPath);
    git(root, 'commit', '-q', '-m', 'docs(task): VL-500 — закрытие задачи (Done)');
    addTaskTokenUsage(root, 'VL-500', 'close', { input: 7, output: 3, total: 10, requests: 1 }, 500);
    assert.ok(commitTaskFile(root, 'VL-500', 'close'));
    // Вторая правка файла задачи → снова amend того же docs(task)-коммита
    addTaskTokenUsage(root, 'VL-500', 'close', { input: 1, output: 1, total: 2, requests: 1 }, 200);
    assert.ok(commitTaskFile(root, 'VL-500', 'close'));
    const body = git(root, 'log', '-1', '--pretty=%B');
    assert.equal(body.split('Co-authored-by:').length - 1, 1, 'трейлер ровно один раз');
  });
});
