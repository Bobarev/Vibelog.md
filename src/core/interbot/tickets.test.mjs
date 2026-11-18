/**
 * Тесты VL-428 — тикеты (статусы/TTL/атомарность) и loop-защита входящего
 * пути (dedup, depth, rate limit, addressing, [DECISION]). Чистая логика,
 * без grammy и сети. Каталоги — только mkdtemp (VL-241).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createTicket,
  loadTickets,
  answerTicket,
  recoverStaleTickets,
  markDelivered,
  waitForAnswer,
  ticketsPath,
} from '../../../dist/core/interbot/tickets.js';
import {
  createDedupCache,
  createRateLimiter,
  createRunLimiter,
  replyDepth,
  mentionsUs,
  dispatchIncoming,
  classifyAnswer,
  buildIncomingPrompt,
  DEFAULT_LIMITS,
} from '../../../dist/bot/interbot.js';

const roots = [];
function root() {
  const d = mkdtempSync(join(tmpdir(), 'vibelog-tickets-'));
  roots.push(d);
  return d;
}
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

describe('VL-428: тикеты (AC6/AC8)', () => {
  it('создание: pending с дедлайном now+timeout, файл атомарно записан', () => {
    const cwd = root();
    const t = createTicket(cwd, {
      id: 't1',
      channel_id: 'lb',
      question_msg_id: 42,
      timeoutSec: 120,
      context: { task: 'VL-1' },
    });
    assert.equal(t.status, 'pending');
    assert.ok(new Date(t.deadline).getTime() > Date.now());
    assert.ok(existsSync(ticketsPath(cwd)));
    assert.equal(loadTickets(cwd).length, 1);
  });

  it('ответ вовремя → answered; после дедлайна → expired', () => {
    const cwd = root();
    createTicket(cwd, { id: 't2', channel_id: 'lb', question_msg_id: 7, timeoutSec: 1 });
    const ok = answerTicket(cwd, 7, 'да', Date.now());
    assert.equal(ok?.status, 'answered');
    assert.equal(ok?.reply, 'да');

    createTicket(cwd, { id: 't3', channel_id: 'lb', question_msg_id: 8, timeoutSec: 1 });
    const late = answerTicket(cwd, 8, 'запоздавший', Date.now() + 10_000);
    assert.equal(late?.status, 'expired', 'просроченный ответ → expired');
  });

  it('ответ на неизвестный question_msg_id → null (лог «ответ без тикета»)', () => {
    const cwd = root();
    assert.equal(answerTicket(cwd, 999, 'x'), null);
  });

  it('recoverStaleTickets: pending с истёкшим deadline → expired (старт бота)', () => {
    const cwd = root();
    createTicket(cwd, { id: 't4', channel_id: 'lb', question_msg_id: 1, timeoutSec: 1 });
    const stale = recoverStaleTickets(cwd, Date.now() + 10_000);
    assert.deepEqual(stale, ['t4']);
    assert.equal(loadTickets(cwd)[0].status, 'expired');
    // Повторный вызов — ничего не трогает
    assert.deepEqual(recoverStaleTickets(cwd, Date.now() + 20_000), []);
  });

  it('async-fallback: expired → delivered после доставки', () => {
    const cwd = root();
    createTicket(cwd, { id: 't5', channel_id: 'lb', question_msg_id: 5, timeoutSec: 1 });
    answerTicket(cwd, 5, 'ответ', Date.now() + 10_000);
    markDelivered(cwd, 't5');
    assert.equal(loadTickets(cwd)[0].status, 'delivered');
  });

  it('waitForAnswer: ответ появился до дедлайна → answered=true', async () => {
    const cwd = root();
    const t = createTicket(cwd, { id: 't6', channel_id: 'lb', question_msg_id: 6, timeoutSec: 5 });
    setTimeout(() => answerTicket(cwd, 6, 'pong', Date.now()), 50);
    const res = await waitForAnswer(cwd, t.id, { pollMs: 20 });
    assert.equal(res.answered, true);
    assert.equal(res.ticket.reply, 'pong');
  });

  it('waitForAnswer: дедлайн прошёл без ответа → answered=false (не ошибка)', async () => {
    const cwd = root();
    const t = createTicket(cwd, { id: 't7', channel_id: 'lb', question_msg_id: 77, timeoutSec: 1 });
    const res = await waitForAnswer(cwd, t.id, {
      pollMs: 10,
      now: () => Date.now() + 10_000, // «сейчас» уже за дедлайном
    });
    assert.equal(res.answered, false);
    assert.equal(res.ticket.status, 'pending');
  });
});

describe('VL-428: loop-защита (AC3/AC8)', () => {
  it('dedup по message_id с TTL', () => {
    let t = 0;
    const cache = createDedupCache(() => t);
    assert.equal(cache.check(1), false, 'первый раз — не дубль');
    assert.equal(cache.check(1), true, 'второй раз — дубль');
    t = 11 * 60 * 1000; // за TTL
    assert.equal(cache.check(1), false, 'после TTL — снова обрабатывается');
  });

  it('rate limit на чужого бота: N/min', () => {
    let t = 0;
    const rate = createRateLimiter(() => t);
    for (let i = 0; i < 5; i++) assert.equal(rate.limited(99, 5), false);
    assert.equal(rate.limited(99, 5), true, 'шестое — лимит');
    assert.equal(rate.limited(100, 5), false, 'другой бот — свой лимит');
    t = 61_000; // окно прошло
    assert.equal(rate.limited(99, 5), false, 'окно сброшено');
  });

  it('глобальный лимит ранов/час', () => {
    let t = 0;
    const runs = createRunLimiter(() => t);
    assert.equal(runs.limited(2), false);
    assert.equal(runs.limited(2), false);
    assert.equal(runs.limited(2), true, 'третий за час — лимит');
    t = 3_600_001;
    assert.equal(runs.limited(2), false, 'час прошёл');
  });

  it('depth reply-цепочки: 0/1/2 проходят, 3 — эскалация', () => {
    // цепочка: msg4 → msg3 → msg2 → msg1
    const map = new Map([
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    assert.equal(replyDepth(1, map), 0);
    assert.equal(replyDepth(2, map), 1);
    assert.equal(replyDepth(3, map), 2);
    assert.equal(replyDepth(4, map), 3);
  });

  it('mentionsUs: /cmd@OurBot и @OurBot; чужие юзернеймы — нет', () => {
    assert.equal(mentionsUs('/ask@OurBot что там?', 'OurBot'), true);
    assert.equal(mentionsUs('@OurBot привет', 'OurBot'), true);
    assert.equal(mentionsUs('/ask@OtherBot что?', 'OurBot'), false);
    assert.equal(mentionsUs('обычный текст', 'OurBot'), false);
    assert.equal(mentionsUs('/ask@OurBot x', ''), false, 'пустой юзернейм — нет');
  });

  it('dispatch: только от ботов; не упомянутый в mention-канале — игнор', () => {
    const channel = {
      id: 'c',
      transport: 'telegram',
      group_id: -100,
      addressing: 'mention',
      approval: 'auto',
    };
    const base = {
      channel,
      ourBotId: 1,
      ourUsername: 'OurBot',
      replyMap: new Map(),
      dedup: createDedupCache(),
      rate: createRateLimiter(),
      runs: createRunLimiter(),
      limits: DEFAULT_LIMITS,
    };
    const fromBot = {
      message_id: 10,
      chat_id: -100,
      text: 'просто текст',
      from_id: 555,
      is_bot: true,
    };
    // Не упомянут и не reply на нас → пустой reply = молчаливый игнор
    const r1 = dispatchIncoming(fromBot, base);
    assert.equal(r1.action, 'answer');
    assert.equal(r1.reply, '', 'без упоминания — молчаливый игнор');

    // Reply на наше сообщение → process
    const r2 = dispatchIncoming({ ...fromBot, message_id: 11, reply_to_message_id: 1, reply_to_from_id: 1 }, base);
    assert.equal(r2.action, 'process');

    // Упоминание → process
    const r3 = dispatchIncoming({ ...fromBot, message_id: 12, text: '/ask@OurBot вопрос' }, base);
    assert.equal(r3.action, 'process');

    // Depth 3 → эскалация с текстом
    const deepMap = new Map([
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    const r4 = dispatchIncoming(
      { ...fromBot, message_id: 4, text: '/ask@OurBot глубоко', reply_to_message_id: 3 },
      { ...base, replyMap: deepMap },
    );
    assert.equal(r4.action, 'answer');
    assert.ok('reply' in r4 && r4.reply.includes('эскалируй'), r4.reply);

    // Дубль → пустой игнор
    dispatchIncoming({ ...fromBot, message_id: 12, text: '/ask@OurBot дубль' }, base);
    const r5 = dispatchIncoming({ ...fromBot, message_id: 12, text: '/ask@OurBot дубль' }, base);
    assert.equal(r5.action, 'answer');
    assert.equal(r5.reply, '');
  });

  it('addressing=all принимает без упоминания (задел v1)', () => {
    const channel = {
      id: 'c',
      transport: 'telegram',
      group_id: -100,
      addressing: 'all',
      approval: 'auto',
    };
    const r = dispatchIncoming(
      { message_id: 20, chat_id: -100, text: 'тихий вопрос', from_id: 555, is_bot: true },
      {
        channel,
        ourBotId: 1,
        ourUsername: 'OurBot',
        replyMap: new Map(),
        dedup: createDedupCache(),
        rate: createRateLimiter(),
        runs: createRunLimiter(),
        limits: DEFAULT_LIMITS,
      },
    );
    assert.equal(r.action, 'process');
  });
});

describe('VL-428: классификация и промпт (AC7)', () => {
  it('[DECISION] → decision_request', () => {
    assert.equal(classifyAnswer('[DECISION] берём вариант B'), 'decision_request');
    assert.equal(classifyAnswer('[decision] так и делаем'), 'decision_request');
    assert.equal(classifyAnswer('просто ответ'), 'info');
    assert.equal(classifyAnswer('Вопрос: почему?'), 'question');
  });

  it('промпт содержит read-only правило и метку [DECISION]', () => {
    const p = buildIncomingPrompt('что с VL-1?', {
      id: 'c',
      transport: 'telegram',
      group_id: -1,
      addressing: 'mention',
      approval: 'auto',
    });
    assert.ok(p.includes('backlog/ и docs/'));
    assert.ok(p.includes('[DECISION]'));
    assert.ok(p.includes('.env'));
    assert.ok(p.includes('что с VL-1?'));
  });
});
