/**
 * Тесты VL-436 — гейт react|read_only (doc-34 §3.2): парсер, fail-open,
 * таймаут. Сеть не нужна — везде мок-клиент (паттерн judge, VL-240).
 * Каталоги — только mkdtemp (VL-241), env — clearPhaseEnv (lesson-254).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearPhaseEnv } from '../test-env.mjs';
import { buildGatePrompt, parseGateVerdict, runGate } from '../../dist/bot/gate.js';

const roots = [];
let restoreEnv;

function root() {
  const d = mkdtempSync(join(tmpdir(), 'vibelog-gate-'));
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

/** Минимальное входящее для гейта. */
function msg(overrides = {}) {
  return {
    message_id: 10,
    chat_id: -1001,
    text: 'Всем привет!',
    from_id: 500,
    is_bot: false,
    ...overrides,
  };
}

/** Мок-клиент LlmClient: streamChat возвращает фиксированный текст. */
function mockClient(text) {
  return {
    model: 'mock',
    streamChat: async () => ({ text, toolCalls: [], usage: {
      input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, total_tokens: 0,
    } }),
  };
}

describe('VL-436: parseGateVerdict (форма ответа модели)', () => {
  it('читает оба вердикта в разных формах', () => {
    assert.equal(parseGateVerdict('read_only'), 'read_only');
    assert.equal(parseGateVerdict('READ_ONLY\n'), 'read_only');
    assert.equal(parseGateVerdict('read_only.'), 'read_only');
    assert.equal(parseGateVerdict('react'), 'react');
    assert.equal(parseGateVerdict('React.'), 'react');
    assert.equal(parseGateVerdict(' react '), 'react');
  });

  it('мусор/пустота → null (вызывающий трактует как сбой → fail-open)', () => {
    assert.equal(parseGateVerdict(''), null);
    assert.equal(parseGateVerdict('ok'), null);
    assert.equal(parseGateVerdict('вопрос требует анализа'), null);
  });

  it('AC2: нормализация — регистр/обёрточные пробелы/переносы, маркеры в реальном тексте', () => {
    assert.equal(parseGateVerdict('\n  READ_ONLY  \n'), 'read_only');
    assert.equal(parseGateVerdict('Вердикт: read_only.'), 'read_only');
    assert.equal(parseGateVerdict('read_only — так лучше'), 'read_only');
    assert.equal(parseGateVerdict('  React.  '), 'react');
    assert.equal(parseGateVerdict('react\n'), 'react');
  });
});

describe('VL-436 AC1/AC2: runGate — вердикт и fail-open', () => {
  it('ответ модели read_only → read_only (без error)', async () => {
    const r = await runGate(root(), msg(), { client: mockClient('read_only') });
    assert.equal(r.verdict, 'read_only');
    assert.equal(r.error, undefined);
    // VL-437 (AC2): сырой ответ и usage — для trace-диагностики
    assert.equal(r.raw, 'read_only');
    assert.equal(r.usage?.output_tokens, 0);
  });

  it('ответ модели react → react (без error)', async () => {
    const r = await runGate(root(), msg(), { client: mockClient('react') });
    assert.equal(r.verdict, 'react');
    assert.equal(r.error, undefined);
    assert.equal(r.raw, 'react');
  });

  it('AC2: пустой ответ модели → fail-open react + ясная причина «пустой ответ», не «непонятный»', async () => {
    const r = await runGate(root(), msg(), { client: mockClient('   \n  ') });
    assert.equal(r.verdict, 'react');
    assert.match(r.error ?? '', /пустой ответ гейта/);
    assert.doesNotMatch(r.error ?? '', /непонятный/);
    assert.equal(r.raw, '   \n  ', 'сырой ответ сохраняется для trace');
  });

  it('AC2: клиент бросил → fail-open react + error (путь в ран не закрыт)', async () => {
    const client = { model: 'm', streamChat: async () => { throw new Error('сеть легла'); } };
    const r = await runGate(root(), msg(), { client });
    assert.equal(r.verdict, 'react');
    assert.match(r.error ?? '', /сеть легла/);
  });

  it('AC2: таймаут (клиент не отвечает) → fail-open react + error про таймаут', async () => {
    const client = { model: 'm', streamChat: () => new Promise(() => {}) };
    const started = Date.now();
    const r = await runGate(root(), msg(), { client, timeoutMs: 20 });
    assert.equal(r.verdict, 'react');
    assert.match(r.error ?? '', /таймаут/);
    assert.ok(Date.now() - started < 2000, 'таймаут сработал быстро, не завис');
  });

  it('непонятный ответ модели → fail-open react + error парсинга', async () => {
    const r = await runGate(root(), msg(), { client: mockClient('нужно подумать') });
    assert.equal(r.verdict, 'react');
    assert.match(r.error ?? '', /непонятный ответ/);
  });
});

describe('VL-436: buildGatePrompt', () => {
  it('содержит текст сообщения, оба вердикта и автора', () => {
    const p = buildGatePrompt(msg({ text: 'что с релизом?', from_username: 'ui_bot', is_bot: true }));
    assert.ok(p.includes('что с релизом?'), 'текст сообщения в промпте');
    assert.ok(p.includes('read_only') && p.includes('react'), 'оба вердикта названы');
    assert.ok(p.includes('@ui_bot'), 'автор-бот виден');
    assert.ok(p.includes('ТОЛЬКО одно слово'), 'формат ответа строгий');
  });
});
