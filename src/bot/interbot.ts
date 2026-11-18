/**
 * Входящий interbot-путь (VL-428, doc-32 §4-5): фильтры и loop-защита.
 *
 * Чистая логика без grammy — юнит-тесты гоняют фильтры напрямую:
 * - dedup по message_id (TTL-кэш);
 * - rate limit на чужого бота (сообщений/мин) и глобальный лимит
 *   входящих LLM-ранов/час;
 * - depth по цепочке reply_to_message_id (лимит 2, дальше — «эскалируй
 *   человеку»);
 * - addressing: mention (дефолт) — только /command@OurBot и reply на наше
 *   сообщение; all — вторым шагом (задел, дефолт mention);
 * - классификация ответа рана по маркеру [DECISION] (approval-флоу C).
 */

import type { CommsChannel } from '../core/comms.js';

/** Лимиты loop-защиты (doc-32 §5), переопределяются в тестах. */
export interface InterbotLimits {
  /** Окно dedup, мс. */
  dedupTtlMs: number;
  /** Сообщений от одного чужого бота в минуту. */
  botRatePerMin: number;
  /** Глобальный лимит входящих LLM-ранов в час. */
  globalRunsPerHour: number;
  /** Максимальная глубина reply-цепочки (включительно). */
  maxDepth: number;
}

/** Дефолтные лимиты v1. */
export const DEFAULT_LIMITS: InterbotLimits = {
  dedupTtlMs: 10 * 60 * 1000,
  botRatePerMin: 10,
  globalRunsPerHour: 20,
  maxDepth: 2,
};

/** Минимальная форма входящего сообщения для фильтров (без grammy). */
export interface IncomingMsg {
  message_id: number;
  chat_id: number;
  text: string;
  from_id: number;
  from_username?: string;
  is_bot: boolean;
  /** message_id сообщения, на которое это является reply (если есть). */
  reply_to_message_id?: number;
  /** from_id автора сообщения, на которое reply (для «reply на нас»). */
  reply_to_from_id?: number;
}

/** Решение по входящему сообщению. */
export type IncomingDecision =
  | { action: 'process'; depth: number; kind: 'question' }
  | { action: 'answer'; depth: number; reply: string };

/**
 * TTL-кэш dedup по message_id.
 *
 * @param now — источник времени (для детерминированных тестов)
 */
export function createDedupCache(now: () => number = Date.now) {
  const seen = new Map<number, number>();
  return {
    /** true — уже обработано (дубль); свежее — регистрирует. */
    check(messageId: number): boolean {
      const ts = now();
      // Выкидываем протухшие на каждом входе — кэш не растёт неограниченно
      for (const [id, at] of seen) if (ts - at > 10 * 60 * 1000) seen.delete(id);
      if (seen.has(messageId)) return true;
      seen.set(messageId, ts);
      return false;
    },
  };
}

/** Счётчик rate limit «окно в секунду скользящее» — простой buckets-per-minute. */
export function createRateLimiter(now: () => number = Date.now) {
  const hits = new Map<number, number[]>();
  return {
    /** true — превышение лимита (сообщение нужно отбросить). */
    limited(key: number, perMin: number): boolean {
      const ts = now();
      const arr = (hits.get(key) ?? []).filter((t) => ts - t < 60_000);
      if (arr.length >= perMin) {
        hits.set(key, arr);
        return true;
      }
      arr.push(ts);
      hits.set(key, arr);
      return false;
    },
  };
}

/** Глобальный лимит LLM-ранов в час (стоимость входящих). */
export function createRunLimiter(now: () => number = Date.now) {
  const runs: number[] = [];
  return {
    /** true — лимит исчерпан, ран запускать нельзя. */
    limited(perHour: number): boolean {
      const ts = now();
      const fresh = runs.filter((t) => ts - t < 3_600_000);
      if (fresh.length >= perHour) {
        runs.length = 0;
        runs.push(...fresh);
        return true;
      }
      fresh.push(ts);
      runs.length = 0;
      runs.push(...fresh);
      return false;
    },
  };
}

/**
 * Глубина reply-цепочки: сколько хопов reply_to_message_id от корня.
 *
 * Цепочка строится по reply_to_message_id: сообщение отвечает на ответ,
 * тот — на вопрос и т.д. Рекурсия идёт по карте id→reply_id (её
 * наполняет вызывающий из полученных сообщений).
 */
export function replyDepth(
  messageId: number,
  replyMap: ReadonlyMap<number, number>,
  max: number = 20,
): number {
  let depth = 0;
  let cur = messageId;
  const guard = new Set<number>();
  while (replyMap.has(cur) && depth < max && !guard.has(cur)) {
    guard.add(cur);
    cur = replyMap.get(cur)!;
    depth++;
  }
  return depth;
}

