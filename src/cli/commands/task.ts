/**
 * Команда `vibelog task` — управление задачами.
 *
 * Подкоманды:
 * - create — создать задачу
 * - list — список задач
 * - view — просмотр задачи
 * - edit — редактировать задачу
 * - complete — завершить задачу
 * - archive — архивировать задачу
 */

import { getFlag, getFlagArray } from '../args.js';
import type { FlagValues } from '../args.js';
import {
  printSuccess, printError, printInfo,
  printTaskTable, printTaskDetail,
} from '../ui.js';
import {
  listTasks, getTask, createTaskFile,
  updateTaskFile, completeTaskFile, archiveTaskFile,
} from '../../core/store.js';
import { loadConfig, normalizeTaskType } from '../../core/config.js';
import { isReady } from '../../core/deps.js';
import { findBacklogDir } from '../../core/paths.js';
import { writeDraft } from '../../core/draft.js';
import type { Task, ChecklistItem, TaskComment } from '../../core/task.js';

/**
 * Выполняет команду task с подкомандой.
 *
 * @param subcommand — подкоманда (create, list, view, edit, complete, archive)
 */
export async function runTask(
  subcommand: string,
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  switch (subcommand) {
    case 'create':
      return taskCreate(positional, flags, cwd);
    case 'list':
    case 'ls':
      return taskList(positional, flags, cwd);
    case 'view':
    case 'show':
      return taskView(positional, flags, cwd);
    case 'edit':
      return taskEdit(positional, flags, cwd);
    case 'complete':
    case 'done':
      return taskComplete(positional, cwd);
    case 'archive':
      return taskArchive(positional, cwd);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные подкоманды: create, list, view, edit, complete, archive');
  }
}

/**
 * Создаёт новую задачу.
 *
 * vibelog task create "Заголовок" [-d описание] [--ac "критерий"] [--labels bug]
 */
function taskCreate(positional: string[], flags: FlagValues, cwd: string): void {
  const title = positional[0];
  if (!title) {
    printError('Укажите заголовок задачи: vibelog task create "Заголовок"');
    return;
  }

  const description = getFlag(flags, 'description', '');
  const priority = getFlag(flags, 'priority', '');
  const status = getFlag(flags, 'status', '');
  const assignee = getFlagArray(flags, 'assignee');
  const labels = getFlagArray(flags, 'labels').flatMap(l => l.split(',').map(s => s.trim()).filter(Boolean));
  const dependencies = getFlagArray(flags, 'deps').flatMap(d => d.split(',').map(s => s.trim()).filter(Boolean));
  const milestone = getFlag(flags, 'milestone', '');
  const dueDate = getFlag(flags, 'due-date', '');

  // Тип задачи (валидация по конфигу, case-insensitive)
  const type = getFlag(flags, 'type', '');
  let normalizedType = '';
  if (type) {
    try {
      normalizedType = normalizeTaskType(loadConfig(cwd), type);
    } catch (err) {
      printError((err as Error).message);
      return;
    }
  }

  const acceptanceCriteria = getFlagArray(flags, 'ac');
  const definitionOfDone = getFlagArray(flags, 'dod');

  // План и заметки при создании (как в оригинале task create --plan/--notes)
  const plan = getFlag(flags, 'plan', '');
  const notes = getFlag(flags, 'notes', '');

  // P2-флаги оригинала: project, parent, ordinal, final-summary, no-dod-defaults
  const project = getFlag(flags, 'project', '');
  const finalSummary = getFlag(flags, 'final-summary', '');

  // --parent: валидация существования родительской задачи
  const parent = getFlag(flags, 'parent', '');
  if (parent && !getTask(cwd, parent)) {
    printError(`Родительская задача ${parent} не найдена.`);
    return;
  }

  // --ordinal: целое ≥ 0
  let ordinal: number | undefined;
  if (flags.ordinal !== undefined) {
    ordinal = Number(getFlag(flags, 'ordinal'));
    if (!Number.isInteger(ordinal) || ordinal < 0) {
      printError(`--ordinal должен быть целым числом ≥ 0, получено: ${getFlag(flags, 'ordinal')}`);
      return;
    }
  }

  const noDodDefaults = flags['no-dod-defaults'] === true;

  // --draft: черновик вместо задачи (ядро VL-13)
  if (flags.draft) {
    const draft = writeDraft(findBacklogDir(cwd) as string, { title, description, labels }, loadConfig(cwd));
    printSuccess(`Черновик ${draft.id} создан: ${draft.title}`);
    return;
  }

  const task = createTaskFile(cwd, {
    title,
    description,
    priority,
    status,
    assignee,
    labels,
    dependencies,
    milestone,
    type: normalizedType,
    due_date: dueDate,
    acceptanceCriteria,
    definitionOfDone,
    implementationPlan: plan,
    implementationNotes: notes,
    project,
    parent_task_id: parent,
    ordinal,
    finalSummary,
    noDodDefaults,
  });

  printSuccess(`Задача ${task.id} создана: ${task.title}`);
}

