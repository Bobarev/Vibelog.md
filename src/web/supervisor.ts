/**
 * Прогон супервизора: план / старт / стоп / статус (VL-268, doc-19 §11, §15).
 *
 * Прогон ≠ автоочередь (`src/core/auto-queue.ts`) и ≠ авто-раннер бота:
 * очередь отвечает «что прогонять» в фоне процесса бота, а прогон — это
 * согласованный в чате набор задач с grant'ом на доверие. Здесь живёт только
 * «механика»: посчитать состав и порядок (план), запустить первую фазу,
 * остановить, отдать статус. Решения «что лечить» и тик-цикл — VL-269.
 *
 * Модуль импортирует оркестратор (`startTaskPhase`, `getRun`), workflow и
 * grant-хранилище. Никакого LLM: всё, что здесь есть, детерминировано и
 * проверяется тестами (спавн фазы подменяется stub-бином через
 * setSpawnEnvBaseForTests — паттерн src/web/trigger-api.test.mjs).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTask } from '../core/store.js';
import type { Task } from '../core/task.js';
import { blockedBy, isReady } from '../core/deps.js';
import { loadSettings } from '../core/settings.js';
import { getNextPhase, getWorkflowForTask } from '../core/workflow.js';
import { resolveSupervisorRuntime } from '../core/supervisor-config.js';
import type { ParallelMode } from '../core/supervisor-config.js';
import { makePhaseRunId, startSupervisorTimer, stopSupervisorTimer } from './supervisor-tick.js';
import { loadState, saveState } from '../core/supervisor-state.js';
import type { SupervisorTickState } from '../core/supervisor-state.js';
import {
  GRANTABLE_TOOLS,
  SUPERVISOR_DIR,
  canonicalTaskId,
  findActiveGrant,
  isGrantActive,
  isGrantExpired,
  isGrantRevoked,
  latestGrantDraft,
  listGrants,
  makeRunId,
  revokeGrant,
  sanitizeTools,
  writeGrant,
} from './supervisor-grant.js';
import type { SupervisorGrant } from './supervisor-grant.js';
import { getRun, startTaskPhase } from './orchestrator.js';

/**
 * Значения лимитов прогона — реэкспорт из core (VL-270, lesson-37: дефолты
 * живут в одном месте). Раньше здесь было 2, doc-19 §7 требует 3; тик и
 * лимит параллельности читают ОДНУ константу, иначе план прогона и тик
 * разошлись бы по значению.
 */
export { DEFAULT_MAX_PARALLEL_PHASES, MAX_PARALLEL_PHASES_CEILING } from '../core/supervisor-config.js';

/** Терминальные статусы задачи: прогон по ним закончен. */
const TERMINAL_STATUSES = ['done', 'rejected', 'completed'];

/** Настройки прогона (`supervisor` в .vibelog/settings.json). */
export interface SupervisorSettings {
  /** Сколько фаз можно держать одновременно запущенными. */
  maxParallelPhases: number;
  /** TTL grant'а по умолчанию, часы. */
  defaultTtlHours: number;
  /** Ошибки валидации секции (битая настройка не отключает дефолты, lesson-117). */
  errors: string[];
}

/**
 * Читает секцию `supervisor` настроек терпимо: битые значения не роняют чат и
 * не отключают дефолты, а попадают в `errors`.
 *
 * VL-270: чтение `max_parallel_phases` делегировано в `resolveSupervisorRuntime`
 * (core/supervisor-config.ts) — тик и план прогона обязаны видеть одно и то же
 * значение (lesson-37). Здесь остаётся только специфичный для прогона TTL
 * grant'а, которого у тика нет.
 */
export function loadSupervisorSettings(cwd: string): SupervisorSettings {
  const runtime = resolveSupervisorRuntime(cwd);
  const errors = runtime.errors.slice();
  let defaultTtlHours = 8;
  const ttl = ((): unknown => {
    const raw = loadSettings(cwd).supervisor;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    return (raw as Record<string, unknown>).default_ttl_hours;
  })();
  if (ttl !== undefined) {
    if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 && ttl <= 336) {
      defaultTtlHours = ttl;
    } else {
      errors.push('settings.json: supervisor.default_ttl_hours должен быть числом 0..336');
    }
  }
  return { maxParallelPhases: runtime.maxParallelPhases, defaultTtlHours, errors };
}

