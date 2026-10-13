---
id: VL-138
title: 'MCP backlog_finish_phase: завершение фазы одним вызовом — статус + отчёт + checks + modifiedFiles'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-13 10:57'
updated_date: '2026-10-13 10:57'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Профиль сессий code: завершение «бумажной» части фазы = backlog_add_comment (1.2) + backlog_update_status (1.0) + backlog_update_task modifiedFiles (4.3) + manage_ac/dod checks (5.6) — до ~10 ходов на операции с одной задачей. Один комбинированный инструмент схлопывает их в 1-2 вызова.

Решение: новый MCP-инструмент backlog_finish_phase {id, status?, comment?, modifiedFiles?, acChecks?, dodChecks?} — атомарно: валидация статуса по конфигу, добавление отчётного комментария, запись modifiedFiles, батч-отметка пунктов AC/DoD (индексы — массивы, как в manage_ac после VL-120). Результат — сводка всех действий (для отчёта агента). Частичные ошибки: невалидный статус или индекс — понятное сообщение, остальные поля применяются (или атомарно — решить при Фазе 2; безопаснее атомарно с явной ошибкой).

Внимание: чек-лист добавления MCP-инструмента (проектная память) — шесть мест: doctor.ts (константа и список имён), diagnostics.test, compat-full.test, server.test (длина tools/list), v11.test, README-пример (21 → 22).

Экономия по профилю: code −4..−6 ходов, spec/close −2..−3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/mcp/tools.ts: backlog_finish_phase {id, status?, comment?, modifiedFiles?, acChecks?: (number|string)[], dodChecks?: (number|string)[]} — все поля опциональны кроме id; статус валидируется по конфигу; checks батчом; результат — сводка «статус X, отчёт добавлен, отмечено AC: N, DoD: M, файлов: K»; частичные ошибки не роняют вызов (чёткие сообщения)
- [ ] #2 чек-лист MCP-tool-count (память): doctor.ts (expected = 22 + имя в списке), diagnostics.test.mjs, compat-full.test.mjs, server.test.mjs (длина tools/list), v11.test.mjs, README-пример doctor
- [ ] #3 server.test.mjs/mcp-client.test.mjs: кейсы — только status+comment; checks массивом; modifiedFiles; невалидный статус; вызов без обязательных полей кроме id
- [ ] #4 шаблоны phase-1/2/3/close/close-worktree: цепочки «add_comment → update_status → update_task(modifiedFiles)» заменены на один finish_phase (списки check по-прежнему через manage_ac/dod до VL-135-all или включаются в acChecks)
- [ ] #5 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->