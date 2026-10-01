/**
 * Модель черновиков (drafts) Vibelog.md.
 *
 * Черновик — task-shaped markdown-файл (id draft-N, статус Draft)
 * в backlog/drafts/. При promote создаётся полноценная задача
 * с префиксом из конфига, черновик удаляется.
 *
 * Совместимо с оригиналом Backlog.md (DRAFT_PREFIX = "draft",
 * cli.ts: draft create/list/view/edit/promote/archive).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createTask, markdownToTask, taskToMarkdown, taskFilename } from './task.js';
import type { Task } from './task.js';
import { draftsDir, completedDir } from './paths.js';

/** Статус черновика — свободный (как в оригинале; при promote заменяется). */
export const DRAFT_STATUS = 'Draft';

/** Запись черновика: объект задачи + путь к файлу. */
export interface DraftEntry {
  task: Task;
  path: string;
}

/** Входные данные черновика (create/edit). */
export interface DraftInput {
  title: string;
  description?: string;
  labels?: string[];
  priority?: string;
}

/**
 * Следующий id вида draft-N (max+1).
 */
function nextDraftId(entries: DraftEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = String(e.task.id).match(/^draft-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `draft-${max + 1}`;
}

/**
 * Читает все черновики из backlog/drafts/.
 */
export function listDrafts(backlogDir: string): DraftEntry[] {
  const dir = draftsDir(backlogDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const path = join(dir, f);
      return { task: markdownToTask(readFileSync(path, 'utf-8')), path };
    })
    .filter(e => e.task.id);
}

/**
 * Находит черновик по id (case-insensitive).
 */
export function getDraft(backlogDir: string, id: string): DraftEntry | null {
  const needle = String(id).toLowerCase();
  return listDrafts(backlogDir).find(e => e.task.id.toLowerCase() === needle) || null;
}

/**
 * Создаёт черновик-файл (id draft-N, статус Draft).
 *
 * @param config — конфиг проекта (loadConfig)
 * @returns созданный черновик (объект задачи)
 */
export function writeDraft(
  backlogDir: string,
  input: DraftInput,
  config: Record<string, unknown>
): Task {
  const dir = draftsDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const id = nextDraftId(listDrafts(backlogDir));
  const task = createTask({ ...input, id, status: DRAFT_STATUS }, config);
  writeFileSync(join(dir, taskFilename(task)), taskToMarkdown(task), 'utf-8');
  return task;
}

/**
 * Обновляет черновик. При смене title файл переименовывается.
 */
export function updateDraft(
  backlogDir: string,
  id: string,
  updates: Partial<Task>
): DraftEntry | null {
  const entry = getDraft(backlogDir, id);
  if (!entry) return null;

  const task = { ...entry.task, ...updates, id: entry.task.id };
  const newPath = join(draftsDir(backlogDir), taskFilename(task));
  writeFileSync(newPath, taskToMarkdown(task), 'utf-8');
  if (newPath !== entry.path && existsSync(entry.path)) {
    try { unlinkSync(entry.path); } catch { /* ignore */ }
  }
  return { task, path: newPath };
}

/**
 * Архивирует черновик — переносит файл в backlog/completed/.
 *
 * @returns true если архивация удалась
 */
export function archiveDraft(backlogDir: string, id: string): boolean {
  const entry = getDraft(backlogDir, id);
  if (!entry) return false;

  const target = join(completedDir(backlogDir), taskFilename(entry.task));
  mkdirSync(completedDir(backlogDir), { recursive: true });
  try {
    renameSync(entry.path, target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Удаляет файл черновика (после promote).
 *
 * @param path — путь к файлу черновика
 */
export function removeDraftFile(path: string): void {
  try { unlinkSync(path); } catch { /* ignore */ }
}
