/**
 * Поиск задач Vibelog.md: текстовый запрос + фильтры полей.
 *
 * Текстовый substring-поиск (id/title/description/labels) и фильтры
 * точного совпадения (status/type/priority/project) — case-insensitive,
 * как в оригинале Backlog.md (task_search).
 *
 * Здесь же — globalSearch (VL-185): единый поиск по 4 типам сущностей
 * (задачи/lessons/references/documents) с группировкой и лимитами; логика
 * не дублируется в веб-слое (lesson-37 — API-хендлер только валидирует).
 */

import { findBacklogDir } from './paths.js';
import { listTasks } from './store.js';
import type { Task } from './task.js';
import { searchLessons } from './lesson.js';
import { searchReferences } from './reference.js';
import { searchDocuments } from './document.js';

/** Фильтры поиска (все поля необязательны — как required: [] в оригинале). */
export interface SearchFilters {
  query?: string;
  status?: string;
  type?: string;
  priority?: string;
  project?: string;
  modifiedFiles?: string[];
  hasLessons?: boolean;
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

  const { query, status, type, priority, project, modifiedFiles, hasLessons, limit } = f;
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

  // hasLessons (VL-153): фильтр по наличию связанных lessons в задаче.
  // true — только задачи с непустым lessons; false — только без lessons.
  if (hasLessons === true) {
    tasks = tasks.filter(t => Array.isArray(t.lessons) && t.lessons.length > 0);
  } else if (hasLessons === false) {
    tasks = tasks.filter(t => !Array.isArray(t.lessons) || t.lessons.length === 0);
  }

  if (limit && limit > 0) {
    tasks = tasks.slice(0, limit);
  }

  return tasks;
}

/** Лимит результатов на один тип сущности в глобальном поиске (VL-185). */
const SEARCH_PER_TYPE_LIMIT = 5;
/** Общий лимит результатов глобального поиска (VL-185). */
const SEARCH_TOTAL_LIMIT = 20;

/** Слим-хит задачи в глобальном поиске: метаданные без description/планов. */
export interface SearchTaskHit {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  labels: string[];
}

/** Слим-хит lesson: метаданные без body. */
export interface SearchLessonHit {
  id: string;
  title: string;
  status: string;
  tags: string[];
}

/** Слим-хит reference: метаданные без body. */
export interface SearchReferenceHit {
  id: string;
  title: string;
  type: string;
  /** Может быть пустой строкой у path-референсов без url. */
  url: string;
  tags: string[];
}

/** Слим-хит документа: метаданные без body. */
export interface SearchDocumentHit {
  id: string;
  title: string;
  type: string;
  tags: string[];
}

/** Сгруппированный ответ глобального поиска (GET /api/search, VL-185). */
export interface GlobalSearchResults {
  query: string;
  tasks: SearchTaskHit[];
  lessons: SearchLessonHit[];
  references: SearchReferenceHit[];
  documents: SearchDocumentHit[];
}

/**
 * Глобальный поиск по 4 типам сущностей (VL-185): задачи, lessons,
 * references, documents. Decisions НЕ ищутся (не используются активно).
 *
 * Каждая группа ограничена SEARCH_PER_TYPE_LIMIT, суммарно —
 * SEARCH_TOTAL_LIMIT: лимит задач = min(найдено, TOTAL − остальные_группы),
 * поэтому при пустых остальных группах задачи дорастают до 20 (спека:
 * «если общее меньше 20, а задач больше 5 — увеличить»).
 *
 * Пустой запрос или отсутствующий backlog → пустые группы (200, не ошибка):
 * searchLessons/searchReferences бросают без backlog (requireBacklogDir),
 * поэтому предпроверка здесь обязательна.
 *
 * @param cwd — рабочая директория проекта
 * @param query — поисковый запрос (substring, case-insensitive)
 */
export function globalSearch(cwd: string, query: string): GlobalSearchResults {
  const empty = (): GlobalSearchResults => ({
    query,
    tasks: [],
    lessons: [],
    references: [],
    documents: [],
  });

  const q = (query ?? '').trim();
  if (!q) return empty();

  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return empty();

  // Группы сущностей ≤ PER_TYPE; searchLessons/searchReferences резолвят
  // backlog сами, но requireBacklogDir бросил бы без предпроверки выше
  const lessons = searchLessons(cwd, q).slice(0, SEARCH_PER_TYPE_LIMIT);
  const references = searchReferences(cwd, q).slice(0, SEARCH_PER_TYPE_LIMIT);
  const documents = searchDocuments(backlogDir, q).slice(0, SEARCH_PER_TYPE_LIMIT);
  const others = lessons.length + references.length + documents.length;

  // Задачи добираются до TOTAL − others (спека VL-185); минус 0 не бывает —
  // others ≤ 3×5 = 15 < 20, но защищаемся на случай смены лимитов
  const tasksAll = searchTasks(cwd, { query: q });
  const taskLimit = Math.max(0, Math.min(tasksAll.length, SEARCH_TOTAL_LIMIT - others));
  const tasks = tasksAll.slice(0, taskLimit);

  return {
    query,
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      labels: t.labels ?? [],
    })),
    lessons: lessons.map(e => ({
      id: e.lesson.id,
      title: e.lesson.title,
      status: e.lesson.status,
      tags: e.lesson.tags ?? [],
    })),
    references: references.map(e => ({
      id: e.reference.id,
      title: e.reference.title,
      type: e.reference.type,
      url: e.reference.url ?? '',
      tags: e.reference.tags ?? [],
    })),
    documents: documents.map(e => ({
      id: e.document.id,
      title: e.document.title,
      type: e.document.type,
      tags: e.document.tags ?? [],
    })),
  };
}
