---
id: VL-355
title: 'lesson_update на уроке-скелете блокирует ЛЮБОЕ обновление (linkedTasks, status, tags) — регресс VL-349, Close VL-346 в тупике'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 15:11'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - mcp
  - lessons
  - regression
  - bug
dependencies: []
milestone: v1.13
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/tool-result.ts
  - src/mcp/write-ack.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/agent/loop.test.mjs
lessons:
  - lesson-234
token_usage:
  input: 6883808
  output: 50902
  cache: 6577152
  total: 6934710
  requests: 127
  duration_ms: 1247045
  reasoning: 27140
  by_phase:
    code:
      input: 3526252
      output: 37941
      cache: 3393536
      requests: 51
    close:
      input: 3357556
      output: 12961
      cache: 3183616
      requests: 76
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Close VL-346 упал кодом 1 (сессия `agent-1794053090709`): модель 6 раз дословно повторила `lesson_update` и умерла по `MAX_ERROR_REPEATS_PER_RUN`.

```
lesson_update {id:"lesson-232", linkedTasks:["VL-346"], verifiedBy:"agent"}
→ {"ok":false,"error":"Тело урока lesson-232 не заполнено… в вызове нет `content`","missing":[…],"hint":"Добавь в вызов `content`…"}
× 6 → fail
```

Модель пришла **привязать урок к задаче** (`linkedTasks`), а не писать тело. Отказ заблокировал всю операцию, выхода из тупика не было: чтобы привязать, надо передать `content`; чтобы передать `content`, надо придумать текст урока.

## Корень — регресс VL-349

`src/mcp/tools.ts:2745`:

```ts
if (updates.content === undefined && isLessonBodyUnfilled(current.body)) {
  return ackErrorDetailed(...);   // отказ ДО применения любых полей
}
```

Проверка срабатывает на **любой** вызов `lesson_update`, если тело урока — скелет. На уроке-скелете нельзя обновить **ничего**: ни `linkedTasks`, ни `status`, ни `tags`.

VL-319 проверял `trim() === ''` — срабатывало редко (только реально пустое тело). VL-349 расширил предикат до `isLessonBodyUnfilled` (пустое ИЛИ скелет) — и заблокировал все обновления уроков, созданных через `lesson_create` без `content`.

Файл `backlog/lessons/lesson-232-…md` подтверждает: `linked_tasks: []` — привязка не применилась, хотя модель её передала. В `applied` ответа поля были перечислены, но это эхо переданных аргументов, а не факт записи.

## Почему это важно

`lesson_create` без `content` теперь отвечает ошибкой (VL-349), но уроки-скелеты уже накоплены (lesson-232 и другие). Для них любое обновление метаданных невозможно — а именно это делает шаг 6.5 Close (`lesson_link` / `lesson_update` с `linkedTasks`).

## Решение

Разделить два случая:

- **есть другие изменения** → применить их, ответить `ackOk` + `missing: [{field:'content'}]` + `hint` (предупреждение, не блокировка);
- **изменений нет вообще** (только `content` отсутствует, остальное уже такое) → `ackErrorDetailed` с `missing: content` (как сейчас), чтобы модель не уходила в noop-петлю.

## Связанные задачи

