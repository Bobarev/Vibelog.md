---
id: VL-245
title: 'backlog_finish_phase: валидировать смену статуса по фазе workflow'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-11-01 16:55'
due_date: ''
labels:
  - core
  - mcp
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow.ts
  - src/core/phase-transient.ts
  - src/mcp/tools.ts
  - src/core/workflow.test.mjs
  - src/core/phase-transient.test.mjs
  - src/mcp/server.test.mjs
  - README.md
  - CHANGELOG.md
  - backlog/docs/doc-8-MCP-справочник-Vibelogmd.md
lessons:
  - lesson-10
  - lesson-102
  - lesson-105
  - lesson-113
  - lesson-13
  - lesson-30
  - lesson-32
  - lesson-34
  - lesson-35
  - lesson-39
  - lesson-40
  - lesson-58
  - lesson-63
  - lesson-92
  - lesson-94
  - lesson-96
  - lesson-135
token_usage:
  input: 10574070
  output: 250217
  cache: 9996288
  total: 10824287
  requests: 125
  duration_ms: 915930
  reasoning: 211752
  by_phase:
    spec:
      input: 82576
      output: 2124
      cache: 76544
      requests: 3
    plan:
      input: 2504402
      output: 111705
      cache: 2308096
      requests: 33
    code:
      input: 6972278
      output: 129184
      cache: 6681344
      requests: 66
    close:
      input: 1014814
      output: 7204
      cache: 930304
      requests: 23
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. `toolFinishPhase` (`src/mcp/tools.ts:1156`) валидирует статус только по `config.statuses` — поэтому фаза `comment` выставила Done у VL-219 (`agent-1793307529535.meta.json`: `"phase":"comment"`), а `SERVICE_PHASES` («статуса не меняют», `src/core/workflow.ts`) проверяются лишь в `isPhaseAllowed`/transient. Добавить на границе MCP проверку: фаза вызывающего (env `VIBELOG_PHASE_NAME` / мета сессии) должна быть той, что в workflow даёт переход `текущий статус + фаза → запрошенный статус` (`getStatusAfterPhase`); для служебных фаз смена статуса на workflow-статус запрещена, кроме явного «ручного» флага, доступного только CLI/веб-API. Невалидный переход — понятная ошибка в сводке (паттерн частичного применения, как у невалидного статуса), запись не выполняется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Из фазы `comment` вызов `backlog_finish_phase {status: "Done"}` отклоняется с понятным сообщением о запрещённом переходе; статус задачи не меняется и запись не выполняется
- [x] #2 Из фазы close при текущем статусе Review вызов `{status: "Done"}` работает как раньше (регрессий нет)
- [x] #3 Тесты в `src/mcp/server.test.mjs` покрывают: запрет для служебной фазы, запрет перехода не из того статуса, разрешённый штатный переход
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Реализация: валидация смены статуса по фазе workflow на границе MCP

Тип: bug, обычная задача — отдельные задачи/блокеры не нужны.

### Решение (архитектурные выводы)

