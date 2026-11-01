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
import { testSpawnEnv } from '../test-env.mjs';

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
  // Тихий MCP-стаб (VL-139): отвечает ТОЛЬКО на initialize, tools/list
  // игнорирует вовсе. Нужен для детерминированного теста таймаута — на
  // реальном сервере «таймаут 1 мс vs быстрый ответ» был гонкой и давал
  // флак (~1 прогон из 5: Missing expected rejection).
  writeFileSync(join(testDir, 'silent-mcp.mjs'), `
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
        serverInfo: { name: 'silent-stub', version: '0.0.0' },
      },
    }) + '\\n');
  }
  // всё остальное (tools/list и пр.) — молчим: клиент получит таймаут
});
`, 'utf-8');
  // Клиент спавнит реальный CLI: node bin/vibelog.mjs mcp start, cwd=/tmp-проект.
  // VL-116/VL-286: env фазы (VIBELOG_CWD/VIBELOG_PHASE_*) не должен утекать в
  // MCP-сервер — иначе задачи теста пишутся в реальный backlog
  const env = testSpawnEnv();
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

    // VL-138/VL-253: finish_phase — обязательны id и comment (comment
    // объявлен в required, иначе tool-calling его не генерирует вовсе)
    const finish = defs.find((d) => d.name === 'backlog_finish_phase');
    assert.ok(finish, `нет backlog_finish_phase: ${names.join(', ')}`);
    assert.deepEqual(finish.inputSchema.required, ['id', 'comment'], 'required — id и comment');
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
    // VL-139: на реальном сервере «таймаут 1 мс vs быстрый ответ» — гонка
    // (флак ~1/5 прогонов). Тихий стаб не отвечает на tools/list вовсе,
    // таймаут детерминирован (200 мс — просто быстрый прогон).
    const silentPath = join(testDir, 'silent-mcp.mjs');
    const silent = await McpClient.create({ bin: process.execPath, binArgs: [silentPath], cwd: testDir });
    try {
      await assert.rejects(silent.request('tools/list', undefined, 200), /таймаут/);
      // Клиент не завис: следующий запрос проходит (стаб отвечает на initialize)
      const info = await silent.request('initialize', { protocolVersion: '2024-11-05' }, 2000);
      assert.equal(info.serverInfo.name, 'silent-stub');
    } finally {
      await silent.close();
    }
    // И основной клиент к тому моменту жив — следующий запрос проходит.
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

describe('MCP-клиент: внешняя команда command/commandArgs (VL-149)', () => {
  it('command задан — спавнится произвольный сервер (без vibelog mcp start)', async () => {
    // silent-mcp.mjs уже написан в beforeAll: отвечает только на initialize.
    // create резолвится после handshake — значит, спавн по command отработал.
    const c = await McpClient.create({
      command: process.execPath,
      commandArgs: [join(testDir, 'silent-mcp.mjs')],
      cwd: testDir,
    });
    try {
      assert.equal(c.exitCode, null, 'внешний сервер должен быть жив');
    } finally {
      await c.close();
    }
  });

  it('command с несуществующим бинарником → reject «MCP-сервер не запущен»', async () => {
    await assert.rejects(
      McpClient.create({ command: '/nonexistent/mcp-server-xyz', cwd: testDir }),
      /MCP-сервер не запущен/,
    );
  });
});
