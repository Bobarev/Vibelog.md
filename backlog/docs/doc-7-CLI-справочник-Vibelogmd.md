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
vibelog init [name] [--prefix LB] [--mode fresh|upgrade] [--yes] [--web]
  [--project-name N] [--agents vb,qwen,opencode] [--default-agent ID]
  [--secrets-location env|settings|both] [--bot] [--bot-token T] [--bot-chats IDS]
  [--provider ID] [--base-url URL] [--api-key-env VAR] [--model ID] [--api-mode chat|responses]
  [--no-mcp] [--skip-llm-check] [--skip-bot-check] [--force] [--no-wizard]
```

Инициализирует backlog-директорию и конфиг. В TTY запускает интерактивный wizard настройки проекта (VL-210): имя/prefix → агенты → где хранить секреты → Telegram-бот → LLM (если выбран `vb`) → MCP → проверки. Без TTY (или с `--yes`/`--no-wizard`) работает как прежний init: создаёт `backlog/` и настраивает MCP.

Два режима (автоопределение по наличию `backlog/`, переопределение — `--mode`):

- **fresh** — `backlog/` нет: создаёт `backlog/` (tasks, completed, drafts, docs, decisions, milestones, lessons, references), `config.yml`, `AGENTS.md` (если файла нет), `.vibelog/settings.json`, `.env` (если выбрано).
- **upgrade** — `backlog/` уже есть: читает текущие `config.yml` и `.vibelog/settings.json`, показывает их как дефолты (Enter — оставить) и **дополняет недостающее** (providers, models, workflows, mcpServers, env). Существующие задачи, docs, lessons, references, decisions, milestones, completed/ не трогаются; в `config.yml` меняются только `project_name`/`task_prefix` и только при явном изменении. Битый `config.yml` → ошибка с подсказкой `--force`.

| Флаг | Описание |
|---|---|
| `name` | Имя проекта (по умолчанию из config.yml или имя каталога) |
| `--project-name` | Имя проекта флагом (то же, что позиционный `name`) |
| `--prefix` | Префикс ID задач (по умолчанию из config.yml или `VL`) |
| `--mode fresh\|upgrade` | Явный режим (по умолчанию автоопределение по `backlog/`) |
| `--yes` | Все дефолты без вопросов: агенты — по папкам `.qwen/`/`.opencode/` (vb не добавляется), без бота, секреты в `.env`, MCP при qwen/opencode |
| `--web` | Открыть браузер на веб-мастере `#/setup` |
| `--agents vb,qwen,opencode` | Список агентов через запятую; пустая строка — без агента (только таск-менеджер) |
| `--default-agent` | Агент по умолчанию (спрашивается, только если выбрано больше одного) |
| `--secrets-location env\|settings\|both` | Где хранить ключи: `.env` (по умолчанию), секция `env` в `.vibelog/settings.json`, оба |
| `--bot`, `--bot-token`, `--bot-chats` | Настройка Telegram-бота (токен и чаты) |
| `--provider`, `--base-url`, `--api-key-env` | LLM-провайдер (только если выбран `vb`) |
| `--model`, `--api-mode chat\|responses` | Модель и режим API |
| `--no-mcp` | Не настраивать MCP-сервер (`.qwen/settings.json`, `.opencode/settings.json`) |
| `--skip-llm-check`, `--skip-bot-check` | Не проверять LLM (ping) / бота (getMe) |
| `--force` | Перезаписать существующие настройки |
| `--no-wizard` | Не запускать интерактив даже в TTY |

Проверки после записи: ping LLM (модель, задержка, usage), `which qwen` + версия (требуется 0.24+), `which opencode`, Telegram `getMe`. Ошибки печатаются понятным текстом без стектрейса.

Примеры:

```bash
vibelog init --yes                          # неинтерактивно, дефолты
vibelog init "API" --prefix api --agents qwen --no-mcp
vibelog init --mode upgrade --yes           # дополнить существующий проект
vibelog init --web                          # веб-мастер #/setup
```

