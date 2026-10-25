/**
 * MCP-инструменты Vibelog.md.
 *
 * Совместимы с Backlog.md по именам и формату параметров.
 * Каждый инструмент — обёртка над функциями ядра (store, search, deps).
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
} from '../core/store.js';
import { searchTasks } from '../core/search.js';
import { isReady, validateDeps } from '../core/deps.js';
import { loadConfig, normalizeTaskType } from '../core/config.js';
import {
  writeMilestone, listMilestones, getMilestone,
  renameMilestone, deleteMilestone, archiveMilestone,
} from '../core/milestone.js';
import {
  writeDocument, listDocuments, getDocument,
  updateDocument, searchDocuments,
} from '../core/document.js';
import type { UpdateDocumentInput } from '../core/document.js';
import {
  listReferences, getReference, writeReference,
  updateReference, removeReference, searchReferences,
  cloneReferenceRepo, syncReferenceRepos, linkReferenceTask,
  REFERENCE_TYPES,
} from '../core/reference.js';
import type { UpdateReferenceInput } from '../core/reference.js';
import {
  listLessons, getLesson, createLessonFile,
  updateLesson, searchLessons, linkLesson, supersedeLesson,
} from '../core/lesson.js';
import type { UpdateLessonInput } from '../core/lesson.js';
import { findBacklogDir } from '../core/paths.js';
import type { Task, TaskComment, ChecklistItem } from '../core/task.js';

// completeTaskFile импортирован для паритета с оригинальным модулем;
// в текущей логике инструментов не вызывается (оставлено без изменений).
void completeTaskFile;

/**
 * Аргументы MCP-инструмента: произвольный JSON со stdio.
 * Значения проверяются схемами и ядром; касты на сайтах использования
 * отражают контракт схемы конкретного инструмента.
 */
export type ToolArgs = Record<string, unknown>;

/** Описание MCP-инструмента (формат tools/list). */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Возвращает список всех MCP-инструментов.
 */
