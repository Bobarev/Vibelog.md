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
import { searchTasksRanked } from '../core/search.js';
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
  cacheReference, refreshReferenceCache, readReferenceCache, syncReferenceCaches,
} from '../core/reference-cache.js';
import {
  listLessons, getLesson, createLessonFile,
  updateLesson, searchLessons, linkLesson, supersedeLesson,
} from '../core/lesson.js';
import type { UpdateLessonInput } from '../core/lesson.js';
import { findBacklogDir } from '../core/paths.js';
import { buildProjectMap } from '../core/project-map.js';
import { truncateToolOutput } from '../agent/tools.js';
import { ackOk, unknownFields } from './tool-result.js';
import type { SkippedField } from './tool-result.js';
import { withIdempotency } from './idempotency.js';
import type { Task, TaskComment, ChecklistItem } from '../core/task.js';
import { addTaskTokenUsage } from '../core/store.js';
import { hasUsageDelta, usageDelta } from '../core/analytics.js';
import type { TokenUsage } from '../core/analytics.js';
import {
  agentSessionsDir, loadSessionMetaSync, sumUsageFromJsonlSync, updateSessionMeta,
} from '../agent/session.js';

// completeTaskFile импортирован для паритета с оригинальным модулем;
// в текущей логике инструментов не вызывается (оставлено без изменений).
void completeTaskFile;

/**
 * Известные поля `backlog_create_task` (VL-262).
 *
 * Список — контракт «что инструмент реально понимает». Переданный ключ вне
 * списка больше не игнорируется молча: он попадает в `skipped` ответа, и
 * агент видит, что поле НЕ записано (источник «частичности» без отказа).
 */
const CREATE_TASK_FIELDS: readonly string[] = [
  'title', 'description', 'priority', 'labels', 'dependencies', 'acceptanceCriteria',
  'status', 'type', 'parentTaskId', 'due_date', 'ordinal', 'project', 'finalSummary',
  'assignee', 'milestone', 'id', 'definitionOfDone', 'noDodDefaults', 'idempotencyKey',
];

/**
 * Известные поля `backlog_update_task` (VL-262) — см. CREATE_TASK_FIELDS.
 * `plan`/`notes`/`append_notes`/`final_summary` — имена аргументов секций тела.
 */
