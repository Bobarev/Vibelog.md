/**
 * Тесты VL-428 — входящие фильтры interbot (AC3, AC8): чистая логика
 * src/bot/interbot.ts без grammy. Каталоги — только mkdtemp (VL-241).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
} from '../../dist/bot/interbot.js';

const roots = [];
function root() {
  const d = mkdtempSync(join(tmpdir(), 'vibelog-interbot-'));
  roots.push(d);
  return d;
}
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

/** Канал-фикстура (addressing по умолчанию — mention). */
function channel(addressing = 'mention', approval = 'auto') {
  return {
    id: 'g1',
    transport: 'telegram',
    group_id: -1001,
    addressing,
    approval,
  };
}

/** Минимальное входящее сообщение от чужого бота. */
function msg(overrides = {}) {
  return {
    message_id: 10,
    chat_id: -1001,
    text: '/question@OurBot что с релизом?',
    from_id: 777,
    from_username: 'OtherBot',
    is_bot: true,
    ...overrides,
  };
}

/** Контекст диспатча с тестовыми лимитерами. */
function ctx(overrides = {}) {
  return {
    channel: channel(),
    ourBotId: 42,
    ourUsername: 'OurBot',
    replyMap: new Map(),
    dedup: createDedupCache(),
    rate: createRateLimiter(),
    runs: createRunLimiter(),
    limits: DEFAULT_LIMITS,
    ...overrides,
  };
}

describe('VL-428: dedup по message_id (AC3/AC8)', () => {
  it('повтор того же message_id — дубль, новый id — нет', () => {
    const cache = createDedupCache();
    assert.equal(cache.check(1), false);
    assert.equal(cache.check(1), true);
    assert.equal(cache.check(2), false);
  });

  it('TTL: записи старше окна выкидываются (повтор снова проходит)', () => {
    let now = 0;
    const cache = createDedupCache(() => now);
    assert.equal(cache.check(5), false);
    now += 11 * 60 * 1000; // > 10 минут
    assert.equal(cache.check(5), false, 'протухшая запись не считается дублем');
  });
});

describe('VL-428: rate limit на бота и глобальный лимит ранов (AC8)', () => {
  it('botRatePerMin: N сообщений проходят, N+1 — limited', () => {
    let now = 0;
    const rate = createRateLimiter(() => now);
    for (let i = 0; i < DEFAULT_LIMITS.botRatePerMin; i++) {
      assert.equal(rate.limited(777, DEFAULT_LIMITS.botRatePerMin), false, `#${i}`);
    }
    assert.equal(rate.limited(777, DEFAULT_LIMITS.botRatePerMin), true);
    // Другой бот — свой bucket
    assert.equal(rate.limited(888, DEFAULT_LIMITS.botRatePerMin), false);
    // Окно скользящее: через минуту снова проходит
    now += 61_000;
    assert.equal(rate.limited(777, DEFAULT_LIMITS.botRatePerMin), false);
  });

  it('globalRunsPerHour: лимит исчерпывается и восстанавливается через час', () => {
    let now = 0;
    const runs = createRunLimiter(() => now);
    for (let i = 0; i < DEFAULT_LIMITS.globalRunsPerHour; i++) {
      assert.equal(runs.limited(DEFAULT_LIMITS.globalRunsPerHour), false, `#${i}`);
    }
    assert.equal(runs.limited(DEFAULT_LIMITS.globalRunsPerHour), true);
    now += 3_601_000;
    assert.equal(runs.limited(DEFAULT_LIMITS.globalRunsPerHour), false);
  });
});

describe('VL-428: depth по цепочке reply (AC3)', () => {
  it('цепочка из 3 хопов даёт depth 3; петля не зацикливается', () => {
    // 4 → 3 → 2 → 1
    const map = new Map([
      [4, 3],
      [3, 2],
      [2, 1],
    ]);
    assert.equal(replyDepth(4, map), 3);
    assert.equal(replyDepth(1, map), 0);
    // Петля: 9 → 9
    const loop = new Map([[9, 9]]);
    assert.equal(replyDepth(9, loop), 1, 'guard разрывает петлю');
  });

  it('dispatchIncoming: depth > maxDepth → «эскалируй человеку», reason=depth', () => {
    const map = new Map([
      [10, 9],
      [9, 8],
      [8, 7],
    ]);
    const d = dispatchIncoming(msg(), ctx({ replyMap: map }));
    assert.equal(d.action, 'answer');
    assert.equal(d.reason, 'depth', 'VL-429: причина ответа видна в trace');
    assert.ok(d.reply.includes('эскалируй'), d.reply);
  });

  it('dispatchIncoming: depth в пределах лимита → process', () => {
    const map = new Map([[10, 9]]);
    const d = dispatchIncoming(msg(), ctx({ replyMap: map }));
    assert.equal(d.action, 'process');
    assert.equal(d.depth, 1);
  });
});

