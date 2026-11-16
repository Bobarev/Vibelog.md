---
id: VL-410
title: 'Директивы цикла называют следующий шаг фазы из workflow, а не по имени фазы'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 16:40'
updated_date: '2026-11-16 16:02'
due_date: ''
labels:
  - agent
  - core
  - prompt
dependencies: []
milestone: v1.14
references: []
priority: ''
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow.ts
  - src/core/workflow.test.mjs
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker-vl357.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/loop-repeat-cap.test.mjs
  - src/agent/cli.ts
  - src/mcp/update-pipeline.ts
lessons:
  - lesson-283
token_usage:
  input: 14836511
  output: 132503
  cache: 14565376
  total: 14969014
  requests: 163
  duration_ms: 1859529
  reasoning: 90886
  by_phase:
    code:
      input: 13732590
      output: 126895
      cache: 13494784
      requests: 139
    close:
      input: 1103921
      output: 5608
      cache: 1070592
      requests: 24
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Фаза spec VL-408 упала кодом 1 (сессия `agent-1794313856082`): модель сделала три отдельных `backlog_update_task` (`{id,title,type}`, `{id,priority,type}`, `{id,labels,type}` — все applied), затем четыре дословных повтора `{id, type}` → noop → кап `MAX_NOOP_REPEATS_PER_RUN=3` → `fail()`. Статус откатился в To Do, AC не появились.

Корень — директива noop-повтора не говорит модели, что делать дальше. `noopRepeatDirective` (`src/agent/repeat-tracker.ts:923`) выдаёт «Следующий шаг: прочитай состояние или смени аргумент» — модель читает это как «попробуй ещё раз» и повторяет дословно (тот же механизм, что VL-319/349/361). Для close это уже вылечено в VL-368, но через хардкод `phase === 'close'` в `appliedNoopDirective` — для любой другой фазы, включая кастомные (`investigate`, `materialize`, `analyze` из `workflows` в settings), остаётся общая фраза и тот же цикл.

Второй дефект: `DEFAULT_COMPLETENESS.default.spec` (`src/core/workflow.ts:101`) требует только `description`. Описание в VL-408 было заполнено, поэтому `taskMissing()` вернул пустой `missing`, и `noopHint` (`src/mcp/tools.ts:1631`) не назвал ни одного конкретного поля — модель осталась без следующего шага. При этом `templates/phases/phase-spec.md` шаг 6 объявляет AC обязательными: гейт неполноты и шаблон фазы описывают spec по-разному.

Цель: следующий шаг фазы вычисляется из workflow и `completeness` (данные конфигурации), а не из списка имён фаз в коде. Работает для любой фазы, включая кастомные.

