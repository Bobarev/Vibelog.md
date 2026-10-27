---
id: VL-196
title: 'Transient In Progress: статус задачи на время выполнения фазы + откат при ошибке'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 21:06'
updated_date: '2026-10-27 06:50'
due_date: ''
labels:
  - core
  - web
  - agent
dependencies: []
milestone: ''
references:
  - ref-1
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/phase-transient.ts
  - src/core/phase-transient.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/web/server.ts
  - src/cli/commands/bot.ts
  - src/bot/auto-runner.test.mjs
lessons:
  - lesson-62
  - lesson-63
token_usage:
  input: 8182595
  output: 110113
  cache: 7946240
  total: 8292708
  requests: 100
  duration_ms: 2161155
  reasoning: 77978
  by_phase:
    spec:
      input: 157396
      output: 9716
      cache: 137088
      requests: 5
    plan:
      input: 1483942
      output: 26561
      cache: 1416320
      requests: 27
    code:
      input: 6541257
      output: 73836
      cache: 6392832
      requests: 68
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Порождено ревьюей плана VL-195 (комментарий Pavel, 2026-10-26): «Статус In Progress должен назначаться во время выполнения фазы — никакая фаза не должна ПРОИЗВОДИТЬ In Progress».

## Текущее поведение (VL-188)
- Статус меняет только backlog_finish_phase (агент); во время работы фазы статус не меняется; при ошибке фазы статус остаётся прежним (ничего не делается).
- В DEFAULT_WORKFLOW In Progress НЕ производится ни одной фазой — только переходы ИЗ неё: In Progress → code → Review, In Progress → reject → Rejected. В статусы config.yml входит; в канбан-колонку попасть нельзя (canMoveTo запрещает) — только escape-hatch /status и MCP --status.

## Желаемая семантика
- запуск фазы → статус задачи = In Progress (на канбане видно, что «в работе»);
- фаза успешно завершилась → применяется produces_status workflow;
- фаза провалилась → возврат к статусу, с которого стартовала (иначе авто-retry в воркфлоу без фаз из In Progress падает — например, investigation); альтернатива «осталась в In Progress» — отклонена: ломает auto-retry (pickAutoPhase по In Progress предложит code вместо исходной фазы).

## Ограничения (зафиксировано в Спеке VL-196)
- Frontmatter задач НЕ расширять (совместимость с Backlog.md, ref-1) → «статус до фазы» хранится в кэше .vibelog/phase-in-progress.json (gitignored) + pid процесса фазы; fallback после рестарта — recovery на старте процесса.
- Единая точка — spawnQwenRun (общий для всех startPhase/startTaskPhase: веб, бот, авто-очередь, оркестратор, rejectTask, drainCloseQueue).
- Глобально для всех workflow-фаз default-воркфлоу (AC1); настройка phase_in_progress НЕ вводится (YAGNI — точка врезки одна, добавляется позже одной проверкой).
- canMoveTo/драг и колонки канбана: In Progress уже в статусах — transient не ломает перетаскивание.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Запуск любой фазы (кнопка веба/бота, авто-очередь, оркестратор) переводит задачу в In Progress до завершения фазы — статус виден на канбане/карточке
- [x] #2 Успешное завершение фазы ставит produces_status из workflow; проваленная фаза возвращает статус, с которого стартовала (решение Спеки), причина фиксируется комментарием
- [x] #3 Задача не может навсегда застрять в In Progress без доступной фазы: после рестарта процесса есть fallback (кэш .vibelog/ или доступная фаза)
- [x] #4 Тесты pnpm test зелёные (старт/успех/ошибка, авто-retry); поведение default-воркфлоу и семантика In Progress описаны в doc-6
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan — VL-196: Transient In Progress на время фазы

## Архитектурные решения (зафиксированы планом)

