/**
 * Тесты VL-12 — CLI vibelog config get/set/list.
 *
 * Проверяет:
 * - get: строки, массивы, числа, boolean
 * - set с типизацией: строка, число, boolean, массив (через запятую и JSON)
 * - list: все ключи
 * - Ошибки: неизвестный ключ, невалидное число/boolean
 * - set не затирает остальные ключи конфига
 *
 * Паттерн search-cli.test.mjs: testDir в /tmp, spawnSync со слиянием
 * stdout/stderr, проверка содержимого не exit code.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = '/tmp/vibelog-config-cli-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  runCli('init', 'Config CLI', '--prefix', 'cfg');
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr (ошибки CLI в stderr при exit 0)
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

describe('VL-12 — CLI config', () => {
  after(() => cleanup());

  it('get: строка, массив, число, boolean', () => {
    fresh();
    assert.equal(runCli('config', 'get', 'project_name').trim(), 'Config CLI');
    const statuses = runCli('config', 'get', 'statuses').trim();
    assert.equal(statuses, '["To Do","In Progress","Review","Done","Blocked"]');
    assert.equal(runCli('config', 'get', 'default_port').trim(), '6420');
    assert.equal(runCli('config', 'get', 'auto_commit').trim(), 'false');
  });

  it('set: строка и число', () => {
    fresh();
    let out = runCli('config', 'set', 'default_editor', 'nvim');
    assert.ok(out.includes('default_editor = nvim'), `set editor: ${out}`);
    assert.equal(runCli('config', 'get', 'default_editor').trim(), 'nvim');

    out = runCli('config', 'set', 'default_port', '8080');
    assert.ok(out.includes('8080'), `set port: ${out}`);
    assert.equal(runCli('config', 'get', 'default_port').trim(), '8080');
  });

  it('set: boolean', () => {
    fresh();
    const out = runCli('config', 'set', 'auto_commit', 'true');
    assert.ok(out.includes('auto_commit = true'), out);
    assert.equal(runCli('config', 'get', 'auto_commit').trim(), 'true');
  });

  it('set: массив через запятую и через JSON', () => {
    fresh();
    runCli('config', 'set', 'priorities', 'High,Low');
    assert.equal(runCli('config', 'get', 'priorities').trim(), '["High","Low"]');

    runCli('config', 'set', 'types', '["bug","feature"]');
    assert.equal(runCli('config', 'get', 'types').trim(), '["bug","feature"]');
  });

  it('set не затирает остальные ключи', () => {
    fresh();
    runCli('config', 'set', 'max_column_width', '40');
    assert.equal(runCli('config', 'get', 'task_prefix').trim(), 'cfg');
    assert.equal(runCli('config', 'get', 'project_name').trim(), 'Config CLI');
    assert.equal(runCli('config', 'get', 'max_column_width').trim(), '40');
  });

  it('list: содержит ключи и значения', () => {
    fresh();
    const out = runCli('config', 'list');
    assert.ok(out.includes('project_name = Config CLI'), `list: ${out}`);
    assert.ok(out.includes('default_port = 6420'), `list port: ${out}`);
    assert.ok(out.includes('statuses'), `list statuses: ${out}`);
  });

  it('ошибки: неизвестный ключ, невалидные значения', () => {
    fresh();
    let out = runCli('config', 'get', 'hacker_key');
    assert.ok(out.includes('Неизвестный ключ конфига'), `get: ${out}`);

    out = runCli('config', 'set', 'no_such_key', 'x');
    assert.ok(out.includes('Неизвестный ключ конфига'), `set: ${out}`);

    out = runCli('config', 'set', 'default_port', 'abc');
    assert.ok(out.includes('ожидается число'), `set число: ${out}`);

    out = runCli('config', 'set', 'auto_commit', 'maybe');
    assert.ok(out.includes('ожидается true или false'), `set boolean: ${out}`);

    out = runCli('config', 'set', 'default_editor');
    assert.ok(out.includes('Использование'), `set без значения: ${out}`);
  });
});
