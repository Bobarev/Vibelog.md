/**
 * Auto-runner — автономное прохождение фаз задач из автоочерери (VL-191).
 *
 * Живёт в процессе Telegram-бота (бот и оркестратор — один процесс):
 * очередь персистентна в `.vibelog/auto-queue.json` (core/auto-queue.ts),
 * запуск фаз — ТОЛЬКО через общий startTaskPhase (lesson-37, без
 * дублирования логики бота/веба), выбор фазы — по workflow (VL-188).
 *
 * Цикл событийный, без параллелизма (спецификация: «параллельный запуск —
 * последовательно проще»):
 * - `tick` стартует только если нет активной auto-фазы (флаг autoActive);
 * - триггеры: /auto start, каждый onExit фазы, /auto add при running:true,
 *   пол-timer 60 c (dep-блокированные pending иначе никогда не дождутся);
 * - текущая задача доводится до терминала (done/failed) прежде чем взята
 *   следующая: элемент «running» продолжается, а не пере-пикается;
 * - stop (/auto stop) — running:false: текущая фаза доигрывает, onExit
 *   перечитывает файл и не запускает следующую.
 *
 * Ветвление: auto выбирает ПЕРВУЮ не-reject фазу статуса; reject — только
 * вручную. Ошибка фазы: retry до max_retries (default 1), затем failed +
 * уведомление во все привязанные чаты. Успех фазы = exitCode 0 И смена
 * статуса задачи (нет смены → нет прогресса → retry, защита от цикла
 * «фаза отработала, агент не сделал finish»).
 */

import type { Bot } from 'grammy';
import {
  addQueueTasks,
  formatAutoQueue,
  loadAutoQueue,
  pickNextQueueTask,
  saveAutoQueue,
  setQueueRunning,
  sweepQueue,
  updateQueueTask,
} from '../core/auto-queue.js';
import type { AutoQueue, AutoQueueTask } from '../core/auto-queue.js';
import { getTask } from '../core/store.js';
import { getAvailablePhases, getWorkflowForTask } from '../core/workflow.js';
import type { Workflow } from '../core/workflow.js';
import { loadBotSettings, resolveDefaultAgent } from './settings.js';
import { startTaskPhase } from '../web/orchestrator.js';
import type { PhaseExitCallback, PhaseRun } from '../web/orchestrator.js';

/** true ⇔ auto-фаза сейчас активна (guard от параллельных тиков). */
let autoActive = false;
/** Пол-timer ожидания dep-блокированных pending; null — не запущен. */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Интервал повторной проверки очереди, мс (dep-зависимости могут созреть). */
export const AUTO_POLL_INTERVAL_MS = 60_000;

/**
 * Следующая фаза авто-прогона: ПЕРВАЯ не-reject ветка статуса workflow.
 *
 * Reject — только вручную (спецификация); если из статуса доступен только
 * reject — авто не знает, что делать → null (вызывающий проваливает задачу).
 *
 * @param workflow — workflow задачи (VL-188)
 * @param status — текущий статус задачи
 */
export function pickAutoPhase(workflow: Workflow, status: string): string | null {
  const phases = getAvailablePhases(workflow, status);
  return phases.find((p) => p !== 'reject') ?? null;
}

/**
 * Решение после ошибки фазы: retry, пока попытки не исчерпаны.
 *
 * @param attempts — попыток уже потрачено (включая текущую)
 * @param maxRepeats — максимум повторов (max_retries очереди, default 1)
 * @returns 'retry' — можно перезапускать; 'failed' — проваливать задачу
 */
export function nextFailureAction(attempts: number, maxRepeats: number): 'retry' | 'failed' {
  return attempts <= maxRepeats ? 'retry' : 'failed';
}

/**
 * Отправка текста по chatId: MarkdownV2 с фолбэком на plain (паттерн VL-48;
 * копия sendText из handlers.ts — handlers импортирует этот модуль, цикл
 * импортов ради 10 строк не нужен).
 */
async function sendText(bot: Bot, chatId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch {
    try {
      await bot.api.sendMessage(chatId, text);
    } catch {
      // Сеть недоступна — сообщение теряется, polling продолжится
    }
  }
}

/** Уведомление во все привязанные чаты (loadBotSettings.chats). */
function notifyAllChats(bot: Bot, cwd: string, text: string): void {
  for (const chatId of loadBotSettings(cwd).chats) {
    void sendText(bot, chatId, text).catch(() => {});
  }
}

