---
id: VL-286
title: 'Устранить причину обхода: тесты наследуют VIBELOG_* env агентской сессии — снять зависимость от env -u'
status: To Do
assignee: []
reporter: ''
created_date: '2026-11-01 22:08'
updated_date: '2026-11-01 22:08'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons:
  - lesson-88
  - lesson-113
  - lesson-120
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Причина обхода (техдолг из корпуса lessons, VL-281)

Три урока описывают один и тот же обход, а не правило: тесты, спавнящие CLI/MCP, наследуют переменные агентской сессии через `{ ...process.env }`, из-за чего прогон внутри фазы падает не по вине кода. Обход — вручную снимать переменные (`env -u …`) перед каждым прогоном; пока причина жива, корпус lessons легализует ритуал как норму.

Уроки-источники (связаны двусторонне):

- `lesson-113` — MCP-тесты: `VIBELOG_PHASE_NAME`/`VIBELOG_RUN_PHASE`/`VIBELOG_CWD`/`VIBELOG_SESSION_ID` попадают в мету сессии, падает «fallback: meta без usage → jsonl» в `src/mcp/server.test.mjs`.
- `lesson-120` — `VIBELOG_RUN_PHASE=code` из окружения рана ломает тот же тест: он ожидает фазу `close`.
- `lesson-88` — `VIBELOG_CWD` на главный репозиторий уводит CLI-тесты (`config-cli`, `create-flags`, `search-cli`, `batch-checklist`) от их `mkdtemp`-каталога.

## Что наблюдается сейчас

- `src/mcp/server.test.mjs` уже чистит env вручную в `startServer()` (VL-116/VL-259) — то есть в одном файле причина устранена локально.
- `src/cli/config-cli.test.mjs:42`, `create-flags.test.mjs:44`, `search-cli.test.mjs:44`, `batch-checklist.test.mjs:46` спавнят CLI с `env: { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' }` — `VIBELOG_CWD` и фазовые переменные наследуются.

## Ожидаемый результат

- Общий хелпер для тестов, спавнящих CLI/MCP: чистит `VIBELOG_CWD`, `VIBELOG_PHASE_*`, `VIBELOG_RUN_*`, `VIBELOG_SESSION_ID` в одном месте; все CLI/MCP-тесты используют его вместо ручного `delete`.
- Полный `pnpm test` в агентской сессии зелёный **без** `env -u` префикса — проверено прогоном из фазы Code.
- После этого `lesson-88`, `lesson-113`, `lesson-120` переводятся в `outdated`/`superseded` (или переписываются в правило «тестовый хелпер сам чистит env»), ссылки «устранение» в их телах закрываются.

## Границы

- Правки только в тестах и, при необходимости, в тестовом хелпере `src/test-setup.mjs`; продуктовый код (`VIBELOG_CWD` как фича для фоновых фаз) не трогать.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Общий тестовый хелпер чистит VIBELOG_CWD/VIBELOG_PHASE_*/VIBELOG_RUN_*/VIBELOG_SESSION_ID при спавне CLI/MCP; используется в config-cli, create-flags, search-cli, batch-checklist, mcp/server тестах
- [ ] #2 Полный pnpm test внутри агентской фазы зелёный без префикса env -u (проверено прогоном из фазы)
- [ ] #3 Уроки lesson-88, lesson-113, lesson-120 переведены в outdated/superseded или переписаны в правило про хелпер, ссылки «устранение: VL-286» закрыты
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->