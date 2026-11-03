---
id: VL-326
title: 'Веб-чат: idempotencyKey входит в сигнатуру вызова и обходит дедуп, noop-ответы не считаются — модель крутится на повторах (инцидент VL-324)'
status: In Progress
assignee: []
reporter: ''
created_date: '2026-11-03 23:08'
updated_date: '2026-11-04 00:10'
due_date: ''
labels:
  - web
  - mcp
  - agent
  - chat
  - bugfix
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
  - src/web/tool-dedup.ts
  - src/web/chat.ts
  - src/mcp/tool-result.ts
  - src/mcp/tools.ts
  - templates/prompts/chat-system.md
  - src/web/tool-dedup.test.mjs
  - src/web/chat.test.mjs
  - src/mcp/write-ack.test.mjs
lessons:
  - lesson-205
token_usage:
  input: 23697380
  output: 96315
  cache: 22167552
  total: 23793695
  requests: 212
  duration_ms: 2050964
  reasoning: 38801
  by_phase:
    code:
      input: 23483426
      output: 95459
      cache: 21979136
      requests: 206
    close:
      input: 213954
      output: 856
      cache: 188416
      requests: 6
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст (инцидент в веб-чате)

При заполнении задачи VL-324 модель 12 раз подряд вызвала `backlog_update_task`, каждый раз передавая только уже применённые поля (`priority`, `type`) — `description`/`acceptanceCriteria`/`plan` в аргументы не попадали вовсе. Инструмент честно отвечал `noop` («Изменений нет: priority, type уже имеют эти значения»), модель ответ не читала и повторяла вызов, меняя только `idempotencyKey`.

Ошибка модели — первопричина, но три системных пробела сделали петлю возможной и неограниченной:

1. **`idempotencyKey` входит в сигнатуру вызова.** `callSignature` (`src/web/tool-dedup.ts:78`) = `name|stableSerialize(args)`, а `args` содержит `idempotencyKey`. Новый ключ на каждый повтор → сигнатуры различаются → guard возвращает `execute` вместо `duplicate`. Дедупликация обходится сменой служебного поля, хотя ключ — маркер повтора, а не семантика вызова.

2. **В веб-чате нет учёта noop-ответов.** В агентской петле есть `noopSignatures` + `MAX_NOOP_REPEATS_PER_RUN` (`src/agent/loop.ts:603,1146,1487`), в `src/web/chat.ts` — только `createTurnToolGuard` с вердиктами `execute`/`duplicate`/`limit`. Серия ответов «изменений нет» не считается; лимит вызовов на ответ (16) сбрасывается `beginTurn()` на каждом ответе модели, поэтому вечного цикла ничто не останавливает.

3. **Текст noop-ответа не подсказывает причину.** `ackNoop` говорит «Следующий шаг: backlog_finish_phase» — в чат-режиме этого инструмента нет; главного сигнала («ты передал только уже применённые поля — если нужны другие, передай их в этом же вызове») не звучит. Плюс в `templates/prompts/chat-system.md:33` контракт описан только как «успех `{ok:true}` / отказ `{ok:false, denied}`» — форма `noop` (`ok:false, noop:true, reason:'noop'`, VL-304) не описана, и модель трактует её как ошибку → «попробую ещё раз».

## Что меняем

