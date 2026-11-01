import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { agentSessionsDir } from '../../dist/agent/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-mcp-server-'));
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

// ——— Постоянный MCP-процесс (VL-139) ———
// Раньше каждый callMcp спавнил `node cli mcp start` (spawn ~100–400 мс на
// каждый из десятков вызовов). Теперь сервер живёт один на весь файл:
// beforeAll спавнит его один раз, callMcp пишет батч в тот же stdin и ждёт
// ответы по id из stdout. Тесты остаются интеграционными (живой сервер),
// но без N спавнов.
let proc = null;
let buffer = '';
const received = [];

/** Спавнит MCP-сервер один раз на файл (env-гард VL-116/VL-132). */
function startServer() {
  // VL-116: env фазы (VIBELOG_CWD/VIBELOG_PHASE_*) не должен утекать в
  // MCP-сервер — иначе backlog пишется в реальный репозиторий, а не в
  // тестовую фикстуру (инцидент загрязнения 2026-10-12)
  // VL-132: единообразный env-гард (mcp и так в SKIP_COMMANDS, но защита не помешает)
  const env = { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' };
  delete env.VIBELOG_CWD;
  delete env.VIBELOG_PHASE_TASK_ID;
  delete env.VIBELOG_PHASE_NAME;
  // VL-259: учёт фазы/времени рана тоже не наследуем из родительской фазы
  delete env.VIBELOG_RUN_PHASE;
  delete env.VIBELOG_RUN_STARTED_AT;
  // VL-198: сессия тестового окружения не должна утекать в fallback
  // finish_phase (иначе мета/jsonl реального репо попадут в фикстуры)
  delete env.VIBELOG_SESSION_ID;
  proc = spawn('node', [cliPath, 'mcp', 'start'], {
    cwd: testDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Построчный парсинг stdout: каждая строка — один JSON-RPC ответ
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // последняя неполная строка
    for (const line of lines) {
      if (line.trim()) {
        try { received.push(JSON.parse(line)); } catch { /* ignore */ }
      }
    }
  });

  proc.stderr.on('data', () => {}); // игнорируем stderr
}

/**
 * Отправляет батч JSON-RPC сообщений в постоянный сервер и ждёт ответы на все id батча.
 *
 * Дубли id между батчами безопасны: батчи последовательны (каждый callMcp —
 * await), а срез received.slice(start) отсекает ответы предыдущих батчей.
 *
 * @param {object[]} messages — массив JSON-RPC сообщений
 * @returns {Promise<object[]>} — ответы батча в порядке появления
 */
async function callMcp(messages) {
  const start = received.length; // снапшот до записи — отсекает старые ответы
  for (const msg of messages) {
    proc.stdin.write(JSON.stringify(msg) + '\n');
  }
  // Без stdin.end(): сервер живёт дальше, stdin закроется в afterAll
  const wanted = new Set(messages.map((m) => m.id));
  const deadline = Date.now() + 5000; // per-batch таймаут 5 с (как раньше)
  while (Date.now() < deadline) {
    const batch = received.slice(start);
    if ([...wanted].every((id) => batch.some((r) => r.id === id))) {
      return batch;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  proc.kill(); // зависший сервер — как в старом callMcp (таймаут + kill)
  throw new Error(`MCP: нет ответа за 5 с для ids: ${[...wanted].join(', ')}`);
}

describe('MCP-сервер', () => {
  beforeAll(() => {
    setup(); // сначала фикстура (testDir — cwd сервера), потом spawn
    startServer();
  });
  afterAll(async () => {
    // Graceful exit: server.ts закрывает rl по stdin.end() и сам выходит
    // (rl close -> process.exit(0)); если не вышел за 2 с — kill
    if (proc) {
      const closed = new Promise((resolve) => proc.on('close', resolve));
      proc.stdin.end();
      const killer = setTimeout(() => proc.kill(), 2000);
      await closed;
      clearTimeout(killer);
      proc = null;
    }
    cleanup();
  });

  /**
   * Батч JSON-RPC в ОТДЕЛЬНОМ MCP-сервере с дополнительным env (VL-253).
   * Нужен для кейсов, где поведение зависит от env сервера (VIBELOG_SESSION_ID):
   * env задаётся только при спавне, поэтому основной `proc` не подходит.
   * Сервер одноразовый: гасим по stdin.end() либо kill по таймауту.
   */
  async function callMcpWithEnv(messages, extraEnv) {
    const env = { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true', ...extraEnv };
    delete env.VIBELOG_CWD;
    delete env.VIBELOG_PHASE_TASK_ID;
    if (!('VIBELOG_PHASE_NAME' in extraEnv)) delete env.VIBELOG_PHASE_NAME;
    // VL-259: фаза/время рана — явно переданные сохраняются, унаследованные срезаются
    if (!('VIBELOG_RUN_PHASE' in extraEnv)) delete env.VIBELOG_RUN_PHASE;
    if (!('VIBELOG_RUN_STARTED_AT' in extraEnv)) delete env.VIBELOG_RUN_STARTED_AT;
    if (!('VIBELOG_SESSION_ID' in extraEnv)) delete env.VIBELOG_SESSION_ID;
    const child = spawn('node', [cliPath, 'mcp', 'start'], {
      cwd: testDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const got = [];
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          try { got.push(JSON.parse(line)); } catch { /* ignore */ }
        }
      }
    });
    child.stderr.on('data', () => {});
    for (const msg of messages) child.stdin.write(JSON.stringify(msg) + '\n');
    const wanted = new Set(messages.map((m) => m.id));
    const deadline = Date.now() + 5000;
    try {
      while (Date.now() < deadline) {
        if ([...wanted].every((id) => got.some((r) => r.id === id))) return got;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`MCP(env): нет ответа за 5 с для ids: ${[...wanted].join(', ')}`);
    } finally {
      child.stdin.end();
      setTimeout(() => child.kill(), 1000);
    }
  }

  it('initialize — возвращает capabilities', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ]);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 1);
    assert.equal(responses[0].result.serverInfo.name, 'vibelog-md');
    assert.ok(responses[0].result.capabilities.tools);
  });

  it('tools/list — возвращает 42 инструмента', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const listResp = responses.find(r => r.id === 2);
    assert.ok(listResp);
    assert.equal(listResp.result.tools.length, 42);
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
    // VL-138
    assert.ok(names.includes('backlog_finish_phase'));
    // VL-253 (AC2): comment объявлен в required схемы, а не только в описании —
    // именно это ломало tool-calling (модель не генерировала поле → луп).
    const finishDef = listResp.result.tools.find((t) => t.name === 'backlog_finish_phase');
    assert.ok(finishDef, 'backlog_finish_phase должна быть в tools/list');
    assert.ok(
      Array.isArray(finishDef.inputSchema.required) && finishDef.inputSchema.required.includes('comment'),
      `comment должен быть в required схемы: ${JSON.stringify(finishDef.inputSchema.required)}`,
    );
    assert.equal(finishDef.inputSchema.properties.comment.type, 'string', 'comment объявлен в properties как string');
    // VL-244 (AC3): явный сигнал «фаза прервана» — без него аварийные ветки
    // шаблонов завершались кодом 0 и получали produces_status (VL-219)
    assert.equal(
      finishDef.inputSchema.properties.aborted.type,
      'boolean',
      'aborted объявлен в properties как boolean',
    );
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
    assert.ok(data.found >= 1);
    assert.ok(data.tasks.length >= 1);
    assert.ok(data.tasks[0].title.includes('MCP'));
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

  it('tools/call — батч-отметка (VL-135): массив, all, строка-массив', async () => {
    // Задача с 3 AC: check [1,3] / 'all' / '[2]' — новый формат «Отмечено пунктов: N (…)»;
    // scalar и подсказки VL-120 не регрессируют.
    const created = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_create_task', arguments: { title: 'Batch AC' } } },
    ]);
    const createdId = created.find(r => r.id === 2).result.content[0].text.match(/mcp-\d+/)[0];
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'add', text: 'К1' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'add', text: 'К2' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'add', text: 'К3' } } },
      // два пункта за один вызов
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'check', index: [1, 3] } } },
      // все пункты
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'check', index: 'all' } } },
      // строка-массив
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'check', index: '[2]' } } },
      // scalar-строка — старый формат с «#2»
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'uncheck', index: '2' } } },
      // невалидные значения — подсказка VL-120 не регрессирует
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'check', index: 'NaN' } } },
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'check', index: '2.5' } } },
      // list — состояние после батчей
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id: createdId, action: 'list' } } },
    ]);
    const byId = (id) => responses.find(r => r.id === id);

    const arr = byId(6);
    assert.ok(!arr.result.isError, 'check [1,3] должен пройти');
    assert.ok(arr.result.content[0].text.includes('Отмечено пунктов: 2 (1, 3)'),
      `неожиданный ответ батча: ${arr.result.content[0].text}`);

    const all = byId(7);
    assert.ok(!all.result.isError, "check 'all' должен пройти");
    assert.ok(all.result.content[0].text.includes('Отмечено пунктов: 3 (1, 2, 3)'),
      `неожиданный ответ all: ${all.result.content[0].text}`);

    const strArr = byId(8);
    assert.ok(!strArr.result.isError, `check '[2]' должен пройти: ${strArr.result.content[0].text}`);

    const scalar = byId(9);
    assert.ok(!scalar.result.isError, 'scalar uncheck "2" должен пройти');
    assert.ok(scalar.result.content[0].text.includes('#2'),
      `scalar-формат изменился: ${scalar.result.content[0].text}`);

    for (const id of [10, 11]) {
      const bad = byId(id);
      assert.equal(bad.result.isError, true, `index id=${id} должен дать isError`);
      const text = bad.result.content[0].text;
      assert.ok(text.includes('целое число, начиная с 1'), `нет подсказки формата: ${text}`);
      assert.ok(text.includes('пунктов чек-листа: 3'), `нет количества пунктов: ${text}`);
    }

    // list: К1 ✓ (check [1,3] + all), К2 снята scalar-uncheck, К3 ✓
    const listText = byId(12).result.content[0].text;
    assert.ok(/1\. ✓ К1/.test(listText), `К1 должна быть отмечена: ${listText}`);
    assert.ok(/2\. ○ К2/.test(listText), `К2 должна быть снята: ${listText}`);
    assert.ok(/3\. ✓ К3/.test(listText), `К3 должна быть отмечена: ${listText}`);
  });

  // ============================================================
  // VL-138 — backlog_finish_phase: завершение фазы одним вызовом
  // ============================================================
  describe('tools/call — backlog_finish_phase (VL-138)', () => {
    // Статусы тест-фикстуры: ['To Do', 'In Progress', 'Done'] — другие брать нельзя
    async function createTask(title) {
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_create_task', arguments: { title } } },
      ]);
      const resp = responses.find(r => r.id === 2);
      return resp.result.content[0].text.match(/mcp-\d+/)[0];
    }

    it('только status + comment → сводка и запись в файл задачи', async () => {
      const id = await createTask('Finish: status+comment');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, status: 'Done', comment: 'Фаза завершена' } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `вызов не должен падать: ${fin.result.content[0].text}`);
      const text = fin.result.content[0].text;
      assert.ok(text.includes('Статус: Done'), `нет статуса в сводке: ${text}`);
      assert.ok(text.includes('отчёт добавлен'), `нет отчёта в сводке: ${text}`);

      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.equal(data.status, 'Done', 'статус должен записаться в файл');
      assert.equal(data.comments.length, 1, 'комментарий должен записаться в файл');
      assert.equal(data.comments[0].author, '@agent');
      assert.ok(data.comments[0].text.includes('Фаза завершена'));
    });

    it('acChecks: [1, "2"] → батч-отметка AC, в сводке AC: 2', async () => {
      const id = await createTask('Finish: acChecks');
      await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id, action: 'add', text: 'К1' } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id, action: 'add', text: 'К2' } } },
      ]);
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, comment: 'Фаза (acChecks)', acChecks: [1, '2'] } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id, action: 'list' } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `вызов не должен падать: ${fin.result.content[0].text}`);
      assert.ok(fin.result.content[0].text.includes('AC: 2'), `нет AC: 2 в сводке: ${fin.result.content[0].text}`);

      const listText = responses.find(r => r.id === 3).result.content[0].text;
      assert.ok(/1\. ✓ К1/.test(listText), `К1 должна быть отмечена: ${listText}`);
      assert.ok(/2\. ✓ К2/.test(listText), `К2 должна быть отмечена: ${listText}`);
    });

    it('modifiedFiles → modified_files в файле задачи', async () => {
      const id = await createTask('Finish: modifiedFiles');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, comment: 'Фаза (modifiedFiles)', modifiedFiles: ['src/a.ts'] } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `вызов не должен падать: ${fin.result.content[0].text}`);
      assert.ok(fin.result.content[0].text.includes('файлов: 1'), `нет файлов: 1 в сводке: ${fin.result.content[0].text}`);

      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.deepEqual(data.modified_files, ['src/a.ts']);
    });

    it('невалидный статус → вызов НЕ падает, ошибка в сводке, comment применяется', async () => {
      const id = await createTask('Finish: bogus status');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, status: 'Bogus', comment: 'Отчёт несмотря на ошибку' } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      // Частичное применение: ошибка валидации — не isError, а текст в сводке
      assert.ok(!fin.result.isError, `невалидный статус не должен ронять вызов: ${fin.result.content[0].text}`);
      const text = fin.result.content[0].text;
      assert.ok(text.includes('Ошибки'), `нет блока Ошибки: ${text}`);
      assert.ok(text.includes('Невалидный статус'), `нет сообщения о статусе: ${text}`);

      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.equal(data.status, 'To Do', 'невалидный статус не должен записаться');
      assert.equal(data.comments.length, 1, 'comment должен примениться несмотря на ошибку статуса');
      assert.ok(data.comments[0].text.includes('Отчёт несмотря на ошибку'));
    });

    it('VL-253: вызов без report → авто-отчёт, фаза завершается без ошибки', async () => {
      const id = await createTask('Finish: только id');
      // Подготовка: статус, AC и файлы, чтобы авто-отчёт было из чего собирать
      await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id, action: 'add', text: 'Критерий А' } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_manage_dod', arguments: { id, action: 'add', text: 'Пункт DoD' } } },
      ]);
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id, status: 'In Progress', acChecks: [1], dodChecks: [1], modifiedFiles: ['src/a.ts', 'src/b.ts'],
        } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `вызов без отчёта НЕ должен падать (VL-253): ${fin.result.content[0].text}`);
      const text = fin.result.content[0].text;
      assert.ok(text.includes('отчёт добавлен (авто)'), `нет пометки об авто-отчёте: ${text}`);
      assert.ok(text.includes('Статус: In Progress'), `статус не применён: ${text}`);
      assert.ok(!text.includes('Неполный вызов'), `жёсткой ошибки больше нет: ${text}`);

      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.equal(data.status, 'In Progress', 'статус записывается');
      assert.equal(data.comments.length, 1, 'авто-отчёт записывается комментарием');
      assert.equal(data.comments[0].author, '@agent');
      const report = data.comments[0].text;
      // AC3: авто-отчёт содержит статус, AC/DoD, modified_files
      assert.ok(report.includes('авто-отчёт'), `нет маркера авто-отчёта: ${report}`);
      assert.ok(report.includes('VL-253'), `нет ссылки на VL-253: ${report}`);
      assert.ok(report.includes('Статус: In Progress'), `нет статуса: ${report}`);
      assert.ok(report.includes('AC отмечено: 1 из 1'), `нет счётчика AC: ${report}`);
      assert.ok(report.includes('DoD отмечено: 1 из 1'), `нет счётчика DoD: ${report}`);
      assert.ok(report.includes('src/a.ts'), `нет modified_files: ${report}`);
      assert.ok(/план|резюме/i.test(report), `нет фрагмента плана/резюме: ${report}`);
      assert.deepEqual(data.modified_files, ['src/a.ts', 'src/b.ts']);
    });

    it('VL-253: авто-отчёт берёт фрагмент Implementation Plan, если он есть', async () => {
      const id = await createTask('Finish: авто-отчёт с планом');
      await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_update_task', arguments: { id, plan: 'Шаг 1: починить схему. Шаг 2: добавить fallback.' } } },
      ]);
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, status: 'In Progress' } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `авто-отчёт не должен падать: ${fin.result.content[0].text}`);
      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.ok(
        data.comments[0].text.includes('Фрагмент плана: Шаг 1: починить схему'),
        `фрагмент плана должен попасть в отчёт: ${data.comments[0].text}`,
      );
    });

    it('VL-253: явный tokenUsage после упавшего рана → игнорируется', async () => {
      const id = await createTask('Finish: usage после падения');
      const sessionId = 'vl253-failed-run';
      const sessionsDir = agentSessionsDir(testDir);
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${sessionId}.meta.json`), JSON.stringify({
        sessionId,
        cwd: testDir,
        taskId: id,
        phase: 'plan',
        last_run: { is_error: true, finishedAt: new Date().toISOString() },
      }), 'utf-8');

      // env VIBELOG_SESSION_ID для MCP-сервера задаётся через tools/call
      // невозможно — сервер спавнится в beforeAll без env; поэтому прогоняем
      // отдельный сервер с env (см. spawnServerWithEnv ниже)
      const responses = await callMcpWithEnv([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id, status: 'In Progress', comment: 'Фаза (usage после падения)', phase: 'plan',
          tokenUsage: { input: 174247, output: 3200, total: 177447 },
        } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ], { VIBELOG_SESSION_ID: sessionId });

      const fin = responses.find(r => r.id === 2);
      const text = fin.result.content[0].text;
      assert.ok(
        text.includes('проигнорирован (значения получены после упавшей фазы)'),
        `нет пометки об игноре tokenUsage: ${text}`,
      );
      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      const input = data.token_usage?.input ?? 0;
      assert.ok(input < 174247, `usage упавшего рана не должен записываться: ${input}`);
    });

    it('VL-259: by_phase пишется фазой РАНА (VIBELOG_RUN_PHASE), а не фазы сессии/prompt', async () => {
      const sessionId = 'agent-vl259-runphase';
      const sessionsDir = agentSessionsDir(testDir);
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${sessionId}.jsonl`), [
        JSON.stringify({ role: 'user', content: 'Продолжи' }),
        JSON.stringify({ role: 'assistant', content: 'ок', usage: { input_tokens: 70, output_tokens: 30, cache_read_input_tokens: 0, total_tokens: 100 } }),
        '',
      ].join('\n'), 'utf-8');
      // Мета принадлежит план-сессии, ран — code (resume при code_same_session)
      writeFileSync(join(sessionsDir, `${sessionId}.meta.json`), JSON.stringify({
        sessionId, cwd: testDir, phase: 'plan',
      }), 'utf-8');

      const id = await createTask('Tokens: run phase');
      const responses = await callMcpWithEnv([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id, comment: 'Фаза code в план-сессии',
        } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ], {
        VIBELOG_SESSION_ID: sessionId,
        VIBELOG_RUN_PHASE: 'code',
        // env фазы сессии служебная — не должна попасть в by_phase
        VIBELOG_PHASE_NAME: 'prompt',
      });

      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `не должен падать: ${fin.result.content[0].text}`);
      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      const byPhase = data.token_usage?.by_phase ?? {};
      assert.ok(byPhase.code, `by_phase.code должен появиться: ${JSON.stringify(byPhase)}`);
      assert.equal(byPhase.code.input, 70);
      assert.equal(byPhase.prompt, undefined, 'служебная фаза prompt не попадает в by_phase');
      assert.equal(byPhase.plan, undefined, 'фаза сессии не подменяет фазу рана');
    });

    it('VL-251: no-op статус (равен текущему) → isError already_finished с датой отчёта', async () => {
      const id = await createTask('Finish: already finished');
      // Первый вызов — легитимное завершение фазы (статус To Do → In Progress)
      await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, status: 'In Progress', comment: 'Фаза (первый отчёт)' } } },
      ]);
      // Повтор с тем же статусом — ровно инцидент VL-234
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, status: 'In Progress', comment: 'Фаза (повтор)' } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(fin.result.isError, `no-op статус должен падать: ${fin.result.content[0].text}`);
      const text = fin.result.content[0].text;
      assert.ok(text.includes('уже завершена'), `нет признака already_finished: ${text}`);
      assert.ok(text.includes('Существующий отчёт'), `нет ссылки на существующий отчёт: ${text}`);
      assert.ok(text.includes('@agent'), `нет автора существующего отчёта: ${text}`);

      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.equal(data.comments.length, 1, 'дубль комментария не должен записаться');
      assert.ok(data.comments[0].text.includes('первый отчёт'), 'первый отчёт сохранён');
    });

    it('VL-251: токен-нули = отсутствующий параметр → пометка в сводке, вызов успешен', async () => {
      const id = await createTask('Finish: zero tokens');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id, status: 'Done', comment: 'Фаза (нулевой usage)',
          tokenUsage: { input: 0, output: 0, cache: 0, total: 0, requests: 0 },
        } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `нулевой usage не должен ронять вызов: ${fin.result.content[0].text}`);
      const text = fin.result.content[0].text;
      assert.ok(text.includes('нули игнорированы'), `нет пометки об откате нулей: ${text}`);
      assert.ok(!text.includes('tokenUsage: input=+0'), `нули не должны записываться: ${text}`);
    });

    it('невалидный индекс acChecks → ошибка в сводке, остальные поля применены', async () => {
      const id = await createTask('Finish: невалидный индекс');
      await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id, action: 'add', text: 'К1' } } },
      ]);
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, comment: 'Частичное применение', acChecks: ['NaN'], status: 'Done' } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id, action: 'list' } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `ошибка индекса не должна ронять вызов: ${fin.result.content[0].text}`);
      const text = fin.result.content[0].text;
      assert.ok(text.includes('Ошибки') && text.includes('acChecks'), `нет ошибки acChecks: ${text}`);
      assert.ok(text.includes('Статус: Done'), `валидные поля должны примениться: ${text}`);

      // AC не отмечен (индекс не применился), статус — применён
      const listText = responses.find(r => r.id === 3).result.content[0].text;
      assert.ok(/1\. ○ К1/.test(listText), `К1 не должна отмечаться: ${listText}`);
    });

    it('id несуществующей задачи → isError «не найдена»', async () => {
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id: 'mcp-0', status: 'Done' } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.equal(fin.result.isError, true, 'несуществующая задача — фатальная ошибка');
      assert.ok(fin.result.content[0].text.includes('не найдена'),
        `нет сообщения «не найдена»: ${fin.result.content[0].text}`);
    });
  });

  // ============================================================
  // VL-198 — backlog_finish_phase: token_usage в frontmatter
  // ============================================================
  describe('tools/call — backlog_finish_phase tokenUsage (VL-198)', () => {
    async function createTask(title) {
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_create_task', arguments: { title } } },
      ]);
      return responses.find(r => r.id === 2).result.content[0].text.match(/mcp-\d+/)[0];
    }

    it('явный tokenUsage + phase → frontmatter token_usage (total + by_phase)', async () => {
      const id = await createTask('Tokens: explicit');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id,
          phase: 'plan',
          comment: 'Фаза (явный usage)',
          tokenUsage: { input: 100, output: 50, cache: 20, total: 170, requests: 3 },
        } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `вызов не должен падать: ${fin.result.content[0].text}`);
      assert.ok(fin.result.content[0].text.includes('tokenUsage: input=+100'), `нет tokenUsage в сводке: ${fin.result.content[0].text}`);

      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.ok(data.token_usage, 'token_usage должен появиться в frontmatter');
      assert.equal(data.token_usage.input, 100);
      assert.equal(data.token_usage.output, 50);
      assert.equal(data.token_usage.cache, 20);
      assert.equal(data.token_usage.total, 170);
      assert.equal(data.token_usage.requests, 3);
      assert.ok(data.token_usage.by_phase.plan, 'by_phase.plan должен записаться');
      assert.equal(data.token_usage.by_phase.plan.input, 100);
      assert.equal(data.token_usage.by_phase.plan.requests, 3);
    });

    it('args-passthrough без env сессии: каждый вызов пишет переданную сумму целиком', async () => {
      const id = await createTask('Tokens: additive');
      const finish = (sum) => callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id, phase: 'code', comment: 'Фаза (additive)', tokenUsage: { input: sum, output: 0, cache: 0, total: sum, requests: 1 },
        } } },
      ]).then((rs) => rs.find(r => r.id === 2).result.content[0].text);
      await finish(10);
      await finish(10);
      // Без sessionId usage_recorded негде хранить → каждый вызов args
      // прибавляет всю сумму (идемпотентность обеспечивает боевой путь с
      // VIBELOG_SESSION_ID — см. fallback-тест ниже; args-only — ручной)
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id, phase: 'code', comment: 'Фаза (additive 25)', tokenUsage: { input: 25, output: 0, cache: 0, total: 25, requests: 1 },
        } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(fin.result.content[0].text.includes('input=+25'), `сумма не прибавилась: ${fin.result.content[0].text}`);
      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.equal(data.token_usage.input, 45, 'вклад накапливается: 10 + 10 + 25');
      assert.equal(data.token_usage.by_phase.code.input, 45);
    });

    it('невалидный tokenUsage → ошибка в сводке, статус/комментарий применяются', async () => {
      const id = await createTask('Tokens: invalid');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: {
          id, status: 'Done', comment: 'ок', phase: 'code', tokenUsage: { input: -5, extra: 1 },
        } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ]);
      const text = responses.find(r => r.id === 2).result.content[0].text;
      assert.ok(!responses.find(r => r.id === 2).result.isError, 'частичное применение не падает');
      assert.ok(text.includes('tokenUsage'), `нет ошибки tokenUsage: ${text}`);
      assert.ok(text.includes('Статус: Done') && text.includes('отчёт добавлен'), `валидные поля не применились: ${text}`);
      const data = JSON.parse(responses.find(r => r.id === 3).result.content[0].text);
      assert.equal(data.status, 'Done');
      assert.equal(data.token_usage, undefined, 'битый tokenUsage не должен записаться');
    });

    it('без args и без VIBELOG_SESSION_ID → ошибка в сводке, вызов не падает', async () => {
      const id = await createTask('Tokens: no source');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, status: 'Done', comment: 'Фаза (без usage)' } } },
      ]);
      const text = responses.find(r => r.id === 2).result.content[0].text;
      assert.ok(!responses.find(r => r.id === 2).result.isError, `не должен падать: ${text}`);
      assert.ok(text.includes('token_usage') && text.includes('недоступны'), `нет ошибки резолва: ${text}`);
      assert.ok(text.includes('Статус: Done'), `статус должен примениться: ${text}`);
    });

    // ── Fallback JSONL + идемпотентность: отдельный сервер с env сессии ──
    it('fallback: meta без usage → jsonl; повтор → «уже записан» (дельта-идемпотентность)', async () => {
      const sessionId = 'agent-vl198fix';
      const sessionsDir = join(testDir, '.vibelog', 'agent-sessions');
      mkdirSync(sessionsDir, { recursive: true });
      // jsonl с usage в assistant-сообщениях (loop дописывает — VL-198)
      writeFileSync(join(sessionsDir, `${sessionId}.jsonl`), [
        JSON.stringify({ role: 'user', content: 'x' }),
        JSON.stringify({ role: 'assistant', content: 'ответ', usage: { input_tokens: 300, output_tokens: 120, cache_read_input_tokens: 60, total_tokens: 420, reasoning_tokens: 5 } }),
        '',
      ].join('\n'), 'utf-8');
      // meta СТАРАЯ (без usage) — но с фазой: провоцирует fallback на jsonl
      writeFileSync(join(sessionsDir, `${sessionId}.meta.json`), JSON.stringify({
        cwd: testDir, phase: 'close',
      }), 'utf-8');

      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_create_task', arguments: { title: 'Tokens: jsonl fallback' } } },
      ]);
      const id = responses.find(r => r.id === 2).result.content[0].text.match(/mcp-\d+/)[0];

      // Сервер с env сессии — как cli спавнит MCP в бою (VL-198)
      const env = { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' };
      delete env.VIBELOG_CWD;
      delete env.VIBELOG_PHASE_TASK_ID;
      delete env.VIBELOG_PHASE_NAME;
      // VL-254: env рана агента протекает в тест-раннер и подменяет фазу из
      // меты (VIBELOG_RUN_PHASE приоритетнее) — изолируем, как в общем хелпере
      delete env.VIBELOG_RUN_PHASE;
      delete env.VIBELOG_RUN_STARTED_AT;
      env.VIBELOG_SESSION_ID = sessionId;
      const srv = spawn('node', [cliPath, 'mcp', 'start'], { cwd: testDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
      try {
        const call = (requests) => new Promise((resolve, reject) => {
          const out = [];
          let buf = '';
          const onData = (chunk) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line);
                if (requests.some((r) => r.id === msg.id)) out.push(msg);
              } catch { /* ignore */ }
            }
            if (out.length === requests.length) {
              srv.stdout.off('data', onData);
              clearTimeout(timer);
              resolve(out);
            }
          };
          const timer = setTimeout(() => reject(new Error('timeout MCP')), 15000);
          srv.stdout.on('data', onData);
          srv.stdin.write(requests.map((r) => JSON.stringify(r)).join('\n') + '\n');
        });

        const batch1 = await call([
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
          { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, comment: 'первый' } } },
        ]);
        const fin1 = batch1.find((r) => r.id === 2);
        assert.ok(!fin1.result.isError, `не должен падать: ${fin1.result.content[0].text}`);
        assert.ok(fin1.result.content[0].text.includes('фаза close'), `фаза из меты не использована: ${fin1.result.content[0].text}`);
        assert.ok(fin1.result.content[0].text.includes('источник jsonl'), `fallback на jsonl не сработал: ${fin1.result.content[0].text}`);

        // Повторный вызов той же сессии: usage_recorded == jsonl → дельта 0
        const batch2 = await call([
          { jsonrpc: '2.0', id: 3, method: 'initialize', params: {} },
          { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, comment: 'второй' } } },
          { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
        ]);
        const fin2 = batch2.find((r) => r.id === 4);
        assert.ok(fin2.result.content[0].text.includes('уже записан'), `повтор не идемпотентен: ${fin2.result.content[0].text}`);

        const data = JSON.parse(batch2.find((r) => r.id === 5).result.content[0].text);
        assert.equal(data.token_usage.input, 300, 'frontmatter содержит ровно одну порцию jsonl');
        assert.equal(data.token_usage.total, 420);
        assert.equal(data.token_usage.requests, 1);
        assert.ok(data.token_usage.by_phase.close, 'by_phase.close из меты сессии');
        // usage_recorded дописан в мету (следующий ран начнёт с новой дельты)
        const meta = JSON.parse(readFileSync(join(sessionsDir, `${sessionId}.meta.json`), 'utf-8'));
        assert.equal(meta.usage_recorded.input, 300);
        assert.equal(meta.phase, 'close', 'фаза меты не должна затираться (lesson-40)');
      } finally {
        srv.kill('SIGTERM');
      }
    });
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

  // ============================================================
  // VL-245 — backlog_finish_phase: смена статуса только фазой workflow
  // ============================================================
  // Инцидент VL-219/VL-231: служебная фаза comment выставила Done
  // незавершённой задаче — toolFinishPhase валидировал статус только по
  // config.statuses, а инварианты workflow (SERVICE_PHASES, getStatusAfterPhase)
  // проверял только оркестратор. Ниже — граница MCP: фаза вызывающего берётся
  // из env (VIBELOG_RUN_PHASE/VIBELOG_PHASE_NAME) или меты сессии.
  //
  // describe объявлен ПОСЛЕДНИМ: его beforeAll расширяет statuses фикстуры
  // (Spec/Planned/Review нужны для DEFAULT_WORKFLOW), чтобы не задеть
  // остальные кейсы файла, где набор ['To Do','In Progress','Done'].
  describe('tools/call — защита перехода по фазе workflow (VL-245)', () => {
    beforeAll(() => {
      // Расширенный набор статусов — только на время этого describe
      // (он последний в файле, дальше statuses не используются)
      writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
        project_name: 'MCP Test',
        task_prefix: 'mcp',
        default_status: 'To Do',
        statuses: ['To Do', 'In Progress', 'Spec', 'Planned', 'Review', 'Done'],
        definition_of_done: [],
      }), 'utf-8');
    });

    /** Создаёт задачу (To Do) и, если задан status, переводит её туда. */
    async function taskWithStatus(title, status) {
      const created = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_create_task', arguments: { title } } },
      ]);
      const id = created.find(r => r.id === 2).result.content[0].text.match(/mcp-\d+/)[0];
      if (status && status !== 'To Do') {
        await callMcp([
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
          { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_update_status', arguments: { id, status } } },
        ]);
      }
      return id;
    }

    /** Завершает фазу одним вызовом + читает задачу (без env — fail-open путь). */
    async function finishAndView(id, args, extraEnv) {
      const [init, call, view] = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: args } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backlog_view_task', arguments: { id } } },
      ];
      const responses = extraEnv ? await callMcpWithEnv([init, call, view], extraEnv) : await callMcp([init, call, view]);
      const fin = responses.find(r => r.id === 2);
      return {
        text: fin.result.content[0].text,
        isError: fin.result.isError === true,
        data: JSON.parse(responses.find(r => r.id === 3).result.content[0].text),
      };
    }

    it('служебная фаза comment + Done → переход запрещён, статус не меняется (AC1)', async () => {
      const id = await taskWithStatus('VL-245: comment не ставит Done', 'To Do');
      const { text, isError, data } = await finishAndView(
        id,
        { id, status: 'Done', comment: 'Фаза Comment: отчёт' },
        { VIBELOG_PHASE_NAME: 'comment' },
      );
      // Паттерн частичного применения (как у невалидного статуса): не isError,
      // ошибка — строкой в сводке (isError дал бы луп, lesson-92)
      assert.ok(!isError, `отказ не должен ронять вызов: ${text}`);
      assert.ok(text.includes('Ошибки') && text.includes('служебная'), `нет запрета служебной фазы: ${text}`);
      assert.ok(text.includes('Статус: не менялся'), `статус не должен применяться: ${text}`);
      // Запись выполнена частично: отчёт записан, статус — нет
      assert.equal(data.status, 'To Do', 'статус задачи не меняется');
      assert.equal(data.comments.length, 1, 'отчёт фазы применяется (частичное применение)');
      assert.ok(data.comments[0].text.includes('Фаза Comment: отчёт'));
    });

    it('фаза не из того статуса: close при To Do + Done → запрещено (AC3)', async () => {
      const id = await taskWithStatus('VL-245: close из To Do', 'To Do');
      const { text, isError, data } = await finishAndView(
        id,
        { id, status: 'Done', comment: 'Фаза Close: отчёт' },
        { VIBELOG_RUN_PHASE: 'close' },
      );
      assert.ok(!isError, `отказ не должен ронять вызов: ${text}`);
      assert.ok(text.includes('не даёт переход'), `нет сообщения о запрещённом переходе: ${text}`);
      assert.ok(text.includes('workflow нет'), `нет пояснения об отсутствии перехода: ${text}`);
      assert.equal(data.status, 'To Do');
    });

    it('штатный переход Review + close → Done работает как раньше (AC2, AC3)', async () => {
      const id = await taskWithStatus('VL-245: Review → close → Done', 'Review');
      const { text, isError, data } = await finishAndView(
        id,
        { id, status: 'Done', comment: 'Фаза Close выполнена' },
        { VIBELOG_RUN_PHASE: 'close' },
      );
      assert.ok(!isError, `штатный переход не должен падать: ${text}`);
      // Прочие ошибки сводки (напр. резолв token_usage без сессии) к VL-245
      // не относятся — проверяем отсутствие именно ошибки перехода
      assert.ok(!text.includes('не даёт переход') && !text.includes('служебная'), `нет ошибки перехода: ${text}`);
      assert.ok(text.includes('Статус: Done'), `статус должен примениться: ${text}`);
      assert.equal(data.status, 'Done');
    });

    it('транзиент In Progress: база проверки — статус до фазы (prevStatus)', async () => {
      // Инцидент-защита: во время рана задача в In Progress (VL-196), а агент
      // передаёт produces_status от исходного статуса. Без чтения кэша
      // «In Progress + close → Done» был бы отклонён.
      const id = await taskWithStatus('VL-245: транзиент', 'In Progress');
      mkdirSync(join(testDir, '.vibelog'), { recursive: true });
      writeFileSync(join(testDir, '.vibelog', 'phase-in-progress.json'), JSON.stringify({
        [id.toUpperCase()]: { prevStatus: 'Review', phase: 'close', startedAt: new Date().toISOString() },
      }), 'utf-8');
      const { text, isError, data } = await finishAndView(
        id,
        { id, status: 'Done', comment: 'Фаза Close (транзиент)' },
        { VIBELOG_RUN_PHASE: 'close' },
      );
      assert.ok(!isError, `транзиент не должен ломать штатный рана: ${text}`);
      assert.equal(data.status, 'Done', 'prevStatus Review + close → Done разрешён');
    });

    it('фаза не резолвится (нет env/меты) → fail-open: статус по конфигу применяется', async () => {
      // Ручной вызов MCP из чужого клиента: фазы нет, guard не применяется
      const id = await taskWithStatus('VL-245: fail-open', 'To Do');
      const { text, data } = await finishAndView(id, { id, status: 'Done', comment: 'Ручное завершение' });
      assert.ok(text.includes('Статус: Done'), `fail-open: статус применяется: ${text}`);
      assert.equal(data.status, 'Done');
    });

    it('фаза из меты сессии (VIBELOG_SESSION_ID) тоже участвует в проверке', async () => {
      const id = await taskWithStatus('VL-245: фаза из меты', 'To Do');
      const sessionId = 'vl245-guard-meta';
      const sessionsDir = agentSessionsDir(testDir);
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${sessionId}.meta.json`), JSON.stringify({
        sessionId, cwd: testDir, taskId: id, phase: 'comment',
      }), 'utf-8');
      const { text, isError, data } = await finishAndView(
        id,
        { id, status: 'Done', comment: 'Фаза из меты' },
        { VIBELOG_SESSION_ID: sessionId },
      );
      assert.ok(!isError, `не должен ронять вызов: ${text}`);
      assert.ok(text.includes('служебная'), `фаза из меты не проверена: ${text}`);
      assert.equal(data.status, 'To Do');
    });
  });
});
