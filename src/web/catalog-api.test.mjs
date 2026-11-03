/**
 * Тесты REST API каталога моделей (VL-316, AC5/AC6).
 *
 * Каталог ходит в сеть, поэтому fetch инжектируется через deps —
 * реальных запросов нет (guard VL-132 в src/test-setup.mjs).
 * Проверяем: валидацию шлюза (400 без похода в сеть), поиск с query,
 * вендоров, resolve готовой записи, деградацию при недоступном апстриме.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleCatalogApi } from '../../dist/web/catalog-api.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-catalog-api-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
});

function writeSettings(extra = {}) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    `${JSON.stringify(
      { gateways: { routerai: { base_url: 'https://routerai.example/api/v1' } }, ...extra },
      null,
      2,
    )}\n`,
    'utf-8',
  );
}

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    for (const [pattern, payload] of routes) {
      if (String(url).includes(pattern)) {
        if (payload instanceof Error) throw payload;
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

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
      pricing: { prompt: 0.000131581775, completion: 0.0010526542 },
      pricing_units: { prompt: 'token', completion: 'token' },
    },
  ],
};

const ENDPOINTS_RESPONSE = {
  data: {
    id: 'deepseek/deepseek-chat',
    endpoints: [
      {
        provider_name: 'DeepSeek',
        tag: 'deepseek',
        context_length: 163840,
        pricing: { prompt: 0.0000336849344, completion: 0.0000936862238 },
        pricing_units: { prompt: 'token', completion: 'token' },
      },
      {
        provider_name: 'Baidu',
        tag: 'baidu',
        context_length: 131072,
        pricing: { prompt: 0.00002, completion: 0.00006 },
        pricing_units: { prompt: 'token', completion: 'token' },
      },
    ],
  },
};

describe('GET /api/catalog/models (AC5)', () => {
  it('отдаёт модели с ценами и context_window', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const res = await handleCatalogApi(
      'GET',
      '/api/catalog/models',
      null,
      cwd,
      'gateway=routerai',
      { fetchFn },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.gateway, 'routerai');
    assert.equal(res.body.stale, false);
    assert.equal(res.body.models.length, 2);
    const ds = res.body.models.find((m) => m.id === 'deepseek/deepseek-chat');
    assert.equal(ds.pricing.input_per_1m, 33.6849344);
    assert.equal(ds.contextWindow, 163840);
  });

  it('query фильтрует выдачу', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const res = await handleCatalogApi(
      'GET',
      '/api/catalog/models',
      null,
      cwd,
      'gateway=routerai&query=gpt',
      { fetchFn },
    );
    assert.deepEqual(res.body.models.map((m) => m.id), ['openai/gpt-5']);
  });

  it('отсутствующий gateway → 400 без похода в сеть', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const res = await handleCatalogApi('GET', '/api/catalog/models', null, cwd, '', { fetchFn });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /gateway/);
    assert.equal(fetchFn.calls.length, 0, 'в сеть не ходили');
  });

  it('неизвестный шлюз → 400 со списком доступных', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', MODELS_RESPONSE]]);
    const res = await handleCatalogApi(
      'GET',
      '/api/catalog/models',
      null,
      cwd,
      'gateway=ghost',
      { fetchFn },
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Неизвестный шлюз/);
    assert.match(res.body.error, /routerai/);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('апстрим недоступен и кэша нет → 503 с понятным текстом', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/models', new Error('ECONNREFUSED')]]);
    const res = await handleCatalogApi(
      'GET',
      '/api/catalog/models',
      null,
      cwd,
      'gateway=routerai',
      { fetchFn },
    );
    assert.equal(res.status, 503);
    assert.match(res.body.error, /недоступен/);
    assert.match(res.body.error, /вручную/, 'подсказка про ручной ввод цен');
  });

  it('URL не из каталога → null (маршрут отдаёт handleApi)', async () => {
    assert.equal(await handleCatalogApi('GET', '/api/models', null, cwd, '', {}), null);
  });
});

describe('GET /api/catalog/vendors (AC3)', () => {
  it('отдаёт вендоров с ценами и context_window', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/endpoints', ENDPOINTS_RESPONSE]]);
    const res = await handleCatalogApi(
      'GET',
      '/api/catalog/vendors',
      null,
      cwd,
      'gateway=routerai&model=deepseek/deepseek-chat',
      { fetchFn },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.vendors.length, 2);
    const baidu = res.body.vendors.find((v) => v.id === 'baidu');
    assert.equal(baidu.pricing.input_per_1m, 20);
    assert.equal(baidu.contextWindow, 131072);
  });

  it('без model → 400', async () => {
    writeSettings();
    const res = await handleCatalogApi(
      'GET',
      '/api/catalog/vendors',
      null,
      cwd,
      'gateway=routerai',
      { fetchFn: fakeFetch([]) },
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /model/);
  });
});

describe('POST /api/catalog/resolve (AC6)', () => {
  it('отдаёт готовую запись: id, gateway, model, vendor, pricing, context_window', async () => {
    writeSettings();
    const fetchFn = fakeFetch([
      ['/endpoints', ENDPOINTS_RESPONSE],
      ['/models', MODELS_RESPONSE],
    ]);
    const res = await handleCatalogApi(
      'POST',
      '/api/catalog/resolve',
      { gateway: 'routerai', model: 'deepseek/deepseek-chat', vendor: 'baidu' },
      cwd,
      '',
      { fetchFn },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'routerai/deepseek/deepseek-chat/@baidu');
    assert.deepEqual(res.body.record, {
      gateway: 'routerai',
      vendor: 'baidu',
      model: 'deepseek/deepseek-chat',
      api_mode: 'chat',
      context_window: 131072,
      pricing: { input_per_1m: 20, output_per_1m: 60, cache_per_1m: 0 },
    });
    assert.equal(res.body.pricingSource, 'vendor');
  });

  it('неизвестный вендор → 404 со списком доступных', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/endpoints', ENDPOINTS_RESPONSE]]);
    const res = await handleCatalogApi(
      'POST',
      '/api/catalog/resolve',
      { gateway: 'routerai', model: 'deepseek/deepseek-chat', vendor: 'ghost' },
      cwd,
      '',
      { fetchFn },
    );
    assert.equal(res.status, 404);
    assert.match(res.body.error, /ghost/);
    assert.match(res.body.error, /baidu/);
  });

  it('без вендора: цена берётся из каталога модели', async () => {
    writeSettings();
    const fetchFn = fakeFetch([
      ['/endpoints', { data: { endpoints: [] } }],
      ['/models', MODELS_RESPONSE],
    ]);
    const res = await handleCatalogApi(
      'POST',
      '/api/catalog/resolve',
      { gateway: 'routerai', model: 'openai/gpt-5' },
      cwd,
      '',
      { fetchFn },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.pricingSource, 'catalog');
    assert.equal(res.body.record.pricing.input_per_1m, 131.581775);
  });

  it('ручная цена приоритетнее каталога (риск R2: поля формы редактируемы)', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/endpoints', ENDPOINTS_RESPONSE]]);
    const res = await handleCatalogApi(
      'POST',
      '/api/catalog/resolve',
      {
        gateway: 'routerai',
        model: 'deepseek/deepseek-chat',
        vendor: 'baidu',
        pricing: { input_per_1m: 99, output_per_1m: 111, cache_per_1m: 5 },
      },
      cwd,
      '',
      { fetchFn },
    );
    assert.equal(res.body.pricingSource, 'manual');
    assert.deepEqual(res.body.record.pricing, {
      input_per_1m: 99,
      output_per_1m: 111,
      cache_per_1m: 5,
    });
  });

  it('каталог недоступен → запись с warning вместо падения', async () => {
    writeSettings();
    const fetchFn = fakeFetch([['/endpoints', new Error('ETIMEDOUT')]]);
    const res = await handleCatalogApi(
      'POST',
      '/api/catalog/resolve',
      { gateway: 'routerai', model: 'deepseek/deepseek-chat' },
      cwd,
      '',
      { fetchFn },
    );
    assert.equal(res.status, 200, 'мастер продолжает работу');
    assert.match(res.body.warning, /недоступен/);
    assert.equal(res.body.record.model, 'deepseek/deepseek-chat');
  });

  it('пустое имя модели / неизвестный шлюз → 400', async () => {
    writeSettings();
    const noModel = await handleCatalogApi(
      'POST',
      '/api/catalog/resolve',
      { gateway: 'routerai' },
      cwd,
      '',
      {},
    );
    assert.equal(noModel.status, 400);
    const noGateway = await handleCatalogApi(
      'POST',
      '/api/catalog/resolve',
      { gateway: 'ghost', model: 'a/b' },
      cwd,
      '',
      {},
    );
    assert.equal(noGateway.status, 400);
  });
});
