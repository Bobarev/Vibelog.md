/**
 * Workflow с явными переходами «статус → фаза → статус» (VL-188).
 *
 * Единственный источник истины для кнопок фаз бота/веба, валидации
 * переносов на канбан-доске (PATCH /api/tasks/:id) и проверки
 * isPhaseAllowed в оркестраторе. Раньше цепочка spec → plan → code → close
 * была захардкожена в nextPhaseForStatus (core/phase-buttons.ts) и шаблонах
 * фаз — нельзя было пропустить Spec (bugfix), сделать do вместо spec+plan
 * (chore/docs) или ветвить (To Do → spec ИЛИ reject).
 *
 * Конфигурация хранится в .vibelog/settings.json (VL-143, общий файл
 * настроек): ключи workflows (имя → Workflow) и task_workflows
 * (тип задачи → имя workflow). Формат:
 *
 *   "workflows": {
 *     "default": {
 *       "initial_status": "To Do",
 *       "transitions": [
 *         { "status": "To Do", "phase": "spec", "produces_status": "Spec" },
 *         { "status": "Done", "phase": null, "produces_status": null }
 *       ]
 *     }
 *   },
 *   "task_workflows": { "bug": "bugfix", "chore": "simple" }
 *
 * Fallback: нет ключей / битый файл / неизвестное имя → DEFAULT_WORKFLOW
 * (прежняя цепочка spec → plan → code → close + reject) — поведение до
 * VL-188 не меняется.
 *
 * Модуль намеренно импортирует только settings.js (fs) — веб-клиент НЕ
 * импортирует его напрямую (Vite не потянет node:fs): фазы приходят в
 * ответах API (availablePhases/triggerPhase), логика считается на сервере.
 */

import { loadSettings } from './settings.js';
import type { Task } from './task.js';

/**
 * Переход workflow: из status фазой phase получается produces_status.
 * phase = null → финальный статус (Done/Rejected), исходящих фаз нет.
 */
export interface Transition {
  /** Текущий статус (источник перехода). */
  status: string;
  /** Фаза, запускающаяся из статуса; null — финальный статус без фаз. */
  phase: string | null;
  /** Статус задачи после успешного завершения фазы; null — не меняется. */
  produces_status: string | null;
}

/** Именованный workflow: стартовый статус + граф переходов. */
export interface Workflow {
  /** Статус, в который попадает задача при ручном «взятии в работу». */
  initial_status: string;
  /** Граф переходов; статус может иметь 0..N исходящих фаз (ветвление). */
  transitions: Transition[];
}

/** Конфигурация workflow проекта (секции settings.json). */
export interface WorkflowConfig {
  /** Имя → workflow; отсутствует 'default' → подставляется DEFAULT_WORKFLOW. */
  workflows: Record<string, Workflow>;
  /** Тип задачи → имя workflow; неизвестный тип → 'default'. */
  task_workflows: Record<string, string>;
}

/**
 * Workflow по умолчанию — цепочка до VL-188 (spec → plan → code → close)
 * плюс ветвление reject и fix-цикл Review → code.
 *
 * Добавлен переход In Progress → code: статус входит в дефолтный список
 * config.ts и поддерживался прежним nextPhaseForStatus — без него задачи
 * в In Progress потеряли бы кнопку фазы (регрессия).
 *
 * Done/Rejected — финалы (phase null), исходящих переходов нет.
 */
