/**
 * Обработчики Telegram-команд бота (VL-34).
 *
 * Пин-флоу привязки: /start → бот просит код → код печатается в консоль
 * запущенного vibelog bot → верный код привязывает chat_id (в .vibelog/settings.json).
 * Все данные читаются через core-функции — формат backlog/ не меняется.
 */

import type { Bot, Context } from 'grammy';
import { addComment, createTaskFile, getTask, listTasks, updateTaskFile } from '../core/store.js';
import { loadConfig } from '../core/config.js';
import type { Task } from '../core/task.js';
import { getGitLog, getGitStatus } from '../core/git.js';
import type { DiffFile, GitStatus, GitCommit } from '../core/git.js';
import { getDocument, listDocuments, searchDocuments } from '../core/document.js';
import type { DocumentEntry } from '../core/document.js';
import { findBacklogDir } from '../core/paths.js';
import {
  escapeMarkdownV2,
  formatBoard,
  formatCommitsList,
  formatDiffList,
  formatDocsList,
  formatDocumentDetail,
  formatPhaseResult,
  formatPhaseRun,
  formatTaskDetail,
  formatTaskList,
} from './formatting.js';
import {
  chunkRich,
  nextPhaseForStatus,
  renderCommitsRich,
  renderDiffRich,
  renderDocsRich,
  renderDocumentRich,
  renderPhaseResultRich,
  renderTaskRich,
  renderTasksRich,
} from './rich.js';
import { loadBotSettings, resolveDefaultAgent, saveBotSettings } from './settings.js';
import { commandsHelp } from './registry.js';
import { spawnReplacementBot } from './restart.js';
import { buildTaskWorktree, ensureTaskWorktree, taskBranchName, worktreeCliPath } from '../core/worktree.js';
import type { PhaseExitCallback, PhaseRun } from '../web/orchestrator.js';
import { getRun, startPhase, startPrompt, startResume } from '../web/orchestrator.js';
import {
  extractSessionRef,
  richToText,
  parseCloseCommand,
  parseCodeCommand,
  parseCommitsCommand,
  parseCommentCommand,
  parseCreateCommand,
  parsePlanCommand,
  parsePromptCommand,
  parseRestartCommand,
  parseSetCommand,
  parseSpecCommand,
  parseStatusCommand,
} from './commands.js';
import type { AgentName } from './commands.js';

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
 *
 * active (VL-91) — маппинг taskId → активная фаза агента: пометка 🔄
 * и в rich-таблице, и в MarkdownV2-фолбэке; дефолт {} — без пометок.
 */
async function sendTasksView(
  bot: Bot,
  chatId: number,
  tasks: Task[],
  styles: Record<string, string>,
  active: Record<string, string> = {}
): Promise<void> {
  try {
    const rich = renderTasksRich(tasks, styles, active);
    for (const part of chunkRich(rich)) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatTaskList(tasks, active));
  }
}

/**
 * Список документов по chatId: rich-таблица + кнопки doc:<id> (VL-89),
 * фолбэк — MarkdownV2-список (formatDocsList). Паттерн sendTasksView.
 */
async function sendDocsView(
  bot: Bot,
  chatId: number,
  entries: DocumentEntry[]
): Promise<void> {
  try {
    for (const part of chunkRich(renderDocsRich(entries))) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatDocsList(entries));
  }
}

/**
 * Карточка документа по chatId: rich-рендер (VL-89), фолбэк —
 * MarkdownV2-детали (formatDocumentDetail). Паттерн sendTaskView.
 */
async function sendDocView(bot: Bot, chatId: number, entry: DocumentEntry): Promise<void> {
  try {
    for (const part of chunkRich(renderDocumentRich(entry))) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatDocumentDetail(entry));
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
 * Таблица коммитов по chatId: rich-таблица /commits (VL-90), фолбэк —
 * MarkdownV2 (formatCommitsList). Паттерн sendDiffView (VL-88).
 */
async function sendCommitsView(
  bot: Bot,
  chatId: number,
  commits: GitCommit[]
): Promise<void> {
  try {
    for (const part of chunkRich(renderCommitsRich(commits))) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatCommitsList(commits));
  }
}

