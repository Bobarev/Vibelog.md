---
id: VL-275
title: '[авто] code VL-239: 7 попыток в code без смены статуса (no-progress) при незакрытой зависимости V...'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 16:34'
updated_date: '2026-11-01 18:25'
due_date: ''
labels:
  - auto-bug
  - code
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
  - src/core/supervisor-state.ts
  - src/web/supervisor-tick.ts
  - src/core/supervisor-state.test.mjs
  - src/web/supervisor-tick.test.mjs
  - README.md
  - CHANGELOG.md
lessons:
  - lesson-141
token_usage:
  input: 13920013
  output: 387005
  cache: 13238784
  total: 14307018
  requests: 155
  duration_ms: 1393302
  reasoning: 349339
  by_phase:
    plan:
      input: 4397537
      output: 182436
      cache: 4153344
      requests: 56
    code:
      input: 9100277
      output: 200561
      cache: 8773120
      requests: 88
    close:
      input: 422199
      output: 4008
      cache: 312320
      requests: 11
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Причина
7 попыток в code без смены статуса (no-progress) при незакрытой зависимости VL-209, которой нет в текущем прогоне; доля повторов 3.5% показывает, что ретраи исчерпаны — дальше лечить бессмысленно, нужно разблокировать зависимость/завести баг

## Последние строки лога
```
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: read_file
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: read_file
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: grep_search
[vibelog-agent] инструмент: backlog_update_task
[vibelog-agent] инструмент: backlog_manage_ac
[vibelog-agent] инструмент: backlog_finish_phase
[vibelog-agent] фаза: запросов=49 (LLM-запросы/ходы модели), tool-calls=86 (лимит 100, счётчик рана — VL-221), повторов=3/86 (3%), shell-повторов=0/1 (0%), топ-повторов=grep_search|pricing|calculateCost×2, search_files|getActiveModelPricing×2, search_files|getActiveModelPricing|getPricing×2, payload последнего запроса=443543 байт (макс 443543), usage={"input_tokens":3644049,"output_tokens":125850,"cache_read_input_tokens":3387136,"total_tokens":3769899,"reasoning_tokens":114045}
```

## Сессия
agent-1793539001373 — .vibelog/agent-sessions/agent-1793539001373.jsonl

## Цепочка лечения
- попытка 1: l2:bug

## Исходная задача
VL-239: Resume-сессия должна продолжаться на модели, с которой начата (фиксация модели в мете сессии)

<!-- auto-bug: VL-239|3b103e9f -->
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Тик супервизора не запускает фазу задачи с незакрытой зависимостью, не входящей в прогон: startTaskPhase для такой задачи не вызывается ни в одном тике.
- [x] #2 Незакрытые блокеры фиксируются в state.json (SupervisorTaskState.blockedBy) и видны в heartbeat.md строкой «ждёт VL-N»; при снятии блокировки поле очищается.
- [x] #3 Заблокированная задача не уходит в лечение: статус в состоянии — pending, healAttempts не растёт, причина «нет прогресса» не подменяет реальную причину (внешняя зависимость).
- [x] #4 После закрытия зависимости (Done/Completed) следующий тик штатно подхватывает задачу в candidates и запускает её фазу; blockedBy участвует в snapshotKey, поэтому wake gate не «спит» после снятия блокировки.
- [x] #5 Новые тесты в src/web/supervisor-tick.test.mjs (заблокированная задача не запускается; после закрытия блокера запускается) и src/core/supervisor-state.test.mjs (snapshotKey/heartbeat учитывают blockedBy); полный pnpm test зелёный.
- [x] #6 Документация: README (раздел про тик супервизора) описывает пропуск задач с невыполненными зависимостями и раздел «Заблокированы» в heartbeat; CHANGELOG дополнен записью VL-275.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (по коду, проверено)

VL-239 получила зависимость `VL-209`, но не была заблокирована для запуска: **тик супервизора не проверяет готовность задачи по зависимостям**.

