---
id: VL-259
title: 'Мета сессии не обновляет phase при смене фазы, а записи resume в billing имеют одинаковый startedAt — восстановить историю ранов'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 12:16'
updated_date: '2026-10-30 14:37'
due_date: ''
labels:
  - sessions
  - billing
  - orchestrator
  - bug
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
  - src/agent/session.ts
  - src/core/billing.ts
  - src/agent/cli.ts
  - src/web/orchestrator.ts
  - src/mcp/tools.ts
  - src/agent/session.test.mjs
  - src/core/billing.test.mjs
  - src/agent/cli.test.mjs
  - src/web/orchestrator.test.mjs
  - src/mcp/server.test.mjs
  - README.md
lessons:
  - lesson-108
token_usage:
  input: 15101688
  output: 155570
  cache: 14519296
  total: 15257258
  requests: 166
  duration_ms: 4401287
  reasoning: 114964
  by_phase:
    plan:
      input: 14200656
      output: 148634
      cache: 13719040
      requests: 145
    close:
      input: 901032
      output: 6936
      cache: 800256
      requests: 21
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

VL-243 (Done) исправила атрибуцию фазы в **billing**: запись теперь пишется с фазой рана (`phase`) + `sessionPhase`. Но в разборе сессии VL-235 (`agent-1793328615846`) остаются два нерешённых расхождения, которые я видел собственными глазами:

1. **Мета сессии по-прежнему лжёт о фазе.** `.vibelog/agent-sessions/agent-1793328615846.meta.json` содержит `"phase":"plan"`, хотя Plan закрылся на строке 106 транскрипта («Готово» после записи `implementationPlan`), а раны 2–3 шли под промптом «Фаза 3: Code». Из-за этого при разборе легко сделать неверный вывод («сгорела фаза Plan» — ровно та неточность, которую пришлось править в VL-254).
2. **Записи resume в billing неразличимы.** В `.vibelog/billing/VL-235.json` 5 записей, у 4 из них **одинаковый `startedAt`: `2026-10-30T03:30:47.654Z`**, при разных `finishedAt`. Старт рана не отражает фактическое начало рана (похоже, берётся время создания сессии), поэтому длительность рана и «первый/последний ран» по журналу не восстановить.
3. **`token_usage.by_phase` задачи искажён** тем же механизмом: у VL-235 в `by_phase` есть только `plan` (163 запроса), хотя значительная часть расхода — Code-раны.

## Цель

Чтобы по мете и журналу можно было однозначно восстановить: сколько было ранов, в какой фазе шёл каждый, когда он реально начался и сколько стоил.

## Что сделать (уточнить в Plan)

1. Мета: при старте каждого рана (`startResume` / vb-ран) обновлять `meta.phase` фактической фазой рана; добавить историю `meta.runs: [{phase, startedAt, finishedAt, sessionId}]` (или массив `phases`), не ломая текущий формат для читателей (`phase` остаётся как фаза последнего рана).
2. Billing: `startedAt` записи = фактическое начало рана, а не сессии; `sessionId` сохраняется, чтобы связь с сессией не терялась. Мигрировать чтение старых записей (нет отдельного поля — считать, что `startedAt` ненадёжен; не падать).
3. `token_usage.by_phase` задачи: агрегировать по фазе рана (`runPhase`), а не по фазе сессии (согласовать с семантикой VL-243: `phase` vs `sessionPhase`).
4. Тест-инвариант: сессия из 3 ранов (plan → code → code) даёт мету с 3 записями в истории и billing-записи с разными `startedAt` и правильными `phase`, `by_phase` содержит и plan, и code.

## Связанное

