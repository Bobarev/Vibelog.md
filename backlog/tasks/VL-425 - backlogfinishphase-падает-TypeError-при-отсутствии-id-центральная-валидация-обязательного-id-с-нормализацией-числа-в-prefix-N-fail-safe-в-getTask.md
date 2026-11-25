---
id: VL-425
title: 'backlog_finish_phase падает TypeError при отсутствии id: центральная валидация обязательного id (с нормализацией числа в prefix-N) + fail-safe в getTask'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-18 00:45'
updated_date: '2026-11-25 15:42'
due_date: ''
labels:
  - mcp
  - agent
  - bug
dependencies: []
milestone: v1.15
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/config.ts
  - src/core/config.test.mjs
  - src/core/store.ts
  - src/core/store.test.mjs
  - src/mcp/tools.ts
  - src/mcp/server.test.mjs
  - src/mcp/types.test.mjs
  - src/mcp/id-guard.test.mjs
  - CHANGELOG.md
  - backlog/docs/doc-8-MCP-справочник-Vibelogmd.md
  - backlog/lessons/lesson-294-Проверяй-обязательность-id-центральным-guardом-по-required-схеме-в-handleToolCall.md
lessons:
  - lesson-294
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 79
  duration_ms: 1658138
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 56
    close:
      input: 0
      output: 0
      cache: 0
      requests: 23
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст (инцидент, подтверждён JSONL проекта lb-gift, vb 1.14.0): фаза code LB-16 — 24 вызова backlog_finish_phase подряд падают серверной ошибкой «Cannot read properties of undefined (reading 'toLowerCase')» и сжигают wall-time фазы.

Корень (проверен по аргументам всех вызовов): модель стабильно НЕ передаёт args.id в backlog_finish_phase (во всех 24 вызовах только aborted/comment/status/phase/tokenUsage — id отсутствует всегда), при этом id есть в add_comment/phase_status/update_task. Схема required: ['id','comment'] не валидируется MCP SDK на входе. Цепочка падения: toolFinishPhase (tools.ts:2107, args.id as string без проверки) → getTask (store.ts:62) → id.toLowerCase() на undefined → TypeError. Падение происходит ДО проверки «задача не найдена», поэтому модель получает бессмысленный текст и повторяет до исчерпания бюджета.

Почему ломается именно там: обязательность comment была защищена VL-253 (авто-отчёт buildAutoReport), а обязательность id — нет; description схемы finish_phase сфокусирован на comment/aborted/status (урок VL-253: description не влияет на генерацию аргументов, только required… а required не проверяется).

