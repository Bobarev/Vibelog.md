/**
 * Тесты VL-34 — генерация пин-кода привязки.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { generatePin } from '../../dist/bot/pin.js';

describe('generatePin (VL-34)', () => {
  it('возвращает 6-значную цифровую строку', () => {
    for (let i = 0; i < 100; i++) {
      assert.match(generatePin(), /^\d{6}$/);
    }
  });

  it('вариативность: 100 выборок дают больше одного значения', () => {
    const pins = new Set(Array.from({ length: 100 }, generatePin));
    assert.ok(pins.size > 1, `ожидалась вариативность, получено уникальных: ${pins.size}`);
  });
});
