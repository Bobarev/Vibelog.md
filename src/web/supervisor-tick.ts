/**
 * Тик супервизора: наблюдение, лечение, планировщик параллельности (VL-270,
 * doc-19 §5, §7–§10, §12–§14, §16).
 *
 * Один тик (doc-19 §5):
 *   1. собрать состояние (фазы, статусы, exitCode, fail_reason, repeat_stats);
 *   2. записать heartbeat.md + state.json;
 *   3. wake gate: изменилось ли что-то? — нет → тик закончен БЕЗ вызова модели;
 *   4. вызвать модель с промптом (heartbeat + правила + grant + прошлое решение);
 *   5. применить решение: запустить фазы / полечить / создать баг / ждать.
 *
 * Два принципиальных решения, которых в doc-19 нет (зафиксированы в
 * Implementation Notes задачи):
 *
 * 1. **Модель НЕ вызывает инструменты.** Тик собирает состояние сам, а модель
 *    возвращает ОДИН JSON-объект решения; применяет решение код. Иначе тик
 *    превратился бы во второй chat-tool-loop: недетерминированный,
 *    неотлаживаемый и способный «назначить» фазу в обход workflow (AC23
 *    запрещает переставлять шаги воркфлоу — значит у модели не должно быть
 *    ручки фазы вовсе).
 * 2. **Состояния в памяти нет.** Источник истины — `state.json`; живость фазы —
 *    `pid` + `phaseRunId` через `process.kill(pid, 0)`. `activeRuns`
 *    оркестратора теряется при рестарте `vibelog browser`, поэтому на него
 *    полагаться нельзя (AC1, AC5, AC19).
 *
 * Модель может ошибиться/ответить не-JSON — тик обязан выжить: невалидное
 * решение заменяется детерминированным фолбэком «последовательно, по
 * приоритету», а причина уходит в heartbeat.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTaskFile, getTask, listTasks } from '../core/store.js';
import type { Task } from '../core/task.js';
import { blockedBy, isReady } from '../core/deps.js';
import { loadSettings } from '../core/settings.js';
import { getNextPhase, getStatusAfterPhase, getWorkflowForTask, SERVICE_PHASES } from '../core/workflow.js';
import {
  DEFAULT_HEAL_ACTION,
  PROTECTED_SUPERVISOR_KEYS,
  applySelfTuning,
  loadHealRules,
  resolveSupervisorRuntime,
} from '../core/supervisor-config.js';
import type { HealAction, HealConfig, HealRule, ParallelMode } from '../core/supervisor-config.js';
import {
  isPidAlive,
  loadState,
  phaseAlive,
  saveState,
  snapshotKey,
  statePath,
  heartbeatPath,
  tailLines,
  writeHeartbeat,
} from '../core/supervisor-state.js';
import type { SupervisorTaskState, SupervisorTickState, TaskObservation } from '../core/supervisor-state.js';
import {
  agentSessionsDir,
  analyzeToolRepeatsFromJsonlSync,
  findLatestTaskSessionSync,
  findTaskPhaseSessionSync,
  loadSessionMetaSync,
} from '../agent/session.js';
import { createLlmClient } from '../agent/llm.js';
import { loadApiMode } from '../agent/llm-env.js';
import { retryResumeArgs } from '../bot/auto-runner.js';
import { taskWorktreeDir } from '../core/worktree.js';
import { canonicalTaskId, findActiveGrant } from './supervisor-grant.js';
import type { SupervisorGrant } from './supervisor-grant.js';
import { countActiveRuns, getRun, startTaskPhase } from './orchestrator.js';

/** Бюджет промпта тика: heartbeat + правила + grant + диагностика (AC3). */
export const MAX_TICK_PROMPT_CHARS = 24_000;

/** Сколько строк лога максимум уходит в промпт/авто-баг (сырые логи целиком — нет). */
const LOG_TAIL_LINES_PROMPT = 6;
const LOG_TAIL_LINES_BUG = 20;

/**
 * Порог «фаза висит» для случая, когда `startedAt` старше и wall-time настройки
 * нет: живой процесс, который не меняет статус дольше получаса, считается
 * протухшим (иначе переиспользованный pid держал бы задачу «вечно идущей»).
 */
const STALE_PHASE_FALLBACK_MS = 30 * 60 * 1000;

/** Компонентные метки проекта: пересечение по ним = риск конфликта (doc-19 §14). */
const COMPONENT_LABELS = ['core', 'cli', 'mcp', 'web', 'bot', 'agent', 'docs', 'prompt'];

/** Действия решения модели (закрытый набор). */
const DECISION_ACTIONS = ['run', 'heal', 'bug', 'stop', 'wait'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** Решение модели в тике. */
export interface TickDecision {
  action: DecisionAction;
  reason?: string;
  diagnosis?: string;
  /** Группы параллельного запуска (массивы ID задач прогона). */
  groups: string[][];
  /** Обоснование группы в conservative: ключ — `id1,id2`. */
  rationale: Record<string, string>;
  /** Лечение уровня 2: содержательный разбор (комментарий-директива + рестарт). */
  heal: { taskId: string; comment?: string; reason?: string }[];
  /** Авто-баг по задаче. */
  bug: { taskId: string; reason?: string }[];
  /** Стоп по задаче (без бага). */
  stop: { taskId: string; reason?: string }[];
  /** Патч правил лечения (только при allow_self_tuning). */
  tuning?: Record<string, unknown>;
}

/** Интерфейс LLM-вызова тика (узкий: промпт → текст; инструментов нет). */
export interface TickLlm {
  ask(prompt: string): Promise<string>;
}

/** Опции тика. */
export interface TickDeps {
  /** LLM для решения; явный `null` — модели нет (фолбэк-последовательность). */
  llm?: TickLlm | null;
  /** Часы (тесты подменяют, чтобы не зависеть от реального времени). */
  now?: () => Date;
  /** Бюджет промпта (тесты проверяют усечение). */
  maxPromptChars?: number;
}

/** Итог одного тика. */
export interface TickResult {
  /** Причина раннего выхода, если тик ничего не делал. */
  skipped?: 'no-grant' | 'unchanged' | 'disabled';
  /** Откуда взялось решение: модель / детерминированный фолбэк / не потребовалось. */
  decision: 'llm' | 'fallback' | 'unchanged' | 'no-grant';
  /** Вызывалась ли модель (AC2: счётчик проверяется тестом). */
  llmCalled: boolean;
  started: string[];
  healed: { taskId: string; ruleId: string; action: HealAction }[];
  bugs: { taskId: string; bugId: string }[];
  stopped: string[];
  /**
   * Задачи, пропущенные из-за незакрытых зависимостей (VL-275): в тике они не
   * запускаются и не лечатся (причина внешняя — перезапуск фазы её не устранит).
   */
  blocked: { taskId: string; blockers: string[] }[];
  errors: string[];
  statePath: string;
  heartbeatPath: string;
  /** Промпт тика (для диагностики/тестов; в состояние не пишется). */
  prompt?: string;
}

// ── Тестовые швы (паттерн VL-140 setSpawnEnvBaseForTests) ──────────────────
// isolate:false у vitest — шов ОБЯЗАН сбрасываться в finally теста, иначе
// утечёт в другие файлы (lesson VL-200).

let llmOverride: { value: TickLlm | null } | null = null;
/** Подменяет LLM тика; null — «модели нет» (фолбэк). Сбрасывать в finally. */
export function setTickLlmForTests(llm: TickLlm | null): void {
  llmOverride = { value: llm };
}
/** Снимает подмену LLM (прод-путь: клиент создаётся лениво). */
export function resetTickLlmForTests(): void {
  llmOverride = null;
}

let clockOverride: (() => Date) | null = null;
/** Подменяет часы тика. Сбрасывать в finally. */
export function setTickClockForTests(fn: (() => Date) | null): void {
  clockOverride = fn;
}

let startPhaseImpl = startTaskPhase;
/** Подменяет запуск фазы (тесты не спавнят реальный qwen). Сбрасывать в finally. */
export function setTickStartPhaseForTests(
  fn: ((...args: Parameters<typeof startTaskPhase>) => ReturnType<typeof startTaskPhase>) | null,
): void {
  startPhaseImpl = fn ?? startTaskPhase;
}

let activeCountImpl = countActiveRuns;
/** Подменяет счётчик активных фаз (тесты не поднимают реальные процессы). */
export function setTickActiveCountForTests(fn: (() => number) | null): void {
  activeCountImpl = fn ?? countActiveRuns;
}

/** Часы тика (override либо системные). */
function nowOf(deps: TickDeps): Date {
  return (deps.now ?? clockOverride ?? (() => new Date()))();
}

/** LLM тика: явный deps.llm → override теста → прод-клиент (либо null). */
function resolveLlm(cwd: string, deps: TickDeps): TickLlm | null {
  if ('llm' in deps) return deps.llm ?? null;
  if (llmOverride !== null) return llmOverride.value;
  return createTickLlm(cwd);
}

/**
 * Прод-клиент LLM для тика: без инструментов, один вызов на тик.
 *
 * @returns клиент либо null (нет модели/ключа) — тик уйдёт в фолбэк, а не упадёт
 */
export function createTickLlm(cwd: string): TickLlm | null {
  try {
    const client = createLlmClient({ cwd, apiMode: loadApiMode(cwd) });
    return {
      ask: async (prompt: string): Promise<string> => {
        const resp = await client.streamChat([{ role: 'user', content: prompt }], undefined);
        return resp.text ?? '';
      },
    };
  } catch {
    // Нет модели в settings.json/env — тик обязан работать (фолбэк), не падать
    return null;
  }
}

/** Собственный идентификатор запуска фазы: оркестратор своего runId не отдаёт. */
export function makePhaseRunId(taskId: string, phase: string, attempt: number): string {
  return `run-${canonicalTaskId(taskId)}-${phase}-${attempt}`;
}

/** Бюджет причины aborted в наблюдении: как в markPhaseAborted (500). */
const ABORTED_REASON_CHARS = 500;
/** Бюджет последнего комментария фазы в наблюдении (в состояние кладётся усечённый). */
const LAST_COMMENT_CHARS = 800;

/**
 * Маркер комментария-причины при аварийном завершении фазы (VL-244/289).
 *
 * Формат зафиксирован контрактом: `finalizePhaseStatus` пишет
 * «Фаза <фаза> прервана агентом (aborted): <причина> — статус возвращён к X».
 * Парсер нужен как fallback: `lastRuns` оркестратора живёт в памяти и после
 * рестарта `vibelog browser` пуст, а комментарий в задаче остаётся. Формат
 * нельзя менять без правки этого регэкспа (проверяется тестом).
 */
const ABORTED_COMMENT_RE = /прервана агентом \(aborted\)(?::\s*([\s\S]*?))?(?:\s+—\s+статус|\s*$)/;

/**
 * Ищет признак aborted в комментариях задачи (VL-289, fallback после рестарта).
 *
 * Смотрится ПОСЛЕДНИЙ комментарий @agent: признак есть только если он сам
 * матчит маркер. Так исторические aborted-комментарии не поднимают правило
 * после того, как фазу перезапустили и она оставила обычный отчёт (ложное
 * срабатывание на норме). Причина вырезается между «(aborted):» и «— статус…».
 *
 * @returns причина либо null; пустая причина → пустая строка (признак есть)
 */
export function detectAbortedFromComments(task: Task): { reason: string } | null {
  const comments = task.comments ?? [];
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i]!;
    if (c.author !== '@agent') continue;
    const m = ABORTED_COMMENT_RE.exec(c.text ?? '');
    return m ? { reason: (m[1] ?? '').trim().slice(0, ABORTED_REASON_CHARS) } : null;
  }
  return null;
}

