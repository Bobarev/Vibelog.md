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
import { createTask, markdownToTask, taskToMarkdown, taskFilename } from './task.mjs';
import { draftsDir, completedDir } from './paths.mjs';

/** Статус черновика — свободный (как в оригинале; при promote заменяется). */
export const DRAFT_STATUS = 'Draft';

/**
 * Следующий id вида draft-N (max+1).
 *
 * @param {Array<{task: object}>} entries
 * @returns {string}
 */
function nextDraftId(entries) {
  let max = 0;
  for (const e of entries) {
    const m = String(e.task.id).match(/^draft-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `draft-${max + 1}`;
}

/**
 * Читает все черновики из backlog/drafts/.
 *
 * @param {string} backlogDir
 * @returns {Array<{task: object, path: string}>}
 */
export function listDrafts(backlogDir) {
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
 *
 * @param {string} backlogDir
 * @param {string} id
 * @returns {{task: object, path: string}|null}
 */
export function getDraft(backlogDir, id) {
  const needle = String(id).toLowerCase();
  return listDrafts(backlogDir).find(e => e.task.id.toLowerCase() === needle) || null;
}

/**
 * Создаёт черновик-файл (id draft-N, статус Draft).
 *
 * @param {string} backlogDir
 * @param {object} input — { title, description, labels, priority }
 * @param {object} config — конфиг проекта (loadConfig)
 * @returns {object} — созданный черновик (объект задачи)
 */
export function writeDraft(backlogDir, input, config) {
  const dir = draftsDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const id = nextDraftId(listDrafts(backlogDir));
  const task = createTask({ ...input, id, status: DRAFT_STATUS }, config);
  writeFileSync(join(dir, taskFilename(task)), taskToMarkdown(task), 'utf-8');
  return task;
}

/**
 * Обновляет черновик. При смене title файл переименовывается.
 *
 * @param {string} backlogDir
 * @param {string} id
 * @param {object} updates — { title, description, labels, priority }
 * @returns {{task: object, path: string}|null}
 */
export function updateDraft(backlogDir, id, updates) {
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
 * @param {string} backlogDir
 * @param {string} id
 * @returns {boolean}
 */
export function archiveDraft(backlogDir, id) {
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
 * @param {string} path — путь к файлу черновика
 */
export function removeDraftFile(path) {
  try { unlinkSync(path); } catch { /* ignore */ }
}