1. **Область**: транзиентный In Progress ставится только для **workflow-фаз** — не для SERVICE_PHASES (`comment`, `prompt`, `analyze`, `resume` — src/core/workflow.ts:100, статуса не меняют) и только если у исходного статуса есть переход `getStatusAfterPhase(workflow, prevStatus, phase) !== null` (т.е. фаза реально участвует в default-воркфлоу: spec/plan/code/do/close/reject/investigate/materialize). «Фазы default-воркфлоу» из описания задачи = фазы transitions; comment-фаза из транзиента исключена (иначе Done-задача мигает в In Progress на каждый комментарий).
2. **Глобальность без настройки**: поведение действует всегда (AC1 «запуск любой фазы»). `phase_in_progress` в settings.json НЕ вводится — точка врезки одна (`markPhaseStarted`), настройка добавляется позже одной guard-строкой, если понадобится.
3. **Хранение «статус до фазы»**: кэш `.vibelog/phase-in-progress.json` (весь `.vibelog/` уже в .gitignore:9). Frontmatter не расширяем (ref-1, совместимость с Backlog.md). In-memory-вариант отклонён: файл межпроцессный (web и бот живут в разных процессах), маленький, операции редкие.
4. **Семантика финализации** (AC2): успех → применяется `produces_status`, посчитанный от **исходного** статуса, но ТОЛЬКО если агент сам не зафиксировал статус (текущий статус всё ещё In Progress; агент мог вызвать `backlog_finish_phase` — он валидирует только список config.yml, не transitions, src/mcp/tools.ts:1138-1149). Провал → откат к исходному статусу + комментарий-причина (`@agent`).
5. **Fallback после рестарта** (AC3): recovery-функция читает кэш и восстанавливает статус, если pid процесса фазы мёртв (`process.kill(pid, 0)` → ESRCH). Вызывается на старте долгоживущих процессов (web-сервер, бот) + opportunistically при старте новой фазы. Живой pid (орфан-процесс после рестарта хозяина доработает сам через MCP) → запись не трогаем; она уберётся при следующем recovery (статус уже не In Progress).

## Файлы для изменения

| Файл | Действие |
|---|---|
| `src/core/phase-transient.ts` | **новый** — вся логика транзиента |
| `src/web/orchestrator.ts` | врезка mark/finalize в spawnQwenRun |
| `src/web/server.ts` | recovery на старте web |
| `src/cli/commands/bot.ts` | recovery на старте бота |
| `src/core/phase-transient.test.mjs` | **новый** — юнит-тесты |
| `src/web/orchestrator.test.mjs` | интеграция со стабом qwen |
| `src/bot/auto-runner.test.mjs` | retry после отката |
| doc-6 (Руководство пользователя) | документация (AC4) |

Все существующие пути проверены `ls` — есть; новые два создаются.

## Порядок действий

### 1. Новый модуль `src/core/phase-transient.ts`

Импорты: `getTask/updateTaskFile/addComment` из `./store.js` (store.ts:58/127/227), `getWorkflowForTask/getStatusAfterPhase/SERVICE_PHASES` из `./workflow.js`, `taskIdPattern` из `./config.js`. Подробные JSDoc/комментарии на русском (правила проекта).

- **Константа** `PHASE_STATUS_FILE = join(cwd, '.vibelog', 'phase-in-progress.json')`.
  Формат: `{ "VL-196": { "prevStatus": "Spec", "phase": "plan", "pid": 12345, "startedAt": "ISO" } }` — ключ канонический (UPPER, как activeRuns, VL-145); `getTask` регистронезависим (store.ts:63-70).
- **`isTransientEligible(cwd, taskKey, phase): boolean`** — `taskIdPattern(cwd).test(taskKey) && !SERVICE_PHASES.includes(phase) && getStatusAfterPhase(workflow, prevStatus, phase) !== null`.
- **`markPhaseStarted(cwd, key, phase, pid): void`** (вызывается ПОСЛЕ успешного spawn — см. этап 2):
  1. eligibility → нет: выйти (служебные фазы/резюме/чужие ключи не трогаем);
  2. прочитать кэш → **merge**-запись своей записи (не затираять записи других процессов/задач) → записать файл; попутно выбросить записи с мёртвым pid (оппортунистическая очистка, AC3);
  3. `updateTaskFile(cwd, key, { status: 'In Progress' })`;
  4. **fail-open**: если запись статуса упала — удалить свою запись кэша, `console.log`, фаза продолжается без транзиента (инвариант: запись в кэше ⇒ статус In Progress). Порядок «кэш → статус» выбран чтобы не оставлять In Progress без записи для отката.
