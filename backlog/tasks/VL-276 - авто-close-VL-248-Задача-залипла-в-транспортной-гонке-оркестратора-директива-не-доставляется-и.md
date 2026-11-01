---
id: VL-276
title: '[авто] close VL-248: Задача залипла в транспортной гонке оркестратора: директива не доставляется и...'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 17:25'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - auto-bug
  - close
dependencies: []
milestone: v1.11
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/orchestrator.ts
  - src/web/supervisor-tick.ts
  - src/web/orchestrator.test.mjs
  - src/web/supervisor-healing.test.mjs
  - README.md
lessons:
  - lesson-142
token_usage:
  input: 13488389
  output: 276844
  cache: 12887552
  total: 13765233
  requests: 163
  duration_ms: 1601703
  reasoning: 233829
  by_phase:
    plan:
      input: 2425904
      output: 119742
      cache: 2232576
      requests: 37
    code:
      input: 9582523
      output: 146475
      cache: 9223936
      requests: 90
    close:
      input: 1479962
      output: 10627
      cache: 1431040
      requests: 36
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Причина
Задача залипла в транспортной гонке оркестратора: директива не доставляется из-за «Запуск уже выполняется (VL-248)», при том что фаза close уже вызвала backlog_finish_phase, а статус остался pending. Задача помечена готовой к запуску, но каждый повторный run воспроизводит тот же фаил доставки, т.е. нет прогресса (status_unchanged). Это уровень оркестратора/транспорта директив, а не план задачи — нужно завести багом и не повторять лечебные retry. Требуется ручная проверка lifecycle запуска: снятие/сброс лока по VL-248 и запись результата уже прошедшей close-фазы.

## Последние строки лога
```
{"type":"result","result":"Фаза Close прервана: конфликт слияния `vb/vl-248` → `master` — `src/core/workflow.test.mjs`, `src/mcp/tools.ts`, `templates/phases/phase-close.md`. Merge не откатывался, конфликты не резолвились; статус/DoD/документация не тронуты. Требуется ручной разбор конфликта и новый ран Фазы Close.","is_error":false,"num_turns":5,"duration_ms":19678,"duration_api_ms":19678,"tool_calls_total":5,"session_id":"agent-1793542688829","usage":{"input_tokens":167604,"output_tokens":1251,"cache_read_input_tokens":139264,"total_tokens":168855,"reasoning_tokens":646}}
[vibelog-agent] фаза=(готовый промпт) задача=- headless=true
[vibelog-agent] Модель: baidu.rai/deepseek-v4.1-flash (routerai/deepseek/deepseek-v4.1-flash@baidu), api_mode: responses
[vibelog-agent] MCP: подключено инструментов — 42
[external-mcp] сервер «chrome-devtools»: подключено инструментов — 32
[vibelog-agent] MCP: внешних серверов подключено — 1, их инструментов — 32
[vibelog-agent] Системный промпт: 12971 символов (AGENTS.md: да)
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: backlog_phase_status
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: backlog_finish_phase
[vibelog-agent] фаза: запросов=5 (LLM-запросы/ходы модели), tool-calls=5 (лимит 100, счётчик рана — VL-221), повторов=0/5 (0%), shell-повторов=0/3 (0%), топ-повторов=нет, payload последнего запроса=142030 байт (макс 142030), usage={"input_tokens":167604,"output_tokens":1251,"cache_read_input_tokens":139264,"total_tokens":168855,"reasoning_tokens":646}
```

## Сессия
agent-1793542688829 — .vibelog/agent-sessions/agent-1793542688829.jsonl

## Цепочка лечения
- попытка 1: l2:bug

## Исходная задача
VL-248: Не ставить Done при невыполненном DoD в backlog_finish_phase

