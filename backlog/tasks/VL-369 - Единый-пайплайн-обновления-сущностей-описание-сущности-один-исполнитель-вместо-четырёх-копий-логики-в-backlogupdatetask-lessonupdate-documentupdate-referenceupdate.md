---
id: VL-369
title: 'Единый пайплайн обновления сущностей: описание сущности + один исполнитель вместо четырёх копий логики в backlog_update_task / lesson_update / document_update / reference_update'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-08 01:45'
updated_date: '2026-11-08 10:32'
due_date: ''
labels: []
dependencies:
  - VL-371
milestone: ''
references: []
priority: high
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/update-pipeline.ts
  - src/mcp/update-pipeline.test.mjs
  - src/mcp/tools.ts
  - src/mcp/tool-result.ts
  - src/mcp/write-ack.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/mcp/lesson-tools.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/v11.test.mjs
  - src/mcp/tool-outcome-trace.test.mjs
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker-vl357.test.mjs
lessons:
  - lesson-253
token_usage:
  input: 27011348
  output: 162377
  cache: 25432064
  total: 27173725
  requests: 254
  duration_ms: 1704944
  reasoning: 91214
  by_phase:
    plan:
      input: 10472664
      output: 55611
      cache: 10030592
      requests: 82
    code:
      input: 13595625
      output: 88443
      cache: 12797952
      requests: 116
    close:
      input: 2943059
      output: 18323
      cache: 2603520
      requests: 56
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

За последние дни закрыто более десятка задач одного класса: модель застревает на повторах write-вызова, упирается в ограничитель повторов, фаза падает. Каждый фикс правил **форму ответа** конкретного инструмента, и следующий фикс отменял предыдущий. Итог — накопленная совместимость с ошибочными решениями и четыре ветки в одной функции.

### Что реально дублируется (проверено по коду)

**1. Сверка «уже так» — два способа на четыре инструмента.**
`backlog_update_task` (`src/mcp/tools.ts:1437`) и `lesson_update` (`src/mcp/tools.ts:2872`) пишут цикл `Object.keys(updates).every(key => sameValue(...))` вручную, а `document_update` и `reference_update` вызывают готовую `sameFieldsUpToDate` из `src/mcp/tool-result.ts:472`. Функция создавалась именно чтобы убрать копии (комментарий в ней: «одна реализация вместо копий»), но две копии остались.

**2. Сборка `applied` — около восьми копий одного цикла** `for (const key of Object.keys(updates)) applied[key] = ...` в `backlog_update_task` (2×), `lesson_update` (3×), `document_update` (2×), `reference_update` (2×), `lesson_create` (вручную). Различие только в том, что сворачивается до длины (`acceptanceCriteria`, `content`).

**3. `skipped` (переданные, но не записанные поля) есть только у одного инструмента.** `unknownFields(args, UPDATE_TASK_FIELDS)` + обработка `null` — только в `backlog_update_task` (`src/mcp/tools.ts:1477-1483`). В `lesson_update`/`document_update`/`reference_update` неизвестное поле игнорируется молча, ответ при этом `ok:true`. Это не «своя логика», а **пропущенная** логика, и она даёт ровно тот класс бага, из-за которого было столько инцидентов: модель передала поле, оно не записалось, ответ выглядит успешным.

**4. `missing` (чего не хватает) — три разных подхода.** `lesson_update` считает по состоянию сущности (`isLessonBodyUnfilled`); `backlog_update_task` — по захардкоженному списку популярных полей (`missingTaskFields`, `src/mcp/tools.ts:1346`: `['description','acceptanceCriteria','plan','notes','labels','priority','status']`, фильтр «не передано в args»); `document_update`/`reference_update` — нет вообще. Список не смотрит на состояние задачи: если описание уже есть, а модель его не передала, поле попадёт в `missing` ложно.

**5. Тексты «Следующий шаг: …» — четыре варианта одной фразы**, вручную в каждом инструменте. Именно они закреплены тестами на точные строки, поэтому любая правка текста ломает тесты.

### Четыре ветки в `toolLessonUpdate` — неверная логика

`src/mcp/tools.ts:2818-2978` (~160 строк) содержит четыре ветки, каждая из которых появилась, чтобы компенсировать предыдущую:

1. тело пустое → отказ (чтобы модель увидела, чего не хватает);
2. но отказ блокирует привязку задачи → применяем поля и предупреждаем;
3. но отказ при создании замыкает петлю → создаём заглушку;
4. но заглушка не отличается от заполненного тела → нужен предикат;
5. но предикат блокирует всё → переставляем проверку после сверки.

Корневая ошибка: код пытался решить «модель застревает» через **выбор формы ответа**. Модель застревает не из-за формы, а из-за **отсутствия следующего шага**. Отказ без готового исправления и успех без указания на пробел одинаково бесполезны; отказ с готовым исправлением и успех с указанием на пробел одинаково полезны.

## Инвариант, закрывающий класс

> Write-инструмент делает ровно две вещи: применяет то, что попросили, и сообщает получившееся состояние. Он **никогда не отказывает из-за того, что сущность неполная**.

Неполнота — свойство сущности, а не ошибка вызова. О ней сообщают полем «чего не хватает» + готовым вызовом, а не отказом. Отказ остаётся только для **испорченного аргумента**: явно пустое обязательное значение, несуществующий идентификатор, значение неверного типа.

## Таблица исходов: два булева вместо четырёх веток

Вся логика ответа сводится к двум вопросам — записали ли что-нибудь и полная ли сущность после записи:

| Записали | Сущность полная | Исход | Что в ответе |
|---|---|---|---|
| да | да | `applied` | применённые поля |
| да | нет | `partial` | применённые поля + чего не хватает + готовый вызов |
| нет (менять нечего) | да | `noop` | фактическое состояние |
| нет (менять нечего) | нет | `noop` | фактическое состояние + чего не хватает + готовый вызов |
| нет (аргумент испорчен) | — | `rejected` | текст ошибки + готовый вызов |

Пятая строка — единственное место, где остаётся отказ. Четвёртая — принципиальна: «ничего не изменилось, и сущность неполная» это `noop`, а не отказ. Именно здесь раньше стоял отказ, и именно он давал серию отказов, упирающуюся в ограничитель повторов. Отказ на повторе — механизм падения, а не защита от него.

## Устройство

Описание сущности (декларация различий) + один исполнитель (общий код):