- `src/web/supervisor.ts:203–215` (`buildSupervisorPlan`) проверяет `isReady`/`blockedBy` и внешние блокеры уводит в `skipped` с текстом «заблокирована зависимостями: …» — планировщик прогона работает верно.
- `src/core/auto-queue.ts:284–299` (`pickNextQueueTask`) тоже фильтрует через `isReady`.
- А `src/web/supervisor-tick.ts:1068–1103` (сбор состояния) пушит в `candidates` **все** не-терминальные задачи прогона без проверки зависимостей (`blockedBy` импортируется, но используется только для текста промпта, строка 827). Дальше `planParallel` (1224) и запуск групп (1231–1250) стартуют фазу.
- Следствие: фазы VL-239 запускались при незакрытой VL-209 (которой нет в прогоне, значит она никогда не закроется внутри прогона) → фаза не давала прогресса → правило `no-progress` (`status_unchanged: true` → `retry_once_then_bug`, `src/core/supervisor-config.ts:158–163`) 7 раз перезапускало `code` → исчерпание `heal_attempts` → авто-баг. Диагноз в баге («незакрытая зависимость») верен, но лечилось следствие, а не причина.
- Второй дефект: причина «внешняя зависимость» нигде не фиксируется как отдельное состояние — в heartbeat/state её нет, поэтому и модель уровня 2, и правила уровня 1 видели только «нет прогресса».

## Цель фикса

Задача с незакрытой зависимостью (внешней ИЛИ не входящей в текущий прогон) не запускается и не лечится как «нет прогресса»: тик помечает её `blockedBy`, держит в `pending`, пишет причину в `state.json`/`heartbeat.md`, и подхватывает в `candidates` сразу после закрытия зависимости.

Единая точка правды — `isReady` из `src/core/deps.ts:49` (уже используется планировщиком и автоочередью): одна проверка покрывает и внешние блокеры, и блокеры внутри прогона.

## Файлы и точки правки (в порядке работы)

### 1. `src/core/supervisor-state.ts` — состояние и heartbeat
- `SupervisorTaskState` (строка 40–77): новое опциональное поле `blockedBy?: string[]` — канонические ID незакрытых зависимостей («ждёт»). Нормализуется в `loadState` (141–216) рядом с `ruleChain` (`...(Array.isArray(t.blockedBy) ? {blockedBy: фильтр строк} : {})`).
- `snapshotKey` (285–311): добавить в `parts` элемент `t.blockedBy?.join(',') ?? ''` — без этого wake gate не заметит снятие блокировки: у самой задачи статус/фаза не меняются, меняется только статус блокера (AC4).
- `writeHeartbeat` (340–…): после таблицы задач добавить секцию `## Заблокированы зависимостями` (`- VL-N — ждёт VL-X, VL-Y (нет в прогоне)`), когда есть непустые `blockedBy`. Существующую таблицу и её колонки НЕ менять — на неё опираются тесты `src/core/supervisor-state.test.mjs:186–230`.

### 2. `src/web/supervisor-tick.ts` — тик (ядро фикса)
- Импорт (строка 35): к `blockedBy` добавить `isReady` из `../core/deps.js`.
- Сбор состояния (между блоком обновления статуса 1068–1080 и `state.tasks[key] = entry` / push в `l2Tasks`/`candidates` на 1093–1103): при `!entry.frozen` и не-терминальном статусе задачи вычислить незакрытые зависимости (`blockedBy(cwd, task)` без статусов Done/Completed/Rejected); если список не пуст:
  - `entry.blockedBy = blockers.map(t => canonicalTaskId(t.id))`;
  - `entry.status = 'pending'` (НЕ `failed` — задача не запускалась и не «упала»), `entry.phase = obs.nextPhase ?? entry.phase`, `entry.nextPhase = obs.nextPhase`, `pid`/`phaseRunId` очищены, `healAttempts` НЕ увеличивается;
  - в `l2Tasks` и `candidates` задача не попадает (`continue`) → ни лечение, ни запуск;
  - запись в `result.blocked` (новое поле `TickResult`, см. ниже).
  - Живую фазу (`entry.status === 'running'` и `phaseAlive`) не трогать: останавливать работающий процесс фикс не должен.
  - Если зависимости закрыты — `entry.blockedBy` сбрасывается (`delete`), задача как обычно идёт в `candidates`.
