---
id: doc-7
title: CLI-справочник Vibelog.md
type: guide
created_date: 2026-10-06
tags:
  - cli
  - reference
  - vl-21
---
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
task list [-s status] [-l labels] [--type type] [--parent ID] [--ready] [--sort priority|created|updated] [--limit N] [--skip N] [--json]
```

| Флаг | Описание |
|---|---|
| `-s, --status` | Фильтр по статусу |
| `-l, --labels` | Фильтр по метке |
| `--type` | Фильтр по типу |
| `--parent` | Фильтр по родительской задаче |
| `--ready` | Только задачи без невыполненных блокеров |
| `--sort` | priority / created / updated |
| `--limit`, `--skip` | Обрезка после фильтрации и сортировки |
| `--json` | JSON-вывод |

### view / edit / complete / archive

```
task view <id> [--json]

task edit <id> [--title ...] [--status ...] [--type ...] [--parent ID] [--ac ...] [--check-ac N[,N]]
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
| `--parent ID` | Смена родителя (пустая строка — сброс; валидация существования) |

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

Веб-интерфейс (kanban с drag-and-drop). `--port` — порт (по умолчанию 6420), `--no-open` — не открывать браузер. При старте читает `.env` проекта и секцию `env` `.vibelog/settings.json` через общий `loadProjectEnv` (VL-189, как бот) — spawn фаз наследует `VIBELOG_LLM_*` без ручного экспорта в shell.

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

## reference

```
vibelog reference <subcommand> [опции]

  list [--type repo|url|file|doc|spec] [--tags a,b] [--json]
  add <title> [--type T] [--url ...] [--path ...] [--tags ...] [-d desc] [--no-clone]
  view <id>
  search <query>
  link <refId> <taskId> [--remove]
  remove <id>
  sync
```

Управление референсами (VL-152) — внешние источники знаний: репозитории, URL, файлы, документация, спецификации. Метаданные — `backlog/references/<id>-<title>.md` (в git), клоны репозиториев — `backlog/references/data/` (в .gitignore).

| Команда | Описание |
|---|---|
| `list` | Список референсов с фильтрами по типу и меткам |
| `add` | Создать референс; `type=repo` по умолчанию **сам клонирует** репозиторий в `data/<dir>` (идемпотентно: уже существующий клон пропускается); `--no-clone` — только метаданные |
| `view` | Метаданные + linked_tasks + описание |
| `search` | Поиск по id/title/url/tags/body |
| `link` | Двусторонняя связь референс ↔ задача (`linked_tasks` ↔ `task.references`); `--remove` — разорвать |
| `remove` | Удалить метаданные (клон в `data/` сохраняется) |
| `sync` | Доклонировать отсутствующие репозитории для всех `type=repo` (для разработчиков, склонировавших проект без `data/`) |

---

## lesson

```
vibelog lesson <subcommand> [опции]

  list [--status active|outdated|superseded] [--tags a,b]
  create <title> [--tags a,b] [--source-tasks VL-1,VL-2] [-d content]
  view <id>
  search <query>
  link <lessonId> <taskId> [--remove]
  supersede <oldId> <newId>
```

Управление уроками из опыта задач (VL-153) — workflow-уроки, предотвращающие повторение ошибок. Файлы — `backlog/lessons/lesson-N-<slug>.md` (YAML-фронтматтер + markdown-тело «Проблема / Решение / Пример»).

| Команда | Описание |
|---|---|
| `list` | Список lessons; фильтры `--status`, `--tags` (все указанные метки должны совпасть) |
| `create` | Создать lesson; id генерируется (`lesson-N`), даты — сегодня; `--source-tasks` — откуда урок |
| `view` | Метаданные + linked_tasks + тело урока |
| `search` | Substring-поиск по id/title/tags/телу |
| `link` | Двусторонняя связь lesson ↔ задача (`linked_tasks` ↔ `task.lessons`); `--remove` — разорвать |
| `supersede` | Пометить `oldId` как заменённый `newId`: старый → `superseded`, новый получает `supersedes: oldId` |

Формулировка урока — императив, конкретика, 1 предложение («Тесты со spawn медленные — запускай батчами по 10»). Close-фаза создаёт/обновляет lessons автоматически (шаг 6.5), Plan получает их в промпт через `{{taskLessons}}` по tags задачи.

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

Диагностика: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, MCP-инструменты (36), `backlog/`, конфиг, round-trip с Backlog.md. `--json` — структурированный результат.

Пример вывода:

```
Vibelog.md doctor
────────────────

✓ node: v22.8.0
✓ path: /usr/local/bin/vibelog
✓ symlink: /usr/local/bin/vibelog (pnpm shim → .../bin/vibelog.mjs)
✓ sources_match: ok
✓ mcp_tools_count: 36
✓ mcp_tools_list: ["backlog_add_comment", ...]
✓ backlog_dir: ./backlog
✓ config: {"project_name":"My Project","task_prefix":"LB"}
✓ tasks_count: 6
✓ roundtrip: 5

⚠ Qwen Code: MCP-сервер мог быть закэширован. Перезапусти Qwen.
```