Веб-мастер `#/setup` доступен и после инициализации — пункт «Мастер настройки» в боковом меню; он работает в том же upgrade-режиме и не перезаписывает существующие данные.

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
| `--no-dod-defaults` | Не ставить дефолтные DoD |
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

`task view` при наличии в frontmatter поля `token_usage` (VL-198, учёт токенов) печатает секцию «Токены»: input/output/cache/total/requests/duration + разбивку по фазам (`by_phase`).

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

Запрос необязателен, если указан хотя бы один фильтр. Фильтры комбинируются (AND). Запрос трактуется как набор токенов (нижний регистр, разделители — пробелы и пунктуация; дефис/подчёркивание сохраняются) — требуется вхождение **всех** токенов (И-логика), для одного слова поведение ≈ substring с усечением основы (первые 5 символов: «модель» найдёт «моделями»). Выдача отсортирована по релевантности: точное id » id содержит » title » labels » description, при равном счёте — created_date desc, затем id asc (VL-237). Релевантность выдачи (ранжирование, И-логика токенов, усечение основы) задаётся общим core-поиском — тем же, что использует MCP-инструмент `backlog_search` (VL-237).

---

## map

```
vibelog map [query] [--dir D] [--limit N] [--no-exports] [--json]
```

Карта проекта одним вызовом (VL-235): модули указанного каталога (по умолчанию `src/`), сгруппированные по подкаталогам — путь, первая содержательная строка шапки-комментария модуля и (если помещается в бюджет) экспортируемые имена. Собираются файлы `.ts` без `*.test.*` и `*.d.ts`; служебные `node_modules`/`.git`/`dist` пропускаются; порядок детерминирован (`localeCompare`). Аргумент-запрос фильтрует по пути/описанию/экспортам и показывает полные описания и все экспорты — это ответ на вопрос «где реализован X» без серии чтений файлов. Ответ ограничен бюджетом ≈8 КБ: при превышении карта ступенчато сжимается (сначала без экспортов, затем короткие описания, затем только имена) и помечается маркером; `--limit` (по умолчанию 150 модулей) даёт отдельный маркер усечения. Нет каталога — сообщение, без ошибки. `--json` — `{schemaVersion:1, kind:"map", data}`.

---

## browser

```
vibelog browser [--port N] [--host ADDR] [--no-open]
```

Веб-интерфейс (kanban с drag-and-drop). `--port` — порт (по умолчанию 6420), `--no-open` — не открывать браузер. При старте читает `.env` проекта и секцию `env` `.vibelog/settings.json` через общий `loadProjectEnv` (VL-189, как бот) — spawn фаз наследует `VIBELOG_LLM_*` без ручного экспорта в shell.

`--host` (VL-266) — адрес, на котором слушает сервер. По умолчанию `127.0.0.1` (только эта машина). `--host 0.0.0.0` открывает доступ из локальной сети; то же значение можно задать настройкой `web_host` в `.vibelog/settings.json` (флаг приоритетнее настройки). При старте печатаются локальный URL (первая строка `Веб-интерфейс Vibelog.md: <url>` — по ней бот определяет адрес для `/web start`) и, если хост wildcard, по строке `Доступ из локальной сети: http://<ip>:<port>` на каждый непустой IPv4-адрес машины. **Аутентификации нет** — не выставляйте `0.0.0.0` за пределы доверенной сети.

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
  add <title> [--type T] [--url ...] [--url ...] [--path ...] [--tags ...] [-d desc] [--no-clone] [--cache]

  --url повторяется: первая ссылка → url, остальные → urls (VL-291). С --cache все ссылки
  кэшируются в ОДИН md-файл секциями в порядке --url (ошибка одной ссылки не ломает кэш
  остальных: пометка в md + «частичный успех» и exitCode 1).
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
| `add` | Создать референс; `type=repo` по умолчанию **сам клонирует** репозиторий в `data/<dir>` (идемпотентно: уже существующий клон пропускается); `--no-clone` — только метаданные. `--url` можно повторять (первая ссылка → `url`, остальные → `urls`); `--cache` скачивает и конвертирует ссылки в markdown-кэш |
| `view` | Метаданные + linked_tasks + описание; все ссылки печатаются (`url:`, затем `url[2]:`, `url[3]:` …) |
| `search` | Поиск по id/title/url/tags/body |
| `link` | Двусторонняя связь референс ↔ задача (`linked_tasks` ↔ `task.references`); `--remove` — разорвать |
| `remove` | Удалить метаданные (клон в `data/` сохраняется) |
| `sync` | Доклонировать отсутствующие репозитории для всех `type=repo` (для разработчиков, склонировавших проект без `data/`); с ID — перекачать кэш ссылок (мульти-url сравниваются общим `source_hash`) |