1. **Точка врезки — `toolFinishPhase` (`src/mcp/tools.ts:1525`), блок валидации статуса (стр. 1583–1592).** Проверка добавляется в ветку `else` (статус валиден по `config.statuses`), паттерн частичного применения: невалидный переход → строка в `errors[]`, поле `status` не попадает в `updates`, остальные поля (comment/AC/DoD/modifiedFiles) применяются. Это ровно «как у невалидного статуса» (стр. 1586–1589), не `isError` — иначе модель зациклится (lesson-92). В существующем тесте «невалидный статус» зафиксировано это же чтение AC1 («запись не выполняется» = не пишется невалидный статус, сводка сообщает ошибку).
2. **Фаза вызывающего резолвится только из доверенных источников**, `args.phase` для guard НЕ используется (иначе модель сама себе выписывает разрешение, передав `phase: "close"`). Порядок: `VIBELOG_RUN_PHASE` → `VIBELOG_PHASE_NAME` (кроме служебного `prompt`, VL-259) → `meta.lastRunPhase` → `meta.phase` (мета сессии из `agentSessionsDir(process.env.VIBELOG_CWD ?? cwd)`, `loadSessionMetaSync` уже импортирован). Существующий резолвер фазы для `token_usage`/`by_phase` НЕ трогаем (VL-198/251/253/259) — в guard будет свой мини-резолвер `resolveGuardPhase(cwd)` (~8 строк) ради нулевого риска для учёта токенов.
3. **Фаза не резолвится вообще** (нет env, нет меты) → fail-open: работают прежние правила (`config.statuses`). Это сохраняет текущее поведение десятков тестов `server.test.mjs`, где `VIBELOG_PHASE_NAME` вырезан, и не ломает ручные вызовы MCP из других клиентов.
4. **Транзиентный In Progress — ключевая тонкость.** Во время фазы статус задачи временно `In Progress` (VL-196, `markPhaseStarted`), а агент передаёт `produces_status`, посчитанный от ИСХОДНОГО статуса. Поэтому эффективный статус для проверки берётся из кэша `.vibelog/phase-in-progress.json`: если есть запись по задаче и её `phase` совпадает с резолвнутой фазой — берём `prevStatus`; иначе — `task.status`. Инвариант модуля («запись в кэше ⇔ In Progress») задокументирован в `src/core/phase-transient.ts:24-30`, так что ветка надёжна. Без этой ветки ломались бы все штатные раны code/plan/close, идущие под транзиентом — главный риск задачи.
5. **Ручного флага `manualStatus` НЕ добавляем.** «Ручные» пути (CLI `vibelog task edit --status` → `core/store`, веб `PATCH /api/tasks/:id` → `canMoveTo` в `src/web/api.ts:637`) работают мимо MCP и guard не проходят. Флаг в схеме MCP был бы доступен и агенту, т.е. дырой. Решение фиксирую в README; при необходимости флаг добавляется позже как `HandleToolCallOpts.manual` (веб/бот), одна строка.
6. **`backlog_update_status` не закрываем.** Фаза comment по шаблону (`templates/phases/phase-comment.md:28`) штатно «переоткрывает» задачу через `update_status` — это легальный путь, а не инцидент. Вне скоупа (в AC его нет), фиксирую как осознанный non-goal.

### Файлы и конкретные места

| Файл | Что делаем |
| --- | --- |
| `src/core/workflow.ts` | Новый экспорт `phaseStatusTransitionError(workflow, currentStatus, phase, requestedStatus): string \| null` (рядом с `getStatusAfterPhase`, ~стр. 222–232). Логика: `SERVICE_PHASES.includes(phase)` → понятная ошибка-запрет; иначе `getStatusAfterPhase(...) === requestedStatus` → `null`, иначе ошибка с фактическим `produces_status`. Сообщения на русском, с указанием фазы, обоих статусов и следующего шага (lesson-92). Текст без «сходи и проверь»-мусора. |
| `src/core/phase-transient.ts` | Новый экспорт `getPhaseTransientStatus(cwd, taskKey, phase): string \| null` — `readCache(cwd)[taskKey.toUpperCase()]`, вернуть `prevStatus` только если `entry.phase === phase`. Fail-open (кэш битый/нет → `null`), как весь модуль. Разместить рядом с `markPhaseAborted` (после стр. 230). |
| `src/mcp/tools.ts` | (а) импорт `getWorkflowForTask` из `../core/workflow.js` и `getPhaseTransientStatus` из `../core/phase-transient.js` (стр. 44–46, туда же, где `markPhaseAborted`); (б) локальный `resolveGuardPhase(cwd): string \| null` перед `toolFinishPhase` (стр. ~1520); (в) в блоке валидации статуса (стр. 1583–1592): при валидном по конфигу статусе и непустой фазе — `effectiveStatus = getPhaseTransientStatus(cwd, id, phase) ?? task.status`, `workflow = getWorkflowForTask(cwd, task)`, ошибка → `errors.push(...)`, иначе `updates.status`/`statusPart`; (г) в `description` инструмента (стр. 438–448) добавить 1–2 предложения о новом правиле (lesson-94/102: поведение описываем в `description`, новых required-полей не вводим — схема не меняется, `required: ['id','comment']` остаётся). |
| `src/core/workflow.test.mjs` | Unit-тесты новой pure-функции (без fs): служебная фаза (`comment/prompt/analyze/resume`) → ошибка-запрет; `close` из `To Do` → ошибка; `close` из `Review` → `null` (разрешён); `code` из `Review` → `Review` (fix-цикл) → `null`. |
| `src/core/phase-transient.test.mjs` | Кейсы `getPhaseTransientStatus`: запись с совпадающей фазой → `prevStatus`; фаза не совпала → `null`; записи нет/битый кэш → `null`. |
| `src/mcp/server.test.mjs` | Новый `describe('VL-245 — защита перехода по фазе workflow')` в КОНЕЦ файла (чтобы не задеть общую фикстуру): в своём `beforeAll` дописывает `backlog/config.yml` со статусами `['To Do','In Progress','Spec','Planned','Review','Done']` (в общем `setup()` набор урезан — стр. 24), использует существующий хелпер `callMcpWithEnv` (стр. 128–165) — он спавнит отдельный сервер с нужным env и уже срезает унаследованные `VIBELOG_*`. Кейсы: (1) `VIBELOG_PHASE_NAME: 'comment'` + `{status:'Done'}` → не `isError`, в сводке есть «Запрещён…переход»/«служебная», `view_task` → статус `To Do`, comment применён; (2) `VIBELOG_RUN_PHASE:'close'` при `To Do` + `{status:'Done'}` → ошибка перехода, статус `To Do`; (3) штатный: `backlog_update_status` → `Review`, затем `VIBELOG_RUN_PHASE:'close'` + `{status:'Done'}` → успех, в файле `Done` (AC2-регрессия); (4) транзиент: записать `.vibelog/phase-in-progress.json` `{ "MCP-N": {prevStatus:'Review', phase:'close', startedAt} }`, статус задачи `In Progress`, фаза `close`, `{status:'Done'}` → разрешено; (5) без env фазы (основной `callMcp`) статус по конфигу применяется как раньше — регресс-ловушка на fail-open. Все вызовы — через `env -u`-чистый процесс (lesson-113). |
| `README.md` | Раздел «Контракт `backlog_finish_phase`» (стр. 677–700): абзац о валидации перехода по фазе workflow (`VIBELOG_RUN_PHASE`/`VIBELOG_PHASE_NAME`/мета), запрете служебных фаз, fail-open при нерезолвимой фазе, отсутствии ручного флага в MCP (ручные пути — CLI/веб-API). |
| `backlog/docs/doc-8-…MCP-справочник….md`, `CHANGELOG.md` | Правки описания `backlog_finish_phase` и запись CHANGELOG — в фазе Close (VL-63: большие backlog/docs не тащим в Code). |

