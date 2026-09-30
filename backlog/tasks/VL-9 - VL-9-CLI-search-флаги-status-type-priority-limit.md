---
id: VL-9
title: 'VL-9: CLI search — флаги --status/--type/--priority/--limit'
status: To Do
assignee: []
reporter: ''
created_date: '2026-09-30 23:23'
updated_date: '2026-09-30 23:23'
due_date: ''
labels: []
dependencies:
  - VL-8
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
CLI-флаги фильтров для vibelog search (поверх ядра из VL-8).

Изменения:
1. src/cli/commands/search.mjs — флаги --status, --type, --priority, --limit → фильтры в searchTasks(cwd, filters). Сохранить поведение без флагов.
2. src/cli/router.mjs — help команды search: новые флаги.

Зависимость: VL-8 (расширенное ядро searchTasks).
Файлы: src/cli/commands/search.mjs, src/cli/router.mjs, тесты CLI (search --json + флаги).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 vibelog search "query" --status/--type/--priority/--limit фильтруют результаты (каждый флаг проверен тестом)
- [ ] #2 Флаги комбинируются с query и --json; без флагов поведение не меняется
- [ ] #3 help команды search показывает новые флаги; pnpm test проходит
<!-- AC:END -->