- `src/web/tool-dedup.ts` — исключить несемантические аргументы (`idempotencyKey`) из сигнатуры через константу `NON_SEMANTIC_ARGS`; добавить учёт noop-серии (кап по образцу агентской петли) и ответ `{ok:false, noop_repeat:true, message}`.
- `src/web/chat.ts` — подключить учёт noop в `executeTool` (единая точка: обычный цикл, resume, `advanceToNextApproval`), счетчик в `repeat_stats`.
- `src/mcp/tool-result.ts` — `hint` в `ackNoopDetailed` для «передай недостающие поля в этом же вызове» (аддитивно, `ackNoop` не меняется).
- `templates/prompts/chat-system.md` — описать форму `noop` и правило «noop ≠ ошибка; повтор с теми же аргументами бессмыслен».
- Тесты + CHANGELOG + lesson.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC1: `callSignature` в `src/web/tool-dedup.ts` игнорирует служебное поле `idempotencyKey` — два вызова с одинаковыми содержательными аргументами и разными ключами дают одинаковую сигнатуру, повтор получает вердикт `duplicate`
- [x] #2 AC2: Список несемантических аргументов вынесен в одну константу (`NON_SEMANTIC_ARGS`) и покрыт тестом: добавление нового служебного поля не требует правок в логике
- [x] #3 AC3: В веб-чате (`src/web/chat.ts`) ведётся учёт noop-ответов по сигнатуре: серия дословных повторов вызова, вернувшего `noop:true`, ограничена капом (по образцу `MAX_NOOP_REPEATS_PER_RUN` в `src/agent/loop.ts`), на исчерпании модель получает JSON `{ok:false, noop_repeat:true, message}` с указанием сменить аргументы или перейти к отчёту
- [x] #4 AC4: Счётчик noop-серии сбрасывается реально исполненным вызовом (в т.ч. успешным write) и попадает в диагностику хода (`repeat_stats` в `<threadId>.repeat.json`)
- [x] #5 AC5: `ackNoopDetailed` (`src/mcp/tool-result.ts`) отдаёт поле `hint` с текстом «переданные поля уже такие; если нужны другие — передай их в этом же вызове» — как минимум для `backlog_update_task`; существующие тексты `ackNoop` сохранены (совместимость с 9 сценариями `NOOP_SCENARIOS`)
- [x] #6 AC6: `templates/prompts/chat-system.md` описывает четвёртую форму ответа write-инструмента (`ok:false, noop:true, reason:'noop'`) и правило: noop ≠ ошибка, повтор с теми же аргументами бессмыслен, нужно проверить полноту переданных полей или перейти к следующему шагу
- [x] #7 AC7: Регресс-тест в `src/web/tool-dedup.test.mjs` и `src/web/chat.test.mjs` воспроизводит инцидент: 5 вызовов `backlog_update_task` с разными `idempotencyKey` и уже применёнными полями → второй и последующие не исполняются как `duplicate`, а при обходе дедупа noop-серия упирается в кап, а не в лимит tool-вызовов
- [ ] #8 AC8: `pnpm build` (tsc strict) чистый, `pnpm test` зелёный; в CHANGELOG добавлена строка, создан lesson с правилом чтения noop-ответа
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы и порядок шагов

1. **`src/web/tool-dedup.ts`** (ядро фикса)
   - `NON_SEMANTIC_ARGS = ['idempotencyKey'] as const` с комментарием: служебные поля не описывают *что* делает вызов, поэтому в сигнатуру не входят. В `callSignature` — копия args без этих ключей перед `stableSerialize` (не мутировать входной объект модели).
   - `TurnToolGuard`: добавить `noteNoop(name, args)` и вердикт `noop_repeat`; счётчик серии `noopRepeatCount` + `noopRepeatSig` по образцу `src/agent/loop.ts` (`MAX_NOOP_REPEATS_PER_RUN`), константа `MAX_NOOP_REPEATS_PER_TURN = 3`, сброс `resetRepeatSeries()` любым реально исполненным вызовом.
   - `noopRepeatCallResult(max)` — JSON `{ok:false, noop_repeat:true, message}` с указанием «передай недостающие поля в этом же вызове или переходи к отчёту».
   - `ToolGuardStats`: добавить `noop` и `noop_blocked` (аддитивно; поле `repeat_stats` в `<threadId>.repeat.json` расширяется, старые читатели не ломаются).