VL-319 (проверка пустого тела), VL-349 (расширение на скелет — источник регресса), VL-351 (контракт ack).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `lesson_update` на уроке с незаполненным телом (пустое или скелет) применяет переданные НЕ-body поля (`linkedTasks`, `status`, `tags`, `sourceTasks`, `verifiedBy`, `appliesTo`, `kind`, `supersedes`, `title`) и отвечает `ackOk` с `applied` фактических значений
- [x] #2 В `ackOk` такого вызова присутствует `missing: [{field:'content', reason:…}]` и `hint` — модель видит, что тело всё ещё не заполнено, но работа не заблокирована
- [x] #3 Отказ `ackErrorDetailed` с `missing: content` остаётся ТОЛЬКО для случая, когда вызов не меняет ничего другого: `content` не передан И все остальные переданные поля уже имеют эти значения (иначе — noop-ветка с `missing`)
- [x] #4 Вызов `lesson_update {id, linkedTasks:[X]}` на уроке-скелете реально записывает `linked_tasks` в файл (проверяется чтением файла, не только по `applied`)
- [x] #5 Регресс-тест на сессию `agent-1794053090709`: `lesson_update {id:'lesson-232', linkedTasks:['VL-346'], verifiedBy:'agent'}` на уроке-скелете → `ok:true`, `linked_tasks` записан, `missing` содержит `content`; повтор того же вызова → noop (не отказ), ран не падает
- [x] #6 Существующие кейсы VL-319/VL-349 не ломаются: вызов без `content` и без других изменений на уроке-скелете по-прежнему даёт `ok:false` с `missing: content` (не noop)
- [x] #7 `pnpm build && pnpm test` проходят без регрессий
- [x] #8 Документация: doc-8 (поведение `lesson_update` на незаполненном теле: частичное применение + `missing`), doc-10 §6 (разбор инцидента `agent-1794053090709`), CHANGELOG.md
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

- `src/mcp/tools.ts` — `toolLessonUpdate` (~:2745): переставить проверку незаполненного тела ПОСЛЕ вычисления `unchanged`.
- `src/mcp/tool-result.ts` — `ackOk` с `missing`/`hint` (проверить, нужен ли новый хелпер `ackOkDetailed`).
- Тесты: `src/mcp/write-ack.test.mjs`, `src/agent/loop.test.mjs`.
- Документация: `backlog/docs/doc-8`, `backlog/docs/doc-10` §6, `CHANGELOG.md`.

## Шаг 1. Порядок проверок в `toolLessonUpdate`

Сейчас (`:2745`) проверка «тело не заполнено» стоит ДО noop-сверки и отсекает любой вызов. Переставить:

1. Собрать `updates` (как есть).
2. Вычислить `unchanged` (как сейчас, `:2780`) — все переданные поля уже имеют эти значения.
3. **Новая логика:**

```ts
const bodyUnfilled = isLessonBodyUnfilled(current.body);

// (а) Явно переданный пустой content — ошибка (как сейчас, VL-319).
if (updates.content !== undefined && String(updates.content).trim() === '') {
  return ackErrorDetailed(...);
}

// (б) Тело не заполнено, content не передан, НО есть другие изменения —
// применяем их и предупреждаем. Раньше здесь стоял отказ, и на уроке-скелете
// нельзя было обновить ничего (сессия agent-1794053090709: linkedTasks не
// применялся, модель 6 раз повторила вызов → fail).
if (bodyUnfilled && updates.content === undefined && !unchanged) {
  const entry = updateLesson(cwd, args.id as string, updates);
  if (!entry) throw new Error(`Lesson ${args.id} не найден.`);
  return ackOkDetailed(
    `Lesson ${entry.lesson.id} обновлён: ${Object.keys(updates).join(', ')} (тело урока всё ещё не заполнено)`,
    appliedFrom(entry, updates),
    [],
    { missing: [{ field: 'content', reason: 'тело урока не заполнено (пустое или дефолтный скелет)' }],
      hint: 'Добавь в вызов `content` с непустым markdown (Проблема/Решение/Пример) — без него урок остаётся пустым.' },
  );
}

// (в) Тело не заполнено, content не передан, других изменений нет — отказ
// (как сейчас): noop здесь был бы петлёй, модель не узнала бы про тело.
if (bodyUnfilled && updates.content === undefined) {
  return ackErrorDetailed(...);   // существующий текст
}

// (г) Обычный noop / обычная запись — как сейчас.
```

Ключевое: ветка (б) стоит ДО (в) и требует `!unchanged`.

## Шаг 2. `ackOkDetailed` в `src/mcp/tool-result.ts`

`ackOk` не принимает `missing`/`hint`. Добавить рядом:

