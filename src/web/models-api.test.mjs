/**
 * Тесты REST API реестра моделей (VL-209): GET/PUT /api/models.
 *
 * - GET отдаёт default/available/providers с keySet (БЕЗ значений ключей);
 * - PUT валидирует id (400 на мусор, файл не меняется), пишет models.default,
 *   сохраняя providers/env/прочие ключи (read-modify-write);
 * - битые/отсутствующие секции → пустые списки, без исключений.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';

let cwd;

/** Прямое чтение settings.json с диска. */
function readSettingsFile() {
  return JSON.parse(readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'));
}

/** Прямая запись settings.json (подготовка данных). */
function writeSettingsFile(data) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

const baseSettings = () => ({
  providers: {
    routerai: { base_url: 'https://routerai.ru/api/v1', api_key_env: 'VL209_API_KEY_TEST' },
    direct: { base_url: 'https://example.com/v1', api_key: 'direct-plain-key' },
  },
  models: {
    default: 'routerai/MiMo/Pro',
    available: {
      'routerai/MiMo/Pro': { label: 'MiMo Pro', provider: 'routerai', model: 'MiMo/Pro', api_mode: 'chat' },
      'direct/plain': { provider: 'direct', model: 'plain' },
    },
  },
  env: { TELEGRAM_BOT_TOKEN: 'secret-token-xyz' },
  git_user_name: 'Tester',
});

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-models-api-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
});

describe('GET /api/models (VL-209)', () => {
  it('отдаёт default, available (id/label/provider/api_mode) и providers с keySet', () => {
    writeSettingsFile(baseSettings());
    process.env.VL209_API_KEY_TEST = 'from-env';
    try {
      const res = handleApi('GET', '/api/models', null, cwd);
      assert.equal(res.status, 200);
      assert.equal(res.body.default, 'routerai/MiMo/Pro');
      assert.deepEqual(res.body.available, [
        { id: 'routerai/MiMo/Pro', label: 'MiMo Pro', provider: 'routerai', api_mode: 'chat' },
        { id: 'direct/plain', label: 'direct/plain', provider: 'direct', api_mode: 'chat' },
      ]);
      const router = res.body.providers.find(p => p.id === 'routerai');
      assert.equal(router.base_url, 'https://routerai.ru/api/v1');
      assert.equal(router.keySet, true, 'ключ из env задан');
      const direct = res.body.providers.find(p => p.id === 'direct');
      assert.equal(direct.keySet, true, 'прямой api_key считается заданным');
    } finally {
      delete process.env.VL209_API_KEY_TEST;
    }
  });

  it('НЕ отдаёт значения ключей и env-секцию (секреты)', () => {
    writeSettingsFile(baseSettings());
    // env-переменная не задана → keySet false, но значения всё равно нет
    const res = handleApi('GET', '/api/models', null, cwd);
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('direct-plain-key'), 'api_key не отдан');
    assert.ok(!raw.includes('secret-token-xyz'), 'токен не отдан');
    assert.ok(!raw.includes('VL209_API_KEY_TEST'), 'имя env-переменной не отдано'); 
    assert.equal(res.body.providers.find(p => p.id === 'routerai').keySet, false);
  });

  it('без секций → default null, пустые списки (не падает)', () => {
    writeSettingsFile({ git_user_name: 'X' });
    const res = handleApi('GET', '/api/models', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.default, null);
    assert.deepEqual(res.body.available, []);
    assert.deepEqual(res.body.providers, []);
  });

  it('отдаёт description модели, если задано (VL-265), и не добавляет пустой ключ', () => {
    const settings = baseSettings();
    settings.models.available['routerai/MiMo/Pro'].description = 'Быстрая модель для чата';
    writeSettingsFile(settings);
    const res = handleApi('GET', '/api/models', null, cwd);
    assert.equal(res.status, 200);
    const withDesc = res.body.available.find(m => m.id === 'routerai/MiMo/Pro');
    assert.equal(withDesc.description, 'Быстрая модель для чата');
    const withoutDesc = res.body.available.find(m => m.id === 'direct/plain');
    assert.equal('description' in withoutDesc, false, 'без description ключ отсутствует');
  });
});

describe('PUT /api/models (VL-209)', () => {
  it('валидный id → 200, models.default записан, прочие ключи сохранены', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi('PUT', '/api/models', { default: 'direct/plain' }, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.default, 'direct/plain');
    const s = readSettingsFile();
    assert.equal(s.models.default, 'direct/plain');
    assert.ok(s.providers.routerai, 'providers сохранены');
    assert.equal(s.env.TELEGRAM_BOT_TOKEN, 'secret-token-xyz', 'env-секция сохранена');
    assert.equal(s.git_user_name, 'Tester');
  });

  it('неизвестный id → 400, файл не меняется', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi('PUT', '/api/models', { default: 'ghost/nope' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Неизвестная модель/);
    assert.equal(readSettingsFile().models.default, 'routerai/MiMo/Pro');
  });

  it('не строка / пустая строка → 400', () => {
    writeSettingsFile(baseSettings());
    for (const bad of [null, 42, '']) {
      const res = handleApi('PUT', '/api/models', { default: bad }, cwd);
      assert.equal(res.status, 400, `default=${JSON.stringify(bad)} → 400`);
    }
    assert.equal(readSettingsFile().models.default, 'routerai/MiMo/Pro');
  });
});
