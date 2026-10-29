/**
 * Тесты VL-209 — CLI vibelog model / provider.
 *
 * Паттерн config-cli.test.mjs: testDir = mkdtemp вне проекта (VL-241), spawnSync со слиянием
 * stdout/stderr; loopback-сервера в процессе НЕТ — spawnSync безопасен
 * (lesson-51 касается только тестов с сервером в своём процессе).
 *
 * Проверяет: list (маркер * у default), use (запись models.default в
 * settings.json без потери других ключей), current, provider list
 * (без значений ключей), ошибки валидации, env-fallback без секции models.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-model-cli-'));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function runCli(...args) {
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir,
    encoding: 'utf-8',
    timeout: 5000,
    env: { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' },
  });
  return (r.stdout || '') + (r.stderr || '');
}

/** Запись settings.json с секциями providers/models. */
function writeSettings(data) {
  mkdirSync(join(testDir, '.vibelog'), { recursive: true });
  writeFileSync(join(testDir, '.vibelog', 'settings.json'), JSON.stringify(data, null, 2));
}

function readSettings() {
  return JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
}

const baseSettings = () => ({
  providers: {
    routerai: { base_url: 'https://routerai.ru/api/v1', api_key_env: 'VL209_CLI_KEY' },
    cloudru: { base_url: 'https://foundation-models.api.cloud.ru/v1', api_key_env: 'VL209_CLOUD_KEY' },
  },
  models: {
    default: 'routerai/xiaomi/mimo-v2.6-pro',
    available: {
      'routerai/xiaomi/mimo-v2.6-pro': { label: 'MiMo Pro', provider: 'routerai', model: 'xiaomi/mimo-v2.6-pro', api_mode: 'chat' },
      'cloudru/giga-chat': { label: 'GigaChat', provider: 'cloudru', model: 'giga-chat', api_mode: 'responses' },
    },
  },
  git_user_name: 'Tester', // не должен потеряться при model use
});

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  runCli('init', 'Model CLI', '--prefix', 'mdl');
}

describe('VL-209 — CLI model/provider', () => {
  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  it('model list: id, label, провайдеры, маркер * у default', () => {
    fresh();
    writeSettings(baseSettings());
    const out = runCli('model', 'list');
    assert.match(out, /\* routerai\/xiaomi\/mimo-v2\.6-pro — MiMo Pro/);
    assert.match(out, /cloudru\/giga-chat — GigaChat \(provider: cloudru, api_mode: responses\)/);
  });

  it('model use: пишет models.default, сохраняет providers/available/прочие ключи', () => {
    fresh();
    writeSettings(baseSettings());
    const out = runCli('model', 'use', 'cloudru/giga-chat');
    assert.ok(out.includes('cloudru/giga-chat'), out);
    const s = readSettings();
    assert.equal(s.models.default, 'cloudru/giga-chat');
    // read-modify-write: ничего не потерялось
    assert.ok(s.providers.routerai, 'providers сохранены');
    assert.ok(s.models.available['routerai/xiaomi/mimo-v2.6-pro'], 'available сохранён');
    assert.equal(s.git_user_name, 'Tester', 'прочие ключи settings.json сохранены');
    // current отражает переключение
    assert.match(runCli('model', 'current'), /cloudru\/giga-chat/);
  });

  it('model use неизвестного id → ошибка, файл не меняется', () => {
    fresh();
    writeSettings(baseSettings());
    const out = runCli('model', 'use', 'ghost/nope');
    assert.match(out, /Неизвестная модель: ghost\/nope/);
    assert.equal(readSettings().models.default, 'routerai/xiaomi/mimo-v2.6-pro');
  });

  it('model current без models → env-fallback или понятная ошибка', () => {
    fresh();
    const out = runCli('model', 'current');
    // env VIBELOG_LLM_MODEL в тестовом окружении обычно нет → ошибка; с ним — fallback
    assert.ok(
      out.includes('VIBELOG_LLM_MODEL') || out.includes('Модель не задана'),
      `неожиданный вывод: ${out}`
    );
  });

  it('model list без секции models → подсказка про fallback', () => {
    fresh();
    const out = runCli('model', 'list');
    assert.match(out, /Модели не настроены/);
  });

  it('provider list: base_url и статус ключа БЕЗ значений', () => {
    fresh();
    writeSettings(baseSettings());
    const out = runCli('provider', 'list');
    assert.match(out, /routerai: https:\/\/routerai\.ru\/api\/v1 \(env VL209_CLI_KEY, ключ: НЕ ЗАДАН\)/);
    assert.match(out, /cloudru: https:\/\/foundation-models\.api\.cloud\.ru\/v1/);
    // секретоподобные значения не выводятся
    assert.ok(!out.includes('plain-key'));
  });

  it('unknown подкоманда → подсказка с list/use/current', () => {
    fresh();
    const out = runCli('model', 'bogus');
    assert.match(out, /Неизвестная подкоманда/);
    assert.match(out, /list, use <id>, current/);
  });
});
