/**
 * Сборка промптов фаз (VL-85, VL-188): общий модуль оркестратора и CLI vibelog-agent.
 *
 * Логика вынесена из src/web/orchestrator.ts: шаблоны templates/phases/*.md
 * (VL-188: переименованы phase-1/2/3 → phase-spec/plan/code, перенесены из
 * templates/qwen-commands/ в корень templates/phases/) + подстановка
 * {{taskId}}/{{key}}. Вынесено, чтобы CLI агента переиспользовал сборку
 * промпта, не таща за собой оркестратор (spawn, поллинг, activeRuns). Путь
 * к шаблонам вычисляется от расположения модуля: dist/web/phase-prompt.js →
 * ../../templates/phases/ (та же глубина, что была у orchestrator.js).
 *
 * Переопределение шаблонов проектом (VL-188): перед встроенным шаблоном
 * читается .vibelog/prompts/phases/<имя файла> рабочей директории проекта —
 * проект может переопределить промпт любой фазы, не правя пакет.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTask } from '../core/store.js';
import { DEFAULT_TASK_TYPES, loadConfig } from '../core/config.js';
import { loadLessonsForTask } from '../core/lesson.js';
import type { ChecklistItem, Task } from '../core/task.js';

/**
 * Допустимые фазы.
 *
 * VL-188: добавлена 'do' — фаза simple workflow (реализация без планирования,
 * phase-do.md); роль KNOWN_PHASES в проекте выполняет именно эта константа
 * (отдельной KNOWN_PHASES нет — проверено grep по src/web и src/bot).
 */
export const PHASES = ['spec', 'plan', 'code', 'do', 'close', 'comment', 'prompt', 'analyze', 'reject'] as const;
export type Phase = (typeof PHASES)[number];

/** Шаблон промпта для каждой фазы (VL-188: имена файлов = phase-<имя фазы>.md). */
const PHASE_FILES: Record<Phase, string> = {
  spec: 'phase-spec.md',
  plan: 'phase-plan.md',
  code: 'phase-code.md',
  do: 'phase-do.md',
  close: 'phase-close.md',
  comment: 'phase-comment.md',
  prompt: 'prompt.md',
  // VL-141: фаза analyze — headless-разбор сессии агента без задачи (как prompt)
  analyze: 'phase-analyze.md',
  reject: 'phase-reject.md',
};

/** Отдельный шаблон close-фазы для задач, работающих в worktree (VL-112). */
const CLOSE_WORKTREE_FILE = 'phase-close-worktree.md';

/**
 * Путь к встроенным шаблонам. Вычисляется от расположения модуля
 * (dist/web/phase-prompt.js → ../../templates/phases/), как webDistDir:
 * команда vibelog browser запускается в репозитории пользователя.
 */
const templatesDir = fileURLToPath(new URL('../../templates/phases/', import.meta.url));

/** Подкаталог переопределения шаблонов проектом (VL-188), относительно cwd. */
export const PROJECT_PROMPTS_DIR = join('.vibelog', 'prompts', 'phases');

/** Опции сборки промпта (VL-112, VL-188). */
export interface RenderPromptOptions {
  /** Фаза close задачи, работающей в worktree: отдельный шаблон с merge-шагом ветки. */
  closeWorktree?: boolean;
  /**
   * Рабочая директория проекта для переопределения шаблонов
   * (.vibelog/prompts/phases/). undefined/'' — только встроенные шаблоны.
   */
  cwd?: string;
}

/**
 * Загружает шаблон фазы с переопределением проектом (VL-188).
 *
 * Порядок: <cwd>/.vibelog/prompts/phases/<fileName> → встроенный
 * templates/phases/<fileName>. Для opts.closeWorktree fileName —
 * phase-close-worktree.md, ищется в обоих каталогах тем же порядком.
 *
 * @param phase — имя фазы (ключ PHASE_FILES); для неизвестной фазы — throw
 * @param opts — closeWorktree (worktree-вариант close) и cwd (переопределение)
 * @throws Error при неизвестной фазе или отсутствии шаблона в обоих каталогах
 */