/** Задача в плане прогона: что с ней сделают и почему. */
export interface SupervisorPlanItem {
  id: string;
  status: string;
  /** Фаза, которая будет запущена следующей (по workflow). */
  phase: string;
  priority: string;
  /** Все зависимости Done. */
  ready: boolean;
  /** Блокеры (ID незавершённых зависимостей). */
  blockedBy?: string[];
  /** Волна (1 — можно запускать сразу). */
  wave: number;
}

/** Отброшенная задача плана с причиной. */
export interface SupervisorPlanSkipped {
  id: string;
  reason: string;
}

/** Сухой прогон: состав, порядок, волны, обоснование. */
export interface SupervisorPlan {
  runId: string;
  taskIds: string[];
  order: SupervisorPlanItem[];
  /** Волны параллельности (в каждой — до maxParallelPhases задач). */
  groups: string[][];
  rationale: string;
  /**
   * VL-270: обоснование групп (по одной строке на группу). В conservative это
   * результат планировщика, в aggressive — пометка «без обоснования»; строки
   * попадают в heartbeat.md прогона (doc-19 §14, AC12).
   */
  groupsRationale: string[];
  /** Режим группировки на момент плана (conservative/aggressive). */
  parallelMode: ParallelMode;
  skipped: SupervisorPlanSkipped[];
  maxParallelPhases: number;
}

/** Порядок приоритетов: High → Medium → Low → прочее. */
const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/** Терминальный ли статус (прогон по задаче закончен). */
function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status.toLowerCase());
}

/**
 * Гасит таймер тика, если после отзыва grant'а активных прогонов не осталось.
 *
 * Слепой `stopSupervisorTimer()` здесь был бы ошибкой: в проекте может идти
 * второй прогон (другой grant), и его таймер должен продолжать считать.
 */
function stopTimerIfNoActiveGrant(cwd: string): void {
  if (findActiveGrant(cwd) === null) stopSupervisorTimer();
}

/**
 * Считает план прогона по набору задач (сухой прогон, AC6).
 *
 * Для каждой задачи: существует → не терминальна → у workflow есть следующая
 * фаза → зависимости готовы. Непрошедшие попадают в `skipped` с причиной.
 * Порядок — приоритет, затем порядок в `ids` (стабильно). Волны считаются по
 * зависимостям ВНУТРИ набора: задача без внутренних блокеров — волна 1,
 * остальные — на 1 больше максимума волн своих внутренних блокеров.
 *
 * @param ids — задачи прогона (порядок предложения пользователя/модели)
 */