VL-243 (billing-атрибуция — сделано; здесь остаток по мете/таймингам/агрегату), VL-258 (обзор транскрипта — тоже должен показывать смену фаз), VL-239 (модель в мете), VL-254 (разбор, в котором эта неточность дала неверный вывод о фазе).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Мета сессии хранит историю ранов `runs: [{phase, startedAt, finishedAt, sessionId}]` (заполняется на каждом ране — CLI пост-ран и finish() оркестратора) и `lastRunPhase`; поле `phase` остаётся фазой СОЗДАНИЯ сессии (инвариант findTaskPhaseSessionSync / VL-147), отсутствие полей у старых мет — не ошибка
- [x] #2 Billing: `startedAt` записи = фактическое начало рана (env VIBELOG_RUN_STARTED_AT от оркестратора, иначе старт процесса CLI), `sessionId` сохраняется, добавлено поле происхождения `startedAtKind`; для старых записей без него есть хелпер чтения, восстанавливающий начало рана как finishedAt − durationMs (без падений)
- [x] #3 `token_usage.by_phase` задачи агрегируется по фазе РАНА (runPhase): CLI-пост-ран, finish_phase (через env VIBELOG_RUN_PHASE) и qwen-блок оркестратора пишут ключ раны, а не фазы сессии
- [x] #4 Тест-инвариант: сессия из 3 ранов (plan → code → code) даёт мету с 3 записями в runs, три billing-записи с разными startedAt (ни один не равен startedAt сессии) и правильными phase, by_phase задачи содержит и plan, и code
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решения (после изучения кода)

Факты из кода:
- `meta.phase` — не «фаза последнего рана», а **фаза создания сессии**: по ней работает `findTaskPhaseSessionSync` (`src/agent/session.ts:319-357`), через который `code_same_session` (VL-147) и retry авто-очереди (VL-200) находят план-сессию. Переприсваивать `phase` фазе рана = воскресить инцидент VL-185 / нарушить lesson-40. Поэтому: `phase` остаётся фазой сессии, а история ранов пишется **аддитивно** — `runs[]` + `lastRunPhase`. Так у меты появляется вся правда о ранах, а читатели `phase` не ломаются (AC1).
- `startedAt` в billing сейчас = `existing?.startedAt`/`metaNow?.startedAt` — это время создания сессии (`src/agent/cli.ts:759`, `src/web/orchestrator.ts:1083` и `:1136`). Отсюда 4 одинаковых `startedAt` у 4 resume-ранов VL-235.
- `by_phase` пишется ключом фазы сессии: CLI `addTaskTokenUsage(..., phaseName, ...)` (`src/agent/cli.ts:728`), `finish_phase` — `finalPhase` (`src/mcp/tools.ts:1634`), qwen-блок — `usagePhase = metaNow?.phase ?? phase` (`src/web/orchestrator.ts:1067`).
- `spawnQwenRun` уже кладёт в `spawnEnv` `VIBELOG_PHASE_TASK_ID/NAME` (`src/web/orchestrator.ts:773-777`) — туда же добавляются `VIBELOG_RUN_PHASE` и `VIBELOG_RUN_STARTED_AT`; они наследуются и агентским процессом, и его MCP-сервером (MCP получает `{...process.env, VIBELOG_SESSION_ID}`).

## Файлы и правки (по порядку)

### 1. `src/agent/session.ts`
- **~127-192** (`interface SessionMeta`): новые поля с JSDoc:
  - `lastRunPhase?: string` — фаза последнего рана (для читателей «в какой фазе шёл последний ран»; `phase` не переприсваивается — инвариант VL-147/lesson-40).
  - `runs?: SessionRun[]` — история ранов, кап `RUN_HISTORY_MAX = 50` (старые вытесняются, мета не пухнет за тысячи resume).
  - новый `export interface SessionRun { sessionId: string; phase?: string; sessionPhase?: string; startedAt: string; finishedAt: string; durationMs?: number; usage?: TokenUsage; agent?: string; billing?: 'run' | 'fallback'; }` — `billing` показывает, кто оставил запись в журнале (наблюдаемость инварианта VL-243, дублирует `billing_recorded`).
- **новый `appendSessionRun(dir, sessionId, run): SessionMeta`** (рядом с `updateSessionMeta`): читает мету через `loadSessionMetaSync` (битая/отсутствующая → начало с пустой, `cwd` из `run.cwd` обязателен — как в `updateSessionMeta`), приклеивает ран, `slice(-RUN_HISTORY_MAX)`, ставит `lastRunPhase`, пишет через merge-семантику (`updateSessionMeta`) — **не** перезаписывает `phase`/`taskId` (lesson-40). Fail-safe: любая ошибка — возврат текущей меты + `console.error`-предупреждение (учёт не роняет фазу).