export function loadPhaseTemplate(phase: string, opts?: { closeWorktree?: boolean; cwd?: string }): string {
  if (!PHASES.includes(phase as Phase)) {
    throw new Error(`Неизвестная фаза: ${phase} (ожидается ${PHASES.join('|')})`);
  }
  const fileName =
    phase === 'close' && opts?.closeWorktree ? CLOSE_WORKTREE_FILE : PHASE_FILES[phase as Phase];
  // Переопределение проектом приоритетнее встроенного шаблона
  const projectPath = opts?.cwd ? join(opts.cwd, PROJECT_PROMPTS_DIR, fileName) : null;
  if (projectPath && existsSync(projectPath)) {
    return readFileSync(projectPath, 'utf-8');
  }
  const bundledPath = join(templatesDir, fileName);
  try {
    return readFileSync(bundledPath, 'utf-8');
  } catch {
    throw new Error(
      `Шаблон промпта не найден: ${fileName} (проверь ${PROJECT_PROMPTS_DIR} в проекте и templates/phases/ в пакете)`
    );
  }
}

/**
 * Собирает промпт фазы: шаблон (с переопределением проектом, VL-188) + подстановка {{taskId}}.
 *
 * @param phase — spec | plan | code | do | close | comment | prompt | analyze | reject
 * @param taskId — ID задачи, например VL-28; для analyze может быть '' (без задачи)
 * @param extraVars — доп. подстановки {{key}} -> value ({{comment}} для comment, {{prompt}} для prompt, {{producesStatus}} и др.)
 * @param opts — опции: closeWorktree (worktree-вариант close), cwd (переопределение шаблонов проектом)
 * @throws Error при неизвестной фазе или отсутствующем шаблоне
 */
export function renderPrompt(
  phase: string,
  taskId: string,
  extraVars?: Record<string, string>,
  opts?: RenderPromptOptions
): string {
  // Ошибки «Неизвестная фаза»/«Шаблон не найден» кидает loadPhaseTemplate
  const template = loadPhaseTemplate(phase, opts);
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

  // VL-154/VL-184: labels/types/priorities из backlog/config.yml — Spec
  // классифицирует задачу по готовым спискам (метки, тип, приоритет), не тратя
  // ход на backlog_config. Ошибка чтения конфига (нет config.yml, битый YAML):
  // labels → пустая строка, types/priorities → значения по умолчанию
  // (зеркало fallback normalizeTaskType в core/config.ts) — фаза не должна
  // падать из-за отсутствующего конфига.
  let cfg: Record<string, unknown> = {};
  try {
    cfg = loadConfig(cwd);
  } catch {
    // конфига нет/битый YAML — cfg остаётся {}, ниже срабатывают дефолты
  }
  const cfgLabels = cfg.labels;
  const availableLabels = Array.isArray(cfgLabels) ? cfgLabels.join(', ') : '';
  // VL-184: типы из конфига; дефолт — DEFAULT_TASK_TYPES (как в normalizeTaskType)
  const cfgTypes = cfg.types;
  const availableTypes = (Array.isArray(cfgTypes) && cfgTypes.length > 0 ? cfgTypes : DEFAULT_TASK_TYPES).join(', ');
  // VL-184: приоритеты из конфига; дефолт — High/Medium/Low (как в defaultConfig)
  const cfgPriorities = cfg.priorities;
  const availablePriorities = (
    Array.isArray(cfgPriorities) && cfgPriorities.length > 0 ? cfgPriorities : ['High', 'Medium', 'Low']
  ).join(', ');

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
    // VL-154: labels при ошибке конфига → ''; VL-184: types/priorities →
    // дефолты (см. вычисления выше)
    availableLabels,
    availableTypes,
    availablePriorities,
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
