/**
 * Команда `vibelog map` — карта проекта для человека и агента (VL-235).
 *
 * Тонкая обёртка над `buildProjectMap` (src/core/project-map.ts): генерация
 * одна на CLI и MCP-инструмент `project_map`, дублирования логики нет.
 * Позиционные аргументы собираются в `query` так же, как у `vibelog search`:
 * первый аргумент попадает в subcommand — роутер передаёт их вместе.
 */

import { getFlag, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printInfo } from '../ui.js';
import { buildProjectMap } from '../../core/project-map.js';

/**
 * Выполняет команду map.
 *
 * @param args — позиционные аргументы (слова запроса)
 * @param flags — флаги (--dir, --limit, --exports, --no-exports, --json)
 * @param cwd — текущая рабочая директория (корень проекта)
 */
export async function runMap(
  args: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const query = args.filter(a => !a.startsWith('-')).join(' ');

  // --limit: строка из флагов → число с валидацией (невалид — дефолт ядра)
  let limit: number | undefined;
  const rawLimit = getFlag(flags, 'limit', '');
  if (rawLimit) {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      printInfo(`--limit должен быть числом больше нуля, получено: ${rawLimit}; использую значение по умолчанию`);
    } else {
      limit = parsed;
    }
  }

  const dir = getFlag(flags, 'dir', '');
  // --no-exports отключает список экспортов; у флага нет значения — hasFlag.
  const showExports = !hasFlag(flags, 'no-exports');
  const result = buildProjectMap(cwd, {
    ...(query ? { query } : {}),
    ...(dir ? { dir } : {}),
    ...(limit !== undefined ? { limit } : {}),
    exports: showExports,
  });

  if (flags.json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: 'map',
      data: {
        text: result.text,
        modules: result.modules,
        shown: result.shown,
        compacted: result.compacted,
        truncated: result.truncated,
      },
    }, null, 2));
    return;
  }

  console.log(result.text);
  printInfo(`Итого: ${result.shown} модулей из ${result.modules}` +
    (result.compacted > 0 ? ` (сжатие уровня ${result.compacted})` : ''));
}