```
EntitySpec {
  name            // 'task' | 'lesson' | 'document' | 'reference'
  fields          // допустимые имена полей — для отлова неизвестных
  setFields       // сравниваемые как множества (порядок не значим)
  bodyField       // какой аргумент ложится в тело
  read(id)        // текущее состояние
  write(id, upd)  // запись
  snapshot(e)     // снимок для сверки «уже так»
  applied(e, keys)// что попадает в ответ
  completeness(e, ctx) // чего не хватает (см. VL-370)
  message(e, keys)// текст
  hooks           // beforeWrite — для настоящей специфики
}
```

Исполнитель `runUpdate(spec, args, cwd)` — шесть шагов: собрать поля → отсеять неизвестные в `skipped` → посчитать неполноту → сверить «уже так» → записать → сериализовать ответ через существующий `serializeAck` (`src/mcp/tool-result.ts`).

Хук `beforeWrite` нужен для настоящей специфики — например, «явно пустое тело недопустимо». Это одна проверка аргумента, а не четыре ветки состояния.

## Граница (согласована)

**Входит:** `backlog_update_task`, `lesson_update`, `document_update`, `reference_update` — на общий пайплайн; `backlog_update_status` — как частный случай (сейчас имеет свою noop-ветку, `src/mcp/tools.ts:1312`).

**Не входит:** `milestone_*` (rename меняет задачи, archive переносит файл — не update-паттерн), `backlog_manage_ac`/`backlog_manage_dod` (работают с индексами, а не полями). Притягивать их к общему пайплайну — новый класс ошибок.

## Что удаляется

- четыре ветки `toolLessonUpdate` — заменяются общей таблицей;
- две ручные копии сверки «уже так»;
- около восьми копий сборки `applied`;
- `missingTaskFields` (гадание по списку) — заменяется расчётом от состояния (VL-370);
- двойная форма ответа (`next.*` и поля в корне) и разбор обеих форм (`parsedAckNext`).

## Связанные задачи

- **VL-370** — неполнота как данные (учёт workflow и фазы). Зависимость: встраивается в пайплайн этой задачи.
- **VL-371** — пересмотр тестов: замена проверок точных формулировок и шести копий порога размера на проверки свойств. Идёт параллельно, но должен завершиться до правки кода, иначе рефакторинг упрётся в тесты на строки.

## Риск

Регресс-тесты шести инцидентов завязаны на текущее поведение `toolLessonUpdate`. Часть из них проверяет формулировки, а не поведение (см. VL-371) — их нельзя «привести к новому контракту», их надо заменить проверками свойств. Тесты, проверяющие наблюдаемое поведение (например, что `linked_tasks` реально записан в файл, а не только в `applied`), сохраняются как есть и должны остаться зелёными.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В `src/mcp/` есть описание сущности (EntitySpec) и один исполнитель `runUpdate(spec, args, cwd)`; `backlog_update_task`, `lesson_update`, `document_update`, `reference_update` вызывают его, а не содержат собственные циклы сверки/сборки applied
- [x] #2 `toolLessonUpdate` больше не содержит четырёх веток состояния: логика сводится к таблице «записали × сущность полная» (applied / partial / noop / noop+missing / rejected); специфика урока вынесена в хук beforeWrite
- [x] #3 `skipped` (переданные, но не записанные поля) заполняется у ВСЕХ четырёх инструментов: неизвестное имя поля и переданный null попадают в skipped, а не игнорируются молча
- [x] #4 `missing` (чего не хватает) считается от состояния сущности, а не от списка переданных аргументов; `missingTaskFields` удалён
- [x] #5 Инвариант проверен тестом: вызов с корректными аргументами на НЕПОЛНОЙ сущности возвращает applied или partial, но НИКОГДА rejected; отказ остаётся только для испорченного аргумента (пустое обязательное значение, несуществующий id, неверный тип)
- [x] #6 `backlog_update_status` использует общий пайплайн как частный случай (одно поле status), собственная noop-ветка удалена
- [x] #7 `pnpm build && pnpm test` зелёный; тесты, проверяющие наблюдаемое поведение (например, что linked_tasks реально записан в файл), сохранены без изменений
- [x] #8 Документация обновлена: doc-8 (контракт write-инструментов, единый пайплайн), doc-10 §6 (разбор класса инцидентов), CHANGELOG.md
- [x] #9 Форма ответа остаётся ПЛОСКОЙ (`missing`/`hint`/`retryWith` в корне JSON — так их разворачивает `serializeAck`); мёртвый разбор `parsed.next?.x` удалён из `parsedAckNext` и `parsedErrorText`, рабочий `parsed.x` сохранён; тесты `repeat-tracker-vl357.test.mjs`, конструирующие несуществующую вложенную форму, переписаны на реальную
- [x] #10 Вызов без полей вообще (`{id}` без изменяющих аргументов) даёт `noop` + `missing` (если сущность неполная), а не исключение «Не указаны поля для обновления»; исключение — `backlog_update_status` без `status` (обязательный аргумент → `rejected`)
- [x] #11 `append_notes` сохраняет неидемпотентность: в `EntitySpec` есть `nonIdempotent`, noop-сверка для него отключена, `build` получает текущее состояние для склейки заметок; повторное дописывание по-прежнему меняет файл
- [x] #12 `PARTIAL_EXEMPT`/`PARTIAL_SCENARIOS` в `write-ack-contract.test.mjs` приведены в соответствие: `backlog_update_task` убран из исключений (после введения `taskCompleteness` запись «незаполненных по смыслу полей нет» стала ложной) и добавлен в сценарии с ожиданием `partial` + `missing[0].field === 'description'`
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

Убрать четыре копии логики ответа в `backlog_update_task` / `lesson_update` / `document_update` / `reference_update` (+ `backlog_update_status`) и свести всё к одной таблице исходов: **записали × сущность полная** → `applied` / `partial` / `noop` / `noop+missing` / `rejected` (пятая строка — только испорченный аргумент).

**Порядок запуска:** код правится только после VL-371 (пересмотр тестов) — иначе рефакторинг упрётся в проверки точных строк. VL-371 — зависимость задачи.

## Предварительное чтение (сделано в Plan)

