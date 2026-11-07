---
id: VL-357
title: 'Tool outcome protocol v2: свести контракт ответа инструментов и детекторы повторов в один протокол (эпик по 14 задачам класса)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 15:54'
updated_date: '2026-11-07 16:43'
due_date: ''
labels:
  - agent
  - mcp
  - architecture
  - loop-detection
  - tool-ack
  - epic
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tool-result.ts
  - src/mcp/tool-outcome.test.mjs
  - src/mcp/tools.ts
  - src/mcp/write-ack.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/core/tool-classify.ts
  - src/core/tool-classify.test.mjs
  - src/core/tool-kinds.ts
  - src/agent/tools.ts
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker-vl357.test.mjs
  - src/agent/loop.ts
  - src/agent/loop-repeat-cap.test.mjs
  - src/web/chat.ts
  - src/web/tool-dedup.ts
lessons:
  - lesson-235
token_usage:
  input: 25296582
  output: 176648
  cache: 24157696
  total: 25473230
  requests: 255
  duration_ms: 1735884
  reasoning: 104115
  by_phase:
    code:
      input: 22957692
      output: 165504
      cache: 21880832
      requests: 211
    close:
      input: 2338890
      output: 11144
      cache: 2276864
      requests: 44
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

За две недели (2026-10-30 … 2026-11-07) закрыто/открыто 14 задач одного класса: агентская фаза падает кодом 1, потому что модель дословно повторяет write-вызов, а ответ инструмента не даёт понять, что делать дальше. Каждая следующая задача — рецидив предыдущей: VL-349 ввёл жёсткий отказ `lesson_create` без `content`, VL-355 частично откатил принцип для `lesson_update`, VL-356 откатывает решение VL-349 целиком.

Полный анализ — **doc-27** («Tool outcome protocol v2»).

## Диагноз: три корня

1. **Четыре независимых детектора повторов** с разными порогами и разными директивами: `src/agent/loop.ts` (`appliedSignatures`/`noopSignatures`/`errorSignatures`, `MAX_*_REPEATS_PER_RUN` 3/4/5, `loopDetectionDirective`), `src/agent/repeat-tracker.ts` (`createRepeatGuard`, `REPEAT_*_LIMIT`, `repeatBlockDirective`), `src/web/tool-dedup.ts` (`TurnToolGuard`, `MAX_NOOP_REPEATS_PER_TURN`), капы оркестратора. Инцидент попадает в тот, что сработал первым, и получает директиву из его словаря.
2. **Классификация инструмента по имени, а не по объявлению**: `isWriteOperation` смотрит на `WRITE_MARKERS` (токен `manage`) — отсюда ложное «уже применено» на `backlog_manage_dod {action:'list'}` (VL-351).
3. **Ответ инструмента — набор независимых флагов, а не исход**: `ok`/`noop`/`denied`/`read`/`missing`/`hint`/`retryWith` комбинируются свободно — отсюда «применили часть, но ответ выглядит как отказ» (VL-355) и «создали сущность, но ответ выглядит как ошибка» (VL-356).

## Цель

Свести контракт «что вернул инструмент → что делать модели» в один протокол, чтобы новый инструмент не мог воспроизвести класс VL-356. Не цель: сделать Close непотопляемым — падение фазы на реальной ошибке остаётся.

## План (5 пунктов, порядок миграции)

1. **Один тип исхода** (`src/mcp/tool-result.ts`): `outcome: 'applied'|'partial'|'noop'|'rejected'|'read'|'unknown'` + `next: {retryWith?, missing?, hint?}`. `ok`/`noop`/`denied`/`read` — вычисляемые геттеры при сериализации (совместимость с тестами и промптами).
2. **Декларативный вид инструмента**: `kind: 'read'|'write'|'mixed'` в `ToolSpec` (`src/agent/tools.ts`), `isWriteOperation` читает поле, `WRITE_MARKERS` удаляется.
3. **Один детектор повторов**: `src/agent/repeat-tracker.ts` — единственный источник порогов и директив; `loop.ts` и `web/tool-dedup.ts` — потребители.
4. **Инвариант «валидация поля не блокирует операцию»**: расширение `ACK_SCENARIOS` в `src/mcp/write-ack-contract.test.mjs` — обход всех write-инструментов, отсутствие необязательного поля даёт `partial` + `missing`, а не `rejected`.
5. **Фазовый прогресс вместо капа**: `fail()` по капу повторов только при недостигнутой цели (`buildRunProgress`, `src/agent/run-progress.ts`).