export function listTools(): ToolDefinition[] {
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
          priority: { type: 'string', description: 'Приоритет (High/Medium/Low или значение из config.priorities)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Метки' },
          dependencies: { type: 'array', items: { type: 'string' }, description: 'ID зависимостей' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Критерии приёмки' },
          status: { type: 'string', description: 'Статус (по умолчанию из конфига)' },
          assignee: { type: 'array', items: { type: 'string' }, description: 'Исполнители' },
          milestone: { type: 'string', description: 'Веха (milestone)' },
          type: { type: 'string', description: 'Тип задачи (bug, feature, ...)' },
          parentTaskId: { type: 'string', description: 'ID родительской задачи' },
          due_date: { type: 'string', description: 'Срок (YYYY-MM-DD)' },
          ordinal: { type: 'number', description: 'Порядковый номер для кастомной сортировки' },
          project: { type: 'string', description: 'Проект' },
          finalSummary: { type: 'string', maxLength: 20000, description: 'Итоговое резюме (для завершённых задач)' },
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
          parentTaskId: { type: 'string', description: 'Фильтр по родительской задаче' },
          ready: { type: 'boolean', description: 'Только задачи без открытых блокеров' },
          sort: { type: 'string', enum: ['priority', 'created', 'updated'], description: 'Сортировка' },
          limit: { type: 'number', description: 'Максимальное количество задач' },
        },
      },
    },
    {
      name: 'backlog_view_task',
      description: 'Получить детали задачи по ID; опционально fields — выбор возвращаемых полей (VL-162)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи (например back-100)' },
          // VL-162: урезанный режим — например для фазы Spec достаточно ["id","title","description"]
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Имена полей Task для возврата (ключи интерфейса Task, напр. ["id","title","description"]); без параметра или при пустом массиве — полное представление',
          },
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
          priority: { type: 'string', description: 'Приоритет (High/Medium/Low или значение из config.priorities)' },
          assignee: { type: 'array', items: { type: 'string' }, description: 'Исполнители (полная замена)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Метки (полная замена)' },
          milestone: { type: 'string', description: 'Веха' },
          type: { type: 'string', description: 'Тип задачи' },
          parentTaskId: { type: 'string', description: 'Родительская задача; пустая строка — сброс' },
          status: { type: 'string', description: 'Статус' },
          plan: { type: 'string', description: 'План реализации (записывает в ## Implementation Plan)' },
          notes: { type: 'string', description: 'Заметки (полная замена ## Implementation Notes)' },
          append_notes: { type: 'string', description: 'Дописать в конец ## Implementation Notes' },
          final_summary: { type: 'string', description: 'Итоговое резюме (записывает в ## Final Summary)' },
          // VL-97: без записи modified_files close-шаг не мог собрать feat-коммит (инцидент VL-94)
          modifiedFiles: { type: 'array', items: { type: 'string' }, description: 'Изменённые файлы (полная замена modified_files)' },
          // VL-152: поле references задачи (связь с reference_*); двусторонняя связь — через reference_link
          references: { type: 'array', items: { type: 'string' }, description: 'ID references задачи (полная замена references)' },
          // VL-153: поле lessons задачи (связь с lesson_*); двусторонняя связь — через lesson_link
          lessons: { type: 'array', items: { type: 'string' }, description: 'ID lessons задачи (полная замена lessons)' },
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
          text: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Текст критерия (для action=add); массив строк — несколько за один вызов; JSON-строка массива — тоже несколько' },
          index: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] } }], description: 'Номер(а) критерия с 1; строка-число ("3"); массив [1,2,3] — несколько; "all" — все пункты; строка-массив "[1, 2]" тоже принимается' },
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
          text: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Текст критерия (для action=add); массив строк — несколько за один вызов; JSON-строка массива — тоже несколько' },
          index: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] } }], description: 'Номер(а) критерия с 1; строка-число ("3"); массив [1,2,3] — несколько; "all" — все пункты; строка-массив "[1, 2]" тоже принимается' },
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
          hasLessons: { type: 'boolean', description: 'Фильтр по наличию lessons у задачи (true — есть, false — нет)' },
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
    // === Завершение фазы (VL-138) ===
    {
      name: 'backlog_finish_phase',
      description: 'Завершение фазы одним вызовом: статус + отчётный комментарий + modifiedFiles + батч-отметки AC/DoD. Все поля опциональны кроме id. Невалидные поля пропускаются с понятным сообщением в сводке (частичное применение), вызов не падает. Пример сводки: «Статус: Review; отчёт добавлен; отмечено AC: 2, DoD: 1; файлов: 3».',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          status: { type: 'string', description: 'Новый статус (валидируется по конфигу; невалидный — пропускается с ошибкой в сводке)' },
          comment: { type: 'string', description: 'Отчётный комментарий (author фиксирован @agent)' },
          modifiedFiles: { type: 'array', items: { type: 'string' }, description: 'Изменённые файлы (полная замена modified_files)' },
          acChecks: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] }, description: 'Индексы AC для отметки (с 1; батч-отметка, как в manage_ac)' },
          dodChecks: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] }, description: 'Индексы DoD для отметки (с 1; батч-отметка, как в manage_dod)' },
        },
        required: ['id'],
      },
    },
    // === References — метаданные о внешних источниках (VL-152) ===
    {
      name: 'reference_list',
      description: 'Список references (внешних источников знаний) с опциональными фильтрами type/tags.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: REFERENCE_TYPES, description: 'Фильтр по типу (repo/url/file/doc/spec)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Фильтр по меткам (все указанные должны совпасть)' },
        },
      },
    },
    {
      name: 'reference_add',
      description: 'Добавить reference (внешний источник знаний). Для type=repo по умолчанию САМ клонирует репозиторий в backlog/references/data/<dir> (идемпотентно: если каталог есть — пропуск).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок reference' },
          type: { type: 'string', enum: REFERENCE_TYPES, description: 'Тип: repo/url/file/doc/spec' },
          url: { type: 'string', description: 'URL (для repo/url)' },
          path: { type: 'string', description: 'Путь (для file/doc/spec; для repo — каталог клона относительно data/)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Метки' },
          description: { type: 'string', description: 'Markdown-описание (тело)' },
          clone: { type: 'boolean', description: 'Клонировать ли repo (default=true; false — только метаданные)' },
        },
        required: ['title', 'type'],
      },
    },
    {
      name: 'reference_view',
      description: 'Показать reference: метаданные, linked_tasks и тело.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID reference (ref-N)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'reference_search',
      description: 'Поиск references по запросу (substring по id/title/url/path/tags/телу).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос' },
        },
        required: ['query'],
      },
    },
    {
      name: 'reference_remove',
      description: 'Удалить reference (метаданные). Клон в data/ не удаляется.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID reference (ref-N)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'reference_update',
      description: 'Обновить reference: теги и/или описание (полная замена).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID reference (ref-N)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Метки (полная замена)' },
          description: { type: 'string', description: 'Описание (markdown, полная замена тела)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'reference_link',
      description: 'Двусторонняя связь reference ↔ задача: обновляет reference.linked_tasks И task.references.',
      inputSchema: {
        type: 'object',
        properties: {
          referenceId: { type: 'string', description: 'ID reference (ref-N)' },
          taskId: { type: 'string', description: 'ID задачи (VL-N)' },
          action: { type: 'string', enum: ['add', 'remove'], description: 'Добавить (default) или удалить связь' },
        },
        required: ['referenceId', 'taskId'],
      },
    },
    {
      name: 'reference_sync',
      description: 'Клонировать отсутствующие репозитории для всех references type=repo в backlog/references/data/.',
      inputSchema: { type: 'object', properties: {} },
    },
    // === Lessons learned — уроки из задач (VL-153) ===
    {
      name: 'lesson_list',
      description: 'Список lessons (уроков из задач) с опциональными фильтрами status/tags.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Фильтр по статусу (active|outdated|superseded)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Фильтр по меткам (все указанные должны совпасть)' },
        },
      },
    },
    {
      name: 'lesson_create',
      description: 'Создать lesson (урок из опыта задач). Императив, конкретика, 1 предложение в title.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок-урок (императив, 1 предложение)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Метки (для подбора по tags в Plan)' },
          sourceTasks: { type: 'array', items: { type: 'string' }, description: 'Задачи-источники урока (VL-N)' },
          content: { type: 'string', description: 'Markdown-тело (Проблема / Решение / Пример)' },
        },
        required: ['title'],
      },
    },
    {
      name: 'lesson_view',
      description: 'Показать lesson: метаданные, linked_tasks и тело.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID lesson (lesson-N)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'lesson_update',
      description: 'Обновить lesson: поля и/или тело. updated_date обновляется автоматически.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID lesson (lesson-N)' },
          title: { type: 'string', description: 'Новый заголовок (переименовывает файл)' },
          status: { type: 'string', enum: ['active', 'outdated', 'superseded'], description: 'Статус' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Метки (полная замена)' },
          sourceTasks: { type: 'array', items: { type: 'string' }, description: 'Задачи-источники (полная замена)' },
          linkedTasks: { type: 'array', items: { type: 'string' }, description: 'Задачи, где применялся (полная замена)' },
          supersedes: { type: 'string', description: 'ID заменённого lesson (пустая строка — сброс)' },
          content: { type: 'string', description: 'Тело (markdown, полная замена)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'lesson_search_lessons',
      description: 'Поиск lessons по запросу (substring по id/title/tags/телу).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос' },
        },
        required: ['query'],
      },
    },
    {
      name: 'lesson_link',
      description: 'Двусторонняя связь lesson ↔ задача: обновляет lesson.linked_tasks И task.lessons.',
      inputSchema: {
        type: 'object',
        properties: {
          lessonId: { type: 'string', description: 'ID lesson (lesson-N)' },
          taskId: { type: 'string', description: 'ID задачи (VL-N)' },
          action: { type: 'string', enum: ['add', 'remove'], description: 'Добавить (default) или удалить связь' },
        },
        required: ['lessonId', 'taskId'],
      },
    },
    {
      name: 'lesson_supersede',
      description: 'Пометить lesson как заменённый: newId заменяет oldId (oldId → superseded, newId → active с supersedes).',
      inputSchema: {
        type: 'object',
        properties: {
          oldId: { type: 'string', description: 'ID заменяемого lesson (lesson-N)' },
          newId: { type: 'string', description: 'ID нового lesson (lesson-N)' },
        },
        required: ['oldId', 'newId'],
      },
    },
  ];
}

