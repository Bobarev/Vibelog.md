/**
 * Поиск задач Vibelog.md: текстовый запрос + фильтры полей.
 *
 * Текстовый поиск (VL-237): запрос токенизируется по пробелам/пунктуации
 * (нижний регистр), требуется вхождение ВСЕХ токенов (И-логика) хотя бы
 * в одном поле задачи, а результат ранжируется по релевантности:
 * id (точное) » id (подстрока) » title » labels » description.
 * Одно попадание в 8-килобайтный description больше не весит столько же,
 * сколько точное совпадение в title (причина инцидента «модель»/«зависимости»).
 *
 * Минимальная морфология: для токенов длиной ≥ 6 сравнивается основа —
 * первые PREFIX_LEN символов («модель»/«моделями» → «модел»); полноценный
 * стеммер не нужен, цена — ложные совпадения на коротких основах.
 *
 * Фильтры точного совпадения (status/type/priority/project) — case-insensitive,
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
 * Веса полей при ранжировании (VL-237). Точное совпадение id ищется
 * отдельно и весит больше подстроки; labels/description — слабые сигналы.
 */
const FIELD_WEIGHTS = {
  idExact: 1000,
  idPartial: 500,
  title: 100,
  labels: 50,
  description: 10,
} as const;

/** Длина основы для усечения токена (минимальная морфология, VL-237). */
const PREFIX_LEN = 5;

/** Токен короче этого порога не усекается — иначе «тест» станет «тест» же. */
const STEM_MIN_LEN = PREFIX_LEN + 1;

/**
 * Разбивает запрос на токены: нижний регистр, разделители — всё, кроме
 * букв/цифр/дефиса/подчёркивания. Дефис и подчёркивание сохраняем,
 * иначе `VL-237` и `modified_files` распались бы на бессмысленные куски.
 *
 * @param query — исходный поисковый запрос
 */
export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}\-_]+/u)
    .filter(t => t.length > 0);
}

/**
 * Усекает токен до основы (первые PREFIX_LEN символов) для длинных слов.
 * «модель» и «моделями» дают «модел» → находят друг друга.
 *
 * @param token — токен в нижнем регистре
 */
export function stemToken(token: string): string {
  return token.length >= STEM_MIN_LEN ? token.slice(0, PREFIX_LEN) : token;
}

/**
 * Считает релевантность задачи запросу.
 *
 * И-логика: каждый токен обязан найтись хотя бы в одном поле, иначе
 * задача отбрасывается (возврат -1). Иначе — сумма весов полей; за токен
 * каждое поле даёт вес не более одного раза (повтор слова в description
 * не накачивает score).
 *
 * @param task — проверяемая задача
 * @param tokens — токены запроса (уже в нижнем регистре, до усечения)
 * @returns score >= 0 или -1, если задача не прошла И-фильтр
 */
function scoreTask(task: Task, tokens: string[]): number {
  const id = (task.id ?? '').toLowerCase();
  const title = (task.title ?? '').toLowerCase();
  const description = String(task.description ?? '').toLowerCase();
  const labels = Array.isArray(task.labels)
    ? task.labels.map(l => String(l).toLowerCase())
    : [];

  let score = 0;
  for (const token of tokens) {
    // Токены с дефисом (VL-237, findme-desc) сравниваем целиком: усечение
    // основы сделало бы «findme-desc» → «findm» и цепляло соседние метки.
    const needle = token.includes('-') ? token : stemToken(token);
    let matched = false;

    // id: точное совпадение весит максимально — агент ищет «VL-209»
    if (id && id === token) {
      score += FIELD_WEIGHTS.idExact;
      matched = true;
    } else if (id && id.includes(needle)) {
      score += FIELD_WEIGHTS.idPartial;
      matched = true;
    }
    if (title && title.includes(needle)) {
      score += FIELD_WEIGHTS.title;
      matched = true;
    }
    if (labels.some(l => l.includes(needle))) {
      score += FIELD_WEIGHTS.labels;
      matched = true;
    }
    if (description && description.includes(needle)) {
      score += FIELD_WEIGHTS.description;
      matched = true;
    }

    if (!matched) return -1;
  }
  return score;
}

/** Задача со посчитанным score — внутренний тип ранжирования. */
interface ScoredTask {
  task: Task;
  score: number;
}

/**
 * Ищет задачи по запросу и фильтрам, сообщая полное число совпадений.
 *
 * Единственная реализация поиска: `searchTasks` — тонкая обёртка над ней
 * (MCP нужен `found` при усечении по limit, CLI/globalSearch — только задачи).
 *
 * @param cwd — текущая рабочая директория
 * @param filters — {query, status, type, priority, project, modifiedFiles, limit}
 * @returns { tasks, found } — tasks уже усечены по limit, found — до усечения
 */
export function searchTasksRanked(
  cwd: string,
  filters: SearchFilters | string = {}
): { tasks: Task[]; found: number } {
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

  // Текстовый запрос: токенизация + И-логика + ранжирование (VL-237)
  if (query && query.trim() !== '') {
    const tokens = tokenizeQuery(query);
    if (tokens.length > 0) {
      const scored: ScoredTask[] = [];
      for (const task of tasks) {
        const score = scoreTask(task, tokens);
        if (score >= 0) scored.push({ task, score });
      }
      // Детерминированный порядок: score desc → created_date desc → id asc.
      // Без второго и третьего ключа порядок зависел бы от чтения каталога.
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ad = String(a.task.created_date ?? '');
        const bd = String(b.task.created_date ?? '');
        if (ad !== bd) return ad < bd ? 1 : -1;
        return String(a.task.id ?? '').localeCompare(String(b.task.id ?? ''));
      });
      tasks = scored.map(s => s.task);
    }
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

  // found считаем ДО усечения по limit — это «сколько реально совпало»
  const found = tasks.length;
  if (limit && limit > 0) {
    tasks = tasks.slice(0, limit);
  }

  return { tasks, found };
}

/**
 * Ищет задачи по запросу и фильтрам (без информации о полноте выдачи).
 *
 * Фильтры комбинируются по AND. Все поля необязательны (как required: []
 * в оригинальной схеме task_search): вызов без query, только с фильтрами, валиден.
 * Выдача — по релевантности (VL-237), см. searchTasksRanked.
 *
 * @param cwd — текущая рабочая директория
 * @param filters — {query, status, type, priority, project, modifiedFiles, limit}
 *   или строка (= query, обратная совместимость со старой сигнатурой)
 */
export function searchTasks(cwd: string, filters: SearchFilters | string = {}): Task[] {
  return searchTasksRanked(cwd, filters).tasks;
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
