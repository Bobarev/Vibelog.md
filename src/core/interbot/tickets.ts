/**
 * Реестр interbot-тикетов (VL-428, doc-32 §4).
 *
 * JSON-файл `.vibelog/interbot/tickets.json` — общая граница между
 * процессом бота (long-polling) и MCP-сервером: ответ чужого бота
 * дописывается ботом, MCP-сервер видит его через файл (паттерн
 * settings.json). Запись атомарная temp+rename (lesson-214).
 *
 * Статусы: pending → answered (ответ вовремя) | expired (просрочка) →
 * delivered (async-fallback доставлен). Разбор протухших при старте —
 * recoverStaleTickets (паттерн recoverStalePhaseStatuses, VL-196).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Статус тикета. */
export type TicketStatus = 'pending' | 'answered' | 'expired' | 'delivered';

/** Тикет синхронного вопроса. */
export interface InterbotTicket {
  id: string;
  channel_id: string;
  /** message_id нашего вопроса в группе (для сопоставления с reply). */
  question_msg_id: number;
  asked_at: string;
  deadline: string;
  status: TicketStatus;
  context: { task?: string; session?: string; kind?: string };
  reply?: string;
}

/** Путь к реестру тикетов. */
export function ticketsPath(cwd: string): string {
  return join(cwd, '.vibelog', 'interbot', 'tickets.json');
}

/** Читает реестр; отсутствует/битый → пустой список (не роняем бота). */
export function loadTickets(cwd: string): InterbotTicket[] {
  const path = ticketsPath(cwd);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is InterbotTicket =>
        t !== null &&
        typeof t === 'object' &&
        typeof (t as InterbotTicket).id === 'string' &&
        typeof (t as InterbotTicket).status === 'string',
    );
  } catch {
    return [];
  }
}

/** Атомарная запись реестра (temp + rename рядом с целевым файлом). */
export function saveTickets(cwd: string, tickets: InterbotTicket[]): void {
  const path = ticketsPath(cwd);
  mkdirSync(join(cwd, '.vibelog', 'interbot'), { recursive: true });
  const tmp = `${path}.vibelog-tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(tickets, null, 2) + '\n', 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // temp может не существовать
    }
    throw new Error(`не удалось записать тикеты: ${(err as Error).message}`);
  }
}

/** Создаёт тикет pending с дедлайном now+timeoutSec и записывает реестр. */
export function createTicket(
  cwd: string,
  data: {
    id: string;
    channel_id: string;
    question_msg_id: number;
    timeoutSec: number;
    context?: { task?: string; session?: string };
  },
): InterbotTicket {
  const now = Date.now();
  const ticket: InterbotTicket = {
    id: data.id,
    channel_id: data.channel_id,
    question_msg_id: data.question_msg_id,
    asked_at: new Date(now).toISOString(),
    deadline: new Date(now + data.timeoutSec * 1000).toISOString(),
    status: 'pending',
    context: data.context ?? {},
  };
  const all = loadTickets(cwd);
  all.push(ticket);
  saveTickets(cwd, all);
  return ticket;
}

/**
 * Записывает ответ в тикет по question_msg_id (его присылает процесс бота,
 * увидевший reply чужого бота). Просроченные pending → expired.
 *
 * @returns обновлённый тикет либо null (совпадений нет — «ответ без тикета»)
 */
export function answerTicket(
  cwd: string,
  questionMsgId: number,
  reply: string,
  now: number = Date.now(),
): InterbotTicket | null {
  const all = loadTickets(cwd);
  const found = all.find(
    (t) => t.question_msg_id === questionMsgId && (t.status === 'pending' || t.status === 'expired'),
  );
  if (!found) return null;
  found.reply = reply;
  found.status = now > new Date(found.deadline).getTime() ? 'expired' : 'answered';
  saveTickets(cwd, all);
  return found;
}

/**
 * Разбор протухших при старте (VL-196): pending с истёкшим deadline → expired.
 *
 * @returns ids затронутых тикетов
 */
export function recoverStaleTickets(cwd: string, now: number = Date.now()): string[] {
  const all = loadTickets(cwd);
  const stale: string[] = [];
  for (const t of all) {
    if (t.status === 'pending' && now > new Date(t.deadline).getTime()) {
      t.status = 'expired';
      stale.push(t.id);
    }
  }
  if (stale.length > 0) saveTickets(cwd, all);
  return stale;
}

/** Помечает тикет доставленным (async-fallback отработал). */
export function markDelivered(cwd: string, id: string): void {
  const all = loadTickets(cwd);
  const t = all.find((x) => x.id === id);
  if (t && t.status === 'expired') {
    t.status = 'delivered';
    saveTickets(cwd, all);
  }
}

/**
 * Синхронное ожидание ответа через файл тикетов (AC5).
 *
 * Опрос файла каждые pollMs; возврат — при answered/достигнутом дедлайне.
 * Таймаут НЕ бросает: возвращает текущее состояние (вызывающий отдаёт
 * агенту аккуратный «ответа нет»).
 */
export async function waitForAnswer(
  cwd: string,
  ticketId: string,
  opts: { pollMs?: number; now?: () => number; maxWaitMs?: number } = {},
): Promise<{ ticket: InterbotTicket; answered: boolean }> {
  const pollMs = opts.pollMs ?? 500;
  const now = opts.now ?? Date.now;
  const started = now();
  let current = loadTickets(cwd).find((t) => t.id === ticketId);
  if (!current) throw new Error(`Тикет не найден: ${ticketId}`);
  for (;;) {
    if (current.status === 'answered') return { ticket: current, answered: true };
    if (current.status !== 'pending' || now() > new Date(current.deadline).getTime()) {
      return { ticket: current, answered: false };
    }
    // Потолок ожидания (VL-428): лимит MCP-клиента 60 с — тикет при этом
    // остаётся pending, его дедлайн не меняется (async-fallback работает)
    if (opts.maxWaitMs !== undefined && now() - started >= opts.maxWaitMs) {
      return { ticket: current, answered: false };
    }
    await new Promise((r) => setTimeout(r, pollMs));
    current = loadTickets(cwd).find((t) => t.id === ticketId) ?? current;
  }
}
