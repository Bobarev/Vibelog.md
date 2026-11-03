/**
 * Тесты записи моделей через REST API (VL-316, AC7–AC12, AC16).
 *
 * - POST /api/models — добавление с валидацией до записи (неизвестный шлюз,
 *   пустое имя, дубль id → 400, файл не меняется);
 * - PUT /api/models/:id — редактирование, в т.ч. смена id и перенос default;
 * - DELETE /api/models/:id — защита models.default и моделей из мет сессий;
 * - ленивая нормализация старой записи (`provider` + `@`-хвост) при
 *   сохранении: в файл уходят gateway/чистый model/vendor.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-models-crud-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
});

function readSettingsFile() {
  return JSON.parse(readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'));
}

function writeSettingsFile(data) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

const baseSettings = () => ({
  gateways: {
    routerai: { base_url: 'https://routerai.ru/api/v1', api_key_env: 'VL316_KEY' },
  },
  models: {
    default: 'routerai/mimo/pro',
    available: {
      'routerai/mimo/pro': { label: 'MiMo Pro', gateway: 'routerai', model: 'mimo/pro', api_mode: 'chat' },
    },
  },
  env: { TELEGRAM_BOT_TOKEN: 'secret' },
});

/** Мета сессии агента с закреплённой моделью (VL-239). */
function writeSessionMeta(sessionId, meta) {
  const dir = join(cwd, '.vibelog', 'agent-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.meta.json`), JSON.stringify(meta), 'utf-8');
}

describe('POST /api/models — добавление (AC7/AC8/AC12)', () => {
  it('валидная запись → 201, структурная запись в settings.json', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi(
      'POST',
      '/api/models',
      {
        label: 'DeepSeek Chat',
        gateway: 'routerai',
        model: 'deepseek/deepseek-chat',
        vendor: 'baidu',
        api_mode: 'responses',
        pricing: { input_per_1m: 20, output_per_1m: 60, cache_per_1m: 3 },
        context_window: 131072,
      },
      cwd,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.id, 'routerai/deepseek/deepseek-chat/@baidu');
    const stored = readSettingsFile().models.available['routerai/deepseek/deepseek-chat/@baidu'];
    assert.deepEqual(stored, {
      label: 'DeepSeek Chat',
      gateway: 'routerai',
      vendor: 'baidu',
      model: 'deepseek/deepseek-chat',
      api_mode: 'responses',
      context_window: 131072,
      pricing: { input_per_1m: 20, output_per_1m: 60, cache_per_1m: 3 },
    });
    // Прежние ключи settings.json сохранены
    assert.equal(readSettingsFile().env.TELEGRAM_BOT_TOKEN, 'secret');
    assert.ok(readSettingsFile().gateways.routerai);
  });

  it('ответ содержит свежий реестр (страница не делает второй запрос)', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi(
      'POST',
      '/api/models',
      { gateway: 'routerai', model: 'x/y' },
      cwd,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.models.available.length, 2);
    assert.ok(res.body.models.available.some((m) => m.id === 'routerai/x/y'));
  });

  it('неизвестный шлюз → 400, файл не меняется', () => {
    writeSettingsFile(baseSettings());
    const before = readSettingsFile();
    const res = handleApi('POST', '/api/models', { gateway: 'ghost', model: 'a/b' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Неизвестный шлюз/);
    assert.deepEqual(readSettingsFile(), before);
  });

  it('пустое имя модели → 400', () => {
    writeSettingsFile(baseSettings());
    for (const model of ['', '   ', '@/@']) {
      const res = handleApi('POST', '/api/models', { gateway: 'routerai', model }, cwd);
      assert.equal(res.status, 400, `model=${JSON.stringify(model)}`);
    }
  });

  it('дубль id → 400 (вторая запись не перезаписывает первую)', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi('POST', '/api/models', { gateway: 'routerai', model: 'mimo/pro' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /уже есть/);
    assert.deepEqual(readSettingsFile().models.available['routerai/mimo/pro'], {
      label: 'MiMo Pro',
      gateway: 'routerai',
      model: 'mimo/pro',
      api_mode: 'chat',
    });
  });

  it('невалидные типы (api_mode, pricing, context_window, тело) → 400', () => {
    writeSettingsFile(baseSettings());
    const cases = [
      { gateway: 'routerai', model: 'a/b', api_mode: 'xml' },
      { gateway: 'routerai', model: 'a/b', pricing: { input_per_1m: -1, output_per_1m: 0, cache_per_1m: 0 } },
      { gateway: 'routerai', model: 'a/b', pricing: { input_per_1m: 'abc' } },
      { gateway: 'routerai', model: 'a/b', context_window: 0 },
      { gateway: 'routerai', model: 'a/b', context_window: 'big' },
      { model: 'a/b' },
      { gateway: 42, model: 'a/b' },
    ];
    for (const body of cases) {
      const res = handleApi('POST', '/api/models', body, cwd);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(Object.keys(readSettingsFile().models.available), ['routerai/mimo/pro']);
  });
});

describe('PUT /api/models/:id — редактирование (AC9/AC11)', () => {
  it('меняет label/цену, сохраняя остальные поля', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi(
      'PUT',
      '/api/models/routerai%2Fmimo%2Fpro',
      { label: 'MiMo Pro Max', gateway: 'routerai', model: 'mimo/pro', api_mode: 'chat' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'routerai/mimo/pro');
    assert.equal(readSettingsFile().models.available['routerai/mimo/pro'].label, 'MiMo Pro Max');
  });

  it('смена вендора переносит запись и ведёт за собой models.default', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi(
      'PUT',
      '/api/models/routerai%2Fmimo%2Fpro',
      { label: 'MiMo Pro', gateway: 'routerai', model: 'mimo/pro', vendor: 'baidu' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'routerai/mimo/pro/@baidu');
    const settings = readSettingsFile();
    assert.equal(settings.models.available['routerai/mimo/pro'], undefined, 'старый ключ убран');
    assert.ok(settings.models.available['routerai/mimo/pro/@baidu']);
    assert.equal(settings.models.default, 'routerai/mimo/pro/@baidu', 'default последовал за id');
  });

  it('несуществующий id → 404', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi('PUT', '/api/models/ghost%2Fx', { gateway: 'routerai', model: 'x' }, cwd);
    assert.equal(res.status, 404);
  });

  it('переименование в занятый id → 400, файл не меняется', () => {
    writeSettingsFile(baseSettings());
    handleApi('POST', '/api/models', { gateway: 'routerai', model: 'other/model' }, cwd);
    const before = readSettingsFile();
    const res = handleApi(
      'PUT',
      '/api/models/routerai%2Fmimo%2Fpro',
      { gateway: 'routerai', model: 'other/model' },
      cwd,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /уже есть/);
    assert.deepEqual(readSettingsFile(), before);
  });

  it('запись остаётся доступной для записи саму себя (excludeId)', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi(
      'PUT',
      '/api/models/routerai%2Fmimo%2Fpro',
      { gateway: 'routerai', model: 'mimo/pro', label: 'Тот же id' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'routerai/mimo/pro');
  });
});