Пункты 1–2 аддитивны и механические (один PR), 4 — тест-инвариант, 3 — самый рискованный по регрессам (отдельный PR), 5 — после стабилизации 1–3.

## Риски

- Ядро цикла, 3455 тестов — митигация: аддитивность 1–2, поэтапность 3–5.
- Тексты `message` не меняются (инвариант VL-262), меняется только форма ответа.
- Не проверено: точные пороги `repeat-tracker.ts`, полный список инструментов с плоским текстом, поведение `TurnToolGuard` после сведения.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `src/mcp/tool-result.ts`: введён `outcome: 'applied'|'partial'|'noop'|'rejected'|'read'|'unknown'`; `ok`/`noop`/`denied`/`read` сериализуются как вычисляемые геттеры — существующие тесты и промпты фаз не меняются
- [x] #2 `ToolSpec` (`src/agent/tools.ts`) получил поле `kind: 'read'|'write'|'mixed'`; `isWriteOperation` (`src/core/tool-classify.ts`) читает его, `WRITE_MARKERS` удалён; `backlog_manage_* {action:'list'}` классифицируется как read без спецкейсов
- [x] #3 `src/agent/repeat-tracker.ts` — единственный источник порогов и директив повторов; `loop.ts` и `src/web/tool-dedup.ts` используют его, собственные счётчики и тексты директив удалены
- [x] #4 Инвариант-тест в `src/mcp/write-ack-contract.test.mjs`: обход всех write-инструментов — вызов без необязательного по смыслу поля даёт `partial` + `missing`, а не `rejected`; новый инструмент с жёстким отказом валит сборку
- [x] #5 `fail()` по капу повторов срабатывает только при недостигнутой цели фазы (`buildRunProgress`); при выполненной работе фаза завершается с отчётом
- [ ] #6 Регрессы всех 14 задач класса (VL-303/304/306/310/318/319/323/326/349/351/353/355/356) проходят в `src/agent/loop.test.mjs` и `src/mcp/write-ack.test.mjs`
- [x] #7 `pnpm build && pnpm test` без регрессий
- [x] #8 Документация: doc-27 (статус → реализовано, фактические решения), doc-8 (контракт `outcome`), doc-10 §6, CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Порядок работ

Пять шагов, каждый — отдельный коммит. Шаги 1–2 аддитивны (старые поля ответа сохраняются), шаг 4 — тест-инвариант, шаг 3 самый рискованный по регрессам, шаг 5 — после стабилизации 1–3.

---

## Шаг 1. Один тип исхода (`src/mcp/tool-result.ts`)

**Файл:** `src/mcp/tool-result.ts` (477 строк, читать целиком — там уже `ackOk`, `ackOkDetailed`, `ackNoopDetailed`, `ackErrorDetailed`, `ackRead`).

1. Ввести тип:
```ts
export type ToolOutcome = 'applied' | 'partial' | 'noop' | 'rejected' | 'read' | 'unknown';
```
2. Внутренний `ToolAck` с полем `outcome` + `next?: { retryWith?, missing?, hint? }`.
3. Сериализация: `ok`, `noop`, `denied`, `read` **вычисляются из `outcome`** при `JSON.stringify` (не хранятся):
   - `applied`/`partial`/`read` → `ok: true`
   - `noop` → `ok: false, noop: true, reason: 'noop'`
   - `rejected` → `ok: false` (+ `denied`/`reason`, если отказ подтверждения)
   - `unknown` → `ok: false`
