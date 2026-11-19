/**
 * Тесты VL-431 — поздний interbot-ответ в веб-чат.
 *
 * - interbotThreadArgs: серверная подстановка thread_id/tool_call_id (AC1);
 * - appendLateInterbotPair: структура виртуальной пары assistant(tool_calls
 *   async-<id> interbot_ask) → tool(content), закрытие pending-хвоста,
 *   отказ для несуществующего треда/пустого id (AC3, lesson-74);
 * - провайдер-валидация: sanitizeWireMessages пропускает дописанную пару;
 * - thread.tsx: фоновый refetch ≤5 с с очисткой (AC4).
 *
 * Каталоги — только mkdtemp (VL-241), env — clearPhaseEnv на уровне файла
 * (lesson-254).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearPhaseEnv } from '../test-env.mjs';
import {
  interbotThreadArgs,
  appendLateInterbotPair,
  loadChatHistory,
} from '../../dist/web/chat.js';
import { sanitizeWireMessages } from '../../dist/agent/llm.js';

const roots = [];
let restoreEnv;

function root() {
  const d = mkdtempSync(join(tmpdir(), 'vibelog-late-interbot-'));
  roots.push(d);
  return d;
}

beforeAll(() => {
  restoreEnv = clearPhaseEnv();
});

afterAll(() => {
  restoreEnv?.();
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

/** Файл истории треда. */
function threadFile(cwd, threadId) {
  return join(cwd, '.vibelog', 'chat-sessions', `${threadId}.jsonl`);
}

/** Создаёт тред с одной user-строкой (getChatThread требует существования файла). */
function seedThread(cwd, threadId, messages = [{ role: 'user', content: 'привет' }]) {
  const dir = join(cwd, '.vibelog', 'chat-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    threadFile(cwd, threadId),
    messages.map((m) => JSON.stringify(m)).join('\n') + '\n',
    'utf8',
  );
}

describe('VL-431: interbotThreadArgs — серверная подстановка (AC1)', () => {
  it('interbot_ask → thread_id + tool_call_id; чужие имена не трогаются', () => {
    const args = { question: 'привет', channel: 'g1' };
    const injected = interbotThreadArgs('interbot_ask', args, 'chat-1', 'call_9');
    assert.equal(injected.thread_id, 'chat-1');
    assert.equal(injected.tool_call_id, 'call_9');
    // исходный объект не мутируется (guard'ам нужны args модели как есть)
    assert.deepEqual(args, { question: 'привет', channel: 'g1' });
    // схема не меняется: исходные поля сохранены
    assert.equal(injected.question, 'привет');
    assert.equal(injected.channel, 'g1');

    const other = interbotThreadArgs('read_file', args, 'chat-1', 'call_9');
    assert.equal(other, args, 'без interbot_ask args возвращаются как есть');
  });

  it('без toolCallId → только thread_id; пустой threadId → args как есть', () => {
    const args = { question: 'x' };
    const onlyThread = interbotThreadArgs('interbot_ask', args, 'chat-1');
    assert.equal(onlyThread.thread_id, 'chat-1');
    assert.ok(!('tool_call_id' in onlyThread), 'tool_call_id не добавляется пустым');
    // пустой toolCallId тоже не добавляется (иначе контекст тикета — '')
    const emptyCall = interbotThreadArgs('interbot_ask', args, 'chat-1', '');
    assert.ok(!('tool_call_id' in emptyCall));

    const noThread = interbotThreadArgs('interbot_ask', args, '', 'call_1');
    assert.equal(noThread, args, 'без threadId подстановки нет');
  });
});

