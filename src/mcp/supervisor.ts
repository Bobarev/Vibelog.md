/**
 * MCP-инструменты супервизора (VL-268, doc-19 §11).
 *
 * Четыре инструмента, дающих чату управлять фазами и очередью:
 * - `backlog_trigger_phase` — запуск фазы задачи (startTaskPhase);
 * - `backlog_phase_status` — состояние запуска + метрика повторов;
 * - `backlog_auto_queue` — автоочередь `.vibelog/auto-queue.json`;
 * - `backlog_supervisor` — прогон (план/старт/стоп/статус) с grant'ом.
 *
 * Почему отдельный модуль, а не дополнение `tools.ts`: там уже 2200+ строк и
 * десятки инструментов backlog-домена; супервизор — отдельный домен (фазы,
 * прогоны, grant), и его правки не должны раздувать реестр. `src/mcp/tools.ts`
 * только подключает определения (`SUPERVISOR_TOOL_DEFS`) и маршрутизирует
 * вызовы (`handleSupervisorTool`).
 *
 * Контракт ответов: ошибки — `ackError` (JSON {ok:false,error}), успехи — тот
 * же JSON-снимок фактического результата (lesson-105: applied/поля из файла,
 * а не перечисление аргументов). Ни один путь не бросает исключений: ошибка
 * валидации — понятный текст, а не is_error-мусор в чате (AC3).
 */

import { addQueueTasks, formatAutoQueue, loadAutoQueue, setQueueRunning, sweepQueue, saveAutoQueue } from '../core/auto-queue.js';
import { getTask } from '../core/store.js';
import { getAvailablePhases, getNextPhase, getWorkflowForTask, isPhaseAllowed, SERVICE_PHASES } from '../core/workflow.js';
import { taskWorktreeDir } from '../core/worktree.js';
import {
  agentSessionsDir,
  analyzeToolRepeatsFromJsonlSync,
  findLatestTaskSessionSync,
  loadSessionMetaSync,
} from '../agent/session.js';
import { ackError, ackOk } from './tool-result.js';
import type { ToolDefinition, ToolArgs } from './tools.js';
import { countActiveRuns, getRun, startTaskPhase } from '../web/orchestrator.js';
import {
  DEFAULT_GRANT_TTL_HOURS,
  GRANTABLE_TOOLS,
  checkSupervisorGrant,
  computeExpiresAt,
  findActiveGrant,
  clearGrantDraft,
  latestGrantDraft,
  loadGrantDraft,
  sanitizeTools,
  taskIdsOfArgs,
} from '../web/supervisor-grant.js';
import {
  buildGrantPreview,
  buildSupervisorPlan,
  formatSupervisorPlan,
  loadSupervisorSettings,
  startSupervisorRun,
  stopSupervisorRun,
  supervisorRunStatus,
} from '../web/supervisor.js';

/** Фазы, которые нельзя стартовать через backlog_trigger_phase (свои точки входа). */
const PHASE_ENTRYPOINT_ERRORS: Record<string, string> = {
  prompt: 'Фаза prompt запускается через команду vibelog prompt, а не по задаче',
  analyze: 'Фаза analyze запускается без задачи (мета сессии) — используй CLI',
};

/**
 * Определения 4 инструментов супервизора для MCP-реестра.
 *
 * Описания — на русском и перечисляют допустимые ключи (lesson-102): модель
 * не должна гадать, какие поля понимает инструмент. `required` объявлены
 * явно (lesson-94: требование в description модель не выполняет).
 */
