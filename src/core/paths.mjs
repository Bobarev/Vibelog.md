/**
 * Утилиты поиска директорий backlog-а в файловой системе.
 *
 * Backlog.md ищет конфиг и задачи в:
 * 1. `backlog/` (внутри текущей директории)
 * 2. `.backlog/` (скрытая версия)
 * 3. `backlog.config.yml` в корне проекта
 *
 * Vibelog.md поддерживает оба варианта конфига:
 * - `backlog/config.yml` (внутри папки backlog)
 * - `backlog.config.yml` (корень проекта)
 */

import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { findGitRoot } from './git.mjs';

/**
 * Ищет директорию backlog от заданного пути.
 *
 * Порядок поиска:
 * 1. `<cwd>/backlog/`
 * 2. `<cwd>/.backlog/`
 * 3. Рекурсивно вверх по родительским директориям
 *
 * @param {string} cwd — начальная директория (обычно process.cwd())
 * @returns {string|null} — абсолютный путь к backlog-директории, или null
 */
export function findBacklogDir(cwd) {
  const absCwd = resolve(cwd);

  // Проверяем локальные варианты
  const candidates = ['backlog', '.backlog'];
  for (const name of candidates) {
    const dir = join(absCwd, name);
    if (isBacklogDir(dir)) {
      return dir;
    }
  }

  // Рекурсивно вверх, ищем backlog-директорию или конфиг
  let current = absCwd;
  while (true) {
    for (const name of candidates) {
      const dir = join(current, name);
      if (isBacklogDir(dir)) {
        return dir;
      }
    }

    // Проверяем, что мы не в корне файловой системы
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Проверяет, является ли директория backlog-директорией.
 *
 * Backlog-директория должна содержать подпапку `tasks/`
 * или файл конфига (`config.yml`).
 *
 * @param {string} dir — путь к директории
 * @returns {boolean}
 */
function isBacklogDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  const entries = readdirSync(dir);
  return entries.includes('tasks') || entries.includes('config.yml');
}

/**
 * Возвращает путь к директории задач.
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @returns {string} — абсолютный путь к `tasks/`
 */
export function tasksDir(backlogDir) {
  return join(backlogDir, 'tasks');
}

/**
 * Возвращает путь к директории завершённых задач.
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @returns {string} — абсолютный путь к `completed/`
 */
export function completedDir(backlogDir) {
  return join(backlogDir, 'completed');
}

/**
 * Возвращает путь к директории черновиков.
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @returns {string} — абсолютный путь к `drafts/`
 */
export function draftsDir(backlogDir) {
  return join(backlogDir, 'drafts');
}

/**
 * Возвращает путь к директории документов.
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @returns {string} — абсолютный путь к `docs/`
 */
export function docsDir(backlogDir) {
  return join(backlogDir, 'docs');
}

/**
 * Возвращает путь к директории решений.
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @returns {string} — абсолютный путь к `decisions/`
 */
export function decisionsDir(backlogDir) {
  return join(backlogDir, 'decisions');
}

/**
 * Возвращает путь к директории вех (milestones).
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @returns {string} — абсолютный путь к `milestones/`
 */
export function milestonesDir(backlogDir) {
  return join(backlogDir, 'milestones');
}

/**
 * Возвращает путь к файлу конфига.
 *
 * Приоритет:
 * 1. `backlog/config.yml` (внутри backlog-директории)
 * 2. `backlog.config.yml` (корень проекта — родитель backlog-директории)
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @returns {string} — абсолютный путь к файлу конфига
 */
export function configPath(backlogDir) {
  const inside = join(backlogDir, 'config.yml');
  if (existsSync(inside)) return inside;

  // Корень проекта — родитель backlog-директории
  const projectRoot = dirname(backlogDir);
  const rootConfig = join(projectRoot, 'backlog.config.yml');
  return rootConfig;
}
