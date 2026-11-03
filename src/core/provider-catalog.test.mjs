/**
 * Тесты каталога моделей шлюза (VL-316).
 *
 * Главный тест — нормализация цен (AC2, риск R1 плана): ошибка «за токен vs
 * за 1M» даёт ×1e6 в стоимости, поэтому проверяем оба направления и
 * не-токенные единицы. Остальное: парсинг ответов RouterAI, кэш с TTL,
 * offline-деградация (риск R2), реестр адаптеров.
 *
 * Сеть не используется: fetch инжектируется через CatalogDeps (guard VL-132
 * в src/test-setup.mjs отклоняет не-loopback запросы).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizePricing,
  comparePricing,
  createOpenAiCompatibleCatalog,
  getCatalogAdapter,
  CATALOG_ADAPTERS,
  listCatalogModels,
  listCatalogVendors,
  catalogCachePath,
  catalogTtlMinutes,
  catalogBaseUrl,
  DEFAULT_CATALOG_TTL_MINUTES,
} from '../../dist/core/provider-catalog.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-catalog-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
});

/** Запись settings.json с одним шлюзом routerai. */
function writeSettings(extra = {}) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    `${JSON.stringify(
      {
        gateways: { routerai: { base_url: 'https://routerai.example/api/v1' } },
        ...extra,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );
}

/** Фейковый fetch: отдаёт заданный JSON по URL-паттерну, считает вызовы. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    for (const [pattern, payload] of routes) {
      if (String(url).includes(pattern)) {
        if (payload instanceof Error) throw payload;
        return {
          ok: true,
          status: 200,
          json: async () => payload,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

/** Ответ /models в формате RouterAI (проверено живым запросом). */
const MODELS_RESPONSE = {
  data: [
    {
      id: 'deepseek/deepseek-chat',
      name: 'DeepSeek: Chat',
      description: 'Быстрая модель',
      context_length: 163840,
      pricing: { prompt: 0.0000336849344, completion: 0.0000936862238 },
      pricing_units: { prompt: 'token', completion: 'token' },
    },
    {
      id: 'openai/gpt-5',
      name: 'OpenAI: GPT-5',
      context_length: 400000,
      pricing: {
        prompt: 0.000131581775,
        completion: 0.0010526542,
        input_cache_read: 0.0000131581775,
        web_search: 1.0526542,
      },
      pricing_units: {
        prompt: 'token',
        completion: 'token',
        input_cache_read: 'token',
        web_search: 'request',
      },
    },
  ],
};

/** Ответ /models/{id}/endpoints в формате RouterAI. */
const ENDPOINTS_RESPONSE = {
  data: {
    id: 'deepseek/deepseek-chat',
    endpoints: [
      {
        name: 'DeepSeek | deepseek/deepseek-chat',
        provider_name: 'DeepSeek',
        tag: 'deepseek',
        context_length: 163840,
        pricing: { prompt: 0.0000336849344, completion: 0.0000936862238 },
        pricing_units: { prompt: 'token', completion: 'token' },
      },
      {
        name: 'Baidu | deepseek/deepseek-chat',
        provider_name: 'Baidu',
        tag: 'baidu',
        context_length: 131072,
        pricing: { prompt: 0.00002, completion: 0.00006 },
        pricing_units: { prompt: 'token', completion: 'token' },
      },
    ],
  },
};

describe('normalizePricing — нормализация цен (AC2, риск R1)', () => {
  it('единица token умножается на 1e6: цена за токен → рубли за 1M', () => {
    const { pricing } = normalizePricing(
      { prompt: 0.0000336849344, completion: 0.0000936862238 },
      { prompt: 'token', completion: 'token' },
    );
    // 0.0000336849344 * 1e6 = 33.6849344 — цена за 1M токенов
    assert.equal(pricing.input_per_1m, 33.6849344);
    assert.equal(pricing.output_per_1m, 93.6862238);
    assert.equal(pricing.cache_per_1m, 0, 'нет input_cache_read → 0');
  });

  it('единица 1m/million НЕ умножается (цена уже за миллион)', () => {
    const { pricing } = normalizePricing(
      { prompt: 3, completion: 15, input_cache_read: 0.3 },
      { prompt: '1M', completion: 'million', input_cache_read: '1m tokens' },
    );
    assert.equal(pricing.input_per_1m, 3);
    assert.equal(pricing.output_per_1m, 15);
    assert.equal(pricing.cache_per_1m, 0.3);
  });

  it('ошибка ×1e6 недопустима: token и 1m дают РАЗНЫЕ значения на одном числе', () => {
    const perToken = normalizePricing({ prompt: 0.000002 }, { prompt: 'token' }).pricing;
    const perMillion = normalizePricing({ prompt: 0.000002 }, { prompt: '1m' }).pricing;
    assert.equal(perToken.input_per_1m, 2);
    assert.equal(perMillion.input_per_1m, 0.000002);
    assert.notEqual(perToken.input_per_1m, perMillion.input_per_1m);
  });

  it('не-токенные единицы (image/second/request/search_unit) в тариф не попадают', () => {
    const { pricing, unsupportedUnits } = normalizePricing(
      { prompt: 0.0001, completion: 0.0004, web_search: 1.05, seconds: 0.0035 },
      { prompt: 'token', completion: 'token', web_search: 'request', seconds: 'second' },
    );
    assert.equal(pricing.input_per_1m, 100);
    assert.equal(pricing.output_per_1m, 400);
    assert.deepEqual(unsupportedUnits.sort(), ['seconds', 'web_search']);
  });

  it('отсутствующая единица трактуется как token', () => {
    const { pricing } = normalizePricing({ prompt: 0.00001, completion: 0.00002 });
    assert.equal(pricing.input_per_1m, 10);
    assert.equal(pricing.output_per_1m, 20);
  });

  it('битые/отрицательные значения → 0, не падает', () => {
    const { pricing } = normalizePricing(
      { prompt: -5, completion: 'abc', input_cache_read: null },
      { prompt: 'token', completion: 'token', input_cache_read: 'token' },
    );
    assert.deepEqual(pricing, { input_per_1m: 0, output_per_1m: 0, cache_per_1m: 0 });
    assert.deepEqual(normalizePricing(undefined).pricing, {
      input_per_1m: 0,
      output_per_1m: 0,
      cache_per_1m: 0,
    });
  });
});

describe('catalogBaseUrl — URL каталога из base_url шлюза (AC17)', () => {
  it('срезает хвостовые слэши, отдельного catalog_url нет', () => {
    assert.equal(catalogBaseUrl({ base_url: 'https://routerai.ru/api/v1/' }), 'https://routerai.ru/api/v1');
    assert.equal(catalogBaseUrl({ base_url: 'https://routerai.ru/api/v1' }), 'https://routerai.ru/api/v1');
  });
});

describe('createOpenAiCompatibleCatalog — парсинг ответов RouterAI (AC1/AC3)', () => {
  it('listModels: id/name/description/context_window/pricing', async () => {
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const adapter = createOpenAiCompatibleCatalog(
      { base_url: 'https://routerai.example/api/v1' },
      { fetchFn },
    );
    const models = await adapter.listModels();
    assert.equal(models.length, 2);
    const ds = models.find((m) => m.id === 'deepseek/deepseek-chat');
    assert.equal(ds.name, 'DeepSeek: Chat');
    assert.equal(ds.description, 'Быстрая модель');
    assert.equal(ds.contextWindow, 163840);
    assert.equal(ds.pricing.input_per_1m, 33.6849344);
    assert.equal(fetchFn.calls[0], 'https://routerai.example/api/v1/models');
  });

  it('listModels: фильтр по query (id и name, регистр не важен)', async () => {
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const adapter = createOpenAiCompatibleCatalog({ base_url: 'https://x/api/v1' }, { fetchFn });
    assert.deepEqual((await adapter.listModels('gpt')).map((m) => m.id), ['openai/gpt-5']);
    assert.deepEqual((await adapter.listModels('DEEPSEEK')).map((m) => m.id), ['deepseek/deepseek-chat']);
    assert.equal((await adapter.listModels('нет-такого')).length, 0);
  });

  it('listVendors: вендоры с их ценами и context_window', async () => {
    const fetchFn = fakeFetch([['/endpoints', ENDPOINTS_RESPONSE]]);
    const adapter = createOpenAiCompatibleCatalog({ base_url: 'https://x/api/v1' }, { fetchFn });
    const vendors = await adapter.listVendors('deepseek/deepseek-chat');
    assert.equal(vendors.length, 2);
    const baidu = vendors.find((v) => v.id === 'baidu');
    assert.equal(baidu.name, 'Baidu');
    assert.equal(baidu.contextWindow, 131072);
    assert.equal(baidu.pricing.input_per_1m, 20);
    assert.equal(baidu.pricing.output_per_1m, 60);
    assert.ok(fetchFn.calls[0].endsWith('/models/deepseek/deepseek-chat/endpoints'));
  });

  it('listVendors: пустой tag → id из provider_name в нижнем регистре', async () => {
    const fetchFn = fakeFetch([
      [
        '/endpoints',
        {
          data: {
            endpoints: [
              { provider_name: 'Some Vendor', tag: '', pricing: { prompt: 0.000001 }, pricing_units: { prompt: 'token' } },
            ],
          },
        },
      ],
    ]);
    const adapter = createOpenAiCompatibleCatalog({ base_url: 'https://x/api/v1' }, { fetchFn });
    const vendors = await adapter.listVendors('a/b');
    assert.equal(vendors[0].id, 'some-vendor');
  });

  it('HTTP-ошибка и не-JSON → понятная ошибка на русском', async () => {
    const adapter = createOpenAiCompatibleCatalog(
      { base_url: 'https://x/api/v1' },
      { fetchFn: async () => ({ ok: false, status: 502, json: async () => ({}) }) },
    );
    await assert.rejects(() => adapter.listModels(), /HTTP 502/);

    const badJson = createOpenAiCompatibleCatalog(
      { base_url: 'https://x/api/v1' },
      { fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }) },
    );
    await assert.rejects(() => badJson.listModels(), /не-JSON/);
  });

  it('сетевой сбой (fetch бросает) → «каталог недоступен»', async () => {
    const adapter = createOpenAiCompatibleCatalog(
      { base_url: 'https://x/api/v1' },
      { fetchFn: async () => { throw new Error('ECONNREFUSED'); } },
    );
    await assert.rejects(() => adapter.listModels(), /каталог недоступен.*ECONNREFUSED/);
  });
});

describe('getCatalogAdapter — per-шлюз адаптер (решение из плана)', () => {
  it('неизвестный шлюз обслуживает дефолтный OpenAI-совместимый адаптер', () => {
    const adapter = getCatalogAdapter('routerai', { base_url: 'https://x/api/v1' }, {});
    assert.equal(typeof adapter.listModels, 'function');
    assert.equal(typeof adapter.listVendors, 'function');
  });

  it('запись в реестре переопределяет адаптер шлюза', async () => {
    CATALOG_ADAPTERS.custom = () => ({
      listModels: async () => [{ id: 'x/y', name: 'X', pricing: { input_per_1m: 1, output_per_1m: 2, cache_per_1m: 0 }, unsupportedUnits: [] }],
      listVendors: async () => [],
    });
    try {
      const adapter = getCatalogAdapter('custom', { base_url: 'https://x/api/v1' }, {});
      assert.equal((await adapter.listModels())[0].id, 'x/y');
    } finally {
      delete CATALOG_ADAPTERS.custom;
    }
  });
});

describe('кэш каталога и TTL (AC4)', () => {
  it('первый запрос идёт в сеть и пишет .vibelog/cache/provider-catalog.json', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const res = await listCatalogModels(cwd, 'routerai', { fetchFn });
    assert.equal(res.stale, false);
    assert.equal(res.items.length, 2);
    assert.equal(fetchFn.calls.length, 1);
    assert.ok(existsSync(catalogCachePath(cwd)), 'файл кэша создан');
    const cache = JSON.parse(readFileSync(catalogCachePath(cwd), 'utf-8'));
    assert.equal(cache.version, 1);
    assert.ok(cache.entries['routerai:models']);
  });

  it('второй запрос в пределах TTL берётся из кэша (сеть не дёргается)', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    await listCatalogModels(cwd, 'routerai', { fetchFn });
    const second = await listCatalogModels(cwd, 'routerai', { fetchFn });
    assert.equal(fetchFn.calls.length, 1, 'второго запроса в сеть нет');
    assert.equal(second.stale, false);
    assert.equal(second.items.length, 2);
  });

  it('после истечения TTL — снова сеть', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');
    await listCatalogModels(cwd, 'routerai', { fetchFn, now: () => t0 });
    // TTL по умолчанию 60 минут: +61 минута — кэш протух
    await listCatalogModels(cwd, 'routerai', { fetchFn, now: () => t0 + 61 * 60_000 });
    assert.equal(fetchFn.calls.length, 2);
  });

  it('TTL из настроек: catalog.ttl_minutes=0 → кэш не используется', async () => {
    writeSettings({ catalog: { ttl_minutes: 0 } });
    assert.equal(catalogTtlMinutes(cwd), 0);
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    await listCatalogModels(cwd, 'routerai', { fetchFn });
    await listCatalogModels(cwd, 'routerai', { fetchFn });
    assert.equal(fetchFn.calls.length, 2);
  });

  it('битый catalog.ttl_minutes → дефолт 60', () => {
    writeSettings({ catalog: { ttl_minutes: 'abc' } });
    assert.equal(catalogTtlMinutes(cwd), DEFAULT_CATALOG_TTL_MINUTES);
    writeSettings({ catalog: 'мусор' });
    assert.equal(catalogTtlMinutes(cwd), DEFAULT_CATALOG_TTL_MINUTES);
  });

  it('force=true игнорирует свежий кэш', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    await listCatalogModels(cwd, 'routerai', { fetchFn });
    await listCatalogModels(cwd, 'routerai', { fetchFn, force: true });
    assert.equal(fetchFn.calls.length, 2);
  });

  it('битый файл кэша не роняет каталог', async () => {
    writeSettings();
    mkdirSync(join(cwd, '.vibelog', 'cache'), { recursive: true });
    writeFileSync(catalogCachePath(cwd), '{ битый json', 'utf-8');
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const res = await listCatalogModels(cwd, 'routerai', { fetchFn });
    assert.equal(res.items.length, 2);
  });
});

describe('comparePricing — сверка тарифа с каталогом (AC15)', () => {
  const settingsPricing = (input, output, cache) => ({
    input_per_1m: input,
    output_per_1m: output,
    cache_per_1m: cache,
  });

  it('одинаковые цены → status same по всем компонентам', () => {
    const cmp = comparePricing(settingsPricing(20, 60, 3), settingsPricing(20, 60, 3));
    assert.equal(cmp.status, 'same');
    assert.equal(cmp.input.status, 'same');
    assert.equal(cmp.output.status, 'same');
    assert.equal(cmp.cache.status, 'same');
    assert.equal(cmp.input.percent, 0);
  });

  it('расхождение меньше 0.5% считается совпадением (float каталога)', () => {
    const cmp = comparePricing(settingsPricing(15.79, 60, 0), settingsPricing(15.789813, 60, 0));
    assert.equal(cmp.input.status, 'same');
    assert.equal(cmp.status, 'same');
  });

  it('цена в settings выше каталога → increased с процентом', () => {
    const cmp = comparePricing(settingsPricing(30, 60, 0), settingsPricing(20, 60, 0));
    assert.equal(cmp.input.status, 'increased');
    assert.equal(cmp.input.percent, 50);
    assert.equal(cmp.status, 'increased');
  });

  it('цена в settings ниже каталога → decreased с отрицательным процентом', () => {
    const cmp = comparePricing(settingsPricing(10, 60, 0), settingsPricing(20, 60, 0));
    assert.equal(cmp.input.status, 'decreased');
    assert.equal(cmp.input.percent, -50);
    assert.equal(cmp.status, 'decreased');
  });

  it('рост приоритетнее снижения в общем статусе', () => {
    const cmp = comparePricing(settingsPricing(30, 30, 0), settingsPricing(20, 60, 0));
    assert.equal(cmp.input.status, 'increased');
    assert.equal(cmp.output.status, 'decreased');
    assert.equal(cmp.status, 'increased', 'рост важнее: денег уйдёт больше ожидаемого');
  });

  it('нет данных каталога → unknown, не «совпадает»', () => {
    const cmp = comparePricing(settingsPricing(10, 20, 0), undefined);
    assert.equal(cmp.status, 'unknown');
    assert.equal(cmp.input.status, 'unknown');
    assert.equal(cmp.input.current, 10);
    assert.equal(cmp.input.catalog, undefined);
  });

  it('нет тарифа в settings → unknown (модель без цены)', () => {
    const cmp = comparePricing(undefined, settingsPricing(10, 20, 0));
    assert.equal(cmp.status, 'unknown');
    assert.equal(cmp.input.current, undefined);
    assert.equal(cmp.input.catalog, 10);
  });

  it('нули с обеих сторон → same, а не деление на ноль', () => {
    const cmp = comparePricing(settingsPricing(0, 0, 0), settingsPricing(0, 0, 0));
    assert.equal(cmp.status, 'same');
    assert.equal(cmp.input.percent, 0);
  });
});

describe('offline-деградация (AC4, риск R2)', () => {  it('апстрим упал, кэш есть → данные из кэша со stale: true', async () => {
    writeSettings();
    const ok = fakeFetch([['/models', MODELS_RESPONSE]]);
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');
    await listCatalogModels(cwd, 'routerai', { fetchFn: ok, now: () => t0 });

    const broken = fakeFetch([['/models', new Error('ECONNREFUSED')]]);
    const res = await listCatalogModels(cwd, 'routerai', {
      fetchFn: broken,
      now: () => t0 + 120 * 60_000,
    });
    assert.equal(res.stale, true, 'данные из протухшего кэша');
    assert.equal(res.items.length, 2);
    assert.equal(res.fetchedAt, new Date(t0).toISOString());
  });

  it('апстрим упал, кэша нет → понятная ошибка (чат/фазы не затронуты)', async () => {
    writeSettings();
    const broken = fakeFetch([['/models', new Error('ECONNREFUSED')]]);
    await assert.rejects(
      () => listCatalogModels(cwd, 'routerai', { fetchFn: broken }),
      /каталог недоступен/,
    );
  });

  it('неизвестный шлюз → ошибка без похода в сеть', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    await assert.rejects(() => listCatalogModels(cwd, 'ghost', { fetchFn }), /Неизвестный шлюз/);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('вендоры: кэш работает и деградирует так же', async () => {
    writeSettings();
    const ok = fakeFetch([['/endpoints', ENDPOINTS_RESPONSE]]);
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');
    const first = await listCatalogVendors(cwd, 'routerai', 'deepseek/deepseek-chat', {
      fetchFn: ok,
      now: () => t0,
    });
    assert.equal(first.items.length, 2);

    const broken = fakeFetch([['/endpoints', new Error('ETIMEDOUT')]]);
    const stale = await listCatalogVendors(cwd, 'routerai', 'deepseek/deepseek-chat', {
      fetchFn: broken,
      now: () => t0 + 120 * 60_000,
    });
    assert.equal(stale.stale, true);
    assert.equal(stale.items.length, 2);
  });

  it('пустое имя модели для вендоров → ошибка', async () => {
    writeSettings();
    await assert.rejects(() => listCatalogVendors(cwd, 'routerai', '  ', {}), /Пустое имя модели/);
  });
});
