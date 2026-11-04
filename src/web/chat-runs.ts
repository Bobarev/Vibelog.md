/**
 * Реестр прогонов веб-чата, отвязанный от HTTP-запроса (VL-332).
 *
 * Проблема: раньше ход жил внутри `POST /api/chat` — оборвался запрос
 * (пользователь переключил тред → рантайм размонтировался → fetch абортился)
 * и ход умирал: в jsonl не оставалось ни ответа, ни даже user-сообщения.
 *
 * Решение: ход — самостоятельный объект `ChatRun`, живущий в module-state
 * сервера до своего завершения. HTTP-запрос только ПОДПИСЫВАЕТСЯ на поток
 * событий (в т.ч. повторно, с индекса `since`), а его обрыв прогон не убивает.
 * Прогресс дублируется в sidecar `<threadId>.turn.json` — по нему UI после
 * перезагрузки страницы знает, что ход ещё идёт (AC3/AC4), а «осиротевший»
 * running (сервер перезапустили) честно переводится в `interrupted`.
 *
 * Файл намеренно не импортирует `chat.ts` рантаймом (только типы): реестр —
 * низкий слой, продюсер (`produce`) его использует, а не наоборот.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatEvent } from './chat.js';

/** Сколько событий держим в буфере прогона (поздний подписчик дочитывает). */
export const RUN_EVENT_BUFFER = 4000;

/** Статус хода, видимый клиенту (`GET /api/chat/threads/:id` → `run`). */
export type TurnStatus = 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';

