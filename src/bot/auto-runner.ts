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
 *
 * Retry через --resume (VL-200): перезапуск упавшей фазы приносит в
 * startTaskPhase extraArgs ['--resume', sessionId] последней сессии ЭТОЙ
 * фазы — агент дописывает существующий JSONL вместо новой сессии (инцидент
 * VL-197: потеря 36 tool-вызовов/34 мин исследования). attempts>0 ⇔ это
 * retry: успех фазы сбрасывает счётчик в 0 (finishCurrentPhase).
 */

import type { Bot } from 'grammy';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
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
import { taskWorktreeDir } from '../core/worktree.js';
import { getAvailablePhases, getWorkflowForTask } from '../core/workflow.js';
import type { Workflow } from '../core/workflow.js';
import { agentSessionsDir, findTaskPhaseSessionSync, loadSessionMetaSync } from '../agent/session.js';
import { loadBotSettings, resolveDefaultAgent } from './settings.js';
import { startTaskPhase } from '../web/orchestrator.js';
import type { PhaseExitCallback, PhaseRun } from '../web/orchestrator.js';

/** true ⇔ auto-фаза сейчас активна (guard от параллельных тиков). */
let autoActive = false;
/** Пол-timer ожидания dep-блокированных pending; null — не запущен. */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Тестовый шов VL-200: подмена startTaskPhase (паттерн setSpawnEnvBaseForTests
 * VL-140). autoTick вызывает через шов — тест захватывает opts вызовов
 * (--resume retry-рана) без реального спавна. null → вернуть оригинал;
 * СБРАСЫВАТЬ в finally теста — isolate:false, шов утечёт в другие файлы.
 */
let startPhaseImpl = startTaskPhase;
export function setStartPhaseForTests(
  fn: ((...args: Parameters<typeof startTaskPhase>) => ReturnType<typeof startTaskPhase>) | null
): void {
  startPhaseImpl = fn ?? startTaskPhase;
}

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
 * extraArgs для retry-рана фазы: ['--resume', sessionId] либо [] (VL-200).
 *
 * Ищет последнюю сессию ЭТОЙ фазы (findTaskPhaseSessionSync — тот же
 * механизм, что у code_same_session, VL-147) ТОЛЬКО в каталоге главного
 * репо: в branch-mode агент пишет/читает сессии через VIBELOG_CWD=главный
 * cwd (cli.ts, инцидент VL-107 fix) — сессия, лежащая только в worktree
 * (legacy без VIBELOG_CWD), агенту недоступна, resume упал бы на
 * «Сессия не найдена» и сжёг бы попытки endless-retry'ем → fail-open:
 * новая сессия, поведение прежнее.
 *
 * Guard'ы передачи флага:
 * - jsonl существует рядом с meta (meta без транскрипта — resume бессилен);
 * - meta.cwd (VL-98, session.ts) указывает на главный cwd либо worktree
 *   ЭТОЙ задачи — сессия из чужого каталога не возобновляется, иначе
 *   правки уйдут не в ту копию кода (инцидент VL-98).
 *
 * @param cwd — рабочая директория проекта (главный репо)
 * @param taskId — ID задачи
 * @param phase — фаза, чью сессию возобновляем (spec/plan/code/…)
 * @returns ['--resume', sid] либо [] — пусто при любом непрохождении guard'ов
 */
export function retryResumeArgs(cwd: string, taskId: string, phase: string): string[] {
  const dir = agentSessionsDir(cwd);
  const sid = findTaskPhaseSessionSync(dir, taskId, phase);
  if (!sid) return [];
  if (!existsSync(join(dir, `${sid}.jsonl`))) {
    console.log(`[auto VL-200] сессия ${sid} фазы ${phase}: jsonl отсутствует — retry в новой сессии`);
    return [];
  }
  const meta = loadSessionMetaSync(dir, sid);
  if (meta?.cwd) {
    const real = (p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return p; // каталог исчез — сравниваем как есть
      }
    };
    const allowed = [real(cwd), real(taskWorktreeDir(cwd, taskId))];
    if (!allowed.includes(real(meta.cwd))) {
      console.log(
        `[auto VL-200] сессия ${sid} создана в чужом каталоге ${meta.cwd} (ожидалось ${allowed.join(' | ')}) — resume пропущен`
      );
      return [];
    }
  }
  return ['--resume', sid];
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
  reason: string,
  permanent = false
): void {
  // VL-228: failed_permanent — ретраев больше не будет (терминал), текст
  // должен это говорить, иначе «очередь засоряется»: провал неотличим от работы
  const tail = permanent
    ? `(статус failed_permanent, ретраи исчерпаны, причина: ${reason.slice(0, 300)})`
    : `(статус failed, причина: ${reason.slice(0, 300)})`;
  notifyAllChats(bot, cwd, `❌ Автоочередь: задача *${taskId}* — фаза ${phase} не удалась после ${attempts} поп. ${tail}`);
}

