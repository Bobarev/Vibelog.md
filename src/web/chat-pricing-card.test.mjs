/**
 * Тесты VL-334 — кнопка «Продолжить» в карточке дрейфа цены и опция
 * «Продолжить и обновить тариф».
 *
 * Баг: карточка рендерилась без пропа `onContinue`, поэтому решение
 * (`setPricingDecision`) записывалось, а нового POST хода не было — ход
 * «зависал» до повторной отправки сообщения вручную.
 *
 * Проверяем две вещи:
 * 1. Поведение чистого модуля `web/src/lib/price-refresh.ts` (порядок
 *    refresh → решение → перезапуск, отказ при ошибке каталога) — `fetchFn`
 *    инъектируется, реальной сети нет;
 * 2. Статический контракт исходников: `onContinue` реально проброшен в
 *    карточку, третья кнопка живёт только под `kind === "ask"`. Регрессия
 *    здесь — возврат к рендеру без `onContinue`, а не поведение JS.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refreshCatalogPricing, refreshThenContinue } from '../../web/src/lib/price-refresh.ts';

const here = dirname(fileURLToPath(import.meta.url));
const chatDir = join(here, '../../web/src/components/chat');
const threadSrc = readFileSync(join(chatDir, 'thread.tsx'), 'utf8');
const cardSrc = readFileSync(join(chatDir, 'pricing-drift-card.tsx'), 'utf8');

/** fetch-заглушка: пишет вызовы в журнал и отдаёт заданный ответ. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url} ${String(init?.body ?? '')}`);
    if (reply.throws !== undefined) throw new Error(reply.throws);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  };
  return { fn: fn, calls };
}

describe('refreshCatalogPricing — обновление тарифа из каталога', () => {
  it('POST /api/pricing/refresh с id модели', async () => {
    const { fn, calls } = fakeFetch({ body: { modelId: 'gateway/model' } });
    const result = await refreshCatalogPricing('gateway/model', fn);
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^POST \/api\/pricing\/refresh /);
    assert.deepEqual(JSON.parse(calls[0].split(' ').slice(2).join(' ')), { id: 'gateway/model' });
  });

  it('ошибка сервера отдаёт текст из {error}', async () => {
    const { fn } = fakeFetch({ status: 404, body: { error: 'Модель "x" отсутствует в models.available' } });
    const result = await refreshCatalogPricing('x', fn);
    assert.equal(result.ok, false);
    assert.match(result.error, /отсутствует в models\.available/);
  });

  it('не-JSON тело ошибки не роняет карточку', async () => {
    const fn = async () => new Response('', { status: 503 });
    const result = await refreshCatalogPricing('x', fn);
    assert.deepEqual(result, { ok: false, error: 'Сервер ответил 503' });
  });

  it('сетевой сбой (офлайн) — понятная ошибка, без исключения', async () => {
    const { fn } = fakeFetch({ throws: 'Failed to fetch' });
    const result = await refreshCatalogPricing('x', fn);
    assert.equal(result.ok, false);
    assert.match(result.error, /Каталог недоступен: Failed to fetch/);
  });
});

describe('refreshThenContinue — refresh → решение → перезапуск', () => {
  it('при успехе порядок именно такой: refresh, decide, continueRun', async () => {
    const order = [];
    const fn = async () => {
      order.push('refresh');
      return new Response('{}', { status: 200 });
    };
    const result = await refreshThenContinue({
      modelId: 'gateway/model',
      decide: () => order.push('decide'),
      continueRun: () => order.push('continue'),
      fetchFn: fn,
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(order, ['refresh', 'decide', 'continue']);
  });

  it('ошибка refresh: ни decide, ни перезапуска (AC4)', async () => {
    const order = [];
    const { fn } = fakeFetch({ status: 400, body: { error: 'Каталог не отдал тариф' } });
    const result = await refreshThenContinue({
      modelId: 'gateway/model',
      decide: () => order.push('decide'),
      continueRun: () => order.push('continue'),
      fetchFn: fn,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Каталог не отдал тариф/);
    assert.deepEqual(order, [], 'ход не продолжается и решение не фиксируется');
  });

  it('сетевой сбой refresh: ход тоже не продолжается', async () => {
    const order = [];
    const { fn } = fakeFetch({ throws: 'offline' });
    const result = await refreshThenContinue({
      modelId: 'gateway/model',
      decide: () => order.push('decide'),
      continueRun: () => order.push('continue'),
      fetchFn: fn,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(order, []);
  });
});

describe('статический контракт карточки (AC1, AC2, AC5, AC7)', () => {
  it('thread.tsx пробрасывает onContinue — регресс «кнопка ничего не делает»', () => {
    assert.match(threadSrc, /function PricingPart\(/, 'карточка рендерится из отдельного компонента');
    assert.ok(threadSrc.includes('aui.message.reload()'), 'перезапуск тем же путём, что Reload (VL-269)');
    assert.match(threadSrc, /onContinue=\{onContinue\}/, 'проп передан в карточку');
    assert.ok(threadSrc.includes('<PricingPart part={part} />'), 'ветка CHAT_PRICING_PART использует PricingPart');
  });

  it('карточка фиксирует решение и перезапускает ход', () => {
    assert.ok(cardSrc.includes('setPricingDecision(ack, nextVendor)'), 'решение уходит на сервер');
    assert.ok(cardSrc.includes('onContinue?.()'), 'ход перезапускается');
  });

  it('третья кнопка — только в ask и только при известной модели', () => {
    assert.ok(cardSrc.includes('Продолжить и обновить тариф'), 'кнопка есть');
    assert.ok(cardSrc.includes('refreshThenContinue'), 'использует общий модуль, а не свою копию логики');
    // кнопки живут внутри ветки kind === "ask"
    const askBranch = cardSrc.slice(cardSrc.indexOf('{kind === "ask" ? ('));
    const pos = askBranch.indexOf('Продолжить и обновить тариф');
    assert.ok(pos > 0 && pos < askBranch.indexOf('{done !== null'), 'кнопка внутри блока kind === "ask"');
    assert.ok(cardSrc.includes('{model !== undefined ? ('), 'без id модели кнопка скрыта');
  });

  it('busy блокирует кнопки и ошибка показывается пользователю (AC6, AC4)', () => {
    assert.ok(cardSrc.includes('disabled={busy !== null}'), 'кнопки блокируются на время запроса');
    assert.match(cardSrc, /role="alert"/, 'ошибка refresh видна пользователю');
    assert.ok(cardSrc.includes('setBusy(null)'), 'после ошибки клики снова доступны');
  });
});