<!-- auto-bug: VL-248|3b103e9f -->
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Залипший лок оркестратора снимается автоматически: если процесс фазы уже завершился (child.exitCode/signalCode установлен) или pid мёртв, запись activeRuns удаляется, а повторный запуск той же задачи не получает «Запуск уже выполняется»
- [x] #2 getRun/countActiveRuns не сообщают running:true по мёртвому запуску; после снятия лока getRun отдаёт завершившийся ран (exitCode/logTail) либо null, а не вечный running
- [x] #3 Супервизор не крутит однотипный лечебный retry бесконечно: ошибка доставки директивы/рестарта расходует healAttempts и по исчерпанию бюджета даёт авто-баг (в тексте причины различима транспортная природа отказа)
- [x] #4 Тесты: юнит-кейсы на reap залипшего лока в src/web/orchestrator.test.mjs (стаб, чей живой потомок держит stdout-пайп, из-за чего событие close не приходит) и на расход бюджета лечения при ошибке доставки в src/web/supervisor-healing.test.mjs; полный pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст (что именно произошло)

Фаза close по VL-248 доработала до конца (агент записал результат и вызвал `backlog_finish_phase` с `aborted: true` из-за конфликта слияния `vb/vl-248 → master`), но статус задачи не сменился. Оркестратор при этом считал запуск активным: каждый последующий запуск (ретрай автоочереди/лечебная директива супервизора) отбивался guard'ом `Запуск уже выполняется (VL-248)`, а супервизор на ошибку доставки не расходовал `healAttempts` → один и тот же безуспешный шаг повторялся без прогресса (`status_unchanged`), пока цепочка не упёрлась в `l2:bug` (создана эта задача, VL-276).

Диагноз (по коду, без догадок): `activeRuns` (`src/web/orchestrator.ts`) удаляется ТОЛЬКО из `finish()`, а `finish()` вызывается только из событий `close`/`error` дочернего процесса. Node эмитит `close` не по факту смерти процесса, а после закрытия stdio-потоков. Процесс qwen/vibelog-agent завершает работу (написав `finish_phase` и JSON результата), но если stdout-пайп удерживает живой потомок (внучка-teardown: MCP-сервер агента, `npx`/node-обёртка), событие `close` не приходит никогда → запись `activeRuns` живёт вечно, `exit`-событие при этом приходит. Отсюда и «статус остался pending», и невosstanovimый «Запуск уже выполняется», и неотличимость мёртвого рана от живого в `getRun`.

## Критерий исправления

1. Лок снимается по факту смерти процесса (`exit`), а не только по `close`: гарантированный `finish()` с grace-периодом и «сборкой» залипших записей.
2. Залипший лок не показывается как живой запуск (`getRun`/`countActiveRuns`).
3. Супервизор не бесконечен на ошибке доставки: попытка расходуется, бюджет `heal_attempts` доводит до авто-бага с различимой причиной.

## Файлы к изменению

1. **`src/web/orchestrator.ts`** (1403 стр.) — основная правка.
2. **`src/web/supervisor-tick.ts`** (1670 стр.) — учёт неудачной доставки.
3. **`src/web/orchestrator.test.mjs`** — тесты reap/grace.
4. **`src/web/supervisor-healing.test.mjs`** — тест «не крутиться вечно».
5. **`README.md`** — раздел про ограничение памяти оркестратора (строка ~636 про `activeRuns`/`lastRuns`) дополнить описанием grace/reap.
6. **`CHANGELOG.md`** — запись (по правилам фазы это делает Close, lesson-63).

## Порядок работ

### Шаг 1. Grace по `exit` + reap залипших записей (`src/web/orchestrator.ts`)

1.1. Рядом с `LOG_TAIL_LINES` (строка 44) добавить константу `RUN_CLOSE_GRACE_MS = 2000` — окно после `exit`, в течение которого ждём штатный `close` (успеть вычитать остатки stdout), и тестовый шов `setRunCloseGraceMsForTests(ms | null)` по паттерну VL-140 (`setSpawnEnvBaseForTests`, строка ~158) — `null` возвращает прод-значение. Шов обязателен: тест с паузой 2 с на кейс — это медленный и флаковый тест.