Решения, принятые с пользователем:1. Текст isError — БЕЗ вставки конкретного id (без «(например \"LB-16\")»): просто констатация отсутствия обязательного аргумента id и требование повторить вызов с ним.2. Нормализация числового id: не-строковый id, являющийся целым числом (16), воспринимать как «<task_prefix>-16» — префикс берётся из backlog/config.yml (тот же источник, что у taskIdPattern: config.ts:114, дефолт VL). Числовая строка \"16\" — так же. Это чинит и потенциальный класс «модель прислала номер вместо полного id»: в проекте с task_prefix: LB однозначно → LB-16. Нечислые/дробные значения → isError.

Сопутствующее: та же уязвимость (args.id as string без проверки) есть в toolAddComment/toolViewTask/toolUpdateDependencies и др. — центральный guard закрывает все id-инструменты разом; плюс fail-safe в getTask как последний рубеж.

После фикса LB-16 в том проекте: статус вручную (веб/CLI), повтор фазы — новой сессией.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backlog_finish_phase без id (или с пустым/не строковым-не числовым id) → isError с текстом «Не передан обязательный аргумент id задачи (обязательное поле схемы)» — БЕЗ примера конкретного id; никаких записей, TypeError не бросается
- [x] #2 Целочисленный id (16) и числовая строка ("16") нормализуются в «<task_prefix>-16» по конфигу проекта; результат проверяется taskIdPattern, не подошёл → тот же isError
- [x] #3 Нормализация центральная — в handleToolCall по схеме required инструмента (все id-инструменты), а не копия в каждом tool*
- [x] #4 getTask/findTaskFilePath: не-строковый id → null (fail-safe, не TypeError) — страховка для путей мимо guard'а
- [x] #5 Регрессия VL-253: finish_phase без comment по-прежнему авто-отчёт; существующие server.test.mjs зелёные; новые тесты: отсутствующий id → isError, 16 → LB-16 (проект с task_prefix: LB), getTask(16) не падает
- [x] #6 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

1. **src/mcp/tools.ts** — центральный guard `id` в `handleToolCall` + нормализация
2. **src/core/store.ts** — fail-safe в `getTask`/`findTaskFilePath`
3. **src/core/config.ts** — экспорт `taskPrefix(cwd)` (вынести префикс из `taskIdPattern`, строка ~114-119 — та же логика чтения `task_prefix` с дефолтом VL; не дублировать!)
4. **Тесты**: src/mcp/server.test.mjs (или отдельный src/mcp/id-guard.test.mjs)

## 1. Guard в handleToolCall (tools.ts:1064)

В `handleToolCall`, ДО `handleToolCallInner` — по required-схеме инструмента:

```ts
const def = listTools().find(t => t.name === name);   // один список — единственный источник
if (def?.inputSchema.required?.includes('id')) {
  const normalized = normalizeTaskId(cwd, args.id);   // string | null
  if (normalized === null) return isError(...);
  args = { ...args, id: normalized };                 // НЕ мутировать вход
}
```

- `comment` из проверки ИСКЛЮЧИТЬ: у него контракт VL-253 (авто-отчёт при отсутствии) — generic-guard по required его сломал бы.
- Текст ошибки (по решению пользователя, БЕЗ примера конкретного id):
  `Не передан обязательный аргумент id (обязательное поле схемы инструмента). Повтори вызов, добавив id задачи.`
- Формат — isError-ответ инструмента (как у невалидного статуса VL-251), не throw: модель получает внятный текст и исправляется с первого повтора.

### `normalizeTaskId(cwd, value): string | null`

1. `string`: `trim()`; непустая → если `/^\d+$/` → ко к canonical (`prefix-N`), иначе вернуть как есть (id не обязан матчить паттерн здесь — «задача не найдена» скажет);
2. `number`: `Number.isInteger(value) && value >= 0` → `${taskPrefix(cwd)}-${value}`; иначе null (дробные/отрицательные — ошибка);
3. `undefined`/`null`/прочее → null.

Нормализация ЧИСЛА по префиксу конфига — пункт 2: `taskPrefix(cwd)` из config.ts (дефолт `VL`, проект lb-gift → `LB` → `16` превращается в `LB-16`). Числовая строка `"16"` → так же (модель часто присылает числа строками).

## 2. Fail-safe в getTask (store.ts:62) и findTaskFilePath (store.ts:332)

```ts
if (typeof id !== 'string' || id === '') return null;   // вместо TypeError
```

Последний рубеж для путей мимо guard'а (вызовы из CLI/веб/тестов, будущие инструменты). `updateTaskFile` при `!task` уже бросает внятное «Задача … не найдена» — не изменяется.

## 3. Тесты

- finish_phase БЕЗ id → `isError: true`, текст содержит «Не передан обязательный аргумент id», файл задачи и комментарии НЕ изменены (байтово до/после);
- finish_phase `id: 16` в проекте с `task_prefix: LB` → успех, применён к LB-16; `id: "16"` → так же;
- `id: 16.5` / `id: {}` → isError (не TypeError);
- регрессия VL-253: finish_phase с id, но БЕЗ comment → авто-отчёт, успех;
- регрессия VL-251/245/248: существующие серверные тесты без изменений;
- `getTask(dir, 16)` → null (не падает) — юнит в store-тесте;
- `taskPrefix`: дефолт VL, override из config.yml (панча из taskIdPattern-тестов).

## Порядок

1. `taskPrefix` в config.ts (+ вынести общий кусок из `taskIdPattern`, чтобы логика не разъехалась).
2. `normalizeTaskId` + guard в `handleToolCall`.
3. Fail-safe в store.ts.
4. Тесты → `pnpm test`.

## Проверка ручная (в проекте lb-gift после обновления vibelog)

- Повторить упавший вызов: `backlog_finish_phase {"aborted":true,"comment":"тест"}` → isError с подсказкой про id (а не TypeError);
- `{"id":"LB-16","aborted":true,"comment":"…"}` → успех;
- Завершить LB-16 (статус — веб/CLI, фазу повторить новой сессией).

## Риски

- Guard по `listTools()` required: если у инструмента id опциональный (не в required) — не трогаем, семантика не меняется. Список required уже есть в схемах — новой конфигурации не заводим.
- Нормализация числа скрывает реальную ошибку «модель перепутала задачу»? Нет: `16` → `LB-16` в проекте с одним префиксом однозначен; чужие id всё равно упираются в «Задача не найдена».
- Мутация args — запрещена: копия `{...args, id}` (иначе идемпотентность/логи видят исходные аргументы).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-18 01:15
---
Фаза 3 (Code) выполнена. Изменено: src/core/config.ts, src/mcp/tools.ts, src/core/store.ts, src/mcp/id-guard.test.mjs (новый), src/mcp/server.test.mjs, src/mcp/types.test.mjs, src/core/config.test.mjs, src/core/store.test.mjs. Коммит de87f99 (ветка vb/vl-425).
Реализация по плану: (1) taskPrefix(cwd) в config.ts — префикс вынесен из taskIdPattern, общий источник для паттерна и нормализации; (2) normalizeTaskId + guardRequiredId в handleToolCall ДО handleToolCallInner: по required-схемы из listTools(), текст ошибки «Не передан обязательный аргумент id задачи (обязательное поле схемы). Повтори вызов, добавив id задачи.» — без вставки конкретного id (решение Pavel), копия args без мутации; comment не трогаем (VL-253); число 16 / строка "16" → «<task_prefix>-N» с проверкой taskIdPattern; supervisor-домен (VL-268 AC3 «никогда не бросает») получает нормализацию, но непригодный id валидирует сам через свой ackError; (3) fail-safe в getTask/findTaskFilePath: не-строковый/пустой id → null вместо TypeError.
Проверки: pnpm test — ПОЛНЫЙ прогон (без --exclude/--skip): 230 тест-файлов, 4431 тест зелёных, 4 skipped (штатных), tsc-сборка чистая. Новые тесты: src/mcp/id-guard.test.mjs (8: без id → отказ без записей байтово до/после и без TypeError, 16/"16" → LB-16 при task_prefix LB, 16.5/{}/отрицательные → отказ, регресс VL-253 авто-отчёт, центральность через add_comment, getTask(16)→null-класс, юнит normalizeTaskId); транспортные isError-кейсы в server.test.mjs; taskPrefix (VL/LB/пустой) в config.test.mjs; fail-safe юниты в store.test.mjs.
Существующие тесты: server.test.mjs зелёные без изменений; supervisor-tools.test.mjs без изменений (guard их исключает из throw по их же контракту). Осознанная правка: в types.test.mjs (VL-183) assertion сообщения переведён с per-tool «Не передан id задачи» на центральную формулировку guard'а — назначение теста («понятная ошибка, не TypeError toLowerCase») сохранено, это следствие AC1/AC3 (централизация).
Что осталось: DoD «Документация обновлена» не отмечен — CHANGELOG.md и backlog/docs по правилам фаз пишет Close после слияния (в Code обновлены только JSDoc/комментарии кода); ручная проверка в проекте lb-gift после обновления vibelog (повтор упавшего вызова → isError с подсказкой, затем LB-16: статус вручную веб/CLI, повтор фазы новой сессией). Урок lesson-294 создан и связан.
---
author: @agent
created: 2026-11-18 06:23
---
Фаза Close выполнена. Ветка vb/vl-425 слита в master (1 коммит de87f99, merge --no-ff без конфликтов), worktree удалена (untracked-симлинк backlog/references/data — только симлинк, данные в главном репо), ветка удалена. Проверки после merge: сборка tsc чистая; ранний точечный фильтр — 5 тест-файлов затронутых модулей (id-guard, config, store, server, types) 91 тест зелёный; полный pnpm test — зелёный (exit 0, без повторных прогонов). DoD: все 3 пункта выполнены — тесты проходят (полный прогон), документация обновлена (CHANGELOG Unreleased + doc-8: новый раздел «Обязательный аргумент id — центральный guard», коммит f031f11), нет регрессий (существующие server/supervisor/types тесты зелёные, VL-253/245/248 покрыты). Урок lesson-294 (создан в Code) закоммичен (299b26d). Ручная проверка в проекте lb-gift после обновления vibelog — на операторе: повтор упавшего вызова → isError с подсказкой про id, затем LB-16: статус вручную веб/CLI, повтор фазы новой сессией.
---
<!-- COMMENTS:END -->