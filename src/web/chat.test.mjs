/**
 * Тесты VL-204 — веб-чат SSE (src/web/chat.ts + POST /api/chat в server.ts).
 *
 * Без сети (fakeLlm, паттерн loop.test.mjs) и с tmp-фикстурой backlog
 * (паттерн search-api.test.mjs):
 * - текстовый ход: text-дельты подряд + done, история в chat-sessions/*.jsonl;
 * - tool loop: backlog_search исполняется (tool_start/tool_end), задачи не меняются;
 * - approval: backlog_create_task НЕ исполняется до resume; approved:true →
 *   задача создаётся, approved:false → не создаётся, в истории tool-result c error;
 * - guard сирот: висящий assistant(tool_calls) закрывается синтетическим
 *   результатом при новом сообщении;
 * - env без VIBELOG_LLM_* → событие error, а не исключение;
 * - HTTP: POST /api/chat → content-type: text/event-stream, поток data-строк.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat, loadChatHistory, loadApprovalLog, loadChatToolStats, listChatThreads } from '../../dist/web/chat.js';
import { startWebServer } from '../../dist/web/server.js';
import { createTaskFile, listTasks, getTask } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';
import { writeGrant, revokeGrant } from '../../dist/web/supervisor-grant.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(cwd, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Chat Test',
    task_prefix: 'ch',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/**
 * Фейковый LLM: очередь ответов {text?, toolCalls?, tokens?}.
 * tokens (массив) шлются по одному через onToken — проверка дельт.
 */
function fakeLlm(script) {
  const state = { calls: 0, messages: [], tools: [] };
  const llm = {
    async streamChat(messages, tools, opts) {
      state.messages.push(structuredClone(messages));
      state.tools = tools;
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      if (step instanceof Error) throw step;
      const tokens = step.tokens ?? (step.text ? step.text.split(/(?<=\s)/) : []);
      for (const t of tokens) opts?.onToken?.(t);
      return {
        text: step.text ?? tokens.join(''),
        toolCalls: step.toolCalls ?? [],
        usage: zeroUsage(),
      };
    },
  };
  return { llm, state };
}

/** Сбор всех событий runChat в массив. */
async function collect(body, deps) {
  const events = [];
  for await (const ev of runChat(body, cwd, deps)) events.push(ev);
  return events;
}

/** Тред с уникальным id (threadId сам не генерируем — читаем из события). */
async function collectWithThread(body, deps, threadId) {
  return collect({ ...body, threadId }, deps);
}

function sessionFile(threadId) {
  return join(cwd, '.vibelog', 'chat-sessions', `${threadId}.jsonl`);
}

describe('chat: текстовый ход', () => {
  it('стримит text-дельты подряд и done; пишет user+assistant в jsonl', async () => {
    const { llm } = fakeLlm([{ tokens: ['Привет', ', мир', '!'] }]);
    const events = await collect({ message: 'привет', threadId: 't-text' }, { llm });

    assert.equal(events[0].type, 'thread');
    assert.equal(events[0].threadId, 't-text');
    const texts = events.filter(e => e.type === 'text').map(e => e.delta);
    assert.deepEqual(texts, ['Привет', ', мир', '!']);
    assert.equal(events.at(-1).type, 'done');

    const history = loadChatHistory(cwd, 't-text');
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
    assert.equal(history[1].content, 'Привет, мир!');
    // system-сообщения в истории нет (пересобирается на каждый ход)
    assert.ok(!history.some(m => m.role === 'system'));
  });
});

describe('chat: tool loop', () => {
  it('backlog_search исполняется: tool_start/tool_end, задачи не меняются', async () => {
    const before = listTasks(cwd, {}).length;
    const { llm, state } = fakeLlm([
      {
        toolCalls: [
          { id: 'tc-search-1', name: 'backlog_search', arguments: { query: 'Привет' } },
        ],
      },
      { text: 'Нашёл задачи.' },
    ]);
    const events = await collect({ message: 'найди задачи', threadId: 't-tool' }, { llm });

    const types = events.map(e => e.type);
    assert.ok(types.includes('tool_start'));
    assert.ok(types.includes('tool_end'));
    const start = events.find(e => e.type === 'tool_start');
    assert.equal(start.id, 'tc-search-1');
    assert.equal(start.name, 'backlog_search');
    const end = events.find(e => e.type === 'tool_end');
    assert.ok(end.result.length > 0);
    assert.notEqual(end.isError, true);
    assert.equal(events.at(-1).type, 'done');

    // инструменты модели: все MCP (без CHAT_DISALLOWED_TOOLS) + read_file/write_file (VL-219)
    const toolNames = state.tools.map(t => t.name).sort();
    assert.ok(toolNames.includes('read_file'), 'read_file должен быть в инструментах');
    assert.ok(toolNames.includes('write_file'), 'write_file должен быть в инструментах');
    assert.ok(toolNames.includes('backlog_search'));
    assert.ok(toolNames.includes('backlog_create_task'));
    assert.ok(toolNames.includes('backlog_update_task'));
    // запрещённые (backlog_finish_phase, reference_sync, milestone_remove) модель не видит
    assert.ok(!toolNames.includes('backlog_finish_phase'));
    assert.ok(!toolNames.includes('reference_sync'));
    assert.ok(!toolNames.includes('milestone_remove'));
    // схемы read_file/write_file содержат обязательные поля
    const readDef = state.tools.find(t => t.name === 'read_file');
    assert.deepEqual(readDef.inputSchema.required, ['path']);
    const writeDef = state.tools.find(t => t.name === 'write_file');
    assert.deepEqual(writeDef.inputSchema.required, ['path', 'content']);

    assert.equal(listTasks(cwd, {}).length, before);
    const history = loadChatHistory(cwd, 't-tool');
    assert.deepEqual(history.map(m => m.role), ['user', 'assistant', 'tool', 'assistant']);
  });
});

describe('chat: approval (human-in-the-loop)', () => {
  it('create без resume НЕ создаёт задачу; approved:true → создаёт, диалог продолжается', async () => {
    const before = listTasks(cwd, {}).length;
    const { llm } = fakeLlm([
      {
        toolCalls: [
          {
            id: 'tc-create-1',
            name: 'backlog_create_task',
            arguments: { title: 'Задача из чата VL-204', priority: 'High' },
          },
        ],
      },
      { text: 'Задача создана.' },
    ]);

    // Ход 1: дошли до approval-паузы
    const events1 = await collect({ message: 'создай задачу', threadId: 't-appr' }, { llm });
    const approval = events1.find(e => e.type === 'approval');
    assert.ok(approval, 'событие approval должно прийти');
    assert.equal(approval.toolCallId, 'tc-create-1');
    assert.equal(approval.name, 'backlog_create_task');
    assert.equal(approval.args.title, 'Задача из чата VL-204');
    assert.equal(events1.at(-1).type, 'approval'); // поток закрылся на паузе
    assert.equal(listTasks(cwd, {}).length, before, 'задача НЕ создана без подтверждения');

    // Resume: пользователь нажал Allow
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-create-1', approved: true } },
      { llm },
      't-appr',
    );
    assert.ok(events2.some(e => e.type === 'text'), 'после resume идёт финальный текст');
    assert.equal(events2.at(-1).type, 'done');

    const tasks = listTasks(cwd, {});
    assert.equal(tasks.length, before + 1, 'задача создана после Allow');
    assert.equal(tasks.find(t => t.title === 'Задача из чата VL-204')?.priority, 'High');

    const history = loadChatHistory(cwd, 't-appr');
    const roles = history.map(m => m.role);
    assert.deepEqual(roles, ['user', 'assistant', 'tool', 'assistant']);
    const toolMsg = history.find(m => m.role === 'tool');
    assert.ok(toolMsg.content.includes('Задача из чата VL-204'));
  });

  it('approved:false → задача не создаётся, в истории tool-result с error', async () => {
    const before = listTasks(cwd, {}).length;
    const { llm } = fakeLlm([
      {
        toolCalls: [
          {
            id: 'tc-create-2',
            name: 'backlog_create_task',
            arguments: { title: 'Отклонённая задача' },
          },
        ],
      },
      { text: 'Хорошо, не создаю.' },
    ]);

    await collect({ message: 'создай ещё задачу', threadId: 't-deny' }, { llm });
    assert.equal(listTasks(cwd, {}).length, before);

    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-create-2', approved: false, reason: 'Не нужно' } },
      { llm },
      't-deny',
    );
    assert.equal(events2.at(-1).type, 'done');
    assert.equal(listTasks(cwd, {}).length, before, 'задача не создана после Deny');

    const toolMsg = loadChatHistory(cwd, 't-deny').find(m => m.role === 'tool');
    assert.ok(toolMsg.content.includes('Не нужно'));
  });
});

