/**
 * Сквозные тесты VL-330 — интерактивный вопрос `ask_user` в веб-чате.
 *
 * Проверяют полный цикл через `runChat` с подменным LLM (паттерн
 * `chat.test.mjs`): пауза хода событием `question`, resume с полем `answer`,
 * синтетический tool-результат в jsonl, отказы валидации, TTL и снятие
 * вопроса новым сообщением.
 *
 * Каталог — mkdtemp (правило AGENTS.md, lesson-89).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat, loadChatHistory } from '../../dist/web/chat.js';
import { chatToolDefs, isWriteOperation, isInteractiveTool } from '../../dist/web/tool-policy.js';
import { listTools } from '../../dist/mcp/tools.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-ask-user-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Ask User Test',
      task_prefix: 'au',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Фейковый LLM: очередь ответов {text?, toolCalls?} (паттерн chat.test.mjs). */
function fakeLlm(script) {
  const state = { calls: 0 };
  const llm = {
    async streamChat(_messages, _tools, opts) {
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
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

/** Аргументы вопроса — базовые для сквозных кейсов. */
const askArgs = {
  question: 'Продолжить?',
  options: [
    { id: 'yes', label: 'Да' },
    { id: 'no', label: 'Нет' },
  ],
};

describe('VL-330 — классификация и доступность инструмента', () => {
  it('ask_user не write и явно интерактивный', () => {
    assert.equal(isWriteOperation('ask_user'), false);
    assert.equal(isInteractiveTool('ask_user'), true);
  });

  it('ask_user объявлен в инструментах веб-чата со схемой', () => {
    const def = chatToolDefs(cwd).find(d => d.name === 'ask_user');
    assert.ok(def, 'ask_user объявлен в chatToolDefs');
    assert.equal(def.inputSchema.properties.question.type, 'string');
    assert.equal(def.inputSchema.properties.options.type, 'array');
    assert.equal(def.inputSchema.properties.allow_custom.type, 'boolean');
    assert.deepEqual(def.inputSchema.required, ['question', 'options']);
  });

  it('ask_user отсутствует в MCP-реестре (headless-режимы его не видят)', () => {
    assert.ok(!listTools().some(t => t.name === 'ask_user'));
  });
});

describe('VL-330 — пауза и resume', () => {
  it('вызов ставит ход на паузу событием question; ответ возобновляет ход', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-1', name: 'ask_user', arguments: askArgs }] },
      { text: 'Спасибо, продолжаю.' },
    ]);

    const events1 = await collect({ message: 'спроси меня', threadId: 't-ask' }, { llm });
    const question = events1.find(e => e.type === 'question');
    assert.ok(question, 'событие question должно прийти');
    assert.equal(question.toolCallId, 'tc-q-1');
    assert.equal(question.question, 'Продолжить?');
    assert.deepEqual(question.options.map(o => o.id), ['yes', 'no']);
    assert.equal(question.allowCustom, true);
    assert.equal(events1.at(-1).type, 'question', 'поток закрылся на паузе');
    assert.ok(!events1.some(e => e.type === 'approval'), 'вопрос не показывается как Allow/Deny');

    const events2 = await collect(
      { threadId: 't-ask', answer: { toolCallId: 'tc-q-1', optionId: 'yes' } },
      { llm },
    );
    assert.ok(events2.some(e => e.type === 'tool_end'), 'tool_end с ответом');
    assert.ok(events2.some(e => e.type === 'text'), 'ход продолжился');
    assert.equal(events2.at(-1).type, 'done');

    const history = loadChatHistory(cwd, 't-ask');
    const tool = history.find(m => m.role === 'tool' && m.tool_call_id === 'tc-q-1');
    assert.deepEqual(JSON.parse(tool.content), { answer: { id: 'yes', label: 'Да' } });
  });

  it('свободный ответ приходит как {answer:{custom}}', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-2', name: 'ask_user', arguments: askArgs }] },
      { text: 'Понял.' },
    ]);
    await collect({ message: 'спроси', threadId: 't-ask-custom' }, { llm });
    const events = await collect(
      { threadId: 't-ask-custom', answer: { toolCallId: 'tc-q-2', custom: 'не сейчас' } },
      { llm },
    );
    assert.equal(events.at(-1).type, 'done');
    const history = loadChatHistory(cwd, 't-ask-custom');
    const tool = history.find(m => m.role === 'tool' && m.tool_call_id === 'tc-q-2');
    assert.deepEqual(JSON.parse(tool.content), { answer: { custom: 'не сейчас' } });
  });

  it('два одинаковых ask_user подряд дают две карточки (дедуп не схлопывает)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-6', name: 'ask_user', arguments: askArgs }] },
      { toolCalls: [{ id: 'tc-q-7', name: 'ask_user', arguments: askArgs }] },
      { text: 'Оба вопроса заданы.' },
    ]);
    const first = await collect({ message: 'спроси дважды', threadId: 't-ask-two' }, { llm });
    assert.ok(first.some(e => e.type === 'question' && e.toolCallId === 'tc-q-6'));

    const second = await collect(
      { threadId: 't-ask-two', answer: { toolCallId: 'tc-q-6', optionId: 'yes' } },
      { llm },
    );
    const question2 = second.find(e => e.type === 'question');
    assert.ok(question2, 'второй одинаковый вопрос снова показан');
    assert.equal(question2.toolCallId, 'tc-q-7');
  });
});

