/**
 * Тесты MCP-инструмента `git_status` (VL-416).
 *
 * Задача: у агента был `git_commit`, но не было способа увидеть, что НЕ
 * закоммичено (в сессии Vibelog UI грязное дерево заметил человек). Инструмент
 * read-only: секция git переиспользует `collectGit` из `core/status.ts`
 * (нового git-кода нет), `paths` сужает вывод до явных путей.
 *
 * Проверяется поведение из AC:
 *   1. чистый репозиторий → changed: 0, untracked: 0;
 *   2. изменённый файл → changed: 1; untracked → untracked: 1;
 *   3. вне git-репозитория → git: null и ok: true (не ошибка);
 *   4. paths фильтрует вывод (entries только по переданным путям);
 *   5. TOOL_KINDS.git_status === 'read' и инструмент есть в listTools().
 *
 * Каталог — mkdtempSync (AGENTS.md/VL-241: фиксированные пути запрещены).
 * Env фазовой сессии снимается на время файла (VL-374/lesson-254): VIBELOG_CWD
 * увёл бы git-вызовы в главный репозиторий.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { parsePorcelain } from '../../dist/mcp/git-status.js';
import { TOOL_KINDS } from '../../dist/core/tool-kinds.js';
import { clearPhaseEnv } from '../test-env.mjs';

/** git в тестовом каталоге. */
function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Разбирает ответ инструмента как JSON-ack. */
function parseAck(out) {
  try {
    return JSON.parse(out);
  } catch {
    assert.fail(`ответ не JSON: ${String(out).slice(0, 300)}`);
  }
}

describe('VL-416 — git_status: read-only снимок рабочего дерева', () => {
  let root;
  let savedEnv;

  beforeEach(() => {
    savedEnv = clearPhaseEnv();
    root = mkdtempSync(join(tmpdir(), 'vibelog-gitstatus-'));
    execFileSync('/usr/bin/git', ['init', '-q'], { cwd: root });
    execFileSync('/usr/bin/git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('/usr/bin/git', ['config', 'user.name', 'Test'], { cwd: root });
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: Git Status Test\n', 'utf-8');
    writeFileSync(join(root, 'a.txt'), 'one\n', 'utf-8');
    git(root, 'add', 'backlog/config.yml', 'a.txt');
    git(root, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => {
    savedEnv();
    rmSync(root, { recursive: true, force: true });
  });

  it('AC1: инструмент зарегистрирован в listTools и объявлен read', () => {
    const names = listTools().map(t => t.name);
    assert.ok(names.includes('git_status'), 'git_status нет в реестре');
    assert.equal(TOOL_KINDS.git_status, 'read');
  });

  it('AC2: чистый репозиторий → changed 0, untracked 0, ветка и ok:true', async () => {
    const ack = parseAck(await handleToolCall('git_status', {}, root));
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.equal(ack.read, true, 'ответ чтения помечен read');
    assert.equal(ack.applied.git, true);
    assert.equal(ack.applied.changed, 0);
    assert.equal(ack.applied.untracked, 0);
    assert.ok(typeof ack.applied.branch === 'string' && ack.applied.branch !== '');
    assert.equal(typeof ack.applied.ahead, 'number');
    assert.equal(typeof ack.applied.behind, 'number');
  });

  it('AC2: изменённый файл → changed 1; новый файл → untracked 1', async () => {
    writeFileSync(join(root, 'a.txt'), 'two\n', 'utf-8');
    let ack = parseAck(await handleToolCall('git_status', {}, root));
    assert.equal(ack.applied.changed, 1);
    assert.equal(ack.applied.untracked, 0);

    writeFileSync(join(root, 'b.txt'), 'new\n', 'utf-8');
    ack = parseAck(await handleToolCall('git_status', {}, root));
    assert.equal(ack.applied.changed, 1);
    assert.equal(ack.applied.untracked, 1);
  });

  it('AC2: вне git-репозитория → git: null и ok: true (не ошибка)', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'vibelog-gitstatus-nogit-'));
    try {
      const ack = parseAck(await handleToolCall('git_status', {}, plain));
      assert.equal(ack.ok, true, JSON.stringify(ack));
      assert.equal(ack.applied.git, null);
      assert.match(ack.message, /не git-репозиторий/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('AC3: paths сужает вывод до явных путей', async () => {
    writeFileSync(join(root, 'a.txt'), 'two\n', 'utf-8');
    writeFileSync(join(root, 'b.txt'), 'new\n', 'utf-8');
    const ack = parseAck(await handleToolCall('git_status', { paths: ['a.txt'] }, root));
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.deepEqual(ack.applied.paths, ['a.txt']);
    assert.equal(ack.applied.pathsChanged, 1);
    assert.deepEqual(ack.applied.entries.map(e => e.path), ['a.txt']);
    // Общие счётчики по-прежнему про всё дерево
    assert.equal(ack.applied.untracked, 1);
  });

  it('AC3: путь вне проекта → отказ', async () => {
    const ack = parseAck(await handleToolCall('git_status', { paths: ['../outside.txt'] }, root));
    assert.equal(ack.ok, false, JSON.stringify(ack));
    assert.match(ack.error, /за пределы проекта/);
  });

  it('parsePorcelain: код, переименование и мусорные строки', () => {
    const entries = parsePorcelain(' M a.txt\n?? b.txt\nR  old.txt -> new.txt\n\n');
    assert.deepEqual(entries, [
      { code: ' M', path: 'a.txt' },
      { code: '??', path: 'b.txt' },
      { code: 'R ', path: 'new.txt' },
    ]);
  });
});
