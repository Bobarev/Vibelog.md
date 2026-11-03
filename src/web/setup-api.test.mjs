/**
 * Тесты REST API wizard-а настройки проекта (VL-210).
 *
 * handleSetupApi вызывается напрямую (без HTTP-сервера): GET отдаёт состояние
 * без секретов, POST применяет ответы через общее ядро core/setup.ts.
 * Сеть не используется (ping/check-bot проверяются в setup-check.test.mjs).
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleSetupApi, parseSetupBody } from '../../dist/web/setup-api.js';

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

describe('VL-210 — REST API /api/setup', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('GET /api/setup отдаёт состояние без значений секретов', () => {
    mkdirSync(join(testDir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(testDir, '.vibelog', 'settings.json'),
      JSON.stringify({
        gateways: { p1: { base_url: 'https://api.example/v1', api_key_env: 'P1_KEY' } },
        env: { TELEGRAM_BOT_TOKEN: 'super-secret' },
      }),
      'utf-8',
    );
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
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.deepEqual(settings.chats, [42]);
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
