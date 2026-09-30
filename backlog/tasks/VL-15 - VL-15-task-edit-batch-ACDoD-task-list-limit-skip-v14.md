---
id: VL-15
title: 'VL-15: task edit batch AC/DoD + task list --limit/--skip (v1.4)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 00:28'
updated_date: '2026-10-01 00:28'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: low
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Мелкие пункты v1.4-раздела ресёрча (строки 361-362):

1. task edit: batch AC/DoD — оригинальный флаг task_edit acceptanceCriteriaCheck: [1,2,3] (MCP) + CLI --check-ac/--check-dod с несколькими индексами через запятую (сейчас поддерживается один индекс). Проверить поддержку массива в backlog_manage_ac/mcp + CLI args.
2. task list: --limit N, --skip N, --max-count (алиас limit?) — обрезка после фильтрации/сортировки.
--watch (cli.ts watch-json.ts) — интерактивный режим, вне скоупа: вынести в v1.5 или отдельную задачу по решению пользователя.

Файлы: src/cli/commands/task.mjs, src/mcp/tools.mjs (если массив индексов), router.mjs help, тесты.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 task edit --check-ac 1,2,3 / --check-dod 1,2 (через запятую) отмечает несколько критериев за вызов
- [ ] #2 task list --limit N / --skip N ограничивают выдачу (комбинируются с фильтрами/sort)
- [ ] #3 --watch НЕ реализуется в этой задаче (интерактивный — отдельное решение); pnpm test проходит
<!-- AC:END -->