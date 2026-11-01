/**
 * Тесты VL-286 — хелпер env для спавнов CLI/MCP в тестах.
 *
 * Проверяет, что унаследованный фазовый env агентской сессии снимается,
 * а явно переданные значения (`extra`) накладываются поверх очистки.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

import { testSpawnEnv, stripVibelogEnv } from './test-env.mjs';

/** Ключи, которые тест выставляет в process.env и обязан убрать после себя. */
const KEYS = [
  'VIBELOG_CWD',
  'VIBELOG_SESSION_ID',
  'VIBELOG_PHASE_NAME',
  'VIBELOG_PHASE_TASK_ID',
  'VIBELOG_RUN_PHASE',
  'VIBELOG_RUN_STARTED_AT',
  'VIBELOG_KEEP_ME',
];

const saved = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  // Имитируем окружение агентской фазы: VIBELOG_CWD на «главный репозиторий»,
  // фазовые переменные рана и id сессии для fallback-учёта токенов
  process.env.VIBELOG_CWD = '/repo/main';
  process.env.VIBELOG_SESSION_ID = 'agent-123';
  process.env.VIBELOG_PHASE_NAME = 'code';
  process.env.VIBELOG_PHASE_TASK_ID = 'VL-286';
  process.env.VIBELOG_RUN_PHASE = 'code';
  process.env.VIBELOG_RUN_STARTED_AT = '2026-11-01T00:00:00.000Z';
  process.env.VIBELOG_KEEP_ME = 'yes';
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('VL-286 — testSpawnEnv', () => {
  it('снимает VIBELOG_CWD/SESSION_ID и все VIBELOG_PHASE_*/VIBELOG_RUN_*', () => {
    const env = testSpawnEnv();
    assert.equal(env.VIBELOG_CWD, undefined);
    assert.equal(env.VIBELOG_SESSION_ID, undefined);
    assert.equal(env.VIBELOG_PHASE_NAME, undefined);
    assert.equal(env.VIBELOG_PHASE_TASK_ID, undefined);
    assert.equal(env.VIBELOG_RUN_PHASE, undefined);
    assert.equal(env.VIBELOG_RUN_STARTED_AT, undefined);
  });

  it('сохраняет посторонние переменные и ставит VIBELOG_SKIP_UPDATE_CHECK', () => {
    const env = testSpawnEnv();
    assert.equal(env.VIBELOG_KEEP_ME, 'yes');
    assert.equal(env.VIBELOG_SKIP_UPDATE_CHECK, 'true');
  });

  it('extra накладывается поверх очистки (осознанно переданная фаза сохраняется)', () => {
    const env = testSpawnEnv({ VIBELOG_RUN_PHASE: 'close', VIBELOG_SESSION_ID: 's-1' });
    assert.equal(env.VIBELOG_RUN_PHASE, 'close');
    assert.equal(env.VIBELOG_SESSION_ID, 's-1');
    // не переданное явно — по-прежнему снято
    assert.equal(env.VIBELOG_CWD, undefined);
    assert.equal(env.VIBELOG_PHASE_NAME, undefined);
  });

  it('не мутирует process.env родителя', () => {
    testSpawnEnv();
    assert.equal(process.env.VIBELOG_CWD, '/repo/main');
  });

  it('stripVibelogEnv чистит переданный объект и возвращает его же', () => {
    const env = { ...process.env };
    const result = stripVibelogEnv(env);
    assert.equal(result, env);
    assert.equal(env.VIBELOG_CWD, undefined);
    assert.equal(env.VIBELOG_RUN_PHASE, undefined);
    assert.equal(env.VIBELOG_KEEP_ME, 'yes');
  });
});
