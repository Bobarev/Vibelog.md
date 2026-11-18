/**
 * Тесты VL-428 — исходящий interbot_ask (AC4, AC5): валидация аргументов,
 * выбор канала, тикет, синхронное ожидание и аккуратный таймаут без ошибки.
 * Сеть мокается подменой globalThis.fetch; каталоги — только mkdtemp (VL-241).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseAskArgs,
  interbotAsk,
  MCP_CALL_CAP_SEC,
} from '../../../dist/core/interbot/ask.js';
import { writeComms, resolveChannel } from '../../../dist/core/comms.js';
import {
  createTicket,
  answerTicket,
  loadTickets,
  recoverStaleTickets,
} from '../../../dist/core/interbot/tickets.js';
import { parseAskCommand } from '../../../dist/bot/commands.js';

const roots = [];
function root() {
  const d = mkdtempSync(join(tmpdir(), 'vibelog-ask-'));
  roots.push(d);
  return d;
}
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

/** Сохраняет и снимает TELEGRAM_* из process.env (изоляция от хоста). */
const savedEnv = {};
for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_PROXY']) {
  savedEnv[k] = process.env[k];
  delete process.env[k];
}
// Восстановление — только в конце файла: afterEach вернул бы реальный
// токен хоста уже после первого теста, и следующие ушли бы в сеть
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** comms.yaml с токеном и одним каналом (default не нужен — единственный). */
function setupComms(cwd, { timeout = 120, channels, defaultChannel } = {}) {
  writeComms(cwd, {
    bot_token: '777:test-token',
    chats: [111],
    sync_timeout_sec: timeout,
    ...(defaultChannel ? { default_channel: defaultChannel } : {}),
    channels:
      channels ??
      [
        {
          id: 'g1',
          transport: 'telegram',
          group_id: -1001,
          addressing: 'mention',
          approval: 'auto',
        },
      ],
  });
}

/** Мок sendMessage: фиксирует вызовы, отдаёт message_id. */
function mockFetch(messageId = 42) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: messageId } }),
    };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

describe('VL-428: parseAskArgs (валидация)', () => {
  it('пустой question — ошибка; kind вне списка — ошибка', () => {
    assert.ok('error' in parseAskArgs({}));
    assert.ok('error' in parseAskArgs({ question: '   ' }));
    assert.ok('error' in parseAskArgs({ question: 'x', kind: 'magic' }));
  });

  it('валидные аргументы собираются, пустые поля отбрасываются', () => {
    const p = parseAskArgs({
      question: '  Что с релизом?  ',
      channel: ' g1 ',
      to: '@OtherBot',
      task: 'VL-1',
      kind: 'decision_request',
    });
    assert.deepEqual(p, {
      question: 'Что с релизом?',
      channel: 'g1',
      to: '@OtherBot',
      task: 'VL-1',
      kind: 'decision_request',
    });
  });
});

describe('VL-428: interbot_ask — канал и отправка (AC4)', () => {
  it('единственный канал — автоподхват; адресат @префиксуется; тикет создаётся', async () => {
    const cwd = root();
    setupComms(cwd, { timeout: 1 });
    const mock = mockFetch(42);
    try {
      const out = await interbotAsk(cwd, { question: 'привет', to: '@OtherBot' });
      // Таймаут-фолбэк (ответ не пришёл) — текст, не исключение
      assert.ok(out.includes('Ответа нет'), out);
      assert.equal(mock.calls.length, 1);
      assert.ok(mock.calls[0].url.includes('/bot777:test-token/sendMessage'));
      assert.equal(mock.calls[0].body.chat_id, -1001);
      assert.equal(mock.calls[0].body.text, '@OtherBot привет');
      const tickets = loadTickets(cwd);
      assert.equal(tickets.length, 1);
      assert.equal(tickets[0].question_msg_id, 42);
      assert.equal(tickets[0].channel_id, 'g1');
      assert.equal(tickets[0].status, 'pending', 'тикет пережил таймаут — ждёт async-fallback');
      // Разбор при старте бота: просроченный pending → expired
      assert.deepEqual(recoverStaleTickets(cwd), [tickets[0].id]);
      assert.equal(loadTickets(cwd)[0].status, 'expired');
    } finally {
      mock.restore();
    }
  });

  it('явный channel переопределяет default; несуществующий — ошибка со списком', async () => {
    const cwd = root();
    setupComms(cwd, {
      timeout: 1,
      defaultChannel: 'a',
      channels: [
        { id: 'a', transport: 'telegram', group_id: -1, addressing: 'mention', approval: 'auto' },
        { id: 'b', transport: 'telegram', group_id: -2, addressing: 'mention', approval: 'auto' },
      ],
    });
    // default — канал a
    const r1 = resolveChannel(cwd);
    assert.equal(r1.channel.id, 'a');
    // явный b — переопределяет
    const mock = mockFetch(7);
    try {
      await interbotAsk(cwd, { question: 'x', channel: 'b' });
      assert.equal(mock.calls[0].body.chat_id, -2);
    } finally {
      mock.restore();
    }
    // несуществующий — ошибка со списком доступных
    await assert.rejects(
      () => interbotAsk(cwd, { question: 'x', channel: 'zzz' }),
      (err) => err.message.includes('Доступные: a, b'),
    );
  });

  it('несколько каналов без default и без явного — ошибка со списком', async () => {
    const cwd = root();
    setupComms(cwd, {
      channels: [
        { id: 'a', transport: 'telegram', group_id: -1, addressing: 'mention', approval: 'auto' },
        { id: 'b', transport: 'telegram', group_id: -2, addressing: 'mention', approval: 'auto' },
      ],
    });
    await assert.rejects(
      () => interbotAsk(cwd, { question: 'x' }),
      (err) => err.message.includes('Несколько каналов') && err.message.includes('a, b'),
    );
  });

  it('нет токена — понятная ошибка (не отправка в пустоту)', async () => {
    const cwd = root();
    writeComms(cwd, {
      chats: [],
      sync_timeout_sec: 120,
      channels: [
        { id: 'a', transport: 'telegram', group_id: -1, addressing: 'mention', approval: 'auto' },
      ],
    });
    await assert.rejects(
      () => interbotAsk(cwd, { question: 'x' }),
      (err) => err.message.includes('comms.yaml'),
    );
  });
});

