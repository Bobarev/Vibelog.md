import { describe, it, beforeAll, afterAll } from 'vitest';
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
  beforeAll(() => setup());
  afterAll(() => cleanup());

  it('initialize — возвращает capabilities', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ]);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 1);
    assert.equal(responses[0].result.serverInfo.name, 'vibelog-md');
    assert.ok(responses[0].result.capabilities.tools);
  });

  it('tools/list — возвращает 22 инструмента', async () => {
    const responses = await callMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const listResp = responses.find(r => r.id === 2);
    assert.ok(listResp);
    assert.equal(listResp.result.tools.length, 22);
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
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, acChecks: [1, '2'] } } },
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
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, modifiedFiles: ['src/a.ts'] } } },
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

    it('вызов только с {id} → успешен, сводка «ничего не менялось»', async () => {
      const id = await createTask('Finish: только id');
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id } } },
      ]);
      const fin = responses.find(r => r.id === 2);
      assert.ok(!fin.result.isError, `вызов только с id должен быть успешным: ${fin.result.content[0].text}`);
      assert.ok(fin.result.content[0].text.includes('ничего не менялось'),
        `нет пометки о пропуске: ${fin.result.content[0].text}`);
    });

    it('невалидный индекс acChecks → ошибка в сводке, остальные поля применены', async () => {
      const id = await createTask('Finish: невалидный индекс');
      await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_manage_ac', arguments: { id, action: 'add', text: 'К1' } } },
      ]);
      const responses = await callMcp([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'backlog_finish_phase', arguments: { id, acChecks: ['NaN'], status: 'Done' } } },
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