- **`finalizePhaseStatus(cwd, key, phase, record): void`** — вызывается в `finish()` строго ДО вызова `onExit`:
  1. `takeEntry` = прочитать кэш, извлечь свою запись, файл перезаписать без неё; записи нет → выйти (служебная фаза/транзиент не ставился);
  2. задача не найдена → выйти;
  3. `task.status !== 'In Progress'` → агент сам зафиксировал итог (`backlog_finish_phase`/`rejectTaskFile`) → только запись уже убрана, ничего не перетирать;
  4. статус In Progress + **успех** (`record.exitCode === 0 && record.result?.is_error !== true`) → `updateTaskFile(status = getStatusAfterPhase(workflow, entry.prevStatus, phase) ?? entry.prevStatus)` — AC2 «успех → produces_status», fallback-откат, если перехода вдруг нет;
  5. статус In Progress + **провал** → `updateTaskFile(status = entry.prevStatus)` + `addComment(cwd, key, 'Фаза <phase> не удалась (код выхода N): <последние ~200 симв. record.logTail> — статус возвращён к <prevStatus>.', '@agent')` — AC2 «причина фиксируется комментарием».
- **`recoverStalePhaseStatuses(cwd): void`** — для каждой записи кэша:
  - `pid` жив (`process.kill(pid, 0)` без исключения; EPERM → жив) → пропустить (фаза ещё идёт, возможно в другом процессе);
  - мёртвый/отсутствующий pid: задача в In Progress → откат к `prevStatus` + комментарий `Фаза <phase> прервана остановкой процесса — статус возвращён к <prev>.`; запись удалить. Задача не найдена/статус уже другой → просто удалить запись.

### 2. `src/web/orchestrator.ts` — две врезки в `spawnQwenRun`

- import `markPhaseStarted, finalizePhaseStatus` из `../core/phase-transient.js` (после строки с импортом workflow, ~стр. 33).
- **Старт**: сразу после `activeRuns.set(key, ...)` (**стр. 811**) и `lastRuns.delete(key)` → `markPhaseStarted(cwd, key, phase, child.pid)`. Ключ `key` канонический. Гарды до спавна (activeRuns, валидация в startPhase, worktree-ensure, стр. 177-330) возвращаются ДО записи статуса — при ошибке запуска транзиент не ставится (ретраям auto-runner не нужен откат). Spawn синхронный, `finish()` асинхронный — гонки «старт против завершения» нет.
- **Финализация**: в `finish()` **после** high-risk retry-ветки (стр. 1086-1110 — она делает `return`, не вызывая onExit: на время авто-resume транзиент сохраняется) и **непосредственно перед** `try { onExit?.(record) }` (~стр. 1111) → `finalizePhaseStatus(cwd, key, phase, record)`. Порядок «finalize → onExit» критичен: auto-runner (`finishCurrentPhase`, src/bot/auto-runner.ts:339-368, проверка `progressed = fresh.status !== statusBefore`) и `rejectTask`-onExit получают уже финальный статус.
- Прочие вызовы `spawnQwenRun` (startPrompt `'prompt'`, startAnalyze `'analyze-*'`, startResume `'resume:*'`) не проходят eligibility — не затронуты. Все точки старта задачных фаз (кнопка веба api.ts:409, бот handlers.ts:372/850/903/960/1009/1548, авто-очередь auto-runner.ts:325 через `startTaskPhase`, rejectTask, drainCloseQueue) идут через `startPhase` → `spawnQwenRun` — одна точка (AC1 покрыт для всех запускающих сторон).

### 3. `src/web/server.ts` — recovery на старте web

В `startWebServer(cwd, ...)` (стр. 34), перед `server.listen` (стр. 125): `recoverStalePhaseStatuses(cwd)` (обёрнуть в try/catch — сбой recovery не должен мешать подъёму сервера).

### 4. `src/cli/commands/bot.ts` — recovery на старте бота