describe('VL-428: interbot_ask — синхронное ожидание (AC5)', () => {
  it('ответ вовремя → возвращается текст ответа чужого бота', async () => {
    const cwd = root();
    setupComms(cwd, { timeout: 30 });
    const mock = mockFetch(42);
    try {
      const promise = interbotAsk(cwd, { question: 'план?', task: 'VL-9' });
      // Ждём появления тикета и отвечаем в него (как сделал бы бот)
      for (let i = 0; i < 40 && loadTickets(cwd).length === 0; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      const tickets = loadTickets(cwd);
      assert.equal(tickets.length, 1);
      assert.equal(tickets[0].status, 'pending');
      assert.equal(tickets[0].context.task, 'VL-9');
      answerTicket(cwd, tickets[0].question_msg_id, 'План утверждён.');
      const out = await promise;
      assert.equal(out, 'План утверждён.');
      assert.equal(loadTickets(cwd)[0].status, 'answered');
    } finally {
      mock.restore();
    }
  });

  it('таймаут → аккуратный «ответа нет» БЕЗ исключения; тикет остаётся (AC5)', async () => {
    const cwd = root();
    setupComms(cwd, { timeout: 1 });
    const mock = mockFetch(42);
    try {
      const out = await interbotAsk(cwd, { question: 'никто не ответит' });
      assert.ok(!out.includes('Error'), out);
      assert.ok(out.includes('Ответа нет'), out);
      const t = loadTickets(cwd)[0];
      assert.equal(t.status, 'pending', 'тикет живёт до дедлайна/async-fallback');
    } finally {
      mock.restore();
    }
  });

  it('потолок ожидания — min(sync_timeout, MCP_CALL_CAP_SEC)', () => {
    assert.ok(MCP_CALL_CAP_SEC < 60, 'должен быть меньше лимита MCP-клиента 60 с');
  });
});

describe('VL-428: разбор протухших тикетов (AC6)', () => {
  it('pending с истёкшим deadline → expired при recoverStaleTickets', () => {
    const cwd = root();
    const t = createTicket(cwd, {
      id: 'ib-1',
      channel_id: 'g1',
      question_msg_id: 5,
      timeoutSec: -10, // уже просрочен
    });
    assert.equal(t.status, 'pending');
    const stale = recoverStaleTickets(cwd);
    assert.deepEqual(stale, ['ib-1']);
    assert.equal(loadTickets(cwd)[0].status, 'expired');
    // повтор — no-op
    assert.deepEqual(recoverStaleTickets(cwd), []);
  });
});

describe('VL-428: parseAskCommand (/ask, AC4)', () => {
  it('без аргументов — синтаксис; question обязателен', () => {
    assert.ok('error' in parseAskCommand(''));
    assert.ok('error' in parseAskCommand('--channel g1'));
  });

  it('канал, адресат и вопрос разбираются; без --channel — только вопрос', () => {
    assert.deepEqual(parseAskCommand('что с релизом?'), { question: 'что с релизом?' });
    assert.deepEqual(parseAskCommand('--channel lb @OtherBot как дела?'), {
      question: 'как дела?',
      channel: 'lb',
      to: '@OtherBot',
    });
    // Полный текст команды тоже принимается (не только ctx.match)
    assert.deepEqual(parseAskCommand('/ask привет'), { question: 'привет' });
  });
});
