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
 * - GET  /api/settings       — настройки бота/settings.json без секретов (VL-156)
 * - PUT  /api/settings       — патч настроек с валидацией (VL-156)
 * - POST /api/tasks/:id/trigger — запуск фазы оркестратора (VL-28)
 * - GET  /api/tasks/:id/trigger — состояние запуска фазы
 * - POST /api/tasks/:id/reject — отклонить задачу (VL-144)
 */

import { listTasks, getTask, createTaskFile, updateTaskFile, archiveTaskFile } from '../core/store.js';
import type { CreateTaskFileInput } from '../core/store.js';
import type { Task } from '../core/task.js';
import { loadConfig } from '../core/config.js';
import { loadBotSettings, saveBotSettings } from '../bot/settings.js';
import type { BotSettings } from '../bot/settings.js';
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

    // GET /api/settings — настройки для веб-страницы (VL-156).
    // loadBotSettings отдаёт ТОЛЬКО валидированные несекретные поля; env-секция
    // (TELEGRAM_BOT_TOKEN и др.) сюда не попадает — секреты не должны утекать
    // в браузер даже на localhost.
    if (method === 'GET' && url === '/api/settings') {
      return { status: 200, body: { settings: loadBotSettings(cwd) } };
    }

    // PUT /api/settings — патч настроек, зеркало валидации команды /set (VL-156).
    // Неизвестный ключ или битое значение → 400, файл не меняется: веб не должен
    // писать в settings.json мусор, который проигнорирует бот. Запись через
    // saveBotSettings (read-modify-write) сохраняет env-секцию и chats (VL-143).
    if (method === 'PUT' && url === '/api/settings') {
      const validated = validateSettingsPatch(body);
      if ('error' in validated) return { status: 400, body: { error: validated.error } };
      const settings = loadBotSettings(cwd);
      Object.assign(settings, validated.patch);
      saveBotSettings(cwd, settings);
      return { status: 200, body: { settings: loadBotSettings(cwd) } };
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
      // VL-147: sameSession — явное переопределение настройки code_same_session
      // для фазы code (продолжение plan-сессии через --resume)
      const sameSession = typeof body?.sameSession === 'boolean' ? body.sameSession : undefined;
      const result = startPhase(cwd, triggerMatch[1], phase, undefined, undefined, 'qwen', {
        sameSession,
      });
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

/**
 * Валидация патча настроек из PUT /api/settings (VL-156) — зеркало команды /set.
 *
 * Правила (как в bot/handlers.ts и loadBotSettings):
 * - default_agent: только 'qwen' | 'vb';
 * - max_wall_time / max_requests: положительное целое; 0 или null — явный
 *   сброс (undefined → saveBotSettings удалит ключ, дефолт агента);
 * - branch_mode / compact / code_same_session: строго boolean;
 * - неизвестные ключи → 400: веб не пишет в settings.json то, что бот
 *   проигнорирует или сломает.
 *
 * @returns patch — валидированные поля для Object.assign в BotSettings,
 *   либо error — текст ошибки (HTTP 400, файл не меняется)
 */
function validateSettingsPatch(
  body: Record<string, unknown> | null
): { patch: Partial<BotSettings> } | { error: string } {
  const patch: Partial<BotSettings> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    switch (key) {
      case 'default_agent':
        // Discriminated union как в /set: известные значения фиксируем
        if (value !== 'qwen' && value !== 'vb') {
          return { error: `default_agent: ожидается 'qwen' или 'vb', получено ${JSON.stringify(value)}` };
        }
        patch.default_agent = value;
        break;
      case 'max_wall_time':
      case 'max_requests': {
        // 0/null — сброс (undefined удалит ключ); иначе положительное целое.
        // Number(null) === 0 и Number('') === 0 — оба идут в сброс
        if (value === null || value === 0) {
          patch[key] = undefined;
          break;
        }
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          return { error: `${key}: ожидается положительное целое (или 0/null — сброс), получено ${JSON.stringify(value)}` };
        }
        patch[key] = n;
        break;
      }
      case 'branch_mode':
      case 'compact':
      case 'code_same_session':
        // Строго boolean: строка 'true' или мусор → 400, а не молчаливый off
        if (typeof value !== 'boolean') {
          return { error: `${key}: ожидается boolean, получено ${JSON.stringify(value)}` };
        }
        patch[key] = value;
        break;
      default:
        return { error: `Неизвестный ключ настройки: ${key}` };
    }
  }
  return { patch };
}
