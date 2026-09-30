/**
 * Команда `vibelog search` — поиск задач.
 *
 * Поддерживает поиск по заголовку, описанию и меткам.
 */

import { getFlag } from '../args.mjs';
import { printTaskTable, printInfo, printError } from '../ui.mjs';
import { searchTasks } from '../../core/search.mjs';
import { loadConfig } from '../../core/config.mjs';

/**
 * Выполняет команду search.
 *
 * @param {string[]} positional — [запрос]
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runSearch(args, flags, cwd) {
  // Собираем все позиционные аргументы (не флаги) в запрос
  const query = args.filter(a => !a.startsWith('-')).join(' ');
  if (!query) {
    printError('Укажите поисковый запрос: vibelog search "текст"');
    return;
  }

  const tasks = searchTasks(cwd, query);

  if (flags.json) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'search', data: tasks }, null, 2));
    return;
  }

  if (tasks.length === 0) {
    printInfo(`По запросу "${query}" ничего не найдено.`);
    return;
  }

  const config = loadConfig(cwd);
  console.log(`\nРезультаты поиска "${query}":\n`);
  printTaskTable(tasks, { maxWidth: config.max_column_width || 20 });
}