В `runBot` после `loadProjectEnv(cwd)` (стр. 31): `recoverStalePhaseStatuses(cwd)` (try/catch, log). Этим закрывается AC3: после рестарта процесса (web/бот) задача не остаётся навсегда в In Progress.

### 5. Тесты (`pnpm test` = build + vitest; тесты импортируют `dist/`)

**`src/core/phase-transient.test.mjs`** (новый, tmp-каталоги как в orchestrator.test.mjs):
- eligibility: `plan` из Spec → true; `comment` (SERVICE) → false; фаза без перехода из текущего статуса → false; ключ не задачи → false;
- mark → статус In Progress + запись в кэше с prevStatus/phase/pid;
- finalize успех → статус = produces_status (Spec+plan → Planned), запись удалена;
- finalize провал → откат к Spec + комментарий `@agent` с кодом выхода, запись удалена;
- «агент сам зафиксировал статус»: после mark статус меняется на Planned вручную, finalize успех → Planned не перетирается, запись удаляется;
- recovery: запись с мёртвым pid (например 999999) + In Progress → откат + коммент; запись с `pid: process.pid` → пропуск; fail-open mark (битый путь записи) → фаза без транзиента, кэш без записи.

**`src/web/orchestrator.test.mjs`** (дописать, стаб `VIBELOG_QWEN_BIN` + `VL28_STUB_EXIT` уже есть):
- старт plan-фазы exit 0 → во время прогона статус In Progress (читаем через getTask до завершения — стаб с `VL28_STUB_SLEEP`), после onExit → Planned;
- `VL28_STUB_EXIT=1` → откат к исходному статусу + комментарий-причина;
- фаза comment → статус НЕ меняется (служебная);
- запись кэша отсутствует после финализации во всех случаях.

**`src/bot/auto-runner.test.mjs`** (дописать/проверить счётком):
- провал фазы с транзиентом → к моменту `finishCurrentPhase` статус уже откачен к `statusBefore` → `progressed=false` + exitCode≠0 → retry; повторный `pickAutoPhase` по исходному статусу находит ту же фазу (регрессия AC «auto-retry из In Progress падал бы»).

### 6. Документация (AC4) — `document_update` doc-6 «Руководство пользователя»

Новый раздел (найти раздел про статусы/канбан и дополнить): семантика default-воркфлоу; **Transient In Progress**: запуск workflow-фазы переводит карточку в In Progress (видно на канбане), успешное завершение ставит `produces_status`, ошибка возвращает исходный статус с комментарием-причиной; In Progress никогда не «производится» фазой; после рестарта веба/бота статус автоматически восстанавливается из `.vibelog/phase-in-progress.json` (pid-проверка); служебные фазы (comment/prompt/analyze/resume) статус не трогают.

### 7. Проверка

```bash
pnpm build && pnpm test      # полный прогон (build + vitest)
pnpm test:fast               # быстрые итерации после сборки
```
Smoke (в Code): `vibelog browser` → открыть страницу → старт фазы кнопкой → карточка в колонке In Progress → завершение → колонка produces_status; проверить консоль/сеть (evaluate_script, без скриншотов — VL-178).

## Риски

1. **`wasInCode` (src/core/store.ts:294)**: «In Progress» — один из признаков «кода». Reject кнопкой во время транзиента (ранее задача была, напр., в Spec) уйдёт в LLM-ветку reject и упрётся в guard «Запуск уже выполняется» вместо чистой механики. Раньше окно было только после code (In Progress/Review) — стало шире. Mitigation: задокументировать; при жалобах — ранний activeRuns-guard в `rejectTask` до выбора ветки.
2. **Гонка read-modify-write кэша** при параллельных фазах web+бот — минимизируется merge-записью; операции редкие (старт/финиш фазы).
3. **pid reuse** (маловероятно на Catalina) → recovery пропустит чужую запись; безвредно: следующий recovery или финализация уберут её.
4. **Существующие тесты** с точными ассертами «статус не изменился при падении фазы»/счётчиками комментариев упадут — ожидания обновляются осознанно (новое поведение: откат + комментарий), регрессии не подменяются.
5. **Коммент-фаза вне транзиента** — трактовка AC1 «любой фазы» = фазы default-воркфлоу (comment не в transitions); если заказчик потребует и comment — расширение одной строкой eligibility.
6. **Откат позже зафиксированного агентом статуса**: если агент выставил итоговый статус mid-фазы, а фаза потом упала — статус НЕ откатывается (атомарность на стороне агента, осознанно: комментарий агента уже зафиксировал итог).
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Документация (для Фазы Close, AC4): черновик раздела doc-6