/**
 * Вызывает MCP-инструмент по имени.
 *
 * @param name — имя инструмента
 * @param args — аргументы инструмента
 * @param cwd — рабочая директория
 * @returns результат (строка)
 * @throws если инструмент не найден или произошла ошибка
 */
export async function handleToolCall(name: string, args: ToolArgs, cwd: string): Promise<string> {
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
    case 'backlog_finish_phase':
      return toolFinishPhase(args, cwd);
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
    case 'reference_list':
      return toolReferenceList(args, cwd);
    case 'reference_add':
      return toolReferenceAdd(args, cwd);
    case 'reference_view':
      return toolReferenceView(args, cwd);
    case 'reference_search':
      return toolReferenceSearch(args, cwd);
    case 'reference_remove':
      return toolReferenceRemove(args, cwd);
    case 'reference_update':
      return toolReferenceUpdate(args, cwd);
    case 'reference_link':
      return toolReferenceLink(args, cwd);
    case 'reference_sync':
      return toolReferenceSync(args, cwd);
    case 'lesson_list':
      return toolLessonList(args, cwd);
    case 'lesson_create':
      return toolLessonCreate(args, cwd);
    case 'lesson_view':
      return toolLessonView(args, cwd);
    case 'lesson_update':
      return toolLessonUpdate(args, cwd);
    case 'lesson_search_lessons':
      return toolLessonSearch(args, cwd);
    case 'lesson_link':
      return toolLessonLink(args, cwd);
    case 'lesson_supersede':
      return toolLessonSupersede(args, cwd);
    default:
      throw new Error(`Неизвестный инструмент: ${name}`);
  }
}

// ============================================================
// Существующие инструменты (с обновлениями)
// ============================================================

/**
 * Создаёт задачу.
 */
function toolCreateTask(args: ToolArgs, cwd: string): string {
  // VL-69: parentTaskId валидируется до записи — задача-сирота с битой
  // ссылкой ломает оркестрацию эпиков (list по parentTaskId вернёт пусто)
  const parentTaskId = (args.parentTaskId as string) || '';
  if (parentTaskId && !getTask(cwd, parentTaskId)) {
    throw new Error(`Родительская задача ${parentTaskId} не найдена.`);
  }

  const task = createTaskFile(cwd, {
    title: args.title as string,
    description: (args.description as string) || '',
    priority: (args.priority as string) || '',
    labels: (args.labels as string[]) || [],
    dependencies: (args.dependencies as string[]) || [],
    acceptanceCriteria: ((args.acceptanceCriteria as string[]) || []).map(text => ({ text, checked: false })),
    status: (args.status as string) || '',
    assignee: (args.assignee as string[]) || [],
    milestone: (args.milestone as string) || '',
    type: args.type ? normalizeTaskType(loadConfig(cwd), args.type as string) : '',
    parent_task_id: parentTaskId,
    due_date: (args.due_date as string) || '',
    ordinal: args.ordinal as number,
    project: (args.project as string) || '',
    finalSummary: (args.finalSummary as string) || '',
  });
  return `Задача ${task.id} создана: ${task.title}`;
}

/**
 * Выводит список задач с фильтрацией, сортировкой.
 */
function toolListTasks(args: ToolArgs, cwd: string): string {
  let tasks = listTasks(cwd);

  if (args.status) {
    const status = (args.status as string).toLowerCase();
    tasks = tasks.filter(t => t.status.toLowerCase() === status);
  }
  if (args.labels && (args.labels as string[]).length > 0) {
    const labels = (args.labels as string[]).map(l => l.toLowerCase());
    tasks = tasks.filter(t =>
      t.labels && labels.some(l =>
        t.labels.some(tl => tl.toLowerCase() === l)
      )
    );
  }
  if (args.milestone) {
    const ms = (args.milestone as string).toLowerCase();
    tasks = tasks.filter(t => t.milestone && t.milestone.toLowerCase() === ms);
  }
  if (args.type) {
    const type = (args.type as string).toLowerCase();
    tasks = tasks.filter(t => t.type && t.type.toLowerCase() === type);
  }
  // VL-69: фильтр по родителю — case-insensitive, как у type
  if (args.parentTaskId) {
    const parent = (args.parentTaskId as string).toLowerCase();
    tasks = tasks.filter(t => (t.parent_task_id || '').toLowerCase() === parent);
  }
  if (args.ready) {
    tasks = tasks.filter(t => isReady(cwd, t));
  }

  // Сортировка
  if (args.sort === 'priority') {
    const priorityOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    tasks.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  } else if (args.sort === 'created') {
    tasks.sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));
  } else if (args.sort === 'updated') {
    tasks.sort((a, b) => (b.updated_date || '').localeCompare(a.updated_date || ''));
  }

  if (args.limit) {
    tasks = tasks.slice(0, args.limit as number);
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
    parent_task_id: t.parent_task_id,
  }));

  return JSON.stringify(simplified, null, 2);
}

/**
 * Просматривает задачу по ID.
 */
