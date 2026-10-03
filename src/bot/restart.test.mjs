/**
 * Тесты VL-70 — самоперезапуск бота: spawn замещающего процесса и реестр.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vibelogCliPath, spawnReplacementBot } from '../../dist/bot/restart.js';
import { BOT_COMMANDS } from '../../dist/bot/registry.js';

describe('vibelogCliPath (VL-70)', () => {
  it('указывает на существующий bin/vibelog.mjs', () => {
    const p = vibelogCliPath();
    assert.match(p, /bin\/vibelog\.mjs$/);
    assert.ok(existsSync(p), `файл CLI не найден: ${p}`);
  });
});

describe('spawnReplacementBot (VL-70)', () => {
  // Изоляция окружения: TELEGRAM_BOT_TOKEN может быть задан глобально на машине
  // разработчика — дочерний процесс нашёл бы его в env и ушёл в реальный
  // long-polling: тест висел до таймаута и плодил живых ботов (поймано 2026-10-03).
  let savedToken;
  before(() => {
    savedToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });
  after(() => {
    if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
  });

  it('запускает новый vibelog bot; без токена — понятная ошибка в stderr', async () => {
    // tmp-каталог без .env/.vibelog: резолв токена падает — процесс бота
    // завершается с сообщением «Токен не найден» (fast-fail, без сети)
    const cwd = mkdtempSync(join(tmpdir(), 'vibelog-restart-'));
    const child = spawnReplacementBot(cwd, 'pipe');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (c) => resolve(c));
    });
    assert.match(stderr, /Токен Telegram-бота не найден/, `stderr: ${stderr}`);
    assert.equal(code, 0, `ожидался exit 0, получен: ${code}; stdout=${stdout}`);
  });

  it('процесс создаётся (событие spawn) — detached+unref не мешают старту', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vibelog-restart-'));
    const child = spawnReplacementBot(cwd, 'pipe');
    const spawned = await new Promise((resolve, reject) => {
      child.once('spawn', () => resolve(true));
      child.once('error', reject);
    });
    assert.equal(spawned, true);
  });
});

describe('реестр: команда restart (VL-70)', () => {
  it('команда restart в BOT_COMMANDS', () => {
    const cmd = BOT_COMMANDS.find((c) => c.command === 'restart');
    assert.ok(cmd, 'команда restart отсутствует в реестре');
    assert.match(cmd.description, /Перезапус/i);
  });
});
