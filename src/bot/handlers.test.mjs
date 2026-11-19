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
  registerHandlers(bot, { cwd, getPin: () => '000000', gate: async () => ({ verdict: 'react' }), ...extraDeps });
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

  // ── VL-433: человек в interbot-канале — семантика Q1/Q3 ──

  it('VL-433 AC1/AC4: человек из interbot-канала БЕЗ адресации → process (не next, шов startPrompt)', async () => {
    const prompts = [];
    const { bot, state } = setupBot(cwd, {
      startPrompt: (cwdArg, prompt, onExit) => {
        prompts.push({ cwdArg, prompt, onExit });
        return { run: { pid: 42 } };
      },
    });
    createTicket(cwd, { id: 'ask-t4', channel_id: 'g1', question_msg_id: 78, timeoutSec: 120 });

    // /help от обычного пользователя в чате -1001 (= interbot-канал):
    // ветка НЕ делает next() (AC4) и запускает ран (AC1, без @ → ко всем)
    await bot.handleUpdate(userTextUpdate({}));

    assert.equal(state.sentinel, 0, 'interbot-ветка не отдаёт людей канала в нижние ветки');
    assert.equal(prompts.length, 1, 'запущен один ран через шов HandlerDeps.startPrompt');
    assert.ok(prompts[0].prompt.includes('/help'), 'промпт — текст сообщения человека');
    assert.equal(loadTickets(cwd)[0].status, 'pending', 'чужой тикет не тронут');
  });

  it('VL-433 AC4-регрессия: человек в чате ВНЕ interbot-канала — next(), команды работают как раньше', async () => {
    const prompts = [];
    const { bot, calls } = setupBot(cwd, {
      startPrompt: () => {
        prompts.push(1);
        return { run: { pid: 43 } };
      },
    });
    // Личка человека (chat вне comms) — канал не найден → next() по-прежнему
    const upd = userTextUpdate({});
    upd.message.chat = { id: 555, type: 'private', first_name: 'U' };
    await bot.handleUpdate(upd);

    assert.equal(prompts.length, 0, 'вне канала ветка не обрабатывает');
    assert.ok(
      calls.some((c) => c.method === 'sendMessage'),
      'help-команда ниже по цепочке отработала → next() сохранился',
    );
  });

  it('VL-433 AC3: reply-уточнение → prompt с цитатой родителя и парой «вопрос/ответ» из памяти', async () => {
    const captured = [];
    const { bot, state } = setupBot(cwd, {
      startPrompt: (cwdArg, prompt, onExit) => {
        captured.push({ prompt, onExit });
        return { run: { pid: 44 } };
      },
    });

    // 1) Первый вопрос человека (без адресации) → onExit с ответом в группу
    await bot.handleUpdate(userTextUpdate({ messageId: 120, text: 'что с релизом?' }));
    assert.equal(captured.length, 1);
    captured[0].onExit({ result: { result: 'релиз в пятницу' }, exitCode: 0 });
    // sendChatAnswer — void .then: ждём microtask/macrotask на регистрацию пары
    await new Promise((r) => setTimeout(r, 0));

    // 2) Уточнение: reply на наш «ответ» (stub вернул message_id 61)
    const upd = userTextUpdate({ messageId: 121, text: 'а во сколько?' });
    upd.message.reply_to_message = {
      message_id: 61,
      date: 0,
      chat: { id: -1001, type: 'supergroup', title: 'G' },
      from: { id: 42, is_bot: true, first_name: 'T', username: 'our_bot' },
      rich_message: {
        blocks: [{ type: 'paragraph', text: [{ type: 'text', text: 'релиз в пятницу' }] }],
      },
    };
    await bot.handleUpdate(upd);

    assert.equal(captured.length, 2, 'уточнение → второй ран (только у адресата — reply на нас)');
    const p = captured[1].prompt;
    assert.ok(p.includes('релиз в пятницу'), 'цитата сообщения-родителя (rich → richToText) в промпте');
    assert.ok(p.includes('что с релизом?'), 'прошлый вопрос ветки из process-памяти');
    assert.ok(p.indexOf('цитата') < p.indexOf('Вопрос:'), 'цитата — до секции «Вопрос:»');
    assert.equal(state.sentinel, 0, 'уточнение не уходит в нижние ветки');
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

// ── VL-434: depth считает свои ответы + служебные ошибки не в группу ──

describe('VL-434: interbot-шторм — fix A (depth) и fix B (служебное не в группу)', () => {
  let cwd;
  beforeEach(() => {
    cwd = root();
    setupComms(cwd);
  });

  /**
   * Стаб с ИНКРЕМЕНТАЛЬНЫМИ message_id (паттерн stubApi, но id растут):
   * каждый ответ бота получает новый id — иначе цепочка depth не строится.
   * reply_to_message эхо-echo из payload.reply_parameters — richDroppedReply
   * не срабатывает (иначе каждый ответ ушёл бы delete+досылкой).
   */
  function setupBotIncIds(cwdArg, extraDeps = {}) {
    const bot = makeBot();
    const calls = [];
    let nextId = 100;
    bot.api.config.use((prev, method, payload, signal) => {
      if (method === 'sendMessage' || method === 'sendRichMessage' || method === 'deleteMessage') {
        calls.push({ method, payload });
        if (method === 'deleteMessage') return Promise.resolve({ ok: true, result: true });
        const reply = payload?.reply_parameters?.message_id;
        return Promise.resolve({
          ok: true,
          result: {
            message_id: ++nextId,
            ...(reply !== undefined ? { reply_to_message: { message_id: reply } } : {}),
          },
        });
      }
      return prev(method, payload, signal);
    });
    registerHandlers(bot, { cwd: cwdArg, getPin: () => '000000', gate: async () => ({ verdict: 'react' }), ...extraDeps });
    return { bot, calls };
  }

  /** Входящий вопрос чужого бота в interbot-канале (addressing=mention). */
  function botQuestion({ messageId, replyTo, text = '/q@our_bot что с релизом?' }) {
    const now = Math.floor(Date.now() / 1000);
    const m = {
      message_id: messageId,
      date: now,
      chat: { id: -1001, type: 'supergroup', title: 'G' },
      from: { id: 777, is_bot: true, first_name: 'UI', username: 'vibelog_ui_bot' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    };
    if (replyTo !== undefined) {
      m.reply_to_message = {
        message_id: replyTo,
        date: now,
        chat: { id: -1001, type: 'supergroup', title: 'G' },
        from: { id: 42, is_bot: true, first_name: 'T', username: 'our_bot' },
      };
    }
    return { update_id: messageId, message: m };
  }

  it('AC3: ошибка «Запуск уже выполняется» НЕ публикуется в группу (только trace/консоль)', async () => {
    const { bot, calls } = setupBotIncIds(cwd, {
      startPrompt: () => ({ error: 'Запуск уже выполняется' }),
    });

    await bot.handleUpdate(botQuestion({ messageId: 130 }));
    // void-пути: даём дожить возможным async-веткам
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(calls.length, 0, 'ни одного send-вызова: материала для петли ошибка↔отчёт нет');
    assert.ok(
      !JSON.stringify(calls).includes('Не удалось запустить ран'),
      'служебная ошибка не ушла в группу',
    );
  });

  it('AC2: цепочка со СВОИМИ ответами → depth растёт, 3-й хоп обрывается «Цепочка слишком длинная»', async () => {
    const prompts = [];
    const { bot, calls } = setupBotIncIds(cwd, {
      startPrompt: (cwdArg, prompt, onExit) => {
        prompts.push({ prompt, onExit });
        return { run: { pid: 50 } };
      },
    });

    // Хоп 1: чужой вопрос (depth 0) → ран → наш ответ id=101 (reply на 1)
    await bot.handleUpdate(botQuestion({ messageId: 1 }));
    assert.equal(prompts.length, 1, 'первый вопрос обработан');
    prompts[0].onExit({ result: { result: 'ответ 1' }, exitCode: 0 });
    await new Promise((r) => setTimeout(r, 0));

    // Хоп 2: чужой reply на НАШ ответ 101 → map[2]=101 + map[101]=1 (fix A) → depth=2 → process
    await bot.handleUpdate(botQuestion({ messageId: 2, replyTo: 101, text: '/q@our_bot уточни' }));
    assert.equal(prompts.length, 2, 'depth=2 в пределах maxDepth — второй ран пошёл');
    prompts[1].onExit({ result: { result: 'ответ 2' }, exitCode: 0 });
    await new Promise((r) => setTimeout(r, 0));

    // Хоп 3: чужой reply на наш ответ 102 → depth=3 > maxDepth=2 → штатный рубеж, БЕЗ рана
    await bot.handleUpdate(botQuestion({ messageId: 3, replyTo: 102, text: '/q@our_bot ещё?' }));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(prompts.length, 2, 'третий хоп не запустил ран — петля оборвана');
    const blob = JSON.stringify(calls);
    assert.ok(blob.includes('Цепочка слишком длинная'), `нет штатного ответа depth: ${blob}`);
    assert.ok(!blob.includes('Не удалось запустить ран'), 'служебных ошибок в группе нет');

    // Регрессия «до fix A»: без пары 101→1 depth на хопе 2 был бы 1 (не 2),
    // а хоп 3 — depth 2 → ран бы пошёл. Здесь depth=3 — fix работает.
  });

  it('AC3-доп: входящее в момент идущего рана без ответа → НЕ создаёт сообщение-ответ', async () => {
    const prompts = [];
    const { bot, calls } = setupBotIncIds(cwd, {
      startPrompt: (cwdArg, prompt, onExit) => {
        prompts.push({ prompt, onExit });
        return { run: { pid: 51 } };
      },
    });

    // Первый ран висит (onExit НЕ вызываем), приходит второе входящее:
    // второй startPrompt вернёт ошибку «Запуск уже выполняется»
    await bot.handleUpdate(botQuestion({ messageId: 10 }));
    assert.equal(prompts.length, 1);
    // Меняем шов: следующий старт падает (симуляция «уже выполняется»)
    // Шов уже записан в closures — вызываем error-ветку через нового бота:
    // проще: второй бот с error-шовом, та же картина входа
    const { bot: bot2, calls: calls2 } = setupBotIncIds(cwd, {
      startPrompt: () => ({ error: 'Запуск уже выполняется' }),
    });
    await bot2.handleUpdate(botQuestion({ messageId: 11 }));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(calls2.length, 0, 'ошибка старта не породила сообщение в группу');
    assert.equal(calls.length, 0, 'первый (висящий) ран тоже ничего не отправил');
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

// ── VL-436: гейт react|read_only, право молчать <no_answer>, срезка [DECISION] ──
// doc-34 §3.2/§3.3/§4. Стаб гейта в тестах обязателен (иначе реальный LLM-вызов,
// паттерн VL-240): дефолт в хелперах — verdict react.

describe('VL-436: interbot-гейт и право молчать (doc-34)', () => {
  let cwd;
  beforeEach(() => {
    cwd = root();
    setupComms(cwd);
  });

  /** Вопрос чужого бота в interbot-канале (паттерн VL-434). */
  function botQuestion({ messageId, replyTo, text = '/q@our_bot что с релизом?' }) {
    const now = Math.floor(Date.now() / 1000);
    const m = {
      message_id: messageId,
      date: now,
      chat: { id: -1001, type: 'supergroup', title: 'G' },
      from: { id: 777, is_bot: true, first_name: 'UI', username: 'vibelog_ui_bot' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    };
    if (replyTo !== undefined) {
      m.reply_to_message = {
        message_id: replyTo,
        date: now,
        chat: { id: -1001, type: 'supergroup', title: 'G' },
        from: { id: 42, is_bot: true, first_name: 'T', username: 'our_bot' },
      };
    }
    return { update_id: messageId, message: m };
  }

  /** Сообщение человека (+ опц. reply на другое сообщение). */
  function humanUpd({ messageId, text, replyTo, replyFromBot = false }) {
    const now = Math.floor(Date.now() / 1000);
    const m = {
      message_id: messageId,
      date: now,
      chat: { id: -1001, type: 'supergroup', title: 'G' },
      from: { id: 500, is_bot: false, first_name: 'U', username: 'user' },
      text,
    };
    if (replyTo !== undefined) {
      m.reply_to_message = {
        message_id: replyTo,
        date: now,
        chat: { id: -1001, type: 'supergroup', title: 'G' },
        from: replyFromBot
          ? { id: 777, is_bot: true, first_name: 'UI', username: 'vibelog_ui_bot' }
          : { id: 500, is_bot: false, first_name: 'U', username: 'user' },
      };
    }
    return { update_id: messageId, message: m };
  }

  /** Callback «✅ Опубликовать» на карточке решения в admin_chat. */
  function ibotOkUpdate(seqId) {
    const now = Math.floor(Date.now() / 1000);
    return {
      update_id: 9500,
      callback_query: {
        id: 'cb-vl436',
        from: { id: 500, is_bot: false, first_name: 'U', username: 'admin' },
        chat_instance: 'ci',
        data: `ibot:ok:${seqId}`,
        message: {
          message_id: 700,
          date: now,
          chat: { id: 111, type: 'private', first_name: 'U' },
          from: { id: 42, is_bot: true, first_name: 'T', username: 'our_bot' },
          text: '⚖️ карточка решения',
        },
      },
    };
  }

  /** Бот со стабом api (включая answerCallbackQuery) и инкрементальными id. */
  function gateBot(extraDeps = {}) {
    const bot = makeBot();
    const calls = [];
    let nextId = 300;
    bot.api.config.use((prev, method, payload, signal) => {
      if (
        method === 'sendMessage' ||
        method === 'sendRichMessage' ||
        method === 'deleteMessage' ||
        method === 'answerCallbackQuery'
      ) {
        calls.push({ method, payload });
        if (method === 'deleteMessage' || method === 'answerCallbackQuery') {
          return Promise.resolve({ ok: true, result: method === 'deleteMessage' ? true : true });
        }
        return Promise.resolve({
          ok: true,
          result: {
            message_id: ++nextId,
            ...(payload?.reply_parameters?.message_id !== undefined
              ? { reply_to_message: { message_id: payload.reply_parameters.message_id } }
              : {}),
          },
        });
      }
      return prev(method, payload, signal);
    });
    registerHandlers(bot, {
      cwd,
      getPin: () => '000000',
      gate: async () => ({ verdict: 'react' }),
      ...extraDeps,
    });
    return { bot, calls };
  }

  it('AC1: гейт read_only → ран НЕ запущен, ничего не отправлено, только trace-решение', async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => {
      logs.push(a.join(' '));
      origLog(...a);
    };
    let started = 0;
    try {
      const { bot, calls } = gateBot({
        trace: true,
        gate: async () => ({ verdict: 'read_only' }),
        startPrompt: () => {
          started += 1;
          return { run: { pid: 1 } };
        },
      });
      await bot.handleUpdate(botQuestion({ messageId: 600 }));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(started, 0, 'ран не запущен');
      assert.equal(calls.length, 0, 'ни одной отправки');
      assert.ok(
        logs.some((l) => l.includes('гейт') && l.includes('read_only')),
        `нет trace-решения гейта; логи: ${logs.filter((l) => l.includes('trace')).join(' || ')}`,
      );
    } finally {
      console.log = origLog;
    }
  });

  it('AC1: read_only обновляет контекст ветки — reply-уточнение видит прочитанное в prompt', async () => {
    const prompts = [];
    const { bot } = gateBot({
      gate: async (c, incoming) =>
        incoming.text.includes('всем спасибо') ? { verdict: 'read_only' } : { verdict: 'react' },
      startPrompt: (cwdArg, prompt) => {
        prompts.push(prompt);
        return { run: { pid: 2 } };
      },
    });
    // 1) человек — пустая вежливость → гейт read_only: контекст записан, тишина
    await bot.handleUpdate(humanUpd({ messageId: 610, text: 'всем спасибо!' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(prompts.length, 0, 'read_only → без рана');
    // 2) reply-уточнение на прочитанное → гейт react → prompt с контекстом ветки
    await bot.handleUpdate(humanUpd({ messageId: 611, text: 'плюсую!', replyTo: 610 }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(prompts.length, 1, 'react → ран запущен');
    assert.ok(
      prompts[0].includes('Предыдущий вопрос и ответ в этой ветке:'),
      'контекст read_only-сообщения попал в промпт',
    );
    assert.ok(prompts[0].includes('Вопрос: всем спасибо!'), 'прочитанное сообщение видно ветке');
    assert.ok(!prompts[0].includes('Ответ:'), 'голая «Ответ: » не рисуется');
  });

  it('AC1: гейт react → прежний путь, startPrompt зван', async () => {
    const prompts = [];
    const { bot, calls } = gateBot({
      gate: async () => ({ verdict: 'react' }),
      startPrompt: (cwdArg, prompt) => {
        prompts.push(prompt);
        return { run: { pid: 3 } };
      },
    });
    await bot.handleUpdate(botQuestion({ messageId: 620 }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(prompts.length, 1, 'ран пошёл');
    assert.ok(prompts[0].includes('что с релизом?'), 'промпт входящего собран как раньше');
    assert.equal(calls.length, 0, 'до onExit отправок нет');
  });

  it('AC2: сбой гейта (исключение шова) → fail-open react, путь в ран не закрыт, сбой в trace', async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => {
      logs.push(a.join(' '));
      origLog(...a);
    };
    let started = 0;
    try {
      const { bot } = gateBot({
        trace: true,
        gate: async () => {
          throw new Error('модель упала');
        },
        startPrompt: () => {
          started += 1;
          return { run: { pid: 4 } };
        },
      });
      await bot.handleUpdate(botQuestion({ messageId: 630 }));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(started, 1, 'fail-open: ран не закрыт');
      assert.ok(
        logs.some((l) => l.includes('гейт') && l.includes('react') && l.includes('сбой') && l.includes('модель упала')),
        `нет trace сбоя гейта; логи: ${logs.filter((l) => l.includes('trace')).join(' || ')}`,
      );
    } finally {
      console.log = origLog;
    }
  });

  it('AC3: onExit ровно <no_answer> → ни в группу, ни в карточку (только trace)', async () => {
    // admin_chat задан — карточка достижима, но <no_answer> возвращает ДО classifyAnswer
    writeComms(cwd, {
      bot_token: '777:test-token',
      chats: [111],
      sync_timeout_sec: 120,
      channels: [
        { id: 'g1', transport: 'telegram', group_id: -1001, addressing: 'mention', approval: 'auto', admin_chat: 111 },
      ],
    });
    const onExits = [];
    const { bot, calls } = gateBot({
      startPrompt: (cwdArg, prompt, onExit) => {
        onExits.push(onExit);
        return { run: { pid: 5 } };
      },
    });
    await bot.handleUpdate(botQuestion({ messageId: 640 }));
    assert.equal(onExits.length, 1);
    onExits[0]({ result: { result: '<no_answer>' }, exitCode: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.length, 0, 'тишина: ни группы, ни карточки, ни уведомлений');
  });

  it('AC5: [DECISION] → карточка в admin_chat с меткой «решение»; ibot:ok публикует в группу БЕЗ маркера', async () => {
    writeComms(cwd, {
      bot_token: '777:test-token',
      chats: [111],
      sync_timeout_sec: 120,
      channels: [
        { id: 'g1', transport: 'telegram', group_id: -1001, addressing: 'mention', approval: 'auto', admin_chat: 111 },
      ],
    });
    const onExits = [];
    const { bot, calls } = gateBot({
      startPrompt: (cwdArg, prompt, onExit) => {
        onExits.push(onExit);
        return { run: { pid: 6 } };
      },
    });
    await bot.handleUpdate(botQuestion({ messageId: 650 }));
    // classifyAnswer парсит маркер как раньше → decision_request → карточка
    onExits[0]({ result: { result: '[DECISION] берём вариант B' }, exitCode: 0 });
    await new Promise((r) => setTimeout(r, 10));
    const card = calls.find((c) => c.method === 'sendMessage' && c.payload?.chat_id === 111);
    assert.ok(card, `нет карточки в admin_chat: ${JSON.stringify(calls.map((c) => c.method))}`);
    assert.ok(card.payload.text.includes('[DECISION]'), 'в карточке маркер остаётся');
    assert.ok(card.payload.text.includes('Требуется решение'), 'карточка с меткой «решение»');
    // Согласование: ibot:ok:1. requireBind читает comms из process.cwd() —
    // переходим в tmp-каталог теста на время handleUpdate (restore в finally)
    const prevCwd = process.cwd();
    process.chdir(cwd);
    try {
      await bot.handleUpdate(ibotOkUpdate(1));
    } finally {
      process.chdir(prevCwd);
    }
    await new Promise((r) => setTimeout(r, 10));
    const groupMsg = calls.find(
      (c) => (c.method === 'sendMessage' || c.method === 'sendRichMessage') && c.payload?.chat_id === -1001,
    );
    assert.ok(groupMsg, `после approve текст не ушёл в группу: ${JSON.stringify(calls.map((c) => [c.method, c.payload?.chat_id]))}`);
    const blob = JSON.stringify(groupMsg.payload);
    assert.ok(blob.includes('берём вариант B'), `реплика цела: ${blob}`);
    assert.ok(!blob.includes('DECISION'), `маркер срезан перед публикацией в группу: ${blob}`);
  });

  it('AC5: решение БЕЗ admin_chat → сразу в группу, но тоже без маркера', async () => {
    const onExits = [];
    const { bot, calls } = gateBot({
      startPrompt: (cwdArg, prompt, onExit) => {
        onExits.push(onExit);
        return { run: { pid: 7 } };
      },
    });
    await bot.handleUpdate(botQuestion({ messageId: 660 }));
    onExits[0]({ result: { result: '[DECISION] Берём вариант B' }, exitCode: 0 });
    await new Promise((r) => setTimeout(r, 10));
    const groupMsg = calls.find(
      (c) => (c.method === 'sendMessage' || c.method === 'sendRichMessage') && c.payload?.chat_id === -1001,
    );
    assert.ok(groupMsg, 'ответ ушёл в группу (нет admin_chat → ветка else)');
    const blob = JSON.stringify(groupMsg.payload);
    assert.ok(blob.includes('Берём вариант B'), `реплика цела: ${blob}`);
    assert.ok(!blob.includes('DECISION'), `маркер срезан в точке публикации: ${blob}`);
  });

  it('AC4 (этап 3, VL-434): ошибка «Запуск уже выполняется» не публикуется — прогон существующего теста здесь не нужен', async () => {
    // Дубль не заводим: эталонный тест AC3 описан в VL-434-блоке (строка ~461),
    // здесь фиксируем только, что гейт не ломает этот путь: ошибка старта при
    // verdict react не порождает отправок
    const { bot, calls } = gateBot({ startPrompt: () => ({ error: 'Запуск уже выполняется' }) });
    await bot.handleUpdate(botQuestion({ messageId: 670 }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 0, 'ошибка старта без отправок в группу');
  });

  it('AC3/AC4 (VL-437): память ветки — входы и наш ответ попадают в секцию истории следующего рана', async () => {
    // approval=auto, БЕЗ admin_chat → публикация сразу в группу (точка записи feed)
    writeComms(cwd, {
      bot_token: '777:test-token',
      chats: [111],
      sync_timeout_sec: 120,
      channels: [
        { id: 'g1', transport: 'telegram', group_id: -1001, addressing: 'mention', approval: 'auto' },
      ],
    });
    const prompts = [];
    const onExits = [];
    const { bot, calls } = gateBot({
      gate: async (c, incoming) =>
        incoming.text.includes('спасибо') ? { verdict: 'read_only' } : { verdict: 'react' },
      startPrompt: (cwdArg, prompt, onExit) => {
        prompts.push(prompt);
        onExits.push(onExit);
        return { run: { pid: 8 } };
      },
    });
    // 1) read_only-вход пишется в память ветки (ран не запускается)
    await bot.handleUpdate(botQuestion({ messageId: 680, text: '/q@our_bot всем спасибо!' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(prompts.length, 0, 'read_only → без рана');
    // 2) react: read_only-вход виден в истории; ТЕКУЩИЙ вопрос — только в «Вопрос:»
    await bot.handleUpdate(botQuestion({ messageId: 681, text: '/q@our_bot что с релизом?' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(prompts.length, 1, 'ран запущен');
    assert.ok(prompts[0].includes('Последние реплики ветки'), 'секция истории есть');
    assert.ok(prompts[0].includes('всем спасибо!'), 'read_only-вход в истории');
    assert.equal(
      (prompts[0].match(/что с релизом\?/g) || []).length,
      1,
      'текущий вопрос не дублируется в секции истории (запись после промпта)',
    );
    // 3) публикация ответа в группу → feed: «мы: <ответ>»
    onExits[0]({ result: { result: 'Релиз закрыт вчера.' }, exitCode: 0 });
    await new Promise((r) => setTimeout(r, 10));
    const groupMsg = calls.find(
      (c) => (c.method === 'sendMessage' || c.method === 'sendRichMessage') && c.payload?.chat_id === -1001,
    );
    assert.ok(groupMsg, 'ответ опубликован в группу (точка записи feed)');
    // 4) повторная тема → модель видит свой прошлый ответ (антидубль)
    await bot.handleUpdate(botQuestion({ messageId: 682, text: '/q@our_bot а релиз точно закрыт?' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(prompts.length, 2, 'второй ран запущен');
    assert.ok(prompts[1].includes('Последние реплики ветки'), 'секция истории во втором промпте');
    assert.ok(
      prompts[1].includes('мы: Релиз закрыт вчера.'),
      'наш прошлый ответ виден модели — антидубль',
    );
    assert.ok(prompts[1].includes('что с релизом?'), 'вход первого рана в истории');
  });
});
