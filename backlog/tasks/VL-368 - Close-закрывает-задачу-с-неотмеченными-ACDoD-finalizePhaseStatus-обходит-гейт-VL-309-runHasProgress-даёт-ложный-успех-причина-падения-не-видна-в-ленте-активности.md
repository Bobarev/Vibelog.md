---
id: VL-368
title: 'Close закрывает задачу с неотмеченными AC/DoD: finalizePhaseStatus обходит гейт VL-309, runHasProgress даёт ложный успех, причина падения не видна в ленте активности'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-08 00:27'
updated_date: '2026-11-08 00:44'
due_date: ''
labels:
  - close
  - workflow
  - status
  - activity
  - repeat-cap
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow.ts
  - src/core/phase-transient.ts
  - src/core/phase-transient.test.mjs
  - src/agent/auto-report.ts
  - src/agent/loop.ts
  - src/agent/loop-repeat-cap.test.mjs
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker-vl357.test.mjs
  - src/agent/cli.ts
  - src/agent/session.ts
  - src/core/activity.ts
  - src/core/activity.test.mjs
  - src/web/orchestrator.ts
lessons:
  - lesson-250
token_usage:
  input: 12615892
  output: 62151
  cache: 12326912
  total: 12678043
  requests: 141
  duration_ms: 775555
  reasoning: 29301
  by_phase:
    plan:
      input: 2412055
      output: 19679
      cache: 2314240
      requests: 31
    code:
      input: 8543941
      output: 35635
      cache: 8399360
      requests: 77
    close:
      input: 1659896
      output: 6837
      cache: 1613312
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `finalizePhaseStatus` (`src/core/phase-transient.ts`) не ставит терминальный статус при неотмеченных AC/DoD: при терминальном `next` и наличии неотмеченных пунктов статус остаётся `prevStatus`, в задачу пишется комментарий-причина с номерами неотмеченных AC/DoD (по образцу текста VL-309). Проверка — общая с `writeAutoReportIfMissing` (одна функция, не две копии)
- [x] #2 `runHasProgress()` (`src/agent/loop.ts`) больше не считает успех доказанным по одному write/commit/shell-следу: для фаз с обязательным отчётом (`backlog_finish_phase`) `failOnRepeatCap` требует `reportWritten`, иначе вызывает `fail()` (`is_error: true`). Регресс-тест: close с коммитом документации и последующим капом повторов `lesson_update` → `is_error: true`, статус не меняется
- [x] #3 Директива `appliedNoopDirective` (`src/agent/repeat-tracker.ts`) называет конкретный следующий шаг фазы вместо общей фразы «переходи к следующему пункту»: для close — «отметь AC/DoD и вызови `backlog_finish_phase`». Фаза пробрасывается в директиву из `loop.ts`; тест проверяет, что текст директивы содержит имя фазы и имя следующего инструмента
- [x] #4 `failureReason()` (`src/core/activity.ts`) показывает причину падения и без `run_progress`: при отсутствии `run_progress` берётся текст результата рана (`last_run`/мета сессии), поэтому «причина не записана» остаётся только для действительно пустого результата. Тест: ран, упавший через `fail()` без `run_progress`, даёт `phase_failed` с непустой причиной
- [x] #5 `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md и doc-10 §6 обновлены (гейт терминальности в `finalizePhaseStatus`, критерий `runHasProgress`, источник причины в ленте активности)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-368 (тип: bug)

### Диагноз (по коду)

