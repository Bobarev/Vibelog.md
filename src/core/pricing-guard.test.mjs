/**
 * Тесты сверки цены вендора с каталогом и политики дрейфа (VL-317).
 *
 * Покрывают AC14: расчёт дрейфа (граница ровно порог, выше/ниже, нулевой
 * тариф — деление на ноль), все три режима on_drift, деградация auto→ask без
 * альтернативы, offline-поведение (allow/block), кэш/TTL сверки, сверка по
 * паре (gateway, model, vendor) а не по модели вообще, терпимый парсинг
 * секции pricing_guard.
 *
 * Сеть не используется: fetch инжектируется (guard VL-132 в
 * src/test-setup.mjs отклоняет не-loopback запросы); кэш каталога VL-316
 * можно наполнить прямо файлом.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolvePricingGuard,
  formatPricingGuardErrors,
  driftPercent,
  checkPricingDrift,
  checkPricingDriftCached,
  decideDriftPolicy,
  formatDriftMessage,
  refreshModelPricing,
  readAcceptedDrift,
  acceptDrift,
  isDriftAccepted,
  clearPricingGuardCache,
  PRICING_GUARD_DEFAULT,
  PRICING_GUARD_KEYS,
} from '../../dist/core/pricing-guard.js';
import { catalogCachePath } from '../../dist/core/provider-catalog.js';
import { handleCatalogApi } from '../../dist/web/catalog-api.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-pricing-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  clearPricingGuardCache();
});

/**
 * settings.json с одной моделью. Тариф по умолчанию — 10/20/0 (₽ за 1M).
 * `extra` мержится на верхний уровень (секция pricing_guard и т.п.).
 */