describe('chat: VL-219 read_file/write_file и Spec-статус', () => {
  it('read_file исполняется без approval: tool_start/tool_end, содержимое файла в result', async () => {
    writeFileSync(join(cwd, 'read-target.txt'), 'СОДЕРЖИМОЕ VL-219', 'utf8');
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-read-1', name: 'read_file', arguments: { path: 'read-target.txt' } }] },
      { text: 'Прочитал.' },
    ]);
    const events = await collect({ message: 'прочитай файл', threadId: 't-read' }, { llm });

    // read — НЕ approval: нет события approval, есть tool_end с содержимым
    assert.ok(!events.some(e => e.type === 'approval'), 'read_file не должен требовать подтверждения');
    const end = events.find(e => e.type === 'tool_end');
    assert.ok(end, 'tool_end должен прийти');
    assert.ok(end.result.includes('СОДЕРЖИМОЕ VL-219'), `содержимое файла: ${end.result}`);
    assert.equal(events.at(-1).type, 'done');
  });

  it('read_file: offset/limit — диапазон строк (AC2)', async () => {
    writeFileSync(join(cwd, 'range.txt'), 'строка0\nстрока1\nстрока2\nстрока3', 'utf8');
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-read-2', name: 'read_file', arguments: { path: 'range.txt', offset: 1, limit: 2 } }] },
      { text: 'Готово.' },
    ]);
    const events = await collect({ message: 'прочитай диапазон', threadId: 't-range' }, { llm });
    const end = events.find(e => e.type === 'tool_end');
    assert.ok(end.result.includes('строка1') && end.result.includes('строка2'));
    assert.ok(!end.result.includes('строка0'), 'offset=1 исключает строку0');
    assert.ok(!end.result.includes('строка3'), 'limit=2 исключает строку3');
  });

  it('read_file: выход за пределы проекта → ошибка «Путь выходит за пределы» (AC3)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-read-out', name: 'read_file', arguments: { path: '../outside.txt' } }] },
      { text: 'Понял.' },
    ]);
    const events = await collect({ message: 'прочитай наружу', threadId: 't-read-out' }, { llm });
    const end = events.find(e => e.type === 'tool_end');
    assert.ok(end.result.includes('выходит за пределы'), `ошибка границы: ${end.result}`);
  });

  it('write_file → approval, файл НЕ создан; Allow → записан (AC4-5)', async () => {
    const target = join(cwd, 'written-by-chat.txt');
    assert.ok(!existsSync(target));
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-write-1', name: 'write_file', arguments: { path: 'written-by-chat.txt', content: 'ЗАПИСАНО VL-219' } }] },
      { text: 'Записал.' },
    ]);

    // Ход 1: approval-пауза, файл не создан
    const events1 = await collect({ message: 'запиши файл', threadId: 't-write' }, { llm });
    const approval = events1.find(e => e.type === 'approval');
    assert.ok(approval, 'write_file должен требовать подтверждения');
    assert.equal(approval.name, 'write_file');
    assert.equal(events1.at(-1).type, 'approval');
    assert.ok(!existsSync(target), 'файл НЕ создан без подтверждения (AC6)');

    // Resume: Allow → записан
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-write-1', approved: true } }, { llm }, 't-write',
    );
    assert.equal(events2.at(-1).type, 'done');
    assert.ok(existsSync(target), 'файл записан после Allow');
    assert.equal(readFileSync(target, 'utf8'), 'ЗАПИСАНО VL-219');
  });

  it('write_file: Deny → файл НЕ записан, диалог продолжается (AC5)', async () => {
    const target = join(cwd, 'denied-by-chat.txt');
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-write-2', name: 'write_file', arguments: { path: 'denied-by-chat.txt', content: 'НЕ ДОЛЖНО БЫТЬ' } }] },
      { text: 'Хорошо, отменяю.' },
    ]);
    await collect({ message: 'запиши другой файл', threadId: 't-deny-w' }, { llm });
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-write-2', approved: false } }, { llm }, 't-deny-w',
    );
    assert.equal(events2.at(-1).type, 'done');
    assert.ok(!existsSync(target), 'файл НЕ создан после Deny');

    const toolMsg = loadChatHistory(cwd, 't-deny-w').find(m => m.role === 'tool');
    assert.ok(toolMsg.content.includes('отклонил'), `tool-result с отказом: ${toolMsg.content}`);
  });

  it('write_file: выход за пределы проекта → ошибка (AC7)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-write-out', name: 'write_file', arguments: { path: '../evil.txt', content: 'x' } }] },
      { text: 'Ок.' },
    ]);
    const events = await collect({ message: 'запиши наружу', threadId: 't-write-out' }, { llm });
    const approval = events.find(e => e.type === 'approval');
    assert.ok(approval, 'write_file даже снаружи сначала approval');
    // Resume Allow → handler вернёт ошибку границы (resolveInProject), файл не создан
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-write-out', approved: true } }, { llm }, 't-write-out',
    );
    const toolMsg = loadChatHistory(cwd, 't-write-out').find(m => m.role === 'tool');
    assert.ok(toolMsg.content.includes('выходит за пределы'), `ошибка границы: ${toolMsg.content}`);
    assert.ok(!existsSync(join(cwd, '..', 'evil.txt')), 'файл за пределами не создан');
  });

  it('backlog_update_task → approval; Allow → поля обновлены (дополнение §2)', async () => {
    const t = createTaskFile(cwd, { title: 'Исходная VL-219', description: 'до' });
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-upd-1', name: 'backlog_update_task', arguments: { id: t.id, title: 'Обновлённая VL-219' } }] },
      { text: 'Обновил.' },
    ]);
    const events1 = await collect({ message: 'измени заголовок', threadId: 't-upd' }, { llm });
    assert.ok(events1.some(e => e.type === 'approval'), 'backlog_update_task требует подтверждения');
    assert.equal(listTasks(cwd, {}).find(x => x.id === t.id).title, 'Исходная VL-219', 'не обновлено до Allow');

    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-upd-1', approved: true } }, { llm }, 't-upd',
    );
    assert.equal(events2.at(-1).type, 'done');
    assert.equal(listTasks(cwd, {}).find(x => x.id === t.id).title, 'Обновлённая VL-219', 'обновлено после Allow');
    const toolMsg = loadChatHistory(cwd, 't-upd').find(m => m.role === 'tool');
    assert.ok(toolMsg.content.includes('обновлена'), `возвращает обновлённое представление: ${toolMsg.content}`);
  });

  it('backlog_update_task: несуществующий id → понятная ошибка «не найдена» (дополнение §2)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-upd-404', name: 'backlog_update_task', arguments: { id: 'ch-999', title: 'x' } }] },
      { text: 'Ошибка.' },
    ]);
    await collect({ message: 'измени несуществующую', threadId: 't-upd-404' }, { llm });
    // update_task — write → approval
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-upd-404', approved: true } }, { llm }, 't-upd-404',
    );
    assert.equal(events2.at(-1).type, 'done');
    const toolMsg = loadChatHistory(cwd, 't-upd-404').find(m => m.role === 'tool');
    assert.ok(toolMsg.content.includes('не найдена'), `понятная ошибка: ${toolMsg.content}`);
  });

  it('Deny на update_task с 3 полями → ни одно поле не изменено, reason=denied, skipped=3 (VL-262)', async () => {
    const t = createTaskFile(cwd, { title: 'Исходная 262', priority: 'Low', labels: ['было'] });
    const { llm } = fakeLlm([
      {
        toolCalls: [{
          id: 'tc-262-deny',
          name: 'backlog_update_task',
          arguments: { id: t.id, title: 'Не должно примениться', priority: 'High', labels: ['новое'] },
        }],
      },
      { text: 'Отменил.' },
    ]);
    await collect({ message: 'обнови три поля', threadId: 't-262-deny' }, { llm });
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-262-deny', approved: false } }, { llm }, 't-262-deny',
    );
    assert.equal(events2.at(-1).type, 'done');

    const stored = listTasks(cwd, {}).find(x => x.id === t.id);
    assert.equal(stored.title, 'Исходная 262', 'title не изменён');
    assert.equal(stored.priority, 'Low', 'priority не изменён');
    assert.deepEqual(stored.labels, ['было'], 'labels не изменены');

    const toolMsg = loadChatHistory(cwd, 't-262-deny').find(m => m.role === 'tool');
    const ack = JSON.parse(toolMsg.content);
    assert.equal(ack.denied, true);
    assert.equal(ack.reason, 'denied');
    assert.deepEqual(ack.applied, {}, 'applied пуст при отказе');
    assert.deepEqual(
      ack.skipped.map(s => s.field).sort(),
      ['id', 'labels', 'priority', 'title'],
      `skipped перечисляет переданные поля: ${toolMsg.content}`,
    );
  });

  it('второй write того же хода получает СВОЙ approval, а не синтетический отказ (VL-256)', async () => {
    const t1 = createTaskFile(cwd, { title: 'Первая 262' });
    const t2 = createTaskFile(cwd, { title: 'Вторая 262' });
    const { llm } = fakeLlm([
      {
        toolCalls: [
          { id: 'tc-262-w1', name: 'backlog_update_task', arguments: { id: t1.id, title: 'Первый обновлён' } },
          { id: 'tc-262-w2', name: 'backlog_update_task', arguments: { id: t2.id, title: 'Второй обновлён' } },
        ],
      },
      { text: 'Готово.' },
    ]);
    const events1 = await collect({ message: 'обнови две задачи', threadId: 't-262-two' }, { llm });
    assert.equal(events1.at(-1).type, 'approval');
    assert.equal(events1.at(-1).toolCallId, 'tc-262-w1');

    // Подтверждаем первый write → ход НЕ закрывает второй, а показывает свой гейт
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-262-w1', approved: true } }, { llm }, 't-262-two',
    );
    assert.equal(events2.at(-1).type, 'approval', `ожидали гейт для второго write: ${JSON.stringify(events2)}`);
    assert.equal(events2.at(-1).toolCallId, 'tc-262-w2');
    // До решения по второму вызову его результат в истории отсутствует
    let toolMsgs = loadChatHistory(cwd, 't-262-two').filter(m => m.role === 'tool');
    assert.equal(toolMsgs.length, 1, 'второй write не закрыт синтетическим отказом');
    assert.ok(!toolMsgs.some(m => m.tool_call_id === 'tc-262-w2'));

    // Решение по второму — Deny: явный отказ, первый остаётся применённым
    const events3 = await collectWithThread(
      { approval: { toolCallId: 'tc-262-w2', approved: false } }, { llm }, 't-262-two',
    );
    assert.equal(events3.at(-1).type, 'done');
    toolMsgs = loadChatHistory(cwd, 't-262-two').filter(m => m.role === 'tool');
    const second = toolMsgs.find(m => m.tool_call_id === 'tc-262-w2');
    const ack = JSON.parse(second.content);
    assert.equal(ack.reason, 'denied', `второй write отклонён пользователем: ${second.content}`);
    assert.ok(ack.hint.includes('Повтор'), 'подсказка про явный отказ');
    assert.equal(listTasks(cwd, {}).find(x => x.id === t1.id).title, 'Первый обновлён');
    assert.equal(listTasks(cwd, {}).find(x => x.id === t2.id).title, 'Вторая 262', 'второй не применён');
  });

  it('повтор create с тем же idempotencyKey после not_confirmed → одна задача (VL-262)', async () => {
    const args = { title: 'Единственная 262', idempotencyKey: 'chat-idem-262' };
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-262-c1', name: 'backlog_create_task', arguments: args }] },
      { text: 'Создал.' },
    ]);
    await collect({ message: 'создай задачу', threadId: 't-262-idem' }, { llm });
    // Первый Allow — создаёт
    await collectWithThread({ approval: { toolCallId: 'tc-262-c1', approved: true } }, { llm }, 't-262-idem');
    assert.equal(listTasks(cwd, {}).filter(t => t.title === 'Единственная 262').length, 1);

    // Модель повторяет тот же вызов с тем же ключом — дубля быть не должно
    const { llm: llm2 } = fakeLlm([
      { toolCalls: [{ id: 'tc-262-c2', name: 'backlog_create_task', arguments: args }] },
      { text: 'Уже создана.' },
    ]);
    await collectWithThread({ message: 'повтори создание', threadId: 't-262-idem' }, { llm: llm2 }, 't-262-idem');
    await collectWithThread({ approval: { toolCallId: 'tc-262-c2', approved: true } }, { llm: llm2 }, 't-262-idem');
    const found = listTasks(cwd, {}).filter(t => t.title === 'Единственная 262');
    assert.equal(found.length, 1, 'повтор с тем же ключом не создал дубль');
    const toolMsgs = loadChatHistory(cwd, 't-262-idem').filter(m => m.role === 'tool');
    const replay = toolMsgs.map(m => JSON.parse(m.content)).find(a => a.idempotentReplay === true);
    assert.ok(replay, 'второй ответ помечен idempotentReplay');
  });

  it('backlog_create_task без status → задача со статусом Spec (дополнение §1)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-sp', name: 'backlog_create_task', arguments: { title: 'Spec-задача VL-219' } }] },
      { text: 'Создана.' },
    ]);
    await collect({ message: 'создай spec-задачу', threadId: 't-spec' }, { llm });
    const events2 = await collectWithThread(
      { approval: { toolCallId: 'tc-sp', approved: true } }, { llm }, 't-spec',
    );
    assert.equal(events2.at(-1).type, 'done');
    const task = listTasks(cwd, {}).find(t => t.title === 'Spec-задача VL-219');
    assert.ok(task, 'задача создана');
    assert.equal(task.status, 'Spec', `статус по умолчанию Spec, а не To Do из конфига (получен: ${task.status})`);
  });

  it('backlog_create_task с явным status → его статус (дополнение §1)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-st', name: 'backlog_create_task', arguments: { title: 'InProgress-задача VL-219', status: 'In Progress' } }] },
      { text: 'Создана.' },
    ]);
    await collect({ message: 'создай задачу In Progress', threadId: 't-status' }, { llm });
    await collectWithThread(
      { approval: { toolCallId: 'tc-st', approved: true } }, { llm }, 't-status',
    );
    const task = listTasks(cwd, {}).find(t => t.title === 'InProgress-задача VL-219');
    assert.equal(task.status, 'In Progress', 'явный статус пользователя приоритетен');
  });

  it('системное сообщение содержит описания read_file/write_file (AC8)', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'проверь системный промпт', threadId: 't-sys' }, { llm });
    const system = state.messages[0][0];
    assert.equal(system.role, 'system');
    assert.ok(system.content.includes('read_file'), 'описание read_file в системном промпте');
    assert.ok(system.content.includes('write_file'), 'описание write_file в системном промпте');
    assert.ok(system.content.includes('backlog_update_task'), 'описание backlog_update_task');
    assert.ok(system.content.includes('подтверждени'), 'правило read/write по природе операции');
    // VL-238: правила чат-режима приезжают шаблоном chat-system.md — проверяем
    // их наличие в собранном system-сообщении (end-to-end через src/web/chat.ts)
    assert.ok(system.content.includes('Продолжи'), 'правило «Продолжи» = запрос результата в промпте');
    assert.ok(system.content.includes('не проверено'), 'пометка непроверенного при исчерпании тайм-бокса');
  });
});

