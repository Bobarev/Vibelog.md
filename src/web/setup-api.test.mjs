/**
 * Тесты REST API wizard-а настройки проекта (VL-210): GET отдаёт состояние
 * без секретов, POST применяет ответы через общее ядро core/setup.ts.
 *
 * VL-328 добавил в API возможности, которые до этого были только у
 * консольного wizard-а (VL-324/327): пресеты шлюзов в GET, локации секретов
 * без legacy-пунктов, факт наличия TELEGRAM_PROXY, валидация base_url,
 * вывод id шлюза из домена, подтверждение перезаписи секретов и перечитывание
 * env после записи — эти тесты идут отдельным блоком ниже.
 *
 * handleSetupApi вызывается напрямую (без HTTP-сервера). Сеть не используется
 * (ping/check-bot проверяются в setup-check.test.mjs).
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleSetupApi, parseSetupBody } from '../../dist/web/setup-api.js';
import { loadProjectEnv } from '../../dist/bot/env.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-setup-api-'));

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** Валидное тело POST /api/setup. */
function body(over = {}) {
  return {
    mode: 'fresh',
    projectName: 'API Project',
    prefix: 'AP',
    agents: [],
    secretsLocation: 'env',
    mcp: false,
    ...over,
  };
}

/** Пишет минимальный settings.json в тестовый проект. */
function writeSettings(settings) {
  mkdirSync(join(testDir, '.vibelog'), { recursive: true });
  writeFileSync(join(testDir, '.vibelog', 'settings.json'), JSON.stringify(settings), 'utf-8');
}