export const DEFAULT_WORKFLOW: Workflow = {
  initial_status: 'To Do',
  transitions: [
    { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
    { status: 'To Do', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Spec', phase: 'plan', produces_status: 'Planned' },
    { status: 'Spec', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Planned', phase: 'code', produces_status: 'Review' },
    { status: 'Planned', phase: 'reject', produces_status: 'Rejected' },
    { status: 'In Progress', phase: 'code', produces_status: 'Review' },
    // reject из In Progress: rejectTask запускает LLM-reject для задач,
    // бывших в Code (wasInCode = In Progress|Review) — без этого перехода
    // откат начатых изменений из In Progress блокировался бы (VL-144)
    { status: 'In Progress', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Review', phase: 'close', produces_status: 'Done' },
    { status: 'Review', phase: 'code', produces_status: 'Review' },
    { status: 'Review', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Done', phase: null, produces_status: null },
    { status: 'Rejected', phase: null, produces_status: null },
  ],
};

/** Служебные фазы вне workflow: не проверяются isPhaseAllowed, статуса не меняют. */
export const SERVICE_PHASES: readonly string[] = ['comment', 'prompt', 'analyze', 'resume'];

/**
 * Проверяет, что запись из settings.json — валидный Workflow.
 *
 * Нестрогая валидация (только обязательные поля и типы): битая секция
 * workflows не должна ронять бота/веб — просто выпадает в fallback,
 * как loadSettings при битом JSON.
 */
function isValidWorkflow(value: unknown): value is Workflow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const wf = value as Partial<Workflow>;
  if (typeof wf.initial_status !== 'string' || wf.initial_status === '') return false;
  if (!Array.isArray(wf.transitions)) return false;
  return wf.transitions.every((t) => {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) return false;
    const tr = t as Partial<Transition>;
    return (
      typeof tr.status === 'string' &&
      (tr.phase === null || typeof tr.phase === 'string') &&
      (tr.produces_status === null || typeof tr.produces_status === 'string')
    );
  });
}

/**
 * Читает конфигурацию workflow из .vibelog/settings.json.
 *
 * Отсутствие файла/ключей, битый JSON, невалидные записи → fallback:
 * { workflows: { default: DEFAULT_WORKFLOW }, task_workflows: {} }.
 * Частичная валидность сохраняется: валидные именованные workflow остаются,
 * битые выпадают; ключ 'default', если невалиден — заменяется DEFAULT_WORKFLOW.
 */
export function loadWorkflows(cwd: string): WorkflowConfig {
  const settings = loadSettings(cwd);
  const rawWorkflows = settings.workflows;
  const rawTaskMap = settings.task_workflows;

  const workflows: Record<string, Workflow> = {};
  if (rawWorkflows !== null && typeof rawWorkflows === 'object' && !Array.isArray(rawWorkflows)) {
    for (const [name, value] of Object.entries(rawWorkflows as Record<string, unknown>)) {
      if (isValidWorkflow(value)) workflows[name] = value;
    }
  }
  if (!isValidWorkflow(workflows.default)) workflows.default = DEFAULT_WORKFLOW;

  const taskWorkflows: Record<string, string> = {};
  if (rawTaskMap !== null && typeof rawTaskMap === 'object' && !Array.isArray(rawTaskMap)) {
    for (const [type, name] of Object.entries(rawTaskMap as Record<string, unknown>)) {
      if (typeof name === 'string' && name !== '') taskWorkflows[type] = name;
    }
  }

  return { workflows, task_workflows: taskWorkflows };
}

/**
 * Имя workflow для задачи: task_workflows[type] → 'default' при отсутствии.
 *
 * @param task — задача; пустой/неизвестный тип → 'default'
 */
export function getWorkflowName(cwd: string, task: Task): string {
  const config = loadWorkflows(cwd);
  const type = (task.type ?? '').toLowerCase();
  const name = config.task_workflows[type];
  return name !== undefined && config.workflows[name] !== undefined ? name : 'default';
}

/**
 * Workflow задачи: по имени из task_workflows, иначе DEFAULT_WORKFLOW.
 *
 * Неизвестное имя в task_workflows (имя удалено из settings.json) →
 * тоже default: задача не должна остаться без workflow.
 */
export function getWorkflowForTask(cwd: string, task: Task): Workflow {
  const config = loadWorkflows(cwd);
  const type = (task.type ?? '').toLowerCase();
  const name = config.task_workflows[type];
  return (name !== undefined ? config.workflows[name] : undefined) ?? config.workflows.default;
}

/**
 * Фазы, доступные из текущего статуса (для кнопок бота/веба).
 *
 * Порядок — как в transitions (первый переход ветки — первичное действие).
 * Финальные статусы (phase null) и неизвестные статусы → [].
 *
 * @returns имена фаз (без reject-исключений — reject тоже обычная фаза ветки)
 */
export function getAvailablePhases(workflow: Workflow, currentStatus: string): string[] {
  return workflow.transitions
    .filter((t) => t.status === currentStatus && t.phase !== null)
    .map((t) => t.phase as string);
}

/**
 * Следующая фаза для кнопки «следующий этап»: первая не-reject ветка
 * (reject — запасной/опасный путь, его рендерит отдельная кнопка),
 * если из статуса только reject — он и есть следующий; фаз нет → null.
 *
 * @param currentStatus — текущий статус задачи
 */
export function getNextPhase(workflow: Workflow, currentStatus: string): string | null {
  const phases = getAvailablePhases(workflow, currentStatus);
  return phases.find((p) => p !== 'reject') ?? phases[0] ?? null;
}

/**
 * Статус задачи после успешного завершения фазы из текущего статуса
 * (подстановка {{producesStatus}} в промпт фазы — шаблоны без хардкода).
 *
 * @returns produces_status перехода; переход не найден → null
 *   (вызывающий обязан сначала проверить isPhaseAllowed)
 */
export function getStatusAfterPhase(
  workflow: Workflow,
  currentStatus: string,
  phase: string
): string | null {
  const t = workflow.transitions.find((x) => x.status === currentStatus && x.phase === phase);
  return t ? t.produces_status : null;
}

/**
 * Разрешена ли фаза из текущего статуса по workflow.
 *
 * Служебные фазы (comment/prompt/analyze/resume) всегда разрешены —
 * они не участвуют в переходах статуса (комментарий уместен из любого
 * статуса, prompt/analyze вообще не привязаны к задаче).
 */
export function isPhaseAllowed(workflow: Workflow, currentStatus: string, phase: string): boolean {
  if (SERVICE_PHASES.includes(phase)) return true;
  return workflow.transitions.some((t) => t.status === currentStatus && t.phase === phase);
}

/**
 * Разрешён ли ручной перенос статуса (канбан-доска, /move, «Взять в работу»).
 *
 * Правила:
 * 1. Транзит: существует переход из from с produces_status = to
 *    (в т.ч. фазовый перенос «задача переместилась в колонку produced»).
 * 2. Ручной вход: to === initial_status, а from — «до-workflow» статус:
 *    в from нет исходящих транзишенов И from не является produces_status
 *    ни одного перехода (Backlog → To Do: «взять в работу», не фаза).
 *    Второе условие закрывает финалы: Done/Rejected тоже без исходящих,
 *    но они достижимы переходами — из них ручной вход запрещён.
 * 3. Нет смены: from === to (повторный бросок в ту же колонку).
 */
export function canMoveTo(workflow: Workflow, from: string, to: string): boolean {
  if (from === to) return true;
  if (workflow.transitions.some((t) => t.status === from && t.produces_status === to)) return true;
  const hasOutgoing = workflow.transitions.some((t) => t.status === from && t.phase !== null);
  if (hasOutgoing) return false;
  const isWorkflowStatus = workflow.transitions.some((t) => t.produces_status === from);
  return !isWorkflowStatus && to === workflow.initial_status;
}
