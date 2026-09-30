# Руководство пользователя Vibelog.md

Markdown-нативный таск-менеджер для git-репозиториев, совместимый с Backlog.md.
Чистый Node.js 20+, zero runtime dependencies, macOS 10.15 Catalina + Qwen Code.

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
11. [Форматы файлов](#11-форматы-файлов)
12. [Диагностика](#12-диагностика)

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

## 12. Диагностика

```bash
vibelog doctor          # проверка окружения
vibelog doctor --json   # структурированный результат
```

Проверяет: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, число MCP-инструментов (21), `backlog/`, конфиг, round-trip с Backlog.md.

Если Qwen Code не видит новые MCP-инструменты — MCP-сервер закэширован: перезапустите Qwen Code.

---

Смотрите также: [Best practices и производительность](best-practices.md) · [CLI-справочник](cli-reference.md) · [MCP-справочник](mcp-reference.md)