describe('VL-210 — REST API /api/setup', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('GET /api/setup отдаёт состояние без значений секретов', () => {
    writeSettings({
      gateways: { p1: { base_url: 'https://api.example/v1', api_key_env: 'P1_KEY' } },
      env: { TELEGRAM_BOT_TOKEN: 'super-secret' },
    });
    const res = handleSetupApi('GET', '/api/setup', null, testDir);
    assert.equal(res.status, 200);
    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes('super-secret'), 'значение секрета не должно утекать');
    assert.equal(res.body.mode, 'fresh');
    assert.equal(res.body.gateways[0].id, 'p1');
    assert.equal(res.body.gateways[0].api_key_env, 'P1_KEY');
    assert.equal(typeof res.body.gateways[0].keySet, 'boolean');
    assert.ok(Array.isArray(res.body.agents));
  });

  it('GET /api/setup в upgrade-режиме отдаёт текущие значения', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: Old\ntask_prefix: OLD\n', 'utf-8');
    const res = handleSetupApi('GET', '/api/setup', null, testDir);
    assert.equal(res.body.mode, 'upgrade');
    assert.equal(res.body.projectName, 'Old');
    assert.equal(res.body.prefix, 'OLD');
  });

  it('POST /api/setup создаёт проект (fresh)', () => {
    const res = handleSetupApi('POST', '/api/setup', body(), testDir);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(existsSync(join(testDir, 'backlog', 'config.yml')));
    assert.ok(existsSync(join(testDir, 'AGENTS.md')));
  });

  it('POST /api/setup в upgrade не меняет задачи', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: Old\ntask_prefix: OLD\n', 'utf-8');
    const taskPath = join(testDir, 'backlog', 'tasks', 'OLD-1 - Задача.md');
    writeFileSync(taskPath, '---\nid: OLD-1\n---\n\n# Задача\n', 'utf-8');
    const before = readFileSync(taskPath, 'utf-8');

    const res = handleSetupApi('POST', '/api/setup', body({ mode: 'upgrade', projectName: 'Old', prefix: 'OLD' }), testDir);
    assert.equal(res.status, 200);
    assert.equal(readFileSync(taskPath, 'utf-8'), before);
  });

  it('POST /api/setup: пустое имя → 400', () => {
    const res = handleSetupApi('POST', '/api/setup', body({ projectName: '  ' }), testDir);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('projectName'), res.body.error);
  });

  it('POST /api/setup: неверный prefix → 400', () => {
    const res = handleSetupApi('POST', '/api/setup', body({ prefix: '1bad' }), testDir);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('prefix'), res.body.error);
  });

  it('POST /api/setup: неизвестный агент → 400', () => {
    const res = handleSetupApi('POST', '/api/setup', body({ agents: ['gpt'] }), testDir);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('gpt'), res.body.error);
  });

  it('POST /api/setup: неверный secretsLocation → 400', () => {
    const res = handleSetupApi('POST', '/api/setup', body({ secretsLocation: 'vault' }), testDir);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('secretsLocation'), res.body.error);
  });

  it('POST /api/setup: провайдер без base_url и без записи в settings → 400', () => {
    const res = handleSetupApi('POST', '/api/setup', body({ gateway: { id: 'unknown' } }), testDir);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('не найден'), res.body.error);
  });

  it('POST /api/setup: неверный api_mode → 400', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({ model: { id: 'm1', gateway: 'p1', model: 'm1', api_mode: 'grpc' } }),
      testDir,
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('api_mode'), res.body.error);
  });

  it('POST /api/setup: defaultAgent вне выбранных агентов → 400', () => {
    const res = handleSetupApi('POST', '/api/setup', body({ agents: ['qwen'], defaultAgent: 'vb' }), testDir);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('defaultAgent'), res.body.error);
  });

  it('POST /api/setup пишет секреты в .env и не возвращает значения', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({ bot: { token: 'bot-secret-token', chats: [42] } }),
      testDir,
    );
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes('bot-secret-token'), 'значение токена не в ответе');
    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_BOT_TOKEN=bot-secret-token'), env);
    // VL-329: chat_id — личная привязка, пишется в .env (TELEGRAM_CHAT_IDS)
    assert.ok(env.includes('TELEGRAM_CHAT_IDS=42'), env);
    const settingsRaw = readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8');
    assert.ok(!settingsRaw.includes('chats'), 'chats не попадают в settings.json');
    assert.ok(!settingsRaw.includes('bot-secret-token'), 'секретов в settings.json нет');
  });

  it('неизвестный URL → null (маршрутизация продолжается)', () => {
    assert.equal(handleSetupApi('GET', '/api/tasks', null, testDir), null);
  });

  it('неподдерживаемый метод → 405', () => {
    const res = handleSetupApi('DELETE', '/api/setup', null, testDir);
    assert.equal(res.status, 405);
  });

  it('parseSetupBody: mode по умолчанию — из состояния проекта', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: X\ntask_prefix: X\n', 'utf-8');
    const parsed = parseSetupBody({ projectName: 'X', prefix: 'X' }, testDir);
    assert.equal(parsed.answers.mode, 'upgrade');
  });
});

