/**
 * Авто-отчёт фазы в пост-ране CLI (VL-304).
 *
 * Проблема, которую модуль решает: `buildAutoReport` (VL-253) срабатывал
 * только ВНУТРИ вызова `backlog_finish_phase`. Если модель до него не дошла
 * (ран завершился повтором уже применённого вызова, лимитом или просто
 * финальным текстом), отчёта не было вовсе: статус не двигался, AC/DoD
 * оставались висеть (наблюдаемо на VL-302 — осталась в To Do, и на VL-303 —
 * Review с неотмеченными AC4/DoD).
 *
 * Точку «ран закончился» знает только CLI (MCP-сервер о ней не знает), поэтому
 * авто-отчёт живёт здесь. Формат отчёта — общий с MCP-путём
 * (`src/mcp/auto-report.ts`), иначе два пути разъезжаются.
 *
 * Что НЕ делается: AC/DoD не отмечаются автоматически. Авто-отметка была бы
 * ложным заявлением о выполненной работе (дух lesson-140/VL-248: терминальный
 * статус при невыполненном DoD отклоняется). Вместо этого отчёт перечисляет
 * неотмеченные пункты по номерам — они не «висят молча».
 */

import { addComment, getTask, updateTaskFile } from '../core/store.js';
import { getStatusAfterPhase, getWorkflowForTask, SERVICE_PHASES, terminalStatusGateForTask } from '../core/workflow.js';
import type { TerminalStatusGateResult } from '../core/workflow.js';
import { getPhaseTransientStatus } from '../core/phase-transient.js';
import { buildAutoReport, uncheckedItems } from '../mcp/auto-report.js';

/** Параметры авто-отчёта пост-рана. */
export interface AutoReportOptions {
  /** Директория проекта (backlog/ ищется от неё). */
  cwd: string;
  /** Директория задачи (worktree задачи в параллельном режиме). */
  taskCwd: string;
  /** ID задачи рана. */
  taskId: string;
  /** Фаза рана (VIBELOG_RUN_PHASE → VIBELOG_PHASE_NAME → фаза сессии). */
  phase: string;
  /** Начало рана (ISO) — граница «отчёт уже писался в этом ране». */
  runStartedAt: string;
  /** Упал ли ран: упавший ран отчитывается через recordRunProgress. */
  isError: boolean;
}

/**
 * Форматирует дату комментария задачи так же, как `addComment` в store.ts
 * (`YYYY-MM-DD HH:MM`, локальное время).
 *
 * Сравнивать ISO-строку `runStartedAt` с `created` напрямую нельзя: форматы
 * разные, и лексикографическое сравнение дало бы ложный результат.
 */
function commentStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Пишет авто-отчёт фазы, если модель не вызвала `backlog_finish_phase`.
 *
 * Пропуски (все — молча, без ошибок):
 * - ран упал (`isError`) — у него свой отчёт через `recordRunProgress`;
 * - фаза служебная (`SERVICE_PHASES`) — статус не двигает и отчёта не требует;
 * - задачи нет;
 * - отчёт уже есть: последний комментарий `@agent` создан не раньше начала
 *   рана (значит `backlog_finish_phase` или `recordRunProgress` уже писали).
 *
 * @returns true, если отчёт записан
 */
