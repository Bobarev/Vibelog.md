/**
 * Управление зависимостями между задачами Vibelog.md.
 *
 * Задачи связаны через поле `dependencies` (массив ID).
 * Если задача A зависит от B, то B "блокирует" A.
 */

import { listTasks } from './store.mjs';

/**
 * Возвращает список задач, от которых зависит данная (blockedBy).
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {object} task — объект задачи
 * @returns {object[]} — массив задач-зависимостей
 */
export function blockedBy(cwd, task) {
  if (!task.dependencies || task.dependencies.length === 0) return [];
  const allTasks = listTasks(cwd);
  const allById = new Map(allTasks.map(t => [t.id.toLowerCase(), t]));
  return task.dependencies
    .map(depId => allById.get(depId.toLowerCase()))
    .filter(Boolean);
}

/**
 * Возвращает список задач, которые блокирует данная (blocks).
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {object} task — объект задачи
 * @returns {object[]} — массив задач, которые зависят от данной
 */
export function blocks(cwd, task) {
  const allTasks = listTasks(cwd);
  return allTasks.filter(t =>
    t.dependencies && t.dependencies.some(dep => dep.toLowerCase() === task.id.toLowerCase())
  );
}

/**
 * Проверяет, готова ли задача к выполнению.
 *
 * Задача готова, если:
 * - Все зависимости выполнены (статус "Done" или "Completed")
 * - Или зависимостей нет
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {object} task — объект задачи
 * @returns {boolean}
 */
export function isReady(cwd, task) {
  const deps = blockedBy(cwd, task);
  if (deps.length === 0) return true;
  return deps.every(d => d.status === 'Done' || d.status === 'Completed');
}

/**
 * Проверяет зависимости задачи на наличие циклов.
 *
 * Использует DFS для обнаружения циклических зависимостей.
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {object} task — объект задачи для проверки
 * @param {object[]} [allTasks] — массив всех задач (если уже загружены)
 * @returns {{ valid: boolean, cycle: string[] }} — результат проверки
 *   valid — true если циклов нет
 *   cycle — путь цикла, если найден
 */
export function validateDeps(cwd, task, allTasks) {
  const tasks = allTasks || listTasks(cwd);
  const byId = new Map(tasks.map(t => [t.id.toLowerCase(), t]));

  const visited = new Set();
  const stack = new Set();

  function dfs(currentId) {
    const id = currentId.toLowerCase();
    if (stack.has(id)) {
      // Нашли цикл — возвращаем путь
      return [id];
    }
    if (visited.has(id)) return null;

    visited.add(id);
    stack.add(id);

    const current = byId.get(id);
    if (current && current.dependencies) {
      for (const dep of current.dependencies) {
        const cycle = dfs(dep);
        if (cycle) return [id, ...cycle];
      }
    }

    stack.delete(id);
    return null;
  }

  const cycle = dfs(task.id);
  return {
    valid: cycle === null,
    cycle: cycle || [],
  };
}
