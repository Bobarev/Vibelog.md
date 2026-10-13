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
  { command: 'docs', description: 'Список документов' },
  { command: 'doc', description: 'Документ: /doc doc-1', usage: '/doc <id>' },
  { command: 'board', description: 'Канбан-доска задач' },
  { command: 'diff', description: 'Незакоммиченные файлы (git status)' },
  { command: 'commits', description: 'Последние коммиты git (log)', usage: '/commits [N]' },
  { command: 'create', description: 'Создать задачу' },
  { command: 'status', description: 'Сменить статус задачи' },
  { command: 'set', description: 'Настройки бота: агент, лимиты фаз, режим веток, компакшн', usage: '/set agent <qwen|vb> | max-wall-time <сек> | max-requests <N> | branch-mode <on|off> | compact <on|off>' },
  { command: 'comment', description: 'Комментарий + Фаза Comment: /comment[:agent] VL-1 текст', usage: '/comment[:agent] VL-1 <текст>' },
  { command: 'spec', description: 'Фаза 1 (Spec): /spec[:agent] описание фичи', usage: '/spec[:agent] <описание>' },
  { command: 'plan', description: 'Фаза 2 (Plan): /plan[:agent] VL-<id> [комментарий]', usage: '/plan[:agent] VL-<id> [комментарий]' },
  { command: 'code', description: 'Фаза 3 (Code): /code[:agent] VL-<id> [комментарий]', usage: '/code[:agent] VL-<id> [комментарий]' },
  { command: 'close', description: 'Закрыть задачу (Фаза Close): /close[:agent] VL-<id>', usage: '/close[:agent] VL-<id>' },
  { command: 'prompt', description: 'Запрос LLM без задачи: qwen или встроенный агент (/prompt:vb)', usage: '/prompt[:agent] <текст>' },
  { command: 'analyze', description: 'Анализ сессии агента — статистика, вердикт, рекомендации: /analyze vb:agent-XXX', usage: '/analyze[:agent] <session-ref>' },
  { command: 'restart', description: 'Перезапустить бота: /restart [VL-N] — из ветки vb/vl-N, без аргумента — из корневого dist/' },
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
