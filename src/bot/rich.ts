/**
 * Рендер Rich Markdown для Telegram Rich Messages (VL-39).
 *
 * Используется sendRichMessage (InputRichMessage.markdown) — GFM-синтаксис:
 * # заголовки, **жирный**, task lists, blockquotes. Лимит 32768 символов
 * (вместо 4096 у sendMessage) — разбивка нужна только для гигантских задач.
 *
 * Markdown-файлы задач уже GFM-совместимы — контент вставляется как есть;
 * служебные строки (меты, авторы) собираются здесь. ``` внутри контента
 * экранируются, чтобы не ломать структуру сообщения.
 *
 * Чистые функции без I/O — юнит-тестируемые.
 */

import type { ChecklistItem, Task } from '../core/task.js';

/** Лимит Rich Message по спецификации Telegram (символов UTF-8). */
export const RICH_LIMIT = 32768;

/**
 * Экранирует последовательности ``` внутри пользовательского контента.
 *
 * Тройные обратные слэши ломают блоки кода GFM — заменяем на безопасную
 * комбинацию (одиночные backticks с пробелом), не меняя читаемость.
 */
function fenceSafe(text: string): string {
  return text.replace(/```/g, '` ` `');
}

/** Нормализует элемент чеклиста: строка → {text, unchecked}. */
function checklistItem(item: ChecklistItem | string): { text: string; checked: boolean } {
  if (typeof item === 'string') return { text: item, checked: false };
  return { text: item.text, checked: item.checked };
}

/** Пустая ли секция (строка/массив без содержимого). */
function filled(value: string | (ChecklistItem | string)[] | undefined): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim().length > 0;
}

/** Блок «## Заголовок» + контент, либо пустая строка, если секции нет. */
function section(title: string, content: string): string {
  return content.trim() ? `## ${title}\n\n${content.trim()}\n` : '';
}

/** Чеклист AC/DoD → task list GFM: - [x] / - [ ]. */
function checklist(items: (ChecklistItem | string)[]): string {
  return items
    .map((raw) => {
      const { text, checked } = checklistItem(raw);
      return `- [${checked ? 'x' : ' '}] ${fenceSafe(text)}`;
    })
    .join('\n');
}

/**
 * Собирает полный Rich Markdown карточки задачи.
 *
 * @param task — задача (поля frontmatter + секции тела)
 * @returns GFM-разметка для InputRichMessage.markdown
 */
export function renderTaskRich(task: Task): string {
  const parts: string[] = [];

  // Шапка: жирный заголовок + строка меты
  parts.push(`# ${task.id} — ${task.title}\n`);

  const meta: string[] = [];
  if (task.status) meta.push(`**Статус:** ${task.status}`);
  if (task.priority) meta.push(`**Приоритет:** ${task.priority}`);
  if (task.assignee.length > 0) meta.push(`**Исполнители:** ${task.assignee.join(', ')}`);
  if (task.labels.length > 0) meta.push(`**Метки:** ${task.labels.join(', ')}`);
  if (task.due_date) meta.push(`**Срок:** ${task.due_date}`);
  if (meta.length > 0) parts.push(meta.join('  \n') + '\n');

  if (filled(task.description)) {
    parts.push(section('Описание', fenceSafe(task.description)));
  }
  if (filled(task.acceptanceCriteria)) {
    parts.push(section('Acceptance Criteria', checklist(task.acceptanceCriteria)));
  }
  if (filled(task.definitionOfDone)) {
    parts.push(section('Definition of Done', checklist(task.definitionOfDone)));
  }
  if (filled(task.implementationPlan)) {
    parts.push(section('Implementation Plan', fenceSafe(task.implementationPlan)));
  }
  if (filled(task.implementationNotes)) {
    parts.push(section('Implementation Notes', fenceSafe(task.implementationNotes)));
  }
  if (filled(task.finalSummary)) {
    parts.push(section('Final Summary', fenceSafe(task.finalSummary)));
  }
  if (task.comments.length > 0) {
    const comments = task.comments
      .map((c) => `**${c.author}** · ${c.created}\n\n${fenceSafe(c.text)}`)
      .join('\n\n---\n\n');
    parts.push(section('Комментарии', comments));
  }

  return parts.join('\n').trim();
}

/**
 * Разбивает длинный текст на части не больше limit по границам абзацев.
 *
 * На практике не задействуется (лимит 32768 — запас для гигантских задач),
 * но защищает от отказа API при экстремальных данных.
 *
 * @param text — Rich Markdown целиком
 * @param limit — максимальная длина части (по умолчанию RICH_LIMIT)
 */
export function chunkRich(text: string, limit: number = RICH_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    // Ищем границу абзаца/секции в пределах лимита
    const slice = rest.slice(0, limit);
    const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
    const cut = breakAt > limit * 0.5 ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
