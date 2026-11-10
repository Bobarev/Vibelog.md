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
  updateTaskFile, completeTaskFile, addComment,
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
import type { UpdateDocumentInput, DocumentEntry } from '../core/document.js';
import {
  listReferences, getReference, writeReference,
  updateReference, removeReference, searchReferences,
  cloneReferenceRepo, syncReferenceRepos, linkReferenceTask,
  referenceUrls, REFERENCE_TYPES,
} from '../core/reference.js';
import type { UpdateReferenceInput } from '../core/reference.js';
import type { Reference } from '../core/reference.js';
import {
  cacheReference, refreshReferenceCache, readReferenceCache, syncReferenceCaches,
} from '../core/reference-cache.js';
// VL-418: чтение задач из клона референса (чужой backlog) — read-only пара
import { toolReferenceTasks, toolReferenceTaskView } from './reference-tasks-tool.js';
import {
  listLessons, getLesson, createLessonFile,
  updateLesson, searchLessons, linkLesson, supersedeLesson,
  isLessonBodyUnfilled,
} from '../core/lesson.js';
import type { UpdateLessonInput } from '../core/lesson.js';
import type { Lesson } from '../core/lesson.js';
import {
  auditLessons, applyLessonAudit, formatLessonAuditMarkdown,
} from '../core/lesson-audit.js';
import { classifyLessons } from '../core/lesson-classify.js';
import {
  buildConsolidationPlan, applyConsolidation,
} from '../core/lesson-consolidate.js';
import { createLlmClient } from '../agent/llm.js';
import { findBacklogDir, lessonsDir } from '../core/paths.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markPhaseAborted, getPhaseTransientStatus } from '../core/phase-transient.js';
// VL-248: терминальность статуса считается по workflow задачи (без хардкода имён)
import { getWorkflowForTask, phaseStatusTransitionError, isTerminalStatus } from '../core/workflow.js';
import { getCompletenessFields, getCompletenessRules, taskCompletenessMissing } from '../core/workflow.js';
import type { CompletenessField } from '../core/workflow.js';
import { buildProjectMap } from '../core/project-map.js';
import { truncateToolOutput } from '../agent/tools.js';
import { ackOk, ackOkDetailed, ackRead, ackError, ackErrorDetailed, unknownFields, sameValue, sameFieldsUpToDate, SET_FIELDS, BODY_FIELD } from './tool-result.js';
import { runUpdate, taskPhaseState, defaultPhaseState } from './update-pipeline.js';
// VL-413: блок `phase` обязателен в КАЖДОМ ответе write-инструмента — признак
// «это write» берётся из общего классификатора (VL-306), а не из списка имён.
import { isWriteOperation } from '../core/tool-classify.js';
import type { EntitySpec, RejectDetail } from './update-pipeline.js';
// VL-399: точечная правка тела документа + guard от молчаливой потери тела
import { applyBodyEdit, contentShrinkCheck } from './document-edit.js';
import { buildAutoReport, uncheckedItems } from './auto-report.js';
import type { SkippedField } from './tool-result.js';
import { withIdempotency } from './idempotency.js';
import { ensureWorktreeOnCreate } from '../core/worktree.js';
import type { Task, TaskComment, ChecklistItem } from '../core/task.js';
import { addTaskTokenUsage } from '../core/store.js';
import { hasUsageDelta, usageDelta } from '../core/analytics.js';
import type { TokenUsage } from '../core/analytics.js';
import {
  agentSessionsDir, loadSessionMetaSync, sumUsageFromJsonlSync, updateSessionMeta,
} from '../agent/session.js';
import { SUPERVISOR_TOOL_DEFS, handleSupervisorTool } from './supervisor.js';
// VL-398: конструктор workflow — отдельный домен (как supervisor)
import { WORKFLOW_TOOL_DEFS, handleWorkflowTool } from './workflow-tools.js';
// VL-412: архитектурные решения (ADR) — отдельный домен, как supervisor/workflow
import { DECISION_TOOL_DEFS, handleDecisionTool } from './decision-tools.js';
import { commitFiles } from './git-commit.js';
// VL-363: репорт бага в upstream через GitVerse Issues
import { GitverseError, isUpstreamConfigured, reportBug, tokenHint, resolveUpstreamConfig } from '../core/gitverse-issues.js';
import {
  MIN_REPORT_ID_PREFIX,
  REPORTS_DIR,
  UpstreamGitError,
  ackReport,
  ensureInboxClone,
  inboxPath,
  listIncoming,
  parseReport,
  targetMatches,
} from '../core/upstream-git.js';
import type { UpstreamReport } from '../core/upstream-git.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadSettings } from '../core/settings.js';

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
  // VL-376: modifiedFilesReplace — явный флаг полной замены modified_files
  // (по умолчанию список НАКАПЛИВАЕТСЯ). Без него флаг попал бы в skipped
  // как «неизвестное поле», и ответ утверждал бы, что он не применён.
  'modifiedFiles', 'modifiedFilesReplace', 'references', 'lessons', 'acceptanceCriteria', 'idempotencyKey',
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
          // VL-260: отбор полей карточки — общий хелпер с backlog_view_task
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Опционально: какие ключи карточки вернуть (id, title, status, priority, labels, assignee, milestone, type, parent_task_id). Принимаются camelCase/snake_case-алиасы (parentTaskId → parent_task_id). Неизвестные ключи не прерывают вызов: они игнорируются, а в корень ответа добавляется `_warning` с ближайшими именами. Без параметра — прежний массив карточек.',
          },
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
            description: 'Имена полей Task для возврата. Допустимые ключи (ключи интерфейса Task): id, title, status, priority, assignee, reporter, created_date, updated_date, due_date, labels, dependencies, milestone, type, project, parent_task_id, ordinal, references, documentation, modified_files, lessons, token_usage, description, acceptanceCriteria, definitionOfDone, implementationPlan, implementationNotes, finalSummary, comments. Принимаются camelCase/snake_case-алиасы (modifiedFiles → modified_files, implementation_plan → implementationPlan) и смысловые алиасы: notes → implementationNotes, plan → implementationPlan, ac → acceptanceCriteria, dod → definitionOfDone, summary → finalSummary. Неизвестные ключи НЕ прерывают вызов: они игнорируются, остальные запрошенные поля возвращаются, а в конец ответа добавляется `_warning` со списком проигнорированных и ближайшими допустимыми именами. Без параметра или при пустом массиве — полное представление',
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
          modifiedFiles: { type: 'array', items: { type: 'string' }, description: 'Изменённые файлы: НАКОПЛЕНИЕ с дедупликацией (существующие первыми, новые в конце) — повторный вызов не стирает историю; modifiedFilesReplace: true — полная замена (VL-376)' },
          modifiedFilesReplace: { type: 'boolean', description: 'true — ПОЛНАЯ замена modified_files вместо накопления (исправление ошибочного пути, VL-376)' },
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
          // VL-260: отбор полей карточки — общий хелпер с backlog_view_task
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Опционально: какие ключи карточки вернуть (id, title, status, priority, type, project, labels, milestone). Принимаются camelCase/snake_case-алиасы. Неизвестные ключи не прерывают вызов: они игнорируются, а в корень ответа добавляется `_warning` с ближайшими именами. Без параметра — полные карточки.',
          },
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
          content: {
            type: 'string',
            description:
              'Новое содержимое — ПОЛНАЯ замена тела документа. Точечная правка — document_edit. ' +
              'Если текст короче текущего более чем на 40% и не сохраняет его начала, вызов отклоняется: ' +
              'осознанная замена требует full_replace: true',
          },
          type: { type: 'string', enum: ['readme', 'guide', 'specification', 'other'], description: 'Тип' },
          tags: { type: 'array', items: { type: 'string', maxLength: 100 }, description: 'Теги (полная замена)' },
          full_replace: {
            type: 'boolean',
            description:
              'Явное согласие на полную замену тела, даже если content короче текущего более чем на 40% ' +
              '(guard от молчаливой потери тела, VL-399)',
          },
        },
        required: ['id'],
      },
    },
    {
      // VL-399: точечная правка тела документа. Отдельный инструмент, а не
      // edit-режим document_update: смешение «content — полная замена» и
      // «old_string → new_string» в одном вызове дало бы неопределённый исход
      // при передаче обоих полей. Модель уже знает семантику файлового edit.
      name: 'document_edit',
      description:
        'Точечная правка ТЕЛА документа: заменяет old_string на new_string. ' +
        'Без replace_all old_string обязан встречаться ровно один раз — иначе отказ без записи. ' +
        'Заголовок/тип/теги — через document_update (там content — ПОЛНАЯ замена тела).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID документа (например doc-1)' },
          old_string: { type: 'string', description: 'Точный текст для поиска в теле' },
          new_string: { type: 'string', description: 'Текст замены' },
          replace_all: { type: 'boolean', description: 'Заменить все вхождения' },
          idempotencyKey: { type: 'string', description: 'Ключ идемпотентности: повтор с тем же ключом не применяет изменение второй раз' },
        },
        required: ['id', 'old_string', 'new_string'],
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
      description: 'Завершение фазы одним вызовом: статус + отчётный комментарий + modifiedFiles + батч-отметки AC/DoD. `comment` объявлен в required — заполняй его отчётом о фазе. Если comment всё же не передан (VL-253), сервер собирает отчёт автоматически из статуса, отметок AC/DoD, modified_files и фрагмента плана и завершает фазу без ошибки. Смена статуса разрешена только фазе, у которой в workflow задачи есть переход «текущий статус + фаза → запрошенный статус» (VL-245): служебные фазы (comment/prompt/analyze/resume) статус не меняют, чужая фаза чужой статус — тоже. Передавай ровно тот статус, что дал шаблон ({{producesStatus}}), иначе он не запишется. Повторный вызов со статусом, равным текущему (already_finished), возвращает ошибку с датой и источником существующего отчёта: не повторяй такой вызов, а заверши фазу финальным текстом. Невалидные значения полей (статус вне конфига, запрещённый фазой переход, битый индекс AC/DoD) пропускаются с сообщением в сводке — частичное применение. Пример сводки: «Статус: Review; отчёт добавлен; отмечено AC: 2, DoD: 1; файлов: 3». Если фаза прервана (не выполнена) — передай `aborted: true` вместе с отчётом-причиной и БЕЗ status: produces_status к такой фазе не применяется (VL-244). Терминальный статус (Done/Rejected) при НЕвыполненных пунктах DoD отклоняется: либо отметь пункты в dodChecks, либо передай непустой `dodOverride` с причиной (попадёт в комментарий-отчёт), либо `aborted: true`, если работа не завершена (VL-248).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи' },
          status: { type: 'string', description: 'Новый статус (валидируется по конфигу; невалидный — пропускается с ошибкой в сводке)' },
          comment: { type: 'string', description: 'Отчётный комментарий (author фиксирован @agent). Обязательное поле схемы; если всё равно не передан — сервер собирает отчёт автоматически (VL-253).' },
          modifiedFiles: { type: 'array', items: { type: 'string' }, description: 'Изменённые файлы: НАКОПЛЕНИЕ с дедупликацией (существующие первыми, новые в конце) — повторный вызов не стирает историю; modifiedFilesReplace: true — полная замена (VL-376)' },
          modifiedFilesReplace: { type: 'boolean', description: 'true — ПОЛНАЯ замена modified_files вместо накопления (исправление ошибочного пути, VL-376)' },
          acChecks: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] }, description: 'Индексы AC для отметки (с 1; батч-отметка, как в manage_ac)' },
          dodChecks: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] }, description: 'Индексы DoD для отметки (с 1; батч-отметка, как в manage_dod)' },
          // VL-248: условно обязательное поле. В required его нет (иначе
          // сломался бы обычный close без замечаний) — требование выставляется
          // явной ошибкой, когда терминальный статус ставится при непройденных DoD.
          dodOverride: {
            type: 'string',
            description: 'Причина закрытия задачи, у которой остались НЕвыполненные пункты DoD (VL-248). Нужна ТОЛЬКО если ставишь терминальный статус (Done/Rejected), а часть DoD не пройдена: без неё вызов отклоняется (isError), статус не меняется. Непустая причина попадёт строкой «DoD override: …» в комментарий-отчёт фазы. Если пункт DoD выполнить не удалось и задача закрывается — это единственный законный путь; если работа не выполнена — передавай `aborted: true` вместо терминального статуса.',
          },
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
          // VL-244: явный сигнал итога фазы. Без него аварийная ветка
          // («фаза прервана, статус не меняем») завершалась кодом 0 и
          // получала produces_status — Done незавершённой задаче (VL-219).
          aborted: {
            type: 'boolean',
            description: 'Явный сигнал: фаза завершается АВАРИЙНО (не выполнена). При true статус-переход produces_status НЕ применяется — транзиент откатит задачу к статусу до фазы и запишет комментарий-причину. Используй в аварийных ветках шаблонов вместо отчёта без status.',
          },
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
          type: { type: 'string', enum: REFERENCE_TYPES, description: 'Фильтр по типу (repo/url/file/doc/spec/experiment)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Фильтр по меткам (все указанные должны совпасть)' },
        },
      },
    },
    {
      name: 'reference_add',
      description: 'Добавить reference (внешний источник знаний). Для type=repo по умолчанию САМ клонирует репозиторий в backlog/references/data/<dir> (идемпотентно: если каталог есть — пропуск). Поддерживает несколько ссылок (url + urls): cache=true склеивает их в один md-файл секциями в порядке ссылок, ошибка одной ссылки не ломает остальные.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок reference' },
          type: { type: 'string', enum: REFERENCE_TYPES, description: 'Тип: repo/url/file/doc/spec/experiment' },
          url: { type: 'string', description: 'URL (для repo/url); повторяемые ссылки — в urls' },
          urls: { type: 'array', items: { type: 'string' }, description: 'Дополнительные URL: кэш склеивается секциями в порядке ссылок (url + urls). Ошибка одной ссылки не ломает остальные — её секция помечается в md, результат = частичный успех' },
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
      description: 'Обновить reference: теги, описание и/или набор ссылок (полная замена переданных полей).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID reference (ref-N)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Метки (полная замена)' },
          description: { type: 'string', description: 'Описание (markdown, полная замена тела)' },
          url: { type: 'string', description: 'Основная ссылка (полная замена значения url)' },
          urls: { type: 'array', items: { type: 'string' }, description: 'Дополнительные ссылки (полная замена набора; [] — очистить). Порядок = порядок секций кэша' },
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
    // VL-418: чтение задач из клона референса (чужой backlog). Аргумента
    // path/dir в схеме НЕТ намеренно: путь резолвится только через
    // referenceCloneDir + realpath-проверку внутри references/data/.
    {
      name: 'reference_tasks',
      description: 'Список задач из клона референса (type=repo) — чтение чужого backlog без read_file по путям. Фильтры status/labels/type, сортировка, лимит (дефолт 50, максимум 200). Ответ содержит total (сколько всего совпало) и returned (сколько отдано). Аргумента пути нет: каталог резолвится из reference.',
      inputSchema: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'ID reference (ref-N) с type=repo' },
          status: { type: 'string', description: 'Точный статус задачи (case-insensitive)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Метки: должны совпасть все (AND)' },
          type: { type: 'string', description: 'Точный тип задачи (bug/feature/…)' },
          limit: { type: 'number', description: 'Максимум задач в ответе (дефолт 50, максимум 200)' },
          sort: { type: 'string', enum: ['id', 'updated', 'priority'], description: 'Сортировка: id (натуральная), updated (свежие первыми), priority (High→Medium→Low)' },
          includeCompleted: { type: 'boolean', description: 'Читать и backlog/completed/ (по умолчанию только backlog/tasks/)' },
        },
        required: ['reference'],
      },
    },
    {
      name: 'reference_task_view',
      description: 'Полная задача из клона референса (type=repo) по ID: описание, AC, план, итоговое резюме. Неизвестный id → ошибка со списком ближайших ID.',
      inputSchema: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'ID reference (ref-N) с type=repo' },
          id: { type: 'string', description: 'ID задачи в клоне (например VL-123)' },
        },
        required: ['reference', 'id'],
      },
    },
    // === Lessons learned — уроки из задач (VL-153) ===
    {
      name: 'lesson_list',
      description: 'Список lessons (уроков из задач) с опциональными фильтрами status/tags.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Фильтр по статусу (active|needs-review|outdated|superseded)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Фильтр по меткам (все указанные должны совпасть)' },
        },
      },
    },
    {
      name: 'lesson_create',
      description: 'Создать lesson (урок из опыта задач). Императив, конкретика, 1 предложение в title. Тело передаётся тремя обычными строками: problem (обязателен), solution (обязателен), example (необязателен) — сервер сам склеит их в markdown с заголовками «## Проблема / ## Решение / ## Пример».',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок-урок (императив, 1 предложение)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Метки (для подбора по tags в Plan)' },
          sourceTasks: { type: 'array', items: { type: 'string' }, description: 'Задачи-источники урока (VL-N)' },
          problem: { type: 'string', description: 'Что было не так — обычный текст, без markdown-разметки' },
          solution: { type: 'string', description: 'Что сделали — обычный текст, без markdown-разметки' },
          example: { type: 'string', description: 'Конкретный пример (необязателен)' },
        },
        required: ['title', 'problem', 'solution'],
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
      description: 'Обновить lesson: поля и/или тело. updated_date обновляется автоматически. Тело передаётся строками problem и solution (вместе — ПОЛНАЯ замена тела) плюс необязательный example; сервер склеивает их в markdown.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID lesson (lesson-N)' },
          title: { type: 'string', description: 'Новый заголовок (переименовывает файл)' },
          status: { type: 'string', enum: ['active', 'needs-review', 'outdated', 'superseded'], description: 'Статус' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Метки (полная замена)' },
          sourceTasks: { type: 'array', items: { type: 'string' }, description: 'Задачи-источники (полная замена)' },
          linkedTasks: { type: 'array', items: { type: 'string' }, description: 'Задачи, где применялся (полная замена)' },
          supersedes: { type: 'string', description: 'ID заменённого lesson (пустая строка — сброс)' },
          problem: { type: 'string', description: 'Проблема — обычный текст, без markdown-разметки (вместе с solution — полная замена тела)' },
          solution: { type: 'string', description: 'Решение — обычный текст, без markdown-разметки' },
          example: { type: 'string', description: 'Конкретный пример (необязателен)' },
          lastVerified: { type: 'string', description: 'Дата проверки актуальности YYYY-MM-DD (VL-279)' },
          verifiedBy: { type: 'string', enum: ['auto', 'agent', 'human'], description: 'Кто проверил актуальность (VL-279)' },
          appliesTo: { type: 'array', items: { type: 'string' }, description: 'Glob-пути/имена символов, проверяемые механически (VL-279)' },
          kind: { type: 'string', description: 'Тип урока: rule|workaround|fact (пусто — сброс) (VL-279)' },
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
      name: 'lesson_audit',
      description:
        'Механический аудит актуальности lessons (VL-279): битые пути в теле/применении, висячие ссылки на задачи, ' +
        'поломанные supersedes и циклы, дубли (Jaccard по заголовку/tags/телу), сироты и протухание. ' +
        'READ-ONLY по умолчанию: возвращает отчёт (findings[] по уроку + сводка по типам). ' +
        'Записи — только при явном verified/needsReview по конкретным ID (массовых изменений нет): ' +
        'verified → last_verified=today + verified_by=auto; needsReview → status=needs-review. ' +
        'Пороги: threshold (дубли 0..1), staleDays (дни), write — записать backlog/lessons/AUDIT.md.',
      inputSchema: {
        type: 'object',
        properties: {
          threshold: { type: 'number', description: 'Порог схожести дублей 0..1 (по умолчанию из настроек/0.35)' },
          staleDays: { type: 'number', description: 'Порог протухания в днях (по умолчанию из настроек/180)' },
          write: { type: 'boolean', description: 'Записать отчёт в backlog/lessons/AUDIT.md (по умолчанию false)' },
          verified: { type: 'array', items: { type: 'string' }, description: 'ID уроков: отметить проверенными (last_verified=today, verified_by=auto)' },
          needsReview: { type: 'array', items: { type: 'string' }, description: 'ID уроков: перевести в статус needs-review' },
        },
      },
    },
    {
      name: 'lesson_classify',
      description:
        'Классификация уроков (lessons) и генерация задач техдолга из уроков-обходов (VL-280). ' +
        'LLM-путь, opt-in — НЕ входит ни в один автоматический прогон/CI-аудит. ' +
        'Вход: ids[] либо фильтр (status, tags, limit). Выход: для каждого урока kind ∈ ' +
        '{rule, workaround, fact, stale} + обоснование; кластеры workaround и черновики задач техдолга. ' +
        'По умолчанию НИЧЕГО не пишет: kind во фронтматтер — только apply=true или confirmIds; ' +
        'задачи техдолга — только createClusters (ID кластеров из ответа), не более N за вызов ' +
        '(настройка lessons.tech_debt_max_tasks, дефолт 1). Идемпотентно: повтор по тем же урокам не создаёт дубль.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'ID уроков (lesson-N); приоритетнее фильтра' },
          status: { type: 'string', description: 'Фильтр по статусу (active/needs-review/outdated/superseded)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Фильтр по меткам (любое пересечение)' },
          limit: { type: 'number', description: 'Максимум уроков в выборке (по умолчанию 20)' },
          apply: { type: 'boolean', description: 'Записать kind во фронтматтер всем классифицированным (по умолчанию false)' },
          confirmIds: { type: 'array', items: { type: 'string' }, description: 'ID уроков, которым kind разрешено записать' },
          createClusters: { type: 'array', items: { type: 'string' }, description: 'ID кластеров, для которых создавать задачи техдолга (явное подтверждение)' },
          maxTasks: { type: 'number', description: 'Лимит задач за вызов (по умолчанию из настроек/1)' },
        },
      },
    },
    {
      name: 'lesson_consolidate',
      description:
        'Консолидация корпуса lessons (VL-400): кластеры правил (kind=rule) → предлагаемая строка для AGENTS.md, ' +
        'пары дублей (duplicate_of из аудита) → предложение supersede, уроки с пустым телом. ' +
        'READ-ONLY по умолчанию: возвращает план, ничего не пишет. ' +
        'Запись — только явными списками: supersede (ID канона кластера или урока-дубля) и ' +
        'appendAgentsMd (строки в секцию-маркер AGENTS.md, дедуп по тексту). ' +
        'Флага «применить всё» нет намеренно: порог дублей 0.35 даёт ложные пары (lesson-147).',
      inputSchema: {
        type: 'object',
        properties: {
          threshold: { type: 'number', description: 'Порог схожести дублей 0..1 (по умолчанию из настроек/0.35)' },
          supersede: {
            type: 'array',
            items: { type: 'string' },
            description: 'ID уроков: применить supersede-план их кластера/пары (канон → остальные, не-канон → он сам)',
          },
          appendAgentsMd: {
            type: 'array',
            items: { type: 'string' },
            description: 'Строки, дописываемые в секцию-маркер AGENTS.md (дедуп по нормализованному тексту)',
          },
        },
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
    // === Git: детерминированный коммит (VL-311) ===
    {
      name: 'git_commit',
      description:
        'Коммит явными путями с трейлером Co-authored-by. Делает `git add -- <paths>` и `git commit` ' +
        'детерминированно: трейлер дописывается кодом (настройка commit_coauthor), пути вне проекта и ' +
        'массовый add (git add -A, ".") отклоняются, пути вне modified_files задачи отклоняются с ' +
        'подсказкой allowForeign. Нечего коммитить по переданным путям → noop. ' +
        'Используй его вместо `git commit` в run_shell_command; status/log/diff/merge — по-прежнему shell. ' +
        'Аргументы: paths (обязательный непустой массив), message, amend?, allowForeign?.',
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Обязательный непустой массив явных путей (файлы задачи); git add -A, "." и пути вне проекта отклоняются',
          },
          message: { type: 'string', description: 'Сообщение коммита: тема (тело — отдельным абзацем после пустой строки)' },
          amend: { type: 'boolean', description: 'true — переписать последний коммит (--amend) с сохранением тела исходного сообщения' },
          allowForeign: { type: 'boolean', description: 'true — разрешить пути вне modified_files задачи (осознанное исключение)' },
          cwd: {
            type: 'string',
            description: 'Каталог коммита (путь внутри проекта) — только для шага close-worktree, который коммитит чужой worktree; по умолчанию worktree задачи (или главный репо в close)',
          },
        },
        required: ['paths', 'message'],
      },
    },
    // === GitVerse Issues: репорт бага в upstream-проект (VL-363) ===
    {
      name: 'upstream_report_bug',
      description:
        'Репорт бага в другой проект Vibelog. Транспорт выбирается секцией upstream в ' +
        '.vibelog/settings.json: mode "git" (по умолчанию) — отчёт кладётся в общий репозиторий-инбокс ' +
        '({inbox, prefix}; нужен target — префикс получателя), mode "api" — создаётся issue в GitVerse ' +
        'Issues ({repo, labels, type}, токен GITVERSE_TOKEN в .env). Инструмент виден только при ' +
        'настроенном upstream. Ответ — JSON-ack: {ok:true, applied:{…}, message} либо {ok:false, error, hint}.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок отчёта (обязателен, непустой)' },
          target: {
            type: 'string',
            description:
              'Получатель отчёта — префикс проекта (ui, tpl, vl). Обязателен для mode "git", ' +
              'по нему получатель забирает входящие через «vibelog upstream pull»',
          },
          body: { type: 'string', description: 'Что произошло: описание проблемы, шаги, ожидаемое поведение' },
          severity: { type: 'string', description: 'Важность: low|medium|high|critical (попадает в «Окружение»)' },
          area: { type: 'string', description: 'Область: cli|mcp|web|agent|install|… (попадает в «Окружение»)' },
          source_task: { type: 'string', description: 'ID задачи проекта-источника (например VL-12) — для секции «Источник»' },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Дополнительные метки поверх upstream.labels (только для mode "api"; создаются при отсутствии)',
          },
        },
        required: ['title'],
      },
    },
    // === GitVerse Issues: приём входящих отчётов (VL-391) ===
    {
      name: 'upstream_list_reports',
      description:
        'Входящие отчёты об ошибках от других проектов Vibelog (git-инбокс). ' +
        'Без report_id — список отчётов для своего префикса (по умолчанию только open); ' +
        'с report_id — полное тело одного отчёта. Виден только при настроенном upstream.',
      inputSchema: {
        type: 'object',
        properties: {
          report_id: { type: 'string', description: 'ID отчёта (полный или первые 8 символов) — вернуть тело' },
          include_resolved: {
            type: 'boolean',
            description: 'Показать и accepted/rejected (по умолчанию только open)',
          },
        },
      },
    },
    {
      name: 'upstream_ack_report',
      description:
        'Принять или отклонить входящий отчёт. accept требует task_id (задача в ЭТОМ проекте, ' +
        'проверяется на существование) и связывает отчёт с задачей: пишет accepted_as и добавляет ' +
        'комментарий в задачу. reject требует reason — причина попадает в отчёт, чтобы отправитель ' +
        'понял отказ. Виден только при настроенном upstream.',
      inputSchema: {
        type: 'object',
        properties: {
          report_id: { type: 'string', description: 'ID отчёта (полный или первые 8 символов)' },
          action: { type: 'string', enum: ['accept', 'reject'], description: 'accept — принять, reject — отклонить' },
          task_id: { type: 'string', description: 'ID задачи-получателя (обязателен для accept), например VL-391' },
          reason: { type: 'string', description: 'Причина отказа (обязательна для reject)' },
        },
        required: ['report_id', 'action'],
      },
    },
    // === Супервизор: запуск фаз, очередь, прогон (VL-268) ===
    ...SUPERVISOR_TOOL_DEFS,
    // VL-398: конструктор workflow (workflow_get / workflow_apply)
    ...WORKFLOW_TOOL_DEFS,
    // VL-412: архитектурные решения (decision_list/view/create/update)
    ...DECISION_TOOL_DEFS,
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
  const out = await handleToolCallInner(name, args, cwd, opts);
  return withPhaseBlock(name, args, cwd, out);
}