/** Последний комментарий фазы (@agent) в бюджете — «что агент успел сказать». */
function lastAgentComment(task: Task): TaskObservation['lastComment'] {
  const comments = task.comments ?? [];
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i]!;
    if (c.author !== '@agent') continue;
    const text = (c.text ?? '').replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    return {
      author: c.author,
      created: c.created ?? '',
      text: text.slice(0, LAST_COMMENT_CHARS),
    };
  }
  return undefined;
}

/**
 * Собирает наблюдение за задачей: запуск в оркестраторе + сессия агента +
 * метрика повторов + следующая фаза по workflow.
 *
 * Сессия ищется в двух каталогах (главный репо и worktree задачи): worktree
 * создаётся на первой «кодовой» фазе (plan/do), и сессия фазы живёт там.
 */
export function collectTaskObservation(cwd: string, task: Task, phaseHint?: string): TaskObservation {
  const run = getRun(task.id);
  const workflow = getWorkflowForTask(cwd, task);
  const nextPhase = getNextPhase(workflow, task.status);

  const dirs = [agentSessionsDir(cwd), agentSessionsDir(taskWorktreeDir(cwd, task.id))];
  let sessionId: string | null = null;
  let sessionDir = dirs[0]!;
  for (const dir of dirs) {
    const found =
      (phaseHint !== undefined && phaseHint !== '' ? findTaskPhaseSessionSync(dir, task.id, phaseHint) : null) ??
      findLatestTaskSessionSync(dir, task.id);
    if (found) {
      sessionId = found;
      sessionDir = dir;
      break;
    }
  }

  const obs: TaskObservation = {
    running: run?.running === true,
    status: task.status,
    ...(nextPhase !== null ? { nextPhase } : {}),
    ...(run?.phase !== undefined ? { phase: run.phase } : {}),
    ...(run?.pid !== undefined ? { pid: run.pid } : {}),
    ...(run?.exitCode !== undefined && run.exitCode !== null ? { exitCode: run.exitCode } : {}),
    ...(run?.logTail !== undefined ? { logTail: run.logTail } : {}),
    sessionId,
  };
  // VL-289: результат фазы — первичный сигнал лечения.
  // 1) основной источник — запись рана (getRun отдаёт aborted/abortedReason
  //    из PhaseRun, куда их положил оркестратор до финализации транзиента);
  // 2) fallback — маркер в комментарии задачи: lastRuns живёт в памяти и
  //    после рестарта `vibelog browser` пуст, а след в задаче остаётся.
  if (run?.aborted === true) {
    obs.aborted = true;
    if (run.abortedReason !== undefined) obs.abortedReason = run.abortedReason.slice(0, ABORTED_REASON_CHARS);
  } else if (run === null || run === undefined) {
    // Fallback включается ТОЛЬКО без записи рана (рестарт процесса). Если ран
    // есть и признака нет — верить комментарию нельзя: в задаче мог остаться
    // старый aborted-комментарий прошлой фазы (ложное срабатывание на норме).
    const fromComments = detectAbortedFromComments(task);
    if (fromComments !== null) {
      obs.aborted = true;
      if (fromComments.reason !== '') obs.abortedReason = fromComments.reason;
    }
  }
  // Последний комментарий фазы нужен и для обычных падений: «что фаза успела
  // сказать» — единственный содержательный диагноз, если лог пуст.
  const lastComment = lastAgentComment(task);
  if (lastComment !== undefined) obs.lastComment = lastComment;
  if (sessionId) {
    const meta = loadSessionMetaSync(sessionDir, sessionId);
    if (meta) {
      if (meta.last_run?.is_error === true) {
        obs.lastRunError = meta.last_run.finishedAt
          ? `ран завершился с ошибкой (${meta.last_run.finishedAt})`
          : 'ран завершился с ошибкой';
      }
      if (meta.finishedAt) obs.finishedAt = meta.finishedAt;
      if (meta.repeat_stats) {
        obs.repeatStats = {
          tool_calls_total: meta.repeat_stats.tool_calls_total,
          repeat_calls: meta.repeat_stats.repeat_calls,
          repeat_share: meta.repeat_stats.repeat_share,
          top: meta.repeat_stats.top.map(e => ({ key: e.key, count: e.count })),
        };
      }
    }
    if (obs.repeatStats === undefined) {
      const stats = analyzeToolRepeatsFromJsonlSync(sessionDir, sessionId);
      if (stats) {
        obs.repeatStats = {
          tool_calls_total: stats.tool_calls_total,
          repeat_calls: stats.repeat_calls,
          repeat_share: stats.repeat_share,
          top: stats.top.map(e => ({ key: e.key, count: e.count })),
        };
      }
    }
  }
  return obs;
}

/** Строка «top_repeats» для шаблона комментария: `read_file src/a.ts ×6, …`. */
export function formatTopRepeats(stats: TaskObservation['repeatStats']): string {
  if (!stats || stats.top.length === 0) return 'повторов не зафиксировано';
  return stats.top
    .slice(0, 5)
    .map(e => `${e.key} ×${e.count}`)
    .join(', ');
}

/**
 * Подстановки шаблона комментария (AC7): `{top_repeats}`, `{fail_reason}`,
 * `{task_id}`, `{attempt}`. Неизвестные подстановки остаются как есть —
 * шаблон правит модель, и «съесть» её текст молча нельзя.
 */
export function renderCommentTemplate(
  template: string,
  vars: { topRepeats?: string; failReason?: string; taskId?: string; attempt?: number },
): string {
  return template
    .replace(/\{top_repeats\}/g, vars.topRepeats ?? 'повторов не зафиксировано')
    .replace(/\{fail_reason\}/g, vars.failReason ?? 'причина не зафиксирована')
    .replace(/\{task_id\}/g, vars.taskId ?? '')
    .replace(/\{attempt\}/g, vars.attempt === undefined ? '' : String(vars.attempt));
}

/**
 * Healing уровня 1: первое совпавшее правило (doc-19 §12).
 *
 * Семантика `when`: `repeat_share_min` и `repeat_calls_min` — оба должны
 * выполниться (AND, это одно измерение «много повторов»); `fail_reason_contains`
 * — любая подстрока (OR, это перечисление вариантов одной причины);
 * `status_unchanged` — фаза завершилась без смены статуса.
 *
 * @returns сработавшее правило либо null (тогда решение отдаётся модели — L2)
 */
export function matchHealRule(
  rules: HealRule[],
  ctx: {
    repeatShare: number;
    repeatCalls: number;
    failReason: string;
    statusUnchanged: boolean;
    /** VL-289: фаза сама сообщила aborted (нужны действия человека). */
    aborted?: boolean;
  },
): HealRule | null {
  const reason = ctx.failReason.toLowerCase();
  for (const rule of rules) {
    const when = rule.when;
    let ok = true;

    if (when.repeat_share_min !== undefined && !(ctx.repeatShare >= when.repeat_share_min)) ok = false;
    if (ok && when.repeat_calls_min !== undefined && !(ctx.repeatCalls >= when.repeat_calls_min)) ok = false;
    if (ok && when.fail_reason_contains !== undefined) {
      const hit = when.fail_reason_contains.some(s => reason.includes(s.toLowerCase()));
      if (!hit) ok = false;
    }
    if (ok && when.status_unchanged !== undefined && ctx.statusUnchanged !== when.status_unchanged) ok = false;
    // VL-289: aborted — отдельное измерение «фаза просит человека»; строгое
    // сравнение (undefined ≠ true), чтобы правило не срабатывало на обычных ранах
    if (ok && when.aborted !== undefined && (ctx.aborted === true) !== when.aborted) ok = false;

    if (ok) return rule;
  }
  return null;
}

/**
 * Общий предок для пары задач: блокирующая связь в ЛЮБУЮ сторону — жёсткий
 * запрет параллели (AC12). Считается по `dependencies` и обратному `blocks`.
 */
export function hasDependencyTie(cwd: string, a: Task, b: Task): boolean {
  const canon = (x: string): string => x.toUpperCase();
  const aBlocksB = blockedBy(cwd, b).some(t => canon(t.id) === canon(a.id));
  const bBlocksA = blockedBy(cwd, a).some(t => canon(t.id) === canon(b.id));
  return aBlocksB || bBlocksA;
}

/** Компонентные метки задачи (пересечение по ним — риск конфликта файлов). */
function componentLabels(task: Task): string[] {
  return (task.labels ?? []).filter(l => COMPONENT_LABELS.includes(l));
}