describe('chat: несколько write в одном ходе (VL-256)', () => {
  it('три write → три последовательных гейта; Allow/Allow/Deny', async () => {
    const t1 = createTaskFile(cwd, { title: 'Гейт 1' });
    const t2 = createTaskFile(cwd, { title: 'Гейт 2' });
    const t3 = createTaskFile(cwd, { title: 'Гейт 3' });
    const { llm } = fakeLlm([
      {
        toolCalls: [
          { id: 'tc-256-g1', name: 'backlog_update_task', arguments: { id: t1.id, title: 'Гейт 1 обновлён' } },
          { id: 'tc-256-g2', name: 'backlog_update_task', arguments: { id: t2.id, title: 'Гейт 2 обновлён' } },
          { id: 'tc-256-g3', name: 'backlog_update_task', arguments: { id: t3.id, title: 'Гейт 3 обновлён' } },
        ],
      },
      { text: 'Готово.' },
    ]);
    const first = await collect({ message: 'обнови три задачи', threadId: 't-256-gates' }, { llm });
    assert.equal(first.at(-1).type, 'approval');
    assert.equal(first.at(-1).toolCallId, 'tc-256-g1');

    const second = await collectWithThread(
      { approval: { toolCallId: 'tc-256-g1', approved: true } }, { llm }, 't-256-gates',
    );
    assert.equal(second.at(-1).type, 'approval', 'после 1-го Allow — гейт для 2-го write');
    assert.equal(second.at(-1).toolCallId, 'tc-256-g2');

    const third = await collectWithThread(
      { approval: { toolCallId: 'tc-256-g2', approved: true } }, { llm }, 't-256-gates',
    );
    assert.equal(third.at(-1).type, 'approval', 'после 2-го Allow — гейт для 3-го write');
    assert.equal(third.at(-1).toolCallId, 'tc-256-g3');

    const fourth = await collectWithThread(
      { approval: { toolCallId: 'tc-256-g3', approved: false } }, { llm }, 't-256-gates',
    );
    assert.equal(fourth.at(-1).type, 'done', 'после решения по последнему write ход продолжается');

    const tasks = listTasks(cwd, {});
    assert.equal(tasks.find(x => x.id === t1.id).title, 'Гейт 1 обновлён');
    assert.equal(tasks.find(x => x.id === t2.id).title, 'Гейт 2 обновлён');
    assert.equal(tasks.find(x => x.id === t3.id).title, 'Гейт 3', 'третий отклонён — не применён');

    const toolMsgs = loadChatHistory(cwd, 't-256-gates').filter(m => m.role === 'tool');
    const denied = JSON.parse(toolMsgs.find(m => m.tool_call_id === 'tc-256-g3').content);
    assert.equal(denied.denied, true);
    assert.equal(denied.reason, 'denied');

    // Лог: 3 запроса и 3 решения в одном ходе (turn одинаков)
    const log = loadApprovalLog(cwd, 't-256-gates');
    const requested = log.filter(e => e.event === 'requested');
    const decided = log.filter(e => e.event === 'decided');
    assert.equal(requested.length, 3, `requested: ${JSON.stringify(log)}`);
    assert.equal(decided.length, 3, `decided: ${JSON.stringify(log)}`);
    assert.equal(new Set(requested.map(e => e.turn)).size, 1, 'все запросы одного хода');
    assert.equal(decided.find(e => e.toolCallId === 'tc-256-g3').approved, false);
  });

  it('read-only вызов между write исполняется сразу, затем гейт следующего write', async () => {
    const t1 = createTaskFile(cwd, { title: 'Между 1' });
    const t2 = createTaskFile(cwd, { title: 'Между 2' });
    const { llm } = fakeLlm([
      {
        toolCalls: [
          { id: 'tc-256-r1', name: 'backlog_update_task', arguments: { id: t1.id, title: 'Между 1 обновлён' } },
          { id: 'tc-256-r2', name: 'backlog_search', arguments: { query: 'Между' } },
          { id: 'tc-256-r3', name: 'backlog_update_task', arguments: { id: t2.id, title: 'Между 2 обновлён' } },
        ],
      },
      { text: 'Готово.' },
    ]);
    const first = await collect({ message: 'обнови и поищи', threadId: 't-256-mixed' }, { llm });
    assert.equal(first.at(-1).toolCallId, 'tc-256-r1');

    const second = await collectWithThread(
      { approval: { toolCallId: 'tc-256-r1', approved: true } }, { llm }, 't-256-mixed',
    );
    const searchStart = second.find(e => e.type === 'tool_start' && e.id === 'tc-256-r2');
    assert.ok(searchStart, 'read-only вызов исполняется сразу, без гейта');
    assert.ok(second.some(e => e.type === 'tool_end' && e.id === 'tc-256-r2'));
    assert.equal(second.at(-1).type, 'approval', 'следующий write ждёт своего решения');
    assert.equal(second.at(-1).toolCallId, 'tc-256-r3');

    const third = await collectWithThread(
      { approval: { toolCallId: 'tc-256-r3', approved: true } }, { llm }, 't-256-mixed',
    );
    assert.equal(third.at(-1).type, 'done');
    assert.equal(listTasks(cwd, {}).find(x => x.id === t2.id).title, 'Между 2 обновлён');
  });
});

