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
    // VL-116: env фазы (VIBELOG_CWD/VIBELOG_PHASE_*) не должен утекать в
    // MCP-сервер — иначе backlog пишется в реальный репозиторий, а не в
    // /tmp-фикстуру (инцидент загрязнения 2026-10-12)
    // VL-132: единообразный env-гард (mcp и так в SKIP_COMMANDS, но защита не помешает)
    const env = { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' };
    delete env.VIBELOG_CWD;
    delete env.VIBELOG_PHASE_TASK_ID;
    delete env.VIBELOG_PHASE_NAME;
    const proc = spawn('node', [cliPath, 'mcp', 'start'], {
      cwd: testDir,
      env,
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

  it('tools/call — backlog_update_task записывает modifiedFiles (roundtrip)', async () => {
    // VL-97: поле modified_files должно записываться в frontmatter и читаться обратно —
    // иначе close-шаг не может собрать feat-коммит по затронутым файлам
    const createResponses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_create_task', arguments: { title: 'MF Task' } } },
    ]);
    const createResp = createResponses.find(r => r.id === 2);
    assert.ok(createResp);
    // ID достаём из ответа create — хардкод 'mcp-1' сломается при изменении порядка тестов
    const createdId = createResp.result.content[0].text.match(/mcp-\d+/)[0];

    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_update_task', arguments: { id: createdId, modifiedFiles: ['src/a.ts', 'docs/b.md'] } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id: createdId } } },
    ]);
    const updResp = responses.find(r => r.id === 2);
    assert.ok(updResp);
    assert.ok(updResp.result.content[0].text.includes('modified_files'));
    // Roundtrip: view_task вернул записанное поле из frontmatter
    const viewResp = responses.find(r => r.id === 3);
    assert.ok(viewResp);
    const data = JSON.parse(viewResp.result.content[0].text);
    assert.deepEqual(data.modified_files, ['src/a.ts', 'docs/b.md']);
  });

  it('tools/call — backlog_manage_ac валидирует index (VL-120)', async () => {
    // Задача с 2 AC; index:'NaN' → isError с подсказкой формата, index:'2' (строка) → успех
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_create_task', arguments: { title: 'AC validation' } } },
    ]);
    // ID достаём из ответа — в фикстуре уже могут быть задачи от других тестов
    const createdId = responses.find(r => r.id === 2).result.content[0].text.match(/mcp-\d+/)[0];
    const responses2 = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'add', text: 'К1' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'add', text: 'К2' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'check', index: 'NaN' } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'check', index: '2' } } },
    ]);
    const all = [...responses, ...responses2];
    const badResp = all.find(r => r.id === 5);
    assert.ok(badResp);
    assert.equal(badResp.result.isError, true, 'index NaN должен дать isError');
    const badText = badResp.result.content[0].text;
    assert.ok(badText.includes('целое число, начиная с 1'), `нет подсказки формата: ${badText}`);
    assert.ok(badText.includes('пунктов чек-листа: 2'), `нет количества пунктов: ${badText}`);
    const goodResp = all.find(r => r.id === 6);
    assert.ok(goodResp);
    assert.ok(!goodResp.result.isError, 'строка-число "2" должна приниматься');
    assert.ok(goodResp.result.content[0].text.includes('#2'));
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