/**
 * Совместима ли пара задач для параллели в режиме conservative: у ОБЕИХ должны
 * быть известные компонентные метки, и они не должны пересекаться. Нет меток —
 * риск неизвестен, и «обосновать» его нельзя (doc-19 §14: не смог обосновать —
 * последовательно).
 *
 * `modified_files` намеренно НЕ используется (AC13): поле заполняется только
 * фазой code, а worktree создаётся на plan/do — признак просто пуст.
 */
export function conservativeCompatible(a: Task, b: Task): boolean {
  const la = componentLabels(a);
  const lb = componentLabels(b);
  if (la.length === 0 || lb.length === 0) return false;
  return !la.some(l => lb.includes(l));
}

/** Результат планировщика: группы + человекочитаемое обоснование по каждой. */
export interface ParallelPlan {
  groups: string[][];
  rationale: string[];
}

/**
 * Планировщик параллельности (doc-19 §14).
 *
 * Жёсткие ограничения независимо от режима:
 * - пара с зависимостью в любую сторону никогда не попадает в одну группу;
 * - в группе не больше `allowed` задач, где `allowed` — ОСТАТОК лимита
 *   `max_parallel_phases` за вычетом уже идущих фаз (AC24: лимит считается по
 *   числу одновременно работающих фаз, а не по числу задач).
 *
 * `conservative`: группа из решения модели принимается, только если модель дала
 * её обоснование И пары внутри совместимы по компонентным меткам; иначе группа
 * распадается, а остаток идёт последовательно (по одной задаче в группе).
 * `aggressive`: группы модели не требуют обоснования, свободные задачи
 * сливаются жадно.
 *
 * @param candidates — ID задач, готовых к запуску (в порядке приоритета)
 * @param decisionGroups — группы от модели (пусто — значит модель не группировала)
 * @param rationale — обоснования модели по ключу `id1,id2`
 * @param allowed — сколько фаз можно запустить СЕЙЧАС (уже с учётом лимита)
 */
export function planParallel(
  cwd: string,
  candidates: string[],
  mode: ParallelMode,
  maxParallel: number,
  allowed: number,
  decisionGroups: string[][] = [],
  rationale: Record<string, string> = {},
): ParallelPlan {
  const tasks = new Map<string, Task>();
  const order: string[] = [];
  for (const id of candidates) {
    const task = getTask(cwd, id);
    if (!task) continue;
    tasks.set(task.id, task);
    order.push(task.id);
  }
  const limit = Math.max(0, Math.min(allowed, maxParallel));
  const groups: string[][] = [];
  const notes: string[] = [];
  const placed = new Set<string>();

  const compatible = (a: string, b: string): boolean => {
    const ta = tasks.get(a);
    const tb = tasks.get(b);
    if (!ta || !tb) return false;
    if (hasDependencyTie(cwd, ta, tb)) return false;
    if (mode === 'conservative') return conservativeCompatible(ta, tb);
    return true;
  };

  // 1. Группы модели: валидируем состав и обоснование
  for (const raw of decisionGroups) {
    const ids = raw.filter(id => tasks.has(id) && !placed.has(id));
    if (ids.length === 0) continue;
    if (ids.length === 1) {
      placed.add(ids[0]!);
      groups.push([ids[0]!]);
      notes.push(`${ids[0]} — одиночная группа из решения модели`);
      continue;
    }
    const key = ids.join(',');
    if (mode === 'conservative' && (rationale[key] ?? '') === '') {
      notes.push(
        `${ids.join(' + ')} — модель не обосновала группу → запускаем последовательно (conservative, doc-19 §14)`,
      );
      for (const id of ids) {
        placed.add(id);
        groups.push([id]);
      }
      continue;
    }
    // Разбиваем предложенную группу на совместимые части (зависимости/метки)
    const parts: string[][] = [];
    for (const id of ids) {
      let put = false;
      for (const part of parts) {
        if (part.every(other => compatible(other, id))) {
          part.push(id);
          put = true;
          break;
        }
      }
      if (!put) parts.push([id]);
    }
    for (const part of parts) {
      for (const id of part) placed.add(id);
      groups.push(part);
      notes.push(
        part.length > 1
          ? `${part.join(' + ')} — ${rationale[key] ?? 'обоснование модели'}`
          : `${part[0]} — отдельно (зависимость или общая компонентная метка внутри группы модели)`,
      );
    }
  }

  // 2. Остальные кандидаты: conservative — по одной, aggressive — жадно до лимита
  for (const id of order) {
    if (placed.has(id)) continue;
    if (mode === 'aggressive') {
      let put = false;
      for (const group of groups) {
        if (group.length >= limit) continue;
        if (group.every(other => compatible(other, id))) {
          group.push(id);
          put = true;
          break;
        }
      }
      if (put) {
        notes.push(`${id} — добавлена в группу (aggressive, без обоснования)`);
        placed.add(id);
        continue;
      }
    }
    placed.add(id);
    groups.push([id]);
    if (mode === 'conservative') notes.push(`${id} — последовательно (нет обоснования группы)`);
  }

  return { groups, rationale: notes };
}

/** Короткая причина для заголовка авто-бага: первая строка, обрезка. */
function shortReason(text: string | undefined): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (line === '') return 'причина не зафиксирована';
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

/** FNV-1a по цепочке правил — маркер дедупа авто-бага. */
function chainHash(chain: string[]): string {
  let hash = 0x811c9dc5;
  const text = chain.join('>');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Контекст для авто-бага (AC11). */
export interface AutoBugContext {
  taskId: string;
  phase: string;
  failReason: string;
  logTail?: string;
  sessionId?: string | null;
  ruleChain?: string[];
  sourceTaskTitle: string;
  /** VL-289: дословная причина, которую сообщила фаза в aborted. */
  abortedReason?: string;
  /** VL-289: последний комментарий фазы — «что агент успел сказать». */
  lastComment?: { author: string; created: string; text: string };
}

/**
 * Создаёт баг-задачу автоматически (doc-19 §13, AC11): статус Spec, метки
 * `auto-bug` + имя фазы, детерминированное описание.
 *
 * Связь с исходной задачей — упоминанием в описании, а не `dependencies`:
 * зависимость от незавершённой задачи сделала бы баг-задачу заблокированной
 * (`isReady` не пустил бы её в работу) — это описано в Implementation Notes.
 *
 * Дедуп: если по этой же задаче и той же цепочке правил баг уже открыт
 * (маркер в описании), новый не создаётся — иначе зацикливание порождало бы
 * лавину багов.
 */
export function createAutoBug(cwd: string, ctx: AutoBugContext): { id: string; title: string; created: boolean } {
  const chain = ctx.ruleChain ?? [];
  const marker = `auto-bug: ${canonicalTaskId(ctx.taskId)}|${chainHash(chain)}`;
  const existing = listTasks(cwd).find(
    t => (t.labels ?? []).includes('auto-bug') && (t.description ?? '').includes(marker),
  );
  if (existing) return { id: existing.id, title: existing.title, created: false };

  // VL-289: причина от самой фазы первична — если агент сообщил aborted,
  // заголовок и описание строятся от его текста, а не от «нет прогресса».
  const abortedReason = (ctx.abortedReason ?? '').trim();
  const hasAbortedReason = abortedReason !== '';
  const reasonText = hasAbortedReason ? abortedReason : ctx.failReason;
  const title = hasAbortedReason
    ? `[авто] ${ctx.phase} ${ctx.taskId}: фаза прервана — ${shortReason(abortedReason)}`
    : `[авто] ${ctx.phase} ${ctx.taskId}: ${shortReason(ctx.failReason)}`;
  const tail = tailLines(ctx.logTail, LOG_TAIL_LINES_BUG);
  const descriptionParts: string[] = [
    '## Причина',
    reasonText.trim() === '' ? 'причина не зафиксирована' : reasonText.trim(),
    '',
  ];
  // Секция «что сообщила фаза»: дословный текст отчёта агента при aborted.
  // Без неё описание авто-бага состояло из «10 попыток без прогресса» и
  // пустого лога (инциденты VL-287/VL-288) — разбирать было нечего.
  if (hasAbortedReason) {
    descriptionParts.push(
      '## Что сообщила фаза (aborted)',
      '',
      abortedReason,
      '',
      'Фаза сама заявила, что нужны действия человека: перезапуск детерминированно ' +
        'воспроизведёт причину, автоматическое лечение остановлено.',
      '',
    );
  }
  // Последний отчёт фазы — независимо от aborted: при обычном падении это
  // единственный содержательный диагноз, когда лог пуст.
  if (
    ctx.lastComment !== undefined &&
    ctx.lastComment.text.trim() !== '' &&
    ctx.lastComment.text.trim() !== abortedReason
  ) {
    descriptionParts.push(
      '## Последний отчёт фазы',
      '',
      `${ctx.lastComment.author} (${ctx.lastComment.created}): ${ctx.lastComment.text}`,
      '',
    );
  }
  const description = [
    ...descriptionParts,
    '## Последние строки лога',
    '```',
    tail === ''
      ? hasAbortedReason
        ? '(лог пуст) — см. отчёт фазы выше'
        : '(лог пуст)'
      : tail,
    '```',
    '',
    '## Сессия',
    ctx.sessionId
      ? `${ctx.sessionId} — .vibelog/agent-sessions/${ctx.sessionId}.jsonl`
      : 'сессия агента не найдена',
    '',
    '## Цепочка лечения',
    chain.length > 0
      ? chain.map((ruleId, i) => `- попытка ${i + 1}: ${ruleId}`).join('\n')
      : '- правила не срабатывали (исчерпаны попытки по умолчанию)',
    '',
    '## Исходная задача',
    `${ctx.taskId}: ${ctx.sourceTaskTitle}`,
    '',
    `<!-- ${marker} -->`,
  ].join('\n');

  const task = createTaskFile(cwd, {
    title,
    description,
    status: 'Spec',
    type: 'bug',
    labels: ['auto-bug', ctx.phase],
    priority: 'High',
  });
  return { id: task.id, title: task.title, created: true };
}

/** Извлекает JSON-объект решения: fenced ```json, иначе первый сбалансированный. */
export function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    const body = fenced[1].trim();
    if (body.startsWith('{')) return body;
  }
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Проверяет, что значение — массив строк. */
function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return null;
    out.push(item.trim());
  }
  return out;
}

