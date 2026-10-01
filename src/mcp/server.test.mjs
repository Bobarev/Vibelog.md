import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { stringifyYaml } from '../../dist/core/yaml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-mcp');
const backlogDir = join(testDir, 'backlog');
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function setup() {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  mkdirSync(join(backlogDir, 'completed'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'MCP Test',
    task_prefix: 'mcp',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
}

function cleanup() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
}

/**
 * Запускает MCP-сервер и отправляет JSON-RPC сообщения.
 *
 * @param {string[]} messages — массив JSON-RPC сообщений
 * @returns {Promise<object[]>} — массив ответов
 */
function callMcp(messages) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [cliPath, 'mcp', 'start'], {
      cwd: testDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses = [];
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // последняя неполная строка
      for (const line of lines) {
        if (line.trim()) {
          try { responses.push(JSON.parse(line)); } catch { /* ignore */ }
        }
      }
    });

    proc.stderr.on('data', () => {}); // игнорируем stderr

    // Отправляем все сообщения
    for (const msg of messages) {
      proc.stdin.write(JSON.stringify(msg) + '\n');
    }
    proc.stdin.end();

    // Ждём завершения
    proc.on('close', () => resolve(responses));
    proc.on('error', reject);

    // Таймаут
    setTimeout(() => { proc.kill(); resolve(responses); }, 5000);
  });
}

describe('MCP-сервер', () => {
  before(() => setup());
  after(() => cleanup());

  it('initialize — возвращает capabilities', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ]);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 1);
    assert.equal(responses[0].result.serverInfo.name, 'vibelog-md');
    assert.ok(responses[0].result.capabilities.tools);
  });

  it('tools/list — возвращает 21 инструмент', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const listResp = responses.find(r => r.id === 2);
    assert.ok(listResp);
    assert.equal(listResp.result.tools.length, 21);
    const names = listResp.result.tools.map(t => t.name);
    // Существующие
    assert.ok(names.includes('backlog_create_task'));
    assert.ok(names.includes('backlog_list_tasks'));
    assert.ok(names.includes('backlog_view_task'));
    assert.ok(names.includes('backlog_update_status'));
    assert.ok(names.includes('backlog_search'));
    assert.ok(names.includes('backlog_ready'));
    // Новые v1.1
    assert.ok(names.includes('backlog_update_task'));
    assert.ok(names.includes('backlog_manage_ac'));
    assert.ok(names.includes('backlog_manage_dod'));
    assert.ok(names.includes('backlog_add_comment'));
    assert.ok(names.includes('backlog_update_dependencies'));
  });

  it('tools/call — backlog_create_task создаёт задачу', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'backlog_create_task',
          arguments: { title: 'MCP Task', priority: 'High', labels: ['test'] },
        },
      },
    ]);
    const callResp = responses.find(r => r.id === 2);
    assert.ok(callResp);
    assert.ok(callResp.result.content[0].text.includes('mcp-1'));
  });

  it('tools/call — backlog_list_tasks возвращает список', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_list_tasks', arguments: {} } },
    ]);
    const callResp = responses.find(r => r.id === 2);
    assert.ok(callResp);
    const data = JSON.parse(callResp.result.content[0].text);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 1);
  });

  it('tools/call — backlog_search ищет задачи', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_search', arguments: { query: 'MCP' } } },
    ]);
    const callResp = responses.find(r => r.id === 2);
    assert.ok(callResp);
    const data = JSON.parse(callResp.result.content[0].text);
    assert.ok(data.length >= 1);
    assert.ok(data[0].title.includes('MCP'));
  });

  it('tools/call — backlog_ready возвращает готовые задачи', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_ready', arguments: {} } },
    ]);
    const callResp = responses.find(r => r.id === 2);
    assert.ok(callResp);
    const data = JSON.parse(callResp.result.content[0].text);
    assert.ok(Array.isArray(data));
  });

  it('Неизвестный метод → error', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'nonexistent', params: {} },
    ]);
    const errResp = responses.find(r => r.id === 2);
    assert.ok(errResp);
    assert.ok(errResp.error);
    assert.equal(errResp.error.code, -32601);
  });

  it('ping → pong', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'ping', params: {} },
    ]);
    const pong = responses.find(r => r.id === 2);
    assert.ok(pong);
    assert.deepStrictEqual(pong.result, {});
  });
});