1. **`finalizePhaseStatus`** (`src/core/phase-transient.ts:370-378`) при `exitCode === 0 && !is_error && !aborted` безусловно ставит `getStatusAfterPhase(...)` — гейт VL-309 (терминальный статус при неотмеченных AC/DoD) живёт только в `writeAutoReportIfMissing` (`src/agent/auto-report.ts:113-145`). Если авто-отчёт не записался (ран упал, отчёт уже был, служебная фаза) — задача получает Done с висящими AC/DoD.
2. **`runHasProgress()`** (`src/agent/loop.ts:793-856`) возвращает `true` по любому успешному `edit`/`write_file`/`git_commit`/shell-следу. В Close этого достаточно, чтобы `failOnRepeatCap` (`:858`) завершил ран «штатно» (`is_error:false`) при невыполненном отчёте — статус не откатывается, авто-resume не запускается.
3. **`appliedNoopDirective`** (`src/agent/repeat-tracker.ts:883`) говорит общей фразой «Переходи к следующему пункту фазы, а если работа сделана — к отчёту»; фаза в директиву не передаётся (`loop.ts:1197`), модель не знает, что для close нужен именно `backlog_finish_phase`.
4. **`failureReason()`** (`src/core/activity.ts:188-195`) читает только `run_progress`; ран, упавший через `fail()` (кап повторов, лимиты без `buildRunProgress`), даёт `phase_failed` с «причина не записана», хотя текст результата есть в мете (`last_run`) и в `PhaseRun.result`.

### Шаг 1. Общий гейт терминальности — одна функция на два пути (AC1)

**Файлы:** `src/core/workflow.ts` (новый экспорт), `src/core/phase-transient.ts:370-378`, `src/agent/auto-report.ts:113-145`.

- В `src/core/workflow.ts` (рядом с `isTerminalStatus`, `:330`) добавить экспорт
  `terminalStatusGate(workflow, targetStatus, uncheckedAc: number[], uncheckedDod: number[]): { blocked: boolean; reason?: string }`:
  - `blocked = isTerminalStatus(workflow, targetStatus) && (uncheckedAc.length > 0 || uncheckedDod.length > 0)`;
  - `reason` — текст по образцу VL-309: `Статус не изменён: терминальный «<target>» при неотмеченных пунктах (DoD: #2; AC: #5) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «<prev>».` — prev передаётся параметром (сигнатура: `{ blocked, reason }`, prevStatus в opts).
  - Модуль остаётся без новых зависимостей (только `Task`/`Workflow`), чтобы его мог импортировать и `core/`, и `agent/`.
- `src/agent/auto-report.ts:113-145`: заменить локальный расчёт `uncheckedDodNumbers`/`uncheckedAcNumbers`/`terminalAtRisk`/`effectiveStatus` на вызов `terminalStatusGate` (номера пунктов считаются там же, `uncheckedItems` не трогаем). Поведение и текст отчёта сохранить байт-в-байт (тесты `auto-report.test.mjs` — регресс-барьер).
- `src/core/phase-transient.ts:370-378`: в успешной ветке после `const next = getStatusAfterPhase(...)` вызвать `terminalStatusGate(workflow, next, uncheckedAcNumbers, uncheckedDodNumbers)`; при `blocked`:
  - `updateTaskFile(cwd, taskKey, { status: entry.prevStatus })` (статус остаётся дофазовым),
  - `addComment(cwd, taskKey, reason, '@agent')`,
  - `return { ...base, outcome: 'failed' }` (исход `failed` — супервизор увидит «нет прогресса», а не «ok»).
  Номера неотмеченных пунктов считать по `task.acceptanceCriteria`/`task.definitionOfDone` (форма `{checked}` как в `auto-report.ts`).
- Тест: `src/core/phase-transient.test.mjs` — новая задача-фикстура `VL-912` в статусе `Review` с неотмеченным DoD; `markPhaseStarted(..., 'close')` + `finalizePhaseStatus(..., {exitCode:0})` → статус остался `Review`, в комментариях есть «Статус не изменён» и `#1`, `outcome === 'failed'`. Второй кейс: все пункты отмечены → `Done`, `outcome === 'ok'`.

### Шаг 2. `runHasProgress` требует отчёт для фаз с обязательным отчётом (AC2)

**Файл:** `src/agent/loop.ts` (`runHasProgress:793`, `failOnRepeatCap:858`, `RunLoopOptions` ~`:100-200`, вызов `runLoop` в `src/agent/cli.ts:855`).

