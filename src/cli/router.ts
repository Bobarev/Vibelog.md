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
 *
 * Алиас: `vb` — тот же бинарь (bin.vb → ./bin/vibelog.mjs), поведение
 * не зависит от имени argv[0]. Без аргументов — справка (VL-158);
 * чат с агентом — vibelog agent [task-id].
 */

import { parseArgs } from './args.js';
import { printHeader, printInfo, colorize, colors } from './ui.js';
import { runInit } from './commands/init.js';
import { runTask } from './commands/task.js';
import { runBoard } from './commands/board.js';
import { runSearch } from './commands/search.js';
import { runMap } from './commands/map.js';
import { runInstructions } from './commands/instructions.js';
import { runMcp } from './commands/mcp.js';
import { runBrowser } from './commands/browser.js';
import { runVersion } from './commands/version.js';
import { runDoctor } from './commands/doctor.js';
import { runMilestone } from './commands/milestone.js';
import { runDoc } from './commands/doc.js';
import { runConfig } from './commands/config.js';
import { runModel, runProvider } from './commands/model.js';
import { runDraft } from './commands/draft.js';
import { runDecision } from './commands/decision.js';
import { runBot } from './commands/bot.js';
import { runQwenDebug } from './commands/qwen-debug.js';
import { runAgent } from './commands/agent.js';
import { runSession } from './commands/session.js';
import { runReference } from './commands/reference.js';
import { runLesson } from './commands/lesson.js';
import { runExperiment } from './commands/experiment.js';

/**
 * Обработать аргументы командной строки и вызвать соответствующую команду.
 *
 * @param args — аргументы командной строки (без node и пути к скрипту)
 */
