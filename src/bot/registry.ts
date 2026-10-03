/**
 * Единый реестр команд Telegram-бота (VL-54).
 *
 * Источник правды для: (1) меню команд в клиенте Telegram — `setMyCommands`
 * при старте `vibelog bot`; (2) help-текстов /start в handlers.ts.
 * Ранее списки команд были захардкожены в двух местах handlers.ts
 * и рассинхронизировались при добавлении новой команды.
 */

import type { Bot } from 'grammy';

/**
 * Команда бота; структурно совместима с BotCommand из grammy
 * (лишнее поле usage допустимо при передаче переменной, не литерала).
 */
export interface RegistryCommand {
  /** Имя без слэша, ≤32 симв. (лимит Telegram). */
  command: string;
  /** Русское описание, ≤256 симв. (лимит Telegram). */
  description: string;
  /** Представление в help-строке /start (для /task — '/task <id>'). */
  usage?: string;
}

/** Все команды бота: имя + русское описание для меню Telegram. */
export const BOT_COMMANDS: RegistryCommand[] = [
  { command: 'start', description: 'Привязать чат: введите код из консоли' },
  { command: 'tasks', description: 'Список невыполненных задач' },
  { command: 'task', description: 'Детали задачи: /task VL-1', usage: '/task <id>' },
  { command: 'board', description: 'Канбан-доска задач' },
  { command: 'create', description: 'Создать задачу' },
  { command: 'status', description: 'Сменить статус задачи' },
  { command: 'comment', description: 'Добавить комментарий и выполнить его через Фазу Comment (qwen)' },
  { command: 'spec', description: 'Запустить Фазу 1 (Spec) через qwen' },
  { command: 'plan', description: 'Запустить Фазу 2 (Plan) через qwen' },
  { command: 'code', description: 'Запустить Фазу 3 (Code) через qwen' },
  { command: 'close', description: 'Закрыть задачу (Фаза Close) через qwen' },
];

/**
 * Help-строка для /start: все команды после /start, формат прежнего хардкода
 * в handlers.ts — поведение отправки (MarkdownV2) не меняется.
 */
export function commandsHelp(): string {
  return BOT_COMMANDS
    .filter((c) => c.command !== 'start')
    .map((c) => c.usage ?? '/' + c.command)
    .join(', ');
}

/**
 * Синхронизация меню команд в Telegram (setMyCommands при старте бота).
 * Ошибки сети/API логируются и не роняют бота — polling продолжается
 * (паттерн sendText/sendMd).
 */
export async function syncCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands(BOT_COMMANDS);
  } catch (err) {
    // Сетевой сбой не должен блокировать polling — бот работает и без меню
    console.error(
      'Не удалось синхронизировать команды с Telegram:',
      err instanceof Error ? err.message : String(err)
    );
  }
}