describe('chat: guard сирот и ошибки', () => {
  it('висящий tool_calls закрывается синтетическим результатом перед новым user', async () => {
    const { llm } = fakeLlm([{ text: 'Понял.' }]);
    // Ручная история: assistant с tool_calls без результата (обрыв на approval)
    const file = sessionFile('t-orphan');
    writeFileSync(file, [
      JSON.stringify({ role: 'user', content: 'создай задачу' }),
      JSON.stringify({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc-dead', name: 'backlog_create_task', arguments: { title: 'X' } }],
      }),
    ].join('\n') + '\n', 'utf-8');

    const events = await collect({ message: 'всё, забудь', threadId: 't-orphan' }, { llm });
    assert.equal(events.at(-1).type, 'done');

    const history = loadChatHistory(cwd, 't-orphan');
    // synthetic tool-result вставлен ДО нового user-сообщения
    const idxTool = history.findIndex(m => m.role === 'tool');
    const idxUser2 = history.map(m => m.role).lastIndexOf('user');
    assert.ok(idxTool > 0 && idxTool < idxUser2, 'synthetic result между assistant и user');
    const synthetic = JSON.parse(history[idxTool].content);
    assert.equal(synthetic.denied, true, 'синтетический отказ помечен denied');
    assert.equal(synthetic.reason, 'denied');
    assert.ok(synthetic.message.includes('отклонил') || synthetic.message.includes('Отменено'), `текст отказа: ${synthetic.message}`);
    assert.equal(history.at(-1).role, 'assistant');
  });

  it('без deps.llm и без env VIBELOG_LLM_* → событие error, не исключение', async () => {
    const savedKey = process.env.VIBELOG_LLM_API_KEY;
    const savedModel = process.env.VIBELOG_LLM_MODEL;
    delete process.env.VIBELOG_LLM_API_KEY;
    delete process.env.VIBELOG_LLM_MODEL;
    try {
      const events = await collect({ message: 'привет', threadId: 't-noenv' });
      const error = events.find(e => e.type === 'error');
      assert.ok(error, 'должно прийти событие error');
      assert.ok(error.message.includes('VIBELOG_LLM_API_KEY'));
    } finally {
      if (savedKey !== undefined) process.env.VIBELOG_LLM_API_KEY = savedKey;
      if (savedModel !== undefined) process.env.VIBELOG_LLM_MODEL = savedModel;
    }
  });

  it('пустое тело (нет message и approval) → error', async () => {
    const events = await collect({ threadId: 't-empty' });
    assert.equal(events.find(e => e.type === 'error')?.message.includes('Пустой запрос'), true);
  });

  it('невалидный threadId → error, тред не создаётся', async () => {
    const events = await collect({ message: 'x', threadId: '../evil' });
    assert.equal(events[0].type, 'error');
    assert.ok(events[0].message.includes('threadId'));
    assert.ok(!existsSync(join(cwd, '.vibelog', 'chat-sessions', '..', 'evil.jsonl')));
  });

  it('ошибка LLM (исключение) → событие error, история сохранена', async () => {
    const { llm } = fakeLlm([new Error('Сетевая ошибка LLM (обрыв)')]);
    const events = await collect({ message: 'тест ошибки', threadId: 't-err' }, { llm });
    const error = events.find(e => e.type === 'error');
    assert.ok(error.message.includes('Сетевая ошибка LLM'));
    const history = loadChatHistory(cwd, 't-err');
    assert.equal(history.at(-1).role, 'user');
  });
});

