---
id: VL-117
title: 'Промпт vb: backlog (задачи/документы) правится только через MCP, не edit/write в worktree-копию'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 14:47'
updated_date: '2026-10-12 14:47'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент VL-113 2026-10-12: агент обновлял backlog/docs/doc-10 через edit-инструмент, который резолвит пути от cwd = worktree — правка легла в worktree-КОПИЮ backlog (git status worktree: M backlog/docs/doc-10). Агент сам заметил дилемму («куда попала правка doc-10 — worktree vs основной репо»), потратил ~5 ходов на выяснение, но обхода не нашёл: правка останется в worktree и потеряется при worktree remove, а MCP-инструменты пишут backlog в ГЛАВНЫЙ репо через VIBELOG_CWD. Рабочий путь обновления backlog-документов — MCP document_update; рабочий путь задач — backlog_update_task и т.п.

Фикс — промптовый: явное правило в templates/agent-prompt.md (базовая часть системного промпта vb, читается из md после VL-109). Альтернатива (вне рамок задачи): guard в tools.ts, запрещающий edit/write в backlog/ при установленном VIBELOG_CWD.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 templates/agent-prompt.md: правило «файлы backlog/ (задачи, документы, конфиги) правь ТОЛЬКО через MCP-инструменты Vibelog; edit/write_file в backlog-копию не использовать — правка попадает не в то хранилище и теряется при worktree remove»
- [ ] #2 src/agent/system-prompt.test.mjs: тест проверяет наличие правила в собранном системном промпте
- [ ] #3 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->