describe('DELETE /api/models/:id — удаление с защитой (AC10, риск R3)', () => {
  it('models.default удалить нельзя → 409 с причиной', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi('DELETE', '/api/models/routerai%2Fmimo%2Fpro', null, cwd);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /models\.default/);
    assert.ok(readSettingsFile().models.available['routerai/mimo/pro'], 'запись осталась');
  });

  it('модель, закреплённая за сессией агента, удалить нельзя → 409', () => {
    const settings = baseSettings();
    settings.models.available['routerai/other/m'] = { gateway: 'routerai', model: 'other/m' };
    writeSettingsFile(settings);
    writeSessionMeta('sess-abc', {
      cwd,
      taskId: 'VL-999',
      model_id: 'routerai/other/m',
      model_gateway: 'routerai',
      model_name: 'other/m',
    });
    const res = handleApi('DELETE', '/api/models/routerai%2Fother%2Fm', null, cwd);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /sess-abc/);
    assert.match(res.body.error, /VL-999/);
    assert.match(res.body.error, /resume/);
    assert.ok(readSettingsFile().models.available['routerai/other/m']);
  });

  it('мета со старым именем model_provider тоже учитывается', () => {
    const settings = baseSettings();
    settings.models.available['routerai/other/m'] = { gateway: 'routerai', model: 'other/m' };
    writeSettingsFile(settings);
    writeSessionMeta('sess-old', {
      cwd,
      model_id: 'routerai/other/m',
      model_provider: 'routerai',
      model_name: 'other/m',
    });
    const res = handleApi('DELETE', '/api/models/routerai%2Fother%2Fm', null, cwd);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /sess-old/);
  });

  it('свободная модель удаляется → 200, запись убрана', () => {
    const settings = baseSettings();
    settings.models.available['routerai/free/m'] = { gateway: 'routerai', model: 'free/m' };
    writeSettingsFile(settings);
    const res = handleApi('DELETE', '/api/models/routerai%2Ffree%2Fm', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(readSettingsFile().models.available['routerai/free/m'], undefined);
    assert.ok(readSettingsFile().models.available['routerai/mimo/pro'], 'default на месте');
  });

  it('несуществующая модель → 404', () => {
    writeSettingsFile(baseSettings());
    const res = handleApi('DELETE', '/api/models/ghost%2Fx', null, cwd);
    assert.equal(res.status, 404);
  });
});