/** Уведомление о провале задачи в автоочереди (спецификация: failed + чат). */
function notifyAutoFailure(
  bot: Bot,
  cwd: string,
  taskId: string,
  phase: string,
  attempts: number,
  reason: string
): void {
  notifyAllChats(
    bot,
    cwd,
    `❌ Автоочередь: задача *${taskId}* — фаза ${phase} не удалась после ${attempts} поп. ` +
      `(статус failed, причина: ${reason.slice(0, 300)})`
  );
}

/**
 * Обработка ошибки фазы: наращивает attempts, при исчерпании — failed +
 * уведомление. Элемент остаётся running при retry (tick продолжит задачу).
 */
function handlePhaseFailure(
  bot: Bot,
  cwd: string,
  item: AutoQueueTask,
  phase: string,
  reason: string
): void {
  const queue = loadAutoQueue(cwd);
  const fresh = queue.tasks.find((t) => t.id === item.id);
  if (!fresh || fresh.status === 'done' || fresh.status === 'failed') return;
  const attempts = (fresh.attempts ?? 0) + 1;
  const max = queue.max_retries ?? 1;
  if (nextFailureAction(attempts, max) === 'retry') {
    fresh.attempts = attempts;
    saveAutoQueue(cwd, queue);
    return;
  }
  fresh.status = 'failed';
  fresh.attempts = attempts;
  saveAutoQueue(cwd, queue);
  notifyAutoFailure(bot, cwd, item.id, phase, attempts, reason);
}

/**
 * Сбрасывает элементы running → pending (рестарт процесса потерял onExit,
 * либо /auto stop оставил текущий элемент running).
 */
function resetRunningToPending(cwd: string): void {
  const queue = loadAutoQueue(cwd);
  let changed = false;
  for (const t of queue.tasks) {
    if (t.status === 'running') {
      t.status = 'pending';
      changed = true;
    }
  }
  if (changed) saveAutoQueue(cwd, queue);
}

/** Запускает пол-timer (идемпотентно); unref — не держит процесс живым. */
export function startAutoPoll(bot: Bot, cwd: string): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => {
    autoTick(bot, cwd);
  }, AUTO_POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

