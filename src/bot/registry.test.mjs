/**
 * Тесты VL-54 — реестр команд бота и синхронизация меню с Telegram.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BOT_COMMANDS, commandsHelp, helpText, syncCommands } from '../../dist/bot/registry.js';
import { chunkRich } from '../../dist/bot/rich.js';
import { escapeMarkdownV2 } from '../../dist/bot/formatting.js';

describe('BOT_COMMANDS (VL-54)', () => {
  it('реестр валиден по лимитам Telegram', () => {
    assert.equal(BOT_COMMANDS.length, 22, `ожидалось 22 команда, получено: ${BOT_COMMANDS.length}`);
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

  it('команда set в реестре с usage agent/max-wall-time/max-requests/branch-mode/compact (VL-94/104/107/122)', () => {
    const set = BOT_COMMANDS.find((c) => c.command === 'set');
    assert.ok(set, 'команда set отсутствует в реестре');
    assert.equal(
      set.usage,
      '/set agent <qwen|vb> | max-wall-time <сек> | max-requests <N> | branch-mode <on|off> | compact <on|off>'
    );
  });

  it('команда restart в реестре упоминает VL-N и корневой dist (VL-107)', () => {
    const restart = BOT_COMMANDS.find((c) => c.command === 'restart');
    assert.ok(restart, 'команда restart отсутствует в реестре');
    assert.match(restart.description, /VL-N/);
    assert.match(restart.description, /dist/);
  });

  it('команды фаз в реестре с синтаксисом [:agent] (VL-94)', () => {
    for (const name of ['spec', 'plan', 'code', 'close', 'comment']) {
      const c = BOT_COMMANDS.find((x) => x.command === name);
      assert.ok(c, `команда ${name} отсутствует в реестре`);
      assert.ok(
        (c.usage ?? '').includes('[:agent]') || c.description.includes('[:agent]'),
        `у ${name} нет синтаксиса [:agent]`
      );
    }
  });

  it('команда prompt в реестре с usage /prompt[:agent] <текст> (VL-66/92)', () => {
    const prompt = BOT_COMMANDS.find((c) => c.command === 'prompt');
    assert.ok(prompt, 'команда prompt отсутствует в реестре');
    assert.equal(prompt.usage, '/prompt[:agent] <текст>');
    assert.match(prompt.description, /qwen/);
    // Описание отражает обоих агентов (VL-92)
    assert.match(prompt.description, /встроенн/);
  });

  it('реестр покрывает все bot.command из handlers.ts (имена и порядок)', async () => {
    // Файл лежит рядом с тестом — сверяем реестр с реальной регистрацией команд.
    // VL-92: вариант команды может регистрироваться массивом (['prompt', ...]) —
    // regex разбирает обе формы, массив разворачивается в плоский список.
    const src = await readFile(new URL('handlers.ts', import.meta.url), 'utf8');
    const registered = [...src.matchAll(/bot\.command\(\s*(?:'([^']+)'|\[([^\]]+)\])/g)].flatMap(
      (m) => (m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().replace(/['\[\]]/g, '')))
    );
    // Варианты с суффиксом (prompt:vb) в реестр Telegram не входят —
    // двоеточие запрещено в BotCommand.command; сверяем базовые имена
    const base = registered.filter((c) => !c.includes(':'));
    assert.deepEqual(
      base,
      BOT_COMMANDS.map((c) => c.command),
      'имена/порядок в handlers.ts и реестре расходятся'
    );
    // Суффиксные варианты (VL-92) зарегистрированы и привязаны к реестру
    for (const v of registered.filter((c) => c.includes(':'))) {
      assert.ok(
        BOT_COMMANDS.some((c) => c.command === v.split(':')[0]),
        `вариант "${v}" не привязан к команде реестра`
      );
    }
  });

  it('команда analyze в реестре с usage /analyze[:agent] <session-ref> [комментарий] (VL-141/169)', () => {
    const analyze = BOT_COMMANDS.find((c) => c.command === 'analyze');
    assert.ok(analyze, 'команда analyze отсутствует в реестре');
    assert.equal(analyze.usage, '/analyze[:agent] <session-ref> [комментарий]');
    assert.match(analyze.description, /vb:agent-XXX/);
    assert.match(analyze.description, /вердикт|рекомендац/i);
  });

  it('команда resume в реестре с usage /resume[:agent] <session-ref> [комментарий] (VL-171)', () => {
    const resume = BOT_COMMANDS.find((c) => c.command === 'resume');
    assert.ok(resume, 'команда resume отсутствует в реестре');
    assert.equal(resume.usage, '/resume[:agent] <session-ref> [комментарий]');
    assert.match(resume.description, /возобнов/i);
    assert.ok(resume.examples?.length, 'у resume нет examples');
  });

  it('commandsHelp() повторяет прежний хардкод help-строки /start', () => {
    assert.equal(
      commandsHelp(),
      '/help, /tasks, /task <id>, /docs, /doc <id>, /board, /diff, /commits [N], /create, /status, /set agent <qwen|vb> | max-wall-time <сек> | max-requests <N> | branch-mode <on|off> | compact <on|off>, /comment[:agent] VL-1 <текст>, /spec[:agent] <описание>, /plan[:agent] VL-<id> [комментарий], /code[:agent] VL-<id> [комментарий], /close[:agent] VL-<id>, /prompt[:agent] <текст>, /analyze[:agent] <session-ref> [комментарий], /resume[:agent] <session-ref> [комментарий], /restart, /web start [VL-N] | /web stop'
    );
  });

  it('команда web в реестре с usage /web start [VL-N] | /web stop (VL-161)', () => {
    const web = BOT_COMMANDS.find((c) => c.command === 'web');
    assert.ok(web, 'команда web отсутствует в реестре');
    assert.equal(web.usage, '/web start [VL-N] | /web stop');
  });
});

describe('helpText (VL-150)', () => {
  it('справка содержит заголовок и команду help', () => {
    const text = helpText();
    // Заголовок в MarkdownV2 — дефис экранирован (Vibelog\-бота)
    assert.ok(text.includes(escapeMarkdownV2('Команды Vibelog-бота')), 'нет заголовка справки');
    assert.ok(text.includes('/help'), 'команда help отсутствует в справке');
  });

  it('каждая команда реестра представлена в справке (usage или /имя)', () => {
    const text = helpText();
    for (const c of BOT_COMMANDS) {
      // Справка — MarkdownV2: спецсимволы usage экранированы, сравниваем в том же виде
      assert.ok(
        text.includes(escapeMarkdownV2(c.usage ?? '/' + c.command)),
        `команда ${c.command} не найдена в справке`
      );
    }
  });

  it('примеры set экранированы и присутствуют в справке', () => {
    const text = helpText();
    const set = BOT_COMMANDS.find((c) => c.command === 'set');
    assert.ok(set?.examples?.length, 'у set нет examples');
    for (const ex of set.examples) {
      assert.ok(text.includes(escapeMarkdownV2(ex)), `пример "${ex}" отсутствует в справке`);
    }
  });

  it('части справки не превышают лимит Telegram после chunkRich', () => {
    for (const part of chunkRich(helpText(), 4096)) {
      assert.ok(part.length <= 4096, `часть справки длиной ${part.length} > 4096`);
    }
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
