---
id: VL-116
title: 'Тест-харнесс: утечка VIBELOG_CWD в дочерние CLI-процессы тестов (загрязнение реального backlog)'
status: Review
assignee: []
reporter: ''
created_date: '2026-10-12 14:47'
updated_date: '2026-10-12 15:49'
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
modified_files:
  - src/agent/mcp-client.ts
  - src/agent/mcp-client.test.mjs
  - src/mcp/server.test.mjs
  - src/agent/cli.test.mjs
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент VL-113 2026-10-12: оркестратор ставит VIBELOG_CWD (главный репо) в env фазы при branch-mode; агент выполнил pnpm test внутри worktree — дочерние CLI-процессы тестов унаследовали переменную и резолвили сессии/backlog в ГЛАВНЫЙ репо: 12 ложных падений cli.test.mjs/mcp/server.test.mjs (агент диагностировал root cause и обходился env -u) + реальное загрязнение — 15 тестовых задач VL-114..VL-128 (заголовки «Задача из MCP-клиента» из mcp-client.test.mjs:68 и др.) и ~80 тестовых сессий/мета в .vibelog/agent-sessions. Всё удалено 2026-10-12.

Чинить в тест-харнессе: каждый харнесс, спавнящий CLI/MCP-сервер (llmEnv, server-тесты), убирает VIBELOG_CWD из env дочернего процесса — независимо от окружения запускающего. После фикса прогоны фаз (и ручные, и агентные) перестанут писать в реальный backlog.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 llmEnv() в cli.test.mjs удаляет VIBELOG_CWD из env дочернего CLI; аналогично для спавновых процессов в mcp/server.test.mjs и mcp-client.test.mjs
- [x] #2 pnpm test, запущенный при установленном VIBELOG_CWD в окружении (как внутри фазы branch-mode), даёт столько же результатов, сколько без него — без ложных падений и без записи в реальный backlog
- [x] #3 CHANGELOG: запись о фиксе
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 15:49
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code; fix 92a042f). Три вектора утечки env фазы в дочерние тестовые процессы закрыты: llmEnv() (cli.test.mjs) удаляет VIBELOG_CWD/VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME из env дочернего CLI; callMcp() (mcp/server.test.mjs) спавнит MCP-сервер с чистым env; McpClient (src/agent/mcp-client.ts) получил опцию env и mcp-client.test передаёт чистый env. Проверка AC#2: прогоны cli/server/mcp-client тестов с VIBELOG_CWD на throwaway-каталог (/tmp/vl116-leakcheck-*) — 46/46 зелёные, ноль задач/сессий в целевом каталоге (до фикса привели бы к записи в реальный backlog). Полный pnpm test — 834/834, fail 0. Что осталось: DoD закрывается Фазой Close; при первой возможности прогнать pnpm test ИМЕННО из живой фазы branch-mode как двойную подтверждение (агент VL-113 обходился env -u).
---
<!-- COMMENTS:END -->