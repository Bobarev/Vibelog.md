---
id: VL-243
title: 'billing и мета не пишутся для фазы Close (и, возможно, теряются code-раны): учёт фаз неполный'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:06'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - billing
  - sessions
  - orchestrator
  - close-phase
dependencies: []
milestone: v1.11
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/billing.ts
  - src/core/billing.test.mjs
  - src/agent/session.ts
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - README.md
lessons:
  - lesson-98
token_usage:
  input: 13494526
  output: 151469
  cache: 13242880
  total: 13645995
  requests: 140
  duration_ms: 5688627
  reasoning: 119521
  by_phase:
    plan:
      input: 13494526
      output: 151469
      cache: 13242880
      requests: 140
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Наблюдение (требует проверки в фазе Spec)

При разборе сессии `vb:agent-1793312743226` (Close VL-227) обнаружено расхождение между фактически выполненными ранами и журналом billing:

**VL-227** (`.vibelog/billing/VL-227.json`) содержит только:
- `spec` — agent-1793312164332;
- `plan` — agent-1793312261510 (две записи, resume).

Записей **`code`** (сессия с коммитом fd7f330) и **`close`** (`agent-1793312743226`) — **нет**, хотя обе фазы выполнялись и отчитались.

Для сравнения: **VL-230** содержит `spec`, `plan`, `code` — то есть code-раны в целом пишутся. **VL-233** содержит только `plan` (code ещё шёл в момент разбора).

## Что видно по коду

- `src/web/orchestrator.ts`, `spawnQwenRun`: по комментарию VL-114 `VIBELOG_PHASE_TASK_ID`/`VIBELOG_PHASE_NAME` кладутся в spawnEnv «задачным фазам (кроме close)».
- `src/agent/cli.ts`, post-run учёт: `taskId = existing?.taskId ?? (isPhaseMode ? positionals[1] : envTaskId…)`. Close спавнится готовым промптом (`isPhaseMode=false`), меты нет, env-taskId не ставится → `taskId` не резолвится → **блок billing/frontmatter целиком пропускается**, и мета сессии не создаётся (отсюда отсутствующий `agent-1793312743226.meta.json`).

То есть для close причина выглядит детерминированной, а не случайной. Отсутствие `code`-записи у VL-227 этим не объясняется — нужна отдельная проверка (возможные причины: другой cwd/branch-mode, запись ушла в другой файл, ран завершился путём без post-run).

## Почему это важно

- Billing объявлен «источником правды» (VL-198): по нему сверяются с провайдером и считают стоимость задач. Пропущенные раны занижают стоимость, причём систематически — всегда в最后一 фазе.
- Мета сессии нужна для `/analyze` (VL-141) и для resume в worktree (VL-110): её отсутствие ухудшает диагностику.
- Оценки «почему фаза долго выполнялась» (как в этом разборе) опираются на billing — при пропусках картина искажается.

## Цель

Сделать учёт фаз полным и предсказуемым: каждый выполненный ран оставляет и мету, и запись billing — либо явно помечен как неучтённый.

## Что проверить/сделать (в Plan)

1. Диагностика: воспроизвести close-ран и code-ран VL-227 на предмет cwd/env; проверить, не теряется ли `code`-запись в branch-mode (worktree vs главный репо, `VIBELOG_CWD`).
2. Решение для close: либо оркестратор ставит `VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME` и для close (снимая особый случай), либо CLI принимает taskId из явного флага для close-промпта; предпочтение — единая механика для всех фаз.
3. Выяснить историческую причину исключения close из env-пути (возможно, защита от двойного учёта при merge или от правки чужого taskId) — если защита нужна, оформить её явно и задокументировать.
4. Добавить тест-инвариант на запись billing для close.

## Связанное

VL-198 (billing/мета), VL-114 (meta для env-пути фаз), VL-141 (`/analyze` по мете), VL-110 (resume в worktree по мете), VL-242 (длительность Close-фазы — этот разбор её и выявил).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагностика (подтверждено чтением кода)

