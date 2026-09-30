# CLI-справочник Vibelog.md

Полная справка по командам. Источник истины — `vibelog <команда> --help`.

Смотрите также: [Руководство пользователя](user-guide.md) · [MCP-справочник](mcp-reference.md)

---

## init

```
vibelog init [name] [--prefix LB] [--skills[=qwen]] [--no-skills] [--no-mcp] [--force]
```

Инициализирует backlog-директорию и конфиг.

| Флаг | Описание |
|---|---|
| `name` | Имя проекта (по умолчанию "My Project") |
| `--prefix` | Префикс ID задач (по умолчанию "LB") |
| `--skills` | Создать команды /vibelog:* для Qwen Code (.qwen/commands/) |
| `--skills=qwen` | Явно указать агента (claude пока не поддерживается) |
| `--no-skills` | Не создавать команды |
| `--no-mcp` | Не настраивать MCP-сервер (.qwen/settings.json) |
| `--force` | Перезаписать существующие команды |

---

## task

```
vibelog task <subcommand> [опции]
```

### create

```
task create "Title" [-d desc] [--ac ...] [--dod ...] [--priority ...] [--labels ...]
  [--deps ...] [--milestone ...] [--type ...] [--plan ...] [--notes ...]
  [--project ...] [--parent ID] [--ordinal N] [--final-summary ...]
  [--draft] [--no-dod-defaults]
```

| Флаг | Описание |
|---|---|
| `-d, --description` | Описание |
| `--ac` | Критерий приёмки (повторяется) |
| `--dod` | Критерий DoD (повторяется); без флагов — дефолты из конфига |
| `--no-dod-defaults` | Не подставлять дефолты DoD |
| `--priority` | High / Medium / Low |
| `--labels` | Метки через запятую |
| `--deps` | ID зависимостей через запятую |
| `--milestone` | Привязка к вехе |
| `--type` | Тип задачи (валидация по конфигу, case-insensitive) |
| `--project` | Проект |
| `--parent` | ID родительской задачи (валидируется существование) |
| `--ordinal` | Целое ≥ 0, кастомный порядок |
| `--plan` / `--notes` | Implementation Plan / Notes |
| `--final-summary` | Итоговое резюме |
| `--draft` | Создать черновик вместо задачи |

### list

```
task list [-s status] [-l labels] [--type type] [--ready] [--sort priority|created|updated] [--limit N] [--skip N] [--json]
```

| Флаг | Описание |
|---|---|
| `-s, --status` | Фильтр по статусу |
| `-l, --labels` | Фильтр по метке |
| `--type` | Фильтр по типу |
| `--ready` | Только задачи без невыполненных блокеров |
| `--sort` | priority / created / updated |
| `--limit`, `--skip` | Обрезка после фильтрации и сортировки |
| `--json` | JSON-вывод |

### view / edit / complete / archive

```
task view <id> [--json]

task edit <id> [--title ...] [--status ...] [--type ...] [--ac ...] [--check-ac N[,N]]
  [--dod ...] [--check-dod N[,N]] [--comment ...] [--assignee ...] [--remove-label ...]
  [--plan ...] [--notes ...] [--append-notes ...] [--final-summary ...]
  [--append-final-summary ...] [--clear-final-summary] [--ordinal N]

task complete <id>
task archive <id>
```

| Флаг edit | Описание |
|---|---|
| `--check-ac N[,N]` | Отметить критерии (несколько через запятую) |
| `--check-dod N[,N]` | То же для DoD |
| `--uncheck-ac` / `--uncheck-dod` | Снять отметку (тоже принимает списки) |
| `--remove-ac` / `--remove-dod` | Удалить критерий по номеру |
| `--comment` | Добавить комментарий |
| `--assignee` | Исполнитель (полная замена) |
| `--remove-label` | Убрать конкретную метку |
| `--append-notes` | Дописать в Implementation Notes |
| `--final-summary` / `--append-final-summary` / `--clear-final-summary` | Резюме: замена / дописывание / очистка |
| `--ordinal` | Кастомный порядок |

---

## board

```
vibelog board [--export]
```

Канбан-доска в терминале. `--export` — markdown-формат.

---

## search

```
vibelog search "query" [--status S] [--type T] [--priority P] [--limit N] [--json]
```

Запрос необязателен, если указан хотя бы один фильтр. Фильтры комбинируются (AND).

---

## browser

```
vibelog browser [--port N] [--no-open]
```

Веб-интерфейс (kanban с drag-and-drop). `--port` — порт (по умолчанию 6420), `--no-open` — не открывать браузер.

---

## instructions

```
vibelog instructions [topic]
```

Инструкции для AI-агентов. Темы: `overview`, `task-creation`, `task-execution`, `task-finalization`.

---

## mcp

```
vibelog mcp start
```

Запуск MCP-сервера (stdio, JSON-RPC 2.0). Обычно вызывается автоматически Qwen Code через `mcpServers` в `.qwen/settings.json`.

---

## milestone

```
vibelog milestone <subcommand> [опции]

  add <name> [-d desc] [--due-date YYYY-MM-DD]
  list [--show-completed]
  rename <from> <to> [--no-update-tasks]
  remove <name> [--task-handling clear|keep|reassign] [--reassign-to <name>]
  archive <name>
```

`rename` по умолчанию обновляет `milestone` во всех задачах; `remove` по умолчанию снимает веху с задач (`--task-handling clear`).

---

## doc

```
vibelog doc <subcommand> [опции]

  create <title> [--type readme|guide|specification|other] [--tags a,b]
  list [--type T]
  view <id>
  update <id> [--title ...] [--type ...] [--tags ...]
  search <query>
```

---

## config

```
vibelog config <subcommand> [опции]

  get <key>           Показать значение ключа
  set <key> <value>   Изменить значение (массивы: JSON или через запятую)
  list                Все ключи конфига
```

Типизация `set` по ключу: массивы (`statuses`, `labels`, `priorities`, `types`, `definition_of_done`), boolean, числа (`default_port`, `active_branch_days`, `max_column_width`), строки.

---

## draft

```
vibelog draft <subcommand> [опции]

  create <title> [-d desc] [-l labels]
  list
  view <id>
  edit <id> [--title ...] [-d desc] [-l labels]
  promote <id>      — черновик → задача (черновик удаляется)
  archive <id>      — перенос в completed/
```

---

## decision

```
vibelog decision <subcommand> [опции]

  create <title> [-s status] [--context ...] [--decision ...] [--consequences ...]
  list [--status S]
  view <id>
```

Статусы (free-form, дефолт `proposed`): `proposed`, `accepted`, `rejected`, `superseded`.

---

## doctor

```
vibelog doctor [--json]
```

Диагностика: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, MCP-инструменты (21), `backlog/`, конфиг, round-trip с Backlog.md. `--json` — структурированный результат.

---

## Глобальные флаги

```
vibelog --version | -v    Версия и пути
vibelog help              Общая справка
vibelog <команда> --help  Справка по команде
```