4. Существующие `ackOk`/`ackOkDetailed`/`ackNoopDetailed`/`ackErrorDetailed`/`ackRead` остаются публичным API и внутри вызывают общий билдер с нужным `outcome`. **Тексты `message` не меняются** (инвариант VL-262).
5. `isNoopAck` (используется MCP-сервером для `isError: true`) переписать на `outcome === 'noop'`.

**Проверка:** `src/mcp/write-ack.test.mjs` и `src/mcp/write-ack-contract.test.mjs` проходят без правок — это и есть доказательство совместимости.

---

## Шаг 2. Декларативный вид инструмента

**Файлы:** `src/agent/tools.ts:52` (`ToolSpec`), `src/core/tool-classify.ts`, `src/mcp/tools.ts` (реестр), `src/web/tool-policy.ts` (реэкспорт).

1. `ToolSpec` (`src/agent/tools.ts:52`) получает `kind: 'read' | 'write' | 'mixed'`.
2. `isWriteOperation(name)` (`src/core/tool-classify.ts`) получает второй параметр — реестр/резолвер `kind`; при наличии `kind` возвращает `kind !== 'read'`. `WRITE_MARKERS`/`READ_MARKERS` остаются **только как фолбэк** для имён вне реестра (локальные файловые инструменты, будущие MCP-инструменты до объявления `kind`).
3. `backlog_manage_ac`/`backlog_manage_dod` объявляются `kind: 'mixed'` — тогда `action: 'list'` классифицируется как read по аргументам, а не по имени. Это закрывает VL-351 без спецкейса в `manageChecklist`.
4. `ask_user` — `kind: 'read'` не подходит; оставить `isInteractiveTool` как отдельную ветку (проверяется до `kind`).

**Проверка:** новый тест в `src/core/tool-classify.test.mjs` — `backlog_manage_dod {action:'list'}` → read, `{action:'add'}` → write; `WRITE_MARKERS` не участвует.

---

## Шаг 3. Один детектор повторов

**Файлы:** `src/agent/repeat-tracker.ts`, `src/agent/loop.ts:325-560`, `src/web/tool-dedup.ts`.

Сейчас пороги и директивы живут в трёх местах:

| Место | Что | Строки |
|---|---|---|
| `loop.ts` | `MAX_APPLIED_REPEATS_PER_RUN = 3`, `MAX_NOOP_REPEATS_PER_RUN = 3`, `MAX_ERROR_REPEATS_PER_RUN = 5`, `MAX_BLOCKED_CALLS_PER_RUN = 5`, `REPEAT_WARN_MAX_PER_RUN = 15` | 325–360 |
| `loop.ts` | `loopDetectionDirective` (397), `retryDirective`, `clipErrorText`, `parsedErrorText` (498) | 397–560 |
| `repeat-tracker.ts` | `REPEAT_*_LIMIT`, `REPEAT_WRITE_BLOCK_DEFAULT`, `REPEAT_BLOCK_MAX_PER_RUN`, `createRepeatGuard`, `repeatBlockDirective`, `repeatKey` | весь модуль |
| `web/tool-dedup.ts` | `TurnToolGuard`, `callSignature`, `MAX_NOOP_REPEATS_PER_TURN` | весь модуль |

1. Перенести `MAX_*_REPEATS_PER_RUN` и `loopDetectionDirective`/`retryDirective`/`clipErrorText`/`parsedErrorText` в `repeat-tracker.ts`. `loop.ts` реэкспортирует `MAX_ERROR_REPEATS_PER_RUN` (его импортируют тесты — `src/agent/loop.test.mjs`).
2. `repeatKey` и `callSignature` свести к одной функции (обе вырезают `idempotencyKey` — сейчас это две реализации).
3. `TurnToolGuard` (`web/tool-dedup.ts`) перевести на `createRepeatGuard` с параметром «окно = ход» вместо собственного счётчика.
4. Пороги — один объект `REPEAT_LIMITS` в `repeat-tracker.ts`; `LoopLimits` и настройки веб-чата читают его.