const UPDATE_TASK_FIELDS: readonly string[] = [
  'id', 'title', 'description', 'priority', 'assignee', 'labels', 'milestone', 'type',
  'parentTaskId', 'status', 'plan', 'notes', 'append_notes', 'final_summary',
  'modifiedFiles', 'references', 'lessons', 'acceptanceCriteria', 'idempotencyKey',
];

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
          status: { type: 'string', description: 'Статус (по умолчанию Spec в веб-чате, иначе из конфига)' },
          type: { type: 'string', description: 'Тип задачи (bug, feature, ...)' },
          parentTaskId: { type: 'string', description: 'ID родительской задачи' },
          due_date: { type: 'string', description: 'Срок (YYYY-MM-DD)' },
          ordinal: { type: 'number', description: 'Порядковый номер для кастомной сортировки' },
          project: { type: 'string', description: 'Проект' },
          finalSummary: { type: 'string', maxLength: 20000, description: 'Итоговое резюме (для завершённых задач)' },
          // VL-262: защита от дубля при повторе после отказа/таймаута
          idempotencyKey: { type: 'string', description: 'Ключ идемпотентности: повтор с тем же ключом НЕ применяет изменения второй раз, а возвращает результат первого применения. Используй при повторе после отказа/таймаута.' },
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
            description: 'Имена полей Task для возврата (ключи интерфейса Task, напр. ["id","title","modified_files"]); camelCase-алиасы принимаются и приводятся к ключу Task (modifiedFiles → modified_files); без параметра или при пустом массиве — полное представление',
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
          // VL-262: idempotencyKey — повтор не перезапишет updated_date
          idempotencyKey: { type: 'string', description: 'Ключ идемпотентности: повтор с тем же ключом НЕ применяет изменения второй раз, а возвращает результат первого применения. Используй при повторе после отказа/таймаута.' },
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
          // VL-219: AC через update_task — полная замена чеклиста (симметрия с create)
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Критерии приёмки (полная замена, unchecked); JSON-строка массива тоже принимается' },
          // VL-262: атомарность + идемпотентность повтора
          idempotencyKey: { type: 'string', description: 'Ключ идемпотентности: повтор с тем же ключом НЕ применяет изменения второй раз, а возвращает результат первого применения. Используй при повторе после отказа/таймаута.' },
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
          // VL-262: повтор не должен дублировать комментарий
          idempotencyKey: { type: 'string', description: 'Ключ идемпотентности: повтор с тем же ключом НЕ применяет изменения второй раз, а возвращает результат первого применения. Используй при повторе после отказа/таймаута.' },
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
          idempotencyKey: { type: 'string', description: 'Ключ идемпотентности: повтор с тем же ключом НЕ применяет изменения второй раз, а возвращает результат первого применения. Используй при повторе после отказа/таймаута.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'backlog_search',
      description: 'Поиск задач с фильтрами (query, status, type, project, priority, modifiedFiles, limit). Запрос трактуется как набор токенов (разделители — пробелы/пунктуация), нужны ВСЕ токены (И-логика); учитывается усечение основы слова. Выдача — по релевантности: id > title > labels > description. Возвращает {found, returned, tasks}: found — сколько всего совпало, tasks усечены по limit.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 200, description: 'Поисковый запрос: токены через пробел, требуются все (И); поля id/title/labels/description с ранжированием' },
          status: { type: 'string', description: 'Фильтр по статусу' },
          type: { type: 'string', description: 'Фильтр по типу (bug, feature, ...)' },
          project: { type: 'string', description: 'Фильтр по проекту' },
          priority: { type: 'string', description: 'Фильтр по приоритету' },
          modifiedFiles: { type: 'array', items: { type: 'string' }, description: 'Фильтр по подстроке в modified_files задачи' },
          hasLessons: { type: 'boolean', description: 'Фильтр по наличию lessons у задачи (true — есть, false — нет)' },
          limit: { type: 'number', minimum: 1, maximum: 100, description: 'Максимум результатов; полное число совпадений — в found' },
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
      description: 'Завершение фазы одним вызовом: статус + отчётный комментарий + modifiedFiles + батч-отметки AC/DoD. `comment` объявлен в required — заполняй его отчётом о фазе. Если comment всё же не передан (VL-253), сервер собирает отчёт автоматически из статуса, отметок AC/DoD, modified_files и фрагмента плана и завершает фазу без ошибки. Повторный вызов со статусом, равным текущему (already_finished), возвращает ошибку с датой и источником существующего отчёта: не повторяй такой вызов, а заверши фазу финальным текстом. Невалидные значения полей (статус вне конфига, битый индекс AC/DoD) пропускаются с сообщением в сводке — частичное применение. Пример сводки: «Статус: Review; отчёт добавлен; отмечено AC: 2, DoD: 1; файлов: 3».',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          status: { type: 'string', description: 'Новый статус (валидируется по конфигу; невалидный — пропускается с ошибкой в сводке)' },
          comment: { type: 'string', description: 'Отчётный комментарий (author фиксирован @agent). Обязательное поле схемы; если всё равно не передан — сервер собирает отчёт автоматически (VL-253).' },
          modifiedFiles: { type: 'array', items: { type: 'string' }, description: 'Изменённые файлы (полная замена modified_files)' },
          acChecks: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] }, description: 'Индексы AC для отметки (с 1; батч-отметка, как в manage_ac)' },
          dodChecks: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] }, description: 'Индексы DoD для отметки (с 1; батч-отметка, как в manage_dod)' },
          tokenUsage: {
            type: 'object',
            description: 'Явный usage токенов сессии для frontmatter (VL-198). Без него MCP резолвит сам: мета текущей сессии (VIBELOG_SESSION_ID) → её jsonl. Объект со всеми нулями трактуется как отсутствующий параметр (тот же резолв). Резолв не удался — блок пропускается с ошибкой в сводку.',
            properties: {
              input: { type: 'number', description: 'Входные токены' },
              output: { type: 'number', description: 'Выходные токены' },
              cache: { type: 'number', description: 'Кэшированные входные токены' },
              total: { type: 'number', description: 'Все токены' },
              requests: { type: 'number', description: 'Число запросов к LLM' },
            },
            additionalProperties: false,
          },
          phase: { type: 'string', description: 'Фаза для by_phase (редкий override; по умолчанию env VIBELOG_PHASE_NAME → мета сессии)' },
        },
        // VL-253: comment в required — tool-calling генерирует только объявленные
        // обязательные поля; требование в description не влияет на аргументы.
        required: ['id', 'comment'],
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
          cache: { type: 'boolean', description: 'Скачать url и сохранить markdown-кэш сейчас (для url/doc/spec)' },
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
      description: 'Синхронизация references: без аргументов — доклонировать отсутствующие репозитории (type=repo) в backlog/references/data/; с id — перекачать markdown-кэш одного reference (сверка source_hash); all=true — клоны + кэши всех url/doc/spec в backlog/references/cache/.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID reference (ref-N) — перекачать его кэш' },
          all: { type: 'boolean', description: 'Обновить кэши всех url/doc/spec references (плюс клоны)' },
        },
      },
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
    {
      name: 'project_map',
      description:
        'Карта проекта: модули каталога src/ — путь + назначение (первая строка шапки модуля) + экспорты. ' +
        'Read-only, читает файлы на момент вызова. Начинай ориентацию в проекте с этого инструмента — ' +
        'вместо серии read_file. Для вопроса «где реализован X» вызывай с query: узкая выборка с полными ' +
        'описаниями и всеми экспортами. Аргументы: query?, exports?, dir?, limit?.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Подстрока по пути/описанию/экспортам; включает полные описания и все экспорты (напр. "htmlToMarkdown")',
          },
          exports: { type: 'boolean', description: 'Показывать экспорты (по умолчанию да, в бюджете)' },
          dir: { type: 'string', description: 'Каталог карты относительно корня проекта (по умолчанию "src"; "" — весь проект)' },
          limit: { type: 'number', description: 'Максимум модулей (по умолчанию 150)' },
        },
        required: [],
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
/** Опции вызова MCP-инструмента (VL-219): defaultStatus — дефолтный статус create из веб-чата (Spec). */
export interface HandleToolCallOpts {
  defaultStatus?: string;
}

