/**
 * Тесты VL-37 — автозагрузка .env.
 *
 * Каталоги — в /tmp; переменные окружения сохраняются/восстанавливаются.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadDotEnv, loadProjectEnv, fileLoadedEnvKeys } from '../../dist/bot/env.js';

describe('loadDotEnv (VL-37)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-env-test-'));
  const KEYS = ['VL_TEST_TOKEN', 'VL_TEST_PROXY', 'VL_TEST_PRESET'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('загружает KEY=VALUE, пропускает комментарии, не затирает реальный env', () => {
    process.env.VL_TEST_PRESET = 'from-real-env';
    writeFileSync(
      join(testRoot, '.env'),
      [
        '# комментарий',
        '',
        'VL_TEST_TOKEN=abc:123',
        'VL_TEST_PROXY="http://127.0.0.1:7070"',
        "VL_TEST_PRESET='from-file'",
        'export VL_TEST_EXPORTED=yes',
        'БЕЗ_РАВНО=мусор',
      ].join('\n'),
      'utf-8'
    );
    mkdirSync(testRoot, { recursive: true });
    loadDotEnv(testRoot);

    assert.equal(process.env.VL_TEST_TOKEN, 'abc:123');
    assert.equal(process.env.VL_TEST_PROXY, 'http://127.0.0.1:7070');
    // Реальная env-переменная приоритетнее файла (стандарт dotenv)
    assert.equal(process.env.VL_TEST_PRESET, 'from-real-env');
    delete process.env.VL_TEST_EXPORTED;

    // VL-143: реально записанные ключи попадают в учёт файловых ключей —
    // по ним spawnReplacementBot стриппит env дочернего процесса
    const tracked = fileLoadedEnvKeys();
    assert.ok(tracked.has('VL_TEST_TOKEN'), 'записанный ключ должен быть в учёте');
    assert.ok(tracked.has('VL_TEST_PROXY'), 'записанный ключ должен быть в учёте');
    // Предустановленный в реальном env ключ НЕ записан из файла → не учтён
    assert.ok(!tracked.has('VL_TEST_PRESET'), 'не записанный ключ не должен быть в учёте');
  });

  it('отсутствующий .env — не ошибка', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'vibelog-env-empty-'));
    try {
      loadDotEnv(emptyRoot); // не должен бросить
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe('loadProjectEnv (VL-189)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-project-env-'));
  // Ключи с префиксом VL189 — не пересекаются с соседними тестами воркера
  const KEYS = ['VL189_LLM_KEY', 'VL189_LLM_MODEL', 'VL189_SETTINGS_ONLY'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('VL-329: грузит ключи ТОЛЬКО из .env, приоритет реальный env > .env', () => {
    // Секция env settings.json больше не читается — ключ из неё не появится
    mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
    writeFileSync(
      join(testRoot, '.vibelog', 'settings.json'),
      JSON.stringify({ env: { VL189_SETTINGS_ONLY: 'from-settings', VL189_LLM_KEY: 'settings-loses' } }),
      'utf-8'
    );
    writeFileSync(
      join(testRoot, '.env'),
      ['VL189_LLM_KEY=from-file', 'VL189_LLM_MODEL=test-model'].join('\n'),
      'utf-8'
    );
    // Реальный env приоритетнее .env: VL189_LLM_MODEL задан заранее
    process.env.VL189_LLM_MODEL = 'from-real-env';

    loadProjectEnv(testRoot);

    assert.equal(process.env.VL189_LLM_KEY, 'from-file', 'ключ берётся из .env');
    assert.equal(process.env.VL189_LLM_MODEL, 'from-real-env', 'реальный env приоритетнее .env');
    assert.equal(
      process.env.VL189_SETTINGS_ONLY,
      undefined,
      'секция env settings.json игнорируется',
    );

    // VL-143: записанные файловые ключи в учёте (для стриппинга рестарта)
    const tracked = fileLoadedEnvKeys();
    assert.ok(tracked.has('VL189_LLM_KEY'), '.env-ключ должен быть в учёте');
    assert.ok(!tracked.has('VL189_SETTINGS_ONLY'), 'ключи settings.json в учёт не попадают');
    assert.ok(!tracked.has('VL189_LLM_MODEL'), 'не записанный (задан в реальном env) не учтён');

    delete process.env.VL189_LLM_MODEL;
    delete process.env.VL189_LLM_KEY;
  });

  it('отсутствие .env и settings.json — не ошибка', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'vibelog-project-env-empty-'));
    try {
      loadProjectEnv(emptyRoot); // не должен бросить
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
