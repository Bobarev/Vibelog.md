/**
 * Команда `vibelog board` — отображение канбан-доски.
 *
 * Рендерит задачи в виде таблицы по статусам (ANSI-канбан).
 * Опция export — экспорт в markdown.
 */

import { printBoard, printInfo } from '../ui.js';
import { listTasks } from '../../core/store.js';
import { loadConfig } from '../../core/config.js';
import type { Task } from '../../core/task.js';
import type { FlagValues } from '../args.js';

/**
 * Выполняет команду board.
 */
export async function runBoard(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const config = loadConfig(cwd);
  const statuses = (config.statuses as string[]) || ['To Do', 'In Progress', 'Done'];
  const maxWidth = (config.max_column_width as number) || 30;

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
 */
function printBoardMarkdown(tasks: Task[], statuses: string[]): void {
  const grouped: Record<string, Task[]> = {};
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
