/**
 * Тесты VL-258 — обзор JSONL-транскрипта сессии (src/agent/session-outline.ts).
 *
 * Модуль чистый (без fs): фикстуры — массивы сообщений и байты строк.
 * Ключевой кейс из AC5: 5 сообщений, одна строка 50 КБ → обзор из 5 компактных
 * строк, весь вывод укладывается в бюджет 8 КБ.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  OUTLINE_ENTRY_BUDGET_CHARS,
  OUTLINE_SNIPPET_CHARS,
  buildSessionOutline,
  formatBytes,
  formatSessionOutline,
} from '../../dist/agent/session-outline.js';

const PLAN_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза 2: Plan) для задачи VL-9.';
const CODE_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза 3: Code) для задачи VL-9.';

/** Фикстура AC5: 5 сообщений, третье — 50 КБ содержимого. */
function bigFixture() {
  const big = 'x'.repeat(50_000);
  const messages = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: PLAN_PROMPT },
    { role: 'assistant', content: big },
    { role: 'user', content: 'Продолжи с текущего места' },
    { role: 'assistant', content: 'готово' },
  ];
  // Байты строк: system ~40, промпт ~100, гигант ~50 000+
  const lineBytes = messages.map((m) => Buffer.byteLength(JSON.stringify(m), 'utf8'));
  return { messages, lineBytes };
}

describe('buildSessionOutline (VL-258)', () => {
  it('AC5: 5 строк, все в обзоре, сниппеты ≤ 80 символов, вывод ≤ 8 КБ', () => {
    const { messages, lineBytes } = bigFixture();
    const outline = buildSessionOutline({
      messages,
      sessionId: 'agent-test',
      path: '.vibelog/agent-sessions/agent-test.jsonl',
      lineBytes,
    });
    assert.equal(outline.lines, 5);
    assert.equal(outline.entries.length, 5);
    for (const e of outline.entries) {
      assert.ok(e.snippet.length <= OUTLINE_SNIPPET_CHARS, `сниппет строки ${e.line} короткий`);
    }
    // Гигантская строка (3-я) — размер из lineBytes, а не из сниппета
    assert.ok(outline.entries[2].bytes > 50_000);
    assert.equal(outline.maxBytesLine, 3);
    const text = formatSessionOutline(outline);
    assert.ok(
      text.length <= OUTLINE_ENTRY_BUDGET_CHARS,
      `вывод обзора ${text.length} ≤ ${OUTLINE_ENTRY_BUDGET_CHARS}`,
    );
    assert.ok(!text.includes('x'.repeat(200)), 'тело гигантской строки не попало в обзор');
  });

  it('маркеры ранов: промпты фаз и «Продолжи» → секция «Раны»', () => {
    const messages = [
      { role: 'system', content: 's' },
      { role: 'user', content: PLAN_PROMPT },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'Продолжи с текущего места' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: CODE_PROMPT },
      { role: 'assistant', content: 'ok' },
    ];
    const outline = buildSessionOutline({ messages, sessionId: 'agent-r', path: 'p.jsonl' });
    assert.equal(outline.runs.length, 3);
    assert.deepEqual(
      outline.runs.map((r) => [r.index, r.line, r.phase]),
      [
        [1, 2, 'plan'],
        [2, 4, 'resume'],
        [3, 6, 'code'],
      ],
    );
    const text = formatSessionOutline(outline);
    assert.match(text, /Раны: 1 → стр\. 2 \(plan\), 2 → стр\. 4 \(resume\), 3 → стр\. 6 \(code\)/);
    assert.match(text, /ран 3 → code/);
  });

  it('tool_calls: валидные считаются, фантом (пустое имя) — нет', () => {
    const messages = [
      { role: 'user', content: PLAN_PROMPT },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', name: 'read_file', arguments: { path: 'x' } },
          { id: 'b', name: 'edit', arguments: {} },
          { id: 'c', name: 'read_file', arguments: { path: 'y' } },
          { id: '', name: '', arguments: {} },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'exit code: 0' },
    ];
    const outline = buildSessionOutline({ messages, sessionId: 'agent-t', path: 'p.jsonl' });
    const assistant = outline.entries[1];
    assert.equal(assistant.toolCalls, 3);
    assert.deepEqual(assistant.toolNames, ['read_file', 'edit']);
    assert.match(formatSessionOutline(outline), /3 tools \(read_file, edit\)/);
  });

  it('сниппет: многострочный content → одна строка с усечением', () => {
    const messages = [
      { role: 'user', content: 'первая строка\nвторая строка\tтретья' },
    ];
    const outline = buildSessionOutline({ messages, sessionId: 's', path: 'p' });
    assert.equal(outline.entries[0].snippet, 'первая строка вторая строка третья');
    assert.ok(!outline.entries[0].snippet.includes('\n'));
  });

  it('offset/limit применены до бюджета; усечение даёт nextOffset', () => {
    const messages = Array.from({ length: 40 }, (_, i) => ({
      role: 'assistant',
      content: `строка ${i + 1} ${'y'.repeat(100)}`,
    }));
    const outline = buildSessionOutline({
      messages,
      sessionId: 's',
      path: 'p',
      offset: 10,
      limit: 5,
    });
    assert.equal(outline.entries.length, 5);
    assert.equal(outline.entries[0].line, 11);
    assert.equal(outline.truncated, false);
    assert.equal(outline.nextOffset, null);
  });

  it('бюджет режет окно и печатает маркер продолжения', () => {
    const messages = Array.from({ length: 300 }, (_, i) => ({
      role: 'assistant',
      content: `сообщение ${i + 1} ${'z'.repeat(120)}`,
    }));
    const outline = buildSessionOutline({
      messages,
      sessionId: 's',
      path: 'p',
      budget: 2048,
    });
    assert.equal(outline.truncated, true);
    assert.ok(outline.entries.length < 300);
    assert.ok(outline.nextOffset !== null && outline.nextOffset > 0);
    const text = formatSessionOutline(outline);
    assert.ok(text.length <= 2048, 'вывод уложен в бюджет');
    assert.match(text, /обзор усечён.*offset=\d+/);
  });

  it('расхождение lineBytes и messages → warning, размеры пересчитаны', () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    const outline = buildSessionOutline({
      messages,
      sessionId: 's',
      path: 'p',
      lineBytes: [10],
    });
    assert.equal(outline.warnings.length, 1);
    assert.match(outline.warnings[0], /не совпадают/);
    assert.ok(outline.entries[1].bytes > 0);
  });

  it('пустой транскрипт → нули и понятный текст', () => {
    const outline = buildSessionOutline({ messages: [], sessionId: 's', path: 'p' });
    assert.equal(outline.lines, 0);
    assert.equal(outline.runs.length, 0);
    assert.equal(outline.entries.length, 0);
    assert.match(formatSessionOutline(outline), /\(строк в выбранном окне нет\)/);
  });

  it('formatBytes: B / KB / MB', () => {
    assert.equal(formatBytes(312), '312 B');
    assert.equal(formatBytes(1229), '1.2 KB');
    assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  });

  it('схема --json стабильна (kind и ключи)', () => {
    const outline = buildSessionOutline({ messages: [{ role: 'user', content: 'a' }], sessionId: 's', path: 'p' });
    assert.equal(outline.kind, 'session-outline');
    assert.deepEqual(Object.keys(outline).sort(), [
      'entries',
      'kind',
      'lines',
      'maxBytes',
      'maxBytesLine',
      'nextOffset',
      'path',
      'runs',
      'sessionId',
      'truncated',
      'warnings',
    ]);
  });
});
