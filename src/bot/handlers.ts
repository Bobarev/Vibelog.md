/**
 * Обработчики Telegram-команд бота (VL-34).
 *
 * Пин-флоу привязки: /start → бот просит код → код печатается в консоль
 * запущенного vibelog bot → верный код привязывает chat_id (в .vibelog/bot.yml).
 * Все данные читаются через core-функции — формат backlog/ не меняется.
 */

import type { Bot, Context } from 'grammy';
import { getTask, listTasks } from '../core/store.js';
import { loadConfig } from '../core/config.js';
import { escapeMarkdownV2, formatBoard, formatTaskDetail, formatTaskList } from './formatting.js';
import { loadBotSettings, saveBotSettings } from './settings.js';

/** Зависимости обработчиков (пин — из замыкания runBot, cwd — проект). */
export interface HandlerDeps {
  cwd: string;
  /** Актуальный пин-код текущей сессии. */
  getPin: () => string;
}

/**
 * Ответ с форматированием MarkdownV2 (VL-38).
 *
 * При ошибке парсинга (400 can't parse entities — незакрытая сущность
 * в тексте) — повтор без форматирования, чтобы бот не молчал.
 */
async function sendMd(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: 'MarkdownV2' });
  } catch {
    try {
      await ctx.reply(text);
    } catch {
      // Сеть недоступна — игнорируем, polling продолжится
    }
  }
}

/**
 * Регистрирует команды бота: /start, /tasks, /task, /board.
 *
 * @param bot — экземпляр grammy Bot
 * @param deps — cwd проекта и геттер пина
 */
export function registerHandlers(bot: Bot, deps: HandlerDeps): void {
  // Чаты, ожидающие ввода пина (в памяти процесса, не в файле)
  const awaitingPin = new Set<number>();

  /** Проверка привязки чата; при отсутствии — ответ-подсказка. */
  function requireBind(ctx: Context): boolean {
    const chatId = ctx.chat?.id;
    if (chatId !== undefined && loadBotSettings(deps.cwd).chats.includes(chatId)) return true;
    void sendMd(ctx, 'Бот не привязан к чату — выполните /start');
    return false;
  }

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    if (loadBotSettings(deps.cwd).chats.includes(chatId)) {
      await sendMd(ctx, 'Чат уже привязан. Команды: /tasks, /task <id>, /board');
      return;
    }
    awaitingPin.add(chatId);
    await sendMd(
      ctx,
      'Чат не привязан. Введите код привязки (отображается в консоли запущенного vibelog bot):'
    );
  });

  bot.command('tasks', async (ctx) => {
    if (!requireBind(ctx)) return;
    const tasks = listTasks(deps.cwd).filter((t) => t.status !== 'Done');
    await sendMd(ctx, formatTaskList(tasks));
  });

  bot.command('task', async (ctx) => {
    if (!requireBind(ctx)) return;
    const id = (ctx.match ?? '').toString().trim();
    if (!id) {
      await sendMd(ctx, 'Укажите ID задачи: /task VL-1');
      return;
    }
    const task = getTask(deps.cwd, id);
    if (!task) {
      // id экранируется — пользователь вводит что угодно
      await sendMd(ctx, `Задача ${escapeMarkdownV2(id)} не найдена.`);
      return;
    }
    await sendMd(ctx, formatTaskDetail(task));
  });

  bot.command('board', async (ctx) => {
    if (!requireBind(ctx)) return;
    const config = loadConfig(deps.cwd);
    const statuses = Array.isArray(config.statuses) ? config.statuses.map(String) : [];
    await sendMd(ctx, formatBoard(statuses, listTasks(deps.cwd)));
  });

  // Ввод пина — ОБЯЗАТЕЛЬНО ПОСЛЕ ВСЕХ bot.command: catch-all message:text
  // перехватывает любое текстовое сообщение и без next() останавливает
  // цепочку grammy — зарегистрированный раньше него /tasks не сработал бы
  // (поймано ручной проверкой VL-37).
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !awaitingPin.has(chatId)) return;
    // ctx.message.text — так typings grammy фильтруют message:text
    if (ctx.message.text.trim() === deps.getPin()) {
      const settings = loadBotSettings(deps.cwd);
      if (!settings.chats.includes(chatId)) settings.chats.push(chatId);
      saveBotSettings(deps.cwd, settings);
      awaitingPin.delete(chatId);
      await sendMd(ctx, 'Чат привязан ✅ Команды: /tasks, /task <id>, /board');
    } else {
      await sendMd(ctx, 'Неверный код. Проверьте консоль запущенного vibelog bot.');
    }
  });


}