function writeSettings({ pricing = { input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }, vendor = 'makora', model = 'xiaomi/mimo-v2.6', extra = {}, modelExtra = {} } = {}) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  // vendor: null — «вендор не задан» (default-параметр сработал бы на undefined)
  const record = {
    label: 'test',
    gateway: 'routerai',
    model,
    pricing,
    ...(vendor !== null ? { vendor } : {}),
    ...modelExtra,
  };
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    `${JSON.stringify(
      {
        gateways: { routerai: { base_url: 'https://routerai.example/api/v1' } },
        models: {
          default: 'routerai/xiaomi/mimo-v2.6/@makora',
          available: { [`routerai/xiaomi/mimo-v2.6/@makora`]: record },
        },
        ...extra,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );
}

/** Наполняет кэш каталога VL-316 вендорами модели (без сети). */
function writeVendorCache(vendors, { fetchedAt = new Date().toISOString(), model = 'xiaomi/mimo-v2.6' } = {}) {
  const path = catalogCachePath(cwd);
  mkdirSync(join(cwd, '.vibelog', 'cache'), { recursive: true });
  const entry = {
    fetchedAt,
    models: [],
    vendors: {
      [model]: vendors.map((v) => ({
        id: v.id,
        name: v.name ?? v.id,
        pricing: {
          input_per_1m: v.input_per_1m,
          output_per_1m: v.output_per_1m,
          cache_per_1m: v.cache_per_1m ?? 0,
        },
        unsupportedUnits: [],
      })),
    },
  };
  writeFileSync(
    path,
    `${JSON.stringify({ version: 1, entries: { [`routerai:vendors:${model}`]: entry } }, null, 2)}\n`,
    'utf-8',
  );
}

/** Ответ fetch для /endpoints: вендоры с ценами в формате каталога RouterAI. */
function endpointsPayload(vendors) {
  return {
    data: {
      endpoints: vendors.map((v) => ({
        tag: v.id,
        provider_name: v.name ?? v.id,
        pricing: {
          prompt: v.input_per_1m / 1e6,
          completion: v.output_per_1m / 1e6,
          input_cache_read: (v.cache_per_1m ?? 0) / 1e6,
        },
        pricing_units: { prompt: 'token', completion: 'token', input_cache_read: 'token' },
      })),
    },
  };
}

/** fetch, отвечающий на /endpoints заданным payload; считает вызовы. */
function fakeFetch(payload) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/endpoints')) {
      if (payload instanceof Error) throw payload;
      return { ok: true, status: 200, json: async () => payload };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

// ── Секция настроек (AC1/AC2) ──

describe('resolvePricingGuard', () => {
  it('без секции — все дефолты и ни одной ошибки', () => {
    writeSettings();
    const { config, errors } = resolvePricingGuard(cwd);
    assert.deepEqual(config, PRICING_GUARD_DEFAULT);
    assert.equal(errors.length, 0);
    // AC1: значения по умолчанию
    assert.equal(config.enabled, true);
    assert.equal(config.thresholdPercent, 10);
    assert.equal(config.onDrift, 'ask');
    assert.equal(config.offline, 'allow');
    assert.ok(config.catalogTtlMinutes >= 15);
  });

  it('валидная секция читается целиком', () => {
    writeSettings({
      extra: {
        pricing_guard: {
          enabled: false,
          threshold_percent: 25,
          on_drift: 'auto',
          catalog_ttl_minutes: 30,
          offline: 'block',
        },
      },
    });
    const { config, errors } = resolvePricingGuard(cwd);
    assert.deepEqual(errors, []);
    assert.deepEqual(config, {
      enabled: false,
      thresholdPercent: 25,
      onDrift: 'auto',
      catalogTtlMinutes: 30,
      offline: 'block',
    });
  });

  it('битые значения → дефолты + понятные сообщения, без падения (AC2)', () => {
    writeSettings({
      extra: {
        pricing_guard: {
          enabled: 'да',
          threshold_percent: -1,
          on_drift: 'sometimes',
          catalog_ttl_minutes: 'часто',
          offline: 'maybe',
        },
      },
    });
    const { config, errors } = resolvePricingGuard(cwd);
    assert.deepEqual(config, PRICING_GUARD_DEFAULT);
    assert.equal(errors.length, PRICING_GUARD_KEYS.length);
    for (const error of errors) assert.match(error, /^pricing_guard\./);
    assert.match(formatPricingGuardErrors(errors), /взяты дефолты/);
  });

  it('секция не объект — дефолты + одна ошибка', () => {
    writeSettings({ extra: { pricing_guard: 'on' } });
    const { config, errors } = resolvePricingGuard(cwd);
    assert.deepEqual(config, PRICING_GUARD_DEFAULT);
    assert.equal(errors.length, 1);
  });
});

// ── Расчёт отклонения (AC14: граница, нулевой тариф) ──

describe('driftPercent', () => {
  it('обычный рост и снижение', () => {
    assert.equal(driftPercent(10, 11), 10);
    assert.equal(driftPercent(10, 9), -10);
    assert.equal(driftPercent(10, 10), 0);
  });

  it('нулевой тариф не делит на ноль (риск R5)', () => {
    // оба нуля — дрейфа нет (бесплатный кэш у обоих)
    assert.equal(driftPercent(0, 0), 0);
    // было 0 → стало >0: бесконечный рост, но БЕЗ NaN/Infinity-арифметики
    assert.equal(driftPercent(0, 5), Number.POSITIVE_INFINITY);
    assert.match(formatDriftMessage({
      state: 'drift',
      components: [{ name: 'cache', was: 0, now: 5, deltaPercent: Number.POSITIVE_INFINITY }],
      maxDeltaPercent: Number.POSITIVE_INFINITY,
      direction: 'increased',
      checkedAt: new Date().toISOString(),
    }), /бесконечно/);
  });
});

// ── Сверка по паре вендора (AC3, риск R1) ──

describe('checkPricingDrift', () => {
  it('сверяет с ценой СВОЕГО вендора, а не модели вообще (AC3, риск R1)', async () => {
    writeSettings({ pricing: { input_per_1m: 13, output_per_1m: 29, cache_per_1m: 0 }, vendor: 'makora' });
    // У makora 13/29 (совпадает), у Xiaomi 14/29 — сверка «по модели» дала бы дрейф
    const fetchFn = fakeFetch(
      endpointsPayload([
        { id: 'makora', input_per_1m: 13, output_per_1m: 29, cache_per_1m: 0 },
        { id: 'xiaomi', input_per_1m: 14, output_per_1m: 29, cache_per_1m: 0 },
      ]),
    );
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.state, 'ok');
    assert.equal(result.vendor, 'makora');
    assert.equal(result.maxDeltaPercent, 0);
    assert.equal(result.components.length, 3);
  });

  it('дрейф виден по компонентам: было/стало и процент (AC4)', async () => {
    writeSettings({ pricing: { input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }, vendor: 'makora' });
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 12, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.state, 'drift');
    assert.equal(result.direction, 'increased');
    assert.equal(result.maxDeltaPercent, 20);
    const input = result.components.find((c) => c.name === 'input');
    assert.deepEqual(input, { name: 'input', was: 10, now: 12, deltaPercent: 20 });
    const message = formatDriftMessage(result);
    assert.match(message, /выросла/);
    assert.match(message, /ввод 10 → 12 \(\+20%\)/);
  });

  it('граница ровно порог — НЕ дрейф, выше — дрейф (AC14)', async () => {
    writeSettings({ pricing: { input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }, vendor: 'makora' });
    const exactly = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 11, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const ok = await checkPricingDrift(cwd, undefined, { fetchFn: exactly, force: true });
    assert.equal(ok.state, 'ok');
    assert.equal(ok.maxDeltaPercent, 10);

    clearPricingGuardCache();
    const above = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 11.01, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const drift = await checkPricingDrift(cwd, undefined, { fetchFn: above, force: true });
    assert.equal(drift.state, 'drift');
    assert.equal(drift.direction, 'increased');
  });

  it('снижение цены — тоже дрейф, но direction=decreased (AC13)', async () => {
    writeSettings({ pricing: { input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }, vendor: 'makora' });
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 5, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.state, 'drift');
    assert.equal(result.direction, 'decreased');
    assert.equal(result.maxDeltaPercent, -50);
  });

  it('модель без вендора — unknown с объяснением (риск R1)', async () => {
    writeSettings({ vendor: null });
    const fetchFn = fakeFetch(endpointsPayload([]));
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.state, 'unknown');
    assert.match(result.reason, /только по паре/);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('модель без тарифа — unknown без сети', async () => {
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(
      join(cwd, '.vibelog', 'settings.json'),
      `${JSON.stringify({
        gateways: { routerai: { base_url: 'https://routerai.example/api/v1' } },
        models: {
          default: 'routerai/x',
          available: { 'routerai/x': { gateway: 'routerai', model: 'x', vendor: 'makora' } },
        },
      })}\n`,
      'utf-8',
    );
    const fetchFn = fakeFetch(endpointsPayload([]));
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.state, 'unknown');
    assert.match(result.reason, /тариф/);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('вендор не обслуживает модель — unknown', async () => {
    writeSettings();
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'xiaomi', input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.state, 'unknown');
    assert.match(result.reason, /makora/);
  });

  it('disabled — сверка не идёт и сети нет', async () => {
    writeSettings({ extra: { pricing_guard: { enabled: false } } });
    const fetchFn = fakeFetch(endpointsPayload([]));
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.skipped, 'disabled');
    assert.equal(result.state, 'ok');
    assert.equal(fetchFn.calls.length, 0);
  });
});

// ── Кэш/TTL сверки (риск R3, AC9) ──

describe('кэш сверки', () => {
  it('в пределах TTL повторной сверки по сети нет (AC9)', async () => {
    // catalog.ttl_minutes=0 — кэш каталога VL-316 выключен: тогда любой сетевой
    // вызов виден в счётчике, и проверяется именно кэш СВЕРКИ
    writeSettings({ extra: { pricing_guard: { catalog_ttl_minutes: 15 }, catalog: { ttl_minutes: 0 } } });
    let now = Date.parse('2026-01-01T00:00:00Z');
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const first = await checkPricingDrift(cwd, undefined, { fetchFn, now: () => now });
    assert.equal(first.state, 'ok');
    const callsAfterFirst = fetchFn.calls.length;
    assert.ok(callsAfterFirst > 0);

    // +10 минут: TTL 15 — сеть не трогаем
    now += 10 * 60_000;
    const second = await checkPricingDrift(cwd, undefined, { fetchFn, now: () => now });
    assert.equal(second.state, 'ok');
    assert.equal(fetchFn.calls.length, callsAfterFirst);

    // +20 минут: TTL истёк — сверка идёт заново
    now += 20 * 60_000;
    await checkPricingDrift(cwd, undefined, { fetchFn, now: () => now });
    assert.ok(fetchFn.calls.length > callsAfterFirst);
  });

  it('force обходит кэш сверки', async () => {
    writeSettings();
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    await checkPricingDrift(cwd, undefined, { fetchFn });
    const before = fetchFn.calls.length;
    await checkPricingDrift(cwd, undefined, { fetchFn, force: true });
    assert.ok(fetchFn.calls.length > before);
  });
});

// ── Offline (AC10) ──

describe('offline-поведение', () => {
  it('каталог недоступен → unknown + offline, state не бросает', async () => {
    writeSettings();
    const fetchFn = fakeFetch(new Error('ECONNREFUSED'));
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(result.state, 'unknown');
    assert.equal(result.offline, true);
  });

  it('offline=allow → работаем с предупреждением (AC10)', async () => {
    writeSettings();
    const fetchFn = fakeFetch(new Error('ECONNREFUSED'));
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    const action = decideDriftPolicy(resolvePricingGuard(cwd).config, result);
    assert.equal(action.kind, 'proceed');
    assert.match(action.warning, /невозможна/);
  });

  it('offline=block → отказ с понятным текстом (AC10)', async () => {
    writeSettings({ extra: { pricing_guard: { offline: 'block' } } });
    const fetchFn = fakeFetch(new Error('ECONNREFUSED'));
    const result = await checkPricingDrift(cwd, undefined, { fetchFn });
    const action = decideDriftPolicy(resolvePricingGuard(cwd).config, result);
    assert.equal(action.kind, 'block');
    assert.match(action.message, /Сверка цен невозможна/);
  });
});

// ── Политика on_drift (AC5-AC8, AC13) ──

describe('decideDriftPolicy', () => {
  const drift = {
    state: 'drift',
    modelId: 'routerai/xiaomi/mimo-v2.6/@makora',
    vendor: 'makora',
    components: [{ name: 'input', was: 10, now: 15, deltaPercent: 50 }],
    maxDeltaPercent: 50,
    direction: 'increased',
    checkedAt: new Date().toISOString(),
  };

  it("'ask' (дефолт) — карточка-подтверждение (AC5)", () => {
    const action = decideDriftPolicy({ ...PRICING_GUARD_DEFAULT, onDrift: 'ask' }, drift);
    assert.equal(action.kind, 'ask');
    assert.match(action.message, /выросла/);
  });

  it("'warn' — работа продолжается, предупреждение остаётся (AC7)", () => {
    const action = decideDriftPolicy({ ...PRICING_GUARD_DEFAULT, onDrift: 'warn' }, drift);
    assert.equal(action.kind, 'proceed');
    assert.match(action.warning, /выросла/);
  });

  it("'auto' с альтернативой — переключение вендора (AC6)", () => {
    const withAlternative = {
      ...drift,
      alternative: { vendor: 'xiaomi', pricing: { input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }, maxDeltaPercent: 0 },
    };
    const action = decideDriftPolicy({ ...PRICING_GUARD_DEFAULT, onDrift: 'auto' }, withAlternative);
    assert.equal(action.kind, 'auto');
    assert.equal(action.vendor, 'xiaomi');
  });

  it("'auto' без альтернативы деградирует в 'ask' (AC8)", () => {
    const action = decideDriftPolicy({ ...PRICING_GUARD_DEFAULT, onDrift: 'auto' }, drift);
    assert.equal(action.kind, 'ask');
  });

  it('снижение цены не блокирует даже в ask (AC13)', () => {
    const decreased = { ...drift, direction: 'decreased', maxDeltaPercent: -50 };
    const action = decideDriftPolicy({ ...PRICING_GUARD_DEFAULT, onDrift: 'ask' }, decreased);
    assert.equal(action.kind, 'proceed');
    assert.match(action.warning, /снизилась/);
  });

  it('принятое тредом расхождение больше не спрашивается', () => {
    const accepted = { model: drift.modelId, acceptedDeltaPercent: 50, at: new Date().toISOString() };
    const action = decideDriftPolicy({ ...PRICING_GUARD_DEFAULT }, drift, accepted);
    assert.equal(action.kind, 'proceed');
  });

  it('принятое расхождение не покрывает больший рост', () => {
    const accepted = { model: drift.modelId, acceptedDeltaPercent: 20, at: new Date().toISOString() };
    const action = decideDriftPolicy({ ...PRICING_GUARD_DEFAULT }, drift, accepted);
    assert.equal(action.kind, 'ask');
  });
});

// ── Синхронная сверка по кэшу каталога (точка «перед фазой») ──

describe('checkPricingDriftCached', () => {
  it('нет кэша — unknown + offline, сети нет', () => {
    writeSettings();
    const result = checkPricingDriftCached(cwd);
    assert.equal(result.state, 'unknown');
    assert.equal(result.offline, true);
  });

  it('свежий кэш — дрейф по паре вендора', () => {
    writeSettings({ pricing: { input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }, vendor: 'makora' });
    writeVendorCache([{ id: 'makora', input_per_1m: 15, output_per_1m: 20, cache_per_1m: 0 }]);
    const result = checkPricingDriftCached(cwd);
    assert.equal(result.state, 'drift');
    assert.equal(result.maxDeltaPercent, 50);
  });

  it('в кэше только чужой вендор — unknown', () => {
    writeSettings({ vendor: 'makora' });
    writeVendorCache([{ id: 'xiaomi', input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }]);
    const result = checkPricingDriftCached(cwd);
    assert.equal(result.state, 'unknown');
    assert.match(result.reason, /не обслуживает/);
  });
});

// ── Принятие дрейфа тредом ──

describe('принятие дрейфа', () => {
  it('acceptDrift/readAcceptedDrift переживают перезапись', () => {
    writeSettings();
    assert.equal(readAcceptedDrift(cwd, 'thread1'), null);
    acceptDrift(cwd, 'thread1', 'routerai/xiaomi/mimo-v2.6/@makora', 50);
    const read = readAcceptedDrift(cwd, 'thread1');
    assert.equal(read.model, 'routerai/xiaomi/mimo-v2.6/@makora');
    assert.equal(read.acceptedDeltaPercent, 50);
  });

  it('битый sidecar — «не принято»', () => {
    writeSettings();
    mkdirSync(join(cwd, '.vibelog', 'chat-sessions'), { recursive: true });
    writeFileSync(join(cwd, '.vibelog', 'chat-sessions', 'bad.pricing.json'), '{oops', 'utf-8');
    assert.equal(readAcceptedDrift(cwd, 'bad'), null);
  });

  it('isDriftAccepted: чужая модель и снижение не принимаются', () => {
    const result = {
      state: 'drift',
      modelId: 'm1',
      components: [],
      maxDeltaPercent: 20,
      direction: 'increased',
      checkedAt: new Date().toISOString(),
    };
    assert.equal(isDriftAccepted({ model: 'm2', acceptedDeltaPercent: 50, at: '' }, result), false);
    assert.equal(
      isDriftAccepted({ model: 'm1', acceptedDeltaPercent: 50, at: '' }, { ...result, direction: 'decreased' }),
      false,
    );
    assert.equal(isDriftAccepted({ model: 'm1', acceptedDeltaPercent: 20, at: '' }, result), true);
  });
});

// ── Обновление тарифа из каталога (AC12) ──

describe('refreshModelPricing', () => {
  it('перезаписывает тариф ценой своего вендора', async () => {
    writeSettings({ vendor: 'makora', model: 'xiaomi/mimo-v2.6' });
    const fetchFn = fakeFetch(
      endpointsPayload([
        { id: 'makora', input_per_1m: 15, output_per_1m: 30, cache_per_1m: 0 },
        { id: 'xiaomi', input_per_1m: 99, output_per_1m: 99, cache_per_1m: 0 },
      ]),
    );
    const result = await refreshModelPricing(cwd, 'routerai/xiaomi/mimo-v2.6/@makora', { fetchFn });
    assert.deepEqual(result.pricing, { input_per_1m: 15, output_per_1m: 30, cache_per_1m: 0 });
    // Сверка после обновления — «ok» (кэш сверки сброшен)
    clearPricingGuardCache();
    const after = await checkPricingDrift(cwd, undefined, { fetchFn });
    assert.equal(after.state, 'ok');
  });

  it('нет вендора — понятная ошибка, файл не тронут', async () => {
    writeSettings({ vendor: null });
    const fetchFn = fakeFetch(endpointsPayload([]));
    await assert.rejects(
      () => refreshModelPricing(cwd, 'routerai/xiaomi/mimo-v2.6/@makora', { fetchFn }),
      /не задан вендор/,
    );
    assert.equal(fetchFn.calls.length, 0);
  });

  it('неизвестная модель — понятная ошибка', async () => {
    writeSettings();
    await assert.rejects(
      () => refreshModelPricing(cwd, 'nope', { fetchFn: fakeFetch(endpointsPayload([])) }),
      /отсутствует/,
    );
  });
});

// ── REST API сверки (AC11/AC12) ──

describe('GET /api/pricing/drift и POST /api/pricing/refresh', () => {
  it('drift отдаёт состояние и подробности (AC11)', async () => {
    writeSettings({ pricing: { input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }, vendor: 'makora' });
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 15, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const res = await handleCatalogApi(
      'GET',
      '/api/pricing/drift',
      null,
      cwd,
      'model=routerai%2Fxiaomi%2Fmimo-v2.6%2F%40makora',
      { fetchFn },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'drift');
    assert.equal(res.body.direction, 'increased');
    assert.equal(res.body.maxDeltaPercent, 50);
    assert.equal(res.body.vendor, 'makora');
    assert.ok(Array.isArray(res.body.components));
    // конфиг отдаётся странице «Модели» для отображения порога
    assert.equal(res.body.config.thresholdPercent, 10);
  });

  it('drift без модели — состояние активной/default модели', async () => {
    writeSettings();
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 10, output_per_1m: 20, cache_per_1m: 0 }]),
    );
    const res = await handleCatalogApi('GET', '/api/pricing/drift', null, cwd, '', { fetchFn });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'ok');
  });

  it('refresh обновляет тариф из каталога (AC12)', async () => {
    writeSettings({ vendor: 'makora' });
    const fetchFn = fakeFetch(
      endpointsPayload([{ id: 'makora', input_per_1m: 12, output_per_1m: 24, cache_per_1m: 0 }]),
    );
    const res = await handleCatalogApi(
      'POST',
      '/api/pricing/refresh',
      { id: 'routerai/xiaomi/mimo-v2.6/@makora' },
      cwd,
      '',
      { fetchFn },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.pricing, { input_per_1m: 12, output_per_1m: 24, cache_per_1m: 0 });
    assert.equal(res.body.vendor, 'makora');
  });

  it('refresh без id — 400', async () => {
    writeSettings();
    const res = await handleCatalogApi('POST', '/api/pricing/refresh', {}, cwd, '', {
      fetchFn: fakeFetch(endpointsPayload([])),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /id/);
  });

  it('чужие URL не перехватываются', async () => {
    const res = await handleCatalogApi('GET', '/api/tasks', null, cwd, '', {});
    assert.equal(res, null);
  });
});
