/**
 * Декларативный вид MCP-инструментов: read / write / mixed (VL-357, шаг 2).
 *
 * Зачем отдельный модуль-таблица, а не эвристика по имени: классификация по
 * маркерам в имени (`manage`, `add`, `list`) ошибалась по построению — токен
 * `manage` делал `backlog_manage_dod {action:'list'}` записью, веб-чат требовал
 * Allow/Deny на чтение, а цикл агента считал ответ чтения «применённой
 * записью» и повтор получал ложную директиву «уже применено» (VL-351, сессия
 * agent-1794047067509). Теперь вид операции ОБЪЯВЛЕН рядом с инструментом:
 * новый инструмент без строки в таблице ловится тестом паритета
 * (`src/core/tool-classify.test.mjs` сверяет таблицу с `listTools()`).
 *
 * Таблица лежит в core (а не рядом с реестром), потому что классификатор
 * `isWriteOperation` нужен и веб-слою (approval-gate), и агенту, а core не
 * должен тянуть `src/mcp/tools.ts` (там llm, оркестратор, fs). Модуль —
 * чистые данные без импортов.
 *
 * `mixed` — операция зависит от аргументов (`backlog_manage_*`: `action:list`
 * читает, `action:add` пишет). Резолюция mixed в классификаторе: без
 * аргументов — write (fail-safe: подтверждение лучше молчаливой записи),
 * с аргументами — по действию.
 */

import type { ToolKind } from './tool-classify.js';

/**
 * Вид каждого MCP-инструмента реестра (`listTools()`).
 *
 * `read` — без побочных эффектов; `write` — пишет; `mixed` — зависит от
 * аргументов (см. `MIXED_READ_ACTIONS`).
 */
export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  // === Задачи ===
  backlog_create_task: 'write',
  backlog_list_tasks: 'read',
  backlog_view_task: 'read',
  backlog_update_status: 'write',
  backlog_update_task: 'write',
  // VL-351/VL-357: action:list — чтение, action:add/check/... — запись
  backlog_manage_ac: 'mixed',
  backlog_manage_dod: 'mixed',
  backlog_add_comment: 'write',
  backlog_update_dependencies: 'write',
  backlog_search: 'read',
  backlog_ready: 'read',
  // === Вехи ===
  milestone_list: 'read',
  milestone_add: 'write',
  milestone_rename: 'write',
  milestone_remove: 'write',
  milestone_archive: 'write',
  // === Документы ===
  document_list: 'read',
  document_view: 'read',
  document_create: 'write',
  document_update: 'write',
  // VL-399: точечная правка тела документа — запись (нужно подтверждение)
  document_edit: 'write',
  document_search: 'read',
  // === Фазы ===
  backlog_finish_phase: 'write',
  // === References ===
  reference_list: 'read',
  reference_add: 'write',
  reference_view: 'read',
  reference_search: 'read',
  reference_remove: 'write',
  reference_update: 'write',
  reference_link: 'write',
  reference_sync: 'write',
  // === Lessons ===
  lesson_list: 'read',
  lesson_create: 'write',
  lesson_view: 'read',
  lesson_update: 'write',
  lesson_search_lessons: 'read',
  lesson_link: 'write',
  lesson_supersede: 'write',
  // audit/classify по умолчанию read-only (записи — только по явному
  // verified/needsReview или apply/confirmIds): поведение до VL-357 сохраняем
  lesson_audit: 'read',
  lesson_classify: 'read',
  // VL-400: консолидация — план по умолчанию, записи только по явным спискам
  lesson_consolidate: 'read',
  // === Прочее ===
  project_map: 'read',
  git_commit: 'write',
  // VL-363: репорт бага в upstream-репозиторий через GitVerse Issues — сетевой write
  upstream_report_bug: 'write',
  // VL-391: приём входящих отчётов: список — read, accept/reject — write
  upstream_list_reports: 'read',
  upstream_ack_report: 'write',
  // === Супервизор (VL-268) ===
  backlog_trigger_phase: 'write',
  backlog_phase_status: 'read',
  backlog_auto_queue: 'write',
  backlog_supervisor: 'write',
  // === Конструктор workflow (VL-398) ===
  workflow_get: 'read',
  workflow_apply: 'write',
};

/**
 * Вид операции для MCP-инструмента по имени.
 *
 * @returns объявленный вид либо `undefined` (имя вне реестра — локальный
 *   файловый инструмент агента, внешний MCP-сервер, новое имя до объявления)
 */
export function toolKindOf(name: string): ToolKind | undefined {
  return TOOL_KINDS[name];
}
