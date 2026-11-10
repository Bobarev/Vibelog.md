/**
 * Реестр CLI-команд Vibelog.md (VL-394).
 *
 * Единственный источник списка команд для справочника `vibelog capabilities`
 * (перечень в `src/cli/router.ts#showHelp` — расширенная справка с флагами,
 * она живёт отдельно и не является реестром).
 *
 * Зачем отдельный модуль, а не литерал в шаблоне текста: AC4 требует, чтобы
 * добавление команды в реестр автоматически появлялось в выводе команды
 * `capabilities`. Шаблон текста со списком команд разъезжался бы с роутером
 * (новая команда есть в switch, а в справочнике её нет) — именно этого
 * задача и должна избежать по конструкции.
 *
 * Синхронность с роутером ловится тестом-инвариантом
 * (`src/cli/capabilities-cli.test.mjs`): каждая запись обязана иметь непустые
 * `name`/`summary`, дублей быть не может, а сам роутер обязан знать команду
 * `capabilities`.
 */

/** Запись реестра CLI-команд: имя и одна строка назначения. */
export interface CliCommandEntry {
  /** Имя команды в том виде, как его вводят: `vibelog <name>`. */
  name: string;
  /** Одна строка назначения (для справочника; полная справка — `<name> --help`). */
  summary: string;
}

/**
 * Все CLI-команды проекта.
 *
 * Порядок — как в `src/cli/router.ts` (сначала init/install/create/upstream,
 * затем повседневные команды, служебные и алиасы в конце): читателю
 * справочника проще, если он совпадает со справкой роутера.
 */
export const CLI_COMMANDS: readonly CliCommandEntry[] = [
  { name: 'init', summary: 'Wizard настройки проекта: backlog/, конфиг, MCP, агент, LLM, бот' },
  { name: 'install', summary: 'Установка компонента из реестра <alias>/<repo>/<name>' },
  { name: 'create', summary: 'Новый проект из шаблона (sparse-checkout, зависимости, postCreate)' },
  { name: 'upstream', summary: 'Баг-репорты между проектами: report | pull | ack' },
  { name: 'task', summary: 'Задачи: create, list, view, edit, complete, reject, archive' },
  { name: 'board', summary: 'Канбан-доска в терминале (--export — markdown)' },
  { name: 'search', summary: 'Поиск задач по тексту и фильтрам (статус, тип, приоритет)' },
  { name: 'map', summary: 'Карта проекта: модули, назначение, экспорты; --query для поиска' },
  { name: 'capabilities', summary: 'Справочник возможностей: workflow, фазы, MCP, CLI, ключи конфигов' },
  { name: 'instructions', summary: 'Инструкции для агента: overview, workflow, mcp, settings, task-*' },
  { name: 'mcp', summary: 'MCP-сервер по stdio: mcp start' },
  { name: 'browser', summary: 'Веб-интерфейс проекта (--port, --host)' },
  { name: 'bot', summary: 'Telegram-бот: фазы и действия из чата' },
  { name: 'qwen-debug', summary: 'Дебаг-прогон qwen (ping, stream-json) для диагностики агента' },
  { name: 'agent', summary: 'Чат с LLM-агентом (TUI); run — headless-запуск фазы' },
  { name: 'session', summary: 'Сводка и обзор транскрипта сессии агента (summary|outline)' },
  { name: 'doctor', summary: 'Диагностика окружения и инвариантов MCP-реестра' },
  { name: 'status', summary: 'Сводка «где я»: версия, задачи, фазы, очередь, grant, git' },
  { name: 'milestone', summary: 'Вехи: add, list, rename, remove, archive' },
  { name: 'doc', summary: 'Документы проекта: create, list, view, update, search' },
  { name: 'reference', summary: 'Внешние источники знаний: repo/url/file/doc/spec, клоны и кэш' },
  { name: 'lesson', summary: 'Уроки из задач: create, list, link, supersede, audit' },
  { name: 'experiment', summary: 'Эксперименты A/B: create, list, dataset, run, record, report, judge, gc' },
  { name: 'config', summary: 'Конфиг проекта (backlog/config.yml): get, set, list' },
  { name: 'workflow', summary: 'Workflow проекта: show (схема и источник), validate (диагностика), apply (запись)' },
  { name: 'model', summary: 'LLM-модели: list, use, current' },
  { name: 'provider', summary: 'LLM-шлюзы (base_url, ключ): list' },
  { name: 'gateway', summary: 'Алиас provider: LLM-шлюзы (base_url, ключ)' },
  { name: 'draft', summary: 'Черновики задач: быстрый захват и promote в задачу' },
  { name: 'decision', summary: 'Архитектурные решения (ADR): create, list, view' },
];
