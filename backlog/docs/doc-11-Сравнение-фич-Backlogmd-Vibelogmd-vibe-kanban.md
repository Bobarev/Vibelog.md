---
id: doc-11
title: 'Сравнение фич: Backlog.md, Vibelog.md, vibe-kanban'
type: other
created_date: 2026-10-06
tags:
  - research
  - comparison
  - refs
---
---
id: doc-11
title: 'Сравнение фич: Backlog.md, Vibelog.md, vibe-kanban'
type: other
created_date: 2026-10-06
tags:
  - research
  - comparison
  - refs
---
# Сравнение фич: Backlog.md, Vibelog.md, vibe-kanban

**Дата:** 2026-09-30
**Задача:** VL-1
**Автор:** Qwen Code (ресёрч), пользователь (ревью)

## Цель ресёрча

Систематически сравнить фичи трёх проектов:
- **Backlog.md** — оригинал, эталон совместимости (`refs/Backlog.md`).
- **Vibelog.md** — наш проект (`../Vibelog.md`).
- **vibe-kanban** — оркестратор агентов, источник идей (`refs/vibe-kanban`). Проект закрывается (sunset), опыт можно переиспользовать.

## Приоритеты

- **P0 (критично)** — без этого нельзя работать.
- **P1 (важно)** — нужно в ближайшие 2-3 итерации.
- **P2 (желательно)** — можно отложить.
- **P3 (не нужно)** — overkill или не применимо.

---

# Часть 1: Backlog.md vs Vibelog.md

## 1.1. CLI-команды

Источник: `refs/Backlog.md/CLI-INSTRUCTIONS.md`, `refs/Backlog.md/src/cli.ts` (44 команды).

| Команда | Backlog.md | Vibelog.md | Статус | Приоритет |
|---|---|---|---|---|
| `init` | ✅ (15 флагов) | ✅ (4 флага: prefix, skills, force) | Частично | P2 |
| `task create` | ✅ (22 флага) | ✅ (10 флагов) | Частично | P1 |
| `task list` | ✅ (17 флагов) | ✅ (5 флагов: status, labels, ready, sort, json) | Частично | P1 |
| `task view` | ✅ | ✅ | Совместимо | — |
| `task edit` | ✅ (40+ флагов) | ✅ (20 флагов) | Частично | P1 |
| `task complete` | ✅ | ✅ | Совместимо | — |
| `task archive` | ✅ | ✅ | Совместимо | — |
| `task demote` | ✅ (→ draft) | ❌ | Отсутствует | P2 |
| `board` | ✅ (layout, milestones) | ✅ (ANSI + export) | Частично | P2 |
| `board export` | ✅ (--force, --readme) | ✅ (--export) | Частично | P3 |
| `browser` | ✅ (--port, --no-open, --non-interactive) | ✅ (--port, --no-open) | Совместимо | — |
| `search` | ✅ (8 флагов) | ✅ (1 флаг: json) | Частично | P1 |
| `milestone list` | ✅ | ❌ | Отсутствует | P1 |
| `milestone add` | ✅ | ❌ | Отсутствует | P1 |
| `milestone rename` | ✅ | ❌ | Отсутствует | P2 |
| `milestone remove` | ✅ (--task-handling) | ❌ | Отсутствует | P2 |
| `milestone archive` | ✅ | ❌ | Отсутствует | P2 |
| `doc create` | ✅ | ❌ | Отсутствует | P1 |
| `doc list` | ✅ | ❌ | Отсутствует | P1 |
| `doc view` | ✅ | ❌ | Отсутствует | P1 |
| `doc update` | ✅ | ❌ | Отсутствует | P2 |
| `doc search` | ✅ | ❌ | Отсутствует | P2 |
| `decision create` | ✅ | ❌ | Отсутствует | P2 |
| `decision list` | ✅ | ❌ | Отсутствует | P2 |
| `draft create` | ✅ | ❌ | Отсутствует | P2 |
| `draft list` | ✅ | ❌ | Отсутствует | P2 |
| `draft promote` | ✅ | ❌ | Отсутствует | P2 |
| `draft edit` | ✅ (общий хелпер с task edit) | ❌ | Отсутствует | P3 |
| `draft archive` | ✅ | ❌ | Отсутствует | P3 |
| `draft view` | ✅ | ❌ | Отсутствует | P3 |
| `config` | ✅ (интерактивный визард + get/set/list) | ❌ (только чтение YAML) | Частично | P1 |
| `config get` | ✅ | ❌ | Отсутствует | P1 |
| `config set` | ✅ (16 ключей) | ❌ | Отсутствует | P1 |
| `config list` | ✅ | ❌ | Отсутствует | P2 |
| `doctor` | ✅ (--fix дубликаты ID) | ✅ (окружение) | Разная семантика | — |
| `instructions` | ✅ (--list, гайды) | ✅ (4 темы) | Совместимо | — |
| `mcp start` | ✅ | ✅ | Совместимо | — |
| `agents --update-instructions` | ✅ | ❌ | Отсутствует | P3 |
| `overview` | ✅ (TUI-статистика) | ❌ | Отсутствует | P2 |
| `cleanup` | ✅ | ❌ | Отсутствует | P3 |
| `completion install` | ✅ (bash/zsh/fish/pwsh) | ❌ | Отсутствует | P3 |

