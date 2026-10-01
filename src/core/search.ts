/**
 * Поиск задач Vibelog.md: текстовый запрос + фильтры полей.
 *
 * Текстовый substring-поиск (id/title/description/labels) и фильтры
 * точного совпадения (status/type/priority/project) — case-insensitive,
 * как в оригинале Backlog.md (task_search).
 */

import { listTasks } from './store.js';
import type { Task } from './task.js';

/** Фильтры поиска (все поля необязательны — как required: [] в оригинале). */
export interface SearchFilters {
  query?: string;
  status?: string;
  type?: string;
  priority?: string;
  project?: string;
  modifiedFiles?: string[];
  limit?: number;
}

/**
 * Ищет задачи по запросу и фильтрам.
 *
 * Фильтры комбинируются по AND. Все поля необязательны (как required: []
 * в оригинальной схеме task_search): вызов без query, только с фильтрами, валиден.
 *
 * @param cwd — текущая рабочая директория
 * @param filters — {query, status, type, priority, project, modifiedFiles, limit}
 *   или строка (= query, обратная совместимость со старой сигнатурой)
 */
export function searchTasks(cwd: string, filters: SearchFilters | string = {}): Task[] {
  // Обратная совместимость: строковый второй аргумент — это query
  // (CLI search.mjs передаёт строку)
  let f: SearchFilters;
  if (typeof filters === 'string') {
    f = { query: filters };
  } else {
    f = filters;
  }

  const { query, status, type, priority, project, modifiedFiles, limit } = f;
  let tasks = listTasks(cwd);

  // Текстовый запрос: substring по id/title/description/labels
  if (query && query.trim() !== '') {
    const q = query.toLowerCase().trim();
    tasks = tasks.filter(task => {
      if (task.id && task.id.toLowerCase().includes(q)) return true;
      if (task.title && task.title.toLowerCase().includes(q)) return true;
      if (task.description && task.description.toLowerCase().includes(q)) return true;
      if (task.labels && task.labels.some(l => l.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  // Фильтры точного совпадения (AND, case-insensitive)
  if (status) {
    tasks = tasks.filter(t => t.status && t.status.toLowerCase() === status.toLowerCase());
  }
  if (type) {
    tasks = tasks.filter(t => t.type && t.type.toLowerCase() === type.toLowerCase());
  }
  if (priority) {
    tasks = tasks.filter(t => t.priority && t.priority.toLowerCase() === priority.toLowerCase());
  }
  if (project) {
    tasks = tasks.filter(t => t.project && t.project.toLowerCase() === project.toLowerCase());
  }

  // modifiedFiles: подстрока по путям из t.modified_files (case-insensitive).
  // Как в оригинале: задача проходит, если хотя бы один путь задачи
  // содержит хотя бы один переданный фильтр.
  if (Array.isArray(modifiedFiles) && modifiedFiles.length > 0) {
    const needles = modifiedFiles.map(m => String(m).toLowerCase());
    tasks = tasks.filter(t => {
      const files = Array.isArray(t.modified_files)
        ? t.modified_files
        : (t.modified_files ? [t.modified_files] : []);
      return files.some(f2 => needles.some(n => String(f2).toLowerCase().includes(n)));
    });
  }

  if (limit && limit > 0) {
    tasks = tasks.slice(0, limit);
  }

  return tasks;
}
