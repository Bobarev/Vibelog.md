/**
 * Роутер CLI-команд Vibelog.md.
 *
 * Разбирает аргументы командной строки и делегирует
 * выполнение соответствующему обработчику.
 *
 * Команды:
 * - init — инициализация backlog-а
 * - task — управление задачами (create, list, view, edit, complete, archive)
 * - board — канбан-доска
 * - search — поиск задач
 * - instructions — инструкции для агентов
 * - help — справка
 */

import { parseArgs } from './args.mjs';
import { printHeader, printInfo, colorize, colors } from './ui.mjs';
import { runInit } from './commands/init.mjs';
import { runTask } from './commands/task.mjs';
import { runBoard } from './commands/board.mjs';
import { runSearch } from './commands/search.mjs';
import { runInstructions } from './commands/instructions.mjs';
import { runMcp } from './commands/mcp.mjs';
import { runBrowser } from './commands/browser.mjs';
import { runVersion } from './commands/version.mjs';
import { runDoctor } from './commands/doctor.mjs';
import { runMilestone } from './commands/milestone.mjs';
import { runDoc } from './commands/doc.mjs';
import { runConfig } from './commands/config.mjs';
import { runDraft } from './commands/draft.mjs';
import { runDecision } from './commands/decision.mjs';

/**
 * Обработать аргументы командной строки и вызвать соответствующую команду.
 *
 * @param {string[]} args — аргументы командной строки (без node и пути к скрипту)
 * @returns {Promise<void>}
 */
export async function route(args) {
  const { command, subcommand, positional, flags } = parseArgs(args);

  // --version / -v — перехват ДО роутинга (совместимо с оригиналом Backlog.md)
  if (args.includes('--version') || args.includes('-v')) {
    return runVersion(args, flags);
  }

  // Без команды — показываем справку
  if (!command || command === 'help') {
    return showHelp();
  }

  // --help для любой команды
  if (flags.help || flags.h) {
    return showCommandHelp(command);
  }

  const cwd = process.cwd();

  switch (command) {
    case 'init':
      return runInit(args.slice(1), flags, cwd);
    case 'task':
      return runTask(subcommand, positional, flags, cwd);
    case 'board':
      return runBoard(positional, flags, cwd);
    case 'search':
      // search без подкоманд: первое слово запроса попадает в subcommand,
      // остальные — в positional; значения флагов в запрос не идут
      return runSearch([subcommand, ...positional].filter(Boolean), flags, cwd);
    case 'instructions':
      return runInstructions(positional, flags, cwd);
    case 'mcp':
      return runMcp(subcommand, positional, flags, cwd);
    case 'browser':
      return runBrowser(positional, flags, cwd);
    case 'doctor':
      return runDoctor(positional, flags, cwd);
    case 'milestone':
      return runMilestone(subcommand, positional, flags, cwd);
    case 'doc':
      return runDoc(subcommand, positional, flags, cwd);
    case 'config':
      return runConfig(subcommand, positional, flags, cwd);
    case 'draft':
      return runDraft(subcommand, positional, flags, cwd);
    case 'decision':
      return runDecision(subcommand, positional, flags, cwd);
    default:
      console.error(`Ошибка: Неизвестная команда: ${command}`);
      showHelp();
      process.exit(1);
  }
}

/**
 * Выводит общую справку.
 */
function showHelp() {
  console.log(`
${colorize('Vibelog.md', colors.bold)} — markdown-нативный таск-менеджер

${colorize('Команды:', colors.bold)}
  ${colorize('init', colors.cyan)} [name] [--prefix LB]          Инициализировать backlog
  ${colorize('task', colors.cyan)} create|list|view|edit|...     Управление задачами
  ${colorize('board', colors.cyan)} [--export]                   Канбан-доска
  ${colorize('browser', colors.cyan)} [--port N] [--no-open]      Веб-интерфейс
  ${colorize('search', colors.cyan)} "query" [--status ...]      Поиск задач с фильтрами
  ${colorize('instructions', colors.cyan)} [topic]               Инструкции для агентов
  ${colorize('mcp', colors.cyan)} start                        MCP-сервер (JSON-RPC)
  ${colorize('milestone', colors.cyan)} add|list|rename|...      Управление вехами
  ${colorize('doc', colors.cyan)} create|list|...          Документы (spec/guide)
  ${colorize('config', colors.cyan)} get|set|list             Конфиг проекта
  ${colorize('draft', colors.cyan)} create|promote|...       Черновики задач
  ${colorize('decision', colors.cyan)} create|list|...         Решения (ADR)
  ${colorize('doctor', colors.cyan)} [--json]                    Диагностика окружения
  ${colorize('--version', colors.cyan)}, ${colorize('-v', colors.cyan)}                 Версия и пути
  ${colorize('help', colors.cyan)}                                Эта справка

${colorize('Примеры:', colors.bold)}
  vibelog init "My Project"
  vibelog task create "Заголовок" -d "Описание" --ac "Критерий" --type bug
  vibelog task list -s "To Do"
  vibelog task view LB-1
  vibelog board
  vibelog search "авторизация"

${colorize('Подробнее:', colors.dim)} vibelog <command> --help`);
}