/** Sidecar-состояние хода треда (`<threadId>.turn.json`). */
export interface TurnState {
  status: TurnStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

/** Один прогон хода: буфер событий + подписчики. */
export interface ChatRun {
  threadId: string;
  cwd: string;
  startedAt: string;
  /** Накопленные события (первые вытесняются при переполнении буфера). */
  events: ChatEvent[];
  /** Абсолютный индекс events[0] (для `since`-переподключения без дублей). */
  baseIndex: number;
  done: boolean;
  status: TurnStatus;
  error?: string;
  /** Отмена пользователем: абортит текущий LLM-вызов. */
  cancel: ((reason?: string) => void) | null;
  listeners: Set<() => void>;
}

const runs = new Map<string, ChatRun>();

/** Каталог сессий чата (дублирует chatSessionsDir, чтобы не было цикла). */
function sessionsDir(cwd: string): string {
  return join(cwd, '.vibelog', 'chat-sessions');
}

/** Путь sidecar-файла состояния хода. */
export function turnStateFile(cwd: string, threadId: string): string {
  return join(sessionsDir(cwd), `${threadId}.turn.json`);
}

/** Запись состояния хода (сбой записи не должен ронять чат). */
export function writeTurnState(cwd: string, threadId: string, state: TurnState): void {
  try {
    mkdirSync(sessionsDir(cwd), { recursive: true });
    writeFileSync(turnStateFile(cwd, threadId), JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // диагностика хода — не критичный путь
  }
}

/** Чтение состояния хода треда (битый/отсутствующий файл → null). */
export function readTurnState(cwd: string, threadId: string): TurnState | null {
  const file = turnStateFile(cwd, threadId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as TurnState;
    if (typeof parsed?.status !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Живой прогон треда (running) либо null. Клиенту отдаём статус из реестра,
 * а не из файла: после завершения прогон некоторое время остаётся в реестре,
 * чтобы поздний подписчик успел дочитать буфер.
 */
export function getChatRun(threadId: string): ChatRun | null {
  return runs.get(threadId) ?? null;
}

/** Создать прогон треда (вызывается стартом хода). */
export function createChatRun(threadId: string, cwd: string): ChatRun {
  const run: ChatRun = {
    threadId,
    cwd,
    startedAt: new Date().toISOString(),
    events: [],
    baseIndex: 0,
    done: false,
    status: 'running',
    cancel: null,
    listeners: new Set(),
  };
  runs.set(threadId, run);
  writeTurnState(cwd, threadId, { status: 'running', startedAt: run.startedAt });
  // Диагностика запросов (append-only, gitignored) — помогает разбирать
  // «ход пропал» без доступа к консоли сервера.
  try {
    appendFileSync(join(sessionsDir(cwd), `${threadId}.runs.log`), `${run.startedAt} start\n`, 'utf8');
  } catch {
    // лог не критичен
  }
  return run;
}

/** Добавить событие в буфер и разбудить подписчиков. */
export function pushChatRunEvent(run: ChatRun, ev: ChatEvent): void {
  if (run.done && ev.type !== 'done') {
    // события после завершения (гонка finally) не должны попадать в поток
    return;
  }
  run.events.push(ev);
  if (run.events.length > RUN_EVENT_BUFFER) {
    const drop = run.events.length - RUN_EVENT_BUFFER;
    run.events.splice(0, drop);
    run.baseIndex += drop;
  }
  for (const notify of [...run.listeners]) notify();
}

/** Завершить прогон: статус, sidecar, уведомление подписчиков. */
export function finishChatRun(run: ChatRun, status: TurnStatus, error?: string): void {
  if (run.done) return;
  run.done = true;
  run.status = status;
  if (error !== undefined) run.error = error;
  const finishedAt = new Date().toISOString();
  writeTurnState(run.cwd, run.threadId, {
    status,
    startedAt: run.startedAt,
    finishedAt,
    ...(error !== undefined ? { error } : {}),
  });
  try {
    appendFileSync(
      join(sessionsDir(run.cwd), `${run.threadId}.runs.log`),
      `${finishedAt} ${status}${error ? `: ${error}` : ''}\n`,
      'utf8',
    );
  } catch {
    // лог не критичен
  }
  for (const notify of [...run.listeners]) notify();
  // Поздний подписчик должен успеть дочитать буфер; сам прогон из реестра
  // убираем, чтобы память не росла (R3 плана).
  setTimeout(() => {
    if (runs.get(run.threadId) === run) runs.delete(run.threadId);
  }, 5 * 60_000).unref?.();
}

/** Отменить ход (кнопка «Остановить» / явный POST cancel). */
export function cancelChatRun(threadId: string, reason = 'Ход остановлен пользователем'): boolean {
  const run = runs.get(threadId);
  if (!run || run.done) return false;
  try {
    run.cancel?.(reason);
  } catch {
    // отмена не должна бросать
  }
  finishChatRun(run, 'cancelled', reason);
  return true;
}

/**
 * Подписка на события прогона с индекса `since` (абсолютный).
 * Возвращает функцию отписки. События до `since` не повторяются — это
 * защита от дублей при переподключении (AC5).
 */
export function subscribeChatRun(
  run: ChatRun,
  since: number,
  onEvent: (ev: ChatEvent, index: number) => void,
): () => void {
  let cursor = Math.max(since, run.baseIndex);
  const drain = (): void => {
    for (;;) {
      if (cursor >= run.baseIndex + run.events.length) return;
      const ev = run.events[cursor - run.baseIndex]!;
      onEvent(ev, cursor);
      cursor++;
    }
  };
  const notify = (): void => drain();
  run.listeners.add(notify);
  drain();
  return () => {
    run.listeners.delete(notify);
  };
}

/** Индекс, с которого продолжится поток (для клиента при переподключении). */
export function chatRunNextIndex(run: ChatRun): number {
  return run.baseIndex + run.events.length;
}

/**
 * «Осиротевшие» прогоны: сервер перезапустили посреди хода — в sidecar
 * остался `running`, живого прогона нет. Честно переводим в `interrupted`,
 * чтобы UI не показывал вечный индикатор (R4 плана).
 */
export function resetOrphanedRuns(cwd: string): string[] {
  const dir = sessionsDir(cwd);
  if (!existsSync(dir)) return [];
  const fixed: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.turn.json')) continue;
    const threadId = name.slice(0, -'.turn.json'.length);
    const state = readTurnState(cwd, threadId);
    if (!state || state.status !== 'running') continue;
    if (runs.has(threadId)) continue;
    writeTurnState(cwd, threadId, {
      ...state,
      status: 'interrupted',
      finishedAt: new Date().toISOString(),
      error: 'Сервер был перезапущен во время хода',
    });
    fixed.push(threadId);
  }
  return fixed;
}

/** Сброс реестра (тесты): прогоны не переживают процесс. */
export function clearChatRuns(): void {
  runs.clear();
}