describe('chat: переопределение модели body.model (VL-209)', () => {
  it('неизвестная модель → error «Неизвестная модель», до LLM-вызова', async () => {
    const events = await collect({ message: 'привет', threadId: 't-badmodel', model: 'ghost/nope' });
    const error = events.find(e => e.type === 'error');
    assert.ok(error, 'должно прийти событие error');
    assert.match(error.message, /Неизвестная модель: ghost\/nope/);
  });

  it('body.model не строка → error «Некорректная модель»', async () => {
    const events = await collect({ message: 'привет', threadId: 't-nummodel', model: 42 });
    const error = events.find(e => e.type === 'error');
    assert.ok(error);
    assert.match(error.message, /Некорректная модель/);
  });

  it('секции models нет → любая body.model отклоняется (нет available)', async () => {
    const events = await collect({ message: 'привет', threadId: 't-nomodels', model: 'a/b' });
    const error = events.find(e => e.type === 'error');
    assert.ok(error);
    assert.match(error.message, /Неизвестная модель/);
  });
});

describe('chat: HTTP-интеграция', () => {
  it('POST /api/chat → 200 text/event-stream, поток data-строк читается', async () => {
    // Без LLM-env: сервер отвечает потоком thread+error — сеть не нужна
    const savedKey = process.env.VIBELOG_LLM_API_KEY;
    const savedModel = process.env.VIBELOG_LLM_MODEL;
    delete process.env.VIBELOG_LLM_API_KEY;
    delete process.env.VIBELOG_LLM_MODEL;
    const server = startWebServer(cwd, 0, false);
    try {
      await new Promise(resolve => server.on('listening', resolve));
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'привет', threadId: 't-http' }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');

      const raw = await res.text();
      const lines = raw.split('\n\n').filter(Boolean);
      assert.ok(lines.length >= 2, 'поток содержит события thread и error');
      const parsed = lines.map(l => {
        assert.ok(l.startsWith('data: '), `строка в формате data: ${l.slice(0, 30)}`);
        return JSON.parse(l.slice(6));
      });
      assert.equal(parsed[0].type, 'thread');
      assert.equal(parsed[0].threadId, 't-http');
      assert.ok(parsed.some(e => e.type === 'error'));
    } finally {
      server.close();
      if (savedKey !== undefined) process.env.VIBELOG_LLM_API_KEY = savedKey;
      if (savedModel !== undefined) process.env.VIBELOG_LLM_MODEL = savedModel;
    }
  });

  it('история чата хранится в .vibelog/chat-sessions/<threadId>.jsonl', async () => {
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'проверка файла', threadId: 't-file' }, { llm });
    const file = sessionFile('t-file');
    assert.ok(existsSync(file), 'файл истории создан');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).role, 'user');
    assert.equal(JSON.parse(lines[1]).role, 'assistant');
  });
});

