/**
 * Тесты аналитики токенов (VL-198): calculateCost, getPricing,
 * usageDelta/hasUsageDelta, formatTokenUsageLines.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addUsage,
  calculateCost,
  emptyUsage,
  formatTokenUsageLines,
  getPricing,
  hasUsageDelta,
  usageDelta,
} from '../core/analytics.js';

describe('calculateCost (VL-198)', () => {
  const pricing = { input_per_1m: 2, output_per_1m: 10, cache_per_1m: 0.5 };

  it('токены × тариф / 1M, кэш отдельной ставкой', () => {
    const cost = calculateCost({ input: 1_000_000, output: 500_000, cache: 2_000_000, total: 3_500_000, requests: 10 }, pricing);
    expect(cost.input).toBe(2);
    expect(cost.output).toBe(5);
    expect(cost.cache).toBe(1);
    expect(cost.total).toBe(8);
  });

  it('нет тарифа модели → нули (не ошибка)', () => {
    const cost = calculateCost({ input: 1000, output: 100, cache: 0, total: 1100, requests: 1 }, undefined);
    expect(cost).toEqual({ input: 0, output: 0, cache: 0, total: 0 });
  });

  it('малые объёмы — дробная стоимость без ошибок округления', () => {
    const cost = calculateCost({ input: 1000, output: 0, cache: 0, total: 1000, requests: 1 }, pricing);
    // 1000 / 1e6 × 2 = 0.002
    expect(cost.input).toBeCloseTo(0.002, 6);
    expect(cost.total).toBeCloseTo(0.002, 6);
  });
});

describe('getPricing (VL-198)', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vib-analytics-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('секция pricing settings.json → PricingMap', () => {
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(dir, '.vibelog', 'settings.json'),
      JSON.stringify({
        pricing: {
          'mimo-v2.6-pro': { input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 },
        },
      }),
      'utf-8',
    );
    expect(getPricing(dir)).toEqual({
      'mimo-v2.6-pro': { input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 },
    });
  });

  it('нет pricing / битые значения → пусто или нули, без исключений', () => {
    expect(getPricing(dir)).toEqual({});
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(dir, '.vibelog', 'settings.json'),
      JSON.stringify({ pricing: { bad: { input_per_1m: 'нет' }, worse: 42 } }),
      'utf-8',
    );
    expect(getPricing(dir)).toEqual({ bad: { input_per_1m: 0, output_per_1m: 0, cache_per_1m: 0 } });
  });
});

describe('usageDelta / hasUsageDelta (VL-198)', () => {
  it('дельта поэлементная с ограничением снизу нулём', () => {
    const d = usageDelta({ input: 100, total: 50 }, { input: 150, output: 10, cache: 0, total: 80, requests: 2 });
    expect(d.input).toBe(50);
    expect(d.output).toBe(10);
    expect(d.total).toBe(30);
    expect(d.requests).toBe(2);
    // base больше current — не уходит в минус (защита от двойного вычитания)
    expect(usageDelta({ input: 500 }, { input: 100, output: 0, cache: 0, total: 0, requests: 0 }).input).toBe(0);
  });

  it('hasUsageDelta: нулевая дельта → false', () => {
    expect(hasUsageDelta(usageDelta({ input: 10 }, { input: 10, output: 0, cache: 0, total: 0, requests: 0 }))).toBe(false);
    expect(hasUsageDelta({ input: 1 })).toBe(true);
    expect(hasUsageDelta({})).toBe(false);
  });

  it('addUsage мутирует target, пустой usage — нули', () => {
    const t = emptyUsage();
    addUsage(t, { input: 5, requests: 1 });
    addUsage(t, { input: 5, reasoning: 3 });
    expect(t.input).toBe(10);
    expect(t.requests).toBe(1);
    expect(t.reasoning).toBe(3);
    expect(emptyUsage()).toEqual({ input: 0, output: 0, cache: 0, total: 0, requests: 0 });
  });
});

describe('formatTokenUsageLines (VL-198)', () => {
  it('пустой/нулевой usage → [] (секция не показывается)', () => {
    expect(formatTokenUsageLines(undefined)).toEqual([]);
    expect(formatTokenUsageLines({ input: 0, output: 0, cache: 0, total: 0, requests: 0 })).toEqual([]);
  });

  it('строка totals + duration при >0', () => {
    const lines = formatTokenUsageLines({ input: 10, output: 5, cache: 2, total: 17, requests: 3 }, 65_000);
    expect(lines[0]).toContain('input=10 output=5 cache=2 total=17 requests=3');
    expect(lines[1]).toContain('65с');
  });
});
