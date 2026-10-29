/**
 * Единый реестр команд Telegram-бота (VL-54).
 *
 * Источник правды для: (1) меню команд в клиенте Telegram — `setMyCommands`
 * при старте `vibelog bot`; (2) help-текстов /start в handlers.ts.
 * Ранее списки команд были захардкожены в двух местах handlers.ts
 * и рассинхронизировались при добавлении новой команды.
 */

import type { Bot } from 'grammy';
import { escapeMarkdownV2 } from './formatting.js';

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
  /** Примеры вызова для /help (VL-150); в setMyCommands не передаются. */
  examples?: string[];
}

/** Все команды бота: имя + русское описание для меню Telegram. */
export const BOT_COMMANDS: RegistryCommand[] = [
  { command: 'start', description: 'Привязать чат: введите код из консоли' },
  { command: 'help', description: 'Все команды: описание и примеры (/help)' },
  { command: 'tasks', description: 'Список невыполненных задач' },
  { command: 'task', description: 'Детали задачи: /task VL-1', usage: '/task <id>', examples: ['/task VL-1'] },
  { command: 'docs', description: 'Список документов' },
  { command: 'doc', description: 'Документ: /doc doc-1', usage: '/doc <id>', examples: ['/doc doc-1'] },
  { command: 'board', description: 'Канбан-доска задач' },
  { command: 'diff', description: 'Незакоммиченные файлы (git status)' },
  { command: 'commits', description: 'Последние коммиты git (log)', usage: '/commits [N]', examples: ['/commits 10'] },
  { command: 'create', description: 'Создать задачу' },
  { command: 'status', description: 'Сменить статус задачи', examples: ['/status VL-1 In Progress'] },
  { command: 'move', description: 'Ручной переход статуса по workflow (Backlog → To Do и др.)', usage: '/move <id> <статус>', examples: ['/move VL-1 To Do'] },
  { command: 'set', description: 'Настройки бота: агент, модель LLM, лимиты фаз, режим веток, компакшн', usage: '/set agent <qwen|vb> | model <id> | max-wall-time <сек> | max-requests <N> | branch-mode <on|off> | compact <on|off>', examples: ['/set agent vb', '/set model routerai/xiaomi/mimo-v2.6-pro', '/set max-wall-time 1800', '/set branch-mode on', '/set compact off'] },
  // VL-209: /model — список моделей (после /set, как в handlers.ts)
  { command: 'model', description: 'Список LLM-моделей (активная ✅)', usage: '/model', examples: ['/model'] },
  // Порядок = порядок bot.command в handlers.ts (VL-191: auto после /set, перед /comment —
  // тест registry.test «реестр покрывает все bot.command» сверяет имена и порядок)
  { command: 'auto', description: 'Автоочередь фаз: /auto add|start|stop|status', usage: '/auto add VL-N … | start | stop | status', examples: ['/auto add VL-1 VL-2', '/auto start', '/auto status'] },
  { command: 'comment', description: 'Комментарий + Фаза Comment: /comment[:agent] VL-1 текст', usage: '/comment[:agent] VL-1 <текст>', examples: ['/comment VL-1 добавь тесты', '/comment:vb VL-1 перепиши план'] },
  { command: 'spec', description: 'Фаза 1 (Spec): /spec[:agent] описание фичи', usage: '/spec[:agent] <описание>', examples: ['/spec добавь экспорт задач в CSV'] },
  { command: 'plan', description: 'Фаза 2 (Plan): /plan[:agent] VL-<id> [комментарий]', usage: '/plan[:agent] VL-<id> [комментарий]', examples: ['/plan VL-12', '/plan:vb VL-12 учти замечания'] },
  { command: 'code', description: 'Фаза 3 (Code): /code[:agent] VL-<id> [комментарий]', usage: '/code[:agent] VL-<id> [комментарий]', examples: ['/code VL-12', '/code:vb VL-12 продолжи'] },
  { command: 'close', description: 'Закрыть задачу (Фаза Close): /close[:agent] VL-<id>', usage: '/close[:agent] VL-<id>', examples: ['/close VL-12', '/close:vb VL-12'] },
  { command: 'prompt', description: 'Запрос LLM без задачи: qwen или встроенный агент (/prompt:vb)', usage: '/prompt[:agent] <текст>', examples: ['/prompt закоммить правки', '/prompt:vb сделай ревью'] },
  { command: 'analyze', description: 'Анализ сессии агента — статистика, вердикт, рекомендации: /analyze vb:agent-XXX [комментарий]', usage: '/analyze[:agent] <session-ref> [комментарий]', examples: ['/analyze vb:agent-1a2b', '/analyze vb:agent-1a2b сверь объём с AC'] },
  { command: 'resume', description: 'Возобновить сессию агента: /resume vb:agent-XXX [комментарий]', usage: '/resume[:agent] <session-ref> [комментарий]', examples: ['/resume vb:agent-1792 продолжи', '/resume 6e3f8a9c-1234-4abc-9def-000000000000 проверь сборку'] },
  { command: 'restart', description: 'Перезапустить бота: /restart [VL-N] — из ветки vb/vl-N, без аргумента — из корневого dist/', examples: ['/restart', '/restart VL-12'] },
  { command: 'web', description: 'Веб-интерфейс: /web start [VL-N] | /web stop', usage: '/web start [VL-N] | /web stop', examples: ['/web start', '/web start VL-12', '/web stop'] },
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
 * Полная справка по командам для /help (VL-150): MarkdownV2-текст собирается
 * из реестра, а не хардкодится — новая команда автоматически появляется
 * в справке (рассинхрон захардкоженных списков — историческая проблема VL-54).
 * Статические строки registry содержат `<id>`, дефисы и точки — всё
 * экранируется через escapeMarkdownV2, чтобы парсер MarkdownV2 не падал.
 */
export function helpText(): string {
  const lines: string[] = [`*${escapeMarkdownV2('Команды Vibelog-бота')}*`, ''];
  for (const c of BOT_COMMANDS) {
    const head = escapeMarkdownV2(c.usage ?? '/' + c.command);
    lines.push(`*${head}* — ${escapeMarkdownV2(c.description)}`);
    for (const ex of c.examples ?? []) {
      lines.push(`пример: ${escapeMarkdownV2(ex)}`);
    }
  }
  return lines.join('\n');
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
