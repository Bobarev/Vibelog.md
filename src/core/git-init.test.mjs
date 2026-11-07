/**
 * Тесты git-операций `vb init` (VL-348): `isInsideGitRepo`, `gitInit`,
 * `initialCommit`, `addRemote`.
 *
 * Все кейсы работают в mkdtemp-каталоге (VL-241/lesson-89: фиксированные пути
 * при параллельных прогонах затирают друг друга). Раннер git инъектируется
 * там, где нужно проверить отсутствие git в PATH без реального PATH.
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  addRemote,
  gitInit,
  initialCommit,
  isInsideGitRepo,
  isValidRemoteUrl,
} from '../../dist/core/git-init.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-git-init-'));

/** Чистая директория теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** Запуск git в тестовом каталоге: { status, stdout }. */
function git(...args) {
  const res = spawnSync('git', args, { cwd: testDir, encoding: 'utf-8' });
  return { status: res.status, stdout: (res.stdout ?? '').trim() };
}

describe('VL-348 — git-операции init', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('AC5: isInsideGitRepo false → gitInit → true, ветка main', () => {
    assert.equal(isInsideGitRepo(testDir), false);
    const res = gitInit(testDir);
    assert.equal(res.ok, true);
    assert.equal(isInsideGitRepo(testDir), true);
    assert.equal(git('symbolic-ref', '--short', 'HEAD').stdout, 'main');
  });

  it('AC13: повторный gitInit — noop (двойного init нет)', () => {
    gitInit(testDir);
    const res = gitInit(testDir);
    assert.equal(res.ok, true);
    assert.equal(res.reason, 'exists');
  });

  it('AC5: initialCommit создаёт коммит в репозитории без истории', () => {
    gitInit(testDir);
    writeFileSync(join(testDir, 'a.txt'), 'a\n', 'utf-8');
    const res = initialCommit(testDir, 'Initial commit');
    assert.equal(res.ok, true, res.message);
    assert.equal(git('rev-list', '--count', 'HEAD').stdout, '1');
    assert.ok(git('ls-files').stdout.includes('a.txt'));
  });

  it('AC6: initialCommit не тащит .env, если он в .gitignore', () => {
    gitInit(testDir);
    writeFileSync(join(testDir, '.gitignore'), '.env\n', 'utf-8');
    writeFileSync(join(testDir, '.env'), 'SECRET=1\n', 'utf-8');
    writeFileSync(join(testDir, 'a.txt'), 'a\n', 'utf-8');
    assert.equal(initialCommit(testDir).ok, true);
    const tracked = git('ls-files').stdout.split('\n');
    assert.ok(tracked.includes('a.txt'), tracked.join(','));
    assert.ok(!tracked.includes('.env'), 'секрет не должен попасть в индекс');
  });

  it('AC7: addRemote добавляет origin, существующий не перезаписывает', () => {
    gitInit(testDir);
    // localhost — чтобы guard сетевых команд (VL-226) не считал адрес внешним:
    // `git remote add` в сеть не ходит, но аргументы сканируются
    assert.equal(addRemote(testDir, 'git@localhost:a/b.git').ok, true);
    assert.ok(git('remote', '-v').stdout.includes('git@localhost:a/b.git'));

    const again = addRemote(testDir, 'https://localhost/other.git');
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'exists');
    assert.ok(git('remote', '-v').stdout.includes('git@localhost:a/b.git'));

    // Явное согласие (force) — замена
    assert.equal(addRemote(testDir, 'https://localhost/other.git', { force: true }).ok, true);
    assert.ok(git('remote', '-v').stdout.includes('https://localhost/other.git'));
  });

  it('AC7: невалидный URL remote — invalid-url без исключения', () => {
    gitInit(testDir);
    const res = addRemote(testDir, 'не-url');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid-url');
  });

  it('isValidRemoteUrl: http(s), ssh:// и scp-подобный', () => {
    assert.equal(isValidRemoteUrl('https://example.com/a/b.git'), true);
    assert.equal(isValidRemoteUrl('http://example.com/a/b.git'), true);
    assert.equal(isValidRemoteUrl('ssh://git@example.com/a/b.git'), true);
    assert.equal(isValidRemoteUrl('git@example.com:a/b.git'), true);
    assert.equal(isValidRemoteUrl(''), false);
    assert.equal(isValidRemoteUrl('example.com/a/b'), false);
  });

  it('AC11: git недоступен (раннер с ошибкой) → no-git без исключения', () => {
    const noGit = () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn git ENOENT') });
    assert.equal(isInsideGitRepo(testDir, noGit), false);
    const init = gitInit(testDir, noGit);
    assert.equal(init.ok, false);
    assert.equal(init.reason, 'no-git');
    const commit = initialCommit(testDir, 'x', noGit);
    assert.equal(commit.ok, false);
    assert.equal(commit.reason, 'no-git');
    const remote = addRemote(testDir, 'https://example.com/a.git', {}, noGit);
    assert.equal(remote.ok, false);
    assert.equal(remote.reason, 'no-git');
  });
});
