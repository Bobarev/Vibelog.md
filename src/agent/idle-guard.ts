/**
 * Idle-watchdog фазы (VL-274, doc-19 §8, заимствование из hermes-agent ref-10).
 *
 * Проблема (VL-254): единственный ограничитель фазы — wall-time (`--max-wall-time`),
 * и фаза, которая РАБОТАЕТ (читает файлы, правит код, гоняет тесты), обрывается
 * на общем таймере, хотя не зависла. hermes решает это иначе: таймаут считается
 * по **простою** — нет новых токенов и нет завершённых tool-вызовов N секунд →
 * сессия считается зависшей и прерывается; долгая-но-активная не обрывается
 * никогда.
 *
 * Модуль намеренно чистый (без fs, без LLM, без loop) — как `createCallGuard`
 * в `src/web/chat-limits.ts` (VL-269, lesson-126): таймер неактивности,
 * перевзводимый на каждое событие активности.
 *
 * Отличие от чата — комбинированный сигнал: loop уже может получить внешний
 * `AbortSignal` (отмена фазы), и idle-abort должен складываться с ним, а не
 * подменять. `AbortSignal.any` не используется намеренно: он появился только
 * в Node 20.3, а в `engines` проекта заявлен `>=20` — комбинируем вручную.
 *
 * Второе отличие — `pause()`: на время выполнения tool-хендлера таймер
 * снимается. В этом проекте легитимный долгий инструмент реален (`pnpm test`
 * на Catalina идёт 20+ минут без вывода) и уже ограничен своими таймаутами
 * (`run_shell_command`: bash-таймаут + усечение по остатку wall-time);
 * watchdog сторожит тишину LLM-стрима и цикла, а не длительность инструмента.
 */

/** Опции создания idle-guard. */
export interface IdleGuardOptions {
  /**
   * Окно неактивности в миллисекундах. `<= 0` — проверка выключена
   * (`HERMES_CRON_TIMEOUT=0` = unlimited): таймер не взводится, `timedOut()`
   * всегда false.
   */
  timeoutMs: number;
  /**
   * Источник текущего времени (инъекция для тестов; дефолт `Date.now`).
   * Используется для `idleMs()` — проверка в цикле идёт по нему, поэтому
   * тесты детерминированны без sleep.
   */
  now?: () => number;
  /** Внешний сигнал отмены (loop: `options.signal`); abort складывается с idle-abort. */
  externalSignal?: AbortSignal;
}

/** Вачдог простоя: отметка активности, пауза на время tool-вызова, комбинированный сигнал. */
export interface IdleGuard {
  /** Сигнал для LLM-запроса и handler'ов: аборт по простою ИЛИ по внешней отмене. */
  readonly signal: AbortSignal;
  /** Активность (новый токен стрима): обновляет отметку и перевзводит таймер. */
  noteActivity(): void;
  /** Снять таймер на время выполнения инструмента (долгий tool — не зависание). */
  pause(): void;
  /** Вернуть таймер после инструмента: окно отсчитывается заново. */
  resume(): void;
  /** Сработал ли idle-таймаут (а не внешняя отмена). */
  timedOut(): boolean;
  /** Сколько миллисекунд прошло с последней активности. */
  idleMs(): number;
  /** Снять таймер (всегда на выходе из loop — иначе он держит процесс/тесты). */
  dispose(): void;
}

/**
 * Создаёт idle-watchdog фазы.
 *
 * @param options — окно простоя, инъекция часов и внешний сигнал отмены
 */
export function createIdleGuard(options: IdleGuardOptions): IdleGuard {
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  const disabled = !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0;
  let lastActivity = now();
  let paused = false;
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Внешняя отмена складывается с idle-abort: у loop один сигнал для
  // LLM-запроса и handler'ов, и он должен срабатывать и по простою, и по
  // отмене пользователем/оркестратором.
  const external = options.externalSignal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** Взводит таймер на остаток окна (в тестах часы виртуальные — остаток может быть 0). */
  const arm = (): void => {
    clear();
    if (disabled || paused || controller.signal.aborted) return;
    const remaining = options.timeoutMs - (now() - lastActivity);
    timer = setTimeout(
      () => {
        if (controller.signal.aborted) return;
        fired = true;
        controller.abort();
      },
      remaining > 0 ? remaining : 0,
    );
    // unref: таймер не должен держать процесс живым (Vitest ругается на открытые хендлы)
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  arm();

  return {
    signal: controller.signal,
    noteActivity(): void {
      lastActivity = now();
      arm();
    },
    pause(): void {
      paused = true;
      clear();
    },
    resume(): void {
      paused = false;
      // Окно отсчитывается заново: длительность инструмента не «съедает» бюджет простоя
      lastActivity = now();
      arm();
    },
    timedOut(): boolean {
      return fired;
    },
    idleMs(): number {
      return now() - lastActivity;
    },
    dispose(): void {
      clear();
    },
  };
}