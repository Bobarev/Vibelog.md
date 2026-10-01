/**
 * Генерация уникальных ID для задач Vibelog.md / Backlog.md.
 *
 * Формат ID: `<prefix>-<n>` где prefix — из конфига (например "back"),
 * а n — максимальный номер среди существующих задач + 1.
 *
 * Подзадачи используют десятичную нумерацию: `back-100.1`, `back-100.2`.
 */

import { readdirSync, existsSync } from 'node:fs';
import { tasksDir, completedDir, findBacklogDir } from './paths.js';

/**
 * Генерирует следующий ID задачи.
 *
 * Сканирует директории `tasks/` и `completed/`, находит максимальный номер
 * и возвращает следующий.
 *
 * @param cwd — текущая рабочая директория
 * @param prefix — префикс ID (например "back")
 * @throws если backlog-директория не найдена
 */
export function nextTaskId(cwd: string, prefix: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена. Выполните "vibelog init".');
  }

  const maxNum = scanMaxNumber(backlogDir, prefix);
  return `${prefix}-${maxNum + 1}`;
}

/**
 * Сканирует директории задач и находит максимальный номер.
 *
 * Учитывает как основные задачи (`back-100`), так и подзадачи (`back-100.1`).
 * Подзадачи не влияют на основную нумерацию — берётся только целая часть.
 *
 * @returns максимальный найденный номер (0, если задач нет)
 */
function scanMaxNumber(backlogDir: string, prefix: string): number {
  let max = 0;
  const dirs = [tasksDir(backlogDir), completedDir(backlogDir)];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir);
    for (const file of files) {
      // Извлекаем номер из имени файла: `back-100 - Title.md` → `100`
      // Подзадачи: `back-100.1 - Title.md` → `100` (берём целую часть)
      const match = file.match(new RegExp(`^${escapeRegex(prefix)}-(\\d+)`));
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
  }

  return max;
}

/**
 * Экранирует спецсимволы регулярного выражения.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
