/**
 * Тесты VL-313: расход треда в SSE-потоке чата и в GET истории.
 *
 * Проверяется контракт стыков:
 * - после каждого вызова модели в поток приходит событие `usage` с уже
 *   посчитанными суммами/рублями/процентом (AC1 — панель без перезагрузки);
 * - `GET /api/chat/threads/:id` отдаёт `usage` — панель восстанавливает те же
 *   цифры после reload (AC2);
 * - практический смысл пика: три хода по «широкому» промпту не дают 100%,
 *   хотя сумма input давно превысила окно (AC3).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat } from '../../dist/web/chat.js';
import { handleApi } from '../../dist/web/api.js';
import { zeroUsage } from '../../dist/agent/llm.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-usage-sse-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Chat Usage Test',
      task_prefix: 'cu',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
  // Модель с окном 100k и тарифом: 100 ₽ / 200 ₽ / 10 ₽ за 1M
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    `${JSON.stringify(
      {
        providers: { p: { base_url: 'https://e.example/v1', api_key: 'test-key' } },
        models: {
          default: 'p/m',
          available: {
            'p/m': {
              label: 'Test model',
              provider: 'p',
              model: 'm',
              context_window: 100_000,
              pricing: { input_per_1m: 100, output_per_1m: 200, cache_per_1m: 10 },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Фейковый LLM: каждый вызов отдаёт заданный usage. */
function fakeLlm(script) {
  const state = { calls: 0 };
  const llm = {
    async streamChat() {
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      return {
        text: step.text ?? 'ответ',
        toolCalls: step.toolCalls ?? [],
        usage: { ...zeroUsage(), ...step.usage },
      };
    },
  };
  return { llm, state };
}

async function collect(body, deps) {
  const events = [];
  for await (const ev of runChat(body, cwd, deps)) events.push(ev);
  return events;
}

describe('VL-313: SSE-событие usage', () => {
  it('после ответа модели приходит usage с токенами, рублями и процентом (AC1)', async () => {
    const { llm } = fakeLlm([
      {
        usage: { input_tokens: 20_000, output_tokens: 1_000, cache_read_input_tokens: 0, total_tokens: 21_000 },
      },
    ]);
    const events = await collect({ message: 'привет', threadId: 'u-sse-1' }, { llm });

    const usageEvents = events.filter(e => e.type === 'usage');
    assert.equal(usageEvents.length, 1, 'одно событие на вызов модели');
    const view = usageEvents[0].usage;
    assert.equal(view.input, 20_000);
    assert.equal(view.output, 1_000);
    assert.equal(view.requests, 1);
    assert.equal(view.modelId, 'p/m');
    assert.equal(view.contextWindow, 100_000);
    assert.equal(view.percent, 20);
    // 20000/1e6*100 + 1000/1e6*200 = 2 + 0.2
    assert.equal(view.cost.total, 2.2);
    // usage — метаданные треда, а не часть ответа: text/done не изменились
    assert.equal(events.at(-1).type, 'done');
  });

  it('usage приходит на КАЖДОМ вызове модели (tool-ход = два запроса)', async () => {
    const { llm } = fakeLlm([
      { usage: { input_tokens: 10_000, output_tokens: 100 }, toolCalls: [
        { id: 'tc-1', name: 'backlog_search', arguments: { query: 'тест' } },
      ] },
      { text: 'готово', usage: { input_tokens: 12_000, output_tokens: 200 } },
    ]);
    const events = await collect({ message: 'найди', threadId: 'u-sse-2' }, { llm });
    const usageEvents = events.filter(e => e.type === 'usage');
    assert.equal(usageEvents.length, 2);
    const last = usageEvents.at(-1).usage;
    assert.equal(last.requests, 2);
    assert.equal(last.input, 22_000);
    // пик — по последнему (широкому) запросу, не сумма
    assert.equal(last.peakContext, 12_000);
    assert.equal(last.percent, 12);
  });

  it('пик, а не сумма: три хода по 60k при окне 100k дают 60%', async () => {
    const { llm } = fakeLlm([
      { usage: { input_tokens: 60_000, output_tokens: 100 } },
    ]);
    await collect({ message: 'ход 1', threadId: 'u-sse-3' }, { llm });
    await collect({ message: 'ход 2', threadId: 'u-sse-3' }, { llm });
    const events = await collect({ message: 'ход 3', threadId: 'u-sse-3' }, { llm });

    const view = events.filter(e => e.type === 'usage').at(-1).usage;
    assert.equal(view.input, 180_000, 'кумулятивная сумма input — 180k');
    assert.equal(view.peakContext, 60_000, 'занятый контекст — пик одного запроса');
    assert.equal(view.percent, 60, 'сумма дала бы 100% на втором ходу (AC3)');
  });
});

describe('VL-313: usage в GET /api/chat/threads/:id', () => {
  it('после хода история отдаёт те же цифры (AC2)', async () => {
    const { llm } = fakeLlm([
      { usage: { input_tokens: 30_000, output_tokens: 500, cache_read_input_tokens: 0 } },
    ]);
    const events = await collect({ message: 'вопрос', threadId: 'u-api-1' }, { llm });
    const fromSse = events.filter(e => e.type === 'usage').at(-1).usage;

    const res = handleApi('GET', '/api/chat/threads/u-api-1', null, cwd, '');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.usage, fromSse, 'reload показывает те же цифры');
  });

  it('тред без учёта (старый jsonl) отдаёт usage: null — панели нет (AC7)', () => {
    const dir = join(cwd, '.vibelog', 'chat-sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'u-api-old.jsonl'),
      `${JSON.stringify({ role: 'user', content: 'старое' })}\n`,
      'utf8',
    );
    const res = handleApi('GET', '/api/chat/threads/u-api-old', null, cwd, '');
    assert.equal(res.status, 200);
    assert.equal(res.body.usage, null);
  });
});
