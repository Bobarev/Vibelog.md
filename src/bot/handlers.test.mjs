/**
 * Тесты VL-430 — interbot-ветка на `bot.on('message')` (rich-ответ чужого бота
 * без поля text) и нетекстовые сообщения.
 *
 * Паттерн: in-process grammy-бот с botInfo (без init/сети), фейковые update →
 * bot.handleUpdate. Сетевые вызовы глушатся стабом bot.api.* — в кейсах AC1/AC3
 * send-вызовов нет вовсе, в AC2 ловим уведомление async-fallback.
 * Каталоги — только mkdtemp (VL-241), env — clearPhaseEnv на уровне файла
 * (lesson-254).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearPhaseEnv } from '../test-env.mjs';
import { Bot } from 'grammy';

import { registerHandlers, askWaiterTick } from '../../dist/bot/handlers.js';
import { writeComms } from '../../dist/core/comms.js';
import { answerTicket, createTicket, loadTickets } from '../../dist/core/interbot/tickets.js';

const roots = [];
let restoreEnv;

function root() {
  const d = mkdtempSync(join(tmpdir(), 'vibelog-handlers-'));
  roots.push(d);
  return d;
}

beforeAll(() => {
  restoreEnv = clearPhaseEnv();
});

afterAll(() => {
  restoreEnv?.();
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

/** comms.yaml с каналом, group_id которого совпадает с chat.id фейковых update. */
function setupComms(cwd) {
  writeComms(cwd, {
    bot_token: '777:test-token',
    chats: [111],
    sync_timeout_sec: 120,
    channels: [
      { id: 'g1', transport: 'telegram', group_id: -1001, addressing: 'mention', approval: 'auto' },
    ],
  });
}

/** Бот с botInfo — handleUpdate работает без init() и без сети. */
function makeBot() {
  return new Bot('123456:TEST', {
    botInfo: { id: 42, is_bot: true, first_name: 'T', username: 'our_bot' },
  });
}

/**
 * Стаб сети через transformer (bot.api.config.use): grammy копирует
 * трансформеры в per-update Api (handleUpdate) — ловит и прямые bot.api-вызовы,
 * и ctx-пути (ctx.reply/ctx.api), не трогая реальный fetch.
 */
function stubApi(bot) {
  const calls = [];
  bot.api.config.use((prev, method, payload, signal) => {
    if (method === 'sendMessage' || method === 'sendRichMessage' || method === 'deleteMessage') {
      calls.push({ method, payload });
      return Promise.resolve({
        ok: true,
        result: method === 'deleteMessage' ? true : { message_id: 61 },
      });
    }
    return prev(method, payload, signal);
  });
  return calls;
}

/** Фейковый rich-update: ответ чужого бота на наш вопрос (структура VL-93). */
function richTicketUpdate({ messageId = 80, replyTo = 78, expired = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: now,
      chat: { id: -1001, type: 'supergroup', title: 'G' },
      from: { id: 777, is_bot: true, first_name: 'UI', username: 'vibelog_ui_bot' },
      reply_to_message: {
        message_id: replyTo,
        date: now,
        chat: { id: -1001, type: 'supergroup', title: 'G' },
        from: { id: 42, is_bot: true, first_name: 'T', username: 'our_bot' },
      },
      rich_message: {
        blocks: [
          { type: 'heading', text: [{ type: 'bold', text: 'Ответ UI' }], size: 1 },
          { type: 'paragraph', text: expired ? 'запоздавший понг' : 'понг из rich' },
        ],
      },
    },
  };
}

/** Нетекстовое сообщение (фото) от чужого бота в канале. */
function photoUpdate({ messageId = 90 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: now,
      chat: { id: -1001, type: 'supergroup', title: 'G' },
      from: { id: 777, is_bot: true, first_name: 'UI', username: 'vibelog_ui_bot' },
      photo: [{ file_id: 'f1', file_unique_id: 'u1', width: 90, height: 90 }],
    },
  };
}

/** Текстовое сообщение обычного пользователя (не бот); help-команде нужны entities. */
function userTextUpdate({ messageId = 91, text = '/help' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: now,
      chat: { id: -1001, type: 'supergroup', title: 'G' },
      from: { id: 500, is_bot: false, first_name: 'U', username: 'user' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    },
  };
}

/**
 * Регистрирует обработчики + sentinel ПОСЛЕ registerHandlers: если interbot-ветка
 * вызвала next(), sentinel сработает; ветка тикета next() не делает — sentinel молчит.
 */
function setupBot(cwd, extraDeps = {}) {
  const bot = makeBot();
  const calls = stubApi(bot);
  registerHandlers(bot, { cwd, getPin: () => '000000', ...extraDeps });
  const state = { sentinel: 0 };
  bot.on('message', () => {
    state.sentinel += 1;
  });
  return { bot, calls, state };
}

