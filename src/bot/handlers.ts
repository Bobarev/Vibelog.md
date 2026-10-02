/**
 * Обработчики Telegram-команд бота (VL-34).
 *
 * Пин-флоу привязки: /start → бот просит код → код печатается в консоль
 * запущенного vibelog bot → верный код привязывает chat_id (в .vibelog/bot.yml).
 * Все данные читаются через core-функции — формат backlog/ не меняется.
 */

import type { Bot, Context } from 'grammy';
import { addComment, createTaskFile, getTask, listTasks, updateTaskFile } from '../core/store.js';
import { loadConfig } from '../core/config.js';
import type { Task } from '../core/task.js';
import {
  escapeMarkdownV2,
  formatBoard,
  formatPhaseRun,
  formatTaskDetail,
  formatTaskList,
} from './formatting.js';
import { chunkRich, renderTaskRich } from './rich.js';
import { loadBotSettings, saveBotSettings } from './settings.js';
import type { PhaseExitCallback, PhaseRun } from '../web/orchestrator.js';
import { getRun, startPhase } from '../web/orchestrator.js';
import {
  parseCommentCommand,
  parseCreateCommand,
  parseSpecCommand,
  parseStatusCommand,
} from './commands.js';

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
 * Отправка текста по chatId: MarkdownV2 с фолбэком на plain (VL-48).
 * Отличие от sendMd: адресат — chatId (уведомления приходят без ctx).
 */
async function sendText(bot: Bot, chatId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch {
    try {
      await bot.api.sendMessage(chatId, text);
    } catch {
      // Сеть недоступна — сообщение теряется, polling продолжится
    }
  }
}

/**
 * Карточка задачи по chatId: rich-рендер (VL-39) + строка фазы (VL-43),
 * фолбэк — MarkdownV2-детали. Используется и в /task, и в уведомлениях
 * о завершении фазы (VL-48) — контент идентичен ответу /task.
 */
async function sendTaskView(
  bot: Bot,
  chatId: number,
  task: Task,
  phaseRun?: PhaseRun
): Promise<void> {
  try {
    const rich = renderTaskRich(task);
    for (const part of chunkRich(rich)) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
    // VL-43: статус фазы отдельным сообщением — rich-рендер не трогаем,
    // данные фазы живут в памяти процесса, а не в файле задачи
    if (phaseRun) {
      const line = formatPhaseRun(phaseRun);
      if (line) await sendText(bot, chatId, line);
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatTaskDetail(task, phaseRun));
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
    // VL-43: статус фазы qwen — in-memory состояние оркестратора;
    // VL-48: карточка выделена в sendTaskView (общая с уведомлениями)
    const phaseRun = getRun(id);
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    await sendTaskView(bot, chatId, task, phaseRun ?? undefined);
  });

  bot.command('board', async (ctx) => {
    if (!requireBind(ctx)) return;
    const config = loadConfig(deps.cwd);
    const statuses = Array.isArray(config.statuses) ? config.statuses.map(String) : [];
    await sendMd(ctx, formatBoard(statuses, listTasks(deps.cwd)));
  });

  // ── Управление задачами (VL-35): ПОСЛЕ всех доска-команд, ДО catch-all ──

  bot.command('create', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parseCreateCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    try {
      const task = createTaskFile(deps.cwd, {
        title: parsed.title,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.priority ? { priority: parsed.priority } : {}),
      });
      await sendMd(ctx, `✅ Задача *${task.id}* создана: ${task.title}`);
    } catch (err) {
      await sendMd(ctx, `Ошибка создания: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.command('status', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parseStatusCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    try {
      const config = loadConfig(deps.cwd);
      const statuses = Array.isArray(config.statuses) ? config.statuses.map(String) : [];
      if (!statuses.includes(parsed.status)) {
        await sendMd(ctx, `Неизвестный статус: ${parsed.status}. Доступные: ${statuses.join(', ')}`);
        return;
      }
      const task = getTask(deps.cwd, parsed.id);
      if (!task) {
        await sendMd(ctx, `Задача ${parsed.id} не найдена.`);
        return;
      }
      const updated = updateTaskFile(deps.cwd, parsed.id, { status: parsed.status });
      await sendMd(ctx, `*${updated.id}*: ${task.status} → ${updated.status}`);
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.command('comment', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parseCommentCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    try {
      // Автор НЕ передаётся: addComment дефолтит git config user.name —
      // единый автор для CLI и бота (однопользовательская система, VL-35)
      const task = addComment(deps.cwd, parsed.id, parsed.text);
      await sendMd(ctx, `💬 Комментарий добавлен к *${task.id}*`);
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ── /spec — Фаза 1 (Spec) через headless qwen (VL-42) ──
  // По аналогии с web (startPhase): создаём родительскую задачу с описанием
  // фичи и спавним qwen с шаблоном phase-1.md — агент сам разобьёт фичу на
  // подзадачи через Vibelog MCP, оставит отчёт комментарием и сменит статус.
  bot.command('spec', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parseSpecCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    try {
      // Заголовок — первая фраза описания (до . ! ? ; или переноса),
      // ≤80 символов по границе слова; полное описание уходит в description
      const firstPhrase =
        parsed.description.split(/[.!?;\n]/)[0].trim() || parsed.description.trim();
      let title = firstPhrase;
      if (title.length > 80) {
        title = title.slice(0, 80).replace(/\s+\S*$/, '') || firstPhrase.slice(0, 80);
        title += '…';
      }
      const task = createTaskFile(deps.cwd, { title, description: parsed.description });
      // VL-48: по завершении фазы — в чат ответ qwen + карточка задачи.
      // Колбэк синхронный (void async): ошибки сети не роняют polling.
      const notifyChat = ctx.chat?.id;
      const onExit: PhaseExitCallback = (run) => {
        if (notifyChat === undefined) return;
        void (async () => {
          const head =
            run.exitCode === 0
              ? '✅ *Фаза Spec завершена* для ' + task.id
              : '⚠️ *Фаза Spec завершена с ошибкой* для ' + task.id + ' — код ' + (run.exitCode ?? '—');
          await sendText(bot, notifyChat, head);
          const tail = (run.logTail ?? '').trim();
          if (tail) {
            // Ответ qwen: последние строки stdout/stderr; лимит Telegram —
            // 4096 символов, режем с запасом. Pre-блок MarkdownV2 (```).
            const cut = tail.length > 3000 ? tail.slice(0, 3000) + '…' : tail;
            await sendText(bot, notifyChat, '```\n' + cut + '\n```');
          }
          // Карточка созданной задачи — как в /task; файл мог изменить qwen
          const fresh = getTask(deps.cwd, task.id) ?? task;
          await sendTaskView(bot, notifyChat, fresh, run);
        })().catch((err) => {
          console.error('Уведомление о завершении фазы не отправлено:', err);
        });
      };
      const result = startPhase(deps.cwd, task.id, 'spec', onExit);
      if ('error' in result) {
        await sendMd(
          ctx,
          '⚠️ Задача *' +
            task.id +
            '* создана, но запуск qwen не удался: ' +
            escapeMarkdownV2(result.error)
        );
        return;
      }
      await sendMd(ctx, `🚀 Фаза Spec запущена для *${task.id}*, PID ${result.pid}`);
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
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
