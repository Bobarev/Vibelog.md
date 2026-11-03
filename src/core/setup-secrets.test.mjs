/**
 * Тесты записи секретов wizard-а (VL-210).
 *
 * Проверяет .env (шапка, дописывание без перезаписи), секцию env
 * settings.json и режим both. Значения секретов не должны попадать в
 * результат (только имена ключей).
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readEnvFile, writeSecrets } from '../../dist/core/setup-secrets.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-setup-secrets-'));

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

describe('VL-210 — запись секретов', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('readEnvFile парсит KEY=value, export и кавычки', () => {
    writeFileSync(
      join(testDir, '.env'),
      '# комментарий\nA=1\nexport B=2\nC="три четыре"\n\n',
      'utf-8',
    );
    assert.deepEqual(readEnvFile(testDir), { A: '1', B: '2', C: 'три четыре' });
  });

  it('readEnvFile без файла → {}', () => {
    assert.deepEqual(readEnvFile(testDir), {});
  });

  it('writeSecrets env создаёт .env с шапкой', () => {
    const res = writeSecrets(testDir, { API_KEY: 'secret' }, 'env');
    assert.deepEqual(res.written, ['API_KEY']);
    const content = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(content.startsWith('# Vibelog: секреты проекта'), content);
    assert.ok(content.includes('API_KEY=secret'), content);
  });

  it('writeSecrets env не перезаписывает существующий ключ', () => {
    writeFileSync(join(testDir, '.env'), 'API_KEY=old\n', 'utf-8');
    const res = writeSecrets(testDir, { API_KEY: 'new', OTHER: 'x' }, 'env');
    assert.deepEqual(res.written, ['OTHER']);
    assert.deepEqual(res.skipped, ['API_KEY']);
    const content = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(content.includes('API_KEY=old'), content);
    assert.ok(!content.includes('API_KEY=new'), content);
  });

  it('writeSecrets settings пишет секцию env settings.json', () => {
    const res = writeSecrets(testDir, { TELEGRAM_BOT_TOKEN: 'tok' }, 'settings');
    assert.deepEqual(res.written, ['TELEGRAM_BOT_TOKEN']);
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.env.TELEGRAM_BOT_TOKEN, 'tok');
    assert.ok(!existsSync(join(testDir, '.env')), '.env не создаётся в режиме settings');
  });

  it('writeSecrets both пишет в оба места', () => {
    writeSecrets(testDir, { K: 'v' }, 'both');
    assert.ok(readFileSync(join(testDir, '.env'), 'utf-8').includes('K=v'));
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.env.K, 'v');
  });

  it('VL-324: writeSecrets system ничего не пишет на диск', () => {
    const res = writeSecrets(testDir, { API_KEY: 'secret' }, 'system');
    assert.deepEqual(res.written, []);
    assert.deepEqual(res.skipped, []);
    assert.ok(!existsSync(join(testDir, '.env')), '.env не создаётся');
    assert.ok(!existsSync(join(testDir, '.vibelog', 'settings.json')), 'settings.json не создаётся');
  });

  it('VL-324: overwrite заменяет строку ключа в .env, не дописывая вторую', () => {
    writeFileSync(join(testDir, '.env'), '# шапка\nAPI_KEY=old\nOTHER=1\n', 'utf-8');
    const res = writeSecrets(testDir, { API_KEY: 'new' }, 'env', { overwrite: true });
    assert.deepEqual(res.written, ['API_KEY']);
    const content = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(content.includes('API_KEY=new'), content);
    assert.ok(!content.includes('API_KEY=old'), content);
    assert.equal(content.split('API_KEY=').length - 1, 1, 'ключ встречается один раз');
    assert.ok(content.includes('OTHER=1'), 'остальные ключи не тронуты');
    assert.equal(readEnvFile(testDir).API_KEY, 'new');
  });

  it('VL-324: overwrite в settings.json заменяет значение секции env', () => {
    writeSecrets(testDir, { K: 'old' }, 'settings');
    const res = writeSecrets(testDir, { K: 'new' }, 'settings', { overwrite: true });
    assert.deepEqual(res.written, ['K']);
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.env.K, 'new');
  });

  it('writeSecrets не возвращает значения секретов', () => {
    const res = writeSecrets(testDir, { SECRET_KEY: 'super-secret-value' }, 'env');
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes('super-secret-value'), serialized);
  });

  it('writeSecrets игнорирует пустые значения', () => {
    const res = writeSecrets(testDir, { EMPTY: '' }, 'env');
    assert.deepEqual(res.written, []);
    assert.ok(!existsSync(join(testDir, '.env')));
  });

  it('writeSecrets экранирует значения с пробелами', () => {
    writeSecrets(testDir, { WITH_SPACE: 'a b' }, 'env');
    const content = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(content.includes('WITH_SPACE="a b"'), content);
    assert.equal(readEnvFile(testDir).WITH_SPACE, 'a b');
  });
});
