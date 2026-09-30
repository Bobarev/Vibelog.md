---
id: VL-14
title: 'VL-14: Decisions — CLI decision create/list, ADR-формат (v1.4)'
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
Decisions (v1.4) — архитектурные решения (ADR) в backlog/decisions/. Оригинал: CLI decision create <title> / list (cli.ts:4899-4933). MCP у оригинала НЕТ — только CLI.

Реализация:
1. src/core/decision.mjs — модель (по образцу milestone.mjs): write/read/list, ADR-нумерация DEC-<n> (сверить с оригиналом), статусы (proposed/accepted/... — сверить с Decision в types/index.ts:203).
2. src/cli/commands/decision.mjs — runDecision: create <title> [-d description] [--status], list [--status].
3. src/cli/router.mjs — case 'decision' + help.
4. Тесты: src/cli/decision-cli.test.mjs (/tmp, spawnSync).

Примечание: глобальный search оригинала индексирует и documents/decisions (cli.ts:2167) — расширение индекса вынести в отдельную задачу после VL-11..14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CLI: decision create <title> [-c контекст] [-c решения] / list [--status accepted|...] работают; файлы в backlog/decisions/ с фронтматтером (id, title, status, date, tags)
- [ ] #2 Формат тела — ADR-секции (Context/Decision/Consequences), совместимый с оригиналом (Decision в types/index.ts:203)
- [ ] #3 Тесты CLI проходят; pnpm test зелёный
<!-- AC:END -->