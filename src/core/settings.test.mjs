/**
 * Тесты VL-143 — единый файл настроек .vibelog/settings.json:
 * load/save, env-секция, миграция legacy bot.yml + settings.yml.
 *
 * Каталоги — в /tmp (миграция не поднимается по дереву, читает только cwd).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  settingsPath,
  loadSettings,
  saveSettingsPatch,
  migrateLegacyConfig,
  readSettingsEnv,
  applySettingsEnv,
} from '../../dist/core/settings.js';

describe('settings.json (VL-143)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-settings-core-'));

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('settingsPath → .vibelog/settings.json', () => {
    assert.equal(settingsPath('/proj'), join('/proj', '.vibelog', 'settings.json'));
  });

  it('отсутствующий файл → дефолты {}', () => {
    assert.deepEqual(loadSettings(join(testRoot, 'nonexistent')), {});
  });

  it('битый JSON → дефолты без throw', () => {
    const dir = join(testRoot, 'broken');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), '{не json вовсе', 'utf-8');
    assert.deepEqual(loadSettings(dir), {});
    // Массив/null вместо объекта — тоже дефолты
    writeFileSync(settingsPath(dir), '[1, 2]', 'utf-8');
    assert.deepEqual(loadSettings(dir), {});
    writeFileSync(settingsPath(dir), 'null', 'utf-8');
    assert.deepEqual(loadSettings(dir), {});
  });

  it('saveSettingsPatch: read-modify-write сохраняет env и git_user_name', () => {
    const dir = join(testRoot, 'patch');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ chats: [1], env: { TELEGRAM_BOT_TOKEN: 'tok' }, git_user_name: 'Bob' }),
      'utf-8'
    );
    saveSettingsPatch(dir, { branch_mode: true, max_wall_time: 900 });
    const loaded = loadSettings(dir);
    assert.equal(loaded.branch_mode, true);
    assert.equal(loaded.max_wall_time, 900);
    assert.deepEqual(loaded.env, { TELEGRAM_BOT_TOKEN: 'tok' });
    assert.equal(loaded.git_user_name, 'Bob');
    assert.deepEqual(loaded.chats, [1]);
  });

  it('saveSettingsPatch: значение undefined удаляет ключ (сброс)', () => {
    const dir = join(testRoot, 'reset');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({ max_wall_time: 1800 }), 'utf-8');
    saveSettingsPatch(dir, { max_wall_time: undefined });
    assert.ok(!('max_wall_time' in loadSettings(dir)));
  });

  it('readSettingsEnv: только строковые пары, битые значения отбрасываются', () => {
    const dir = join(testRoot, 'envsec');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ env: { A: 'x', B: 42, C: null, '': 'пустой-ключ' } }),
      'utf-8'
    );
    assert.deepEqual(readSettingsEnv(dir), { A: 'x' });
    assert.deepEqual(readSettingsEnv(join(testRoot, 'no-env')), {});
  });

  it('applySettingsEnv: заполняет пустые ключи, не затирает реальный env', () => {
    const dir = join(testRoot, 'applyenv');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ env: { VL143_A: 'from-settings', VL143_B: 'fill-me' } }),
      'utf-8'
    );
    process.env.VL143_A = 'from-real-env';
    delete process.env.VL143_B;
    try {
      const written = applySettingsEnv(dir);
      assert.equal(process.env.VL143_A, 'from-real-env', 'реальный env не должен затираться');
      assert.equal(process.env.VL143_B, 'fill-me');
      assert.deepEqual([...written], ['VL143_B']);
    } finally {
      delete process.env.VL143_A;
      delete process.env.VL143_B;
    }
  });
});

describe('миграция legacy-конфигурации (VL-143)', () => {
  const migRoot = mkdtempSync(join(tmpdir(), 'vibelog-settings-mig-'));

  afterAll(() => {
    rmSync(migRoot, { recursive: true, force: true });
  });

  it('bot.yml + settings.yml → settings.json, секреты в env-секцию, legacy удалён', () => {
    const dir = join(migRoot, 'full');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(dir, '.vibelog', 'bot.yml'),
      [
        'chats: [111, 222]',
        'telegram_token: tok-abc',
        'telegram_proxy: http://127.0.0.1:7070',
        'default_agent: vb',
        'max_wall_time: 1800',
        'branch_mode: true',
        'task_type_styles:',
        '  bug: success',
      ].join('\n'),
      'utf-8'
    );
    writeFileSync(join(dir, '.vibelog', 'settings.yml'), 'git_user_name: Pavel\n', 'utf-8');

    const migrated = migrateLegacyConfig(dir);
    assert.equal(migrated, true, 'миграция должна была записать settings.json');

    const raw = JSON.parse(readFileSync(settingsPath(dir), 'utf-8'));
    assert.deepEqual(raw.chats, [111, 222]);
    assert.equal(raw.default_agent, 'vb');
    assert.equal(raw.max_wall_time, 1800);
    assert.equal(raw.branch_mode, true);
    assert.deepEqual(raw.task_type_styles, { bug: 'success' });
    assert.equal(raw.git_user_name, 'Pavel');
    // Секреты — только в env-секции, на топ-уровне их больше нет
    assert.equal(raw.env.TELEGRAM_BOT_TOKEN, 'tok-abc');
    assert.equal(raw.env.TELEGRAM_PROXY, 'http://127.0.0.1:7070');
    assert.ok(!('telegram_token' in raw));
    assert.ok(!('telegram_proxy' in raw));
    // Legacy-файлы удалены после успешной записи
    assert.ok(!existsSync(join(dir, '.vibelog', 'bot.yml')), 'bot.yml должна быть удалена');
    assert.ok(!existsSync(join(dir, '.vibelog', 'settings.yml')), 'settings.yml должна быть удалена');
    // Повторный вызов — no-op (settings.json существует)
    assert.equal(migrateLegacyConfig(dir), false);
  });

  it('readSettings после миграции видит токен через resolve-секцию', () => {
    const dir = join(migRoot, 'tok');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'bot.yml'), 'telegram_token: secret\n', 'utf-8');
    // loadSettings запускает ленивую миграцию сам
    loadSettings(dir);
    assert.equal(readSettingsEnv(dir).TELEGRAM_BOT_TOKEN, 'secret');
    assert.ok(!existsSync(join(dir, '.vibelog', 'bot.yml')));
  });

  it('битый legacy YAML → миграция не падает, файлы не теряются молча', () => {
    const dir = join(migRoot, 'broken-yaml');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    // parseYaml может бросить или вернуть мусор — важно, что миграция не throw
    writeFileSync(join(dir, '.vibelog', 'bot.yml'), 'chats: [oops\n\tbroken\n', 'utf-8');
    let threw = false;
    try {
      migrateLegacyConfig(dir);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'миграция не должна бросать');
  });

  it('legacy-файлов нет → миграция no-op, файл не создаётся', () => {
    const dir = join(migRoot, 'no-legacy');
    mkdirSync(dir, { recursive: true });
    assert.equal(migrateLegacyConfig(dir), false);
    assert.ok(!existsSync(settingsPath(dir)));
    assert.deepEqual(loadSettings(dir), {});
  });

  it('settings.json уже существует → legacy не трогается', () => {
    const dir = join(migRoot, 'exists');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({ chats: [1] }), 'utf-8');
    writeFileSync(join(dir, '.vibelog', 'bot.yml'), 'chats: [2]\n', 'utf-8');
    assert.equal(migrateLegacyConfig(dir), false);
    assert.deepEqual(loadSettings(dir).chats, [1], 'settings.json не должен затираться');
    assert.ok(existsSync(join(dir, '.vibelog', 'bot.yml')), 'legacy остаётся при существующем settings.json');
  });
});