export async function handleToolCall(
  name: string,
  args: ToolArgs,
  cwd: string,
  opts?: HandleToolCallOpts,
): Promise<string> {
  switch (name) {
    // VL-262: write-инструменты задачи — идемпотентность по ключу вызывающего.
    // Без idempotencyKey поведение прежнее (обёртка прозрачна).
    case 'backlog_create_task':
      return withIdempotency(cwd, name, args.idempotencyKey, () => toolCreateTask(args, cwd, opts));
    case 'backlog_list_tasks':
      return toolListTasks(args, cwd);
    case 'backlog_view_task':
      return toolViewTask(args, cwd);
    case 'backlog_update_status':
      return withIdempotency(cwd, name, args.idempotencyKey, () => toolUpdateStatus(args, cwd));
    case 'backlog_update_task':
      return withIdempotency(cwd, name, args.idempotencyKey, () => toolUpdateTask(args, cwd));
    case 'backlog_manage_ac':
      return toolManageAc(args, cwd);
    case 'backlog_manage_dod':
      return toolManageDod(args, cwd);
    case 'backlog_add_comment':
      return withIdempotency(cwd, name, args.idempotencyKey, () => toolAddComment(args, cwd));
    case 'backlog_finish_phase':
      return toolFinishPhase(args, cwd);
    case 'backlog_update_dependencies':
      return withIdempotency(cwd, name, args.idempotencyKey, () => toolUpdateDependencies(args, cwd));
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
    case 'project_map':
      return toolProjectMap(args, cwd);
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
function toolCreateTask(args: ToolArgs, cwd: string, opts?: HandleToolCallOpts): string {
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
    // VL-219: acceptanceCriteria — parseAcList с фолбэком [] (undefined → пустой чеклист)
    acceptanceCriteria: args.acceptanceCriteria !== undefined
      ? parseAcList(args.acceptanceCriteria).map(text => ({ text, checked: false }))
      : [],
    // VL-219: веб-чат создаёт задачи на фазе Spec — дефолт из opts
    // (defaultStatus: 'Spec'); без opts — как раньше, фолбэк конфига в createTask
    status: (args.status as string) || opts?.defaultStatus || '',
    assignee: (args.assignee as string[]) || [],
    milestone: (args.milestone as string) || '',
    type: args.type ? normalizeTaskType(loadConfig(cwd), args.type as string) : '',
    parent_task_id: parentTaskId,
    due_date: (args.due_date as string) || '',
    ordinal: args.ordinal as number,
    project: (args.project as string) || '',
    finalSummary: (args.finalSummary as string) || '',
  });
  // VL-262: снимок фактически применённого — по задаче ПОСЛЕ записи, а не по
  // переданным аргументам. skipped — переданные ключи вне известного набора
  // (раньше молча игнорировались: агент считал поле записанным).
  const applied: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    labels: task.labels ?? [],
    assignee: task.assignee ?? [],
    type: task.type || '',
    parent_task_id: task.parent_task_id || '',
    milestone: task.milestone || '',
    due_date: task.due_date || '',
    project: task.project || '',
    ordinal: task.ordinal ?? null,
    acceptanceCriteria: (task.acceptanceCriteria ?? []).length,
    description: task.description ?? '',
  };
  const skipped = unknownFields(args, CREATE_TASK_FIELDS);
  return ackOk(`Задача ${task.id} создана: ${task.title}`, applied, skipped);
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
 * Приводит camelCase-имя к snake_case: `modifiedFiles` → `modified_files`.
 *
 * VL-236: интерфейс Task (`src/core/task.ts`) — это TypeScript-код, где поля тела
 * названы в camelCase (`acceptanceCriteria`, `implementationPlan`), а его ключи
 * (в т.ч. frontmatter) — в snake_case (`modified_files`, `parent_task_id`).
 * Модели и большинство API мыслят в camelCase, поэтому имя поля вида
 * `modifiedFiles` — предсказуемая конвенция, а не ошибка. Нормализация снимает
 * класс отказов «поле названо в camelCase → ошибка валидации».
 */
function camelToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Резолвит имя поля, переданное клиентом, в канонический ключ Task.
 *
 * Порядок проверок важен: точное совпадение приоритетно (поведение VL-162
 * не меняется), иначе — приведение к snake_case. Возвращает undefined, если
 * имя не соответствует ни одному ключу: вызывающая сторона решает, как
 * сообщить об ошибке (текст перечня допустимых полей сохраняем).
 *
 * В Task нет пар полей, различающихся только регистром/подчёркиваниями
 * (проверено по списку ключей интерфейса), поэтому «схлопывание» двух разных
 * полей в одно исключено.
 */
function resolveFieldName(field: string, valid: string[]): string | undefined {
  if (valid.includes(field)) return field;
  const snake = camelToSnake(field);
  if (valid.includes(snake)) return snake;
  // Обратное направление: клиент прислал snake_case для ключа-«camelCase»
  // (acceptance_criteria → acceptanceCriteria). В Task таких пар-двойников
  // (отличающихся только регистром/подчёркиваниями) нет, поэтому поиск по
  // нормализованной форме однозначен: find вернёт единственный ключ.
  return valid.find((key) => camelToSnake(key) === snake);
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
  // VL-236: элементы fields обязаны быть строками — иначе camelToSnake упадёт
  // с TypeError вместо понятной ошибки (lesson-34: валидация на границе слоя)
  if (fields.some((f) => typeof f !== 'string')) {
    throw new Error('Параметр fields должен быть массивом имён полей.');
  }
  // Нормализация имён перед валидацией: точное совпадение → snake_case-алиас.
  // unknown собираем для сохранения прежнего текста ошибки с перечнем допустимых.
  const valid = Object.keys(task);
  const resolved: string[] = [];
  const unknown: string[] = [];
  for (const f of fields as string[]) {
    const name = resolveFieldName(f, valid);
    if (name === undefined) {
      unknown.push(f);
      continue;
    }
    // Дедуп: один канонический ключ, пришедший дважды (alias + canonical),
    // не должен попасть в ответ дважды; порядок — по первому вхождению
    if (!resolved.includes(name)) resolved.push(name);
  }
  if (unknown.length > 0) {
    throw new Error(`Неизвестные поля: ${unknown.join(', ')}. Допустимые: ${valid.join(', ')}.`);
  }
  // Порядок ключей в ответе = порядок в fields (удобно для компактного контекста)
  const picked: Record<string, unknown> = {};
  for (const f of resolved) picked[f] = task[f as keyof Task];
  return JSON.stringify(picked, null, 2);
}

/**
 * Обновляет статус задачи.
 */
function toolUpdateStatus(args: ToolArgs, cwd: string): string {
  const task = updateTaskFile(cwd, args.id as string, { status: args.status as string });
  return ackOk(`Статус задачи ${task.id} обновлён: ${task.status}`, { status: task.status });
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

  // VL-219: acceptanceCriteria через update_task — полная замена чеклиста
  // unchecked (симметрия с create); JSON-строка массива разбирается (lesson-35)
  if (args.acceptanceCriteria !== undefined) {
    updates.acceptanceCriteria = parseAcList(args.acceptanceCriteria).map(text => ({ text, checked: false }));
  }

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
    // VL-262: пустой набор — либо ошибка (поля не переданы), либо все
    // переданные ключи неизвестны. Разные подсказки: агенту нужно знать,
    // что его ключи не распознаны (иначе он повторяет тот же вызов).
    const skipped = unknownFields(args, UPDATE_TASK_FIELDS);
    if (skipped.length > 0) {
      throw new Error(
        `Не указаны поля для обновления. Неизвестные поля: ${skipped.map(s => s.field).join(', ')}. ` +
          `Допустимые: ${UPDATE_TASK_FIELDS.join(', ')}.`,
      );
    }
    throw new Error('Не указаны поля для обновления.');
  }

  // VL-262: единственная запись — все валидации выше (parentTaskId, parseAcList)
  // прошли до неё, поэтому «полуприменённого» состояния файла не бывает.
  const task = updateTaskFile(cwd, args.id as string, updates);

  // applied — значения из задачи ПОСЛЕ записи (фактическое состояние файла,
  // а не намерение вызова). Чеклист сворачиваем до длины: полный массив
  // раздувает ответ без пользы для агента.
  const applied: Record<string, unknown> = {};
  for (const key of Object.keys(updates)) {
    const value = (task as unknown as Record<string, unknown>)[key];
    applied[key] = Array.isArray(value) && key === 'acceptanceCriteria' ? value.length : value;
  }
  // skipped: неизвестные ключи + переданный null (раньше type: null молча игнорировался)
  const skipped: SkippedField[] = unknownFields(args, UPDATE_TASK_FIELDS);
  for (const key of Object.keys(args)) {
    if (args[key] === null && UPDATE_TASK_FIELDS.includes(key) && !skipped.some(s => s.field === key)) {
      skipped.push({ field: key, reason: 'значение null не применяется: поле не изменено' });
    }
  }

  return ackOk(`Задача ${task.id} обновлена: ${Object.keys(updates).join(', ')}`, applied, skipped);
}