/** Останавливает пол-timer. */
export function stopAutoPoll(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Один шаг автоочерери: продолжить текущую (running) либо взять следующую
 * pending по правилам AC2. Никогда не запускает вторую фазу параллельно
 * (guard autoActive); ошибки запуска уходят в retry/failed-машину.
 */
export function autoTick(bot: Bot, cwd: string): void {
  if (autoActive) return;
  const queue = loadAutoQueue(cwd);
  if (!queue.running) {
    stopAutoPoll();
    return;
  }
  // Синхронизация очереди с состоянием задач (удалённые/Done/Rejected)
  const changed = sweepQueue(cwd, queue);
  if (changed) saveAutoQueue(cwd, queue);

  // 1) Продолжение текущей задачи (элемент running — фазы идут подряд)
  let item = queue.tasks.find((t) => t.status === 'running') ?? null;
  // 2) Иначе — следующая pending по правилам выбора
  if (!item) item = pickNextQueueTask(cwd, queue);

  if (!item) {
    const hasPending = queue.tasks.some((t) => t.status === 'pending');
    if (!hasPending) {
      // Пустая очередь → остановиться (спецификация)
      setQueueRunning(cwd, false);
      stopAutoPoll();
      if (changed || queue.tasks.length > 0) {
        notifyAllChats(bot, cwd, '✅ Автоочередь пуста — автопрогон остановлен');
      }
    } else {
      // pending есть, но они dep-блокированы/без фаз — ждём пол-timer
      startAutoPoll(bot, cwd);
    }
    return;
  }

  const task = getTask(cwd, item.id);
  if (!task) {
    // sweep уже пометил бы failed; страховка — не должно доходить
    updateQueueTask(cwd, item.id, { status: 'failed' });
    setImmediate(() => autoTick(bot, cwd));
    return;
  }
  const workflow = getWorkflowForTask(cwd, task);
  const phase = pickAutoPhase(workflow, task.status);
  if (!phase) {
    // Нет не-reject фазы и не терминальный статус (иначе sweep) — авто
    // не может двигать задачу: failed + уведомление, очередь продолжается
    updateQueueTask(cwd, item.id, { status: 'failed' });
    notifyAutoFailure(bot, cwd, item.id, '—', item.attempts ?? 0, `нет фазы из статуса ${task.status}`);
    setImmediate(() => autoTick(bot, cwd));
    return;
  }

  // Запуск фазы: элемент running (текущая задача), фиксируем started_at
  const statusBefore = task.status;
  item.status = 'running';
  item.started_at = new Date().toISOString();
  saveAutoQueue(cwd, queue);
  autoActive = true;

  const onExit: PhaseExitCallback = (run) => {
    autoActive = false;
    finishCurrentPhase(bot, cwd, item.id, phase, statusBefore, run);
    // Продолжение: очередь могла остановиться (stop/пусто) — tick сам проверит
    setImmediate(() => autoTick(bot, cwd));
  };
  const result = startTaskPhase(cwd, item.id, phase, {
    onExit,
    agent: resolveDefaultAgent(cwd),
  });
  if ('error' in result) {
    // Ошибка запуска (409 «уже выполняется», валидация) — та же retry-машинa
    autoActive = false;
    handlePhaseFailure(bot, cwd, item, phase, result.error);
    setImmediate(() => autoTick(bot, cwd));
  }
}

/**
 * Финализация фазы в onExit: успех (exitCode 0 + смена статуса) → сброс
 * attempts, элемент остаётся running (задача продолжается); иначе retry/failed.
 * Стоп очереди (/auto stop) перечитывается здесь — фаза доиграла, дальше нет.
 */
function finishCurrentPhase(
  bot: Bot,
  cwd: string,
  taskId: string,
  phase: string,
  statusBefore: string,
  run: PhaseRun
): void {
  const queue = loadAutoQueue(cwd);
  const item = queue.tasks.find((t) => t.id === taskId);
  if (!item) return;
  // /auto stop во время фазы: текущая фаза доиграла, не продолжаем
  if (!queue.running) {
    return;
  }
  const fresh = getTask(cwd, taskId);
  const progressed = fresh !== null && fresh.status !== statusBefore;
  if (run.exitCode === 0 && progressed) {
    item.attempts = 0;
    saveAutoQueue(cwd, queue);
    return;
  }
  const reason =
    run.exitCode === 0
      ? 'статус задачи не изменился (нет прогресса)'
      : `код выхода ${run.exitCode ?? '—'}${run.logTail ? `: ${run.logTail.slice(-200)}` : ''}`;
  handlePhaseFailure(bot, cwd, item, phase, reason);
}

/**
 * Добавляет задачи в очередь (/auto add и кнопка auto:<id> карточки).
 * Идемпотентно: уже в очереди → skipped. При включённом running — сразу
 * триггерит тик (новая задача будет взята после текущей фазы).
 *
 * @returns added/skipped для ответа бота
 */
export function enqueueAutoTasks(
  bot: Bot,
  cwd: string,
  ids: string[]
): { added: string[]; skipped: string[] } {
  const res = addQueueTasks(cwd, ids);
  const queue = loadAutoQueue(cwd);
  if (queue.running) {
    startAutoPoll(bot, cwd);
    setImmediate(() => autoTick(bot, cwd));
  }
  return res;
}

/**
 * /auto start: running:true, running-элементы → pending (хвост после
 * прошлого stop/рестарта), запуск цикла.
 */
export function startAutoRunner(bot: Bot, cwd: string): void {
  resetRunningToPending(cwd);
  setQueueRunning(cwd, true);
  startAutoPoll(bot, cwd);
  setImmediate(() => autoTick(bot, cwd));
}

/**
 * /auto stop: running:false — текущая фаза доиграет, onExit не продолжит.
 * Пол-timer гаснет на следующем тике/проверке.
 */
export function stopAutoRunner(cwd: string): void {
  setQueueRunning(cwd, false);
}

/**
 * Возобновление при старте бота (рестарт пережил очередь): running-элементы
 * → pending (onExit потерялся), при running:true — продолжаем цикл.
 */
export function resumeAutoRunner(bot: Bot, cwd: string): void {
  const queue = loadAutoQueue(cwd);
  if (queue.tasks.some((t) => t.status === 'running')) resetRunningToPending(cwd);
  if (!queue.running) return;
  startAutoPoll(bot, cwd);
  setImmediate(() => autoTick(bot, cwd));
}

/** Текст /auto status: текущее состояние очереди. */
export function autoQueueStatusText(cwd: string): string {
  return formatAutoQueue(loadAutoQueue(cwd));
}