/**
 * Парсит решение модели. Невалидный ответ — не исключение, а `{decision: null,
 * error}`: тик уходит в фолбэк (AC: мусорный ответ не роняет цикл).
 *
 * Отдельно отбрасываются попытки «назначить фазу» (`phase: "analyze"` и любой
 * другой phase в лечебных записях): фаза выбирается workflow, а `analyze`
 * read-only и для лечения не используется (doc-19 §12, AC10, AC23).
 */
export function parseTickDecision(text: string): { decision: TickDecision | null; error?: string; notes: string[] } {
  const notes: string[] = [];
  const raw = extractJsonObject(text);
  if (raw === null) return { decision: null, error: 'в ответе нет JSON-объекта', notes };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { decision: null, error: `JSON не разобран: ${(err as Error).message}`, notes };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { decision: null, error: 'решение не является объектом', notes };
  }
  const body = parsed as Record<string, unknown>;

  const action = typeof body.action === 'string' && DECISION_ACTIONS.includes(body.action as DecisionAction)
    ? (body.action as DecisionAction)
    : null;
  if (action === null) {
    return { decision: null, error: `action вне набора ${DECISION_ACTIONS.join('|')}`, notes };
  }

  const groups: string[][] = [];
  if (body.groups !== undefined) {
    if (!Array.isArray(body.groups)) return { decision: null, error: 'groups должен быть массивом массивов', notes };
    for (const g of body.groups) {
      const ids = stringArray(g);
      if (ids === null) return { decision: null, error: 'groups: элементы должны быть массивами непустых строк', notes };
      groups.push(ids);
    }
  }

  const rationale: Record<string, string> = {};
  if (body.rationale !== undefined) {
    if (body.rationale === null || typeof body.rationale !== 'object' || Array.isArray(body.rationale)) {
      return { decision: null, error: 'rationale должен быть объектом', notes };
    }
    for (const [key, value] of Object.entries(body.rationale as Record<string, unknown>)) {
      if (typeof value === 'string') rationale[key] = value;
    }
  }

  const heal: TickDecision['heal'] = [];
  for (const entry of parseEntries(body.heal, 'heal', notes)) heal.push(entry.raw);
  const bug: TickDecision['bug'] = [];
  for (const entry of parseEntries(body.bug, 'bug', notes)) bug.push(entry.raw);
  const stop: TickDecision['stop'] = [];
  for (const entry of parseEntries(body.stop, 'stop', notes)) stop.push(entry.raw);

  const decision: TickDecision = { action, groups, rationale, heal, bug, stop };
  if (typeof body.reason === 'string') decision.reason = body.reason;
  if (typeof body.diagnosis === 'string') decision.diagnosis = body.diagnosis;
  if (body.tuning !== null && typeof body.tuning === 'object' && !Array.isArray(body.tuning)) {
    decision.tuning = body.tuning as Record<string, unknown>;
  }
  return { decision, notes };
}

/**
 * Разбор массива лечебных записей. Каждая запись обязана иметь непустой
 * `taskId`; `phase` в записи означает попытку назначить фазу — запись
 * отбрасывается с note (фазы выбирает workflow, AC23).
 */
function parseEntries(
  value: unknown,
  kind: 'heal' | 'bug' | 'stop',
  notes: string[],
): { raw: { taskId: string; comment?: string; reason?: string } }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    notes.push(`${kind}: ожидался массив — секция проигнорирована`);
    return [];
  }
  const out: { raw: { taskId: string; comment?: string; reason?: string } }[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      notes.push(`${kind}: запись не объект — проигнорирована`);
      continue;
    }
    const entry = item as Record<string, unknown>;
    const taskId = typeof entry.taskId === 'string' ? entry.taskId.trim() : '';
    if (taskId === '') {
      notes.push(`${kind}: запись без taskId — проигнорирована`);
      continue;
    }
    if (entry.phase !== undefined) {
      notes.push(
        `${kind} ${taskId}: попытка назначить фазу "${String(entry.phase)}" — отброшена (фазу определяет workflow, analyze для лечения не используется)`,
      );
      continue;
    }
    const raw: { taskId: string; comment?: string; reason?: string } = { taskId };
    if (typeof entry.comment === 'string' && entry.comment.trim() !== '') raw.comment = entry.comment;
    if (typeof entry.reason === 'string' && entry.reason.trim() !== '') raw.reason = entry.reason;
    out.push({ raw });
  }
  return out;
}

/** Секция промпта с бюджетом: обрезается последней, с явной пометкой. */
function fit(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const note = `\n... [промпт усечён по бюджету ${budget} символов]`;
  // Пометка об усечении входит в бюджет: иначе «усечённый» промпт оказывался
  // бы ДЛИННЕЕ лимита, и бюджет превращался бы в фикцию.
  return `${text.slice(0, Math.max(0, budget - note.length))}${note}`;
}

/**
 * Собирает промпт тика (AC3): heartbeat + правила лечения + grant + кандидаты
 * + диагностика падений + прошлое решение + контракт ответа.
 *
 * Сырые логи целиком не попадают: только хвост (≤ LOG_TAIL_LINES_PROMPT строк)
 * и топ-3 повторов. Бюджет `maxPromptChars` — жёсткий, усечение помечается в
 * тексте (модель видит, что данные обрезаны, и не «додумывает» их).
 */
export function buildTickPrompt(
  cwd: string,
  args: {
    state: SupervisorTickState;
    heal: HealConfig;
    runtimeErrors: string[];
    grant: SupervisorGrant;
    heartbeat: string;
    candidates: string[];
    failing: { taskId: string; obs: TaskObservation; state: SupervisorTaskState }[];
    lastDecision: SupervisorTickState['lastDecision'];
    maxChars?: number;
  },
): string {
  const budget = args.maxChars ?? MAX_TICK_PROMPT_CHARS;
  const parts: string[] = [];

  parts.push(
    'Ты — супервизор прогона фаз Vibelog. Реши, что запустить сейчас, что лечить и что завести багом. ' +
      'Ты НЕ вызываешь инструменты и НЕ назначаешь фазы: фазу каждой задачи определяет workflow.',
  );

  parts.push('## Heartbeat', '', fit(args.heartbeat.trim(), Math.floor(budget * 0.4)), '');

  const rulesView = args.heal.rules.map(r => ({
    id: r.id,
    when: r.when,
    action: r.action,
  }));
  parts.push(
    '## Правила лечения (уровень 1, применяет код до тебя)',
    '',
    '```json',
    JSON.stringify({ heal_rules: rulesView, default_action: args.heal.defaultAction }, null, 2),
    '```',
    '',
    'Правила уже сопоставлены с упавшими фазами: если сработало правило — действие выполнено без тебя. ' +
      'Твоя часть (уровень 2) — содержательный разбор: упавшие тесты, ошибочный план, «нет прогресса». ' +
      'Для содержательного разбора НЕ вызывай и не предлагай фазу analyze (она read-only).',
    '',
  );

  if (args.runtimeErrors.length > 0 || args.heal.errors.length > 0) {
    parts.push('## Предупреждения конфигурации', '');
    for (const err of [...args.runtimeErrors, ...args.heal.errors]) parts.push(`- ${err}`);
    parts.push('');
  }

  parts.push(
    '## Прогон',
    '',
    `- runId: ${args.grant.runId}`,
    `- режим группировки: ${args.state.mode}`,
    `- задачи прогона: ${args.grant.taskIds.join(', ')}`,
    `- grant до: ${args.grant.expiresAt}`,
    `- тик: ${args.state.tick}`,
    '',
  );

  if (args.candidates.length > 0) {
    parts.push('## Готовы к запуску', '');
    for (const id of args.candidates) {
      const task = getTask(cwd, id);
      if (!task) continue;
      const deps = blockedBy(cwd, task).map(t => t.id);
      parts.push(
        `- ${id} [${task.priority}] ${task.title}` +
          ` (тип ${task.type ?? 'task'}, метки ${(task.labels ?? []).join('/') || 'нет'}` +
          (deps.length > 0 ? `, ждёт ${deps.join(',')}` : '') +
          ')',
      );
      const desc = (task.description ?? '').replace(/\s+/g, ' ').trim();
      if (desc !== '') parts.push(`  описание: ${desc.slice(0, 400)}`);
    }
    parts.push('');
  }

  if (args.failing.length > 0) {
    parts.push('## Упавшие фазы (нужен твой разбор)', '');
    for (const item of args.failing) {
      parts.push(`### ${item.taskId} — фаза ${item.state.phase}, попыток ${item.state.attempt}, лечение ${item.state.healAttempts}`);
      parts.push(`- причина: ${item.obs.lastRunError ?? item.state.lastError ?? 'не зафиксирована'}`);
      // VL-289: результат фазы — первичный вход разбора. Без этих двух строк
      // модель видела только «нет прогресса» и не могла понять, что агент
      // просил человека (инцидент VL-285: merge-конфликт).
      if (item.obs.aborted === true || item.state.aborted === true) {
        const why = item.obs.abortedReason ?? item.state.abortedReason ?? 'причина не указана';
        parts.push(`- фаза сама сообщила: aborted — ${why}`);
      }
      if (item.obs.lastComment !== undefined) {
        parts.push('#### Отчёт фазы', '', fit(item.obs.lastComment.text, 400), '');
      }
      if (item.obs.repeatStats) {
        const top = item.obs.repeatStats.top.slice(0, 3).map(e => `${e.key} ×${e.count}`).join(', ');
        parts.push(
          `- повторы: ${item.obs.repeatStats.repeat_calls}/${item.obs.repeatStats.tool_calls_total} ` +
            `(доля ${item.obs.repeatStats.repeat_share})${top ? `; топ: ${top}` : ''}`,
        );
      }
      if (item.state.ruleChain && item.state.ruleChain.length > 0) {
        parts.push(`- уже срабатывали правила: ${item.state.ruleChain.join(' → ')}`);
      }
      const tail = tailLines(item.obs.logTail, LOG_TAIL_LINES_PROMPT);
      if (tail !== '') parts.push('- хвост лога (фрагмент):', '```', tail, '```');
      parts.push('');
    }
  }

  const d = args.lastDecision;
  parts.push(
    '## Прошлое решение',
    '',
    `- тик ${d.tick}: ${d.action}${d.ruleId ? ` (правило ${d.ruleId})` : ''}${d.taskId ? ` по ${d.taskId}` : ''}`,
    `- причина: ${d.reason || '—'}`,
    '',
  );

  parts.push(
    '## Контракт ответа',
    '',
    'Верни РОВНО один JSON-объект (без текста вокруг — он тоже допустим, но парсится только объект):',
    '',
    '```json',
    '{',
    '  "action": "run|heal|bug|stop|wait",',
    '  "reason": "кратко, почему так",',
    '  "diagnosis": "разбор содержательных ошибок (упавшие тесты/ошибочный план)",',
    '  "groups": [["VL-1","VL-2"]],',
    '  "rationale": {"VL-1,VL-2": "разные подсистемы: web и docs, файлы не пересекаются"},',
    '  "heal": [{"taskId":"VL-3","comment":"директива фазе: ...","reason":"что понял"}],',
    '  "bug": [{"taskId":"VL-4","reason":"почему дальше лечить бессмысленно"}],',
    '  "stop": [{"taskId":"VL-5","reason":"почему остановить"}],',
    '  "tuning": {"heal_rules":[...],"default_action":"bug","reason":"почему меняю правило"}',
    '}',
    '```',
    '',
    'Правила:',
    `- режим ${args.state.mode}: ` +
      (args.state.mode === 'conservative'
        ? 'каждую группу ОБЯЗАТЕЛЬНО обоснуй в rationale (разные компонентные метки) — без обоснования фазы пойдут последовательно.'
        : 'обоснование группы не требуется.'),
    '- задачи с зависимостями (dependencies/blocks) параллельно не запускаются никогда — не предлагай.',
    '- задачи с незакрытыми зависимостями («Заблокированы зависимостями» в heartbeat, в списке готовых их нет) не ' +
      'предлагай ни к запуску, ни к retry: причина внешняя, перезапуск фазы её не устранит.',
    '- фазы в решении не указывай: их определяет workflow; analyze для лечения не используется.',
    '- запрещено править max_parallel_phases, heal_attempts, allow_self_tuning, parallel_mode — это страховочные поля пользователя.',
    '- запрещено подделывать прогресс: не отмечай фазы выполненными, не меняй статусы (backlog_finish_phase тебе недоступен).',
    '- не запускай задачу, которой нет в списке задач прогона.',
    '- фаза, которая сама сообщила aborted, НЕ перезапускается: если причина требует человека ' +
      'или внешнего действия — bug, иначе stop; retry запрещён (перезапуск воспроизведёт причину).',
  );

  return fit(parts.join('\n'), budget);
}