/**
 * Выводит список задач.
 *
 * vibelog task list [-s статус] [--json]
 */
function taskList(positional: string[], flags: FlagValues, cwd: string): void {
  let tasks = listTasks(cwd);

  // Фильтрация по статусу
  const statusFilter = getFlag(flags, 'status');
  if (statusFilter) {
    tasks = tasks.filter(t => t.status.toLowerCase() === statusFilter.toLowerCase());
  }

  // Фильтрация по типу
  const typeFilter = getFlag(flags, 'type');
  if (typeFilter) {
    tasks = tasks.filter(t => t.type && t.type.toLowerCase() === typeFilter.toLowerCase());
  }

  // Фильтрация по метке
  const labelFilter = getFlag(flags, 'labels');
  if (labelFilter) {
    tasks = tasks.filter(t =>
      t.labels && t.labels.some(l => l.toLowerCase() === labelFilter.toLowerCase())
    );
  }

  // Фильтр: только готовые к работе
  if (flags.ready) {
    tasks = tasks.filter(t => isReady(cwd, t));
  }

  // Сортировка
  const sortField = getFlag(flags, 'sort');
  if (sortField === 'priority') {
    const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    tasks.sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3));
  } else if (sortField === 'created') {
    tasks.sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));
  } else if (sortField === 'updated') {
    tasks.sort((a, b) => (b.updated_date || '').localeCompare(a.updated_date || ''));
  }

  // Обрезка после фильтрации и сортировки (как в оригинале)
  if (flags.skip !== undefined) {
    const skip = Number(getFlag(flags, 'skip'));
    if (!Number.isInteger(skip) || skip < 0) {
      printError(`--skip должен быть целым числом ≥ 0, получено: ${getFlag(flags, 'skip')}`);
      return;
    }
    tasks = tasks.slice(skip);
  }
  if (flags.limit !== undefined) {
    const limit = Number(getFlag(flags, 'limit'));
    if (!Number.isInteger(limit) || limit < 0) {
      printError(`--limit должен быть целым числом ≥ 0, получено: ${getFlag(flags, 'limit')}`);
      return;
    }
    tasks = tasks.slice(0, limit);
  }

  // JSON-вывод
  if (flags.json) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'task-list', data: tasks }, null, 2));
    return;
  }

  if (tasks.length === 0) {
    printInfo('Задач не найдено.');
    return;
  }

  const config = loadConfig(cwd);
  printTaskTable(tasks, {
    maxWidth: (config.max_column_width as number) || 20,
  });
}

/**
 * Просматривает задачу по ID.
 *
 * vibelog task view <id> [--json]
 */
function taskView(positional: string[], flags: FlagValues, cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID задачи: vibelog task view <id>');
    return;
  }

  const task = getTask(cwd, id);
  if (!task) {
    printError(`Задача ${id} не найдена.`);
    return;
  }

  if (flags.json) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'task-view', data: task }, null, 2));
    return;
  }

  printTaskDetail(task);
}

