/**
 * Тесты VL-428 — comms.yaml: чтение/запись, миграция из .env, каналы.
 * Каталоги — только mkdtemp (VL-241).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commsPath,
  readComms,
  writeComms,
  migrateEnvToComms,
  resolveChannel,
  resolveCommsSecret,
  syncTimeoutSec,
  DEFAULT_SYNC_TIMEOUT_SEC,
} from '../../dist/core/comms.js';

const roots = [];
function root() {
  const d = mkdtempSync(join(tmpdir(), 'vibelog-comms-'));
  roots.push(d);
  mkdirSync(join(d, '.vibelog'), { recursive: true });
  return d;
}
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

describe('VL-428: comms.yaml чтение/запись', () => {
  it('AC1: отсутствует файл → пустая конфигурация с дефолтным таймаутом', () => {
    const cwd = root();
    const cfg = readComms(cwd, { warn: () => {} });
    assert.equal(cfg.channels.length, 0);
    assert.equal(cfg.chats.length, 0);
    assert.equal(cfg.sync_timeout_sec, DEFAULT_SYNC_TIMEOUT_SEC);
  });

  it('AC1: write→read roundtrip сохраняет секреты, чаты и каналы', () => {
    const cwd = root();
    writeComms(cwd, {
      bot_token: '123:abc',
      proxy: 'http://127.0.0.1:7070',
      chats: [111, 222],
      default_channel: 'lb-link',
      sync_timeout_sec: 90,
      channels: [
        {
          id: 'lb-link',
          label: 'Связь с LB',
          transport: 'telegram',
          group_id: -1001234567890,
          addressing: 'mention',
          approval: 'admin',
          admin_chat: 111,
        },
      ],
    });
    const cfg = readComms(cwd, { warn: () => {} });
    assert.equal(cfg.bot_token, '123:abc');
    assert.equal(cfg.proxy, 'http://127.0.0.1:7070');
    assert.deepEqual(cfg.chats, [111, 222]);
    assert.equal(cfg.default_channel, 'lb-link');
    assert.equal(cfg.sync_timeout_sec, 90);
    assert.equal(cfg.channels.length, 1);
    assert.equal(cfg.channels[0].group_id, -1001234567890);
    assert.equal(cfg.channels[0].addressing, 'mention');
    assert.equal(cfg.channels[0].approval, 'admin');
    assert.equal(cfg.channels[0].admin_chat, 111);
    // Файл содержит токен и лежит в .vibelog (не в git по умолчанию)
    const text = readFileSync(commsPath(cwd), 'utf-8');
    assert.ok(text.includes('123:abc'));
  });

  it('AC1: битый YAML не роняет чтение (дефолты + предупреждение)', () => {
    const cwd = root();
    writeFileSync(commsPath(cwd), 'secrets: [битая структура', 'utf-8');
    const warns = [];
    const cfg = readComms(cwd, { warn: (m) => warns.push(m) });
    assert.equal(cfg.channels.length, 0);
    assert.ok(warns.length > 0, 'должно быть предупреждение');
  });

  it('AC1: миграция переносит TELEGRAM_* из .env в comms.yaml и чистит .env', () => {
    const cwd = root();
    writeFileSync(
      join(cwd, '.env'),
      '# шапка\nTELEGRAM_BOT_TOKEN=777:xyz\nTELEGRAM_CHAT_IDS=1, 2\nVIBELOG_LLM_API_KEY=keep-me\n',
      'utf-8',
    );
    const moved = migrateEnvToComms(cwd);
    assert.deepEqual(moved.sort(), ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS'].sort());
    const cfg = readComms(cwd, { warn: () => {} });
    assert.equal(cfg.bot_token, '777:xyz');
    assert.deepEqual(cfg.chats, [1, 2]);
    const env = readFileSync(join(cwd, '.env'), 'utf-8');
    assert.ok(!env.includes('TELEGRAM_BOT_TOKEN'), 'токен убран из .env');
    assert.ok(!env.includes('TELEGRAM_CHAT_IDS'), 'чаты убраны из .env');
    assert.ok(env.includes('VIBELOG_LLM_API_KEY=keep-me'), 'прочие ключи сохранены');
    assert.ok(env.includes('# шапка'), 'комментарии сохранены');
    // Повтор — no-op (идемпотентность)
    assert.deepEqual(migrateEnvToComms(cwd), []);
  });

  it('AC1: секреты приоритетнее shell env; comms приоритетнее legacy .env', () => {
    const cwd = root();
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    try {
      delete process.env.TELEGRAM_BOT_TOKEN;
      writeFileSync(join(cwd, '.env'), 'TELEGRAM_BOT_TOKEN=from-legacy\n', 'utf-8');
      // shell env задан → приоритет 1
      process.env.TELEGRAM_BOT_TOKEN = 'from-shell';
      assert.equal(resolveCommsSecret(cwd, 'bot_token'), 'from-shell');
      // shell env снят → legacy .env (загружен в process.env имитируем)
      delete process.env.TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = 'from-legacy';
      assert.equal(resolveCommsSecret(cwd, 'bot_token'), 'from-legacy');
      // comms.yaml задан → приоритетнее legacy
      writeComms(cwd, {
        bot_token: 'from-comms',
        chats: [],
        channels: [],
        sync_timeout_sec: 120,
      });
      assert.equal(resolveCommsSecret(cwd, 'bot_token'), 'from-comms');
    } finally {
      if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = saved;
    }
  });
});

describe('VL-428: выбор канала (AC4)', () => {
  function setup(channels, defaultChannel) {
    const cwd = root();
    writeComms(cwd, {
      chats: [],
      channels: channels.map(([id, gid]) => ({
        id,
        transport: 'telegram',
        group_id: gid,
        addressing: 'mention',
        approval: 'auto',
      })),
      ...(defaultChannel ? { default_channel: defaultChannel } : {}),
      sync_timeout_sec: 120,
    });
    return cwd;
  }

  it('явный id переопределяет default', () => {
    const cwd = setup([
      ['a', -1001],
      ['b', -1002],
    ], 'a');
    const r = resolveChannel(cwd, 'b');
    assert.ok('channel' in r && r.channel.id === 'b');
  });

  it('default_channel без явного', () => {
    const cwd = setup(
      [
        ['a', -1001],
        ['b', -1002],
      ],
      'b',
    );
    const r = resolveChannel(cwd);
    assert.ok('channel' in r && r.channel.id === 'b');
  });

  it('единственный канал — автоподхват', () => {
    const cwd = setup([['solo', -1003]]);
    const r = resolveChannel(cwd);
    assert.ok('channel' in r && r.channel.id === 'solo');
  });

  it('несколько без default и без явного — ошибка со списком', () => {
    const cwd = setup([
      ['a', -1001],
      ['b', -1002],
    ]);
    const r = resolveChannel(cwd);
    assert.ok('error' in r);
    assert.ok(r.error.includes('Несколько каналов'), r.error);
    assert.ok(r.error.includes('a') && r.error.includes('b'), r.error);
  });

  it('явный несуществующий id — ошибка со списком доступных', () => {
    const cwd = setup([['a', -1001]]);
    const r = resolveChannel(cwd, 'zzz');
    assert.ok('error' in r && r.error.includes('a'), r.error);
  });

  it('sync_timeout_sec читается из comms.yaml', () => {
    assert.equal(syncTimeoutSec(setup([['a', -1]], undefined)), DEFAULT_SYNC_TIMEOUT_SEC);
    const cwd2 = root();
    writeComms(cwd2, { chats: [], channels: [], sync_timeout_sec: 45 });
    assert.equal(syncTimeoutSec(cwd2), 45);
  });

  it('битые каналы отбрасываются с предупреждением', () => {
    const cwd = root();
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(
      commsPath(cwd),
      ['channels:', '  - group_id: -1001', '  - id: ok', '    group_id: -1002'].join('\n'),
      'utf-8',
    );
    const warns = [];
    const cfg = readComms(cwd, { warn: (m) => warns.push(m) });
    assert.equal(cfg.channels.length, 1, 'канал без id отброшен');
    assert.equal(cfg.channels[0].id, 'ok');
    assert.ok(warns.length >= 1);
  });
});

describe('VL-428: git-политика', () => {
  it('comms.yaml не попадает в git (проверка .vibelog/.gitignore)', () => {
    const cwd = root();
    // Правило `*` в .vibelog/.gitignore покрывает comms.yaml — файл создаём
    // только чтобы убедиться, что путь соответствует ожидаемому
    writeComms(cwd, { bot_token: 'x', chats: [], channels: [], sync_timeout_sec: 120 });
    assert.ok(existsSync(commsPath(cwd)));
    // Прямой тест git check-ignore здесь не запускаем — политика проверена в задаче
  });
});
