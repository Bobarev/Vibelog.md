/**
 * Форматирование данных для Telegram-ответов бота (VL-34, VL-38).
 *
 * Выход — разметка Telegram MarkdownV2: жирные ID/заголовки/метки,
 * статусы в скобках. Динамический текст из backlog ОБЯЗАН экранироваться
 * (escapeMarkdownV2): заголовки и описания задач могут содержать любые
 * спецсимволы MarkdownV2, и неэкранированные ломают парсинг сообщения.
 *
 * Чистые функции без I/O — юнит-тестируемые.
 */

import type { Task } from '../core/task.js';
import type { PhaseRun } from '../web/orchestrator.js';

/**
 * Экранирует спецсимволы Telegram MarkdownV2.
 *
 * По спецификации Telegram в обычном тексте обязаны экранироваться:
 * _ * [ ] ( ) ~ ` > # + - = | { } . ! и сам обратный слэш.
 *
 * @param text — произвольный текст (заголовок, описание, статус)
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Список задач для /tasks: жирный ID, статус в скобках.
 *
 * @param tasks — задачи для отображения
 */
export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return 'Задач нет';
  return tasks
    .map(
      (t) =>
        `*${escapeMarkdownV2(t.id)}* — ${escapeMarkdownV2(t.title)} \\[${escapeMarkdownV2(t.status)}\\]`
    )
    .join('\n');
}

/**
 * Строка статуса фазы qwen для задачи (VL-43).
 *
 * @param run — запуск фазы из оркестратора (getRun)
 * @returns MarkdownV2-строка либо '' если данных о запуске нет
 */
export function formatPhaseRun(run: PhaseRun | null | undefined): string {
  if (!run || !run.phase) return '';
  const phase = escapeMarkdownV2(run.phase);
  if (run.running) {
    return `*Фаза ${phase}: выполняется \\(PID ${run.pid ?? '—'}\\)*`;
  }
  if (run.exitCode === 0) {
    return `*Фаза ${phase}: завершена \\(код 0\\)*`;
  }
  return `*Фаза ${phase}: ошибка \\(код ${run.exitCode ?? '—'}\\)*`;
}

/**
 * Детали задачи для /task: жирный заголовок, метки полей, описание.
 *
 * @param task — задача
 * @param phaseRun — запуск фазы qwen (VL-43); строка вставляется после статуса
 */
export function formatTaskDetail(task: Task, phaseRun?: PhaseRun): string {
  const lines = [
    `*${escapeMarkdownV2(task.id)} — ${escapeMarkdownV2(task.title)}*`,
    `*Статус:* ${escapeMarkdownV2(task.status)}`,
    `*Приоритет:* ${escapeMarkdownV2(task.priority || '—')}`,
  ];
  // VL-43: строка статуса фазы qwen — сразу после статуса задачи
  const phaseLine = formatPhaseRun(phaseRun);
  if (phaseLine) lines.splice(2, 0, phaseLine);
  if (task.assignee.length > 0) {
    lines.push(`*Исполнители:* ${escapeMarkdownV2(task.assignee.join(', '))}`);
  }
  if (task.labels.length > 0) {
    lines.push(`*Метки:* ${escapeMarkdownV2(task.labels.join(', '))}`);
  }
  if (task.due_date) {
    lines.push(`*Срок:* ${escapeMarkdownV2(task.due_date)}`);
  }
  if (task.description) {
    // Ограничение: Telegram-сообщение — до 4096 символов
    const desc =
      task.description.length > 1500 ? task.description.slice(0, 1500) + '…' : task.description;
    lines.push('', escapeMarkdownV2(desc));
  }
  return lines.join('\n');
}

/**
 * Сводка доски для /board: жирные названия колонок + количество.
 *
 * @param statuses — статусы колонок из конфига
 * @param tasks — все задачи
 */
export function formatBoard(statuses: string[], tasks: Task[]): string {
  if (statuses.length === 0) return 'Статусы не настроены в конфиге';
  return statuses
    .map((s) => `*${escapeMarkdownV2(s)}:* ${tasks.filter((t) => t.status === s).length}`)
    .join('\n');
}