- `TickResult` (структура ~120–150): + `blocked: { taskId: string; blockers: string[] }[]` — для отчёта тика и тестов.
- `applyHealAction`, ветка retry/`retry_once_then_bug` (1503–1518): защита-в-глубину — если у задачи в `state` непустой `blockedBy`, перезапуск не выполнять, вернуть `{ }` с `entry.lastError = 'перезапуск отменён: задача ждёт зависимость …'` (иначе l2-решение модели «перезапусти» снова запускало бы заблокированную фазу).
- Применение решения, запуск групп (1231–1250): пропускать задачи с `entry.blockedBy?.length` — с записью в `result.errors`/`rationale` («не запущена: ждёт зависимости …»).
- `buildTickPrompt` (820–835): в блоке «Готовы к запуску» для заблокированных писать `заблокирована: ждёт VL-X (нет в прогоне)`; добавить в контракт промпта правило: «задача, ждущая зависимости, не предлагается к запуску и не лечится retry — причина внешняя» (иначе модель уровня 2 снова выберет `heal` и съест `heal_attempts`).

### 3. Проверка, что менять `src/web/supervisor.ts` не нужно
`startSupervisorRun` (473–560) стартует первую волну из `plan.groups`, а план уже отфильтрован `isReady` — правок не требуется (зафиксировать в отчёте фазы Code).

### 4. Тесты
- `src/web/supervisor-tick.test.mjs` (mkdtemp-фикстуры уже есть, швы `setTickLlmForTests/setTickStartPhaseForTests/setTickActiveCountForTests`):
  - задача с зависимостью от внешней незакрытой задачи: `startTaskPhase`-стаб не вызван ни разу, `state.tasks[key].blockedBy` = ['VL-X'], статус `pending`, `healAttempts` = 0, `result.blocked` непустой;
  - закрытие блокера (перевести блокер в Done) → следующий тик запускает фазу заблокированной задачи (сброс `state.snapshotHash`/новая граница тика);
  - задача без зависимостей запускается как раньше (регрессионный кейс).
- `src/core/supervisor-state.test.mjs`: `snapshotKey` меняется при изменении `blockedBy` (и не меняется при его отсутствии — существующие кейсы 147–179 обязаны остаться зелёными); `writeHeartbeat` содержит строку «ждёт VL-…».
- Не трогать: `src/web/supervisor-healing.test.mjs` (правила лечения) и `src/web/supervisor.test.mjs` (план) — поведение не меняется.

### 5. Документация
- `README.md`, раздел «Супервизор: тик, лечение и планировщик (VL-270)» (~строка 542): абзац — тик не запускает и не лечит задачи с незакрытыми зависимостями, помечает их в `state.json`/`heartbeat.md` (`blockedBy`, секция «Заблокированы зависимостями»), после закрытия зависимости подхватывает в первую же волну; `blockedBy` входит в ключ снимка, поэтому снятие блокировки будит тик.
- `CHANGELOG.md`: запись про VL-275 (одна строка под текущей версией).

## Порядок действий

1. `src/core/supervisor-state.ts` — поле, `loadState`, `snapshotKey`, секция heartbeat.
2. `src/web/supervisor-tick.ts` — фильтр зависимостей в сборе состояния, `TickResult.blocked`, защита в `applyHealAction`, пропуск в запуске групп, текст промпта.
3. Тесты (tick + state), затем `pnpm build`.
4. Точечный прогон, затем полный.
5. README + CHANGELOG.

## Как проверить

