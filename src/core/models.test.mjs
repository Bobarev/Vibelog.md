/**
 * Тесты реестра LLM-шлюзов/моделей (VL-209, VL-315): чтение секций
 * settings.json, резолв активной модели, валидация конфига, `@`-хвост
 * апстрима и алиасы старых ключей.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findModelByGatewayName,
  loadGateways,
  loadProviders,
  parseVendorSuffix,
  buildVendorSuffix,
  loadModels,
  resolveActiveModel,
  resolveModelById,
  validateModelsConfig,
} from '../core/models.js';

describe('models (VL-209)', () => {
  let dir;
  let savedKey;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vb-models-'));
    savedKey = process.env.TEST_ROUTER_KEY;
    delete process.env.TEST_ROUTER_KEY;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.TEST_ROUTER_KEY;
    else process.env.TEST_ROUTER_KEY = savedKey;
  });

  /** Пишет settings.json в temp-каталог. */
  function writeSettings(data) {
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify(data, null, 2));
  }

  const fullSettings = () => ({
    gateways: {
      routerai: { base_url: 'https://routerai.ru/api/v1', api_key_env: 'TEST_ROUTER_KEY' },
      direct: { base_url: 'https://example.com/v1', api_key: 'plain-key' },
    },
    models: {
      default: 'routerai/Some/Model',
      available: {
        'routerai/Some/Model': {
          label: 'Some Model',
          gateway: 'routerai',
          model: 'Some/Model',
          api_mode: 'responses',
          pricing: { input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 },
        },
        'direct/plain': { gateway: 'direct', model: 'plain-model' },
      },
    },
  });

  describe('loadGateways/loadModels', () => {
    it('нет файла settings → пустые секции (не падает)', () => {
      expect(loadGateways(dir)).toEqual({});
      expect(loadModels(dir)).toEqual({ available: {} });
    });

    it('битый JSON → пустые секции (паттерн loadSettings)', () => {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'settings.json'), '{oops');
      expect(loadGateways(dir)).toEqual({});
      expect(loadModels(dir)).toEqual({ available: {} });
    });

    it('провайдер без base_url отбрасывается, корректный — остаётся', () => {
      writeSettings({
        gateways: { bad: { api_key_env: 'X' }, good: { base_url: 'https://ok/v1' } },
      });
      expect(Object.keys(loadGateways(dir))).toEqual(['good']);
    });

    it('модель без provider/model отбрасывается, api_mode/парынги парсятся', () => {
      writeSettings(fullSettings());
      const models = loadModels(dir);
      expect(models.default).toBe('routerai/Some/Model');
      expect(models.available['routerai/Some/Model']).toEqual({
        label: 'Some Model',
        gateway: 'routerai',
        model: 'Some/Model',
        api_mode: 'responses',
        pricing: { input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 },
      });
      expect(models.available['direct/plain'].api_mode).toBeUndefined();
    });

    it('description модели читается (VL-265), отсутствие — ключ не появляется', () => {
      writeSettings({
        gateways: { p: { base_url: 'https://x/v1', api_key: 'k' } },
        models: {
          available: {
            'p/with-desc': { gateway: 'p', model: 'm1', description: 'Быстрая и дешёвая' },
            'p/no-desc': { gateway: 'p', model: 'm2' },
          },
        },
      });
      const models = loadModels(dir);
      expect(models.available['p/with-desc'].description).toBe('Быстрая и дешёвая');
      expect('description' in models.available['p/no-desc']).toBe(false);
    });
  });

  describe('resolveActiveModel', () => {
    it('нет секции models → null (env-fallback)', () => {
      writeSettings({ gateways: { x: { base_url: 'https://x/v1' } } });
      expect(resolveActiveModel(dir)).toBeNull();
    });

    it('полный резолв: id/label/wire-имя/apiMode/baseUrl', () => {
      writeSettings(fullSettings());
      const active = resolveActiveModel(dir);
      expect(active).toMatchObject({
        id: 'routerai/Some/Model',
        label: 'Some Model',
        gatewayId: 'routerai',
        model: 'Some/Model',
        apiMode: 'responses',
        baseUrl: 'https://routerai.ru/api/v1',
        apiKeyEnv: 'TEST_ROUTER_KEY',
        pricing: { input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 },
      });
      expect(active.apiKey).toBe(''); // env не задан
    });

    it('ключ: env[api_key_env] приоритетнее provider.api_key', () => {
      writeSettings(fullSettings());
      process.env.TEST_ROUTER_KEY = 'from-env';
      expect(resolveActiveModel(dir).apiKey).toBe('from-env');
    });

    it('без env — fallback на provider.api_key', () => {
      writeSettings(fullSettings());
      // провайдер routerai без env → null у resolveModelById? Нет: apiKey ''
      expect(resolveActiveModel(dir).apiKey).toBe('');
      // а у direct-провайдера ключ прямой
      expect(resolveModelById(dir, 'direct/plain').apiKey).toBe('plain-key');
    });

    it('default отсутствует в available → null', () => {
      const s = fullSettings();
      s.models.default = 'missing/id';
      writeSettings(s);
      expect(resolveActiveModel(dir)).toBeNull();
    });

    it('провайдер модели отсутствует → null', () => {
      const s = fullSettings();
      delete s.gateways.routerai;
      writeSettings(s);
      expect(resolveActiveModel(dir)).toBeNull();
    });

    it('resolveModelById: неизвестный id → null', () => {
      writeSettings(fullSettings());
      expect(resolveModelById(dir, 'nope/nope')).toBeNull();
    });

    it('api_mode по умолчанию chat', () => {
      writeSettings(fullSettings());
      expect(resolveModelById(dir, 'direct/plain').apiMode).toBe('chat');
    });
  });

  describe('findModelByGatewayName (VL-239/VL-315)', () => {
    it('находит модель по паре provider + wire-имя', () => {
      writeSettings(fullSettings());
      const found = findModelByGatewayName(dir, 'direct', 'plain-model');
      expect(found).toMatchObject({
        id: 'direct/plain',
        label: 'direct/plain',
        gatewayId: 'direct',
        model: 'plain-model',
        baseUrl: 'https://example.com/v1',
        apiKey: 'plain-key',
      });
    });

    it('label и api_mode/pricing берутся из записи available', () => {
      writeSettings(fullSettings());
      const found = findModelByGatewayName(dir, 'routerai', 'Some/Model');
      expect(found).toMatchObject({
        id: 'routerai/Some/Model',
        label: 'Some Model',
        apiMode: 'responses',
      });
      expect(found.pricing).toEqual({ input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 });
    });

    it('чужой provider / чужое wire-имя → null', () => {
      writeSettings(fullSettings());
      expect(findModelByGatewayName(dir, 'routerai', 'plain-model')).toBeNull();
      expect(findModelByGatewayName(dir, 'direct', 'Some/Model')).toBeNull();
    });

    it('провайдер удалён → null; пустые аргументы → null', () => {
      const s = fullSettings();
      delete s.gateways.direct;
      writeSettings(s);
      expect(findModelByGatewayName(dir, 'direct', 'plain-model')).toBeNull();
      expect(findModelByGatewayName(dir, '', 'plain-model')).toBeNull();
      expect(findModelByGatewayName(dir, 'direct', '')).toBeNull();
    });
  });

  describe('validateModelsConfig', () => {
    it('секция models отсутствует → [] (валидировать нечего)', () => {
      expect(validateModelsConfig(dir)).toEqual([]);
    });

    it('валидный конфиг с заданным ключом → []', () => {
      writeSettings(fullSettings());
      process.env.TEST_ROUTER_KEY = 'set';
      expect(validateModelsConfig(dir)).toEqual([]);
    });

    it('default не в available → ошибка', () => {
      const s = fullSettings();
      s.models.default = 'ghost/model';
      writeSettings(s);
      const errors = validateModelsConfig(dir);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/ghost\/model.*отсутствует в models\.available/);
    });

    it('шлюз не в gateways → ошибка', () => {
      const s = fullSettings();
      delete s.gateways.routerai;
      writeSettings(s);
      const errors = validateModelsConfig(dir);
      expect(errors[0]).toMatch(/шлюз "routerai"/);
    });

    it('api_key_env не задан ни в одном источнике → понятная ошибка', () => {
      writeSettings(fullSettings());
      const errors = validateModelsConfig(dir);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/TEST_ROUTER_KEY не задана/);
    });

    it('models.default отсутствует у секции models → ошибка', () => {
      writeSettings({ models: { available: fullSettings().models.available } });
      const errors = validateModelsConfig(dir);
      expect(errors[0]).toMatch(/models\.default отсутствует/);
    });
  });

  // ── VL-315: `@`-хвост апстрима и алиасы старых ключей ──

  describe('parseVendorSuffix (VL-315)', () => {
    it('только provider → vendor, имя без хвоста', () => {
      expect(parseVendorSuffix('deepseek/deepseek-v4.1-flash@provider=baidu')).toEqual({
        model: 'deepseek/deepseek-v4.1-flash',
        vendor: 'baidu',
      });
    });

    it('provider + allow_fallbacks=false', () => {
      expect(
        parseVendorSuffix('deepseek/deepseek-v4.1-flash@provider=baidu&allow_fallbacks=false'),
      ).toEqual({
        model: 'deepseek/deepseek-v4.1-flash',
        vendor: 'baidu',
        allowFallbacks: false,
      });
    });

    it('allow_fallbacks=true распознаётся', () => {
      expect(parseVendorSuffix('m@provider=x&allow_fallbacks=true')).toEqual({
        model: 'm',
        vendor: 'x',
        allowFallbacks: true,
      });
    });

    it('без хвоста → имя как есть, vendor нет', () => {
      expect(parseVendorSuffix('xiaomi/mimo-v2.6-pro')).toEqual({ model: 'xiaomi/mimo-v2.6-pro' });
    });

    it('мусор в хвосте → имя как есть (не ломаем легитимный @)', () => {
      for (const raw of ['m@', 'm@foo', 'm@provider=', 'm@a=b', 'm@=x', '@provider=x']) {
        expect(parseVendorSuffix(raw)).toEqual({ model: raw });
      }
    });

    it('buildVendorSuffix — обратная операция', () => {
      expect(buildVendorSuffix('m', 'baidu')).toBe('m@provider=baidu');
      expect(buildVendorSuffix('m', 'baidu', false)).toBe('m@provider=baidu&allow_fallbacks=false');
      expect(parseVendorSuffix(buildVendorSuffix('m', 'baidu', false))).toEqual({
        model: 'm',
        vendor: 'baidu',
        allowFallbacks: false,
      });
    });
  });

  describe('алиасы provider/gateway и providers/gateways (VL-315)', () => {
    it('старый ключ providers читается как gateways', () => {
      writeSettings({
        providers: { p: { base_url: 'https://old/v1', api_key: 'k' } },
        models: { default: 'p/m', available: { 'p/m': { provider: 'p', model: 'm' } } },
      });
      expect(Object.keys(loadGateways(dir))).toEqual(['p']);
      expect(resolveActiveModel(dir)).toMatchObject({ gatewayId: 'p', model: 'm' });
    });

    it('gateways приоритетнее providers по совпадающим id', () => {
      writeSettings({
        providers: { p: { base_url: 'https://old/v1' } },
        gateways: { p: { base_url: 'https://new/v1' } },
      });
      expect(loadGateways(dir).p.base_url).toBe('https://new/v1');
    });

    it('loadProviders — deprecated-алиас loadGateways', () => {
      writeSettings({ gateways: { p: { base_url: 'https://x/v1' } } });
      expect(loadProviders(dir)).toEqual(loadGateways(dir));
    });

    it('поле provider модели читается как gateway (deprecated)', () => {
      writeSettings({
        gateways: { p: { base_url: 'https://x/v1', api_key: 'k' } },
        models: { default: 'p/m', available: { 'p/m': { provider: 'p', model: 'm' } } },
      });
      expect(loadModels(dir).available['p/m'].gateway).toBe('p');
    });

    it('поле gateway приоритетнее provider', () => {
      writeSettings({
        gateways: { a: { base_url: 'https://a/v1' }, b: { base_url: 'https://b/v1' } },
        models: {
          default: 'a/m',
          available: { 'a/m': { provider: 'a', gateway: 'b', model: 'm' } },
        },
      });
      expect(loadModels(dir).available['a/m'].gateway).toBe('b');
    });

    it('@-хвост в model разбирается при чтении: vendor + чистое имя', () => {
      writeSettings({
        gateways: { routerai: { base_url: 'https://routerai.ru/api/v1', api_key: 'k' } },
        models: {
          default: 'routerai/ds',
          available: {
            'routerai/ds': {
              gateway: 'routerai',
              model: 'deepseek/deepseek-v4.1-flash@provider=baidu&allow_fallbacks=false',
            },
          },
        },
      });
      const conf = loadModels(dir).available['routerai/ds'];
      expect(conf.model).toBe('deepseek/deepseek-v4.1-flash');
      expect(conf.vendor).toBe('baidu');
      expect(resolveActiveModel(dir)).toMatchObject({
        model: 'deepseek/deepseek-v4.1-flash',
        vendor: 'baidu',
      });
    });

    it('структурный vendor приоритетнее @-хвоста, хвост всё равно срезается', () => {
      writeSettings({
        gateways: { g: { base_url: 'https://x/v1', api_key: 'k' } },
        models: {
          default: 'g/m',
          available: { 'g/m': { gateway: 'g', vendor: 'makora', model: 'm@provider=baidu' } },
        },
      });
      const conf = loadModels(dir).available['g/m'];
      expect(conf.vendor).toBe('makora');
      expect(conf.model).toBe('m');
    });

    it('битый vendor (неизвестный апстрим) не ломает загрузку', () => {
      writeSettings({
        gateways: { g: { base_url: 'https://x/v1', api_key: 'k' } },
        models: {
          default: 'g/m',
          available: { 'g/m': { gateway: 'g', vendor: 'no-such-vendor', model: 'm' } },
        },
      });
      expect(validateModelsConfig(dir)).toEqual([]);
      expect(resolveActiveModel(dir).vendor).toBe('no-such-vendor');
    });
  });
});
