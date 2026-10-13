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
 * - POST /api/tasks/:id/trigger — запуск фазы оркестратора (VL-28)
 * - GET  /api/tasks/:id/trigger — состояние запуска фазы
 * - POST /api/tasks/:id/reject — отклонить задачу (VL-144)
 */

import { listTasks, getTask, createTaskFile, updateTaskFile, archiveTaskFile } from '../core/store.js';
import type { CreateTaskFileInput } from '../core/store.js';
import type { Task } from '../core/task.js';
import { loadConfig } from '../core/config.js';
import { startPhase, getRun, rejectTask } from './orchestrator.js';

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

    // POST /api/tasks/:id/trigger — запуск фазы (VL-28).
    // ВАЖНО: роут обязан стоять ДО общего getMatch ниже — иначе
    // 'VL-28/trigger' матчится как id задачи.
    const triggerMatch = url.match(/^\/api\/tasks\/([^/]+)\/trigger$/);
    if (triggerMatch && method === 'POST') {
      const task = getTask(cwd, triggerMatch[1]);
      if (!task) return { status: 404, body: { error: 'Задача не найдена' } };
      const phase = typeof body?.phase === 'string' ? body.phase : '';
      const result = startPhase(cwd, triggerMatch[1], phase);
      if ('error' in result) return { status: 409, body: { error: result.error } };
      return { status: 202, body: result };
    }

    // GET /api/tasks/:id/trigger — состояние запуска фазы
    if (triggerMatch && method === 'GET') {
      return { status: 200, body: getRun(triggerMatch[1]) ?? { running: false } };
    }

    // POST /api/tasks/:id/reject — отклонить задачу (VL-144).
    // Матч ДО общего getMatch ниже (иначе 'VL-N/reject' — id задачи).
    // Никогда не бывшая в Code: синхронная механика → 200 {rejected:true}.
    // Была в Code: запуск LLM-фазы reject → 202 {started,pid}; статус+архив
    // применяются в onExit завершения фазы ( rejectTask сам ). Ошибка
    // валидации/guard (задача не найдена, запуск уже выполняется) → 404/409.
    const rejectMatch = url.match(/^\/api\/tasks\/([^/]+)\/reject$/);
    if (rejectMatch && method === 'POST') {
      const comment = typeof body?.comment === 'string' ? body.comment : '';
      const result = rejectTask(cwd, rejectMatch[1], comment);
      if ('rejected' in result) return { status: 200, body: { rejected: true } };
      if ('error' in result) {
        const status = result.error.startsWith('Задача не найдена') ? 404 : 409;
        return { status, body: { error: result.error } };
      }
      return { status: 202, body: result };
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