**Итого:** Backlog.md — 37 команд. Vibelog.md — 11 команд. Совместимо — 8. Частично — 7. Отсутствует — 22.

## 1.2. Флаги CLI

Источник: `refs/Backlog.md/CLI-INSTRUCTIONS.md`.

### task create — ключевые флаги

| Флаг | Backlog.md | Vibelog.md | Статус | Приоритет |
|---|---|---|---|---|
| `-d/--description` | ✅ | ✅ | Совместимо | — |
| `-a/--assignee` | ✅ | ✅ | Совместимо | — |
| `-s/--status` | ✅ | ✅ | Совместимо | — |
| `-l/--labels` | ✅ | ✅ | Совместимо | — |
| `--priority` | ✅ | ✅ | Совместимо | — |
| `--type` | ✅ | ❌ | Отсутствует | P1 |
| `--project` | ✅ | ❌ | Отсутствует | P2 |
| `--due-date` | ✅ | ✅ | Совместимо | — |
| `--ac` | ✅ | ✅ | Совместимо | — |
| `--dod` | ✅ | ✅ | Совместимо | — |
| `--no-dod-defaults` | ✅ | ❌ | Отсутствует | P2 |
| `--plan` | ✅ | ❌ | Отсутствует | P1 |
| `--notes` | ✅ | ❌ | Отсутствует | P1 |
| `--final-summary` | ✅ | ❌ | Отсутствует | P2 |
| `--ordinal` | ✅ | ❌ | Отсутствует | P2 |
| `-m/--milestone` | ✅ | ✅ | Совместимо | — |
| `--draft` | ✅ | ❌ | Отсутствует | P2 |
| `-p/--parent` | ✅ | ❌ | Отсутствует | P2 |
| `--depends-on/--dep` | ✅ | ✅ | Совместимо | — |
| `--ref` | ✅ | ❌ | Отсутствует | P2 |
| `--modified-file` | ✅ | ❌ | Отсутствует | P3 |
| `--doc` | ✅ | ❌ | Отсутствует | P2 |
| `--plain` | ✅ | ❌ | Отсутствует | P3 |

### task edit — ключевые флаги

| Флаг | Backlog.md | Vibelog.md | Статус | Приоритет |
|---|---|---|---|---|
| `--title/-t` | ✅ | ✅ | Совместимо | — |
| `--description/-d` | ✅ | ✅ | Совместимо | — |
| `--status/-s` | ✅ | ✅ | Совместимо | — |
| `--priority` | ✅ | ✅ | Совместимо | — |
| `--labels/-l` | ✅ | ✅ | Совместимо | — |
| `--add-label` | ✅ | ❌ | Отсутствует | P2 |
| `--remove-label` | ✅ | ✅ | Совместимо | — |
| `--clear-labels` | ✅ | ❌ | Отсутствует | P3 |
| `--type` | ✅ | ❌ | Отсутствует | P1 |
| `--due-date` | ✅ | ✅ | Совместимо | — |
| `--clear-due-date` | ✅ | ❌ | Отсутствует | P3 |
| `--ac` | ✅ | ✅ | Совместимо | — |
| `--remove-ac` | ✅ | ✅ | Совместимо | — |
| `--check-ac` | ✅ | ✅ | Совместимо | — |
| `--uncheck-ac` | ✅ | ✅ | Совместимо | — |
| `--clear-ac` | ✅ | ❌ | Отсутствует | P3 |
| `--dod` | ✅ | ✅ | Совместимо | — |
| `--check-dod` | ✅ | ✅ | Совместимо | — |
| `--uncheck-dod` | ✅ | ✅ | Совместимо | — |
| `--remove-dod` | ✅ | ✅ | Совместимо | — |
| `--plan` | ✅ | ✅ | Совместимо | — |
| `--append-plan` | ✅ | ❌ | Отсутствует | P2 |
| `--notes` | ✅ | ✅ | Совместимо | — |
| `--append-notes` | ✅ | ✅ | Совместимо | — |
| `--comment` | ✅ | ✅ | Совместимо | — |
| `--comment-author` | ✅ | ✅ | Совместимо | — |
| `--final-summary` | ✅ | ❌ | Отсутствует | P2 |
| `--append-final-summary` | ✅ | ❌ | Отсутствует | P3 |
| `--clear-final-summary` | ✅ | ❌ | Отсутствует | P3 |
| `--depends-on/--dep` | ✅ | ✅ | Совместимо | — |
| `--clear-deps` | ✅ | ❌ | Отсутствует | P3 |
| `--ref` | ✅ | ❌ | Отсутствует | P2 |
| `--add-ref` | ✅ | ❌ | Отсутствует | P3 |
| `--remove-ref` | ✅ | ❌ | Отсутствует | P3 |
| `--clear-refs` | ✅ | ❌ | Отсутствует | P3 |
| `--assignee/-a` | ✅ | ✅ | Совместимо | — |
| `--milestone/-m` | ✅ | ✅ | Совместимо | — |
| `--clear-milestone` | ✅ | ❌ | Отсутствует | P3 |