### 2. `src/web/orchestrator.ts`
- **~855-866** (`activeRuns.set`, `runStartedAt`): перенести `const runStartedAt = new Date().toISOString();` **выше** `spawn(...)` (сейчас считается после спавна, а нужен в env).
- **~773-777** (`spawnEnv`): добавить `VIBELOG_RUN_PHASE: runPhase, VIBELOG_RUN_STARTED_AT: runStartedAt`, где `runPhase` = фаза РАНА: `phase !== 'prompt' ? phase : (worktreeTaskId ? loadSessionMetaSync(...)?.phase : undefined)`. Для `startResume` (фаза 'prompt') фаза рана = `meta.phase` (продолжение план-сессии — это работа plan-фазы, а не 'prompt'); меты нет — env не ставится (учёт пропускается как сейчас).
- **~1020-1150** (учёт в `finish()`):
  - qwen-блок: `usagePhase` (строка ~1067) → `const usagePhase = metaNow?.phase ?? phase;` **оставить для billing.sessionPhase**, а в `addTaskTokenUsage` передавать фазу рана: `const byPhaseKey = process.env.VIBELOG_RUN_PHASE ?? phase;` (строка ~1073).
  - оба `appendBilling` (qwen ~1079, vb-fallback ~1134): `startedAt: environmentRunStart` — новое значение: `process.env.VIBELOG_RUN_STARTED_AT ?? runStartedAt` (замыкание `spawnQwenRun`, где env не задавался — например тестовый seam), плюс `startedAtKind: 'run'`; убрать `metaNow?.startedAt`.
  - после обоих `updateSessionMeta(...)` вызвать `appendSessionRun(agentSessionsDir(cwd), result.session_id, { sessionId, phase, sessionPhase: usagePhase !== phase ? usagePhase : undefined, startedAt: runStartedAt, finishedAt, durationMs: result.duration_ms, usage: runUsage, agent, billing: qwenBlock ? 'run' : 'fallback' })` — в блоке qwen и в vb-fallback-блоке (в vb штатный путь — CLI, там `billing: 'run'`; fallback помечается `'fallback'`).

### 3. `src/agent/cli.ts`
- **~331-345** (после `const cwd = process.cwd();`): `const runStartedAt = process.env.VIBELOG_RUN_STARTED_AT ?? new Date().toISOString();` — фактический старт рана; env от оркестратора приоритетнее (иначе берётся старт процесса CLI, а не создания сессии).
- **~697-704** (`phaseName`/`runPhase`): `phaseName` (фаза сессии) не меняется; `runPhase` дополнить приоритетом env фазы рана:
  `const envRunPhase = process.env.VIBELOG_RUN_PHASE ?? (process.env.VIBELOG_PHASE_NAME !== 'prompt' ? process.env.VIBELOG_PHASE_NAME : undefined);`
  `const runPhase = phase ?? envRunPhase ?? typesPhase ?? phaseName;` (где `typesPhase = isPhaseMode ? positionals[0] : undefined`). Для 'prompt' фаза рана = `phaseName` — by_phase не получит ключа `prompt`.
- **~728** (`addTaskTokenUsage`): `phaseName` → `runPhase` (AC3: агрегат по фазе рана).
- **~754-770** (`appendBilling`): `startedAt: runStartedAt` (вместо `existing?.startedAt`), добавить `startedAtKind: 'run'`, `sessionId` остаётся.
- **~771-790 + ~800**: после финального `updateSessionMeta` — `appendSessionRun(sessionsDir, sessionId, { sessionId, phase: runPhase, sessionPhase: phaseName !== runPhase ? phaseName : undefined, startedAt: runStartedAt, finishedAt, durationMs: loopResult.duration_ms, usage: sessionUsage, agent: 'vb', billing: 'run' })`; блок в том же `try/catch`-паттерне (предупреждение в stderr, фазу не роняем). `billing_recorded`-маркер и `last_run` не трогаем.

### 4. `src/core/billing.ts`
- **~20-60** (`BillingSession`): `startedAt` JSDoc уточнить («фактическое начало рана, VL-259»), новые поля:
  `startedAtKind?: 'run' | 'session'` — происхождение `startedAt` (у старых записей отсутствует → считаем 'session', т.е. ненадёжным);
  `sessionId` остаётся обязательным.
- **новый `export function billingRunStart(entry: BillingSession): string | undefined`** — миграция чтения старых записей: `startedAtKind === 'run'` → `startedAt`; иначе `finishedAt` минус `durationMs` (ISO), при отсутствии `durationMs` → `finishedAt`, ничего нет → `undefined`. Не бросает (AC2: «не падать»); используется при разборе журнала/сверке (документируется, потребителей-агрегаторов сейчас нет).
- `readBilling`/`appendBilling` не меняются (аддитивные поля читаются старыми записями как прежде, тест VL-243 остаётся зелёным).