export function buildSupervisorPlan(cwd: string, ids: unknown, now: Date = new Date()): SupervisorPlan {
  const settings = loadSupervisorSettings(cwd);
  const requested: string[] = [];
  if (Array.isArray(ids)) {
    for (const item of ids) if (typeof item === 'string' && item.trim() !== '') requested.push(item.trim());
  } else if (typeof ids === 'string' && ids.trim() !== '') {
    requested.push(ids.trim());
  }
  // Дедуп по каноническому ID: vl-268 и VL-268 — одна задача
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of requested) {
    const canon = canonicalTaskId(id);
    if (seen.has(canon)) continue;
    seen.add(canon);
    unique.push(id);
  }

  const skipped: SupervisorPlanSkipped[] = [];
  const candidates: { id: string; status: string; phase: string; priority: string; blockers: string[]; order: number }[] = [];
  const canonInPlan = new Set(unique.map(canonicalTaskId));

  unique.forEach((id, index) => {
    const task = getTask(cwd, id);
    if (!task) {
      skipped.push({ id, reason: 'задача не найдена' });
      return;
    }
    if (isTerminal(task.status)) {
      skipped.push({ id: task.id, reason: `статус ${task.status} — задача терминальна, фаз нет` });
      return;
    }
    const workflow = getWorkflowForTask(cwd, task);
    const phase = getNextPhase(workflow, task.status);
    if (!phase) {
      skipped.push({ id: task.id, reason: `статус ${task.status} — в workflow нет исходящей фазы` });
      return;
    }
    const deps = blockedBy(cwd, task);
    const blockers = deps.filter(d => !isTerminal(d.status)).map(d => d.id);
    if (blockers.length > 0) {
      // Внутренние блокеры (из набора) дают волну, внешние — причину пропуска
      const external = blockers.filter(b => !canonInPlan.has(canonicalTaskId(b)));
      if (external.length > 0) {
        skipped.push({ id: task.id, reason: `заблокирована зависимостями: ${external.join(', ')}` });
        return;
      }
    }
    candidates.push({
      id: task.id,
      status: task.status,
      phase,
      priority: task.priority ?? 'Medium',
      blockers,
      order: index,
    });
  });

  // Сортировка: приоритет, затем исходный порядок (стабильно)
  candidates.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 3;
    const pb = PRIORITY_ORDER[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return a.order - b.order;
  });

  // Волны по внутренним зависимостям: topological depth внутри набора
  const byCanon = new Map(candidates.map(c => [canonicalTaskId(c.id), c]));
  const waveOf = new Map<string, number>();
  const computeWave = (canon: string, stack: Set<string>): number => {
    const known = waveOf.get(canon);
    if (known !== undefined) return known;
    if (stack.has(canon)) return 1; // цикл — не зацикливаемся, ставим в первую волну
    const item = byCanon.get(canon);
    if (!item) return 0;
    stack.add(canon);
    let wave = 1;
    for (const blocker of item.blockers) {
      const bCanon = canonicalTaskId(blocker);
      if (!byCanon.has(bCanon)) continue;
      wave = Math.max(wave, computeWave(bCanon, stack) + 1);
    }
    stack.delete(canon);
    waveOf.set(canon, wave);
    return wave;
  };
  for (const item of candidates) computeWave(canonicalTaskId(item.id), new Set());

  const order: SupervisorPlanItem[] = candidates.map(c => {
    const item: SupervisorPlanItem = {
      id: c.id,
      status: c.status,
      phase: c.phase,
      priority: c.priority,
      // ready — все зависимости (включая внешние) в терминальном статусе
      ready: c.blockers.length === 0 && isReady(cwd, getTask(cwd, c.id)!),
      wave: waveOf.get(canonicalTaskId(c.id)) ?? 1,
    };
    if (c.blockers.length > 0) item.blockedBy = c.blockers;
    return item;
  });

  // Группы = волны; внутри волны порядок из order (приоритет/исходный порядок)
  const maxWave = order.reduce((m, i) => Math.max(m, i.wave), 0);
  const groups: string[][] = [];
  for (let w = 1; w <= maxWave; w++) {
    groups.push(order.filter(i => i.wave === w).map(i => i.id));
  }

  const runId = makeRunId(now);
  const parallelMode = resolveSupervisorRuntime(cwd).parallelMode;
  return {
    runId,
    taskIds: order.map(i => i.id),
    order,
    groups,
    rationale: buildRationale(order, groups, skipped, settings.maxParallelPhases),
    groupsRationale: planGroupNotes(cwd, groups, order, parallelMode, settings.maxParallelPhases),
    parallelMode,
    skipped,
    maxParallelPhases: settings.maxParallelPhases,
  };
}

/**
 * Обоснование групп волнового плана (VL-270).
 *
 * Волны считаются по зависимостям внутри набора, поэтому две задачи с
 * `dependencies`/`blocks` в одну волну попасть не могут ПО ПОСТРОЕНИЮ — это и
 * есть жёсткий запрет параллели (AC12). Метка-предупреждение о зависимостях
 * ставится, если в волне всё же оказалась связанная пара (цикл зависимостей —
 * `computeWave` не зацикливается, но пара возможна).
 */
