/**
 * Тесты VL-286 — хелпер env для спавнов CLI/MCP в тестах.
 *
 * Проверяет, что унаследованный фазовый env агентской сессии снимается,
 * а явно переданные значения (`extra`) накладываются поверх очистки.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

import { testSpawnEnv, stripVibelogEnv, clearPhaseEnv, withCleanPhaseEnv } from './test-env.mjs';

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

describe('VL-374 — clearPhaseEnv/withCleanPhaseEnv (in-process изоляция)', () => {
  it('снимает фазовый env из process.env, посторонние ключи остаются', () => {
    const restore = clearPhaseEnv();
    try {
      assert.equal(process.env.VIBELOG_CWD, undefined);
      assert.equal(process.env.VIBELOG_SESSION_ID, undefined);
      assert.equal(process.env.VIBELOG_PHASE_NAME, undefined);
      assert.equal(process.env.VIBELOG_PHASE_TASK_ID, undefined);
      assert.equal(process.env.VIBELOG_RUN_PHASE, undefined);
      assert.equal(process.env.VIBELOG_RUN_STARTED_AT, undefined);
      assert.equal(process.env.VIBELOG_KEEP_ME, 'yes', 'посторонний ключ не тронут');
    } finally {
      restore();
    }
  });

  it('возвращённая функция восстанавливает ровно исходные значения', () => {
    const restore = clearPhaseEnv();
    restore();
    assert.equal(process.env.VIBELOG_CWD, '/repo/main');
    assert.equal(process.env.VIBELOG_SESSION_ID, 'agent-123');
    assert.equal(process.env.VIBELOG_PHASE_NAME, 'code');
    assert.equal(process.env.VIBELOG_RUN_PHASE, 'code');
    assert.equal(process.env.VIBELOG_RUN_STARTED_AT, '2026-11-01T00:00:00.000Z');
  });

  it('восстанавливает и отсутствовавшие ключи (undefined → ключа нет)', () => {
    delete process.env.VIBELOG_PHASE_TASK_ID;
    const restore = clearPhaseEnv();
    restore();
    assert.equal('VIBELOG_PHASE_TASK_ID' in process.env, false, 'ключа не было — и не появилось');
  });

  it('withCleanPhaseEnv восстанавливает env и после исключения внутри fn', async () => {
    await assert.rejects(
      withCleanPhaseEnv(async () => {
        assert.equal(process.env.VIBELOG_PHASE_NAME, undefined, 'внутри fn env чист');
        throw new Error('бум');
      }),
      /бум/,
    );
    assert.equal(process.env.VIBELOG_PHASE_NAME, 'code', 'env восстановлен после исключения');
  });

  it('withCleanPhaseEnv возвращает результат fn', async () => {
    const value = await withCleanPhaseEnv(async () => 42);
    assert.equal(value, 42);
  });

  it('withCleanPhaseEnv снимает env ДО fn: выставленное внутри значение действует', async () => {
    // Документирует семантику порядка: обёртка не «защищает» от значения,
    // выставленного внутри fn — фаза, нужная тесту, ставится до обёртки.
    const seen = await withCleanPhaseEnv(async () => {
      process.env.VIBELOG_PHASE_NAME = 'close';
      return process.env.VIBELOG_PHASE_NAME;
    });
    assert.equal(seen, 'close');
    assert.equal(process.env.VIBELOG_PHASE_NAME, 'code', 'после обёртки env восстановлен');
  });

  it('clearPhaseEnv не связан с объектом testSpawnEnv (разные контракты)', () => {
    const env = testSpawnEnv();
    const restore = clearPhaseEnv();
    try {
      assert.equal(env.VIBELOG_KEEP_ME, 'yes', 'объект спавна не зависит от мутации process.env');
      assert.equal(process.env.VIBELOG_CWD, undefined);
    } finally {
      restore();
    }
  });
});