/** Активный grant (или null) — прогон без grant не наблюдается. */
function activeGrant(cwd: string): SupervisorGrant | null {
  return findActiveGrant(cwd);
}

/** Ключ grant'а для снимка состояния: истечение/отзыв меняют снимок. */
function grantKeyOf(grant: SupervisorGrant): string {
  return `${grant.runId}:${grant.expiresAt}:${grant.revokedAt ?? ''}:${grant.taskIds.join(',')}`;
}

/** Начальное состояние прогона из grant'а (первый тик после confirm). */
export function initialState(cwd: string, grant: SupervisorGrant, now: Date): SupervisorTickState {
  const runtime = resolveSupervisorRuntime(cwd);
  return {
    runId: grant.runId,
    mode: runtime.parallelMode,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    tick: 0,
    lastDecision: { tick: 0, action: 'wait', reason: 'прогон создан, решений ещё не было' },
    tasks: {},
    tuning: { applied: 0 },
    wakeAt: new Date(now.getTime() + runtime.tickSeconds * 1000).toISOString(),
  };
}

/** Порог «фаза протухла»: wall-time из настроек, иначе полчаса. */
function stalePhaseMs(cwd: string): number {
  const raw = loadSettings(cwd).max_wall_time;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw * 1000;
  return STALE_PHASE_FALLBACK_MS;
}

/** Идущая фаза держится дольше допустимого без смены статуса. */
function phaseStale(entry: SupervisorTaskState, now: Date, staleMs: number): boolean {
  if (entry.status !== 'running' || entry.startedAt === undefined) return false;
  const started = Date.parse(entry.startedAt);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started > staleMs;
}

/**
 * Один тик супервизора: сбор состояния → heartbeat/state → wake gate → модель →
 * применение решения (doc-19 §5).
 *
 * Побочных эффектов вне `.vibelog/supervisor/`, задач и запусков фаз нет.
 * Функция не бросает: любая ошибка возвращается в `errors` (тик обязан выжить,
 * иначе один сломанный конфиг остановит ночной прогон).
 */
