/**
 * Команда `vibelog bot` — Telegram-бот на grammy (VL-34).
 *
 * Запускает long-polling процесс: генерирует пин-код привязки (печатается
 * только в консоль), регистрирует обработчики команд, слушает Telegram API.
 */

import { Bot } from 'grammy';
import { resolveToken } from '../../bot/settings.js';
import { generatePin } from '../../bot/pin.js';
import { registerHandlers } from '../../bot/handlers.js';

/**
 * Выполняет команду bot.
 *
 * @param _positional — позиционные аргументы (не используются)
 * @param _flags — флаги (не используются)
 * @param cwd — рабочая директория проекта (backlog/ и .vibelog/ ищутся отсюда)
 */
export async function runBot(
  _positional: string[],
  _flags: Record<string, unknown>,
  cwd: string
): Promise<void> {
  const token = resolveToken(cwd);
  if (!token) {
    console.error(
      'Токен Telegram-бота не найден. Задайте TELEGRAM_BOT_TOKEN или telegram_token в .vibelog/bot.yml'
    );
    return;
  }

  const pin = generatePin();
  console.log(`Код привязки: ${pin}`);
  console.log('Введите его в Telegram командой /start. Ctrl+C — остановить бота.');

  const bot = new Bot(token);
  registerHandlers(bot, { cwd, getPin: () => pin });

  bot.catch((err) => {
    // grammy переживает сетевые сбои polling сам; логируем для диагностики
    console.error('Ошибка бота:', err.message);
  });

  try {
    // Long polling; grammy автоматически переподключается при сбоях сети
    await bot.start();
  } catch (err) {
    // Невалидный токен / нет сети — понятная ошибка вместо стектрейса
    console.error('Бот не запустился:', err instanceof Error ? err.message : String(err));
  }
}
