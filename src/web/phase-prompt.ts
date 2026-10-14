/**
 * Сборка промптов фаз (VL-85): общий модуль оркестратора и CLI vibelog-agent.
 *
 * Логика вынесена из src/web/orchestrator.ts без изменений: шаблоны
 * templates/qwen-commands/phase-*.md + подстановка {{taskId}}/{{key}}.
 * Вынесено, чтобы CLI агента переиспользовал сборку промпта, не таща
 * за собой оркестратор (spawn, поллинг, activeRuns). Путь к шаблонам
 * вычисляется от расположения модуля: dist/web/phase-prompt.js →
 * ../../templates/qwen-commands/ (та же глубина, что была у orchestrator.js).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTask } from '../core/store.js';
import { loadConfig } from '../core/config.js';
import { loadLessonsForTask } from '../core/lesson.js';
import type { ChecklistItem, Task } from '../core/task.js';

/** Допустимые фазы. */
export const PHASES = ['spec', 'plan', 'code', 'close', 'comment', 'prompt', 'analyze', 'reject'] as const;
export type Phase = (typeof PHASES)[number];

/** Шаблон промпта для каждой фазы. */
const PHASE_FILES: Record<Phase, string> = {
  spec: 'phase-1.md',
  plan: 'phase-2.md',
  code: 'phase-3.md',
  close: 'phase-close.md',
  comment: 'phase-comment.md',
  prompt: 'prompt.md',
  // VL-141: фаза analyze — headless-разбор сессии агента без задачи (как prompt)
  analyze: 'phase-analyze.md',
  reject: 'reject.md',
};

/** Отдельный шаблон close-фазы для задач, работающих в worktree (VL-112). */
const CLOSE_WORKTREE_FILE = 'phase-close-worktree.md';

/**
 * Путь к headless-промптам. Вычисляется от расположения модуля
 * (dist/web/phase-prompt.js → ../../templates/qwen-commands/), как webDistDir:
 * команда vibelog browser запускается в репозитории пользователя.
 */
const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url));

/** Опции сборки промпта (VL-112). */
export interface RenderPromptOptions {
  /** Фаза close задачи, работающей в worktree: отдельный шаблон с merge-шагом ветки. */
  closeWorktree?: boolean;
}

/**
 * Собирает промпт фазы: шаблон + подстановка {{taskId}}.
 *
 * @param phase — spec | plan | code | close | comment | prompt | analyze | reject
 * @param taskId — ID задачи, например VL-28; для analyze может быть '' (без задачи)
 * @param extraVars — доп. подстановки {{key}} -> value ({{comment}} для comment, {{prompt}} для prompt, {{sessionId}} и др. для analyze)
 * @param opts — опции (VL-112: closeWorktree — close задачи с worktree → отдельный шаблон)
 * @throws Error при неизвестной фазе или отсутствующем шаблоне
 */
export function renderPrompt(
  phase: string,
  taskId: string,
  extraVars?: Record<string, string>,
  opts?: RenderPromptOptions
): string {
  if (!PHASES.includes(phase as Phase)) {
    throw new Error(`Неизвестная фаза: ${phase} (ожидается spec|plan|code|close|comment|prompt|analyze|reject)`);
  }
  // VL-112: close задачи с worktree сливает ветку из главного репо — отдельный шаблон
  const fileName = phase === 'close' && opts?.closeWorktree ? CLOSE_WORKTREE_FILE : PHASE_FILES[phase as Phase];
  const templatePath = join(templatesDir, fileName);
  let template: string;
  try {
    template = readFileSync(templatePath, 'utf-8');
  } catch {
    throw new Error(`Шаблон промпта не найден: ${templatePath}`);
  }
  let prompt = template.replaceAll('{{taskId}}', taskId);
  if (extraVars) {
    for (const [key, value] of Object.entries(extraVars)) {
      prompt = prompt.replaceAll('{{' + key + '}}', value);
    }
  }
  return prompt;
}

/** Элемент чеклиста AC/DoD: объект ChecklistItem либо готовая строка формата `- [ ] #N ...`. */
type ChecklistEntry = ChecklistItem | string;

/**
 * Нумерованный список чеклиста для подстановки в промпт фазы (VL-137).
 *
 * Объекты приводятся к виду `N. [x] Текст` / `N. [ ] Текст`; строки-форматы
 * хранения нумеруются как есть (в них чекбокс уже есть).
 *
 * @returns '' для пустого списка — в шаблоне читается как «(нет)»
 */