- `src/mcp/tools.ts` — 1309-1324 (`toolUpdateStatus`, своя noop-ветка), 1341-1349 (`missingTaskFields`), 1351-1488 (`toolUpdateTask`: ручная сверка `every(sameValue)`, сборка `applied`, `skipped`+null, `append_notes`), 2417-2474 (`DOC_SET_FIELDS`, `toolDocumentUpdate`), 2596-2666 (`toolReferenceUpdate`, ручная сборка `comparable.__urls`), 2750-2790 (`lesson_create` — ручная сборка applied), 2805-2817 (`LESSON_BODY_TEMPLATE`/`LESSON_BODY_HINT`), 2818-2978 (`toolLessonUpdate`, четыре ветки).
- `src/mcp/tool-result.ts` — `serializeAck` (:112), `ackOk` (:210), `ackOkDetailed` (:255), `ackNoop` (:287), `ackNoopDetailed` (:330), `ackError` (:527), `ackErrorDetailed` (:542), `sameValue` (:407), `sameFieldsUpToDate` (:472), `unknownFields` (:585), `SET_FIELDS`/`BODY_FIELD` (:399/:413).
- `src/agent/repeat-tracker.ts` — `parsedAckNext` (:838), `parsedErrorText` (:705-740), `appliedNoopDirective`/`noopRepeatDirective` (:885/:918).
- Ядро записи: `updateTaskFile` (`src/core/store.ts:127`), `updateLesson` (`src/core/lesson.ts:430`), `updateDocument` (`src/core/document.ts:211`), `updateReference` (`src/core/reference.ts:342`) — все принимают `Partial<…>` и возвращают запись либо `null`; атомарность уже на их стороне (один `writeFileSync`), менять ядро НЕ нужно.

## КРИТИЧНО: форма ответа — ПЛОСКАЯ, `next.*` в JSON не существует

Первая редакция плана требовала «читать только `next.missing`/`next.hint`/`next.retryWith`, fallback на корень удалить». **Это откатило бы VL-361 и VL-362 целиком.**

Факт по коду `serializeAck` (`src/mcp/tool-result.ts:112-150`):

```ts
const next = ack.next ?? {};
if (next.missing !== undefined && next.missing.length > 0) out.missing = next.missing;
if (next.hint !== undefined && next.hint !== '') out.hint = next.hint;
if (next.retryWith !== undefined && Object.keys(next.retryWith).length > 0) out.retryWith = next.retryWith;
```

`next` — **внутренняя структура** `ToolAckInput`. В JSON она **разворачивается в корень**. Реальный ответ инструмента всегда плоский:

```json
{ "ok": true, "outcome": "partial", "missing": [...], "hint": "...", "retryWith": {...} }
```

Вложенного `next` в выводе нет нигде (проверено поиском: `next: {` встречается только в `tool-result.ts` во внутренних вызовах `serializeAck`).

Следствия:
- `parsed.next?.missing ?? parsed.missing` — первая часть **мёртвый код**, вторая — рабочая;
- удаление fallback на корень сделало бы `parsedAckNext` всегда `null` → директивы потеряли бы `missing`/`hint`/`retryWith` → откат VL-361/VL-362.

**Правильное направление:** удалить `parsed.next?.x` (мёртвый разбор), оставить `parsed.x`. Форма ответа остаётся одна — плоская.

Откуда путаница: `src/agent/repeat-tracker-vl357.test.mjs:140` конструирует v2-форму вручную (`{ outcome: 'rejected', next: { hint, retryWith } }`), но `serializeAck` так не сериализует — тест проверяет гипотетическую форму, которой в реальности нет. Этот тест переписывается (см. шаг 3).

## Файлы и конкретные шаги

### 1. Новый модуль `src/mcp/update-pipeline.ts` (≈220 строк)

Единственный исполнитель + декларации различий.

```ts
export interface EntitySpec<E> {
  name: 'task' | 'lesson' | 'document' | 'reference';
  fields: readonly string[];            // допустимые имена аргументов (для skipped)
  setFields: readonly string[];         // сравниваемые как множества
  bodyArg?: string;                     // 'content' | 'description'
  /** Неидемпотентные аргументы: noop-сверка для них отключена (append_notes). */
  nonIdempotent?: readonly string[];
  /** Сборка полей. `current` передан для операций, которым нужно текущее состояние. */
  build(args, cwd, current): { updates: Record<string, unknown> };
  read(cwd, id): E | null;
  write(cwd, id, updates): E | null;
  snapshot(e): Record<string, unknown>; // тело под BODY_FIELD
  comparable?(updates, e): Record<string, unknown>; // спец-поля (url/urls)
  applied(e, keys): Record<string, unknown>; // сворачивание в длину задаётся здесь
  completeness(e, ctx): SkippedField[] | undefined; // чего не хватает (VL-370 расширит)
  suggest?(e, transferred: string[]): string[];      // для hint «например: …», от состояния
  message(e, keys, via: 'applied' | 'noop' | 'partial'): string;
  beforeWrite?(args, updates, current): string | null; // хук: испорченный АРГУМЕНТ → rejected
}
export function runUpdate<E>(spec: EntitySpec<E>, args: ToolArgs, cwd: string): string
```

`runUpdate` — шесть шагов:
1. `current = spec.read(cwd, id)` (нужен до `build` — для `append_notes` и `completeness`).
2. `spec.build(args, cwd, current)` — сборка `updates`; любая порча аргумента (неверный тип, несуществующий id родителя, битый JSON в AC, отсутствие обязательного `status`) вылетает исключением **до** записи → `ackErrorDetailed`.
3. `skipped = unknownFields(args, spec.fields)` + универсальная обработка `null`: переданный `null` для имени из `spec.fields` → `{field, reason:'значение null не применяется: поле не изменено'}` (логика переносится из `tools.ts:1475-1483` без изменений — AC3).
4. `missing = spec.completeness(current) ?? []`.
5. Сверка «уже так» — только `sameFieldsUpToDate(spec.snapshot(current), comparable, spec.setFields)`; `comparable` строит исполнитель (`bodyArg` → `BODY_FIELD`, спец-поля — через `spec.comparable`). **Если в `updates` есть ключ из `spec.nonIdempotent` — сверка пропускается** (перенос условия `if (args.append_notes === undefined)` из `tools.ts:1437`).
6. Сериализация: `ackOk` / `ackOkDetailed` (partial при непустом `missing`) / `ackNoopDetailed` (noop + missing). Единый текст noop-сообщения — общий хелпер в этом же модуле: `Изменений нет: <поля> уже имеют эти значения. Следующий шаг: backlog_finish_phase (или следующий шаг плана) — повтор этого вызова ничего не изменит.` Подстрока `Следующий шаг: backlog_finish_phase` закреплена тестами `write-ack.test.mjs:178,238`, `server.test.mjs:625` — сохраняется в `message`, а не в `hint` (VL-326 запретил её именно в `hint`).