---

## lesson

```
vibelog lesson <subcommand> [опции]

  list [--status active|outdated|superseded|needs-review] [--tags a,b]
  create <title> [--tags a,b] [--source-tasks VL-1,VL-2] [-d content]
  view <id>
  search <query>
  link <lessonId> <taskId> [--remove]
  supersede <oldId> <newId>
  audit [--write] [--threshold N] [--stale-days N] [--json] [--verify id,…] [--needs-review id,…]
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
| `audit` | Механический аудит актуальности корпуса уроков (VL-279). Read-only: `--write` — отчёт в `backlog/lessons/AUDIT.md`, без него только stdout; `--json` — машинный вывод; `--threshold N` — порог схожести дублей (дефолт 0.35); `--stale-days N` — порог протухания (дефолт 180); `--verify id,…` и `--needs-review id,…` — единственный способ записи: пометить уроки проверенными (`verified_by=auto`, `last_verified=today`) или перевести в `needs-review` (массовых изменений без явных ID нет) |

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

## model

```
vibelog model <subcommand>

  list        Список моделей (маркер * — активная)
  use <id>    Переключить активную модель (запись в models.default)
  current     Показать активную модель
```

Управление реестром LLM-моделей (VL-209): модели живут в секции `models` файла `.vibelog/settings.json` (`default` + `available`), провайдент — в секции `providers`. Секции нет — fallback на env `VIBELOG_LLM_MODEL` (старое поведение).

- `list` — таблица: маркер `*` у активной, id, label, provider, api_mode; при пустом реестре — подсказка про env-fallback.
- `use <id>` — валидация id в `available` (неизвестный → ошибка со списком доступных), запись только `models.default` через read-modify-write (остальные ключи settings.json сохраняются).
- `current` — `<id> — <label> (api_mode, provider)`; без секции models — «Модель из VIBELOG_LLM_MODEL: …»; ничего не задано → ошибка.

---

## provider

```
vibelog provider list
```

Список LLM-провайдеров (VL-209) из секции `providers` файла `.vibelog/settings.json`: id, `base_url`, источник ключа (`env <api_key_env>` / `api_key (прямой)` / `нет источника`) и статус ключа (задан / НЕ ЗАДАН). Значения ключей в вывод не попадают — секреты.

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

## experiment

```
vibelog experiment <subcommand> [опции]

  create <title> [--dataset <name>] [--runner manual] [--status draft]
         [--variant A:builtin:spec] [-d описание]
  list [--status S]
  dataset create <name> [--from-completed] [--limit N] [--force]
  dataset list [--exp <exp-id>]
  dataset view <name> [--exp <exp-id>] [--dataset-path <p>]
  dataset <exp-id> [--dataset-path <p>]
  run <exp-id> [--dry-run] [--variant A,B] [--recover [--reason <text>]]
  record <exp-id> --variant A --task <id> [--score n] [--run N] [--from-json <f>]
  report <exp-id> [--run N] [--compare run-M] [--json]