function toolViewTask(args: ToolArgs, cwd: string): string {
  const task = getTask(cwd, args.id as string);
  if (!task) {
    throw new Error(`Задача ${args.id} не найдена.`);
  }

  // VL-162: урезанный режим с выбором полей. Имена полей — ключи интерфейса Task;
  // реестр не держим, Object.keys(task) всегда актуален (новые поля Task автоматически допустимы).
  const fields = args.fields as string[] | undefined;
  // Обратная совместимость: без fields или с пустым массивом — полное представление,
  // как и раньше (веб-оркестратор и фазовые промпты зовут без параметров — регрессия исключена)
  if (fields === undefined || (Array.isArray(fields) && fields.length === 0)) {
    return JSON.stringify(task, null, 2);
  }
  if (!Array.isArray(fields)) {
    throw new Error('Параметр fields должен быть массивом имён полей.');
  }
  // Валидация имён: неизвестное поле — ошибка с перечнем допустимых, а не тихий пропуск
  const valid = Object.keys(task);
  const unknown = fields.filter((f) => !valid.includes(f));
  if (unknown.length > 0) {
    throw new Error(`Неизвестные поля: ${unknown.join(', ')}. Допустимые: ${valid.join(', ')}.`);
  }
  // Порядок ключей в ответе = порядок в fields (удобно для компактного контекста)
  const picked: Record<string, unknown> = {};
  for (const f of fields) picked[f] = task[f as keyof Task];
  return JSON.stringify(picked, null, 2);
}

/**
 * Обновляет статус задачи.
 */
function toolUpdateStatus(args: ToolArgs, cwd: string): string {
  const task = updateTaskFile(cwd, args.id as string, { status: args.status as string });
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
 */
function toolUpdateTask(args: ToolArgs, cwd: string): string {
  // VL-183: валидация id на границе MCP-слоя. Схема требует id, но сервер её
  // не проверяет: без id getTask/findTaskFilePath падают с TypeError
  // «Cannot read properties of undefined (reading 'toLowerCase')» — модель
  // видит невнятную ошибку вместо подсказки (инцидент VL-182).
  const id = args.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('Не передан id задачи (параметр "id").');
  }

  const updates: Partial<Task> = {};

  // Frontmatter-поля
  if (args.title !== undefined) updates.title = args.title as string;
  if (args.description !== undefined) updates.description = args.description as string;
  if (args.priority !== undefined) updates.priority = args.priority as string;
  if (args.assignee !== undefined) updates.assignee = args.assignee as string[];
  if (args.labels !== undefined) updates.labels = args.labels as string[];
  if (args.milestone !== undefined) updates.milestone = args.milestone as string;
  if (args.status !== undefined) updates.status = args.status as string;
  // VL-183: null ≠ «сброс» — раньше args.type === null проходил проверку
  // !== undefined и тихо стирал type в ''. null приравнен к отсутствию
  // (поле не трогаем); явный сброс — только пустая строка ''.
  if (args.type !== undefined && args.type !== null) updates.type = normalizeTaskType(loadConfig(cwd), args.type as string);
  // VL-69: смена/сброс родителя; несуществующий parent — ошибка, поле не трогаем
  if (args.parentTaskId !== undefined) {
    const parent = args.parentTaskId as string;
    if (parent && !getTask(cwd, parent)) {
      throw new Error(`Родительская задача ${parent} не найдена.`);
    }
    updates.parent_task_id = parent;
  }

  // VL-97: прокидываем modified_files — поле есть в core (Task-input/сериализация),
  // но было недоступно ни в MCP, ни в CLI, поэтому всегда оставалось пустым
  if (args.modifiedFiles !== undefined) updates.modified_files = args.modifiedFiles as string[];

  // VL-152: поле references (связь с reference_*); двусторонняя связь — reference_link
  if (args.references !== undefined) updates.references = args.references as string[];

  // VL-153: поле lessons (связь с lesson_*); двусторонняя связь — lesson_link
  if (args.lessons !== undefined) updates.lessons = args.lessons as string[];

  // Секции тела
  if (args.plan !== undefined) updates.implementationPlan = args.plan as string;
  if (args.notes !== undefined) updates.implementationNotes = args.notes as string;
  if (args.final_summary !== undefined) updates.finalSummary = args.final_summary as string;

  // append_notes — дописывает в конец существующих заметок
  if (args.append_notes !== undefined) {
    const task = getTask(cwd, args.id as string);
    if (!task) throw new Error(`Задача ${args.id} не найдена.`);
    updates.implementationNotes = (task.implementationNotes || '') +
      (task.implementationNotes ? '\n' : '') + (args.append_notes as string);
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('Не указаны поля для обновления.');
  }

  const task = updateTaskFile(cwd, args.id as string, updates);
  return `Задача ${task.id} обновлена: ${Object.keys(updates).join(', ')}`;
}

/**
 * Управление Acceptance Criteria.
 */
function toolManageAc(args: ToolArgs, cwd: string): string {
  return manageChecklist(args, cwd, 'acceptanceCriteria');
}

/**
 * Управление Definition of Done.
 */
function toolManageDod(args: ToolArgs, cwd: string): string {
  return manageChecklist(args, cwd, 'definitionOfDone');
}

/**
 * Нормализация и валидация индексов чек-листа на границе MCP-инструмента.
 *
 * Инцидент VL-113: модель передавала индекс не того типа ('NaN', '', 2.5),
 * вызовы падали с невнятной ошибкой и фаза теряла ходы на повтор.
 * Поэтому ошибка самодостаточна: содержит исходный ввод (JSON), подсказку
 * формата и текущее количество пунктов — модель может исправиться с первого раза.
 *
 * parseInt('2.5') = 2 — «тихое» срезание дроби недопустимо, поэтому строка
 * принимается только строго по /^\d+$/ (после trim), а число — только целое.
 */
