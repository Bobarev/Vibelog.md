/**
 * Тесты VL-54 — реестр команд бота и синхронизация меню с Telegram.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BOT_COMMANDS, commandsHelp, syncCommands } from '../../dist/bot/registry.js';

describe('BOT_COMMANDS (VL-54)', () => {
  it('реестр валиден по лимитам Telegram', () => {
    assert.equal(BOT_COMMANDS.length, 12, `ожидалось 12 команд, получено: ${BOT_COMMANDS.length}`);
    assert.ok(BOT_COMMANDS.length <= 100, 'лимит Telegram: не более 100 команд');
    const seen = new Set();
    for (const c of BOT_COMMANDS) {
      assert.ok(c.command.length > 0 && c.command.length <= 32, `имя "${c.command}" вне лимита 32`);
      assert.ok(c.description.length > 0, `пустое описание у "${c.command}"`);
      assert.ok(c.description.length <= 256, `описание "${c.command}" длиннее 256`);
      assert.ok(!seen.has(c.command), `дубликат имени "${c.command}"`);
      seen.add(c.command);
    }
  });

  it('команда prompt в реестре с usage /prompt <текст> (VL-66)', () => {
    const prompt = BOT_COMMANDS.find((c) => c.command === 'prompt');
    assert.ok(prompt, 'команда prompt отсутствует в реестре');
    assert.equal(prompt.usage, '/prompt <текст>');
    assert.match(prompt.description, /qwen/);
  });

  it('реестр покрывает все bot.command из handlers.ts (имена и порядок)', async () => {
    // Файл лежит рядом с тестом — сверяем реестр с реальной регистрацией команд
    const src = await readFile(new URL('handlers.ts', import.meta.url), 'utf8');
    const registered = [...src.matchAll(/bot\.command\('([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(
      registered,
      BOT_COMMANDS.map((c) => c.command),
      'имена/порядок в handlers.ts и реестре расходятся'
    );
  });

  it('commandsHelp() повторяет прежний хардкод help-строки /start', () => {
    assert.equal(
      commandsHelp(),
      '/tasks, /task <id>, /board, /create, /status, /comment, /spec, /plan, /code, /close, /prompt <текст>'
    );
  });
});

describe('syncCommands (VL-54)', () => {
  it('вызывает setMyCommands с полным списком команд', async () => {
    let captured = null;
    const mock = { api: { setMyCommands: async (cmds) => { captured = cmds; } } };
    await syncCommands(mock);
    assert.deepEqual(captured, BOT_COMMANDS);
  });

  it('не бросает при ошибке сети (бот продолжает polling)', async () => {
    const mock = { api: { setMyCommands: async () => { throw new Error('network'); } } };
    const original = console.error;
    console.error = () => {};
    try {
      await assert.doesNotReject(syncCommands(mock));
    } finally {
      console.error = original;
    }
  });
});