/**
 * Нормализует значение массива строк на границе MCP: массив → как есть,
 * JSON-строка массива (`'["A", "B"]'`) → разбирается, битый JSON/скаляр →
 * ошибка с подсказкой (lesson-35: модель часто шлёт строку вместо массива).
 */
function parseAcList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(v => String(v));
    } catch {
      // не JSON — ошибка ниже
    }
  }
  throw new Error('acceptanceCriteria: ожидается массив строк или JSON-строка массива');
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

  // VL-262: снимок применённого — что именно записалось, без повторного чтения
  return ackOk(
    `Комментарий добавлен к задаче ${args.id} (${comment.author})`,
    { comment: { author: comment.author, created: comment.created, id: args.id } },
  );
}

/**
 * Авто-отчёт фазы (VL-253): собирается сервером, когда модель не передала
 * `comment`. Причина: `description` схемы не влияет на генерацию аргументов
 * tool-calling — если поля нет в `required`, модель может его не прислать
 * никогда (инцидент VL-250/VL-252: 10+ вызовов без comment → луп).
 * Фаза не должна падать из-за дисциплины модели в необязательном по факту поле.
 *
 * @param task — задача до применения правок (источник плана/резюме/файлов)
 * @param ctx — уже вычисленные части сводки (статус, счётчики, файлы)
 */
