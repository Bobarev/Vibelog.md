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
  /** Сообщений от одного ЧЕЛОВЕКА в минуту (VL-433: своя константа, не botRatePerMin). */
  humanRatePerMin: number;
  /** Глобальный лимит входящих LLM-ранов в час. */
  globalRunsPerHour: number;
  /** Максимальная глубина reply-цепочки (включительно). */
  maxDepth: number;
}

/** Дефолтные лимиты v1. */
export const DEFAULT_LIMITS: InterbotLimits = {
  dedupTtlMs: 10 * 60 * 1000,
  botRatePerMin: 10,
  humanRatePerMin: 5,
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
  /** Автор сообщения-родителя — бот? (VL-433: reply на бота = адресация). */
  reply_to_is_bot?: boolean;
}

/** Решение по входящему сообщению.
 *
 * VL-429: у `action='answer'` появилось поле `reason` — почему диспатч не
 * запустил ран (для trace-лога и юнит-тестов): dedup/rate/depth/
 * not-addressed/run-limit; `ignore` — резервная причина «вне классификации»
 * (защита будущих веток: вручную решение с пустым ответом).
 */
export type IncomingDecision =
  | { action: 'process'; depth: number; kind: 'question' }
  | {
      action: 'answer';
      depth: number;
      reply: string;
      reason: 'dedup' | 'rate' | 'depth' | 'not-addressed' | 'run-limit' | 'ignore';
    };

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

/**
 * Адресация сообщения ЧЕЛОВЕКА (VL-433, Q1): reply на сообщение бота
 * приоритетнее @упоминания (конфликт «reply на B + @C» → только B —
 * Q2-уточнение живёт на reply).
 *
 * - reply на сообщение бота → 'us'/'other' по reply_to_from_id;
 * - любой @упоминание не-наш → 'other': боты не знают списка имён канала,
 *   поэтому различают только «мне / чужому / никому» (@человека трактуется
 *   как чужая адресация — осознанная эвристика, VL-433);
 * - иначе 'none' → вопрос ко ВСЕМ ботам канала (addressing-конфиг канала
 *   на людей не действует).
 */
export function humanAddressing(
  msg: IncomingMsg,
  opts: { ourBotId: number; ourUsername: string },
): 'us' | 'other' | 'none' {
  if (msg.reply_to_is_bot) {
    return msg.reply_to_from_id === opts.ourBotId ? 'us' : 'other';
  }
  if (/(?:^|\s)@[\w]+\b/.test(msg.text)) {
    return mentionsUs(msg.text, opts.ourUsername) ? 'us' : 'other';
  }
  return 'none';
}

/** Экранирование строки для RegExp (юзернеймы Telegram безопасны, но на всякий). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Регистрация СВОИХ отправленных id → reply_to в карте цепочки (VL-434, fix A).
 *
 * Свои сообщения бота в апдейты Telegram не приходят (handlers-ветка пропускает
 * `m.from.id === ctx.me.id`), поэтому без этой записи цепочка разрывалась на
 * собственном сообщении-ответе и depth всегда = 1 (штатный рубеж maxDepth не
 * срабатывал → interbot-шторм). Паттерн FIFO-санитки — как у interbotReplyMap
 * в handlers-ветке (≤5000).
 */
