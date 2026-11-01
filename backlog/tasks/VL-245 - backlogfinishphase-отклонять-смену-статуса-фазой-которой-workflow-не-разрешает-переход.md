---
id: VL-245
title: 'backlog_finish_phase: отклонять смену статуса фазой, которой workflow не разрешает переход'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-10-30 02:17'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. `toolFinishPhase` (`src/mcp/tools.ts:1156`) валидирует статус только по `config.statuses` — поэтому фаза `comment` выставила Done у VL-219 (`agent-1793307529535.meta.json`: `"phase":"comment"`), а `SERVICE_PHASES` («статуса не меняют», `src/core/workflow.ts`) проверяются лишь в `isPhaseAllowed`/transient. Добавить на границе MCP проверку: фаза вызывающего (env `VIBELOG_PHASE_NAME` / мета сессии) должна быть той, что в workflow даёт переход `текущий статус + фаза → запрошенный статус` (`getStatusAfterPhase`); для служебных фаз смена статуса на workflow-статус запрещена, кроме явного «ручного» флага, доступного только CLI/веб-API. Невалидный переход — понятная ошибка в сводке (паттерн частичного применения, как у невалидного статуса), запись не выполняется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Из фазы `comment` вызов `backlog_finish_phase {status: "Done"}` отклоняется с сообщением о запрещённом переходе, статус задачи не меняется
- [ ] #2 Из close-фазы при статусе `Review` вызов `{status: "Done"}` работает как раньше (регрессии нет)
- [ ] #3 Тесты в `src/mcp/server.test.mjs`: запрет для служебной фазы, запрет перехода не из того статуса, разрешённый штатный переход
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->