### task list — ключевые флаги

| Флаг | Backlog.md | Vibelog.md | Статус | Приоритет |
|---|---|---|---|---|
| `-s/--status` | ✅ | ✅ | Совместимо | — |
| `--exclude-status` | ✅ | ❌ | Отсутствует | P3 |
| `-a/--assignee` | ✅ | ❌ | Отсутствует | P2 |
| `--unassigned` | ✅ | ❌ | Отсутствует | P3 |
| `-m/--milestone` | ✅ | ❌ | Отсутствует | P1 |
| `-l/--labels` | ✅ | ✅ | Совместимо | — |
| `--search` | ✅ | ❌ | Отсутствует | P2 |
| `--ready` | ✅ | ✅ | Совместимо | — |
| `--limit` | ✅ | ❌ | Отсутствует | P2 |
| `--sort` | ✅ | ✅ | Совместимо | — |
| `--json` | ✅ | ✅ | Совместимо | — |
| `--watch` | ✅ | ❌ | Отсутствует | P2 |
| `--plain` | ✅ | ❌ | Отсутствует | P3 |
| `--type` | ✅ | ❌ | Отсутствует | P1 |
| `--project` | ✅ | ❌ | Отсутствует | P2 |
| `--priority` | ✅ | ❌ | Отсутствует | P2 |
| `--parent` | ✅ | ❌ | Отсутствует | P2 |

### Оконные опции (общие)

| Флаг | Backlog.md | Vibelog.md | Статус | Приоритет |
|---|---|---|---|---|
| `--max-count` | ✅ (все list-команды) | ❌ | Отсутствует | P2 |
| `--skip` | ✅ (все list-команды) | ❌ | Отсутствует | P2 |
| `--count` | ✅ | ❌ | Отсутствует | P3 |

## 1.3. MCP-инструменты

Источник: `refs/Backlog.md/src/mcp/tools/`. В оригинале **19 инструментов**.

| Инструмент | Backlog.md | Vibelog.md | Статус | Приоритет |
|---|---|---|---|---|
| `task_create` | ✅ (required: title) | ✅ `backlog_create_task` | Совместимо | — |
| `task_list` | ✅ (фильтры: status, type, project, assignee, unassigned, milestone, labels, search, ready, limit) | ✅ `backlog_list_tasks` (status, labels, milestone, ready, sort, limit) | Частично | P1 |
| `task_search` | ✅ (query, status, type, project, priority, modifiedFiles, limit) | ✅ `backlog_search` (query) | Частично | P1 |
| `task_edit` | ✅ (40+ полей: AC/DoD batch, comments, plan, notes, refs, docs) | ✅ `backlog_update_task` (9 полей) + `backlog_manage_ac` + `backlog_manage_dod` + `backlog_add_comment` | Разная декомпозиция | — |
| `task_view` | ✅ | ✅ `backlog_view_task` | Совместимо | — |
| `task_archive` | ✅ | ✅ `backlog_update_status` (через status) | Частично | P2 |
| `task_complete` | ✅ | ✅ `backlog_update_status` | Частично | P2 |
| `milestone_list` | ✅ | ❌ | Отсутствует | P1 |
| `milestone_add` | ✅ (required: name) | ❌ | Отсутствует | P1 |
| `milestone_rename` | ✅ (required: from, to) | ❌ | Отсутствует | P2 |
| `milestone_remove` | ✅ (taskHandling: clear/keep/reassign) | ❌ | Отсутствует | P2 |
| `milestone_archive` | ✅ | ❌ | Отсутствует | P2 |
| `document_list` | ✅ (search) | ❌ | Отсутствует | P1 |
| `document_view` | ✅ (required: id) | ❌ | Отсутствует | P1 |
| `document_create` | ✅ (required: title, content) | ❌ | Отсутствует | P1 |
| `document_update` | ✅ (required: id, content) | ❌ | Отсутствует | P2 |
| `document_search` | ✅ (required: query) | ❌ | Отсутствует | P2 |
| `definition_of_done_defaults_get` | ✅ | ❌ | Отсутствует | P2 |
| `definition_of_done_defaults_upsert` | ✅ (required: items) | ❌ | Отсутствует | P2 |
| `get_backlog_instructions` | ✅ (overview, task-creation, task-execution, task-finalization) | ✅ `vibelog instructions` (CLI) | Совместимо | — |

**Итого:** Backlog.md — 19 MCP-инструментов. Vibelog.md — 11. Совместимо — 5. Частично — 4. Отсутствует — 10.

### Ключевые отличия в декомпозиции

