/**
 * Сводка «где я» — сбор данных для команды `vibelog status` (VL-341).
 *
 * Модуль ТОЛЬКО читает: ничего не запускает, не пишет файлов, не отзывает
 * grant. Форматирование живёт в `src/cli/commands/status.ts` — здесь чистые
 * данные, пригодные и для `--json`, и для человекочитаемого вывода.
 *
 * Источники (все уже существуют, новых модулей состояния не заводим):
 * - версия — `package.json` пакета (путь от `dist/core/`, не от cwd);
 * - проект/префикс и задачи — `loadConfig` + `listTasks` (core/store.ts);
 * - идущие фазы — `getRun` оркестратора + транзиент-кэш (там же `startedAt`
 *   и `pid`); JSONL-транскрипты сессий НЕ читаются (дорого и не нужно);
 * - автоочередь — `loadAutoQueue` (core/auto-queue.ts);
 * - grant супервизора — `findActiveGrant` (web/supervisor-grant.ts);
 * - git — `spawnSync('git', …)` без shell (инъекция невозможна).
 *
 * Инвариант устойчивости: каждая секция собирается в своём try/catch. Сбой
 * одного источника не рушит сводку — в секцию пишется `error`, остальные
 * остаются на месте (иначе `--json` терял бы стабильность ключей).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { findBacklogDir } from './paths.js';
import { loadConfig } from './config.js';
import { listTasks } from './store.js';
import { loadAutoQueue } from './auto-queue.js';
import { phaseTransientCachePath } from './phase-transient.js';
import { getRun } from '../web/orchestrator.js';
import { findActiveGrant } from '../web/supervisor-grant.js';
// Живость pid процесса фазы — та же проверка, что у recovery транзиента
import { isPidAlive } from './supervisor-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Идущая фаза: задача, фаза, pid и время старта. */
export interface StatusRun {
  taskId: string;
  phase: string;
  pid?: number;
  startedAt?: string;
}

/** Секция автоочереди (VL-191): флаг прогона + элементы по статусам. */
export interface StatusQueue {
  running: boolean;
  pending: string[];
  runningIds: string[];
  done: string[];
  failed: Array<{ id: string; reason: string }>;
  /** Причина сбоя чтения очереди (битый файл и т.п.); секция при этом на месте. */
  error?: string;
}

/** Секция grant супервизора (VL-268): активный прогон либо null. */
export interface StatusGrant {
  runId: string;
  taskIds: string[];
  expiresAt: string;
}

/** Секция git: ветка, изменённые/нетрекнутые файлы, ahead/behind. */
export interface StatusGit {
  branch: string;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
  /** false — upstream не настроен (ahead/behind тогда 0, а не ошибка). */
  upstream: boolean;
  error?: string;
}

/** Полная сводка проекта. */
export interface ProjectStatus {
  version: string;
  /** null — backlog/ не найден (команда не падает, но CLI вернёт код 1). */
  project: { name: string; taskPrefix: string } | null;
  tasks: { byStatus: Record<string, number>; total: number; error?: string };
  runs: StatusRun[];
  queue: StatusQueue;
  grant: StatusGrant | null;
  /** null — не git-репозиторий (это не ошибка). */
  git: StatusGit | null;
}

/** Опции сбора: `noGit` — не трогать git (большой репозиторий, `--no-git`). */
export interface CollectStatusOptions {
  noGit?: boolean;
}

/**
 * Версия пакета из `package.json`.
 *
 * Путь считается от `dist/core/` (два уровня вверх), а не от cwd: сводку
 * можно запускать в любом каталоге проекта. Сбой чтения → '0.0.0'.
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')) as {
      version?: string;
    };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Корень проекта для путей `.vibelog/`.
 *
 * В worktree задачи backlog живёт в главном репозитории, а `.vibelog/`
 * (очередь, grant'ы, транзиент-кэш) — рядом с ним. Поэтому корень берём как
 * родителя найденного `backlog/`, а не хардкодим `.vibelog` от cwd (риск из
 * плана VL-341). Нет backlog/ — работаем от cwd.
 */
function projectRoot(cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  return backlogDir ? dirname(backlogDir) : cwd;
}

/** Секция проекта и счётчиков задач; отсутствие backlog/ — не ошибка. */
function collectProject(cwd: string): Pick<ProjectStatus, 'project' | 'tasks'> {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    return { project: null, tasks: { byStatus: {}, total: 0 } };
  }
  let project: ProjectStatus['project'] = null;
  try {
    const config = loadConfig(cwd);
    project = {
      name: typeof config.project_name === 'string' ? config.project_name : '',
      taskPrefix: typeof config.task_prefix === 'string' ? config.task_prefix : '',
    };
  } catch (err) {
    // Конфиг битый — задачи всё равно попробуем посчитать
    project = { name: '', taskPrefix: '' };
    void err;
  }
  try {
    const tasks = listTasks(cwd);
    const byStatus: Record<string, number> = {};
    for (const task of tasks) {
      const status = task.status || '—';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    return { project, tasks: { byStatus, total: tasks.length } };
  } catch (err) {
    return { project, tasks: { byStatus: {}, total: 0, error: (err as Error).message } };
  }
}