/**
 * Дописывает блок `phase` в ответ write-инструмента (VL-413, AC3).
 *
 * Зачем на границе, а не в каждом инструменте: AC3 требует блок в КАЖДОМ
 * ответе write-инструмента, а write-инструментов в реестре больше тридцати.
 * Копия в каждом — ровно тот дефект, который закрывал VL-369 (четыре копии
 * одной логики). Здесь одна точка: ответ уже JSON-ack → добавляем поле, если
 * его нет; плоский текст и не-JSON не трогаем (их форма — отдельный контракт).
 *
 * `phaseNextStep` читает диск, поэтому блок считается ОДИН раз на ответ и
 * только когда его действительно нет (update-pipeline уже положил свой).
 */
function withPhaseBlock(name: string, args: ToolArgs, cwd: string, out: string): string {
  if (!isWriteOperation(name, args)) return out;
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(out);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
    parsed = value as Record<string, unknown>;
  } catch {
    return out; // плоский текст — не ack, форма не наша
  }
  if (parsed.phase !== undefined) return out;
  if (parsed.ok !== true) return out; // отказы/ошибки — не «состояние фазы»
  parsed.phase = defaultPhaseState({ cwd, phase: resolveGuardPhase(cwd) }, []);
  return JSON.stringify(parsed, null, 2);
}