export const SUPERVISOR_TOOL_DEFS: ToolDefinition[] = [
  {
    name: 'backlog_trigger_phase',
    description:
      'Запустить фазу задачи (spec/plan/code/close/comment и др.) через оркестратор фаз. ' +
      'Параметры: id (обязательный — ID задачи, напр. VL-1), phase (фаза; не указана — первая допустимая по workflow из текущего статуса), ' +
      'comment (комментарий к запуску — как `/plan VL-1 текст`; пишется в задачу ДО старта и подставляется в промпт фазы), ' +
      'sameSession (boolean — для фазы code: продолжить plan-сессию, VL-147). ' +
      'ВНИМАНИЕ: вызов не идемпотентен — не повторяй его после таймаута, состояние смотри через backlog_phase_status. ' +
      'Возможные отказы (каждый отдельным текстом): задача не найдена; фаза не разрешена из текущего статуса; фаза уже идёт у этой задачи; ' +
      'превышен лимит параллельных фаз (настройка supervisor.max_parallel_phases); задача вне grant текущего прогона.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID задачи (например VL-268)' },
        phase: {
          type: 'string',
          description:
            'Фаза: spec, plan, code, close, comment, reject, do и др. по workflow проекта. ' +
            'Не указана — берётся первая допустимая из текущего статуса (getAvailablePhases, первая не-reject).',
        },
        comment: {
          type: 'string',
          description: 'Комментарий к запуску: пишется в задачу до старта и подставляется в промпт фазы ({{comment}})',
        },
        sameSession: {
          type: 'boolean',
          description: 'Для фазы code: продолжить plan-сессию агента (--resume, VL-147). Явное значение переопределяет настройку code_same_session',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'backlog_phase_status',
    description:
      'Состояние запуска фазы задачи: running, phase, pid, exitCode, logTail, result (разобранный вывод агента), ' +
      'repeat_stats (метрика повторных tool-вызовов сессии — диагностика зацикливания) и last_run.is_error (упал ли последний ран). ' +
      'Данные берутся из состояния оркестратора (getRun) и меты сессии агента, полный транскрипт не читается. ' +
      'Вызывай этот инструмент вместо повторного backlog_trigger_phase, если не знаешь, идёт ли фаза.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID задачи (например VL-268)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'backlog_auto_queue',
    description:
      'Управление автоочередью фаз (.vibelog/auto-queue.json) — то же, что команды бота /auto. ' +
      'action=add — добавить задачи (ids): уже pending/running и failed_permanent пропускаются, done/failed возвращаются в pending; ' +
      'action=start/stop — включить/остановить автопрогон (running); action=status — состояние очереди с причинами провалов.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'start', 'stop', 'status'],
          description: 'add — добавить задачи; start/stop — переключить автопрогон; status — показать очередь',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'ID задач для action=add (массив строк; JSON-строка массива тоже принимается)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'backlog_supervisor',
    description:
      'Управление прогоном супервизора (набор задач + grant доверия на прогон). ' +
      'action=plan — сухой прогон: показать состав, порядок, волны параллельности и обоснование, ничего не запуская; ' +
      'action=start — запустить прогон: ТРЕБУЕТ подтверждения пользователя (карточка с составом, инструментами и сроком); ' +
      'action=stop — остановить прогон и немедленно отозвать grant; action=status — состояние прогона (grant, задачи, фазы). ' +
      'Параметры: action (обязательный), ids (ID задач прогона), expiresInHours (срок grant в часах, по умолчанию 8), ' +
      'expiresAt (явный срок ISO 8601 — приоритетнее expiresInHours). ' +
      'Grant разрешает только инструменты backlog_trigger_phase/backlog_phase_status/backlog_auto_queue/backlog_supervisor/backlog_create_task ' +
      'и только для задач прогона; write_file и прочие файловые изменения всегда требуют подтверждения.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['plan', 'start', 'stop', 'status'],
          description: 'plan — сухой прогон; start — запустить (нужно подтверждение); stop — остановить и отозвать grant; status — состояние',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'ID задач прогона (для plan/start; JSON-строка массива тоже принимается)',
        },
        expiresInHours: {
          type: 'number',
          description: `Срок действия grant в часах (по умолчанию ${DEFAULT_GRANT_TTL_HOURS}, максимум 336)`,
        },
        expiresAt: {
          type: 'string',
          description: 'Явный срок действия grant (ISO 8601). Приоритетнее expiresInHours',
        },
      },
      required: ['action'],
    },
  },
];