export function formatChecklist(items: ChecklistEntry[] | undefined): string {
  if (!items || items.length === 0) return '(нет)';
  return items
    .map((item, i) =>
      typeof item === 'string' ? `${i + 1}. ${item}` : `${i + 1}. [${item.checked ? 'x' : ' '}] ${item.text}`
    )
    .join('\n');
}

/**
 * Подбирает подстановки полей задачи для первого промпта фазы (VL-137).
 *
 * Задача читается getTask ОДИН раз на фазу — агенту не нужен первый
 * backlog_view_task ради title/type/описания/плана/AC/DoD/статуса/файлов.
 *
 * Решение (Pavel, комментарий к VL-137): фолбэк-инструкции «неподставленные
 * {{...}} → прочитай через MCP» в шаблонах НЕТ — если задача не читается на
 * уровне кода, фаза вообще не должна запускаться (пустой блок промпт не исправит).
 *
 * @returns фиксированный набор ключей при успехе; null — задача не найдена
 *   или файл битый (ошибка парсинга приравнивается к «не найдена»)
 */
export function taskExtraVars(cwd: string, taskId: string): Record<string, string> | null {
  let task: Task | null;
  try {
    task = getTask(cwd, taskId);
  } catch {
    return null;
  }
  if (!task) return null;
  const last = task.comments.length > 0 ? task.comments[task.comments.length - 1] : null;
  // Порядок ключей фиксирован: renderPrompt заменяет значения по порядку
  // replaceAll — длинные тексты (description/plan) идут первыми, чтобы
  // редкий случай литерала {{...}} внутри них гасился последующими ключами
  return {
    taskDescription: task.description || '(нет)',
    taskPlan: task.implementationPlan || '(нет)',
    taskAC: formatChecklist(task.acceptanceCriteria),
    taskDoD: formatChecklist(task.definitionOfDone),
    taskModifiedFiles: task.modified_files.length > 0 ? task.modified_files.join(', ') : '(нет)',
    taskLastComment: last ? `${last.author} (${last.created}): ${last.text}` : '(нет комментариев)',
    // VL-152: references задачи (внешние источники) — Plan читает их, Code дописывает
    taskReferences: task.references && task.references.length > 0 ? task.references.join(', ') : '(нет)',
    // VL-153: lessons learned по tags задачи — Plan читает их без дополнительного
    // MCP-вызова. Ошибка чтения (нет backlog, битый lesson-файл) → '(нет)':
    // фаза не должна падать из-за отсутствия lessons.
    taskLessons: (() => {
      try {
        const lessons = loadLessonsForTask(cwd, taskId);
        return lessons.length > 0 ? lessons.join('\n') : '(нет)';
      } catch {
        return '(нет)';
      }
    })(),
    // VL-154: labels из backlog/config.yml — Spec классифицирует задачу по
    // готовому списку, не тратя ход на backlog_config. Любая ошибка чтения
    // конфига (нет backlog, нет config.yml, битый YAML) → пустая строка:
    // фаза не должна падать из-за отсутствующих labels
    availableLabels: (() => {
      try {
        const labels = loadConfig(cwd).labels;
        return Array.isArray(labels) ? labels.join(', ') : '';
      } catch {
        return '';
      }
    })(),
    taskTitle: task.title,
    taskType: task.type || '(не определён)',
    taskStatus: task.status,
  };
}

/**
 * Компактный блок состояния задачи для промпта resume (VL-137).
 *
 * Resume идёт по сырому тексту без renderPrompt — минимальный контекст
 * задачи (заголовок/тип/статус/последний комментарий) конкатенируется к
 * promptText, чтобы модель не тратила MCP-вызов на восстановление контекста
 * при «Продолжи».
 *
 * @returns '' если задача не найдена/не читается — resume существующей
 *   сессии не должен падать из-за пропажи файла задачи
 */
export function taskBlockText(cwd: string, taskId: string): string {
  let task: Task | null;
  try {
    task = getTask(cwd, taskId);
  } catch {
    return '';
  }
  if (!task) return '';
  const lines = [
    `Задача ${task.id}: ${task.title} (тип: ${task.type || 'не определён'}, статус: ${task.status})`,
  ];
  if (task.comments.length > 0) {
    const last = task.comments[task.comments.length - 1];
    lines.push(`Последний комментарий: ${last.author} (${last.created}): ${last.text}`);
  }
  return lines.join('\n');
}
