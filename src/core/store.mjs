/**
 * CRUD-операции с задачами Vibelog.md.
 *
 * Все операции работают с файловой системой напрямую:
 * читают/пишут markdown-файлы в директории backlog.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { findBacklogDir, tasksDir, completedDir } from './paths.mjs';
import { loadConfig } from './config.mjs';
import { createTask, taskToMarkdown, markdownToTask, taskFilename } from './task.mjs';
import { nextTaskId } from './id.mjs';

/**
 * Получает список всех активных задач.
 *
 * Читает все .md файлы из `backlog/tasks/` и парсит их.
 *
 * @param {string} cwd — текущая рабочая директория
 * @returns {object[]} — массив объектов задач
 */
export function listTasks(cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return [];

  const dir = tasksDir(backlogDir);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const content = readFileSync(join(dir, f), 'utf-8');
    return markdownToTask(content);
  });
}

/**
 * Получает задачу по ID.
 *
 * Ищет в `tasks/` и `completed/`.
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {string} id — ID задачи (например "back-100")
 * @returns {object|null} — объект задачи или null
 */
export function getTask(cwd, id) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return null;

  const idLower = id.toLowerCase();
  const dirs = [tasksDir(backlogDir), completedDir(backlogDir)];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      if (f.toLowerCase().startsWith(idLower + ' ') || f.toLowerCase().startsWith(idLower + '.')) {
        const content = readFileSync(join(dir, f), 'utf-8');
        return markdownToTask(content);
      }
    }
  }
  return null;
}

/**
 * Создаёт новую задачу.
 *
 * Генерирует ID, создаёт объект задачи, записывает markdown-файл
 * в `backlog/tasks/`.
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {object} input — входные данные задачи
 * @returns {object} — созданная задача
 * @throws {Error} — если backlog-директория не найдена
 */
export function createTaskFile(cwd, input) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена. Выполните "vibelog init".');
  }

  const config = loadConfig(cwd);
  const id = input.id || nextTaskId(cwd, config.task_prefix);
  const task = createTask({ ...input, id }, config);

  const dir = tasksDir(backlogDir);
  const filename = taskFilename(task);
  const content = taskToMarkdown(task);
  writeFileSync(join(dir, filename), content, 'utf-8');

  return task;
}

/**
 * Обновляет существующую задачу.
 *
 * Находит задачу по ID, применяет обновления, перезаписывает файл.
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {string} id — ID задачи
 * @param {object} updates — поля для обновления
 * @returns {object} — обновлённая задача
 * @throws {Error} — если задача не найдена
 */
export function updateTaskFile(cwd, id, updates) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена.');
  }

  const task = getTask(cwd, id);
  if (!task) {
    throw new Error(`Задача ${id} не найдена.`);
  }

  // Находим путь к файлу
  const filePath = findTaskFilePath(backlogDir, id);
  if (!filePath) {
    throw new Error(`Файл задачи ${id} не найден.`);
  }

  // Применяем обновления
  const updated = { ...task, ...updates, updated_date: formatDateTime(new Date()) };
  const content = taskToMarkdown(updated);
  writeFileSync(filePath, content, 'utf-8');

  return updated;
}

/**
 * Архивирует задачу (перемещает из tasks/ в completed/).
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {string} id — ID задачи
 * @throws {Error} — если задача не найдена
 */
export function archiveTaskFile(cwd, id) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена.');
  }

  const filePath = findTaskFilePath(backlogDir, id);
  if (!filePath) {
    throw new Error(`Задача ${id} не найдена в tasks/.`);
  }

  const filename = filePath.split('/').pop();
  const dest = join(completedDir(backlogDir), filename);
  renameSync(filePath, dest);
}

/**
 * Помечает задачу как завершённую (меняет статус на "Done" и архивирует).
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {string} id — ID задачи
 * @returns {object} — обновлённая задача
 */
export function completeTaskFile(cwd, id) {
  const task = updateTaskFile(cwd, id, { status: 'Done' });
  archiveTaskFile(cwd, id);
  return task;
}

/**
 * Ищет файл задачи по ID и возвращает путь.
 *
 * @param {string} backlogDir — путь к backlog-директории
 * @param {string} id — ID задачи
 * @returns {string|null} — абсолютный путь к файлу или null
 */
function findTaskFilePath(backlogDir, id) {
  const dir = tasksDir(backlogDir);
  if (!existsSync(dir)) return null;

  const idLower = id.toLowerCase();
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    if (f.toLowerCase().startsWith(idLower + ' ') || f.toLowerCase().startsWith(idLower + '.')) {
      return join(dir, f);
    }
  }
  return null;
}

/**
 * Форматирует дату в формате YYYY-MM-DD HH:MM.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}
