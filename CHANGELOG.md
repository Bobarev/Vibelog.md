# Changelog

Все заметные изменения Vibelog.md. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Добавлено

- **VL-32: smoke-тест npm-пакета** — `scripts/npm-smoke.mjs`: pack → установка в чистый /tmp-каталог → реальный прогон CLI (--help, init, task create/list, browser + React UI) + проверка содержимого пакета (шаблоны оркестратора, web/dist, отсутствие backlog/.qwen). Гонять перед npm publish.
- **VL-28: Оркестратор фаз Qwen Code** — перенос карточки в Spec/In Progress/Review на Kanban-доске запускает фазу (spec/plan/code) через `POST /api/tasks/:id/trigger`: сервер спавнит `qwen <промпт> --approval-mode yolo` с headless-промптом из `templates/qwen-commands/phase-*.md`. Guard от двойного запуска (409), поллинг завершения → авто-refresh доски, отчёт фазы виден как последний комментарий карточки. Статусы проекта расширены: Backlog, Spec, Planned.
- **VL-27: Kanban-доска в веб-интерфейсе** (портирована из шаблона arhamkhnz на @dnd-kit/react ^0.5). Колонки — статусы из `backlog.config.yml`; карточка показывает id, title, priority, description, labels, assignee, due_date, число комментариев. Drag-and-drop карточек между колонками выполняет `PATCH /api/tasks/:id` со сменой `status`; при ошибке доска откатывается. Компоненты без следов Next.js ('use client', next/*).
- **VL-26: `vibelog browser` отдаёт React UI из `web/dist`** (Vite + React + Tailwind). Каталог `web/dist` коммитится в репозиторий — свежий clone сразу получает React UI; если сборки нет, сервер отдаёт прежний inline HTML из `assets.ts` (фолбэк). Dev-прокси `/api` → `127.0.0.1:3030` в `web/vite.config.ts`. Скрипт `pnpm web:build` — сборка UI из корня.

## [1.5.0] — 2026-10-01

Миграция проекта на TypeScript. Поведение и форматы данных не изменились.

### Изменено

- **Весь исходный код на TypeScript** (`src/**/*.ts`, strict-режим): ядро (15 модулей `src/core`), CLI (роутер + 14 команд), MCP-сервер (21 инструмент), веб-интерфейс. Сборка: `pnpm build` (`tsc`) → `dist/` (ESM); `bin/vibelog.mjs` — шим на `dist/cli/router.js`.
- **TypeScript и `@types/node` — только devDependencies**; runtime остаётся zero-dependency (чистый ESM без нативных модулей, совместимость с macOS Catalina сохранена).
- Скрипты: `build` (tsc), `typecheck` (tsc --noEmit), `test` (build + `node --test src`). Тесты (`*.test.mjs`) импортируют скомпилированный код из `dist/`.
- Публичные контракты ядра типизированы: `Task`, `TaskInput`, `ChecklistItem`, `TaskComment`, `Milestone`, `Document`, `Decision`, `SearchFilters`.
- README: установка включает `pnpm build`; AGENTS.md: правило «только .mjs» заменено на схему «.ts → tsc → dist».

### Примечания

- Форматы данных Backlog.md не менялись — round-trip совместимость покрыта compat-тестами (306/306).

## [1.4.0] — 2026-10-01

Первый релиз после v1.2.0: два плановых релиза фич (v1.3 + v1.4) в одном.

### Добавлено — v1.4

- **Documents**: `vibelog doc create/list/view/update/search` + 5 MCP-инструментов `document_*`. Файлы `backlog/docs/<id>-<slug>.md`, типы `readme/guide/specification/other`.
- **Config**: `vibelog config get/set/list` — управление `backlog/config.yml` с типизацией (массивы/boolean/числа), whitelist ключей.
- **Drafts**: `vibelog draft create/list/view/edit/promote/archive` — черновики задач (`draft-N`, статус Draft) в `backlog/drafts/`; `promote` создаёт задачу с префиксом конфига.
- **Decisions (ADR)**: `vibelog decision create/list/view` — `backlog/decisions/`, статусы `proposed/accepted/rejected/superseded`, тело Context/Decision/Consequences/Alternatives.
- `task edit`: batch AC/DoD — `--check-ac 1,3`, `--uncheck-dod 1,2`; MCP `manage_ac`/`manage_dod` принимают массив индексов (как `acceptanceCriteriaCheck` оригинала), `remove` — по убыванию без сдвига.
- `task list`: `--limit N`, `--skip N` — после фильтрации и сортировки.

### Добавлено — v1.3

- **Milestones**: `vibelog milestone add/list/rename/remove/archive` + 5 MCP-инструментов `milestone_*`. Файлы `backlog/milestones/`, `rename` обновляет задачи, `remove --task-handling clear|keep|reassign`.
- **Types**: типы задач (`bug/feature/enhancement/task/chore/docs/spike`) — ключ `types` в конфиге, `--type` в create/list/edit, фильтр `type` в MCP; валидация case-insensitive с каноническим написанием.
- `task create --plan/--notes` — план и заметки при создании.
- `task create`: DoD-дефолты из `config.definition_of_done` (unchecked) + `--no-dod-defaults` — **исправлена несовместимость**: раньше дефолты не добавлялись вовсе.
- `task create`: `--project`, `--parent` (валидация существования), `--ordinal`, `--final-summary`, `--draft` (черновик вместо задачи).
- `task edit`: `--final-summary`, `--append-final-summary`, `--clear-final-summary`, `--ordinal`.
- MCP `backlog_create_task`: параметры `type`, `ordinal`, `finalSummary`, `project` — паритет с `task_create` оригинала.
- `vibelog init` автоматически настраивает MCP-сервер в `.qwen/settings.json` (массив `mcpServers.vibelog` c `trust: true`); отключение — `--no-mcp`.

### Изменено

- Всего **21** MCP-инструмент (было 11 в v1.2.0).
- `backlog_search`: фильтры `status/type/project/priority/modifiedFiles/limit`, `query` необязателен — как `task_search` оригинала; вывод расширен (type, project, labels, milestone).
- `vibelog search`: флаги `--status/--type/--priority/--limit`, запрос необязателен при наличии фильтра.
- doctor: проверка числа MCP-инструментов (21) и их имён.

### Исправлено

- MCP-сервер: терялся последний JSON-RPC ответ при закрытии stdin (гонка `process.exit(0)` с буферизацией stdout-pipe).
- `vibelog search`: значения флагов попадали в поисковый запрос (`search --status Done` искал «Done»); первое слово запроса терялось в `subcommand`.

## [1.2.0] — 2026-09-30

- Планы PLAN-01..10: scaffold, YAML/frontmatter-парсеры, core, CLI, MCP-сервер, web-интерфейс (kanban), compat с Backlog.md (94 задачи), v1.1-workflow (5 MCP-инструментов), diagnostics (`vibelog doctor`), команды `/vibelog:*` для Qwen Code (spec → plan → code).

## [1.1.0] — 2026-09-30

- MCP-инструменты полного workflow: `backlog_update_task`, `backlog_manage_ac`, `backlog_manage_dod`, `backlog_add_comment`, `backlog_update_dependencies` (итого 11).

## [1.0.0] — 2026-09-30

- Первый релиз: markdown-нативный таск-менеджер для git-репозиториев, совместимый с Backlog.md. Чистый Node.js, zero runtime dependencies, macOS 10.15 Catalina + Qwen Code.
