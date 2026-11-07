---
id: VL-359
title: 'Доделать Tool outcome protocol v2: ToolSpec.kind не читается, пороги повторов дублируются, guard-ответы веб-чата в обход outcome'
status: Review
assignee: []
reporter: ''
created_date: '2026-11-07 17:03'
updated_date: '2026-11-07 18:39'
due_date: ''
labels:
  - agent
  - mcp
  - web
  - tech-debt
  - tool-ack
  - vl-357
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/loop.ts
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker.test.mjs
  - src/agent/tools.ts
  - src/core/tool-classify.ts
  - src/core/tool-classify.test.mjs
  - src/mcp/tool-result.ts
  - src/mcp/tool-outcome-trace.test.mjs
  - src/web/chat.ts
  - src/web/chat.test.mjs
  - src/web/tool-dedup.ts
  - src/web/tool-dedup.test.mjs
lessons:
  - lesson-236
token_usage:
  input: 7849847
  output: 45164
  cache: 7676928
  total: 7895011
  requests: 136
  duration_ms: 772294
  reasoning: 17174
  by_phase:
    code:
      input: 4552175
      output: 31894
      cache: 4446720
      requests: 60
    close:
      input: 3297672
      output: 13270
      cache: 3230208
      requests: 76
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

VL-357 (Tool outcome protocol v2) закрыта, все 5 пунктов плана реализованы. При проверке остатков найдены четыре незакрытых места — три из них реальные дефекты, а не косметика.

## 1. `ToolSpec.kind` — мёртвое поле, два источника правды

`src/agent/tools.ts:66` объявляет `kind?: ToolKind`, и все 8 локальных фабрик его заполняют (`:684, :757, :847, :879, :1307, :1434, :1511, :1539`). Но `isWriteOperation` (`src/core/tool-classify.ts:106`) читает **не** его, а `LOCAL_TOOL_KINDS` — отдельную таблицу в том же файле классификатора.

Итог: одни и те же 8 инструментов объявлены дважды. Тест паритета (`src/core/tool-classify.test.mjs`) сверяет с реестром только `TOOL_KINDS` (MCP), для локальных инструментов сверки нет. Новый локальный инструмент с `kind: 'read'` в `tools.ts`, но без строки в `LOCAL_TOOL_KINDS`, молча классифицируется как write (fail-safe) — ровно тот класс ошибки, который VL-357 устранял.

## 2. Пороги повторов всё ещё не в одном месте

AC3 VL-357 требовал «единственный источник порогов». Фактически:

- `REPEAT_BLOCK_MAX_PER_RUN = 5` (`repeat-tracker.ts:67`) и `REPEAT_LIMITS.blockedCalls = 5` — две константы с одним значением, объявленные рядом;
- `PHANTOM_CALL_LIMIT_DEFAULT = 3` и `INTENT_LOOP_REPEAT_DEFAULT = 4` (`loop.ts:359,363`) остались локальными, хотя это пороги детекторов повторов.

## 3. Guard-ответы веб-чата в обход протокола v2

`duplicateCallResult`, `limitCallResult`, `noopRepeatCallResult` (`src/web/tool-dedup.ts:292-330`) отдают плоский JSON `{ok:false, duplicate:true, …}` без `outcome`. Модель в веб-чате видит ответы двух разных форматов: инструменты — с `outcome`, guard — без. Протокол v2 объявлен единственным источником правды, но веб-слой его не соблюдает.

## 4. AC6 VL-357 не закрыт по существу

AC6 («регрессы всех 14 задач класса») остался неотмеченным, а статус задачи — `Done`. Покрытие есть (`loop.test.mjs`, `write-ack.test.mjs`, `web/chat.test.mjs`, `web/tool-dedup.test.mjs`), но поимённой трассировки «задача → тест» нет. Это тот же класс, что VL-309: терминальный статус при неотмеченном AC.

## Что НЕ входит в задачу

- Сведение `TurnToolGuard` к `createRepeatGuard` — осознанно отклонено в VL-357 (окно другого уровня, риск регресса VL-324). Не пересматриваем.
- Изменение формы `ackError` (3 ключа вместо 2) — зафиксировано тестом, откатывать не нужно.

## Связанные задачи