- **task_edit (Backlog.md)** — один инструмент с 40+ полями: `acceptanceCriteriaSet/Add/Remove/Check/Uncheck`, `definitionOfDoneAdd/Remove/Check/Uncheck`, `commentsAppend`, `planSet/Append/Clear`, `notesSet/Append/Clear`, `finalSummary/Append/Clear`, `references/Add/Remove`, `documentation/Add/Remove`, `modifiedFiles`.
- **Vibelog.md** — разбил на 4 инструмента: `backlog_update_task` (базовые поля), `backlog_manage_ac`, `backlog_manage_dod`, `backlog_add_comment`. Декомпозиция чище для AI-агента (каждый инструмент — одна операция).
- **Формат ответов:** Backlog.md — plain-text. Vibelog.md — JSON. Для Qwen Code JSON предпочтительнее.

## 1.4. Фичи (docs, decisions, drafts, milestones)

| Сущность | Backlog.md | Vibelog.md | Описание | Приоритет |
|---|---|---|---|---|
| **Documents** (`docs/`) | ✅ | ❌ | Markdown-файлы для спецификаций, README, гайдов. Команды: `doc create/list/view/update/search`. MCP: `document_*`. Полезно для соло-разработки — спецификации фич рядом с задачами. | **P1** |
| **Decisions** (`decisions/`) | ✅ | ❌ | Архитектурные решения (ADR). Команды: `decision create/list`. Полезно для документирования почему выбрано то-то. | **P2** |
| **Drafts** (`drafts/`) | ✅ | ❌ | Черновики задач до формализации. Команды: `draft create/list/promote/edit/archive/view`. Полезно для быстрого захвата идей. | **P2** |
| **Milestones** (`milestones/`) | ✅ | ❌ | Вехи/релизы. Команды: `milestone add/list/rename/remove/archive`. MCP: `milestone_*`. Важно для планирования. | **P1** |

## 1.5. Конфиг

Источник: `refs/Backlog.md/ADVANCED-CONFIG.md`.

| Ключ | Backlog.md | Vibelog.md | Статус |
|---|---|---|---|
| `project_name` | ✅ | ✅ | Совместимо |
| `task_prefix` | ✅ | ✅ | Совместимо |
| `default_status` | ✅ | ✅ | Совместимо |
| `statuses` | ✅ | ✅ | Совместимо |
| `labels` | ✅ | ✅ | Совместимо |
| `priorities` | ✅ | ✅ | Совместимо |
| `definition_of_done` | ✅ | ✅ | Совместимо |
| `date_format` | ✅ | ✅ | Совместимо |
| `default_editor` | ✅ | ✅ | Совместимо |
| `auto_open_browser` | ✅ | ✅ | Совместимо |
| `default_port` | ✅ | ✅ | Совместимо |
| `remote_operations` | ✅ | ✅ | Совместимо |
| `auto_commit` | ✅ | ✅ | Совместимо |
| `bypass_git_hooks` | ✅ | ✅ | Совместимо |
| `check_active_branches` | ✅ | ✅ | Совместимо |
| `active_branch_days` | ✅ | ✅ | Совместимо |
| `max_column_width` | ✅ | ✅ | Совместимо |
| `default_assignee` | ✅ | ❌ | Отсутствует |
| `zero_padded_ids` | ✅ | ❌ | Отсутствует |
| `include_datetime_in_dates` | ✅ | ❌ | Отсутствует |
| `types` | ✅ | ❌ | Отсутствует |
| `projects` | ✅ | ❌ | Отсутствует |
| `filesystem_only` | ✅ | ❌ | Отсутствует |
| `hide_empty_columns` | ✅ | ❌ | Отсутствует |
| `on_status_change` | ✅ (callback) | ❌ | Отсутствует |
| `backlog_directory` | ✅ | ✅ (через findBacklogDir) | Совместимо |

## 1.6. Web UI

| Фича | Backlog.md | Vibelog.md | Статус | Приоритет |
|---|---|---|---|---|
| Kanban-доска | ✅ (React) | ✅ (inline HTML/CSS/JS) | Совместимо | — |
| Drag-and-drop | ✅ | ✅ | Совместимо | — |
| Редактор AC | ✅ | ✅ | Совместимо | — |
| Тёмная/светлая тема | ✅ | ✅ | Совместимо | — |
| Фильтры | ✅ | ❌ | Отсутствует | P2 |
| Milestones view | ✅ | ❌ | Отсутствует | P2 |
| Statistics | ✅ | ❌ | Отсутствует | P3 |
| Inline комментарии к коду | ✅ | ❌ | Отсутствует | P3 |
| Diff-view | ✅ | ❌ | Отсутствует | P3 |
| Встроенный браузер | ✅ | ❌ | Отсутствует | P3 |

---

# Часть 2: vibe-kanban — что применимо

## 2.1. Worktree-per-task

Vibe-kanban создаёт git-worktree с веткой `vk/abc123-task-name` для каждой попытки задачи.

