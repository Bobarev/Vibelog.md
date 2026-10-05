/**
 * Тесты VL-86 — чистые функции TUI (src/agent/tui-format.ts).
 * Импорт с dist/ (паттерн проекта); React/Ink в тестах не участвуют —
 * сборка .tsx проверяется pnpm build (tsc не пропустит ошибки JSX).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatToolArgs,
  formatToolCard,
  formatCounters,
  formatDuration,
  formatErrorBlock,
} from '../../dist/agent/tui-format.js';

describe('formatToolArgs (VL-86)', () => {
  it('короткие аргументы — полный JSON без обрезки', () => {
    assert.equal(formatToolArgs({ x: 1 }), '{"x":1}');
  });

  it('длинные аргументы обрезаются до max с «…»', () => {
    const args = { text: 'x'.repeat(500) };
    const out = formatToolArgs(args, 120);
    assert.equal(out.length, 120);
    assert.ok(out.endsWith('…'));
  });

  it('пустые/отсутствующие аргументы — пустая строка', () => {
    assert.equal(formatToolArgs(undefined), '');
    assert.equal(formatToolArgs({}), '{}');
  });

  it('несериализуемые аргументы не роняют форматирование', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    assert.match(formatToolArgs(cyclic), /непредставимые аргументы/);
  });
});

describe('formatToolCard (VL-86)', () => {
  it('pending: иконка ⏳ + имя + аргументы, без длительности', () => {
    const line = formatToolCard({ name: 'read_file', args: { path: 'a.ts' }, status: 'pending' });
    assert.equal(line, '⏳ read_file {"path":"a.ts"}');
  });

  it('ok: ✅ + длительность в мс', () => {
    assert.equal(formatToolCard({ name: 'bash', status: 'ok', durationMs: 1500 }), '✅ bash 1500 мс');
  });

  it('error: ❌ + длительность', () => {
    assert.equal(
      formatToolCard({ name: 'mcp_tool', args: { q: 1 }, status: 'error', durationMs: 42 }),
      '❌ mcp_tool {"q":1} 42 мс',
    );
  });
});

describe('formatDuration/formatCounters (VL-86)', () => {
  it('MM:SS с ведущими нулями', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(65_000), '01:05');
  });

  it('часы — H:MM:SS', () => {
    assert.equal(formatDuration(3_725_000), '1:02:05');
  });

  it('строка счётчиков: ход, токены, время', () => {
    const line = formatCounters({
      turn: 3,
      inputTokens: 100,
      outputTokens: 20,
      cacheTokens: 7,
      elapsedMs: 65_000,
    });
    assert.equal(line, 'ход 3 | in: 100 | out: 20 | cache: 7 | время 01:05');
  });
});

describe('formatErrorBlock (VL-86)', () => {
  it('каждая строка получает префикс «  ✖ »', () => {
    assert.deepEqual(formatErrorBlock(['Ошибка LLM', 'Лимит tool-calls']), [
      '  ✖ Ошибка LLM',
      '  ✖ Лимит tool-calls',
    ]);
  });

  it('пустой список — пустой блок', () => {
    assert.deepEqual(formatErrorBlock([]), []);
  });
});