describe('VL-428: addressing mention (AC3)', () => {
  it('mentionsUs: /cmd@OurBot и @OurBot — да; чужой бот и голый текст — нет', () => {
    assert.equal(mentionsUs('/question@OurBot привет', 'OurBot'), true);
    assert.equal(mentionsUs('привет @OurBot как дела', 'OurBot'), true);
    assert.equal(mentionsUs('/question@OtherBot привет', 'OurBot'), false);
    assert.equal(mentionsUs('привет просто так', 'OurBot'), false);
    assert.equal(mentionsUs('/question@OurBot x', ''), false);
  });

  it('reply на наше сообщение — addressed; без упоминания и reply — игнор', () => {
    const addressed = dispatchIncoming(
      msg({ text: 'без упоминания', reply_to_message_id: 1, reply_to_from_id: 42 }),
      ctx(),
    );
    assert.equal(addressed.action, 'process');
    const ignored = dispatchIncoming(msg({ text: 'привет всем' }), ctx());
    assert.equal(ignored.action, 'answer');
    assert.equal(ignored.reply, '', 'не наше — молча игнорируем');
    assert.equal(ignored.reason, 'not-addressed', 'VL-429: причина игнора для trace');
  });

  it('addressing=all: без упоминания тоже process (задел v2, дефолт mention)', () => {
    const d = dispatchIncoming(msg({ text: 'привет всем' }), ctx({ channel: channel('all') }));
    assert.equal(d.action, 'process');
  });

  it('dedup/rate/runs: каждый фильтр отсекает сообщение (VL-429: с reason)', () => {
    const dedup = createDedupCache();
    dedup.check(10);
    const d1 = dispatchIncoming(msg(), ctx({ dedup }));
    assert.equal(d1.action, 'answer');
    assert.equal(d1.reason, 'dedup');

    const rate = createRateLimiter();
    for (let i = 0; i < DEFAULT_LIMITS.botRatePerMin; i++) rate.limited(777, DEFAULT_LIMITS.botRatePerMin);
    const d2 = dispatchIncoming(msg({ message_id: 11 }), ctx({ rate }));
    assert.equal(d2.action, 'answer');
    assert.equal(d2.reason, 'rate');

    const runs = createRunLimiter();
    for (let i = 0; i < DEFAULT_LIMITS.globalRunsPerHour; i++) runs.limited(DEFAULT_LIMITS.globalRunsPerHour);
    const d3 = dispatchIncoming(msg({ message_id: 12 }), ctx({ runs }));
    assert.equal(d3.action, 'answer');
    assert.equal(d3.reason, 'run-limit');
    assert.ok(d3.reply.includes('Лимит'), d3.reply);
  });

  it('ответ на наш тикет не тратит глобальный лимит ранов', () => {
    const runs = createRunLimiter();
    for (let i = 0; i < DEFAULT_LIMITS.globalRunsPerHour; i++) runs.limited(DEFAULT_LIMITS.globalRunsPerHour);
    const d = dispatchIncoming(
      msg({ message_id: 20, text: 'вот ответ', reply_to_message_id: 1, reply_to_from_id: 42 }),
      ctx({ runs, isTicketAnswer: true }),
    );
    assert.equal(d.action, 'process');
  });
});

describe('VL-428: классификация и промпт (AC7)', () => {
  it('classifyAnswer: [DECISION] → decision_request; вопрос → question; иначе info', () => {
    assert.equal(classifyAnswer('[DECISION] перейти на новый формат?'), 'decision_request');
    assert.equal(classifyAnswer('[decision] да'), 'decision_request');
    assert.equal(classifyAnswer('Вопрос: подтверди план'), 'question');
    assert.equal(classifyAnswer('Готово, формат обновлён.'), 'info');
  });

  it('buildIncomingPrompt: read-only правило, запрет секретов и маркер [DECISION]', () => {
    const p = buildIncomingPrompt('что с форматом?', channel());
    assert.ok(p.includes('что с форматом?'));
    assert.ok(p.includes('backlog/'));
    assert.ok(p.includes('[DECISION]'));
    assert.ok(p.includes('.env'), 'запрет чтения секретов явный');
  });
});

// ── VL-433: человек в interbot-канале — семантика Q1/Q3 ──

/** Сообщение ЧЕЛОВЕКА (не бота) в interbot-канале. */
function humanMsg(overrides = {}) {
  return {
    message_id: 50,
    chat_id: -1001,
    text: 'что с релизом?',
    from_id: 500,
    from_username: 'vasya',
    is_bot: false,
    ...overrides,
  };
}

