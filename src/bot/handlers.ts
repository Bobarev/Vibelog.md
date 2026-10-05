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
import { getGitStatus } from '../core/git-status.js';
import type { DiffFile, GitStatus } from '../core/git-status.js';
import {
  escapeMarkdownV2,
  formatBoard,
  formatDiffList,
  formatPhaseResult,
  formatPhaseRun,
  formatTaskDetail,
  formatTaskList,
} from './formatting.js';
import {
  chunkRich,
  nextPhaseForStatus,
  renderDiffRich,
  renderPhaseResultRich,
  renderTaskRich,
  renderTasksRich,
} from './rich.js';
import { loadBotSettings, saveBotSettings } from './settings.js';
import { commandsHelp } from './registry.js';
import { spawnReplacementBot } from './restart.js';
import type { PhaseExitCallback, PhaseRun } from '../web/orchestrator.js';
import { getRun, startPhase, startPrompt } from '../web/orchestrator.js';
import {
  parseCloseCommand,
  parseCodeCommand,
  parseCommentCommand,
  parseCreateCommand,
  parsePlanCommand,
  parsePromptCommand,
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
 * Список задач по chatId: rich-таблица + кнопки (VL-82), фолбэк —
 * MarkdownV2-список (formatTaskList). Паттерн sendTaskView/sendPhaseResult:
 * try sendRichMessage → catch фолбэк для старых Telegram-клиентов.
 */
async function sendTasksView(
  bot: Bot,
  chatId: number,
  tasks: Task[],
  styles: Record<string, string>
): Promise<void> {
  try {
    const rich = renderTasksRich(tasks, styles);
    for (const part of chunkRich(rich)) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatTaskList(tasks));
  }
}

/**
 * Git-статус по chatId: rich-таблица /diff (VL-88), фолбэк — MarkdownV2
 * (formatDiffList). Паттерн sendTasksView: try sendRichMessage → catch.
 */
async function sendDiffView(
  bot: Bot,
  chatId: number,
  files: DiffFile[],
  branch: string
): Promise<void> {
  try {
    for (const part of chunkRich(renderDiffRich(files, branch))) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatDiffList(files, branch));
  }
}



/**
 * Информационное сообщение о завершении фазы по chatId: rich-рендер GFM
 * (VL-71), фолбэк — MarkdownV2 (formatPhaseResult + sendText). Паттерн
 * sendTaskView: лимит rich 32768 — разбивка нужна только для гигантских
 * отчётов.
 */
async function sendPhaseResult(bot: Bot, chatId: number, run: PhaseRun): Promise<void> {
  try {
    const rich = renderPhaseResultRich(run);
    for (const part of chunkRich(rich)) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatPhaseResult(run));
  }
}

/**
 * Регистрирует обработчики команд бота.
 *
 * Список команд и их описания — в реестре `./registry.ts` (VL-54);
 * help-тексты /start генерируются из него.
 *
 * @param bot — экземпляр grammy Bot
 * @param deps — cwd проекта и геттер пина
 */