async function handleToolCallInner(
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
    case 'document_edit':
      // VL-399: точечная правка тела. Идемпотентность по ключу вызывающего —
      // как у остальных write-инструментов (VL-262): повтор после таймаута
      // возвращает сохранённый ответ первого применения.
      return withIdempotency(cwd, name, args.idempotencyKey, () => toolDocumentEdit(args, cwd));
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
    // VL-418: чтение задач из клона референса — чистый read, идемпотентность
    // by-key не нужна (ничего не пишется)
    case 'reference_tasks':
      return toolReferenceTasks(args, cwd);
    case 'reference_task_view':
      return toolReferenceTaskView(args, cwd);
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
    case 'lesson_audit':
      return toolLessonAudit(args, cwd);
    case 'lesson_classify':
      return toolLessonClassify(args, cwd);
    case 'lesson_consolidate':
      return toolLessonConsolidate(args, cwd);
    case 'project_map':
      return toolProjectMap(args, cwd);
    // VL-311: коммит явными путями с трейлером — детерминированная замена
    // шагов `git commit -m` в шаблонах фаз (инструкция модели → проверка в коде).
    // Идемпотентность by-key не нужна: повторный вызов по тем же путям без
    // изменений отвечает noop (VL-310), а не создаёт пустой коммит.
    case 'git_commit':
      return commitFiles(cwd, {
        paths: (args.paths as string[]) ?? [],
        message: (args.message as string) ?? '',
        amend: args.amend === true,
        allowForeign: args.allowForeign === true,
        cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
      });
    // VL-363: репорт бага в upstream через GitVerse Issues. Сетевой write:
    // идемпотентность by-key не применяется (дедуп даёт номер issue, а
    // повторный вызов создаст второй issue — это осознанно: репорт уникален).
    case 'upstream_report_bug':
      return toolUpstreamReportBug(args, cwd);
    // VL-391: приём входящих отчётов — чтение списка и решение accept/reject.
    // Идемпотентность by-key не нужна (как у report_bug): повторный accept того
    // же отчёта с тем же task_id даёт noop от replaceAckFields (значения уже такие).
    case 'upstream_list_reports':
      return toolUpstreamListReports(args, cwd);
    case 'upstream_ack_report':
      return toolUpstreamAckReport(args, cwd);
    // VL-268: инструменты супервизора (фазы, очередь, прогон). Идемпотентность
    // by-key здесь не применяется: они не пишут поля задачи, а запускают фазы
    // и прогоны (дедуп add-очереди и «фаза уже идёт» даёт ядро/оркестратор).
    case 'backlog_trigger_phase':
    case 'backlog_phase_status':
    case 'backlog_auto_queue':
    case 'backlog_supervisor':
      return handleSupervisorTool(name, args, cwd);
    // VL-398: конструктор workflow — чтение схемы и запись конфигурации
    case 'workflow_get':
    case 'workflow_apply':
      return handleWorkflowTool(name, args, cwd);
    // VL-412: архитектурные решения. Идемпотентность by-key — у write-веток
    // (create/update): повтор после таймаута не создаёт второе решение.
    case 'decision_list':
    case 'decision_view':
      return handleDecisionTool(name, args, cwd);
    case 'decision_create':
    case 'decision_update':
      return withIdempotency(cwd, name, args.idempotencyKey, () => handleDecisionTool(name, args, cwd));
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
  // VL-278: задача, созданная сразу в статусе «plan уже выполнен», должна
  // получить ветку vb/<id> и worktree — иначе фаза code пойдёт в главном
  // дереве (инцидент VL-277). Fail-open: ошибка git не отменяет создание.
  const wt = ensureWorktreeOnCreate(cwd, task.id, task.status);
  if (wt.worktreePath !== null) {
    applied.worktree = wt.worktreePath;
  }
  if (wt.warning !== undefined) {
    return ackOk(`${wt.warning}\nЗадача ${task.id} создана: ${task.title}`, applied, skipped);
  }
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

  // VL-260: опциональный отбор полей — те же правила и тот же текст предупреждения,
  // что у backlog_view_task (общий хелпер). Без fields формат ответа прежний (массив).
  if (args.fields !== undefined) {
    const { picked, warning } = pickFieldsList(
      simplified as unknown as Array<Record<string, unknown>>,
      args.fields,
      Object.keys(simplified[0] ?? {
        id: '', title: '', status: '', priority: '', labels: [], assignee: '',
        milestone: '', type: '', parent_task_id: '',
      }),
    );
    return JSON.stringify(warning ? { tasks: picked, _warning: warning } : picked, null, 2);
  }

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
  const reverse = valid.find((key) => camelToSnake(key) === snake);
  if (reverse !== undefined) return reverse;
  // VL-260: смысловые алиасы. Модель естественно пишет `notes`/`plan`/`ac`/`dod`,
  // тогда как ключи Task называются implementationNotes/implementationPlan/
  // acceptanceCriteria/definitionOfDone. Проверка стоит ПОСЛЕ точного совпадения
  // и нормализации, поэтому реальный ключ Task всегда приоритетнее алиаса
  // (в интерфейсе Task таких коротких имён нет — конфликт исключён).
  const alias = FIELD_ALIASES[field] ?? FIELD_ALIASES[snake];
  return alias !== undefined && valid.includes(alias) ? alias : undefined;
}

/**
 * Явные смысловые алиасы: слово, которое модель пишет естественно → канонический
 * ключ Task (VL-260). Работают только если в задаче реально есть целевой ключ.
 */
const FIELD_ALIASES: Record<string, string> = {
  notes: 'implementationNotes',
  note: 'implementationNotes',
  plan: 'implementationPlan',
  plans: 'implementationPlan',
  ac: 'acceptanceCriteria',
  dod: 'definitionOfDone',
  summary: 'finalSummary',
};

/** Расстояние Левенштейна — только для подсказок «ближайшие имена полей» (VL-260). */
function levenshtein(a: string, b: string): number {
  // Обычная DP по двум строкам; имена полей короткие, оптимизации не нужны.
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Подсказывает ближайшие допустимые имена для опечатки/незнакомого слова (VL-260).
 *
 * Сравнение идёт по нормализованной форме (camelToSnake), порог — расстояние не
 * больше max(2, len/3) либо вхождение подстроки (ловятся `notes` → `implementationNotes`).
 * Подсказка никогда не подставляется автоматически — только показывается в `_warning`.
 */
function suggestFieldNames(field: string, validKeys: string[], limit = 3): string[] {
  const token = camelToSnake(field);
  const scored: Array<{ key: string; dist: number }> = [];
  for (const key of validKeys) {
    const norm = camelToSnake(key);
    const dist = levenshtein(token, norm);
    const close = dist <= Math.max(2, Math.floor(token.length / 3))
      || norm.includes(token) || token.includes(norm);
    if (close) scored.push({ key, dist });
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, limit).map((s) => s.key);
}

/**
 * Резолвит список запрошенных полей: канонические ключи (дедуп по первому вхождению)
 * и список неизвестных имён (VL-260).
 *
 * Валидация типа — на границе слоя (lesson-34): не-массив и не-строковые элементы
 * дают явную ошибку, а не TypeError из camelToSnake.
 */
function resolveFields(fields: unknown, validKeys: string[]): { resolved: string[]; unknown: string[] } {
  if (!Array.isArray(fields) || fields.some((f) => typeof f !== 'string')) {
    throw new Error('Параметр fields должен быть массивом имён полей.');
  }
  const resolved: string[] = [];
  const unknown: string[] = [];
  for (const f of fields as string[]) {
    const name = resolveFieldName(f, validKeys);
    if (name === undefined) {
      unknown.push(f);
      continue;
    }
    // Дедуп: один канонический ключ, пришедший дважды (alias + canonical),
    // не должен попасть в ответ дважды; порядок — по первому вхождению
    if (!resolved.includes(name)) resolved.push(name);
  }
  return { resolved, unknown };
}

/**
 * Текст предупреждения о проигнорированных полях (VL-260).
 *
 * VL-260/lesson-92: вместо отказа с пустым ответом агент получает валидные поля
 * плюс явный следующий шаг — ближайшие имена и полный список допустимых.
 */
function unknownFieldsWarning(unknown: string[], validKeys: string[]): string {
  const hints: string[] = [];
  for (const f of unknown) {
    for (const key of suggestFieldNames(f, validKeys)) {
      if (!hints.includes(key) && !unknown.includes(key)) hints.push(key);
    }
  }
  let text = `Неизвестные поля проигнорированы: ${unknown.join(', ')}.`;
  if (hints.length > 0) text += ` Ближайшие: ${hints.slice(0, 3).join(', ')}.`;
  text += ` Допустимые: ${validKeys.join(', ')}.`;
  return text;
}

/**
 * Отбирает запрошенные поля из объекта задачи (VL-162, VL-260).
 *
 * Ключевой контракт: без неизвестных имён в ответе РОВНО запрошенные ключи
 * (в порядке fields); при неизвестных — они не прерывают вызов, а добавляют
 * в конец служебный ключ `_warning` (префикс `_` не конфликтует с ключами Task).
 */
function pickFields(obj: Record<string, unknown>, fields: unknown, validKeys: string[]): Record<string, unknown> {
  const { resolved, unknown } = resolveFields(fields, validKeys);
  const picked: Record<string, unknown> = {};
  for (const name of resolved) picked[name] = obj[name];
  if (unknown.length > 0) picked._warning = unknownFieldsWarning(unknown, validKeys);
  return picked;
}

/**
 * Отбирает поля из списка карточек: те же правила, что и pickFields, но предупреждение
 * одно на весь ответ (а не повторяется в каждой карточке) — VL-260.
 */
function pickFieldsList(
  items: Array<Record<string, unknown>>,
  fields: unknown,
  validKeys: string[],
): { picked: Array<Record<string, unknown>>; warning?: string } {
  const { resolved, unknown } = resolveFields(fields, validKeys);
  const picked = items.map((item) => {
    const one: Record<string, unknown> = {};
    for (const name of resolved) one[name] = item[name];
    return one;
  });
  return unknown.length > 0
    ? { picked, warning: unknownFieldsWarning(unknown, validKeys) }
    : { picked };
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
  const fields = args.fields;
  // Обратная совместимость: без fields или с пустым массивом — полное представление,
  // как и раньше (веб-оркестратор и фазовые промпты зовут без параметров — регрессия исключена)
  if (fields === undefined || (Array.isArray(fields) && fields.length === 0)) {
    return JSON.stringify(task, null, 2);
  }
  // VL-260: неизвестные поля не валят вызов — отбор общим хелпером (+ `_warning`)
  const picked = pickFields(task as unknown as Record<string, unknown>, fields, Object.keys(task));
  return JSON.stringify(picked, null, 2);
}

/**
 * Имя поля сущности → имя аргумента write-инструмента (VL-370).
 *
 * Неполнота считается в именах ПОЛЕЙ задачи (`implementationPlan`), а модель
 * передаёт АРГУМЕНТЫ (`plan`) — соответствие нужно, чтобы подсказка и готовый
 * повторный вызов были исполнимыми.
 */
const FIELD_TO_ARG: Record<string, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  labels: 'labels',
  acceptanceCriteria: 'acceptanceCriteria',
  definitionOfDone: 'definitionOfDone',
  implementationPlan: 'plan',
  implementationNotes: 'notes',
};

/** Поле сущности → имя аргумента инструмента (по умолчанию совпадает). */
function fieldToArg(field: string): string {
  return FIELD_TO_ARG[field] ?? field;
}

/**
 * Неполнота задачи по правилам её workflow и текущей фазы (VL-370).
 *
 * Единая точка для инструмента и для noop-подсказки: набор полей приходит из
 * DEFAULT_COMPLETENESS/`completeness` в settings, а не из списка популярных
 * полей в коде инструмента.
 */
function taskMissing(entity: Task, cwd: string, phase: string | null): CompletenessField[] {
  return taskCompletenessMissing(entity, getCompletenessRules(cwd, entity, phase).task);
}

/**
 * Слияние `modified_files`: существующие первыми, новые в конце, без дублей (VL-376).
 *
 * Причина: поле работало как полная замена, и повторный ран фазы (авто-resume
 * после падения, ручной перезапуск Code, повторный Close) затирал историю —
 * в VL-370 из 8 файлов остался 1. Последствия не косметические: `git_commit`
 * сверяет пути с этим списком и отклонял легитимные правки первого рана как
 * «чужие», а `backlog_search {modifiedFiles}` переставал находить задачу по
 * реально изменённым файлам.
 *
 * Пути обрезаются по пробелам, пустые отбрасываются (иначе мусорный путь
 * уехал бы в сверку коммита). Дедупликация — по точному совпадению строк:
 * синонимы путей (`./src/a.ts` и `src/a.ts`) сюда не сводятся.
 */
function mergeModifiedFiles(current: unknown, incoming: string[]): string[] {
  const base = Array.isArray(current) ? current.map(String) : [];
  const out: string[] = [];
  for (const raw of [...base, ...incoming]) {
    const filePath = String(raw).trim();
    if (filePath !== '' && !out.includes(filePath)) out.push(filePath);
  }
  return out;
}

/**
 * Сборка полей задачи из аргументов вызова (VL-369: вынесено из `toolUpdateTask`).
 *
 * Все валидации (`parentTaskId`, `parseAcList`, `type`) выполняются здесь и
 * бросают исключение ДО записи — пайплайн вызывает `build` до `write`.
 */
function buildTaskUpdates(args: ToolArgs, cwd: string, current: Task): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

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
  // VL-376: по умолчанию НАКОПЛЕНИЕ с дедупликацией; полная замена — явным
  // modifiedFilesReplace: true (исправление ошибочного пути).
  if (args.modifiedFiles !== undefined) {
    const files = args.modifiedFiles as string[];
    updates.modified_files = args.modifiedFilesReplace === true
      ? mergeModifiedFiles([], files)
      : mergeModifiedFiles(current.modified_files, files);
  }

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

  // append_notes — дописывает в конец существующих заметок (нужно текущее состояние)
  if (args.append_notes !== undefined) {
    updates.implementationNotes = (current.implementationNotes || '') +
      (current.implementationNotes ? '\n' : '') + (args.append_notes as string);
  }

  return updates;
}

/**
 * Описание сущности «задача» для общего пайплайна (VL-369).
 *
 * VL-370: неполнота — ДАННЫЕ (DEFAULT_COMPLETENESS + ключ `completeness` в
 * settings), считается от СОСТОЯНИЯ с учётом workflow задачи и текущей фазы.
 * Прежняя эвристика (`TASK_SUGGEST` + `isEmptyTaskField`, фильтр по «не
 * передано в args») удалена: она врала в обе стороны — заполненное поле
 * попадало в `missing` ложно, пустое не попадало вовсе.
 */