export async function runSupervisorTick(cwd: string, deps: TickDeps = {}): Promise<TickResult> {
  const now = nowOf(deps);
  const result: TickResult = {
    decision: 'unchanged',
    llmCalled: false,
    started: [],
    healed: [],
    bugs: [],
    stopped: [],
    blocked: [],
    errors: [],
    statePath: statePath(cwd),
    heartbeatPath: heartbeatPath(cwd),
  };

  if (process.env.VIBELOG_SUPERVISOR_TICK === 'off') {
    result.skipped = 'disabled';
    result.decision = 'no-grant';
    return result;
  }

  const grant = activeGrant(cwd);
  if (!grant) {
    result.skipped = 'no-grant';
    result.decision = 'no-grant';
    return result;
  }

  const runtime = resolveSupervisorRuntime(cwd);
  const heal = loadHealRules(cwd);
  const state = loadState(cwd) ?? initialState(cwd, grant, now);
  state.mode = runtime.parallelMode;
  state.tick += 1;
  state.updatedAt = now.toISOString();
  state.wakeAt = new Date(now.getTime() + runtime.tickSeconds * 1000).toISOString();
  // Предупреждения обоих конфигов — в отчёт тика: битое правило лечения не
  // должно исчезать молча, иначе пользователь не узнает, что его правило
  // выпало и работает что-то другое (AC8).
  result.errors.push(...runtime.errors, ...heal.errors);

  // ── 1. Сбор состояния ─────────────────────────────────────────────────────
  const observations: Record<string, TaskObservation> = {};
  const candidates: string[] = [];
  const l2Tasks: { taskId: string; obs: TaskObservation; state: SupervisorTaskState }[] = [];
  const staleMs = stalePhaseMs(cwd);

  for (const id of grant.taskIds) {
    const task = getTask(cwd, id);
    if (!task) continue;
    // Ключи состояния канонические (VL-N): grant и план пишут их в верхнем
    // регистре, а task.id из файла приходит в нижнем. Без канонизации тик
    // «терял» бы состояние задачи и заводил её заново каждый тик.
    const key = canonicalTaskId(task.id);
    const prev: SupervisorTaskState = state.tasks[key] ?? {
      phase: '',
      status: 'pending',
      attempt: 0,
      healAttempts: 0,
    };
    const obs = collectTaskObservation(cwd, task, prev.phase);
    // Метрика повторов не должна «теряться»: если текущий ран её не оставил
    // (упал до post-run), берём последнюю известную из состояния — иначе
    // правило repeat-loop перестало бы срабатывать именно тогда, когда оно
    // нужнее всего (после падения по зацикливанию).
    if (obs.repeatStats === undefined && prev.lastRepeatStats !== undefined) {
      obs.repeatStats = prev.lastRepeatStats;
    }
    observations[key] = obs;
    const entry: SupervisorTaskState = { ...prev };

    if (entry.status === 'running' && !entry.frozen) {
      // Сервисные фазы (comment/prompt) статуса не меняют ПО ЗАМЫСЛУ — их
      // завершение не «нет прогресса», а «директива доставлена»: после них
      // задача возвращается в pending и получает рабочую фазу по workflow.
      // Без этого различия лечение уровня 1 (comment_and_retry) съедало бы
      // лечебную попытку на собственную же директиву.
      const servicePhase = SERVICE_PHASES.includes(entry.phase);
      if (entry.statusAtStart !== undefined && obs.status !== entry.statusAtStart) {
        // Статус сменился — фаза дала прогресс, независимо от того, жив процесс
        entry.status = 'done';
        entry.healAttempts = 0;
        entry.ruleChain = [];
        entry.pid = undefined;
        entry.phaseRunId = undefined;
      } else if (!phaseAlive(state, key) && !obs.running) {
        if (servicePhase) {
          // Директива доставлена: следующий тик возьмёт рабочую фазу заново
          entry.status = 'pending';
          entry.phase = obs.nextPhase ?? entry.phase;
          entry.nextPhase = obs.nextPhase;
          entry.pid = undefined;
          entry.phaseRunId = undefined;
        } else {
          // Причина падения ищется в порядке достоверности: мета сессии
          // (реальный fail_reason рана) → ранее известная причина → общая
          // формулировка с признаком мёртвого pid (диагностика рестарта AC19).
          // Прежний `lastError` терять нельзя: именно по нему работают правила
          // лечения (fail_reason_contains), и подмена его текстом «процесса
          // нет» отключила бы payload-limit/wall-timeout целиком.
          const deadNote =
            entry.pid !== undefined && !isPidAlive(entry.pid)
              ? `процесс фазы не найден (pid ${entry.pid}) — вероятен рестарт vibelog browser`
              : 'фаза завершилась без смены статуса задачи (нет прогресса)';
          // VL-289: заявление фазы («нужен человек») важнее прочих причин —
          // именно его увидят промпт тика и авто-баг
          const reason = obs.abortedReason ?? obs.lastRunError ?? entry.lastError ?? deadNote;
          entry.status = 'failed';
          entry.lastError = reason;
          entry.pid = undefined;
          entry.phaseRunId = undefined;
        }
      } else if (phaseStale(entry, now, staleMs)) {
        entry.status = 'failed';
        entry.lastError = `фаза ${entry.phase} идёт дольше допустимого без смены статуса (wall-time ${Math.round(staleMs / 1000)} с)`;
        entry.pid = undefined;
        entry.phaseRunId = undefined;
      } else {
        entry.status = 'running';
      }
    } else if (!entry.frozen && obs.running) {
      // Фазу запустили вне супервизора (доска/бот) — принимаем как факт
      entry.status = 'running';
      entry.phase = obs.phase ?? entry.phase;
      entry.pid = obs.pid;
      entry.startedAt = entry.startedAt ?? now.toISOString();
      entry.statusAtStart = entry.statusAtStart ?? obs.status;
      entry.attempt += 1;
    }

    if (entry.status !== 'running' && !entry.frozen) {
      const terminal = ['done', 'completed', 'rejected'].includes(obs.status.toLowerCase());
      const nextPhase = obs.nextPhase;
      if (terminal || nextPhase === undefined) {
        entry.status = 'done';
        if (nextPhase === undefined) entry.nextPhase = undefined;
      } else {
        entry.status = entry.status === 'failed' ? 'failed' : 'pending';
        entry.nextPhase = nextPhase;
        entry.phase = entry.status === 'failed' ? entry.phase : nextPhase;
      }
    }

    state.tasks[key] = entry;

    // VL-289: признак aborted живёт в состоянии до старта новой фазы. Пишем
    // его только для не-идущей фазы (у живой рана нет), снимаем при старте —
    // иначе признак «прилипнет» и после успешного перезапуска фаза снова
    // попадёт под правило «нужен человек».
    if (entry.status === 'running') {
      delete entry.aborted;
      delete entry.abortedReason;
    } else if (obs.aborted === true) {
      entry.aborted = true;
      if (obs.abortedReason !== undefined) entry.abortedReason = obs.abortedReason;
    } else {
      delete entry.aborted;
      delete entry.abortedReason;
    }

    // ── Незакрытые зависимости (VL-275) ──────────────────────────────────────
    // Планировщик прогона и автоочередь фильтруют задачи по isReady, а тик —
    // нет: он пушил в candidates ВСЕ не-терминальные задачи. Из-за этого фазы
    // задачи с незакрытой зависимостью (VL-239 при незакрытой VL-209, которой
    // в прогоне не было) запускались, не могли дать прогресс и сжигали
    // heal_attempts на правило no-progress — лечилось следствие, а не причина.
    // Живую фазу не трогаем: остановка работающего процесса — не наша задача.
    if (!entry.frozen && entry.status !== 'running') {
      const blockers = blockedBy(cwd, task)
        .filter(d => d.status !== 'Done' && d.status !== 'Completed' && d.status !== 'Rejected')
        .map(d => canonicalTaskId(d.id));
      const terminal = ['done', 'completed', 'rejected'].includes(obs.status.toLowerCase());
      // Гейт — isReady (единая точка правды, что и в планировщике/автоочереди),
      // список ниже — для человекочитаемого текста «ждёт VL-X». Rejected-блокер
      // в список не попадает (isReady его «готовым» не считает, но ждать
      // отклонённую зависимость вечно нельзя) — задача остаётся доступной.
      if (!isReady(cwd, task) && blockers.length > 0 && !terminal) {
        entry.blockedBy = blockers;
        // pending, а не failed: задача не запускалась и не «упала» — она ждёт,
        // и попытки лечения тут не расходуются (AC3).
        entry.status = 'pending';
        entry.phase = obs.nextPhase ?? entry.phase;
        entry.nextPhase = obs.nextPhase;
        entry.pid = undefined;
        entry.phaseRunId = undefined;
        result.blocked.push({ taskId: key, blockers });
        continue; // ни в l2Tasks (лечение), ни в candidates (запуск)
      }
      delete entry.blockedBy; // зависимости закрылись — задача снова доступна
    }

    if (entry.status === 'failed' && !entry.frozen) {
      l2Tasks.push({ taskId: key, obs, state: entry });
    }
    if (entry.status === 'pending' && !entry.frozen) {
      // Метрику повторов сохраняем в состояние: следующее падение этой фазы
      // должно опираться на неё (правило repeat-loop читает lastRepeatStats).
      if (obs.repeatStats !== undefined) entry.lastRepeatStats = obs.repeatStats;
      candidates.push(key);
    }
    if (obs.repeatStats !== undefined) entry.lastRepeatStats = obs.repeatStats;
  }

  // ── 2. Healing уровня 1 (детерминированный, без модели) ───────────────────
  const stillFailing: { taskId: string; obs: TaskObservation; state: SupervisorTaskState }[] = [];
  for (const item of l2Tasks) {
    const entry = state.tasks[item.taskId]!;
    if (entry.status !== 'failed') continue;
    if (entry.healAttempts >= runtime.healAttempts) {
      // AC9: лечение исчерпано → авто-баг и стоп по задаче
      const bug = createAutoBug(cwd, {
        taskId: item.taskId,
        phase: entry.phase,
        failReason: item.obs.lastRunError ?? entry.lastError ?? 'причина не зафиксирована',
        logTail: item.obs.logTail,
        sessionId: item.obs.sessionId ?? null,
        ruleChain: [...(entry.ruleChain ?? []), 'heal_attempts-exhausted'],
        sourceTaskTitle: getTask(cwd, item.taskId)?.title ?? item.taskId,
        // VL-289: причина и последний отчёт фазы — в описание авто-бага
        ...(item.obs.abortedReason !== undefined ? { abortedReason: item.obs.abortedReason } : {}),
        ...(item.obs.lastComment !== undefined ? { lastComment: item.obs.lastComment } : {}),
      });
      entry.ruleChain = [...(entry.ruleChain ?? []), 'heal_attempts-exhausted'];
      entry.frozen = true;
      entry.status = 'done';
      result.bugs.push({ taskId: item.taskId, bugId: bug.id });
      result.healed.push({ taskId: item.taskId, ruleId: 'heal_attempts-exhausted', action: 'bug' });
      continue;
    }

    const statusUnchanged =
      entry.statusAtStart !== undefined && item.obs.status === entry.statusAtStart && !item.obs.running;
    const rule = matchHealRule(heal.rules, {
      repeatShare: item.obs.repeatStats?.repeat_share ?? 0,
      repeatCalls: item.obs.repeatStats?.repeat_calls ?? 0,
      failReason: `${item.obs.lastRunError ?? ''} ${entry.lastError ?? ''}`,
      statusUnchanged,
      // VL-289: фаза сама сказала «нужен человек» — правило
      // aborted-requires-human стоит первым и даёт bug без retry
      aborted: item.obs.aborted === true,
    });
    if (rule === null) {
      stillFailing.push(item); // уровень 2 — решение модели
      continue;
    }
    const applied = applyHealAction(cwd, runtime, entry, rule.action, {
      ruleId: rule.id,
      comment: rule.commentTemplate,
      taskId: item.taskId,
      obs: item.obs,
      now,
    });
    result.healed.push({ taskId: item.taskId, ruleId: rule.id, action: rule.action });
    if (applied.bugId) result.bugs.push({ taskId: item.taskId, bugId: applied.bugId });
    if (applied.stopped) result.stopped.push(item.taskId);
    if (applied.started) result.started.push(item.taskId);
  }

  // ── 3. Wake gate ─────────────────────────────────────────────────────────
  const grantKey = grantKeyOf(grant);
  const keyNow = snapshotKey(state, observations, grantKey);
  const hasFailing = stillFailing.length > 0;
  const nothingToDo = candidates.length === 0 && !hasFailing;
  if (keyNow === state.snapshotHash && nothingToDo) {
    // Ничего не изменилось: heartbeat обновляется, модель НЕ вызывается (AC2)
    const heartbeat = writeHeartbeat(cwd, state, {
      grant: { runId: grant.runId, expiresAt: grant.expiresAt, active: true },
      running: true,
      ruleErrors: [...runtime.errors, ...heal.errors],
      observations,
    });
    state.snapshotHash = keyNow;
    saveState(cwd, state);
    result.skipped = 'unchanged';
    result.decision = 'unchanged';
    void heartbeat;
    return result;
  }

  // ── 4. Модель: план групп и разбор содержательных ошибок ─────────────────
  const llm = resolveLlm(cwd, deps);
  let decision: TickDecision | null = null;
  let decisionError: string | null = null;
  if (candidates.length > 0 || stillFailing.length > 0) {
    const heartbeat = writeHeartbeat(cwd, state, {
      grant: { runId: grant.runId, expiresAt: grant.expiresAt, active: true },
      running: true,
      ruleErrors: [...runtime.errors, ...heal.errors],
      observations,
    });
    if (llm === null) {
      decisionError = 'LLM не настроен — детерминированный фолбэк';
    } else {
      const prompt = buildTickPrompt(cwd, {
        state,
        heal,
        runtimeErrors: runtime.errors,
        grant,
        heartbeat,
        candidates,
        failing: stillFailing,
        lastDecision: state.lastDecision,
        ...(deps.maxPromptChars !== undefined ? { maxChars: deps.maxPromptChars } : {}),
      });
      result.prompt = prompt;
      try {
        const text = await llm.ask(prompt);
        result.llmCalled = true;
        const parsed = parseTickDecision(text);
        if (parsed.decision === null) decisionError = parsed.error ?? 'решение не разобрано';
        else {
          decision = parsed.decision;
          result.errors.push(...parsed.notes);
        }
      } catch (err) {
        result.llmCalled = true;
        decisionError = `вызов модели не удался: ${(err as Error).message}`;
      }
    }
  }

  // ── 5. Применение решения ────────────────────────────────────────────────
  const rationale: string[] = [];
  const groupsInput = decision?.groups ?? [];
  const rationaleInput = decision?.rationale ?? {};
  const activePhases = activeCountImpl() + Object.keys(state.tasks).filter(id => phaseAlive(state, id)).length;
  const allowed = Math.max(0, runtime.maxParallelPhases - activePhases);

  const plan = planParallel(cwd, candidates, state.mode, runtime.maxParallelPhases, allowed, groupsInput, rationaleInput);
  rationale.push(...plan.rationale);

  // Последовательная посадка: запускаем группы по порядку, но не больше лимита
  let startedCount = 0;
  let groupIndex = 0;
  const startedIds: string[] = [];
  for (const group of plan.groups) {
    if (startedCount >= allowed) break;
    groupIndex += 1;
    const groupId = `g${groupIndex}`;
    for (const id of group) {
      if (startedCount >= allowed) break;
      const entry = state.tasks[id];
      if (!entry || entry.frozen) continue;
      // Заблокированную задачу не запускаем даже по решению модели (VL-275):
      // прогресса она не даст, а попытки лечения сгорят на no-progress.
      if ((entry.blockedBy?.length ?? 0) > 0) {
        result.blocked.push({ taskId: id, blockers: entry.blockedBy! });
        continue;
      }
      const phase = entry.nextPhase ?? entry.phase;
      if (phase === '') continue;
      const res = startPhaseImpl(cwd, id, phase, {});
      if ('error' in res) {
        result.errors.push(`${id}: ${res.error}`);
        continue;
      }
      entry.status = 'running';
      entry.phase = phase;
      entry.attempt += 1;
      entry.groupId = groupId;
      entry.startedAt = now.toISOString();
      entry.statusAtStart = getTask(cwd, id)?.status ?? entry.statusAtStart;
      entry.pid = res.pid;
      entry.phaseRunId = makePhaseRunId(id, phase, entry.attempt);
      // VL-289: новая фаза стартовала — старый признак aborted снимаем,
      // иначе он «прилипнет» и следующее падение снова уйдёт в bug без retry
      delete entry.aborted;
      delete entry.abortedReason;
      startedIds.push(id);
      startedCount += 1;
    }
  }

  // Лечение уровня 2 из решения модели
  for (const item of decision?.heal ?? []) {
    const id = canonicalTaskId(item.taskId);
    const entry = state.tasks[id];
    if (!entry || entry.frozen) continue;
    if (entry.healAttempts >= runtime.healAttempts) {
      const bug = createAutoBug(cwd, {
        taskId: id,
        phase: entry.phase,
        failReason: item.reason ?? entry.lastError ?? 'причина не зафиксирована',
        logTail: observations[id]?.logTail,
        sessionId: observations[id]?.sessionId ?? null,
        ruleChain: [...(entry.ruleChain ?? []), 'l2:model'],
        sourceTaskTitle: getTask(cwd, id)?.title ?? id,
        ...(observations[id]?.abortedReason !== undefined
          ? { abortedReason: observations[id]!.abortedReason }
          : {}),
        ...(observations[id]?.lastComment !== undefined
          ? { lastComment: observations[id]!.lastComment }
          : {}),
      });
      entry.frozen = true;
      entry.ruleChain = [...(entry.ruleChain ?? []), 'l2:model'];
      entry.status = 'done';
      result.bugs.push({ taskId: id, bugId: bug.id });
      continue;
    }
    const applied = applyHealAction(cwd, runtime, entry, 'comment_and_retry', {
      ruleId: 'l2:model',
      comment: item.comment ?? 'Разбор супервизора: предыдущий запуск не дал результата. Проверь причину и продолжи работу.',
      taskId: id,
      obs: observations[id],
      now,
    });
    result.healed.push({ taskId: id, ruleId: 'l2:model', action: 'comment_and_retry' });
    if (applied.bugId) result.bugs.push({ taskId: id, bugId: applied.bugId });
    if (applied.stopped) result.stopped.push(id);
    if (applied.started) result.started.push(id);
  }

  // Задачи, по которым модель ничего не сказала: default_action (AC9)
  const covered = new Set((decision?.heal ?? []).map(h => canonicalTaskId(h.taskId)));
  for (const h of decision?.bug ?? []) covered.add(canonicalTaskId(h.taskId));
  for (const s of decision?.stop ?? []) covered.add(canonicalTaskId(s.taskId));
  for (const item of stillFailing) {
    const entry = state.tasks[item.taskId];
    if (!entry || entry.frozen || entry.status === 'running') continue;
    if (covered.has(item.taskId) || startedIds.includes(item.taskId)) continue;
    // default_action применяется независимо от того, что модель сказала «wait»
    // про прогон в целом: если содержательного разбора по КОНКРЕТНОЙ задаче
    // не дано, значит правило по умолчанию — единственное решение. Иначе при
    // пассивном/недоступном LLM детерминированное лечение не срабатывало бы
    // и упавшая фаза висела бы вечно (AC9).
    const action = heal.defaultAction;
    if ((action as string) === 'wait') continue;
    const applied = applyHealAction(cwd, runtime, entry, action, {
      ruleId: 'default_action',
      taskId: item.taskId,
      obs: item.obs,
      now,
    });
    result.healed.push({ taskId: item.taskId, ruleId: 'default_action', action });
    if (applied.bugId) result.bugs.push({ taskId: item.taskId, bugId: applied.bugId });
    if (applied.stopped) result.stopped.push(item.taskId);
    if (applied.started) result.started.push(item.taskId);
  }

  // Явные bug/stop из решения
  for (const item of decision?.bug ?? []) {
    const id = canonicalTaskId(item.taskId);
    const entry = state.tasks[id];
    if (!entry || entry.frozen) continue;
    const bug = createAutoBug(cwd, {
      taskId: id,
      phase: entry.phase,
      failReason: item.reason ?? entry.lastError ?? 'причина не зафиксирована',
      logTail: observations[id]?.logTail,
      sessionId: observations[id]?.sessionId ?? null,
      ruleChain: [...(entry.ruleChain ?? []), 'l2:bug'],
      sourceTaskTitle: getTask(cwd, id)?.title ?? id,
      ...(observations[id]?.abortedReason !== undefined
        ? { abortedReason: observations[id]!.abortedReason }
        : {}),
      ...(observations[id]?.lastComment !== undefined
        ? { lastComment: observations[id]!.lastComment }
        : {}),
    });
    entry.frozen = true;
    entry.status = 'done';
    entry.ruleChain = [...(entry.ruleChain ?? []), 'l2:bug'];
    result.bugs.push({ taskId: id, bugId: bug.id });
  }
  for (const item of decision?.stop ?? []) {
    const id = canonicalTaskId(item.taskId);
    const entry = state.tasks[id];
    if (!entry || entry.frozen) continue;
    entry.frozen = true;
    entry.status = 'done';
    entry.lastError = `остановлено супервизором: ${item.reason ?? 'без причины'}`;
    result.stopped.push(id);
  }

  // Самонастройка (AC14) — только при allow_self_tuning
  if (decision?.tuning && Object.keys(decision.tuning).length > 0) {
    if (!runtime.allowSelfTuning) {
      const patchKeys = Object.keys(decision.tuning).join(', ');
      result.errors.push(`самонастройка отклонена: allow_self_tuning=false (патч: ${patchKeys})`);
    } else {
      const tuned = applySelfTuning(
        cwd,
        heal,
        decision.tuning,
        decision.reason ?? decision.diagnosis ?? '',
        now,
      );
      result.errors.push(...tuned.rejected);
      if (tuned.tuningLogLine !== null) {
        state.tuning = { applied: state.tuning.applied + 1, last: tuned.tuningLogLine };
      }
    }
  }

  // ── 6. state + heartbeat ─────────────────────────────────────────────────
  state.updatedAt = now.toISOString();
  const action: SupervisorTickState['lastDecision']['action'] =
    decision === null
      ? (result.bugs.length > 0 ? 'bug' : startedIds.length > 0 ? 'fallback' : 'wait')
      : (decision.action === 'wait' && decisionError !== null
          ? 'fallback'
          : (decision.action as SupervisorTickState['lastDecision']['action']));
  state.lastDecision = {
    tick: state.tick,
    action: decisionError !== null && decision === null && (startedIds.length > 0 || result.bugs.length > 0)
      ? 'fallback'
      : action,
    reason:
      decision?.reason ??
      decision?.diagnosis ??
      decisionError ??
      (startedIds.length > 0 ? 'детерминированный фолбэк: последовательный запуск готовых задач' : 'изменений нет'),
    ...(decision !== null ? {} : {}),
    ...(result.healed.length > 0 ? { ruleId: result.healed[result.healed.length - 1]!.ruleId } : {}),
    ...(startedIds.length > 0 ? { taskId: startedIds[0]! } : {}),
  };
  const finalKey = snapshotKey(state, observations, grantKey);
  state.snapshotHash = finalKey;

  const heartbeat = writeHeartbeat(cwd, state, {
    grant: { runId: grant.runId, expiresAt: grant.expiresAt, active: true },
    running: true,
    groupsRationale: rationale,
    ruleErrors: [...runtime.errors, ...heal.errors],
    observations,
  });
  void heartbeat;
  saveState(cwd, state);

  result.started = [...new Set([...result.started, ...startedIds])];
  result.decision = decision !== null ? 'llm' : 'fallback';
  return result;
}

