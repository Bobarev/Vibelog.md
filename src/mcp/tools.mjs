/**
 * MCP-инструменты Vibelog.md.
 *
 * Совместимы с Backlog.md по именам и формату параметров.
 * Каждый инструмент — обёртка над функциями ядра (store.mjs, search.mjs, deps.mjs).
 *
 * v1.1 — добавлены инструменты записи:
 * - backlog_update_task — универсальное обновление полей задачи
 * - backlog_manage_ac — управление Acceptance Criteria
 * - backlog_manage_dod — управление Definition of Done
 * - backlog_add_comment — добавление комментария
 * - backlog_update_dependencies — управление зависимостями
 *
 * Формат имён: `backlog_<action>_<entity>` (наш конвеншн, отличается от оригинала `task_<action>`).
 * Схемы параметров — совместимы с оригиналом Backlog.md.
 */

import {
  listTasks, getTask, createTaskFile,
  updateTaskFile, completeTaskFile,
} from '../core/store.mjs';
import { searchTasks } from '../core/search.mjs';
import { isReady, blockedBy, validateDeps } from '../core/deps.mjs';
import { loadConfig } from '../core/config.mjs';

/**
 * Возвращает список всех MCP-инструментов.
 *
 * @returns {Array<{name: string, description: string, inputSchema: object}>}
 */
export function listTools() {
  return [
    // === Управление задачами ===
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
          milestone: { type: 'string', description: 'Веха (milestone)' },
          due_date: { type: 'string', description: 'Срок (YYYY-MM-DD)' },
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
          labels: { type: 'array', items: { type: 'string' }, description: 'Фильтр по меткам' },
          milestone: { type: 'string', description: 'Фильтр по вехе' },
          ready: { type: 'boolean', description: 'Только задачи без открытых блокеров' },
          sort: { type: 'string', enum: ['priority', 'created', 'updated'], description: 'Сортировка' },
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
      description: 'Обновить статус задачи. Возможные значения: To Do, In Progress, Done (читаются из конфига)',
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
      name: 'backlog_update_task',
      description: 'Универсальное обновление полей задачи. Обновляет только переданные поля.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          title: { type: 'string', description: 'Новый заголовок' },
          description: { type: 'string', description: 'Новое описание (полная замена)' },
          priority: { type: 'string', enum: ['High', 'Medium', 'Low'], description: 'Приоритет' },
          assignee: { type: 'array', items: { type: 'string' }, description: 'Исполнители (полная замена)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Метки (полная замена)' },
          milestone: { type: 'string', description: 'Веха' },
          status: { type: 'string', description: 'Статус' },
          plan: { type: 'string', description: 'План реализации (записывает в ## Implementation Plan)' },
          notes: { type: 'string', description: 'Заметки (полная замена ## Implementation Notes)' },
          append_notes: { type: 'string', description: 'Дописать в конец ## Implementation Notes' },
          final_summary: { type: 'string', description: 'Итоговое резюме (записывает в ## Final Summary)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'backlog_manage_ac',
      description: 'Управление Acceptance Criteria задачи (add/check/uncheck/remove/list)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          action: { type: 'string', enum: ['add', 'check', 'uncheck', 'remove', 'list'], description: 'Действие' },
          text: { type: 'string', description: 'Текст критерия (для action=add)' },
          index: { type: 'number', description: 'Номер критерия, начиная с 1 (для check/uncheck/remove)' },
        },
        required: ['id', 'action'],
      },
    },
    {
      name: 'backlog_manage_dod',
      description: 'Управление Definition of Done задачи (add/check/uncheck/remove/list)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          action: { type: 'string', enum: ['add', 'check', 'uncheck', 'remove', 'list'], description: 'Действие' },
          text: { type: 'string', description: 'Текст критерия (для action=add)' },
          index: { type: 'number', description: 'Номер критерия, начиная с 1 (для check/uncheck/remove)' },
        },
        required: ['id', 'action'],
      },
    },
    {
      name: 'backlog_add_comment',
      description: 'Добавить комментарий к задаче',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          comment: { type: 'string', description: 'Текст комментария' },
          author: { type: 'string', description: 'Автор (по умолчанию @agent)' },
        },
        required: ['id', 'comment'],
      },
    },
    {
      name: 'backlog_update_dependencies',
      description: 'Добавить или удалить зависимости задачи. Проверяет циклы.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          add: { type: 'array', items: { type: 'string' }, description: 'ID задач для добавления в зависимости' },
          remove: { type: 'array', items: { type: 'string' }, description: 'ID задач для удаления из зависимостей' },
        },
        required: ['id'],
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
 * @returns {Promise<string>} — результат (строка)
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
    case 'backlog_update_task':
      return toolUpdateTask(args, cwd);
    case 'backlog_manage_ac':
      return toolManageAc(args, cwd);
    case 'backlog_manage_dod':
      return toolManageDod(args, cwd);
    case 'backlog_add_comment':
      return toolAddComment(args, cwd);
    case 'backlog_update_dependencies':
      return toolUpdateDependencies(args, cwd);
    case 'backlog_search':
      return toolSearch(args, cwd);
    case 'backlog_ready':
      return toolReady(args, cwd);
    default:
      throw new Error(`Неизвестный инструмент: ${name}`);
  }
}