describe('chat: роль ассистента (VL-265)', () => {
  let pcwd;

  beforeAll(() => {
    pcwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-persona-'));
    mkdirSync(join(pcwd, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(pcwd, 'backlog', 'config.yml'), stringifyYaml({
      project_name: 'Persona Test',
      task_prefix: 'pp',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }), 'utf-8');
    mkdirSync(join(pcwd, '.vibelog'), { recursive: true });
    writeFileSync(join(pcwd, '.vibelog', 'settings.json'), JSON.stringify({
      chat_personas: {
        researcher: { label: 'Ресёрчер', description: 'Ищет информацию', prompt: 'researcher' },
      },
    }, null, 2), 'utf-8');
    mkdirSync(join(pcwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
    writeFileSync(
      join(pcwd, '.vibelog', 'prompts', 'personas', 'researcher.md'),
      'Ты — ресёрчер проекта: ищи источники.',
      'utf-8',
    );
  });

  afterAll(() => {
    rmSync(pcwd, { recursive: true, force: true });
  });

  /** Сбор событий runChat на отдельном cwd (свои настройки ролей). */
  async function collectP(body, deps) {
    const events = [];
    for await (const ev of runChat(body, pcwd, deps)) events.push(ev);
    return events;
  }

  it('роль architect добавляет свой блок в системный промпт', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    await collectP({ message: 'привет', threadId: 'p-arch', persona: 'architect' }, { llm });
    const system = state.messages[0][0].content;
    assert.ok(system.includes('## Текущая роль: Архитектор'), 'блок роли в промпте');
    assert.ok(system.includes('Planned'), 'текст роли architect в промпте');
    // Общая часть идёт раньше блока роли (AC7)
    assert.ok(system.indexOf('Правило доступа') < system.indexOf('## Текущая роль'));
  });

  it('проектная роль читается из .vibelog/prompts/personas', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    await collectP({ message: 'привет', threadId: 'p-res', persona: 'researcher' }, { llm });
    const system = state.messages[0][0].content;
    assert.ok(system.includes('## Текущая роль: Ресёрчер'));
    assert.ok(system.includes('ищи источники'));
  });

  it('роль определяет defaultStatus: architect → Planned, helper → Spec', async () => {
    const mk = (tcId, title) => fakeLlm([
      { toolCalls: [{ id: tcId, name: 'backlog_create_task', arguments: { title } }] },
      { text: 'Создал.' },
    ]);
    const arch = mk('tc-p-arch', 'Architect-задача VL-265');
    await collectP({ message: 'создай', threadId: 'p-arch-status', persona: 'architect' }, arch);
    await collectP(
      { threadId: 'p-arch-status', persona: 'architect', approval: { toolCallId: 'tc-p-arch', approved: true } },
      arch,
    );
    const archTask = listTasks(pcwd, {}).find(t => t.title === 'Architect-задача VL-265');
    assert.equal(archTask.status, 'Planned', 'architect → Planned');

    const helper = mk('tc-p-helper', 'Helper-задача VL-265');
    await collectP({ message: 'создай', threadId: 'p-helper-status' }, helper);
    await collectP(
      { threadId: 'p-helper-status', approval: { toolCallId: 'tc-p-helper', approved: true } },
      helper,
    );
    const helperTask = listTasks(pcwd, {}).find(t => t.title === 'Helper-задача VL-265');
    assert.equal(helperTask.status, 'Spec', 'без persona → helper → Spec');
  });

  it('явный status в вызове приоритетнее роли', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-p-explicit', name: 'backlog_create_task', arguments: { title: 'Explicit-задача VL-265', status: 'In Progress' } }] },
      { text: 'Создал.' },
    ]);
    await collectP({ message: 'создай', threadId: 'p-explicit', persona: 'architect' }, { llm });
    await collectP(
      { threadId: 'p-explicit', persona: 'architect', approval: { toolCallId: 'tc-p-explicit', approved: true } },
      { llm },
    );
    const task = listTasks(pcwd, {}).find(t => t.title === 'Explicit-задача VL-265');
    assert.equal(task.status, 'In Progress');
  });

  it('неизвестная роль → error-событие, ход не начинается (jsonl не создан)', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    const events = await collectP({ message: 'привет', threadId: 'p-bad', persona: 'nope' }, { llm });
    const err = events.find(e => e.type === 'error');
    assert.ok(err, 'событие error');
    assert.equal(err.message, 'Неизвестная роль: nope');
    assert.equal(events.at(-1).type, 'error');
    assert.equal(state.calls, 0, 'LLM не вызывался');
    assert.ok(!existsSync(join(pcwd, '.vibelog', 'chat-sessions', 'p-bad.jsonl')), 'история не создана');
  });

  it('удалённая роль orchestrator (VL-273) → error-событие, ход не начинается', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    const events = await collectP(
      { message: 'привет', threadId: 'p-retired', persona: 'orchestrator' },
      { llm },
    );
    const err = events.find(e => e.type === 'error');
    assert.ok(err, 'событие error');
    assert.equal(err.message, 'Неизвестная роль: orchestrator');
    assert.equal(events.at(-1).type, 'error');
    assert.equal(state.calls, 0, 'LLM не вызывался');
    assert.ok(
      !existsSync(join(pcwd, '.vibelog', 'chat-sessions', 'p-retired.jsonl')),
      'история не создана',
    );
  });

  it('persona не строка → error-событие', async () => {
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    const events = await collectP({ message: 'привет', threadId: 'p-type', persona: 42 }, { llm });
    const err = events.find(e => e.type === 'error');
    assert.ok(err);
    assert.match(err.message, /Некорректная роль/);
  });

  it('смена роли посреди треда не применяется: роль зафиксирована первым ходом (VL-283)', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    await collectP({ message: 'первый', threadId: 'p-switch' }, { llm });
    const historyAfterFirst = loadChatHistory(pcwd, 'p-switch');
    await collectP({ message: 'второй', threadId: 'p-switch', persona: 'architect' }, { llm });
    // VL-283: роль треда — helper (первый ход без persona), чужой body.persona игнорируется
    assert.ok(state.messages[1][0].content.includes('## Текущая роль: Помощник'));
    assert.ok(!state.messages[1][0].content.includes('## Текущая роль: Архитектор'));
    const history = loadChatHistory(pcwd, 'p-switch');
    assert.equal(history[0].content, historyAfterFirst[0].content, 'история не переписана');
    assert.equal(history[1].content, historyAfterFirst[1].content);
    assert.ok(!history.some(m => m.role === 'system'), 'system в истории не хранится');
  });
});

/**
 * VL-255: дедупликация и лимит tool-вызовов на ход в веб-чате.
 *
 * Отдельный cwd на каждый тест (mkdtemp — lesson-89): свои settings.json
 * (chat_max_tool_calls), файлы проекта и allow-list для write-вызовов.
 */