/** Результат применения лечебного действия. */
interface AppliedHeal {
  started?: boolean;
  stopped?: boolean;
  bugId?: string;
}

/**
 * VL-276: текст причины отказа доставки директивы/перезапуска.
 *
 * Различает транспортную природу отказа (лок оркестратора: «Запуск уже
 * выполняется», «Фаза уже идёт») от содержательной — по этой строке в
 * heartbeat и авто-баге видно, что дело в транспорте, а не в самой задаче.
 * Иначе разбор инцидента снова упирался бы в догадки (VL-248).
 */
export function classifyDeliveryError(error: string, base: string): string {
  if (/Запуск уже выполняется|уже идёт|уже в очереди/i.test(error)) {
    return `фаза занята локом оркестратора (транспорт): ${error}`;
  }
  return `${base}: ${error}`;
}

/**
 * Применяет действие лечения к задаче.
 *
 * `retry` — перезапуск той же фазы с `--resume` последней сессии (VL-200):
 * агент продолжает транскрипт, а не начинает заново (инцидент VL-197: потеря
 * 36 tool-вызовов). `comment_and_retry` — директива уходит фазой `comment`
 * (AC7: `startTaskPhase(cwd, id, 'comment', { comment })`), а рестарт рабочей
 * фазы следует за ней отдельным запуском: одновременно две фазы одной задачи
 * запускать нельзя (guard оркестратора), поэтому шаги разведены по тикам.
 * `bug` — авто-баг + стоп по задаче, `stop` — просто стоп.
 */