/**
 * Лог причины терминального провала в stderr (VL-228, AC1).
 *
 * Пишем в console.error, а не только в чат: бот может быть запущен без
 * привязанных чатов, а stderr остаётся у владельца в терминале/логе.
 * Ссылка на сессию агента обязательна — по ней видно, где копать контекст
 * (findTaskPhaseSessionSync — тот же поиск, что у retryResumeArgs).
 */
function logPermanentFailure(cwd: string, taskId: string, phase: string, attempts: number, max: number, reason: string): void {
  const sessionId = findTaskPhaseSessionSync(agentSessionsDir(cwd), taskId, phase);
  console.error(
    `[auto VL-228] ${taskId} → failed_permanent: фаза ${phase}, попыток ${attempts} из ${max}, ` +
      `причина: ${reason.slice(0, 300)}; сессия: ${sessionId ?? 'не найдена'}`
  );
}

/**
 * Обработка ошибки фазы: наращивает attempts, при исчерпании — failed +
 * уведомление. Элемент остаётся running при retry (tick продолжит задачу).
 *
 * VL-228: исчерпание ретраев ставит `failed_permanent` (а не `failed`) —
 * терминальный статус, который sweep не реанимирует, pick не выбирает и
 * /auto add не перетирает; причина пишется в `fail_reason` и в stderr
 * вместе со ссылкой на сессию агента.
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
  if (!fresh || fresh.status === 'done' || fresh.status === 'failed_permanent') return;
  const attempts = (fresh.attempts ?? 0) + 1;
  const max = queue.max_retries ?? 1;
  if (nextFailureAction(attempts, max) === 'retry') {
    fresh.attempts = attempts;
    saveAutoQueue(cwd, queue);
    return;
  }
  const permanentReason = `${reason.slice(0, 300)}; attempts=${attempts}/max=${max}`;
  fresh.status = 'failed_permanent';
  fresh.attempts = attempts;
  fresh.fail_reason = permanentReason;
  saveAutoQueue(cwd, queue);
  logPermanentFailure(cwd, item.id, phase, attempts, max, reason);
  notifyAutoFailure(bot, cwd, item.id, phase, attempts, permanentReason, true);
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
    // sweep уже пометил бы failed; страховка — не должно доходить.
    // VL-228: задача исчезла — фазы не будет никогда → терминальный статус
    const reason = 'задача не найдена в backlog';
    updateQueueTask(cwd, item.id, { status: 'failed_permanent', fail_reason: reason });
    logPermanentFailure(cwd, item.id, '—', item.attempts ?? 0, queue.max_retries ?? 1, reason);
    setImmediate(() => autoTick(bot, cwd));
    return;
  }
  const workflow = getWorkflowForTask(cwd, task);
  const phase = pickAutoPhase(workflow, task.status);
  if (!phase) {
    // Нет не-reject фазы и не терминальный статус (иначе sweep) — авто
    // не может двигать задачу: терминальный failed_permanent + уведомление,
    // очередь продолжается. Фаза из статуса не определится и позже → ретрай
    // бессмыслен (VL-228).
    const reason = `нет фазы из статуса ${task.status}`;
    updateQueueTask(cwd, item.id, { status: 'failed_permanent', fail_reason: reason });
    logPermanentFailure(cwd, item.id, '—', item.attempts ?? 0, queue.max_retries ?? 1, reason);
    notifyAutoFailure(bot, cwd, item.id, '—', item.attempts ?? 0, reason, true);
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
  // VL-200: retry (attempts>0 — успех фазы сбрасывает счётчик в 0) продолжает
  // последнюю сессию ЭТОЙ фазы через --resume; первая попытка — новая сессия.
  // attempts/max_retries не затронуты — меняются только extraArgs спавна.
  const isRetry = (item.attempts ?? 0) > 0;
  const extraArgs = isRetry ? retryResumeArgs(cwd, item.id, phase) : [];
  const result = startPhaseImpl(cwd, item.id, phase, {
    onExit,
    agent: resolveDefaultAgent(cwd),
    extraArgs,
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