describe('VL-433: человек в interbot-канале (Q1, AC1/AC2/AC5)', () => {
  it('AC1: без @ и без reply → process у всех ботов, независимо от addressing-конфига', () => {
    const d = dispatchIncoming(humanMsg(), ctx());
    assert.equal(d.action, 'process', 'addressing=mention на людей не действует');
    assert.equal(d.depth, 0, 'depth на людей не распространяется');
    const dAll = dispatchIncoming(humanMsg({ message_id: 51 }), ctx({ channel: channel('all') }));
    assert.equal(dAll.action, 'process');
  });

  it('AC2: @наш → process; @чужой → not-addressed (молча)', () => {
    const us = dispatchIncoming(humanMsg({ text: '@OurBot подскажи' }), ctx());
    assert.equal(us.action, 'process');
    const other = dispatchIncoming(
      humanMsg({ message_id: 51, text: '@OtherBot подскажи' }),
      ctx(),
    );
    assert.equal(other.action, 'answer');
    assert.equal(other.reason, 'not-addressed');
    assert.equal(other.reply, '', 'адресация чужому — молча, без ответа в группу');
  });

  it('AC2: reply на сообщение бота → конкретный бот (наш — process, чужой — ignore)', () => {
    const replyUs = dispatchIncoming(
      humanMsg({ message_id: 52, reply_to_message_id: 1, reply_to_from_id: 42, reply_to_is_bot: true }),
      ctx(),
    );
    assert.equal(replyUs.action, 'process');
    const replyOther = dispatchIncoming(
      humanMsg({ message_id: 53, reply_to_message_id: 2, reply_to_from_id: 777, reply_to_is_bot: true }),
      ctx(),
    );
    assert.equal(replyOther.action, 'answer');
    assert.equal(replyOther.reason, 'not-addressed');
  });

  it('AC2: reply на чужого бота приоритетнее @наш (конфликт → только адресат)', () => {
    const conflict = dispatchIncoming(
      humanMsg({
        message_id: 54,
        text: '@OurBot а что думаешь?',
        reply_to_message_id: 3,
        reply_to_from_id: 777,
        reply_to_is_bot: true,
      }),
      ctx(),
    );
    assert.equal(conflict.action, 'answer');
    assert.equal(conflict.reason, 'not-addressed');
  });

  it('reply на сообщение ЧЕЛОВЕКА — не адресация боту (без @ → ко всем)', () => {
    const d = dispatchIncoming(
      humanMsg({ message_id: 55, reply_to_message_id: 4, reply_to_from_id: 600, reply_to_is_bot: false }),
      ctx(),
    );
    assert.equal(d.action, 'process');
  });

  it('AC5: свой rate — humanRatePerMin, а не botRatePerMin; bucket бота не задет', () => {
    assert.notEqual(DEFAULT_LIMITS.humanRatePerMin, DEFAULT_LIMITS.botRatePerMin);
    const rate = createRateLimiter();
    for (let i = 0; i < DEFAULT_LIMITS.humanRatePerMin; i++) {
      assert.equal(rate.limited(500, DEFAULT_LIMITS.humanRatePerMin), false, `#${i}`);
    }
    const d = dispatchIncoming(humanMsg({ message_id: 60 }), ctx({ rate }));
    assert.equal(d.action, 'answer');
    assert.equal(d.reason, 'rate');
    // Разные ключи: бот в своём bucket не ограничен
    assert.equal(rate.limited(777, DEFAULT_LIMITS.botRatePerMin), false);
  });

  it('AC5: depth-цепочка на людей НЕ распространяется (глубокий reply → process)', () => {
    const map = new Map([
      [50, 49],
      [49, 48],
      [48, 47],
      [47, 46],
    ]);
    const d = dispatchIncoming(humanMsg(), ctx({ replyMap: map }));
    assert.equal(d.action, 'process', 'глубина цепочки человека не отсекается');
    assert.equal(d.depth, 0);
  });

  it('AC5: dedup по message_id общий с ботами', () => {
    const dedup = createDedupCache();
    assert.equal(dedup.check(50), false, 'первый проход');
    const d = dispatchIncoming(humanMsg(), ctx({ dedup }));
    assert.equal(d.action, 'answer');
    assert.equal(d.reason, 'dedup');
  });

  it('runs/час: общий лимит распространяется и на людей (стоимость)', () => {
    const runs = createRunLimiter();
    for (let i = 0; i < DEFAULT_LIMITS.globalRunsPerHour; i++) runs.limited(DEFAULT_LIMITS.globalRunsPerHour);
    const d = dispatchIncoming(humanMsg({ message_id: 61 }), ctx({ runs }));
    assert.equal(d.action, 'answer');
    assert.equal(d.reason, 'run-limit');
  });

  it('AC3: buildIncomingPrompt с цитатой и контекстом ветки; без opts — прежняя форма', () => {
    const p = buildIncomingPrompt('а если добавить флаг?', channel(), {
      quote: 'Вот ответ бота по пункту 1',
      context: { question: 'что с релизом?', answer: 'релиз в пятницу' },
    });
    assert.ok(p.includes('Вот ответ бота по пункту 1'), 'цитата родителя в промпте');
    assert.ok(p.includes('что с релизом?'), 'прошлый вопрос ветки');
    assert.ok(p.includes('релиз в пятницу'), 'прошлый ответ ветки');
    assert.ok(p.indexOf('цитата') < p.indexOf('Вопрос:'), 'цитата — до секции «Вопрос:»');
    assert.ok(p.indexOf('Предыдущий вопрос') < p.indexOf('Вопрос:'), 'контекст — до «Вопрос:»');
    // Без opts форма прежняя (регресс VL-428)
    const plain = buildIncomingPrompt('что с форматом?', channel());
    assert.ok(!plain.includes('цитата'));
    assert.ok(!plain.includes('Предыдущий вопрос'));
  });
});