function parseChecklistIndexes(raw: unknown, listLength: number): number[] {
  const hint = (v: unknown): Error =>
    new Error(
      `Неверный индекс: ${JSON.stringify(v)}. Индекс — целое число, начиная с 1 ` +
        `(текущих пунктов чек-листа: ${listLength}). Пример: index: 2 или index: "3".`
    );

  // VL-135: строка «all» — модель хочет отметить все пункты за один вызов.
  // На пустом чек-листе отдельная подсказка (hint), а не «0 пунктов» — это тоже ошибка вызова.
  if (typeof raw === 'string' && raw.trim() === 'all') {
    if (listLength === 0) throw hint(raw);
    return Array.from({ length: listLength }, (_, i) => i + 1);
  }

  // VL-135: строка-массив "[1, 2, 3]" — модель шлёт JSON-строку вместо массива
  // (после VL-120 такой вызов падал «Неверный индекс» и тратил ход на повтор).
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      // SyntaxError наружу не выпускаем — иначе модель увидит невнятную ошибку JSON
      // вместо привычной подсказки формата (VL-120-стиль, с оригинальной строкой).
      throw hint(raw);
    }
    if (!Array.isArray(parsed)) throw hint(raw);
    // Каждый элемент проходит СУЩЕСТВУЮЩУЮ валидацию ниже (целое/строка-число, 1..length)
    raw = parsed;
  }

  const items = Array.isArray(raw) ? raw : [raw];
  const indexes: number[] = [];
  for (const v of items) {
    let n: number;
    if (typeof v === 'number' && Number.isInteger(v)) {
      n = v;
    } else if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
      n = parseInt(v, 10);
    } else {
      // NaN, пустая строка, дробь, 'abc', null, undefined — ошибка с подсказкой
      throw hint(v);
    }
    if (n < 1 || n > listLength) throw hint(v);
    indexes.push(n);
  }
  // VL-135: дедуп — иначе remove с [2, 2] сдвинет позиции дважды
  return [...new Set(indexes)];
}

/**
 * Общая логика управления чеклистами (AC / DoD).
 *
 * @param field — 'acceptanceCriteria' или 'definitionOfDone'
 */
function manageChecklist(args: ToolArgs, cwd: string, field: 'acceptanceCriteria' | 'definitionOfDone'): string {
  const task = getTask(cwd, args.id as string);
  if (!task) throw new Error(`Задача ${args.id} не найдена.`);

  // runtime-элементы всегда объекты (markdownToTask); строки допускает контракт Task
  const list = (task[field] || []) as ChecklistItem[];
  const action = args.action as string;

  switch (action) {
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
      // VL-183 (инцидент VL-182): модель/мост могут передать массив как
      // JSON-строку «["A","B"]» — как index в VL-120/VL-135. Без парсинга
      // строка целиком становилась ОДНИМ критерием-JSON. Парсим только валидный
      // JSON-массив непустых строк; битый JSON и тексты вида «[blocker] …»
      // уходят в scalar-ветку — обычные критерии не ломаются.
      let text: unknown = args.text;
      if (typeof text === 'string' && text.trim().startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(text.trim());
          if (Array.isArray(parsed) && parsed.length > 0 &&
              parsed.every(t => typeof t === 'string' && t.trim() !== '')) {
            text = parsed;
          }
        } catch {
          // Не JSON — оставляем строкой (scalar-критерий)
        }
      }
      // VL-135: batch-add — массив строк создаёт несколько пунктов за один вызов
      // (раньше сливалось в один критерий «B1,B2»; симметрия с батч-отметкой)
      if (Array.isArray(text)) {
        for (const t of text) {
          if (typeof t !== 'string' || t.trim() === '') {
            throw new Error('Для action=add text — строка или массив непустых строк.');
          }
        }
        for (const t of text) list.push({ text: t, checked: false });
        updateTaskFile(cwd, args.id as string, { [field]: list });
        return `Добавлено критериев: ${text.length} (${text.join(', ')})`;
      }
      list.push({ text: text as string, checked: false });
      updateTaskFile(cwd, args.id as string, { [field]: list });
      return `Добавлен критерий #${list.length}: ${text}`;
    }

    case 'check':
    case 'uncheck': {
      // Батч (VL-135): массив, строка-массив "[1, 2]" или «all» → новый формат ответа.
      // Scalar (2, "2") → старый формат без изменений (регрессия VL-120, server.test.mjs).
      const batch = Array.isArray(args.index) ||
        (typeof args.index === 'string' && !/^\d+$/.test(args.index.trim()));
      // index: одиночный номер или массив; нормализация — parseChecklistIndexes (VL-120/VL-135)
      const indexes = parseChecklistIndexes(args.index, list.length);
      const checked = action === 'check';
      for (const i of indexes) {
        list[i - 1].checked = checked;
      }
      updateTaskFile(cwd, args.id as string, { [field]: list });
      if (batch) {
        return checked
          ? `Отмечено пунктов: ${indexes.length} (${indexes.join(', ')})`
          : `Снято пунктов: ${indexes.length} (${indexes.join(', ')})`;
      }
      return checked
        ? `Отмечены критерии #${indexes.join(', #')}`
        : `Сняты отметки с критериев #${indexes.join(', #')}`;
    }

    case 'remove': {
      // Несколько индексов — удаляем по убыванию, чтобы не сдвигать позиции
      const batch = Array.isArray(args.index) ||
        (typeof args.index === 'string' && !/^\d+$/.test(args.index.trim()));
      const indexes = parseChecklistIndexes(args.index, list.length);
      for (const i of [...indexes].sort((a, b) => b - a)) {
        list.splice(i - 1, 1);
      }
      updateTaskFile(cwd, args.id as string, { [field]: list });
      if (batch) return `Удалено пунктов: ${indexes.length} (${indexes.join(', ')})`;
      return `Удалены критерии #${indexes.join(', #')}`;
    }

    default:
      throw new Error(`Неизвестное действие: ${args.action}. Используйте: add, check, uncheck, remove, list`);
  }
}

/**
 * Добавляет комментарий к задаче.
 */
function toolAddComment(args: ToolArgs, cwd: string): string {
  const task = getTask(cwd, args.id as string);
  if (!task) throw new Error(`Задача ${args.id} не найдена.`);

  const comment: TaskComment = {
    author: (args.author as string) || '@agent',
    created: formatNow(),
    text: args.comment as string,
  };

  const comments = [...(task.comments || []), comment];
  updateTaskFile(cwd, args.id as string, { comments });

  return `Комментарий добавлен к задаче ${args.id} (${comment.author})`;
}