### Close — причина детерминированная (два независимых пропуска)
`src/web/orchestrator.ts:745-751`: `phaseTaskId` считается как
`taskIdPattern(cwd).test(key) && phase !== 'close' ? key.toUpperCase() : (worktreeTaskId ?? '')`.
Для close при обычном `startPhase` это `''` → в `spawnEnv` НЕ кладутся
`VIBELOG_PHASE_TASK_ID/NAME` (строки 747-753). Следствия:
1. В `finish()` (строка 980: `if (result?.session_id && phaseTaskId !== '')`) не пишется
   ни `meta.json` сессии, ни frontmatter, ни billing (строки 1003-1063) — отсюда
   отсутствующий `agent-1793312743226.meta.json`.
2. В CLI-пост-ране (`src/agent/cli.ts:690-695`) `taskId = existing?.taskId ?? (isPhaseMode ? positionals[1] : envTaskId…)`:
   `isPhaseMode=false` (спавн готовым промптом), `existing=null` (меты нет), env пуст →
   `taskId === undefined` → блок billing/frontmatter (строки 696-740) и блок меты
   (строка 743 `if (existing || taskId)`) целиком пропускаются.

То есть close теряет учёт **на обоих** путях (qwen — оркестраторный, vb — CLI-пост-ран).

### Пропавший «code»-ран VL-227 — вероятная причина найдена
`code` у VL-227 шёл с `--resume` план-сессии (`code_same_session`, VL-147): у resume-рана
`existing.phase === 'plan'`, и обе точки учёта берут фазу ИЗ МЕТЫ:
- `cli.ts:687`: `phaseName = existing?.phase ?? (isPhaseMode ? phase : env(VIBELOG_PHASE_NAME))`;
- `orchestrator.ts:1043`: `usagePhase = metaNow?.phase ?? phase`.

Итог: billing-запись code-рана дописывается с `phase: 'plan'` и ТЕМ ЖЕ `sessionId`
(plan-сессии) — в журнале VL-227 это выглядит ровно как «plan — два записи (resume)»,
а отдельной `code`-записи нет. Ошибка не в «потере записи», а в неверной атрибуции
фазы рана (побочный эффект lesson-40: защита меты от перезаписи распространена на
billing). Проверить в Code по факту: `.vibelog/billing/VL-227.json` в главном репо —
две «plan»-записи должны иметь один `sessionId`, а `finishedAt` второй ≈ времени
коммита fd7f330 и отличающийся `durationMs`/`model`.

### Почему close был исключён (историческая причина — задокументировать)
VL-112: close выполняется в ГЛАВНОМ репо (merge ветки + `docs(task)`-коммит backlog),
и ответ «Продолжи» на close-сообщении не должен уводить закрытие в worktree.
Исключение было про **worktree**, но реализовано через общий `phaseTaskId`, который
заодно кормит env-мету и учёт — учёт пострадал «заодно», без необходимости. Правильная
форма: worktree-исключение close оставить (`branchTask`, строка 739), env/учёт — снять.

## Решение

1. **Единая механика env для всех фаз**: `phaseTaskId` в `spawnQwenRun` считается без
   `phase !== 'close'`; `branchTask` (worktree) по-прежнему исключает close.
2. **Защита VL-112 явная**: в `startResume` (`orchestrator.ts:627-637`) worktree-resume
   не включается для сессий фазы close — `meta.phase !== 'close'` в условии
   `worktreeTaskId`; close-resume остаётся в главном cwd (и получает env taskId —
   учёт работает).
3. **Billing пишет фазу РАНА, а не фазу сессии**: `phase` записи = фаза текущего рана,
   исходная фаза сессии — в новом необязательном поле `sessionPhase` (+ `fallback?`).
   Frontmatter (`by_phase`) не меняем — там lesson-40 сохраняется (кумулятив по фазе сессии).