**Вызов без полей вообще** (`Object.keys(updates).length === 0` и нет `nonIdempotent`): сейчас `toolUpdateTask`/`toolLessonUpdate`/`toolDocumentUpdate` бросают `throw new Error('Не указаны поля для обновления.')`. По новой таблице это **`noop`** (аргумент не испорчен, менять нечего) + `missing`, если сущность неполная. Исключение — `backlog_update_status`: отсутствие `status` — испорченный аргумент (см. шаг 2).

### 2. `src/mcp/tools.ts` — свести пять инструментов к описаниям

| Место (строки) | Что делаем |
|---|---|
| 1309-1324 `toolUpdateStatus` | → `statusSpec`: `fields=['id','status']`, `build` **бросает** при отсутствии/пустом `status` (обязательный аргумент — `PARTIAL_EXEMPT:556`), собственная noop-ветка удаляется (AC7). `message` по `via:'applied'` — «Статус задачи X обновлён: Y» (закреплено `write-ack.test.mjs:222`) |
| 1341-1349 `missingTaskFields` | **удалить** (AC4) |
| 1351-1488 `toolUpdateTask` | оставить только сборку `updates` из args (1390-1410) + `runUpdate(taskSpec, args, cwd)`; убрать 1437-1460 (ручная сверка + своя noop-ветка) и 1464-1483 (сборка applied/skipped). `taskSpec.nonIdempotent = ['append_notes']`; `build` для `append_notes` использует переданный `current` (склейка `implementationNotes`) |
| 2417-2474 `toolDocumentUpdate` | `documentSpec`: `fields=['id','title','content','type','tags','idempotencyKey']`, `setFields=DOC_SET_FIELDS`, `bodyArg='content'`, `completeness: () => []` (тело документа необязательно — `PARTIAL_EXEMPT:565`) |
| 2596-2666 `toolReferenceUpdate` | `referenceSpec`: `fields=['id','tags','description','url','urls','idempotencyKey']`, `setFields=REFERENCE_SET_FIELDS`, `bodyArg='description'`, нормализация `url/urls` в `comparable.__urls` переносится в `spec.comparable`; `completeness: () => []` (`PARTIAL_EXEMPT:566`) |
| 2805-2978 (`LESSON_BODY_TEMPLATE`, `LESSON_BODY_HINT`, `toolLessonUpdate`) | `lessonSpec` + `beforeWrite`: `updates.content !== undefined && String(content).trim() === ''` → отказ с `retryWith: {content: LESSON_BODY_TEMPLATE}` (единственный хук, AC2). `completeness: (e) => isLessonBodyUnfilled(e.body) ? [{field:'content', reason:…}] : []`. `applied`: `content` → длина тела, остальное — значение из `entry.lesson`. Четыре ветки (2843-2978) удаляются целиком |
| 2750-2790 `toolLessonCreate` applied | перевести на общий `spec.applied` (одна копия цикла меньше) |

Ожидаемое сокращение `tools.ts` — примерно на 250-300 строк.

### 3. Одна форма «следующего шага» — ПЛОСКАЯ (AC6, исправлено)

- `src/agent/repeat-tracker.ts`: в `parsedAckNext` (:838-870) и `parsedErrorText` (:705-740) **удалить мёртвый разбор `parsed.next?.x`**, оставить `parsed.x`. Экспортируемые имена сохраняются (на них ссылаются `loop.ts:58,85` и тесты).
- `src/agent/repeat-tracker-vl357.test.mjs:130-147`: тесты, конструирующие v2-форму вручную (`{ next: { hint, retryWith } }`), переписать на **реальную** плоскую форму (`{ hint, retryWith }`), которую производит `serializeAck`. Добавить кейс «ответ без `missing`/`hint`/`retryWith` → `null`».
- Проверить, что `serializeAck` не начал отдавать вложенный `next` (он и не должен — это внутренняя структура).

### 4. Тесты

Новые файлы:
- `src/mcp/update-pipeline.test.mjs` — таблица исходов на заглушке-спеке: (записали,полная) → `applied`/`partial`/`noop`/`noop+missing`; `beforeWrite` даёт `rejected`; `skipped` содержит неизвестное поле и `null` для всех четырёх сущностей (AC3); `nonIdempotent` отключает noop-сверку; вызов без полей → `noop`, а не исключение.
- `src/mcp/update-invariant.test.mjs` — AC5: для каждого из пяти инструментов вызов с корректными аргументами на **неполной** сущности даёт `applied`|`partial` и категорически не `rejected`; `rejected` наступает только на порче аргумента (пустой `content`, несуществующий id, `acceptanceCriteria`-скаляр, отсутствие `status` у `backlog_update_status`).

Правки существующих (осознанные, по списку — в духе VL-371):
- `src/mcp/lesson-tools.test.mjs:93` (`update без полей → ошибка`) и `src/mcp/documents.test.mjs:134` (`document_update без полей → /Не указаны поля/`) → теперь `noop` (аргумент не испорчен, менять нечего);
- `src/mcp/write-ack.test.mjs` VL-355 AC6 (:415-424, `{id}` на скелете → отказ) → `noop` + `missing[0].field==='content'`;
- `src/mcp/write-ack.test.mjs:560-580` (hint перечисляет не переданные поля) — формулировка остаётся, набор берётся из `spec.suggest` (state-based);
- **`src/mcp/write-ack-contract.test.mjs:554`** — `backlog_update_task` **убрать из `PARTIAL_EXEMPT`** (запись «незаполненных по смыслу полей у задачи нет» станет ложной после введения `taskCompleteness`) и **добавить в `PARTIAL_SCENARIOS`** со сценарием «задача без `description` → `partial` + `missing[0].field==='description'`». Тест `AC4: каждый write-инструмент реестра учтён` проверяет только наличие ключа, поэтому молчаливая порча семантики иначе не была бы замечена;
- `src/mcp/tool-outcome-trace.test.mjs` — имена `it(...)` не меняются, строки матрицы править не нужно (проверить прогоном).

Сохраняются без изменений: `write-ack-contract.test.mjs` (таблица всех write-инструментов, кроме правки `PARTIAL_*` выше), `write-ack.test.mjs:368` (`linked_tasks` проверяется чтением файла), `loop-repeat-cap.test.mjs`.

### 5. Документация (AC9)