### 5. `src/mcp/tools.ts` (finish_phase, by_phase)
- **~1552-1556** (`phaseName`) и **~1634** (`finalPhase`): приоритет фазы для `by_phase` — `args.phase` → `VIBELOG_RUN_PHASE` → (`VIBELOG_PHASE_NAME`, если не `'prompt'`) → `meta.phase`. Иначе в resume-ране ключом by_phase становился `prompt`/фаза сессии (AC3). Результат — в `addTaskTokenUsage(cwd, id, finalPhase, ...)`.

### 6. Тесты
- `src/agent/session.test.mjs`: `appendSessionRun` — добавление записи, кап 50 (51-й ран вытесняет первый), `lastRunPhase`, мета без `runs` не падает, `phase` после 3 ранов по-прежнему фаза создания (инвариант VL-147/lesson-40).
- `src/core/billing.test.mjs`: `startedAtKind: 'run'` сохраняется; `billingRunStart` — новая запись → `startedAt`, старая без `startedAtKind` → `finishedAt − durationMs`, без `durationMs` → `finishedAt`, пустая запись → `undefined`; чтение старых записей без новых полей (расширить кейс VL-243).
- `src/agent/cli.test.mjs`: **главный инвариант AC4** — три рана одной сессии (plan → resume code → resume code, env-путь, mkdtemp): `meta.runs.length === 3`, фазы `['plan','code','code']` (или `['plan','code','code']` с `sessionPhase:'plan'`), три `startedAt` попарно различны и **ни один не равен** `meta.startedAt`, `billing.sessions[].startedAtKind === 'run'`, `task.token_usage.by_phase` содержит `plan` и `code`.
- `src/web/orchestrator.test.mjs`: env-тест задачной фазы дополняется проверкой `VIBELOG_RUN_PHASE`/`VIBELOG_RUN_STARTED_AT` в argv/env спавна; qwen-finish пишет `startedAt` = фаза-ран-старт (не `meta.startedAt`) и `meta.runs` получает запись; vb-fallback — запись с `billing:'fallback'`.
- `src/mcp/server.test.mjs`: `finish_phase` с `VIBELOG_RUN_PHASE=code` и `VIBELOG_PHASE_NAME=prompt` → `by_phase.code` (а не `prompt`).

