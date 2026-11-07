---
id: VL-357
title: 'Tool outcome protocol v2: свести контракт ответа инструментов и детекторы повторов в один протокол (эпик по 14 задачам класса)'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-07 15:54'
updated_date: '2026-11-07 16:07'
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
modified_files: []
lessons: []
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
- [ ] #1 `src/mcp/tool-result.ts`: введён `outcome: 'applied'|'partial'|'noop'|'rejected'|'read'|'unknown'`; `ok`/`noop`/`denied`/`read` сериализуются как вычисляемые геттеры — существующие тесты и промпты фаз не меняются
- [ ] #2 `ToolSpec` (`src/agent/tools.ts`) получил поле `kind: 'read'|'write'|'mixed'`; `isWriteOperation` (`src/core/tool-classify.ts`) читает его, `WRITE_MARKERS` удалён; `backlog_manage_* {action:'list'}` классифицируется как read без спецкейсов
- [ ] #3 `src/agent/repeat-tracker.ts` — единственный источник порогов и директив повторов; `loop.ts` и `src/web/tool-dedup.ts` используют его, собственные счётчики и тексты директив удалены
- [ ] #4 Инвариант-тест в `src/mcp/write-ack-contract.test.mjs`: обход всех write-инструментов — вызов без необязательного по смыслу поля даёт `partial` + `missing`, а не `rejected`; новый инструмент с жёстким отказом валит сборку
- [ ] #5 `fail()` по капу повторов срабатывает только при недостигнутой цели фазы (`buildRunProgress`); при выполненной работе фаза завершается с отчётом
- [ ] #6 Регрессы всех 14 задач класса (VL-303/304/306/310/318/319/323/326/349/351/353/355/356) проходят в `src/agent/loop.test.mjs` и `src/mcp/write-ack.test.mjs`
- [ ] #7 `pnpm build && pnpm test` без регрессий
- [ ] #8 Документация: doc-27 (статус → реализовано, фактические решения), doc-8 (контракт `outcome`), doc-10 §6, CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
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