function buildAutoReport(
  task: Task,
  ctx: { status: string; acChecked: number; acTotal: number; dodChecked: number; dodTotal: number; files: string[] },
): string {
  const oneLine = (s: string, limit: number): string => {
    const flat = String(s).replace(/\s+/g, ' ').trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
  };
  const planFragment = task.implementationPlan
    ? `Фрагмент плана: ${oneLine(task.implementationPlan, 300)}`
    : task.finalSummary
      ? `Фрагмент резюме: ${oneLine(task.finalSummary, 300)}`
      : 'Фрагмент плана/резюме: план и резюме отсутствуют.';
  const files = ctx.files.length > 0
    ? `Файлы (${ctx.files.length}): ${ctx.files.slice(0, 10).join(', ')}${ctx.files.length > 10 ? ', …' : ''}`
    : 'Файлы: не менялись';
  return [
    'Фаза: авто-отчёт (comment не передан моделью)',
    `Статус: ${ctx.status}`,
    `AC отмечено: ${ctx.acChecked} из ${ctx.acTotal}`,
    `DoD отмечено: ${ctx.dodChecked} из ${ctx.dodTotal}`,
    files,
    planFragment,
    'Отчёт собран сервером автоматически (VL-253): модель не передала comment.',
  ].join('\n');
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

  // ── Жёсткая валидация (VL-251) ────────────────────────────────────────
  // Отличие от мягкого частичного применения: no-op статус — не «мелкая
  // ошибка поля», а признак бесполезного вызова: раньше он отвечал
  // нейтрально-успешно, и модель повторяла его байт-в-байт (VL-234).
  // Ошибка бросается ДО любых записей: файл задачи и usage не трогаются,
  // повтор безопасен и не плодит дубли комментариев/токенов.
  //
  // VL-253: жёсткой ошибки на отсутствие `comment` больше НЕТ — вместо неё
  // авто-отчёт (buildAutoReport). Требование в тексте ошибки модель
  // выполнить не может, если поля нет в required схемы, — это давало луп.
  const hardErrors: string[] = [];
  const norm = (s: string): string => s.trim().toLowerCase();
  if (typeof args.status === 'string' && norm(args.status) === norm(task.status)) {
    // Ссылка на существующий отчёт: модель должна видеть, что фаза уже закрыта
    const comments = (task.comments || []) as TaskComment[];
    const lastAgent = [...comments].reverse().find((c) => c.author === '@agent');
    const lastAny = comments.length > 0 ? comments[comments.length - 1] : undefined;
    const refComment = lastAgent ?? lastAny;
    const reportRef = refComment
      ? `Существующий отчёт: ${refComment.created} (@${refComment.author}), начало: "${String(refComment.text).slice(0, 80).replace(/\s+/g, ' ')}"`
      : 'Существующего отчёта в задаче нет.';
    hardErrors.push(
      `Фаза уже завершена: статус «${task.status}» совпадает с текущим. ${reportRef} ` +
        'Не повторяй этот вызов: статус уже целевой. Если нужен отчёт или отметки — backlog_add_comment / backlog_manage_ac / backlog_manage_dod; если фаза завершена — верни финальный текст.',
    );
  }
  if (hardErrors.length > 0) throw new Error(hardErrors.join('\n'));

  const errors: string[] = [];
  const updates: Partial<Task> = {};
  // Фактически применённые действия — каждый элемент сводки отражает запись,
  // а не переданный параметр (неприменённое поле не «светится» в сводке)
  let statusPart = 'Статус: не менялся';
  let commentPart = 'отчёт: нет';
  let acCount = 0;
  let dodCount = 0;
  let filesPart = 'файлов: не менялись';

  // Статус валидируется по конфигу: невалидный → ошибка в сводку, поле пропускается
  if (args.status !== undefined) {
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

  // Отчётный комментарий: author фиксирован @agent (поле author в схему не входит).
  // VL-253: comment из схемы обязателен, но модель может его не прислать
  // (description схемы не влияет на генерацию аргументов) — тогда собираем
  // отчёт автоматически, вместо ошибки: фаза не должна падать из-за поля,
  // которого модель физически не передаёт (инцидент VL-250/VL-252).
  const explicitComment = typeof args.comment === 'string' && args.comment.trim() !== ''
    ? args.comment
    : undefined;
  const acList = (task.acceptanceCriteria || []) as ChecklistItem[];
  const dodList = (task.definitionOfDone || []) as ChecklistItem[];
  const reportText = explicitComment ?? buildAutoReport(task, {
    status: typeof args.status === 'string' ? args.status : task.status,
    acChecked: acList.filter((c) => c.checked).length,
    acTotal: acList.length,
    dodChecked: dodList.filter((c) => c.checked).length,
    dodTotal: dodList.length,
    files: Array.isArray(args.modifiedFiles) ? (args.modifiedFiles as string[]) : (task.modified_files || []),
  });
  updates.comments = [...(task.comments || []), {
    author: '@agent',
    created: formatNow(),
    text: reportText,
  }];
  commentPart = explicitComment ? 'отчёт добавлен' : 'отчёт добавлен (авто)';

  // Единственная запись: все валидные обновления применяются одним вызовом
  if (Object.keys(updates).length > 0) {
    updateTaskFile(cwd, id, updates);
  }

  // ── token_usage (VL-198): агрегат токенов в frontmatter задачи ─────────
  // Запись ПОСЛЕ основного updateTaskFile: addTaskTokenUsage перечитывает
  // файл (updates уже на месте — не затираются). Резолв usage, если явный
  // tokenUsage не передан: мета текущей сессии (VIBELOG_SESSION_ID от CLI)
  // → её jsonl (fallback, когда мета старая без usage). Не резолвится
  // (qwen-ран без env, /prompt) — блок пропускается с ошибкой в сводку,
  // фаза НЕ падает (паттерн частичного применения инструмента).
  let tokenPart = '';
  // VL-251: пометка об откате нулевого tokenUsage на резолв сессии
  let tokenFallbackNote = '';
  try {
    const phaseName = (typeof args.phase === 'string' && args.phase)
      ? args.phase
      : process.env.VIBELOG_PHASE_NAME;
    let usage: TokenUsage | null = null;
    let usageSource = 'args';
    // VL-251: tokenUsage с нулями = отсутствующий параметр. Нулевой usage
    // приходит от модели, которая «не знает» своих токенов; раньше он
    // принимался как валидный и давал в сводке «уже записан» — неотличимо
    // от успеха. Теперь нули откатываются на штатный резолв (мета → jsonl),
    // при этом сам факт отката виден в сводке.
    const rawExplicit = args.tokenUsage !== undefined && args.tokenUsage !== null
      ? (typeof args.tokenUsage === 'object' && !Array.isArray(args.tokenUsage)
          ? (args.tokenUsage as Record<string, unknown>)
          : null)
      : undefined;
    const explicitKeys = ['input', 'output', 'cache', 'total', 'requests'];
    const explicitAllZero = rawExplicit
      ? explicitKeys.every((k) => rawExplicit[k] === undefined || rawExplicit[k] === 0)
      : false;
    // VL-253: явный tokenUsage из упавшей фазы — не «успешный» usage.
    // Модель подставляет в следующий вызов числа из сводки предыдущего
    // (упавшего) рана (VL-250/VL-252) — такие значения нельзя записывать в
    // frontmatter как usage этой фазы. Источник правды о последнем ране —
    // мета сессии (`last_run.is_error`, пишут CLI и оркестратор).
    const sessionIdForLastRun = process.env.VIBELOG_SESSION_ID;
    const lastRunMeta = sessionIdForLastRun
      ? loadSessionMetaSync(agentSessionsDir(process.env.VIBELOG_CWD ?? cwd), sessionIdForLastRun)
      : null;
    const lastRunFailed = lastRunMeta?.last_run?.is_error === true;
    if (explicitAllZero) {
      tokenFallbackNote = 'tokenUsage: нули игнорированы (как отсутствующий параметр)';
    } else if (lastRunFailed && rawExplicit !== undefined) {
      tokenFallbackNote = 'tokenUsage: проигнорирован (значения получены после упавшей фазы)';
    }
    if (rawExplicit !== undefined && !explicitAllZero && !lastRunFailed) {
      // Явный аргумент: валидация на границе (lesson-34) — объект с
      // finite-числами ≥0, без лишних ключей (additionalProperties: false)
      const raw = rawExplicit;
      const keys = explicitKeys;
      const badFields = raw
        ? keys.filter((k) => {
            const v = raw[k];
            return v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0);
          })
        : [];
      const unknownKey = raw ? Object.keys(raw).find((k) => !keys.includes(k)) : undefined;
      if (!raw || badFields.length > 0 || unknownKey) {
        errors.push(
          `tokenUsage: ${!raw ? 'ожидается объект' : unknownKey ? `неизвестное поле ${unknownKey}` : `нечисловые поля: ${badFields.join(', ')}`}`,
        );
      } else {
        const n = (k: string): number => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
        usage = { input: n('input'), output: n('output'), cache: n('cache'), total: n('total'), requests: n('requests') };
      }
    } else {
      // Fallback: env сессии → мета → jsonl (мета старая без usage)
      const sessionId = process.env.VIBELOG_SESSION_ID;
      const sessionsDir = agentSessionsDir(process.env.VIBELOG_CWD ?? cwd);
      if (sessionId) {
        const meta = loadSessionMetaSync(sessionsDir, sessionId);
        if (meta?.usage) {
          usage = { ...meta.usage };
        } else {
          const summed = sumUsageFromJsonlSync(sessionsDir, sessionId);
          if (summed) {
            usage = { input: summed.input, output: summed.output, cache: summed.cache, total: summed.total, requests: summed.requests };
            usageSource = 'jsonl';
          }
        }
        if (usage && !phaseName && meta?.phase) {
          // фаза берётся из меты, если env не задан
          (usage as TokenUsage & { __phase?: string }).__phase = meta.phase;
        }
      }
      if (!usage) {
        errors.push('token_usage: сессия/usage недоступны (нет VIBELOG_SESSION_ID либо у сессии нет usage в мете и jsonl)');
      }
    }
    if (usage) {
      const metaPhase = (usage as TokenUsage & { __phase?: string }).__phase;
      delete (usage as TokenUsage & { __phase?: string }).__phase;
      const finalPhase = phaseName ?? (metaPhase || undefined);
      if (!finalPhase) {
        errors.push('token_usage: фаза неизвестна (нет args.phase, VIBELOG_PHASE_NAME и meta.phase)');
      } else {
        // Дельта от usage_recorded меты — идемпотентность при повторных
        // вызовах finish_phase в одном ране (риск №1 плана VL-198)
        const sessionId = process.env.VIBELOG_SESSION_ID;
        const sessionsDir = agentSessionsDir(process.env.VIBELOG_CWD ?? cwd);
        const meta = sessionId ? loadSessionMetaSync(sessionsDir, sessionId) : null;
        const delta = usageDelta(meta?.usage_recorded ?? {}, usage);
        if (hasUsageDelta(delta)) {
          if (addTaskTokenUsage(cwd, id, finalPhase, delta)) {
            tokenPart = `tokenUsage: input=+${delta.input} (фаза ${finalPhase}, источник ${usageSource})`;
          }
        } else {
          tokenPart = 'tokenUsage: уже записан';
        }
        if (sessionId) {
          // Отметка перенесённого в frontmatter — следующий вызов допишет только дельту
          try {
            updateSessionMeta(sessionsDir, sessionId, { cwd, usage_recorded: usage });
          } catch (err) {
            errors.push(`token_usage: мета сессии не дополнена — ${(err as Error).message}`);
          }
        }
      }
    }
  } catch (err) {
    errors.push(`token_usage: ${(err as Error).message}`);
  }

  const summary = `${statusPart}; ${commentPart}; отмечено AC: ${acCount}, DoD: ${dodCount}; ${filesPart}` +
    (tokenPart ? `; ${tokenPart}` : '') +
    (tokenFallbackNote ? `; ${tokenFallbackNote}` : '') +
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
  // VL-262: applied — итоговый набор зависимостей из записи
  return ackOk(`Зависимости задачи ${args.id} обновлены: [${deps.join(', ')}]`, { dependencies: deps });
}

