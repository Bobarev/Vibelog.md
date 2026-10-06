/**
 * Тесты VL-34 — настройки бота (.vibelog/bot.yml).
 *
 * Каталоги — в /tmp (findBacklogDir поднимается вверх по дереву).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadBotSettings,
  saveBotSettings,
  resolveToken,
  resolveProxy,
  resolveDefaultAgent,
  resolveMaxWallTime,
  resolveMaxRequests,
  botSettingsPath,
} from '../../dist/bot/settings.js';

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

describe('default_agent (VL-94)', () => {
  const agentRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-agent-'));

  after(() => {
    rmSync(agentRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load: default_agent vb', () => {
    saveBotSettings(agentRoot, { chats: [111], default_agent: 'vb' });
    assert.equal(loadBotSettings(agentRoot).default_agent, 'vb');
  });

  it('resolveDefaultAgent: без файла → qwen; с файлом → значение', () => {
    assert.equal(resolveDefaultAgent(join(agentRoot, 'nonexistent')), 'qwen');
    saveBotSettings(agentRoot, { chats: [], default_agent: 'vb' });
    assert.equal(resolveDefaultAgent(agentRoot), 'vb');
    saveBotSettings(agentRoot, { chats: [], default_agent: 'qwen' });
    assert.equal(resolveDefaultAgent(agentRoot), 'qwen');
  });

  it('невалидное default_agent в файле отброшено → qwen', () => {
    const root = join(agentRoot, 'invalid');
    // botSettingsPath указывает внутрь .vibelog/ — каталог создаём явно
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(botSettingsPath(root), 'chats: []\ndefault_agent: foo\n', 'utf-8');
    assert.equal(loadBotSettings(root).default_agent, undefined);
    assert.equal(resolveDefaultAgent(root), 'qwen');
  });
});

describe('max_wall_time/max_requests (VL-104)', () => {
  const limitsRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-limits-'));

  after(() => {
    rmSync(limitsRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load: лимиты фаз', () => {
    saveBotSettings(limitsRoot, { chats: [111], max_wall_time: 1800, max_requests: 50 });
    const loaded = loadBotSettings(limitsRoot);
    assert.equal(loaded.max_wall_time, 1800);
    assert.equal(loaded.max_requests, 50);
  });

  it('сброс: undefined-поля не попадают в файл', () => {
    saveBotSettings(limitsRoot, { chats: [], max_wall_time: 1800, max_requests: 50 });
    saveBotSettings(limitsRoot, { chats: [] });
    const loaded = loadBotSettings(limitsRoot);
    assert.equal(loaded.max_wall_time, undefined);
    assert.equal(loaded.max_requests, undefined);
  });

  it('битые значения в bot.yml игнорируются', () => {
    const root = join(limitsRoot, 'invalid');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(
      botSettingsPath(root),
      'chats: []\nmax_wall_time: abc\nmax_requests: -5\n',
      'utf-8',
    );
    const loaded = loadBotSettings(root);
    assert.equal(loaded.max_wall_time, undefined);
    assert.equal(loaded.max_requests, undefined);
  });

  it('resolveMaxWallTime/resolveMaxRequests: без файла → undefined', () => {
    assert.equal(resolveMaxWallTime(join(limitsRoot, 'nonexistent')), undefined);
    assert.equal(resolveMaxRequests(join(limitsRoot, 'nonexistent')), undefined);
    saveBotSettings(limitsRoot, { chats: [], max_wall_time: 900, max_requests: 40 });
    assert.equal(resolveMaxWallTime(limitsRoot), 900);
    assert.equal(resolveMaxRequests(limitsRoot), 40);
  });
});