describe('VL-255 — дедупликация и лимит tool-вызовов', () => {
  /** Проект-фикстура: README.md + опционально settings.json. */
  function makeProject({ settings } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-chat-dedup-'));
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), 'строка 1\nстрока 2\nстрока 3\n', 'utf-8');
    writeFileSync(join(dir, 'backlog', 'config.yml'), stringifyYaml({
      project_name: 'Dedup Test',
      task_prefix: 'dd',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }), 'utf-8');
    if (settings !== undefined) {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify(settings), 'utf-8');
    }
    return dir;
  }

  /** События runChat на отдельном проекте (+allow-list треда при need). */
  async function collectOn(dir, body, deps, allowThread) {
    if (allowThread) {
      mkdirSync(join(dir, '.vibelog', 'chat-sessions'), { recursive: true });
      writeFileSync(
        join(dir, '.vibelog', 'chat-sessions', `${body.threadId}.allow.json`),
        JSON.stringify(allowThread),
        'utf-8',
      );
    }
    const events = [];
    for await (const ev of runChat(body, dir, deps)) events.push(ev);
    return events;
  }

  it('три идентичных read_file: первый исполнен, два других — duplicate с пояснением', async () => {
    const dir = makeProject();
    try {
      const call = { id: 'c1', name: 'read_file', arguments: { path: 'README.md' } };
      const { llm } = fakeLlm([
        { text: 'Читаю.', toolCalls: [call, { ...call, id: 'c2' }, { ...call, id: 'c3' }] },
        { text: 'Готово.' },
      ]);
      const events = await collectOn(dir, { message: 'прочитай README', threadId: 'd-dup' }, { llm });

      const ends = events.filter(e => e.type === 'tool_end');
      assert.equal(ends.length, 3, 'tool_end есть для каждого вызова');
      assert.equal(events.filter(e => e.type === 'tool_start').length, 3, 'парность tool_start/tool_end');
      assert.match(ends[0].result, /строка 1/, 'первый вызов реально прочитан');
      for (const blocked of ends.slice(1)) {
        const parsed = JSON.parse(blocked.result);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.duplicate, true);
        assert.match(parsed.message, /Идентичный вызов уже выполнен в этом ходе/);
        assert.ok(!blocked.result.includes('строка 1'), 'содержимое файла не повторяется');
      }
      const history = loadChatHistory(dir, 'd-dup');
      assert.equal(history.filter(m => m.role === 'tool').length, 3, 'история сохраняет парность');
      assert.equal(events.at(-1).type, 'done');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('30 разных вызовов: выполнены 16, остальные 14 — limit с пояснением', async () => {
    const dir = makeProject();
    try {
      const calls = Array.from({ length: 30 }, (_, i) => ({
        id: `c${i}`,
        name: 'read_file',
        arguments: { path: 'README.md', offset: i },
      }));
      const { llm } = fakeLlm([{ text: 'Читаю пачкой.', toolCalls: calls }, { text: 'Готово.' }]);
      const events = await collectOn(dir, { message: 'прочитай', threadId: 'd-limit' }, { llm });

      const ends = events.filter(e => e.type === 'tool_end');
      assert.equal(ends.length, 30);
      let limited = 0;
      let executed = 0;
      for (const e of ends) {
        if (e.result.includes('Лимит tool-вызовов на один ответ исчерпан')) {
          limited++;
          const parsed = JSON.parse(e.result);
          assert.equal(parsed.limit, true);
          assert.match(parsed.message, /\(16\)/);
          assert.match(parsed.message, /заверши ход и продолжи следующим/);
        } else {
          executed++;
        }
      }
      assert.equal(executed, 16, 'выполнено ровно 16 (дефолтный лимит)');
      assert.equal(limited, 14, 'остальные 14 заблокированы лимитом');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('чтение после записи того же файла не считается дублем (write из allow-list)', async () => {
    const dir = makeProject();
    try {
      const { llm } = fakeLlm([
        {
          text: 'Правлю.',
          toolCalls: [
            { id: 'r1', name: 'read_file', arguments: { path: 'README.md' } },
            { id: 'w1', name: 'write_file', arguments: { path: 'README.md', content: 'новое\n' } },
            { id: 'r2', name: 'read_file', arguments: { path: 'README.md' } },
          ],
        },
        { text: 'Готово.' },
      ]);
      const events = await collectOn(
        dir,
        { message: 'правь README', threadId: 'd-write' },
        { llm },
        ['write_file'],
      );
      const ends = events.filter(e => e.type === 'tool_end');
      assert.equal(ends.length, 3);
      assert.ok(!ends[2].result.includes('"duplicate":true'), 'повтор чтения после write разрешён');
      assert.match(ends[2].result, /новое/, 'прочитано новое содержимое');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('chat_max_tool_calls из settings.json применяется; мусор → дефолт 16', async () => {
    for (const [value, expected] of [[2, 2], ['abc', 16]]) {
      const dir = makeProject({ settings: { chat_max_tool_calls: value } });
      try {
        const calls = Array.from({ length: 5 }, (_, i) => ({
          id: `c${i}`,
          name: 'read_file',
          arguments: { path: 'README.md', offset: i },
        }));
        const { llm } = fakeLlm([{ text: 'Читаю.', toolCalls: calls }, { text: 'Готово.' }]);
        const events = await collectOn(dir, { message: 'читай', threadId: 'd-cfg' }, { llm });
        const ends = events.filter(e => e.type === 'tool_end');
        const executed = ends.filter(e => !e.result.includes('Лимит tool-вызовов')).length;
        const expectedExecuted = Math.min(calls.length, expected);
        assert.equal(
          executed,
          expectedExecuted,
          `chat_max_tool_calls=${JSON.stringify(value)} → ${expectedExecuted} исполнено`,
        );
        if (expected < calls.length) {
          assert.match(
            ends[expected].result,
            new RegExp(`Лимит tool-вызовов на один ответ исчерпан \\(${expected}\\)`),
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('диагностика хода пишется в <threadId>.repeat.json и не ломает список тредов', async () => {
    const dir = makeProject();
    try {
      const call = { id: 'c1', name: 'read_file', arguments: { path: 'README.md' } };
      const { llm } = fakeLlm([
        { text: 'Читаю.', toolCalls: [call, { ...call, id: 'c2' }, { ...call, id: 'c3' }] },
        { text: 'Готово.' },
      ]);
      await collectOn(dir, { message: 'читай', threadId: 'd-stats' }, { llm });

      const stats = loadChatToolStats(dir, 'd-stats');
      assert.ok(stats, 'файл диагностики создан');
      assert.equal(stats.executed, 1);
      assert.equal(stats.deduped, 2);
      assert.equal(stats.limit_hits, 0);
      assert.ok(stats.repeat_stats, 'repeat_stats в формате агент-петли');
      assert.equal(stats.repeat_stats.tool_calls_total, 3);
      assert.ok(Array.isArray(stats.repeat_stats.top));
      assert.equal(typeof stats.repeat_stats.repeat_share, 'number');
      assert.equal(typeof stats.turn, 'number');
      // Файл .repeat.json не должен считаться тредом в списке чатов
      assert.deepEqual(listChatThreads(dir).map(t => t.threadId), ['d-stats']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('chat: VL-268 — grant прогона развязывает инструменты супервизора', () => {
  it('активный grant покрывает backlog_supervisor plan: паузы нет, tool_start auto', async () => {
    const task = createTaskFile(cwd, { title: 'Grant план', status: 'Spec' });
    writeGrant(cwd, {
      runId: 'run-chat-grant-1',
      taskIds: [task.id],
      allowedTools: ['backlog_supervisor', 'backlog_trigger_phase'],
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    try {
      const { llm } = fakeLlm([
        { toolCalls: [{ id: 'tc-sup-plan', name: 'backlog_supervisor', arguments: { action: 'plan', ids: [task.id] } }] },
        { text: 'Вот план.' },
      ]);
      const events = await collect({ message: 'покажи план', threadId: 't-grant-ok' }, { llm });
      assert.ok(!events.some(e => e.type === 'approval'), 'grant снимает паузу Allow/Deny');
      const start = events.find(e => e.type === 'tool_start');
      assert.equal(start.auto, true);
      const end = events.find(e => e.type === 'tool_end');
      assert.ok(String(end.result).includes('Волна 1'), 'план посчитан');
      assert.equal(events.at(-1).type, 'done');
    } finally {
      revokeGrant(cwd, 'run-chat-grant-1', 'конец теста');
    }
  });

  it('без grant инструмент супервизора идёт обычным путём Allow/Deny', async () => {
    const task = createTaskFile(cwd, { title: 'Без grant', status: 'Spec' });
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-sup-plan-2', name: 'backlog_supervisor', arguments: { action: 'start', ids: [task.id] } }] },
    ]);
    const events = await collect({ message: 'покажи план', threadId: 't-grant-none' }, { llm });
    const approval = events.find(e => e.type === 'approval');
    assert.ok(approval, 'без grant вызов ждёт подтверждения');
    assert.equal(approval.name, 'backlog_supervisor');
    // данные карточки grant (состав прогона) приходят в событии approval
    assert.ok(approval.grant, 'предпросмотр grant в событии approval');
    assert.deepEqual(approval.grant.taskIds, [task.id]);
    assert.ok(Array.isArray(approval.grant.tools));
    assert.ok(!approval.grant.tools.some(t => t.name === 'write_file'), 'write_file не grantable');
    assert.equal(events.at(-1).type, 'approval');
  });

  it('задача вне taskIds прогона → отказ без исполнения и без паузы', async () => {
    const inside = createTaskFile(cwd, { title: 'В прогоне 2', status: 'Spec' });
    const outside = createTaskFile(cwd, { title: 'Вне прогона 2', status: 'Spec' });
    writeGrant(cwd, {
      runId: 'run-chat-grant-2',
      taskIds: [inside.id],
      allowedTools: ['backlog_trigger_phase'],
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    try {
      const { llm } = fakeLlm([
        { toolCalls: [{ id: 'tc-outside', name: 'backlog_trigger_phase', arguments: { id: outside.id } }] },
        { text: 'Не могу.' },
      ]);
      const events = await collect({ message: 'запусти', threadId: 't-grant-out' }, { llm });
      assert.ok(!events.some(e => e.type === 'approval'), 'отказ не превращается в Allow/Deny');
      const end = events.find(e => e.type === 'tool_end');
      assert.equal(end.isError, true);
      assert.ok(String(end.result).includes('вне прогона'));
      assert.equal(getTask(cwd, outside.id).status, 'Spec', 'фаза не запускалась');
    } finally {
      revokeGrant(cwd, 'run-chat-grant-2', 'конец теста');
    }
  });
});

describe('chat: лимиты хода из конфига (VL-269)', () => {
  /** Запись секции chat в settings.json общего cwd. */
  function writeChatSettings(chat) {
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    const file = join(cwd, '.vibelog', 'settings.json');
    let current = {};
    try {
      current = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      current = {};
    }
    writeFileSync(file, JSON.stringify({ ...current, chat }, null, 2), 'utf-8');
  }

  /** Удаление секции chat из settings.json (изоляция от соседних тестов). */
  function clearChatSettings() {
    const file = join(cwd, '.vibelog', 'settings.json');
    try {
      const current = JSON.parse(readFileSync(file, 'utf-8'));
      delete current.chat;
      writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8');
    } catch {
      rmSync(file, { force: true });
    }
  }

  afterAll(() => {
    clearChatSettings();
  });

  it('лимит итераций исчерпан → событие truncated/iterations, история цела', async () => {
    writeChatSettings({ max_iterations: 2 });
    /* Каждый ответ — tool_call (backlog_search): ход сам не завершается */
    const step = n => ({ toolCalls: [{ id: `tc-limit-${n}`, name: 'backlog_search', arguments: { query: `q${n}` } }] });
    const { llm } = fakeLlm([step(1), step(2), step(3), step(4)]);
    const events = await collect({ message: 'ищи', threadId: 't-trunc-iter' }, { llm });

    const truncated = events.find(e => e.type === 'truncated');
    assert.ok(truncated, 'должно прийти событие truncated');
    assert.equal(truncated.reason, 'iterations');
    assert.equal(truncated.saved, true);
    assert.equal(truncated.step, 2);
    assert.equal(truncated.limits.maxIterations, 2);
    assert.ok(!events.some(e => e.type === 'error' && /лимит итераций/i.test(e.message)));

    /* История jsonl к моменту truncated: user + 2 пары assistant/tool */
    const history = loadChatHistory(cwd, 't-trunc-iter');
    assert.equal(history[0].role, 'user');
    assert.equal(history.filter(m => m.role === 'assistant').length, 2, 'два ответа модели сохранены');
    assert.equal(history.filter(m => m.role === 'tool').length, 2, 'два tool-результата сохранены');
  });

  it('лимит времени исчерпан → truncated/wall_time, история цела', async () => {
    writeChatSettings({ max_wall_time: 1, max_iterations: 50 });
    let calls = 0;
    /* Первый ответ медленный (перебор бюджета 1 с) и содержит tool-вызов:
       цикл идёт на следующую итерацию, где бюджет уже исчерпан */
    const slowLlm = {
      async streamChat() {
        calls++;
        await new Promise(r => setTimeout(r, 1100));
        return {
          text: `ответ-${calls}`,
          toolCalls: [{ id: `tc-wall-${calls}`, name: 'backlog_search', arguments: { query: `w${calls}` } }],
          usage: zeroUsage(),
        };
      },
    };
    const events = await collect({ message: 'медленно', threadId: 't-trunc-wall' }, { llm: slowLlm });

    const truncated = events.find(e => e.type === 'truncated');
    assert.ok(truncated, 'должно прийти событие truncated');
    assert.equal(truncated.reason, 'wall_time');
    assert.equal(truncated.saved, true);
    const history = loadChatHistory(cwd, 't-trunc-wall');
    assert.equal(history[0].role, 'user');
    assert.ok(history.some(m => m.role === 'assistant' && m.content === 'ответ-1'), 'первый ответ сохранён');
  });

  it('continue:true — продолжение без нового user-сообщения', async () => {
    clearChatSettings();
    const { llm } = fakeLlm([{ text: 'Сначала.' }, { text: 'Продолжил.' }]);
    await collect({ message: 'начни', threadId: 't-continue' }, { llm });
    const usersBefore = loadChatHistory(cwd, 't-continue').filter(m => m.role === 'user').length;

    const events = await collect({ continue: true, threadId: 't-continue' }, { llm });
    assert.ok(events.some(e => e.type === 'done'), 'ход завершился done');
    assert.ok(!events.some(e => e.type === 'error'));

    const after = loadChatHistory(cwd, 't-continue');
    assert.equal(after.filter(m => m.role === 'user').length, usersBefore, 'user-сообщений не прибавилось');
    assert.equal(after.at(-1).role, 'assistant');
    assert.equal(after.at(-1).content, 'Продолжил.');
  });

  it('continue:true на пустой истории → error «Нечего продолжать»', async () => {
    const { llm } = fakeLlm([{ text: 'не должно выполниться' }]);
    const events = await collect({ continue: true, threadId: 't-continue-empty' }, { llm });
    const error = events.find(e => e.type === 'error');
    assert.ok(error);
    assert.match(error.message, /Нечего продолжать/);
  });

  it('изменение конфига применяется к следующему ходу без перезапуска (AC2)', async () => {
    writeChatSettings({ max_iterations: 1 });
    const step = n => ({ toolCalls: [{ id: `tc-reconf-${n}`, name: 'backlog_search', arguments: { query: `r${n}` } }] });
    const first = fakeLlm([step(1), step(2)]);
    const events1 = await collect({ message: 'раз', threadId: 't-reconf' }, { llm: first.llm });
    assert.equal(events1.find(e => e.type === 'truncated')?.reason, 'iterations');

    writeChatSettings({ max_iterations: 5 });
    const second = fakeLlm([step(3), { text: 'Готово.' }]);
    const events2 = await collect({ continue: true, threadId: 't-reconf' }, { llm: second.llm });
    assert.ok(!events2.some(e => e.type === 'truncated'), 'лимит из нового конфига не сработал');
    assert.equal(events2.at(-1).type, 'done');
  });

  it('мусорный конфиг не роняет чат — работают дефолты', async () => {
    writeChatSettings({ max_iterations: 'много', call_timeout: -5 });
    const { llm } = fakeLlm([{ text: 'Ответ на дефолтах.' }]);
    const events = await collect({ message: 'привет', threadId: 't-badlimits' }, { llm });
    assert.ok(!events.some(e => e.type === 'error'));
    assert.equal(events.at(-1).type, 'done');
    assert.equal(loadChatHistory(cwd, 't-badlimits').at(-1).content, 'Ответ на дефолтах.');
  });

  it('per-call таймаут молчащего вызова → truncated/wall_time, а не error', async () => {
    writeChatSettings({ call_timeout: 1, max_wall_time: 300, max_iterations: 10 });
    /* LLM «висит», пока guard не абортит сигнал */
    const hungLlm = {
      streamChat(_messages, _tools, opts) {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('Операция прервана')));
        });
      },
    };
    const events = await collect({ message: 'висни', threadId: 't-call-timeout' }, { llm: hungLlm });
    const truncated = events.find(e => e.type === 'truncated');
    assert.ok(truncated, 'per-call таймаут даёт truncated');
    assert.equal(truncated.reason, 'wall_time');
    assert.equal(truncated.limits.callTimeoutSec, 1);
  });
});