Если Qwen Code не видит новые MCP-инструменты — MCP-сервер закэширован: перезапустите Qwen Code, он подхватит обновлённый список инструментов.

---

## vibelog-agent

```
vibelog-agent <фаза> <taskId> [флаги]
vibelog-agent <промпт> [флаги]
```

Отдельный бинарь агента (VL-85): headless-исполнитель фаз вместо qwen. В stdout печатает одну JSON-строку `type=result` (формат `parseQwenResult`), логи — stderr. Флаги: `--headless`, `--no-mcp`, `--no-tui`, `--comment <текст>`, `--max-tool-calls <N>`, `--max-wall-time <сек>`, `--help`. Qwen-совместимые `--approval-mode`, `--output-format json`, `--allowed-mcp-server-names` принимаются и игнорируются. Env: `VIBELOG_LLM_BASE_URL`, `VIBELOG_LLM_API_KEY`, `VIBELOG_LLM_MODEL`. Подключение к оркестратору: `VIBELOG_QWEN_BIN=bin/vibelog-agent.mjs`.

**TUI (VL-86).** В интерактивном режиме (stdout — TTY, без `--headless`/`--output-format json`, фаза ≠ `prompt`, без `--no-tui`) агент рендерит TUI на Ink: посимвольный стриминг токенов ответа модели, карточки tool calls (имя, ключевые аргументы, статус ⏳/✅/❌, длительность в мс), счётчики (ход, токены in/out/cache, время фазы) и блок ошибок (лимиты, LLM API) на русском. TUI живёт на stderr в альтернативном буфере терминала — stdout остаётся под единственную JSON-строку результата, контракт оркестратора не меняется. Флаг `--no-tui` отключает TUI (текстовый прогресс в stderr). Зависимости: ink 7.0.3 + react 19 (без нативных модулей).

**Чат по умолчанию (VL-102).** Агент запускается и без отдельного бинаря: `vibelog` (или алиас `vb`) **без аргументов и флагов** в интерактивном терминале (stdin и stdout — TTY) открывает TUI-чат с агентом: multi-turn диалог с инструментами (локальные + MCP Vibelog), строка ввода внизу TUI, ответ стримится, транскрипт сессии сохраняется в `.vibelog/agent-sessions/` после каждого хода. В не-TTY (скрипты, CI) пустой запуск выводит справку; `vibelog help` / `--help` не меняются. Env LLM — те же `VIBELOG_LLM_*` (читаются также из `.env` проекта — VL-37, как у бота).

---

## Глобальные флаги

```
vibelog --version | -v    Версия и пути
vibelog help              Общая справка
vibelog <команда> --help  Справка по команде
vb …                      Алиас vibelog (тот же бинарь)
(без аргументов)          В интерактивном TTY — TUI-чат с агентом (VL-102)
```

Примеры вывода версии:

```
$ vibelog --version
vibelog.md 1.9.0
  bin:  /usr/local/bin/vibelog
  src:  /path/to/Vibelog.md/bin/vibelog.mjs
  node: v22.8.0

$ vibelog -v
1.9.0

$ vibelog --version --json
{
  "name": "vibelog.md",
  "version": "1.9.0",
  "bin": "/usr/local/bin/vibelog",
  "src": "/path/to/Vibelog.md/bin/vibelog.mjs",
  "node": "v22.8.0",
  "engines": { "node": ">=20" }
}
```

---

## Автообновление

При запуске CLI проверяет npm registry на наличие новой версии `vibelog.md` и, если версия новее текущей, выводит уведомление в stderr:

```
⚠ Доступна новая версия для обновления: npm install -g vibelog.md (текущая: 1.6.0 → новая: 1.7.0)
```

Поведение:

- **Только уведомление**, без автоустановки — по желанию пользователь ставит сам.
- **Проверка не чаще раза в 24 часа**: результат кэшируется в `<tmpdir>/vibelog-update-check.json`; пока кэш свежий, и сетевой вызов, и уведомление пропускаются. Кэш с ошибкой тоже живёт сутки — офлайн-пользователь получает максимум одну тихую попытку в сутки.
- Механизм — `npm view vibelog.md version --json`; жёсткий предел задержки CLI — 3 с (дочерний процесс npm ограничен таймаутом 5 с).
- Уведомление уходит **в stderr**: stdout не трогается, контракт `-v` / `--json` сохраняется.
- Ошибки сети молча глотаются — CLI работает как раньше.

Пропуск проверки:

- env `VIBELOG_SKIP_UPDATE_CHECK=true|1|yes`:

```bash
VIBELOG_SKIP_UPDATE_CHECK=true vibelog task list
```

- команды `mcp`, `browser`, `bot`, `qwen-debug` (долгоживущие/JSON-RPC — уведомление не нужно);
- флаги `-v` / `--version`.