describe('VL-330 — отказы валидации', () => {
  it('битые аргументы вопроса → ошибка модели, паузы нет', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-bad', name: 'ask_user', arguments: { question: '', options: [] } }] },
      { text: 'Извините, переспрошу иначе.' },
    ]);
    const events = await collect({ message: 'спроси', threadId: 't-ask-bad' }, { llm });
    assert.ok(!events.some(e => e.type === 'question'), 'битый вопрос не показываем');
    const err = events.find(e => e.type === 'tool_end' && e.isError === true);
    assert.ok(err, 'ошибка вернулась модели');
    assert.match(err.result, /question/);
    assert.equal(events.at(-1).type, 'done');
  });

  it('VL-435: аргументы-сырьё (__raw, битый JSON) → ошибка с эхом и подсказкой, паузы нет', async () => {
    // склейка двух вопросов в один вызов: parseToolArguments положил сырьё под __raw
    const glued = '{"question":"Первый вопрос?","options":[{"id":"a","label":"A"}]} {"question":"Второй вопрос?"';
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-raw', name: 'ask_user', arguments: { __raw: glued } }] },
      { text: 'Понял, спрошу по одному.' },
    ]);
    const events = await collect({ message: 'спроси', threadId: 't-ask-raw' }, { llm });
    assert.ok(!events.some(e => e.type === 'question'), 'битый вызов не ставит паузу');
    const err = events.find(e => e.type === 'tool_end' && e.isError === true);
    assert.ok(err, 'ошибка вернулась модели');
    const payload = JSON.parse(err.result);
    assert.ok(payload.error.includes(glued.slice(0, 50)), 'эхо __raw дошло до модели');
    assert.match(payload.error, /по одному вопросу/);
    assert.equal(events.at(-1).type, 'done');
  });

  it('чужой optionId отклоняется понятной ошибкой', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-3', name: 'ask_user', arguments: askArgs }] },
    ]);
    await collect({ message: 'спроси', threadId: 't-ask-badopt' }, { llm });
    const events = await collect(
      { threadId: 't-ask-badopt', answer: { toolCallId: 'tc-q-3', optionId: 'maybe' } },
      { llm },
    );
    const error = events.find(e => e.type === 'error');
    assert.ok(error, 'отказ пришёл событием error');
    assert.match(error.message, /не было среди предложенных/);
    const history = loadChatHistory(cwd, 't-ask-badopt');
    assert.ok(!history.some(m => m.role === 'tool' && m.tool_call_id === 'tc-q-3'));
  });

  it('custom при allow_custom=false отклоняется', async () => {
    const { llm } = fakeLlm([
      {
        toolCalls: [
          { id: 'tc-q-4', name: 'ask_user', arguments: { ...askArgs, allow_custom: false } },
        ],
      },
    ]);
    await collect({ message: 'спроси', threadId: 't-ask-strict' }, { llm });
    const events = await collect(
      { threadId: 't-ask-strict', answer: { toolCallId: 'tc-q-4', custom: 'свой' } },
      { llm },
    );
    const error = events.find(e => e.type === 'error');
    assert.ok(error);
    assert.match(error.message, /свободный ввод.*запрещён/);
  });

  it('пустой ответ отклоняется', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-empty', name: 'ask_user', arguments: askArgs }] },
    ]);
    await collect({ message: 'спроси', threadId: 't-ask-empty' }, { llm });
    const events = await collect(
      { threadId: 't-ask-empty', answer: { toolCallId: 'tc-q-empty' } },
      { llm },
    );
    const error = events.find(e => e.type === 'error');
    assert.ok(error);
    assert.match(error.message, /пуст/);
  });

  it('повторный ответ на уже отвеченный вопрос не проходит', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-5', name: 'ask_user', arguments: askArgs }] },
      { text: 'Готово.' },
    ]);
    await collect({ message: 'спроси', threadId: 't-ask-twice' }, { llm });
    await collect(
      { threadId: 't-ask-twice', answer: { toolCallId: 'tc-q-5', optionId: 'yes' } },
      { llm },
    );
    const events = await collect(
      { threadId: 't-ask-twice', answer: { toolCallId: 'tc-q-5', optionId: 'no' } },
      { llm },
    );
    const error = events.find(e => e.type === 'error');
    assert.ok(error, 'повторный ответ отклонён');
    assert.match(error.message, /уже ответили|не найден/);
  });

  it('неизвестный toolCallId — понятная ошибка, без зависания', async () => {
    const { llm } = fakeLlm([{ text: 'не используется' }]);
    await collect({ message: 'привет', threadId: 't-ask-unknown' }, { llm });
    const events = await collect(
      { threadId: 't-ask-unknown', answer: { toolCallId: 'tc-nope', optionId: 'yes' } },
      { llm },
    );
    const error = events.find(e => e.type === 'error');
    assert.ok(error);
    assert.match(error.message, /не найден/);
  });
});