/**
 * Выводит справку по конкретной команде.
 *
 * @param {string} command
 */
function showCommandHelp(command) {
  const helpTexts = {
    init: `
vibelog init [name] [--prefix LB] [--skills[=qwen]] [--no-skills] [--no-mcp] [--force]

Инициализирует backlog-директорию и конфиг.
  name        — имя проекта (по умолчанию "My Project")
  --prefix    — префикс ID задач (по умолчанию "LB")
  --skills    — создать команды /vibelog:* для Qwen Code (.qwen/commands/)
  --skills=qwen — явно указать агента (claude пока не поддерживается)
  --no-skills — не создавать команды
  --no-mcp    — не настраивать MCP-сервер (.qwen/settings.json)
  --force     — перезаписать существующие команды`,

    task: `
vibelog task <subcommand> [опции]

Подкоманды:
  create "Title" [-d desc] [--ac ...] [--dod ...] [--priority ...] [--labels ...] [--deps ...] [--milestone ...] [--type ...] [--plan ...] [--notes ...] [--project ...] [--parent ID] [--ordinal N] [--final-summary ...] [--draft] [--no-dod-defaults]
  list [-s status] [-l labels] [--type type] [--ready] [--sort priority|created|updated] [--limit N] [--skip N] [--json]
  view <id> [--json]
  edit <id> [--title ...] [--status ...] [--type ...] [--ac ...] [--check-ac N[,N]] [--dod ...] [--check-dod N[,N]] [--comment ...] [--assignee ...] [--remove-label ...] [--plan ...] [--notes ...] [--append-notes ...] [--final-summary ...] [--append-final-summary ...] [--clear-final-summary] [--ordinal N]
  complete <id>
  archive <id>`,

    board: `
vibelog board [--export]

Отображает канбан-доску в терминале.
  --export — экспорт в markdown-формат`,

    search: `
vibelog search "query" [--status S] [--type T] [--priority P] [--limit N] [--json]

Поиск задач по текстовому запросу + фильтры полей.
Запрос необязателен, если указан хотя бы один фильтр.
  --status   — фильтр по статусу
  --type     — фильтр по типу (bug, feature, ...)
  --priority — фильтр по приоритету
  --limit    — максимум результатов`,

    instructions: `
vibelog instructions [topic]

Выводит инструкции для AI-агентов.
Темы: overview, task-creation, task-execution, task-finalization`,

    doctor: `
vibelog doctor [--json]

Диагностика окружения:
  Проверяет Node.js, PATH, симлинки, MCP-инструменты, backlog/, конфиг.
  --json — структурированный результат`,

    milestone: `
vibelog milestone <subcommand> [опции]

Подкоманды:
  add <name> [-d desc] [--due-date YYYY-MM-DD]
  list [--show-completed]
  rename <from> <to> [--no-update-tasks]
  remove <name> [--task-handling clear|keep|reassign] [--reassign-to <name>]
  archive <name>`,

    doc: `
vibelog doc <subcommand> [опции]

Подкоманды:
  create <title> [--type readme|guide|specification|other] [--tags a,b]
  list [--type T]
  view <id>
  update <id> [--title ...] [--type ...] [--tags ...]
  search <query>`,

    config: `
vibelog config <subcommand> [опции]

Подкоманды:
  get <key>           Показать значение ключа
  set <key> <value>   Изменить значение (массивы: JSON или через запятую)
  list                Все ключи конфига`,

    draft: `
vibelog draft <subcommand> [опции]

Подкоманды:
  create <title> [-d desc] [-l labels]
  list
  view <id>
  edit <id> [--title ...] [-d desc] [-l labels]
  promote <id>      — черновик → задача (черновик удаляется)
  archive <id>      — перенос в completed/`,

    decision: `
vibelog decision <subcommand> [опции]

Подкоманды:
  create <title> [-s status] [--context ...] [--decision ...] [--consequences ...]
  list [--status S]
  view <id>

Статусы (free-form, дефолт proposed): proposed, accepted, rejected, superseded`,
  };

  const text = helpTexts[command];
  if (text) {
    console.log(text);
  } else {
    console.log(`Справка для команды "${command}" не найдена.`);
  }
}