export function writeAutoReportIfMissing(opts: AutoReportOptions): boolean {
  const { cwd, taskCwd, taskId, phase, runStartedAt, isError } = opts;
  if (isError) return false;
  if (!phase || SERVICE_PHASES.includes(phase)) return false;
  try {
    const task = getTask(taskCwd, taskId);
    if (!task) return false;

    // Guard от дубля: отчёт этого рана уже записан (finish_phase/прогресс).
    const startedAt = new Date(runStartedAt);
    const startedStamp = Number.isNaN(startedAt.getTime()) ? null : commentStamp(startedAt);
    const lastAgent = [...(task.comments || [])]
      .reverse()
      .find((c) => c.author === '@agent');
    if (startedStamp !== null && lastAgent && lastAgent.created >= startedStamp) return false;

    // Целевой статус: переход «исходный статус + фаза». Исходный берём из
    // транзиент-кэша (VL-196 временно держит задачу в In Progress), иначе —
    // текущий статус задачи.
    const prevStatus = getPhaseTransientStatus(cwd, taskId, phase) ?? task.status;
    const workflow = getWorkflowForTask(cwd, task);
    const nextStatus = getStatusAfterPhase(workflow, prevStatus, phase);

    const acList = task.acceptanceCriteria || [];
    const dodList = task.definitionOfDone || [];
    // Локальный предикат остаётся только для СТАТИСТИКИ отчёта (сколько
    // отмечено из скольких); само правило блокировки считает
    // `terminalStatusGateForTask` — второго экземпляра правила нет (VL-370).
    const isChecked = (c: string | { checked?: boolean }): boolean =>
      typeof c === 'string' ? false : c.checked === true;

    // VL-309/VL-368/VL-370: терминальный статус при неполноте не ставится.
    // Правило VL-248 («Done при невыполненном DoD требует явного
    // dodOverride/aborted») живёт внутри backlog_finish_phase, а этот путь его
    // обходил: Close VL-307 получил Done с неотмеченными AC5/DoD2.
    // VL-370: расчёт неполноты — ОДИН источник (`terminalStatusGateForTask`:
    // workflow задачи + фаза + состояние сущности). Локальная копия списка
    // неотмеченных пунктов удалена — второй экземпляр правила неизбежно
    // разъезжается с первым (lesson-250).
    //
    // VL-372: гейт считается ДО сборки отчёта — строке `Статус:` нужен
    // ФАКТИЧЕСКИЙ статус. До этой правки в отчёт попадал целевой статус, а
    // фактический был виден только в дописанной причине: один комментарий
    // содержал и «Статус: Done», и «Задача оставлена в «Review»» (класс
    // VL-369: ответ инструмента врёт о состоянии).
    const targetStatus = nextStatus ?? task.status;
    // Гейт применяется только при валидном переходе (nextStatus !== null):
    // без перехода статус и так не меняется, и лишняя строка в отчёте врала бы.
    const gate: TerminalStatusGateResult =
      nextStatus === null
        ? { blocked: false }
        : terminalStatusGateForTask(cwd, task, targetStatus, phase, prevStatus);
    const terminalAtRisk = gate.blocked;
    // ДО VL-372 переменная была мёртвой (объявлялась и присваивалась, но не
    // читалась — смена статуса шла по `!terminalAtRisk`). Теперь она —
    // источник строки `Статус:` в отчёте и по-прежнему отражает то, что реально
    // произойдёт с задачей.
    const effectiveStatus = terminalAtRisk ? prevStatus : targetStatus;

    let report = buildAutoReport(task, {
      status: effectiveStatus,
      blockedTarget: terminalAtRisk ? targetStatus : undefined,
      acChecked: acList.filter(isChecked).length,
      acTotal: acList.length,
      dodChecked: dodList.filter(isChecked).length,
      dodTotal: dodList.length,
      files: task.modified_files || [],
      uncheckedAc: uncheckedItems(acList),
      uncheckedDod: uncheckedItems(dodList),
    });
    // Причина блокировки остаётся отдельной строкой: она несёт номера
    // неотмеченных пунктов и указание на dodOverride/aborted, которых в строке
    // статуса нет.
    if (terminalAtRisk) report += `\n${gate.reason ?? ''}`;

    addComment(taskCwd, taskId, report, '@agent');
    // Статус двигаем только при валидном переходе и только если задача ещё
    // не зафиксирована агентом (иначе перетёрли бы его решение).
    if (nextStatus && nextStatus !== task.status && task.status === prevStatus && !terminalAtRisk) {
      updateTaskFile(taskCwd, taskId, { status: nextStatus });
    }
    console.error(`[vibelog-agent] авто-отчёт фазы ${phase} записан в ${taskId} (VL-304)`);
    return true;
  } catch (err) {
    // Авто-отчёт — вспомогательный шаг: его сбой не должен менять исход рана
    console.error(`Предупреждение: авто-отчёт фазы не записан — ${(err as Error).message}`);
    return false;
  }
}
