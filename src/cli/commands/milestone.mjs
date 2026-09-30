/**
 * Команда `vibelog milestone` — управление вехами (milestones).
 *
 * Подкоманды:
 * - add <name> — создать веху
 * - list — список вех
 * - rename <from> <to> — переименовать
 * - remove <name> — удалить
 * - archive <name> — архивировать
 */

import { getFlag } from '../args.mjs';
import { printSuccess, printError, printInfo } from '../ui.mjs';
import { findBacklogDir, tasksDir } from '../../core/paths.mjs';
import { loadConfig } from '../../core/config.mjs';
import {
  writeMilestone, listMilestones, renameMilestone,
  deleteMilestone, archiveMilestone,
} from '../../core/milestone.mjs';
import { listTasks, updateTaskFile, getTask } from '../../core/store.mjs';

/**
 * Выполняет команду milestone.
 *
 * @param {string} subcommand
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runMilestone(subcommand, positional, flags, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    printError('Backlog не найден. Выполните: vibelog init');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'add':
      return milestoneAdd(positional, flags, backlogDir);
    case 'list':
      return milestoneList(positional, flags, backlogDir);
    case 'rename':
      return milestoneRename(positional, flags, backlogDir, cwd);
    case 'remove':
      return milestoneRemove(positional, flags, backlogDir, cwd);
    case 'archive':
      return milestoneArchive(positional, backlogDir);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: add, list, rename, remove, archive');
  }
}

function milestoneAdd(positional, flags, backlogDir) {
  const name = positional[0];
  if (!name) {
    printError('Укажите название: vibelog milestone add <name>');
    return;
  }
  const description = getFlag(flags, 'description', '');
  const dueDate = getFlag(flags, 'due-date', '');
  const milestone = writeMilestone(backlogDir, { name, description, due_date: dueDate });
  printSuccess(`Веха "${milestone.name}" создана.`);
}

function milestoneList(positional, flags, backlogDir) {
  // --show-completed читает архивные вехи из backlog/completed/
  let milestones = listMilestones(backlogDir, { includeArchived: !!flags['show-completed'] });
  if (!flags['show-completed']) {
    milestones = milestones.filter(m => m.status !== 'archived');
  }
  if (milestones.length === 0) {
    printInfo('Вех нет.');
    return;
  }
  console.log('');
  for (const m of milestones) {
    const status = m.status === 'archived' ? ' [archived]' : '';
    const due = m.due_date ? ` (до ${m.due_date})` : '';
    console.log(`  ${m.name}${due}${status}`);
  }
  console.log(`\n  ${milestones.length} вех`);
}

function milestoneRename(positional, flags, backlogDir, cwd) {
  const from = positional[0];
  const to = positional[1];
  if (!from || !to) {
    printError('Использование: vibelog milestone rename <from> <to>');
    return;
  }
  const updated = renameMilestone(backlogDir, from, to);
  if (!updated) {
    printError(`Веха "${from}" не найдена.`);
    return;
  }
  printSuccess(`Веха переименована: ${from} → ${to}`);

  // Обновляем milestone в задачах (если не --no-update-tasks)
  if (!flags['no-update-tasks']) {
    const tasks = listTasks(cwd);
    let updated2 = 0;
    for (const task of tasks) {
      if (task.milestone && task.milestone.toLowerCase() === from.toLowerCase()) {
        updateTaskFile(cwd, task.id, { milestone: to });
        updated2++;
      }
    }
    if (updated2 > 0) printInfo(`Обновлено задач: ${updated2}`);
  }
}

function milestoneRemove(positional, flags, backlogDir, cwd) {
  const name = positional[0];
  if (!name) {
    printError('Использование: vibelog milestone remove <name>');
    return;
  }

  const deleted = deleteMilestone(backlogDir, name);
  if (!deleted) {
    printError(`Веха "${name}" не найдена.`);
    return;
  }
  printSuccess(`Веха "${name}" удалена.`);

  // Обработка связанных задач
  const handling = getFlag(flags, 'task-handling', 'clear');
  const tasks = listTasks(cwd);
  let updated = 0;

  for (const task of tasks) {
    if (task.milestone && task.milestone.toLowerCase() === name.toLowerCase()) {
      if (handling === 'clear') {
        updateTaskFile(cwd, task.id, { milestone: '' });
        updated++;
      } else if (handling === 'reassign') {
        const target = getFlag(flags, 'reassign-to', '');
        if (target) {
          updateTaskFile(cwd, task.id, { milestone: target });
          updated++;
        }
      }
      // 'keep' — не трогаем
    }
  }
  if (updated > 0) printInfo(`Задач обновлено: ${updated}`);
}

function milestoneArchive(positional, backlogDir) {
  const name = positional[0];
  if (!name) {
    printError('Использование: vibelog milestone archive <name>');
    return;
  }
  const archived = archiveMilestone(backlogDir, name);
  if (!archived) {
    printError(`Веха "${name}" не найдена.`);
    return;
  }
  printSuccess(`Веха "${name}" архивирована.`);
}