/**
 * Идущие фазы.
 *
 * Два источника, оба без чтения JSONL-транскриптов:
 * 1. `getRun` оркестратора — точное состояние, но живёт в памяти процесса
 *    (в отдельном процессе CLI он пуст, поэтому это primary, а не единственный);
 * 2. транзиент-кэш `.vibelog/phase-in-progress.json` — межпроцессный, хранит
 *    `phase`/`pid`/`startedAt`; запись считается идущей, только если pid жив
 *    (`isPidAlive`), иначе это мёртвый остаток и в сводку он не попадает.
 */
function collectRuns(cwd: string): StatusRun[] {
  let cache: Record<string, { phase?: string; pid?: number; startedAt?: string }> = {};
  try {
    const parsed = JSON.parse(readFileSync(phaseTransientCachePath(projectRoot(cwd)), 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cache = parsed as typeof cache;
    }
  } catch {
    // Нет кэша/битый JSON — идущих фаз просто нет
    return [];
  }
  const runs: StatusRun[] = [];
  for (const [taskId, entry] of Object.entries(cache)) {
    try {
      const run = getRun(taskId);
      if (run && run.running === true) {
        runs.push({
          taskId,
          phase: run.phase ?? entry.phase ?? '',
          ...(typeof run.pid === 'number' ? { pid: run.pid } : entry.pid ? { pid: entry.pid } : {}),
          ...(typeof entry.startedAt === 'string' ? { startedAt: entry.startedAt } : {}),
        });
        continue;
      }
      // Другой процесс (бот/браузер): getRun пуст — верим кэшу с живым pid
      if (isPidAlive(entry.pid)) {
        runs.push({
          taskId,
          phase: entry.phase ?? '',
          ...(typeof entry.pid === 'number' ? { pid: entry.pid } : {}),
          ...(typeof entry.startedAt === 'string' ? { startedAt: entry.startedAt } : {}),
        });
      }
    } catch {
      // Сбой одного рана не должен скрывать остальные
    }
  }
  return runs.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

/** Секция автоочереди: отсутствие файла — остановленная очередь, не ошибка. */
function collectQueue(cwd: string): StatusQueue {
  const empty: StatusQueue = { running: false, pending: [], runningIds: [], done: [], failed: [] };
  try {
    const queue = loadAutoQueue(projectRoot(cwd));
    const result: StatusQueue = { ...empty, running: queue.running === true };
    for (const item of queue.tasks) {
      if (item.status === 'pending') result.pending.push(item.id);
      else if (item.status === 'running') result.runningIds.push(item.id);
      else if (item.status === 'done') result.done.push(item.id);
      else if (item.status === 'failed' || item.status === 'failed_permanent') {
        result.failed.push({ id: item.id, reason: item.fail_reason ?? '' });
      }
    }
    return result;
  } catch (err) {
    return { ...empty, error: (err as Error).message };
  }
}

/** Активный grant супервизора; нет прогона — null. */
function collectGrant(cwd: string): StatusGrant | null {
  try {
    const grant = findActiveGrant(projectRoot(cwd));
    if (!grant) return null;
    return { runId: grant.runId, taskIds: grant.taskIds, expiresAt: grant.expiresAt };
  } catch {
    return null;
  }
}

/** Запуск git без shell: инъекция через аргументы невозможна. */
function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (res.error || res.status !== 0) return { ok: false, out: '' };
  return { ok: true, out: res.stdout ?? '' };
}

/**
 * Секция git. Вне репозитория — null (пометка в выводе, не ошибка).
 *
 * `rev-list @{u}...HEAD` падает при отсутствии upstream — это штатное
 * состояние: ahead/behind = 0 и отдельный булев флаг `upstream: false`
 * (числа не подменяются текстом — иначе `--json` терял бы тип).
 *
 * Экспортируется (VL-416): MCP-инструмент `git_status` переиспользует ровно
 * эту сборку, а не копирует git-вызовы. `collectStatus` тянет задачи, очередь
 * и grant — для чтения состояния дерева это лишняя работа и лишние импорты
 * (`web/orchestrator`) в MCP-слое.
 */
export function collectGit(cwd: string): StatusGit | null {
  const inside = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out.trim() !== 'true') return null;
  try {
    const branchRes = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchRes.ok ? branchRes.out.trim() : '';
    const statusRes = git(cwd, ['-c', 'core.quotepath=false', 'status', '--porcelain']);
    let changed = 0;
    let untracked = 0;
    if (statusRes.ok) {
      for (const line of statusRes.out.split('\n')) {
        if (line.length < 3) continue;
        if (line.startsWith('??')) untracked += 1;
        else changed += 1;
      }
    }
    const counts = git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    let ahead = 0;
    let behind = 0;
    let upstream = false;
    if (counts.ok) {
      const [left, right] = counts.out.trim().split(/\s+/);
      behind = Number.parseInt(left ?? '0', 10) || 0;
      ahead = Number.parseInt(right ?? '0', 10) || 0;
      upstream = true;
    }
    return { branch, changed, untracked, ahead, behind, upstream };
  } catch (err) {
    return {
      branch: '',
      changed: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      upstream: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Собирает сводку проекта.
 *
 * @param cwd — директория проекта (обычно process.cwd())
 * @param opts — `noGit: true` пропускает git-секцию (git: null)
 */
export function collectStatus(cwd: string, opts: CollectStatusOptions = {}): ProjectStatus {
  const { project, tasks } = collectProject(cwd);
  return {
    version: readVersion(),
    project,
    tasks,
    runs: collectRuns(cwd),
    queue: collectQueue(cwd),
    grant: collectGrant(cwd),
    git: opts.noGit ? null : collectGit(cwd),
  };
}
