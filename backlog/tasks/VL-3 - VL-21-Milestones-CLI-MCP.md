---
id: VL-3
title: 'VL-2.1: Milestones — CLI + MCP'
status: Done
assignee: []
reporter: ''
created_date: '2026-09-30 18:23'
updated_date: '2026-09-30 22:24'
due_date: ''
labels:
  - v1.3
  - milestones
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Реализовать CRUD для milestones (вех/релизов).

Файлы: backlog/milestones/<name>.md с YAML-фронтматтером (name, description, due_date, status).

CLI-команды (src/cli/commands/milestone.mjs):
- milestone add <name> [-d description] [--due-date YYYY-MM-DD]
- milestone list [--show-completed]
- milestone rename <from> <to> [--no-update-tasks]
- milestone remove <name> [--task-handling clear|keep|reassign] [--reassign-to <name>]
- milestone archive <name>

MCP-инструменты (src/mcp/tools.mjs — добавить 5):
- milestone_list
- milestone_add (required: name)
- milestone_rename (required: from, to)
- milestone_remove (required: name)
- milestone_archive (required: name)

Зарегистрировать в router.mjs, добавить в help.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 milestone add/list/rename/remove/archive работают через CLI
- [x] #2 MCP milestone_* (5 инструментов) зарегистрированы в tools.mjs и отвечают
- [x] #3 milestone remove --task-handling clear снимает milestone с задач
- [x] #4 Тесты на все команды проходят
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: Milestones (VL-3)

### Файлы для изменения/создания

1. **Создать src/core/milestone.mjs** (~80 строк)
   - readMilestone(dir, name) → объект {name, description, due_date, status}
   - writeMilestone(dir, milestone) → запись в backlog/milestones/<name>.md
   - listMilestones(backlogDir) → массив из backlog/milestones/*.md
   - milestoneFilename(name) → name с заменой пробелов на дефисы

2. **Создать src/cli/commands/milestone.mjs** (~120 строк)
   - runMilestone(subcommand, positional, flags, cwd)
   - add: записать файл, вывести подтверждение
   - list: вывести таблицу (name, due_date, status)
   - rename: переименовать файл + обновить milestone во всех задачах (если не --no-update-tasks)
   - remove: удалить файл + --task-handling clear (снять milestone с задач), keep, reassign (--reassign-to)
   - archive: перенести в backlog/completed/

3. **Обновить src/mcp/tools.mjs** (+5 инструментов)
   - milestone_list, milestone_add, milestone_rename, milestone_remove, milestone_archive
   - Добавить в listTools() и handleToolCall()
   - Использовать функции из core/milestone.mjs

4. **Обновить src/cli/router.mjs**
   - Добавить case 'milestone': → runMilestone(...)
   - Добавить в help: milestone add|list|rename|remove|archive

5. **Тесты: src/mcp/milestones.test.mjs** (~60 строк)
   - add/list/rename/remove/archive через MCP
   - remove --task-handling clear

### Порядок действий
1. core/milestone.mjs (модель данных)
2. cli/commands/milestone.mjs (CLI)
3. router.mjs регистрация
4. MCP tools.mjs
5. Тесты
6. pnpm test

### Проверки
- node --test src/mcp/milestones.test.mjs
- pnpm test (все тесты)
- node bin/vibelog.mjs milestone add v1.3 (ручной тест)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-09-30 22:24
---
Фаза 3 (Code) завершена. 4/4 AC.
Реализовано:
- src/core/milestone.mjs — модель вех (slug-имена файлов, read/write/list/rename/delete/archive). listMilestones поддерживает includeArchived — читает архивные вехи из backlog/completed/ с фильтрацией файлов задач (по id/title во фронтматтере).
- src/cli/commands/milestone.mjs — CLI add|list|rename|remove|archive + флаги --task-handling clear|keep|reassign, --reassign-to, --no-update-tasks, --show-completed.
- src/cli/router.mjs — команда milestone зарегистрирована, справка обновлена.
- src/mcp/tools.mjs — +5 инструментов milestone_list/add/rename/remove/archive (итого 16 MCP-инструментов), хендлеры в handleToolCall.
- src/cli/commands/doctor.mjs — ожидаемое число инструментов 11→16, milestone_* добавлены в mcp_tools_list.
Тесты:
- src/mcp/milestones.test.mjs (новый): MCP CRUD + task-handling clear/keep/reassign + ошибки; CLI все подкоманды + --show-completed.
- server.test.mjs, v11.test.mjs, diagnostics.test.mjs, compat-full.test.mjs — счётчики 11→16.
Проверки: pnpm lint ✓; pnpm test — 212/212 pass ✓; ручной CLI-тест в /tmp (add → list → rename с обновлением задачи → archive → list --show-completed) ✓.
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->