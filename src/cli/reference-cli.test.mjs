/**
 * Тесты VL-417 — CLI `vibelog reference sync` обновляет клон репозитория.
 *
 * Спавнит CLI (bin/vibelog.mjs) во временном каталоге с backlog/ и локальным
 * bare-репозиторием (file://, без сети).
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
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-cli-reference-test-'));
const backlogDir = join(testRoot, 'backlog');
const bare = join(testRoot, 'remote-bare.git');
const work = join(testRoot, 'upstream-work');

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8',
    env: testSpawnEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** git в каталоге; падение — ошибка теста. */
function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8', env: gitEnv });
  assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout ?? '';
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

  // bare-«удалённый» + рабочий upstream с одной задачей
  mkdirSync(bare, { recursive: true });
  git(['init', '-q', '--bare'], bare);
  mkdirSync(work, { recursive: true });
  git(['init', '-q'], work);
  git(['checkout', '-q', '-b', 'master'], work);
  mkdirSync(join(work, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(work, 'backlog', 'tasks', 'VL-1 - one.md'), [
    '---', 'id: VL-1', 'title: Одна', 'status: To Do', 'created_date: 2026-01-01', '---', '', 'Описание.', '',
  ].join('\n'), 'utf-8');
  git(['remote', 'add', 'origin', bare], work);
  git(['add', '-A'], work);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '--no-gpg-sign'], work);
  git(['push', 'origin', 'HEAD:master'], work);
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-417 — CLI reference sync', () => {
  it('первый sync клонирует, повторный — «Без изменений»', () => {
    const add = runCli(['reference', 'add', 'Local', '--type', 'repo', '--url', 'file://' + bare, '--path', 'data/cli-src', '--no-clone']);
    assert.equal(add.status, 0, add.stdout + add.stderr);

    const first = runCli(['reference', 'sync']);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /Клонировано: 1/);

    const second = runCli(['reference', 'sync']);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /Без изменений: ref-1/);
    assert.match(second.stdout, /обновлено: 0, без изменений: 1, ошибок: 0/);
  });

  it('после коммита в upstream печатает «Обновлено: …» с diff-сводкой', () => {
    writeFileSync(join(work, 'backlog', 'tasks', 'VL-2 - two.md'), [
      '---', 'id: VL-2', 'title: Две', 'status: To Do', 'created_date: 2026-01-01', '---', '', 'Описание.', '',
    ].join('\n'), 'utf-8');
    git(['add', '-A'], work);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add task', '--no-gpg-sign'], work);
    git(['push', 'origin', 'HEAD:master'], work);

    const res = runCli(['reference', 'sync']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /Обновлён: ref-1 — \+1 задач/, res.stdout);
    assert.match(res.stdout, /Обновлено: ref-1 \(\+1 задач\)/, res.stdout);
    assert.match(res.stdout, /обновлено: 1, без изменений: 0, ошибок: 0/, res.stdout);
  });

  it('--json отдаёт объект целиком (updated + diffs)', () => {
    const res = runCli(['reference', 'sync', '--json']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const json = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
    assert.ok(Array.isArray(json.updated), JSON.stringify(json));
    assert.ok(Array.isArray(json.skipped));
    assert.ok(Array.isArray(json.cloned));
    assert.equal(typeof json.diffs, 'object');
  });
});