### Порядок работ (фаза Code)

1. `src/core/workflow.ts` — pure-функция + JSDoc (русский, «почему»).
2. `src/core/workflow.test.mjs` — unit-кейсы (быстрый цикл без сборки при уже собранном `dist/`).
3. `src/core/phase-transient.ts` — `getPhaseTransientStatus` + тест в `phase-transient.test.mjs`.
4. `src/mcp/tools.ts` — импорты, `resolveGuardPhase`, guard в `toolFinishPhase`, описание инструмента.
5. `src/mcp/server.test.mjs` — новый describe с 5 кейсами.
6. `README.md` — абзац контракта.
7. `pnpm build && pnpm test` (полный прогон обязателен для DoD «Тесты проходят»).

### Как проверять

```
pnpm build && npx vitest run src/mcp/server.test.mjs src/core/workflow.test.mjs src/core/phase-transient.test.mjs   # точечно (lesson-113: env -u VIBELOG_*)
pnpm build && pnpm test                                                                                            # полный прогон (DoD)
```
Ручная проверка сценария инцидента: `VIBELOG_PHASE_NAME=comment node bin/vibelog.mjs mcp start` + `tools/call backlog_finish_phase {id, status:"Done"}` на задаче в `To Do` → в сводке ошибка запрета, файл задачи не изменился. И штатный: `VIBELOG_RUN_PHASE=close` на задаче в `Review` → `status: "Done"` записан.

### Риски и их закрытие