/**
 * Разбирает список индексов через запятую (--check-ac 1,3).
 *
 * Невалидные индексы: printError, валидные возвращаются (0-based).
 *
 * @param raw — значение флага
 * @param max — максимум (длина списка)
 * @param label — для сообщений об ошибках (AC/DoD)
 */
function parseIndexes(raw: string, max: number, label: string): number[] {
  const result: number[] = [];
  for (const part of String(raw).split(',')) {
    const s = part.trim();
    if (!s) continue;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      printError(`Неверный индекс ${s} (${label}: допустимо 1-${max})`);
      continue;
    }
    result.push(n - 1);
  }
  return result;
}

/**
 * Редактирует задачу.
 *
 * vibelog task edit <id> [--title ...] [--status ...] [--ac "текст"] [--check-ac N]
 */
function taskEdit(positional: string[], flags: FlagValues, cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID задачи: vibelog task edit <id>');
    return;
  }

  const updates: Partial<Task> = {};

  if (flags.title) updates.title = getFlag(flags, 'title');
  if (flags.status) updates.status = getFlag(flags, 'status');
  if (flags.priority) updates.priority = getFlag(flags, 'priority');
  if (flags.description) updates.description = getFlag(flags, 'description');
  if (flags.milestone) updates.milestone = getFlag(flags, 'milestone');
  if (flags['due-date']) updates.due_date = getFlag(flags, 'due-date');
  if (flags.type) {
    try {
      updates.type = normalizeTaskType(loadConfig(cwd), getFlag(flags, 'type'));
    } catch (err) {
      printError((err as Error).message);
      return;
    }
  }

  // Финальные поля (P2 оригинала): final-summary / append / clear / ordinal
  if (flags['final-summary']) updates.finalSummary = getFlag(flags, 'final-summary');
  if (flags['append-final-summary']) {
    const t = getTask(cwd, id);
    if (t) {
      updates.finalSummary = (t.finalSummary ? t.finalSummary + '\n' : '') + getFlag(flags, 'append-final-summary');
    }
  }
  if (flags['clear-final-summary']) updates.finalSummary = '';
  if (flags.ordinal !== undefined) {
    const ord = Number(getFlag(flags, 'ordinal'));
    if (!Number.isInteger(ord) || ord < 0) {
      printError(`--ordinal должен быть целым числом ≥ 0, получено: ${getFlag(flags, 'ordinal')}`);
      return;
    }
    updates.ordinal = ord;
  }

  // Assignee (полная замена)
  const assignee = getFlagArray(flags, 'assignee');
  if (assignee.length > 0) updates.assignee = assignee;

  // Массивы labels (полная замена через --labels)
  const newLabels = getFlagArray(flags, 'labels');
  if (newLabels.length > 0) updates.labels = newLabels;

  // Удаление конкретного label (--remove-label)
  if (flags['remove-label']) {
    const task = getTask(cwd, id);
    if (task) {
      const toRemove = getFlag(flags, 'remove-label').toLowerCase();
      updates.labels = (task.labels || []).filter(l => l.toLowerCase() !== toRemove);
    }
  }

  // Массивы deps
  const newDeps = getFlagArray(flags, 'deps');
  if (newDeps.length > 0) updates.dependencies = newDeps;

  // AC: добавление
  const newAc = getFlagArray(flags, 'ac');
  if (newAc.length > 0) {
    const task = getTask(cwd, id);
    if (task) {
      updates.acceptanceCriteria = [
        ...task.acceptanceCriteria,
        ...newAc.map(text => ({ text, checked: false })),
      ];
    }
  }

  // AC: отметка (несколько индексов через запятую: --check-ac 1,3)
  if (flags['check-ac']) {
    const task = getTask(cwd, id);
    if (task) {
      const list = task.acceptanceCriteria as ChecklistItem[];
      for (const i of parseIndexes(getFlag(flags, 'check-ac'), list.length, 'AC')) {
        list[i].checked = true;
      }
      updates.acceptanceCriteria = list;
    }
  }

  // AC: снятие отметки (несколько индексов: --uncheck-ac 1,2)
  if (flags['uncheck-ac']) {
    const task = getTask(cwd, id);
    if (task) {
      const list = task.acceptanceCriteria as ChecklistItem[];
      for (const i of parseIndexes(getFlag(flags, 'uncheck-ac'), list.length, 'AC')) {
        list[i].checked = false;
      }
      updates.acceptanceCriteria = list;
    }
  }

  // AC: удаление
  if (flags['remove-ac']) {
    const task = getTask(cwd, id);
    if (task) {
      const idx = parseInt(getFlag(flags, 'remove-ac'), 10) - 1;
      if (idx >= 0 && idx < task.acceptanceCriteria.length) {
        updates.acceptanceCriteria = task.acceptanceCriteria.filter((_, i) => i !== idx);
      }
    }
  }

  // DoD: добавление
  const newDod = getFlagArray(flags, 'dod');
  if (newDod.length > 0) {
    const task = getTask(cwd, id);
    if (task) {
      updates.definitionOfDone = [
        ...task.definitionOfDone,
        ...newDod.map(text => ({ text, checked: false })),
      ];
    }
  }

  // DoD: отметка (несколько индексов: --check-dod 1,2)
  if (flags['check-dod']) {
    const task = getTask(cwd, id);
    if (task) {
      const list = task.definitionOfDone as ChecklistItem[];
      for (const i of parseIndexes(getFlag(flags, 'check-dod'), list.length, 'DoD')) {
        list[i].checked = true;
      }
      updates.definitionOfDone = list;
    }
  }

  // DoD: снятие отметки (несколько индексов: --uncheck-dod 1,2)
  if (flags['uncheck-dod']) {
    const task = getTask(cwd, id);
    if (task) {
      const list = task.definitionOfDone as ChecklistItem[];
      for (const i of parseIndexes(getFlag(flags, 'uncheck-dod'), list.length, 'DoD')) {
        list[i].checked = false;
      }
      updates.definitionOfDone = list;
    }
  }

  // DoD: удаление
  if (flags['remove-dod']) {
    const task = getTask(cwd, id);
    if (task) {
      const idx = parseInt(getFlag(flags, 'remove-dod'), 10) - 1;
      if (idx >= 0 && idx < task.definitionOfDone.length) {
        updates.definitionOfDone = task.definitionOfDone.filter((_, i) => i !== idx);
      }
    }
  }

  // Plan
  if (flags.plan) updates.implementationPlan = getFlag(flags, 'plan');

  // Notes
  if (flags.notes) updates.implementationNotes = getFlag(flags, 'notes');

  // Append notes
  if (flags['append-notes']) {
    const task = getTask(cwd, id);
    if (task) {
      updates.implementationNotes = (task.implementationNotes || '') + '\n' + getFlag(flags, 'append-notes');
    }
  }

  // Комментарий
  if (flags.comment) {
    const task = getTask(cwd, id);
    if (task) {
      const author = getFlag(flags, 'comment-author', '@agent');
      const now = new Date();
      const created = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const comment: TaskComment = { author, created, text: getFlag(flags, 'comment') };
      updates.comments = [...(task.comments || []), comment];
    }
  }

  if (Object.keys(updates).length === 0) {
    printError('Не указаны поля для обновления. Используйте --title, --status, --ac и т.д.');
    return;
  }

  const updated = updateTaskFile(cwd, id, updates);
  printSuccess(`Задача ${updated.id} обновлена.`);
}

/**
 * Завершает задачу (меняет статус на Done и архивирует).
 *
 * vibelog task complete <id>
 */
function taskComplete(positional: string[], cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID задачи: vibelog task complete <id>');
    return;
  }

  try {
    completeTaskFile(cwd, id);
    printSuccess(`Задача ${id} завершена и архивирована.`);
  } catch (err) {
    printError((err as Error).message);
  }
}

/**
 * Архивирует задачу.
 *
 * vibelog task archive <id>
 */
function taskArchive(positional: string[], cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID задачи: vibelog task archive <id>');
    return;
  }

  try {
    archiveTaskFile(cwd, id);
    printSuccess(`Задача ${id} архивирована.`);
  } catch (err) {
    printError((err as Error).message);
  }
}
