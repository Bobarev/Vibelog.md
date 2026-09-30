---
id: VL-4
title: 'VL-2.2: Types — конфиг + CLI + MCP'
status: To Do
assignee: []
reporter: ''
created_date: '2026-09-30 18:23'
updated_date: '2026-09-30 18:27'
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
- [ ] #1 task create --type записывает type во frontmatter
- [ ] #2 task list --type фильтрует по типу
- [ ] #3 backlog_create_task/list_tasks/update_task принимают параметр type
- [ ] #4 Валидация type по конфигу (case-insensitive)
- [ ] #5 Round-trip с Backlog.md сохраняется
- [ ] #6 Тесты проходят
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