/** Парсит ids: массив строк либо JSON-строка массива (lesson-35). */
function parseIds(raw: unknown): { ids: string[] } | { error: string } {
  if (raw === undefined || raw === null) return { ids: [] };
  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return { ids: [] };
    try {
      value = JSON.parse(trimmed);
    } catch {
      value = [trimmed];
    }
  }
  if (!Array.isArray(value)) return { error: 'ids должен быть массивом ID задач (или JSON-строкой массива)' };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      return { error: 'ids: ожидаются непустые строки-ID задач' };
    }
    ids.push(item.trim());
  }
  return { ids };
}

/** Значение строкового аргумента или '' (с trim). */
function str(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Маршрутизатор 4 инструментов супервизора.
 *
 * @returns JSON-строка ответа (никогда не бросает)
 */
export async function handleSupervisorTool(name: string, args: ToolArgs, cwd: string): Promise<string> {
  switch (name) {
    case 'backlog_trigger_phase':
      return toolTriggerPhase(args, cwd);
    case 'backlog_phase_status':
      return toolPhaseStatus(args, cwd);
    case 'backlog_auto_queue':
      return toolAutoQueue(args, cwd);
    case 'backlog_supervisor':
      return toolSupervisor(args, cwd);
    default:
      return ackError(`Неизвестный инструмент супервизора: ${name}`);
  }
}

/**
 * backlog_trigger_phase: запуск фазы.
 *
 * Порядок проверок (каждая — отдельный понятный текст, AC3):
 * 1. id задан и задача существует;
 * 2. grant текущего прогона покрывает задачу (страховка к гейту чата — AC8);
 * 3. лимит параллельных фаз (настройка supervisor.max_parallel_phases);
 * 4. фаза не идёт уже у этой задачи;
 * 5. фаза выбрана (явная либо первая по workflow) и разрешена из статуса.
 */
async function toolTriggerPhase(args: ToolArgs, cwd: string): Promise<string> {
  const id = str(args.id);
  if (id === '') return ackError('Не указан id задачи — запуск фазы невозможен.');

  const task = getTask(cwd, id);
  if (!task) return ackError(`Задача не найдена: ${id}`);

  // Grant-страховка: вне прогона задача запускается только обычным Allow/Deny,
  // сюда попадать не должна, но handler обязан отказывать сам (AC8).
  const verdict = checkSupervisorGrant(cwd, 'backlog_trigger_phase', { id: task.id });
  if (!verdict.granted && 'error' in verdict) return ackError(verdict.error);

  const settings = loadSupervisorSettings(cwd);
  if (countActiveRuns() >= settings.maxParallelPhases) {
    return ackError(
      `Превышен лимит параллельных фаз (${settings.maxParallelPhases}): дождись завершения текущих фаз ` +
        `или увеличь supervisor.max_parallel_phases в .vibelog/settings.json`,
    );
  }

  const run = getRun(task.id);
  if (run?.running) {
    return ackError(
      `Фаза уже идёт у задачи ${task.id}: ${run.phase ?? '?'} (pid ${run.pid ?? '?'}). ` +
        `Состояние — backlog_phase_status {id:"${task.id}"}`,
    );
  }

  const workflow = getWorkflowForTask(cwd, task);
  const requestedPhase = str(args.phase);
  let phase = requestedPhase;
  if (phase === '') {
    const available = getAvailablePhases(workflow, task.status);
    phase = getNextPhase(workflow, task.status) ?? '';
    if (phase === '') {
      return ackError(
        `У задачи ${task.id} из статуса ${task.status} нет доступных фаз по workflow` +
          (available.length > 0 ? ` (есть только ${available.join(', ')})` : '') +
          '. Укажи phase явно.',
      );
    }
  } else {
    const entryError = PHASE_ENTRYPOINT_ERRORS[phase];
    if (entryError) return ackError(entryError);
    if (!SERVICE_PHASES.includes(phase) && !isPhaseAllowed(workflow, task.status, phase)) {
      const available = getAvailablePhases(workflow, task.status);
      return ackError(
        `Фаза ${phase} недопустима из статуса ${task.status}: разрешены ${available.length > 0 ? available.join(', ') : 'никакие'}`,
      );
    }
  }

  const comment = str(args.comment);
  if (phase === 'comment' && comment === '') {
    return ackError('Для фазы comment нужен непустой comment — без текста шаблон фазы не заполнить.');
  }
  const sameSession = typeof args.sameSession === 'boolean' ? args.sameSession : undefined;

  const result = startTaskPhase(cwd, task.id, phase, {
    ...(comment !== '' ? { comment } : {}),
    ...(sameSession !== undefined ? { sameSession } : {}),
  });
  if ('error' in result) {
    // Единая точка: ошибка ядра приходит как есть (задача не читается,
    // недопустимая фаза, «Запуск уже выполняется» и т.п.)
    return ackError(
      comment !== ''
        ? `Комментарий добавлен, но запуск не удался: ${result.error}`
        : result.error,
    );
  }
  const applied: Record<string, unknown> = {
    id: task.id,
    phase,
    pid: result.pid,
  };
  if (result.queued) applied.queued = true;
  if (result.queuedBehind) applied.queuedBehind = result.queuedBehind;
  if (result.sameSession) applied.sameSession = result.sameSession;
  if (comment !== '') applied.comment = comment;
  return ackOk(
    `Фаза ${phase} запущена для ${task.id}` +
      (result.queued ? ' (в очереди: активен close другой задачи)' : '') +
      (sameSession !== undefined ? `, sameSession=${sameSession}` : ''),
    applied,
  );
}

/**
 * backlog_phase_status: состояние запуска + диагностика повторов.
 *
 * Источники (без чтения транскрипта целиком):
 * - `getRun(id)` — running/phase/pid/exitCode/logTail/result;
 * - мета сессии (`*.meta.json`) — `repeat_stats` (уже посчитанная пост-раном)
 *   и `last_run.is_error`; если метрики в мете нет — `analyzeToolRepeatsFromJsonlSync`;
 * - sessionId ищется в каталоге сессий главного репо И worktree задачи
 *   (VL-187: worktree создаётся только на фазе plan).
 */
async function toolPhaseStatus(args: ToolArgs, cwd: string): Promise<string> {
  const id = str(args.id);
  if (id === '') return ackError('Не указан id задачи.');
  const task = getTask(cwd, id);
  if (!task) return ackError(`Задача не найдена: ${id}`);

  const run = getRun(task.id);
  const payload: Record<string, unknown> = {
    id: task.id,
    status: task.status,
    running: run?.running === true,
  };
  if (run) {
    if (run.phase) payload.phase = run.phase;
    if (run.pid !== undefined) payload.pid = run.pid;
    if (run.exitCode !== undefined) payload.exitCode = run.exitCode;
    if (run.logTail !== undefined) payload.logTail = run.logTail;
    if (run.result !== undefined) payload.result = run.result;
    if (run.agent) payload.agent = run.agent;
    if (run.queued) payload.queued = true;
  }

  // Фаза последней сессии: сначала текущая/последняя фаза, затем любая последняя
  const phaseHint = run?.phase ?? '';
  const dirs = [agentSessionsDir(cwd), agentSessionsDir(taskWorktreeDir(cwd, task.id))];
  let sessionId: string | null = null;
  let sessionDir = dirs[0]!;
  for (const dir of dirs) {
    const found =
      (phaseHint !== '' ? findLatestTaskSessionSync(dir, task.id) : null) ??
      findLatestTaskSessionSync(dir, task.id);
    if (found) {
      sessionId = found;
      sessionDir = dir;
      break;
    }
  }

  if (sessionId) {
    payload.sessionId = sessionId;
    const meta = loadSessionMetaSync(sessionDir, sessionId);
    if (meta) {
      if (meta.phase) payload.session_phase = meta.phase;
      if (meta.lastRunPhase) payload.last_run_phase = meta.lastRunPhase;
      if (meta.finishedAt) payload.finishedAt = meta.finishedAt;
      if (meta.last_run) payload.last_run = meta.last_run;
      if (meta.repeat_stats) {
        payload.repeat_stats = meta.repeat_stats;
        payload.repeat_stats_source = 'session-meta';
      }
    }
    if (payload.repeat_stats === undefined) {
      const stats = analyzeToolRepeatsFromJsonlSync(sessionDir, sessionId);
      payload.repeat_stats = stats;
      payload.repeat_stats_source = stats ? 'jsonl' : 'none';
    }
  } else {
    payload.sessionId = null;
    payload.repeat_stats = null;
    payload.repeat_stats_source = 'none';
  }

  return JSON.stringify(payload, null, 2);
}

/** backlog_auto_queue: add/start/stop/status поверх core/auto-queue. */
async function toolAutoQueue(args: ToolArgs, cwd: string): Promise<string> {
  const action = str(args.action);
  if (action === '') return ackError('Не указан action: add | start | stop | status');
  const parsed = parseIds(args.ids);
  if ('error' in parsed) return ackError(parsed.error);

  switch (action) {
    case 'add': {
      if (parsed.ids.length === 0) return ackError('Для action=add нужен непустой ids — список ID задач');
      // Те же правила дедупликации, что у бота /auto add: их реализует ядро
      const res = addQueueTasks(cwd, parsed.ids);
      const queue = loadAutoQueue(cwd);
      return ackOk(
        `Очередь: добавлено ${res.added.length}, пропущено ${res.skipped.length} (running=${queue.running})`,
        { added: res.added, skipped: res.skipped, running: queue.running },
      );
    }
    case 'start': {
      const queue = setQueueRunning(cwd, true);
      return ackOk(`Автоочередь запущена (задач в очереди: ${queue.tasks.length})`, {
        running: queue.running,
        tasks: queue.tasks.length,
      });
    }
    case 'stop': {
      const queue = setQueueRunning(cwd, false);
      return ackOk('Автоочередь остановлена (текущая фаза доводится, новые не стартуют)', {
        running: queue.running,
        tasks: queue.tasks.length,
      });
    }
    case 'status': {
      const queue = loadAutoQueue(cwd);
      // sweepQueue доводит статусы «задача уже терминальна» — тот же вид, что /auto status
      if (sweepQueue(cwd, queue)) saveAutoQueue(cwd, queue);
      return JSON.stringify(
        {
          running: queue.running,
          max_retries: queue.max_retries ?? 1,
          tasks: queue.tasks,
          text: formatAutoQueue(queue),
        },
        null,
        2,
      );
    }
    default:
      return ackError(`Неизвестный action: ${action}. Допустимо: add | start | stop | status`);
  }
}

/** backlog_supervisor: plan/start/stop/status над прогоном и grant'ом. */
async function toolSupervisor(args: ToolArgs, cwd: string): Promise<string> {
  const action = str(args.action);
  if (action === '') return ackError('Не указан action: plan | start | stop | status');
  const parsed = parseIds(args.ids);

  switch (action) {
    case 'plan': {
      if ('error' in parsed) return ackError(parsed.error);
      if (parsed.ids.length === 0) return ackError('Для action=plan нужен ids — список задач прогона');
      const plan = buildSupervisorPlan(cwd, parsed.ids);
      return (
        formatSupervisorPlan(plan) +
        '\n\nДанные плана: ' +
        JSON.stringify(
          {
            runId: plan.runId,
            taskIds: plan.taskIds,
            groups: plan.groups,
            order: plan.order,
            skipped: plan.skipped,
            maxParallelPhases: plan.maxParallelPhases,
          },
          null,
          2,
        )
      );
    }
    case 'start': {
      // scopeIds: из draft'а карточки (если пользователь правил состав), иначе из args
      const draft = findDraftForStart(cwd);
      const ids = draft?.taskIds.length ? draft.taskIds : 'error' in parsed ? [] : parsed.ids;
      if (ids.length === 0) {
        return ackError('Для action=start нужен ids — список задач прогона (или подтверждённая карточка).');
      }
      const plan = buildSupervisorPlan(cwd, ids);
      if (plan.taskIds.length === 0) {
        return ackError(`Прогон не собрать: ${plan.rationale}`);
      }
      // Срок: явный expiresAt → draft.expiresAt → expiresInHours → дефолт настроек
      const grantedAt = new Date().toISOString();
      const settings = loadSupervisorSettings(cwd);
      const ttlArg = args.expiresInHours ?? settings.defaultTtlHours;
      const expiry = computeExpiresAt(
        grantedAt,
        ttlArg,
        args.expiresAt ?? draft?.expiresAt ?? undefined,
      );
      if ('error' in expiry) return ackError(expiry.error);
      const tools = sanitizeTools(
        draft
          ? draft.allowedTools
          : Array.isArray(args.allowedTools)
            ? args.allowedTools
            : GRANTABLE_TOOLS,
      );
      const res = startSupervisorRun(
        cwd,
        { ...plan, runId: draft?.runId ?? plan.runId },
        tools,
        expiry.expiresAt,
        grantedAt,
      );
      if (draft) clearGrantDraft(cwd, draft.runId);
      if (!res.ok) return ackError(res.message);
      return ackOk(res.message, {
        runId: res.runId,
        taskIds: plan.taskIds,
        allowedTools: tools,
        expiresAt: expiry.expiresAt,
        ...(res.startedTask ? { started: res.startedTask, phase: res.startedPhase, pid: res.pid } : {}),
      });
    }
    case 'stop': {
      const res = stopSupervisorRun(cwd, str(args.runId) !== '' ? str(args.runId) : undefined);
      return res.ok ? ackOk(res.message, { runId: res.runId, revoked: true }) : ackError(res.message);
    }
    case 'status': {
      const status = supervisorRunStatus(cwd);
      const grant = findActiveGrant(cwd);
      return JSON.stringify(
        {
          runId: status.runId,
          active: status.active,
          grantedAt: status.grantedAt ?? null,
          expiresAt: status.expiresAt ?? null,
          revokedAt: status.revokedAt ?? null,
          taskIds: status.taskIds,
          tasks: status.tasks,
          finished: status.finished,
          autoRevoked: status.autoRevoked,
          allowedTools: grant?.allowedTools ?? null,
          text: status.message,
        },
        null,
        2,
      );
    }
    default:
      return ackError(`Неизвестный action: ${action}. Допустимо: plan | start | stop | status`);
  }
}

/**
 * Draft карточки для текущего старта.
 *
 * Карточка пишет draft по runId, который сервер показал в предпросмотре.
 * Handler не знает runId заранее (он зависит от времени), поэтому берём самый
 * свежий draft — ожидающий подтверждения старт у прогона ровно один.
 */
function findDraftForStart(cwd: string): ReturnType<typeof loadGrantDraft> {
  return latestGrantDraft(cwd);
}

/**
 * Предпросмотр карточки grant для approval-события чата (AC10).
 *
 * Возвращает данные для рендера: состав, порядок, волны, инструменты и срок.
 * Не пишет файлов и не запускает фаз.
 */
export function supervisorGrantPreview(
  cwd: string,
  args: Record<string, unknown>,
): ReturnType<typeof buildGrantPreview> {
  return buildGrantPreview(cwd, taskIdsOfArgs(args), {
    expiresInHours: args.expiresInHours,
    expiresAt: args.expiresAt,
  });
}