2. **`src/web/chat.ts`** — в `executeTool`: после исполнения вызова проверять ответ через `isNoopAck` (`src/mcp/tool-result.ts`); noop → `noteNoop(...)`, исполнение → сброс серии. Проверка вердикта `noop_repeat` — рядом с `duplicate`/`limit`. Одна точка ⇒ работает и в resume-пути, и в `advanceToNextApproval`.
3. **`src/mcp/tool-result.ts`** — `ackNoopDetailed`: в `hint` (если не передан вызывающим) подставлять универсальный текст «переданные поля уже такие; если нужны другие — передай их в этом же вызове»; `ackNoop` (обёртка) остаётся байт-в-байт совместимой — 9 сценариев `NOOP_SCENARIOS` не меняют текстов. В `toolUpdateTask` — свой `hint` с перечнем не переданных полей (по образцу VL-319 `missing`).
4. **`templates/prompts/chat-system.md`** — абзац после контракта ack: четвёртая форма `{ok:false, noop:true, reason:'noop'}` = «изменений нет, файл не переписан», это НЕ ошибка инструмента и НЕ повод повторять; действия — проверить, все ли нужные поля переданы в этом же вызове, иначе переходить к следующему шагу.
5. **Тесты**
   - `src/web/tool-dedup.test.mjs`: разные `idempotencyKey` при одинаковых args → `duplicate`; `idempotencyKey` не ломает epoch-логику (read→write→read); `noteNoop` ×3 → `noop_repeat` на 4-й; сброс серии исполненным вызовом; `stats()` содержит новые поля.
   - `src/web/chat.test.mjs`: регресс-тест инцидента VL-324 — 5×`backlog_update_task` с разными ключами и уже применёнными полями: не более одного исполнения, остальные `duplicate`; при обходе дедупа серия упирается в `noop_repeat`, а не в лимит 16; `repeat_stats` в файле диагностики.
   - `src/mcp/write-ack.test.mjs`: `hint` в noop-ответе `backlog_update_task`; тексты `ackNoop`-сценариев не изменились (регресс-инвариант).
6. **Документация**: doc-8 (контракт ack — `hint` в noop), doc-10 §6 (дедуп веб-чата: несемантические аргументы, noop-серия), CHANGELOG (`Unreleased → Исправлено`), lesson «noop-ответ читай как "поля уже такие"».

## Проверка

- `pnpm build` (tsc strict) — чисто.
- `pnpm test` — зелёный; `tool-dedup`/`chat`/`write-ack` таргетно.
- Ручной прогон веб-чата: повторить сценарий VL-324 (несколько `backlog_update_task` с уже применёнными полями) — второй вызов блокируется как `duplicate`, ход не раздувается.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 23:23
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/web/tool-dedup.ts
- src/web/chat.ts
- src/mcp/tool-result.ts
- src/mcp/tools.ts
- templates/prompts/chat-system.md
- src/web/tool-dedup.test.mjs
- src/web/chat.test.mjs
- I'll start by exploring the current state of the code and understanding the existing implementation.
Now I'll implement the core fix in `src/web/tool-dedup.ts`.
Now the guard interface and implementation:
Now add the `noopRepeatCallResult` function at the end of the file:
Now `src/web/chat.ts` — imp…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 776 с, payload 681302 байт_
Незакоммиченные изменения сохранены в ветку: коммит `5cfdec6`.
---
author: @agent
created: 2026-11-03 23:23
---
Фаза code не удалась (код выхода 1): окировок=3, payload последнего запроса=681302 байт (макс 681302), usage={"input_tokens":9666138,"output_tokens":38863,"cache_read_input_tokens":9109504,"total_tokens":9705001,"reasoning_tokens":15305} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 23:56
---
Фаза 3 (Code) выполнена.
**Что сделано (по плану):**
- `src/web/tool-dedup.ts` — ядро фикса: `NON_SEMANTIC_ARGS = ['idempotencyKey']` + `stripNonSemanticArgs()` (копия args, входной объект модели не мутируется) → `callSignature` игнорирует служебные поля; `MAX_NOOP_REPEATS_PER_TURN = 3` по образцу `MAX_NOOP_REPEATS_PER_RUN`; вердикт `noop_repeat`; `noteNoop()`/сброс серии в `noteExecuted()`; `noopRepeatCallResult()`; счётчики `noop`/`noop_blocked` в `ToolGuardStats`.
  - Отличие от плана: вместо отдельного метода `resetRepeatSeries()` сброс серии выполняется внутри `noteExecuted()` (единая точка — исполнение не-noop вызова); вместо `noopRepeatSig` серия ведётся по факту noop-ответа с набором `noopTools` (какой инструмент уже отвечал noop). Это покрывает именно инцидент VL-324, где модель меняла только `idempotencyKey`/набор уже применённых полей, и совпадает с семантикой `noopSignatures` в агентской петле.