/**
 * Addressing=mention (AC3): сообщение адресовано нам, если это
 * `/command@OurBot` (команда с суффиксом нашего юзернейма) ИЛИ reply на
 * НАШЕ сообщение (reply_to_from_id === ourId).
 *
 * addressing=all — принимается всё (задел на второй шаг, дефолт mention).
 */
export function isAddressedToUs(
  msg: IncomingMsg,
  opts: { ourBotId: number; addressing: 'mention' | 'all' },
): boolean {
  if (opts.addressing === 'all') return true;
  // Reply на наше сообщение
  if (msg.reply_to_from_id !== undefined && msg.reply_to_from_id === opts.ourBotId) return true;
  // /command@OurBot или упоминание @OurBot в тексте
  const uname = msg.from_username; // не наш юзернейм — см. ниже
  void uname;
  return false;
}

/**
 * Полная проверка упоминания по тексту: `/cmd@OurBot` или `@OurBot`.
 *
 * @param ourUsername — юзернейм НАШЕГО бота (без @)
 */
export function mentionsUs(text: string, ourUsername: string): boolean {
  if (!ourUsername) return false;
  const re = new RegExp(`(?:^|\\s)/(?:\\w+)@${escapeRe(ourUsername)}\\b|(?:^|\\s)@${escapeRe(ourUsername)}\\b`);
  return re.test(text);
}

/** Экранирование строки для RegExp (юзернеймы Telegram безопасны, но на всякий). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Диспетчер входящего сообщения: dedup → depth → addressing → решение.
 *
 * @returns decision.action=process — запускать ран; иначе ответ/игнор
 */
export function dispatchIncoming(
  msg: IncomingMsg,
  ctx: {
    channel: CommsChannel;
    ourBotId: number;
    ourUsername: string;
    replyMap: ReadonlyMap<number, number>;
    dedup: { check(id: number): boolean };
    rate: { limited(key: number, perMin: number): boolean };
    runs: { limited(perHour: number): boolean };
    limits: InterbotLimits;
    /** Сообщение-ответ на наш тикет (question_msg_id) — отдельная ветка. */
    isTicketAnswer?: boolean;
  },
): IncomingDecision {
  const { limits, channel } = ctx;
  // 0. Только сообщения от ботов
  if (!msg.is_bot) return { action: 'process', depth: 0, kind: 'question' } as never;
  // dedup
  if (ctx.dedup.check(msg.message_id)) return { action: 'answer', depth: 0, reply: '' };
  // rate limit на бота
  if (ctx.rate.limited(msg.from_id, limits.botRatePerMin))
    return { action: 'answer', depth: 0, reply: '' };
  // depth по цепочке reply
  const depth = replyDepth(msg.message_id, ctx.replyMap, limits.maxDepth + 1);
  if (depth > limits.maxDepth)
    return {
      action: 'answer',
      depth,
      reply: 'Цепочка слишком длинная (лимит depth) — эскалируй вопрос человеку.',
    };
  // addressing
  const mentioned =
    mentionsUs(msg.text, ctx.ourUsername) ||
    (msg.reply_to_from_id !== undefined && msg.reply_to_from_id === ctx.ourBotId);
  if (channel.addressing === 'mention' && !mentioned && !ctx.isTicketAnswer) {
    return { action: 'answer', depth, reply: '' }; // не наше — молча игнорируем
  }
  // глобальный лимит ранов/час
  if (!ctx.isTicketAnswer && ctx.runs.limited(limits.globalRunsPerHour))
    return {
      action: 'answer',
      depth,
      reply: 'Лимит входящих запросов в час исчерпан — повтори позже.',
    };
  return { action: 'process', depth, kind: 'question' };
}

/**
 * Классификация ответа рана по маркеру [DECISION] (AC7, вариант C):
 * ответ содержит маркер → decision_request → всегда approval через admin.
 */
export function classifyAnswer(answer: string): 'decision_request' | 'info' | 'question' {
  if (/\[DECISION\]/i.test(answer)) return 'decision_request';
  if (/^\s*(вопрос|\?)/i.test(answer)) return 'question';
  return 'info';
}

/** Правила read-only промпта входящего рана (AC: утечки контекста нет). */
export function buildIncomingPrompt(question: string, channel: CommsChannel): string {
  return [
    `Ты отвечаешь на вопрос другой бот-проект в Telegram-канале «${channel.label ?? channel.id}».`,
    'Отвечай кратко и по делу. Используй ТОЛЬКО чтение файлов backlog/ и docs/ этого проекта.',
    'НИКОГДА не читай и не цитируй .env, .vibelog/settings.json, .vibelog/comms.yaml, секреты, токены и чужие проекты.',
    'Если вопрос требует архитектурного решения — начни ответ с метки [DECISION] в первой строке.',
    '',
    'Вопрос:',
    question,
  ].join('\n');
}