1.2. `interface ActiveRun` (строки 101–107) дополнить полями: `exitCode?: number | null;` `signalCode?: string | null;` `finalize?: () => void;` — `finalize` это замыкание на `finish(exitCode)` данного рана, чтобы reap из внешнего гарда умел корректно завершить ран (закрыть probe, разобрать буферы, записать `lastRuns`, вызвать `onExit`), а не просто удалить запись.

1.3. В `spawnQwenRun` после `activeRuns.set(key, {...})` (строка 932) записать `finalize` замыканием на локальный `finish` (объявить `finish` уже существующим — порядок кода менять не нужно, достаточно зарегистрировать замыкание после определения `const finish`). Сохранить в записи результат `exit`-события.

1.4. `child.on('exit', ...)` (строки 1343–1345): кроме лога — запомнить `exitCode`/`signalCode` в записи `activeRuns` и завести таймер `setTimeout(() => finish(code), graceMs)` c `unref?.()`; лог при срабатывании: `close не пришёл за N мс — завершаю ран по exit (потомок держит stdio)`. В `child.on('close', ...)` (1351–1353) — `clearTimeout` этого таймера перед `finish(code)`. Таймер хранить в замыкании (не в интерфейсе), `finish` уже идемпотентен по флагу `finished` (1039) — двойной вызов безопасен.

1.5. Новая функция `reapStaleRuns(cwd)` (разместить рядом с `countActiveRuns`): для каждой записи `activeRuns` — если `entry.child.exitCode !== null || entry.child.signalCode !== null` либо `!isPidAlive(entry.child.pid)` (импортировать `isPidAlive` из `../core/supervisor-state.js`) → лог `[phase <key>] лок снят: процесс не найден (exit code …)`, вызвать `entry.finalize?.()`; если `finalize` нет — удалить запись вручную и положить в `lastRuns` минимальный `PhaseRun` с `running: false`/`exitCode`. Возвращать число снятых локов (для теста). Внутренняя версия `reapStaleRun(key)` для точечного вызова в гардах.

1.6. Точки вызова reap:
 - guard `spawnQwenRun` (строки 779–784): перед `return { error: 'Запуск уже выполняется' }` вызвать `reapStaleRun(key)`; если запись снята и `activeRuns.has(key)` теперь false — продолжить запуск (текст ошибки и его подстрока сохраняются как есть — lesson: существующие тесты матчат `Запуск уже выполняется`).
 - guard close-очереди (строки 314–321): тем же приёмом снять залипший лок до проверки `activeRuns.has(canon)`.
 - `startPhase` для close (строки 351–368): если `closeActive === true`, но живого close-рана нет (нет ни одной записи `activeRuns` с `phase === 'close'` у живого процесса) — сбросить `closeActive`/`closeOwner` и вызвать `drainCloseQueue()` (иначе очередь close залипает навсегда, известное ограничение VL-146 усугубляется).
 - `countActiveRuns()` (1381) и `getRun()` (1391): вызвать `reapStaleRuns(cwd)` в начале, чтобы мёртвый ран не считался активным и не отображался как `running: true`; для `getRun` — после reap вернуть запись из `lastRuns` (её положит `finalize`) либо `null`.

### Шаг 2. Супервизор: ошибка доставки расходует бюджет (`src/web/supervisor-tick.ts`)

2.1. `applyHealAction`, ветка `comment_and_retry` — обработка `'error' in res` (строки 1541–1545). Сейчас: `entry.lastError = 'директива не доставлена: …'` и `return {}` — `healAttempts` НЕ растёт, статус остаётся прежним, следующий тик повторяет ровно тот же шаг (наблюдаемое «нет прогресса»). Заменить на:
 - `entry.healAttempts += 1;`
 - `entry.status = 'failed';`
 - `entry.pid = undefined; entry.phaseRunId = undefined;`
 - `entry.lastError = classifyDeliveryError(res.error)` — новая маленькая функция: если `/Запуск уже выполняется|уже идёт/` → `«фаза занята локом оркестратора (транспорт): <текст>»`; иначе → `«директива не доставлена: <текст>»`. Причина попадает в heartbeat/авто-баг, и по ней видно, что дело в транспорте, а не в содержании задачи.
 - лог в `console.log` с taskId/ruleId (диагностика инцидента).