**Применимость к Vibelog.md:** Низкая (P3). Vibelog.md — markdown-таск-менеджер, не раннер агентов. Worktree нужен для изоляции параллельных сессий агентов. Для соло-разработки с одним Qwen Code — избыточно. Если в будущем понадобится параллельное выполнение — взять идею автоименования веток из task-id.

## 2.2. MCP-автогенерация планов («CTO agent»)

Vibe-kanban: внешний MCP-клиент описывает фичу → «turn this plan into issues» → `create_issue` × N → `start_workspace` запускает агента.

**Применимость:** Высокая (P1). Это ровно наша Фаза Spec. Уже реализовано в PLAN-10 (сейчас фазы запускаются ботом и вебом по workflow, см. VL-188). Отличие vibe-kanban: автоматический запуск агента после создания задач. Мы останавливаемся на подтверждении — это правильно для соло-разработки.

## 2.3. Параллельное выполнение агентов

Vibe-kanban: несколько workspaces одновременно, несколько sessions внутри workspace.

**Применимость:** Низкая (P3). На Catalina с одним Qwen Code параллельность невозможна. Идея «несколько задач в разных ветках» применима, но без worktree — просто git branches.

## 2.4. Централизованный MCP-конфиг

Vibe-kanban: UI для настройки MCP-серверов каждого агента, one-click install.

**Применимость:** Низкая (P3). Это задача Qwen Code, не таск-менеджера. Vibelog.md уже имеет свой MCP-сервер.

## 2.5. Другие фичи vibe-kanban

| Фича | Описание | Применимость | Приоритет |
|---|---|---|---|
| Task Attempt | Концепция «попытки» задачи с другим подходом | Идея optional-поля `attempt` во frontmatter | P3 |
| Auto-issue из плана | MCP-инструмент `create_issue` из плана | Уже реализовано (PLAN-10) | — |
| Инлайн-ревью кода | Комментарии к diff в UI | Для Vibelog.md — git diff в CLI достаточно | P3 |
| PR-интеграция | GitHub/Azure Repos merge из UI | Out of scope | P3 |
| Real-time sync | ElectricSQL для cloud-версии | Out of scope | P3 |

---

# Часть 3: Приоритизация

## 3.1. Сводная таблица

| # | Фича | Источник | Приоритет | Обоснование |
|---|---|---|---|---|
| 1 | **Milestones** (CLI + MCP) | Backlog.md | **P1** | Группировка задач по версиям (v1.1.1, v1.2.0). Релизный цикл уже есть через теги. |
| 2 | **Types** (CLI + MCP) | Backlog.md | **P1** | Типы задач (bug/feature/enhancement) для фильтрации. Подтверждено пользователем. |
| 3 | **task_search (расширенный)** | Backlog.md | **P1** | Фильтры status/type/priority в MCP-поиске. |
| 4 | **task create --plan, --notes** | Backlog.md | **P1** | Запись плана и заметок при создании (сейчас только через edit). |
| 5 | **task list --milestone, --type** | Backlog.md | **P1** | Фильтрация по вехе и типу. |
| 6 | **Documents** (CLI + MCP) | Backlog.md | **P2** | Спецификации фич. Понижено с P1 по решению пользователя. |
| 7 | **Config set/get/list** | Backlog.md | **P2** | Управление конфигом без ручного редактирования YAML. |
| 8 | **task_edit: batch AC/DoD** | Backlog.md | **P2** | `acceptanceCriteriaCheck: [1,2,3]` вместо одиночных операций. |
| 9 | **task list --limit, --watch** | Backlog.md | **P2** | Пагинация и подписка на изменения. |
| 10 | **Decisions** (CLI + MCP) | Backlog.md | **P2** | ADR-документирование архитектурных решений. |
| 11 | **Drafts** (CLI + MCP) | Backlog.md | **P2** | Черновики задач для быстрого захвата идей. |
| 12 | **board: milestones view** | Backlog.md | **P2** | Доска с группировкой по вехам. |
| 13 | **Web UI: фильтры** | Backlog.md | **P2** | Фильтрация на kanban-доске. |
| 14 | **task list --max-count, --skip** | Backlog.md | **P2** | Оконные опции для больших списков. |
| 15 | **task create --ref, --doc** | Backlog.md | **P2** | Ссылки на внешние ресурсы и документы. |
| 16 | **task edit --append-plan** | Backlog.md | **P2** | Дописывание в план (как append_notes). |
| 17 | **doD defaults MCP** | Backlog.md | **P2** | Управление DoD-по умолчанию через MCP. |
| 18 | **task --plain** | Backlog.md | **P3** | Плоский вывод для скриптов. |
| 19 | **task list --exclude-status, --unassigned** | Backlog.md | **P3** | Тонкая фильтрация. |
| 20 | **cleanup** | Backlog.md | **P3** | Перемещение старых completed задач. |
| 21 | **completion install** | Backlog.md | **P3** | Автодополнение bash/zsh. |
| 22 | **agents --update-instructions** | Backlog.md | **P3** | Автообновление AGENTS.md/CLAUDE.md. |
| 23 | **Worktree-per-task** | vibe-kanban | **P3** | Изоляция параллельных агентов. На Catalina — неактуально. |
| 24 | **Параллельные агенты** | vibe-kanban | **P3** | Один Qwen Code — параллельность невозможна. |
| 25 | **task attempt (поле)** | vibe-kanban | **P3** | Optional-поле во frontmatter. Не ломает совместимость. |

