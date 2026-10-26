/**
 * CRUD-операции с задачами Vibelog.md.
 *
 * Все операции работают с файловой системой напрямую:
 * читают/пишут markdown-файлы в директории backlog.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { findBacklogDir, tasksDir, completedDir } from './paths.js';
import { loadConfig } from './config.js';
import { resolveGitUserName } from './project-settings.js';
import { createTask, taskToMarkdown, markdownToTask, taskFilename } from './task.js';
import type { Task, TaskComment, TaskInput } from './task.js';
import { nextTaskId } from './id.js';
import { emptyUsage, hasUsageDelta, usageDelta } from './analytics.js';
import type { TokenUsage } from './analytics.js';

/**
 * Вход createTaskFile: TaskInput (id опционален — генерируется nextTaskId)
 * + флаг отключения DoD-дефолтов.
 */
export interface CreateTaskFileInput extends Omit<TaskInput, 'id'> {
  id?: string;
  noDodDefaults?: boolean;
}

/**
 * Получает список всех активных задач.
 *
 * Читает все .md файлы из `backlog/tasks/` и парсит их.
 *
 * @param cwd — текущая рабочая директория
 */
export function listTasks(cwd: string): Task[] {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return [];

  const dir = tasksDir(backlogDir);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const content = readFileSync(join(dir, f), 'utf-8');
    return markdownToTask(content);
  });
}

/**
 * Получает задачу по ID.
 *
 * Ищет в `tasks/` и `completed/`.
 *
 * @param cwd — текущая рабочая директория
 * @param id — ID задачи (например "back-100")
 * @returns объект задачи или null
 */
export function getTask(cwd: string, id: string): Task | null {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return null;

  const idLower = id.toLowerCase();
  const dirs = [tasksDir(backlogDir), completedDir(backlogDir)];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      if (f.toLowerCase().startsWith(idLower + ' ') || f.toLowerCase().startsWith(idLower + '.')) {
        const content = readFileSync(join(dir, f), 'utf-8');
        return markdownToTask(content);
      }
    }
  }
  return null;
}

/**
 * Создаёт новую задачу.
 *
 * Генерирует ID, создаёт объект задачи, записывает markdown-файл
 * в `backlog/tasks/`.
 *
 * @param cwd — текущая рабочая директория
 * @param input — входные данные задачи
 * @throws если backlog-директория не найдена
 */
export function createTaskFile(cwd: string, input: CreateTaskFileInput): Task {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена. Выполните "vibelog init".');
  }

  const config = loadConfig(cwd);

  // DoD-дефолты из конфига (как в оригинале): если критерии не переданы
  // и не выставлен noDodDefaults, добавляем definition_of_done как unchecked
  let effectiveInput = input;
  if ((!input.definitionOfDone || input.definitionOfDone.length === 0) && input.noDodDefaults !== true) {
    const defaults = (config.definition_of_done as string[] | undefined) || [];
    if (defaults.length > 0) {
      effectiveInput = { ...input, definitionOfDone: defaults.map(text => ({ text, checked: false })) };
    }
  }

  const id = input.id || nextTaskId(cwd, config.task_prefix as string);
  const task = createTask({ ...effectiveInput, id }, config);

  const dir = tasksDir(backlogDir);
  const filename = taskFilename(task);
  const content = taskToMarkdown(task);
  writeFileSync(join(dir, filename), content, 'utf-8');

  return task;
}

/**
 * Обновляет существующую задачу.
 *
 * Находит задачу по ID, применяет обновления, перезаписывает файл.
 *
 * @param cwd — текущая рабочая директория
 * @param id — ID задачи
 * @param updates — поля для обновления
 * @throws если задача не найдена
 */
export function updateTaskFile(cwd: string, id: string, updates: Partial<Task>): Task {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена.');
  }

  const task = getTask(cwd, id);
  if (!task) {
    throw new Error(`Задача ${id} не найдена.`);
  }

  // Находим путь к файлу
  const filePath = findTaskFilePath(backlogDir, id);
  if (!filePath) {
    throw new Error(`Файл задачи ${id} не найден.`);
  }

  // Применяем обновления
  const updated = { ...task, ...updates, updated_date: formatDateTime(new Date()) };
  const content = taskToMarkdown(updated);
  writeFileSync(filePath, content, 'utf-8');

  return updated;
}