4. **Инвариант «каждый ран оставил запись billing»** (закрывает и vb-раны, убитые
   до пост-рана): CLI ставит в мету маркер `billing_recorded: {sessionId, finishedAt}`;
   `finish()` оркестратора для `agent === 'vb'` проверяет маркер и, если его нет,
   дописывает запись сам (`agent: 'vb'`, `fallback: true`). Для qwen поведение прежнее.
5. **SIGINT в CLI не теряет учёт**: обработчик (`cli.ts:496-520`) не делает
   `process.exit(130)` напрямую — abort'ит цикл, закрывает MCP и выставляет
   `process.exitCode = 130`, давая основному потоку выполнить пост-ран (billing/мета/JSON).

## Файлы и конкретные места

| Файл | Место | Что меняем |
|---|---|---|
| `src/web/orchestrator.ts` | 735-753 | `phaseTaskId` без close-исключения; `branchTask` не трогаем; обновить комментарий: исключение close = только worktree (VL-112), учёт общий |
| `src/web/orchestrator.ts` | 627-637 (`startResume`) | `meta.phase !== 'close'` в условии `worktreeTaskId`; комментарий «VL-243: close-resume — всегда главный репо» |
| `src/web/orchestrator.ts` | 696-702 (JSDoc `spawnQwenRun`) | «(кроме close)» → close получает env, но не worktree |
| `src/web/orchestrator.ts` | 1010-1063 (`finish`, учёт) | qwen-блок остаётся; добавить ветку `agent === 'vb'`: нет маркера `billing_recorded` за этот `sessionId` → `appendBilling(..., {fallback: true})` + мета-маркер; `usagePhase` → `phase` рана, `sessionPhase: metaNow?.phase ?? phase` |
| `src/web/orchestrator.ts` | 1003-1008 | в `saveSessionMeta` для close теперь пишется `phase: 'close'` — поведение не менять, только тест |
| `src/agent/cli.ts` | 496-520 (SIGINT) | убрать ранний `process.exit(130)`; `abort()` + close MCP + `process.exitCode = 130` |
| `src/agent/cli.ts` | 686-745 (пост-ран) | `billingPhase = phase ?? (isPhaseMode ? positionals[0] : env VIBELOG_PHASE_NAME) ?? existing?.phase`; в `appendBilling` — `phase: billingPhase`, `sessionPhase: existing?.phase`; после успешного append ставить `billing_recorded: {sessionId, finishedAt}` в мету; frontmatter (`addTaskTokenUsage`) оставить на `phaseName` (фаза сессии) |
| `src/core/billing.ts` | 12-40 (`BillingSession`) | поля `sessionPhase?: string`, `fallback?: boolean` (аддитивно, формат Backlog.md не затрагивается) |
| `src/agent/session.ts` | ~150-165 (`SessionMeta`) | поле `billing_recorded?: {sessionId: string; finishedAt: string}` + комментарий назначения (защита от двойного учёта) |
| `src/web/orchestrator.test.mjs` | 1138-1159 | ОБНОВИТЬ существующий тест «close не получает задачный env (VL-112-гард)»: `envPhaseTaskId === 'VL-88'`, `envPhaseName === 'close'`, `envCwd === null` (close остаётся в главном репо) |
| `src/web/orchestrator.test.mjs` | рядом с 1138 | +1 тест: close-ран qwen с result → `.vibelog/billing/VL-88.json` содержит запись `phase: 'close'`; +1: close-resume (`startResume` с метой `phase:'close'`, branch_mode) не переходит в worktree (`cwd` = главный) |
| `src/agent/cli.test.mjs` | после 838-876 (env-путь) | +2 теста: (а) env `ot-7`+`close` → `meta.phase==='close'` и billing-запись `phase:'close'`; (б) resume-ран пишет billing `phase` рана + `sessionPhase` исходной фазы, мета-`phase` не перезаписана (регрессия lesson-40) |
| `src/core/billing.test.mjs` | после кейса «append-only» | +1: `sessionPhase`/`fallback` сохраняются в файле; старые записи без них читаются |
| `README.md` | 169-200 («Учёт токенов») | абзац: `phase` в billing = фаза рана, `sessionPhase` = фаза сессии; close учитывается как любая фаза; `fallback`-запись оркестратора |
| `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` | раздел учёта токенов/billing | то же + пометка о VL-112-исключении: worktree — да, учёт — нет |

