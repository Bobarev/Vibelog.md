/**
 * Transient In Progress: статус задачи на время выполнения workflow-фазы (VL-196).
 *
 * Семантика (Спека VL-196, ревью плана VL-195):
 * - запуск фазы → задача временно переходит в In Progress (видно на канбане);
 * - фаза успешно завершилась → применяется produces_status workflow, посчитанный
 *   от ИСХОДНОГО статуса (но только если агент сам не зафиксировал статус через
 *   backlog_finish_phase — тогда его запись приоритетна);
 * - фаза провалилась → откат к статусу, с которого стартовала, + комментарий
 *   с причиной (иначе авто-retry воркфлоу из In Progress теряет исходную фазу);
 * - рестарт процесса → recoverStalePhaseStatuses откатывает «зависшие» In Progress
 *   по кэшу с pid-проверкой (AC3: задача не может навсегда застрять в In Progress).
 *
 * «Статус до фазы» хранится НЕ в frontmatter задачи (совместимость с Backlog.md,
 * ref-1), а в кэше .vibelog/phase-in-progress.json (весь .vibelog/ gitignored):
 * файл межпроцессный (веб и бот живут в разных процессах) и переживает рестарт.
 * Frontmatter-совместимость + кэш — решение Спеки VL-196.
 *
 * Инвариант: запись в кэше ⇔ статус задачи In Progress (ставим кэш ПЕРВЫМ,
 * затем статус; при сбое записи статуса запись кэша откатывается — fail-open,
 * фаза продолжается без транзиента).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addComment, getTask, updateTaskFile } from './store.js';
import { getStatusAfterPhase, getWorkflowForTask, SERVICE_PHASES } from './workflow.js';
import { taskIdPattern } from './config.js';

/**
 * Запись кэша: «статус до фазы» для одной задачи.
 * Ключ — канонический ID задачи (UPPER-регистр, как activeRuns, VL-145).
 */
export interface PhaseTransientEntry {
  /** Статус задачи до старта фазы — куда откатывать при провале. */
  prevStatus: string;
  /** Фаза, для которой записана (для комментариев recovery). */
  phase: string;
  /** pid процесса фазы: жив → запись не трогаем (фаза ещё идёт). */
  pid?: number;
  /** ISO-время старта (диагностика; не участвует в логике). */
  startedAt: string;
  /**
   * Фаза завершилась АВАРИЙНО: агент прислал `aborted: true` в
   * backlog_finish_phase (VL-244). Признак переживает границу процессов —
   * MCP-сервер и оркестратор разные процессы, поэтому единственный общий
   * носитель сигнала — этот кэш. Флаг отменяет применение produces_status:
   * даже exitCode 0 уходит в fail-ветку (иначе Review → close → Done
   * ставится незавершённой задаче, инцидент VL-219).
   */
  aborted?: boolean;
  /** Причина аварии для комментария-причины (текст отчёта агента, обрезка 500). */
  abortedReason?: string;
}

/** Кэш-файл проекта: { "VL-196": PhaseTransientEntry, ... }. */
function cachePath(cwd: string): string {
  return join(cwd, '.vibelog', 'phase-in-progress.json');
}

/** Читает кэш; отсутствующий/битый файл → пустой объект (fail-open). */
function readCache(cwd: string): Record<string, PhaseTransientEntry> {
  const path = cachePath(cwd);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, PhaseTransientEntry>)
      : {};
  } catch (err) {
    // Битый кэш не должен ронять фазу: логируем и работаем с пустым
    console.log(`[phase-transient] кэш ${path} не читается: ${(err as Error).message}`);
    return {};
  }
}