VL-357 (источник), VL-351 (класс «чтение считается записью»), VL-326 (noop-серия веб-чата), VL-309 (терминальный статус при неотмеченном AC).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `ToolSpec.kind` (`src/agent/tools.ts:66`) либо читается классификатором, либо удалён: сейчас поле объявлено в 8 фабриках, но `isWriteOperation` его НЕ читает (читает `LOCAL_TOOL_KINDS` из `src/core/tool-classify.ts`) — два источника правды для одних и тех же 8 инструментов
- [x] #2 Добавлен тест паритета для локальных инструментов (аналог `TOOL_KINDS` vs `listTools()`): набор `kind` в `src/agent/tools.ts` сверяется с `LOCAL_TOOL_KINDS`; расхождение валит сборку
- [x] #3 `REPEAT_BLOCK_MAX_PER_RUN` (`src/agent/repeat-tracker.ts:67`) сведён с `REPEAT_LIMITS.blockedCalls` — сейчас это две константы со значением 5, объявленные рядом
- [x] #4 `PHANTOM_CALL_LIMIT_DEFAULT` и `INTENT_LOOP_REPEAT_DEFAULT` (`src/agent/loop.ts:359,363`) перенесены в `REPEAT_LIMITS` — это пороги детекторов повторов, а AC3 VL-357 требовал единственного источника
- [x] #5 Guard-ответы веб-чата (`duplicateCallResult`, `limitCallResult`, `noopRepeatCallResult` в `src/web/tool-dedup.ts`) сериализуются через `serializeAck` и несут `outcome` (`rejected`/`noop`); сейчас они отдают плоский `{ok:false, …}` в обход протокола v2
- [x] #6 Трассировка «14 задач класса → именованный тест» зафиксирована (таблица в doc-27 §9 или тест-матрица): AC6 VL-357 закрыт по существу, а не отметкой
- [x] #7 `pnpm build && pnpm test` без регрессий
- [ ] #8 Документация: doc-27 §9 (что осталось открытым → закрыто), doc-8 (guard-ответы веб-чата в контракте `outcome`), CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Порядок работ

Четыре независимых шага, каждый — отдельный коммит. Шаги 1–2 механические, шаг 3 затрагивает веб-слой, шаг 4 — документация.

---

## Шаг 1. `ToolSpec.kind` — один источник правды

**Файлы:** `src/agent/tools.ts`, `src/core/tool-classify.ts`, `src/core/tool-classify.test.mjs`.

Два варианта, выбрать один:

**Вариант A (предпочтительный) — `kind` читается.** `declaredToolKind(name)` получает третий источник: реестр локальных `ToolSpec`. Проблема: `src/core/tool-classify.ts` не может импортировать `src/agent/tools.ts` (там fs, llm, оркестратор — core не должен тянуть агентский слой, это прямо записано в шапке модуля). Значит нужен резолвер, который регистрируется извне:

```ts
// src/core/tool-classify.ts
let localKindResolver: ((name: string) => ToolKind | undefined) | null = null;
export function registerLocalToolKinds(fn: (name: string) => ToolKind | undefined): void {
  localKindResolver = fn;
}
export function declaredToolKind(name: string): ToolKind | undefined {
  return toolKindOf(name) ?? localKindResolver?.(name) ?? LOCAL_TOOL_KINDS[name];
}
```

`src/agent/tools.ts` при сборке реестра вызывает `registerLocalToolKinds(name => specs.find(s => s.name === name)?.kind)`. `LOCAL_TOOL_KINDS` остаётся фолбэком для путей, где реестр не собран (тесты классификатора).

**Вариант B (проще) — `kind` удалить.** Убрать поле из `ToolSpec` и 8 фабрик, оставить только `LOCAL_TOOL_KINDS`. Меньше кода, но объявление уезжает от инструмента — теряется главная идея VL-357 («вид объявлен рядом с инструментом»).

Рекомендую A: смысл VL-357 в том, что объявление живёт рядом с инструментом.

**Тест паритета** (обязателен в любом варианте): в `src/core/tool-classify.test.mjs` — собрать `createAgentTools(cwd)` (или как называется фабрика реестра), взять `kind` каждого `ToolSpec`, сверить с `declaredToolKind(name)`. Расхождение → падение с текстом «добавь строку в LOCAL_TOOL_KINDS или убери kind из ToolSpec».

---

## Шаг 2. Пороги повторов в `REPEAT_LIMITS`

**Файлы:** `src/agent/repeat-tracker.ts`, `src/agent/loop.ts`.

