/**
 * Тесты VL-9 — CLI vibelog search с фильтрами.
 *
 * Проверяет:
 * - query-режим работает как раньше (без флагов)
 * - --status / --type / --priority / --limit фильтруют
 * - комбинация флагов (AND)
 * - без query и фильтров — ошибка
 * - невалидный --limit — ошибка
 * - --json с фильтрами
 *
 * Паттерн init-mcp.test.mjs: testDir в /tmp (findBacklogDir не поднимается
 * к backlog проекта), spawnSync со слиянием stdout/stderr (ошибки CLI пишутся
 * в stderr при exit 0), проверка содержимого не exit code (Catalina SIGABRT).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = '/tmp/vibelog-search-cli-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr: ошибки CLI печатаются в stderr
  // при exit code 0 — execFileSync вернул бы только пустой stdout
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

/** Инициализирует backlog и создаёт набор задач для фильтрации. */
function seed() {
  fresh();
  runCli('init', 'Search CLI', '--prefix', 'sc');
  runCli('task', 'create', 'Найти баг авторизации', '--status', 'To Do', '--priority', 'High', '--type', 'bug');
  runCli('task', 'create', 'Фича поиска', '--status', 'Done', '--priority', 'Low', '--type', 'feature');
  runCli('task', 'create', 'Чистка', '--status', 'To Do', '--priority', 'Medium', '--type', 'chore');
}

describe('VL-9 — CLI search с фильтрами', () => {
  after(() => cleanup());

  it('query-режим работает без флагов (обратная совместимость)', () => {
    seed();
    const out = runCli('search', 'баг');
    // printTaskTable обрезает title по maxWidth — проверяем устойчивую подстроку
    assert.ok(out.includes('Найти баг'), `out: ${out}`);
    assert.ok(!out.includes('Чистка'), `out: ${out}`);
  });

  it('--status фильтрует', () => {
    seed();
    const out = runCli('search', '--status', 'Done', '--json');
    const data = JSON.parse(out).data;
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Фича поиска');
  });

  it('--type + --priority комбинация (AND)', () => {
    seed();
    const out = runCli('search', '--type', 'bug', '--priority', 'high', '--json');
    const data = JSON.parse(out).data;
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Найти баг авторизации');
  });

  it('query + фильтр вместе', () => {
    seed();
    const out = runCli('search', 'баг', '--status', 'To Do', '--json');
    const data = JSON.parse(out).data;
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Найти баг авторизации');

    const out2 = runCli('search', 'баг', '--status', 'Done', '--json');
    assert.equal(JSON.parse(out2).data.length, 0);
  });

  it('--limit обрезает выдачу', () => {
    seed();
    const out = runCli('search', '--limit', '2', '--json');
    const data = JSON.parse(out).data;
    assert.equal(data.length, 2);
  });

  it('без query и фильтров — ошибка', () => {
    seed();
    const out = runCli('search');
    assert.ok(out.includes('Укажите поисковый запрос или фильтр'), `out: ${out}`);
  });

  it('невалидный --limit — ошибка', () => {
    seed();
    const out = runCli('search', '--limit', 'abc');
    assert.ok(out.includes('--limit должен быть числом'), `out: ${out}`);
  });

  it('help показывает новые флаги', () => {
    const out = runCli('search', '--help');
    assert.ok(out.includes('--status') && out.includes('--limit'), `out: ${out}`);
  });
});