/** Записывает кэш (создаёт .vibelog/); исключение пробрасывается вызывающему. */
function writeCache(cwd: string, cache: Record<string, PhaseTransientEntry>): void {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(cachePath(cwd), JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Жив ли pid процесса фазы.
 *
 * process.kill(pid, 0): ESRCH → мёртв; EPERM → жив (чужой процесс);
 * прочие ошибки считаем мёртвым (безопасный откат). pid не задан
 * (спавн не дал pid) → мёртв: запись подлежит recovery.
 */
function isPidAlive(pid?: number): boolean {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Участвует ли фаза в транзиентном In Progress.
 *
 * Условия (решения Спеки/плана VL-196):
 * 1. только задачные ключи (prompt/analyze/resume живут по своим ключам);
 * 2. не SERVICE_PHASES (comment/prompt/analyze/resume статуса не меняют —
 *    иначе Done-задача мигала бы в In Progress на каждый комментарий);
 * 3. у исходного статуса есть переход фазы (getStatusAfterPhase !== null) —
 *    т.е. фаза реально участвует в workflow, как и проверяет isPhaseAllowed.
 *
 * @param cwd — директория проекта
 * @param taskKey — ключ запуска (для задач — ID вида VL-N)
 * @param phase — имя фазы
 */
export function isTransientEligible(cwd: string, taskKey: string, phase: string): boolean {
  if (!taskIdPattern(cwd).test(taskKey)) return false;
  if (SERVICE_PHASES.includes(phase)) return false;
  const task = getTask(cwd, taskKey);
  if (!task) return false;
  const workflow = getWorkflowForTask(cwd, task);
  return getStatusAfterPhase(workflow, task.status, phase) !== null;
}

/**
 * Ставит транзиентный In Progress после успешного спавна фазы.
 *
 * Порядок (инвариант «запись в кэше ⇒ In Progress»):
 * 1. eligibility (служебные фазы/чужие ключи — выход без изменений);
 * 2. recovery чужих зависших записей (оппортунистическая очистка AC3:
 *    мёртвый pid → откат чужой задачи, чтобы её запись не ждала рестарта);
 * 3. перечитываем задачу (после recovery её статус мог измениться!) и
 *    пишем СВОЮ запись в кэш (merge — записи других процессов не затираем);
 * 4. updateTaskFile(status: 'In Progress'); при сбое — убираем свою запись
 *    из кэша и логируем: фаза идёт без транзиента, статус не «зависает».
 *
 * Вызывается из spawnQwenRun ПОСЛЕ activeRuns.set: все гарды до спавна
 * (activeRuns, валидация startPhase, worktree) уже прошли — при ошибке
 * запуска транзиент не ставится и откат ретраям не нужен.
 *
 * @param cwd — директория проекта (главный репо; в worktree фазы backlog живёт здесь)
 * @param taskKey — канонический ключ задачи (UPPER)
 * @param phase — имя фазы
 * @param pid — pid процесса фазы (для recovery после рестарта)
 */
export function markPhaseStarted(cwd: string, taskKey: string, phase: string, pid?: number): void {
  try {
    if (!taskIdPattern(cwd).test(taskKey) || SERVICE_PHASES.includes(phase)) return;
    // Оппортунистическая очистка: чужие записи с мёртвым pid откатываем
    // сразу, не дожидаясь рестарта процесса (AC3)
    recoverStalePhaseStatuses(cwd);
    const task = getTask(cwd, taskKey);
    if (!task) return;
    const workflow = getWorkflowForTask(cwd, task);
    if (getStatusAfterPhase(workflow, task.status, phase) === null) return;
    const cache = readCache(cwd);
    cache[taskKey] = {
      prevStatus: task.status,
      phase,
      pid,
      startedAt: new Date().toISOString(),
    };
    // Кэш ПЕРВЫМ: если статус записать не удалось — запись убираем (ниже),
    // иначе остался бы кэш без In Progress (ложный откат при recovery)
    writeCache(cwd, cache);
    try {
      updateTaskFile(cwd, taskKey, { status: 'In Progress' });
    } catch (err) {
      removeEntry(cwd, taskKey);
      console.log(
        `[phase-transient] статус In Progress для ${taskKey} не записан — фаза продолжается без транзиента: ${(err as Error).message}`
      );
    }
  } catch (err) {
    // Fail-open: транзиент — косметика канбана, не должна ронять спавн фазы
    console.log(`[phase-transient] markPhaseStarted(${taskKey}) не удался: ${(err as Error).message}`);
  }
}

/** Убирает запись задачи из кэша (без изменения статуса); ошибки глотает. */
function removeEntry(cwd: string, taskKey: string): void {
  try {
    const cache = readCache(cwd);
    if (!(taskKey in cache)) return;
    delete cache[taskKey];
    writeCache(cwd, cache);
  } catch (err) {
    console.log(`[phase-transient] запись кэша для ${taskKey} не удалась: ${(err as Error).message}`);
  }
}

/**
 * Помечает текущую фазу задачи как АВАРИЙНО завершённую (VL-244).
 *
 * Зачем: агент может закончить фазу обычным текстом с кодом выхода 0 —
 * тогда finalizePhaseStatus применил бы produces_status (и поставил Done
 * незавершённой задаче, инцидент VL-219). Явный сигнал `aborted: true`
 * из backlog_finish_phase доезжает до оркестратора ТОЛЬКО через кэш
 * (MCP-сервер и оркестратор — разные процессы), поэтому пишем флаг сюда.
 *
 * Семантика:
 * - ключ нормализуется в UPPER: в кэше ключи канонические (markPhaseStarted
 *   получает key уже из оркестратора, VL-145), а MCP-инструмент получает
 *   raw `task.id`;
 * - записи нет (служебная фаза, транзиент не ставился) → no-op, false:
 *   отсутствие транзиента — не ошибка, ронять MCP-вызов нельзя (иначе
 *   модель зациклится на повторе, lesson-92);
 * - любые сбои записи глотаются с логом (fail-open как во всём модуле).
 *
 * @param cwd — директория проекта (та же, что у finalizePhaseStatus)
 * @param taskKey — ID задачи в любом регистре
 * @param reason — причина аварии (текст отчёта агента), обрезается до 500
 * @returns true, если флаг действительно записан в существующую запись кэша
 */
export function markPhaseAborted(cwd: string, taskKey: string, reason?: string): boolean {
  try {
    const key = taskKey.toUpperCase();
    const cache = readCache(cwd);
    const entry = cache[key];
    if (!entry) {
      // Транзиента нет — сигнал некуда писать; статус фазы и так не тронут
      return false;
    }
    entry.aborted = true;
    if (typeof reason === 'string' && reason.trim() !== '') {
      entry.abortedReason = reason.trim().slice(0, 500);
    }
    writeCache(cwd, cache);
    console.log(`[phase-transient] ${key}: фаза ${entry.phase} помечена прерванной (aborted)`);
    return true;
  } catch (err) {
    console.log(`[phase-transient] markPhaseAborted(${taskKey}) не удался: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Статус задачи ДО текущей фазы из транзиент-кэша (VL-245).
 *
 * Нужен границе MCP: во время рана задача временно в In Progress (VL-196),
 * а агент передаёт статус, посчитанный от ИСХОДНОГО статуса (шаблон
 * подставляет {{producesStatus}} до спавна). Без чтения кэша валидатор
 * перехода «текущий статус + фаза → запрошенный статус» видел бы
 * «In Progress + plan → Planned» и отклонял штатные раны.
 *
 * Возврат: prevStatus ТОЛЬКО если запись принадлежит этой же фазе — чужая
 * запись (другая фаза) не должна подменять базу проверки. Все сбои чтения
 * глотаются (readCache fail-open) → null: вызывающий проверит от
 * физического статуса задачи.
 *
 * @param cwd — директория проекта (главный репо: в worktree backlog там же)
 * @param taskKey — ID задачи в любом регистре (ключи кэша канонические UPPER)
 * @param phase — фаза вызывающего
 * @returns статус до фазы либо null, если записи нет/фаза не совпала
 */
export function getPhaseTransientStatus(cwd: string, taskKey: string, phase: string): string | null {
  try {
    const entry = readCache(cwd)[taskKey.toUpperCase()];
    if (!entry || entry.phase !== phase || typeof entry.prevStatus !== 'string') return null;
    return entry.prevStatus;
  } catch (err) {
    // Fail-open: кэш — вспомогательный источник, его сбой не должен менять
    // поведение инструмента (проверка продолжится от статуса задачи)
    console.log(`[phase-transient] getPhaseTransientStatus(${taskKey}) не удался: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Финализирует транзиентный статус ЗАВЕРШИВШЕЙСЯ фазы.
 *
 * Вызывается в finish() spawnQwenRun строго ДО onExit: авто-очередь
 * (проверка progressed по статусу) и rejectTask-onExit должны видеть уже
 * финальный статус. Ветка авто-resume после high-risk (VL-178) делает
 * return ДО этой точки — на время повторного рана транзиент сохраняется.
 *
 * Ветки (AC2):
 * - записи нет (служебная фаза/транзиент не ставился) → выход;
 * - статус уже не In Progress → агент сам зафиксировал итог
 *   (backlog_finish_phase/rejectTaskFile) → не перетираем, только чистим кэш;
 * - успех (exitCode 0, не is_error и НЕ aborted — VL-244) → produces_status
 *   от исходного статуса (fallback — сам исходный, если перехода вдруг нет);
 * - провал (в т.ч. при exitCode 0, если агент прислал aborted: true) →
 *   откат к исходному статусу + комментарий-причина (@agent).
 *
 * @param record — финальный PhaseRun (exitCode/result/logTail)
 */
export function finalizePhaseStatus(
  cwd: string,
  taskKey: string,
  phase: string,
  record: { exitCode?: number | null; result?: { is_error?: boolean } | null; logTail?: string }
): void {
  try {
    const cache = readCache(cwd);
    const entry = cache[taskKey];
    if (!entry) return;
    delete cache[taskKey];
    writeCache(cwd, cache);
    const task = getTask(cwd, taskKey);
    if (!task) return;
    if (task.status !== 'In Progress') return; // итог зафиксирован агентом
    const phaseName = entry.phase || phase;
    // VL-244: явный aborted-флаг агента сильнее кода выхода — «обычный текст
    // с exit 0» больше не означает «фаза выполнена»
    const aborted = entry.aborted === true;
    if (!aborted && record.exitCode === 0 && record.result?.is_error !== true) {
      const workflow = getWorkflowForTask(cwd, task);
      const next = getStatusAfterPhase(workflow, entry.prevStatus, phaseName) ?? entry.prevStatus;
      updateTaskFile(cwd, taskKey, { status: next });
      console.log(
        `[phase-transient] ${taskKey}: фаза ${phaseName} завершилась — статус ${entry.prevStatus} → ${next}`
      );
    } else {
      // Причина: либо явный aborted-флаг (с текстом отчёта агента), либо
      // код выхода + хвост лога. Fallback по тексту лога («не завершена»)
      // НЕ используется как критерий — только диагностика (VL-244).
      const reason = aborted
        ? `Фаза ${phaseName} прервана агентом (aborted)${entry.abortedReason ? `: ${entry.abortedReason}` : ''} — статус возвращён к ${entry.prevStatus}.`
        : `Фаза ${phaseName} не удалась (код выхода ${record.exitCode ?? '—'})${record.logTail ? `: ${record.logTail.slice(-200)}` : ''} — статус возвращён к ${entry.prevStatus}.`;
      updateTaskFile(cwd, taskKey, { status: entry.prevStatus });
      addComment(cwd, taskKey, reason, '@agent');
      console.log(
        `[phase-transient] ${taskKey}: фаза ${phaseName} ${aborted ? 'прервана агентом (aborted)' : 'провалена'} — статус откачен к ${entry.prevStatus}`
      );
    }
  } catch (err) {
    // Финализация не должна ронять finish()/onExit — логируем и продолжаем
    console.log(`[phase-transient] finalizePhaseStatus(${taskKey}) не удался: ${(err as Error).message}`);
  }
}

/**
 * Recovery «зависших» транзиентов после рестарта процесса (AC3).
 *
 * Для каждой записи кэша: pid жив → пропустить (фаза ещё идёт, возможно,
 * в другом процессе; орфан после рестарта хозяина доработает сам и сам
 * зафиксирует статус через MCP). Мёртвый/отсутствующий pid → задача в
 * In Progress: откат к prevStatus + комментарий-причина; запись убрать.
 * Задача не найдена или статус уже другой → просто убрать запись.
 *
 * Вызывается на старте долгоживущих процессов (startWebServer, runBot)
 * и оппортунистически из markPhaseStarted. Все ошибки глотаются с логом —
 * recovery не должен мешать подъёму процесса.
 *
 * @param cwd — директория проекта
 */
export function recoverStalePhaseStatuses(cwd: string): void {
  try {
    const cache = readCache(cwd);
    const keys = Object.keys(cache);
    if (keys.length === 0) return;
    let changed = false;
    for (const key of keys) {
      const entry = cache[key];
      if (isPidAlive(entry?.pid)) continue; // фаза ещё выполняется
      delete cache[key];
      changed = true;
      const task = getTask(cwd, key);
      // Задача удалена/в архиве не нашлась либо итог уже зафиксирован —
      // запись просто чистим, статус не трогаем
      if (!task || task.status !== 'In Progress') continue;
      updateTaskFile(cwd, key, { status: entry.prevStatus });
      addComment(
        cwd,
        key,
        `Фаза ${entry.phase} прервана остановкой процесса — статус возвращён к ${entry.prevStatus}.`,
        '@agent'
      );
      console.log(
        `[phase-transient] recovery ${key}: фаза ${entry.phase} прервана (pid ${entry.pid ?? '—'} мёртв) — статус откачен к ${entry.prevStatus}`
      );
    }
    if (changed) writeCache(cwd, cache);
  } catch (err) {
    console.log(`[phase-transient] recoverStalePhaseStatuses не удалась: ${(err as Error).message}`);
  }
}

/** Экспорт для тестов: путь кэш-файла. */
export function phaseTransientCachePath(cwd: string): string {
  return cachePath(cwd);
}
