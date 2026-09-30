/**
 * Поиск задач Vibelog.md по текстовому запросу.
 *
 * Ищет по заголовку, описанию и меткам.
 * Поддерживает регистронезависимый substring-поиск.
 */

import { listTasks } from './store.mjs';

/**
 * Ищет задачи по текстовому запросу.
 *
 * Проверяет совпадение запроса (без учёта регистра) с:
 * - заголовком задачи
 * - описанием
 * - метками (labels)
 * - ID задачи
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {string} query — текстовый запрос
 * @returns {object[]} — массив совпавших задач
 */
export function searchTasks(cwd, query) {
  if (!query || query.trim() === '') return listTasks(cwd);

  const q = query.toLowerCase().trim();
  const allTasks = listTasks(cwd);

  return allTasks.filter(task => {
    // Поиск по ID
    if (task.id && task.id.toLowerCase().includes(q)) return true;

    // Поиск по заголовку
    if (task.title && task.title.toLowerCase().includes(q)) return true;

    // Поиск по описанию
    if (task.description && task.description.toLowerCase().includes(q)) return true;

    // Поиск по меткам
    if (task.labels && task.labels.some(l => l.toLowerCase().includes(q))) return true;

    return false;
  });
}