- `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md`: §`backlog_update_task` (:87), §`document_update` (:380), §`reference_update`, §`lesson_update` — единый контракт «описание сущности + `runUpdate`», таблица исходов, обязательность `skipped`; убрать упоминание `missingTaskFields` (:135); зафиксировать, что форма ответа **плоская** (поля `missing`/`hint`/`retryWith` в корне).
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`: §6 (Loop detection, :405-447) — разбор класса инцидентов «форма ответа вместо следующего шага», инвариант «write-инструмент не отказывает из-за неполноты сущности»; §6.7 — та же причина.
- `CHANGELOG.md`: запись в верхнюю секцию — единый пайплайн, таблица исходов, плоская форма ответа.

## Проверка

```
pnpm build && pnpm test                     # полный прогон — обязателен для DoD
pnpm build && npx vitest run src/mcp/update-pipeline.test.mjs src/mcp/update-invariant.test.mjs \
  src/mcp/write-ack.test.mjs src/mcp/write-ack-contract.test.mjs src/mcp/lesson-tools.test.mjs \
  src/mcp/documents.test.mjs src/mcp/reference-tools.test.mjs src/agent/repeat-tracker-vl357.test.mjs
git diff --stat                             # контроль: tools.ts сократился, новых копий нет
grep -rn "Object.keys(updates).every\|missingTaskFields\|parsed.next?." src/   # пусто
```

## Риски и как снимать

1. **`missing` от состояния делает `backlog_update_task` чаще `partial`.** `taskCompleteness` в этой задаче минимальна: `description` пуст → `missing:[description]`; набор «что ещё можно передать» берётся из `spec.suggest` (поля, пустые в сущности и не переданные). Тесты, ожидающие `outcome:'applied'` у update_task, поправляются осознанно; `PARTIAL_EXEMPT`/`PARTIAL_SCENARIOS` обновляются (шаг 4); VL-370 заменит расчёт на workflow/phase-aware.
2. **Поведение `lesson_update` закреплено ~20 регресс-тестами.** Часть — на точный `reason`/`applied` (см. VL-371). Порядок: VL-371 → правка кода; тесты наблюдаемого поведения (запись `linked_tasks` в файл) остаются как есть.
3. **`backlog_update_status` в общем пайплайне** ломает сообщение «Статус задачи X обновлён: Y» — сохраняется как `spec.message` по `via:'applied'`; noop-текст — общий (маркеры `Изменений нет`/`Следующий шаг: backlog_finish_phase` обязательны, `write-ack.test.mjs:178,238`, `server.test.mjs:625`). Отсутствие `status` — `rejected`, а не `noop`.
4. **`append_notes` — неидемпотентная операция.** В `EntitySpec` есть `nonIdempotent`; `build` получает `current` для склейки заметок. Без этого `append_notes` попал бы в noop-сверку и перестал бы дописывать.
5. **Границы соблюдаем:** `milestone_*`, `backlog_manage_ac`/`backlog_manage_dod`, `lesson_link`/`reference_link`, `git_commit` в пайплайн НЕ переводятся — у них другая семантика (rename/archive, индексы, две стороны связи, явные пути).
6. **Идемпотентность:** `withIdempotency` остаётся на уровне `handleToolCall` (`tools.ts:852-912`), состав аргументов не меняется — кэш не инвалидируется.
7. **Форма ответа не меняется.** Плоская форма (`missing`/`hint`/`retryWith` в корне) — действующая; рефакторинг её сохраняет. Меняется только разбор: мёртвый `parsed.next?.x` удаляется. Если после правки `parsedAckNext` начал возвращать `null` на реальных ответах — значит направление снова перепутано, откатить.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 01:55
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, не epic). План записан в ## Implementation Plan.
**Что изучено:** `src/mcp/tools.ts` (пять update-инструментов: 1309-1324, 1341-1349, 1351-1488, 2417-2474, 2596-2666, 2805-2978), `src/mcp/tool-result.ts` (контракт ack: serializeAck/ackOk/ackOkDetailed/ackNoopDetailed/ackErrorDetailed/sameValue/sameFieldsUpToDate/unknownFields), `src/agent/repeat-tracker.ts` (parsedAckNext/parsedErrorText — две формы `next`), ядро записи (`updateTaskFile`/`updateLesson`/`updateDocument`/`updateReference` — атомарность уже на их стороне, менять не нужно).
**План (кратко):**
1. Новый модуль `src/mcp/update-pipeline.ts`: `EntitySpec` (name/fields/setFields/bodyArg/build/read/write/snapshot/applied/completeness/suggest/message/beforeWrite) + `runUpdate(spec, args, cwd)` с шестью шагами и единой таблицей исходов «записали × сущность полная».
2. `tools.ts`: пять инструментов сводятся к описаниям; удаляются `missingTaskFields`, две ручные копии сверки «уже так», ~8 копий сборки `applied`, четыре ветки `toolLessonUpdate` (~160 строк). Ожидаемое сокращение файла — 250-300 строк.
3. Одна форма `next.*`: fallback на поля в корне убирается в `parsedAckNext` и `parsedErrorText` (имя экспорта сохраняется — на него ссылается `loop.ts`).
4. Тесты: новые `update-pipeline.test.mjs` (таблица исходов, skipped с null) и `update-invariant.test.mjs` (AC5 — неполная сущность никогда не даёт rejected); правки в `lesson-tools.test.mjs`, `documents.test.mjs`, `write-ack.test.mjs` по списку; `write-ack-contract.test.mjs`, `write-ack.test.mjs:368` (linked_tasks чтением файла), `loop-repeat-cap.test.mjs` — без изменений.
5. Документация: doc-8 (контракт update-инструментов), doc-10 §6/§6.7, CHANGELOG.md.
**Риски:** (1) `missing` от состояния чаще даёт `partial` у update_task — закрывается сознательной правкой тестов и VL-370; (2) поведение `lesson_update` закреплено ~20 регресс-тестами на точные строки — поэтому порядок «сначала VL-371, потом код» (зависимость уже стоит); (3) маркерные подстроки `Изменений нет` / `Следующий шаг: backlog_finish_phase` сохраняются в `message` (в `hint` их запрещает VL-326); (4) границы соблюдены: milestone_*, manage_ac/dod, *_link, git_commit в пайплайн не входят.
Файлов к правке: 8 существующих + 3 новых (update-pipeline.ts, update-pipeline.test.mjs, update-invariant.test.mjs) + 3 документа.
---
author: @agent
created: 2026-11-08 02:28
---
## План пересмотрен после проверки против кода
Проверка выявила **критическую ошибку**, которая откатила бы VL-361 и VL-362, плюс три пробела. План обновлён.
### 1. КРИТИЧНО: направление правки формы ответа было перепутано
Первая редакция требовала: «`parsedAckNext`/`parsedErrorText` читают только `next.missing`/`next.hint`/`next.retryWith`, fallback на корень удалить».
**Это сломало бы всё.** Факт по `serializeAck` (`src/mcp/tool-result.ts:112-150`):
```ts
const next = ack.next ?? {};
if (next.missing !== undefined && next.missing.length > 0) out.missing = next.missing;
if (next.hint !== undefined && next.hint !== '') out.hint = next.hint;
if (next.retryWith !== undefined && ...) out.retryWith = next.retryWith;
```
`next` — **внутренняя структура** `ToolAckInput`, в JSON она **разворачивается в корень**. Реальный ответ всегда плоский:
```json
{ "ok": true, "outcome": "partial", "missing": [...], "hint": "...", "retryWith": {...} }
```
Вложенного `next` в выводе нет нигде (проверено поиском: `next: {` встречается только в `tool-result.ts` во внутренних вызовах `serializeAck`).
Значит `parsed.next?.missing ?? parsed.missing` — первая часть **мёртвый код**, вторая рабочая. Удаление fallback на корень сделало бы `parsedAckNext` всегда `null` → директивы потеряли бы `missing`/`hint`/`retryWith` → полный откат VL-361/VL-362.
**Исправлено:** удаляется мёртвый `parsed.next?.x`, сохраняется `parsed.x`. AC6 переформулирован: «форма остаётся плоской, мёртвый разбор удалён».
Откуда путаница: `repeat-tracker-vl357.test.mjs:140` конструирует v2-форму вручную (`{ next: { hint, retryWith } }`), но `serializeAck` так не сериализует — тест проверяет гипотетическую форму, которой в реальности нет. Тест переписывается на реальную плоскую.
### 2. Пробел: `append_notes` не был отражён в `EntitySpec`
`toolUpdateTask` (`tools.ts:1437`) явно отключает noop-сверку: `if (args.append_notes === undefined)`. Плюс `append_notes` требует чтения текущей задачи для склейки. В интерфейсе плана не было ни поля для неидемпотентных операций, ни передачи `current` в `build`.
**Исправлено:** добавлено `nonIdempotent?: readonly string[]` и `build(args, cwd, current)`. Добавлен AC.
### 3. Пробел: `PARTIAL_EXEMPT` стал бы ложным
`write-ack-contract.test.mjs:554` содержит: `backlog_update_task: 'обновление применяет переданные поля; незаполненных «по смыслу» полей у задачи нет'`. После введения `taskCompleteness` (пустой `description` → `missing`) запись станет неверной. Тест `AC4: каждый write-инструмент реестра учтён` проверяет только наличие ключа — молчаливая порча семантики не была бы замечена.
**Исправлено:** `backlog_update_task` убирается из `PARTIAL_EXEMPT`, добавляется в `PARTIAL_SCENARIOS`. Добавлен AC.
### 4. Пробел: «вызов без полей → noop» не был в AC
План меняет поведение: `lesson_update {id}` и `document_update {id}` сейчас бросают `throw new Error('Не указаны поля для обновления.')`, станут `noop`. Это изменение контракта, но в AC его не было.
**Исправлено:** добавлен AC. Отдельно оговорено: `backlog_update_status` без `status` — `rejected` (обязательный аргумент, `PARTIAL_EXEMPT:556`), а не `noop`.
### Проверенные ссылки на код (все верны)
`serializeAck` (:112), `ackOk` (:210), `ackOkDetailed` (:255), `ackNoop` (:287), `ackNoopDetailed` (:330), `ackError` (:527), `ackErrorDetailed` (:542), `sameValue` (:407), `sameFieldsUpToDate` (:472), `unknownFields` (:585) — `src/mcp/tool-result.ts`.
`updateTaskFile` (`store.ts:127`), `updateLesson` (`lesson.ts:430`), `updateDocument` (`document.ts:211`), `updateReference` (`reference.ts:342`) — все возвращают запись или `null`, атомарность на их стороне, ядро менять не нужно.
`missingTaskFields` (`tools.ts:1346`), `UPDATE_TASK_FIELDS` (`tools.ts:101`, 19 полей), `DOC_SET_FIELDS` (`:2417`), `REFERENCE_SET_FIELDS` (`:2646`) — существуют, ссылки корректны.
### Добавлен риск 7
«Форма ответа не меняется. Если после правки `parsedAckNext` начал возвращать `null` на реальных ответах — значит направление снова перепутано, откатить.»
---
author: @agent
created: 2026-11-08 09:46
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/mcp/update-pipeline.ts
- src/mcp/tools.ts
- .vibelog/tmp/vl369-lesson.js
- .vibelog/tmp/vl369-imports.js
- .vibelog/tmp/vl369-applied.js
- .vibelog/tmp/vl369-tests1.js
- .vibelog/tmp/vl369-tests2.js
- Продолжаю с контекстом планирования. Начинаю правки.
Пишу новый модуль пайплайна.
Продолжаю правки `tools.ts`. Заменяю `toolUpdateStatus`, `missingTaskFields` и `toolUpdateTask`.
Пишу замену для `toolUpdateStatus`, `missingTaskFields` и `toolUpdateTask`.
Теперь `document_update` и `reference_update`…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 440 с, payload 708824 байт_
Незакоммиченные изменения сохранены в ветку: коммит `fbe9c81`.
---
author: @agent
created: 2026-11-08 09:46
---
Фаза code не удалась (код выхода 1): ировок=3, payload последнего запроса=625145 байт (макс 708824), usage={"input_tokens":10640592,"output_tokens":50038,"cache_read_input_tokens":9996288,"total_tokens":10690630,"reasoning_tokens":21325} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-08 09:56
---
Фаза 3 (Code) выполнена. Коммит 60c234e (плюс wip-коммит fbe9c81 после обрыва рана по max-requests).
**Изменено:**
- `src/mcp/update-pipeline.ts` (новый, 258 строк) — `EntitySpec` + `runUpdate(spec, args, cwd)`. Шесть шагов: id → чтение → сборка полей → `skipped` → `beforeWrite` → сверка «уже так» → запись → сериализация. Таблица исходов «записали × сущность полная»: applied / partial / noop / noop+missing / rejected. `null` отсекается до записи (иначе ядро падало «Недопустимый статус lesson "null"»). `nonIdempotent` отключает noop-сверку, `build(args, cwd, current)` получает текущее состояние.
- `src/mcp/tools.ts` — пять инструментов сведены к декларациям: `taskSpec`, `statusSpec`, `documentSpec`, `referenceSpec`, `lessonSpec`. Удалены `missingTaskFields`, две ручные копии сверки `every(sameValue)`, ~8 копий сборки `applied`, четыре ветки `toolLessonUpdate` (~160 строк). Специфика урока — один хук `beforeWrite` (явно пустой `content`) + `completeness` (тело не заполнено) + `next` с готовым каркасом.
- `src/mcp/tool-result.ts` — `ackNoopDetailed` принимает `skipped` (раньше жёстко `[]`, из-за чего noop терял переданные-но-не-записанные поля).
- `src/agent/repeat-tracker.ts` — удалён мёртвый разбор `parsed.next?.x` в `parsedAckNext` и `parsedErrorText`; рабочий `parsed.x` сохранён. Форма ответа не менялась — она и была плоской (`serializeAck` разворачивает внутренний `next` в корень).
**Тесты:** новый `src/mcp/update-pipeline.test.mjs` (17 тестов) — таблица исходов, `skipped` у всех четырёх инструментов, инвариант «неполная сущность никогда не rejected», вызов без полей → noop, `append_notes` неидемпотентен, `backlog_update_status` в общем пайплайне. Обновлены осознанно (изменение контракта по плану): `write-ack.test.mjs` (4 теста «вызов без полей → отказ» стали noop + missing; «только неизвестные поля» → noop + skipped), `write-ack-contract.test.mjs` (`backlog_update_task` убран из `PARTIAL_EXEMPT`, добавлен в `PARTIAL_SCENARIOS` с ожиданием `partial` + `missing[0].field === 'description'`; VL-319 AC3 → noop), `lesson-tools.test.mjs`, `documents.test.mjs`, `reference-tools.test.mjs`, `v11.test.mjs` (без полей → noop), `tool-outcome-trace.test.mjs` (имя теста VL-319 в матрице), `repeat-tracker-vl357.test.mjs` (плоская форма вместо несуществующей вложенной).
**Проверки:**
- `pnpm test` — полный прогон, без `--exclude`/`--skip`: **196 файлов passed, 3682 теста passed, 4 skipped** (предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`, к задаче не относятся), плюс отдельный прогон `web` (1 файл, 8 тестов) — passed. Код выхода 0.
- `npx tsc --noEmit` — чисто.
- `grep -rn "Object.keys(updates).every|missingTaskFields|parsed.next?\." src/` — только комментарии-описания удалённого и одна легитимная `sameFieldsUpToDate` в `tool-result.ts` (сама общая реализация, которая и должна содержать этот цикл).
**Что осталось (не входит в Code):** документация (doc-8 контракт write-инструментов, doc-10 §6, CHANGELOG) — по регламенту её пишет Фаза Close после слияния. Наблюдаемое поведение сохранено: `linked_tasks` пишется в файл (тест `write-ack.test.mjs` VL-355 AC1/AC4 без изменений), `append_notes` дописывает, noop не переписывает файл и не сдвигает `updated_date`.
---
author: @agent
created: 2026-11-08 09:56
---
Фаза 3 (Code) выполнена. Коммит 60c234e (плюс wip-коммит fbe9c81 после обрыва рана по max-requests).
**Изменено:**
- `src/mcp/update-pipeline.ts` (новый, 258 строк) — `EntitySpec` + `runUpdate(spec, args, cwd)`. Шесть шагов: id → чтение → сборка полей → `skipped` → `beforeWrite` → сверка «уже так» → запись → сериализация. Таблица исходов «записали × сущность полная»: applied / partial / noop / noop+missing / rejected. `null` отсекается до записи. `nonIdempotent` отключает noop-сверку, `build(args, cwd, current)` получает текущее состояние.
- `src/mcp/tools.ts` — пять инструментов сведены к декларациям: `taskSpec`, `statusSpec`, `documentSpec`, `referenceSpec`, `lessonSpec`. Удалены `missingTaskFields`, две ручные копии сверки `every(sameValue)`, ~8 копий сборки `applied`, четыре ветки `toolLessonUpdate` (~160 строк).
- `src/mcp/tool-result.ts` — `ackNoopDetailed` принимает `skipped`.
- `src/agent/repeat-tracker.ts` — удалён мёртвый разбор `parsed.next?.x`; рабочий `parsed.x` сохранён, форма ответа плоская и не менялась.
**Тесты:** новый `src/mcp/update-pipeline.test.mjs` (17 тестов) — таблица исходов, `skipped` у всех четырёх инструментов, инвариант «неполная сущность никогда не rejected», вызов без полей → noop, `append_notes` неидемпотентен. Обновлены осознанно: `write-ack`, `write-ack-contract` (`backlog_update_task` в `PARTIAL_SCENARIOS`), `lesson-tools`, `documents`, `reference-tools`, `v11`, `tool-outcome-trace`, `repeat-tracker-vl357`.
**Проверки:** `pnpm test` — полный прогон без `--exclude`: 196 файлов passed, 3682 теста passed, 4 skipped (предсуществующие `it.skip` в `frontmatter.test.mjs`), плюс web-прогон 8/8. `npx tsc --noEmit` чисто. Копий логики не осталось (grep-проверка).
**Осталось (Close):** документация doc-8, doc-10 §6, CHANGELOG. Наблюдаемое поведение сохранено: `linked_tasks` пишется в файл, `append_notes` дописывает, noop не переписывает файл.
**Примечание:** предыдущий вызов не применил статус — фаза в env определена как `plan` (последний запуск фазы), а переход `Planned + plan → Review` в workflow отсутствует. Передаю `phase: "code"` явно.
---
author: @agent
created: 2026-11-08 10:20
---
Фаза Close прервана: конфликт слияния vb/vl-369 → master (файл: `UU src/mcp/tool-outcome-trace.test.mjs`).
**Что произошло.** Ветка `vb/vl-369` (коммиты `fbe9c81` wip + `60c234e` feat) слита в master с `--no-ff`, merge остановился на конфликте содержимого в `src/mcp/tool-outcome-trace.test.mjs`. Конфликтный хунк один — таблица `TRACE`:
- HEAD (master): `'VL-303': ['P1']` … `'VL-356': ['P1','P4']` — короткий формат «ID → массив инвариантов P1..P5»;
- vb/vl-369: тот же набор ID, но расширенный формат «ID → массив пар `[путь тест-файла, имя it(...)]`» (машиночитаемая привязка инварианта к конкретному тесту, добавлены кейсы VL-369: `write-ack.test.mjs` «AC1: урок на скелете → noop + missing», VL-356 `lesson-tools`.
Это не текстовая мелочь: две ветки одновременно переписали структуру одной и той же таблицы (`master` — формат VL-371/соседней задачи, ветка — свой), и выбор формата определяет, что читает проверка трассируемости инцидентов. Разрешать это в фазе Close (где правка `src/` запрещена) нельзя — нужен осознанный выбор схемы + прогон `src/mcp/tool-outcome-trace.test.mjs`.
**Состояние репозитория (не откатывал, `git merge --abort` не выполнял по правилам).** Merge в процессе, `git diff --name-only --diff-filter=U` → `src/mcp/tool-outcome-trace.test.mjs`. Все остальные файлы ветки слиты без конфликтов (в индексе: `src/mcp/update-pipeline.ts`, `update-pipeline.test.mjs`, `tools.ts`, `tool-result.ts`, `repeat-tracker.ts`, тесты, `write-ack*`).
**Что нужно сделать, чтобы повторить Close:**
1. В главном репозитории разрешить конфликт в `src/mcp/tool-outcome-trace.test.mjs`: выбрать единый формат `TRACE`. Ожидаемо — расширенный формат ветки VL-369 (пары `[путь, имя теста]`), но проверить, какой формат ожидает сам файл ниже по коду (функция, обходящая `TRACE`) и соседние задачи, которые его вводят; недостающие строки из HEAD-варианта (`P1..P5` для ID, которых нет в ветке) перенести.
2. `git add src/mcp/tool-outcome-trace.test.mjs` и `git commit --no-edit` (завершить начатый merge).
3. Прогнать `pnpm build && npx vitest run src/mcp/tool-outcome-trace.test.mjs` для проверки трассируемости, затем повторить Фазу Close (полный `pnpm test` уже на её шаге 4).
Кто: разрешение конфликта `src/` — фаза Code (или человек) в главном репозитории; Close только сливает и проверяет.
**Не выполнено (ожидаемо для аварийного итога):** шаги 4–11 — проверка после merge, уборка worktree `vl-369` и ветки `vb/vl-369`, DoD, lessons, refs, документация (doc-8, doc-10 §6, CHANGELOG), финальный статус. Задача остаётся в Review. Документация к задаче (doc-8/doc-10/CHANGELOG) по отчёту Фазы 3 также осталась незакрытой — она входит в шаг 9 и будет сделана при успешном повторе Close.
---
author: @agent
created: 2026-11-08 10:20
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-369 → master (файл: `UU src/mcp/tool-outcome-trace.test.mjs`).
**Что произошло.** Ветка `vb/vl-369` (коммиты `fbe9c81` wip + `60c234e` feat) слита в master с `--no-ff`, merge остановился на конфликте содержимого в `src/mcp/tool-outcome-trace.test.mjs`. Конфликтный хунк один — таблица `TRACE`:
- HEAD (master): `'VL-303': ['P1']` … `'VL-356': ['P1','P4']` — короткий формат «ID → массив инвариантов P1..P5»;
- vb/vl-369: тот же набор ID, но расширенный фо — статус возвращён к Review.
---
author: @agent
created: 2026-11-08 10:32
---
Фаза Close выполнена. Ветка `vb/vl-369` слита в master (2 коммита: `fbe9c81` wip + `60c234e` feat), merge-коммит `2b39575`, worktree `.vibelog/worktrees/vl-369` удалена, ветка `vb/vl-369` удалена.
**Конфликт merge (разрешён человеком до продолжения фазы).** Первый заход Close прервался на конфликте в `src/mcp/tool-outcome-trace.test.mjs` (таблица-реестр `TRACE`). Конфликт разрешён в формате HEAD — `'VL-303': ['P1']` (ID → массив свойств P1..P5), потому что код ниже в том же файле обходит `Object.values(TRACE).flat()` и проверяет `id in PROPERTIES`; расширенный формат ветки (пары `[файл, имя теста]`) дал бы `unknown` для каждого элемента. Проверено прогоном: `tool-outcome-trace.test.mjs` — 4 теста зелёные.
**Проверки после merge (diff затронул `src/`).**
- `pnpm build` — чисто (tsc без ошибок).
- Ранний точечный фильтр по diff: `update-pipeline`, `write-ack`, `write-ack-contract`, `lesson-tools`, `documents`, `reference-tools`, `v11`, `tool-outcome-trace`, `repeat-tracker-vl357` — 9 файлов, 186 тестов passed.
- **Полный `pnpm test`** (без `--exclude`/`--skip`): 198 файлов passed, 3698 тестов passed, 4 skipped (предсуществующие `it.skip` в `frontmatter.test.mjs`), плюс web-прогон 8/8. Повторных прогонов не было.
**Уборка.** `git worktree remove` отказал из-за untracked-симлинка `backlog/references/data` (его кладёт оркестратор, данные не теряются) — удалено с `--force`; `git branch -d vb/vl-369` прошёл (ветка считалась слитой).
**Lessons.** Создан `lesson-253` «При разрешении конфликта в тест-таблице-реестре выбирай формат, который читает код ниже в файле, а не «свою» версию ветки» (tags: git, merge, tests, close; `linked_tasks: [VL-369]`, `verified_by: agent`), связан с задачей. Коммит `5699722`.
**Документация (закрыт долг Фазы 3).** Коммит `3ec9291`:
- `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` — новый раздел «Единый пайплайн обновления сущностей (VL-369)»: `EntitySpec` + `runUpdate`, таблица исходов «записали × сущность полная», инвариант «write-инструмент не отказывает из-за неполноты», `skipped` у всех четырёх инструментов, `missing` от состояния, вызов без полей → `noop`, `append_notes` неидемпотентен, границы (milestone/ac/dod/link/git_commit не переведены); исправлено устаревшее утверждение «поля переехали внутрь `next`» → зафиксирована **плоская** форма ответа; убрано упоминание `missingTaskFields` (заменено на `spec.suggest`).
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` §6 — новый пункт «Класс «форма ответа вместо следующий шаг» закрыт единым пайплайном обновления (VL-369)»: разбор четырёх веток `toolLessonUpdate`, корневая ошибка (форма ответа вместо следующего шага), инвариант, таблица исходов, побочно закрытые дыры (`skipped`, `missing` от состояния, вызов без полей), плоская форма ответа, границы.
- `CHANGELOG.md` — запись в `[Unreleased]` → «Изменено (ломающие изменения)».
**DoD:** 1. Тесты проходят — да (полный прогон 3698 passed, 4 предсуществующих skip). 2. Документация обновлена — да (doc-8, doc-10 §6, CHANGELOG). 3. Нет регрессий — да (полный прогон зелёный после merge; наблюдаемое поведение сохранено: `linked_tasks` пишется в файл, `append_notes` дописывает, noop не переписывает файл).
**Примечание.** Файл задачи в главном репо не коммитил — его коммитит framework после записи `token_usage` рана. Подзадач у VL-369 нет.
---
<!-- COMMENTS:END -->