/**
 * Утилиты для работы с git.
 *
 * Минимальная реализация для Vibelog.md:
 * - Поиск корня git-репозитория
 * - Проверка статуса ( modified / committed )
 */

import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Ищет корень git-репозитория от заданного пути.
 *
 * Поднимается вверх по директориям, пока не найдёт `.git/`.
 *
 * @param {string} startDir — начальная директория
 * @returns {string|null} — абсолютный путь к корню репозитория, или null
 */
export function findGitRoot(startDir) {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, '.git')) && statSync(join(current, '.git')).isDirectory()) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