export function rememberReplyPair(
  map: Map<number, number>,
  ids: readonly number[],
  replyTo: number,
): void {
  for (const id of ids) map.set(id, replyTo);
  if (map.size > 5000) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/**
 * Служебные тексты ботов, которые НЕ являются вопросами (VL-434, fix B).
 *
 * Ошибки/статусы («Не удалось запустить ран», «Цепочка слишком длинная» и т.п.)
 * публикуются в группу rich-сообщением и чужим dispatch читались как входящий
 * вопрос → петля «ошибка ↔ отчёт об ошибке». Префиксы — по началу текста
 * (после trim): guard на стороне получателя дополняет fix B-1 (отказ от
 * публикации ошибки старта в группу).
 */
export function isServiceMessage(text: string): boolean {
  const t = text.trim();
  return [
    '⚠️ Не удалось запустить ран',
    '⚠️ Ран упал',
    '⛔ Админ отклонил публикацию решения.',
    'Цепочка слишком длинная (лимит depth)',
    'Лимит входящих запросов в час',
  ].some((p) => t.startsWith(p));
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
  // 0. Человек (VL-433, Q1): своя семантика адресации — конфиг addressing
  // канала и depth НЕ применяются, rate — своя константа humanRatePerMin,
  // dedup и runs/час — общие с ботами. @/reply → конкретный бот; без
  // адресации → process (каждый бот канала отвечает своим раном).
  if (!msg.is_bot) {
    if (ctx.dedup.check(msg.message_id))
      return { action: 'answer', depth: 0, reply: '', reason: 'dedup' };
    if (ctx.rate.limited(msg.from_id, limits.humanRatePerMin))
      return { action: 'answer', depth: 0, reply: '', reason: 'rate' };
    const addr = humanAddressing(msg, {
      ourBotId: ctx.ourBotId,
      ourUsername: ctx.ourUsername,
    });
    if (addr === 'other')
      return { action: 'answer', depth: 0, reply: '', reason: 'not-addressed' };
    if (ctx.runs.limited(limits.globalRunsPerHour))
      return {
        action: 'answer',
        depth: 0,
        reply: 'Лимит входящих запросов в час исчерпан — повтори позже.',
        reason: 'run-limit',
      };
    return { action: 'process', depth: 0, kind: 'question' };
  }
  // VL-434 (fix B): служебные тексты чужого бота не запускаем — молчаливый
  // пропуск (пустой reply → handlers не создаёт сообщение, материала для
  // петли «ошибка ↔ отчёт» нет). До dedup/rate/depth — служебное не должно
  // сжигать лимиты.
  if (msg.is_bot && isServiceMessage(msg.text))
    return { action: 'answer', depth: 0, reply: '', reason: 'ignore' };
  // dedup
  if (ctx.dedup.check(msg.message_id))
    return { action: 'answer', depth: 0, reply: '', reason: 'dedup' };
  // rate limit на бота
  if (ctx.rate.limited(msg.from_id, limits.botRatePerMin))
    return { action: 'answer', depth: 0, reply: '', reason: 'rate' };
  // depth по цепочке reply
  const depth = replyDepth(msg.message_id, ctx.replyMap, limits.maxDepth + 1);
  if (depth > limits.maxDepth)
    return {
      action: 'answer',
      depth,
      reply: 'Цепочка слишком длинная (лимит depth) — эскалируй вопрос человеку.',
      reason: 'depth',
    };
  // addressing
  const mentioned =
    mentionsUs(msg.text, ctx.ourUsername) ||
    (msg.reply_to_from_id !== undefined && msg.reply_to_from_id === ctx.ourBotId);
  if (channel.addressing === 'mention' && !mentioned && !ctx.isTicketAnswer) {
    // не наше — молча игнорируем
    return { action: 'answer', depth, reply: '', reason: 'not-addressed' };
  }
  // глобальный лимит ранов/час
  if (!ctx.isTicketAnswer && ctx.runs.limited(limits.globalRunsPerHour))
    return {
      action: 'answer',
      depth,
      reply: 'Лимит входящих запросов в час исчерпан — повтори позже.',
      reason: 'run-limit',
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

/**
 * Срезка маркера [DECISION] перед публикацией в группу (VL-436, doc-34 §4).
 *
 * Маркер — метка парсера-приёмщика: classifyAnswer парсит его ДО срезки
 * (approval-ветка работает как раньше), но в interbot-ленту человеку не
 * попадает — в ленте не бывает протокольного текста. В карточке согласования
 * маркер остаётся (там он и есть содержание). Удаляются все вхождения
 * (case-insensitive); осиротевшая пустая первая строка схлопывается.
 */
export function stripDecisionMarker(text: string): string {
  return text
    // маркер вместе с соседними пробелами → один пробел (без двойных)
    .replace(/[ \t]*\[DECISION\][ \t]*/gi, ' ')
    // осиротевшая пустая первая строка (маркер стоял строкой один)
    .replace(/^[ \t]*\n/, '')
    .trim();
}

/**
 * Промпт входящего рана (AC: утечки контекста нет).
 *
 * VL-433 (Q3): opts.quote — цитата сообщения-родителя reply-уточнения
 * человека; opts.context — последний вопрос/ответ ветки из process-памяти.
 * Обе секции опциональны и добавляются только при наличии — форма
 * прежних вызовов (без opts) не меняется.
 */
export function buildIncomingPrompt(
  question: string,
  channel: CommsChannel,
  opts: { quote?: string; context?: { question: string; answer: string } } = {},
): string {
  const parts = [
    `Ты отвечаешь на вопрос другой бот-проект в Telegram-канале «${channel.label ?? channel.id}».`,
    'Отвечай кратко и по делу. Используй ТОЛЬКО чтение файлов backlog/ и docs/ этого проекта.',
    'НИКОГДА не читай и не цитируй .env, .vibelog/settings.json, .vibelog/comms.yaml, секреты, токены и чужие проекты.',
    'Если вопрос требует архитектурного решения — начни ответ с метки [DECISION] в первой строке.',
    // VL-436 (doc-34 §3.3): контракт «права молчать» — модель вправе признать
    // вопрос пустым; ровно маркер → onExit ничего не отправляет (не в группу,
    // не в карточку). Маркер только для нашего возврата, на приёме его не бывает.
    'Если отвечать нечего — верни ровно <no_answer>. В группу при этом ничего не отправляется.',
  ];
  if (opts.quote) {
    parts.push('', 'Сообщение, на которое отвечает человек (цитата):', opts.quote.slice(0, 1500));
  }
  if (opts.context) {
    parts.push('', 'Предыдущий вопрос и ответ в этой ветке:');
    parts.push('Вопрос: ' + opts.context.question.slice(0, 1000));
    // VL-436: пустой answer — контекст из read_only-записи гейта (сообщение
    // прочитано без ответа); строку «Ответ:» не рисуем, иначе в промпт
    // попадает голая «Ответ: »
    if (opts.context.answer) parts.push('Ответ: ' + opts.context.answer.slice(0, 2000));
  }
  parts.push('', 'Вопрос:', question);
  return parts.join('\n');
}
