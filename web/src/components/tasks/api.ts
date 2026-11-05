/**
 * Слой данных таблицы задач #/tasks (VL-175).
 *
 * fetchTasks — переэкспорт из kanban/api: данные те же (GET /api/tasks),
 * меняется только представление. fetchConfig — конфиг проекта для
 * сортировки status/priority по порядку из конфига и селекта статусов
 * модалки (fallback — как FALLBACK_STATUSES в kanban/api, чтобы страница
 * открывалась при недоступном конфиге, lesson-16: ошибок в консоли нет).
 */

import { fetchTasks } from '../kanban/api';
import { loadProjectConfig } from '@/lib/project-config';

export { fetchTasks };

/** Конфиг проекта, нужный таблице (порядок сортировки + селекты). */
export interface TasksConfig {
  statuses: string[];
  priorities: string[];
  types: string[];
}

/** Значения по умолчанию — копия FALLBACK_STATUSES kanban/api + приоритеты/типы из config.yml. */
const FALLBACK_CONFIG: TasksConfig = {
  statuses: ['To Do', 'In Progress', 'Review', 'Done'],
  priorities: ['High', 'Medium', 'Low'],
  types: ['task', 'bug', 'feature', 'epic'],
};

/** GET /api/config → { statuses, priorities, types }; при ошибке — fallback.
 *  Запрос идёт через общий кэш lib/project-config (VL-345): один /api/config
 *  на всю страницу, а не по одному на каждый модуль. */
export async function fetchConfig(): Promise<TasksConfig> {
  try {
    const config = (await loadProjectConfig()) as Partial<TasksConfig>;
    return {
      statuses:
        Array.isArray(config.statuses) && config.statuses.length > 0
          ? config.statuses
          : FALLBACK_CONFIG.statuses,
      priorities:
        Array.isArray(config.priorities) && config.priorities.length > 0
          ? config.priorities
          : FALLBACK_CONFIG.priorities,
      types:
        Array.isArray(config.types) && config.types.length > 0
          ? config.types
          : FALLBACK_CONFIG.types,
    };
  } catch {
    // Конфиг недоступен — дефолты, таблица должна открываться
    return FALLBACK_CONFIG;
  }
}