/** Агрегат by_phase: по фазе — input/output/cache/requests (без total/duration). */
export type PhaseUsage = NonNullable<NonNullable<Task['token_usage']>['by_phase']>[string];

/**
 * Дозаписывает дельту использования токенов в frontmatter задачи (VL-198).
 *
 * Три писателя (backlog_finish_phase, cli post-run, оркестратор) вызывают
 * эту функцию со СВОЕЙ дельтой (usage − usage_recorded из меты сессии) —
 * тогда запись идемпотентна и двойного учёта нет (двойной учёт — риск №1
 * плана VL-198). Ненулевая дельта обновляет total и duration_ms,
 * ненулевая по фазам — вклад в by_phase[phase].
 *
 * @param cwd — директория проекта (в branch-mode — worktree, как у MCP/CLI)
 * @param taskId — ID задачи
 * @param phase — фаза (spec/plan/code/close/…); пустая → только total
 * @param delta — дельта токенов (негативные значения отсекаются usageDelta)
 * @param durationMsDelta — дельта длительности (мс), 0 → не менять
 * @returns true, если файл обновлён (дельта ненулевая), иначе false
 * @throws если задача не найдена (вызывающий глотает — запись не критична)
 */
export function addTaskTokenUsage(
  cwd: string,
  taskId: string,
  phase: string | undefined,
  delta: Partial<TokenUsage>,
  durationMsDelta = 0,
): boolean {
  const task = getTask(cwd, taskId);
  if (!task) throw new Error(`Задача ${taskId} не найдена.`);
  // Нормализуем через пустой usage: отрицательные «дельты» не бывают
  const norm = usageDelta(emptyUsage(), { ...emptyUsage(), ...delta });
  const addDur = Number.isFinite(durationMsDelta) && durationMsDelta > 0 ? durationMsDelta : 0;
  if (!hasUsageDelta(norm) && addDur === 0) return false;

  const current = task.token_usage;
  const merged: NonNullable<Task['token_usage']> = {
    input: (current?.input ?? 0) + norm.input,
    output: (current?.output ?? 0) + norm.output,
    cache: (current?.cache ?? 0) + norm.cache,
    total: (current?.total ?? 0) + norm.total,
    requests: (current?.requests ?? 0) + norm.requests,
    duration_ms: (current?.duration_ms ?? 0) + addDur,
    ...(current?.reasoning !== undefined || norm.reasoning !== undefined
      ? { reasoning: (current?.reasoning ?? 0) + (norm.reasoning ?? 0) }
      : {}),
    by_phase: { ...(current?.by_phase ?? {}) },
  };
  if (phase && hasUsageDelta(norm)) {
    const p: PhaseUsage = { ...(merged.by_phase![phase] ?? { input: 0, output: 0, cache: 0, requests: 0 }) };
    merged.by_phase![phase] = {
      input: p.input + norm.input,
      output: p.output + norm.output,
      cache: p.cache + norm.cache,
      requests: p.requests + norm.requests,
    };
  }
  updateTaskFile(cwd, taskId, { token_usage: merged });
  return true;
}

/**
 * Добавляет комментарий к задаче через штатное сохранение (VL-35).
 *
 * Автор по умолчанию — user.name из кэша .vibelog/settings.json (заполняется
 * при init) или git config проекта: однопользовательская
 * система, привязанный чат бота и CLI принадлежат одному пользователю.
 * Формат файла не меняется — совместимость с Backlog.md сохраняется.
 *
 * @param cwd — рабочая директория проекта
 * @param id — ID задачи
 * @param text — текст комментария
 * @param author — автор; по умолчанию кэш settings.json → git config → '@agent'
 * @returns обновлённая задача
 * @throws если задача не найдена
 */
export function addComment(cwd: string, id: string, text: string, author?: string): Task {
  const task = getTask(cwd, id);
  if (!task) {
    throw new Error(`Задача не найдена: ${id}`);
  }
  const resolvedAuthor = author || resolveGitUserName(cwd);
  const now = new Date();
  const created = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const comment: TaskComment = { author: resolvedAuthor, created, text };
  return updateTaskFile(cwd, id, { comments: [...(task.comments || []), comment] });
}

