/**
 * Команда `vibelog search` — поиск задач.
 *
 * Текстовый запрос (по заголовку, описанию, меткам, ID) и/или
 * фильтры полей: --status, --type, --priority, --limit.
 * Запрос необязателен, если указан хотя бы один фильтр.
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

  const status = getFlag(flags, 'status', '');
  const type = getFlag(flags, 'type', '');
  const priority = getFlag(flags, 'priority', '');

  // limit: строка из флагов → число с валидацией
  let limit;
  if (flags.limit !== undefined) {
    limit = Number(getFlag(flags, 'limit'));
    if (!Number.isFinite(limit) || limit <= 0) {
      printError(`--limit должен быть числом больше нуля, получено: ${getFlag(flags, 'limit')}`);
      return;
    }
  }

  // Без запроса и фильтров искать нечего
  if (!query && !status && !type && !priority && limit === undefined) {
    printError('Укажите поисковый запрос или фильтр: vibelog search "текст" --status "To Do"');
    return;
  }

  const tasks = searchTasks(cwd, {
    query: query || undefined,
    status: status || undefined,
    type: type || undefined,
    priority: priority || undefined,
    limit,
  });

  // Активные критерии — для заголовка и сообщений
  const criteria = [
    query ? `запрос "${query}"` : '',
    status ? `status=${status}` : '',
    type ? `type=${type}` : '',
    priority ? `priority=${priority}` : '',
    limit ? `limit=${limit}` : '',
  ].filter(Boolean).join(', ');

  if (flags.json) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'search', data: tasks }, null, 2));
    return;
  }

  if (tasks.length === 0) {
    printInfo(`Ничего не найдено (${criteria}).`);
    return;
  }

  const config = loadConfig(cwd);
  console.log(`\nРезультаты поиска: ${criteria}\n`);
  printTaskTable(tasks, { maxWidth: config.max_column_width || 20 });
}