export async function route(args: string[]): Promise<void> {
  const { command, subcommand, positional, flags } = parseArgs(args);

  // --version / -v — перехват ДО роутинга (совместимо с оригиналом Backlog.md)
  if (args.includes('--version') || args.includes('-v')) {
    return runVersion(args, flags);
  }

  // Без команды — показываем справку (VL-158: всегда, в т.ч. в TTY;
  // чат с агентом перенесён в vibelog agent)
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
    case 'map':
      // VL-235: первый аргумент запроса попадает в subcommand (как у search)
      return runMap([subcommand, ...positional].filter(Boolean), flags, cwd);
    case 'instructions':
      return runInstructions(positional, flags, cwd);
    case 'mcp':
      return runMcp(subcommand, positional, flags, cwd);
    case 'browser':
      // VL-189: runBrowser возвращает Server (для закрытия в тестах) —
      // route: Promise<void>, поэтому прямой return Server не типизируется
      await runBrowser(positional, flags, cwd);
      return;
    case 'bot':
      return runBot(positional, flags, cwd);
    case 'qwen-debug':
      return runQwenDebug(cwd);
    case 'agent':
      return runAgent(subcommand, positional, flags, cwd);
    // VL-261: сводка сессии агента по jsonl; agent-session — алиас из
    // описания задачи (обе формы ведут в один обработчик)
    case 'session':
    case 'agent-session':
      return runSession(subcommand, positional, flags, cwd);
    case 'doctor':
      return runDoctor(positional, flags, cwd);
    case 'milestone':
      return runMilestone(subcommand, positional, flags, cwd);
    case 'doc':
      return runDoc(subcommand, positional, flags, cwd);
    case 'reference':
      return runReference(subcommand, positional, flags, cwd);
    case 'lesson':
      return runLesson(subcommand, positional, flags, cwd);
    // VL-294: каркас экспериментов (A/B) — create/list
    case 'experiment':
      return runExperiment(subcommand, positional, flags, cwd);
    case 'config':
      return runConfig(subcommand, positional, flags, cwd);
    case 'model':
      return runModel(subcommand, positional, flags, cwd);
    case 'provider':
      return runProvider(subcommand, positional, flags, cwd);
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
function showHelp(): void {
  console.log(`
${colorize('Vibelog.md', colors.bold)} — markdown-нативный таск-менеджер

${colorize('Команды:', colors.bold)}
  ${colorize('init', colors.cyan)} [name] [--prefix LB]          Инициализировать backlog
  ${colorize('task', colors.cyan)} create|list|view|edit|...     Управление задачами
  ${colorize('board', colors.cyan)} [--export]                   Канбан-доска
  ${colorize('browser', colors.cyan)} [--port N] [--host ADDR]   Веб-интерфейс
  ${colorize('bot', colors.cyan)}                             Telegram-бот (grammy)
  ${colorize('agent', colors.cyan)} [task-id]               Чат с LLM-агентом (TUI); analyze <ref> [комментарий] — анализ сессии
  ${colorize('session', colors.cyan)} summary|outline <id> [--task VL-N] [--json]  Сводка/обзор транскрипта сессии
  ${colorize('qwen-debug', colors.cyan)}                  Дебаг-прогон qwen (ping, stream-json)
  ${colorize('search', colors.cyan)} "query" [--status ...]      Поиск задач с фильтрами
  ${colorize('map', colors.cyan)} [query] [--dir src] [--limit N]  Карта проекта: модули + назначение + экспорты
  ${colorize('instructions', colors.cyan)} [topic]               Инструкции для агентов
  ${colorize('mcp', colors.cyan)} start                        MCP-сервер (JSON-RPC)
  ${colorize('milestone', colors.cyan)} add|list|rename|...      Управление вехами
  ${colorize('doc', colors.cyan)} create|list|...          Документы (spec/guide)
  ${colorize('reference', colors.cyan)} list|add|...          Референсы (repo/url/file/doc/spec/experiment)
  ${colorize('lesson', colors.cyan)} list|create|...         Уроки из задач (lessons learned)
  ${colorize('experiment', colors.cyan)} create|list            Эксперименты (A/B): карточки backlog/experiments/
  ${colorize('config', colors.cyan)} get|set|list             Конфиг проекта
  ${colorize('model', colors.cyan)} list|use|current          LLM-модели: список, переключение
  ${colorize('provider', colors.cyan)} list                   LLM-провайдеры (base_url, ключ)
  ${colorize('draft', colors.cyan)} create|promote|...       Черновики задач
  ${colorize('decision', colors.cyan)} create|list|...         Решения (ADR)
  ${colorize('doctor', colors.cyan)} [--json]                    Диагностика окружения
  ${colorize('--version', colors.cyan)}, ${colorize('-v', colors.cyan)}                 Версия и пути
  ${colorize('help', colors.cyan)}                                Эта справка

${colorize('Алиас:', colors.bold)} vb — то же самое, что vibelog
${colorize('Без аргументов:', colors.bold)} показывается эта справка; чат с агентом — vibelog agent

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
 */
function showCommandHelp(command: string): void {
  const helpTexts: Record<string, string> = {
    init: `
vibelog init [name] [--prefix LB] [--no-mcp] [--force]

Инициализирует backlog-директорию и конфиг.
  name        — имя проекта (по умолчанию "My Project")
  --prefix    — префикс ID задач (по умолчанию "LB")
  --no-mcp    — не настраивать MCP-сервер (.qwen/settings.json)
  --force     — перезаписать существующие настройки`,

    'qwen-debug': `
vibelog qwen-debug

Дебаг-прогон qwen: «Пинг, просто ответь понг.» + --output-format stream-json
+ --allowed-mcp-server-names vibelog + --debug. stdio наследуется —
события видны в терминале. VIBELOG_QWEN_BIN переопределяет бинарь.`,

    task: `
vibelog task <subcommand> [опции]

Подкоманды:
  create "Title" [-d desc] [--ac ...] [--dod ...] [--priority ...] [--labels ...] [--deps ...] [--milestone ...] [--type ...] [--plan ...] [--notes ...] [--project ...] [--parent ID] [--ordinal N] [--final-summary ...] [--draft] [--no-dod-defaults]
  list [-s status] [-l labels] [--type type] [--parent ID] [--ready] [--sort priority|created|updated] [--limit N] [--skip N] [--json]
  view <id> [--json]
  edit <id> [--title ...] [--status ...] [--type ...] [--parent ID] [--ac ...] [--check-ac N[,N]] [--dod ...] [--check-dod N[,N]] [--comment ...] [--assignee ...] [--remove-label ...] [--plan ...] [--notes ...] [--append-notes ...] [--final-summary ...] [--append-final-summary ...] [--clear-final-summary] [--ordinal N]
  complete <id>
  reject <id> [комментарий]  — отклонить задачу (Rejected + completed/; если задача была в Code — предварительный откат через LLM)
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

    map: `
vibelog map [query] [--dir PATH] [--limit N] [--no-exports] [--json]

Карта проекта (VL-235): модули каталога src/ — путь, назначение (первая строка
шапки модуля) и экспорты. Read-only, читает файлы на момент вызова.
  query      — подстрока по пути/описанию/экспортам; выборка с полными описаниями
  --dir      — каталог карты (по умолчанию src; "" — весь проект)
  --limit    — максимум модулей (по умолчанию 150)
  --no-exports — без списков экспортов
  --json     — машиночитаемый вывод ({schemaVersion, kind:'map', data})

Пример: vibelog map htmlToMarkdown`,

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

    reference: `
vibelog reference <subcommand> [опции]

Внешние источники знаний (VL-152). Метаданные: backlog/references/<id>-<slug>.md;
клоны репозиториев: backlog/references/data/, markdown-кэш: backlog/references/cache/
(оба в .gitignore).

Подкоманды:
  list [--type repo|url|file|doc|spec] [--tags a,b] [--json]
  add <title> [--type T] [--url ...] [--path ...] [--tags ...] [-d desc] [--no-clone] [--cache]
      (type=repo по умолчанию клонирует в data/<dir>; --no-clone — только метаданные;
       --cache — скачать url и сохранить markdown в cache/<id>.md)
  view <id>                           — при наличии кэша печатает markdown-кэш
  search <query>
  link <refId> <taskId> [--remove]   — двусторонняя связь: linked_tasks ↔ task.references
  remove <id>                        — удаляет метаданные; клон в data/ сохраняется
  sync [ref-id] [--all]              — без аргументов: доклонировать отсутствующие (type=repo);
                                       ref-id: перекачать кэш одного (сверка source_hash);
                                       --all: клоны + кэши всех url/doc/spec`,

    lesson: `
vibelog lesson <subcommand> [опции]

Уроки из задач (lessons learned, VL-153). Метаданные: backlog/lessons/lesson-N-<slug>.md.
Урок эволюционирует вне замороженной задачи: устаревает, заменяется (supersede).

Подкоманды:
  list [--status active|needs-review|outdated|superseded] [--tags a,b] [--json]
  create <title> [--tags ...] [--source-tasks VL-1,VL-2] [-d desc]
  view <id>
  search <query>
  link <lessonId> <taskId> [--remove]  — двусторонняя связь: linked_tasks ↔ task.lessons
  supersede <oldId> <newId>            — newId заменяет oldId (oldId → superseded)
  audit [--write] [--threshold N] [--stale-days N] [--json]
                                       — механический аудит (VL-279): битые пути,
                                         висячие ссылки, дубли, протухание;
                                         --write пишет backlog/lessons/AUDIT.md;
                                         --verify id1,id2 / --needs-review id1,id2 —
                                         явные правки по конкретным урокам`,

    config: `
vibelog config <subcommand> [опции]

Подкоманды:
  get <key>           Показать значение ключа
  set <key> <value>   Изменить значение (массивы: JSON или через запятую)
  list                Все ключи конфига`,

    model: `
vibelog model <subcommand>

Управление LLM-моделями (.vibelog/settings.json, секция models, VL-209):
  list      Список моделей (* — активная, models.default)
  use <id>  Переключить активную модель (записывает models.default)
  current   Активная модель (или env VIBELOG_LLM_MODEL при fallback)

Без секции models используется env VIBELOG_LLM_MODEL (как раньше).`,

    provider: `
vibelog provider <subcommand>

Провайдеры LLM (.vibelog/settings.json, секция providers, VL-209):
  list      id, base_url, api_key_env + статус ключа (значения не выводятся)`,

    bot: `
vibelog bot

Запускает Telegram-бота (long polling). Токен: TELEGRAM_BOT_TOKEN в .env
или в секции env .vibelog/settings.json. При старте в консоль печатается пин-код —
введите его в Telegram после /start для привязки чата.

Команды: /tasks, /task <id>, /board`,

    agent: `
vibelog agent [task-id] [--resume <session-ref>]
vibelog agent analyze <session-ref> [комментарий]

Интерактивный TUI-чат с LLM-агентом (VL-158, нужен терминал):
  task-id — карточка задачи добавляется в контекст чата
  --resume <session-ref> (VL-171) — чат продолжает сохранённую сессию
    (vb:agent-XXX либо agent-XXX; префикс vb: необязателен)

Штатный разбор сессии vibelog-agent (VL-141) — CLI-паритет /analyze бота:
статистика jsonl (длительность, wall-убийства, прогоны «Продолжи», профиль
tool-вызовов), вердикт «объём задачи vs тупик», рекомендации.
  session-ref — vb:agent-XXX либо agent-XXX (только сессии vibelog-agent)
  комментарий — необязательный (VL-169): уточнение к разбору, как в /analyze бота`,

    session: `
vibelog session summary <sessionId|--task VL-N> [--json]

Готовая сводка сессии агента (VL-261) вместо ручного чтения jsonl:
  <sessionId>  — id сессии (agent-…); префикс vb:/qwen: снимается
  --task VL-N  — последняя сессия задачи (по *.meta.json)
  --json       — стабильная схема (schemaVersion, kind=session-summary)

Выводит: строк/ранов; по каждому рану — фазу, строки-границы маркеров
промптов, тайминги (мета/billing), LLM-запросы, input/output/cache/reasoning,
max payload_bytes, инструменты, правки; агрегаты: tool→count, топ-5 скелетов
run_shell_command, топ чтений и правок (edit / write_file раздельно).

Обзор транскрипта (VL-258) — вместо чтения килобайтов jsonl:
vibelog session outline <sessionId|--task VL-N> [--offset N] [--limit N] [--json]
  по каждой строке — индекс, роль, байты, tool_calls, маркер рана/фазы,
  первые 80 символов; плюс секция «Раны» (фаза → строка). Строка с максимальным
  размером — индикатор дублирования промпта. Целевые строки читаются
  обычным read_file с диапазоном "файл:N-M".

Алиас: vibelog agent-session summary ...`,

    draft: `
vibelog draft <subcommand> [опции]

Подкоманды:
  create <title> [-d desc] [-l labels]
  list
  view <id>
  edit <id> [--title ...] [-d desc] [-l labels]
  promote <id>      — черновик → задача (черновик удаляется)
  archive <id>      — перенос в completed/`,

    browser: `
vibelog browser [--port N] [--host ADDR] [--no-open]

Веб-интерфейс (kanban с drag-and-drop).
  --port  — порт (по умолчанию default_port из config, иначе 3030)
  --host  — адрес прослушивания: 127.0.0.1 (по умолчанию) или 0.0.0.0
            для доступа из локальной сети. При wildcard-адресе в консоль
            печатаются локальный URL и LAN-адреса машины
  --no-open — не открывать браузер

Хост можно задать настройкой web_host в .vibelog/settings.json (флаг приоритетнее).`,

    decision: `
vibelog decision <subcommand> [опции]

Подкоманды:
  create <title> [-s status] [--context ...] [--decision ...] [--consequences ...]
  list [--status S]
  view <id>

Статусы (free-form, дефолт proposed): proposed, accepted, rejected, superseded`,
  };

  // VL-261: agent-session — алиас session; справка берётся у основной команды
  const text = helpTexts[command === 'agent-session' ? 'session' : command];
  if (text) {
    console.log(text);
  } else {
    console.log(`Справка для команды "${command}" не найдена.`);
  }
}
