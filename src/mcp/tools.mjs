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
import { loadConfig, normalizeTaskType } from '../core/config.mjs';
import {
  writeMilestone, listMilestones, getMilestone,
  renameMilestone, deleteMilestone, archiveMilestone,
} from '../core/milestone.mjs';
import {
  writeDocument, listDocuments, getDocument,
  updateDocument, searchDocuments,
} from '../core/document.mjs';
import { findBacklogDir } from '../core/paths.mjs';

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
          type: { type: 'string', description: 'Тип задачи (bug, feature, ...)' },
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
          type: { type: 'string', description: 'Фильтр по типу' },
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
          type: { type: 'string', description: 'Тип задачи' },
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
          index: { anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }], description: 'Номер(а) критерия с 1, массив — для check/uncheck/remove' },
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
          index: { anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }], description: 'Номер(а) критерия с 1, массив — для check/uncheck/remove' },
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
      description: 'Поиск задач с фильтрами (query, status, type, project, priority, modifiedFiles, limit)',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 200, description: 'Поисковый запрос (substring по id/title/description/labels)' },
          status: { type: 'string', description: 'Фильтр по статусу' },
          type: { type: 'string', description: 'Фильтр по типу (bug, feature, ...)' },
          project: { type: 'string', description: 'Фильтр по проекту' },
          priority: { type: 'string', description: 'Фильтр по приоритету' },
          modifiedFiles: { type: 'array', items: { type: 'string' }, description: 'Фильтр по подстроке в modified_files задачи' },
          limit: { type: 'number', minimum: 1, maximum: 100, description: 'Максимум результатов' },
        },
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
    // === Milestones ===
    {
      name: 'milestone_list',
      description: 'Список вех (milestones)',
      inputSchema: {
        type: 'object',
        properties: {
          include_archived: { type: 'boolean', description: 'Включить архивные вехи' },
        },
      },
    },
    {
      name: 'milestone_add',
      description: 'Создать веху (milestone)',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Название вехи' },
          description: { type: 'string', description: 'Описание' },
          due_date: { type: 'string', description: 'Срок (YYYY-MM-DD)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'milestone_rename',
      description: 'Переименовать веху. Обновляет milestone в задачах.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Текущее название' },
          to: { type: 'string', description: 'Новое название' },
          update_tasks: { type: 'boolean', description: 'Обновить задачи (по умолчанию true)' },
        },
        required: ['from', 'to'],
      },
    },
    {
      name: 'milestone_remove',
      description: 'Удалить веху. Обрабатывает связанные задачи.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Название вехи' },
          task_handling: { type: 'string', enum: ['clear', 'keep', 'reassign'], description: 'Что делать с задачами (по умолчанию clear)' },
          reassign_to: { type: 'string', description: 'Целевая веха для reassign' },
        },
        required: ['name'],
      },
    },
    {
      name: 'milestone_archive',
      description: 'Архивировать веху (перенести в completed/)',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Название вехи' },
        },
        required: ['name'],
      },
    },
    // === Documents (v1.4) ===
    {
      name: 'document_list',
      description: 'Список документов (docs/), с опциональным текстовым фильтром',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Фильтр по id/title/tags/телу' },
        },
      },
    },
    {
      name: 'document_view',
      description: 'Показать документ по id (фронтматтер + содержимое)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID документа (например doc-1)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'document_create',
      description: 'Создать документ (спецификацию/гайд)',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок' },
          content: { type: 'string', description: 'Markdown-содержимое' },
          type: { type: 'string', enum: ['readme', 'guide', 'specification', 'other'], description: 'Тип документа' },
          tags: { type: 'array', items: { type: 'string', maxLength: 100 }, description: 'Теги' },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: 'document_update',
      description: 'Обновить документ (только переданные поля)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID документа' },
          title: { type: 'string', description: 'Новый заголовок' },
          content: { type: 'string', description: 'Новое содержимое (полная замена)' },
          type: { type: 'string', enum: ['readme', 'guide', 'specification', 'other'], description: 'Тип' },
          tags: { type: 'array', items: { type: 'string', maxLength: 100 }, description: 'Теги (полная замена)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'document_search',
      description: 'Поиск документов по запросу',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 200, description: 'Поисковый запрос' },
        },
        required: ['query'],
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
    case 'milestone_list':
      return toolMilestoneList(args, cwd);
    case 'milestone_add':
      return toolMilestoneAdd(args, cwd);
    case 'milestone_rename':
      return toolMilestoneRename(args, cwd);
    case 'milestone_remove':
      return toolMilestoneRemove(args, cwd);
    case 'milestone_archive':
      return toolMilestoneArchive(args, cwd);
    case 'document_list':
      return toolDocumentList(args, cwd);
    case 'document_view':
      return toolDocumentView(args, cwd);
    case 'document_create':
      return toolDocumentCreate(args, cwd);
    case 'document_update':
      return toolDocumentUpdate(args, cwd);
    case 'document_search':
      return toolDocumentSearch(args, cwd);
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
    type: args.type ? normalizeTaskType(loadConfig(cwd), args.type) : '',
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
  if (args.type) {
    tasks = tasks.filter(t => t.type && t.type.toLowerCase() === args.type.toLowerCase());
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
    type: t.type,
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
  if (args.type !== undefined) updates.type = normalizeTaskType(loadConfig(cwd), args.type);

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

    case 'check':
    case 'uncheck': {
      // index: одиночный номер или массив (как acceptanceCriteriaCheck оригинала)
      const indexes = (Array.isArray(args.index) ? args.index : [args.index]).map(Number);
      for (const i of indexes) {
        const idx = i - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
          throw new Error(`Неверный индекс: ${i}. Доступно: 1-${list.length}`);
        }
      }
      const checked = args.action === 'check';
      for (const i of indexes) {
        list[i - 1].checked = checked;
      }
      updateTaskFile(cwd, args.id, { [field]: list });
      return checked
        ? `Отмечены критерии #${indexes.join(', #')}`
        : `Сняты отметки с критериев #${indexes.join(', #')}`;
    }

    case 'remove': {
      // Несколько индексов — удаляем по убыванию, чтобы не сдвигать позиции
      const indexes = (Array.isArray(args.index) ? args.index : [args.index]).map(Number);
      for (const i of indexes) {
        const idx = i - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
          throw new Error(`Неверный индекс: ${i}. Доступно: 1-${list.length}`);
        }
      }
      for (const i of [...indexes].sort((a, b) => b - a)) {
        list.splice(i - 1, 1);
      }
      updateTaskFile(cwd, args.id, { [field]: list });
      return `Удалены критерии #${indexes.join(', #')}`;
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
  const tasks = searchTasks(cwd, {
    query: args.query,
    status: args.status,
    type: args.type,
    project: args.project,
    priority: args.priority,
    modifiedFiles: args.modifiedFiles,
    limit: args.limit,
  });
  const simplified = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    type: t.type,
    project: t.project,
    labels: t.labels,
    milestone: t.milestone,
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