// ============================================================
// Поиск и готовность
// ============================================================

/**
 * Ищет задачи по запросу.
 *
 * Ответ — объект { found, returned, tasks } (VL-237): при усечении по limit
 * агенту нужно знать, сколько совпадений всего, иначе он не может понять,
 * что выдача неполная и запрос надо сузить.
 */
function toolSearch(args: ToolArgs, cwd: string): string {
  const { tasks, found } = searchTasksRanked(cwd, {
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
  return JSON.stringify({ found, returned: simplified.length, tasks: simplified }, null, 2);
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

async function toolReferenceAdd(args: ToolArgs, cwd: string): Promise<string> {
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
  // Кэш (VL-194): cache=true скачивает url → markdown в cache/<id>.md;
  // ошибка кэширования НЕ роняет создание — уходит в сообщение (как clone)
  let cacheMessage = '';
  if (args.cache === true) {
    if (!ref.url) {
      cacheMessage = '\nДля cache=true нужен url.';
    } else {
      const res = await cacheReference(cwd, ref);
      cacheMessage = '\n' + res.message;
    }
  }
  return `Reference ${ref.id} создан: ${ref.title} (${ref.type})${cloneMessage}${cacheMessage}`;
}

function toolReferenceView(args: ToolArgs, cwd: string): string {
  const entry = getReference(cwd, args.id as string);
  if (!entry) throw new Error(`Reference ${args.id} не найден.`);
  // Локальный markdown-кэш (VL-194): если есть — Plan-фаза читает его и не
  // делает web_fetch; поле отсутствует (null) → прежний fallback на url
  const cachedMarkdown = readReferenceCache(cwd, entry.reference);
  return JSON.stringify({
    ...entry.reference,
    body: entry.body,
    path: entry.path,
    cached_markdown: cachedMarkdown,
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

async function toolReferenceSync(args: ToolArgs, cwd: string): Promise<string> {
  // Без аргументов — прежнее поведение (только клоны, VL-152);
  // id — кэш одного; all — клоны + кэши url/doc/spec (VL-194)
  const cloneResult = syncReferenceRepos(cwd);
  if (args.id === undefined && args.all !== true) {
    return JSON.stringify(cloneResult, null, 2);
  }
  let cacheResult;
  if (typeof args.id === 'string') {
    const entry = getReference(cwd, args.id);
    if (!entry) throw new Error(`Reference ${args.id} не найден.`);
    const res = await refreshReferenceCache(cwd, entry.reference);
    const single = { updated: [] as string[], skipped: [] as string[], failed: [] as { id: string; error: string }[] };
    if (res.updated) single.updated.push(entry.reference.id);
    else if (res.message.includes('ошибка')) single.failed.push({ id: entry.reference.id, error: res.message });
    else single.skipped.push(entry.reference.id);
    cacheResult = single;
  } else {
    cacheResult = await syncReferenceCaches(cwd, { all: true });
  }
  return JSON.stringify({ ...cloneResult, ...cacheResult }, null, 2);
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

/**
 * Карта проекта (VL-235): обёртка над buildProjectMap.
 *
 * Валидация аргументов — на границе слоя (lesson-34): не-строки в query/dir
 * превращаются в явную ошибку-текст, а не TypeError из ядра; `limit` не-число
 * игнорируется (дефолт ядра). Вывод капится truncateToolOutput — единая точка
 * ограничения размера tool-вывода (lesson-30).
 */
function toolProjectMap(args: ToolArgs, cwd: string): string {
  const query = args.query;
  const dir = args.dir;
  const exportsFlag = args.exports;
  const limit = args.limit;
  if (query !== undefined && typeof query !== 'string') {
    return 'Ошибка: поле "query" должно быть строкой (подстрока по пути/описанию/экспортам).';
  }
  if (dir !== undefined && typeof dir !== 'string') {
    return 'Ошибка: поле "dir" должно быть строкой (каталог карты, например "src").';
  }
  if (exportsFlag !== undefined && typeof exportsFlag !== 'boolean') {
    return 'Ошибка: поле "exports" должно быть boolean.';
  }
  if (limit !== undefined && typeof limit !== 'number') {
    return 'Ошибка: поле "limit" должно быть числом (максимум модулей).';
  }
  const result = buildProjectMap(cwd, {
    ...(typeof query === 'string' ? { query } : {}),
    ...(typeof dir === 'string' ? { dir } : {}),
    ...(typeof exportsFlag === 'boolean' ? { exports: exportsFlag } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  });
  return truncateToolOutput(result.text);
}
