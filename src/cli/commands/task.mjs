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

import { parseArgs, getFlag, getFlagArray } from '../args.mjs';
import {
  printSuccess, printError, printInfo,
  printTaskTable, printTaskDetail,
} from '../ui.mjs';
import {
  listTasks, getTask, createTaskFile,
  updateTaskFile, completeTaskFile, archiveTaskFile,
} from '../../core/store.mjs';
import { loadConfig } from '../../core/config.mjs';

/**
 * Выполняет команду task с подкомандой.
 *
 * @param {string} subcommand — подкоманда (create, list, view, edit, complete, archive)
 * @param {string[]} positional — позиционные аргументы
 * @param {Record<string, unknown>} flags — флаги
 * @param {string} cwd — текущая рабочая директория
 */
export async function runTask(subcommand, positional, flags, cwd) {
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
 *
 * @param {string[]} positional — [заголовок]
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
function taskCreate(positional, flags, cwd) {
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

  const acceptanceCriteria = getFlagArray(flags, 'ac');
  const definitionOfDone = getFlagArray(flags, 'dod');

  const task = createTaskFile(cwd, {
    title,
    description,
    priority,
    status,
    assignee,
    labels,
    dependencies,
    milestone,
    due_date: dueDate,
    acceptanceCriteria,
    definitionOfDone,
  });

  printSuccess(`Задача ${task.id} создана: ${task.title}`);
}

/**
 * Выводит список задач.
 *
 * vibelog task list [-s статус] [--json]
 *
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
function taskList(positional, flags, cwd) {
  let tasks = listTasks(cwd);

  // Фильтрация по статусу
  const statusFilter = getFlag(flags, 'status');
  if (statusFilter) {
    tasks = tasks.filter(t => t.status.toLowerCase() === statusFilter.toLowerCase());
  }

  // Фильтрация по метке
  const labelFilter = getFlag(flags, 'labels');
  if (labelFilter) {
    tasks = tasks.filter(t =>
      t.labels && t.labels.some(l => l.toLowerCase() === labelFilter.toLowerCase())
    );
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
    maxWidth: config.max_column_width || 20,
  });
}

/**
 * Просматривает задачу по ID.
 *
 * vibelog task view <id> [--json]
 *
 * @param {string[]} positional — [id]
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
function taskView(positional, flags, cwd) {
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
 * Редактирует задачу.
 *
 * vibelog task edit <id> [--title ...] [--status ...] [--ac "текст"] [--check-ac N]
 *
 * @param {string[]} positional — [id]
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
function taskEdit(positional, flags, cwd) {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID задачи: vibelog task edit <id>');
    return;
  }

  const updates = {};

  if (flags.title) updates.title = getFlag(flags, 'title');
  if (flags.status) updates.status = getFlag(flags, 'status');
  if (flags.priority) updates.priority = getFlag(flags, 'priority');
  if (flags.description) updates.description = getFlag(flags, 'description');
  if (flags.milestone) updates.milestone = getFlag(flags, 'milestone');
  if (flags['due-date']) updates.due_date = getFlag(flags, 'due-date');

  // Массивы
  const newLabels = getFlagArray(flags, 'labels');
  if (newLabels.length > 0) updates.labels = newLabels;

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

  // AC: отметка
  if (flags['check-ac']) {
    const task = getTask(cwd, id);
    if (task) {
      const idx = parseInt(getFlag(flags, 'check-ac'), 10) - 1;
      if (idx >= 0 && idx < task.acceptanceCriteria.length) {
        task.acceptanceCriteria[idx].checked = true;
        updates.acceptanceCriteria = task.acceptanceCriteria;
      }
    }
  }

  // AC: снятие отметки
  if (flags['uncheck-ac']) {
    const task = getTask(cwd, id);
    if (task) {
      const idx = parseInt(getFlag(flags, 'uncheck-ac'), 10) - 1;
      if (idx >= 0 && idx < task.acceptanceCriteria.length) {
        task.acceptanceCriteria[idx].checked = false;
        updates.acceptanceCriteria = task.acceptanceCriteria;
      }
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

  // DoD
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
 *
 * @param {string[]} positional — [id]
 * @param {string} cwd
 */
function taskComplete(positional, cwd) {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID задачи: vibelog task complete <id>');
    return;
  }

  try {
    completeTaskFile(cwd, id);
    printSuccess(`Задача ${id} завершена и архивирована.`);
  } catch (err) {
    printError(err.message);
  }
}

/**
 * Архивирует задачу.
 *
 * vibelog task archive <id>
 *
 * @param {string[]} positional — [id]
 * @param {string} cwd
 */
function taskArchive(positional, cwd) {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID задачи: vibelog task archive <id>');
    return;
  }

  try {
    archiveTaskFile(cwd, id);
    printSuccess(`Задача ${id} архивирована.`);
  } catch (err) {
    printError(err.message);
  }
}