describe('VL-328 — веб-мастер догнал CLI-wizard', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('AC1: GET отдаёт пресеты шлюзов из ядра', () => {
    const res = handleSetupApi('GET', '/api/setup', null, testDir);
    assert.equal(res.status, 200);
    const presets = res.body.gatewayPresets;
    assert.ok(Array.isArray(presets));
    assert.deepEqual(presets.map((p) => p.id), ['routerai', 'selectel_router', 'openai_compatible']);
    assert.equal(presets[0].base_url, 'https://routerai.ru/api/v1');
    assert.equal(presets[0].api_key_env, 'ROUTERAI_API_KEY');
    assert.equal(presets[0].catalog, true);
    assert.equal(presets[1].base_url, 'https://api.selectel.ru/aig/v1');
    // custom: своего base_url нет, id выводится из домена
    assert.equal(presets[2].base_url, null);
    assert.equal(presets[2].custom, true);
  });

  it('AC5: GET предлагает ровно две локации секретов (без settings/both)', () => {
    const res = handleSetupApi('GET', '/api/setup', null, testDir);
    const locations = res.body.secretsLocations;
    assert.deepEqual(locations.map((l) => l.id), ['system', 'env']);
    assert.ok(locations[0].label.includes('env'), locations[0].label);
    assert.ok(locations[1].label.includes('.env'), locations[1].label);
  });

  it('VL-329: legacy-локации settings/both отвергаются (секция env удалена)', () => {
    for (const loc of ['settings', 'both']) {
      fresh();
      const res = handleSetupApi('POST', '/api/setup', body({ secretsLocation: loc }), testDir);
      assert.equal(res.status, 400, `${loc}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.error.includes('secretsLocation'), res.body.error);
    }
  });

  it('AC6: GET отдаёт факт наличия прокси без значения', () => {
    const saved = process.env.TELEGRAM_PROXY;
    process.env.TELEGRAM_PROXY = 'http://127.0.0.1:7070';
    try {
      const res = handleSetupApi('GET', '/api/setup', null, testDir);
      assert.equal(res.body.bot.proxySet, true);
      assert.ok(
        !JSON.stringify(res.body).includes('127.0.0.1:7070'),
        'значение прокси не должно утекать',
      );
    } finally {
      if (saved === undefined) delete process.env.TELEGRAM_PROXY;
      else process.env.TELEGRAM_PROXY = saved;
    }
  });

  it('AC6: POST принимает bot.proxy и пишет TELEGRAM_PROXY в .env', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({ bot: { token: 't:1', chats: [], proxy: 'http://127.0.0.1:7070' } }),
      testDir,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_PROXY'), env);
    assert.ok(env.includes('127.0.0.1:7070'), env);
  });

  it('AC6: пустой bot.proxy не создаёт ключ TELEGRAM_PROXY', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({ bot: { token: 't:1', chats: [], proxy: '' } }),
      testDir,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const envPath = join(testDir, '.env');
    const env = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
    assert.ok(!env.includes('TELEGRAM_PROXY'), `пустой прокси не пишется: ${env}`);
  });

  it('AC1: POST с пресетом берёт base_url и api_key_env из ядра', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({
        agents: ['vb'],
        gateway: { id: 'routerai', preset: 'routerai', base_url: '' },
        model: { id: 'deepseek/deepseek-chat', gateway: 'routerai', model: 'deepseek/deepseek-chat', api_mode: 'responses' },
      }),
      testDir,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.gateways.routerai.base_url, 'https://routerai.ru/api/v1');
    assert.equal(settings.gateways.routerai.api_key_env, 'ROUTERAI_API_KEY');
    assert.equal(settings.models.available['deepseek/deepseek-chat'].api_mode, 'responses');
  });

  it('AC1: unknown preset → 400 с перечнем допустимых', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({ gateway: { id: 'x', preset: 'nope', base_url: 'https://x.dev/v1' } }),
      testDir,
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('preset'), res.body.error);
    assert.ok(res.body.error.includes('routerai'), res.body.error);
  });

  it('AC1: custom шлюз — id выводится из домена', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({
        agents: ['vb'],
        gateway: { preset: 'openai_compatible', id: '', base_url: 'https://api.cloud.ru/aig/v1' },
        model: { id: 'm1', gateway: 'cloud_ru', model: 'm1', api_mode: 'responses' },
      }),
      testDir,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.ok(settings.gateways.cloud_ru, JSON.stringify(settings.gateways));
    assert.equal(settings.gateways.cloud_ru.base_url, 'https://api.cloud.ru/aig/v1');
    assert.equal(settings.gateways.cloud_ru.api_key_env, 'CLOUD_RU_API_KEY');
  });

  it('AC1: custom без base_url → 400', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({ gateway: { preset: 'openai_compatible', base_url: '' } }),
      testDir,
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('base_url'), res.body.error);
  });

  it('AC1: битый base_url (не http(s)) → 400', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({ gateway: { preset: 'openai_compatible', base_url: 'ftp://example.com/v1' } }),
      testDir,
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('base_url'), res.body.error);
  });

  it('AC3: POST принимает model.vendor и пишет его в available', () => {
    const res = handleSetupApi(
      'POST',
      '/api/setup',
      body({
        agents: ['vb'],
        gateway: { id: 'routerai', preset: 'routerai', base_url: '' },
        model: {
          id: 'deepseek/deepseek-chat',
          gateway: 'routerai',
          vendor: 'baidu',
          model: 'deepseek/deepseek-chat',
          api_mode: 'responses',
        },
      }),
      testDir,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.models.available['deepseek/deepseek-chat'].vendor, 'baidu');
  });

  it('AC7: без secretsOverwrite существующий секрет пропускается, с флагом — перезаписывается', () => {
    // Первый POST задаёт ключ
    handleSetupApi(
      'POST',
      '/api/setup',
      body({ bot: { token: 'old-token', chats: [] } }),
      testDir,
    );
    assert.ok(readFileSync(join(testDir, '.env'), 'utf-8').includes('old-token'));

    // Второй POST без подтверждения — значение не меняется
    const noOverwrite = handleSetupApi(
      'POST',
      '/api/setup',
      body({ bot: { token: 'new-token', chats: [] } }),
      testDir,
    );
    assert.equal(noOverwrite.status, 200);
    assert.ok(
      noOverwrite.body.skipped.some((s) => s.includes('TELEGRAM_BOT_TOKEN')),
      JSON.stringify(noOverwrite.body),
    );
    assert.ok(readFileSync(join(testDir, '.env'), 'utf-8').includes('old-token'));

    // С подтверждением — значение заменяется
    const overwrite = handleSetupApi(
      'POST',
      '/api/setup',
      body({ bot: { token: 'new-token', chats: [] }, secretsOverwrite: true }),
      testDir,
    );
    assert.equal(overwrite.status, 200);
    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('new-token'), env);
    assert.ok(!env.includes('old-token'), env);
    assert.ok(!JSON.stringify(overwrite.body).includes('new-token'), 'значение ключа не в ответе');
  });

  it('AC8: после POST ключ из .env попадает в окружение процесса', () => {
    // Изоляция от окружения агентской сессии: реальный ROUTERAI_API_KEY в
    // shell перекрыл бы файловое значение (VL-143) и тест стал бы плавающим
    const saved = process.env.ROUTERAI_API_KEY;
    delete process.env.ROUTERAI_API_KEY;
    try {
      const res = handleSetupApi(
        'POST',
        '/api/setup',
        body({
          agents: ['vb'],
          gateway: { id: 'routerai', preset: 'routerai', base_url: '', apiKey: 'routerai-secret' },
          model: { id: 'm1', gateway: 'routerai', model: 'm1', api_mode: 'responses' },
        }),
        testDir,
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      // Без перечитывания env ping LLM уходил без Authorization (ложный 401)
      assert.equal(process.env.ROUTERAI_API_KEY, 'routerai-secret');
      assert.ok(!JSON.stringify(res.body).includes('routerai-secret'));
    } finally {
      if (saved === undefined) delete process.env.ROUTERAI_API_KEY;
      else process.env.ROUTERAI_API_KEY = saved;
    }
  });

  it('AC8: перечитывание env обновляет значение, загруженное ранее из .env', () => {
    const saved = process.env.ROUTERAI_API_KEY;
    delete process.env.ROUTERAI_API_KEY;
    try {
      // Имитируем сервер, который уже загрузил .env при старте (VL-143):
      // loadProjectEnv регистрирует ключ как «файловый» и кладёт в process.env
      writeFileSync(join(testDir, '.env'), 'ROUTERAI_API_KEY=stale-value\n', 'utf-8');
      loadProjectEnv(testDir);
      assert.equal(process.env.ROUTERAI_API_KEY, 'stale-value');

      const res = handleSetupApi(
        'POST',
        '/api/setup',
        body({
          agents: ['vb'],
          gateway: { id: 'routerai', preset: 'routerai', base_url: '', apiKey: 'fresh-value' },
          model: { id: 'm1', gateway: 'routerai', model: 'm1', api_mode: 'responses' },
          secretsOverwrite: true,
        }),
        testDir,
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(
        process.env.ROUTERAI_API_KEY,
        'fresh-value',
        'устаревшее значение должно обновиться',
      );
    } finally {
      if (saved === undefined) delete process.env.ROUTERAI_API_KEY;
      else process.env.ROUTERAI_API_KEY = saved;
    }
  });
});