// ============================================================
// Milestones (v1.3)
// ============================================================

function toolMilestoneList(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  let milestones = listMilestones(backlogDir, { includeArchived: !!args.include_archived });
  if (!args.include_archived) {
    milestones = milestones.filter(m => m.status !== 'archived');
  }
  return JSON.stringify(milestones, null, 2);
}

function toolMilestoneAdd(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const milestone = writeMilestone(backlogDir, {
    name: args.name,
    description: args.description || '',
    due_date: args.due_date || '',
  });
  return `Веха "${milestone.name}" создана.`;
}

function toolMilestoneRename(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const updated = renameMilestone(backlogDir, args.from, args.to);
  if (!updated) throw new Error(`Веха "${args.from}" не найдена.`);

  let updatedCount = 0;
  if (args.update_tasks !== false) {
    const tasks = listTasks(cwd);
    for (const task of tasks) {
      if (task.milestone && task.milestone.toLowerCase() === args.from.toLowerCase()) {
        updateTaskFile(cwd, task.id, { milestone: args.to });
        updatedCount++;
      }
    }
  }
  return `Веха переименована: ${args.from} → ${args.to}. Задач обновлено: ${updatedCount}`;
}

function toolMilestoneRemove(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const deleted = deleteMilestone(backlogDir, args.name);
  if (!deleted) throw new Error(`Веха "${args.name}" не найдена.`);

  const handling = args.task_handling || 'clear';
  let updatedCount = 0;
  const tasks = listTasks(cwd);
  for (const task of tasks) {
    if (task.milestone && task.milestone.toLowerCase() === args.name.toLowerCase()) {
      if (handling === 'clear') {
        updateTaskFile(cwd, task.id, { milestone: '' });
        updatedCount++;
      } else if (handling === 'reassign' && args.reassign_to) {
        updateTaskFile(cwd, task.id, { milestone: args.reassign_to });
        updatedCount++;
      }
    }
  }
  return `Веха "${args.name}" удалена. Задач обработано: ${updatedCount} (${handling})`;
}

function toolMilestoneArchive(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const archived = archiveMilestone(backlogDir, args.name);
  if (!archived) throw new Error(`Веха "${args.name}" не найдена.`);
  return `Веха "${args.name}" архивирована.`;
}


// ============================================================
// Documents (v1.4)
// ============================================================

function toolDocumentList(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  let entries = listDocuments(backlogDir);
  if (args.query) {
    const q = args.query.toLowerCase();
    entries = entries.filter(e =>
      e.document.id.toLowerCase().includes(q) ||
      e.document.title.toLowerCase().includes(q) ||
      e.document.tags.some(t => String(t).toLowerCase().includes(q)) ||
      (e.body && e.body.toLowerCase().includes(q))
    );
  }
  return JSON.stringify(entries.map(e => e.document), null, 2);
}

function toolDocumentView(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const entry = getDocument(backlogDir, args.id);
  if (!entry) throw new Error(`Документ ${args.id} не найден.`);
  return JSON.stringify({ ...entry.document, content: entry.body }, null, 2);
}

function toolDocumentCreate(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const doc = writeDocument(backlogDir, {
    title: args.title,
    type: args.type || '',
    tags: args.tags || [],
    content: args.content || '',
  });
  return `Документ ${doc.id} создан: ${doc.title} (тип: ${doc.type})`;
}

function toolDocumentUpdate(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const updates = {};
  if (args.title !== undefined) updates.title = args.title;
  if (args.content !== undefined) updates.content = args.content;
  if (args.type !== undefined) updates.type = args.type;
  if (args.tags !== undefined) updates.tags = args.tags;
  if (Object.keys(updates).length === 0) {
    throw new Error('Не указаны поля для обновления (title, content, type, tags).');
  }
  const updated = updateDocument(backlogDir, args.id, updates);
  if (!updated) throw new Error(`Документ ${args.id} не найден.`);
  return `Документ ${updated.document.id} обновлён: ${updated.document.title}`;
}

function toolDocumentSearch(args, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const entries = searchDocuments(backlogDir, args.query);
  return JSON.stringify(entries.map(e => e.document), null, 2);
}
