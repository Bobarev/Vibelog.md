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
      return runSearch(args.slice(1), flags, cwd);
    case 'instructions':
      return runInstructions(positional, flags, cwd);
    case 'mcp':
      return runMcp(subcommand, positional, flags, cwd);
    case 'browser':
      return runBrowser(positional, flags, cwd);
    case 'doctor':
      return runDoctor(positional, flags, cwd);
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
  ${colorize('search', colors.cyan)} "query" [--json]            Поиск задач
  ${colorize('instructions', colors.cyan)} [topic]               Инструкции для агентов
  ${colorize('mcp', colors.cyan)} start                        MCP-сервер (JSON-RPC)
  ${colorize('doctor', colors.cyan)} [--json]                    Диагностика окружения
  ${colorize('--version', colors.cyan)}, ${colorize('-v', colors.cyan)}                 Версия и пути
  ${colorize('help', colors.cyan)}                                Эта справка

${colorize('Примеры:', colors.bold)}
  vibelog init "My Project"
  vibelog task create "Заголовок" -d "Описание" --ac "Критерий"
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
vibelog init [name] [--prefix LB]

Инициализирует backlog-директорию и конфиг.
  name     — имя проекта (по умолчанию "My Project")
  --prefix — префикс ID задач (по умолчанию "LB")`,

    task: `
vibelog task <subcommand> [опции]

Подкоманды:
  create "Title" [-d desc] [--ac ...] [--dod ...] [--priority ...] [--labels ...] [--deps ...] [--milestone ...]
  list [-s status] [-l labels] [--ready] [--sort priority|created|updated] [--json]
  view <id> [--json]
  edit <id> [--title ...] [--status ...] [--ac ...] [--check-ac N] [--dod ...] [--check-dod N] [--comment ...] [--assignee ...] [--remove-label ...]
  complete <id>
  archive <id>`,

    board: `
vibelog board [--export]

Отображает канбан-доску в терминале.
  --export — экспорт в markdown-формат`,

    search: `
vibelog search "query" [--json]

Поиск задач по заголовку, описанию и меткам.`,

    instructions: `
vibelog instructions [topic]

Выводит инструкции для AI-агентов.
Темы: overview, task-creation, task-execution, task-finalization`,

    doctor: `
vibelog doctor [--json]

Диагностика окружения:
  Проверяет Node.js, PATH, симлинки, MCP-инструменты, backlog/, конфиг.
  --json — структурированный результат`,
  };

  const text = helpTexts[command];
  if (text) {
    console.log(text);
  } else {
    console.log(`Справка для команды "${command}" не найдена.`);
  }
}