function planGroupNotes(
  cwd: string,
  groups: string[][],
  order: SupervisorPlanItem[],
  mode: ParallelMode,
  maxParallelPhases: number,
): string[] {
  const notes: string[] = [];
  groups.forEach((group, index) => {
    const parts: string[] = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = getTask(cwd, group[i]!);
        const b = getTask(cwd, group[j]!);
        if (a && b && hasDependencyTiePublic(cwd, a, b)) {
          parts.push(`внимание: ${a.id} и ${b.id} связаны зависимостью — волна построена по циклу зависимостей`);
        }
      }
    }
    const maxInWave = Math.min(maxParallelPhases, group.length);
    notes.push(
      `Волна ${index + 1} (режим ${mode}): ${group.join(', ')} — ` +
        (mode === 'conservative'
          ? 'conservative: обоснование — волна построена по зависимостям набора, задачи внутри волны независимы'
          : 'aggressive: без обоснования') +
        `, максимум ${maxInWave} фаз одновременно` +
        (index === 0 ? ', зависимостей внутри набора нет' : `, ждут завершения волны ${index}`) +
        (parts.length > 0 ? `; ${parts.join('; ')}` : ''),
    );
  });
  void order;
  return notes;
}

/** Связь задач по зависимостям в любую сторону (обёртка для плана). */
function hasDependencyTiePublic(cwd: string, a: Task, b: Task): boolean {
  const canon = (x: string): string => x.toUpperCase();
  const aBlocksB = blockedBy(cwd, b).some(t => canon(t.id) === canon(a.id));
  const bBlocksA = blockedBy(cwd, a).some(t => canon(t.id) === canon(b.id));
  return aBlocksB || bBlocksA;
}

/** Текст обоснования плана (показывается в чате и в MCP-ответе). */
function buildRationale(
  order: SupervisorPlanItem[],
  groups: string[][],
  skipped: SupervisorPlanSkipped[],
  maxParallelPhases: number,
): string {
  if (order.length === 0) {
    const reasons = skipped.map(s => `${s.id} — ${s.reason}`).join('; ');
    return `Запускать нечего: в наборе нет задач с доступной фазой${reasons ? ` (${reasons})` : ''}.`;
  }
  const lines: string[] = [];
  lines.push(`Порядок: приоритет (High → Medium → Low), внутри приоритета — порядок набора.`);
  groups.forEach((group, index) => {
    lines.push(
      `Волна ${index + 1}: ${group.join(', ')} — параллельно до ${maxParallelPhases} фаз` +
        (index === 0 ? ' (зависимостей внутри набора нет)' : ` (ждут завершения волны ${index})`),
    );
  });
  const phases = order.map(i => `${i.id}: ${i.status} → ${i.phase}`).join(', ');
  lines.push(`Фазы: ${phases}.`);
  if (skipped.length > 0) {
    lines.push(`Пропущены: ${skipped.map(s => `${s.id} — ${s.reason}`).join('; ')}.`);
  }
  return lines.join('\n');
}

/** Текстовое представление плана для MCP-ответа. */
export function formatSupervisorPlan(plan: SupervisorPlan): string {
  const head = `Прогон ${plan.runId}: задач ${plan.taskIds.length}, параллельность до ${plan.maxParallelPhases}.`;
  if (plan.taskIds.length === 0) return `${head}\n${plan.rationale}`;
  const rows = plan.order.map(
    i =>
      `- ${i.id} (${i.priority}) — ${i.status} → фаза ${i.phase}, волна ${i.wave}` +
      (i.blockedBy && i.blockedBy.length > 0 ? `, ждёт: ${i.blockedBy.join(', ')}` : ''),
  );
  return [head, ...rows, '', plan.rationale].join('\n');
}

/** Состояние прогона на диске: `runs/<runId>.json`. */
export interface SupervisorRunRecord {
  runId: string;
  taskIds: string[];
  groups: string[][];
  createdAt: string;
  /** Задачи, по которым запуск уже был инициирован (для статуса). */
  started: string[];
  stoppedAt?: string;
  finishedAt?: string;
}

/** Каталог записей прогонов. */
export function runsDir(cwd: string): string {
  return join(cwd, SUPERVISOR_DIR, 'runs');
}

/** Путь к записи прогона. */
export function runRecordPath(cwd: string, runId: string): string {
  return join(runsDir(cwd), `${runId}.json`);
}

