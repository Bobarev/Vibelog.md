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
import { formatBoard, formatTaskDetail, formatTaskList } from './formatting.js';
import { loadBotSettings, saveBotSettings } from './settings.js';

/** Зависимости обработчиков (пин — из замыкания runBot, cwd — проект). */
export interface HandlerDeps {
  cwd: string;
  /** Актуальный пин-код текущей сессии. */
  getPin: () => string;
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
    void ctx.reply('Бот не привязан к чату — выполните /start');
    return false;
  }

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    if (loadBotSettings(deps.cwd).chats.includes(chatId)) {
      await ctx.reply('Чат уже привязан. Команды: /tasks, /task <id>, /board');
      return;
    }
    awaitingPin.add(chatId);
    await ctx.reply(
      'Чат не привязан. Введите код привязки (отображается в консоли запущенного vibelog bot):'
    );
  });

  // Ввод пина — обычный текст от чата в режиме ожидания.
  // Регистрируется ПОСЛЕ bot.command: в grammy цепочка останавливается
  // на обработчике, не вызвавшем next(), поэтому команды сюда не попадают.
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !awaitingPin.has(chatId)) return;
    // ctx.message.text — так typings grammy фильтруют message:text
    if (ctx.message.text.trim() === deps.getPin()) {
      const settings = loadBotSettings(deps.cwd);
      if (!settings.chats.includes(chatId)) settings.chats.push(chatId);
      saveBotSettings(deps.cwd, settings);
      awaitingPin.delete(chatId);
      await ctx.reply('Чат привязан. Команды: /tasks, /task <id>, /board');
    } else {
      await ctx.reply('Неверный код. Проверьте консоль запущенного vibelog bot.');
    }
  });

  bot.command('tasks', async (ctx) => {
    if (!requireBind(ctx)) return;
    const tasks = listTasks(deps.cwd).filter((t) => t.status !== 'Done');
    await ctx.reply(formatTaskList(tasks));
  });

  bot.command('task', async (ctx) => {
    if (!requireBind(ctx)) return;
    const id = (ctx.match ?? '').toString().trim();
    if (!id) {
      await ctx.reply('Укажите ID задачи: /task VL-1');
      return;
    }
    const task = getTask(deps.cwd, id);
    if (!task) {
      await ctx.reply(`Задача ${id} не найдена.`);
      return;
    }
    await ctx.reply(formatTaskDetail(task));
  });

  bot.command('board', async (ctx) => {
    if (!requireBind(ctx)) return;
    const config = loadConfig(deps.cwd);
    const statuses = Array.isArray(config.statuses) ? config.statuses.map(String) : [];
    await ctx.reply(formatBoard(statuses, listTasks(deps.cwd)));
  });
}