```ts
export function ackOkDetailed(
  message: string,
  applied: Record<string, unknown> = {},
  skipped: SkippedField[] = [],
  extra: { missing?: SkippedField[]; hint?: string } = {},
): string
```

Форма: `{ok:true, message, applied, skipped, ...(missing.length ? {missing} : {}), ...(hint ? {hint} : {})}`. `ackOk` остаётся обёрткой (совместимость).

## Шаг 3. Тесты

`src/mcp/write-ack.test.mjs`:

- **регресс `agent-1794053090709`**: урок-скелет + `lesson_update {id, linkedTasks:['VL-346'], verifiedBy:'agent'}` → `ok:true`, `missing` содержит `content`, `hint` непустой; **прочитать файл** и убедиться, что `linked_tasks: [VL-346]` записан (не только `applied`);
- повтор того же вызова → `ok:false, noop:true` (не отказ), `missing` содержит `content`;
- урок-скелет + `lesson_update {id}` без других полей → `ok:false` с `missing: content` (кейс VL-349 сохранён);
- урок-скелет + `lesson_update {id, content:'## Проблема\n\nx'}` → `ok:true`, тело записано;
- урок с заполненным телом + `linkedTasks` → `ok:true` без `missing` (регресс не задет).

`src/agent/loop.test.mjs`:

- регресс `agent-1794053090709`: заглушка `lesson_update` возвращает `ackOk` с `missing` → ран доходит до финального текста, нет 6 повторов.

## Шаг 4. Проверка и документация

- `pnpm build && pnpm test` — полный прогон.
- Ручная проверка: `lesson_update {id:'lesson-232', linkedTasks:['VL-346']}` → файл содержит `linked_tasks: [VL-346]`.
- `backlog/docs/doc-8`: поведение `lesson_update` на незаполненном теле — частичное применение + `missing`/`hint`, когда отказ.
- `backlog/docs/doc-10` §6: разбор инцидента `agent-1794053090709`, регресс VL-349.
- `CHANGELOG.md` → `## [Unreleased]` / «Исправлено».

## Риски

