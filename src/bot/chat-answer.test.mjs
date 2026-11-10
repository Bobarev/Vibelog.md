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
 */
function fakeBot(opts = {}) {
  const calls = [];
  return {
    calls,
    api: {
      async sendRichMessage(chatId, rich) {
        if (opts.richFails) throw new Error('400 RICH_MESSAGE_UNSUPPORTED');
        calls.push({ method: 'rich', chatId, markdown: rich.markdown });
        return {};
      },
      async sendMessage(chatId, text, other) {
        if (opts.mdFails && other?.parse_mode) throw new Error("400 can't parse entities");
        calls.push({ method: 'text', chatId, text, parseMode: other?.parse_mode });
        return {};
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
});