```

A/B-эксперименты (спецификация — doc-21). Карточка эксперимента — `backlog/experiments/exp-<id>.md`; общие датасеты — `backlog/experiments/datasets/<name>.jsonl`, частные — `backlog/experiments/<exp-id>/datasets/<name>.jsonl`.

### dataset create

Создаёт **общий** датасет `backlog/experiments/datasets/<name>.jsonl`.

| Флаг | Описание |
|---|---|
| `--from-completed` | Собрать строки из завершённых задач (`status: Done` в `backlog/tasks/**` и `backlog/completed/`): `task_id` = ID, `title`+`description` → `input`, `acceptanceCriteria[].text` → `expected_ac`, `type`/`priority` → `custom`; сортировка по `updated_date` убыв. |
| `--limit N` | Ограничить число строк (по умолчанию 20; действует с `--from-completed`) |
| `--force` | Перезаписать существующий файл (без флага — отказ) |

Без `--from-completed` создаётся пустой файл и печатается шаблон строки (`DATASET_ROW_TEMPLATE`).

### dataset list

Печатает общие и частные датасеты с пометкой происхождения (`общий` / `exp-<id>`) и счётчиками валидных/битых строк. `--exp <exp-id>` — ограничить частными датасетами одного эксперимента.

### dataset view

Валидирует датасет и печатает число валидных и битых строк, список `task_id`, тексты ошибок (`строка N: …`). `--exp <exp-id>` — взять частный датасет эксперимента. `--dataset-path <p>` — читать указанный файл напрямую. Exit 1 при наличии ошибок.

### dataset <exp-id>

Показывает резолв датасета для эксперимента по порядку «частный → общий» (doc-21 §6): `backlog/experiments/<exp-id>/datasets/<name>.jsonl` → `backlog/experiments/datasets/<name>.jsonl`. Имя берётся из `<exp-id> <name>` или из поля `dataset` карточки эксперимента. При коллизии (оба файла есть) в stderr печатается warning, а в stdout — строка `resolution: {"chosen": "private"|"shared", "path": …, "shadowed": …}` для записи в `meta.json` рана. `--dataset-path <p>` перебивает резолв полностью (`chosen: "explicit"`), предупреждая, если общий файл остался в тени.

**Схема строки JSONL** (doc-21 §5): `task_id` (обязателен, уникален), `expected_ac?`, `input?`, `payload?`, `custom?`, `meta?`. Синоним `expected` читается как `expected_ac` с warning'ом; одновременные `input` и `payload` — warning, выигрывает `payload`. Битые JSON-строки и дубликаты `task_id` попадают в `errors`, команда не падает.

### run

```
vibelog experiment run <exp-id> [--dry-run] [--variant A,B]
  [--variant-a-prompt-path <p>] [--variant-b-prompt-path <p>]
  [--recover [--reason <text>]]
```

Manual runner (doc-21 §4/§7/§10). Без `--dry-run` создаёт очередной каталог `backlog/experiments/<exp-id>/run-<N>/` с `meta.json` (`status: running`, `pid`, `started_at`, `resolution` датасета и промптов) и печатает инструкцию + список задач датасета. Manual-прогон **сам не завершается**: статус закрывает `experiment report` (VL-297). Номер прогона — `max+1` по существующим каталогам (дырка не переиспользуется), создание каталога атомарное (`mkdir` без `recursive`, при `EEXIST` — следующий номер).

| Флаг | Описание |
|---|---|
| `--dry-run` | Напечатать матрицу «строки датасета × варианты» и резолвнутые промпты (пометка `частный`/`общий`/`builtin`/`по пути`), ран не создавать |
| `--variant A,B` | Ограничить набор вариантов (по умолчанию — все из карточки) |
| `--variant-<k>-prompt-path <p>` | Escape hatch: подставить файл промпта для варианта `<k>`, минуя резолв |
| `--recover` | Перевести зависший ран в `failed`: сохраняет частичные `results.jsonl`, дописывает `finished_at` и `reason` (по умолчанию «зависший ран») |

**Резолв промпта варианта** (doc-21 §6): значение `variant.prompt` — либо имя файла, ищущееся по правилу «частный → общий» (`backlog/experiments/<exp-id>/prompts/<name>.md` → `backlog/experiments/prompts/<name>.md`) с warning при затенении, либо `builtin:<phase>` — файловая система **не ищется**: отдаётся текст шаблона фазы (приоритет `.vibelog/prompts/phases/phase-<phase>.md`, затем `templates/phases/phase-<phase>.md`), неизвестная фаза — ошибка со списком доступных.

**Правило «stale running»**: если у рана `status: running`, пуст `finished_at` и `pid` не жив (`process.kill(pid, 0)` → ESRCH), команды печатают предупреждение с подсказкой `experiment run <exp-id> --recover`. Manual-ран с `pid: null` зависшим не считается — его закрывает `report`. Статус карточки эксперимента — производная от последнего рана (`draft → running → completed|failed`).

### record

```
vibelog experiment record <exp-id> --variant A --task <id>
  [--score <n>] [--output <text>] [--error <text>] [--error-kind <k>]
  [--tool-calls N] [--duration <ms>] [--cost <n>] [--custom '<json>']
  [--run N] [--from-json <file>]
```

Пишет строку результата в `run-<N>/results.jsonl` **upsert-ом по ключу `(task_id, variant)`** — повторная запись той же пары перезаписывает строку на её позиции, а не добавляет дубликат. Запись атомарна (temp-файл в том же каталоге + `rename`), поэтому прерывание не оставляет половину строки.

| Флаг | Описание |
|---|---|
| `--variant` | Ключ варианта из карточки (`A`, `B`, …) |
| `--task` | `task_id` из датасета |
| `--score / --output / --error / --error-kind` | Оценка, сырой вывод, текст ошибки, вид ошибки (`timeout`, `api`, `runner`, `judge`, `interrupted`) |
| `--tool-calls / --duration / --cost` | Доп. метрики строки |
| `--custom '<json>'` | Произвольные метрики (объект JSON) |
| `--run N` | Целевой прогон; без флага — последний. Если ранов больше одного и `--run` не задан, в stderr печатается предупреждение |
| `--from-json <file>` | Массив results-строк: upsert пачкой за один вызов |

### judge

```
vibelog experiment judge <exp-id> [--run N]
```

LLM-judge (doc-21 §4/§11): оценивает **существующие** строки `results.jsonl` по тексту вывода, используя `expected_ac` из датасета рана и `input`/`output` строки. Новых строк не добавляет — `score` upsert-ится по ключу `(task_id, variant)`; строки без `output` не оцениваются (путь `score: null` работает и без судьи).

Конфигурация — секция `judge` карточки эксперимента (парсер VL-294): `enabled`, `model?`, `prompt?`, `scale: 'numeric' | 'pass_fail'`, `score_min`, `score_max`. Валидация: числа конечны, `score_min < score_max`, для `pass_fail` шкала фиксирована 0..1; `enabled: false` — неблокирующее предупреждение. Модель — `judge.model` через `resolveModelById` → `models.default`; неизвестный явный id — ошибка (тихий откат на default исказил бы сравнение прогонов).

Парс ответа устойчив к форматам: «7/10» при шкале 1..10 → 7, «0.7» и «0,7» при 0..1 → 0.7, «85%» → 0.85; `pass_fail` понимает PASS/FAIL/passed/failed/да/нет/соответствует/не соответствует и пишет **числом** 1/0; значение вне шкалы → `null` (без обрезки). Ошибка клиента или неразборчивый ответ не роняют прогон: строка остаётся, ставится `error_kind: judge`.

**Стоимость судьи — отдельно от варианта** (doc-21 §11): в `meta.json` пишутся `judge_usage`, `cost_judge`, `judge_model`, `judge_pricing_missing`; поле `cost` результатов и агрегаты `report` не меняются. При отсутствии тарифа `cost_judge: null` (не 0).

### report

```
vibelog experiment report <exp-id> [--run N] [--compare run-M] [--json]
```

Отчёт по прогону (doc-21 §8–§9): агрегаты по каждому варианту, `report.md` в каталог прогона и **завершение** manual-прогона.

| Флаг | Описание |
|---|---|
| `--run N` | Целевой прогон; без флага — последний |
| `--compare run-M` | Добавить таблицу дельт метрик между прогонами (например, до/после правки промпта) — в stdout и в `report.md` |
| `--json` | Напечатать ту же структуру в stdout для машинной обработки (с `--compare` — `{report, compare}`) |

По каждому варианту печатаются: `n` (валидные строки — `score` конечное число), `dropped` (исключённые из средних: `error` есть или `score: null`, с разбивкой по `error_kind`), `mean`, `median`, `delta` к baseline-варианту (`metrics.baseline`, по умолчанию `A`) в абсолютных и процентах с учётом `metrics.higher_is_better`, `win_rate` (доля пар, где вариант строго лучше baseline), средние по `row.custom` строго для метрик из `metrics.custom`, число ошибок по `error_kind`. `n` и `dropped` печатаются всегда; при `n = 0` метрики — `—`, не `NaN`.

**Завершение прогона.** Если для всех строк датасета × всех вариантов есть строка с `score` или `error`, прогон переводится в `completed` (заполняются `finished_at`, `n`, `dropped`, `cost_total` и `meta.summary = {n, dropped, cost_total}`), статус эксперимента пересчитывается (`draft` без прогонов | `running` | `completed` | `failed`). Если данных не хватает — печатается список недостающих пар `(task_id, variant)`, статус **не меняется**. `report.md` — производный файл: перегенерируется при каждом запуске (единственное исключение из «прогон неизменяем»), `results.jsonl` не трогается.

**Правило `results.jsonl > 10 MB`** (doc-21 §15): файл всё равно парсится локально для отчёта, но в `meta.json` ставится `results_ignored: true` и в stderr печатается warning.

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

Отдельный бинарь агента (VL-85): headless-исполнитель фаз вместо qwen. В stdout печатает одну JSON-строку `type=result` (формат `parseQwenResult`), логи — stderr. Флаги: `--headless`, `--no-mcp`, `--no-tui`, `--comment <текст>`, `--max-tool-calls <N>`, `--tool-calls-per-session <N>` (VL-223: опциональный кумулятивный лимит tool-calls сессии, при resume счётчик восстанавливается из jsonl), `--max-wall-time <сек>`, `--api-mode <chat|responses>` (режим LLM API, VL-205: дефолт `chat`, иначе берётся из ключа `api_mode` в `.vibelog/settings.json`), `--help`. Qwen-совместимые `--approval-mode`, `--output-format json`, `--allowed-mcp-server-names` принимаются и игнорируются. Env: `VIBELOG_LLM_BASE_URL`, `VIBELOG_LLM_API_KEY`, `VIBELOG_LLM_MODEL` (VL-209: при наличии секции `models` в `.vibelog/settings.json` приоритет у неё — модель/провайдер/`api_mode`/ключ резолвятся из `models.default` → `providers`, env остаётся fallback-путём). Подключение к оркестратору: `VIBELOG_QWEN_BIN=bin/vibelog-agent.mjs`.

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
- **`vb bot` и `vb browser`** (VL-206): проверка выполняется при запуске (до `route()`), уведомление печатается в stderr сразу после старта — раньше любого вывода сервиса; задержка старта ≤ 3 с раз в сутки (по общему кэшу).

Пропуск проверки:

- env `VIBELOG_SKIP_UPDATE_CHECK=true|1|yes`:

```bash
VIBELOG_SKIP_UPDATE_CHECK=true vibelog task list
```

- команды `mcp` и `qwen-debug` — JSON-RPC/отладка, уведомление не нужно; `bot` и `browser` — проверка выполняется при запуске (до route), уведомление в stderr сразу после старта;
- флаги `-v` / `--version`.
