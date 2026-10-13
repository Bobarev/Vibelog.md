/**
 * Тесты VL-84 — MCP-клиент Vibelog (src/agent/mcp-client.ts).
 *
 * Реальный запуск node bin/vibelog.mjs mcp start в /tmp-проекте (изоляция
 * от репозитория — память cli-test-isolation): handshake, tools/list,
 * tools/call, ошибка метода, isError-инструмент, таймаут, close(),
 * ENOENT спавна, toolsAsSpecs (текст модели при протокольной ошибке).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { McpClient, toolsAsSpecs } from '../../dist/agent/mcp-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

let testDir;
let client;

beforeAll(async () => {
  // Изолированный /tmp-проект: backlog/ + конфиг (паттерн server.test.mjs).
  testDir = mkdtempSync(join(tmpdir(), 'vl-agent-mcp-'));
  mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
  mkdirSync(join(testDir, 'backlog', 'completed'), { recursive: true });
  writeFileSync(join(testDir, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'MCP Client Test',
    task_prefix: 'mcpcli',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  // Клиент спавнит реальный CLI: node bin/vibelog.mjs mcp start, cwd=/tmp-проект.
  // VL-116: env фазы (VIBELOG_CWD/VIBELOG_PHASE_*) не должен утекать в
  // MCP-сервер — иначе задачи теста пишутся в реальный backlog
  const env = { ...process.env };
  delete env.VIBELOG_CWD;
  delete env.VIBELOG_PHASE_TASK_ID;
  delete env.VIBELOG_PHASE_NAME;
  client = await McpClient.create({ bin: process.execPath, binArgs: [cliPath], cwd: testDir, env });
});

afterAll(async () => {
  await client?.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('MCP-клиент: handshake и tools/list (VL-84)', () => {
  it('create выполняет initialize → notifications/initialized', async () => {
    // create резолвился только после успешного handshake — просто живой клиент.
    assert.equal(client.exitCode, null, 'сервер должен быть жив');
  });

  it('listTools содержит backlog_* инструменты с inputSchema', async () => {
    const defs = await client.listTools();
    const names = defs.map((d) => d.name);
    assert.ok(names.includes('backlog_view_task'), `нет backlog_view_task: ${names.join(', ')}`);
    assert.ok(names.includes('backlog_list_tasks'));
    assert.ok(names.includes('backlog_create_task'));
    const view = defs.find((d) => d.name === 'backlog_view_task');
    assert.equal(typeof view.description, 'string');
    assert.equal(typeof view.inputSchema, 'object', 'схема нормализована к inputSchema');
  });
});

describe('MCP-клиент: tools/call (VL-84)', () => {
  it('backlog_create_task → backlog_list_tasks видит задачу', async () => {
    const created = await client.callTool('backlog_create_task', {
      title: 'Задача из MCP-клиента',
      description: 'создана тестом mcp-client',
    });
    assert.match(created, /создана/);
    const listed = await client.callTool('backlog_list_tasks', {});
    assert.match(listed, /Задача из MCP-клиента/, 'задача должна попасть в список');
  });

  it('isError=true сервера → tool-результат с пометкой, не исключение', async () => {
    // toolViewTask бросает «Задача … не найдена» → сервер отдаёт isError=true.
    const text = await client.callTool('backlog_view_task', { id: 'NOPE-999' });
    assert.match(text, /^Ошибка MCP-инструмента backlog_view_task:/);
    assert.match(text, /не найдена/);
  });

  it("manage_dod: index '2.5' → isError с подсказкой формата (VL-120)", async () => {
    // Дробный индекс не должен «срезаться» до 2 — ошибка с форматом и лимитом.
    const created = await client.callTool('backlog_create_task', { title: 'DoD validation' });
    const taskId = created.match(/mcpcli-\d+/)[0];
    await client.callTool('backlog_manage_dod', { id: taskId, action: 'add', text: 'D1' });
    await client.callTool('backlog_manage_dod', { id: taskId, action: 'add', text: 'D2' });
    const text = await client.callTool('backlog_manage_dod', { id: taskId, action: 'check', index: '2.5' });
    assert.match(text, /^Ошибка MCP-инструмента backlog_manage_dod:/, `нет пометки isError: ${text}`);
    assert.match(text, /целое число, начиная с 1/, `нет подсказки формата: ${text}`);
    assert.match(text, /пунктов чек-листа: 2/, `нет количества пунктов: ${text}`);
  });

  it('батч-отметка manage_dod: массив, all, batch-add (VL-135)', async () => {
    const created = await client.callTool('backlog_create_task', { title: 'DoD batch VL-135' });
    const taskId = created.match(/mcpcli-\d+/)[0];
    // batch-add: массив строк → отдельные пункты, не слияние «D1,D2»
    await client.callTool('backlog_manage_dod', { id: taskId, action: 'add', text: ['D1', 'D2'] });
    const list = await client.callTool('backlog_manage_dod', { id: taskId, action: 'list' });
    assert.match(list, /1\. ○ D1/, `нет пункта D1: ${list}`);
    assert.match(list, /2\. ○ D2/, `нет пункта D2: ${list}`);
    assert.ok(!list.includes('D1,D2'), 'batch-add не должен сливать пункты в один');

    // два пункта за один вызов
    const batch = await client.callTool('backlog_manage_dod', { id: taskId, action: 'check', index: [1, 2] });
    assert.ok(!batch.startsWith('Ошибка MCP-инструмента'), `батч [1,2] упал: ${batch}`);
    assert.match(batch, /Отмечено пунктов: 2/, `неожиданный ответ: ${batch}`);

    // 'all' — все пункты списка
    const all = await client.callTool('backlog_manage_dod', { id: taskId, action: 'check', index: 'all' });
    assert.ok(!all.startsWith('Ошибка MCP-инструмента'), `батч 'all' упал: ${all}`);
    assert.match(all, /Отмечено пунктов: /, `неожиданный ответ: ${all}`);
  });
});

describe('MCP-клиент: ошибки протокола (VL-84)', () => {
  it('неизвестный метод → reject с JSON-RPC ошибкой -32601', async () => {
    await assert.rejects(
      client.request('no/such/method', {}),
      (err) => {
        assert.match(err.message, /MCP ошибка -32601/);
        assert.match(err.message, /Method not found/);
        return true;
      },
    );
  });

  it('таймаут запроса → reject «таймаут», клиент жив', async () => {
    // Таймаут на один вызов: 1 мс не успевает дождаться ответа сервера.
    await assert.rejects(client.request('tools/list', undefined, 1), /таймаут/);
    // Клиент не завис: следующий запрос проходит (сервер отвечает быстро).
    const defs = await client.listTools();
    assert.ok(defs.length > 0);
  });

  it('ENOENT спавна → reject «MCP-сервер не запущен»', async () => {
    await assert.rejects(
      McpClient.create({ bin: '/nonexistent/vibelog-xyz', cwd: testDir }),
      /MCP-сервер не запущен/,
    );
  });
});

describe('MCP-клиент: завершение (VL-84)', () => {
  it('close(): stdin EOF → сервер выходит сам, exitCode 0', async () => {
    const c2 = await McpClient.create({ bin: process.execPath, binArgs: [cliPath], cwd: testDir });
    await c2.close();
    assert.equal(c2.exitCode, 0, 'сервер должен завершиться с кодом 0');
  });
});

describe('toolsAsSpecs: проксирование в loop (VL-84)', () => {
  it('handler возвращает текст модели; ошибки протокола — текст, не исключение', async () => {
    const defs = await client.listTools();
    const specs = toolsAsSpecs(client, defs);
    const byName = new Map(specs.map((s) => [s.name, s]));
    assert.ok(byName.has('backlog_list_tasks'));
    const out = await byName.get('backlog_list_tasks').handler({});
    assert.match(out, /Задача из MCP-клиента/, 'вызов проксируется через handler');

    // Мёртвый клиент: исключение протокола → текст «MCP-вызов … не выполнен».
    const dead = await McpClient.create({ bin: process.execPath, binArgs: [cliPath], cwd: testDir });
    await dead.close();
    const deadSpecs = toolsAsSpecs(dead, [{ name: 'backlog_list_tasks', description: '', inputSchema: { type: 'object' } }]);
    const failText = await deadSpecs[0].handler({});
    assert.match(failText, /^MCP-вызов backlog_list_tasks не выполнен: MCP-клиент закрыт/);
  });
});
