/**
 * Лимиты веб-чата: конфиг + per-call таймаут (VL-269).
 *
 * Инцидент: чат дважды умирал посреди изучения референса — «Превышено время
 * ответа (120 с) — диалог остановлен» и «Превышен лимит итераций инструментов
 * (8) — диалог остановлен», после чего пользователю пришлось больше десятка
 * раз писать «Продолжи». Причины: (1) оба лимита были жёстко зашиты в
 * `src/web/chat.ts` и слишком малы для реальной работы с инструментами
 * (изучение одного файла — итерация на «подумать» плюс по итерации на каждый
 * батч чтения); (2) `max_wall_time` из `.vibelog/settings.json` читал только
 * агент фаз, чат — нет; (3) 120 с резали ВЕСЬ ход, включая пять быстрых
 * tool-вызовов, а не один вызов модели.
 *
 * Модуль намеренно чистый (без fs, без LLM и без чата) — как `tool-dedup.ts`:
 * 1. `resolveChatLimits(cwd)` читает секцию `chat` `.vibelog/settings.json`
 *    терпимо (lesson-117): битое значение → дефолт + сообщение в `errors`,
 *    но никогда не падение. Вызывается на КАЖДЫЙ ход, а не на старте
 *    процесса — правка настроек применяется к следующему ходу без рестарта.
 * 2. `createCallGuard(callTimeoutMs)` — таймаут одного вызова модели.
 *    Таймер перевзводится на каждое событие активности (токен стрима),
 *    поэтому медленный, но живой стрим не убивается раньше времени;
 *    `timedOut()` отличает срабатывание таймаута от отмены пользователем.
 */

import { loadSettings } from '../core/settings.js';

/** Разрешённые лимиты хода веб-чата (мс — только внутри модуля, наружу секунды). */
export interface ChatLimits {
  /** Максимум итераций LLM-цикла на один ход (ответ модели + tool-вызовы). */
  maxIterations: number;
  /** Общий бюджет хода, мс. */
  maxWallTimeMs: number;
  /** Максимум авто-продолжений подряд на клиенте. */
  maxAutoContinue: number;
  /** Таймаут одного вызова модели, мс. */
  callTimeoutMs: number;
}

/**
 * Дефолты: 8 итераций / 120 с — ТЕКУЩЕЕ поведение чата. Без секции `chat`
 * в settings.json чат ведёт себя ровно как до VL-269 (AC1).
 */
export const CHAT_LIMITS_DEFAULT: ChatLimits = {
  maxIterations: 8,
  maxWallTimeMs: 120_000,
  maxAutoContinue: 3,
  callTimeoutMs: 90_000,
};

/**
 * Потолки значений (защита от «поставлю 100000 итераций»): не столько про
 * риск, сколько про предсказуемость — битый/ошибочный конфиг не должен
 * приводить к ходу, который не кончается никогда.
 */
export const CHAT_LIMITS_CEILING = {
  maxIterations: 200,
  maxWallTimeSec: 86_400,
  maxAutoContinue: 20,
  callTimeoutSec: 3_600,
} as const;

/** Ключи секции `chat` в settings.json (секунды — как их видит пользователь). */
export const CHAT_LIMITS_KEYS = ['max_iterations', 'max_wall_time', 'max_auto_continue', 'call_timeout'] as const;

/** Ключ секции `chat`. */
export type ChatLimitsKey = (typeof CHAT_LIMITS_KEYS)[number];

/** Результат чтения лимитов: значения + понятные проблемы конфига. */
export interface ChatLimitsResolution {
  limits: ChatLimits;
  /** Сообщения о мусорных значениях (откат к дефолту уже сделан). */
  errors: string[];
}

/**
 * Целое в диапазоне 1..ceiling либо null (мусор — вызывающий берёт дефолт).
 *
 * Number(null) === 0 и Number('') === 0 → в диапазон не попадают, поэтому
 * `null`/пустая строка трактуются как «не задано» без особого случая.
 */
function readInt(raw: unknown, ceiling: number): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= ceiling ? raw : null;
}

/**
 * Лимиты чата из `.vibelog/settings.json` (секция `chat`).
 *
 * Отсутствие секции/ключа — дефолт БЕЗ ошибки (нормальная конфигурация).
 * Присутствующий, но невалидный ключ (0, отрицательное, дробное, строка,
 * null, объект, значение сверх потолка) — дефолт + запись в `errors`.
 * Битый settings.json (`loadSettings` возвращает `{}`) — все дефолты.
 *
 * @param cwd — каталог проекта (там же, где backlog/ и .vibelog/)
 */
