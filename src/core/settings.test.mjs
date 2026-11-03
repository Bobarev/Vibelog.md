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
import { loadProjectEnv } from '../../dist/bot/env.js';

import {
  settingsPath,
  loadSettings,
  saveSettingsPatch,
  migrateLegacyConfig,
  readSettingsEnv,
  detectLegacyEnvSection,
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

  it('VL-329: секция env в settings.json игнорируется, detectLegacyEnvSection её видит', () => {
    const dir = join(testRoot, 'legacy-env');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ env: { VL329_LEGACY: 'from-settings' } }),
      'utf-8'
    );
    delete process.env.VL329_LEGACY;
    try {
      // loadProjectEnv грузит только .env — ключ из секции env не появляется
      loadProjectEnv(dir);
      assert.equal(
        process.env.VL329_LEGACY,
        undefined,
        'секция env больше не попадает в process.env',
      );
      // Признак legacy-секции нужен для одноразового предупреждения при старте
      assert.equal(detectLegacyEnvSection(dir), true);
      assert.equal(detectLegacyEnvSection(join(testRoot, 'no-env')), false);
    } finally {
      delete process.env.VL329_LEGACY;
    }
  });
});

describe('миграция legacy-конфигурации (VL-143)', () => {
  const migRoot = mkdtempSync(join(tmpdir(), 'vibelog-settings-mig-'));

  afterAll(() => {
    rmSync(migRoot, { recursive: true, force: true });
  });

  it('bot.yml + settings.yml → settings.json, секреты и чаты в .env, legacy удалён', () => {
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
    assert.equal(raw.default_agent, 'vb');
    assert.equal(raw.max_wall_time, 1800);
    assert.equal(raw.branch_mode, true);
    assert.deepEqual(raw.task_type_styles, { bug: 'success' });
    assert.equal(raw.git_user_name, 'Pavel');
    // VL-329: секретов и чатов в settings.json больше нет — они в .env
    assert.ok(!('env' in raw), 'секция env не пишется');
    assert.ok(!('chats' in raw), 'chats не пишутся в settings.json');
    assert.ok(!('telegram_token' in raw));
    assert.ok(!('telegram_proxy' in raw));
    const env = readFileSync(join(dir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_BOT_TOKEN=tok-abc'), env);
    assert.ok(env.includes('TELEGRAM_PROXY=http://127.0.0.1:7070'), env);
    assert.ok(env.includes('TELEGRAM_CHAT_IDS=111,222'), env);
    // Legacy-файлы удалены после успешной записи
    assert.ok(!existsSync(join(dir, '.vibelog', 'bot.yml')), 'bot.yml должна быть удалена');
    assert.ok(!existsSync(join(dir, '.vibelog', 'settings.yml')), 'settings.yml должна быть удалена');
    // Повторный вызов — no-op (settings.json существует)
    assert.equal(migrateLegacyConfig(dir), false);
  });

  it('после миграции токен лежит в .env, а не в settings.json', () => {
    const dir = join(migRoot, 'tok');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'bot.yml'), 'telegram_token: secret\n', 'utf-8');
    // loadSettings запускает ленивую миграцию сам
    loadSettings(dir);
    assert.deepEqual(readSettingsEnv(dir), {}, 'секция env не создаётся');
    assert.ok(readFileSync(join(dir, '.env'), 'utf-8').includes('TELEGRAM_BOT_TOKEN=secret'));
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