// ============================================================
// Существующие инструменты (с обновлениями)
// ============================================================

/**
 * Создаёт задачу.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
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
    milestone: args.milestone || '',
    due_date: args.due_date || '',
  });
  return `Задача ${task.id} создана: ${task.title}`;
}

/**
 * Выводит список задач с фильтрацией, сортировкой.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
 */
function toolListTasks(args, cwd) {
  let tasks = listTasks(cwd);

  if (args.status) {
    tasks = tasks.filter(t => t.status.toLowerCase() === args.status.toLowerCase());
  }
  if (args.labels && args.labels.length > 0) {
    tasks = tasks.filter(t =>
      t.labels && args.labels.some(l =>
        t.labels.some(tl => tl.toLowerCase() === l.toLowerCase())
      )
    );
  }
  if (args.milestone) {
    tasks = tasks.filter(t => t.milestone && t.milestone.toLowerCase() === args.milestone.toLowerCase());
  }
  if (args.ready) {
    tasks = tasks.filter(t => isReady(cwd, t));
  }

  // Сортировка
  if (args.sort === 'priority') {
    const priorityOrder = { High: 0, Medium: 1, Low: 2 };
    tasks.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  } else if (args.sort === 'created') {
    tasks.sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));
  } else if (args.sort === 'updated') {
    tasks.sort((a, b) => (b.updated_date || '').localeCompare(a.updated_date || ''));
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
    milestone: t.milestone,
  }));

  return JSON.stringify(simplified, null, 2);
}

/**
 * Просматривает задачу по ID.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
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
 * @returns {string}
 */
function toolUpdateStatus(args, cwd) {
  const task = updateTaskFile(cwd, args.id, { status: args.status });
  return `Статус задачи ${task.id} обновлён: ${task.status}`;
}

// ============================================================
// Новые инструменты v1.1
// ============================================================

/**
 * Универсальное обновление полей задачи.
 *
 * Обновляет только переданные поля. updated_date обновляется всегда.
 * Поля plan/notes/append_notes/final_summary пишут в соответствующие секции тела.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
 */
function toolUpdateTask(args, cwd) {
  const updates = {};

  // Frontmatter-поля
  if (args.title !== undefined) updates.title = args.title;
  if (args.description !== undefined) updates.description = args.description;
  if (args.priority !== undefined) updates.priority = args.priority;
  if (args.assignee !== undefined) updates.assignee = args.assignee;
  if (args.labels !== undefined) updates.labels = args.labels;
  if (args.milestone !== undefined) updates.milestone = args.milestone;
  if (args.status !== undefined) updates.status = args.status;

  // Секции тела
  if (args.plan !== undefined) updates.implementationPlan = args.plan;
  if (args.notes !== undefined) updates.implementationNotes = args.notes;
  if (args.final_summary !== undefined) updates.finalSummary = args.final_summary;

  // append_notes — дописывает в конец существующих заметок
  if (args.append_notes !== undefined) {
    const task = getTask(cwd, args.id);
    if (!task) throw new Error(`Задача ${args.id} не найдена.`);
    updates.implementationNotes = (task.implementationNotes || '') +
      (task.implementationNotes ? '\n' : '') + args.append_notes;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('Не указаны поля для обновления.');
  }

  const task = updateTaskFile(cwd, args.id, updates);
  return `Задача ${task.id} обновлена: ${Object.keys(updates).join(', ')}`;
}

/**
 * Управление Acceptance Criteria.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
 */
function toolManageAc(args, cwd) {
  return manageChecklist(args, cwd, 'acceptanceCriteria');
}

/**
 * Управление Definition of Done.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
 */
