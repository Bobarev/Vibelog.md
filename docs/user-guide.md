# Руководство пользователя Vibelog.md

Markdown-нативный таск-менеджер для git-репозиториев, совместимый с Backlog.md.
Node.js 20+, macOS 10.15 Catalina + Qwen Code. Runtime-зависимость — grammy (Telegram-бот).

## Содержание

1. [Установка и инициализация](#1-установка-и-инициализация)
2. [Задачи](#2-задачи)
3. [Вехи (milestones)](#3-ветки-milestones)
4. [Типы задач](#4-типы-задач)
5. [Документы](#5-документы)
6. [Черновики](#6-черновики)
7. [Решения (ADR)](#7-решения-adr)
8. [Конфигурация](#8-конфигурация)
9. [Поиск](#9-поиск)
10. [Доска и веб-интерфейс](#10-доска-и-веб-интерфейс)
11. [Telegram-бот](#11-telegram-бот)
12. [Форматы файлов](#12-форматы-файлов)
13. [Диагностика](#13-диагностика)

Справочники: [CLI](cli-reference.md) · [MCP](mcp-reference.md) · [Best practices](best-practices.md) · [MCP-подключение](../MCP-SETUP.md)

---

## 1. Установка и инициализация

```bash
pnpm install
pnpm link --global   # команда vibelog в PATH
```

Инициализация backlog-а в корне git-репозитория:

```bash
vibelog init "Мой проект"            # префикс задач по умолчанию LB
vibelog init "API" --prefix api      # свой префикс: api-1, api-2, ...
vibelog init "X" --skills            # + команды /vibelog:* для Qwen Code
vibelog init "X" --no-mcp            # без автонастройки MCP-сервера
```

Что создаёт `init`:

- `backlog/` с подпапками `tasks/`, `completed/`, `drafts/`, `docs/`, `decisions/`, `milestones/`
- `backlog/config.yml` — конфигурация проекта
- `.qwen/settings.json` — секция `mcpServers.vibelog` (автонастройка MCP для Qwen Code; отключение `--no-mcp`)
- с `--skills` — команды `/vibelog:spec|plan|code` в `.qwen/commands/vibelog/`
- `.vibelog/settings.yml` — кэш `git_user_name` (VL-44): имя автора комментариев берётся отсюда, без спавна `git config` на каждый комментарий. При `--force` кэш перечитывается из git config. Файл в `.gitignore` (как `bot.yml`) — машинная настройка, не коммитится. Если кэша нет или он пуст — используется текущий каскад `git config user.name` → `@agent`

Повторный `init` на инициализированном проекте отклоняется; перезапись — `--force`.

---

## 2. Задачи

### 2.1 Создание

```bash
vibelog task create "Добавить авторизацию" -d "Реализовать JWT-токены"
```

Все флаги `create`:

| Флаг | Что делает |
|---|---|
| `-d, --description` | Описание задачи |
| `--ac "текст"` | Критерий приёмки (флаг повторяется) |
| `--dod "текст"` | Критерий Definition of Done (повторяется). Без флагов подставляются дефолты из конфига (`definition_of_done`) |
| `--no-dod-defaults` | Не подставлять дефолты DoD |
| `--priority High\|Medium\|Low` | Приоритет |
| `--labels a,b` | Метки (через запятую) |
| `--deps api-1,api-2` | Зависимости (ID задач) |
| `--milestone v1.4` | Привязка к вехе |
| `--type bug` | Тип задачи (см. [Типы](#4-типы-задач)) |
| `--project web` | Проект |
| `--parent api-1` | Родительская задача (валидируется существование) |
| `--ordinal N` | Порядковый номер для кастомной сортировки |
| `--plan "текст"` | Сразу заполнить Implementation Plan |
| `--notes "текст"` | Сразу заполнить Implementation Notes |
| `--final-summary "текст"` | Итоговое резюме (для завершённых задач) |
| `--draft` | Создать черновик вместо задачи (см. [Черновики](#6-черновики)) |

Пример:

```bash
vibelog task create "Рефакторинг поиска" \
  --type refactor --priority High --labels backend,v1.5 \
  --ac "Тесты проходят" --ac "Нет регрессий" \
  --plan "1. Выделить ядро поиска" --notes "Смотреть search.mjs"
```

### 2.2 Список

```bash
vibelog task list                          # все задачи
vibelog task list -s "To Do"               # по статусу
vibelog task list --type bug               # по типу
vibelog task list -l backend               # по метке
vibelog task list --ready                  # без невыполненных блокеров
vibelog task list --sort priority          # сортировка: priority|created|updated
vibelog task list --limit 10 --skip 5      # обрезка после фильтрации
vibelog task list --json                   # JSON для скриптов
```

Флаги комбинируются (AND): `vibelog task list --type bug --ready --sort priority`.

### 2.3 Просмотр

```bash
vibelog task view api-1        # карточка задачи
vibelog task view api-1 --json # то же в JSON
```

### 2.4 Редактирование

```bash
vibelog task edit api-1 --status "In Progress"
vibelog task edit api-1 --priority High --title "Новый заголовок"
vibelog task edit api-1 --ac "Новый критерий"        # добавить AC
vibelog task edit api-1 --check-ac 1,3                # отметить критерии №1 и №3 за один вызов
vibelog task edit api-1 --check-dod 1,2               # то же для DoD
vibelog task edit api-1 --uncheck-ac 2                # снять отметку
vibelog task edit api-1 --comment "Прогресс: 50%"     # добавить комментарий
vibelog task edit api-1 --remove-label urgent         # убрать метку
vibelog task edit api-1 --plan "1. Шаг" --notes "Заметка"
vibelog task edit api-1 --append-notes "Ещё строка"   # дописать в заметки
vibelog task edit api-1 --final-summary "Готово"      # заменить резюме
vibelog task edit api-1 --append-final-summary "и выкачено"
vibelog task edit api-1 --clear-final-summary         # очистить резюме
vibelog task edit api-1 --ordinal 5                   # порядок сортировки
vibelog task edit api-1 --deps api-2                  # заменить зависимости
vibelog task edit api-1 --assignee pavel              # исполнитель
```

`--check-ac`/`--check-dod` принимают несколько индексов через запятую — один вызов вместо трёх.

### 2.5 Завершение и архивация

```bash
vibelog task complete api-1   # статус → Done
vibelog task archive api-1    # перенос в backlog/completed/
```

---

## 3. Вехи (milestones)

Веха — релиз или этап, к которому привязаны задачи (`--milestone`).

```bash
vibelog milestone add v1.5 -d "Релиз поиска" --due-date 2026-12-01
vibelog milestone list                  # активные вехи
vibelog milestone list --show-completed # + архивные
vibelog milestone rename v1.5 v1.6      # обновляет milestone в задачах
vibelog milestone rename v1.5 v1.6 --no-update-tasks  # без обновления задач
vibelog milestone remove v1.6                                  # + clear задач (по умолчанию)
vibelog milestone remove v1.6 --task-handling keep             # задачи сохраняют веху
vibelog milestone remove v1.6 --task-handling reassign --reassign-to v1.7
vibelog milestone archive v1.6         # перенос в backlog/completed/
```

Файлы: `backlog/milestones/<slug>.md`. Задачи вехи: `vibelog task list` + фильтр в JSON или `backlog_search` с `milestone`.

---

## 4. Типы задач

Типы описываются в конфиге (по умолчанию: `bug`, `feature`, `enhancement`, `task`, `chore`, `docs`, `spike`):

```bash
vibelog config get types
vibelog config set types "bug,feature,docs"   # свой список
```

Использование:

```bash
vibelog task create "Падение логина" --type bug
vibelog task list --type bug
vibelog task edit api-1 --type enhancement
```

Валидация case-insensitive: `--type Bug` сохранится как `bug`; неизвестный тип — ошибка со списком допустимых.

---

## 5. Документы

Документы — спецификации, гайды, README в `backlog/docs/`.

```bash
vibelog doc create "Гайд API" --type guide --tags api,internal
vibelog doc list                # все документы
vibelog doc list --type guide   # фильтр по типу
vibelog doc view doc-1
vibelog doc update doc-1 --title "Гайд API v2" --tags api
vibelog doc search "миграция"
```

Типы: `readme`, `guide`, `specification`, `other` (по умолчанию `other`). ID: `doc-1`, `doc-2`, ...

---

## 6. Черновики

Черновики — быстрый захват идей до формализации. Хранятся в `backlog/drafts/`, статус `Draft`.

```bash
vibelog draft create "Идея виджета" -d "Быстрый захват" -l idea
vibelog draft list
vibelog draft view draft-1
vibelog draft edit draft-1 --title "Идея (уточнена)" -d "Новое описание"
vibelog draft promote draft-1   # черновик → задача (id из конфига, статус To Do)
vibelog draft archive draft-1   # перенос в backlog/completed/
```

Альтернатива — `vibelog task create "Идея" --draft`: черновик создаётся из команды задач.

Взаимодействие с AI-агентом: попросите агента оформить идею как черновик, а вечером — `promote` зрелых черновиков.


---

## 7. Решения (ADR)

Архитектурные решения фиксируются в `backlog/decisions/` (формат ADR).

```bash
vibelog decision create "Перейти на pnpm" -s accepted \
  --context "npm тянет лишние зависимости" \
  --decision "Использовать pnpm 10" \
  --consequences "Лок-файл pnpm-lock.yaml"
vibelog decision list                 # все решения
vibelog decision list --status accepted
vibelog decision view decision-1      # карточка + ADR-тело
```

Статусы: `proposed` (по умолчанию), `accepted`, `rejected`, `superseded` — свободная форма, как в оригинале Backlog.md.

---

## 8. Конфигурация

`backlog/config.yml` управляется командой (без ручного редактирования YAML):

```bash
vibelog config list                              # все ключи
vibelog config get project_name                  # значение
vibelog config get statuses                      # массив → JSON
vibelog config set default_port 8080             # число
vibelog config set auto_commit true              # boolean
vibelog config set priorities "High,Low"         # массив через запятую
vibelog config set types '["bug","feature"]'     # массив через JSON
vibelog config set default_editor nvim           # строка
```

Типизация `set` определяется ключом: массивы (`statuses`, `labels`, `priorities`, `types`, `definition_of_done`), boolean, числа (`default_port`, `active_branch_days`, `max_column_width`), строки. Неизвестный ключ — ошибка со списком допустимых.

---

## 9. Поиск

```bash
vibelog search "авторизация"                  # substring по id/title/description/меткам
vibelog search --status "To Do"               # только фильтр, без запроса
vibelog search --type bug --priority High     # комбинация фильтров (AND)
vibelog search --limit 5 --json               # обрезка + JSON
```

Запрос необязателен, если указан хотя бы один фильтр. `--json` удобно пайпить в `node -e`-скрипты.

---

## 10. Доска и веб-интерфейс

```bash
vibelog board              # канбан в терминале
vibelog board --export     # markdown-экспорт
vibelog browser            # веб-интерфейс (kanban, drag-and-drop)
vibelog browser --port 8080 --no-open
```

---

## 11. Telegram-бот

Команды `vibelog bot` (long-polling, grammy): привязка чата через /start + пин-код, затем задачи и фазы.

### Фазы через qwen

| Команда | Фаза | Что делает |
|---------|------|------------|
| `/spec <описание>` | Spec | создаёт задачу и разбивает фичу на подзадачи |
| `/plan <id> [комментарий]` | Plan | план реализации для существующей задачи; комментарий добавляется в задачу и учитывается фазой |
| `/code <id> [комментарий]` | Code | реализация задачи; комментарий добавляется в задачу и учитывается фазой |
| `/close <id>` | Close | закрытие: статус из конфига + git commit |
| `/comment <id> <текст>` | Comment | комментарий + запрос для qwen (статус не меняется) |
| `/prompt <текст>` | Prompt | произвольный запрос через qwen без задачи (git разрешён) |

`/prompt` — для запросов, слишком мелких для задачи («сделай коммиты незакоммиченных файлов», «внеси правку в настройки»): команда не создаёт задачу, `backlog/` не трогается, git-операции разрешены (кроме push без явной просьбы). По завершении в чат приходит только информационное сообщение (VL-63, без карточки задачи); одновременно активен только один `/prompt` — повторный запрос получает ошибку guard'а.

### Кнопки карточки задачи (VL-72, VL-78)

В rich-рендере карточки задачи (команда /task и карточка после завершения фазы) сразу после заголовка выводится **центрированный ряд callback-кнопок** (`<tg-button-row align="center">`):

- **«▶ Spec / 📋 Plan / 💻 Code / ✅ Close»** (`style="primary"`, data `next:<id>`) — запуск следующей фазы workflow по статусу задачи;
- **«💬 Комментарий»** (`style="success"`, data `comment:<id>`) — показывается всегда, включая Done/Blocked.

| Статус | Кнопка следующего этапа | Запускаемая фаза |
|--------|--------|------------------|
| To Do | ▶ Spec | Фаза 1 (spec) → статус Spec |
| Spec | 📋 Plan | Фаза 2 (plan) → статус Planned |
| Planned | 💻 Code | Фаза 3 (code) → статус Review |
| In Progress | 💻 Code | Фаза 3 (code) — продолжение реализации |
| Review | ✅ Close | Фаза Close (close) → статус Done |
| Done, Blocked | — (только «💬 Комментарий») | кнопка не показывается |

**Кнопка «следующий этап»** (VL-72): нажатие отправляет callback-запрос `next:<id>`: бот отвечает на него (иначе Telegram показывает «часики») и запускает фазу по тому же механизму, что и команды /plan, /code, /close — с уведомлением о завершении фазы. Для Done/Blocked и неизвестных статусов бот отвечает «нет следующего этапа» без запуска.

**Кнопка «Комментарий»** (VL-78): нажатие отправляет callback `comment:<id>` — бот просит ввести текст комментария следующим сообщением. Введённый текст сохраняется через `addComment` и запускает Фазу Comment — та же логика, что у команды `/comment <id> <текст>` (VL-60). Пустой ввод → повторный промпт; `/cancel` — выход из режима ожидания. Режим ожидания живёт в памяти процесса (как пин-код) — после рестарта бота нужно нажать кнопку заново.

**Expand-блоки карточки** (VL-78): секции Описание / Acceptance Criteria / Definition of Done / Implementation Plan / Implementation Notes / Final Summary / Комментарии свёрнуты в `<details><summary>` (поддерживается rich-сообщениями Telegram); **Описание открыта по умолчанию**, шапка с метой (статус, приоритет, исполнители, метки, срок) видна всегда. Кнопки и details доступны только в rich-рендере; фолбэк MarkdownV2 (старые клиенты) их не содержит.

**Сырые rich-теги в контенте** (VL-81): если текст задачи (описание, AC/DoD, plan, notes, комментарии) сам содержит `<tg-button>`, `<tg-button-row>`, `<details>`, `<summary>` — при вставке в rich-разметку такие теги оборачиваются в code-разметку (строки целиком из тегов — в fenced-блок, теги вперемешку с текстом — в inline-бэкитики), чтобы парсер Telegram не интерпретировал их как настоящие элементы и не ломал кнопки/expand-блоки карточки. Теги, уже находящиеся внутри `...`-кода, не изменяются; блоки ``` контента (после экранирования в ` ` `) превращаются в настоящий fenced-блок — маркеры ` ` ` fenced-блоком не являются. Служебные теги рендера (шапка, ряд кнопок, обёртки секций) не затрагиваются; фолбэк MarkdownV2 не изменён.

### Список /tasks — rich-таблица (VL-82)

Команда `/tasks` отправляет RichMessage: таблица `<table bordered striped compact>` с колонками ID / Заголовок / Статус / Тип / Приоритет (невыполненные задачи, по возрастанию ID — фильтр и порядок не менялись) и под таблицей callback-кнопки `<tg-button-row>` — по одной на задачу (текст = ID, data `task:<id>`). Кнопки дробятся на ряды по 8 — это лимит Telegram на кнопки в одном ряду (при большем числе rich-сообщение отклоняется с ошибкой RICH_MESSAGE_BUTTONS_TOO_MANY). Нажатие кнопки открывает карточку задачи — полный аналог команды `/task VL-N`.

**Формат ячеек — HTML.** Таблица строится как Rich HTML (`<tr>/<th>/<td>`, жирный ID — `<b>`): по спецификации Telegram блок `<table>` в rich-сообщении парсится именно как HTML-таблица, и GFM-строки `| ... |` внутри него отображаются сырым текстом — поэтому «Markdown-таблица» в обёртке `<table>` не рендерилась (исправлено в VL-82 после проверки в Telegram).

**Цвет кнопки по типу задачи**: маппинг хранится в `.vibelog/bot.yml` (ключ `task_type_styles`); дефолты — `bug→danger`, `feature→success`, `enhancement→primary`, `epic→primary`. Допустимые стили Telegram: `danger` (красный), `success` (зелёный), `primary` (синий), `link` (без рамок); для остальных типов кнопка получает дефолтный стиль Telegram. Пользовательские переопределения перекрывают дефолты (сами дефолты в файл не записываются):

```yaml
# .vibelog/bot.yml
task_type_styles:
  bug: success
  docs: link
```

При ошибке rich API (старые клиенты) бот откатывается на MarkdownV2-список (`formatTaskList`) — поведение прежнее.

### Самоперезапуск /restart (VL-70)

После `pnpm build` запущенный бот продолжает исполнять старый `dist/`. Команда `/restart` в привязанном чате рестартует бота **самого себя**: он отвечает «🔄 Перезапуск бота…», останавливает long polling и поднимает новый `vibelog bot` **в том же терминале** (stdio наследуется — новый пин-код печатается там же, где был запущен старый процесс; detached-режим — новый процесс переживает старый). Новый процесс исполняет свежий `dist/` — Ctrl+C не требуется. Чат остаётся привязанным (`.vibelog/bot.yml` не меняется); команда доступна только привязанным чатам. При сбое запуска нового процесса бот сообщает об ошибке в чат и в консоль.

### Ответ по завершении фазы — 2 сообщения (VL-63)

1. **Карточка задачи** — как в /task (rich-рендер, без строки фазы).
2. **Информационное сообщение** — из последней JSON-строки `type=result` вывода qwen; отправляется RichMessage (GFM) через sendRichMessage — MarkdownV2 остаётся фолбэком для старых клиентов (VL-71):

```
# Фаза comment: завершена (код 0)
понг

**Входные токены:** 10956
**Сгенерированные токены:** 19
**Кэш-токены:** 10944
**Всего токенов:** 10975

**Общее время:** 42411 мс (api: 42369 мс)
**Количество запросов:** 1

`a470c7dd-2ca8-4510-9d81-b184f932af76`
```

Сырой JSON-лог в чат больше не шлётся. Если результат недоступен (ошибка запуска qwen, обрыв), информационное сообщение содержит статус, строку «Данные результата недоступны» и хвост лога (до 800 символов) в тройных backticks — без экранирования MarkdownV2. Парсер понимает оба формата вывода qwen: NDJSON-поток и строку-массив `[{…}]` (json-адаптер qwen 0.24.x). Если result не распознан, в консоль сервера печатается расширенная диагностика: сводка `parseQwenResult` по stdout, размеры потоков stdout/stderr, хвосты обоих (в таймлайне консоли строки stderr помечены `err|`), а полный stdout дампится в `.vibelog/qwen-debug/<id>-<время>.log` (gitignored) — по дампу видно точный формат вывода qwen без перезапуска фазы. stdout и stderr копятся в раздельных буферах: предупреждения qwen и логи MCP-серверов не могут вклиниваться в JSON-строку результата. Флаги `--json-file`/`--json-fd` в headless-режиме qwen 0.24.x не работают (проверено: файл остаётся пустым) — JSON по-прежнему идёт в stdout через `--output-format json`.

---
## 11. Форматы файлов

Все сущности — markdown с YAML-фронтматтером. Совместимо с Backlog.md.

### Задача — `backlog/tasks/<id> - <slug>.md`

```yaml
---
id: api-1
title: Добавить авторизацию
status: To Do
priority: high
labels: [backend]
milestone: v1.5
type: bug
---
```

Тело: секции `## Description`, `## Acceptance Criteria` (блоки `<!-- AC:BEGIN -->`), `## Definition of Done`, `## Implementation Plan/Notes`, `## Comments`.

### Веха — `backlog/milestones/<slug>.md`

```yaml
---
name: v1.5
description: Релиз поиска
due_date: 2026-12-01
status: active
---
```

### Документ — `backlog/docs/<id>-<slug>.md`

```yaml
---
id: doc-1
title: Гайд API
type: guide
created_date: 2026-10-01
tags: [api]
---
```

Тело — произвольный markdown (rawContent).

### Решение — `backlog/decisions/<id>-<slug>.md`

```yaml
---
id: decision-1
title: Перейти на pnpm
date: 2026-10-01
status: accepted
---
```

Тело — секции `## Context`, `## Decision`, `## Consequences`, `## Alternatives`.

### Черновик — `backlog/drafts/<id> - <slug>.md`

Та же форма, что у задачи: `id: draft-1`, `status: Draft`.

---

## 13. Диагностика

```bash
vibelog doctor          # проверка окружения
vibelog doctor --json   # структурированный результат
```

Проверяет: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, число MCP-инструментов (21), `backlog/`, конфиг, round-trip с Backlog.md.

Если Qwen Code не видит новые MCP-инструменты — MCP-сервер закэширован: перезапустите Qwen Code.

---

Смотрите также: [Best practices и производительность](best-practices.md) · [CLI-справочник](cli-reference.md) · [MCP-справочник](mcp-reference.md)