/**
 * Информационное сообщение о завершении фазы по chatId: rich-рендер GFM
 * (VL-71), фолбэк — MarkdownV2 (formatPhaseResult + sendText). Паттерн
 * sendTaskView: лимит rich 32768 — разбивка нужна только для гигантских
 * отчётов.
 *
 * @param taskId — идентификатор задачи VL-N (VL-98): попадает в заголовок
 *   отчёта; undefined (/prompt, resume) — отчёт без суффикса задачи
 */
async function sendPhaseResult(bot: Bot, chatId: number, run: PhaseRun, taskId?: string): Promise<void> {
  try {
    const rich = renderPhaseResultRich(run, taskId);
    for (const part of chunkRich(rich)) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatPhaseResult(run, taskId));
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
      // VL-98: task.id есть у всех реальных завершений фаз (comment/spec/
      // plan/code/close) — идентификатор попадает в заголовок отчёта
      await sendPhaseResult(bot, chatId, run, task.id);
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
  async function commitComment(
    taskId: string,
    text: string,
    chatId: number,
    agent: AgentName
  ): Promise<void> {
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
    const result = startPhase(
      deps.cwd,
      task.id,
      'comment',
      onExit,
      { comment: text },
      agent
    );
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase:
      // комментарий уже сохранён — не откатываем, сообщаем явно (VL-60)
      await sendText(
        bot,
        chatId,
        '⚠️ Комментарий добавлен, но запуск ' + agent + ' не удался: ' +
          escapeMarkdownV2(result.error)
      );
      return;
    }
    await sendText(
      bot,
      chatId,
      `🚀 Фаза Comment (${agent}) запущена для *${task.id}*, PID ${result.pid}`
    );
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
    // Пометка активных фаз агента (VL-91): getRun — in-memory оркестратора
    // (бот и оркестратор — один процесс); running === true — только у активных
    // запусков, lastRuns (завершённые/ошибочные) не помечаются
    const active: Record<string, string> = {};
    for (const t of tasks) {
      const run = getRun(t.id);
      if (run?.running === true && run.phase) active[t.id] = run.phase;
    }
    // Стили кнопок по типу задачи — task_type_styles из .vibelog/settings.json (VL-82)
    await sendTasksView(
      bot,
      chatId,
      tasks,
      loadBotSettings(deps.cwd).task_type_styles ?? {},
      active
    );
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

  // ── /docs — список документов (VL-89) ──
  bot.command('docs', async (ctx) => {
    if (!requireBind(ctx)) return;
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    // listDocuments/searchDocuments принимают backlogDir, а НЕ cwd —
    // ищем backlog-директорию явно (паттерн src/cli/commands/doc.ts)
    const backlogDir = findBacklogDir(deps.cwd);
    // Нет backlog/ — ведём себя как пустой список, не падаем (VL-89)
    if (!backlogDir) {
      await sendMd(ctx, formatDocsList([]));
      return;
    }
    const filter = (ctx.match ?? '').toString().trim();
    const entries = filter ? searchDocuments(backlogDir, filter) : listDocuments(backlogDir);
    // Пустой список — короткий текст без таблицы (паттерн /tasks)
    if (entries.length === 0) {
      await sendMd(ctx, formatDocsList(entries));
      return;
    }
    await sendDocsView(bot, chatId, entries);
  });

  bot.command('doc', async (ctx) => {
    if (!requireBind(ctx)) return;
    const id = (ctx.match ?? '').toString().trim();
    if (!id) {
      await sendMd(ctx, 'Укажите ID документа: /doc doc-1');
      return;
    }
    const backlogDir = findBacklogDir(deps.cwd);
    const entry = backlogDir ? getDocument(backlogDir, id) : null;
    if (!entry) {
      // id экранируется — пользователь вводит что угодно (паттерн /task)
      await sendMd(ctx, `Документ ${escapeMarkdownV2(id)} не найден.`);
      return;
    }
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    await sendDocView(bot, chatId, entry);
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

  bot.command('commits', async (ctx) => {
    if (!requireBind(ctx)) return;
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const parsed = parseCommitsCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    let commits: GitCommit[];
    try {
      commits = getGitLog(deps.cwd, parsed.count);
    } catch (err) {
      // git-сбой / не git-репозиторий — ошибка в чат, бот не падает (паттерн /diff)
      await sendMd(ctx, err instanceof Error ? err.message : 'Не удалось получить git log');
      return;
    }
    if (commits.length === 0) {
      // Пустой лог — короткое сообщение, таблица не строится (как пустой /tasks)
      await sendMd(ctx, 'Коммитов нет');
      return;
    }
    await sendCommitsView(bot, chatId, commits);
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

  // ── /set — настройки бота (VL-94/104/107/122): агент, лимиты фаз, режим
  // веток, компакшн истории ──
  // /set agent <qwen|vb> — агент по умолчанию для всех команд фаз и кнопок
  // действий без суффикса :<agent>. /set max-wall-time <сек> и
  // /set max-requests <N> — лимиты фазы для встроенного агента (vb):
  // оркестратор прокидывает их флагами при следующем запуске; 0 — сброс
  // настройки (дефолт агента). /set branch-mode on|off — режим параллельной
  // разработки в git-ветках vb/vl-N (VL-107). /set compact on|off — компакшн
  // истории LLM-запроса в длинных сессиях (VL-122; по умолчанию включён).
  // Хранится в .vibelog/settings.json.
  bot.command('set', async (ctx) => {
    if (!requireBind(ctx)) return;
    const parsed = parseSetCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    const settings = loadBotSettings(deps.cwd);
    // Дискриминированный union (VL-94): switch сужает key → value без приведений
    switch (parsed.key) {
      case 'agent': {
        settings.default_agent = parsed.value;
        saveBotSettings(deps.cwd, settings);
        await sendMd(
          ctx,
          `⚙️ Агент по умолчанию: *${parsed.value}*. Команды без суффикса :<agent> запускают его.`
        );
        return;
      }
      case 'branch-mode': {
        // VL-107: читается оркестратором перед каждым запуском фазы —
        // перезапуск бота не требуется
        settings.branch_mode = parsed.value;
        saveBotSettings(deps.cwd, settings);
        await sendMd(
          ctx,
          `⚙️ Режим параллельной разработки (ветки vb/vl-N): ${parsed.value ? '*вкл*' : '*выкл*'}.`
        );
        return;
      }
      case 'compact': {
        // VL-122: компакшн истории LLM-запроса — по умолчанию включён;
        // /set compact off → оркестратор передаёт --no-compact (агент vb)
        settings.compact = parsed.value;
        saveBotSettings(deps.cwd, settings);
        await sendMd(
          ctx,
          `⚙️ Компакшн истории LLM-запроса (усечение длинных сессий): ${parsed.value ? '*вкл*' : '*выкл*'}.`
        );
        return;
      }
      case 'max-wall-time':
      case 'max-requests': {
        // Числовые лимиты (VL-104): 0 — сброс (удаление ключа из settings.json),
        // иначе — запись; применяются при следующем запуске фазы (агент vb)
        const key = parsed.key;
        const field = key === 'max-wall-time' ? 'max_wall_time' : 'max_requests';
        if (parsed.value === 0) {
          settings[field] = undefined;
          saveBotSettings(deps.cwd, settings);
          await sendMd(
            ctx,
            `⚙️ Лимит *${key}* сброшен — используется дефолт агента (без лимита).`
          );
          return;
        }
        settings[field] = parsed.value;
        saveBotSettings(deps.cwd, settings);
        await sendMd(
          ctx,
          `⚙️ Лимит *${key}*: *${parsed.value}*. Передаётся при запуске фаз (агент vb). Сброс: \`/set ${key} 0\`.`
        );
        return;
      }
    }
  });

  // ── /comment — комментарий + Фаза Comment (VL-35/60), агент — VL-94 ──
  bot.command(['comment', 'comment:qwen', 'comment:vb'], async (ctx) => {
    if (!requireBind(ctx)) return;
    // ctx.command в grammy 1.46 отсутствует — слово команды берём из текста
    // сообщения (первое слово без '/'): '/comment:vb VL-1 текст' → 'comment:vb'
    const raw = (ctx.message?.text ?? '').trim();
    const commandWord = raw.split(/\s+/)[0]?.replace(/^\//, '') ?? 'comment';
    const parsed = parseCommentCommand((ctx.match ?? '').toString(), commandWord);
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    // Явный суффикс :<agent> перекрывает агента по умолчанию из настроек (VL-94)
    const agent = parsed.agent ?? resolveDefaultAgent(deps.cwd);
    // Логика комментария общая с callback-кнопкой «Комментарий» (VL-78)
    try {
      await commitComment(parsed.id, parsed.text, chatId, agent);
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ── /spec — Фаза 1 (Spec) через headless qwen (VL-42) ──
  // По аналогии с web (startPhase): создаём родительскую задачу с описанием
  // фичи и спавним qwen с шаблоном phase-1.md — агент сам разобьёт фичу на
  // подзадачи через Vibelog MCP, оставит отчёт комментарием и сменит статус.
  bot.command(['spec', 'spec:qwen', 'spec:vb'], async (ctx) => {
    if (!requireBind(ctx)) return;
    // ctx.command в grammy 1.46 отсутствует — слово команды берём из текста
    // сообщения (первое слово без '/'): '/spec:vb …' → 'spec:vb' (VL-94)
    const raw = (ctx.message?.text ?? '').trim();
    const commandWord = raw.split(/\s+/)[0]?.replace(/^\//, '') ?? 'spec';
    const parsed = parseSpecCommand((ctx.match ?? '').toString(), commandWord);
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
      // Явный суффикс :<agent> перекрывает агента по умолчанию (VL-94)
      const agent = parsed.agent ?? resolveDefaultAgent(deps.cwd);
      // VL-48: по завершении фазы — в чат ответ qwen + карточка задачи.
      // Колбэк синхронный (void async): ошибки сети не роняют polling.
      const notifyChat = ctx.chat?.id;
      const onExit: PhaseExitCallback = (run) => {
        if (notifyChat === undefined) return;
        notifyPhaseDone(bot, notifyChat, task, run);
      };
      const result = startPhase(deps.cwd, task.id, 'spec', onExit, undefined, agent);
      if ('error' in result) {
        await sendMd(
          ctx,
          '⚠️ Задача *' +
            task.id +
            '* создана, но запуск ' +
            agent +
            ' не удался: ' +
            escapeMarkdownV2(result.error)
        );
        return;
      }
      await sendMd(ctx, `🚀 Фаза Spec (${agent}) запущена для *${task.id}*, PID ${result.pid}`);
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  });


  // ── /plan — Фаза 2 (Plan) через headless qwen (VL-51) ──
  // По аналогии с /spec (VL-42/48), но задача НЕ создаётся: аргумент —
  // ID существующей задачи (обычно после /spec, статус Planned).
  bot.command(['plan', 'plan:qwen', 'plan:vb'], async (ctx) => {
    if (!requireBind(ctx)) return;
    // ctx.command в grammy 1.46 отсутствует — слово команды берём из текста
    // сообщения (первое слово без '/'): '/plan:vb VL-1 …' → 'plan:vb' (VL-94)
    const raw = (ctx.message?.text ?? '').trim();
    const commandWord = raw.split(/\s+/)[0]?.replace(/^\//, '') ?? 'plan';
    const parsed = parsePlanCommand((ctx.match ?? '').toString(), commandWord);
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
    // Явный суффикс :<agent> перекрывает агента по умолчанию (VL-94)
    const agent = parsed.agent ?? resolveDefaultAgent(deps.cwd);
    // Колбэк завершения — паттерн VL-63: карточка + информационное сообщение
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(
      deps.cwd,
      task.id,
      'plan',
      onExit,
      { comment: parsed.comment ?? '' },
      agent
    );
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза Plan (${agent}) запущена для *${task.id}*, PID ${result.pid}`);
  });
  // ── /code — Фаза 3 (Code) через headless qwen (VL-53) ──
  // По аналогии с /plan (VL-51), но фаза — Code (шаблон phase-3.md).
  // ID существующей задачи (обычно после /plan).
  bot.command(['code', 'code:qwen', 'code:vb'], async (ctx) => {
    if (!requireBind(ctx)) return;
    // ctx.command в grammy 1.46 отсутствует — слово команды берём из текста
    // сообщения (первое слово без '/'): '/code:vb VL-1 …' → 'code:vb' (VL-94)
    const raw = (ctx.message?.text ?? '').trim();
    const commandWord = raw.split(/\s+/)[0]?.replace(/^\//, '') ?? 'code';
    const parsed = parseCodeCommand((ctx.match ?? '').toString(), commandWord);
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
    // Явный суффикс :<agent> перекрывает агента по умолчанию (VL-94)
    const agent = parsed.agent ?? resolveDefaultAgent(deps.cwd);
    // Колбэк завершения — паттерн VL-63: карточка + информационное сообщение
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(
      deps.cwd,
      task.id,
      'code',
      onExit,
      { comment: parsed.comment ?? '' },
      agent
    );
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза Code (${agent}) запущена для *${task.id}*, PID ${result.pid}`);
  });
  // ── /close — Фаза Close (закрытие задачи) через headless qwen (VL-55) ──
  // По аналогии с /code (VL-53): закрывает задачу — статус завершения
  // из конфига проекта + git commit файлов задачи + отчёт комментарием.
  // Шаблон phase-close.md — единственная фаза, где git-операции разрешены.
  bot.command(['close', 'close:qwen', 'close:vb'], async (ctx) => {
    if (!requireBind(ctx)) return;
    // ctx.command в grammy 1.46 отсутствует — слово команды берём из текста
    // сообщения (первое слово без '/'): '/close:vb VL-1 …' → 'close:vb' (VL-94)
    const raw = (ctx.message?.text ?? '').trim();
    const commandWord = raw.split(/\s+/)[0]?.replace(/^\//, '') ?? 'close';
    const parsed = parseCloseCommand((ctx.match ?? '').toString(), commandWord);
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    const task = getTask(deps.cwd, parsed.id);
    if (!task) {
      await sendMd(ctx, `Задача ${escapeMarkdownV2(parsed.id)} не найдена.`);
      return;
    }
    // Явный суффикс :<agent> перекрывает агента по умолчанию (VL-94)
    const agent = parsed.agent ?? resolveDefaultAgent(deps.cwd);
    // Колбэк завершения — паттерн VL-63: карточка + информационное сообщение
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(deps.cwd, task.id, 'close', onExit, undefined, agent);
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPhase
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза Close (${agent}) запущена для *${task.id}*, PID ${result.pid}`);
  });
  // ── /prompt — произвольный запрос через LLM без задачи (VL-66/92) ──
  // Запросы, слишком мелкие для задачи (коммит незакоммиченных файлов,
  // правка настроек и т.п.): бот спавнит агент с шаблоном prompt.md.
  // Суффикс :<agent> выбирает агента (VL-92): /prompt:vb — встроенный
  // vibelog-agent, /prompt:qwen или без суффикса — qwen. grammy 1.46 матчит
  // только строковые имена (has.command сравнивает Set'ы) — вариации
  // регистрируются массивом. Задача НЕ создаётся, backlog/ не трогается;
  // git-операции разрешены (шаблон запрещает только push без явной просьбы).
  // Активен только один /prompt (guard в spawnQwenRun — общий для агентов).
  bot.command(['prompt', 'prompt:qwen', 'prompt:vb'], async (ctx) => {
    if (!requireBind(ctx)) return;
    // ctx.command в grammy 1.46 отсутствует — слово команды берём из текста
    // сообщения (первое слово без '/'): '/prompt:vb привет' → 'prompt:vb'
    const raw = (ctx.message?.text ?? '').trim();
    const commandWord = raw.split(/\s+/)[0]?.replace(/^\//, '') ?? 'prompt';
    const parsed = parsePromptCommand((ctx.match ?? '').toString(), commandWord);
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
    // Явный суффикс :<agent> перекрывает агента по умолчанию из настроек (VL-94)
    const agent = parsed.agent ?? resolveDefaultAgent(deps.cwd);
    const result = startPrompt(deps.cwd, parsed.text, onExit, agent);
    if ('error' in result) {
      // Guard «уже выполняется» и прочие ошибки валидации startPrompt
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    const agentLabel = agent === 'vb' ? 'vibelog-agent' : 'qwen';
    await sendMd(ctx, `🚀 Запрос отправлен в ${escapeMarkdownV2(agentLabel)}, PID ${result.pid}`);
  });
  // Фолбэк VL-92 для /prompt:<неизвестный агент>: если Telegram-entity
  // обрывается на двоеточии, command-хендлер выше не сматчит 'prompt:foo' —
  // подсказка шлётся здесь, спавна нет
  bot.hears(/^\/prompt:(\S+)/, async (ctx) => {
    if (!requireBind(ctx)) return;
    await sendMd(ctx, escapeMarkdownV2('Синтаксис: /prompt[:agent] <запрос> (агенты: qwen, vb)'));
  });
  // Фолбэк VL-94 для /<фаза>:<неизвестный агент>: как у /prompt — command-
  // хендлеры выше не сматчат 'spec:foo' (только зарегистрированные имена),
  // подсказка шлётся здесь, спавна нет
  bot.hears(/^\/(spec|plan|code|close|comment):(\S+)/, async (ctx) => {
    if (!requireBind(ctx)) return;
    const cmd = ctx.match?.[1] ?? 'команда';
    await sendMd(ctx, escapeMarkdownV2(`Синтаксис: /${cmd}[:agent] … (агенты: qwen, vb)`));
  });
  // ── /restart — самоперезапуск бота (VL-70/107) ──
  // Сценарий разработки: после pnpm build старый процесс исполняет старый
  // dist/. Бот рестартует САМ СЕБЯ по команде из чата: гасит polling и
  // поднимает новый vibelog bot в том же терминале — пин нового запуска
  // печатается там же, новый процесс исполняет свежий dist/. CLI
  // `vibelog restart` с pid-файлом отменён: он заменял только Ctrl+C.
  // VL-107: /restart VL-N собирает worktree ветки vb/vl-N и запускает бота
  // из …/vl-N/bin/vibelog.mjs (исполняет dist ветки); cwd остаётся главным —
  // токен/backlog/.vibelog общие. Без аргумента — прежнее поведение (корневой dist).
  bot.command('restart', async (ctx) => {
    if (!requireBind(ctx)) return;
    const chatId = ctx.chat?.id;
    const parsed = parseRestartCommand((ctx.match ?? '').toString());
    if ('error' in parsed) {
      await sendMd(ctx, parsed.error);
      return;
    }
    let cliPath: string | undefined;
    if (parsed.taskId) {
      const taskId = parsed.taskId;
      await sendMd(ctx, `🔧 Сборка ветки ${taskBranchName(taskId)}…`);
      // Ошибки ensure/build — в чат, процесс НЕ трогаем: бот продолжает
      // работать из текущего dist, пользователь может исправить и повторить
      let dir: string;
      try {
        dir = ensureTaskWorktree(deps.cwd, taskId);
      } catch (err) {
        await sendMd(ctx, `⚠️ ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      try {
        buildTaskWorktree(deps.cwd, taskId);
      } catch (err) {
        await sendMd(ctx, `⚠️ ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      cliPath = worktreeCliPath(deps.cwd, taskId);
      await sendMd(ctx, `✅ Ветка ${taskBranchName(taskId)} собрана (${dir})`);
    }
    await sendMd(ctx, '🔄 Перезапуск бота…');
    // Порядок обязателен: два параллельных long-polling с одним токеном —
    // Telegram отвечает 409 Conflict; сначала гасим старый, потом спавним новый
    try {
      await bot.stop();
    } catch {
      // polling ещё не стартовал или уже остановлен — не критично
    }
    const child = spawnReplacementBot(deps.cwd, 'inherit', cliPath);
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
    // ── Кнопка документа в списке /docs (VL-89): data = doc:<id> ──
    // Полный аналог команды /doc <id>: карточка через sendDocView.
    // answerCallbackQuery обязателен в любом исходе — иначе «часики».
    if (data.startsWith('doc:')) {
      const id = data.slice('doc:'.length).trim();
      if (!requireBind(ctx)) {
        await ctx
          .answerCallbackQuery({ text: 'Бот не привязан к чату — выполните /start' })
          .catch(() => {});
        return;
      }
      const chatId = ctx.chat?.id;
      const backlogDir = findBacklogDir(deps.cwd);
      const entry = backlogDir ? getDocument(backlogDir, id) : null;
      if (chatId === undefined || !entry) {
        await ctx.answerCallbackQuery({ text: `Документ ${id} не найден.` }).catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery({ text: `📄 ${entry.document.id}` }).catch(() => {});
      await sendDocView(bot, chatId, entry);
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
    // Агент по умолчанию из настроек (VL-94): кнопки действий — как команды
    const agent = resolveDefaultAgent(deps.cwd);
    const result = startPhase(deps.cwd, task.id, next.phase, onExit, { comment: '' }, agent);
    if ('error' in result) {
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(
      ctx,
      `🚀 Фаза ${next.label} (${agent}) запущена для *${task.id}*, PID ${result.pid}`
    );
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
      await commitComment(taskId, text, chatId, resolveDefaultAgent(deps.cwd));
    } catch (err) {
      await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  // ── VL-93: reply на информационное сообщение бота → resume сессии qwen ──
  // Строго МЕЖДУ awaitingComment (VL-78) и catch-all пина (ловушка порядка
  // grammy VL-37): все «не мой случай» ветки уходят next() дальше — иначе
  // catch-all пина перехватил бы reply и остановил цепочку.
  bot.on('message:text', async (ctx, next) => {
    const reply = ctx.message.reply_to_message;
    if (!reply) {
      await next();
      return;
    }
    // Текст сообщения-ответа: обычное text-сообщение (MarkdownV2-фолбэк
    // formatPhaseResult) либо rich-сообщение (sendRichMessage, VL-71) —
    // у него НЕТ поля text, контент в rich_message.blocks (типы Telegram:
    // RichMessageMessage = CommonMessage & MsgWith<"rich_message">).
    // Раньше reply.text === undefined для rich-сообщения давал next() и
    // тишину — жалоба Pavel 2026-10-05 «нет реакции на reply» (фикс VL-93).
    const replyText =
      typeof reply.text === 'string' && reply.text
        ? reply.text
        : reply.rich_message
          ? richToText(reply.rich_message)
          : '';
    // Обычные тексты и reply без текста — к следующим обработчикам
    if (!replyText) {
      await next();
      return;
    }
    // Resume имеет смысл только на сообщения бота: информационное
    // сообщение фазы содержит session_id; в сообщениях пользователей
    // идентификаторов сессий нет
    if (!reply.from?.is_bot) {
      await next();
      return;
    }
    // Без session_id (прочие сообщения бота) — поведение пина/комментария
    // не меняется
    const ref = extractSessionRef(replyText);
    if (!ref) {
      await next();
      return;
    }
    if (!requireBind(ctx)) return;
    // Промпт — сырой текст reply-сообщения; resume вне жизненного цикла
    // фаз задачи — карточка не шлётся, только информационное сообщение
    // (паттерн sendPhaseResult, VL-63/71)
    const chatId = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (chatId === undefined) return;
      void sendPhaseResult(bot, chatId, run);
    };
    // Агент прокидывается из ref (VL-95): vb-сессии возобновляются через
    // --resume vibelog-agent, qwen — как раньше (VL-93)
    const result = startResume(deps.cwd, ref.sessionId, ctx.message.text.trim(), onExit, ref.agent);
    if ('error' in result) {
      // Guard «Запуск уже выполняется» (resume либо фаза в этом процессе)
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(
      ctx,
      `🔄 Сессия возобновлена (resume ${escapeMarkdownV2(ref.sessionId)}), PID ${result.pid}`
    );
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
