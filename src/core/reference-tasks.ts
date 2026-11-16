/**
 * Чтение задач из клона референса (VL-418).
 *
 * Зачем отдельный модуль: `listTasks`/`getTask` (`src/core/store.ts`) жёстко
 * привязаны к `findBacklogDir(cwd)` — они ищут backlog ТЕКУЩЕГО проекта.
 * Задачи чужого проекта (клона референса) агенту приходилось читать через
 * `read_file` по путям: листинг обрезался на 200 записей, не было фильтра по
 * статусу/метке, а фронтматтер агент разбирал сам.
 *
 * Разделение ответственности: модуль принимает УЖЕ РЕЗОЛВЛЕННЫЙ абсолютный
 * каталог клона и не ищет `backlog/` сам. Резолв пути (единственный источник —
 * `referenceCloneDir`) и проверка выхода за `references/data/` живут в
 * MCP-слое (`src/mcp/reference-tasks-tool.ts`): ядро остаётся чистым и
 * тестируется на `mkdtemp` без сервера.
 *
 * Формат задач — общий с Backlog.md: `markdownToTask` терпим к отсутствующим
 * полям, поэтому чужой проект на другой версии читается без падений.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToTask } from './task.js';
import type { Task } from './task.js';

/** Опции листинга задач клона. */
export interface CloneTasksOptions {
  /** Точное совпадение статуса (case-insensitive). */
  status?: string;
  /** Метки: должны совпасть ВСЕ (AND). Пустой массив — без фильтра. */
  labels?: string[];
  /** Точное совпадение типа задачи (case-insensitive). */
  type?: string;
  /** Максимум задач в ответе (дефолт 50, максимум 200). */
  limit?: number;
  /** Сортировка: id (натуральная), updated (по updated_date убыв.), priority. */
  sort?: 'id' | 'updated' | 'priority';
  /** Читать и `backlog/completed/` (по умолчанию только `backlog/tasks/`). */
  includeCompleted?: boolean;
}

/** Результат листинга: усечённый список + полное число совпадений. */
export interface CloneTasksResult {
  /** Задачи после фильтров/сортировки, усечённые по limit. */
  tasks: Task[];
  /** Сколько всего совпало ДО limit — агент видит, что список усечён. */
  total: number;
}

/** Дефолтный лимит: агент обычно спрашивает «открытые», а не «все». */
export const DEFAULT_CLONE_TASKS_LIMIT = 50;

/** Жёсткий потолок лимита — защита от выгрузки всего чужого backlog. */
export const MAX_CLONE_TASKS_LIMIT = 200;

/**
 * Читает все .md-файлы задач из каталога.
 *
 * Отсутствующий каталог — не ошибка (у чужого проекта может не быть
 * `completed/`): возвращается пустой массив.
 */
function readTasksFromDir(dir: string): Task[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) return [];
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const tasks: Task[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    try {
      const task = markdownToTask(readFileSync(join(dir, name), 'utf-8'));
      // Файл без id — посторонний markdown, а не задача
      if (task.id) tasks.push(task);
    } catch {
      // Битый файл чужого проекта не должен ронять весь листинг
    }
  }
  return tasks;
}

/** Разбивает строку на чередование числовых и нечисловых кусков. */
function naturalChunks(value: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /(\d+)|(\D+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    out.push(match[1] !== undefined ? Number(match[1]) : match[2]);
  }
  return out;
}

/**
 * Натуральное сравнение ID: `VL-9` < `VL-10` < `VL-100`.
 *
 * Лексикографическое сравнение поставило бы `VL-100` перед `VL-11` — для
 * агента, который листает задачи по ID, это выглядит как перемешанный список.
 */
export function naturalCompare(a: string, b: string): number {
  const ca = naturalChunks(a);
  const cb = naturalChunks(b);
  const len = Math.max(ca.length, cb.length);
  for (let i = 0; i < len; i += 1) {
    const x = ca[i];
    const y = cb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
    } else {
      const sx = String(x);
      const sy = String(y);
      if (sx !== sy) return sx < sy ? -1 : 1;
    }
  }
  return 0;
}

/** Ранг приоритета: High → Medium → Low → пусто/неизвестно. */
function priorityRank(priority: string): number {
  const value = String(priority || '').toLowerCase();
  if (value === 'high') return 0;
  if (value === 'medium') return 1;
  if (value === 'low') return 2;
  return 3;
}

/** Приводит limit к допустимому диапазону (дефолт 50, потолок 200). */
function normalizeLimit(limit: unknown): number {
  const num = Number(limit);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_CLONE_TASKS_LIMIT;
  return Math.min(Math.floor(num), MAX_CLONE_TASKS_LIMIT);
}

/**
 * Список задач из клона референса с фильтрами, сортировкой и лимитом.
 *
 * @param cloneDir — УЖЕ РЕЗОЛВЛЕННЫЙ абсолютный каталог клона (не cwd!)
 * @param opts — фильтры/сортировка/лимит
 * @returns усечённый список + полное число совпадений (`total`)
 */
