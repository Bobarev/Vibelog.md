/**
 * Тесты VL-149 — внешние MCP-серверы vibelog-агента (src/agent/external-mcp.ts).
 *
 * Валидация конфига (.vibelog/settings.json mcpServers), подключение фейкового
 * stdio-сервера через command/commandArgs, префикс имен инструментов «<name>__»,
 * маппинг callTool обратно без префикса, изоляция отказов (битый сервер не
 * мешает исправному), enabled:false, closeExternalMcpClients.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadExternalMcpServers,
  connectExternalMcpServers,
  closeExternalMcpClients,
  toolPrefixFor,
} from '../../dist/agent/external-mcp.js';
import { toolsAsSpecs } from '../../dist/agent/mcp-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let testDir;

/** Пишет .vibelog/settings.json с данным содержимым (объект → JSON). */
function writeSettings(data) {
  mkdirSync(join(testDir, '.vibelog'), { recursive: true });
  writeFileSync(join(testDir, '.vibelog', 'settings.json'), JSON.stringify(data, null, 2), 'utf-8');
}

beforeAll(() => {
  // Изолированный /tmp-проект (паттерн mcp-client.test.mjs)
  testDir = mkdtempSync(join(tmpdir(), 'vl-external-mcp-'));

  // Фейковый stdio MCP-сервер: handshake + tools/list с одним инструментом
  // echo (возвращает аргумент message). Набор методов минимальный, но
  // реалистичный — сторонние серверы отвечают так же.
  writeFileSync(join(testDir, 'fake-mcp.mjs'), `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize' && msg.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-server', version: '1.0.0' },
      },
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/list' && msg.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { tools: [{ name: 'echo', description: 'echo message', inputSchema: { type: 'object' } }] },
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/call' && msg.id !== undefined) {
    const text = String(msg.params?.arguments?.message ?? '');
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { content: [{ type: 'text', text }] },
    }) + '\\n');
    return;
  }
  // notifications и прочее — молчим
});
rl.on('close', () => process.exit(0));
`, 'utf-8');
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('loadExternalMcpServers: валидация конфига (VL-149)', () => {
  it('нет файла/ключа mcpServers → пустой список', () => {
    writeSettings({});
    assert.deepEqual(loadExternalMcpServers(testDir), []);
  });

  it('корректная запись → сервер с command/args/env/timeoutMs', () => {
    writeSettings({
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
          env: { CHROME_PATH: '/bin/chrome' },
          timeoutMs: 120000,
        },
      },
    });
    const servers = loadExternalMcpServers(testDir);
    assert.equal(servers.length, 1);
    assert.deepEqual(servers[0], {
      name: 'chrome-devtools',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      env: { CHROME_PATH: '/bin/chrome' },
      timeoutMs: 120000,
    });
  });

  it('битые записи (нет command, args не массив, env не объект) пропускаются', () => {
    writeSettings({
      mcpServers: {
        good: { command: 'node' },
        noCommand: { args: ['x'] },
        emptyCommand: { command: '   ' },
        badArgs: { command: 'node', args: 'not-array' },
        badEnv: { command: 'node', env: ['A=B'] },
        badTimeout: { command: 'node', timeoutMs: -5 },
        notObject: 'string-entry',
      },
    });
    const servers = loadExternalMcpServers(testDir);
    assert.deepEqual(servers.map((s) => s.name), ['good'], `остались: ${servers.map((s) => s.name)}`);
  });

  it('enabled:false остаётся в записи (фильтрация — на подключении)', () => {
    writeSettings({ mcpServers: { off: { command: 'node', enabled: false } } });
    const servers = loadExternalMcpServers(testDir);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].enabled, false);
  });

  it('mcpServers не объект → пустой список с предупреждением', () => {
    writeSettings({ mcpServers: ['array-not-object'] });
    assert.deepEqual(loadExternalMcpServers(testDir), []);
  });
});

