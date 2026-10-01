/**
 * Управление зависимостями между задачами Vibelog.md.
 *
 * Задачи связаны через поле `dependencies` (массив ID).
 * Если задача A зависит от B, то B "блокирует" A.
 */

import { listTasks } from './store.js';
import type { Task } from './task.js';

/**
 * Возвращает список задач, от которых зависит данная (blockedBy).
 *
 * @param cwd — текущая рабочая директория
 * @param task — объект задачи
 */
export function blockedBy(cwd: string, task: Task): Task[] {
  if (!task.dependencies || task.dependencies.length === 0) return [];
  const allTasks = listTasks(cwd) as Task[];
  const allById = new Map(allTasks.map(t => [t.id.toLowerCase(), t]));
  return task.dependencies
    .map(depId => allById.get(depId.toLowerCase()))
    .filter((t): t is Task => t !== undefined);
}

/**
 * Возвращает список задач, которые блокирует данная (blocks).
 *
 * @param cwd — текущая рабочая директория
 * @param task — объект задачи
 */
export function blocks(cwd: string, task: Task): Task[] {
  const allTasks = listTasks(cwd) as Task[];
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
 * @param cwd — текущая рабочая директория
 * @param task — объект задачи
 */
export function isReady(cwd: string, task: Task): boolean {
  const deps = blockedBy(cwd, task);
  if (deps.length === 0) return true;
  return deps.every(d => d.status === 'Done' || d.status === 'Completed');
}

/**
 * Проверяет зависимости задачи на наличие циклов.
 *
 * Использует DFS для обнаружения циклических зависимостей.
 *
 * @param cwd — текущая рабочая директория
 * @param task — объект задачи для проверки
 * @param allTasks — массив всех задач (если уже загружены)
 * @returns valid — true если циклов нет; cycle — путь цикла, если найден
 */
export function validateDeps(
  cwd: string,
  task: Task,
  allTasks?: Task[]
): { valid: boolean; cycle: string[] } {
  const tasks = (allTasks || listTasks(cwd)) as Task[];
  const byId = new Map(tasks.map(t => [t.id.toLowerCase(), t]));

  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(currentId: string): string[] | null {
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
