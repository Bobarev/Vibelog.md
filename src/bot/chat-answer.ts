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
 * Rich-сервер проигнорировал reply_parameters (VL-429, фикс 2).
 *
 * Признак — вернулось сообщение с message_id, но без reply_to_message:
 * контент отправлен, а reply потерян, тикет ответ не поймает. Пустой/необъектный
 * ответ расширения трактуется как «непроверяемо» → без фолбэка (иначе каждый
 * вызов дублировался бы sendMessage).
 */
function richDroppedReply(res: unknown): boolean {
  if (res === null || typeof res !== 'object') return false;
  const obj = res as Record<string, unknown>;
  return typeof obj.message_id === 'number' && !('reply_to_message' in obj);
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
 *   ответ чужому боту в канале обязан быть reply на его вопрос; VL-429:
 *   если rich-сервер проигнорировал reply_parameters — сообщение удаляется
 *   и досылается через sendMessage с reply_parameters, reply не теряется)
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
        // Каст: rich-расширение принимает reply_parameters третьим аргументом.
        // VL-429 (фикс 2): ответ обязан дойти С reply — иначе тикет чужого
        // бота его не поймает (маскируется под «интербот молчит»). Если сервер
        // вернул сообщение без reply_to_message — третий аргумент проигнорирован:
        // удаляем его и досылаем через sendMessage с reply_parameters (AC6)
        const res = await (
          bot.api.sendRichMessage as unknown as (
            chatId: number,
            payload: unknown,
            other?: unknown,
          ) => Promise<unknown>
        )(chatId, { markdown: part }, { reply_parameters: { message_id: opts.replyTo } });
        if (richDroppedReply(res)) {
          const richMsg = res as { message_id: number };
          console.error(
            `sendRichMessage проигнорировал reply_parameters (message_id=${richMsg.message_id}) — фолбэк sendMessage с reply`,
          );
          try {
            await bot.api.deleteMessage(chatId, richMsg.message_id);
          } catch {
            // Удаление недоступно — досылаем с reply всё равно (reply важнее дубля)
          }
          await sendMdFallback(bot, chatId, part, opts.replyTo);
        }
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