describe('toolPrefixFor: имя сервера → префикс инструментов (VL-149)', () => {
  it('дефисы заменяются на _, к имени добавляется __', () => {
    assert.equal(toolPrefixFor('chrome-devtools'), 'chrome_devtools__');
    assert.equal(toolPrefixFor('my_server'), 'my_server__');
  });
});

describe('toolsAsSpecs: namePrefix (VL-149)', () => {
  it('префикс видит только модель; в сервер уходит имя без префикса', async () => {
    // Фейковый клиент: фиксирует имя, переданное в callTool
    const calls = [];
    const fakeClient = {
      callTool: async (name, args) => {
        calls.push({ name, args });
        return 'ok';
      },
    };
    const specs = toolsAsSpecs(fakeClient, [
      { name: 'echo', description: 'd', inputSchema: { type: 'object' } },
    ], 'srv__');
    assert.equal(specs[0].name, 'srv__echo', 'имя для модели — с префиксом');
    await specs[0].handler({ message: 'hi' });
    assert.deepEqual(calls, [{ name: 'echo', args: { message: 'hi' } }], 'в сервер — без префикса');
  });

  it('без префикса — прежнее поведение (обратная совместимость VL-84)', async () => {
    const fakeClient = { callTool: async () => 'ok' };
    const specs = toolsAsSpecs(fakeClient, [{ name: 't', description: 'd', inputSchema: {} }]);
    assert.equal(specs[0].name, 't');
  });
});

describe('connectExternalMcpServers: подключение (VL-149)', () => {
  it('два сервера из конфига → оба подключены, инструменты с префиксами', async () => {
    writeSettings({
      mcpServers: {
        alpha: { command: process.execPath, args: [join(testDir, 'fake-mcp.mjs')] },
        'beta-tool': { command: process.execPath, args: [join(testDir, 'fake-mcp.mjs')] },
      },
    });
    const { clients, specs } = await connectExternalMcpServers(testDir);
    try {
      assert.equal(clients.length, 2);
      assert.deepEqual(
        specs.map((s) => s.name).sort(),
        ['alpha__echo', 'beta_tool__echo'],
        'префиксы: дефис → _, инструменты обоих серверов',
      );
      // Вызов через префикс: сервер получает echo, возвращает аргумент
      const echo = specs.find((s) => s.name === 'beta_tool__echo');
      const out = await echo.handler({ message: 'привет' });
      assert.equal(out, 'привет', 'callTool замаплен обратно на имя без префикса');
    } finally {
      await closeExternalMcpClients(clients);
    }
  });

  it('битый сервер (нет бинарника) не мешает исправному', async () => {
    writeSettings({
      mcpServers: {
        broken: { command: '/nonexistent/mcp-server-xyz' },
        good: { command: process.execPath, args: [join(testDir, 'fake-mcp.mjs')] },
      },
    });
    const { clients, specs } = await connectExternalMcpServers(testDir);
    try {
      assert.equal(clients.length, 1, 'подключился только good');
      assert.deepEqual(specs.map((s) => s.name), ['good__echo']);
    } finally {
      await closeExternalMcpClients(clients);
    }
  });

  it('enabled:false не подключается', async () => {
    writeSettings({
      mcpServers: {
        off: { command: process.execPath, args: [join(testDir, 'fake-mcp.mjs')], enabled: false },
      },
    });
    const { clients, specs } = await connectExternalMcpServers(testDir);
    assert.equal(clients.length, 0);
    assert.equal(specs.length, 0);
    await closeExternalMcpClients(clients);
  });

  it('нет конфига → пустой результат, closeExternalMcpClients идемпотентен', async () => {
    writeSettings({});
    const { clients, specs } = await connectExternalMcpServers(testDir);
    assert.equal(clients.length, 0);
    assert.equal(specs.length, 0);
    await closeExternalMcpClients([]); // не падает на пустом массиве
  });
});