## 3.3. Roadmap

### v1.3 — Milestones + Types + Search + Plan/Notes

- [ ] Milestones: CLI (add/list/rename/remove/archive) + MCP (5 инструментов)
- [ ] Types: task create --type, task list --type, task_search --type
- [ ] task_search (расширенный): status/type/priority фильтры
- [ ] task create: --plan, --notes
- [ ] task list: --milestone, --type
- [ ] **Итого: +5 MCP-инструментов milestones + расширение существующих (16 вместо 11)**

### v1.4 — Documents + Config + Drafts + Decisions

- [ ] Documents: CLI (create/list/view/update/search) + MCP (5 инструментов)
- [ ] Config: CLI (get/set/list)
- [ ] Drafts: CLI (create/list/promote/edit/archive/view) + MCP
- [ ] Decisions: CLI (create/list) + MCP
- [ ] task edit: batch AC/DoD (acceptanceCriteriaCheck: [1,2,3])
- [ ] task list: --limit, --watch, --max-count, --skip
- [ ] board: milestones view
- [ ] Web UI: фильтры
- [ ] task create: --ref, --doc
- [ ] task edit: --append-plan

### v2.0 — Крупные изменения

- [ ] task attempt (optional-поле)
- [ ] Worktree-per-task (если понадобится параллельность)
- [ ] Git-интеграция: автоименование веток из task-id
- [ ] Web UI: diff-view, inline-комментарии

### Никогда

- Параллельные агенты (Catalina + один Qwen Code)
- Cloud-версия / real-time sync
- PR-интеграция (GitHub/Azure)
- Встроенный браузер в Web UI
- Автодополнение shell (completion install) — Qwen Code делает это лучше

---

# Часть 4: Выводы

## Топ-5 приоритетов (что делать следующим)

1. **Milestones** — поле `milestone` уже есть, не хватает CRUD. Группировка по версиям (v1.2.0).
2. **Types** — типы задач (bug/feature/enhancement) для фильтрации.
3. **task_search (расширенный)** — фильтры status/type/priority в MCP-поиске.
4. **task create --plan/--notes** — запись плана и заметок при создании.
5. **task list --milestone/--type** — фильтрация по вехе и типу.

## Топ-3 из vibe-kanban

1. **MCP-автогенерация задач** — уже реализовано (PLAN-10). Подтверждение правильности подхода.
2. **Минималистичный набор MCP-инструментов** — vibe-kanban: ~25, мы: 11. Правильная стратегия — расширять по мере необходимости.
3. **Единый бинарник CLI + MCP** — уже сделано (`vibelog mcp start`). Архитектура подтверждена.

## Главный риск

**Совместимость формата.** При добавлении milestones/documents нужно следить, чтобы:
- Новые сущности не ломали round-trip с Backlog.md.
- Frontmatter задач оставался совместимым.
- Новые MCP-инструменты не конфликтовали с именами оригинала.

## Рекомендация

**Следующая итерация: v1.3 (Milestones + Types + Search + Plan/Notes).** Это закрывает релизный цикл (группировка по версиям) и добавляет ключевые фильтры. Декомпозиция MCP-инструментов Vibelog.md (manage_ac, manage_dod вместо batch task_edit) — правильный подход, расширять её.

---

## Acceptance Criteria для задачи VL-1

- [x] Таблица CLI-команд заполнена полностью (37 команд Backlog.md)
- [x] Таблица MCP-инструментов заполнена (19 в оригинале)
- [x] Таблица фич (docs, decisions, drafts, milestones) заполнена
- [x] Раздел по vibe-kanban заполнен
- [x] Приоритизация с обоснованием (25 фич, P0-P3)
- [x] Roadmap на v1.3, v1.4, v2.0
- [x] Выводы с топ и рекомендацией

---

## План на текущую версию (v1.7)

*Дополнено 2026-10-04 (VL-77). Раздел 3.3 «Roadmap» выше устарел: v1.3/v1.4 выполнены, выпущены v1.3–v1.6 (текущая версия пакета — v1.6.0, Telegram-бот). Актуальные планы — в этом разделе.*

Фокус итерации: **ядро собственного LLM-агента в headless-режиме + стабилизация Telegram-бота**. TUI откладывается на v1.8 — оркестратору она не нужна, фазы идут headless.

Легенда приоритетов: **P0** — критично, **P1** — важно, **P2** — можно отложить.

### 1. Доставить ресёрч для VL-75 и закрыть референсы (VL-77, VL-76)

