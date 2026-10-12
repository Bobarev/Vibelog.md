---
id: VL-116
title: 'Тест-харнесс: утечка VIBELOG_CWD в дочерние CLI-процессы тестов (загрязнение реального backlog)'
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
Инцидент VL-113 2026-10-12: оркестратор ставит VIBELOG_CWD (главный репо) в env фазы при branch-mode; агент выполнил pnpm test внутри worktree — дочерние CLI-процессы тестов унаследовали переменную и резолвили сессии/backlog в ГЛАВНЫЙ репо: 12 ложных падений cli.test.mjs/mcp/server.test.mjs (агент диагностировал root cause и обходился env -u) + реальное загрязнение — 15 тестовых задач VL-114..VL-128 (заголовки «Задача из MCP-клиента» из mcp-client.test.mjs:68 и др.) и ~80 тестовых сессий/мета в .vibelog/agent-sessions. Всё удалено 2026-10-12.

Чинить в тест-харнессе: каждый харнесс, спавнящий CLI/MCP-сервер (llmEnv, server-тесты), убирает VIBELOG_CWD из env дочернего процесса — независимо от окружения запускающего. После фикса прогоны фаз (и ручные, и агентные) перестанут писать в реальный backlog.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 llmEnv() в cli.test.mjs удаляет VIBELOG_CWD из env дочернего CLI; аналогично для спавновых процессов в mcp/server.test.mjs и mcp-client.test.mjs
- [ ] #2 pnpm test, запущенный при установленном VIBELOG_CWD в окружении (как внутри фазы branch-mode), даёт столько же результатов, сколько без него — без ложных падений и без записи в реальный backlog
- [ ] #3 CHANGELOG: запись о фиксе
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->