describe('VL-431: appendLateInterbotPair — структура дописки (AC3)', () => {
  it('пара assistant(tool_calls async-<id>) → tool(tool_call_id, content)', () => {
    const cwd = root();
    seedThread(cwd, 'chat-a');
    const ok = appendLateInterbotPair(cwd, 'chat-a', 'ask-123-x', 'поздний ответ');
    assert.equal(ok, true);

    const history = loadChatHistory(cwd, 'chat-a');
    assert.equal(history.length, 3, 'user + assistant + tool');
    const pair = history.slice(-2);
    assert.equal(pair[0].role, 'assistant');
    assert.equal(pair[0].content, null);
    assert.equal(pair[0].tool_calls.length, 1);
    const tc = pair[0].tool_calls[0];
    assert.equal(tc.id, 'async-ask-123-x', 'id = async-<ticketId>, старые id не переиспользуются');
    assert.equal(tc.name, 'interbot_ask');
    assert.deepEqual(tc.arguments, {});
    assert.equal(pair[1].role, 'tool');
    assert.equal(pair[1].tool_call_id, 'async-ask-123-x', 'парность assistant→tool по id');
    assert.equal(pair[1].content, 'поздний ответ');
  });

  it('пара валидна для провайдера: sanitizeWireMessages не вырезает ничего', () => {
    const cwd = root();
    seedThread(cwd, 'chat-b');
    appendLateInterbotPair(cwd, 'chat-b', 'ask-b', 'ответ');
    const history = loadChatHistory(cwd, 'chat-b');
    const wire = sanitizeWireMessages(history);
    assert.equal(wire.length, history.length, 'санация не дропает валидную пару');
    assert.equal(wire.at(-2).role, 'assistant');
    assert.equal(wire.at(-1).role, 'tool');
  });

  it('pending-хвост (approval-пауза) закрывается синтетикой ДО дописки', () => {
    const cwd = root();
    seedThread(cwd, 'chat-c', [
      { role: 'user', content: 'сделай' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-pending', name: 'backlog_create_task', arguments: { title: 'x' } }],
      },
    ]);
    assert.equal(appendLateInterbotPair(cwd, 'chat-c', 'ask-c', 'ответ'), true);
    const history = loadChatHistory(cwd, 'chat-c');
    // хвост: синтетический tool(call-pending) → пара async-ask-c
    const tail = history.slice(-3);
    assert.equal(tail[0].role, 'tool');
    assert.equal(tail[0].tool_call_id, 'call-pending', 'висящий вызов закрыт синтетикой');
    assert.equal(tail[1].role, 'assistant');
    assert.equal(tail[2].role, 'tool');
    // провайдер-валидация и здесь: парность полной истории
    assert.equal(sanitizeWireMessages(history).length, history.length);
  });

  it('несуществующий/невалидный тред и пустой ticketId → false, файл не тронут', () => {
    const cwd = root();
    assert.equal(appendLateInterbotPair(cwd, 'no-such-thread', 'ask-x', 'ответ'), false);
    assert.equal(existsSync(threadFile(cwd, 'no-such-thread')), false, 'файл не создан');
    assert.equal(appendLateInterbotPair(cwd, '../etc', 'ask-x', 'ответ'), false);
    // пустой id (lesson-74: валидация id до записи) — тред существует, но не дописываем
    seedThread(cwd, 'chat-d');
    assert.equal(appendLateInterbotPair(cwd, 'chat-d', '  ', 'ответ'), false);
    const lines = readFileSync(threadFile(cwd, 'chat-d'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'jsonl не изменился');
  });
});

describe('VL-431: thread.tsx — фоновый refetch (AC4)', () => {
  it('эффект refetch: интервал 5000 мс, очистка clearInterval, пропуск при стриме', () => {
    const src = readFileSync(
      new URL('../../web/src/components/chat/thread.tsx', import.meta.url),
      'utf8',
    );
    assert.match(src, /фоновый refetch истории/, 'комментарий VL-431 на месте');
    assert.match(src, /\}, 5000\)/, 'интервал ≤5 с (ровно 5000)');
    const cleanupIdx = src.indexOf('фоновый refetch истории');
    assert.ok(cleanupIdx > 0);
    // в блоке cleanup эффекта есть clearInterval (стоп при unmount/уходе)
    // VL-439: база refetch-а — serverCount (серверская длина): клиентская
    // load.messages.length всегда меньше (tool-слияние) → вечный «рост»
    const effectEnd = src.indexOf('}, [load.status, load.runtimeThreadId, load.serverCount', cleanupIdx);
    assert.ok(effectEnd > cleanupIdx, 'эффект завершается deps-массивом');
    const effectBody = src.slice(cleanupIdx, effectEnd);
    assert.match(effectBody, /clearInterval\(timer\)/, 'очистка при unmount');
    assert.match(effectBody, /runtimeRunning\) return/, 'локальный стрим не дёргает refetch');
    assert.match(effectBody, /const baseCount = load\.serverCount/, 'база — серверская длина истории');
    assert.doesNotMatch(effectBody, /const baseCount = load\.messages\.length/, 'не клиентская длина (VL-439)');
  });
});
