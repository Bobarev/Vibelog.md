/**
 * Исходящий синхронный interbot-вопрос (VL-428, doc-32 §6-7).
 *
 * MCP-инструмент interbot_ask живёт в процессе MCP-сервера, у которого нет
 * grammy-бота: отправка идёт напрямую через Bot API HTTPS (с прокси из
 * comms.yaml, паттерн setup-check.ts). Ожидание ответа — через файл тикетов
 * (граница процессов бот ≠ MCP): бот-получатель дописывает reply в тикет,
 * здесь файл опрашивается.
 *
 * Лимит MCP-клиента на один вызов — 60 с (REQUEST_TIMEOUT_MS_DEFAULT,
 * src/agent/mcp-client.ts): ожидание ограничивается 55 с. VL-429 (фикс 1):
 * и дедлайн тикета ставится в тот же потолок min(sync_timeout_sec, 55 с) —
 * иначе ответ на 56–120-й секунде помечался answered, но MCP-клиент к тому
 * времени уже вернулся «ответа нет», и доставка не происходила (дырка
 * 55–120 с). Теперь такой ответ — expired → штатный async-fallback
 * (комментарий к задаче + уведомление в боте), а не потеря.
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { resolveChannel, resolveCommsSecret, syncTimeoutSec } from '../comms.js';
import { createTicket, waitForAnswer } from './tickets.js';

/** Жёсткий потолок одного MCP-вызова (клиент 60 с, запас 5 с). */
export const MCP_CALL_CAP_SEC = 55;

/**
 * Дедлайн тикета interbot_ask (VL-429, фикс дырки 55–120 с): не длиннее
 * потолка MCP-вызова — ответ после capSec не может быть доставлен вызывающему
 * синхронно, поэтому тикет честно «протухает» и уходит в async-fallback.
 *
 * @param syncTimeout — sync_timeout_sec проекта (глобальный потолок ожидания)
 */
export function askTicketDeadlineSec(syncTimeout: number): number {
  return Math.min(syncTimeout, MCP_CALL_CAP_SEC);
}

/** Аргументы interbot_ask (приходят как есть из JSON-RPC). */
export interface InterbotAskArgs {
  question?: unknown;
  channel?: unknown;
  to?: unknown;
  task?: unknown;
  kind?: unknown;
}

/** Разобранные и валидированные аргументы. */
export interface ParsedAsk {
  question: string;
  channel?: string;
  to?: string;
  task?: string;
  kind?: string;
}

/**
 * Валидация аргументов без сети (юнит-тесты).
 *
 * @returns либо {error} с русским сообщением, либо ParsedAsk
 */
export function parseAskArgs(args: InterbotAskArgs): ParsedAsk | { error: string } {
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  if (question === '') return { error: 'interbot_ask: question обязателен' };
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  const channel = str(args.channel);
  const to = str(args.to);
  const task = str(args.task);
  const kind = str(args.kind);
  if (kind !== undefined && !['info', 'question', 'decision_request'].includes(kind)) {
    return {
      error: `interbot_ask: неизвестный kind «${kind}» (ожидается info|question|decision_request)`,
    };
  }
  return {
    question,
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(task ? { task } : {}),
    ...(kind ? { kind } : {}),
  };
}

/**
 * Отправка текста в чат через Bot API напрямую (без grammy).
 *
 * @param opts.replyTo — message_id сообщения, на которое это reply
 * @param opts.fetchImpl — подмена fetch (тесты)
 * @returns message_id отправленного сообщения (нужен для тикета)
 */
export async function sendTelegramText(
  cwd: string,
  chatId: number,
  text: string,
  opts: { replyTo?: number; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const token = resolveCommsSecret(cwd, 'bot_token');
  if (!token) {
    throw new Error('Токен бота не задан: secrets.telegram.bot_token в .vibelog/comms.yaml');
  }
  const proxy = resolveCommsSecret(cwd, 'proxy');
  const fetchImpl: typeof fetch =
    opts.fetchImpl ??
    (proxy
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (((input: any, init?: any) =>
          undiciFetch(input, { ...init, dispatcher: new ProxyAgent(proxy) })) as any)
      : globalThis.fetch);
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (opts.replyTo !== undefined) body.reply_parameters = { message_id: opts.replyTo };
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  } | null;
  if (!res.ok || !parsed?.ok || typeof parsed.result?.message_id !== 'number') {
    throw new Error(
      `Telegram sendMessage не прошёл: ${parsed?.description ?? `HTTP ${res.status}`}`,
    );
  }
  return parsed.result.message_id;
}

/**
 * Полный сценарий interbot_ask (AC4/AC5): выбор канала → отправка →
 * тикет → синхронное ожидание (≤ min(sync_timeout_sec, MCP_CALL_CAP_SEC)).
 *
 * По таймауту НЕ бросает: возвращает аккуратный текст «ответа нет» —
 * тикет остаётся pending, запоздавший ответ доставит bot-процесс.
 *
 * @returns текст ответа чужого бота либо сообщение о таймауте
 */
export async function interbotAsk(cwd: string, rawArgs: InterbotAskArgs): Promise<string> {
  const parsed = parseAskArgs(rawArgs);
  if ('error' in parsed) throw new Error(parsed.error);
  const resolved = resolveChannel(cwd, parsed.channel);
  if ('error' in resolved) throw new Error(resolved.error);
  const channel = resolved.channel;
  const text = parsed.to ? `${parsed.to} ${parsed.question}` : parsed.question;
  const messageId = await sendTelegramText(cwd, channel.group_id, text);
  const fullTimeout = syncTimeoutSec(cwd);
  // VL-429 (фикс 1): дедлайн тикета = потолок MCP-вызова — ответ позже capSec
  // обязан уйти в async-fallback (expired), а не «замaskироваться» под answered
  const capSec = askTicketDeadlineSec(fullTimeout);
  const ticket = createTicket(cwd, {
    id: `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channel_id: channel.id,
    question_msg_id: messageId,
    timeoutSec: capSec,
    ...(parsed.task || parsed.kind
      ? {
          context: {
            ...(parsed.task ? { task: parsed.task } : {}),
            ...(parsed.kind ? { kind: parsed.kind } : {}),
          },
        }
      : {}),
  });
  // Фактическое ожидание ограничено лимитом MCP-клиента (AC5: «не дольше
  // sync_timeout_sec» — потолок тем более выполняется)
  const { answered, ticket: final } = await waitForAnswer(cwd, ticket.id, {
    maxWaitMs: capSec * 1000,
  });
  if (answered && final.reply) return final.reply;
  return (
    `Ответа нет за ${capSec} с (потолок MCP-вызова; дедлайн тикета тоже ${capSec} с). ` +
    `Тикет ${ticket.id}: запоздавший ответ будет доставлен асинхронно — ` +
    `комментарием к задаче${parsed.task ? ` ${parsed.task}` : ''} и уведомлением в боте.`
  );
}