1. **Транзиент In Progress (высокий):** без ветки `prevStatus` из кэша отклонились бы все штатные раны (`In Progress + plan → Planned`). Закрытие: `getPhaseTransientStatus` + кейс 4 в `server.test.mjs`; инвариант «кэш ⇔ In Progress» — `src/core/phase-transient.ts:24-30`.
2. **Расширение фикстуры `server.test.mjs` (средний):** добавление `Spec/Planned/Review` в общий `setup()` (стр. 24) задело бы все тесты файла — правим конфиг только в `beforeAll` нового describe в конце файла.
3. **Подмена фазы через `args.phase` (средний):** guard резолвит фазу только из env/меты; `args.phase` продолжает жить только в `token_usage`/`by_phase` (VL-259) — регрессий учёта нет.
4. **Кастомные workflow/статусы (средний):** проверяем по `getWorkflowForTask(cwd, task)` (а не по `DEFAULT_WORKFLOW`), поэтому `task_workflows`/`workflows` из `settings.json` уважаются; кастомная фаза, отсутствующая в переходах, для смены статуса будет отклонена — это осознанно (фаза без перехода статус не двигает), фиксируем в README.
5. **Ложный отказ при кастомном статусе вне workflow (`Blocked` и пр.) (низкий):** из такого статуса `isPhaseAllowed` не даёт запустить фазу, поэтому транзиента там и не будет; при нерезолвимой фазе поведение прежнее (fail-open).
6. **Форма ошибки (низкий):** частичное применение вместо `isError` — по описанию задачи и по прецеденту невалидного статуса. Если ревью прочтёт AC1 как «полный no-op записи», правка — одна строка: перенести проверку в `hardErrors` (тогда `isError`, как `already_finished`); выношу решение на ревью, в коде — вариант с частичным применением.
7. **Параллельные процессы/кэш (низкий):** чтение `.vibelog/phase-in-progress.json` идёт через fail-open `readCache`; гонка «кэш прочитан в момент удаления» безопасна (→ `null` → проверка от физического статуса).

### DoD-вклад