function toolManageDod(args, cwd) {
  return manageChecklist(args, cwd, 'definitionOfDone');
}

/**
 * Общая логика управления чеклистами (AC / DoD).
 *
 * @param {object} args — { id, action, text?, index? }
 * @param {string} cwd
 * @param {string} field — 'acceptanceCriteria' или 'definitionOfDone'
 * @returns {string}
 */
function manageChecklist(args, cwd, field) {
  const task = getTask(cwd, args.id);
  if (!task) throw new Error(`Задача ${args.id} не найдена.`);

  const list = task[field] || [];

  switch (args.action) {
    case 'list': {
      if (list.length === 0) return 'Чеклист пуст.';
      const lines = list.map((item, i) => {
        const mark = item.checked ? '✓' : '○';
        return `${i + 1}. ${mark} ${item.text}`;
      });
      return lines.join('\n');
    }

    case 'add': {
      if (!args.text) throw new Error('Для action=add требуется параметр text.');
      list.push({ text: args.text, checked: false });
      updateTaskFile(cwd, args.id, { [field]: list });
      return `Добавлен критерий #${list.length}: ${args.text}`;
    }

    case 'check': {
      const idx = args.index - 1;
      if (idx < 0 || idx >= list.length) {
        throw new Error(`Неверный индекс: ${args.index}. Доступно: 1-${list.length}`);
      }
      list[idx].checked = true;
      updateTaskFile(cwd, args.id, { [field]: list });
      return `Отмечен критерий #${args.index}: ${list[idx].text}`;
    }

    case 'uncheck': {
      const idx = args.index - 1;
      if (idx < 0 || idx >= list.length) {
        throw new Error(`Неверный индекс: ${args.index}. Доступно: 1-${list.length}`);
      }
      list[idx].checked = false;
      updateTaskFile(cwd, args.id, { [field]: list });
      return `Снята отметка с критерия #${args.index}: ${list[idx].text}`;
    }

    case 'remove': {
      const idx = args.index - 1;
      if (idx < 0 || idx >= list.length) {
        throw new Error(`Неверный индекс: ${args.index}. Доступно: 1-${list.length}`);
      }
      const removed = list.splice(idx, 1)[0];
      updateTaskFile(cwd, args.id, { [field]: list });
      return `Удалён критерий #${args.index}: ${removed.text}`;
    }

    default:
      throw new Error(`Неизвестное действие: ${args.action}. Используйте: add, check, uncheck, remove, list`);
  }
}

/**
 * Добавляет комментарий к задаче.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
 */
function toolAddComment(args, cwd) {
  const task = getTask(cwd, args.id);
  if (!task) throw new Error(`Задача ${args.id} не найдена.`);

  const comment = {
    author: args.author || '@agent',
    created: formatNow(),
    text: args.comment,
  };

  const comments = [...(task.comments || []), comment];
  updateTaskFile(cwd, args.id, { comments });

  return `Комментарий добавлен к задаче ${args.id} (${comment.author})`;
}

/**
 * Обновляет зависимости задачи.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
 */
function toolUpdateDependencies(args, cwd) {
  const task = getTask(cwd, args.id);
  if (!task) throw new Error(`Задача ${args.id} не найдена.`);

  let deps = [...(task.dependencies || [])];

  // Добавляем новые зависимости
  if (args.add && args.add.length > 0) {
    for (const dep of args.add) {
      if (!deps.includes(dep)) deps.push(dep);
    }
  }

  // Удаляем зависимости
  if (args.remove && args.remove.length > 0) {
    deps = deps.filter(d => !args.remove.includes(d));
  }

  // Проверяем циклы
  const probe = { ...task, dependencies: deps };
  const validation = validateDeps(cwd, probe, [...listTasks(cwd).filter(t => t.id !== task.id), probe]);
  if (!validation.valid) {
    throw new Error(`Обнаружен цикл зависимостей: ${validation.cycle.join(' → ')}`);
  }

  updateTaskFile(cwd, args.id, { dependencies: deps });
  return `Зависимости задачи ${args.id} обновлены: [${deps.join(', ')}]`;
}

// ============================================================
// Поиск и готовность
// ============================================================

/**
 * Ищет задачи по запросу.
 *
 * @param {object} args
 * @param {string} cwd
 * @returns {string}
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
 * @returns {string}
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

/**
 * Форматирует текущую дату.
 *
 * @returns {string} — "YYYY-MM-DD HH:MM"
 */
function formatNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