const taskSpec: EntitySpec<Task> = {
  name: 'Задача',
  fields: UPDATE_TASK_FIELDS,
  setFields: SET_FIELDS,
  // дописывание заметок всегда меняет файл — noop-сверка для него отключена
  nonIdempotent: ['append_notes'],
  missingIdMessage: 'Не передан id задачи (параметр "id").',
  notFoundMessage: id => `Задача ${id} не найдена.`,
  build: buildTaskUpdates,
  read: (cwd, id) => getTask(cwd, id) as Task | null,
  write: (cwd, id, updates) => updateTaskFile(cwd, id, updates as Partial<Task>),
  snapshot: entity => entity as unknown as Record<string, unknown>,
  // Чеклист сворачиваем до длины: полный массив раздувает ответ без пользы для агента
  applied: (entity, keys) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const value = (entity as unknown as Record<string, unknown>)[key];
      result[key] = key === 'acceptanceCriteria' && Array.isArray(value) ? value.length : value;
    }
    return result;
  },
  // Фаза — только доверенный источник (env рана/мета сессии), args.phase не читается
  resolvePhase: resolveGuardPhase,
  completeness: (entity, ctx) => taskMissing(entity, ctx.cwd, ctx.phase),
  // VL-413: только готовый образец аргументов — «что делать дальше» несёт
  // блок данных `phase`, а не прозаический hint.
  next: (_entity, missing) => {
    // Готовый образец вызова: имена ПОЛЕЙ задачи → имена АРГУМЕНТОВ инструмента
    const fields = missing.map(m => fieldToArg(m.field));
    return fields.length > 0
      ? { retryWith: Object.fromEntries(fields.map(f => [f, '…'])) }
      : {};
  },
  // VL-413: состояние фазы — из workflow и completeness (VL-410), данные.
  phaseState: (entity, ctx, missing) => taskPhaseState(entity, ctx, missing),
  message: (entity, keys) => `Задача ${entity.id} обновлена: ${keys.join(', ')}`,
};

/**
 * Обновляет статус задачи.
 *
 * VL-369: частный случай общего пайплайна (одно поле `status`); собственная
 * noop-ветка удалена — «статус уже такой» стало обычным noop-исходом.
 */
const statusSpec: EntitySpec<Task> = {
  name: 'Задача',
  fields: ['id', 'status', 'idempotencyKey'],
  setFields: [],
  missingIdMessage: 'Не передан id задачи (параметр "id").',
  notFoundMessage: id => `Задача ${id} не найдена.`,
  build: args => {
    // status — обязательный аргумент: без него операция не имеет смысла,
    // это испорченный аргумент (rejected), а не «нечего менять» (noop).
    if (typeof args.status !== 'string' || args.status.trim() === '') {
      throw new Error('Не передан status задачи (параметр "status").');
    }
    return { status: args.status as string };
  },
  read: (cwd, id) => getTask(cwd, id) as Task | null,
  write: (cwd, id, updates) => updateTaskFile(cwd, id, updates as Partial<Task>),
  snapshot: entity => entity as unknown as Record<string, unknown>,
  applied: (entity, keys) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = (entity as unknown as Record<string, unknown>)[key];
    return result;
  },
  phaseState: (entity, ctx, missing) => taskPhaseState(entity, ctx, missing),
  message: (entity, keys) => `Статус задачи ${entity.id} обновлён: ${entity.status}`,
};

function toolUpdateStatus(args: ToolArgs, cwd: string): string {
  return runUpdate(statusSpec, args, cwd);
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
 * VL-369: вся логика ответа (сверка «уже так», skipped, applied, missing,
 * тексты) вынесена в общий пайплайн `runUpdate`; здесь осталась декларация
 * различий (`taskSpec`).
 */
function toolUpdateTask(args: ToolArgs, cwd: string): string {
  return runUpdate(taskSpec, args, cwd);
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
      // VL-351: чтение отвечает тем же JSON-ack, что и запись. Раньше ветка
      // отдавала плоский текст, и цикл агента (страховка VL-306 «не-JSON ответ
      // write-инструмента = применено») помечал `action:list` ПРИМЕНЁННОЙ
      // записью — повтор чтения получал ложную директиву «уже применён ранее»
      // (сессия agent-1794047067509, Close VL-349). `applied.items` — снимок
      // прочитанного, `message` сохраняет прежний текст (на него опираются
      // тесты mcp-client/server).
      const items = list.map((item, i) => ({ index: i + 1, checked: item.checked, text: item.text }));
      if (list.length === 0) return ackRead('Чеклист пуст.', { items });
      const lines = list.map((item, i) => {
        const mark = item.checked ? '✓' : '○';
        return `${i + 1}. ${mark} ${item.text}`;
      });
      return ackRead(lines.join('\n'), { items });
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
        return ackOk(`Добавлено критериев: ${text.length} (${text.join(', ')})`, {
          added: [...text],
          total: list.length,
        });
      }
      list.push({ text: text as string, checked: false });
      updateTaskFile(cwd, args.id as string, { [field]: list });
      return ackOk(`Добавлен критерий #${list.length}: ${text}`, {
        added: [text],
        total: list.length,
      });
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
        return ackOk(
          checked
            ? `Отмечено пунктов: ${indexes.length} (${indexes.join(', ')})`
            : `Снято пунктов: ${indexes.length} (${indexes.join(', ')})`,
          { checked: indexes, action },
        );
      }
      return ackOk(
        checked
          ? `Отмечены критерии #${indexes.join(', #')}`
          : `Сняты отметки с критериев #${indexes.join(', #')}`,
        { checked: indexes, action },
      );
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
      if (batch) {
        return ackOk(`Удалено пунктов: ${indexes.length} (${indexes.join(', ')})`, {
          removed: indexes,
          total: list.length,
        });
      }
      return ackOk(`Удалены критерии #${indexes.join(', #')}`, {
        removed: indexes,
        total: list.length,
      });
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
 * Фаза, которой принадлежит текущий вызов MCP-инструмента (VL-245).
 *
 * Источники — только доверенные: env рана (оркестратор/CLI) и мета сессии.
 * `args.phase` НЕ используется: поле в схеме служит для учёта usage
 * (by_phase, VL-259) и передаётся моделью — если бы guard читал его, модель
 * выписывала бы себе разрешение на любой переход (phase: "close" → Done).
 *
 * Приоритет (как у фазы рана в CLI, VL-259): VIBELOG_RUN_PHASE → фаза сессии
 * (VIBELOG_PHASE_NAME, кроме служебного prompt) → meta.lastRunPhase → meta.phase.
 * Мета в branch-mode живёт в главном репо (VIBELOG_CWD, lesson-13).
 *
 * @returns имя фазы либо null, если фазу установить не удалось
 *   (инструмент из чужого клиента/ручной вызов) — тогда проверка перехода
 *   не применяется (fail-open, прежнее поведение по config.statuses).
 */
