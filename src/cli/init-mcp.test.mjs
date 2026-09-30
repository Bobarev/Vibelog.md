/**
 * Тесты VL-6 — MCP-автонастройка через vibelog init.
 *
 * Проверяет:
 * - init добавляет mcpServers.vibelog в .qwen/settings.json
 * - чужие ключи settings.json сохраняются (merge, не replace)
 * - идемпотентность повторного init (--force)
 * - --no-mcp не создаёт settings.json
 * - повреждённый JSON не роняет init
 *
 * По паттерну skills.test.mjs: проверяем содержимое файлов/вывод,
 * а не exit code (на Catalina SIGABRT перехватывает коды выхода).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = '/tmp/vibelog-init-mcp-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const settingsPath = join(testDir, '.qwen', 'settings.json');

/** Чистая директория для теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr: сообщения об ошибках печатаются
  // в stderr при exit code 0 — execFileSync вернул бы только пустой stdout
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

describe('VL-6 — init MCP-настройка', () => {
  after(() => cleanup());

  it('init добавляет mcpServers.vibelog в .qwen/settings.json', () => {
    fresh();
    const out = runCli('init', 'MCP Test', '--prefix', 'mcp');
    assert.ok(out.includes('MCP-сервер vibelog настроен'), `out: ${out}`);
    assert.ok(existsSync(settingsPath), 'settings.json должен существовать');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.deepEqual(settings.mcpServers.vibelog, {
      command: 'vibelog',
      args: ['mcp', 'start'],
      trust: true,
    });
  });

  it('чужие ключи settings.json сохраняются (merge)', () => {
    fresh();
    mkdirSync(join(testDir, '.qwen'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      ui: { theme: 'Qwen Light' },
      $version: 4,
      mcpServers: { other: { command: 'other-cmd' } },
    }), 'utf-8');

    runCli('init', 'Merge Test', '--prefix', 'mgt');

    const s = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.deepEqual(s.ui, { theme: 'Qwen Light' }, 'ui сохраняется');
    assert.equal(s.$version, 4, '$version сохраняется');
    assert.deepEqual(s.mcpServers.other, { command: 'other-cmd' }, 'чужой mcpServer сохраняется');
    assert.equal(s.mcpServers.vibelog.command, 'vibelog', 'vibelog добавлен');
  });

  it('повторный init (--force) идемпотентен', () => {
    fresh();
    runCli('init', 'Idem Test', '--prefix', 'idt');
    const first = readFileSync(settingsPath, 'utf-8');

    runCli('init', 'Idem Test', '--prefix', 'idt', '--force');
    const second = readFileSync(settingsPath, 'utf-8');

    assert.equal(second, first, 'settings.json не должен меняться');
    const s = JSON.parse(second);
    const vibelogKeys = Object.keys(s.mcpServers).filter(k => k === 'vibelog');
    assert.equal(vibelogKeys.length, 1, 'секция vibelog ровно одна');
  });

  it('--no-mcp не создаёт settings.json', () => {
    fresh();
    runCli('init', 'No MCP', '--prefix', 'nom', '--no-mcp');
    assert.ok(!existsSync(settingsPath), 'settings.json не должен создаваться');
    assert.ok(existsSync(join(testDir, 'backlog', 'config.yml')), 'backlog создаётся');
  });

  it('повреждённый JSON не роняет init', () => {
    fresh();
    mkdirSync(join(testDir, '.qwen'), { recursive: true });
    writeFileSync(settingsPath, '{битый json', 'utf-8');

    const out = runCli('init', 'Broken', '--prefix', 'brk');

    assert.ok(out.includes('Не удалось разобрать'), `out: ${out}`);
    assert.ok(existsSync(join(testDir, 'backlog', 'config.yml')), 'backlog должен быть создан');
  });
});
