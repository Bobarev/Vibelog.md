---
id: doc-6
title: Руководство пользователя Vibelog.md
type: readme
created_date: 2026-10-06
tags:
  - user-guide
  - руководство
  - vl-19
---
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
13. [Референсы](#13-референсы-vl-152)
14. [Lessons learned](#14-lessons-learned-vl-153)
15. [Диагностика](#15-диагностика)

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
- `.vibelog/settings.json` — единый файл настроек (VL-143): кэш `git_user_name` (VL-44), настройки бота и секция `env` с секретами. Имя автора комментариев берётся из кэша, без спавна `git config` на каждый комментарий. При `--force` кэш перечитывается из git config. Файл в `.gitignore` — машинная настройка (секция `env` содержит секреты), не коммитится. Если кэша нет или он пуст — используется текущий каскад `git config user.name` → `@agent`

Повторный `init` на инициализированном проекте отклоняется; перезапись — `--force`.

CLI при запуске проверяет npm registry на новую версию (не чаще раза в сутки) и при наличии обновления печатает в stderr уведомление `npm install -g vibelog.md` — без автоустановки. Отключение: `VIBELOG_SKIP_UPDATE_CHECK=true`. Подробнее: [CLI — Автообновление](cli-reference.md#автообновление).

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

В веб-интерфейсе есть сайдбар с переключением между канбан-доской (`#/`) и страницей настроек (`#/settings`, VL-156). Страница настроек редактирует тот же `.vibelog/settings.json`, что и команда `/set` в боте: агент по умолчанию (qwen/vb), лимиты `max_wall_time`/`max_requests` (0 или пусто — сброс к дефолту агента), флаги `branch_mode`/`compact`/`code_same_session`. Секреты (env-секция, например TELEGRAM_BOT_TOKEN) в браузер не отдаются и через страницу не редактируются — только напрямую правкой файла.

---

## 11. Telegram-бот

Команды `vibelog bot` (long-polling, grammy): привязка чата через /start + пин-код, затем задачи и фазы.

Справка `/help` (VL-150) выводит все команды реестра с описанием и примерами — включая полный синтаксис `/set` (`/set agent vb`, `/set max-wall-time 1800`, `/set branch-mode on`, `/set compact off`). Команда доступна до привязки чата (как `/start`); справка собирается из единого реестра `BOT_COMMANDS`, поэтому новая команда появляется в ней автоматически, а меню Telegram и help-строка `/start` обновляются из того же реестра. Длинный текст разбивается на части по лимиту Telegram.

### Фазы через qwen

| Команда | Фаза | Что делает |
|---------|------|------------|
| `/spec[:agent] <описание>` | Spec | создаёт задачу и разбивает фичу на подзадачи |
| `/plan[:agent] <id> [комментарий]` | Plan | план реализации для существующей задачи; комментарий добавляется в задачу и учитывается фазой |
| `/code[:agent] <id> [комментарий] [--same-session\|--no-same-session]` | Code | реализация задачи; комментарий добавляется в задачу и учитывается фазой; флаги `--same-session`/`--no-same-session` (VL-147) разово переопределяют настройку `code_same_session` — см. «Фаза Code в сессии Plan» |
| `/close[:agent] <id>` | Close | закрытие: статус из конфига + git commit |
| `/comment[:agent] <id> <текст>` | Comment | комментарий + запрос агенту (статус не меняется) |
| `/prompt[:agent] <текст>` | Prompt | произвольный запрос через LLM без задачи (git разрешён) |

`/prompt` — для запросов, слишком мелких для задачи («сделай коммиты незакоммиченных файлов», «внеси правку в настройки»): команда не создаёт задачу, `backlog/` не трогается, git-операции разрешены (кроме push без явной просьбы). По завершении в чат приходит только информационное сообщение (VL-63, без карточки задачи); одновременно активен только один `/prompt` — повторный запрос получает ошибку guard'а (общего для обоих агентов).

**Агент-исполнитель** (суффикс `:<agent>`, VL-92/94 — доступен у всех команд фаз: `/spec`, `/plan`, `/code`, `/close`, `/comment`, `/prompt`):

| Суффикс | Агент | Бинарь |
|---------|-------|--------|
| без суффикса, `:qwen` | qwen (дефолт) | `VIBELOG_QWEN_BIN` или `qwen` в PATH |
| `:vb` | встроенный Vibelog | `VIBELOG_AGENT_BIN` или `bin/vibelog-agent.mjs` |

`/prompt:vb <запрос>` запускает встроенный агент Vibelog (VL-85, `docs/agent.md`): те же qwen-совместимые флаги, тот же JSON-контракт результата. Переменные `VIBELOG_LLM_BASE_URL` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_MODEL` берутся из `.env` или секции `env` в `.vibelog/settings.json` — бот применяет их в process.env через `loadDotEnv` → `applySettingsEnv` (VL-37/143, приоритет: реальное окружение → `.env` → `env`-секция), отдельная настройка не нужна. Неизвестный суффикс (`/prompt:foo`) — подсказка синтаксиса, без запуска.

**Настройки бота** (`/set`, VL-94/104/107/122/147): команда принимает шесть параметров.

| Параметр | Пример | Сброс | Назначение |
|----------|--------|-------|------------|
| `agent` | `/set agent vb` | `/set agent qwen` | Агент по умолчанию для команд фаз и кнопок действий (ключ `default_agent`) |
| `max-wall-time` | `/set max-wall-time 1800` | `/set max-wall-time 0` | Лимит времени фазы в секундах для агента vb (ключ `max_wall_time`; передаётся флагом `--max-wall-time`) |
| `max-requests` | `/set max-requests 50` | `/set max-requests 0` | Лимит LLM-запросов фазы (ходов модели) для агента vb (ключ `max_requests`, флаг `--max-requests`; ≠ лимит tool-calls) |
| `branch-mode` | `/set branch-mode on` | `/set branch-mode off` | Режим параллельной разработки в git-ветках vb/vl-N (VL-107, ключ `branch_mode`; раздел «Параллельная разработка в ветках») |
| `compact` | `/set compact off` | `/set compact on` | Компакшн истории LLM-запроса в длинных сессиях (VL-122, ключ `compact`; при `off` оркестратор передаёт агенту vb флаг `--no-compact`; дефолт — включён) |
| `code-same-session` | `/set code-same-session on` | `/set code-same-session off` | Запуск Фазы Code в той же сессии агента, что и Plan (VL-147, ключ `code_same_session`; раздел «Фаза Code в сессии Plan»; дефолт — выключен) |

Все настройки хранятся в едином `.vibelog/settings.json` (VL-143 — замена `bot.yml`/`settings.yml`, прежние snake_case-ключи); битые значения в файле игнорируются. Изменения подхватываются при рестарте бота (`/restart` или перезапуск, VL-143). Лимиты применяются **при следующем запуске** фазы и только для встроенного агента (vb) — qwen эти флаги не поддерживает; без настроек флаги не передаются (поведение прежнее). Значение `0` удаляет настройку (используется дефолт агента). Неизвестный параметр — подсказка синтаксиса. Без суффикса `:<agent>` запускают агента по умолчанию все команды фаз и кнопок действий («следующий этап», ввод комментария с кнопки); явный суффикс (`/code:qwen VL-1`) перекрывает настройку. Неизвестный суффикс любой фазовой команды (`/spec:foo`) — подсказка синтаксиса, без запуска и создания задачи.

### Фаза Code в сессии Plan (VL-147)

Экономия входных токенов: при включённом режиме Фаза Code продолжает сессию агента Фазы Plan через `--resume` — большой контекст планирования уже в истории сессии и попадает в кэш LLM, модель не инициализирует его заново.

- **Включение**: `/set code-same-session on` (ключ `code_same_session` в `.vibelog/settings.json`); по умолчанию выключен — без включения поведение прежнее (каждый `/code` — новая сессия).
- **Явное переопределение** (перекрывает настройку в обе стороны): флаги `/code VL-N --same-session` / `/code VL-N --no-same-session` и поле `sameSession` (boolean) в `POST /api/tasks/:id/trigger`.
- **Источник plan-сессии** — меты `.vibelog/agent-sessions/*.meta.json` (пишет CLI при старте задачной сессии; для qwen дополнительно дописывает оркестратор по result.session_id). Если план-сессия не найдена (задача планировалась до VL-147, меты нет / сессия удалена) — Code запускается в новой сессии, регрессий нет.
- Возобновление дописывает историю план-сессии (без `--fork-session`): повторный `/code` продолжит ту же сессию «план+код» — это цель фичи, но сессия смешивает обе фазы. Если сессия потеряна в локальном хранилище qwen (`~/.qwen`), `--resume` падает с exit 1 — ошибка видна в боте/на доске, повторный обычный `/code` работает.

### Resume сессии по reply (VL-93)

Информационное сообщение о завершении фазы (VL-63) содержит идентификатор сессии агента в одинарных backticks последней строкой — **единый формат `<agent>:<session_id>` для всех агентов** (VL-93): у qwen — `qwen:<session_id>` (UUID), у встроенного vibelog-agent (VL-92) — `vb:<session_id>`.

**Reply на это сообщение** с уточнением продолжает ту же сессию **обоих агентов** (VL-93/95): бот извлекает session_id из сообщения-ответа (текст либо блоки rich-сообщения — информационное сообщение шлётся `sendRichMessage` и не имеет поля `text`; backtick-обёртка, `qwen:<uuid>` и `vb:<session_id>` распознаются, голый UUID/токен — фолбэк, если Telegram отдал reply без backticks — entities хранятся отдельно) и запускает агент-сессию с `--resume <session_id>` и текстом пользователя промптом — без `--fork-session`, та же сессия. У qwen это `qwen --resume <uuid>` (сессии хранит сам qwen, `~/.qwen/projects/`); у vibelog-agent (VL-95) — `--resume` с JSONL-транскриптом из `.vibelog/agent-sessions/` (`docs/agent.md`, раздел «Сессии»), префикс `vb:` снимается CLI агента. Результат приходит в чат информационным сообщением (VL-63, без карточки задачи).

**Параллельность resume (VL-145)**: одновременно могут выполняться resume **разных задач и разных сессий** — в том числе параллельно с фазами других задач (web-оркестратор и бот). Блокировка действует только на повторный запуск **той же самой задачи** (resume при живой фазе этой задачи и наоборот) либо **дубль той же сессии** — такой запуск получает ошибку guard'а «Запуск уже выполняется (VL-N)» с ID занятой задачи. Resume, чья сессия привязана к задаче (мета `*.meta.json`), использует задачный ключ и участвует в guard'е наравне с фазами; resume без меты (старые сессии, `/prompt`-подобные) блокируется только дублем своего session_id. Если resume падает (сессия не найдена) — в чат уходит сообщение об ошибке.

Reply на сообщение бота без session_id и обычные текстовые сообщения не меняются: режим комментария (VL-78) и пин работают как раньше. Возобновление работает только в привязанных чатах.

### Кнопки карточки задачи (VL-72, VL-78)

В rich-рендере карточки задачи (команда /task и карточка после завершения фазы) сразу после заголовка выводится **центрированный ряд callback-кнопок** (`<tg-button-row align="center">`):

- **«▶ Spec / 📋 Plan / 💻 Code / ✅ Close»** (`style="primary"`, data `next:<id>`) — запуск следующей фазы workflow по статусу задачи;
- **«💬 Комментарий»** (`style="success"`, data `comment:<id>`) — показывается всегда, включая Done/Blocked.

| Статус | Кнопка следующего этапа | Запускаемая фаза |
|--------|------------------|------------------|
| To Do | ▶ Spec | Фаза 1 (spec) → статус Spec |
| Spec | 📋 Plan | Фаза 2 (plan) → статус Planned |
| Planned | 💻 Code | Фаза 3 (code) → статус Review |
| In Progress | 💻 Code | Фаза 3 (code) — продолжение реализации |
| Review | ✅ Close | Фаза Close (close) → статус Done |
| Done, Blocked | — (только «💬 Комментарий») | кнопка не показывается |

**Кнопка «следующий этап»** (VL-72): нажатие отправляет callback-запрос `next:<id>`: бот отвечает на него (иначе Telegram показывает «часики») и запускает фазу по тому же механизму, что и команды /plan, /code, /close — с уведомлением о завершении фазы. Фаза запускается агентом по умолчанию из настроек (VL-94, `/set agent`). Для Done/Blocked и неизвестных статусов бот отвечает «нет следующего этапа» без запуска.

**Кнопка «Комментарий»** (VL-78): нажатие отправляет callback `comment:<id>` — бот просит ввести текст комментария следующим сообщением. Введённый текст сохраняется через `addComment` и запускает Фазу Comment — та же логика, что у команды `/comment[:agent] <id> <текст>` (VL-60); агент — по умолчанию из настроек (VL-94). Пустой ввод → повторный промпт; `/cancel` — выход из режима ожидания. Режим ожидания живёт в памяти процесса (как пин-код) — после рестарта бота нужно нажать кнопку заново.

**Expand-блоки карточки** (VL-78): секции Описание / Acceptance Criteria / Definition of Done / Implementation Plan / Implementation Notes / Final Summary / Комментарии свёрнуты в `<details><summary>` (поддерживается rich-сообщениями Telegram); **Описание открыта по умолчанию**, шапка с метой (статус, приоритет, исполнители, метки, срок) видна всегда. Кнопки и details доступны только в rich-рендере; фолбэк MarkdownV2 (старые клиенты) их не содержит.

**Сырые rich-теги в контенте** (VL-81): если текст задачи (описание, AC/DoD, plan, notes, комментарии) сам содержит `<tg-button>`, `<tg-button-row>`, `<details>`, `<summary>` — при вставке в rich-разметку такие теги оборачиваются в code-разметку (строки целиком из тегов — в fenced-блок, теги вперемешку с текстом — в inline-бэкитики), чтобы парсер Telegram не интерпретировал их как настоящие элементы и не ломал кнопки/expand-блоки карточки. Теги, уже находящиеся внутри `...`-кода, не изменяются; блоки ``` контента (после экранирования в ` ` `) превращаются в настоящий fenced-блок — маркеры ` ` ` fenced-блоком не являются. Служебные теги рендера (шапка, ряд кнопок, обёртки секций) не затрагиваются; фолбэк MarkdownV2 не изменён.

### Список /tasks — rich-таблица (VL-82)

Команда `/tasks` отправляет RichMessage: таблица `<table bordered striped compact>` с колонками ID / Заголовок / Статус / Тип / Приоритет (невыполненные задачи, по возрастанию ID — фильтр и порядок не менялись) и под таблицей callback-кнопки `<tg-button-row>` — по одной на задачу (текст = только номер задачи без префикса «VL-», например «128»; data `task:<id>` полная, `task:VL-N`). Кнопки дробятся на ряды по 5 (VL-128: при 8 в ряду подписи-ID не помещались и текст не был виден); жёсткий лимит Telegram — 8 кнопок в ряду (при большем числе rich-сообщение отклоняется с ошибкой RICH_MESSAGE_BUTTONS_TOO_MANY) — остаётся верхней границей, и в `/docs` кнопки документов по-прежнему дробятся по 8. Нажатие кнопки открывает карточку задачи — полный аналог команды `/task VL-N`.

**Формат ячеек — HTML.** Таблица строится как Rich HTML (`<tr>/<th>/<td>`, жирный ID — `<b>`): по спецификации Telegram блок `<table>` в rich-сообщении парсится именно как HTML-таблица, и GFM-строки `| ... |` внутри него отображаются сырым текстом — поэтому «Markdown-таблица» в обёртке `<table>` не рендерилась (исправлено в VL-82 после проверки в Telegram).

**Цвет кнопки по типу задачи**: маппинг хранится в `.vibelog/settings.json` (ключ `task_type_styles`); дефолты — `bug→danger`, `feature→success`, `enhancement→primary`, `epic→primary`. Допустимые стили Telegram: `danger` (красный), `success` (зелёный), `primary` (синий), `link` (без рамок); для остальных типов кнопка получает дефолтный стиль Telegram. Пользовательские переопределения перекрывают дефолты (сами дефолты в файл не записываются):

```json
{
  "task_type_styles": {
    "bug": "success",
    "docs": "link"
  }
}
```

При ошибке rich API (старые клиенты) бот откатывается на MarkdownV2-список (`formatTaskList`) — поведение прежнее.

**Пометка активной фазы агента (VL-91)**: строки задач, у которых в оркестраторе прямо сейчас выполняется фаза, помечаются значком 🔄 с указанием фазы (spec/plan/code/close/comment) — и в rich-таблице, и в MarkdownV2-фолбэке. Активность определяется по in-memory состоянию оркестратора (`getRun(taskId).running === true`) того же процесса, что и бот, поэтому фазы, запущенные из web UI (`vibelog browser`, отдельный процесс), в `/tasks` не видны — то же ограничение, что у `/task` (VL-43). Завершённые и ошибочные запуски не помечаются.

### Git-статус /diff (VL-88)

Команда `/diff` в привязанном чате показывает текущие незакоммиченные файлы git-репозитория проекта — read-only, ничего не коммитит и не меняет в рабочем дереве.

RichMessage-таблица `<table bordered striped compact>` с колонками «Файл | Статус | Строки (+/−)» из `git status --porcelain` + `git diff --numstat` (staged и unstaged раздельно):

- **Статус** — человекочитаемый: Modified / Added / Deleted / Untracked / Renamed; staged-файлы отмечаются меткой «(staged)» и не сливаются с unstaged (файл в обеих колонках — две строки таблицы).
- **Строки (+/−)** — счётчики строк из numstat; для renamed — по новому пути, для untracked — 0/0.
- Заголовок содержит имя ветки (`git branch --show-current`); пути и подписи экранируются, длинная таблица дробится по лимиту 32768 (chunkRich).

Если незакоммиченных изменений нет — короткое сообщение «Незакоммиченных изменений нет» (таблица не строится). При недоступности rich API (старые клиенты) — фолбэк на MarkdownV2-список (`formatDiffList`), как у /task и /tasks. Git-сбой или не-git-репозиторий — сообщение об ошибке в чат, бот не падает.

Сбор данных — core-функция `getGitStatus(cwd)` (`src/core/git.ts`); git вызывается с `-c core.quotepath=false`, чтобы не-ASCII пути не octal-экранировались и совпадали с numstat.

### Команды git — /commits (VL-90)

Команда `/commits [X]` (по умолчанию X=10) в привязанном чате показывает таблицу последних X коммитов git-репозитория проекта — read-only, ничего не коммитится.

RichMessage-таблица `<table bordered striped compact>` с колонками «Тема | Дата | Автор | Хеш» (хеш — в `<code>`; все поля через cellSafe):

- Дефолт — 10 коммитов; `/commits 5` — ровно 5; некорректный аргумент (0, отрицательный, дробный, буквы) — сообщение «Синтаксис: /commits [N]».
- Пустой лог (репозиторий без коммитов) — короткое сообщение «Коммитов нет», таблица не строится.
- Git-сбой или не-git-репозиторий — сообщение об ошибке в чат, бот не падает (паттерн /diff). При недоступности rich API — фолбэк на MarkdownV2 (`formatCommitsList`).

Сбор данных — `getGitLog(cwd, count)` в `src/core/git.ts` — единый git-модуль Vibelog (VL-90 объединил `git.ts` + `git-user.ts` + `git-status.ts` в один файл по аналогии с `src/git/operations.ts` оригинала Backlog.md): `git rev-parse --is-inside-work-tree` (проверка), `git rev-parse --verify HEAD` (пустой репозиторий → `[]`), `git log -n <count>` с форматом `%h%x1f%an%x1f%ad%x1f%s` и чистым парсером `parseGitLog`.

### Документы в боте (VL-89)

Команды `/docs` и `/doc` — просмотр документов проекта (`backlog/docs/`, формат doc-N) в Telegram. Создание и редактирование через бот не реализованы — используйте CLI `vibelog doc ...` или MCP-инструменты `document_*`.

**`/docs [фильтр]`** — список документов: RichMessage-таблица `<table bordered striped compact>` с колонками ID / Заголовок / Тип / Теги и под таблицей callback-кнопки `doc:<id>` (дробление по 8 в ряд — лимит Telegram, паттерн `/tasks`). Необязательный текстовый аргумент — фильтр поиска (`searchDocuments`: id, заголовок, теги, тело документа). Пустой список — короткий текст «Документов нет» без таблицы. При отказе rich API — фолбэк MarkdownV2 (`formatDocsList`).

**`/doc <id>`** — карточка документа: метаданные (id, title, тип, теги, дата создания) + тело markdown с учётом лимитов Telegram (разбивка `chunkRich`; MarkdownV2-фолбэк `formatDocumentDetail` усечён до 1500 символов). Неизвестный id — сообщение «Документ &lt;id&gt; не найден» (id экранируется, как в `/task`). Callback-кнопка `doc:<id>` из `/docs` открывает ту же карточку.

### Самоперезапуск /restart (VL-70/107)

После `pnpm build` запущенный бот продолжает исполнять старый `dist/`. Команда `/restart` в привязанном чате рестартует бота **самого себя**: он отвечает «🔄 Перезапуск бота…», останавливает long polling и поднимает новый `vibelog bot` **в том же терминале** (stdio наследуется — новый пин-код печатается там же, где был запущен старый процесс; detached-режим — новый процесс переживает старый). Новый процесс исполняет свежий `dist/` — Ctrl+C не требуется, и перечитывает `.env` и `.vibelog/settings.json` — изменённые настройки применяются сразу (VL-143). Чат остаётся привязанным (`.vibelog/settings.json` не меняется); команда доступна только привязанным чатам. При сбое запуска нового процесса бот сообщает об ошибке в чат и в консоль.

**`/restart VL-N` (VL-107)** — перезапуск из worktree ветки `vb/vl-N` (режим параллельной разработки): бот отвечает «🔧 Сборка ветки vb/vl-N…», создаёт worktree (если его нет) и собирает его главным `tsc` (dist worktree пересобирается с нуля; typescript берётся из главного node_modules — `pnpm install` в worktree не нужен, если ветка не меняла зависимости). Успешная сборка — сообщение «✅ Ветка собрана», затем обычный перезапуск: новый процесс исполняет `…/vl-N/bin/vibelog.mjs` (dist ветки), но **cwd остаётся главным репозиторием** — токен, backlog/ и `.vibelog/` общие. Ошибка сборки (не git-репо, конфликт ветки, сломанный tsconfig) — сообщение об ошибке в чат, **текущий процесс не трогается** — бот продолжает работать, можно исправить и повторить. Некорректный аргумент — «Синтаксис: /restart [VL-N]». Рекомендуется сначала `/set branch-mode on`, чтобы фазы новых задач сразу шли в ветки. Повторный `/restart` без аргументов после `/restart VL-N` возвращает бота в корневой dist (главная ветка), не оставляя в worktree.

### Параллельная разработка в ветках (VL-107)

Несколько задач в статусе Review не должны блокировать друг друга: режим `/set branch-mode on` (ключ `branch_mode` в `.vibelog/settings.json`) направляет фазы задач в git-ветки.

**Схема «worktree для кода + общий backlog»**: worktree `.vibelog/worktrees/vl-N` на ветке `vb/vl-N` (`git worktree add -b vb/vl-N … HEAD` — от закоммиченного HEAD главного репо; незакоммиченные изменения в ветку не переносятся) создаётся **впервые при запуске Фазы Plan** (VL-134: к этому моменту ветка ещё актуальна; фазы до Plan — Spec и прочие — работают в главном репозитории); для задач типа **epic worktree не создаётся ни на одной фазе**. Уже созданный worktree используется остальными фазами (code/comment/resume) — спавн идёт с cwd worktree, код изолирован в ветке; если worktree нет — фаза идёт в главном cwd. MCP-сервер агента при этом получает `VIBELOG_CWD` = главный репозиторий: статусы и комментарии задач пишутся в **общий** `backlog/`, worktree-копия backlog не трогается — merge ветки не конфликтует с задачами. Агенту в промпте дописывается примечание: коммитить код в текущую ветку, файлы `backlog/` не коммить. `/prompt` и `/prompt`-кнопки (не привязаны к задаче) всегда работают в главном репозитории — без изменений; resume-сессии возобновляются в worktree своей задачи, если мета сессии её знает (VL-110).

Worktree выбран вместо `dist/VL-N`: `package.json.files` включает `dist` (сборки веток попали бы в npm-пакет), `pnpm build` главного репо стирает `dist/` целиком, а `.vibelog/` уже в `.gitignore`. Ветка, меняющая зависимости, требует ручного `pnpm install` в worktree — иначе рантайм упадёт на импорте новой паки. `/tasks` показывает активную фазу 🔄 по in-memory состоянию процесса бота — фазы в worktree видны так же (guard от двойного запуска общий).

### Ответ по завершении фазы — 2 сообщения (VL-63)

1. **Карточка задачи** — как в /task (rich-рендер, без строки фазы).
2. **Информационное сообщение** — из последней JSON-строки `type=result` вывода qwen; отправляется RichMessage (GFM) через sendRichMessage — MarkdownV2 остаётся фолбэком для старых клиентов (VL-71):

```
# Фаза comment: завершена (код 0) — VL-98

> понг (каждая строка ответа модели — в цитате)

**Токены:** входные: 10956 · сгенерированные: 19 · кэш: 10944 · всего: 10975
**Входные минус кэш:** 12

**Общее время:** 42с (api: 42с)
**Количество запросов:** 1

`qwen:a470c7dd-2ca8-4510-9d81-b184f932af76`
```

Заголовок завершается идентификатором задачи ` — VL-N` (VL-98): он есть у всех реальных завершений фаз задач (comment/spec/plan/code/close); `/prompt` и resume-сессии не привязаны к задаче — их отчёт остаётся без суффикса. Ответ модели выводится цитатой (каждая строка с `> `). Токены — одной строкой плюс строка «Входные минус кэш» (входные минус кэш-токены — объём «свежего» входа без учёта кэша). Время — в минутах и секундах («1м 23с»; до секунды — миллисекунды).

Идентификатор сессии выводится с префиксом агента — единый формат `<agent>:<session_id>` (VL-93): `qwen:<session_id>` у qwen, `vb:<session_id>` у встроенного vibelog-agent (VL-92); по reply на информационное сообщение возобновляется сессия любого агента (VL-95, раздел «Resume сессии по reply»).

Сырой JSON-лог в чат больше не шлётся. Если результат недоступен (ошибка запуска qwen, обрыв), информационное сообщение содержит статус, строку «Данные результата недоступны» и хвост лога (до 800 символов) в тройных backticks — без экранирования MarkdownV2. Парсер понимает оба формата вывода qwen: NDJSON-поток и строку-массив `[{…}]` (json-адаптер qwen 0.24.x). Если result не распознан, в консоль сервера печатается расширенная диагностика: сводка `parseQwenResult` по stdout, размеры потоков stdout/stderr, хвосты обоих (в таймлайне консоли строки stderr помечены `err|`), а полный stdout дампится в `.vibelog/qwen-debug/<id>-<время>.log` (gitignored) — по дампу видно точный формат вывода qwen без перезапуска фазы. stdout и stderr копятся в раздельных буферах: предупреждения qwen и логи MCP-серверов не могут клиниваться в JSON-строку результата. Флаги `--json-file`/`--json-fd` в headless-режиме qwen 24.x не работают (проверено: файл остаётся пустым) — JSON по-прежнему идёт в stdout через `--output-format json`.

### Разбивка длинных сообщений фаз (VL-148)

Итоговое сообщение фазы (результат `/analyze`, `/prompt`, уведомление о завершении фазы) **не обрезается**: если оно не помещается в лимит длины сообщения Telegram (4096 символов для MarkdownV2-фолбэка, 32768 для rich-сообщений), бот отправляет несколько последовательных сообщений с нумерацией суффиксов «часть 1/N» … «часть N/N». Короткий результат (в пределах лимита) приходит одним сообщением без изменений.

- Разрез идёт **только по границам строк** — чтобы не разорвать escape-последовательность MarkdownV2 (`\x`), иначе Telegram отклоняет сообщение («can't parse entities»). Аномально длинная строка без переводов строк режется жёстко.
- Общий помощник разбивки — `splitNumbered` (`src/bot/formatting.ts`); к другим командам бота (`/task`, `/diff`, `/commits`) подключается позже отдельной задачей.

---
## 12. Форматы файлов

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

Тело: секции `## Context`, `## Decision`, `## Consequences`, `## Alternatives`.

### Черновик — `backlog/drafts/<id> - <slug>.md`

Та же форма, что у задачи: `id: draft-1`, `status: Draft`.

---

## 13. Референсы (VL-152)

Референсы — внешние источники знаний: репозитории, URL, файлы, документация, спецификации. Метаданные — `backlog/references/<id>-<title>.md` (в git), клоны репозиториев — `backlog/references/data/` (в .gitignore).

```bash
vibelog reference list                        # все референсы
vibelog reference list --type repo --tags mcp # фильтры
vibelog reference add "vibe-kanban" --type repo --url https://github.com/BloopAI/vibe-kanban.git
vibelog reference view ref-1                  # метаданные + linked_tasks + описание
vibelog reference search "drag"               # поиск по id/title/url/tags/телу
vibelog reference link ref-1 VL-152           # двусторонняя связь с задачей
vibelog reference remove ref-1                # удалить метаданные (клон в data/ остаётся)
vibelog reference sync                        # доклонировать отсутствующие
```

Типы: `repo`, `url`, `file`, `doc`, `spec`. `add --type repo` **сам клонирует** репозиторий в `data/<dir>` (идемпотентно: существующий клон пропускается; `--no-clone` — только метаданные). `sync` доклонирует отсутствующие — для разработчиков, склонировавших проект без `data/` (папка в .gitignore).

Связь с задачей двусторонняя: `linked_tasks` референса ↔ `references` задачи (`vibelog reference link` или MCP `reference_link`).

**Интеграция с фазами**: Plan-фаза читает `references` задачи через `reference_view` и использует источники в плане; Code-фаза добавляет новые (`reference_add`) и связывает использованные (`reference_link`), записывая их в задачу. База знаний растёт с каждой задачей — следующая похожая задача находит проверенные источники сразу. Подробнее: [Референсные проекты](doc-3-Референсные-проекты-backlogreferences.md) (doc-3).

---

## 14. Lessons learned (VL-153)

Lessons learned — workflow-уроки из опыта задач: сформулированные проблемы и их решения, которые предотвращают повторение ошибок в будущих задачах. Хранятся отдельно от задач: задача в статусе Done заморожена, а урок эволюционирует (уточняется, объединяется, устаревает).

Файлы — `backlog/lessons/lesson-N-<slug>.md`: YAML-фронтматтер (id, title, status, tags, source_tasks, linked_tasks, created_date, updated_date, supersedes) + markdown-тело «Проблема / Решение / Пример». Статусы: `active` (по умолчанию), `outdated`, `superseded` (заменён другим уроком — через `lesson_supersede`).

```bash
vibelog lesson list                              # все lessons
vibelog lesson list --status active --tags mcp   # фильтры
vibelog lesson create "Тесты со spawn медленные — запускай батчами по 10" \
  --tags core,tests --source-tasks VL-153 -d "Проблема: ..."
vibelog lesson view lesson-1                     # метаданные + linked_tasks + тело
vibelog lesson search "spawn"                    # поиск по id/title/tags/телу
vibelog lesson link lesson-1 VL-160              # двусторонняя связь с задачей
vibelog lesson supersede lesson-1 lesson-5       # lesson-1 → superseded, lesson-5 ссылается на него
```

Формулировка урока — императив, конкретика, 1 предложение. Хорошо: «Тесты со spawn медленные — запускай батчами по 10». Плохо: «Производительность тестов».

Связь с задачей двусторонняя: `linked_tasks` урока ↔ `lessons` задачи (`vibelog lesson link` или MCP `lesson_link`).

**Интеграция с фазами**:
- **Close пишет автоматически** (шаг 6.5): при закрытии задачи, которая была в Code, формулирует 1–3 урока (если есть чему учить), проверяет похожие активные lessons и обновляет их или создаёт новые, связывает задачу.
- **Plan читает автоматически**: активные lessons с теми же tags/labels, что у задачи, подставляются в промпт Plan через переменную `{{taskLessons}}` (0 дополнительных ходов модели).
- **Code связывает применённые** (шаг 6.5): использовал существующий lesson — оставляет связь, создал новый — создаёт и связывает.

Чем больше задач выполнено, тем больше накапливается уроков — следующая похожая задача планируется с учётом уже сделанных ошибок. Отличие от других сущностей: references — внешние источники; decisions — архитектурные решения («почему X, не Y»); docs — документация проекта; lessons — workflow-уроки, эволюционирующие независимо от задач.

---

## 15. Диагностика

```bash
vibelog doctor          # проверка окружения
vibelog doctor --json   # структурированный результат
```

Проверяет: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, число MCP-инструментов (36), `backlog/`, конфиг, round-trip с Backlog.md.

Если Qwen Code не видит новые MCP-инструменты — MCP-сервер закэширован: перезапустите Qwen Code.

---

Смотрите также: [Best practices и производительность](best-practices.md) · [CLI-справочник](cli-reference.md) · [MCP-справочник](mcp-reference.md)