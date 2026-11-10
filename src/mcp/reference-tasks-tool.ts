/**
 * MCP-инструменты чтения задач из клона референса (VL-418).
 *
 * `backlog_list_tasks`/`backlog_view_task` жёстко привязаны к
 * `findBacklogDir(cwd)` — задачи ЧУЖОГО проекта агенту приходилось читать
 * через `read_file` по путям (листинг обрезался на 200 записей, без фильтра
 * по статусу и без разбора фронтматтера). Здесь — read-only пара
 * `reference_tasks` / `reference_task_view`.
 *
 * БЕЗОПАСНОСТЬ (главный риск задачи). Инструмент открывает чтение чужого
 * репозитория, поэтому:
 * 1. путь резолвится ТОЛЬКО через `referenceCloneDir` — в схеме инструмента
 *    нет аргумента `path`/`dir`, модель не может подсунуть произвольный путь;
 * 2. `realpathSync` каталога обязан лежать внутри `realpathSync` каталога
 *    `references/data/` — симлинк, ведущий наружу, отклоняется (тот же класс
 *    защиты, что `resolveInProject` в `src/agent/tools.ts`).
 *
 * Ядро чтения — `src/core/reference-tasks.ts` (чистые функции без MCP).
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { getReference, referenceCloneDir } from '../core/reference.js';
import { findBacklogDir, referencesDataDir } from '../core/paths.js';
import { listCloneTasks, getCloneTask, suggestCloneTaskIds } from '../core/reference-tasks.js';
import type { CloneTasksOptions } from '../core/reference-tasks.js';
import { ackRead, ackError } from './tool-result.js';

/** Аргументы MCP-инструмента (совместимо с `ToolArgs` в tools.ts). */
type ToolArgs = Record<string, unknown>;

/**
 * Резолвит каталог клона референса — ЕДИНСТВЕННАЯ точка получения пути.
 *
 * @param cwd — рабочая директория проекта (для поиска backlog и метаданных)
 * @param refId — ID reference (ref-N)
 * @throws если reference не найден, не type=repo, клон отсутствует или
 *   реальный путь клона выходит за `references/data/`
 */
export function resolveCloneDir(cwd: string, refId: string): string {
  const entry = getReference(cwd, refId);
  if (!entry) throw new Error(`Reference ${refId} не найден.`);
  const ref = entry.reference;
  if (ref.type !== 'repo') {
    throw new Error(`Reference ${refId}: задачи читаются только из type=repo (сейчас ${ref.type}).`);
  }
  const dir = referenceCloneDir(cwd, ref);
  if (!existsSync(dir)) {
    throw new Error(`Reference ${refId}: клон не найден (${dir}). Выполните reference_sync.`);
  }
  // Защита от симлинка наружу: реальный путь клона обязан лежать внутри
  // references/data/. Сравнение по realpath обеих сторон — иначе симлинк
  // внутри data/, ведущий в /etc, прошёл бы проверку по строке.
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const dataRoot = referencesDataDir(backlogDir);
  const realDir = realpathSync(dir);
  const realRoot = existsSync(dataRoot) ? realpathSync(dataRoot) : resolve(dataRoot);
  if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
    throw new Error(
      `Reference ${refId}: каталог клона выходит за references/data/ (${realDir}) — чтение отклонено.`,
    );
  }
  return realDir;
}

/** Приводит аргументы вызова к опциям ядра (без валидации значений — она в ядре). */
function toOptions(args: ToolArgs): CloneTasksOptions {
  const opts: CloneTasksOptions = {};
  if (typeof args.status === 'string') opts.status = args.status;
  if (typeof args.type === 'string') opts.type = args.type;
  if (Array.isArray(args.labels)) opts.labels = (args.labels as unknown[]).map(l => String(l));
  if (args.limit !== undefined) opts.limit = Number(args.limit);
  if (args.sort === 'id' || args.sort === 'updated' || args.sort === 'priority') opts.sort = args.sort;
  if (args.includeCompleted === true) opts.includeCompleted = true;
  return opts;
}

/**
 * `reference_tasks` — список задач из клона референса.
 *
 * Ответ — `ackRead` с `{reference, cloneDir, total, returned, tasks}`:
 * `total` — сколько всего совпало ДО лимита (прямая замена обрезанному
 * листингу на 200 записей), `returned` — сколько отдано.
 */
export function toolReferenceTasks(args: ToolArgs, cwd: string): string {
  const refId = String(args.reference ?? '').trim();
  if (!refId) return ackError('reference_tasks: не передан reference (ref-N).');
  let cloneDir: string;
  try {
    cloneDir = resolveCloneDir(cwd, refId);
  } catch (err) {
    return ackError((err as Error).message);
  }
  const opts = toOptions(args);
  const { tasks, total } = listCloneTasks(cloneDir, opts);
  const shown = tasks.length;
  const message = total > shown
    ? `Reference ${refId}: показано ${shown} из ${total} задач (limit=${shown}).`
    : `Reference ${refId}: задач ${total}.`;
  return ackRead(message, {
    reference: refId,
    cloneDir,
    total,
    returned: shown,
    tasks,
  });
}

/**
 * `reference_task_view` — полная задача из клона референса по ID.
 *
 * Неизвестный id → `ackError` со списком ближайших ID: агенту нужен список,
 * из которого он выберет существующий, а не догадка.
 */
export function toolReferenceTaskView(args: ToolArgs, cwd: string): string {
  const refId = String(args.reference ?? '').trim();
  if (!refId) return ackError('reference_task_view: не передан reference (ref-N).');
  const id = String(args.id ?? '').trim();
  if (!id) return ackError('reference_task_view: не передан id задачи (например VL-123).');
  let cloneDir: string;
  try {
    cloneDir = resolveCloneDir(cwd, refId);
  } catch (err) {
    return ackError((err as Error).message);
  }
  const task = getCloneTask(cloneDir, id);
  if (!task) {
    const near = suggestCloneTaskIds(cloneDir, id);
    const hint = near.length > 0 ? ` Ближайшие ID: ${near.join(', ')}.` : ' Задач в клоне нет.';
    return ackError(`Reference ${refId}: задача ${id} не найдена.${hint}`);
  }
  return ackRead(`Reference ${refId}: задача ${task.id} — ${task.title}`, {
    reference: refId,
    cloneDir,
    task,
  });
}