В Фазе 3 документы backlog/docs не обновляются (правила фазы); полный контент doc-6 (87 КБ) не проходит кап вывода MCP (8 КБ) — поэтому текст раздела готов здесь, Close вставляет его в doc-6 (раздел 10 «Доска и веб-интерфейс» или рядом со статусами):

### Статус задачи во время фазы (Transient In Progress)

Запуск любой workflow-фазы (spec/plan/code/do/close/reject/…) временно переводит задачу в **In Progress** — на канбане видно, что задача «в работе». Это транзиентный статус, а не результат перехода workflow:

- фаза завершилась успешно → статус меняется на `produces_status` текущего перехода (Spec + plan → Planned, Planned + code → Review, Review + close → Done);
- фаза провалилась → статус возвращается к тому, с которого фаза стартовала; причина (код выхода, хвост лога) добавляется комментарием от @agent;
- агент сам зафиксировал статус через backlog_finish_phase во время фазы — его запись приоритетна, оркестратор не перетирает её;
- служебные фазы (comment/prompt/analyze/resume) статус не меняют;
- рестарт веба/бота: «зависшие» In Progress откатываются автоматически по кэшу `.vibelog/phase-in-progress.json` (исходный статус, фаза, pid процесса; запись с живым pid не трогается — фаза ещё идёт), поэтому задача не может навсегда остаться в In Progress без доступной фазы.

