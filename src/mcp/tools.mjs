/**
 * MCP-инструменты Vibelog.md.
 *
 * Совместимы с Backlog.md по именам и формату параметров.
 * Каждый инструмент — обёртка над функциями ядра (store.mjs, search.mjs, deps.mjs).
 *
 * Инструменты:
 * - backlog_create_task — создать задачу
 * - backlog_list_tasks — список задач
 * - backlog_view_task — просмотр задачи
 * - backlog_update_status — обновить статус
 * - backlog_search — поиск задач
 * - backlog_ready — готовые к работе задачи
 */

import {
  listTasks, getTask, createTaskFile,
  updateTaskFile, completeTaskFile,
} from '../core/store.mjs';
import { searchTasks } from '../core/search.mjs';
import { isReady } from '../core/deps.mjs';
import { loadConfig } from '../core/config.mjs';

/**
 * Возвращает список всех MCP-инструментов.
 *
 * Формат совместим с MCP SDK:
 * - name: уникальное имя инструмента
 * - description: описание для AI-агента
 * - inputSchema: JSON Schema параметров
 *
 * @returns {Array<{name: string, description: string, inputSchema: object}>}
 */
export function listTools() {
  return [
    {
      name: 'backlog_create_task',
      description: 'Создать новую задачу в backlog',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок задачи' },
          description: { type: 'string', description: 'Описание задачи' },
          priority: { type: 'string', enum: ['High', 'Medium', 'Low'], description: 'Приоритет' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Метки' },
          dependencies: { type: 'array', items: { type: 'string' }, description: 'ID зависимостей' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Критерии приёмки' },
          status: { type: 'string', description: 'Статус (по умолчанию из конфига)' },
          assignee: { type: 'array', items: { type: 'string' }, description: 'Исполнители' },
        },
        required: ['title'],
      },
    },
    {
      name: 'backlog_list_tasks',
      description: 'Получить список задач с фильтрацией',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Фильтр по статусу' },
          labels: { type: 'string', description: 'Фильтр по метке' },
          limit: { type: 'number', description: 'Максимальное количество задач' },
        },
      },
    },
    {
      name: 'backlog_view_task',
      description: 'Получить детали задачи по ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи (например back-100)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'backlog_update_status',
      description: 'Обновить статус задачи',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          status: { type: 'string', description: 'Новый статус' },
        },
        required: ['id', 'status'],
      },
    },
    {
      name: 'backlog_search',
      description: 'Поиск задач по текстовому запросу',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос' },
        },
        required: ['query'],
      },
    },
    {
      name: 'backlog_ready',
      description: 'Получить список задач, готовых к выполнению (все зависимости выполнены)',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

/**
 * Вызывает MCP-инструмент по имени.
 *
 * @param {string} name — имя инструмента
 * @param {object} args — аргументы инструмента
 * @param {string} cwd — рабочая директория
 * @returns {Promise<string|object>} — результат (текст или объект)
 * @throws {Error} — если инструмент не найден или произошла ошибка
 */
export async function handleToolCall(name, args, cwd) {
  switch (name) {
    case 'backlog_create_task':
      return toolCreateTask(args, cwd);
    case 'backlog_list_tasks':
      return toolListTasks(args, cwd);
    case 'backlog_view_task':
      return toolViewTask(args, cwd);
    case 'backlog_update_status':
      return toolUpdateStatus(args, cwd);
    case 'backlog_search':
      return toolSearch(args, cwd);
    case 'backlog_ready':
      return toolReady(args, cwd);
    default:
      throw new Error(`Неизвестный инструмент: ${name}`);
  }
}

/**
 * Создаёт задачу.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string} — подтверждение с ID созданной задачи
 */
function toolCreateTask(args, cwd) {
  const task = createTaskFile(cwd, {
    title: args.title,
    description: args.description || '',
    priority: args.priority || '',
    labels: args.labels || [],
    dependencies: args.dependencies || [],
    acceptanceCriteria: (args.acceptanceCriteria || []).map(text => ({ text, checked: false })),
    status: args.status || '',
    assignee: args.assignee || [],
  });
  return `Задача ${task.id} создана: ${task.title}`;
}

/**
 * Выводит список задач.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string} — JSON со списком задач
 */
function toolListTasks(args, cwd) {
  let tasks = listTasks(cwd);

  if (args.status) {
    tasks = tasks.filter(t => t.status.toLowerCase() === args.status.toLowerCase());
  }
  if (args.labels) {
    tasks = tasks.filter(t =>
      t.labels && t.labels.some(l => l.toLowerCase() === args.labels.toLowerCase())
    );
  }
  if (args.limit) {
    tasks = tasks.slice(0, args.limit);
  }

  const simplified = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    labels: t.labels,
    assignee: t.assignee,
  }));

  return JSON.stringify(simplified, null, 2);
}

/**
 * Просматривает задачу по ID.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string} — JSON с деталями задачи
 */
function toolViewTask(args, cwd) {
  const task = getTask(cwd, args.id);
  if (!task) {
    throw new Error(`Задача ${args.id} не найдена.`);
  }
  return JSON.stringify(task, null, 2);
}

/**
 * Обновляет статус задачи.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string} — подтверждение
 */
function toolUpdateStatus(args, cwd) {
  const task = updateTaskFile(cwd, args.id, { status: args.status });
  return `Статус задачи ${task.id} обновлён: ${task.status}`;
}

/**
 * Ищет задачи по запросу.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string} — JSON со списком найденных задач
 */
function toolSearch(args, cwd) {
  const tasks = searchTasks(cwd, args.query);
  const simplified = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
  }));
  return JSON.stringify(simplified, null, 2);
}

/**
 * Возвращает задачи, готовые к выполнению.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string} — JSON со списком готовых задач
 */
function toolReady(args, cwd) {
  const allTasks = listTasks(cwd);
  const ready = allTasks.filter(t => isReady(cwd, t));
  const simplified = ready.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
  }));
  return JSON.stringify(simplified, null, 2);
}