- **Модель может проигнорировать `missing` в успешном ответе** и не заполнить тело. Это приемлемо: привязка сделана, работа не заблокирована; `lesson_audit` finding `empty_body` покажет урок-скелет.
- **Порядок веток критичен**: (б) до (в), иначе регресс останется. Закрепить тестом.
- **`ackOkDetailed` — новый экспорт**: проверить, что инвариант `write-ack-contract.test.mjs` не требует обновления (он про наличие JSON-ack, форма не меняется).
- **Накопленные уроки-скелеты** останутся: их тела надо заполнять отдельно (или `lesson_audit` покажет список).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 15:28
---
Фаза 3 (Code) выполнена. Коммит a89f300.
**Изменено:**
- `src/mcp/tools.ts` (`toolLessonUpdate`): проверка «тело не заполнено» переставлена ПОСЛЕ вычисления `unchanged`. Ветки: (а) явно пустой `content` → отказ (как было); (б) тело не заполнено + `content` не передан + есть другие изменения → поля ПРИМЕНЯЮТСЯ, ответ `ackOkDetailed` с `applied` фактических значений + `missing:[{field:'content'}]` + `hint`; (в) вызов без полей вообще (только `id`) на уроке-скелете → `ackErrorDetailed` с `missing: content` (кейс VL-349 сохранён); (г) повтор уже применённых полей → обычный noop с `missing: content` (не отказ — иначе рецидив инцидента по капу повторов).
- `src/mcp/tool-result.ts`: новый экспорт `ackOkDetailed(message, applied, skipped, {missing, hint})`; `WriteAck` расширен аддитивными `missing?`/`hint?`; `ackOk` остался обёрткой (совместимость).
- Тесты: `src/mcp/write-ack.test.mjs` — новый блок VL-355 (6 кейсов, включая регресс `agent-1794053090709` с проверкой `linked_tasks` ЧТЕНИЕМ ФАЙЛА, а не по `applied`); `src/agent/loop.test.mjs` — регресс: `lesson_update` с `missing` в успешном ответе → ран доходит до финального текста без повторов; `src/mcp/write-ack-contract.test.mjs` — кейс VL-319 приведён к новому контракту (отказ для вызова без полей + частичное применение с `missing`).
**Проверки:** `pnpm build` — ок; полный `pnpm test` — 184 файла, 3488 passed, 4 skipped, exit 0 (лог `.vibelog/tmp/vl355-test.log`). Первый полный прогон дал одно падение `src/web/orchestrator.test.mjs` (git-флейк в mkdtemp: «not a git repository»); изолированно файл проходит (89/89), повторный полный прогон — зелёный.
**Отклонение от буквы AC3:** AC3 требует отказ для «content не передан И все остальные переданные поля уже имеют эти значения», а AC5 — noop для повтора того же вызова. Это взаимоисключающие требования; выбран вариант AC5 (noop с `missing`), потому что серия отказов на повторе — ровно механизм падения `agent-1794053090709` (`MAX_ERROR_REPEATS_PER_RUN`). Отказ сохранён для вызова, который не передаёт ни одного поля.
**Что осталось (Фаза Close):** AC8 — документация: `backlog/docs/doc-8` (поведение `lesson_update` на незаполненном теле: частичное применение + `missing`/`hint`), `backlog/docs/doc-10` §6 (разбор инцидента `agent-1794053090709`, регресс VL-349), `CHANGELOG.md` → `## [Unreleased]` / «Исправлено». В Фазе 3 эти файлы по регламенту не правятся. Накопленные уроки-скелеты (lesson-232 и др.) остаются — их тела заполняются отдельно, `lesson_audit` finding `empty_body` покажет список.
---
author: @agent
created: 2026-11-07 15:33
---
Фаза close не удалась (код выхода 1): ет, блокировок=0, payload последнего запроса=160321 байт (макс 160321), usage={"input_tokens":622103,"output_tokens":1643,"cache_read_input_tokens":605184,"total_tokens":623746,"reasoning_tokens":446} — статус возвращён к Review.
---
author: @agent
created: 2026-11-07 15:39
---
Фаза Close выполнена. Ветка vb/vl-355 слита в master (1 коммит a89f300, merge --no-ff без конфликтов), worktree удалена (force — в ней был только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-355 удалена.
**Проверки после merge:** `pnpm build` — ок; ранний точечный прогон затронутых diff'ом файлов (`src/mcp/write-ack.test.mjs`, `src/mcp/write-ack-contract.test.mjs`, `src/agent/loop.test.mjs`) — 178 passed; полный `pnpm test` — 184 файла, 3494 passed, 4 skipped, exit 0 (один прогон, повторов не было).
**Документация (AC8, DoD2):** коммит a02ef30 — `backlog/docs/doc-8` (поведение `lesson_update` на незаполненном теле: четыре случая, частичное применение + `missing`/`hint`, разбор регресса VL-349), `backlog/docs/doc-10` §6 (новый буллет VL-355 с разбором инцидента `agent-1794053090709`), `CHANGELOG.md` → `## [Unreleased]` / «Исправлено».
**Lessons:** создан lesson-234 «Валидация одного поля не должна блокировать применение остальных — предупреждай через missing/hint, а не отказом» (с телом), связан с VL-355; коммит 7a10565.
**DoD:** 1 «Тесты проходят» — выполнен (полный прогон зелёный); 2 «Документация обновлена» — выполнен (a02ef30); 3 «Нет регрессий» — выполнен. Все три отмечены.
**Замечание по процессу:** в этой сессии модель дважды уходила в дословные повторы (`lesson_create` без `content` и `git_commit` без `allowForeign`) — ровно тот класс, который чинит сама задача; вызовы прошли только после явной передачи недостающего аргумента.
---
<!-- COMMENTS:END -->