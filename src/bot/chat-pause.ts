/**
 * Паузы хода веб-чата в Telegram-боте (VL-414): approval и question.
 *
 * Зачем отдельный модуль: у пауз своя, чистая логика — тексты карточек,
 * inline-клавиатуры и разбор `callback_data`. Держать это в `handlers.ts`
 * (1900+ строк) значило бы утопить UI-решения в обработчиках команд; здесь
 * всё чистое и тестируется без grammy и без сети.
 *
 * Ключевое решение — `callback_data` НЕ содержит `toolCallId`: лимит Telegram
 * 64 байта на кнопку, а id вызова модели бывает длинным. Состояние паузы
 * живёт в module-state бота по `chatId` (паттерн `awaitingComment`), в кнопке
 * лежит только решение (`chata:allow`) или индекс варианта (`chatq:2`).
 */

import { escapeMarkdownV2 } from './formatting.js';
import type { SupervisorGrantPreview } from '../web/supervisor.js';

/** Висящая пауза хода, привязанная к чату Telegram. */
export type ChatPause =
  | { kind: 'approval'; threadId: string; toolCallId: string; name: string }
  | {
      kind: 'question';
      threadId: string;
      toolCallId: string;
      allowCustom: boolean;
      options: { id: string; label: string }[];
    };

/** Разобранное нажатие inline-кнопки паузы. */
export type ChatCallback =
  | { kind: 'approval'; decision: 'allow' | 'deny' | 'always' }
  | { kind: 'question'; index: number };

/** Префикс callback_data кнопок approval (не пересекается с comment:/next:/resume:). */
export const APPROVAL_PREFIX = 'chata:';

/** Префикс callback_data кнопок-вариантов вопроса. */
export const QUESTION_PREFIX = 'chatq:';

/** Inline-клавиатура Telegram (базовый Bot API, не rich-расширение). */
export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

/**
 * Разобрать `callback_data` кнопки паузы.
 *
 * @returns решение/индекс либо null — callback чужой (обработчик зовёт next)
 */
export function parseChatCallback(data: string): ChatCallback | null {
  if (data.startsWith(APPROVAL_PREFIX)) {
    const decision = data.slice(APPROVAL_PREFIX.length);
    if (decision === 'allow' || decision === 'deny' || decision === 'always') {
      return { kind: 'approval', decision };
    }
    return null;
  }
  if (data.startsWith(QUESTION_PREFIX)) {
    const raw = data.slice(QUESTION_PREFIX.length);
    if (!/^\d{1,2}$/.test(raw)) return null;
    return { kind: 'question', index: Number(raw) };
  }
  return null;
}

/** Кнопки решения по write-операции: Allow / Deny / Always allow (VL-264). */
export function approvalKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✅ Разрешить', callback_data: `${APPROVAL_PREFIX}allow` },
        { text: '⛔ Отклонить', callback_data: `${APPROVAL_PREFIX}deny` },
      ],
      [{ text: '✅ Разрешить всегда', callback_data: `${APPROVAL_PREFIX}always` }],
    ],
  };
}

/**
 * Кнопки-варианты вопроса: по одной на вариант, по 2 в ряду.
 *
 * Подпись — `label`; `description` в подпись не поместится (лимит Telegram),
 * поэтому он выводится в тексте сообщения (`questionText`).
 */
export function questionKeyboard(options: { id: string; label: string }[]): InlineKeyboard {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(
      options.slice(i, i + 2).map((option, j) => ({
        text: option.label,
        callback_data: `${QUESTION_PREFIX}${i + j}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

/** Короткое превью аргументов инструмента для карточки подтверждения. */
function argsPreview(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const text =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : JSON.stringify(value);
    const short = text.length > 80 ? `${text.slice(0, 80)}…` : text;
    parts.push(short ? `${key}: ${short}` : key);
  }
  const joined = parts.join('\n');
  return joined.length > 300 ? `${joined.slice(0, 300)}…` : joined;
}

/**
 * Текст карточки подтверждения write-операции (MarkdownV2, всё экранировано).
 *
 * @param req — имя инструмента, его аргументы и (для супервизора) превью grant
 */
export function approvalText(req: {
  name: string;
  args?: Record<string, unknown>;
  grant?: SupervisorGrantPreview;
}): string {
  const lines = [
    '🔐 *Требуется подтверждение*',
    `Инструмент: \`${escapeMarkdownV2(req.name)}\``,
  ];
  const preview = argsPreview(req.args);
  if (preview) lines.push('', '```', preview, '```');
  if (req.grant) {
    const g = req.grant;
    lines.push(
      '',
      `Прогон: ${escapeMarkdownV2(g.runId)}`,
      `Задачи: ${escapeMarkdownV2(g.taskIds.join(', ') || '—')}`,
      `Срок: ${escapeMarkdownV2(g.expiresAt)}`
    );
  }
  lines.push('', 'Разрешить выполнение?');
  return lines.join('\n');
}

/**
 * Текст карточки вопроса (MarkdownV2): сам вопрос + варианты с описаниями.
 *
 * `description` выводится здесь, а не в подписи кнопки: Telegram не поместит
 * длинный текст в кнопку.
 */
export function questionText(req: {
  question: string;
  options: { id: string; label: string; description?: string }[];
  allowCustom: boolean;
}): string {
  const lines = ['❓ *Вопрос персоны*', '', escapeMarkdownV2(req.question), ''];
  for (const option of req.options) {
    const label = escapeMarkdownV2(option.label);
    lines.push(
      option.description
        ? `• *${label}* — ${escapeMarkdownV2(option.description)}`
        : `• *${label}*`
    );
  }
  lines.push(
    '',
    req.allowCustom
      ? 'Выберите вариант кнопкой или напишите свой ответ текстом.'
      : 'Выберите вариант кнопкой (свободный ввод для этого вопроса запрещён).'
  );
  return lines.join('\n');
}

/** Сообщение о снятом по TTL (24 ч) вопросе. */
export function expiredQuestionText(): string {
  return '⌛ Вопрос снят по таймауту (24 ч) — задайте его заново, если он ещё нужен.';
}