2.2. Та же правка в ветке retry (`retry` / `retry_once_then_bug` / default), строки 1557–1570 (`entry.lastError = 'перезапуск фазы не удался: ' + res.error; return {};`) — тот же `healAttempts += 1` + `status = 'failed'` + `classifyDeliveryError`.

2.3. За счёт 2.1/2.2 бюджет ограничен: L1-цикл (строки 1150/1310) при `healAttempts >= runtime.healAttempts` (дефолт 2, `DEFAULT_HEAL_ATTEMPTS`) уходит в `createAutoBug` → «попытка 2/3: bug» с осмысленной причиной. Отдельного счётчика «транспортных» попыток не вводим — не плодим состояние; различимость даёт текст причины.

2.4. Автоочередь (`src/bot/auto-runner.ts`, `finishCurrentPhase`, ~370–394) НЕ трогаем: там `handlePhaseFailure` уже ведёт к `failed_permanent` (VL-228) — правка не нужна, риск лишней регрессии.

### Шаг 3. Тесты

3.1. `src/web/orchestrator.test.mjs`: расширить стаб qwen (литерал `STUB`, строки ~63–95) режимом `VL28_STUB_HOLD_STDOUT=1` — стаб спавнит `node -e "setTimeout(()=>{},30000)"` с наследованием stdout/stderr (`stdio: ['ignore',1,2]`, `detached: true`) и сразу выходит; потомок держит пайп → `close` не приходит, `exit` приходит. Кейсы (новый `describe` рядом с guard-тестами, ~строка 2186):
 - «лок снимается по exit, повторный запуск проходит»: со швом `setRunCloseGraceMsForTests(150)` — после первого `startPhase` дождаться `getRun(...)` с `running: false` (или `null`) → второй `startPhase` той же задачи возвращает `{ started: true }`, а не `Запуск уже выполняется`.
 - «getRun не врёт про running по мёртвому процессу»: сразу после снятия лока `getRun` отдаёт `running: false` c `exitCode` (запись из `lastRuns`, положенная `finalize`) либо `null` — оба варианта допустимы, `running: true` — нет.
 - Шов и `VL28_STUB_*` сбрасывать в `finally` (isolate:false — утечка в другие файлы).
3.2. `src/web/supervisor-healing.test.mjs`: кейс «ошибка доставки директивы расходует healAttempts и доходит до бага» — шов `setTickStartPhaseForTests(() => ({ error: 'Запуск уже выполняется (VL-1)' }))`, `seedFailed(task, { healAttempts: 0 })`, прогнать два тика с правилом `retry_once_then_bug` → после первого тика `healAttempts === 1`, после второго — создан авто-баг и `entry.frozen === true`; проверить, что `lastError` содержит признак транспорта. Шов сбрасывать в `finally`.

### Шаг 4. Документация

4.1. `README.md` — в абзац про ограничение памяти оркестратора (строка ~636) добавить: ран завершается по `exit` с grace-периодом (`RUN_CLOSE_GRACE_MS`), залипшие записи `activeRuns` с мёртвым процессом снимаются автоматически при гардах/`getRun`/`countActiveRuns`; очередь close получает тот же reap.
4.2. `CHANGELOG.md` — запись VL-276 (делает Close, lesson-63).

## Проверка

```
pnpm build && npx vitest run src/web/orchestrator.test.mjs src/web/supervisor-healing.test.mjs
```
затем обязательный полный прогон (DoD «Тесты проходят» без него не закрывается):
```
pnpm test
```
Ручная проверка на живом стенде (операторская часть формулировки задачи, кода не касается): `backlog_phase_status {id:"VL-248"}` → убедиться, что `running: false` и лока нет; записать в VL-248 результат уже прошедшей close-фазы (прерывание из-за конфликта `vb/vl-248 → master` в `src/core/workflow.test.mjs`, `src/mcp/tools.ts`, `templates/phases/phase-close.md`) — комментарием; после ручного разрешения конфликта запустить close заново. После правки тот же сценарий (залипший лок) должен воспроизводимо самоустраняться.

