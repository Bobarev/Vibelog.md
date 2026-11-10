---
id: VL-411
title: Повтор noop-вызова блокирует инструмент в ране вместо счёта до трёх
status: Review
assignee: []
reporter: ''
created_date: '2026-11-10 16:59'
updated_date: '2026-11-10 18:44'
due_date: ''
labels:
  - agent
  - core
dependencies:
  - VL-410
milestone: ''
references: []
priority: ''
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/loop.ts
  - src/agent/repeat-tracker.ts
  - src/agent/loop-repeat-cap.test.mjs
  - src/agent/loop.test.mjs
  - src/agent/repeat-tracker.test.mjs
  - src/agent/directive-size-property.test.mjs
  - src/agent/loop-properties.mjs
  - src/mcp/tool-outcome-trace.test.mjs
lessons: []
token_usage:
  input: 6544937
  output: 49926
  cache: 6401536
  total: 6594863
  requests: 74
  duration_ms: 1581830
  reasoning: 28497
  by_phase:
    code:
      input: 6136467
      output: 47448
      cache: 6013952
      requests: 63
    close:
      input: 408470
      output: 2478
      cache: 387584
      requests: 11
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Продолжение разбора падения фазы spec VL-408 (сессия `agent-1794313856082`). Модель четыре раза дословно повторила `backlog_update_task {id, type}`, получила четыре одинаковых noop-директивы и упёрлась в кап `MAX_NOOP_REPEATS_PER_RUN=3` → `fail()` → откат статуса.

Сейчас эскалации нет: 1-й, 2-й и 3-й повтор дают модели ОДИН И ТОТ ЖЕ текст, 4-й убивает ран. Модель четыре раза игнорирует директиву, потому что ничто не мешает ей повторить вызов ещё раз.

Отдельно отвергнутое решение (не реализовывать): считать успешный MCP write-ack (`ok:true`, `outcome:'applied'`) следом работы в `runHasProgress()`. Это класс VL-124/VL-368 — ложный успех рана: ран завершится `is_error:false`, статус не откатится, авто-resume не запустится, и недоделанная задача молча повиснет. `runHasProgress()` остаётся на `edit`/`write_file`/`git_commit`/shell-работе.

Цель: сделать повтор физически невозможным, а не увеличивать число попыток. Если ран всё же кончился без `backlog_finish_phase` — честный `fail()` с причиной, называющей незавершённую фазу (чтобы человек и авторежим видели именно это, а не «модель зациклилась»).

Зависит от VL-410: текст следующего шага берётся из `phaseNextStep`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После второго дословного повтора вызова, вернувшего `noop:true`, этот инструмент блокируется в ране: следующий вызов той же сигнатуры не доходит до handler и получает ответ «инструмент заблокирован в этом ране: работа фазы закончена, доступен backlog_finish_phase»
- [x] #2 Блокировка per-name не мешает другим инструментам: `backlog_finish_phase`, `backlog_manage_ac`, `backlog_manage_dod` и чтения проходят после блокировки `backlog_update_task`
- [x] #3 Блокировка включается только на дословном повторе той же сигнатуры (`name|args`); вызов того же инструмента с ДРУГИМИ аргументами исполняется как обычно
- [x] #4 `runHasProgress()` не изменён: успешный MCP write-ack (`ok:true`, `outcome:'applied'`) по-прежнему НЕ считается следом работы (регресс-тест VL-124/VL-368 остаётся зелёным)
- [x] #5 Текст `fail()` при исчерпании капа называет незавершённую фазу и отсутствие `backlog_finish_phase`, а не только «модель повторила вызов»
- [x] #6 Регресс-тест на сессию `agent-1794313856082`: 3 applied + 4 noop `{id,type}` → ран доходит до `backlog_finish_phase` (или падает с текстом про незавершённую фазу), но не крутится на повторах
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы и правки

**`src/agent/loop.ts`** — эскалация noop-повтора:
- рядом с `noopSignatures`/`noopRepeatCount` (`:540`) добавить `blockedTools = new Set<string>()` — имена инструментов, заблокированных в ране;
- в `blockAndPush` (`:1195`) в ветке `noopSignatures.has(signature)`: при `noopRepeatCount >= 2` добавить `call.name` в `blockedTools` и в текст директивы дописать «Инструмент `<name>` заблокирован в этом ране — доступен `backlog_finish_phase`»;
- в начале обработки `validCalls` (до `blockAndPush`) — проверка `blockedTools.has(call.name)`: ответ `serializeAck({outcome:'rejected', reason:'tool_blocked', message: '…', extra:{tool_blocked:true}})`, вызов не исполняется, счётчики не растут;
- `resetRepeatSeries` (`:1302`) НЕ снимает `blockedTools` (блокировка до конца рана — иначе цикл возобновится);
- `fail()` при исчерпании капа (`:1369`): текст `Модель N раз повторила вызов <name>, вернувший «изменений нет» — вызов не исполнялся. Фаза <phase> не завершена: backlog_finish_phase не вызван.` Фаза — из `RunLoopOptions.phase`.

