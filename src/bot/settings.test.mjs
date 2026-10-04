/**
 * Тесты VL-34 — настройки бота (.vibelog/bot.yml).
 *
 * Каталоги — в /tmp (findBacklogDir поднимается вверх по дереву).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBotSettings, saveBotSettings, resolveToken, resolveProxy, botSettingsPath } from '../../dist/bot/settings.js';

describe('settings (VL-34)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-test-'));
  const savedEnv = process.env.TELEGRAM_BOT_TOKEN;

  after(() => {
    if (savedEnv === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = savedEnv;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load', () => {
    saveBotSettings(testRoot, { telegram_token: 'tok-123', chats: [111, 222] });
    assert.ok(existsSync(botSettingsPath(testRoot)));
    const loaded = loadBotSettings(testRoot);
    assert.equal(loaded.telegram_token, 'tok-123');
    assert.deepEqual(loaded.chats, [111, 222]);
  });

  it('отсутствующий файл → пустые настройки', () => {
    const empty = loadBotSettings(join(testRoot, 'nonexistent-sub'));
    assert.equal(empty.telegram_token, undefined);
    assert.deepEqual(empty.chats, []);
  });

  it('resolveToken: env приоритетнее файла', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'from-env';
    assert.equal(resolveToken(testRoot), 'from-env');
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(resolveToken(testRoot), 'tok-123');
  });

  it('resolveProxy: env → файл → null (VL-37)', () => {
    const savedProxy = process.env.TELEGRAM_PROXY;
    try {
      process.env.TELEGRAM_PROXY = 'http://127.0.0.1:7070';
      assert.equal(resolveProxy(testRoot), 'http://127.0.0.1:7070');
      delete process.env.TELEGRAM_PROXY;
      // Файл без telegram_proxy → null
      assert.equal(resolveProxy(testRoot), null);
      // С telegram_proxy в файле
      saveBotSettings(testRoot, { telegram_token: 'tok-123', telegram_proxy: 'http://127.0.0.1:1080', chats: [] });
      assert.equal(resolveProxy(testRoot), 'http://127.0.0.1:1080');
    } finally {
      if (savedProxy === undefined) delete process.env.TELEGRAM_PROXY;
      else process.env.TELEGRAM_PROXY = savedProxy;
    }
  });
});

describe('task_type_styles (VL-82)', () => {
  const stylesRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-styles-'));

  after(() => {
    rmSync(stylesRoot, { recursive: true, force: true });
  });

  it('отсутствующий bot.yml → дефолты (4 записи)', () => {
    const loaded = loadBotSettings(join(stylesRoot, 'nonexistent'));
    assert.deepEqual(loaded.task_type_styles, {
      bug: 'danger',
      feature: 'success',
      enhancement: 'primary',
      epic: 'primary',
    });
  });

  it('пользовательское переопределение перекрывает дефолты', () => {
    const root = join(stylesRoot, 'override');
    saveBotSettings(root, { chats: [], task_type_styles: { bug: 'success', docs: 'link' } });
    const loaded = loadBotSettings(root);
    assert.deepEqual(loaded.task_type_styles, {
      bug: 'success', // переопределён пользователем
      docs: 'link', // новый тип
      feature: 'success', // дефолт сохранён
      enhancement: 'primary',
      epic: 'primary',
    });
  });

  it('невалидный стиль отброшен → остаётся дефолт danger', () => {
    const root = join(stylesRoot, 'invalid');
    saveBotSettings(root, { chats: [], task_type_styles: { bug: 'green' } });
    const loaded = loadBotSettings(root);
    assert.equal(loaded.task_type_styles.bug, 'danger');
  });

  it('round-trip: в файл попадают только пользовательские стили', () => {
    const root = join(stylesRoot, 'roundtrip');
    saveBotSettings(root, { chats: [111], task_type_styles: { bug: 'success' } });
    const raw = readFileSync(botSettingsPath(root), 'utf-8');
    // Дефолты в файл не записываем — только пользовательское переопределение
    assert.ok(raw.includes('bug'));
    assert.ok(!raw.includes('feature'));
    assert.ok(!raw.includes('enhancement'));
    assert.ok(!raw.includes('epic'));
    const loaded = loadBotSettings(root);
    assert.equal(loaded.task_type_styles.bug, 'success');
  });
});
