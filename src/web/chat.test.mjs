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
    statuses: ['To Do', 'In Progress', 'Done'],
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

    // инструменты модели — ровно три нужных имени (AC)
    const toolNames = state.tools.map(t => t.name).sort();
    assert.deepEqual(toolNames, ['backlog_create_task', 'backlog_search', 'backlog_view_task']);

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
    assert.ok(history[idxTool].content.includes('Отменено'));
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
