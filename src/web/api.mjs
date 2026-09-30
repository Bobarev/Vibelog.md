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

import { listTasks, getTask, createTaskFile, updateTaskFile, archiveTaskFile } from '../core/store.mjs';
import { loadConfig } from '../core/config.mjs';

/**
 * Обрабатывает REST-запрос.
 *
 * @param {string} method — HTTP-метод
 * @param {string} url — путь URL (без query string)
 * @param {object|null} body — тело запроса (для POST/PATCH)
 * @param {string} cwd — рабочая директория
 * @returns {{ status: number, body: object|string }} — HTTP-ответ
 */
export function handleApi(method, url, body, cwd) {
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

    // POST /api/tasks
    if (method === 'POST' && url === '/api/tasks') {
      const task = createTaskFile(cwd, body || {});
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
      const task = updateTaskFile(cwd, getMatch[1], body || {});
      return { status: 200, body: task };
    }

    // DELETE /api/tasks/:id
    if (method === 'DELETE' && getMatch) {
      archiveTaskFile(cwd, getMatch[1]);
      return { status: 200, body: { success: true } };
    }

    return { status: 404, body: { error: 'Не найдено' } };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}