1. `REPEAT_BLOCK_MAX_PER_RUN` (`repeat-tracker.ts:67`) → `export const REPEAT_BLOCK_MAX_PER_RUN = REPEAT_LIMITS.blockedCalls;` (по образцу `MAX_APPLIED_REPEATS_PER_RUN` и соседей, строки 113–122). Значение остаётся 5, публичный API не меняется.
2. `PHANTOM_CALL_LIMIT_DEFAULT` и `INTENT_LOOP_REPEAT_DEFAULT` (`loop.ts:359,363`) → добавить в `REPEAT_LIMITS` как `phantom: 3` и `intent: 4`, в `loop.ts` читать оттуда. Комментарии-обоснования (почему 3 и почему 4) перенести вместе с константами — они объясняют значения, а не место.

**Проверка:** `src/agent/repeat-tracker.test.mjs` (там уже есть проверки значений на строках 282–283), `src/agent/loop.test.mjs` (VL-215 — фантомные вызовы, VL-119 — зацикливание намерений).

---

## Шаг 3. Guard-ответы веб-чата через `serializeAck`

**Файлы:** `src/web/tool-dedup.ts`, `src/web/chat.ts`, `src/web/tool-dedup.test.mjs`, `src/web/chat.test.mjs`.

1. `duplicateCallResult()` → `serializeAck({ outcome: 'rejected', reason: 'duplicate', message: '…' })`. Текст `message` не меняется (инвариант VL-262).
2. `limitCallResult(max)` → `serializeAck({ outcome: 'rejected', reason: 'limit', message: '…' })`.
3. `noopRepeatCallResult(max)` → `serializeAck({ outcome: 'noop', reason: 'noop_repeat', message: '…' })`.

**Важно:** `serializeAck` не умеет произвольные поля (`duplicate`, `limit`, `noop_repeat`). Нужно либо расширить `ToolAckInput` аддитивным `extra?: Record<string, unknown>` (сериализуется как есть), либо оставить эти флаги в `message`. Рекомендую `extra` — модель и тесты читают `duplicate: true` машиночитаемо, и это не ломает контракт.

**Проверка:** `src/web/tool-dedup.test.mjs` (VL-326, строки 188–380), `src/web/chat.test.mjs` (VL-326, строки 1046–1120). Тесты проверяют `ok:false` и `duplicate:true` — оба поля сохраняются, значит правок в тестах быть не должно. Если появятся — это признак, что `extra` не пробросился.

---

## Шаг 4. Трассировка 14 задач → тесты

**Файл:** `backlog/docs/doc-27` §9 (раздел «Что осталось открытым»).

Таблица: задача → файл теста → имя `it(...)`. Заполнить по факту, не по памяти:

| Задача | Тест |
|---|---|
| VL-303 | `write-ack.test.mjs:165` |
| VL-304 | `loop.test.mjs:446,457` |
| VL-306 | `loop.test.mjs:2518` |
| VL-310 | `loop.test.mjs:507,667,768` |
| VL-318 | `loop.test.mjs:2672` |
| VL-319 | `loop.test.mjs:695,734`, `write-ack.test.mjs:259` |
| VL-323 | `loop.test.mjs:2743` |
| VL-326 | `web/chat.test.mjs:1046,1088`, `web/tool-dedup.test.mjs:86-380` |
| VL-349 | `loop.test.mjs:539`, `write-ack.test.mjs:307` |
| VL-351 | `loop.test.mjs:2518` |
| VL-353 | `loop.test.mjs:2884` |
| VL-355 | `loop.test.mjs:591`, `write-ack.test.mjs:360` |
| VL-356 | `loop.test.mjs:624`, `lesson-tools.test.mjs:96,145` |

Номера строк — ориентир на момент проверки; в таблице достаточно имени `it(...)`, чтобы ссылка не протухла.

---

## Финальная проверка

- `pnpm build && pnpm test` — полный прогон (189 файлов, ~3536 тестов).
- Ручная: `backlog_manage_dod {action:'list'}` в веб-чате не требует Allow/Deny (регресс VL-351); дословный дубль в веб-чате отдаёт `outcome: 'rejected'` + `duplicate: true`.
- Документация: doc-27 §9, doc-8 (guard-ответы в контракте `outcome`), CHANGELOG.md.

## Риски

