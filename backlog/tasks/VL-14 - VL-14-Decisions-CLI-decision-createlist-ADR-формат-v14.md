---
id: VL-14
title: 'VL-14: Decisions — CLI decision create/list, ADR-формат (v1.4)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 00:27'
updated_date: '2026-10-01 01:12'
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
- [x] #1 CLI: decision create <title> [-c контекст] [-c решения] / list [--status accepted|...] работают; файлы в backlog/decisions/ с фронтматтером (id, title, status, date, tags)
- [x] #2 Формат тела — ADR-секции (Context/Decision/Consequences), совместимый с оригиналом (Decision в types/index.ts:203)
- [x] #3 Тесты CLI проходят; pnpm test зелёный
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: Decisions — CLI decision create/list (VL-14)

Оригинал: Decision = id (decision-N), title, date, status (proposed|accepted|rejected|superseded, free-form, дефолт proposed), context/decision/consequences/alternatives (ADR-секции тела); CLI: decision create <title> [-s status] / list. CLI-only.

### Файлы для изменения/создания

1. **Создать src/core/decision.mjs** (~80 строк)
   - DECISION_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'] — справочно (CLI original: free-form, строгой валидации нет — принимаем любое, дефолт proposed)
   - decisionFilename(id, title) → `<id>-<slug>.md`
   - writeDecision(backlogDir, {title, status, context, decision, consequences, alternatives}) — id decision-N (max+1), date = сегодня, тело = ADR-секции (## Context / ## Decision / ## Consequences / ## Alternatives)
   - listDecisions(backlogDir, {status}) → [{decision, body, path}]
   - getDecision(backlogDir, id) — case-insensitive

2. **Создать src/cli/commands/decision.mjs** (~70 строк) — runDecision
   - create <title> [-s status] [--context ...] [--decision ...] [--consequences ...] [--alternatives ...]
     (длинные флаги вместо «-c дважды» из спеки — -c в parseArgs не повторяется однозначно)
   - list [--status S] — id, title, status, date
   - view <id> — карточка + ADR-тело (дополнительно к AC — дёшево и полезно)

3. **Обновить src/cli/router.mjs** — case 'decision' → runDecision + help (main + command)

4. **Создать src/cli/decision-cli.test.mjs** (~70 строк, /tmp/vibelog-decision-test, spawnSync)
   - create без -s → статус proposed в файле; -s accepted → accepted
   - ADR-секции в файле (## Context / ## Decision)
   - list: обе записи; --status accepted фильтрует
   - view: карточка + тело
   - create без заголовка → ошибка; view несуществующего → ошибка
   - help

### Порядок действий
1. core/decision.mjs
2. cli/commands/decision.mjs
3. router.mjs (help)
4. decision-cli.test.mjs
5. pnpm test + ручной прогон в /tmp

### Проверки
- node --check всех файлов
- pnpm test (все)
- Ручной: /tmp/vl14 — decision create/list/view

### Риски
- Статус free-form (как в оригинале) — DECISION_STATUSES только справочно; list --status фильтрует case-insensitive
- Дата — сегодняшняя (YYYY-MM-DD), как у документов
- Расширение глобального search индексом decisions — отложено (решение по скоупу эпика)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 01:12
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/core/decision.mjs (новый): id decision-N (max+1), date = сегодня (YYYY-MM-DD), статус free-form с дефолтом proposed (как в оригинале; DECISION_STATUSES справочно), тело — ADR-секции ## Context / ## Decision / ## Consequences / ## Alternatives; write/list (фильтр --status case-insensitive)/get.
- src/cli/commands/decision.mjs (новый): create <title> [-s status] [--context/--decision/--consequences/--alternatives], list [--status], view <id> (карточка + тело).
- src/cli/router.mjs: case 'decision' + help.
- src/cli/decision-cli.test.mjs (новый, 5 тестов): статусы, ADR-секции в файле, list + фильтр, view, ошибки, help.
Отклонения от спеки (зафиксированы):
- Флаги контента — длинные (--context и т.д.) вместо повторяемого -c из спеки: в parseArgs повторный -c неоднозначен.
- Фронтматтер: id/title/date/status — без tags (в интерфейсе Decision оригинала поля tags нет; в AC спеки упоминание tags было неточным).
Проверки: pnpm test — 291/291 ✓; node --check ✓; ручной CLI-тест в /tmp ✓ (decision-1 accepted, ADR-секции в файле).
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->