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

import { runChat, loadChatHistory } from '../../dist/web/chat.js';
import { startWebServer } from '../../dist/web/server.js';
import { createTaskFile, listTasks } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

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

  it('второй write того же хода без подтверждения → reason=not_confirmed (а не denied) (VL-262)', async () => {
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
    await collect({ message: 'обнови две задачи', threadId: 't-262-two' }, { llm });
    // Подтверждаем только первый write; второй закрывается синтетическим отказом
    await collectWithThread(
      { approval: { toolCallId: 'tc-262-w1', approved: true } }, { llm }, 't-262-two',
    );
    const toolMsgs = loadChatHistory(cwd, 't-262-two').filter(m => m.role === 'tool');
    const second = toolMsgs.find(m => m.tool_call_id === 'tc-262-w2');
    assert.ok(second, 'результат второго write есть в истории');
    const ack = JSON.parse(second.content);
    assert.equal(ack.reason, 'not_confirmed', `причина отказа второго write: ${second.content}`);
    assert.equal(ack.denied, true);
    assert.ok(ack.hint.includes('idempotencyKey'), 'подсказка про безопасный повтор');
    // Первый применился, второй — нет
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