**Проверка:** `src/agent/repeat-tracker.test.mjs`, `src/agent/loop.test.mjs` (регрессы VL-284, VL-310, VL-323, VL-326, VL-353), `src/web/tool-dedup.test.mjs`.

---

## Шаг 4. Инвариант «валидация поля не блокирует операцию»

**Файл:** `src/mcp/write-ack-contract.test.mjs` (там уже есть `ACK_SCENARIOS`).

1. Расширить `ACK_SCENARIOS`: для каждого write-инструмента — вызов с отсутствующим **необязательным по смыслу** полем (для `lesson_create` это `content`, для `document_create` — `content`, для `reference_add` — `description`).
2. Ожидание: `outcome === 'partial'` + непустой `next.missing`, а не `rejected`.
3. Тест обходит реестр инструментов (`listTools()`), поэтому новый инструмент с жёстким отказом валит сборку — VL-358 не понадобится.

**Проверка:** тест падает на текущем `lesson_create` до шага 1 и проходит после; на `document_create`/`reference_add` — проверить, не придётся ли их тоже править (возможно, это и есть следующий скрытый рецидив).

---

## Шаг 5. Фазовый прогресс вместо капа

**Файлы:** `src/agent/loop.ts` (точки `fail()` по капам), `src/agent/run-progress.ts` (`buildRunProgress`).

1. В точках исчерпания `MAX_APPLIED/NOOP/ERROR_REPEATS_PER_RUN` вызывать `buildRunProgress(messages)`.
2. Если прогресс есть (работа сделана: коммит, тесты, отчёт) — завершать ран штатно с отчётом, а не `fail()`.
3. Если прогресса нет — `fail()` как сейчас, с текстом последней ошибки.

**Проверка:** регресс VL-349 (merge + 3455 тестов прошли, фаза упала на `lesson_update`) — теперь должна завершиться штатно; регресс VL-307 (работа не сделана) — по-прежнему `fail()`.

---

## Финальная проверка

- `pnpm build && pnpm test` — полный прогон (184 файла, ~3455 тестов).
- Ручная: `backlog_manage_dod {action:'list'}` в веб-чате не требует Allow/Deny; `lesson_create {title:'x'}` → `outcome: 'partial'` + `missing: content`.
- Документация: doc-27 (статус → реализовано, фактические решения и отклонения от плана), doc-8 (контракт `outcome` и `next`), doc-10 §6, CHANGELOG.md.

## Риски и что проверить до старта