In Progress никогда не «производится» фазой — только занимается на время её выполнения. Ручной перенос канбана из In Progress ограничен переходами workflow (только code/reject), как и раньше.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 05:53
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (информативный, <80 символов). Тип: feature (изменён с task). Масштаб: task. Приоритет: Medium. Уточнено: точка внедрения — startPhase (web/orchestrator.ts), все запуски фаз идут через startTaskPhase; семантика: старт фазы → In Progress, успех → produces_status workflow, ошибка → откат к исходному статусу с комментарием-причиной; fallback против «вечного» In Progress после рестарта — кэш .vibelog/ или доступная фаза; поведение глобальное для всех фаз default-воркфлоу (глобальность зафиксирована AC1: «запуск любой фазы»), опциональная настройка phase_in_progress в .vibelog/settings.json — вопрос для Фазы 2 (Plan), решение за пользователем; статус In Progress не ломает canMoveTo/драг (уже в статусах, просто временно занимает канбан-колонку). Labels: core, web, agent. References: ref-1 (Backlog.md — ограничение совместимости frontmatter). Вопросов нет.
---
author: @agent
created: 2026-10-27 06:05
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в задачу: 8 файлов (4 изменения + 2 новых исходника/тестов + 2 целевых теста), риски: wasInCode-окно reject во время транзиента, merge-гонка кэша web+bot, pid-reuse, обновление точных ассертов старых тестов. Ключевые решения плана: (1) единая точка — spawnQwenRun (общая для веба/бота/авто-очереди/rejectTask/drainCloseQueue → AC1 покрыт всеми запускающими сторонами), mark после activeRuns.set (~стр. 811), finalize в finish() после high-risk-ветки и до onExit (~стр. 1111); (2) хранение «статус до фазы» — кэш .vibelog/phase-in-progress.json (gitignored, frontmatter не расширяем — ref-1), формат {prevStatus, phase, pid, startedAt}; (3) семантика: успех → produces_status от исходного статуса (только если агент сам не зафиксировал статус), провал → откат к исходному + комментарий-причина @agent; (4) fallback после рестарта (AC3): recoverStalePhaseStatuses с pid-проверкой на старте startWebServer и runBot + opportunistic-очистка при старте фазы; (5) транзиент только для workflow-фаз — SERVICE_PHASES (comment/prompt/analyze/resume) статус не трогают («фазы default-воркфлоу» из описания = фазы transitions); (6) глобально без настройки phase_in_progress (YAGNI, AC1) — точка врезки одна, toggle добавляется позже одной guard-строкой; настройка — открытый вопрос для пользователя при ревью. Тесты: новый src/core/phase-transient.test.mjs (eligibility/успех/провал/recovery/fail-open), интеграция в orchestrator.test.mjs (In Progress во время прогона, откат, comment-фаза), auto-runner.test.mjs (retry после отката). Документация: doc-6 — раздел о transient In Progress и семантике default-воркфлоу (AC4). canMoveTo/драг не ломаются: In Progress уже в статусах, у исходящего In Progress есть только code/reject. Проверка: pnpm build && pnpm test.
---
author: @agent
created: 2026-10-27 06:26
---
Фаза 3 (Code) выполнена. Изменено: src/core/phase-transient.ts (новый модуль: isTransientEligible/markPhaseStarted/finalizePhaseStatus/recoverStalePhaseStatuses, кэш .vibelog/phase-in-progress.json {prevStatus, phase, pid, startedAt}), src/web/orchestrator.ts (markPhaseStarted после activeRuns.set в spawnQwenRun; finalizePhaseStatus в finish() после high-risk-ветки и до onExit), src/web/server.ts (recovery на старте startWebServer), src/cli/commands/bot.ts (recovery на старте runBot), тесты: src/core/phase-transient.test.mjs (новый, 8 тестов), src/web/orchestrator.test.mjs (4 интеграционных: In Progress во время фазы → produces, откат+комментарий+statusAtExit, comment-фаза без транзиента, статус агента приоритетен), src/bot/auto-runner.test.mjs (retry после отката + правка VL-200-ожидания). Коммит 7131687 (ветка vb/vl-196). Проверки: pnpm build + pnpm test — 79 файлов/1422 теста + static 7 — все зелёные; pnpm lint (node --check) не менялся. Отмечено AC: 1, 2, 3; DoD: 1, 3. Что осталось: AC4 вторая часть и DoD2 (документация doc-6) — в Фазе 3 документы backlog/docs не обновляются по правилам фазы, полный контент doc-6 (87 КБ) не проходит кап вывода MCP (8 КБ) → готовый черновик раздела «Transient In Progress» лежит в Implementation Notes задачи, применит Close; после Close AC4/DoD2 закрыть. Нюансы: (1) retry-промпт теперь содержит комментарий-причину провала ({{taskLastComment}}) — тест VL-200 переведён на сравнение без этой строки, полезный эффект; (2) служебные фазы (comment/prompt/analyze/resume) из транзиента исключены — «фазы default-воркфлоу» из Спеки = фазы transitions; (3) recovery оппортунистически срабатывает и при старте каждой новой фазы (мёртвый pid → откат чужой зависшей записи). Lessons: lesson-62, lesson-63 созданы и связаны.
---
author: @agent
created: 2026-10-27 06:50
---
Фаза Close выполнена. Ветка vb/vl-196 слита в master (1 коммит 7131687, merge ec0a3a4, без конфликтов), worktree удалена, ветка удалена. После merge в главном репо: pnpm build + pnpm test — зелёные (79 файлов/1422 теста + static 7). Документация (AC4/DoD2): doc-6 — новый подраздел «Transient In Progress — статус задачи на время фазы (VL-196)» (запись через MCP document_update — контент собран программно из исходного файла, diff ровно 2 целевых изменения) + исправлено устаревшее утверждение investigation «во время фазы статус задачи не меняется»; CHANGELOG.md — запись Unreleased VL-196; docs-коммит 11ae244. Refs/lessons закоммичены отдельным коммитом fefa6a6 (ref-1, lesson-62, lesson-63). DoD: 1) Тесты проходят — да (pnpm test после merge зелёный); 2) Документация обновлена — да (doc-6 + CHANGELOG, коммит 11ae244); 3) Нет регрессий — сборка и тесты после merge чистые. Отмечено AC: 4; DoD: 1, 2, 3 (AC 1-3 отмечены в Code).
---
<!-- COMMENTS:END -->