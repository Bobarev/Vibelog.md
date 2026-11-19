/**
 * Тесты VL-414 — rich-отправка ответа персоны в режиме /chat.
 *
 * Без сети: подменный bot с api.sendRichMessage/sendMessage (паттерн
 * registry.test.mjs — мок только нужных методов).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { sendChatAnswer } from '../../dist/bot/chat-answer.js';
import { RICH_LIMIT } from '../../dist/bot/rich.js';
import { TELEGRAM_TEXT_LIMIT } from '../../dist/bot/formatting.js';

/**
 * Фейковый bot: пишет вызовы в журнал.
 *
 * @param opts.richFails — sendRichMessage бросает (проверка фолбэка)
 * @param opts.mdFails — sendMessage с parse_mode бросает (проверка plain)
 * @param opts.richReply — что rich-сервер возвращает при reply_parameters:
 *   'with' — message_id + reply_to_message (reply принят),
 *   'without' — только message_id (reply проигнорирован, VL-429),
 *   по умолчанию {} — ответ непроверяем (детект невозможен)
 * @param opts.deleteFails — deleteMessage бросает (VL-429: reply всё равно досылается)
 * @param opts.mdHardFail — sendMessage бросает всегда (VL-433: полный сбой сети)
 */
function fakeBot(opts = {}) {
  const calls = [];
  let msgSeq = 70; // инкрементальные message_id sendMessage (VL-433: возврат ids)
  return {
    calls,
    api: {
      async sendRichMessage(chatId, rich, other) {
        if (opts.richFails) throw new Error('400 RICH_MESSAGE_UNSUPPORTED');
        calls.push({ method: 'rich', chatId, markdown: rich.markdown, other });
        if (opts.richReply === 'with') {
          return { message_id: 55, reply_to_message: { message_id: other?.reply_parameters?.message_id } };
        }
        if (opts.richReply === 'without') return { message_id: 55 };
        return {};
      },
      async sendMessage(chatId, text, other) {
        if (opts.mdHardFail) throw new Error('NETWORK_DOWN');
        if (opts.mdFails && other?.parse_mode) throw new Error("400 can't parse entities");
        calls.push({
          method: 'text',
          chatId,
          text,
          parseMode: other?.parse_mode,
          replyTo: other?.reply_parameters?.message_id,
        });
        return { message_id: ++msgSeq };
      },
      async deleteMessage(chatId, messageId) {
        if (opts.deleteFails) throw new Error('400 MESSAGE_DELETE_FAILED');
        calls.push({ method: 'delete', chatId, messageId });
        return true;
      },
    },
  };
}

