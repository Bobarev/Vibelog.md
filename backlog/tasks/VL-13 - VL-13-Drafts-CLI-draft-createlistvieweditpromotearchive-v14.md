---
id: VL-13
title: 'VL-13: Drafts — CLI draft create/list/view/edit/promote/archive (v1.4)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 00:27'
updated_date: '2026-10-01 00:27'
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
Drafts (v1.4) — черновики задач для быстрого захвата идей до формализации. Оригинал: CLI draft list/create/edit/archive/promote/view (cli.ts:4064-4286). MCP у оригинала НЕТ — только CLI (совместимость).

Реализация:
1. src/core/draft.mjs — модель (по образцу milestone.mjs): write/read/list/delete, slug-имена, id D-<n> или по счёту (сверить формат id с оригиналом cli.ts:4121 draft create).
2. src/cli/commands/draft.mjs — runDraft: create <title> [-d desc], list, view <id>, edit <id> [--title/-d], archive <id>, promote <id>.
3. promote: черновик → createTaskFile (title/description) + перенос черновика в backlog/completed/ или удаление (сверить с оригиналом).
4. src/cli/router.mjs — case 'draft' + help.
5. Тесты: src/cli/draft-cli.test.mjs (/tmp, spawnSync): цикл create→list→view→edit→promote (задача появилась в tasks/)→archive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CLI: draft create <title> [-d desc] / list / view <id> / edit <id> / archive <id> / promote <id> работают; файлы в backlog/drafts/ с фронтматтером (id, title, description, created_date)
- [ ] #2 promote <id> создаёт полноценную задачу в backlog/tasks/ (префикс конфига) и архивирует черновик
- [ ] #3 Тесты CLI проходят; pnpm test зелёный
<!-- AC:END -->