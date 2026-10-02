/**
 * Форматирование данных для Telegram-ответов бота (VL-34).
 *
 * Чистые функции без I/O — юнит-тестируемые.
 */

import type { Task } from '../core/task.js';

/**
 * Список задач для /tasks: «VL-1 — Заголовок [статус]».
 *
 * @param tasks — задачи для отображения
 */
export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return 'Задач нет.';
  return tasks.map((t) => `${t.id} — ${t.title} [${t.status}]`).join('\n');
}

/**
 * Детали задачи для /task.
 *
 * @param task — задача
 */
export function formatTaskDetail(task: Task): string {
  const lines = [
    `${task.id} — ${task.title}`,
    `Статус: ${task.status}`,
    `Приоритет: ${task.priority || '—'}`,
  ];
  if (task.assignee.length > 0) lines.push(`Исполнители: ${task.assignee.join(', ')}`);
  if (task.labels.length > 0) lines.push(`Метки: ${task.labels.join(', ')}`);
  if (task.due_date) lines.push(`Срок: ${task.due_date}`);
  if (task.description) {
    // Ограничение: Telegram-сообщение — до 4096 символов
    const desc = task.description.length > 1500 ? task.description.slice(0, 1500) + '…' : task.description;
    lines.push('', desc);
  }
  return lines.join('\n');
}

/**
 * Сводка доски для /board: колонка — количество задач.
 *
 * @param statuses — статусы колонок из конфига
 * @param tasks — все задачи
 */
export function formatBoard(statuses: string[], tasks: Task[]): string {
  if (statuses.length === 0) return 'Статусы не настроены в конфиге.';
  return statuses
    .map((s) => {
      const count = tasks.filter((t) => t.status === s).length;
      return `${s}: ${count}`;
    })
    .join('\n');
}