- **Шаг 1 вариант A** вводит глобальный резолвер — состояние модуля. Если реестр собирается в нескольких местах с разными наборами, последний вызов перезапишет. Проверить, что `createAgentTools` вызывается один раз на процесс (или резолвер идемпотентен по набору).
- **Шаг 3** трогает веб-чат — там же живёт approval-gate. `serializeAck` не должен попасть в путь подтверждений (`ackDenied` уже есть, использовать его).
- **VL-354 сейчас в работе** — она правит `src/agent/tools.ts` (`makeGrepSearch`, `truncateToolOutput`). Шаг 1 тоже правит `tools.ts` (поле `kind`). Конфликт маловероятен (разные регионы), но merge делать после закрытия VL-354.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 17:55
---
Фаза 3 (Code) выполнена. Коммит 67171e5.
**Шаг 1 — `ToolSpec.kind` читается (вариант A).** `src/core/tool-classify.ts`: добавлен `registerLocalToolKinds(fn)` + резолвер модуля; `declaredToolKind(name) = toolKindOf(name) ?? localKindResolver?.(name) ?? LOCAL_TOOL_KINDS[name]`. `LOCAL_TOOL_KINDS` экспортирован и остался фолбэком для путей без реестра. `src/agent/tools.ts`: `listLocalTools` собирает `specs` и регистрирует резолвер `name => specs.find(s => s.name === name)?.kind` (идемпотентен по набору — вид от cwd не зависит, риск из плана снят). Тест паритета в `src/core/tool-classify.test.mjs`: обход `listLocalTools()` сверяет `ToolSpec.kind` ↔ `declaredToolKind` ↔ `LOCAL_TOOL_KINDS` в обе стороны, плюс проверка «в таблице нет имён вне реестра»; текст падения — «добавь строку в LOCAL_TOOL_KINDS или убери kind из ToolSpec».
**Шаг 2 — пороги в `REPEAT_LIMITS`.** `REPEAT_BLOCK_MAX_PER_RUN = REPEAT_LIMITS.blockedCalls` (объявление перенесено ниже `REPEAT_LIMITS` — TDZ). В `REPEAT_LIMITS` добавлены `phantom: 3` и `intent: 4` с перенесёнными комментариями-обоснованиями; `PHANTOM_CALL_LIMIT_DEFAULT`/`INTENT_LOOP_REPEAT_DEFAULT` теперь экспортируемые производные в `repeat-tracker.ts`, `loop.ts` импортирует их оттуда (локальные объявления удалены). Тест в `repeat-tracker.test.mjs` сверяет все три с `REPEAT_LIMITS`.
**Шаг 3 — guard-ответы веб-чата через `serializeAck`.** `ToolAckInput` получил аддитивное `extra?: Record<string, unknown>`; `serializeAck` дописывает его ключи, НЕ перезаписывая вычисленные из `outcome` (исход остаётся единственным источником правды). `duplicateCallResult` → `outcome:'rejected', reason:'duplicate', extra:{duplicate:true}`; `limitCallResult` → `rejected`/`limit`; `noopRepeatCallResult` → `outcome:'noop', reason:'noop_repeat', extra:{noop_repeat:true}`. Тексты `message` не менялись (инвариант VL-262). Путь подтверждений не затронут — `ackDenied` не тронут.
**Шаг 4 — трассировка 13 задач класса.** Фаза Code не правит `backlog/docs`, поэтому AC6 закрыт вторым допустимым вариантом — тест-матрицей `src/mcp/tool-outcome-trace.test.mjs`: 13 задач → файл + подстрока имени `it(...)` (ссылки по имени, не по номеру строки — номера протухают). Тест падает, если регресс переименовали/удалили. Таблица в doc-27 §9 остаётся за фазой Close.
**Проверки:** `pnpm build` — ок; полный `pnpm test` — 189 файлов, 3533 passed, 4 skipped (предсуществующие skip в `src/core/frontmatter.test.mjs`, не связаны с задачей), 0 failed. Исключённых/пропущенных тест-файлов нет.
**Что осталось (фаза Close):** документация — doc-27 §9 (что осталось открытым → закрыто, таблица трассировки), doc-8 (guard-ответы веб-чата в контракте `outcome`, поле `extra`), CHANGELOG.md. В фазе Code эти файлы по регламенту не правятся.
**Урок:** lesson-236 (заполняемое, но не читаемое поле = второй источник правды; закрывать тестом паритета).
---
author: @agent
created: 2026-11-07 18:25
---
Фаза close не удалась (код выхода 1): ет, блокировок=0, payload последнего запроса=178953 байт (макс 178953), usage={"input_tokens":915407,"output_tokens":3092,"cache_read_input_tokens":890368,"total_tokens":918499,"reasoning_tokens":881} — статус возвращён к Review.
---
<!-- COMMENTS:END -->