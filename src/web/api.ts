/**
 * REST API хендлеры для веб-интерфейса Vibelog.md.
 *
 * Эндпоинты:
 * - GET  /api/tasks          — список задач
 * - POST /api/tasks          — создать задачу
 * - GET  /api/tasks/:id      — детали задачи
 * - PATCH /api/tasks/:id     — обновить задачу
 * - DELETE /api/tasks/:id    — архивировать задачу
 * - GET  /api/config         — конфиг проекта
 */

import { listTasks, getTask, createTaskFile, updateTaskFile, archiveTaskFile } from '../core/store.js';
import type { CreateTaskFileInput } from '../core/store.js';
import type { Task } from '../core/task.js';
import { loadConfig } from '../core/config.js';

/** HTTP-ответ API. */
export interface ApiResponse {
  status: number;
  body: object | string;
}

/**
 * Обрабатывает REST-запрос.
 *
 * @param method — HTTP-метод
 * @param url — путь URL (без query string)
 * @param body — тело запроса (для POST/PATCH)
 * @param cwd — рабочая директория
 */
export function handleApi(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  cwd: string
): ApiResponse {
  try {
    // GET /api/tasks
    if (method === 'GET' && url === '/api/tasks') {
      const tasks = listTasks(cwd);
      return { status: 200, body: tasks };
    }

    // GET /api/config
    if (method === 'GET' && url === '/api/config') {
      const config = loadConfig(cwd);
      return { status: 200, body: config };
    }

    // POST /api/tasks — тело приходит из HTTP без гарантий типов
    if (method === 'POST' && url === '/api/tasks') {
      const task = createTaskFile(cwd, (body || {}) as unknown as CreateTaskFileInput);
      return { status: 201, body: task };
    }

    // GET /api/tasks/:id
    const getMatch = url.match(/^\/api\/tasks\/(.+)$/);
    if (method === 'GET' && getMatch) {
      const task = getTask(cwd, getMatch[1]);
      if (!task) return { status: 404, body: { error: 'Задача не найдена' } };
      return { status: 200, body: task };
    }

    // PATCH /api/tasks/:id
    if (method === 'PATCH' && getMatch) {
      const task = updateTaskFile(cwd, getMatch[1], (body || {}) as Partial<Task>);
      return { status: 200, body: task };
    }

    // DELETE /api/tasks/:id
    if (method === 'DELETE' && getMatch) {
      archiveTaskFile(cwd, getMatch[1]);
      return { status: 200, body: { success: true } };
    }

    return { status: 404, body: { error: 'Не найдено' } };
  } catch (err) {
    return { status: 500, body: { error: (err as Error).message } };
  }
}