Связанная задача: VL-411 (эскалация и блокировка повторов в `src/agent/loop.ts`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В `src/core/workflow.ts` есть экспорт `phaseNextStep(cwd, task, phase)`: для служебной фазы (`SERVICE_PHASES`) и для фазы без перехода (`getStatusAfterPhase(...) === null`) возвращает «отчёт не требуется, заверши текстом», иначе — «вызови backlog_finish_phase» с перечислением неполных полей из `completeness`
- [x] #2 `noopRepeatDirective` и `appliedNoopDirective` (`src/agent/repeat-tracker.ts`) получают текст следующего шага из `phaseNextStep`; в коде директив нет сравнений с именами фаз (`phase === 'close'` и подобных)
- [x] #3 `REPORT_REQUIRED_PHASES = {close}` в `src/agent/loop.ts` заменён вычислением через `phaseNextStep` — «нужен отчёт» = «у фазы есть переход»
- [x] #4 `DEFAULT_COMPLETENESS.default.spec` требует `acceptanceCriteria` (сейчас только `description`), `PARTIAL_SCENARIOS` в `src/mcp/write-ack-contract.test.mjs` остаётся зелёным
- [x] #5 Регресс-тест на сессию `agent-1794313856082` (3 applied + 4 noop `{id,type}` в фазе spec): директива называет `backlog_finish_phase` и `acceptanceCriteria`, а не общую фразу
- [x] #6 Тест на кастомную фазу (`investigate` из `.vibelog/settings.json`): директива называет `backlog_finish_phase`, а не общую фразу
- [x] #7 `noopPrefix` в `src/mcp/update-pipeline.ts` согласован по числу: «type уже имеет эти значения» для одного поля
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы и правки

**`src/core/workflow.ts`** — новый экспорт `phaseNextStep(cwd, task, phase): { required: boolean; text: string; missing: string[] }`:
- `SERVICE_PHASES.includes(phase)` → `{required: false, text: 'Служебная фаза: отчёт не требуется, заверши работу текстом.'}`;
- `getStatusAfterPhase(getWorkflowForTask(cwd, task), prevStatus, phase) === null` → `{required: false, text: 'Фаза не двигает статус задачи: заверши работу текстом.'}`;
- иначе `{required: true, text: 'Фаза <phase> не завершена — вызови backlog_finish_phase.'}` + при непустом `taskCompletenessMissing(...)` дописать «Сначала передай в этом же вызове: <поля>».
`prevStatus` брать из `getPhaseTransientStatus(cwd, task.id, phase) ?? task.status` (как в `src/agent/auto-report.ts:100`). Имён фаз в коде быть не должно — только `SERVICE_PHASES` и данные workflow/completeness.

**`src/core/workflow.ts:101`** — `DEFAULT_COMPLETENESS.default.spec: { task: ['description', 'acceptanceCriteria'] }`. Проверить, что `PARTIAL_SCENARIOS` в `src/mcp/write-ack-contract.test.mjs` остаётся зелёным (правило `'*'` — регресс-барьер).

**`src/agent/repeat-tracker.ts:887,923`** — `appliedNoopDirective(name, lastAck, nextStep?)` и `noopRepeatDirective(name, lastAck, nextStep?)` принимают готовый текст шага вместо `phase?: string`; ветка `phase === 'close'` удаляется. `extra.phase` сохранить (диагностика), но текст — только из `nextStep`.

**`src/agent/loop.ts:360,1369`** — `REPORT_REQUIRED_PHASES = new Set(['close'])` заменить на вычисление `phaseNextStep(...).required` один раз в начале рана (нужны `cwd`, `task`, `phase` — они уже есть в `RunLoopOptions`); `runHasProgress()` читает флаг. Проброс `nextStep` в обе директивы — в точках `blockAndPush` и `appliedRepeatOutcome`.

**`src/mcp/update-pipeline.ts`** — `noopPrefix`: для одного поля «type уже имеет эти значения», для нескольких — «type, labels уже имеют эти значения».

## Порядок

1. `phaseNextStep` + тесты в `src/core/workflow.test.mjs` (spec/close/служебная/кастомная `investigate`/фаза без перехода).
2. `DEFAULT_COMPLETENESS.default.spec` + прогон `write-ack-contract.test.mjs`.
3. Директивы на `nextStep`, удаление хардкода close.
4. `loop.ts`: `REPORT_REQUIRED_PHASES` → вычисление, проброс `nextStep`.
5. `noopPrefix` (согласование).
6. Регресс-тесты сессии `agent-1794313856082` в `src/agent/loop.test.mjs` и кастомной фазы в `src/agent/repeat-tracker-vl357.test.mjs`.

## Проверка

`pnpm build && pnpm test` (полный прогон). Целевые: `src/core/workflow.test.mjs`, `src/agent/repeat-tracker-vl357.test.mjs`, `src/agent/loop.test.mjs`, `src/mcp/write-ack-contract.test.mjs`, `src/web/phase-prompt.test.mjs` (инвариант «шаблон spec требует AC»).

## Риски

- `DEFAULT_COMPLETENESS.default.spec` += `acceptanceCriteria` меняет ответ `backlog_update_task` в фазе spec: вызов без AC станет `partial` вместо `applied`. Это цель, но проверить, что шаблоны фаз и тесты не ждут `applied`.
- `phaseNextStep` зовёт `getWorkflowForTask`/`getPhaseTransientStatus` — оба читают диск; вызов один раз за ран, не в цикле.
- Кастомный workflow без записи в `completeness` даёт пустой `missing` — текст шага остаётся корректным («вызови backlog_finish_phase»), это ожидаемо.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 17:30
---
Фаза code не удалась (код выхода 1): окировок=1, payload последнего запроса=525901 байт (макс 525901), usage={"input_tokens":6411704,"output_tokens":62248,"cache_read_input_tokens":6296064,"total_tokens":6473952,"reasoning_tokens":44519} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 17:35
---
Фаза 3 (Code) выполнена. Коммит c281140.
**Что сделано**
1. `src/core/workflow.ts` — новый экспорт `phaseNextStep(cwd, task, phase)`: `SERVICE_PHASES` → «отчёт не требуется»; `getStatusAfterPhase(...) === null` → «фаза не двигает статус»; иначе «Фаза <phase> не завершена — вызови backlog_finish_phase» + «Сначала передай в этом же вызове: <поля>». `prevStatus` — из `getPhaseTransientStatus(...) ?? task.status`. Имён фаз в коде нет — только `SERVICE_PHASES` и данные workflow/completeness.
2. `DEFAULT_COMPLETENESS.default.spec` → `['description', 'acceptanceCriteria']` (согласовано с шаблоном `phase-spec.md`, шаг 6). `PARTIAL_SCENARIOS` в `write-ack-contract.test.mjs` зелёный.
3. `src/agent/repeat-tracker.ts` — `appliedNoopDirective(name, lastAck, nextStep?, phase?)` и `noopRepeatDirective(name, lastAck, nextStep?)` принимают готовый текст шага; ветка `phase === 'close'` удалена, `extra.phase` сохранён для диагностики.
4. `src/agent/loop.ts` — `REPORT_REQUIRED_PHASES` удалён; `reportRequired` и `nextStepText` вычисляются один раз за ран через `phaseNextStep` (новые опции `RunLoopOptions.cwd`/`task`); `nextStep` проброшен в обе директивы в `blockAndPush`.
5. `src/agent/cli.ts` — передаёт `cwd` (taskCwd, в branch-mode главный репо) и задачу рана в `runLoop`.
6. `src/mcp/update-pipeline.ts` — `noopPrefix` согласован по числу: «type уже имеет эти значения» для одного поля, «type, labels уже имеют эти значения» для нескольких.
**Тесты**
- `src/core/workflow.test.mjs`: новый блок `phaseNextStep (VL-410)` — служебная фаза, фаза без перехода, spec без AC (называет `acceptanceCriteria`), полная задача, close, кастомная `investigate`; обновлён AC3-тест spec.
- `src/agent/loop.test.mjs`: регресс сессии `agent-1794313856082` (applied + 4 noop `{id,type}` в фазе spec → директива называет `backlog_finish_phase` и `acceptanceCriteria`, общей фразы нет) и кастомная фаза `investigate`.
- `src/agent/repeat-tracker-vl357.test.mjs`: директивы несут готовый текст шага (VL-368-тест переписан на VL-410-контракт).
- `src/agent/loop-repeat-cap.test.mjs`: VL-368-сценарии переведены на `cwd`/`task`; добавлены «code без отчёта → fail» и «code с отчётом → штатно» (признак «нужен отчёт» теперь из workflow).
**Проверки**: `pnpm build` + полный `pnpm test` — 220 файлов, 4254 passed, 4 skipped, 0 failed. Промежуточное падение `src/web/orchestrator.test.mjs` (billing-коммит) при первом полном прогоне — флейк окружения: изолированный прогон файла и повторный полный прогон зелёные.
**Что осталось**: DoD «Документация обновлена» не отмечен — по правилам фазы Code CHANGELOG.md и backlog/docs не правятся, итоговую документацию пишет фаза Close после merge. Связанная задача VL-411 (эскалация и блокировка повторов в `src/agent/loop.ts`) не затрагивалась.
---
author: @agent
created: 2026-11-10 17:54
---
Фаза Close выполнена. Ветка vb/vl-410 слита в master (1 коммит c281140, merge --no-ff без конфликтов), worktree удалена (force — только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-410 удалена.
**Проверки после merge**: `pnpm build` — успешно; ранний точечный фильтр (workflow, repeat-tracker-vl357, loop, loop-repeat-cap, write-ack-contract, phase-prompt) — 6 файлов / 340 тестов зелёные; полный `npx vitest run` — 221 файл, 4262 passed, 4 skipped, 0 failed. Повторных прогонов не было.
**Документация** (коммит 6ccf1eb): CHANGELOG.md — запись в Unreleased/Исправлено; doc-30 §4 — дефолт `spec` требует `acceptanceCriteria` и почему это согласовано с шаблоном фазы; doc-31 §4 — директива повтора называет следующий шаг из `phaseNextStep`, имён фаз в коде нет.
**Урок** (коммит d2725a6): lesson-283 «Вычисляй следующий шаг фазы из workflow и completeness, а не из списка имён фаз в коде», связан с VL-410.
**DoD**: 1. Тесты проходят — да (полный прогон зелёный); 2. Документация обновлена — да (CHANGELOG + doc-30 + doc-31); 3. Нет регрессий — да (полный прогон без падений, merge чистый).
---
<!-- COMMENTS:END -->