/**
 * Архивирует задачу (перемещает из tasks/ в completed/).
 * Директория completed/ создаётся автоматически, если отсутствует (VL-190).
 *
 * @param cwd — текущая рабочая директория
 * @param id — ID задачи
 * @throws если задача не найдена
 */
export function archiveTaskFile(cwd: string, id: string): void {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена.');
  }

  const filePath = findTaskFilePath(backlogDir, id);
  if (!filePath) {
    throw new Error(`Задача ${id} не найдена в tasks/.`);
  }

  const filename = filePath.split('/').pop() as string;
  const dest = join(completedDir(backlogDir), filename);
  // VL-190: в сторонних проектах backlog/completed/ может не существовать —
  // renameSync падал с ENOENT; создаём папку идемпотентно перед переносом
  mkdirSync(completedDir(backlogDir), { recursive: true });
  renameSync(filePath, dest);
}

/**
 * Помечает задачу как завершённую (меняет статус на "Done" и архивирует).
 *
 * @param cwd — текущая рабочая директория
 * @param id — ID задачи
 */
export function completeTaskFile(cwd: string, id: string): Task {
  const task = updateTaskFile(cwd, id, { status: 'Done' });
  archiveTaskFile(cwd, id);
  return task;
}

/**
 * Детектор «задача хотя бы раз была в фазе Code» (VL-144).
 *
 * Определяет путь reject: никогда не бывшая в Code — чистая механика
 * (без LLM), бывшая — откат начатых изменений через фазу reject.
 * Ложноположительное срабатывание безопасно (лишний LLM-запуск),
 * ложноотрицательное — нет (пропуск отката), поэтому набор признаков
 * широкий: отчёт завершённой Code-фазы, статус «кода», заполненные
 * поля, которые фаза Code оставляет в задаче.
 *
 * @param task — задача
 */
export function wasInCode(task: Task): boolean {
  // Отчёт завершённой Фазы 3 (Code) — прямой след выполнения кода
  if (task.comments.some((c) => c.text.startsWith('Фаза 3 (Code)'))) return true;
  // Код шёл (In Progress) или шёл после Code (Review)
  if (task.status === 'In Progress' || task.status === 'Review') return true;
  // Поля заполняются фазой Code (notes — по ходу, finalSummary — в Close,
  // но непустой finalSummary означает, что жизненный цикл дошёл дальше Spec/Plan)
  if (task.implementationNotes.trim() || task.finalSummary.trim()) return true;
  return false;
}

/**
 * Отклоняет задачу: комментарий (причина) → статус Rejected → архив (VL-144).
 *
 * Чистая механика без LLM: для задач, никогда не бывших в Code, откатывать
 * нечего. Для бывших в Code LLM-откат выполняет фаза reject ДО вызова этой
 * функции (в onExit завершения фазы) — здесь только статус и перенос файла.
 *
 * @param cwd — текущая рабочая директория
 * @param id — ID задачи
 * @param comment — причина отказа; пустой/undefined — без комментария
 * @returns задача в статусе Rejected (до архива)
 * @throws если задача не найдена
 */
export function rejectTaskFile(cwd: string, id: string, comment?: string): Task {
  if (comment && comment.trim()) {
    addComment(cwd, id, comment.trim());
  }
  const task = updateTaskFile(cwd, id, { status: 'Rejected' });
  archiveTaskFile(cwd, id);
  return task;
}

/**
 * Ищет файл задачи по ID и возвращает путь.
 *
 * @returns абсолютный путь к файлу или null
 */
function findTaskFilePath(backlogDir: string, id: string): string | null {
  const dir = tasksDir(backlogDir);
  if (!existsSync(dir)) return null;

  const idLower = id.toLowerCase();
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    if (f.toLowerCase().startsWith(idLower + ' ') || f.toLowerCase().startsWith(idLower + '.')) {
      return join(dir, f);
    }
  }
  return null;
}

/**
 * Форматирует дату в формате YYYY-MM-DD HH:MM.
 */
function formatDateTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}