function applyHealAction(
  cwd: string,
  runtime: { healAttempts: number },
  entry: SupervisorTaskState,
  action: HealAction | 'wait',
  ctx: {
    ruleId: string;
    comment?: string;
    taskId: string;
    obs?: TaskObservation;
    now: Date;
  },
): AppliedHeal {
  entry.ruleChain = [...(entry.ruleChain ?? []), ctx.ruleId];
  const obs = ctx.obs;
  const task = getTask(cwd, ctx.taskId);

  const doBug = (reason: string): AppliedHeal => {
    const bug = createAutoBug(cwd, {
      taskId: ctx.taskId,
      phase: entry.phase,
      // VL-289: заявление самой фазы («нужен человек») первичнее общей
      // формулировки «нет прогресса»
      failReason: obs?.abortedReason ?? reason,
      logTail: obs?.logTail,
      sessionId: obs?.sessionId ?? null,
      ruleChain: entry.ruleChain ?? [],
      sourceTaskTitle: task?.title ?? ctx.taskId,
      ...(obs?.abortedReason !== undefined ? { abortedReason: obs.abortedReason } : {}),
      ...(obs?.lastComment !== undefined ? { lastComment: obs.lastComment } : {}),
    });
    entry.frozen = true;
    entry.status = 'done';
    entry.pid = undefined;
    entry.phaseRunId = undefined;
    return { bugId: bug.id };
  };

  if (action === 'bug') {
    return doBug(obs?.lastRunError ?? entry.lastError ?? 'причина не зафиксирована');
  }
  if (action === 'stop') {
    entry.frozen = true;
    entry.status = 'done';
    entry.pid = undefined;
    entry.phaseRunId = undefined;
    entry.lastError = `остановлено супервизором по правилу ${ctx.ruleId}`;
    return { stopped: true };
  }
  if (action === 'retry_once_then_bug' && entry.healAttempts >= runtime.healAttempts) {
    return doBug(obs?.lastRunError ?? entry.lastError ?? 'причина не зафиксирована');
  }
  // Защита-в-глубину (VL-275): задача ждёт зависимость — перезапуск фазы и
  // директиву не выполняем. Причина внешняя, прогресса не будет, а heal-бюджет
  // сгорит на no-progress (именно так сгорел прогон VL-239). Обычный путь до
  // сюда не доходит: заблокированные задачи не попадают в l2Tasks.
  if ((entry.blockedBy?.length ?? 0) > 0) {
    entry.lastError = `перезапуск отменён: задача ждёт зависимости ${entry.blockedBy!.join(', ')}`;
    return {};
  }

  const failReason = obs?.lastRunError ?? entry.lastError ?? '';
  if (action === 'comment_and_retry') {
    const template =
      ctx.comment ??
      'Разбор супервизора: предыдущий запуск не дал результата ({fail_reason}). Продолжи работу: следующий шаг — правка, а не чтение.';
    const text = renderCommentTemplate(template, {
      topRepeats: formatTopRepeats(obs?.repeatStats),
      failReason,
      taskId: ctx.taskId,
      attempt: entry.healAttempts + 1,
    });
    const res = startPhaseImpl(cwd, ctx.taskId, 'comment', { comment: text });
    if ('error' in res) {
      // VL-276: неудачная доставка директивы — ТОЖЕ попытка лечения. Раньше
      // healAttempts не рос, статус оставался прежним → следующий тик повторял
      // ровно тот же безуспешный шаг, пока не сгорал весь прогон (инцидент
      // VL-248: «Запуск уже выполняется» вечно, status_unchanged, прогресса нет).
      entry.healAttempts += 1;
      entry.status = 'failed';
      entry.pid = undefined;
      entry.phaseRunId = undefined;
      entry.lastError = classifyDeliveryError(res.error, 'директива не доставлена');
      console.log(
        `[supervisor] ${ctx.taskId}: доставка директивы (${ctx.ruleId}) не удалась — ` +
          `попытка ${entry.healAttempts}/${runtime.healAttempts}: ${entry.lastError}`
      );
      return {};
    }
    entry.healAttempts += 1;
    entry.status = 'running';
    entry.phase = 'comment';
    entry.attempt += 1;
    entry.startedAt = ctx.now.toISOString();
    entry.statusAtStart = task?.status ?? entry.statusAtStart;
    entry.pid = res.pid;
    entry.phaseRunId = makePhaseRunId(ctx.taskId, 'comment', entry.attempt);
    return { started: true };
  }

  // retry / retry_once_then_bug (до исчерпания) / default_action retry
  const phase = entry.phase === '' ? (obs?.nextPhase ?? 'plan') : entry.phase;
  const extraArgs = retryResumeArgs(cwd, ctx.taskId, phase);
  const res = startPhaseImpl(cwd, ctx.taskId, phase, {
    ...(extraArgs.length > 0 ? { extraArgs } : {}),
  });
  if ('error' in res) {
    // VL-276: та же логика, что и в ветке comment_and_retry — неудачный
    // перезапуск расходует бюджет лечения, иначе цикл «тик → тот же отказ →
    // тик» бесконечен и задача никогда не дойдёт до авто-бага.
    entry.healAttempts += 1;
    entry.status = 'failed';
    entry.pid = undefined;
    entry.phaseRunId = undefined;
    entry.lastError = classifyDeliveryError(res.error, 'перезапуск фазы не удался');
    console.log(
      `[supervisor] ${ctx.taskId}: перезапуск фазы ${phase} (${ctx.ruleId}) не удался — ` +
        `попытка ${entry.healAttempts}/${runtime.healAttempts}: ${entry.lastError}`
    );
    return {};
  }
  entry.healAttempts += 1;
  entry.status = 'running';
  entry.phase = phase;
  entry.attempt += 1;
  entry.groupId = undefined;
  entry.startedAt = ctx.now.toISOString();
  entry.statusAtStart = task?.status ?? entry.statusAtStart;
  entry.pid = res.pid;
  entry.phaseRunId = makePhaseRunId(ctx.taskId, phase, entry.attempt);
  return { started: true };
}

// ── Таймер тика ────────────────────────────────────────────────────────────

let tickTimer: NodeJS.Timeout | null = null;
let ticking = false;

/**
 * Заводит таймер тика в процессе `vibelog browser` (doc-19 §5).
 *
 * Таймер поднимается ТОЛЬКО при активном grant: без прогона наблюдать нечего,
 * а лишний LLM-вызов стоит денег. `unref()` — таймер не держит процесс
 * (иначе `server.close()` в тестах вешал бы воркер). Флаг `ticking` не даёт
 * тикам накладываться, если предыдущий ещё считает.
 *
 * Точки вызова (VL-272): старт сервера, когда grant уже лежит на диске
 * (`src/web/server.ts`), и выдача grant'а в `startSupervisorRun`
 * (`src/web/supervisor.ts`) — сервер к этому моменту обычно запущен раньше
 * grant'а, поэтому одной серверной точки мало. Гасится `stopSupervisorTimer`
 * (stop прогона, авто-отзыв grant'а, `server.close`/`server.on('error')`)
 * либо собственным self-stop'ом, когда тик увидел отсутствие/истечение grant'а.
 *
 * @returns true — таймер поставлен (grant активен); false — не заведён
 */
export function startSupervisorTimer(cwd: string, opts: { llm?: TickLlm | null; intervalMs?: number } = {}): boolean {
  if (process.env.VIBELOG_SUPERVISOR_TICK === 'off') return false;
  if (tickTimer !== null) return true;
  if (findActiveGrant(cwd) === null) return false;

  const runtime = resolveSupervisorRuntime(cwd);
  const intervalMs = opts.intervalMs ?? runtime.tickSeconds * 1000;
  const run = (): void => {
    if (ticking) return;
    ticking = true;
    const deps: TickDeps = 'llm' in opts ? { ...(opts.llm !== undefined ? { llm: opts.llm } : {}) } : {};
    void runSupervisorTick(cwd, deps)
      .then(res => {
        // VL-272: grant истёк или отозван — интервалу больше нечего наблюдать
        // (модель и так не вызывается, skipped='no-grant'), а новый grant
        // поднимет таймер заново из startSupervisorRun. Без этого само-стопа
        // истечение expiresAt заметить некому: тик «молотил» бы до конца
        // процесса, а heartbeat выглядел бы живым при мёртвом прогоне.
        if (res.skipped === 'no-grant') stopSupervisorTimer();
      })
      .catch(err => {
        console.error(`[supervisor] тик упал: ${(err as Error).message}`);
      })
      .finally(() => {
        ticking = false;
      });
  };
  tickTimer = setInterval(run, intervalMs);
  (tickTimer as unknown as { unref?: () => void }).unref?.();
  return true;
}

/** Останавливает таймер тика (server.close, stop прогона, тесты). */
export function stopSupervisorTimer(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** Идёт ли таймер тика (диагностика и тесты). */
export function isSupervisorTimerRunning(): boolean {
  return tickTimer !== null;
}

/** Каталог супервизора (создаётся лениво) — экспорт для отладки/тестов. */
export function supervisorDataDir(cwd: string): string {
  return join(cwd, '.vibelog', 'supervisor');
}

/** Читает heartbeat.md (для чата/отладки). */
export function readHeartbeat(cwd: string): string | null {
  const path = heartbeatPath(cwd);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Гарантирует каталог супервизора (используется тестами/чатом). */
export function ensureSupervisorDir(cwd: string): string {
  const dir = supervisorDataDir(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Публичный доступ к реэкспорту DEFAULT_HEAL_ACTION (промпт/тесты). */
export { DEFAULT_HEAL_ACTION, PROTECTED_SUPERVISOR_KEYS };