/** Читает запись прогона (нет файла/мусор → null). */
export function loadRunRecord(cwd: string, runId: unknown): SupervisorRunRecord | null {
  if (typeof runId !== 'string' || runId === '') return null;
  const path = runRecordPath(cwd, runId);
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Partial<SupervisorRunRecord>;
    if (typeof r.runId !== 'string' || !Array.isArray(r.taskIds)) return null;
    return {
      runId: r.runId,
      taskIds: r.taskIds.filter((t): t is string => typeof t === 'string'),
      groups: Array.isArray(r.groups)
        ? r.groups.map(g => (Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : []))
        : [],
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
      started: Array.isArray(r.started) ? r.started.filter((t): t is string => typeof t === 'string') : [],
      ...(typeof r.stoppedAt === 'string' ? { stoppedAt: r.stoppedAt } : {}),
      ...(typeof r.finishedAt === 'string' ? { finishedAt: r.finishedAt } : {}),
    };
  } catch {
    return null;
  }
}

/** Записывает запись прогона. */
export function saveRunRecord(cwd: string, record: SupervisorRunRecord): void {
  mkdirSync(runsDir(cwd), { recursive: true });
  writeFileSync(runRecordPath(cwd, record.runId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/** Последняя запись прогона (по createdAt, свежие первыми). */
export function latestRunRecord(cwd: string): SupervisorRunRecord | null {
  const dir = runsDir(cwd);
  if (!existsSync(dir)) return null;
  const records: SupervisorRunRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const rec = loadRunRecord(cwd, name.slice(0, -'.json'.length));
    if (rec) records.push(rec);
  }
  if (records.length === 0) return null;
  records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return records[0]!;
}

/** Результат старта прогона. */
export interface StartSupervisorResult {
  ok: boolean;
  runId?: string;
  grant?: SupervisorGrant;
  startedTask?: string;
  startedPhase?: string;
  pid?: number;
  message: string;
  /** Задачи, которые не удалось запустить (с причинами). */
  failed?: { id: string; reason: string }[];
}

/**
 * Стартует прогон: пишет grant и запись прогона, запускает первые фазы.
 *
 * Запускаются первые задачи волны 1 (не больше `maxParallelPhases`), каждая —
 * `startTaskPhase` с фазой из плана. Провал запуска конкретной задачи не
 * отменяет остальные; если не удалось запустить НИ ОДНОЙ — grant отзывается
 * (не оставляем доверие на пустой прогон, AC11).
 *
 * @param plan — результат buildSupervisorPlan (состав и волны)
 * @param allowedTools — развязанные инструменты (уже отфильтрованные sanitizeTools)
 * @param expiresAt — срок действия grant'а (ISO)
 */
export function startSupervisorRun(
  cwd: string,
  plan: SupervisorPlan,
  allowedTools: string[],
  expiresAt: string,
  grantedAt: string = new Date().toISOString(),
): StartSupervisorResult {
  const tools = sanitizeTools(allowedTools);
  if (plan.taskIds.length === 0) {
    return { ok: false, message: 'В прогоне нет задач с доступной фазой — запускать нечего.' };
  }
  if (tools.length === 0) {
    return { ok: false, message: 'Не выбран ни один инструмент для развязывания — прогон не имеет смысла.' };
  }
  const runtime = resolveSupervisorRuntime(cwd);
  const grant: SupervisorGrant = {
    runId: plan.runId,
    taskIds: plan.taskIds,
    allowedTools: tools,
    grantedAt,
    expiresAt,
  };
  writeGrant(cwd, grant);
  const record: SupervisorRunRecord = {
    runId: plan.runId,
    taskIds: plan.taskIds,
    groups: plan.groups,
    createdAt: grantedAt,
    started: [],
  };
  saveRunRecord(cwd, record);

  // VL-270: прогон стартует с ЧИСТОГО state.json — тик читает его как источник
  // истины о запущенных фазах. Живость фазы определяется по pid + phaseRunId,
  // поэтому запуск обязан сразу записать обоих: иначе первый же тик после
  // рестарта процесса принял бы живую фазу за зависшую (AC5).
  const tickState: SupervisorTickState = {
    runId: plan.runId,
    mode: runtime.parallelMode,
    startedAt: grantedAt,
    updatedAt: grantedAt,
    tick: 0,
    lastDecision: { tick: 0, action: 'wait', reason: 'прогон запущен, тик ещё не считал' },
    tasks: {},
    tuning: { applied: 0 },
  };

  const firstWave = plan.groups[0] ?? plan.taskIds;
  const toStart = firstWave.slice(0, Math.max(1, plan.maxParallelPhases));
  const failed: { id: string; reason: string }[] = [];
  let firstStarted: { id: string; phase: string; pid: number } | null = null;

  for (const id of toStart) {
    const item = plan.order.find(i => canonicalTaskId(i.id) === canonicalTaskId(id));
    if (!item) continue;
    if (getRun(id)?.running) {
      failed.push({ id, reason: 'фаза уже идёт' });
      continue;
    }
    const res = startTaskPhase(cwd, id, item.phase, {});
    if ('error' in res) {
      failed.push({ id, reason: res.error });
      continue;
    }
    record.started.push(id);
    const attempt = 1;
    tickState.tasks[canonicalTaskId(id)] = {
      phase: item.phase,
      status: 'running',
      phaseRunId: makePhaseRunId(id, item.phase, attempt),
      pid: res.pid,
      startedAt: grantedAt,
      attempt,
      healAttempts: 0,
      groupId: 'g1',
      statusAtStart: item.status,
      nextPhase: item.phase,
    };
    if (!firstStarted) firstStarted = { id, phase: item.phase, pid: res.pid };
  }
  saveRunRecord(cwd, record);
  // Состояние пишется и при частичном успехе: у запущенных задач pid есть,
  // у остальных их добавит первый тик (они попадут в candidates как pending)
  if (Object.keys(tickState.tasks).length > 0) saveState(cwd, tickState);

  if (record.started.length === 0) {
    revokeGrant(cwd, plan.runId, 'ни одна фаза не запустилась');
    saveRunRecord(cwd, { ...record, finishedAt: new Date().toISOString() });
    // VL-272: неуспешный старт не оставляет работающий таймер — грант отозван,
    // наблюдать нечего (AC5). Если есть другой активный прогон, его таймер живёт.
    stopTimerIfNoActiveGrant(cwd);
    return {
      ok: false,
      runId: plan.runId,
      grant,
      failed,
      message: `Прогон ${plan.runId} не запущен: ${failed.map(f => `${f.id} — ${f.reason}`).join('; ')}`,
    };
  }

  // VL-272: таймер тика поднимается ЗДЕСЬ, а не только при старте сервера:
  // сервер обычно уже работает, когда пользователь подтверждает grant, поэтому
  // единственная серверная точка старта оставляла прогон без лечения и
  // планирования волн. Вызов идемпотентен (внутри guard tickTimer !== null) —
  // повторный start второй интервал не создаст (AC4).
  try {
    startSupervisorTimer(cwd);
  } catch (err) {
    // Прогон уже запущен — ошибка таймера не отменяет его, но должна быть видна
    console.error(`[supervisor] таймер не запущен: ${(err as Error).message}`);
  }

  return {
    ok: true,
    runId: plan.runId,
    grant,
    ...(firstStarted
      ? { startedTask: firstStarted.id, startedPhase: firstStarted.phase, pid: firstStarted.pid }
      : {}),
    ...(failed.length > 0 ? { failed } : {}),
    message:
      `Прогон ${plan.runId} запущен: grant на ${plan.taskIds.length} задач, инструментов ${tools.length}, ` +
      `срок до ${expiresAt}. Запущено: ${record.started.join(', ')}` +
      (failed.length > 0 ? `. Не удалось: ${failed.map(f => `${f.id} — ${f.reason}`).join('; ')}` : ''),
  };
}

/**
 * Останавливает прогон: отзывает grant (немедленно, AC11) и помечает запись.
 *
 * @param runId — конкретный прогон; не задан — активный (или последний)
 */
export function stopSupervisorRun(cwd: string, runId?: unknown): { ok: boolean; message: string; runId?: string } {
  const active = findActiveGrant(cwd);
  const effectiveRunId =
    typeof runId === 'string' && runId !== '' ? runId : active?.runId ?? latestRunRecord(cwd)?.runId;
  if (!effectiveRunId) {
    return { ok: false, message: 'Активного прогона нет — останавливать нечего.' };
  }
  const revoked = revokeGrant(cwd, effectiveRunId, 'остановлен пользователем (backlog_supervisor stop)');
  const record = loadRunRecord(cwd, effectiveRunId);
  if (record) saveRunRecord(cwd, { ...record, stoppedAt: new Date().toISOString() });
  if (!revoked && !record) {
    return { ok: false, message: `Прогон ${effectiveRunId} не найден.` };
  }
  // VL-272: грант отозван — прогон больше не наблюдается, таймер снимаем
  // (если других активных прогонов нет) — AC2.
  stopTimerIfNoActiveGrant(cwd);
  return {
    ok: true,
    runId: effectiveRunId,
    message:
      `Прогон ${effectiveRunId} остановлен: grant отозван, новые фазы не стартуют ` +
      `(уже запущенные доводятся оркестратором).`,
  };
}

/** Состояние запуска задачи внутри прогона. */
export interface SupervisorTaskStatus {
  id: string;
  status: string;
  phase?: string;
  running: boolean;
  exitCode?: number | null;
  logTail?: string;
}

/** Состояние прогона (AC6: status отдаёт состояние прогона). */
export interface SupervisorRunStatus {
  runId: string | null;
  active: boolean;
  expiresAt?: string;
  revokedAt?: string;
  grantedAt?: string;
  taskIds: string[];
  tasks: SupervisorTaskStatus[];
  /** Все задачи прогона в терминальном статусе. */
  finished: boolean;
  /** Отзыв произошёл при этом вызове (все задачи терминальны). */
  autoRevoked: boolean;
  message: string;
}

/**
 * Состояние прогона + авто-отзыв grant'а при завершении (AC11).
 *
 * «Завершён» = каждая задача прогона в терминальном статусе (Done/Rejected).
 * В этот момент grant больше не нужен: новые фазы по этим задачам запускать
 * нечего, а висящее доверие — лишний риск. Отзыв происходит ровно один раз
 * (idempotentно: повторный вызов видит revokedAt и autoRevoked=false).
 */
export function supervisorRunStatus(cwd: string, now: Date = new Date()): SupervisorRunStatus {
  const active = findActiveGrant(cwd, now);
  const grants = listGrants(cwd);
  const grant = active ?? grants[0] ?? null;
  const record = grant ? loadRunRecord(cwd, grant.runId) : latestRunRecord(cwd);
  const runId = grant?.runId ?? record?.runId ?? null;
  const taskIds = grant?.taskIds ?? record?.taskIds ?? [];

  const tasks: SupervisorTaskStatus[] = [];
  let allTerminal = taskIds.length > 0;
  for (const id of taskIds) {
    const task = getTask(cwd, id);
    const run = getRun(id);
    const item: SupervisorTaskStatus = {
      id,
      status: task?.status ?? 'не найдена',
      running: run?.running === true,
    };
    if (run?.phase) item.phase = run.phase;
    if (run?.exitCode !== undefined) item.exitCode = run.exitCode;
    if (run?.logTail) item.logTail = run.logTail;
    tasks.push(item);
    if (!task || !isTerminal(task.status)) allTerminal = false;
  }

  let autoRevoked = false;
  if (taskIds.length > 0 && allTerminal && grant && isGrantActive(grant, now)) {
    revokeGrant(cwd, grant.runId, 'все задачи прогона в терминальном статусе');
    const rec = loadRunRecord(cwd, grant.runId);
    if (rec && !rec.finishedAt) saveRunRecord(cwd, { ...rec, finishedAt: now.toISOString() });
    autoRevoked = true;
    // VL-272: авто-отзыв (все задачи терминальны) — прогон закончен, таймер
    // снимаем: иначе он продолжил бы считать по завершённому прогону (AC2).
    stopTimerIfNoActiveGrant(cwd);
  }

  const activeAfter = grant ? isGrantActive(grant, now) && !autoRevoked : false;
  const lines: string[] = [];
  if (!runId) {
    lines.push('Прогона нет: grant не выдан.');
  } else {
    lines.push(
      `Прогон ${runId}: ${activeAfter ? 'активен' : 'не активен'}` +
        (grant?.expiresAt ? `, срок до ${grant.expiresAt}` : ''),
    );
    if (grant && isGrantRevoked(grant)) {
      lines.push(`Отозван ${grant.revokedAt}${grant.revokeReason ? `: ${grant.revokeReason}` : ''}`);
    } else if (grant && isGrantExpired(grant, now)) {
      lines.push('Срок истёк: новые фазы не стартуют, текущие доводятся.');
    }
    for (const t of tasks) {
      lines.push(
        `- ${t.id}: ${t.status}${t.running ? ` — идёт фаза ${t.phase ?? '?'}` : ''}` +
          (t.exitCode !== undefined && t.exitCode !== null ? `, exit ${t.exitCode}` : ''),
      );
    }
    if (autoRevoked) lines.push('Все задачи прогона терминальны — grant отозван автоматически.');
  }
  return {
    runId,
    active: activeAfter,
    ...(grant?.grantedAt ? { grantedAt: grant.grantedAt } : {}),
    ...(grant?.expiresAt ? { expiresAt: grant.expiresAt } : {}),
    ...(grant?.revokedAt ? { revokedAt: grant.revokedAt } : {}),
    taskIds,
    tasks,
    finished: taskIds.length > 0 && allTerminal,
    autoRevoked,
    message: lines.join('\n'),
  };
}

/** Предпросмотр карточки grant (данные для approval-карточки в чате, AC10). */
export interface SupervisorGrantPreview {
  runId: string;
  taskIds: string[];
  /** Доступные для развязывания инструменты (с отметкой «включён по умолчанию»). */
  tools: { name: string; enabled: boolean; description: string }[];
  expiresAt: string;
  grantedAt: string;
  order: { id: string; status: string; phase: string; wave: number; priority: string }[];
  groups: string[][];
  rationale: string;
  skipped: SupervisorPlanSkipped[];
  maxParallelPhases: number;
}

/** Подписи инструментов для карточки grant (человеческий текст). */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  backlog_trigger_phase: 'Запуск фаз задач',
  backlog_phase_status: 'Состояние запуска фазы',
  backlog_auto_queue: 'Управление автоочередью',
  backlog_supervisor: 'Управление прогоном',
  backlog_create_task: 'Создание задач (в т.ч. багов при провале)',
};

/**
 * Собирает данные approval-карточки grant: состав, порядок, волны, инструменты
 * с чекбоксами и срок. Ничего не пишет и не запускает.
 *
 * @param ids — задачи прогона (аргумент `ids` инструмента backlog_supervisor)
 */
export function buildGrantPreview(
  cwd: string,
  ids: unknown,
  options: { expiresInHours?: unknown; expiresAt?: unknown } = {},
  now: Date = new Date(),
): SupervisorGrantPreview {
  const plan = buildSupervisorPlan(cwd, ids, now);
  const settings = loadSupervisorSettings(cwd);
  const grantedAt = now.toISOString();
  const ttl =
    options.expiresInHours === undefined || options.expiresInHours === null
      ? settings.defaultTtlHours
      : options.expiresInHours;
  // Срок как в grant: явный expiresAt приоритетнее TTL; мусор → дефолт TTL
  const computed = computePreviewExpiry(grantedAt, ttl, options.expiresAt, settings.defaultTtlHours);
  return {
    runId: plan.runId,
    taskIds: plan.taskIds,
    tools: GRANTABLE_TOOLS.map(name => ({
      name,
      enabled: true,
      description: TOOL_DESCRIPTIONS[name] ?? name,
    })),
    expiresAt: computed,
    grantedAt,
    order: plan.order.map(i => ({
      id: i.id,
      status: i.status,
      phase: i.phase,
      wave: i.wave,
      priority: i.priority,
    })),
    groups: plan.groups,
    rationale: plan.rationale,
    skipped: plan.skipped,
    maxParallelPhases: plan.maxParallelPhases,
  };
}

/** Срок действия для предпросмотра: терпимо к мусору (карточка не падает). */
function computePreviewExpiry(
  grantedAt: string,
  expiresInHours: unknown,
  expiresAt: unknown,
  fallbackTtlHours: number,
): string {
  if (typeof expiresAt === 'string' && expiresAt !== '') {
    const ms = Date.parse(expiresAt);
    if (!Number.isNaN(ms) && ms > Date.parse(grantedAt)) return new Date(ms).toISOString();
  }
  const hours =
    typeof expiresInHours === 'number' && Number.isFinite(expiresInHours) && expiresInHours > 0
      ? expiresInHours
      : fallbackTtlHours;
  return new Date(Date.parse(grantedAt) + hours * 3_600_000).toISOString();
}