export function resolveChatLimits(cwd: string): ChatLimitsResolution {
  const errors: string[] = [];
  const limits: ChatLimits = { ...CHAT_LIMITS_DEFAULT };
  const raw = loadSettings(cwd).chat;
  if (raw === undefined || raw === null) return { limits, errors };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`chat: ожидается объект с ключами ${CHAT_LIMITS_KEYS.join(', ')} — взяты дефолты`);
    return { limits, errors };
  }
  const section = raw as Record<string, unknown>;

  const iterations = readInt(section.max_iterations, CHAT_LIMITS_CEILING.maxIterations);
  if (iterations !== null) limits.maxIterations = iterations;
  else if (section.max_iterations !== undefined) {
    errors.push(
      `chat.max_iterations: ожидается целое 1..${CHAT_LIMITS_CEILING.maxIterations}, получено ${JSON.stringify(section.max_iterations)} — взято ${CHAT_LIMITS_DEFAULT.maxIterations}`,
    );
  }

  const wallTime = readInt(section.max_wall_time, CHAT_LIMITS_CEILING.maxWallTimeSec);
  if (wallTime !== null) limits.maxWallTimeMs = wallTime * 1000;
  else if (section.max_wall_time !== undefined) {
    errors.push(
      `chat.max_wall_time: ожидается целое 1..${CHAT_LIMITS_CEILING.maxWallTimeSec} (сек), получено ${JSON.stringify(section.max_wall_time)} — взято ${CHAT_LIMITS_DEFAULT.maxWallTimeMs / 1000}`,
    );
  }

  const autoContinue = readInt(section.max_auto_continue, CHAT_LIMITS_CEILING.maxAutoContinue);
  if (autoContinue !== null) limits.maxAutoContinue = autoContinue;
  else if (section.max_auto_continue !== undefined) {
    errors.push(
      `chat.max_auto_continue: ожидается целое 1..${CHAT_LIMITS_CEILING.maxAutoContinue}, получено ${JSON.stringify(section.max_auto_continue)} — взято ${CHAT_LIMITS_DEFAULT.maxAutoContinue}`,
    );
  }

  const callTimeout = readInt(section.call_timeout, CHAT_LIMITS_CEILING.callTimeoutSec);
  if (callTimeout !== null) limits.callTimeoutMs = callTimeout * 1000;
  else if (section.call_timeout !== undefined) {
    errors.push(
      `chat.call_timeout: ожидается целое 1..${CHAT_LIMITS_CEILING.callTimeoutSec} (сек), получено ${JSON.stringify(section.call_timeout)} — взято ${CHAT_LIMITS_DEFAULT.callTimeoutMs / 1000}`,
    );
  }

  return { limits, errors };
}

/** Одна строка предупреждения о мусорных лимитах (для лога/ответа сервера). */
export function formatChatLimitsErrors(errors: readonly string[]): string {
  if (errors.length === 0) return '';
  return `[vibelog-chat] некорректные лимиты в .vibelog/settings.json (взяты дефолты): ${errors.join('; ')}`;
}

/** Guard одного вызова модели: сигнал отмены + признак сработавшего таймаута. */
export interface CallGuard {
  /** Сигнал для fetch/LLM-клиента: аборт по таймауту ИЛИ по остановке. */
  readonly signal: AbortSignal;
  /**
   * Отметка активности (токен стрима, начало ответа): перевзводит таймер.
   * Живой, но медленный стрим так не убивается per-call таймаутом.
   */
  noteActivity(): void;
  /** Сработал ли per-call таймаут (а не отмена пользователем). */
  timedOut(): boolean;
  /** Снять таймер (всегда в finally — иначе он держит процесс/тесты). */
  dispose(): void;
}

/**
 * Per-call таймаут (AC12): таймер inactivity, а не «весь ход».
 *
 * `callTimeoutMs` — максимум БЕЗ единого события активности; каждое
 * `noteActivity()` отсчитывает заново. По срабатыванию абортится сигнал и
 * выставляется `timedOut() === true`, по нему сервер отдаёт `truncated`
 * (мягкая деградация) вместо error-события: ход продолжится на клиенте
 * или кнопкой «Продолжить», история в jsonl цела.
 *
 * @param timeoutMs — окно неактивности; 0/отрицательное — таймаута нет
 *   (полезно в тестах и при выключенном лимите)
 */
export function createCallGuard(timeoutMs: number): CallGuard {
  const controller = new AbortController();
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = (): void => {
    clear();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    // unref недоступен в браузерных типах — в Node таймер не должен держать
    // процесс, если ход уже завершён (guard.dispose() тоже это делает)
    timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      fired = true;
      controller.abort();
    }, timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  arm();

  return {
    signal: controller.signal,
    noteActivity(): void {
      if (controller.signal.aborted) return;
      arm();
    },
    timedOut(): boolean {
      return fired;
    },
    dispose(): void {
      clear();
    },
  };
}