```
pnpm build && pnpm test:fast -- src/core/supervisor-state.test.mjs src/web/supervisor-tick.test.mjs src/web/supervisor-healing.test.mjs src/web/supervisor.test.mjs src/core/core.test.mjs
```
Перед отметкой DoD — ПОЛНЫЙ `pnpm test` без `--exclude`/`--skip` (AGENTS.md: частичный прогон не закрывает DoD). Если полный прогон падает — сначала тот же тест-файл на чистом дереве (`git stash`, lesson-115) и проверить, не идёт ли параллельный vitest в другом worktree, и только потом винить свою правку (в отчёте фазы Close/Code — причина).

Ручная проверка (необязательно, если тесты зелёные): в `.vibelog/supervisor/state.json` у заблокированной задачи `blockedBy: ["VL-209"]`, `status: "pending"`; в `heartbeat.md` — секция «Заблокированы зависимостями».

## Риски и митигации

- **Ложная блокировка из-за регистра/формата ID**: `blockedBy` из `core/deps.ts` матчит ID без учёта регистра (`toLowerCase`); в состояние и heartbeat пишем канонические ID через `canonicalTaskId` — иначе маркер «ждёт VL-209» не совпадёт с ID в прогоне.
- **Wake gate «уснёт»**: без `blockedBy` в `snapshotKey` снятие зависимости не изменит снимок и тик не разбудится (AC4) — правка ключа обязательна вместе с полем.
- **Регрессия heartbeat/таблицы**: существующие тесты `supervisor-state.test.mjs` сверяют формат; добавляем только новую секцию, колонки не меняем.
- **Живая фаза заблокированной задачи**: фикс срабатывает только для не-`running` состояний — работающий процесс не убиваем (иначе потеряем легитимный ран).
- **Порядок фильтра в тике**: проверка должна стоять до формирования `l2Tasks`, иначе заблокированная «упавшая» задача уйдёт в лечение раньше, чем будет помечена.
- **Уже существующие авто-баги** по этому сценарию лечению не подлежат (баг VL-275 и есть разблокировка); правка ничего не «переигрывает» задним числом — прогон с VL-239 после закрытия VL-209 просто начнёт запускать фазы.
- **Изоляция тестов** (VL-240/VL-241): только `mkdtempSync`-фикстуры, локальный `.vibelog/settings.json` в тестах не читать (тик-тесты уже изолированы своим cwd).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 18:06
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в Implementation Plan; добавлены AC1–AC6.
**Диагноз (подтверждён по коду).** Причина бага — не сама VL-209, а дефект тика супервизора: он не проверяет готовность задачи по зависимостям.
- `src/web/supervisor.ts:203–215` (`buildSupervisorPlan`) фильтрует `isReady`/внешние блокеры → `skipped: «заблокирована зависимостями»` — корректно;
- `src/core/auto-queue.ts:284–299` (`pickNextQueueTask`) тоже фильтрует `isReady` — корректно;
- `src/web/supervisor-tick.ts:1068–1103` пушит в `candidates` **все** не-терминальные задачи прогона без проверки зависимостей (`blockedBy` импортируется, но используется только для текста промпта, строка 827) → `planParallel` (1224) и запуск групп (1231–1250) стартовали `code` для VL-239 при незакрытой VL-209, которой в прогоне нет → «нет прогресса» → правило `no-progress` (`status_unchanged: true` → `retry_once_then_bug`, `supervisor-config.ts:158–163`) 7 раз перезапускало фазу → `heal_attempts` исчерпаны → авто-баг. Лечилось следствие, а не причина; состояние «ждёт зависимость» нигде не фиксировалось.
**Объём правки — 5 файлов:**
1. `src/core/supervisor-state.ts` — поле `SupervisorTaskState.blockedBy?: string[]`, нормализация в `loadState` (141–216), `snapshotKey` (285–311) учитывает `blockedBy` (иначе снятие блокировки не разбудит wake gate), секция «Заблокированы зависимостями» в `writeHeartbeat` (340+) без изменения существующей таблицы.
2. `src/web/supervisor-tick.ts` (ядро) — импорт `isReady`; фильтр незакрытых зависимостей в сборе состояния до формирования `l2Tasks`/`candidates` (статус `pending`, `blockedBy`, `healAttempts` не растёт, живую фазу не трогаем); новое поле `TickResult.blocked`; защита-в-глубину в `applyHealAction` (1503–1518) — не перезапускать заблокированную задачу; пропуск в запуске групп (1231–1250); текст промпта (820–835) + правило контракта.
3. `src/web/supervisor.ts` — правок НЕ требуется (`startSupervisorRun` стартует уже отфильтрованный план); зафиксировано в плане для фазы Code.
4. Тесты: `src/web/supervisor-tick.test.mjs` (не запускается при блокере; запускается после закрытия блокера; регрессия для задачи без зависимостей), `src/core/supervisor-state.test.mjs` (`snapshotKey`/`writeHeartbeat` с `blockedBy`). `supervisor-healing.test.mjs` и `supervisor.test.mjs` не трогаем.
5. Документация: README (раздел «Супервизор: тик, лечение и планировщик», ~542) + `CHANGELOG.md`.
**Риски:** ложная блокировка из-за регистра ID (митигация: канонизация через `canonicalTaskId`, `blockedBy` и так case-insensitive); «уснувший» wake gate без `blockedBy` в `snapshotKey` (поле и ключ правим вместе); регрессия формата heartbeat (только новая секция); порядок фильтра в тике (проверка строго до `l2Tasks`, иначе задача уйдёт в лечение раньше пометки); изоляция тестов mkdtemp + отказ от локального settings.json (VL-240/VL-241, lesson-115).
**Проверка:** `pnpm build && pnpm test:fast --` по 5 файлам (state, tick, healing, supervisor, core), перед DoD — полный `pnpm test` без исключений; при падении полного прогона — сверка с чистым деревом (`git stash`, lesson-115) и проверка параллельного vitest в другом worktree.
**Контекст:** зависимость исходной задачи VL-209 в backlog уже `Done`, то есть запускать VL-239 больше не блокируется; правка VL-275 устраняет дефект супервизора, из-за которого ретраи жгли попытки вместо фиксации причины «внешняя зависимость». Блокеров и дочерних задач не требуется — объём одной задачи.
---
author: @agent
created: 2026-11-01 18:11
---
Фаза 3 (Code) выполнена. Коммит `f697a34` («fix: VL-275 — тик супервизора не запускает и не лечит задачи с незакрытыми зависимостями»), 5 файлов, +205/−1.
**Что сделано (по плану):**
1. `src/core/supervisor-state.ts` — поле `SupervisorTaskState.blockedBy?: string[]` (канонические ID незакрытых зависимостей), нормализация в `loadState` (не-строки/пустой массив отбрасываются), `blockedBy` добавлен в `snapshotKey` (снятие блокировки меняет ключ → wake gate не «спит»), секция «Заблокированы зависимостями» в `writeHeartbeat` (блокеры вне прогона помечаются «(нет в прогоне)»); существующая таблица задач не тронута.
2. `src/web/supervisor-tick.ts` (ядро) — импорт `isReady`; гейт незакрытых зависимостей в сборе состояния **до** формирования `l2Tasks`/`candidates`: задача со `blockedBy` не попадает ни в лечение, ни в запуск, статус `pending`, `healAttempts` не растёт, живая фаза не трогается; при закрытии зависимостей `blockedBy` очищается; новое поле `TickResult.blocked`; защита-в-глубину в `applyHealAction` (не перезапускать фазу, если ждём зависимости); пропуск заблокированной задачи в запуске групп; правило в контракте промпта тика («заблокированные не предлагать ни к запуску, ни к retry»).
3. `src/web/supervisor.ts` — правок не потребовалось: `startSupervisorRun` стартует уже отфильтрованный `isReady` план (подтверждено прогоном `supervisor.test.mjs`).
**Тесты (добавлены):** `src/web/supervisor-tick.test.mjs` — 3 кейса: заблокированная задача не запускается (`startTaskPhase` не вызван, статус `pending`, `healAttempts`=0, `blockedBy=["VL-…"]`, модель не вызывается), после перевода блокера в `Done` задача запускается следующим тиком (`skipped` не `unchanged`, поле блокировки очищено), регрессия для задачи без зависимостей. `src/core/supervisor-state.test.mjs` — 3 кейса: `blockedBy` меняет `snapshotKey` и возвращает его при снятии, heartbeat содержит секцию с «ждёт VL-209 (нет в прогоне)», без блокировок секции нет.
**Проверки:** `pnpm build` — чисто; полный `pnpm test` — **120 файлов, 2272 passed, 4 skipped, 0 failed** (без `--exclude`/`--skip`, исключённых файлов нет; 4 skipped — существующие пропуски в `src/core/frontmatter.test.mjs`, не связаны с задачей); точечно `supervisor-state`/`supervisor-tick`/`supervisor`/`supervisor-healing` — 73 passed. README обновлён (раздел «Супервизор: тик, лечение и планировщик»: абзац «Незакрытые зависимости блокируют запуск (VL-275)»).
**Что осталось / замечания:**
- AC6 отмечен не полностью: README обновлён, но `CHANGELOG.md` намеренно **не трогал** — по правилам фазы Code итоговую документацию пишет фаза Close после слияния. Это единственная причина незакрытого AC6 и неотмеченного DoD «Документация обновлена» — просьба к Close добавить запись VL-275.
- Lesson: создан `lesson-141` («Проверку готовности задачи по зависимостям (isReady) применяй во ВСЕХ точках запуска фаз…»), связан с VL-275.
Изменённые файлы: `src/core/supervisor-state.ts`, `src/web/supervisor-tick.ts`, `src/core/supervisor-state.test.mjs`, `src/web/supervisor-tick.test.mjs`, `README.md`.
---
author: @agent
created: 2026-11-01 18:25
---
Фаза Close выполнена. Ветка `vb/vl-275` (1 коммит `f697a34`) слита в master без конфликтов — merge-коммит `d025348`... (merge: VL-275), diff: README.md, src/core/supervisor-state.ts + .test.mjs, src/web/supervisor-tick.ts + .test.mjs (+205/−1). worktree `.vibelog/worktrees/vl-275` удалена (в ней были только untracked-симлинки node_modules/refs — `--force`), ветка `vb/vl-275` удалена.
**Проверки после merge (главный репо):** `pnpm build` — чисто; полный `pnpm test` (`vitest run` без `--exclude`/`--skip`) — **121 файл, 2285 passed, 4 skipped, 0 failed** (4 skipped — пре-существующие пропуски в `src/core/frontmatter.test.mjs`); запущенный Command `pnpm test:fast -- <файлы>` фактически выполнил весь набор, отдельного частичного прогона не потребовалось. Повторных полных прогонов не было, классификация падений не понадобилась (падений нет).
**Документация:** README (раздел «Супервизор: тик, лечение и планировщик») уже обновлён в фазе Code; в Close добавлена запись **VL-275** в `CHANGELOG.md` (раздел Unreleased → «Исправлено») — отсюда закрыты AC6 и DoD «Документация обновлена». Коммит документации/уроков: `d025348`.
**DoD:** все три пункта выполнены — Тесты проходят, Документация обновлена (README + CHANGELOG), Нет регрессий (полный прогон зелёный).
**Lessons:** `lesson-141` («Проверку готовности задачи по зависимостям (isReady) применяй во ВСЕХ точках запуска фаз…») создан в фазе Code, связан с VL-275 и закоммичен в главный репо вместе с CHANGELOG. References у задачи нет.
**Примечание:** лечение исходного авто-бага по VL-239 этим фиксом задним числом не выполняется — прогон с VL-239 после закрытия VL-209 просто начнёт запускать фазы штатно.
---
<!-- COMMENTS:END -->