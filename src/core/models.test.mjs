/**
 * Тесты реестра LLM-моделей/провайдеров (VL-209): чтение секций
 * settings.json, резолв активной модели, валидация конфига.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadProviders,
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
    providers: {
      routerai: { base_url: 'https://routerai.ru/api/v1', api_key_env: 'TEST_ROUTER_KEY' },
      direct: { base_url: 'https://example.com/v1', api_key: 'plain-key' },
    },
    models: {
      default: 'routerai/Some/Model',
      available: {
        'routerai/Some/Model': {
          label: 'Some Model',
          provider: 'routerai',
          model: 'Some/Model',
          api_mode: 'responses',
          pricing: { input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 },
        },
        'direct/plain': { provider: 'direct', model: 'plain-model' },
      },
    },
  });

  describe('loadProviders/loadModels', () => {
    it('нет файла settings → пустые секции (не падает)', () => {
      expect(loadProviders(dir)).toEqual({});
      expect(loadModels(dir)).toEqual({ available: {} });
    });

    it('битый JSON → пустые секции (паттерн loadSettings)', () => {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'settings.json'), '{oops');
      expect(loadProviders(dir)).toEqual({});
      expect(loadModels(dir)).toEqual({ available: {} });
    });

    it('провайдер без base_url отбрасывается, корректный — остаётся', () => {
      writeSettings({
        providers: { bad: { api_key_env: 'X' }, good: { base_url: 'https://ok/v1' } },
      });
      expect(Object.keys(loadProviders(dir))).toEqual(['good']);
    });

    it('модель без provider/model отбрасывается, api_mode/парынги парсятся', () => {
      writeSettings(fullSettings());
      const models = loadModels(dir);
      expect(models.default).toBe('routerai/Some/Model');
      expect(models.available['routerai/Some/Model']).toEqual({
        label: 'Some Model',
        provider: 'routerai',
        model: 'Some/Model',
        api_mode: 'responses',
        pricing: { input_per_1m: 1.2, output_per_1m: 6, cache_per_1m: 0.3 },
      });
      expect(models.available['direct/plain'].api_mode).toBeUndefined();
    });
  });

  describe('resolveActiveModel', () => {
    it('нет секции models → null (env-fallback)', () => {
      writeSettings({ providers: { x: { base_url: 'https://x/v1' } } });
      expect(resolveActiveModel(dir)).toBeNull();
    });

    it('полный резолв: id/label/wire-имя/apiMode/baseUrl', () => {
      writeSettings(fullSettings());
      const active = resolveActiveModel(dir);
      expect(active).toMatchObject({
        id: 'routerai/Some/Model',
        label: 'Some Model',
        providerId: 'routerai',
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
      delete s.providers.routerai;
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

    it('провайдер не в providers → ошибка', () => {
      const s = fullSettings();
      delete s.providers.routerai;
      writeSettings(s);
      const errors = validateModelsConfig(dir);
      expect(errors[0]).toMatch(/провайдер "routerai"/);
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
});
