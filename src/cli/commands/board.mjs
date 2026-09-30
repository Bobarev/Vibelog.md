/**
 * Команда `vibelog board` — отображение канбан-доски.
 *
 * Рендерит задачи в виде таблицы по статусам (ANSI-канбан).
 * Опция export — экспорт в markdown.
 */

import { getFlag } from '../args.mjs';
import { printBoard, printInfo, printError } from '../ui.mjs';
import { listTasks } from '../../core/store.mjs';
import { loadConfig } from '../../core/config.mjs';

/**
 * Выполняет команду board.
 *
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runBoard(positional, flags, cwd) {
  const config = loadConfig(cwd);
  const statuses = config.statuses || ['To Do', 'In Progress', 'Done'];
  const maxWidth = config.max_column_width || 30;

  const tasks = listTasks(cwd);

  if (tasks.length === 0) {
    printInfo('Задач нет. Создайте первую: vibelog task create "Заголовок"');
    return;
  }

  // Экспорт в markdown
  if (flags.export || positional[0] === 'export') {
    printBoardMarkdown(tasks, statuses);
    return;
  }

  // ANSI-доска в терминале
  printBoard(tasks, statuses, maxWidth);
}

/**
 * Экспортирует доску в markdown-формате.
 *
 * @param {object[]} tasks
 * @param {string[]} statuses
 */
function printBoardMarkdown(tasks, statuses) {
  const grouped = {};
  for (const status of statuses) grouped[status] = [];
  for (const task of tasks) {
    const status = task.status || 'To Do';
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(task);
  }

  console.log('# Task Board\n');
  for (const status of statuses) {
    console.log(`## ${status}\n`);
    if (grouped[status].length === 0) {
      console.log('_нет задач_\n');
    } else {
      for (const task of grouped[status]) {
        const labels = task.labels.length > 0 ? ` \`${task.labels.join('` `')}\`` : '';
        console.log(`- **${task.id}** ${task.title}${labels}`);
      }
      console.log('');
    }
  }
}