- В `RunLoopOptions` добавить `phase?: string` (фаза рана; CLI передаёт `runPhase`).
- В `loop.ts` — константа `REPORT_REQUIRED_PHASES = new Set(['close'])` (фазы, где отчёт `backlog_finish_phase` обязателен; расширяемо).
- `runHasProgress()`: первой строкой — `if (reportRequired && !reportWritten) return false;` (до проверки следов работы). `reportRequired = REPORT_REQUIRED_PHASES.has(options.phase ?? '')`.
- `failOnRepeatCap` не меняется по структуре: при `!runHasProgress()` он уже вызывает `fail(errorText)` → `is_error: true`. Текст ошибки дополнить: при `reportRequired && !reportWritten` — «…работа в ране есть, но отчёт фазы (backlog_finish_phase) не записан — фаза не завершена».
- `src/agent/cli.ts:855`: передать `phase: runPhase` в `runLoop` (переменная `runPhase` объявлена на `:961` — вызов `runLoop` идёт раньше; перенести вычисление `runPhase`/`phaseName`/`envRunPhase` выше вызова `runLoop` либо передать `phase: phase ?? process.env.VIBELOG_RUN_PHASE ?? process.env.VIBELOG_PHASE_NAME` — выбрать первое, без дублирования логики).
- Регресс-тест: `src/agent/loop-repeat-cap.test.mjs` — новый кейс: `runLoop({ phase: 'close', ... })`, скрипт «успешный `git_commit` (или `run_shell_command` с `git merge`) → 10 повторов `lesson_update` с одинаковыми аргументами» → `res.is_error === true`, текст содержит «отчёт фазы … не записан». Второй кейс: тот же сценарий + успешный `backlog_finish_phase` → `is_error === false` (штатный выход сохранён).

### Шаг 3. Директива `appliedNoopDirective` называет шаг фазы (AC3)

**Файлы:** `src/agent/repeat-tracker.ts:883-895`, `src/agent/loop.ts:1197`.

- `appliedNoopDirective(name: string, lastAck?: AckNext, phase?: string)`: текст `message` собирается по фазе:
  - `close` → «…Переходи к следующему пункту фазы: отметь AC/DoD (`backlog_manage_ac`/`backlog_manage_dod`) и вызови `backlog_finish_phase`.»;
  - иначе — прежняя общая фраза (обратная совместимость с `repeat-tracker-vl357.test.mjs:83`).
  Фаза попадает и в `extra` (`{ applied_repeat: true, phase }`) — машиночитаемо.
- `loop.ts:1197`: передать `options.phase` третьим аргументом.
- Тест: `src/agent/repeat-tracker-vl357.test.mjs` — `appliedNoopDirective('lesson_update', undefined, 'close')` содержит `close` и `backlog_finish_phase`; без фазы — прежний текст.

### Шаг 4. Причина падения в ленте активности без `run_progress` (AC4)

**Файлы:** `src/core/activity.ts:188-195` (+ `MetaLite:150-165`), `src/agent/session.ts:204`, `src/agent/cli.ts:1156`, `src/web/orchestrator.ts:1345`.

- `SessionMeta.last_run` расширить аддитивно: `{ is_error?, finishedAt?, result?: string }` (обрезка 500 символов — как `abortedReason`). Запись: `cli.ts:1156` — `result: loopResult.result.slice(0, 500)`; `orchestrator.ts:1345` — `result: String(result.result ?? '').slice(0, 500)`.
- `MetaLite.last_run` в `activity.ts` — то же поле.
- `failureReason(meta)`: если `run_progress` нет (или пуст) — брать `meta.last_run.result` (сжатый в одну строку, обрезка 200); `undefined` возвращать только когда пусто и там. Формат: `причина: <result>`.
- Тест: `src/core/activity.test.mjs` — кейс «`fallback: true` + мета с `last_run: { is_error: true, result: 'Кап повторов исчерпан: …' }` без `run_progress`» → `phase_failed`, `summary` содержит текст причины и НЕ содержит «причина не записана». Существующий кейс «run_progress отсутствует → причина не записана» остаётся зелёным (мета без `last_run.result`).

### Шаг 5. Документация и проверка (AC5)