describe("VL-430: interbot-ветка на bot.on('message')", () => {
  let cwd;
  beforeEach(() => {
    cwd = root();
    setupComms(cwd);
  });

  it('AC1: rich-ответ на тикет → answerTicket, статус answered, без next()', async () => {
    const { bot, calls, state } = setupBot(cwd);
    createTicket(cwd, { id: 'ask-t1', channel_id: 'g1', question_msg_id: 78, timeoutSec: 120 });

    await bot.handleUpdate(richTicketUpdate({}));

    const tickets = loadTickets(cwd);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'answered');
    assert.match(tickets[0].reply ?? '', /понг из rich/, 'reply — плоский текст rich');
    assert.equal(state.sentinel, 0, 'ветка тикета не должна вызывать next()');
    assert.equal(calls.length, 0, 'синхронный путь без сетевых вызовов');
  });

  it('AC2: поздний rich-ответ → deliverLateTicket (уведомление + delivered)', async () => {
    const { bot, calls, state } = setupBot(cwd);
    createTicket(cwd, { id: 'ask-t2', channel_id: 'g1', question_msg_id: 78, timeoutSec: -10 });

    await bot.handleUpdate(richTicketUpdate({ messageId: 81, expired: true }));

    // deliverLateTicket — void-async: ждём завершения через поллинг статуса
    let status = '';
    for (let i = 0; i < 100 && status !== 'delivered'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = loadTickets(cwd)[0]?.status ?? '';
    }
    assert.equal(status, 'delivered', 'async-fallback доставил ответ');
    assert.equal(state.sentinel, 0, 'ветка тикета не вызывает next() и для expired');
    const notify = calls.find((c) => c.method === 'sendRichMessage');
    assert.ok(notify, 'уведомление «Запоздавший ответ» отправлено');
    const blob = JSON.stringify(calls);
    assert.match(blob, /Запоздавший ответ/);
    assert.match(blob, /запоздавший понг/, 'текст rich в уведомлении');
  });

  it('VL-431 AC3: поздний ответ с thread_id → дописка пары + авто-ход + delivered', async () => {
    // Тестовый шов HandlerDeps.startChatRun: реальный LLM-ход не стартуем
    const runs = [];
    const { bot, calls } = setupBot(cwd, {
      startChatRun: (body, runCwd) => {
        runs.push({ body, runCwd });
        return { run: { threadId: body.threadId } };
      },
    });
    // Тред существует (getChatThread требует файла истории)
    const threadId = 'chat-late-1';
    const dir = join(cwd, '.vibelog', 'chat-sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${threadId}.jsonl`),
      JSON.stringify({ role: 'user', content: 'привет' }) + '\n',
      'utf8',
    );
    createTicket(cwd, {
      id: 'ask-late-1',
      channel_id: 'g1',
      question_msg_id: 78,
      timeoutSec: -10,
      context: { thread_id: threadId },
    });

    await bot.handleUpdate(richTicketUpdate({ messageId: 83, expired: true }));

    // void-async: ждём завершения через поллинг статуса (паттерн AC2)
    let status = '';
    for (let i = 0; i < 150 && status !== 'delivered'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = loadTickets(cwd)[0]?.status ?? '';
    }
    assert.equal(status, 'delivered', 'markDelivered после успешной дописки');

    // (а) jsonl дополнен виртуальной парой
    const lines = readFileSync(join(dir, `${threadId}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const pair = lines.slice(-2);
    assert.equal(pair[0].role, 'assistant');
    assert.equal(pair[0].tool_calls[0].id, 'async-ask-late-1');
    assert.equal(pair[0].tool_calls[0].name, 'interbot_ask');
    assert.equal(pair[1].role, 'tool');
    assert.equal(pair[1].tool_call_id, 'async-ask-late-1');
    assert.match(pair[1].content, /запоздавший понг/, 'content — поздний ответ');

    // (б) авто-ход стартовал со стимулом
    assert.equal(runs.length, 1, 'startChatRun вызван один раз');
    assert.equal(runs[0].body.threadId, threadId);
    assert.match(runs[0].body.message, /Поздний interbot-ответ/);
    assert.match(runs[0].body.message, /доведи его до пользователя/);
    assert.equal(runs[0].runCwd, cwd);

    // (в) ветки взаимоисключающие: Telegram-уведомление НЕ шлём
    const notify = calls.find((c) => c.method === 'sendRichMessage');
    assert.ok(!notify, 'с thread_id прежний путь (Telegram) не работает');
  });

  it('VL-431 AC5: тред не найден → фолбэк на прежний путь (комментарий + Telegram)', async () => {
    const runs = [];
    const { bot, calls } = setupBot(cwd, {
      startChatRun: (body) => {
        runs.push(body);
        return { run: {} };
      },
    });
    createTicket(cwd, {
      id: 'ask-late-2',
      channel_id: 'g1',
      question_msg_id: 78,
      timeoutSec: -10,
      context: { thread_id: 'no-such-thread' },
    });

    await bot.handleUpdate(richTicketUpdate({ messageId: 84, expired: true }));

    let status = '';
    for (let i = 0; i < 150 && status !== 'delivered'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = loadTickets(cwd)[0]?.status ?? '';
    }
    assert.equal(status, 'delivered', 'тикет доставлен прежним путём');
    assert.equal(runs.length, 0, 'авто-ход не стартовал (дописка не удалась)');
    const notify = calls.find((c) => c.method === 'sendRichMessage');
    assert.ok(notify, 'уведомление отправлено прежним путём');
    assert.match(JSON.stringify(calls), /Запоздавший ответ/);
  });

  it('AC3: фото без text и rich_message → next(), тикеты не тронуты', async () => {
    const { bot, state } = setupBot(cwd);
    createTicket(cwd, { id: 'ask-t3', channel_id: 'g1', question_msg_id: 78, timeoutSec: 120 });

    await bot.handleUpdate(photoUpdate({}));

    assert.equal(state.sentinel, 1, 'next() дошёл до нижнего обработчика');
    assert.equal(loadTickets(cwd)[0].status, 'pending', 'тикет не тронут');
  });

  it('AC4-регрессия: текст пользователя проходит interbot-ветку next() до нижних веток', async () => {
    const { bot, calls, state } = setupBot(cwd);
    createTicket(cwd, { id: 'ask-t4', channel_id: 'g1', question_msg_id: 78, timeoutSec: 120 });

    // /help от обычного пользователя: interbot-ветка (не бот → next()) не должна
    // сорвать цепочку — команда help ниже по цепочке обязана отработать
    // (catch-all пина ниже команд последний, sentinel после registerHandlers
    // для текста недостижим — он и не должен достигаться, ловушка VL-37).
    await bot.handleUpdate(userTextUpdate({}));

    assert.equal(state.sentinel, 0, 'catch-all пина перехватывает текст (не next) — как раньше');
    assert.ok(
      calls.some((c) => c.method === 'sendMessage'),
      'help-команда ниже по цепочке отработала → interbot вызвал next()',
    );
    assert.equal(loadTickets(cwd)[0].status, 'pending', 'чужой тикет не тронут');
  });

  it('AC1-регрессия: пустой text проходит в ветку как раньше (filter.js: leaf != null)', async () => {
    const { bot, state } = setupBot(cwd);
    createTicket(cwd, { id: 'ask-t5', channel_id: 'g1', question_msg_id: 78, timeoutSec: 120 });

    const upd = richTicketUpdate({ messageId: 82 });
    upd.message.rich_message = { blocks: [] }; // richToText → ''
    // Пустой text от text-свойства: старый фильтр его пропускал ('' != null)
    upd.message.text = '';
    delete upd.message.rich_message;

    await bot.handleUpdate(upd);
    // Пустой текст без rich: textProp = '' → ветка работает (answerTicket с '')
    assert.equal(state.sentinel, 0, 'ветка не next() для text-свойства с ""');
    assert.equal(loadTickets(cwd)[0].status, 'answered');
  });

  it('AC3-доп: rich без текста (пустые блоки) → next()', async () => {
    const { bot, state } = setupBot(cwd);
    const upd = richTicketUpdate({ messageId: 83 });
    upd.message.rich_message = { blocks: [] };
    await bot.handleUpdate(upd);
    assert.equal(state.sentinel, 1, 'пустой richToText → next()');
  });
});

describe('VL-430 AC6: trace-перехват через transformer', () => {
  it('лог api.sendMessage из ctx-вызовов (per-update Api) виден в консоли', async () => {
    const cwd = root();
    setupComms(cwd);
    const bot = makeBot();
    // Стаб сети СНАЧАЛА, затем registerHandlers(trace) ставит логирующий
    // трансформер ПОЗЖЕ → он внешний в цепочке (reduce накладывает новые поверх):
    // лог пишется первым, вызов гасится стабом до реального fetch.
    bot.api.config.use((prev, method, payload, signal) => {
      if (method === 'sendMessage' || method === 'sendRichMessage') {
        return Promise.resolve({ ok: true, result: { message_id: 1 } });
      }
      return prev(method, payload, signal);
    });
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => {
      lines.push(args.join(' '));
      origLog(...args);
    };
    try {
      registerHandlers(bot, { cwd, getPin: () => '000000', trace: true });
      // ctx-путь: handleUpdate создаёт новый Api с КОПИЕЙ трансформеров —
      // до фикса instance-patch на bot.api этот вызов не логировался
      const upd = userTextUpdate({ messageId: 95, text: '/help' });
      upd.message.chat = { id: 555, type: 'private', first_name: 'U' };
      await bot.handleUpdate(upd);
    } finally {
      console.log = origLog;
    }
    // /help → sendMd через ctx.reply → ctx.api.sendMessage (per-update Api)
    assert.ok(
      lines.some((l) => l.includes('[trace] api.sendMessage')),
      `нет [trace] api.sendMessage; логи: ${lines.filter((l) => l.includes('[trace]')).join(' || ')}`,
    );
  });
});

// ── VL-432: фоновый тикер /ask — неблокирующее ожидание ответа ──
// askWaiterTick зовётся напрямую (без setInterval): fake-clock через opts.now,
// сеть — стаб bot.api через transformer (паттерн stubApi выше).
describe('VL-432: askWaiterTick — фоновый тикер /ask', () => {
  let cwd;
  beforeEach(() => {
    cwd = root();
    setupComms(cwd);
  });

  /** Бот только со стабом api (без registerHandlers — тикер зовём сами). */
  function tickBot() {
    const bot = makeBot();
    const calls = stubApi(bot);
    return { bot, calls };
  }

  it('AC6/AC2: answered до дедлайна → ответ в личку, снятие с карты, повторный тик без отправок (AC4)', async () => {
    const { bot, calls } = tickBot();
    const t = createTicket(cwd, { id: 'ask-vl432-1', channel_id: 'g1', question_msg_id: 78, timeoutSec: 120 });
    answerTicket(cwd, 78, 'понг из UI');
    const waiters = new Map([[t.id, { chatId: 555, timeout: 120 }]]);

    await askWaiterTick(bot, cwd, waiters);

    assert.equal(waiters.size, 0, 'тикет снят с карты после доставки');
    const blob = JSON.stringify(calls);
    assert.match(blob, /понг из UI/, 'reply доставлен в личку');
    assert.ok(calls.some((c) => c.method === 'sendRichMessage'), 'доставка rich-ответом');

    // Однократность: повторный тик по пустой карте — ни одного send (AC4)
    await askWaiterTick(bot, cwd, waiters);
    assert.equal(calls.length, 1, 'повторный тик без новых send');
  });

  it('AC6 fake-clock: answered при now за дедлайном → всё равно доставка, не «Ответа нет»', async () => {
    const { bot, calls } = tickBot();
    const t = createTicket(cwd, { id: 'ask-vl432-2', channel_id: 'g1', question_msg_id: 79, timeoutSec: 120 });
    answerTicket(cwd, 79, 'понг'); // ответ пришёл до дедлайна — статус заморожен
    const waiters = new Map([[t.id, { chatId: 555, timeout: 120 }]]);

    await askWaiterTick(bot, cwd, waiters, { now: () => Date.now() + 60_000 });

    assert.equal(waiters.size, 0);
    const blob = JSON.stringify(calls);
    assert.match(blob, /понг/);
    assert.doesNotMatch(blob, /Ответа нет/, 'answered важнее дедлайна');
  });

  it('AC3: дедлайн прошёл, входа нет → «Ответа нет» в личку, тикет остаётся pending', async () => {
    const { bot, calls } = tickBot();
    const t = createTicket(cwd, { id: 'ask-vl432-3', channel_id: 'g1', question_msg_id: 80, timeoutSec: -1 });
    const waiters = new Map([[t.id, { chatId: 555, timeout: 120 }]]);

    await askWaiterTick(bot, cwd, waiters);

    assert.equal(waiters.size, 0, 'дедлайн → снятие с карты');
    const blob = JSON.stringify(calls);
    assert.match(blob, /Ответа нет за 120 с/, 'текст контракта сохранён');
    assert.match(blob, /async.{0,3}fallback/, 'текст контракта сохранён (MarkdownV2 экранирует дефис)');
    assert.equal(loadTickets(cwd)[0].status, 'pending', 'тикет остаётся pending (AC3)');
  });

  it('AC6: expired → снятие с карты БЕЗ уведомления (deliverLateTicket владеет этим)', async () => {
    const { bot, calls } = tickBot();
    createTicket(cwd, { id: 'ask-vl432-4', channel_id: 'g1', question_msg_id: 81, timeoutSec: -1 });
    const upd = answerTicket(cwd, 81, 'запоздавший понг'); // now > deadline → expired
    assert.equal(upd.status, 'expired');
    const waiters = new Map([[upd.id, { chatId: 555, timeout: 120 }]]);

    await askWaiterTick(bot, cwd, waiters);

    assert.equal(waiters.size, 0, 'expired снят с карты');
    assert.equal(calls.length, 0, 'тикер не дублирует уведомление (AC4/AC6)');
  });

  it('пустая карта → no-op: файл не читается, send нет', async () => {
    const { bot, calls } = tickBot();
    await askWaiterTick(bot, cwd, new Map());
    assert.equal(calls.length, 0);
  });
});