### 7. Документация (Code/Close)
- `README.md` (~205-225, «Учёт токенов (billing)»): `startedAt` = начало рана + `startedAtKind`; `meta.runs`/`lastRunPhase`; `by_phase` по фазе рана.
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` (~177-183, §3.3): та же семантика + правило «`meta.phase` — фаза создания сессии (VL-147), история — в `runs[]`».

## Проверка
```bash
pnpm build
pnpm test:fast -- src/agent/session.test.mjs src/core/billing.test.mjs src/agent/cli.test.mjs src/web/orchestrator.test.mjs src/mcp/server.test.mjs
pnpm test            # полный прогон — обязателен для DoD
```

## Риски
1. **Регрессия VL-147/lesson-40** (план-сессия не находится) — снят решением №1: `phase` не переприсваивается, `findTaskPhaseSessionSync` не трогаем; тест «фаза создания после 3 ранов» — прямой инвариант.
2. **`by_phase` теряет ключ `prompt`-ранов** — сознательно: 'prompt' не фаза workflow; при отсутствии `VIBELOG_RUN_PHASE` и меты ключ остаётся прежним (`phaseName`) — деградации нет.
3. **Рост меты** — кап `RUN_HISTORY_MAX = 50` + отсутствие `messages` в записи (только usage/времена).
4. **Двойной учёт времени/usage** — `appendSessionRun` пишет только историю, `usage_recorded`/`billing_recorded` не трогает (lesson-58 сохраняется).
5. **Оркестраторные тесты флэкуют** в полном прогоне (lesson-23) — при падении повторять файл отдельно перед вердиктом о регрессии.
6. **Старые журналы** — новые поля аддитивны, `readBilling` не валидирует их строго; существующие тесты VL-198/243 не меняют ожиданий.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 13:33
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в задачу (6 файлов правки + 4 тест-файла + 2 документа).
Изучены: `src/agent/session.ts` (SessionMeta/updateSessionMeta/findTaskPhaseSessionSync), `src/core/billing.ts`, `src/agent/cli.ts` (пост-ран 690-800), `src/web/orchestrator.ts` (spawnQwenRun env 769-777, runStartedAt 865, учёт finish 1020-1150), `src/mcp/tools.ts` (finish_phase token_usage 1540-1660), `src/core/store.ts:172` (addTaskTokenUsage), тесты session/billing/cli/orchestrator.
Ключевое архитектурное уточнение (расходится с буквой описания, но сохраняет AC): `meta.phase` — не «фаза последнего рана», а **фаза создания сессии** — по ней работает `findTaskPhaseSessionSync`, через который живут `code_same_session` (VL-147) и retry авто-очереди (VL-200). Переприсваивать `phase` фазе рана = повтор инцидента VL-185/lesson-40. Поэтому история ранов пишется аддитивно: `meta.runs[{sessionId, phase, sessionPhase, startedAt, finishedAt, durationMs, usage, agent, billing}]` (кап 50) + `meta.lastRunPhase`; `phase` не трогается. «В какой фазе шёл последний ран» восстанавливается из `lastRunPhase`/`runs.at(-1)`, а не из `phase`.
По остальным пунктам: (2) `startedAt` billing = начало рана — оркестратор кладёт `VIBELOG_RUN_STARTED_AT` (+`VIBELOG_RUN_PHASE`) в spawnEnv рядом с существующими `VIBELOG_PHASE_TASK_ID/NAME`, CLI берёт env либо старт процесса; добавляется `startedAtKind: 'run'` и миграционный хелпер `billingRunStart()` (старые записи без поля → `finishedAt − durationMs`, без падений). (3) `by_phase` переводится на фазу рана в трёх точках: CLI-пост-ран (`runPhase` вместо `phaseName`), `finish_phase` (приоритет `VIBELOG_RUN_PHASE` над `VIBELOG_PHASE_NAME`), qwen-блок оркестратора (`byPhaseKey`), при этом `billing.sessionPhase` по-прежнему фиксирует фазу сессии. (4) Инвариантный тест: 3 рана plan→code→code в mkdtemp → `runs.length === 3`, 3 разных `startedAt`, ни один не равен `meta.startedAt`, `by_phase` содержит plan и code.
Риски: регрессия VL-147 (снята решением не трогать `phase`, плюс инвариантный тест); потеря ключа `prompt` в by_phase (сознательно — 'prompt' не фаза workflow, при отсутствии env/меты ключ прежний); рост меты (кап 50); двойной учёт (appendSessionRun не трогает usage_recorded/billing_recorded, lesson-58); флэки orchestrator.test (lesson-23 — повтор файла отдельно).
---
author: @agent
created: 2026-10-30 14:14
---
Фаза code не удалась (код выхода 1): .test.mjs×4, payload последнего запроса=552337 байт (макс 552337), usage={"input_tokens":5733574,"output_tokens":18216,"cache_read_input_tokens":5605888,"total_tokens":5751790,"reasoning_tokens":3957} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 14:27
---
Фаза 3 (Code) выполнена. Коммит 9080049 (ветка vb/vl-259).
Изменено (11 файлов):
- `src/agent/session.ts` — новый `SessionRun` + `RUN_HISTORY_MAX = 50`, поля `SessionMeta.runs`/`lastRunPhase`, функция `appendSessionRun` (аддитивная запись истории, merge через `updateSessionMeta`, `phase`/`taskId` не трогаются — lesson-40/VL-147, ошибка → предупреждение в stderr, не роняет фазу).
- `src/core/billing.ts` — `startedAt` = начало рана (JSDoc), поле `startedAtKind: 'run' | 'session'`, новый миграционный хелпер `billingRunStart` (старые записи → `finishedAt − durationMs`, без `durationMs` → `finishedAt`, пустая → `undefined`, не бросает).
- `src/agent/cli.ts` — `runStartedAt` из `VIBELOG_RUN_STARTED_AT` либо старт процесса; `runPhase` с приоритетом `VIBELOG_RUN_PHASE` (исключая служебный `prompt`); `addTaskTokenUsage(..., runPhase, ...)` — by_phase по фазе рана; `appendBilling` с `startedAt: runStartedAt` + `startedAtKind: 'run'`; после меты — `appendSessionRun`.
- `src/web/orchestrator.ts` — `runStartedAt` считается ДО spawn и уходит в `spawnEnv` вместе с `VIBELOG_RUN_PHASE` (для `phase='prompt'` фаза рана = `meta.phase` резюмируемой сессии); qwen-блок: by_phase по `runPhase`, billing `startedAt` = ран, `appendSessionRun` (billing:'run'); vb-fallback: то же + `appendSessionRun` с `billing:'fallback'`.
- `src/mcp/tools.ts` — `finish_phase`: приоритет фазы для by_phase `args.phase` → `VIBELOG_RUN_PHASE` → `VIBELOG_PHASE_NAME` (кроме `prompt`) → `meta.phase`.
- README (раздел «Учёт токенов») — семантика `startedAt`/`startedAtKind`, `meta.runs`/`lastRunPhase`, by_phase по фазе рана.
- Тесты: `src/agent/session.test.mjs` (+3: накопление/`lastRunPhase`/инвариант `phase`, кап 50, старая мета без runs), `src/core/billing.test.mjs` (+4: `startedAtKind`, `billingRunStart` — новый/старый/без durationMs/битые даты), `src/agent/cli.test.mjs` (+1 главный инвариант AC4: 3 рана plan→code→code — `runs.length===3`, 3 разных `startedAt`, ни один ≠ `meta.startedAt`, `by_phase` содержит plan и code), `src/web/orchestrator.test.mjs` (close-ран: `startedAtKind:'run'` + запись в `meta.runs` с совпадающим временем; env-тест задачной фазы + `VIBELOG_RUN_PHASE`/`VIBELOG_RUN_STARTED_AT`), `src/mcp/server.test.mjs` (+1: `VIBELOG_RUN_PHASE=code` при `VIBELOG_PHASE_NAME=prompt` → `by_phase.code`, не prompt/plan) + env-гарды от утечки новых переменных.
Проверки: `pnpm build` чистый; целевые прогоны (session, billing, cli, mcp/server, orchestrator) зелёные; **полный `pnpm test`** — 92 файла / 1744 теста passed, 4 skipped (штатные, как до задачи), суммарно + static 7 passed. Исключений/--skip не было.
Документация: README обновлён. `backlog/docs/doc-10` (§3.3) и CHANGELOG по правилам фазы Code не правятся — оставлено Close (черновик: `phase` в мете — фаза создания сессии, история — в `runs[]`, `startedAt` billing — начало рана с `startedAtKind`).
AC: 1–4 отмечены. DoD: «Тесты проходят» и «Нет регрессий» — полный прогон зелёный; «Документация обновлена» — README сделан, doc-10 за Close (DoD2 не отмечаю).
Lesson: создан lesson-108 и связан с задачей.
---
author: @agent
created: 2026-10-30 14:37
---
Фаза Close выполнена. Ветка vb/vl-259 слита в master (1 коммит: 9080049), worktree `.vibelog/worktrees/vl-259` удалена через `--force` (в ней оставались только untracked-симлинки `node_modules`/`backlog/references/data` от оркестратора), ветка vb/vl-259 удалена.
Проверки на master после merge: `pnpm build` — чистая сборка; ранний точечный прогон затронутых diff'ом файлов (session, billing, cli, orchestrator, mcp/server) — 98 файлов / 1821 тест passed, 4 skipped; полный `pnpm test` — passed (без исключений и `--skip`, повторов не потребовалось).
Документация (DoD2): CHANGELOG.md — запись в Unreleased (коммит ae85154); `backlog/docs/doc-10` §3.3 переписан — `meta.phase` = фаза создания сессии (VL-147/lesson-40), история ранов в `runs[]`/`lastRunPhase`, `startedAt` billing = начало рана + `startedAtKind` + миграционный `billingRunStart`, `by_phase` по фазе рана; README-раздел «Учёт токенов» обновлён ещё в фазе Code (в merge).
DoD: «Тесты проходят» — полный прогон зелёный; «Документация обновлена» — doc-10 §3.3 + CHANGELOG + README (ae85154); «Нет регрессий» — полный прогон зелёный. AC 1–4 подтверждены (главный инвариант AC4 покрыт тестом в `src/agent/cli.test.mjs`). Lesson-108 создан и связан с задачей (коммит a124988).
---
<!-- COMMENTS:END -->