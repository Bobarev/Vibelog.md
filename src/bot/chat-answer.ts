/**
 * Отправка ответа персоны в режиме `/chat` (VL-414).
 *
 * Зачем отдельный модуль: ответ персоны — это GFM-текст модели (`**жирный**`,
 * заголовки, списки, код-блоки). Через `sendMd` (MarkdownV2 без экранирования)
 * Telegram отвечает `400 can't parse entities`, и сообщение доходит plain.
 * Карточки задач (`sendTaskView`, `sendPhaseResult`) шлются иначе —
 * `bot.api.sendRichMessage(chatId, { markdown })`, где текст передаётся как
 * есть. Здесь тот же механизм, вынесенный в общий помощник: две точки вывода
 * ответа персоны (`/chat <id>` и перехватчик `message:text`) не должны
 * расходиться в поведении (lesson-37: одна логика — один модуль).
 *
 * Почему не в `handlers.ts`: `handlers.ts` импортирует этот модуль, обратный
 * импорт дал бы цикл, а тесты тянули бы весь бот. Поэтому `sendMdFallback` —
 * локальная копия `sendText` из `handlers.ts` (MarkdownV2 → plain).
 */

import type { Bot } from 'grammy';

import { splitNumbered, TELEGRAM_TEXT_LIMIT } from './formatting.js';
import { chunkRich } from './rich.js';

/**
 * Отправка текста по chatId: MarkdownV2 с фолбэком на plain.
 *
 * Копия `sendText` из `handlers.ts` (там она приватная, а импорт дал бы цикл).
 * Обе ветки глушат сетевые ошибки: сообщение теряется, но polling продолжается.
 */
async function sendMdFallback(
  bot: Bot,
  chatId: number,
  text: string,
  replyTo?: number,
): Promise<void> {
  const other = replyTo !== undefined ? { reply_parameters: { message_id: replyTo } } : {};
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', ...other });
  } catch {
    try {
      await bot.api.sendMessage(chatId, text, other);
    } catch {
      // Сеть недоступна — сообщение теряется, polling продолжится
    }
  }
}

/**
 * Отправить ответ персоны в Telegram как Rich Message (GFM).
 *
 * Паттерн `sendPhaseResult` (`handlers.ts`): `chunkRich` по rich-лимиту
 * (32768) → `sendRichMessage` по частям; при исключении — фолбэк на
 * MarkdownV2 через `splitNumbered` (лимит 4096, резка по границам строк —
 * `chunkRich` с лимитом 4096 рвал бы escape-последовательности, lesson VL-148),
 * затем plain (внутри `sendMdFallback`).
 *
 * @param bot — экземпляр grammy Bot
 * @param chatId — адресат
 * @param text — сырой GFM-текст ответа персоны
 * @param opts.replyTo — message_id, на которое ответить reply (VL-428:
 *   ответ чужому боту в канале обязан быть reply на его вопрос)
 */
export async function sendChatAnswer(
  bot: Bot,
  chatId: number,
  text: string,
  opts: { replyTo?: number } = {},
): Promise<void> {
  try {
    for (const part of chunkRich(text)) {
      if (opts.replyTo !== undefined) {
        // Каст: rich-расширение принимает reply_parameters третьим аргументом;
        // если сервер их проигнорирует — сообщение уйдёт без reply, но контент
        // не потеряется (главное — ответ дошёл)
        await (
          bot.api.sendRichMessage as unknown as (
            chatId: number,
            payload: unknown,
            other?: unknown,
          ) => Promise<unknown>
        )(chatId, { markdown: part }, { reply_parameters: { message_id: opts.replyTo } });
      } else {
        await bot.api.sendRichMessage(chatId, { markdown: part });
      }
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    // VL-148: длинный текст режется по строкам с нумерацией «часть i/N»;
    // `/` в MarkdownV2 обязан быть экранирован (`\/`)
    const parts = splitNumbered(
      text,
      TELEGRAM_TEXT_LIMIT,
      (i, n) => `\n\n_часть ${i}\\/${n}_`
    );
    for (const part of parts) {
      await sendMdFallback(bot, chatId, part, opts.replyTo);
    }
  }
}