**`src/agent/repeat-tracker.ts`** — `REPEAT_LIMITS` += `noopBlockAfter: 2` (порог блокировки инструмента, отдельно от `noop: 3` — кап рана); производная `NOOP_BLOCK_AFTER_REPEATS`. Пороги остаются в единственном источнике (VL-357/VL-359).

**`src/agent/loop.ts:370`** — `WORK_EVIDENCE_TOOLS` и `runHasProgress()` НЕ трогать. В комментарии к функции дописать явно: «успешный MCP write-ack работой не считается — это класс VL-124/VL-368 (ложный успех рана)».

## Порядок

1. `REPEAT_LIMITS.noopBlockAfter` + тест в `src/agent/repeat-tracker.test.mjs`.
2. `blockedTools` + проверка в цикле + текст директивы.
3. Текст `fail()` с именем фазы.
4. Регресс-тесты в `src/agent/loop-repeat-cap.test.mjs` и `src/agent/loop.test.mjs`.

## Проверка

`pnpm build && pnpm test`. Целевые: `src/agent/loop-repeat-cap.test.mjs` (блокировка после 2-го повтора, `backlog_finish_phase` проходит, другой инструмент проходит, вызов с другими аргументами проходит), `src/agent/loop.test.mjs` (регресс `agent-1794313856082`), `src/agent/repeat-tracker.test.mjs` (порог из `REPEAT_LIMITS`), `src/mcp/tool-outcome-trace.test.mjs` (новый исход `tool_blocked` в матрице).

## Риски