- `src/web/chat.ts` — учёт noop подключён в `executeTool` (единая точка: обычный цикл, resume-путь, `advanceToNextApproval`): `isNoopAck(raw)` → `noteNoop()`; вердикт `noop_repeat` обрабатывается рядом с `duplicate`/`limit`; поля `noop`/`noop_blocked` добавлены в `ChatToolStats` и попадают в `<threadId>.repeat.json` (аддитивно).
- `src/mcp/tool-result.ts` — `NOOP_DEFAULT_HINT` и `hint` всегда в `ackNoopDetailed` («переданные поля уже имеют эти значения … передай их в ЭТОМ ЖЕ вызове»); `ackNoop` осталась байт-в-байт обёрткой (texts `NOOP_SCENARIOS` не изменились).
- `src/mcp/tools.ts` — `toolUpdateTask` на noop отдаёт `ackNoopDetailed` со своим `hint`, перечисляющим НЕ переданные поля (`missingTaskFields()`).
- `templates/prompts/chat-system.md` — описана четвёртая форма ответа (`ok:false, noop:true, reason:'noop'`), правило «noop ≠ ошибка, повтор с теми же аргументами бессмыслен», плюс уточнение, что серия noop ограничена капом и `idempotencyKey` в сигнатуру дедупа не входит.
- Тесты: `src/web/tool-dedup.test.mjs` (+сигнатура с разными ключами, epoch-логика, `noteNoop`×N → `noop_repeat`, сброс серии, новые поля `stats()`), `src/web/chat.test.mjs` (регресс VL-324: 5×`backlog_update_task` с разными ключами → 1 исполнение + 4 `duplicate`; обход дедупа разными наборами полей упирается в `noop_repeat`, а не в лимит 16; `repeat_stats` в файле диагностики), `src/mcp/write-ack.test.mjs` (`hint` в noop `backlog_update_task`, инвариант текстов `ackNoop`).
**Проверки:**
- `pnpm build` (tsc strict) — чисто.
- `pnpm test` (полный прогон) — зелёный: 163 файла, 3136 тестов passed, 4 skipped (штатные `it.skip` проекта), исключённых файлов нет.
  - Замечание о первом прогоне: падал один тест `src/web/orchestrator.test.mjs → VL-277 AC1` (в temp-репо не появлялся коммит `docs(task): VL-93`). Прогон файла изолированно (`npx vitest run src/web/orchestrator.test.mjs`, и с `-t VL-277`) и повторный полный `pnpm test` — зелёные; падение не связано с диффом задачи (тест про коммит файла задачи в фазе close, наши файлы в нём не участвуют) — флак тайминг-ожидания `waitDone`/fire-and-forget коммита в параллельном прогоне.
- Изменения закоммичены: `c4730d1` — «fix: VL-326 — noop-серия в веб-чате и служебные аргументы вне сигнатуры дедупа» (в ветке `vb/vl-326`; ядро фикса вошло в предыдущий wip-коммит `5cfdec6`, доработки тестов — в `c4730d1`).
**Что осталось:**
- AC8 частично: `pnpm build`/`pnpm test` зелёные, lesson создан (`lesson-205`), но строку CHANGELOG и документы `backlog/docs/doc-8`, `doc-10 §6` по правилам фазы Code не писал — это делает Фаза Close после слияния. Поэтому AC8 и DoD «Документация обновлена» не отмечены.
- Ручной прогон веб-чата (сценарий VL-324 живьём в UI) не выполнялся — регресс воспроизведён интеграционным тестом `chat.test.mjs` с фейковым LLM.
**Lessons:** создан и связан `lesson-205` («Читай noop-ответ write-инструмента как "поля уже такие"»).
---
<!-- COMMENTS:END -->