describe('ленивая нормализация старой записи (AC11)', () => {
  it('provider + @-хвост читаются, при сохранении пишутся структурно', () => {
    writeSettingsFile({
      providers: { routerai: { base_url: 'https://routerai.ru/api/v1' } },
      models: {
        default: 'routerai/ds/flash@baidu',
        available: {
          'routerai/ds/flash@baidu': {
            label: 'DeepSeek Flash',
            provider: 'routerai',
            model: 'ds/flash@provider=baidu&allow_fallbacks=false',
          },
        },
      },
    });

    // Чтение: старый формат нормализуется (provider → gateway, хвост → vendor)
    const got = handleApi('GET', '/api/models', null, cwd);
    assert.equal(got.status, 200);
    const model = got.body.available[0];
    assert.equal(model.gateway, 'routerai');
    assert.equal(model.model, 'ds/flash');
    assert.equal(model.vendor, 'baidu');

    // Сохранение из UI: запись становится структурной
    const res = handleApi(
      'PUT',
      '/api/models/routerai%2Fds%2Fflash%40baidu',
      { label: 'DeepSeek Flash', gateway: 'routerai', model: 'ds/flash', vendor: 'baidu' },
      cwd,
    );
    assert.equal(res.status, 200);
    const stored = readSettingsFile().models.available['routerai/ds/flash/@baidu'];
    assert.equal(stored.gateway, 'routerai');
    assert.equal(stored.vendor, 'baidu');
    assert.equal(stored.model, 'ds/flash', 'в файле нет @-хвоста');
    assert.equal(stored.provider, undefined, 'старое поле provider не пишется');
  });

  it('вендор входит в id: две записи одной модели не перезаписывают друг друга', () => {
    writeSettingsFile(baseSettings());
    const first = handleApi(
      'POST',
      '/api/models',
      { gateway: 'routerai', model: 'deepseek/deepseek-chat', vendor: 'baidu', pricing: { input_per_1m: 20, output_per_1m: 60, cache_per_1m: 0 } },
      cwd,
    );
    const second = handleApi(
      'POST',
      '/api/models',
      { gateway: 'routerai', model: 'deepseek/deepseek-chat', vendor: 'deepseek', pricing: { input_per_1m: 33, output_per_1m: 93, cache_per_1m: 0 } },
      cwd,
    );
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const available = readSettingsFile().models.available;
    assert.equal(available['routerai/deepseek/deepseek-chat/@baidu'].pricing.input_per_1m, 20);
    assert.equal(available['routerai/deepseek/deepseek-chat/@deepseek'].pricing.input_per_1m, 33);
  });
});

describe('GET /api/models — поля для страницы «Модели» (AC7/AC13/AC15)', () => {
  it('отдаёт model, pricing и context_window', () => {
    const settings = baseSettings();
    settings.models.available['routerai/mimo/pro'].pricing = {
      input_per_1m: 1,
      output_per_1m: 2,
      cache_per_1m: 0.1,
    };
    settings.models.available['routerai/mimo/pro'].context_window = 262144;
    writeSettingsFile(settings);
    const res = handleApi('GET', '/api/models', null, cwd);
    const m = res.body.available[0];
    assert.equal(m.model, 'mimo/pro');
    assert.equal(m.context_window, 262144);
    assert.deepEqual(m.pricing, { input_per_1m: 1, output_per_1m: 2, cache_per_1m: 0.1 });
  });
});