- **Почему:** Фаза 2 (Plan) VL-75 декомпозирует эпик по проверенным данным (контракт stdout qwen, паттерны tool-calling loop из референсов, MCP stdio-клиент), а не по догадкам. VL-76 (клонирование референсов в refs/) — Done: 12 референсов, включая qwen-code (добавлен при доработке VL-76 по запросу Pavel); VL-77 (ресёрч) — отчёт обновлён по новым данным; этот раздел — его результат.
- **Результат:** итоговый документ ресёрча (MCP-документ doc-4 + этот roadmap); все 12 референсов задокументированы в doc-3 (§12 — qwen-code); Фаза 2 VL-75 разворачивается без повторного исследования.
- **Приоритет:** P0

### 2. Агент: LLM-клиент Cloud.ru + tool-calling loop + инструменты + MCP-клиент (VL-75)

- **Почему:** qwen тратит 935k токенов на Spec и 96k на Comment из-за тяжёлого system prompt; лёгкий агент делает только то, что нужно фазе. Cloud.ru — OpenAI-совместимый API, undici уже в зависимостях (fetch/стриминг), нативных модулей нет (Node 20, Catalina).
- **Результат:** каталог src/agent: LLM-клиент (chat/completions + tool calling + streaming), цикл «модель запрашивает инструменты → выполняем → возвращаем результат», инструменты read_file/write_file/edit/run_shell_command/grep_search/glob (plain TS), минимальный stdio-клиент к `vibelog mcp start` (без typescript-sdk: 21 инструмент, capabilities — только tools).
- **Приоритет:** P0

### 3. Headless-режим агента и интеграция с оркестратором (VL-75, AC#1)

- **Почему:** оркестратор (src/web/orchestrator.ts) спавнит бинарь с промптом шаблона и парсит parseQwenResult (src/web/qwen-result.ts) — если агент печатает тот же JSON type=result, замена qwen → vibelog-agent не требует правок оркестратора и шаблонов.
- **Результат:** `node dist/agent/cli.mjs <phase> <taskId>` печатает JSON `{type:'result', result, is_error, usage, session_id}`; переключение бинаря одной настройкой (VIBELOG_QWEN_BIN или новая); шаблоны templates/phases/phase-*.md переиспользуются без изменений; qwen остаётся фолбэком. Контракт подтверждён на исходниках qwen-code 0.24.7 (refs/qwen-code, doc-4 §10.1): JSON-режим пишет строку-массив с `type:'result'` последним элементом (JsonOutputAdapter), NDJSON-вариант — StreamJsonOutputAdapter.
- **Приоритет:** P0

### 4. Loop detection и лимиты: --max-tool-calls, --max-wall-time (VL-75, AC#2)

- **Почему:** tool-calling loop без обрыва зависает на зацикливании модели; фаза в оркестраторе должна завершаться предсказуемо — с ошибкой в результатах, а не вечным ожиданием.
- **Результат:** детект повторяющихся tool calls подряд → фаза завершается ошибкой в JSON-результатах; лимиты по числу вызовов инструментов и wall-time; оркестратор получает ошибку штатно. Прецедент лимита — `error_max_turns` у qwen-code (refs/qwen-code, doc-4 §10.1): целевой агент завершает сессию с таким result-подтипом — формат ошибки для оркестратора изучен.
- **Приоритет:** P0

### 5. Улучшение карточки задачи бота (VL-78)

- **Почему:** карточка /task в Telegram неудобна для управления фазами: кнопка старта следующей фазы мелкая, ответ на комментарий требует ручного набора команды.
- **Результат:** увеличенная кнопка «Следующая фаза» (callback-запуск фазы по статусу), кнопка «Комментарий» (callback → addComment), expand-блоки описания/AC/DoD.
- **Приоритет:** P1

### 6. Уведомления бота на события backlog (VL-36)

- **Почему:** сейчас бот уведомляет только о фазах оркестратора; изменения задач вручную или через MCP невидимы в чате. План реализации в VL-36 уже готов (fs.watch + снапшот-дифф + debounce).
- **Результат:** push-уведомления в привязанные чаты: новая задача, смена статуса, новый комментарий; дедупликация событий, retry с backoff, процесс не падает.
- **Приоритет:** P1

### Критерии завершения v1.7