export function listCloneTasks(cloneDir: string, opts: CloneTasksOptions = {}): CloneTasksResult {
  const dirs = [join(cloneDir, 'backlog', 'tasks')];
  if (opts.includeCompleted === true) dirs.push(join(cloneDir, 'backlog', 'completed'));

  let tasks: Task[] = [];
  for (const dir of dirs) tasks = tasks.concat(readTasksFromDir(dir));

  // Фильтры: статус и тип — точное совпадение без учёта регистра; метки — AND.
  // Статус НЕ валидируется по конфигу своего проекта: у чужого проекта свой
  // набор статусов, и незнакомое значение — не ошибка, а просто несовпадение.
  if (opts.status !== undefined && String(opts.status).trim() !== '') {
    const needle = String(opts.status).trim().toLowerCase();
    tasks = tasks.filter(t => String(t.status || '').toLowerCase() === needle);
  }
  if (opts.type !== undefined && String(opts.type).trim() !== '') {
    const needle = String(opts.type).trim().toLowerCase();
    tasks = tasks.filter(t => String(t.type || '').toLowerCase() === needle);
  }
  if (Array.isArray(opts.labels) && opts.labels.length > 0) {
    const needles = opts.labels.map(l => String(l).toLowerCase());
    tasks = tasks.filter(t => {
      const own = (t.labels || []).map(l => String(l).toLowerCase());
      return needles.every(n => own.includes(n));
    });
  }

  const sort = opts.sort || 'id';
  if (sort === 'updated') {
    tasks.sort((a, b) => {
      const ua = String(a.updated_date || '');
      const ub = String(b.updated_date || '');
      if (ua !== ub) return ua < ub ? 1 : -1; // убывание: свежие первыми
      return naturalCompare(a.id, b.id);
    });
  } else if (sort === 'priority') {
    tasks.sort((a, b) => {
      const ra = priorityRank(a.priority);
      const rb = priorityRank(b.priority);
      if (ra !== rb) return ra - rb;
      return naturalCompare(a.id, b.id);
    });
  } else {
    tasks.sort((a, b) => naturalCompare(a.id, b.id));
  }

  const total = tasks.length;
  const limit = normalizeLimit(opts.limit);
  return { tasks: tasks.slice(0, limit), total };
}

/**
 * Задача клона по ID (ищет в `tasks/` и `completed/`).
 *
 * Совпадение — по префиксу имени файла (`<ID> - ` или `<ID>.`), как в
 * `getTask` (`src/core/store.ts`), но без привязки к cwd.
 *
 * @param cloneDir — УЖЕ РЕЗОЛВЛЕННЫЙ абсолютный каталог клона
 * @param id — ID задачи (например `VL-123`)
 * @returns задача или null
 */
export function getCloneTask(cloneDir: string, id: string): Task | null {
  const needle = String(id || '').trim().toLowerCase();
  if (!needle) return null;
  const dirs = [join(cloneDir, 'backlog', 'tasks'), join(cloneDir, 'backlog', 'completed')];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const lower = name.toLowerCase();
      if (!lower.startsWith(needle + ' ') && !lower.startsWith(needle + '.')) continue;
      try {
        const task = markdownToTask(readFileSync(join(dir, name), 'utf-8'));
        if (task.id) return task;
      } catch {
        // Битый файл — пробуем следующий
      }
    }
  }
  return null;
}

/**
 * Ближайшие ID клона к запрошенному — подсказка для неизвестного id.
 *
 * Сначала ID с тем же префиксом (`VL-4` → `VL-40`, `VL-41`, …), затем просто
 * первые по натуральному порядку: агенту нужно не «правильный» ответ, а
 * список, из которого он выберет существующий ID вместо угадывания.
 *
 * @param cloneDir — УЖЕ РЕЗОЛВЛЕННЫЙ абсолютный каталог клона
 * @param id — запрошенный (несуществующий) ID
 * @param limit — максимум подсказок (дефолт 10)
 */
export function suggestCloneTaskIds(cloneDir: string, id: string, limit = 10): string[] {
  const all = listCloneTasks(cloneDir, { limit: MAX_CLONE_TASKS_LIMIT, includeCompleted: true }).tasks;
  const ids = all.map(t => t.id);
  const needle = String(id || '').trim().toLowerCase();
  // Префикс без последнего числового блока: «VL-41» → «vl-4»
  const prefix = needle.replace(/\d+$/, '');
  const byPrefix = prefix
    ? ids.filter(x => x.toLowerCase().startsWith(prefix) && x.toLowerCase() !== needle)
    : [];
  const rest = ids.filter(x => !byPrefix.includes(x) && x.toLowerCase() !== needle);
  return [...byPrefix, ...rest].slice(0, Math.max(1, limit));
}