/**
 * Завершение фазы одним вызовом (VL-138).
 *
 * Схлопывает «бумажную» цепочку фазы (add_comment → update_status →
 * update_task(modifiedFiles) → manage_ac/dod check) в один вызов —
 * экономия ~4–6 ходов на задачу в профиле code.
 *
 * Частичное применение (по AC 1): невалидное поле НЕ записывается, а идёт
 * ошибкой в сводку — остальные поля применяются. Все ошибки валидации
 * собираются ДО единственной записи, файл пишется ОДНИМ updateTaskFile,
 * поэтому «полуприменённого» состояния файла не бывает.
 */
function toolFinishPhase(args: ToolArgs, cwd: string): string {
  const id = args.id as string;
  // Отсутствие задачи — фатально (не частичная ошибка): продолжать некуда
  const task = getTask(cwd, id);
  if (!task) throw new Error(`Задача ${id} не найдена.`);

  const errors: string[] = [];
  const updates: Partial<Task> = {};
  // Фактически применённые действия — каждый элемент сводки отражает запись,
  // а не переданный параметр (неприменённое поле не «светится» в сводке)
  let statusPart = 'Статус: не менялся';
  let commentPart = 'отчёт: нет';
  let acCount = 0;
  let dodCount = 0;
  let filesPart = 'файлов: не менялись';
  let anyField = false;

  // Статус валидируется по конфигу: невалидный → ошибка в сводку, поле пропускается
  if (args.status !== undefined) {
    anyField = true;
    // loadConfig типизирует statuses как unknown (YAML-конфиг) — приводим к string[]
    const statuses = (loadConfig(cwd).statuses as string[]) || [];
    if (typeof args.status !== 'string' || !statuses.includes(args.status)) {
      errors.push(`Невалидный статус ${JSON.stringify(args.status)}. Допустимые: ${statuses.join(', ')}`);
    } else {
      updates.status = args.status;
      statusPart = `Статус: ${args.status}`;
    }
  }

  // modifiedFiles — полная замена modified_files (как в toolUpdateTask)
  if (args.modifiedFiles !== undefined) {
    anyField = true;
    if (!Array.isArray(args.modifiedFiles)) {
      errors.push('modifiedFiles — массив строк (например: ["src/a.ts"]).');
    } else {
      const files = args.modifiedFiles as string[];
      updates.modified_files = files;
      filesPart = `файлов: ${files.length}`;
    }
  }

  // Батч-отметка AC: индексы через parseChecklistIndexes (VL-120/VL-135-подсказки),
  // ошибка одного батча не мешает применить остальные поля
  if (args.acChecks !== undefined) {
    anyField = true;
    const list = (task.acceptanceCriteria || []) as ChecklistItem[];
    try {
      for (const i of parseChecklistIndexes(args.acChecks, list.length)) {
        if (!list[i - 1].checked) acCount++;
        list[i - 1].checked = true;
      }
      updates.acceptanceCriteria = list;
    } catch (e) {
      errors.push(`acChecks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Батч-отметка DoD — та же семантика, что и у AC
  if (args.dodChecks !== undefined) {
    anyField = true;
    const list = (task.definitionOfDone || []) as ChecklistItem[];
    try {
      for (const i of parseChecklistIndexes(args.dodChecks, list.length)) {
        if (!list[i - 1].checked) dodCount++;
        list[i - 1].checked = true;
      }
      updates.definitionOfDone = list;
    } catch (e) {
      errors.push(`dodChecks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Отчётный комментарий: author фиксирован @agent (поле author в схему не входит)
  if (args.comment !== undefined) {
    anyField = true;
    if (typeof args.comment !== 'string' || args.comment.trim() === '') {
      errors.push('comment — пустая строка.');
    } else {
      updates.comments = [...(task.comments || []), {
        author: '@agent',
        created: formatNow(),
        text: args.comment as string,
      }];
      commentPart = 'отчёт добавлен';
    }
  }

  // Единственная запись: все валидные обновления применяются одним вызовом
  if (Object.keys(updates).length > 0) {
    updateTaskFile(cwd, id, updates);
  }

  const summary = `${statusPart}; ${commentPart}; отмечено AC: ${acCount}, DoD: ${dodCount}; ${filesPart}` +
    (anyField ? '' : '; ничего не менялось') +
    (errors.length > 0 ? `; Ошибки: ${errors.join(' | ')}` : '');
  return summary;
}

/**
 * Обновляет зависимости задачи.
 */
function toolUpdateDependencies(args: ToolArgs, cwd: string): string {
  const task = getTask(cwd, args.id as string);
  if (!task) throw new Error(`Задача ${args.id} не найдена.`);

  let deps = [...(task.dependencies || [])];

  // Добавляем новые зависимости
  if (args.add && (args.add as string[]).length > 0) {
    for (const dep of args.add as string[]) {
      if (!deps.includes(dep)) deps.push(dep);
    }
  }

  // Удаляем зависимости
  if (args.remove && (args.remove as string[]).length > 0) {
    const remove = args.remove as string[];
    deps = deps.filter(d => !remove.includes(d));
  }

  // Проверяем циклы
  const probe = { ...task, dependencies: deps };
  const validation = validateDeps(cwd, probe, [...listTasks(cwd).filter(t => t.id !== task.id), probe]);
  if (!validation.valid) {
    throw new Error(`Обнаружен цикл зависимостей: ${validation.cycle.join(' → ')}`);
  }

  updateTaskFile(cwd, args.id as string, { dependencies: deps });
  return `Зависимости задачи ${args.id} обновлены: [${deps.join(', ')}]`;
}

// ============================================================
// Поиск и готовность
// ============================================================

/**
 * Ищет задачи по запросу.
 */
function toolSearch(args: ToolArgs, cwd: string): string {
  const tasks = searchTasks(cwd, {
    query: args.query as string,
    status: args.status as string,
    type: args.type as string,
    project: args.project as string,
    priority: args.priority as string,
    modifiedFiles: args.modifiedFiles as string[],
    hasLessons: args.hasLessons as boolean | undefined,
    limit: args.limit as number,
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
 */
function toolReady(args: ToolArgs, cwd: string): string {
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
 * @returns "YYYY-MM-DD HH:MM"
 */
function formatNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ============================================================
// Milestones (v1.3)
// ============================================================

function toolMilestoneList(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  let milestones = listMilestones(backlogDir, { includeArchived: !!args.include_archived });
  if (!args.include_archived) {
    milestones = milestones.filter(m => m.status !== 'archived');
  }
  return JSON.stringify(milestones, null, 2);
}

function toolMilestoneAdd(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const milestone = writeMilestone(backlogDir, {
    name: args.name as string,
    description: (args.description as string) || '',
    due_date: (args.due_date as string) || '',
  });
  return `Веха "${milestone.name}" создана.`;
}

function toolMilestoneRename(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const from = args.from as string;
  const to = args.to as string;
  const updated = renameMilestone(backlogDir, from, to);
  if (!updated) throw new Error(`Веха "${args.from}" не найдена.`);

  let updatedCount = 0;
  if (args.update_tasks !== false) {
    const tasks = listTasks(cwd);
    for (const task of tasks) {
      if (task.milestone && task.milestone.toLowerCase() === from.toLowerCase()) {
        updateTaskFile(cwd, task.id, { milestone: to });
        updatedCount++;
      }
    }
  }
  return `Веха переименована: ${args.from} → ${args.to}. Задач обновлено: ${updatedCount}`;
}

function toolMilestoneRemove(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const name = args.name as string;
  const deleted = deleteMilestone(backlogDir, name);
  if (!deleted) throw new Error(`Веха "${args.name}" не найдена.`);

  const handling = (args.task_handling as string) || 'clear';
  let updatedCount = 0;
  const tasks = listTasks(cwd);
  for (const task of tasks) {
    if (task.milestone && task.milestone.toLowerCase() === name.toLowerCase()) {
      if (handling === 'clear') {
        updateTaskFile(cwd, task.id, { milestone: '' });
        updatedCount++;
      } else if (handling === 'reassign' && args.reassign_to) {
        updateTaskFile(cwd, task.id, { milestone: args.reassign_to as string });
        updatedCount++;
      }
    }
  }
  return `Веха "${args.name}" удалена. Задач обработано: ${updatedCount} (${handling})`;
}

function toolMilestoneArchive(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const archived = archiveMilestone(backlogDir, args.name as string);
  if (!archived) throw new Error(`Веха "${args.name}" не найдена.`);
  return `Веха "${args.name}" архивирована.`;
}

// ============================================================
// Documents (v1.4)
// ============================================================

function toolDocumentList(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  let entries = listDocuments(backlogDir);
  if (args.query) {
    const q = (args.query as string).toLowerCase();
    entries = entries.filter(e =>
      e.document.id.toLowerCase().includes(q) ||
      e.document.title.toLowerCase().includes(q) ||
      e.document.tags.some(t => String(t).toLowerCase().includes(q)) ||
      (e.body && e.body.toLowerCase().includes(q))
    );
  }
  return JSON.stringify(entries.map(e => e.document), null, 2);
}

function toolDocumentView(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const entry = getDocument(backlogDir, args.id as string);
  if (!entry) throw new Error(`Документ ${args.id} не найден.`);
  return JSON.stringify({ ...entry.document, content: entry.body }, null, 2);
}

function toolDocumentCreate(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const doc = writeDocument(backlogDir, {
    title: args.title as string,
    type: (args.type as string) || '',
    tags: (args.tags as string[]) || [],
    content: (args.content as string) || '',
  });
  return `Документ ${doc.id} создан: ${doc.title} (тип: ${doc.type})`;
}

function toolDocumentUpdate(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const updates: UpdateDocumentInput = {};
  if (args.title !== undefined) updates.title = args.title as string;
  if (args.content !== undefined) updates.content = args.content as string;
  if (args.type !== undefined) updates.type = args.type as string;
  if (args.tags !== undefined) updates.tags = args.tags as string[];
  if (Object.keys(updates).length === 0) {
    throw new Error('Не указаны поля для обновления (title, content, type, tags).');
  }
  const updated = updateDocument(backlogDir, args.id as string, updates);
  if (!updated) throw new Error(`Документ ${args.id} не найден.`);
  return `Документ ${updated.document.id} обновлён: ${updated.document.title}`;
}

function toolDocumentSearch(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const entries = searchDocuments(backlogDir, args.query as string);
  return JSON.stringify(entries.map(e => e.document), null, 2);
}

// ============================================================
// References — метаданные о внешних источниках (VL-152)
// ============================================================

function toolReferenceList(args: ToolArgs, cwd: string): string {
  let entries = listReferences(cwd);
  if (args.type !== undefined) {
    const t = String(args.type).toLowerCase();
    entries = entries.filter(e => e.reference.type === t);
  }
  if (Array.isArray(args.tags) && (args.tags as string[]).length > 0) {
    const tags = (args.tags as string[]).map(t => String(t).toLowerCase());
    entries = entries.filter(e =>
      tags.every(t => e.reference.tags.some(rt => String(rt).toLowerCase() === t))
    );
  }
  return JSON.stringify(entries.map(e => e.reference), null, 2);
}

function toolReferenceAdd(args: ToolArgs, cwd: string): string {
  const ref = writeReference(cwd, {
    title: args.title as string,
    type: args.type as string,
    url: args.url as string | undefined,
    path: args.path as string | undefined,
    tags: args.tags as string[] | undefined,
    content: args.description as string | undefined,
  });
  // Клонирование: clone default=true для type=repo; false — только метаданные
  let cloneMessage = '';
  if (ref.type === 'repo' && ref.url && args.clone !== false) {
    const res = cloneReferenceRepo(cwd, ref);
    cloneMessage = '\n' + res.message;
  }
  return `Reference ${ref.id} создан: ${ref.title} (${ref.type})${cloneMessage}`;
}

function toolReferenceView(args: ToolArgs, cwd: string): string {
  const entry = getReference(cwd, args.id as string);
  if (!entry) throw new Error(`Reference ${args.id} не найден.`);
  return JSON.stringify({
    ...entry.reference,
    body: entry.body,
    path: entry.path,
  }, null, 2);
}

function toolReferenceSearch(args: ToolArgs, cwd: string): string {
  const entries = searchReferences(cwd, args.query as string);
  return JSON.stringify(entries.map(e => e.reference), null, 2);
}

function toolReferenceRemove(args: ToolArgs, cwd: string): string {
  const ok = removeReference(cwd, args.id as string);
  if (!ok) throw new Error(`Reference ${args.id} не найден (или файл не удалось удалить).`);
  return `Reference ${args.id} удалён (клон в data/ сохранён).`;
}

// VL-164: обновление меты reference; MCP-параметр description → UpdateReferenceInput.content
function toolReferenceUpdate(args: ToolArgs, cwd: string): string {
  const updates: UpdateReferenceInput = {};
  if (args.tags !== undefined) updates.tags = args.tags as string[];
  if (args.description !== undefined) updates.content = args.description as string;
  if (Object.keys(updates).length === 0) {
    throw new Error('Не указаны поля для обновления (tags, description).');
  }
  const entry = updateReference(cwd, args.id as string, updates);
  if (!entry) throw new Error(`Reference ${args.id} не найден.`);
  return `Reference ${entry.reference.id} обновлён: ${Object.keys(updates).join(', ')}`;
}

function toolReferenceLink(args: ToolArgs, cwd: string): string {
  const action = (args.action as 'add' | 'remove') || 'add';
  linkReferenceTask(cwd, args.referenceId as string, args.taskId as string, action);
  return action === 'add'
    ? `Reference ${args.referenceId} связан с задачей ${args.taskId} (linked_tasks ↔ task.references).`
    : `Связь Reference ${args.referenceId} ↔ задача ${args.taskId} удалена.`;
}

function toolReferenceSync(_args: ToolArgs, cwd: string): string {
  const result = syncReferenceRepos(cwd);
  return JSON.stringify(result, null, 2);
}

// ============================================================
// Lessons learned — уроки из задач (VL-153)
// ============================================================

function toolLessonList(args: ToolArgs, cwd: string): string {
  let entries = listLessons(cwd);
  const status = args.status as string | undefined;
  if (status) {
    entries = entries.filter(e => e.lesson.status === String(status).toLowerCase());
  }
  const tags = (args.tags as string[] | undefined) || [];
  if (tags.length > 0) {
    const needles = tags.map(t => String(t).toLowerCase());
    entries = entries.filter(e =>
      needles.every(n => e.lesson.tags.some(lt => String(lt).toLowerCase() === n))
    );
  }
  return JSON.stringify(entries.map(e => e.lesson), null, 2);
}

function toolLessonCreate(args: ToolArgs, cwd: string): string {
  const lesson = createLessonFile(cwd, {
    title: args.title as string,
    tags: (args.tags as string[] | undefined) || [],
    source_tasks: (args.sourceTasks as string[] | undefined) || [],
    content: args.content as string | undefined,
  });
  return `Lesson ${lesson.id} создан: ${lesson.title} (${lesson.status})`;
}

function toolLessonView(args: ToolArgs, cwd: string): string {
  const entry = getLesson(cwd, args.id as string);
  if (!entry) throw new Error(`Lesson ${args.id} не найден.`);
  return JSON.stringify({
    ...entry.lesson,
    body: entry.body,
    path: entry.path,
  }, null, 2);
}

function toolLessonUpdate(args: ToolArgs, cwd: string): string {
  const updates: UpdateLessonInput = {};
  if (args.title !== undefined) updates.title = args.title as string;
  if (args.status !== undefined) updates.status = args.status as string;
  if (args.tags !== undefined) updates.tags = args.tags as string[];
  if (args.sourceTasks !== undefined) updates.source_tasks = args.sourceTasks as string[];
  if (args.linkedTasks !== undefined) updates.linked_tasks = args.linkedTasks as string[];
  if (args.supersedes !== undefined) updates.supersedes = args.supersedes as string;
  if (args.content !== undefined) updates.content = args.content as string;
  if (Object.keys(updates).length === 0) {
    throw new Error('Не указаны поля для обновления.');
  }
  const entry = updateLesson(cwd, args.id as string, updates);
  if (!entry) throw new Error(`Lesson ${args.id} не найден.`);
  return `Lesson ${entry.lesson.id} обновлён: ${Object.keys(updates).join(', ')} (updated_date: ${entry.lesson.updated_date})`;
}

function toolLessonSearch(args: ToolArgs, cwd: string): string {
  const entries = searchLessons(cwd, args.query as string);
  return JSON.stringify(entries.map(e => e.lesson), null, 2);
}

function toolLessonLink(args: ToolArgs, cwd: string): string {
  const action = (args.action as 'add' | 'remove') || 'add';
  linkLesson(cwd, args.lessonId as string, args.taskId as string, action);
  return action === 'add'
    ? `Lesson ${args.lessonId} связан с задачей ${args.taskId} (linked_tasks ↔ task.lessons).`
    : `Связь Lesson ${args.lessonId} ↔ задача ${args.taskId} удалена.`;
}

function toolLessonSupersede(args: ToolArgs, cwd: string): string {
  supersedeLesson(cwd, args.oldId as string, args.newId as string);
  return `Lesson ${args.newId} заменяет ${args.oldId} (${args.oldId} → superseded, ${args.newId} → active).`;
}