- [ ] `vibelog-agent <phase> <taskId>` (headless) выполняет затратные фазы (spec, comment) через Cloud.ru + MCP vibelog и печатает JSON type=result, который parseQwenResult парсит без изменений (AC#1 VL-75).
- [ ] Loop detection и лимиты --max-tool-calls/--max-wall-time завершают фазу с ошибкой в результатах вместо зависания (AC#2 VL-75).
- [ ] Оркестратор переключается на vibelog-agent одной настройкой; шаблоны phase-*.md и контракт qwen-result.ts не изменялись; qwen доступен как фолбэк.
- [ ] pnpm build и pnpm test зелёные (регрессий нет); docs/agent.md: настройка Cloud.ru API key, запуск фаз, headless-JSON.
- [ ] VL-76, VL-77, VL-78 — Done; VL-74 (тестовый параллельный spec) снята с Review — закрыта или заархивирована.
- [ ] Релиз v1.7.0: CHANGELOG, тег, npm publish.

---

## План на следующую версию (v1.8)

*Фокус: TUI на Ink, полный переход фаз на агента, закрытие P2-хвостов таблицы 3.1. Пункты отложены осознанно: в v1.7 приоритет — корректное headless-ядро.*

### 1. TUI на Ink: стриминг токенов, карточки tool calls, счётчики (VL-75, AC#3)

- **Почему не в текущей версии:** оркестратору TUI не нужна — фазы идут headless; интерактивная оболочка нужна человеку, а сначала должно быть стабильное ядро (loop, инструменты, ошибки). Порядок «ядро → оболочка» снижает риск отладки двух слоёв сразу.
- **Зависимости от v1.7:** стабильный tool-calling loop и LLM-клиент со стримингом; TUI-паттерны из ресёрча VL-77 (refs/gemini-cli, refs/opencode, refs/qwen-code); Ink допустим без нативных модулей. Уточнение по qwen-code (доработка VL-76): официальный Qwen Code v0.24.7 использует официальный ink 7.0.3 (не форк @jrichman/ink@6.6.9, как gemini-cli) — кандидат для Vibelog; проверить совместимость с React 19 и Node 20 при реализации (doc-4 §10.4, ADR-2 proposed).
- **Результат:** интерактивный запуск `vibelog-agent <phase> <taskId>`: стриминг ответа, карточки выполняемых tool calls, счётчики токенов/времени, внятные ошибки.
- **Приоритет:** P1

### 2. Полный переход фаз оркестратора на vibelog-agent + сравнение расхода токенов (VL-75, компонент 10)

- **Почему не в текущей версии:** v1.7 ограничивается самыми затратными фазами (spec — 935k, comment — 96k у qwen); полный переход plan/code/close/prompt — после накопления опыта и метрик на реальных прогонах, иначе регрессия качества фаз не будет заметна.
- **Зависимости от v1.7:** headless-ядро стабильно, loop detection/лимиты отработаны, по прогонам накоплена статистика usage.
- **Результат:** все фазы по умолчанию идут через vibelog-agent; в docs/agent.md — таблица сравнения расхода токенов vibelog-agent vs qwen по фазам; qwen — документированный фолбэк.
- **Приоритет:** P1

### 3. Хвосты P2 таблицы 3.1: task list --watch, task edit --append-plan, task create --ref/--doc, board: milestones view

- **Почему не в текущей версии:** не блокируют работу; приоритет ниже агента. Часть оконных опций (--limit/--skip) уже реализована в v1.3–v1.4 — перед началом проверить актуальность, чтобы не дублировать.
- **Зависимости от v1.7:** прямых технических нет (независимые CLI-флаги); в ресурсах — после релиза v1.7.
- **Результат:** закрытые пункты P2 таблицы 3.1; CLI-паритет с Backlog.md по оконным опциям, ссылкам и доске с вехами.
- **Приоритет:** P2

### 4. Web UI: фильтры на kanban-доске

- **Почему не в текущей версии:** веб-интерфейс работает (v1.5–v1.6), фильтры — удобство, а не блокер; в v1.7 ресурсы сосредоточены на агенте и боте.
- **Зависимости от v1.7:** прямых нет; после стабилизации агента уточнить, не нужны ли вебу данные о фазах (usage, статус прогонов).
- **Результат:** фильтрация задач на доске по статусу, приоритету и вехе.
- **Приоритет:** P2

### 5. task attempt (optional-поле) и git-интеграция: автоименование веток из task-id

- **Почему не в текущей версии:** пункты из старого раздела v2.0; optional-поле во frontmatter не ломает совместимость с Backlog.md, но спешки нет — ни одна текущая фаза без него не обходится.
- **Зависимости от v1.7:** прямых нет; после выхода агента (v1.7–v1.8) станет понятнее, нужен ли трекинг попыток (attempt) параллельных прогонов фаз.
- **Результат:** optional-поле task attempt (история прогонов фазы); git-ветки автоименуются из task-id.
- **Приоритет:** P2

---

*Дополнение подготовлено в рамках VL-77 (Фаза Comment, 2026-10-04). Доработка 2026-10-04 (VL-77 после переоткрытия по запросу Pavel): учтены новые данные доработки VL-76 — 12-й референс qwen-code (refs/qwen-code; doc-3 §12; doc-4 §10): официальный ink 7.0.3 для TUI v1.8, прецедент `error_max_turns` для loop detection v1.7, подтверждение JSON-контракта headless на исходниках qwen-code. Открытые задачи backlog для связи пунктов: VL-36, VL-74, VL-75, VL-76, VL-77, VL-78. Ограничения учтены: Node 20+, macOS 10.15 Catalina, минимум зависимостей, без нативных модулей.*