describe('VL-330 — TTL и снятие вопроса', () => {
  it('истёкший TTL: ответ отклоняется «вопрос снят по таймауту»', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-8', name: 'ask_user', arguments: askArgs }] },
      { text: 'Ок.' },
    ]);
    await collect({ message: 'спроси', threadId: 't-ask-ttl' }, { llm });

    // Состариваем журнал вопроса: ts на 25 часов назад
    const logFile = join(cwd, '.vibelog', 'chat-sessions', 't-ask-ttl.questions.jsonl');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const lines = readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map(line => {
        const entry = JSON.parse(line);
        if (entry.event === 'asked' && entry.toolCallId === 'tc-q-8') entry.ts = old;
        return JSON.stringify(entry);
      });
    writeFileSync(logFile, lines.join('\n') + '\n', 'utf8');

    const events = await collect(
      { threadId: 't-ask-ttl', answer: { toolCallId: 'tc-q-8', optionId: 'yes' } },
      { llm },
    );
    const error = events.find(e => e.type === 'error');
    assert.ok(error, 'истёкший вопрос не принимает ответ');
    assert.match(error.message, /таймаут/);
    assert.ok(!events.some(e => e.type === 'text'), 'ход не возобновился');
  });

  it('новое сообщение вместо ответа снимает вопрос (answer:null)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-q-9', name: 'ask_user', arguments: askArgs }] },
      { text: 'Хорошо, идём дальше.' },
    ]);
    await collect({ message: 'спроси', threadId: 't-ask-cancel' }, { llm });
    await collect({ threadId: 't-ask-cancel', message: 'не отвечай, делай' }, { llm });

    const history = loadChatHistory(cwd, 't-ask-cancel');
    const tool = history.find(m => m.role === 'tool' && m.tool_call_id === 'tc-q-9');
    assert.ok(tool, 'висящий вопрос закрыт синтетическим результатом');
    const parsed = JSON.parse(tool.content);
    assert.equal(parsed.answer, null);
    assert.equal(parsed.cancelled, true);
  });
});
