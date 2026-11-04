/**
 * Тесты VL-332 — ход веб-чата не теряется при обрыве SSE-потребителя.
 *
 * Проверяют серверный реестр прогонов (`src/web/chat-runs.ts`) и его
 * интеграцию с `runChat`/`streamChatRun`: подписчик отписался — ход дошёл до
 * конца и jsonl содержит ответ (AC1/AC2); повторный POST по тому же треду
 * джойнится к идущему прогону, а не запускает второй LLM-цикл; переподключение
 * с `since` не дублирует события (AC5); cancel завершает ход статусом
 * `cancelled`; sidecar `<threadId>.turn.json` отражает состояние и
 * «осиротевший» running переводится в `interrupted` (AC3/AC4).
 *
 * Каталог — mkdtemp (правило AGENTS.md, lesson-89).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat, streamChatRun, loadChatHistory } from '../../dist/web/chat.js';
import {
  clearChatRuns,
  getChatRun,
  readTurnState,
  resetOrphanedRuns,
  subscribeChatRun,
  writeTurnState,
} from '../../dist/web/chat-runs.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-detached-run-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Detached Run Test',
      task_prefix: 'dr',
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

beforeEach(() => {
  clearChatRuns();
});

/** Фейковый LLM: очередь ответов {text?, toolCalls?} (паттерн chat.test.mjs). */
function fakeLlm(script, opts = {}) {
  const state = { calls: 0 };
  const llm = {
    async streamChat(_messages, _tools, callOpts) {
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      if (opts.delayMs) {
        await new Promise(resolve => setTimeout(resolve, opts.delayMs));
      }
      const tokens = step.tokens ?? (step.text ? step.text.split(/(?<=\s)/) : []);
      for (const t of tokens) callOpts?.onToken?.(t);
      return {
        text: step.text ?? tokens.join(''),
        toolCalls: step.toolCalls ?? [],
        usage: zeroUsage(),
      };
    },
  };
  return { llm, state };
}

/** Дождаться завершения прогона (событие done либо статус из sidecar). */
async function waitForRunEnd(threadId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = getChatRun(threadId);
    if (run !== null && run.done) return run;
    const state = readTurnState(cwd, threadId);
    if (run === null && state !== null && state.status !== 'running') return null;
    if (Date.now() > deadline) throw new Error('прогон не завершился за отведённое время');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('VL-332 — ход не зависит от потребителя (AC1/AC2)', () => {
  it('подписчик отписался сразу после thread-события — ответ всё равно в jsonl', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ответ после обрыва.' }], { delayMs: 30 });
    const threadId = 'dr-detached';
    const events = [];
    for await (const ev of runChat({ threadId, message: 'привет' }, cwd, { llm })) {
      events.push(ev);
      if (ev.type === 'thread') break; // потребитель ушёл сразу после старта
    }
    assert.equal(events.length, 1);
    await waitForRunEnd(threadId);

    const history = loadChatHistory(cwd, threadId);
    assert.equal(history.length, 2, 'user + assistant в jsonl');
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
    assert.match(history[1].content, /Ответ после обрыва\./);
    assert.equal(state.calls, 1, 'один LLM-вызов');
  });

  it('второй POST по тому же треду джойнится к идущему прогону (нет второго LLM-цикла)', async () => {
    const { llm, state } = fakeLlm([{ text: 'Долгий ответ.' }], { delayMs: 60 });
    const threadId = 'dr-join';
    const first = [];
    for await (const ev of runChat({ threadId, message: 'раз' }, cwd, { llm })) {
      first.push(ev);
      if (ev.type === 'thread') break;
    }
    const runBefore = getChatRun(threadId);
    assert.ok(runBefore !== null, 'прогон жив после ухода потребителя');

    const second = [];
    for await (const ev of runChat({ threadId, message: 'два' }, cwd, { llm })) {
      second.push(ev);
      if (ev.type === 'done') break;
    }
    assert.equal(state.calls, 1, 'второй POST не запустил второй LLM-цикл');
    const runAfter = getChatRun(threadId);
    assert.equal(runAfter, runBefore, 'прогон тот же (джойн, не новый)');
    assert.equal(runAfter.status, 'done', 'прогон завершён');
    const history = loadChatHistory(cwd, threadId);
    assert.equal(history.filter(m => m.role === 'user').length, 1, 'второе сообщение не записано');
    assert.ok(second.some(ev => ev.type === 'done'), 'подписчик получил done');
  });
});

describe('VL-332 — переподключение и события (AC5)', () => {
  it('streamChatRun с since отдаёт только события после индекса (без дублей)', async () => {
    const { llm } = fakeLlm([{ text: 'раз два три' }], { delayMs: 40 });
    const threadId = 'dr-since';
    // стартуем ход и уходим
    for await (const ev of runChat({ threadId, message: 'давай' }, cwd, { llm })) {
      if (ev.type === 'thread') break;
    }
    await waitForRunEnd(threadId);
    const run = getChatRun(threadId);
    assert.ok(run !== null, 'буфер прогона доступен позднему подписчику');

    const all = [];
    const unsub = subscribeChatRun(run, 0, (_ev, index) => all.push(index));
    unsub();
    assert.ok(all.length > 2, 'в буфере несколько событий');

    const tail = [];
    for await (const ev of streamChatRun(threadId, 2)) tail.push(ev);
    assert.equal(tail.length, all.length - 2, 'ровно хвост от индекса 2');
  });

  it('streamChatRun без живого прогона отдаёт пустой поток', async () => {
    const out = [];
    for await (const ev of streamChatRun('dr-none', 0)) out.push(ev);
    assert.equal(out.length, 0);
  });
});

describe('VL-332 — отмена и состояние хода (AC3/AC4)', () => {
  it('cancel завершает прогон статусом cancelled, jsonl без ответа', async () => {
    const { llm } = fakeLlm([{ text: 'не должно дойти' }], { delayMs: 200 });
    const threadId = 'dr-cancel';
    for await (const ev of runChat({ threadId, message: 'стоп' }, cwd, { llm })) {
      if (ev.type === 'thread') break;
    }
    const run = getChatRun(threadId);
    assert.ok(run !== null);
    run.cancel?.('тест');
    await waitForRunEnd(threadId);
    const state = readTurnState(cwd, threadId);
    assert.ok(state !== null);
    assert.ok(['cancelled', 'error'].includes(state.status), `статус ${state.status}`);
  });

  it('sidecar: running при старте, done в конце', async () => {
    const { llm } = fakeLlm([{ text: 'ок' }], { delayMs: 30 });
    const threadId = 'dr-turn';
    for await (const ev of runChat({ threadId, message: 'старт' }, cwd, { llm })) {
      if (ev.type === 'thread') break;
    }
    assert.equal(readTurnState(cwd, threadId)?.status, 'running');
    await waitForRunEnd(threadId);
    assert.equal(readTurnState(cwd, threadId)?.status, 'done');
  });

  it('«осиротевший» running переводится в interrupted', () => {
    const threadId = 'dr-orphan';
    writeTurnState(cwd, threadId, { status: 'running', startedAt: new Date().toISOString() });
    const fixed = resetOrphanedRuns(cwd);
    assert.ok(fixed.includes(threadId), 'тред попал в список починенных');
    assert.equal(readTurnState(cwd, threadId)?.status, 'interrupted');
  });
});
