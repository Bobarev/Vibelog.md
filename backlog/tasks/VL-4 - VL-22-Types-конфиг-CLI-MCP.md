---
id: VL-4
title: 'VL-2.2: Types — конфиг + CLI + MCP'
status: Done
assignee: []
reporter: ''
created_date: '2026-09-30 18:23'
updated_date: '2026-09-30 22:39'
due_date: ''
labels:
  - v1.3
  - types
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
Добавить типы задач (bug/feature/enhancement).

Конфиг: поле types: [bug, feature, enhancement, task, chore, docs, spike] в defaultConfig (src/core/config.mjs).

CLI:
- task create --type <type> — записывает type во frontmatter
- task list --type <type> — фильтр по типу
- task edit --type <type> — смена типа

MCP (расширить существующие):
- backlog_create_task: добавить параметр type (string)
- backlog_list_tasks: добавить параметр type (string)
- backlog_update_task: добавить параметр type (string)

Валидация: type входит в types из конфига (case-insensitive).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task create --type записывает type во frontmatter
- [x] #2 task list --type фильтрует по типу
- [x] #3 backlog_create_task/list_tasks/update_task принимают параметр type
- [x] #4 Валидация type по конфигу (case-insensitive)
- [x] #5 Round-trip с Backlog.md сохраняется
- [x] #6 Тесты проходят
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: Types (VL-4)

### Файлы для изменения

1. **src/core/config.mjs** — defaultConfig: добавить types: ['bug','feature','enhancement','task','chore','docs','spike']

2. **src/cli/commands/task.mjs** — 3 правки:
   - taskCreate: добавить flags.type → input.type
   - taskList: добавить фильтр flags.type → tasks.filter(t => t.type === type)
   - taskEdit: добавить flags.type → updates.type

3. **src/mcp/tools.mjs** — 3 правки:
   - backlog_create_task inputSchema: добавить type: {type:'string', description:'Тип задачи'}
   - backlog_list_tasks inputSchema: добавить type
   - backlog_update_task inputSchema: добавить type
   - toolCreateTask: передать args.type
   - toolListTasks: фильтр по type
   - toolUpdateTask: обновить type

4. **src/cli/router.mjs** — обновить help: task create/list/edit с --type

5. **Тесты** — в skills.test.mjs или новый файл:
   - task create --type записывает type
   - task list --type фильтрует
   - MCP create/list/update с type

### Порядок действий
1. config.mjs (defaultConfig)
2. task.mjs CLI (3 правки)
3. tools.mjs MCP (6 правок)
4. router.mjs help
5. Тесты
6. pnpm test

### Проверки
- pnpm test
- node -e проверка defaultConfig
- ручной тест: vibelog task create X --type bug
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-09-30 22:39
---
Фаза 3 (Code) завершена. 6/6 AC.
Реализовано:
- src/core/config.mjs: DEFAULT_TASK_TYPES (bug/feature/enhancement/task/chore/docs/spike — как в оригинале), types в defaultConfig, normalizeTaskType() — case-insensitive с возвратом канонического написания из конфига (семантика enum-валидации оригинала Backlog.md), fallback на дефолты без ключа types.
- CLI: task create/list/edit --type (валидация + ошибка при невалидном типе, задача не создаётся).
- MCP: type в схемах и хендлерах backlog_create_task / backlog_list_tasks (фильтр + поле в выводе) / backlog_update_task.
- router.mjs: help обновлён (--type в create/list/edit).
- Round-trip: type уже поддерживался taskToMarkdown/markdownToTask — проверено тестом.
Дополнительно исправлен гон в src/mcp/server.mjs: process.exit(0) на rl close обрывал буферизованный stdout-pipe и терял последний JSON-RPC ответ (воспроизводилось на tools/list с 16 инструментами). Фикс: exit в колбэке пустой write — после сброса очереди stdout. Проверено 3 изолированными прогонами.
Тесты: src/mcp/types.test.mjs (новый: конфиг/нормализация, MCP create/list/update, CLI --type, кастомный types, round-trip). pnpm test — 230/230 ✓; pnpm lint ✓; ручной CLI-тест в /tmp ✓.
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->