function resolveGuardPhase(cwd: string): string | null {
  const envRun = process.env.VIBELOG_RUN_PHASE;
  if (typeof envRun === 'string' && envRun.trim() !== '') return envRun;
  const envPhase = process.env.VIBELOG_PHASE_NAME;
  if (typeof envPhase === 'string' && envPhase.trim() !== '' && envPhase !== 'prompt') return envPhase;
  const sessionId = process.env.VIBELOG_SESSION_ID;
  if (!sessionId) return null;
  try {
    const meta = loadSessionMetaSync(agentSessionsDir(process.env.VIBELOG_CWD ?? cwd), sessionId);
    const metaPhase = meta?.lastRunPhase ?? meta?.phase;
    return typeof metaPhase === 'string' && metaPhase !== '' ? metaPhase : null;
  } catch {
    return null; // битая мета — фаза неизвестна, проверка не применяется
  }
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
  // ── VL-244: явный сигнал «фаза прервана» ───────────────────────────────
  // Флаг живёт в transient-кэше: MCP-сервер и процесс оркестратора разные,
  // record до оркестратора не доходит. Пишем ДО записи задачи: даже если
  // updateTaskFile ниже упадёт, finalizePhaseStatus увидит aborted и не
  // применит produces_status. Отсутствие записи кэша (служебная фаза или
  // транзиент не ставился) — не ошибка: статус и так никто не тронет,
  // isError не отдаём (иначе модель зациклится, lesson-92).
  let abortedPart = '';
  if (args.aborted === true) {
    const saved = markPhaseAborted(cwd, id, typeof args.comment === 'string' ? args.comment : undefined);
    abortedPart = saved
      ? 'aborted: фаза помечена прерванной (статус не применён)'
      : 'aborted: фаза вне транзиента (флаг не сохранён, статус не менялся)';
  }
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
      // ── VL-245: переход должен быть разрешён ФАЗОЙ workflow ─────────────
      // Статус валиден по конфигу, но менять его вправе только фаза, у которой
      // в workflow есть переход «текущий статус + фаза → запрошенный». Инцидент
      // VL-219/VL-231: служебная фаза comment выставила Done незавершённой
      // задаче, потому что проверялся лишь config.statuses.
      // Фаза не резолвится (ручной вызов MCP из чужого клиента) → fail-open:
      // прежние правила, иначе сломались бы все внешние интеграции.
      const guardPhase = resolveGuardPhase(cwd);
      const transitionError = guardPhase
        ? phaseStatusTransitionError(
            getWorkflowForTask(cwd, task),
            // В транзиенте задача в In Progress (VL-196) — база проверки это
            // статус ДО фазы, иначе штатные раны отклонялись бы
            getPhaseTransientStatus(cwd, id, guardPhase) ?? task.status,
            guardPhase,
            args.status,
          )
        : null;
      if (transitionError) {
        errors.push(transitionError);
      } else {
        updates.status = args.status;
        statusPart = `Статус: ${args.status}`;
      }
    }
  }

  // modifiedFiles — накопление с дедупликацией (как в toolUpdateTask, VL-376):
  // повторный ран фазы больше не стирает историю файлов
  if (args.modifiedFiles !== undefined) {
    if (!Array.isArray(args.modifiedFiles)) {
      errors.push('modifiedFiles — массив строк (например: ["src/a.ts"]).');
    } else {
      const files = args.modifiedFiles as string[];
      updates.modified_files = args.modifiedFilesReplace === true
        ? mergeModifiedFiles([], files)
        : mergeModifiedFiles(task.modified_files, files);
      // Сводка показывает ИТОГОВЫЙ размер: «файлов: 1» на задаче с 8 файлами
      // при накоплении вводило бы в заблуждение
      filesPart = `файлов: ${(updates.modified_files as string[]).length}`;
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

  // ── VL-248: терминальный статус при непройденных DoD ───────────────────
  // Инциденты VL-212/VL-219: задача закрывалась в Done с отмеченным DoD
  // «Тесты проходят» при красном полном прогоне. Теперь закрытие с
  // невыполненными пунктами возможно только с явным dodOverride и причиной.
  // Проверка идёт ДО любых записей (как жёсткая валидация VL-251): при отказе
  // файл задачи, комментарий и usage не трогаются — статус гарантированно
  // не меняется (AC1). Эффективный список DoD — с учётом dodChecks ЭТОГО
  // вызова: иначе «отмечу что есть» обходило бы требование.
  const effectiveDod = (updates.definitionOfDone ?? task.definitionOfDone ?? []) as ChecklistItem[];
  const uncheckedDod = effectiveDod
    .map((item, i) => ({ n: i + 1, checked: item.checked === true }))
    .filter((x) => !x.checked)
    .map((x) => x.n);
  const dodNumbers = uncheckedDod.map((n) => `#${n}`).join(', ');
  const overrideReason = typeof args.dodOverride === 'string' && args.dodOverride.trim() !== ''
    ? args.dodOverride.trim()
    : undefined;
  const workflow = getWorkflowForTask(cwd, task);
  // Жёсткое требование override — только к явно запрошенному терминальному
  // статусу: комментарий к уже закрытой задаче блокировать нельзя.
  const requestedTerminal = typeof updates.status === 'string' && isTerminalStatus(workflow, updates.status);
  // Предупреждение в сводке (AC3) — по итоговому статусу: валидный запрошенный
  // либо текущий (задача уже терминальная — напоминание без смены поведения).
  const resultingStatus = typeof updates.status === 'string' ? updates.status : task.status;
  const dodWarnPart = isTerminalStatus(workflow, resultingStatus) && uncheckedDod.length > 0
    ? `терминальный статус при непройденных DoD: ${dodNumbers}` +
      (overrideReason ? ` (override: ${overrideReason})` : '')
    : '';
  if (requestedTerminal && uncheckedDod.length > 0 && overrideReason === undefined) {
    // Текст ошибки называет следующий шаг явно — иначе модель зациклится на
    // повторе того же вызова (lesson-92). Сам термин «dodOverride» и имя поля
    // продублированы в description схемы.
    throw new Error(
      `Терминальный статус «${updates.status}» при невыполненных пунктах DoD: ${dodNumbers}. ` +
        'Статус НЕ изменён, файл задачи не тронут. Выбери одно из двух: ' +
        '(1) если задача закрывается с честно невыполненными пунктами — повтори вызов, добавив непустой dodOverride с причиной ' +
        '(она попадёт строкой «DoD override: …» в комментарий-отчёт фазы); ' +
        '(2) если работа не завершена — вызывай backlog_finish_phase с "aborted": true и БЕЗ status. ' +
        'Отмечай в dodChecks только реально выполненные пункты.',
    );
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
  let reportText = explicitComment ?? buildAutoReport(task, {
    // VL-372: `updates.status` выставляется только после успешной валидации и
    // проверки перехода фазой, поэтому в отчёт попадает ПРИМЕНЁННЫЙ статус;
    // отклонённый запрос виден пометкой `blockedTarget` (иначе отчёт утверждал
    // бы статус, который не был записан — класс VL-369).
    status: typeof updates.status === 'string' ? updates.status : task.status,
    blockedTarget: updates.status === undefined && typeof args.status === 'string' ? args.status : undefined,
    acChecked: acList.filter((c) => c.checked).length,
    acTotal: acList.length,
    dodChecked: dodList.filter((c) => c.checked).length,
    dodTotal: dodList.length,
    // VL-376: отчёт называет ИТОГОВЫЙ набор файлов (после накопления) —
    // иначе он снова ссылался бы на список, не соответствующий задаче
    files: (updates.modified_files as string[] | undefined) ?? (task.modified_files || []),
    // VL-304: неотмеченные пункты перечисляются явно — они не «висят молча»
    uncheckedAc: uncheckedItems(acList),
    uncheckedDod: uncheckedItems(dodList),
  });
  // VL-248: причина override обязательно фиксируется в комментарии-отчёте
  // фазы (AC2) — и для явного comment, и для авто-отчёта.
  if (overrideReason !== undefined) {
    reportText = `${reportText}\nDoD override: ${overrideReason}`;
  }
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
      : process.env.VIBELOG_RUN_PHASE
        ?? (process.env.VIBELOG_PHASE_NAME && process.env.VIBELOG_PHASE_NAME !== 'prompt'
          ? process.env.VIBELOG_PHASE_NAME
          : undefined);
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

  const summary = `${statusPart}; ${commentPart}${abortedPart ? `; ${abortedPart}` : ''}; отмечено AC: ${acCount}, DoD: ${dodCount}; ${filesPart}` +
    (dodWarnPart ? `; ${dodWarnPart}` : '') +
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

  // VL-310: noop-детекция — итоговый набор совпал с текущим (например,
  // `add` уже существующей зависимости). Раньше файл переписывался и ответ был
  // «обновлены», модель повторяла вызов в надежде на эффект.
  const before = [...(task.dependencies || [])];
  const unchanged = before.length === deps.length && before.every(d => deps.includes(d));
  if (unchanged) {
    // VL-413: неизменяющая запись — успех с перечнем неизменённых полей.
    return ackOk(
      `Изменений нет: зависимости задачи ${args.id} уже [${deps.join(', ')}].`,
      {},
      [],
      false,
      { unchanged: ['dependencies'] },
    );
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
  // VL-260: опциональный отбор полей карточки — общий хелпер с backlog_view_task
  if (args.fields !== undefined) {
    const { picked, warning } = pickFieldsList(
      simplified as unknown as Array<Record<string, unknown>>,
      args.fields,
      Object.keys(simplified[0] ?? {
        id: '', title: '', status: '', priority: '', type: '',
        project: '', labels: [], milestone: '',
      }),
    );
    return JSON.stringify(
      warning
        ? { found, returned: picked.length, tasks: picked, _warning: warning }
        : { found, returned: picked.length, tasks: picked },
      null,
      2,
    );
  }
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
  // VL-306: единый JSON-контракт write-инструментов (как backlog_update_task).
  // message сохраняет прежнюю формулировку — substring-проверки не ломаются.
  return ackOk(`Веха "${milestone.name}" создана.`, {
    name: milestone.name,
    description: milestone.description,
    due_date: milestone.due_date,
  });
}

function toolMilestoneRename(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const from = args.from as string;
  const to = args.to as string;
  // VL-310: noop-детекция — переименование в то же имя ничего не меняет.
  // Сравнение без регистра: renameMilestone ищет веху по lowercase.
  // Для остальных milestone-инструментов noop неприменим по природе: add
  // создаёт файл (повтор упадёт «уже существует»), archive/remove удаляют
  // (повтор упадёт «не найдена») — явный список-исключение в
  // write-ack-contract.test.mjs.
  if (String(from).toLowerCase() === String(to).toLowerCase()) {
    // VL-413: неизменяющая запись — успех, а не событие.
    return ackOk(
      `Изменений нет: веха «${from}» уже называется «${to}».`,
      {},
      [],
      false,
      { unchanged: ['from', 'to'] },
    );
  }
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
  // VL-306: JSON-ack; прежняя формулировка сохранена в message.
  return ackOk(`Веха переименована: ${args.from} → ${args.to}. Задач обновлено: ${updatedCount}`, {
    from,
    to,
    updated_tasks: updatedCount,
  });
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
  // VL-351: JSON-ack — плоский текст write-инструмента цикл агента не может
  // классифицировать (не applied/noop/failed), а до VL-351 страховка «не-JSON
  // = применено» давала ложный факт. Прежняя формулировка сохранена в message.
  return ackOk(`Веха "${args.name}" удалена. Задач обработано: ${updatedCount} (${handling})`, {
    name,
    task_handling: handling,
    updated_tasks: updatedCount,
  });
}

function toolMilestoneArchive(args: ToolArgs, cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  const archived = archiveMilestone(backlogDir, args.name as string);
  if (!archived) throw new Error(`Веха "${args.name}" не найдена.`);
  // VL-306: JSON-ack; прежняя формулировка сохранена в message.
  return ackOk(`Веха "${args.name}" архивирована.`, { name: args.name as string, status: 'archived' });
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
  // VL-351: JSON-ack — плоский текст write-инструмента цикл агента не может
  // классифицировать (не applied/noop/failed). Прежняя формулировка в message.
  // VL-357: отсутствие `content` — не отказ, а `partial` + `missing`. Документ
  // без тела создать можно (скелет), но модель обязана узнать, что он пуст:
  // молчаливое «создан» уводило её к следующему шагу с незаполненной сущностью.
  const contentRaw = args.content as string | undefined;
  const bodyEmpty = contentRaw === undefined || String(contentRaw).trim() === '';
  if (bodyEmpty) {
    return ackOkDetailed(
      `Документ ${doc.id} создан: ${doc.title} (тип: ${doc.type}) — тело не заполнено`,
      { id: doc.id, title: doc.title, type: doc.type },
      [],
      {
        missing: [{ field: 'content', reason: 'content не передан — тело документа пустое' }],
        // VL-413: готовый образец аргументов вместо прозаического hint.
        retryWith: { id: doc.id, content: '# …' },
      },
    );
  }
  return ackOk(`Документ ${doc.id} создан: ${doc.title} (тип: ${doc.type})`, {
    id: doc.id,
    title: doc.title,
    type: doc.type,
  });
}

/**
 * Поля документа, сравниваемые как множества (VL-310): порядок тегов не значим.
 */
const DOC_SET_FIELDS = ['tags'] as const;

/** Документ в терминах пайплайна: метаданные + тело (тело отдельно от frontmatter). */
interface DocumentEntity {
  document: DocumentEntry['document'];
  body: string;
  path: string;
}

function requireBacklogDirOrThrow(cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден.');
  return backlogDir;
}

/**
 * Описание сущности «документ» для общего пайплайна (VL-369).
 */
const documentSpec: EntitySpec<DocumentEntity> = {
  name: 'Документ',
  // `full_replace` — управляющий флаг guard'а (VL-399), а не поле документа:
  // в updates он не попадает, но обязан быть в fields, иначе уйдёт в skipped
  // как «неизвестное поле» и ответ начнёт врать.
  fields: ['id', 'title', 'content', 'type', 'tags', 'full_replace', 'idempotencyKey'],
  setFields: DOC_SET_FIELDS,
  // В аргументах тело называется content, в снимке — BODY_FIELD (см. sameValue)
  bodyArg: 'content',
  missingIdMessage: 'Не передан id документа (параметр "id").',
  notFoundMessage: id => `Документ ${id} не найден.`,
  build: args => {
    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title as string;
    if (args.content !== undefined) updates.content = args.content as string;
    if (args.type !== undefined) updates.type = args.type as string;
    if (args.tags !== undefined) updates.tags = args.tags as string[];
    return updates;
  },
  read: (cwd, id) => getDocument(requireBacklogDirOrThrow(cwd), id) as DocumentEntity | null,
  write: (cwd, id, updates) =>
    updateDocument(requireBacklogDirOrThrow(cwd), id, updates as UpdateDocumentInput) as DocumentEntity | null,
  // VL-310: тело лежит не в метаданных, а в `entry.body` — сверяется под BODY_FIELD
  snapshot: entity => ({
    ...(entity.document as unknown as Record<string, unknown>),
    [BODY_FIELD]: entity.body,
  }),
  // applied: id есть всегда, тело сворачиваем до длины (полный markdown раздувает ответ).
  // VL-399: плюс размеры тела до/после и маркер усечения — потеря объёма должна
  // быть видна в ответе инструмента, а не только в git-диффе (инцидент doc-10:
  // ответ «Документ обновлён» при падении тела с 60 КБ до 1 КБ).
  applied: (entity, keys, _via, previous) => {
    const result: Record<string, unknown> = { id: entity.document.id };
    const bodyAfter = String(entity.body).length;
    for (const key of keys.filter(k => k !== 'id')) {
      result[key] = key === 'content' ? bodyAfter : (entity.document as unknown as Record<string, unknown>)[key];
    }
    // Размеры имеют смысл только когда тело переписывалось.
    if (keys.includes('content')) {
      const bodyBefore = previous !== undefined ? String(previous.body).length : bodyAfter;
      result.bodyLengthBefore = bodyBefore;
      result.bodyLengthAfter = bodyAfter;
      result.truncated = bodyAfter < bodyBefore;
    }
    return result;
  },
  // VL-399: guard против молчаливой потери тела. Переданный content — ПОЛНАЯ
  // замена; если он заметно короче текущего тела и не сохраняет его начала,
  // это с высокой вероятностью «модель прислала только правимый фрагмент».
  // Отказ, а не предупреждение: молчаливое применение уже стоило документа.
  // Выход — либо document_edit (точечно), либо full_replace: true (осознанно).
  beforeWrite: (args, _updates, current) => {
    if (args.content === undefined || args.full_replace === true) return null;
    const check = contentShrinkCheck(current.body, String(args.content));
    if (!check.suspicious) return null;
    const id = current.document.id;
    return {
      message:
        `content — ПОЛНАЯ замена тела документа ${id}: ${check.bodyLengthAfter} симв. вместо ` +
        `${check.bodyLengthBefore} (сокращение ${check.shrinkPercent}%), начало текущего текста не сохранено. ` +
        'Ничего не записано.',
      hint:
        'Точечная правка — document_edit {"id","old_string","new_string"} ' +
        '(old_string берётся дословно из document_view). ' +
        'Осознанная полная замена — тот же document_update с full_replace: true.',
      retryWith: { id, content: args.content, full_replace: true },
    };
  },
  // Тело документа необязательно по смыслу (см. PARTIAL_EXEMPT в контракт-тесте)
  completeness: () => [],
  message: (entity, keys) => `Документ ${entity.document.id} обновлён: ${entity.document.title}`,
};

/**
 * Обновление документа: поля и/или тело (VL-369 — общий пайплайн).
 */
function toolDocumentUpdate(args: ToolArgs, cwd: string): string {
  return runUpdate(documentSpec, args, cwd);
}

function toolDocumentEdit(args: ToolArgs, cwd: string): string {
  const backlogDir = requireBacklogDirOrThrow(cwd);
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) throw new Error('Не передан id документа (параметр "id").');
  const oldString = args.old_string;
  const newString = args.new_string;
  // Пустой old_string превратил бы замену в «вставку между всеми символами»
  // (split('') разваливает тело на буквы) — это испорченный аргумент.
  if (typeof oldString !== 'string' || oldString === '') {
    throw new Error('old_string пустой: точечная правка без искомого текста невозможна.');
  }
  if (typeof newString !== 'string') {
    throw new Error('Не передан new_string (параметр "new_string").');
  }
  const entry = getDocument(backlogDir, id);
  if (!entry) throw new Error(`Документ ${id} не найден.`);
  const before = entry.body;
  const replaceAll = args.replace_all === true;
  const result = applyBodyEdit(before, oldString, newString, replaceAll);

  if (!result.ok) {
    // Отказ ДО записи: файл остаётся байт-в-байт прежним (AC2).
    if (result.reason === 'not_found') {
      return ackErrorDetailed(
        `old_string не найден в теле документа ${id} (тело ${before.length} симв.). Ничего не записано. ` +
          'Проверь точный текст: document_view {"id":"' + id + '"}. ' +
          'Возможно, документ восстановлен из git и текст в нём другой.',
        {
          hint:
            'Скопируй фрагмент из ответа document_view дословно (включая отступы и переносы строк) ' +
            'и повтори document_edit с ним в old_string.',
          retryWith: { id, old_string: oldString, new_string: newString },
        },
      );
    }
    return ackErrorDetailed(
      `old_string встречается ${result.count} раз(а) в теле документа ${id}: уточни текст ` +
        '(добавь соседнюю строку как контекст) или передай replace_all: true. Ничего не записано.',
      {
        hint: 'Двусмысленная правка не применяется: одна и та же строка в нескольких местах — добавь контекст.',
        retryWith: { id, old_string: oldString, new_string: newString, replace_all: true },
      },
    );
  }

  // old_string === new_string (или замена на тот же текст): файл не переписываем —
  // это noop по природе, а не применение (VL-303/lesson-92).
  if (result.body === before) {
    // VL-413: неизменяющая запись — успех с перечнем неизменённых полей.
    return ackOk(
      'Изменений нет: old_string и new_string дают тот же текст.',
      {},
      [],
      false,
      { unchanged: ['old_string', 'new_string'] },
    );
  }

  const written = updateDocument(backlogDir, id, { content: result.body });
  if (!written) throw new Error(`Документ ${id} не найден.`);
  const after = written.body.length;
  return ackOk(`Документ ${id} обновлён: заменено вхождений — ${result.replaced}`, {
    id,
    replaced: result.replaced,
    bodyLengthBefore: before.length,
    bodyLengthAfter: after,
    truncated: after < before.length,
  });
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
  // VL-291: список ссылок = url + urls (порядок сохраняется: он же порядок
  // секций склеенного кэша). writeReference/createReference нормализуют
  // (trim, дедуп) и продвигают первую ссылку в поле url.
  const urls: string[] = [];
  if (typeof args.url === 'string' && args.url.trim()) urls.push(args.url.trim());
  if (Array.isArray(args.urls)) {
    for (const u of args.urls as unknown[]) {
      const value = String(u ?? '').trim();
      if (value) urls.push(value);
    }
  }
  const ref = writeReference(cwd, {
    title: args.title as string,
    type: args.type as string,
    url: urls[0],
    urls,
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
      cacheMessage = '\nДля cache=true нужен url (или urls).';
    } else {
      const res = await cacheReference(cwd, ref);
      // VL-291: частичный успех виден по префиксу «частичный успех» в сообщении
      cacheMessage = '\n' + res.message;
    }
  }
  const linksInfo = (ref.urls?.length || 0) > 0 ? `, ссылок: ${1 + (ref.urls?.length || 0)}` : '';
  // VL-351: JSON-ack (см. toolDocumentCreate).
  // VL-357: не переданное описание — `partial` + missing, а не молчаливый
  // успех: reference без описания остаётся «ссылкой без пояснения», и модель
  // должна узнать это из ответа, а не из повторного чтения.
  const descriptionRaw = args.description as string | undefined;
  const descriptionEmpty = descriptionRaw === undefined || String(descriptionRaw).trim() === '';
  if (descriptionEmpty) {
    return ackOkDetailed(
      `Reference ${ref.id} создан: ${ref.title} (${ref.type}${linksInfo}) — описание не заполнено${cloneMessage}${cacheMessage}`,
      { id: ref.id, title: ref.title, type: ref.type },
      [],
      {
        missing: [{ field: 'description', reason: 'description не передан — тело reference пустое' }],
        // VL-413: готовый образец аргументов вместо прозаического hint.
        retryWith: { id: ref.id, description: '…' },
      },
    );
  }
  return ackOk(`Reference ${ref.id} создан: ${ref.title} (${ref.type}${linksInfo})${cloneMessage}${cacheMessage}`, {
    id: ref.id,
    title: ref.title,
    type: ref.type,
  });
}

function toolReferenceView(args: ToolArgs, cwd: string): string {
  const entry = getReference(cwd, args.id as string);
  if (!entry) throw new Error(`Reference ${args.id} не найден.`);
  // Локальный markdown-кэш (VL-194): если есть — Plan-фаза читает его и не
  // делает web_fetch; поле отсутствует (null) → прежний fallback на url
  const cachedMarkdown = readReferenceCache(cwd, entry.reference);
  return JSON.stringify({
    ...entry.reference,
    // VL-291: полный упорядоченный список ссылок (url + urls) — одна точка
    // правды для вызывающего, порядок = порядок секций кэша
    urls_all: referenceUrls(entry.reference),
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
  // VL-351: JSON-ack (см. toolDocumentCreate).
  return ackOk(`Reference ${args.id} удалён (клон в data/ сохранён).`, { id: args.id });
}

/**
 * Поля reference, сравниваемые как множества (VL-310): порядок тегов не значим.
 */
const REFERENCE_SET_FIELDS = ['tags', 'linked_tasks'] as const;

/** Reference в терминах пайплайна: метаданные + тело (тело отдельно от frontmatter). */
interface ReferenceEntity {
  reference: Reference;
  body: string;
  path: string;
}

/**
 * Поля, сверяемые не «как есть» (VL-310/VL-369):
 * - description → тело записи (BODY_FIELD) — делает пайплайн по `bodyArg`;
 * - url/urls → полный упорядоченный набор ссылок: после нормализации первый
 *   url выкидывается из urls (normalizeExtraUrls), а порядок набора значим
 *   (он же порядок секций склеенного кэша).
 */
function referenceComparable(
  updates: Record<string, unknown>,
  current: ReferenceEntity,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const comparable = { ...base };
  delete comparable.url;
  delete comparable.urls;
  if (updates.url !== undefined || updates.urls !== undefined) {
    const baseUrl = updates.url !== undefined ? String(updates.url) : current.reference.url;
    const rest = updates.urls !== undefined
      ? (updates.urls as unknown[])
      : current.reference.urls;
    const seen = new Set<string>();
    const merged: string[] = [];
    if (baseUrl) { merged.push(baseUrl); seen.add(baseUrl); }
    for (const raw of rest || []) {
      const value = String(raw ?? '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      merged.push(value);
    }
    comparable.__urls = merged;
  }
  return comparable;
}

/**
 * Описание сущности «reference» для общего пайплайна (VL-369).
 */
const referenceSpec: EntitySpec<ReferenceEntity> = {
  name: 'Reference',
  fields: ['id', 'tags', 'description', 'url', 'urls', 'idempotencyKey'],
  setFields: REFERENCE_SET_FIELDS,
  // MCP-параметр description → UpdateReferenceInput.content (VL-164)
  bodyArg: 'description',
  missingIdMessage: 'Не передан id reference (параметр "id").',
  notFoundMessage: id => `Reference ${id} не найден.`,
  build: args => {
    const updates: Record<string, unknown> = {};
    if (args.tags !== undefined) updates.tags = args.tags as string[];
    if (args.description !== undefined) updates.content = args.description as string;
    // VL-291: набор ссылок (полная замена переданных полей); urls: [] очищает
    if (args.url !== undefined) updates.url = String(args.url);
    if (args.urls !== undefined) updates.urls = (args.urls as unknown[]).map(u => String(u));
    return updates;
  },
  read: (cwd, id) => getReference(cwd, id) as ReferenceEntity | null,
  write: (cwd, id, updates) => updateReference(cwd, id, updates as UpdateReferenceInput) as ReferenceEntity | null,
  snapshot: entity => ({
    ...(entity.reference as unknown as Record<string, unknown>),
    [BODY_FIELD]: entity.body,
    __urls: referenceUrls(entity.reference),
  }),
  comparable: referenceComparable,
  applied: (entity, keys) => {
    const result: Record<string, unknown> = { id: entity.reference.id };
    for (const key of keys.filter(k => k !== 'id')) {
      if (key === 'description' || key === 'content') {
        result[key] = String(entity.body).length;
      } else if (key === 'urls') {
        result[key] = referenceUrls(entity.reference);
      } else {
        result[key] = (entity.reference as unknown as Record<string, unknown>)[key];
      }
    }
    return result;
  },
  // Тело reference необязательно по смыслу (см. PARTIAL_EXEMPT в контракт-тесте)
  completeness: () => [],
  message: (entity, keys) => `Reference ${entity.reference.id} обновлён: ${keys.join(', ')}`,
};

// VL-164: обновление меты reference; MCP-параметр description → UpdateReferenceInput.content
// VL-369: общий пайплайн, декларация различий — `referenceSpec`.
function toolReferenceUpdate(args: ToolArgs, cwd: string): string {
  return runUpdate(referenceSpec, args, cwd);
}

function toolReferenceLink(args: ToolArgs, cwd: string): string {
  const action = (args.action as 'add' | 'remove') || 'add';
  const referenceId = args.referenceId as string;
  const taskId = args.taskId as string;
  // VL-310: noop-детекция — связь уже есть (add) или уже удалена (remove).
  // Связь живёт в ДВУХ местах (reference.linked_tasks ↔ task.references),
  // поэтому сверяются обе стороны: расхождение означает, что запись реально
  // что-то чинит, и noop был бы ложью.
  const refEntry = getReference(cwd, referenceId);
  const taskEntry = getTask(cwd, taskId);
  if (refEntry && taskEntry) {
    const inRef = (refEntry.reference.linked_tasks || []).includes(taskId);
    const inTask = (taskEntry.references || []).includes(referenceId);
    const upToDate = action === 'add' ? inRef && inTask : !inRef && !inTask;
    if (upToDate) {
      // VL-413: неизменяющая запись — успех, а не событие.
      return ackOk(
        `Изменений нет: связь Reference ${referenceId} ↔ задача ${taskId} уже ` +
          `${action === 'add' ? 'установлена' : 'удалена'}.`,
        {},
        [],
        false,
        { unchanged: ['referenceId', 'taskId', 'action'] },
      );
    }
  }
  linkReferenceTask(cwd, referenceId, taskId, action);
  // VL-351: JSON-ack (см. toolDocumentCreate) — плоский текст write-инструмента
  // цикл агента не классифицирует (не applied/noop/failed).
  return ackOk(
    action === 'add'
      ? `Reference ${args.referenceId} связан с задачей ${args.taskId} (linked_tasks ↔ task.references).`
      : `Связь Reference ${args.referenceId} ↔ задача ${args.taskId} удалена.`,
    { referenceId, taskId, action },
  );
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
    // VL-291: явный статус вместо разбора подстрок сообщения; partial —
    // часть ссылок не скачалась, это не полный успех → в failed с текстом
    if (res.status === 'updated') single.updated.push(entry.reference.id);
    else if (res.status === 'failed' || res.status === 'partial') single.failed.push({ id: entry.reference.id, error: res.message });
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

/**
 * Склейка тела урока из трёх аргументов (VL-379).
 *
 * Почему: `content` — одна большая экранированная строка markdown (`\n`, `##`),
 * и слабая модель физически не вставляет её в JSON: формулировала намерение и
 * снова отправляла вызов без поля (сессия agent-1794146250210 — 4 дословных
 * повтора `lesson_update` → кап → fail). Три обычные строки генерируются так
 * же надёжно, как `title`/`description` у `backlog_create_task`.
 *
 * `example` необязателен: не у каждого урока есть пример, обязательность
 * заставляла бы выдумывать. Раздел «## Пример» опускается, если он пуст.
 */
function lessonBodyFromParts(problem: string, solution: string, example?: string): string {
  const parts = [
    '## Проблема', String(problem).trim(), '',
    '## Решение', String(solution).trim(), '',
  ];
  if (example !== undefined && String(example).trim() !== '') {
    parts.push('## Пример', String(example).trim());
  }
  return parts.join('\n');
}

/** Причина попадания `content` в `skipped` (VL-379: поле удалено из схем). */
const LESSON_CONTENT_REMOVED =
  'поле удалено: передай problem и solution (markdown-тело сервер склеит сам)';

/** Допустимые аргументы `lesson_create` (для `skipped`). */
const LESSON_CREATE_FIELDS = [
  'title', 'status', 'tags', 'sourceTasks', 'problem', 'solution', 'example', 'idempotencyKey',
] as const;

function toolLessonCreate(args: ToolArgs, cwd: string): string {
  // VL-379: тело передаётся частями (problem/solution/example) — markdown
  // склеивает сервер. Урок без тела MCP-путём больше не создаётся: скелет
  // (LESSON_BODY_SKELETON) остаётся только у CLI-пути
  // (`vibelog lesson create` без `-d`), где сидит человек и может сохранить
  // черновик. Отказ здесь обязателен, потому что inputSchema.required НЕ
  // валидируется сервером (server.ts::handleToolsCall вызывает handleToolCall
  // без проверки схемы) — required влияет только на генерацию моделью.
  const problem = args.problem as string | undefined;
  const solution = args.solution as string | undefined;
  const missingParts: string[] = [];
  if (problem === undefined || String(problem).trim() === '') missingParts.push('problem');
  if (solution === undefined || String(solution).trim() === '') missingParts.push('solution');
  const skipped = unknownFields(args, LESSON_CREATE_FIELDS).map(entry =>
    entry.field === 'content' ? { field: entry.field, reason: LESSON_CONTENT_REMOVED } : entry,
  );
  if (missingParts.length > 0) {
    return ackErrorDetailed(
      `Lesson не создан: не передано тело урока (${missingParts.join(', ')}). ` +
        'Тело передаётся обычными строками problem и solution (плюс необязательный example) — ' +
        'markdown с заголовками «## Проблема / ## Решение / ## Пример» склеит сервер. Файл урока не создан.',
      {
        missing: missingParts.map(field => ({
          field,
          reason: 'обязательный аргумент тела урока не передан — урок без тела не создаётся',
        })),
        hint: 'Передай problem и solution обычным текстом (без markdown-разметки), example — если есть.',
        retryWith: { ...LESSON_BODY_TEMPLATE },
      },
    );
  }
  const lesson = createLessonFile(cwd, {
    title: args.title as string,
    tags: (args.tags as string[] | undefined) || [],
    source_tasks: (args.sourceTasks as string[] | undefined) || [],
    content: lessonBodyFromParts(problem as string, solution as string, args.example as string | undefined),
  });
  // VL-319/VL-349: JSON-ack с длиной фактического тела (после записи).
  const entry = getLesson(cwd, lesson.id);
  const applied = {
    id: lesson.id,
    title: lesson.title,
    status: lesson.status,
    content: entry ? entry.body.length : 0,
  };
  return ackOk(`Lesson ${lesson.id} создан: ${lesson.title} (${lesson.status})`, applied, skipped);
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

/**
 * VL-379: каркас тела урока для `retryWith` — три обычные строки.
 *
 * Раньше здесь была одна строка с markdown (`## Проблема\n\n…`) — именно та
 * форма, которую модель не может вставить в JSON. Теперь каркас повторяет
 * форму аргументов: `{problem, solution, example}` с плейсхолдерами в угловых
 * скобках (модель обычно их заменяет).
 */
const LESSON_BODY_TEMPLATE = {
  problem: '<что было не так>',
  solution: '<что сделали>',
  example: '<конкретный пример>',
};

/** VL-379: hint при незаполненном теле — передать problem и solution. */
const LESSON_BODY_HINT =
  'Заполни тело урока: передай problem (что было не так) и solution (что сделали) обычным текстом, ' +
  'example — если есть. Замени плейсхолдеры из retryWith, не копируй их дословно.';

/** Урок в терминах пайплайна: метаданные + тело (тело отдельно от frontmatter). */
interface LessonEntity {
  lesson: Lesson;
  body: string;
  path: string;
}

/**
 * Описание сущности «урок» для общего пайплайна (VL-369).
 *
 * Здесь и только здесь остаётся специфика урока: тело обязательно по смыслу
 * (пустое тело означало урок, созданный шаблоном без `content`). Раньше это
 * было ЧЕТЫРЬМЯ ветками состояния в `toolLessonUpdate` (~160 строк), каждая
 * компенсировала предыдущую: отказ → отказ блокирует привязку → создаём
 * заглушку → заглушка не отличается от заполненной → предикат блокирует всё.
 *
 * Теперь специфика — один хук `beforeWrite` (проверка АРГУМЕНТА: явно пустое
 * тело недопустимо) плюс `completeness` (свойство СУЩНОСТИ: тело не заполнено).
 * Незаполненное тело никогда не даёт отказ — только `missing` + готовый вызов.
 */
const lessonSpec: EntitySpec<LessonEntity> = {
  name: 'Lesson',
  // VL-379: тело приходит ЧАСТЯМИ (problem/solution/example), а `content`
  // удалён из схемы. Два способа передать одно и то же — та же «двойная форма»,
  // что вычищалась в VL-369: модель выберет худший, как выбирала `content` все
  // шесть предыдущих попыток.
  fields: [
    'id', 'title', 'status', 'tags', 'sourceTasks', 'linkedTasks', 'supersedes',
    'lastVerified', 'verifiedBy', 'appliesTo', 'kind', 'problem', 'solution', 'example',
    'idempotencyKey',
  ],
  setFields: ['tags', 'source_tasks', 'linked_tasks', 'applies_to'],
  // В ядре тело по-прежнему называется `content` (UpdateLessonInput) — на этом
  // держится noop-сверка тела (`comparableKey` → BODY_FIELD).
  bodyArg: 'content',
  removedFields: { content: LESSON_CONTENT_REMOVED },
  missingIdMessage: 'Не передан id урока (параметр "id").',
  notFoundMessage: id => `Lesson ${id} не найден.`,
  build: args => {
    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title as string;
    if (args.status !== undefined) updates.status = args.status as string;
    if (args.tags !== undefined) updates.tags = args.tags as string[];
    if (args.sourceTasks !== undefined) updates.source_tasks = args.sourceTasks as string[];
    if (args.linkedTasks !== undefined) updates.linked_tasks = args.linkedTasks as string[];
    if (args.supersedes !== undefined) updates.supersedes = args.supersedes as string;
    // VL-279: поля аудита (additive)
    if (args.lastVerified !== undefined) updates.last_verified = args.lastVerified as string;
    if (args.verifiedBy !== undefined) updates.verified_by = args.verifiedBy as string;
    if (args.appliesTo !== undefined) updates.applies_to = args.appliesTo as string[];
    if (args.kind !== undefined) updates.kind = (args.kind as string) || null;
    // VL-379: markdown склеивает сервер — модель передаёт три обычные строки.
    // Семантика прежнего `content` сохранена: problem+solution — ПОЛНАЯ замена
    // тела; example дописывается третьим разделом, если непустой.
    if (args.problem !== undefined && args.solution !== undefined) {
      updates.content = lessonBodyFromParts(
        args.problem as string, args.solution as string, args.example as string | undefined,
      );
    }
    return updates;
  },
  read: (cwd, id) => getLesson(cwd, id) as LessonEntity | null,
  write: (cwd, id, updates) => updateLesson(cwd, id, updates as UpdateLessonInput) as LessonEntity | null,
  snapshot: entity => ({
    ...(entity.lesson as unknown as Record<string, unknown>),
    [BODY_FIELD]: entity.body,
  }),
  // Тело сворачиваем до длины: полный markdown раздувает ответ без пользы.
  // VL-379: аргументы problem/solution/example в сущности не хранятся — они
  // сворачиваются в то же `content` (длина фактического тела), один ключ.
  applied: (entity, keys) => {
    const result: Record<string, unknown> = {};
    const bodyLength = String(entity.body).length;
    for (const key of keys) {
      result[key] = key === 'content' || key === 'problem' || key === 'solution' || key === 'example'
        ? bodyLength
        : (entity.lesson as unknown as Record<string, unknown>)[key];
    }
    return result;
  },
  // VL-319/VL-349/VL-370/VL-379: неполнота — свойство СУЩНОСТИ, набор полей
  // приходит из данных (DEFAULT_COMPLETENESS / ключ `completeness`). Новые
  // уроки неполными быть не могут по конструкции (problem/solution обязательны
  // в схеме и проверяются сервером), предикат нужен только для накопленных
  // скелетов. Поле в `missing` — `problem`: именно его теперь передают.
  completeness: (entity, ctx) => {
    // Урок не имеет типа задачи → его работой считается workflow `default`
    const fields = getCompletenessFields(ctx.cwd, 'default', ctx.phase, 'lesson');
    if (!fields.includes('content') || !isLessonBodyUnfilled(entity.body)) return [];
    return [{
      field: 'problem',
      reason: entity.body.trim() === ''
        ? 'тело урока пустое — передай problem и solution'
        : 'тело урока — дефолтный скелет, не заполнено по смыслу — передай problem и solution',
    }];
  },
  // VL-379: не текст требования, а ГОТОВЫЙ образец аргументов — форма та же,
  // что у модели в схеме (три строки, без markdown и `\n`).
  next: () => ({ retryWith: { ...LESSON_BODY_TEMPLATE } }),
  message: (entity, keys, via) =>
    via === 'partial'
      ? `Lesson ${entity.lesson.id} обновлён: ${keys.join(', ')} (тело урока всё ещё не заполнено)`
      : `Lesson ${entity.lesson.id} обновлён: ${keys.join(', ')} (updated_date: ${entity.lesson.updated_date})`,
  // Единственный хук специфики: испорченный АРГУМЕНТ тела, а не свойство
  // состояния (VL-319). Файл не перезаписывается. VL-379: проверяются части —
  // problem и solution передаются вместе и непустыми; example без них смысла
  // не имеет (тело не собирается).
  beforeWrite: args => {
    const hasProblem = args.problem !== undefined;
    const hasSolution = args.solution !== undefined;
    const hasExample = args.example !== undefined;
    if (!hasProblem && !hasSolution) {
      if (hasExample) {
        return {
          message:
            'example без problem и solution не применяется: тело урока собирается из problem и solution. ' +
            'Файл урока не изменён.',
          missing: [{ field: 'problem', reason: 'example передан без problem/solution — тело не собрать' }],
          hint: 'Передай problem (что было не так) и solution (что сделали) вместе с example.',
          retryWith: { ...LESSON_BODY_TEMPLATE },
        };
      }
      return null;
    }
    const emptyParts: string[] = [];
    if (!hasProblem || String(args.problem).trim() === '') emptyParts.push('problem');
    if (!hasSolution || String(args.solution).trim() === '') emptyParts.push('solution');
    if (emptyParts.length > 0) {
      return {
        message:
          `Пустое или неполное тело урока недопустимо: не передано ${emptyParts.join(', ')}. ` +
          'Передай problem и solution обычным текстом — файл урока не изменён.',
        missing: emptyParts.map(field => ({
          field,
          reason: 'тело урока заменяется целиком — нужны и problem, и solution',
        })),
        hint: 'Передай problem (что было не так) и solution (что сделали); example — если есть.',
        retryWith: { ...LESSON_BODY_TEMPLATE },
      };
    }
    return null;
  },
};

/**
 * Обновление урока (VL-369: общий пайплайн, специфика — в `lessonSpec`).
 *
 * Четыре ветки состояния удалены. Таблица исходов одна для всех сущностей:
 * записали × полная → applied / partial / noop (+missing) / rejected (только
 * испорченный аргумент). Незаполненное тело НИКОГДА не даёт отказ.
 */
function toolLessonUpdate(args: ToolArgs, cwd: string): string {
  return runUpdate(lessonSpec, args, cwd);
}


function toolLessonSearch(args: ToolArgs, cwd: string): string {
  const entries = searchLessons(cwd, args.query as string);
  return JSON.stringify(entries.map(e => e.lesson), null, 2);
}

function toolLessonLink(args: ToolArgs, cwd: string): string {
  const action = (args.action as 'add' | 'remove') || 'add';
  const lessonId = args.lessonId as string;
  const taskId = args.taskId as string;
  // VL-310: noop-детекция (симметрия с reference_link): связь живёт в двух
  // местах (lesson.linked_tasks ↔ task.lessons), сверяются обе стороны.
  const lessonEntry = getLesson(cwd, lessonId);
  const taskEntry = getTask(cwd, taskId);
  if (lessonEntry && taskEntry) {
    const inLesson = (lessonEntry.lesson.linked_tasks || []).includes(taskId);
    const inTask = (taskEntry.lessons || []).includes(lessonId);
    const upToDate = action === 'add' ? inLesson && inTask : !inLesson && !inTask;
    if (upToDate) {
      // VL-413: неизменяющая запись — успех, а не событие.
      return ackOk(
        `Изменений нет: связь Lesson ${lessonId} ↔ задача ${taskId} уже ` +
          `${action === 'add' ? 'установлена' : 'удалена'}.`,
        {},
        [],
        false,
        { unchanged: ['lessonId', 'taskId', 'action'] },
      );
    }
  }
  linkLesson(cwd, lessonId, taskId, action);
  // VL-306: JSON-ack; прежняя формулировка сохранена в message.
  return ackOk(
    action === 'add'
      ? `Lesson ${args.lessonId} связан с задачей ${args.taskId} (linked_tasks ↔ task.lessons).`
      : `Связь Lesson ${args.lessonId} ↔ задача ${args.taskId} удалена.`,
    { lessonId: args.lessonId as string, taskId: args.taskId as string, action },
  );
}

function toolLessonSupersede(args: ToolArgs, cwd: string): string {
  supersedeLesson(cwd, args.oldId as string, args.newId as string);
  // VL-306: JSON-ack; прежняя формулировка сохранена в message.
  return ackOk(
    `Lesson ${args.newId} заменяет ${args.oldId} (${args.oldId} → superseded, ${args.newId} → active).`,
    { oldId: args.oldId as string, newId: args.newId as string, old_status: 'superseded', new_status: 'active' },
  );
}

/**
 * lesson_audit (VL-279): механический аудит актуальности уроков.
 *
 * Границы слоя (lesson-34): типы аргументов валидируются здесь — не-число в
 * threshold/staleDays не роняет ядро TypeError'ом, а даёт явный текст;
 * не-массив в verified/needsReview игнорируется. Записи выполняются только
 * по переданным ID: без них инструмент read-only (AC9).
 */
function toolLessonAudit(args: ToolArgs, cwd: string): string {
  const threshold = args.threshold;
  const staleDays = args.staleDays;
  if (threshold !== undefined && (typeof threshold !== 'number' || !(threshold > 0) || threshold > 1)) {
    return 'Ошибка: поле "threshold" должно быть числом в диапазоне (0, 1].';
  }
  if (staleDays !== undefined && (typeof staleDays !== 'number' || !(staleDays > 0))) {
    return 'Ошибка: поле "staleDays" должно быть положительным числом.';
  }
  const asIdList = (value: unknown): string[] => (
    Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : []
  );
  const verified = asIdList(args.verified);
  const needsReview = asIdList(args.needsReview);

  const report = auditLessons(cwd, {
    ...(typeof threshold === 'number' ? { duplicateThreshold: threshold } : {}),
    ...(typeof staleDays === 'number' ? { staleDays } : {}),
  });

  let auditPath: string | null = null;
  if (args.write === true) {
    const backlogDir = findBacklogDir(cwd);
    if (backlogDir) {
      auditPath = join(lessonsDir(backlogDir), 'AUDIT.md');
      writeFileSync(auditPath, formatLessonAuditMarkdown(report), 'utf-8');
    }
  }

  const applied = (verified.length > 0 || needsReview.length > 0)
    ? applyLessonAudit(cwd, {
      ...(verified.length > 0 ? { verified } : {}),
      ...(needsReview.length > 0 ? { needsReview } : {}),
    })
    : null;

  // JSON-безопасный кап вывода (lesson-30): сообщения находок (message)
  // опускаем — они дублируют details и раздувают JSON на сотни байт каждая;
  // при нехватке места убираем избыточную byLesson (findings её дублируют),
  // но никогда не режем строку — обрезанный JSON ломает разбор.
  const compactFindings = report.findings.map(f => ({
    type: f.type, lessonId: f.lessonId, details: f.details,
  }));
  // VL-319: byLesson тоже компактим (без message — он дублирует details):
  // новые находки empty_body раздували payload, и byLesson выпадал из ответа
  // целиком, хотя группировка нужна потребителям (CLI/веб-чат).
  const compactByLesson = report.byLesson.map(group => ({
    id: group.id,
    title: group.title,
    status: group.status,
    findings: group.findings.map(f => ({ type: f.type, details: f.details })),
  }));
  const buildPayload = (includeByLesson: boolean): string => JSON.stringify({
    total: report.total,
    config: report.config,
    summary: report.summary,
    ...(includeByLesson ? { byLesson: compactByLesson } : {}),
    findings: compactFindings,
    ...(auditPath ? { written_to: auditPath } : {}),
    ...(applied ? { applied } : {}),
  }, null, 2);

  const full = buildPayload(true);
  return full.length <= 20000 ? full : buildPayload(false);
}

/**
 * lesson_consolidate (VL-400): консолидация корпуса lessons.
 *
 * Границы слоя (lesson-34): типы аргументов валидируются здесь — не-число в
 * threshold и не-массив в supersede/appendAgentsMd дают явный текст ошибки,
 * а не TypeError из ядра. Read-only по умолчанию (AC5): план строится всегда,
 * записи — только по переданным спискам ID/строк (паттерн lesson_audit,
 * lesson-147). Вывод капится: план на 274 уроках с десятками пар дублей
 * раздувается, поэтому при превышении бюджета отдаём сводку без titles.
 */
function toolLessonConsolidate(args: ToolArgs, cwd: string): string {
  const threshold = args.threshold;
  if (threshold !== undefined && (typeof threshold !== 'number' || !(threshold > 0) || threshold > 1)) {
    return 'Ошибка: поле "threshold" должно быть числом в диапазоне (0, 1].';
  }
  const asList = (value: unknown, field: string): string[] | string => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return `Ошибка: поле "${field}" должно быть массивом строк.`;
    return value.map(v => String(v).trim()).filter(Boolean);
  };
  const supersede = asList(args.supersede, 'supersede');
  if (typeof supersede === 'string') return supersede;
  const appendAgentsMd = asList(args.appendAgentsMd, 'appendAgentsMd');
  if (typeof appendAgentsMd === 'string') return appendAgentsMd;

  const plan = buildConsolidationPlan(cwd, {
    ...(typeof threshold === 'number' ? { duplicateThreshold: threshold } : {}),
  });

  const applied = (supersede.length > 0 || appendAgentsMd.length > 0)
    ? applyConsolidation(cwd, {
      ...(supersede.length > 0 ? { supersede } : {}),
      ...(appendAgentsMd.length > 0 ? { appendAgentsMd } : {}),
    })
    : null;

  const buildPayload = (includeTitles: boolean): string => JSON.stringify({
    total: plan.total,
    summary: plan.summary,
    ruleClusters: plan.ruleClusters.map(c => ({
      id: c.id,
      tags: c.tags,
      lessons: c.lessons,
      canonical: c.canonical,
      proposedLine: c.proposedLine,
      supersede: c.supersede,
      ...(includeTitles ? { titles: c.titles } : {}),
    })),
    duplicatePairs: plan.duplicatePairs,
    emptyBodies: plan.emptyBodies,
    ...(applied ? { applied } : {}),
  }, null, 2);

  const full = buildPayload(true);
  return full.length <= 20000 ? full : buildPayload(false);
}

/**
 * lesson_classify (VL-280): LLM-классификация уроков + техдолг из workaround'ов.
 * Границы слоя (lesson-34): типы аргументов валидируются здесь — не-массив в
 * ids/tags/confirmIds/createClusters игнорируется с явным текстом ошибки,
 * не-число в limit/maxTasks не роняет ядро. Ничего не пишется без явного
 * подтверждения (AC3/AC5): apply/confirmIds — для kind, createClusters — для
 * задач техдолга. Ошибки LLM по отдельным урокам попадают в отчёт (AC9),
 * а не бросают исключение наружу.
 */
async function toolLessonClassify(args: ToolArgs, cwd: string): Promise<string> {
  const bad = (msg: string): string => `Ошибка: ${msg}`;
  const limit = args.limit;
  if (limit !== undefined && (typeof limit !== 'number' || !(limit > 0))) {
    return bad('поле "limit" должно быть положительным числом.');
  }
  const maxTasks = args.maxTasks;
  if (maxTasks !== undefined && (typeof maxTasks !== 'number' || !(maxTasks > 0))) {
    return bad('поле "maxTasks" должно быть положительным числом.');
  }
  if (args.status !== undefined && typeof args.status !== 'string') {
    return bad('поле "status" должно быть строкой.');
  }
  if (args.apply !== undefined && typeof args.apply !== 'boolean') {
    return bad('поле "apply" должно быть boolean.');
  }
  const asList = (value: unknown): string[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
    return value.map(v => String(v).trim()).filter(Boolean);
  };
  const ids = asList(args.ids);
  const tags = asList(args.tags);
  const confirmIds = asList(args.confirmIds);
  const createClusters = asList(args.createClusters);
  if (ids === null) return bad('поле "ids" должно быть массивом строк.');
  if (tags === null) return bad('поле "tags" должно быть массивом строк.');
  if (confirmIds === null) return bad('поле "confirmIds" должно быть массивом строк.');
  if (createClusters === null) return bad('поле "createClusters" должно быть массивом строк.');

  // Модель: дефолтная из settings (AC «модель для классификации» — дефолт
  // проекта, отдельная дешёвая модель не вводится: лишняя настройка без
  // подтверждённой пользы).
  let client;
  try {
    client = createLlmClient({ cwd });
  } catch (err) {
    return bad(`LLM-клиент не создан: ${(err as Error).message}`);
  }

  const report = await classifyLessons(cwd, {
    ...(ids.length > 0 ? { ids } : {}),
    ...(typeof args.status === 'string' ? { status: args.status } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(args.apply === true ? { apply: true } : {}),
    ...(confirmIds.length > 0 ? { confirmIds } : {}),
    ...(createClusters.length > 0 ? { createClusters } : {}),
    ...(typeof maxTasks === 'number' ? { maxTasks } : {}),
  }, async (prompt) => {
    const response = await client.streamChat([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ], undefined);
    return response.text;
  });

  // JSON-кап вывода (lesson-30): тела цитат и полные черновики описаний в
  // ответ не кладём — только заголовки/ID, чтобы чат не получал мегабайты;
  // при нехватке места убираем черновики целиком (кластеры их дублируют).
  const buildPayload = (includeDrafts: boolean): string => JSON.stringify({
    total: report.total,
    summary: report.summary,
    classifications: report.classifications,
    applied: report.applied,
    clusters: report.clusters,
    ...(includeDrafts ? { drafts: report.drafts } : {}),
    ...(report.creation ? { creation: report.creation } : {}),
  }, null, 2);

  const full = buildPayload(true);
  return truncateToolOutput(full.length <= 20000 ? full : buildPayload(false));
}

/**
 * Карта проекта (VL-235): обёртка над buildProjectMap.
 *
 * Валидация аргументов — на границе слоя (lesson-34): не-строки в query/dir
 * превращаются в явную ошибку-текст, а не TypeError из ядра; `limit` не-число
 * игнорируется (дефолт ядра). Вывод капится truncateToolOutput — единая точка
 * ограничения размера tool-вывода (lesson-30).
 */
/**
 * Репорт бага в upstream-проект (VL-363, VL-375).
 *
 * Ветвится по `upstream.mode`: `git` (по умолчанию) — отчёт в git-инбокс
 * (`core/upstream-git.ts`), `api` — issue в GitVerse Issues.
 *
 * Ответ — JSON-ack по контракту VL-306. Для git-транспорта: успех
 * `{ok:true, applied:{report_id, path, target, created}, message}`,
 * идемпотентный повтор — `created:false` (отчёт уже был).
 * Токен/пути ошибок в ответ не попадают вне текстов ядра.
 */
async function toolUpstreamReportBug(args: ToolArgs, cwd: string): Promise<string> {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (title === '') {
    return ackErrorDetailed('поле title обязательно: заголовок отчёта не может быть пустым', {
      hint: 'передай title — короткое описание проблемы, например «install: файл компонента не копируется»',
    });
  }
  // VL-375: инструмент скрыт из tools/list без валидной секции upstream, но
  // устаревший кэш списка у клиента может всё ещё звать его напрямую. Тогда
  // отвечаем actionable-ошибкой, а не «Неизвестный инструмент» (AC8).
  if (!isUpstreamConfigured(cwd)) {
    return ackErrorDetailed('upstream не настроен — репорт отправлять некуда', {
      hint:
        'добавь секцию upstream в .vibelog/settings.json: {"mode": "git", "inbox": ' +
        '"git@gitverse.ru:owner/inbox.git", "prefix": "<префикс>"} либо {"mode": "api", "repo": "owner/name"}',
    });
  }
  const labels = Array.isArray(args.labels)
    ? (args.labels as unknown[]).filter((l): l is string => typeof l === 'string')
    : undefined;

  return reportBug(cwd, {
    title,
    ...(typeof args.body === 'string' ? { body: args.body } : {}),
    ...(typeof args.severity === 'string' ? { severity: args.severity } : {}),
    ...(typeof args.area === 'string' ? { area: args.area } : {}),
    ...(typeof args.source_task === 'string' ? { sourceTask: args.source_task } : {}),
    ...(typeof args.target === 'string' ? { target: args.target } : {}),
    ...(labels !== undefined ? { labels } : {}),
  })
    .then((result) => {
      if (result.mode === 'git') {
        const message = result.created
          ? `Отчёт ${result.reportId.slice(0, 8)} записан в инбокс: ${result.path}`
          : `Отчёт ${result.reportId.slice(0, 8)} уже был в инбоксе: ${result.path}`;
        return ackOk(message, {
          report_id: result.reportId,
          path: result.path,
          target: result.target,
          created: result.created,
        });
      }
      const createdNote =
        result.createdLabels.length > 0 ? ` (созданы метки: ${result.createdLabels.join(', ')})` : '';
      return ackOk(
        `Issue #${result.number} создан: ${title}${createdNote}`,
        { number: result.number, url: result.url, labels: result.labels },
      );
    })
    .catch((err: unknown) => {
      if (err instanceof UpstreamGitError) {
        return ackErrorDetailed(err.message, { hint: err.kind === 'auth' ? 'проверь права на репозиторий-инбокс' : undefined });
      }
      if (err instanceof GitverseError) {
        return ackErrorDetailed(err.message, { hint: err.kind === 'no_token' ? tokenHint() : undefined });
      }
      return ackError(err instanceof Error ? err.message : String(err));
    });
}

/** Подсказка «как настроить upstream» — общая для всех трёх upstream-инструментов (VL-391). */
function upstreamConfigHint(): string {
  return (
    'добавь секцию upstream в .vibelog/settings.json: {"mode": "git", "inbox": ' +
    '"git@gitverse.ru:owner/inbox.git", "prefix": "<префикс>"} либо {"mode": "api", "repo": "owner/name"}'
  );
}

/**
 * Проверка «upstream настроен и это git-транспорт» для инструментов приёма (VL-391).
 *
 * @returns текст ack-ошибки либо null, если можно продолжать
 */
function assertUpstreamGit(cwd: string, action: string): string | null {
  if (!isUpstreamConfigured(cwd)) {
    return ackErrorDetailed(`upstream не настроен — ${action} недоступен`, { hint: upstreamConfigHint() });
  }
  // Без настроенного config разрешать чтение бессмысленно, но и падать
  // невнятной ошибкой нельзя: входящих отчётов в API-режиме не существует
  // (API — отправка в чужой трекер), поэтому говорим об этом прямо.
  if (resolveUpstreamMode(cwd) === 'api') {
    return ackErrorDetailed(
      `upstream.mode: "api" — ${action} доступен только в mode: "git" (входящих отчётов в API-режиме нет)`,
      {
        hint:
          'git-инбокс — единственный транспорт приёма отчётов: переведи секцию upstream на ' +
          '{"mode": "git", "inbox": "<URL репозитория-инбокса>", "prefix": "<префикс>"}',
      },
    );
  }
  return null;
}

/** Режим upstream из настроек (`'api'` только при явном mode: api, иначе git). */
function resolveUpstreamMode(cwd: string): 'git' | 'api' {
  try {
    const raw = loadSettings(cwd).upstream;
    if (raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).mode === 'api') return 'api';
  } catch {
    // битые настройки — считаем git (ошибку всё равно отдаст resolveUpstreamConfig)
  }
  return 'git';
}

/** Краткое представление отчёта для списка (полное тело — по report_id). */
function reportSummary(report: UpstreamReport): Record<string, unknown> {
  return {
    report_id: report.report_id,
    source_project: report.source_project,
    source_task: report.source_task,
    title: report.title,
    target: report.target,
    severity: report.severity,
    area: report.area,
    created: report.created,
    status: report.status,
    ...(report.accepted_as !== '' ? { accepted_as: report.accepted_as } : {}),
    ...(report.rejected_reason !== '' ? { rejected_reason: report.rejected_reason } : {}),
  };
}

/**
 * Входящие отчёты об ошибках от других проектов (VL-391).
 *
 * Без `report_id` — список для своего префикса (только `open`, если не передан
 * `include_resolved`); с `report_id` — полное тело одного отчёта.
 */
async function toolUpstreamListReports(args: ToolArgs, cwd: string): Promise<string> {
  const denied = assertUpstreamGit(cwd, 'список входящих отчётов');
  if (denied !== null) return denied;
  try {
    const cfg = resolveUpstreamConfig(cwd);
    if (cfg.mode !== 'git') {
      // Двойная страховка: assertUpstreamGit уже отсекает api-режим
      return ackErrorDetailed('список входящих доступен только в mode: "git"');
    }
    ensureInboxClone(cwd, cfg);
    const id = typeof args.report_id === 'string' ? args.report_id.trim() : '';
    if (id !== '') {
      const found = findIncomingReport(cwd, cfg.prefix, id);
      if (found === null) {
        return ackErrorDetailed(`отчёт с report_id «${id}» не найден в инбоксе`, {
          hint: 'вызови upstream_list_reports без report_id — полный список входящих даёт точный id',
        });
      }
      return ackRead(`Отчёт ${found.report.report_id.slice(0, 8)} — ${found.report.title}`, {
        report: { ...reportSummary(found.report), body: found.report.body },
        path: found.path,
      });
    }
    const includeResolved = args.include_resolved === true;
    const reports = listIncoming(cwd, cfg.prefix, includeResolved ? { includeResolved } : {});
    const message = reports.length === 0
      ? `Входящих отчётов для «${cfg.prefix}» нет${includeResolved ? '' : ' (показаны только open)'}`
      : `Входящих отчётов: ${reports.length}`;
    return ackRead(message, { prefix: cfg.prefix, count: reports.length, reports: reports.map(reportSummary) });
  } catch (err) {
    return upstreamErrorAck(err);
  }
}

/** Находит отчёт по id/префиксу среди входящих своего префикса (для чтения тела). */
function findIncomingReport(
  cwd: string,
  prefix: string,
  id: string,
): { path: string; report: UpstreamReport } | null {
  const needle = id.toLowerCase();
  if (needle.length < MIN_REPORT_ID_PREFIX) {
    throw new UpstreamGitError(
      `report_id «${id}» слишком короткий: нужно не меньше ${MIN_REPORT_ID_PREFIX} символов`,
      'config',
    );
  }
  const root = join(inboxPath(cwd), REPORTS_DIR);
  const matches: Array<{ path: string; report: UpstreamReport }> = [];
  if (!existsSync(root)) return null;
  for (const dirEntry of readdirSync(root, { withFileTypes: true })) {
    if (!dirEntry.isDirectory()) continue;
    const dir = join(root, dirEntry.name);
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      try {
        const report = parseReport(readFileSync(join(dir, file.name), 'utf-8'));
        if (!targetMatches(report.target, prefix)) continue;
        if (report.report_id.toLowerCase().startsWith(needle)) {
          matches.push({ path: `${REPORTS_DIR}/${dirEntry.name}/${file.name}`, report });
        }
      } catch {
        // битый файл не должен ломать чтение по id
      }
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new UpstreamGitError(
      `report_id «${id}» совпал с ${matches.length} отчётами — уточни id: ` +
        matches.map((m) => `${m.report.report_id} (${m.report.source_task})`).join(', '),
      'config',
    );
  }
  return matches[0]!;
}

/** Единый разбор ошибок upstream в JSON-ack для инструментов приёма. */
function upstreamErrorAck(err: unknown): string {
  if (err instanceof UpstreamGitError) {
    return ackErrorDetailed(err.message, {
      hint: err.kind === 'auth' ? 'проверь права на репозиторий-инбокс' : undefined,
    });
  }
  if (err instanceof GitverseError) {
    return ackErrorDetailed(err.message, { hint: err.kind === 'no_token' ? tokenHint() : undefined });
  }
  return ackError(err instanceof Error ? err.message : String(err));
}

/**
 * Приём или отклонение входящего отчёта (VL-391).
 *
 * Автосоздания задач НЕТ — принципиально: решение принимает человек в диалоге,
 * инструмент только фиксирует. `accept` требует СУЩЕСТВУЮЩУЮ задачу в этом
 * проекте (`getTask`), закрывая класс дефекта VL-388 для MCP-пути.
 */
async function toolUpstreamAckReport(args: ToolArgs, cwd: string): Promise<string> {
  const denied = assertUpstreamGit(cwd, 'приём отчётов');
  if (denied !== null) return denied;
  const id = typeof args.report_id === 'string' ? args.report_id.trim() : '';
  if (id === '') {
    return ackErrorDetailed('поле report_id обязательно', {
      hint: 'вызови upstream_list_reports — он вернёт report_id входящих отчётов',
    });
  }
  const action = typeof args.action === 'string' ? args.action.trim() : '';
  if (action !== 'accept' && action !== 'reject') {
    return ackErrorDetailed('поле action: ожидалось "accept" или "reject"', {
      hint: 'accept — принять отчёт со ссылкой на задачу (task_id), reject — отклонить с причиной (reason)',
    });
  }

  try {
    const cfg = resolveUpstreamConfig(cwd);
    if (cfg.mode !== 'git') {
      return ackErrorDetailed('приём отчётов доступен только в mode: "git" (в API-режиме входящих нет)');
    }

    if (action === 'accept') {
      const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
      if (taskId === '') {
        return ackErrorDetailed('для action: "accept" обязателен task_id — ID задачи в этом проекте', {
          hint: 'создай задачу через backlog_create_task и передай её ID, либо свяжи отчёт с уже существующей',
        });
      }
      // VL-391 AC3: существование задачи проверяется ДО записи — иначе в отчёт
      // уедет ссылка на несуществующую задачу (класс дефекта VL-388).
      const task = getTask(cwd, taskId);
      if (task === null) {
        return ackErrorDetailed(`задача ${taskId} не найдена в этом проекте — отчёт не изменён`, {
          hint: 'создай задачу через backlog_create_task и передай её ID в task_id',
          missing: [{ field: 'task_id', reason: 'задача не существует в backlog получателя' }],
        });
      }
      ensureInboxClone(cwd, cfg);
      const result = ackReport(cwd, id, { action: 'accept', taskId });
      // Обратная ссылка: задача узнаёт, какой отчёт она закрывает (иначе связь
      // живёт только в инбоксе, и задача остаётся без контекста).
      addComment(
        cwd,
        task.id,
        `Принят отчёт ${result.report.report_id.slice(0, 8)} из проекта ${result.report.source_project} ` +
          `(задача ${result.report.source_task}). Файл: ${result.path}`,
      );
      return ackOk(
        `Отчёт ${result.report.report_id.slice(0, 8)} принят и связан с задачей ${task.id}`,
        {
          report_id: result.report.report_id,
          path: result.path,
          status: result.report.status,
          accepted_as: result.report.accepted_as,
          task_id: task.id,
        },
      );
    }

    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (reason === '') {
      return ackErrorDetailed('для action: "reject" обязателен reason — причина отказа', {
        hint: 'причина попадает в отчёт: без неё отправитель не поймёт, что делать',
      });
    }
    ensureInboxClone(cwd, cfg);
    const result = ackReport(cwd, id, { action: 'reject', reason });
    return ackOk(`Отчёт ${result.report.report_id.slice(0, 8)} отклонён: ${reason}`, {
      report_id: result.report.report_id,
      path: result.path,
      status: result.report.status,
      rejected_reason: result.report.rejected_reason,
    });
  } catch (err) {
    return upstreamErrorAck(err);
  }
}

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