describe('sendChatAnswer (VL-414)', () => {
  it('AC1: ответ уходит через sendRichMessage с GFM как есть', async () => {
    const bot = fakeBot();
    await sendChatAnswer(bot, 42, '**жирный** и `код`');
    assert.equal(bot.calls.length, 1);
    assert.equal(bot.calls[0].method, 'rich');
    assert.equal(bot.calls[0].chatId, 42);
    assert.equal(bot.calls[0].markdown, '**жирный** и `код`');
  });

  it('AC3: отказ sendRichMessage → фолбэк MarkdownV2 через sendMessage', async () => {
    const bot = fakeBot({ richFails: true });
    await sendChatAnswer(bot, 7, 'ответ персоны');
    assert.equal(bot.calls.length, 1);
    assert.equal(bot.calls[0].method, 'text');
    assert.equal(bot.calls[0].parseMode, 'MarkdownV2');
    assert.equal(bot.calls[0].text, 'ответ персоны');
  });

  it('AC3: отказ и rich, и MarkdownV2 → plain, сообщение не теряется', async () => {
    const bot = fakeBot({ richFails: true, mdFails: true });
    await sendChatAnswer(bot, 7, 'ответ персоны');
    assert.equal(bot.calls.length, 1, 'MarkdownV2-попытка упала, записан только plain');
    assert.equal(bot.calls[0].method, 'text');
    assert.equal(bot.calls[0].parseMode, undefined, 'второй заход — без parse_mode');
    assert.equal(bot.calls[0].text, 'ответ персоны');
  });

  it('длинный ответ режется по rich-лимиту (chunkRich), а не по 4096', async () => {
    const bot = fakeBot();
    // 5000 символов: больше TELEGRAM_TEXT_LIMIT, но меньше RICH_LIMIT
    const text = 'строка текста\n'.repeat(360);
    assert.ok(text.length > TELEGRAM_TEXT_LIMIT && text.length < RICH_LIMIT);
    await sendChatAnswer(bot, 1, text);
    assert.equal(bot.calls.length, 1, 'в пределах rich-лимита — одно сообщение');
    assert.equal(bot.calls[0].method, 'rich');
  });

  it('фолбэк режет длинный текст splitNumbered с нумерацией частей', async () => {
    const bot = fakeBot({ richFails: true });
    const text = 'строка текста\n'.repeat(600); // > 4096
    await sendChatAnswer(bot, 1, text);
    assert.ok(bot.calls.length > 1, 'длинный текст разбит на части');
    for (const call of bot.calls) {
      assert.equal(call.method, 'text');
      assert.ok(call.text.length <= TELEGRAM_TEXT_LIMIT, 'часть в пределах лимита');
    }
    assert.ok(
      bot.calls[0].text.includes('_часть 1\\/'),
      `нумерация частей в MarkdownV2, получено: ${JSON.stringify(bot.calls[0].text.slice(-40))}`
    );
  });

  // ── VL-429 (фикс 2): replyTo обязан дойти с reply ──

  it('VL-429 AC6: rich принял reply_parameters (reply_to_message в ответе) — фолбэка нет', async () => {
    const bot = fakeBot({ richReply: 'with' });
    await sendChatAnswer(bot, 42, 'ответ с reply', { replyTo: 7 });
    assert.equal(bot.calls.length, 1, 'ответ ушёл одним rich-сообщением');
    assert.equal(bot.calls[0].method, 'rich');
    assert.equal(bot.calls[0].other.reply_parameters.message_id, 7, 'третий аргумент передан');
  });

  it('VL-429 AC6: rich проигнорировал reply_parameters → delete + sendMessage с reply', async () => {
    const bot = fakeBot({ richReply: 'without' });
    await sendChatAnswer(bot, 42, 'ответ с reply', { replyTo: 7 });
    const methods = bot.calls.map((c) => c.method);
    assert.deepEqual(methods, ['rich', 'delete', 'text'], 'rich без reply удаляется и досылается');
    const text = bot.calls.find((c) => c.method === 'text');
    assert.equal(text.replyTo, 7, 'фолбэк обязан нести reply_parameters — тикет ловит ответ');
  });

  it('VL-429 AC6: ответ rich непроверяем (без message_id) — без фолбэка и дублей', async () => {
    const bot = fakeBot();
    await sendChatAnswer(bot, 42, 'ответ с reply', { replyTo: 7 });
    assert.equal(bot.calls.length, 1, 'непроверяемый ответ ≠ проигнорированный reply');
    assert.equal(bot.calls[0].method, 'rich');
  });

  it('VL-429 AC6: deleteMessage упал — sendMessage с reply всё равно уходит', async () => {
    const bot = fakeBot({ richReply: 'without', deleteFails: true });
    await sendChatAnswer(bot, 42, 'ответ с reply', { replyTo: 7 });
    const text = bot.calls.find((c) => c.method === 'text');
    assert.ok(text, 'дубль лучше потерянного reply (AC6)');
    assert.equal(text.replyTo, 7);
  });

  // ── VL-433: возврат message_id для памяти ветки ──

  it('VL-433: возвращает ids отправленных rich-частей (reply принят)', async () => {
    const bot = fakeBot({ richReply: 'with' });
    const ids = await sendChatAnswer(bot, 42, 'ответ с reply', { replyTo: 7 });
    assert.deepEqual(ids, [55], 'id rich-ответа возвращается');
  });

  it('VL-433: rich проигнорировал reply → удалённый id НЕ возвращается, id фолбэка — возвращается', async () => {
    const bot = fakeBot({ richReply: 'without' });
    const ids = await sendChatAnswer(bot, 42, 'ответ с reply', { replyTo: 7 });
    assert.deepEqual(ids, [71], 'только id досланного sendMessage (первый msgSeq)');
  });

  it('VL-433: непроверяемый ответ (без message_id) — пустой массив, не падение', async () => {
    const bot = fakeBot();
    const ids = await sendChatAnswer(bot, 42, 'ответ с reply', { replyTo: 7 });
    assert.deepEqual(ids, [], 'id нет — пара в память не пишется');
  });

  it('VL-433: полный сбой сети — пустой массив (сообщение потеряно, ошибок нет)', async () => {
    const bot = fakeBot({ richFails: true, mdHardFail: true });
    const ids = await sendChatAnswer(bot, 42, 'ответ персоны');
    assert.deepEqual(ids, []);
  });
});
