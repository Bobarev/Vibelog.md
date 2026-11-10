/**
 * Тесты VL-406 — исход хода веб-чата называется явно, а не теряется молча.
 *
 * Симптом: ход завершился, индикатор погас, ответа в jsonl нет, ошибки нет —
 * «ничего не происходит даже после перезагрузки». Причины: (1) пустой ответ
 * модели завершался статусом `done`, неотличимым от «ничего не было»;
 * (2) зависший `running` (продюсер умер, не записав финал) не лечился в живом
 * процессе — только при рестарте сервера.
 *
 * Проверяем:
 * - пустой ответ модели → `turn.json` со статусом `empty` и причиной (AC6);
 * - ход с tool-вызовами без текста → `done`, а не `empty` (ложное срабатывание);
 * - ошибка провайдера → `error` с текстом (AC2);
 * - зависший `running` → `interrupted` «ход не отвечает» по порогу (AC4);
 * - живой прогон сторож не трогает;
 * - `retry: true` повторяет ход без дубля user-сообщения в jsonl (AC3).
 *
 * Каталог — mkdtemp (правило AGENTS.md, lesson-89).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat, loadChatHistory, chatTurnState } from '../../dist/web/chat.js';
import {
  clearChatRuns,
  createChatRun,
  getChatRun,
  readTurnState,
  reapStaleChatRuns,
  STALE_RUN_ERROR,
  writeTurnState,
} from '../../dist/web/chat-runs.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-turn-outcome-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Turn Outcome Test',
      task_prefix: 'to',
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
      if (opts.delayMs) await new Promise(resolve => setTimeout(resolve, opts.delayMs));
      const tokens = step.tokens ?? (step.text ? step.text.split(/(?<=\s)/) : []);
      for (const t of tokens) callOpts?.onToken?.(t);
      if (step.throwError) throw new Error(step.throwError);
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

describe('VL-406 — пустой ответ модели (AC1/AC6)', () => {
  it('ход без текста и без tool-вызовов получает статус empty с причиной', async () => {
    const { llm } = fakeLlm([{ text: '' }]);
    const threadId = 'to-empty';
    for await (const ev of runChat({ threadId, message: 'привет' }, cwd, { llm })) {
      if (ev.type === 'thread') break;
    }
    await waitForRunEnd(threadId);

    const state = readTurnState(cwd, threadId);
    assert.ok(state !== null, 'sidecar записан');
    assert.equal(state.status, 'empty', 'пустой ответ — явный статус, а не молчаливый done');
    assert.match(state.error ?? '', /пустой ответ/, 'причина названа');

    // В jsonl только user-сообщение: assistant-строки нет — именно поэтому
    // раньше ход выглядел как «ничего не произошло».
    const history = loadChatHistory(cwd, threadId);
    assert.equal(history.filter(m => m.role === 'assistant').length, 0);
  });

  it('ход с tool-вызовами без текста — done, а не empty (нет ложного срабатывания)', async () => {
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'backlog_search', arguments: { query: 'x' } }] },
      { text: 'готово' },
    ]);
    const threadId = 'to-tools';
    for await (const ev of runChat({ threadId, message: 'найди' }, cwd, { llm })) {
      if (ev.type === 'thread') break;
    }
    await waitForRunEnd(threadId);
    assert.equal(readTurnState(cwd, threadId)?.status, 'done');
  });

  it('ошибка провайдера — статус error с текстом (AC2)', async () => {
    const { llm } = fakeLlm([{ throwError: 'провайдер недоступен' }]);
    const threadId = 'to-error';
    for await (const ev of runChat({ threadId, message: 'привет' }, cwd, { llm })) {
      if (ev.type === 'thread') break;
    }
    await waitForRunEnd(threadId);
    const state = readTurnState(cwd, threadId);
    assert.equal(state?.status, 'error');
    assert.match(state?.error ?? '', /провайдер недоступен/);
  });
});

describe('VL-406 — сторож зависших прогонов (AC4)', () => {
  it('running со старым lastEventAt переводится в interrupted «ход не отвечает»', () => {
    const threadId = 'to-stale';
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    writeTurnState(cwd, threadId, { status: 'running', startedAt: old, lastEventAt: old });

    const reaped = reapStaleChatRuns(cwd);
    assert.ok(reaped.includes(threadId), 'тред попал в список починенных');
    const state = readTurnState(cwd, threadId);
    assert.equal(state?.status, 'interrupted');
    assert.equal(state?.error, STALE_RUN_ERROR);
  });

  it('свежий running сторож не трогает', () => {
    const threadId = 'to-fresh';
    writeTurnState(cwd, threadId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
    });
    const reaped = reapStaleChatRuns(cwd);
    assert.ok(!reaped.includes(threadId), 'живой ход не прерван');
    assert.equal(readTurnState(cwd, threadId)?.status, 'running');
  });

  it('живой прогон в реестре со свежими событиями не прерывается', () => {
    const threadId = 'to-live';
    const run = createChatRun(threadId, cwd);
    const reaped = reapStaleChatRuns(cwd);
    assert.ok(!reaped.includes(threadId));
    assert.equal(run.status, 'running');
  });

  it('chatTurnState (ленивая проверка при чтении) лечит зависший running', () => {
    const threadId = 'to-lazy';
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    writeTurnState(cwd, threadId, { status: 'running', startedAt: old, lastEventAt: old });
    const state = chatTurnState(cwd, threadId);
    assert.equal(state?.status, 'interrupted');
    assert.equal(state?.error, STALE_RUN_ERROR);
  });

  it('порог настраивается: с большим maxIdleMs ход остаётся running', () => {
    const threadId = 'to-threshold';
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    writeTurnState(cwd, threadId, { status: 'running', startedAt: old, lastEventAt: old });
    const reaped = reapStaleChatRuns(cwd, 60 * 60_000);
    assert.ok(!reaped.includes(threadId));
  });
});

describe('VL-406 — повтор хода без дубля user-сообщения (AC3)', () => {
  it('retry: true повторяет ход по накопленной истории, jsonl без дубля', async () => {
    // Первый ход — пустой ответ (assistant-строки нет).
    const first = fakeLlm([{ text: '' }]);
    const threadId = 'to-retry';
    for await (const ev of runChat({ threadId, message: 'вопрос' }, cwd, { llm: first.llm })) {
      if (ev.type === 'thread') break;
    }
    await waitForRunEnd(threadId);
    assert.equal(readTurnState(cwd, threadId)?.status, 'empty');
    const before = loadChatHistory(cwd, threadId);
    assert.equal(before.filter(m => m.role === 'user').length, 1);

    // Повтор: тот же путь, что у кнопки «Повторить» (retry: true).
    const second = fakeLlm([{ text: 'теперь ответ' }]);
    for await (const ev of runChat({ threadId, retry: true }, cwd, { llm: second.llm })) {
      if (ev.type === 'thread') break;
    }
    await waitForRunEnd(threadId);

    const after = loadChatHistory(cwd, threadId);
    assert.equal(
      after.filter(m => m.role === 'user').length,
      1,
      'повтор не создал второе user-сообщение',
    );
    assert.equal(after.filter(m => m.role === 'assistant').length, 1, 'ответ записан');
    assert.equal(readTurnState(cwd, threadId)?.status, 'done');
  });

  it('retry без истории — понятная ошибка, а не пустой ход', async () => {
    const { llm } = fakeLlm([{ text: 'не должно дойти' }]);
    const events = [];
    for await (const ev of runChat({ threadId: 'to-retry-empty', retry: true }, cwd, { llm })) {
      events.push(ev);
    }
    assert.ok(events.some(ev => ev.type === 'error' && /Нечего продолжать/.test(ev.message)));
  });
});
