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
 *
 * @returns message_id отправленного сообщения (VL-433: id идёт в память
 *   ветки) либо undefined при сетевом сбое
 */
async function sendMdFallback(
  bot: Bot,
  chatId: number,
  text: string,
  replyTo?: number,
): Promise<number | undefined> {
  const other = replyTo !== undefined ? { reply_parameters: { message_id: replyTo } } : {};
  const idOf = (res: unknown): number | undefined =>
    typeof res === 'object' && res !== null && typeof (res as { message_id?: unknown }).message_id === 'number'
      ? (res as { message_id: number }).message_id
      : undefined;
  try {
    const res = await bot.api.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', ...other });
    return idOf(res);
  } catch {
    try {
      const res = await bot.api.sendMessage(chatId, text, other);
      return idOf(res);
    } catch {
      // Сеть недоступна — сообщение теряется, polling продолжится
      return undefined;
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
 * @returns message_id всех реально отправленных частей (VL-433: ids нужны
 *   для регистрации пары «вопрос/ответ» в памяти ветки). Удалённый при
 *   richDroppedReply id НЕ возвращается; ничего не ушло — пустой массив.
 */
export async function sendChatAnswer(
  bot: Bot,
  chatId: number,
  text: string,
  opts: { replyTo?: number } = {},
): Promise<number[]> {
  const sentIds: number[] = [];
  const idOf = (res: unknown): number | undefined =>
    typeof res === 'object' && res !== null && typeof (res as { message_id?: unknown }).message_id === 'number'
      ? (res as { message_id: number }).message_id
      : undefined;
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
          const id = await sendMdFallback(bot, chatId, part, opts.replyTo);
          if (id !== undefined) sentIds.push(id);
        } else {
          // Непроверяемый ответ (без числового id) — просто не регистрируем
          const id = idOf(res);
          if (id !== undefined) sentIds.push(id);
        }
      } else {
        const res = await bot.api.sendRichMessage(chatId, { markdown: part });
        const id = idOf(res);
        if (id !== undefined) sentIds.push(id);
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
      const id = await sendMdFallback(bot, chatId, part, opts.replyTo);
      if (id !== undefined) sentIds.push(id);
    }
  }
  return sentIds;
}