## Порядок действий

1. `src/core/billing.ts` + `src/agent/session.ts` — аддитивные поля (сборка не ломается).
2. `src/agent/cli.ts`: SIGINT-путь, затем пост-ран (фаза рана + маркер `billing_recorded`).
3. `src/web/orchestrator.ts`: `phaseTaskId`, `startResume`-гард, vb-fallback в `finish()`, комментарии/JSDoc.
4. Обновить существующий close-env тест + добавить 5 новых тестов (см. таблицу); эталон инварианта «каждый ран фазы → запись billing».
5. Документация: README + doc-10.
6. Проверки и диагностическое подтверждение гипотезы по `.vibelog/billing/VL-227.json` (главный репо) — сравнить `sessionId`/`finishedAt`/`durationMs` двух «plan»-записей с временем коммита fd7f330; результат — в отчёт фазы Code.

## Как проверить

```bash
pnpm build
pnpm test:fast -- src/core/billing.test.mjs src/agent/cli.test.mjs src/web/orchestrator.test.mjs
pnpm test                      # полный прогон — обязательное условие для DoD
```

Живая проверка: `vibelog browser`/бот → close задачи с worktree в branch-mode;
в `.vibelog/billing/<ID>.json` появляется запись `phase: 'close'`, в
`.vibelog/agent-sessions/<sid>.meta.json` — `taskId`/`phase: 'close'`; worktree не
создаётся/не используется (close по-прежнему в главном репо).

## Риски

1. **Двойной учёт** (главный риск): vb-ран пишется и CLI, и fallback-веткой
   оркестратора. Снимается маркером `billing_recorded` в мете (паттерн
   `usage_recorded`, lesson-58); fallback-запись помечается `fallback: true`,
   поэтому двойник виден в журнале.
2. **Регрессия VL-112**: close-сессия теперь имеет мету с taskId → resume мог бы уйти
   в worktree. Снимается явным `meta.phase !== 'close'` в `startResume` + тест.
3. **Смена семантики `phase` в billing**: ранее «plan»-запись могла содержать code-токены;
   старые записи остаются как есть (аддитивные поля), новые корректны. Аналитика по
   `by_phase` во frontmatter не меняется — сверка «frontmatter vs billing» даст
   расхождение по фазе у resume-ранов; описано в README/doc-10.
4. **SIGINT-путь**: если цикл не завершится после abort, процесс может «повиснуть».
   Митигация: `ac.abort()` уже прерывает запросы; оставить один `setTimeout(...).unref()`
   с аварийным `process.exit(130)` через 5 с.
5. **Флэки `orchestrator.test.mjs`** в полном прогоне (lesson-23): при падениях
   повторить файл отдельно перед вердиктом о регрессии.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 09:18