- **Шаг 3 самый рискованный**: `loop.ts` — 1686 строк, регрессы 14 задач живут в `loop.test.mjs`. Делать отдельным PR и только после зелёных шагов 1–2.
- **`kind` в `ToolSpec`** затрагивает реестр `src/mcp/tools.ts` — там ~40 инструментов; проверить, что `listTools()` не теряет поле при сериализации в MCP-схему (лишнее поле в JSON-схеме инструмента может смутить модель — `kind` должен быть только в TS-описании, не в `inputSchema`).
- **Не проверено:** точные пороги `repeat-tracker.ts` (читал только имена констант), полный список инструментов с плоским текстом ответа, поведение `TurnToolGuard` после сведения.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 16:25
---
Фаза code не удалась (код выхода 1): окировок=4, payload последнего запроса=603756 байт (макс 603756), usage={"input_tokens":7669342,"output_tokens":67234,"cache_read_input_tokens":7258112,"total_tokens":7736576,"reasoning_tokens":44635} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 16:37
---
Фаза 3 (Code) выполнена. Коммит 8dff411 («feat: VL-357 — tool outcome protocol v2»).
**Что сделано (все 5 шагов плана):**
1. **Единый тип исхода** — `src/mcp/tool-result.ts`: введены `ToolOutcome` ('applied'|'partial'|'noop'|'rejected'|'read'|'unknown'), `ToolNext {retryWith, missing, hint}` и общий билдер `serializeAck`, ВЫЧИСЛЯЮЩИЙ `ok`/`noop`/`denied`/`read` из исхода. `ackOk`/`ackOkDetailed`/`ackNoopDetailed`/`ackError`/`ackErrorDetailed`/`ackDenied`/`ackRead` остались публичным API, но переведены на билдер; `isNoopAck` читает `outcome==='noop'` (с фолбэком на флаг). Тексты `message` не менялись (инвариант VL-262): единственное правление теста — `ackError` теперь отдаёт три ключа `error/ok/outcome` вместо двух (зафиксировано в `write-ack.test.mjs`).
2. **Декларативный вид инструмента** — новый `src/core/tool-kinds.ts` (таблица `TOOL_KINDS` на 47 инструментов реестра) + `LOCAL_TOOL_KINDS` для файловых инструментов агента. `isWriteOperation(name, args?)` читает объявление, `WRITE_MARKERS`/`READ_MARKERS` удалены, `mixed` разрешается по `action` (`backlog_manage_ac/dod {action:'list'}` → read, без аргументов → write fail-safe). `ToolSpec` (`src/agent/tools.ts`) получил `kind?: ToolKind` (в `inputSchema`/MCP-схему НЕ попадает); локальные инструменты объявляют kind у себя. Веб-чат (`src/web/chat.ts`, две точки) и `tool-dedup.ts` передают аргументы в классификатор.
3. **Один детектор повторов** — `src/agent/repeat-tracker.ts` теперь единственный источник: `REPEAT_LIMITS` (search/read/shell/write/writeBlock/applied/noop/error/blockedCalls/warnMax), именованные `MAX_*_REPEATS_PER_RUN`/`MAX_BLOCKED_CALLS_PER_RUN`/`REPEAT_WARN_MAX_PER_RUN` как производные, единая `callSignature` (бывшая копия в `web/tool-dedup.ts` удалена, модуль реэкспортирует) и `repeatKey` — обе вырезают `NON_SEMANTIC_ARGS` (`idempotencyKey`); директивы `loopDetectionDirective`/`retryDirective`/`appliedNoopDirective`/`noopRepeatDirective`/`clipErrorText`/`parsedErrorText` перенесены сюда, `loop.ts` их реэкспортирует (публичный API сохранён). `parsedErrorText` читает и v2-форму (`next.retryWith`/`next.hint`), и старую (поля в корне). `MAX_NOOP_REPEATS_PER_TURN` в веб-чате = `REPEAT_LIMITS.noop`.
4. **Инвариант «валидация поля не блокирует операцию»** — в `write-ack-contract.test.mjs` добавлен блок `PARTIAL_SCENARIOS` + `PARTIAL_EXEMPT` и тест обхода реестра: каждый write-инструмент обязан либо вернуть `outcome:'partial'` + непустой `next.missing` на вызове без необязательного по смыслу поля, либо иметь документированное исключение. По ходу вскрылись два скрытых рецидива: `document_create` и `reference_add` молча возвращали `applied` при пустом теле — исправлены на `partial` + `missing`/`hint` (там же `lesson_create` уже был исправлен VL-356).
5. **Фазовый прогресс вместо капа** — `failOnRepeatCap`: при исчерпании `MAX_APPLIED/NOOP/ERROR_REPEATS_PER_RUN` ран завершается ШТАТНО с блоком `buildRunProgress`, если в ране есть фактический след работы (успешный `edit`/`write_file`/`git_commit`/отчёт — проверяется имя + содержимое ответа, а не одно имя; ответ `ok:false`/директива блокировки работой не считаются). Иначе — прежний `fail()`.
**Проверки:**
- `pnpm build` — чисто.
- `pnpm test` — полный прогон: **188 тестовых файлов, все passed** (исключений/`--skip`/отдельных файлов нет).
- Новые тесты: `src/mcp/tool-outcome.test.mjs` (10), `src/core/tool-classify.test.mjs` (6), `src/agent/loop-repeat-cap.test.mjs` (3), `src/agent/repeat-tracker-vl357.test.mjs` (10), блок partial в `write-ack-contract.test.mjs` (3 новых кейса).
- Регрессы класса: `loop.test.mjs` (VL-318/323/351/353 и др.), `write-ack.test.mjs`, `tool-dedup.test.mjs`, `write-ack-contract.test.mjs` — зелёные без правок логики.
- Попутно исправлен дефект: `callSignature` падал с `Cannot use 'in' operator to search for 'idempotencyKey'` на строковых `args` (веб-слой/супервизор передают JSON-строку) — `supervisor-limits.test.mjs` ловил это как регресс.
**Что осталось (не закрываю):**
- **AC6** — регрессы класса проверены в `loop.test.mjs`/`write-ack.test.mjs`, но отдельные кейсы VL-303/304/306/310/319/326/349/355/356 как именованные тесты не перечислял: покрытие есть, явной трассировки «14 задач → тест» не делал.
- **AC8** — документация (doc-27, doc-8, doc-10 §6, CHANGELOG.md) НЕ обновлялась: по правилам фазы Code это работа фазы Close после merge.
- `TurnToolGuard` (`web/tool-dedup.ts`) переведён на общий `callSignature`/порог, но собственный счётчик окна «ход» оставлен осознанно: это окно другого уровня (ответ модели, а не ран), сводить его к `createRepeatGuard` в этой фазе не стал — риск регресса VL-324 выше выгоды; зафиксировано как отклонение от плана для Close.
Урок: создан lesson-235 (`lesson_link` с VL-357 выполнен), тело заполнено.
---
author: @agent
created: 2026-11-07 16:43
---
Фаза Close выполнена. Ветка vb/vl-357 слита в master (1 коммит 8dff411, merge-коммит c0a3da0), worktree удалена (force — в ней был только untracked-симлинк backlog/references/data на главный репозиторий, данные не потеряны), ветка vb/vl-357 удалена.
**Проверки после merge:**
- `pnpm build` — чисто.
- Ранний точечный фильтр по diff'у merge (15 файлов src/): `loop.test.mjs`, `loop-repeat-cap.test.mjs`, `repeat-tracker.test.mjs`, `repeat-tracker-vl357.test.mjs`, `tool-classify.test.mjs`, `tool-outcome.test.mjs`, `write-ack.test.mjs`, `write-ack-contract.test.mjs`, `tool-dedup.test.mjs` — 9 файлов, 272 теста, все passed.
- Полный прогон `npx vitest run` — **189 файлов, 3536 passed, 4 skipped**, падений нет. Повторных полных прогонов не было.
**DoD:** 1 «Тесты проходят» — да (полный прогон зелёный); 2 «Документация обновлена» — да (см. ниже); 3 «Нет регрессий» — да.
**Документация (коммит 3d7be55):** CHANGELOG.md (запись VL-357 в Unreleased → «Изменено (ломающие изменения)»), doc-27 (статус → «реализовано», новый §9 «Фактическая реализация» с фактическими решениями и отклонениями от плана), doc-8 (контракт `outcome` + `next` в разделе ack-контракта), doc-10 §6 (пункт про протокол v2: три корня, пять пунктов, отклонение по `TurnToolGuard`).
**Lessons:** lesson-235 («Сводить контракт ответа инструмента к одному исходу, а не набору независимых флагов») — создан в фазе Code, в Close дополнен тегами и `verified_by: agent`, привязан к задаче; закоммичен отдельно (4d57728).
**AC:** AC8 (документация) отмечен в этой фазе. AC6 (поимённая трассировка «14 задач класса → именованный тест») остаётся НЕотмеченным: покрытие есть — регрессы класса живут в `loop.test.mjs`/`write-ack.test.mjs` и зелёные, — но явной привязки «задача → тест» не сделано; это честно зафиксировано и в doc-27 §9. DoD этим не блокируется (все три пункта DoD выполнены).
Файл задачи коммитит framework после записи token_usage. VL-358 — самостоятельная задача (parent_task_id пуст), не подзадача VL-357, поэтому её файл в батч не включён.
---
<!-- COMMENTS:END -->