- Блокировка per-name может отрезать легитимный вызов, если модель после noop захочет обновить другое поле. Снимается тем, что блокировка включается только на дословном повторе той же сигнатуры, а вызов с другими аргументами проходит.
- Новый исход `rejected`/`tool_blocked` попадает в `isFailureResponse` (`runHasProgress`) как «не работа» — это правильно, но проверить, что он не считается и «прогрессом» в `buildRunProgress`.
- `blockedTools` не сбрасывается на resume — проверить, что состояние живёт в пределах рана (локальная переменная `runLoop`), а не в модуле.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 18:21
---
Фаза 3 (Code) выполнена. Коммит 30cef3a.
**Что сделано**
1. `src/agent/repeat-tracker.ts` — `REPEAT_LIMITS.noopBlockAfter: 2` (порог блокировки инструмента, отдельно от `noop: 3` — кап рана) + производная `NOOP_BLOCK_AFTER_REPEATS`; новая директива `toolBlockedDirective(name, phase?)` — `serializeAck({outcome:'rejected', reason:'tool_blocked', extra:{tool_blocked:true, phase}})` с текстом «Инструмент X заблокирован в этом ране… доступен backlog_finish_phase».
2. `src/agent/loop.ts` — `blockedTools = new Set<string>()` (локальная переменная `runLoop`, живёт в пределах рана) + `blockedToolStreak`; в ветке `noopSignatures` при `noopRepeatCount >= NOOP_BLOCK_AFTER_REPEATS` имя инструмента попадает в `blockedTools`, и директива этого повтора уже сообщает о блокировке; в начале обработки `validCalls` — проверка `blockedTools.has(call.name) && noopSignatures.has(signature)`: вызов не доходит до handler, счётчики повторов не растут, ответ — `tool_blocked`. `resetRepeatSeries` сбрасывает только серию (`blockedToolStreak`), сам набор `blockedTools` НЕ чистит — блокировка до конца рана. Текст `fail()` при исчерпании капа называет незавершённую фазу и отсутствие `backlog_finish_phase`.
3. `runHasProgress()` / `WORK_EVIDENCE_TOOLS` НЕ изменены; в комментарий к функции дописано явно: успешный MCP write-ack работой не считается — класс VL-124/VL-368 (ложный успех рана).
**Тесты**
- `src/agent/loop-repeat-cap.test.mjs` — новый блок VL-411 (5 тестов): AC1 (после 2-го повтора handler не вызывается, ответ `tool_blocked`), AC2 (per-name: `backlog_finish_phase`/`backlog_manage_ac`/чтения проходят), AC3 (другие аргументы того же инструмента исполняются), AC5 (кап обращений к заблокированному инструменту → fail с «Фаза spec не завершена: backlog_finish_phase не вызван»), AC6 (регресс `agent-1794313856082`: 3 applied + 4 noop `{id,type}` → ран доходит до `backlog_finish_phase`, `is_error:false`).
- `src/agent/repeat-tracker.test.mjs` — порог `REPEAT_LIMITS.noopBlockAfter === 2`, `NOOP_BLOCK_AFTER_REPEATS` — производная, `noopBlockAfter < noop`.
- `src/agent/loop-properties.mjs` + `src/mcp/tool-outcome-trace.test.mjs` — новое свойство P6 «повтор noop-вызова блокирует инструмент в ране» и привязка `VL-411 → P6` (матрица 14 задач).
- `src/agent/loop.test.mjs` — регресс VL-310 (agent-1793637056809) обновлён под новое поведение: серия noop-директив теперь короткая, дальше приходит `tool_blocked`; проверяются оба вида ответа.
- `src/agent/directive-size-property.test.mjs` — P5-тест серии noop-повторов переписан: серия обрывается блокировкой, проверяется потолок размера директив и число noop-директив ≤ порога блокировки.
**Проверки**
`pnpm build` — успешно. Полный `pnpm test` — 220 файлов, 4249 тестов passed, 4 skipped, 0 failed. Первые два прогона дали по одному падению в чужих файлах (`src/core/report.test.mjs` — `process.exitCode`, и git-commit-тест с `token_usage`); оба файла по отдельности и в повторном полном прогоне зелёные — падения плавающие, к diff'у VL-411 не относятся (ни один из файлов не затронут).
**Что осталось**
DoD «Документация обновлена» не отмечен: в фазе Code документация (CHANGELOG, backlog/docs) не пишется — это работа фазы Close после merge. DoD «Тесты проходят» и «Нет регрессий» отмечены по полному прогону.
---
author: @agent
created: 2026-11-10 18:27
---
Фаза Close прервана: конфликт слияния vb/vl-411 → master в файле src/agent/loop.ts (git status --porcelain: `UU src/agent/loop.ts`; остальные файлы ветки слились автоматически: src/agent/repeat-tracker.ts, src/agent/loop.test.mjs, src/agent/loop-repeat-cap.test.mjs, src/agent/directive-size-property.test.mjs, src/agent/loop-properties.mjs, src/agent/repeat-tracker.test.mjs, src/mcp/tool-outcome-trace.test.mjs). Конфликтный путь вне разрешённого для Close множества (CHANGELOG.md, backlog/docs/*), поэтому резолв в фазе Close запрещён — правка кода в Close недопустима. Merge не прерывался (git merge --abort не выполнялся), состояние конфликта остаётся в главном репозитории.
Что нужно сделать, чтобы повторить фазу: разработчику вручную разрешить конфликт в src/agent/loop.ts в главном репозитории (свести изменения VL-411 — blockedTools/NOOP_BLOCK_AFTER_REPEATS/текст fail() — с текущим master, сохранив обе стороны по смыслу), выполнить `git add src/agent/loop.ts && git commit --no-edit` для завершения merge-коммита, затем перезапустить Фазу Close задачи VL-411. Если конфликт затрагивает логику, требующую переработки, — вместо ручного резолва нужна новая фаза Code (rebase ветки vb/vl-411 на master) и только после неё Close.
---
author: @agent
created: 2026-11-10 18:27
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-411 → master в файле src/agent/loop.ts (git status --porcelain: `UU src/agent/loop.ts`; остальные файлы ветки слились автоматически: src/agent/repeat-tracker.ts, src/agent/loop.test.mjs, src/agent/loop-repeat-cap.test.mjs, src/agent/directive-size-property.test.mjs, src/agent/loop-properties.mjs, src/agent/repeat-tracker.test.mjs, src/mcp/tool-outcome-trace.test.mjs). Конфликтный путь вне разрешённого для Close множества (CHANGELOG.md, backlog/docs/*), — статус возвращён к Review.
---
author: @agent
created: 2026-11-10 18:44
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Review (целевой был Done — переход заблокирован)
AC отмечено: 6 из 6
DoD отмечено: 2 из 3
DoD не отмечены (1): 2. Документация обновлена
Файлы (8): src/agent/loop.ts, src/agent/repeat-tracker.ts, src/agent/loop-repeat-cap.test.mjs, src/agent/loop.test.mjs, src/agent/repeat-tracker.test.mjs, src/agent/directive-size-property.test.mjs, src/agent/loop-properties.mjs, src/mcp/tool-outcome-trace.test.mjs
Фрагмент плана: ## Файлы и правки **`src/agent/loop.ts`** — эскалация noop-повтора: - рядом с `noopSignatures`/`noopRepeatCount` (`:540`) добавить `blockedTools = new Set<string>()` — имена инструментов, заблокированных в ране; - в `blockAndPush` (`:1195`) в ветке `noopSignatures.has(signature)`: при `noopRepeatCou…
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
<!-- COMMENTS:END -->