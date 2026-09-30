---
id: VL-17
title: 'VL-17: task create --project/--parent/--ordinal/--final-summary + MCP-паритет'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 01:32'
updated_date: '2026-10-01 01:41'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Простые поля модели в CLI create + паритет MCP create с оригиналом (P2 из ресёрча).

Поля уже есть в createTask (project, ordinal, finalSummary, parent_task_id) — добавляются только флаги/параметры.

Реализация:
1. src/cli/commands/task.mjs — taskCreate: --project, --parent (с валидацией существования через getTask — несуществующий → printError, выход), --ordinal (Number, валидация), --final-summary.
2. src/mcp/tools.mjs — схема backlog_create_task: + ordinal (number), + finalSummary (string maxLength 20000 — как оригинал), + project (string); toolCreateTask передаёт поля.
3. src/cli/router.mjs: help create — новые флаги.
4. Тесты: CLI round-trip каждого флага; --parent ошибка; MCP create с новыми полями.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task create --project/--parent/--ordinal/--final-summary записывают соответствующие поля frontmatter (round-trip)
- [x] #2 --parent валидируется: несуществующий id → ошибка, задача не создаётся
- [x] #3 MCP backlog_create_task принимает ordinal/finalSummary/project (как оригинал); pnpm test зелёный
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: create --project/--parent/--ordinal/--final-summary + MCP-паритет (VL-17)

Поля модели уже есть в createTask — добавляются флаги/параметры.

1. **src/cli/commands/task.mjs — taskCreate**:
   - --project (строка)
   - --parent: getTask(cwd, parent) → нет задачи → printError + выход (валидация существования)
   - --ordinal: Number + валидация (целое ≥ 0)
   - --final-summary (строка)
2. **src/mcp/tools.mjs — схема backlog_create_task**: + ordinal (number), finalSummary (string maxLength 20000 — как оригинал), project (string); toolCreateTask передаёт поля.
3. **src/cli/router.mjs — help create**: новые флаги.
4. **Тесты** — в src/cli/create-flags.test.mjs: round-trip каждого флага (view --json); --parent несуществующий → ошибка; MCP create с ordinal/finalSummary/project.

Риски: --parent валидация гоняется с getTask до createTaskFile; ordinal — числовая валидация как у --limit (VL-15 паттерн).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 01:41
---
Фаза 3 завершена. 3/3 AC.
- src/cli/commands/task.mjs: taskCreate — --project, --parent (валидация существования через getTask), --ordinal (целое ≥ 0), --final-summary.
- src/mcp/tools.mjs: схема backlog_create_task + ordinal (number), finalSummary (string maxLength 20000 — как оригинал), project; toolCreateTask передаёт поля (MCP-паритет с оригинальным task_create).
- src/cli/router.mjs: help create — новые флаги.
- Тесты: src/cli/create-flags.test.mjs (round-trip каждого флага, ошибка --parent, MCP-поля).
Проверки: pnpm test 306/306 ✓; ручной прогон ✓ (project: web, ordinal: 5 во view --json).
---
<!-- COMMENTS:END -->