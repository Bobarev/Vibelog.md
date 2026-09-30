---
id: VL-2
title: 'VL-2: Milestones + Types для v1.3'
status: To Do
assignee: []
reporter: ''
created_date: '2026-09-30 18:10'
updated_date: '2026-09-30 18:10'
due_date: ''
labels:
  - v1.3
  - milestones
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
Реализовать milestones (CLI + MCP) и types задач.

## Milestones
Группировка задач по версиям/релизам. Поле milestone уже есть во frontmatter.
CLI: milestone add/list/rename/remove/archive
MCP: milestone_list, milestone_add, milestone_rename, milestone_remove, milestone_archive
Файлы: backlog/milestones/<name>.md

## Types
Типы задач (bug/feature/enhancement) для фильтрации.
CLI: task create --type, task list --type, task_search --type
MCP: расширить task_create/task_list/task_search параметром type
Конфиг: types: [bug, feature, enhancement, task, chore, docs, spike]
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 milestone add/list/rename/remove/archive работают через CLI
- [ ] #2 MCP milestone_* инструменты зарегистрированы и отвечают
- [ ] #3 task create --type записывает type во frontmatter
- [ ] #4 task list --type фильтрует по типу
- [ ] #5 task_search --type фильтрует по типу
- [ ] #6 Round-trip с Backlog.md сохраняется
- [ ] #7 Тесты на все новые команды проходят
<!-- AC:END -->