- `CHANGELOG.md` — запись в `## [Unreleased]` (строка 5), раздел «Исправлено»: гейт терминальности в `finalizePhaseStatus` (общая функция `terminalStatusGate`), критерий `runHasProgress` для фаз с обязательным отчётом, фазовая директива `appliedNoopDirective`, источник причины в ленте активности (`last_run.result`).
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` §6 (строка 405+): дополнить пункт про `failOnRepeatCap`/`runHasProgress` (критерий «отчёт обязателен для close») и пункт про директивы повтора (фаза в тексте); §4/§3.3 — строка про `last_run.result` как источник причины в ленте активности. README не трогать (лимит 150 строк, тест `readme-standard.test.mjs`).
- Проверка: `pnpm build && pnpm test` (полный прогон, без `--exclude`). Точечно перед полным: `pnpm build && npx vitest run src/core/phase-transient.test.mjs src/agent/loop-repeat-cap.test.mjs src/agent/repeat-tracker-vl357.test.mjs src/core/activity.test.mjs src/agent/auto-report.test.mjs`.

### Риски

- **R1 (регресс VL-124/349):** ужесточение `runHasProgress` может снова ронять Close, где отчёт физически не нужен (например, аварийная ветка шаблона). Митигация: `REPORT_REQUIRED_PHASES` содержит только `close`, а `fail()` в Close — штатный путь отката статуса + авто-resume; тест «отчёт записан → штатный выход» фиксирует обратную сторону.
- **R2 (двойной гейт):** `terminalStatusGate` вызывается и в авто-отчёте, и в `finalizePhaseStatus` — тексты должны совпадать, иначе тесты `auto-report.test.mjs` покраснеют. Митигация: одна функция, текст собирается в ней.
- **R3 (порядок в CLI):** перенос вычисления `runPhase` выше `runLoop` затрагивает пост-ран-блок (`:948-961`); правку делать минимальную (вычислить `runPhase` до `runLoop`, в пост-ране использовать ту же переменную), проверить `cli.test.mjs`.
- **R4 (объём меты):** `last_run.result` до 500 символов на сессию — приемлемо (мета уже хранит `run_progress.text`).
- **R5 (worktree):** правки только в `src/`, `CHANGELOG.md`, `backlog/docs/`; файлы `backlog/tasks/` не коммитить (MCP пишет в главный репо).
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Диагностика (чат, 2026-11-08)

Наблюдение пользователя: фаза close завершается кодом 0 с текстом «Кап повторов исчерпан: Модель 4 раз подряд повторила уже применённый вызов lesson_update», в блоке прогресса «Сделано: Now DoD list and lessons check», «Осталось: проверки не завершены, отчёт фазы не записан, AC/DoD не отмечены» — и задача при этом становится Done. Сессии `agent-1794083462754` (VL-366), `agent-1794083271195` (VL-365).

Три независимых дефекта складываются в ложное закрытие:

1. **`failOnRepeatCap` объявляет успех** (`src/agent/loop.ts`). При исчерпании `MAX_APPLIED/NOOP/ERROR_REPEATS_PER_RUN` ран завершается штатно (`is_error: false`), если `runHasProgress()` нашёл «след работы». Критерий слишком слабый: достаточно ОДНОГО успешного `edit`/`write_file`/`git_commit` (а с VL-361 — и shell-класса `git merge`/`pnpm build`/`pnpm test`). В close коммит документации идёт в начале, поэтому флаг взводится сразу и любой последующий кап повторов превращается в «успех».

2. **`finalizePhaseStatus` обходит гейт VL-309** (`src/core/phase-transient.ts:342`). Гейт «терминальный статус при неотмеченных AC/DoD не ставится» живёт только в `writeAutoReportIfMissing` (`src/agent/auto-report.ts`). Но статус двигают ДВА места, и второе проверки не имеет:
   ```ts
   if (!aborted && record.exitCode === 0 && record.result?.is_error !== true) {
     const next = getStatusAfterPhase(workflow, entry.prevStatus, phaseName) ?? entry.prevStatus;
     updateTaskFile(cwd, taskKey, { status: next });   // ← Done без проверки AC/DoD
   }
   ```
   Порядок пост-рана: `writeAutoReportIfMissing` → … → `finalizePhaseStatus`. Авто-отчёт честно оставляет Review, финализация следом видит `exitCode 0` + `is_error: false` и ставит Done. Гейт VL-309 перетирается.

3. **Директива `applied_repeat` не выводит модель из шага** (`src/agent/repeat-tracker.ts`, `appliedNoopDirective`). Текст «Переходи к следующему пункту фазы, а если работа сделана — к отчёту» — общая фраза; модель повторяет `lesson_update` дословно. Это причина зацикливания, а не следствие.

Плюс отдельное наблюдение по ленте активности: `phase_failed` показывает «Фаза close упала (причина не записана)». `failureReason()` (`src/core/activity.ts:188`) читает только `meta.run_progress`, а `run_progress` пишется лишь на путях wall-time/max-requests (`failWithProgress`). Обычный `fail()` и `failOnRepeatCap` без прогресса оставляют причину только в тексте результата рана — в мету она не попадает. Бот причину показывает (читает текст рана), лента — нет.

## Цель

Задача не должна закрываться, если не отмечены все AC/DoD — независимо от того, почему ран объявил успех. И причина падения должна быть видна в ленте активности без комментария в задаче.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 00:34
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не эпик).
План записан в задачу: 5 шагов, 9 файлов кода/тестов + CHANGELOG.md и doc-10.
Диагноз по коду:
1. `finalizePhaseStatus` (`src/core/phase-transient.ts:370-378`) ставит `produces_status` без гейта VL-309 — гейт живёт только в `writeAutoReportIfMissing` (`src/agent/auto-report.ts:113-145`).
2. `runHasProgress()` (`src/agent/loop.ts:793-856`) считает успех по одному следу работы → `failOnRepeatCap` (`:858`) завершает Close штатно без отчёта.
3. `appliedNoopDirective` (`src/agent/repeat-tracker.ts:883`) не знает фазы; вызов из `loop.ts:1197` без фазы.
4. `failureReason()` (`src/core/activity.ts:188-195`) читает только `run_progress` → «причина не записана» при падении через `fail()`.
Решения:
- Шаг 1: новая общая функция `terminalStatusGate` в `src/core/workflow.ts` (одна проверка на два пути — авто-отчёт и `finalizePhaseStatus`), исход `failed` при блокировке.
- Шаг 2: `RunLoopOptions.phase` + `REPORT_REQUIRED_PHASES = {close}`; `runHasProgress` возвращает false без `reportWritten`; CLI передаёт `runPhase` (вычисление поднять выше `runLoop`).
- Шаг 3: третий параметр `phase` в `appliedNoopDirective` с конкретным шагом для close.
- Шаг 4: аддитивное `last_run.result` (500 симв.) в мете (CLI + оркестратор) как fallback-источник причины в ленте.
- Шаг 5: CHANGELOG `[Unreleased]` + doc-10 §6/§3.3; README не трогаем (лимит 150 строк).
Риски: R1 — ужесточение `runHasProgress` может снова ронять Close (митигация: только `close` в наборе, тест «отчёт записан → штатный выход»); R2 — расхождение текстов двух гейтов (одна функция); R3 — перенос вычисления `runPhase` в CLI затрагивает пост-ран; R4 — объём меты; R5 — файлы `backlog/tasks/` не коммитить.
Проверка: `pnpm build && pnpm test` (полный прогон) + точечный прогон 5 затронутых тест-файлов.
---
author: @agent
created: 2026-11-08 00:40
---
Фаза 3 (Code) выполнена. Коммит f56d5cf.
Изменено (13 файлов):
- `src/core/workflow.ts` — новый экспорт `terminalStatusGate(workflow, targetStatus, uncheckedAc, uncheckedDod, prevStatus)` + тип `TerminalStatusGateResult`: одна проверка «терминальный статус при неотмеченных AC/DoD» с готовым текстом причины (образец VL-309).
- `src/core/phase-transient.ts` — `finalizePhaseStatus` в успешной ветке применяет `terminalStatusGate`: при блокировке статус остаётся `prevStatus`, в задачу пишется комментарий-причина с номерами неотмеченных AC/DoD, исход `failed` (супервизор видит «нет прогресса», а не «ok»).
- `src/agent/auto-report.ts` — локальная копия гейта заменена вызовом `terminalStatusGate` (текст отчёта сохранён байт-в-байт, `auto-report.test.mjs` зелёный).
- `src/agent/loop.ts` — `RunLoopOptions.phase`, константа `REPORT_REQUIRED_PHASES = {close}`; `runHasProgress()` возвращает false без `reportWritten` для таких фаз; `failOnRepeatCap` дописывает в текст «отчёт фазы (backlog_finish_phase) не записан — фаза не завершена»; `appliedNoopDirective` получает `options.phase`.
- `src/agent/repeat-tracker.ts` — `appliedNoopDirective(name, lastAck?, phase?)`: для close текст называет шаг «отметь AC/DoD (backlog_manage_ac/backlog_manage_dod) и вызови backlog_finish_phase», фаза уходит и в `extra.phase`.
- `src/core/activity.ts` — `failureReason()` при отсутствии `run_progress` берёт `last_run.result` (сжатие в строку, обрезка 200); `MetaLite.last_run.result`.
- `src/agent/session.ts` — `SessionMeta.last_run.result?: string`.
- `src/agent/cli.ts` — `loopRunPhase` вычисляется до `runLoop` и передаётся в `phase`; в мету пишется `last_run.result` (обрезка 500).
- `src/web/orchestrator.ts` — паритет: `last_run.result` в мете qwen-рана.
- Тесты: `src/core/phase-transient.test.mjs` (VL-912 close с неотмеченным DoD → Review + комментарий + outcome failed; VL-913 все отмечены → Done/ok), `src/agent/loop-repeat-cap.test.mjs` (close: коммит + кап `lesson_update` → is_error:true; с отчётом → штатно; code — прежнее поведение), `src/agent/repeat-tracker-vl357.test.mjs` (директива close содержит фазу и `backlog_finish_phase`), `src/core/activity.test.mjs` (причина из `last_run.result` без `run_progress`).
Проверки: `pnpm build` — чисто; точечный прогон 5 затронутых файлов — 63 теста зелёные; полный `pnpm test` — 195 файлов, 3667 тестов passed, 4 skipped (пропуски — предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`, не связаны с задачей), исключений/`--exclude` не было.
Что осталось (AC5, часть про документацию): CHANGELOG.md и doc-10 §6 в фазе Code по правилам не правятся — их пишет фаза Close после merge. Полный прогон тестов (первая часть AC5) выполнен и зелёный.
---
author: @agent
created: 2026-11-08 00:44
---
Фаза Close выполнена. Ветка vb/vl-368 слита в master (1 коммит f56d5cf, merge 5c9f6bd), worktree удалена (force — только untracked-симлинк backlog/references/data), ветка vb/vl-368 удалена.
Проверки после merge: `pnpm build` — чисто; ранний точечный фильтр по diff (phase-transient, loop-repeat-cap, repeat-tracker-vl357, activity, auto-report) — 63 теста зелёные; полный `pnpm test` — 195 файлов, 3667 passed, 4 skipped (предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`), без `--exclude`/`--skip`. Повторных прогонов не было.
Документация (коммит 71ad7df): CHANGELOG.md — запись в `## [Unreleased]` → «Исправлено» (все четыре корня: гейт терминальности в `finalizePhaseStatus` через общий `terminalStatusGate`, критерий `runHasProgress` для фаз с обязательным отчётом, фазовая директива `appliedNoopDirective`, источник причины в ленте активности `last_run.result`); doc-10 §6 — новый пункт про обязательность отчёта фазы и фазовую директиву, §6.6 п.4 — про `last_run.result` как источник причины. README не тронут.
Урок: lesson-250 «Выноси инвариант-гейт в одну функцию, если статус ставят два пути» (коммит 53c1205), связан с задачей.
DoD: 1 «Тесты проходят» — выполнен (полный прогон зелёный); 2 «Документация обновлена» — выполнен (CHANGELOG + doc-10); 3 «Нет регрессий» — выполнен (полный прогон без падений, `auto-report.test.mjs` зелёный байт-в-байт). Все AC 1–5 отмечены.
---
<!-- COMMENTS:END -->