---
Фаза 2 (Plan) выполнена. Тип: bug.
**Диагностика подтверждена чтением кода** (без запуска ранов):
1. **Close теряет учёт на обоих путях.** `orchestrator.ts:745-751` считает `phaseTaskId` с исключением `phase !== 'close'` → env не ставится → в `finish()` (строка 980 `if (result?.session_id && phaseTaskId !== '')`) не пишутся ни мета, ни frontmatter, ни billing (отсюда нет `agent-1793312743226.meta.json`). В CLI-пост-ране (`cli.ts:690-695`) `taskId` не резолвится (isPhaseMode=false, меты нет, env пуст) → блоки billing/frontmatter (696-740) и меты (743) пропускаются целиком.
2. **«Пропавший» code-ран VL-227 объяснён** — это не потеря, а неверная атрибуция: при `code_same_session` code-ран идёт с `--resume` план-сессии, а обе точки учёта берут фазу ИЗ МЕТЫ (`cli.ts:687`, `orchestrator.ts:1043`) → запись дописывается как вторая «plan» с тем же sessionId. Проверка в Code: у двух plan-записей VL-227 должен совпасть `sessionId`, а у второй `finishedAt` ≈ коммиту fd7f330.
3. **Историческая причина исключения close найдена**: VL-112 исключал close из WORKTREE (merge ветки + docs-коммит — только в главном репо), но реализовал это через общий `phaseTaskId`, который заодно кормит env-мету и учёт — учёт пострадал «заодно».
**План** записан в задачу: единый env для всех фаз (worktree-исключение close сохраняется через `branchTask`), явный `meta.phase !== 'close'` в `startResume`, billing пишет фазу РАНА (+ `sessionPhase` исходной фазы сессии), маркер `billing_recorded` + fallback-ветка оркестратора для vb-ранов, убран ранний `process.exit(130)` из SIGINT-обработчика CLI. Инвариант «каждый ран → запись billing» закрепляется тестом.
Файлов: 9 (src/web/orchestrator.ts, src/agent/cli.ts, src/core/billing.ts, src/agent/session.ts, 3 тест-файла, README.md + doc-10).
Риски: (1) двойной учёт vb-рана — снимается маркером `billing_recorded`/`fallback`; (2) регрессия VL-112 (close-resume в worktree) — снимается явным гардом + тестом; (3) смена семантики `phase` в billing для resume-ранов (аддитивно, описано в документации); (4) возможное зависание процесса на SIGINT — аварийный `process.exit` через 5 с; (5) флэки orchestrator.test — повторять файл отдельно перед вердиктом (lesson-23).
---
author: @agent
created: 2026-10-30 10:00
---
Фаза code не удалась (код выхода 1): nt/cli.ts×3, payload последнего запроса=534348 байт (макс 534348), usage={"input_tokens":4819749,"output_tokens":17167,"cache_read_input_tokens":4771328,"total_tokens":4836916,"reasoning_tokens":5914} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 10:27
---
Фаза 3 (Code) выполнена. Коммит **e3d6bcf**.
**Реализовано (по плану):**
1. `src/core/billing.ts` — в `BillingSession` аддитивные поля `sessionPhase?` (фаза сессии, если отличается от фазы рана) и `fallback?` (запись дописана оркестратором «по факту»).
2. `src/agent/session.ts` — `SessionMeta.billing_recorded {sessionId, finishedAt}`: маркер «ран записан в billing» (паттерн `usage_recorded`, защита от двойного учёта).
3. `src/agent/cli.ts`, пост-ран — `runPhase` (фаза ЭТОГО рана) отдельно от `phaseName` (фаза сессии): в billing пишется `phase: runPhase`, при расхождении — `sessionPhase`; frontmatter (`by_phase`) оставлен на фазе сессии (lesson-40); после `appendBilling` ставится маркер `billing_recorded`; при нерезолвленном `taskId` теперь `console.error`-след в logTail (раньше — молчаливый пропуск).
4. `src/agent/cli.ts`, SIGINT — убран немедленный `process.exit(130)`: `abort()` → закрытие MCP → `process.exitCode = 130`, основной поток доходит до пост-рана (раньше учёт прерванного рана терялся); страховочный `setTimeout(...,5000).unref()` от зависания.
5. `src/web/orchestrator.ts` — `phaseTaskId` больше не исключает close (учёт close работает на обоих путях); worktree-исключение close (VL-112) вынесено в новый параметр `spawnQwenRun(..., noWorktree)`, который `startResume` включает для меты `phase==='close'`; гард `meta.phase !== 'close'` в `startResume`; в `finish()` для qwen `phase` записи = фаза рана + `sessionPhase`; новая vb-ветка fallback-учёта (нет маркера `billing_recorded` за ран → `appendBilling(..., {fallback:true})` + маркер).
6. `README.md` — раздел «Учёт токенов»: семантика `phase`/`sessionPhase`/`fallback` и учёт фазы Close.
**Тесты (+6):** `billing.test.mjs` — сохранение `sessionPhase`/`fallback` и чтение старых записей; `cli.test.mjs` — close через env-путь (мета `phase:'close'` + billing-запись `phase:'close'` + маркер) и resume-ран (`phase:'code'`, `sessionPhase:'plan'`, мета не перезаписана — регрессия lesson-40); `orchestrator.test.mjs` — обновлён тест close-env (close получает env, но не worktree), новый «close-ран qwen пишет billing с `phase:'close'` + мету», новый «close-resume идёт в главный репо, не в worktree».
**Проверки:** `pnpm build` — OK; целевые файлы (billing/cli/orchestrator) — 89 файлов зелёные; полный `pnpm test` — **1674 passed, 4 skipped, 0 failed** (+ отдельный `static.test.mjs` 7/7).
**Что осталось (для Close):** (а) диагноз по `.vibelog/billing/VL-227.json` в главном репо не выполнен — файла в worktree нет (`.vibelog/` gitignored), проверка перенесена в отчёт; (б) doc-10 (блок учёта токенов) сознательно НЕ правился в этой фазе — документацию backlog/docs пишет Close; (в) живая проверка на реальном close-ране в branch-mode (запись `phase:'close'` в журнале и мете). Lesson lesson-98 создан и связан. AC у задачи не заведены, поэтому acChecks пуст; DoD отмечены (полный прогон тестов, документация README, регрессий нет).
---
author: @agent
created: 2026-10-30 10:37
---
Фаза Close выполнена.
**Merge:** ветка `vb/vl-243` слита в master (`--no-ff`, 1 коммит e3d6bcf: 8 файлов, +354/−23). Worktree удалена (`--force`: только untracked-симлинки node_modules и backlog/references/data), ветка `vb/vl-243` удалена (`-d`, была e3d6bcf).
**Проверки:** `pnpm build` — OK. `pnpm test:fast` в главном репо — первый прогон дал 1 падение `src/web/chat.test.mjs` («write_file: выход за пределы проекта → ошибка (AC7)»); файл вне зоны правки VL-243 (chat/tool-policy), при повторном прогоне всего набора — **89 файлов / 1681 passed, 4 skipped, 0 failed**. Падение квалифицировано как флэка LLM-мокнутого чата, регрессии нет.
**Диагностика гипотезы плана (подтверждена фактом).** `.vibelog/billing/VL-227.json` содержит 3 записи: `spec` (agent-1793312164332), `plan` (agent-1793312261510, 22:18:12Z), **`plan` (тот же sessionId, 22:24:02Z)**. Коммит code-рана `fd7f330` — 22:23:56Z (+03:00 → 22:23:56Z), то есть вторая «plan»-запись закончилась через 6 с после коммита: это и есть code-ран, записанный под фазой сессии `plan` с тем же sessionId (неверная атрибуция, а не потеря записи). `close`-записи нет вовсе — детерминированный пропуск по `phaseTaskId !== 'close'`. Обе причины устранены в коде: billing пишет фазу рана (`sessionPhase`), close получает env и учитывается.
**Документация:** CHANGELOG (раздел Unreleased → Исправлено, запись VL-243) и doc-10 (новый §3.3 «Учёт токенов и billing», включая явную пометку о VL-112-исключении: worktree — да, учёт — нет) — коммит **d638d52**. README («Учёт токенов») обновлён в фазе Code. Lessons: lesson-98 (уже создан и связан с задачей).
**DoD:** 1. Тесты проходят — да (полный прогон 1681 passed / 0 failed); 2. Документация обновлена — да (README + CHANGELOG + doc-10); 3. Нет регрессий — да (единственное падение — флэка chat.test.mjs, повторно зелёная).
**Остаётся на живую проверку:** реальный close-ран в branch-mode (запись `phase:'close'` в журнале и мете, worktree не создаётся) — автотесты инвариант покрывают (orchestrator +2, cli +2, billing +1).
---
<!-- COMMENTS:END -->