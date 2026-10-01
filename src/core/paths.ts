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
import { findGitRoot } from './git.js';

// findGitRoot импортирован для паритета с оригинальным модулем;
// в текущей логике поиска не вызывается (оставлено без изменений при миграции на TS).
void findGitRoot;

/**
 * Ищет директорию backlog от заданного пути.
 *
 * Порядок поиска:
 * 1. `<cwd>/backlog/`
 * 2. `<cwd>/.backlog/`
 * 3. Рекурсивно вверх по родительским директориям
 *
 * @param cwd — начальная директория (обычно process.cwd())
 * @returns абсолютный путь к backlog-директории, или null
 */
export function findBacklogDir(cwd: string): string | null {
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
 */
function isBacklogDir(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  const entries = readdirSync(dir);
  return entries.includes('tasks') || entries.includes('config.yml');
}

/**
 * Возвращает путь к директории задач.
 */
export function tasksDir(backlogDir: string): string {
  return join(backlogDir, 'tasks');
}

/**
 * Возвращает путь к директории завершённых задач.
 */
export function completedDir(backlogDir: string): string {
  return join(backlogDir, 'completed');
}

/**
 * Возвращает путь к директории черновиков.
 */
export function draftsDir(backlogDir: string): string {
  return join(backlogDir, 'drafts');
}

/**
 * Возвращает путь к директории документов.
 */
export function docsDir(backlogDir: string): string {
  return join(backlogDir, 'docs');
}

/**
 * Возвращает путь к директории решений.
 */
export function decisionsDir(backlogDir: string): string {
  return join(backlogDir, 'decisions');
}

/**
 * Возвращает путь к директории вех (milestones).
 */
export function milestonesDir(backlogDir: string): string {
  return join(backlogDir, 'milestones');
}

/**
 * Возвращает путь к файлу конфига.
 *
 * Приоритет:
 * 1. `backlog/config.yml` (внутри backlog-директории)
 * 2. `backlog.config.yml` (корень проекта — родитель backlog-директории)
 */
export function configPath(backlogDir: string): string {
  const inside = join(backlogDir, 'config.yml');
  if (existsSync(inside)) return inside;

  // Корень проекта — родитель backlog-директории
  const projectRoot = dirname(backlogDir);
  const rootConfig = join(projectRoot, 'backlog.config.yml');
  return rootConfig;
}