- Тесты: новые unit-кейсы + 5 интеграционных в `src/mcp/server.test.mjs`; полный `pnpm test` в конце фазы.
- Документация: README-абзац в Code, doc-8 и CHANGELOG — в Close.
- Регрессии: fail-open без резолвимой фазы + кейс 5 в тестах; существующие тесты `server.test.mjs`/`phase-transient.test.mjs`/`workflow.test.mjs` не правятся (кроме новых кейсов).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 16:16
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «backlog_finish_phase: валидировать смену статуса по фазе workflow» (был длиннее 80 символов). Тип: bug. Масштаб: task. Приоритет: Medium. Уточнено: цель — на границе MCP-инструмента `backlog_finish_phase` отклонять смену статуса, если фаза вызывающего (env `VIBELOG_PHASE_NAME` / мета сессии) не даёт в workflow перехода `текущий статус + фаза → запрошенный статус` (`getStatusAfterPhase`); для служебных фаз (`SERVICE_PHASES`) смена статуса на workflow-статус запрещена, кроме явного «ручного» флага, доступного только CLI/веб-API. Невалидный переход — понятная ошибка в сводке (паттерн частичного применения, как у невалидного статуса), без записи. Критерии приёмки переформулированы в 3 проверяемые пункта (в т.ч. регрессия close+Review → Done и тесты в `src/mcp/server.test.mjs`). Labels: core, mcp. References: нет. Вопросов нет.
---
author: @agent
created: 2026-11-01 16:32
---
Фаза 2 (Plan) выполнена. Тип: bug, обычная задача — план записан в саму задачу, дочерние задачи/блокеры не нужны.
Изучено: `src/mcp/tools.ts` (toolFinishPhase 1525–1795: hardErrors VL-251, блок валидации статуса 1583–1592, резолвер фазы для token_usage/by_phase 1676–1782, описание инструмента 438–448), `src/core/workflow.ts` (Transition/Workflow, DEFAULT_WORKFLOW, SERVICE_PHASES, getStatusAfterPhase, isPhaseAllowed, canMoveTo), `src/core/phase-transient.ts` (markPhaseStarted/finalizePhaseStatus/markPhaseAborted, инвариант «кэш ⇔ In Progress»), `src/mcp/server.test.mjs` (фикстура setup() со статусами To Do/In Progress/Done, хелпер callMcpWithEnv, describe VL-138/198/251), `src/web/api.ts:637` (canMoveTo), `src/web/orchestrator.ts:820-940` (spawnEnv, VIBELOG_RUN_PHASE/VIBELOG_PHASE_NAME, markPhaseStarted), `templates/phases/phase-comment.md:28` (штатный update_status как путь переоткрытия), README 677–700 (контракт finish_phase).
План: 6 файлов изменений + 1 документация — `src/core/workflow.ts` (новая pure-функция `phaseStatusTransitionError(workflow, currentStatus, phase, requestedStatus): string|null`), `src/core/phase-transient.ts` (`getPhaseTransientStatus(cwd, taskKey, phase)` — prevStatus из кэша при совпадении фазы), `src/mcp/tools.ts` (импорты, локальный `resolveGuardPhase(cwd)`, guard в блоке валидации статуса, абзац в description), `src/core/workflow.test.mjs`, `src/core/phase-transient.test.mjs`, `src/mcp/server.test.mjs` (новый describe в конце файла: служебная фаза comment + Done → отказ; close из To Do + Done → отказ; регрессия Review→close→Done; транзиент In Progress + prevStatus Review → разрешено; без env фазы — fail-open), `README.md`; doc-8/CHANGELOG — в Close.
Ключевые решения: (1) врезка в `toolFinishPhase` веткой `errors[]` — паттерн частичного применения как у невалидного статуса, не isError (lesson-92); (2) фаза guard резолвится только из `VIBELOG_RUN_PHASE` → `VIBELOG_PHASE_NAME` (кроме prompt) → `meta.lastRunPhase` → `meta.phase`, `args.phase` для разрешения НЕ используется (иначе модель сама себе выписывает разрешение); (3) эффективный статус — `getPhaseTransientStatus(...) ?? task.status`, иначе штатные раны под транзиентом In Progress ломались бы (главный риск); (4) ручного флага `manualStatus` в схеме MCP нет — ручные пути (CLI `task edit --status`, веб PATCH) идут мимо MCP, флаг в схеме стал бы дырой для агента; (5) нерезолвимая фаза → fail-open (прежнее поведение по `config.statuses`), что сохраняет десятки существующих тестов server.test.mjs; (6) `backlog_update_status` не закрываем — фаза comment по шаблону штатно переоткрывает задачу, вне AC.
Риски: транзиент In Progress (закрыт `getPhaseTransientStatus` + кейс 4), расширение общей фикстуры server.test.mjs (правим config.yml только в beforeAll нового describe в конце файла), подмена фазы через args.phase (guard игнорирует), кастомные workflow (проверка через `getWorkflowForTask`, не DEFAULT_WORKFLOW), форма ошибки: если ревью прочтёт AC1 как полный no-op записи — правка в одну строку (перенос в `hardErrors`), вынесено на ревью.
Проверка: `pnpm build && pnpm test` (полный прогон — DoD «Тесты проходят»); точечно — `npx vitest run src/mcp/server.test.mjs src/core/workflow.test.mjs src/core/phase-transient.test.mjs`.
---
author: @agent
created: 2026-11-01 16:43
---
Фаза 3 (Code) выполнена. Изменено: 7 файлов, коммит 0435199 (ветка vb/vl-245).
Реализация по плану:
- `src/core/workflow.ts` — новый экспорт `phaseStatusTransitionError(workflow, currentStatus, phase, requestedStatus)`: служебная фаза → запрет любой смены статуса (с пояснением «статус меняют только workflow-фазы, ручной перевод — CLI/веб-API» и «Не повторяй вызов», lesson-92); иначе разрешён ровно `produces_status` перехода «currentStatus + phase»; нет перехода/`produces_status: null` → запрет с фактическим `produces_status` и списком доступных фаз.
- `src/core/phase-transient.ts` — `getPhaseTransientStatus(cwd, taskKey, phase)`: `prevStatus` из кэша только при совпадении фазы (ключ в UPPER), иначе/при битом кэше → `null` (fail-open).
- `src/mcp/tools.ts` — импорты `getWorkflowForTask`/`phaseStatusTransitionError`/`getPhaseTransientStatus`; локальный `resolveGuardPhase(cwd)` (порядок `VIBELOG_RUN_PHASE` → `VIBELOG_PHASE_NAME` кроме `prompt` → `meta.lastRunPhase` → `meta.phase`, мета из `VIBELOG_CWD ?? cwd`; `args.phase` сознательно НЕ используется — иначе модель выписывает себе разрешение); guard в ветке «статус валиден по конфигу» с базой `getPhaseTransientStatus(...) ?? task.status`; абзац о новом правиле в `description` инструмента (схема не менялась, новых required-полей нет).
- Тесты: `src/core/workflow.test.mjs` +7 кейсов новой pure-функции (служебные фазы, инцидент comment+Done, Review+close→Done, fix-цикл Review+code→Review, close из To Do, финальные статусы, кастомный investigation-workflow); `src/core/phase-transient.test.mjs` +2 кейса `getPhaseTransientStatus` (своя/чужая фаза, регистр ключа; нет записи/битый кэш → null); `src/mcp/server.test.mjs` — новый `describe('…защита перехода по фазе workflow (VL-245)')` из 6 интеграционных кейсов (служебная фаза comment + Done → отказ с частичным применением отчёта; close при To Do + Done → отказ; Review + close → Done успех/регрессия; транзиент In Progress + prevStatus Review → разрешено; без env фазы → fail-open; фаза из меты сессии).
- Документация: `README.md` — абзац «Смена статуса разрешена только фазе workflow (VL-245)» в разделе контракта `backlog_finish_phase` (источники фазы, запрет служебных, база из транзиент-кэша, fail-open, отсутствие флага-исключения в MCP). doc-8 и CHANGELOG — как запланировано, в фазе Close.
Проверки: `pnpm build` (tsc, чисто) + полный `pnpm test` — 119 файлов, 2200 passed, 4 skipped (пропуски — встроенные `it.skip` в `src/core/frontmatter.test.mjs`, к задаче не относятся); исключённых файлов нет, прогон полный. Точечно те же suites проверялись отдельно (env -u VIBELOG_*, lesson-113).
Отмечено AC 1–3 и DoD 1 (тесты), 3 (нет регрессий). DoD 2 «Документация обновлена» НЕ отмечен: README-абзац записан, но правки doc-8 (MCP-справочник) и CHANGELOG по плану выполняет фаза Close.
Non-goal зафиксирован в плане: `backlog_update_status` не закрыт — фаза comment по шаблону (`templates/phases/phase-comment.md:28`) штатно переоткрывает задачу этим путём; в AC его нет.
Новое: lesson-135 (фазу для guard бери из env/меты, базу — из транзиент-кэша), связан с задачей.
---
author: @agent
created: 2026-11-01 16:55
---
Фаза Close выполнена. Ветка vb/vl-245 слита в master (1 коммит, 0435199 — «fix: VL-245 — запрет смены статуса фазой без перехода в workflow»), merge-коммит 1dbf035, worktree .vibelog/worktrees/vl-245 удалён (force — в нём были только untracked-симлинки node_modules и backlog/references/data, их кладёт оркестратор; данных не потеряно), ветка vb/vl-245 удалена.
Проверки после merge (в главном репо): `pnpm build` — чисто (tsc); ранний точечный фильтр по файлам diff'а — `src/core/workflow.test.mjs`, `src/core/phase-transient.test.mjs`, `src/mcp/server.test.mjs` — 3 файла, 76 passed (включая все 6 новых интеграционных кейсов VL-245 и новый describe «защита перехода по фазе workflow»); полный `pnpm test` — 119 файлов, 2200 passed, 4 skipped (пропуски — встроенные it.skip в `src/core/frontmatter.test.mjs`, к задаче не относятся), параллельного vitest в других worktree не было (ps aux пусто), повторных полных прогонов не требовалось. Дифф merge затрагивает src/ (workflow.ts, phase-transient.ts, tools.ts + три тест-файла) и docs, поэтому полный прогон был обязателен и выполнен один раз.
DoD: 1 «Тесты проходят» — полный `pnpm test` после merge зелёный; 2 «Документация обновлена» — закрыт в этой фазе: README-абзац «Смена статуса разрешена только фазе workflow (VL-245)» пришёл merge'ом из Code, CHANGELOG.md (раздел Unreleased → Исправлено, запись VL-245 со всеми деталями) и backlog/docs/doc-8-MCP-справочник (правило перехода по фазе в разделе `backlog_finish_phase`) — коммит 62af731; 3 «Нет регрессий» — штатный переход Review + close → Done работает как раньше (AC2), fail-open без резолвимой фазы покрыт кейсом 5.
AC 1–3 были отмечены ещё в фазе Code и подтверждены на слитом коде. Lessons: lesson-135 (фаза для guard — из env/меты, база — из транзиент-кэша, не из args.phase и task.status) связан с задачей; refs у задачи нет. Non-goal: `backlog_update_status` не закрыт — фаза comment по шаблону штатно переоткрывает задачу этим путём.
---
<!-- COMMENTS:END -->