export function registerHandlers(bot: Bot, deps: HandlerDeps): void {
  // Чаты, ожидающие ввода пина (в памяти процесса, не в файле)
  const awaitingPin = new Set<number>();
  // Чаты, ожидающие ввода комментария после кнопки «Комментарий» (VL-78):
  // chatId → id задачи; паттерн awaitingPin — память процесса, рестарт
  // бота теряет режим ожидания (допустимо — пользователь нажмёт заново)
  const awaitingComment = new Map<number, string>();

  /** Проверка привязки чата; при отсутствии — ответ-подсказка. */
  function requireBind(ctx: Context): boolean {
    const chatId = ctx.chat?.id;
    if (chatId !== undefined && loadBotSettings(deps.cwd).chats.includes(chatId)) return true;
    void sendMd(ctx, 'Бот не привязан к чату — выполните /start');
    return false;
  }

  /**
   * Уведомление о завершении фазы (VL-63): ровно 2 сообщения —
   * карточка задачи «как и была» (без строки фазы: статус теперь
   * в информационном сообщении, дублирование убрало VL-63) и
   * информационное rich-рендером renderPhaseResultRich (VL-71; фолбэк —
   * formatPhaseResult/MarkdownV2).
   */
  const notifyPhaseDone = (bot: Bot, chatId: number, task: Task, run: PhaseRun): void => {
    void (async () => {
      // Файл мог изменить qwen — перечитываем; rich-рендер без phaseRun
      const fresh = getTask(deps.cwd, task.id) ?? task;
      await sendTaskView(bot, chatId, fresh);
      await sendPhaseResult(bot, chatId, run);
    })().catch((err) => {
      console.error('Уведомление о завершении фазы не отправлено:', err);
    });
  };

  /**
   * Общая логика комментария (VL-60 / VL-78): addComment → сообщение →
   * запуск Фазы Comment с notifyPhaseDone. Используется командой /comment
   * и callback-кнопкой «Комментарий» — поведение /comment не меняется.
   * Ошибки пробрасываются вызывающему (обработчик шлёт «Ошибка: …»).
   */
  async function commitComment(taskId: string, text: string, chatId: number): Promise<void> {
    // Автор НЕ передаётся: addComment дефолтит git config user.name —
    // единый автор для CLI и бота (однопользовательская система, VL-35)
    const task = addComment(deps.cwd, taskId, text);
    await sendText(bot, chatId, `💬 Комментарий добавлен к *${task.id}*`);
    // VL-60: комментарий — не только запись, но и команда для qwen:
    // сразу после addComment запускаем Фазу Comment — headless qwen
    // выполняет запрос из комментария и оставляет отчёт комментарием.
    // Статус НЕ меняется (фаза вне жизненного цикла spec/plan/code/close).
    // Уведомление — паттерн VL-63: карточка + информационное сообщение.
    const onExit: PhaseExitCallback = (run) => {
      notifyPhaseDone(bot, chatId, task, run);
    };
    const result = startPhase(deps.cwd, task.id, 'comment', onExit, {
      comment: text,
    });
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase:
      // комментарий уже сохранён — не откатываем, сообщаем явно (VL-60)
      await sendText(
        bot,
        chatId,
        '⚠️ Комментарий добавлен, но запуск qwen не удался: ' +
          escapeMarkdownV2(result.error)
      );
      return;
    }
    await sendText(bot, chatId, `🚀 Фаза Comment запущена для *${task.id}*, PID ${result.pid}`);
  }

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    if (loadBotSettings(deps.cwd).chats.includes(chatId)) {
      await sendMd(ctx, `Чат уже привязан. Команды: ${commandsHelp()}`);
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
    // Пустой список — короткий текст «Задач нет» (rich-таблица не строится)
    if (tasks.length === 0) {
      await sendMd(ctx, formatTaskList(tasks));
      return;
    }
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    // Стили кнопок по типу задачи — task_type_styles из .vibelog/bot.yml (VL-82)
    await sendTasksView(bot, chatId, tasks, loadBotSettings(deps.cwd).task_type_styles ?? {});
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

  bot.command('diff', async (ctx) => {
    if (!requireBind(ctx)) return;
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    let status: GitStatus;
    try {
      status = getGitStatus(deps.cwd);
    } catch (err) {
      // git-сбой / не git-репозиторий — ошибка в чат, бот не падает (AC#2 VL-88)
      await sendMd(ctx, err instanceof Error ? err.message : 'Не удалось получить git-статус');
      return;
    }
    if (status.files.length === 0) {
      // Пустой статус — короткое сообщение, таблица не строится (как пустой /tasks)
      await sendMd(ctx, 'Незакоммиченных изменений нет');
      return;
    }
    await sendDiffView(bot, chatId, status.files, status.branch);
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
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    // Логика комментария общая с callback-кнопкой «Комментарий» (VL-78)
    try {
      await commitComment(parsed.id, parsed.text, chatId);
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
        notifyPhaseDone(bot, notifyChat, task, run);
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


  // ── /plan — Фаза 2 (Plan) через headless qwen (VL-51) ──
  // По аналогии с /spec (VL-42/48), но задача НЕ создаётся: аргумент —
  // ID существующей задачи (обычно после /spec, статус Planned).
  bot.command('plan', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parsePlanCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    const task = getTask(deps.cwd, parsed.id);
    if (!task) {
      await sendMd(ctx, `Задача ${escapeMarkdownV2(parsed.id)} не найдена.`);
      return;
    }
    // Опциональный комментарий (VL-80): сначала в задачу, затем в промпт фазы
    try {
      if (parsed.comment) addComment(deps.cwd, task.id, parsed.comment);
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    // Колбэк завершения — паттерн VL-63: карточка + информационное сообщение
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(deps.cwd, task.id, 'plan', onExit, { comment: parsed.comment ?? '' });
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза Plan запущена для *${task.id}*, PID ${result.pid}`);
  });
  // ── /code — Фаза 3 (Code) через headless qwen (VL-53) ──
  // По аналогии с /plan (VL-51), но фаза — Code (шаблон phase-3.md).
  // ID существующей задачи (обычно после /plan).
  bot.command('code', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parseCodeCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    const task = getTask(deps.cwd, parsed.id);
    if (!task) {
      await sendMd(ctx, `Задача ${escapeMarkdownV2(parsed.id)} не найдена.`);
      return;
    }
    // Опциональный комментарий (VL-80): как в /plan
    try {
      if (parsed.comment) addComment(deps.cwd, task.id, parsed.comment);
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    // Колбэк завершения — паттерн VL-63: карточка + информационное сообщение
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(deps.cwd, task.id, 'code', onExit, { comment: parsed.comment ?? '' });
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза Code запущена для *${task.id}*, PID ${result.pid}`);
  });
  // ── /close — Фаза Close (закрытие задачи) через headless qwen (VL-55) ──
  // По аналогии с /code (VL-53): закрывает задачу — статус завершения
  // из конфига проекта + git commit файлов задачи + отчёт комментарием.
  // Шаблон phase-close.md — единственная фаза, где git-операции разрешены.
  bot.command('close', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parseCloseCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    const task = getTask(deps.cwd, parsed.id);
    if (!task) {
      await sendMd(ctx, `Задача ${escapeMarkdownV2(parsed.id)} не найдена.`);
      return;
    }
    // Колбэк завершения — паттерн VL-63: карточка + информационное сообщение
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(deps.cwd, task.id, 'close', onExit);
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза Close запущена для *${task.id}*, PID ${result.pid}`);
  });
  // ── /prompt — произвольный запрос через qwen без задачи (VL-66) ──
  // Запросы, слишком мелкие для задачи (коммит незакоммиченных файлов,
  // правка настроек и т.п.): бот спавнит qwen с шаблоном prompt.md.
  // Задача НЕ создаётся, backlog/ не трогается; git-операции разрешены
  // (шаблон запрещает только push без явной просьбы). Активен только
  // один /prompt (guard в spawnQwenRun).
  bot.command('prompt', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parsePromptCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    // Задачи нет — карточка не шлётся, только информационное сообщение
    // по шаблону VL-63/65 (rich-рендер VL-71, фолбэк — formatPhaseResult)
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      void sendPhaseResult(bot, notifyChat, run);
    };
    const result = startPrompt(deps.cwd, parsed.text, onExit);
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPrompt
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Запрос отправлен в qwen, PID ${result.pid}`);
  });
  // ── /restart — самоперезапуск бота (VL-70) ──
  // Сценарий разработки: после pnpm build старый процесс исполняет старый
  // dist/. Бот рестартует САМ СЕБЯ по команде из чата: гасит polling и
  // поднимает новый vibelog bot в том же терминале — пин нового запуска
  // печатается там же, новый процесс исполняет свежий dist/. CLI
  // `vibelog restart` с pid-файлом отменён: он заменял только Ctrl+C.
  bot.command('restart', async (ctx) => {
    if (!requireBind(ctx)) return;
    const chatId = ctx.chat?.id;
    await sendMd(ctx, '🔄 Перезапуск бота…');
    // Порядок обязателен: два параллельных long-polling с одним токеном —
    // Telegram отвечает 409 Conflict; сначала гасим старый, потом спавним новый
    try {
      await bot.stop();
    } catch {
      // polling ещё не стартовал или уже остановлен — не критично
    }
    const child = spawnReplacementBot(deps.cwd);
    await new Promise<void>((resolve) => {
      child.once('spawn', () => resolve());
      child.once('error', (err) => {
        console.error('Не удалось перезапустить бота:', err.message);
        if (chatId !== undefined) {
          void sendText(
            bot,
            chatId,
            '⚠️ Не удалось перезапустить бота — запустите вручную: vibelog bot'
          );
        }
        process.exit(1);
      });
    });
    // Новый процесс создан — выходим; detached+unref: он переживает нас
    process.exit(0);
  });
  // ── Кнопка «следующий этап» (VL-72) ──
  // callback-кнопка из rich-рендера карточки задачи: data = next:<id>.
  // Запускает фазу по маппингу статус→фаза (как /plan,/code,/close),
  // включая notifyPhaseDone. Регистрируется ДО catch-all message:text.
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data ?? '';
    // ── Кнопка «Комментарий» (VL-78): режим ожидания текста ──
    // data = comment:<id>. Бот просит ввести комментарий; текст будет
    // принят обработчиком message:text (awaitingComment) ДО catch-all пина.
    if (data.startsWith('comment:')) {
      const id = data.slice('comment:'.length).trim();
      // answerCallbackQuery обязателен в любом исходе — иначе «часики»
      if (!requireBind(ctx)) {
        await ctx
          .answerCallbackQuery({ text: 'Бот не привязан к чату — выполните /start' })
          .catch(() => {});
        return;
      }
      const chatId = ctx.chat?.id;
      const task = getTask(deps.cwd, id);
      if (chatId === undefined || !task) {
        await ctx.answerCallbackQuery({ text: `Задача ${id} не найдена.` }).catch(() => {});
        return;
      }
      awaitingComment.set(chatId, task.id);
      await ctx
        .answerCallbackQuery({ text: `💬 Введите комментарий для ${task.id}` })
        .catch(() => {});
      await sendMd(ctx, `Введите комментарий для *${task.id}*. /cancel — отмена.`);
      return;
    }
    // ── Кнопка задачи в списке /tasks (VL-82): data = task:<id> ──
    // Полный аналог команды /task VL-N: карточка через sendTaskView
    // (включая строку фазы VL-43). Регистрируется ДО ветки next: —
    // префиксы не конфликтуют, порядок по аналогии с comment:.
    if (data.startsWith('task:')) {
      const id = data.slice('task:'.length).trim();
      // answerCallbackQuery обязателен в любом исходе — иначе «часики»
      if (!requireBind(ctx)) {
        await ctx
          .answerCallbackQuery({ text: 'Бот не привязан к чату — выполните /start' })
          .catch(() => {});
        return;
      }
      const chatId = ctx.chat?.id;
      const task = getTask(deps.cwd, id);
      if (chatId === undefined || !task) {
        await ctx.answerCallbackQuery({ text: `Задача ${id} не найдена.` }).catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery({ text: `📋 ${task.id}` }).catch(() => {});
      await sendTaskView(bot, chatId, task, getRun(id) ?? undefined);
      return;
    }
    if (!data.startsWith('next:')) return; // чужие callback не трогаем
    const id = data.slice('next:'.length).trim();
    // answerCallbackQuery обязателен в любом исходе — иначе «часики» на кнопке
    if (!requireBind(ctx)) {
      await ctx
        .answerCallbackQuery({ text: 'Бот не привязан к чату — выполните /start' })
        .catch(() => {});
      return;
    }
    const task = getTask(deps.cwd, id);
    const next = task ? nextPhaseForStatus(task.status) : null;
    if (!task || !next) {
      await ctx
        .answerCallbackQuery({
          text: !task
            ? `Задача ${id} не найдена.`
            : `Для статуса «${task.status}» нет следующего этапа.`,
        })
        .catch(() => {});
      return;
    }
    await ctx
      .answerCallbackQuery({ text: `🚀 Фаза ${next.label} запускается для ${task.id}` })
      .catch(() => {});
    // Колбэк завершения — паттерн /plan,/code,/close (VL-63): notifyPhaseDone
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(deps.cwd, task.id, next.phase, onExit, { comment: '' });
    if ('error' in result) {
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза ${next.label} запущена для *${task.id}*, PID ${result.pid}`);
  });
  // ── Ввод комментария (VL-78): ОБЯЗАТЕЛЬНО ДО catch-all пина ──
  // Режим ожидания после кнопки «Комментарий»: текст сохраняется через
  // commitComment (addComment + Фаза Comment). При отсутствии режима —
  // next() к catch-all пина: message:text-обработчик без next() останавливает
  // цепочку grammy (ловушка порядка VL-37).
  bot.on('message:text', async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !awaitingComment.has(chatId)) {
      await next(); // не наш режим — дальше, к catch-all пина
      return;
    }
    const text = ctx.message.text.trim();
    if (text === '/cancel') {
      awaitingComment.delete(chatId);
      await sendMd(ctx, 'Отменено.');
      return;
    }
    if (!text) {
      // Пустой ввод — повторный промпт, режим ожидания сохраняется
      await sendMd(ctx, 'Комментарий пуст — введите текст или /cancel.');
      return;
    }
    const taskId = awaitingComment.get(chatId) ?? '';
    // Удаляем ДО async-работы — защита от двойного ввода, пока идёт addComment
    awaitingComment.delete(chatId);
    try {
      await commitComment(taskId, text, chatId);
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
      await sendMd(ctx, `Чат привязан ✅ Команды: ${commandsHelp()}`);
    } else {
      await sendMd(ctx, 'Неверный код. Проверьте консоль запущенного vibelog bot.');
    }
  });


}