## Риски

1. **Обрезание позднего stdout в grace-окне.** Если `close` приходит позже grace, `finish` по таймеру может не добрать хвост потока → `parseQwenResult` вернёт undefined и result рана потеряется. Митигация: grace 2 с (типичный teardown — десятки мс), перед парсингом `finish` уже досыпает `tailBuf`/`stderrTailBuf` (1043–1050), при срабатывании таймера пишем предупреждение в лог; диагностический дамп stdout (1310–1320) сохраняется.
2. **Reap как побочный эффект в read-путях** (`getRun`/`countActiveRuns` мутируют карты). Допустимо: снимаем только заведомо мёртвые записи (`exitCode !== null`/`!isPidAlive`), живой процесс не трогаем; инвариант «`activeRuns` ⇒ живой процесс» усиливается — ранее он нарушался.
3. **Повторный `finish`** из таймера после `close` — закрыт флагом `finished` (1039) и `clearTimeout` в обработчике `close`; `onExit` вызывается ровно один раз (иначе бот/автоочередь получат двойное уведомление).
4. **Смена учёта `healAttempts` у супервизора** сокращает бюджет для genuinely внешних отказов (например, чужой незакоммиченный merge, lesson-82) — два ретрая и авто-баг; это и требовалось («не повторять лечебные retry»). Текст причины сохраняет различимость транспорта, поэтому разбор не теряется.
5. **Результат уже прошедшей close-фазы VL-248 кодом не восстановить** — это ручной шаг оператора (см. «Проверка»); в план входит только предотвращение повторения класса (лок + бюджет лечения). Скоуп VL-248 (терминальный DoD/`dodOverride`) правкой не затрагивается.
6. **`closeActive`-сброс** (шаг 1.6) меняет поведение очереди close: сбрасываем флаг только когда живого close-рана нет вообще; при живом ране поведение прежнее (VL-146), регрессии нет — закрепить тестом из 3.1 на снятие лока и существующим тестом очереди (orchestrator.test.mjs ~2186).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 18:38
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic) — план записан в Implementation Plan самой задачи, дочерних задач/блокеров не создавал.
**Диагноз по коду (не план задачи, а оркестратор/транспорт — как и сказано в описании):** `activeRuns` (`src/web/orchestrator.ts`) удаляется ТОЛЬКО из `finish()`, а `finish()` вызывается только событиями `close`/`error` дочернего процесса. Node эмитит `close` не по смерти процесса, а после закрытия stdio-потоков: если stdout-пайп удерживает живой потомок (внучка-teardown qwen/vibelog-agent: MCP-сервер, node-обёртка), `close` не приходит никогда, хотя `exit` приходит. Отсюда ровно наблюдаемое: close-фаза VL-248 доработала (вызвала `backlog_finish_phase` с `aborted: true` из-за конфликта `vb/vl-248 → master`), статус не сменился, а лок «Запуск уже выполняется (VL-248)» вечен. Второй множитель — `src/web/supervisor-tick.ts:applyHealAction`: ветки `comment_and_retry` и `retry` при `'error' in res` пишут `lastError` и `return {}` **без** `healAttempts += 1`, поэтому лечебная директива повторяется бесконечно на том же отказе (`status_unchanged`), пока не сгорит цепочка до `l2:bug`.
**Решения плана:** (1) ран закрывается по `exit` с grace-периодом (`RUN_CLOSE_GRACE_MS`) + тестовый шов `setRunCloseGraceMsForTests` (паттерн VL-140, чтобы тест не ждал 2 с); (2) `reapStaleRuns()` снимает залипшие записи по `child.exitCode/signalCode`/`!isPidAlive` через сохранённый в `ActiveRun` `finalize` — состояние рана (logTail, `lastRuns`, `onExit`) не теряется, `onExit` не дублируется (флаг `finished` + `clearTimeout`); (3) reap вызывается в гарде `spawnQwenRun`, в гарде close-очереди, в `countActiveRuns`/`getRun` — мёртвый ран перестаёт показываться как `running: true`, повторный запуск проходит; (4) сброс залипшего `closeActive` с `drainCloseQueue`, иначе очередь close VL-146 залипает навсегда; (5) супервизор: неудачная доставка директивы/рестарта расходует `healAttempts` и переводит entry в `failed`, причина классифицируется (`фаза занята локом оркестратора (транспорт)` vs `директива не доставлена`) — различимость в heartbeat и авто-баге; (6) автоочередь (`auto-runner.ts`) не трогаю — там `handlePhaseFailure` уже даёт `failed_permanent` (VL-228).
**Файлов к изменению:** 6 — `src/web/orchestrator.ts` (основная правка), `src/web/supervisor-tick.ts`, `src/web/orchestrator.test.mjs`, `src/web/supervisor-healing.test.mjs`, `README.md` (абзац у строки ~636 про ограничение памяти `activeRuns`/`lastRuns`), `CHANGELOG.md` (пишет Close, lesson-63). Все пути проверены через `ls`.
**Проверки в плане:** `pnpm build && npx vitest run src/web/orchestrator.test.mjs src/web/supervisor-healing.test.mjs`, затем обязательный полный `pnpm test` (DoD «Тесты проходят» частичным прогоном не закрывается). Тесты: стаб-режим `VL28_STUB_HOLD_STDOUT=1` (потомок держит пайп → `close` не приходит) на два кейса — снятие лока и правдивость `getRun`; кейс супервизора «ошибка доставки расходует healAttempts → авто-баг».
**Риск/открытый пункт (операторское, кодом не решается):** результат уже прошедшей close-фазы VL-248 восстановить кодом нельзя — нужен ручной шаг: убедиться, что лока нет (`backlog_phase_status {id:"VL-248"}` → `running: false`), записать комментарием итог прерванного close (конфликт в `src/core/workflow.test.mjs`, `src/mcp/tools.ts`, `templates/phases/phase-close.md`), разрешить конфликт `vb/vl-248 → master` и запустить close заново. Это зафиксировано в плане (раздел «Проверка»), в скоуп VL-276 как кодовой правки не входит.
References у задачи нет — новых не добавлял. Lessons (100, 121, 82, 83) учтены: guard внешнего git-состояния оставлен как есть, падение тестов в Close будет проверяться diff'ом `HEAD^1`, полный прогон — один после классификации.
---
author: @agent
created: 2026-11-01 18:43
---
Фаза code не удалась (код выхода 1): earch_files|Запуск уже выполняется×3, payload последнего запроса=450571 байт (макс 450571), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-01 18:56
---
Фаза 3 (Code) выполнена. Коммит `432d51b` в ветке vb/vl-276 (worktree); файлы backlog/ не коммичены.
**Изменено (5 файлов):**
- `src/web/orchestrator.ts` — (1) `RUN_CLOSE_GRACE_MS = 2000` + тестовый шов `setRunCloseGraceMsForTests` (паттерн VL-140; null → прод-значение); (2) `ActiveRun` дополнен `exitCode`/`signalCode`/`finalize`; (3) `finish` теперь `(code = null)` и публикуется в записи как `finalize` — внешний reap завершает ран через штатный путь (буферы, парсинг результата, `lastRuns`, `finalizePhaseStatus`, ровно один `onExit`); (4) обработчик `exit` запоминает код/сигнал и заводит grace-таймер (`unref`), который при отсутствии `close` пишет лог «close не пришёл за N мс — завершаю ран по exit (потомок держит stdio)» и вызывает `finish(code)`; `close`/`error` чистят таймер; (5) новые `reapStaleRun(key)`/`reapStaleRuns()` — снимают только заведомо мёртвые записи (exit-код/сигнал установлен либо pid отвечает ESRCH), через `finalize`; живой процесс и не-выданный pid (ENOENT) не трогают; (6) `hasLiveCloseRun()` + сброс залипшего `closeActive`/`closeOwner` с `drainCloseQueue()` — очередь close VL-146 больше не залипает навсегда; (7) reap вызывается в гарде `spawnQwenRun`, в гарде close-очереди, в `countActiveRuns()` и `getRun()` (мёртвый ран не выглядит `running: true`, не занимает слот `max_parallel_phases`); текст «Запуск уже выполняется» сохранён как был.
- `src/web/supervisor-tick.ts` — новый экспорт `classifyDeliveryError(error, base)`: лок оркестратора («Запуск уже выполняется / уже идёт / уже в очереди») → «фаза занята локом оркестратора (транспорт): …», иначе «<base>: …». В `applyHealAction` обе ветки отказа доставки (`comment_and_retry` и retry/`retry_once_then_bug`/default) теперь делают `healAttempts += 1`, `status = 'failed'`, сбрасывают `pid`/`phaseRunId`, пишут классифицированный `lastError` и лог. Раньше бюджет не тратился → один и тот же безуспешный шаг повторялся до конца прогона (ровно инцидент VL-248).
- `src/web/orchestrator.test.mjs` — режим стаба `VL28_STUB_HOLD_STDOUT`: стаб спавнит внука с наследованием stdout/stderr (`stdio: ['ignore', 1, 2]`, `detached`, 3 с) и сразу выходит → приходит `exit`, `close` не приходит. Новый `describe` из 2 кейсов: (а) лок снимается по exit — `getRun` не `running`, `countActiveRuns() === 0`, повторный `startPhase` той же задачи проходит; (б) живой ран reap не снимает — `running: true` и guard двойного запуска отвечает «Запуск уже выполняется (VL-2)». Свой экземпляр стаба на тест (общий `stubBin` удаляется в afterAll первого describe — при фильтрованном прогоне `-t` его уже нет), шов/env сбрасываются в `finally`.
- `src/web/supervisor-healing.test.mjs` — кейс «ошибка доставки директивы/рестарта расходует healAttempts и доходит до авто-бага»: стаб `startPhase` возвращает `{error: 'Запуск уже выполняется (VL-N)'}`; тик 1 → `healAttempts === 1`, `status === 'failed'`, `lastError` с признаком транспорта, бага ещё нет; тик 2 → `healAttempts === 2`; тик 3 → авто-баг и `frozen: true`. Швы сбрасываются в `afterEach`.
- `README.md` — в разделе про супервизор: два новых абзаца — «Залипший лок фазы (VL-276)» (grace по exit, reap в гардах/`getRun`/`countActiveRuns`, сброс `closeActive`) и «Неудачная доставка директивы лечения (VL-276)» (расход `heal_attempts`, классификация причины).
**Проверки:** `pnpm build` (tsc, чисто) → `npx vitest run src/web/orchestrator.test.mjs` (83 passed) → `npx vitest run src/web/supervisor-healing.test.mjs` (20 passed) → полный `pnpm test`: 120 файлов, **2280 passed, 4 skipped, 0 failed**, исключений/`--skip` не было. DoD «Тесты проходят» закрыт полным прогоном; «Нет регрессий» — 0 failed. Документация (README) обновлена, CHANGELOG и backlog/docs — по правилам фазы пишет Close.
**Что осталось:** (1) операторская часть формулировки задачи кодом не решается — в VL-248 нужно вручную записать итог прерванной close-фазы (конфликт `vb/vl-248 → master` в `src/core/workflow.test.mjs`, `src/mcp/tools.ts`, `templates/phases/phase-close.md`) и после разрешения конфликта перезапустить close; (2) запись в `CHANGELOG.md` — фаза Close (lesson-63).
**Lesson:** создан lesson-142 («Закрывай ран фазы по событию exit с grace-таймером, а не только по close — stdout-пайп может держать потомок»), связан с задачей.
---
author: @agent
created: 2026-11-01 18:58
---
Фаза Close прервана: merge `vb/vl-276` → `master` невозможен — главный репозиторий содержит незакоммиченные правки параллельной задачи VL-277 (статус In Progress, фаза code, ведётся без worktree): `src/agent/cli.ts`, `src/agent/cli.test.mjs`, `src/web/orchestrator.ts`, `src/web/orchestrator.test.mjs`, `templates/phases/phase-close.md`, `templates/phases/phase-close-worktree.md`, `src/agent/task-commit.ts`, `src/agent/task-commit.test.mjs`. Пересечение именно по файлам VL-276 (`src/web/orchestrator.ts`, `src/web/orchestrator.test.mjs`), поэтому git отказывает до слияния: «error: Your local changes to the following files would be overwritten by merge: src/web/orchestrator.test.mjs, src/web/orchestrator.ts … Aborting». Merge не начат, конфликтных файлов нет, ничего не откатывалось и не резолвилось; статус/DoD/документация не тронуты.
Состояние: ветка `vb/vl-276` цела (коммит 432d51b), worktree `.vibelog/worktrees/vl-276` чистый (только untracked-симлинки `node_modules`, `backlog/references/data`) и НЕ удалён, ветка не удалена.
Что нужно: завершить (закоммитить или слить) работу VL-277 в главном репо и повторить Фазу Close VL-276. Требуется ручной выбор порядка — трогать чужие незакоммиченные файлы в этой фазе запрещено.
---
author: @agent
created: 2026-11-01 18:59
---
Фаза close прервана агентом (aborted): Фаза Close прервана: merge `vb/vl-276` → `master` невозможен — главный репозиторий содержит незакоммиченные правки параллельной задачи VL-277 (статус In Progress, фаза code, ведётся без worktree): `src/agent/cli.ts`, `src/agent/cli.test.mjs`, `src/web/orchestrator.ts`, `src/web/orchestrator.test.mjs`, `templates/phases/phase-close.md`, `templates/phases/phase-close-worktree.md`, `src/agent/task-commit.ts`, `src/agent/task-commit.test.mjs`. Пересечение именно по файлам VL-276 (`src/web/orchestrat — статус возвращён к Review.
---
author: @agent
created: 2026-11-01 19:08
---
Фаза Close выполнена. Ветка `vb/vl-276` слита в master (1 коммит — `432d51b`; merge-коммит `215fb27` без конфликтов), worktree `.vibelog/worktrees/vl-276` удалена (force — в ней оставались только untracked-симлинки `node_modules` и `backlog/references/data`), ветка удалена (`git branch -d`).
Проверки после merge: `pnpm build` — ок; ранний точечный прогон `src/web/orchestrator.test.mjs` + `src/web/supervisor-healing.test.mjs` — 104 passed (включая новые кейсы VL-276: «лок снимается по exit, повторный запуск проходит; getRun не врёт про running», «живой ран не снимается reap-ом»); полный `pnpm test` — 121 файл, 2293 passed, 4 skipped, 0 failed.
DoD: 1) Тесты проходят — полный прогон зелёный; 2) Документация обновлена — README (§«Ограничение памяти оркестратора»: grace/reap) в ветке, CHANGELOG.md (запись VL-276 в Unreleased → Исправлено, коммит `6d2c65a`); 3) Нет регрессий — полный прогон зелёный, оба тест-файла смоука проходят вместе с остальными 119 файлами.
Урок: lesson-142 (снятие лока по `exit` с grace-таймером + reap залипших записей + расход `healAttempts` на ошибку доставки), связка с задачей обновлена.
Операторская часть формулировки (ручная запись результата уже прошедшей close-фазы VL-248 и разрешение конфликта `vb/vl-248 → master`) кодом не выполняется — остаётся за оператором, как и было оговорено в плане (риск 5).
---
<!-- COMMENTS:END -->