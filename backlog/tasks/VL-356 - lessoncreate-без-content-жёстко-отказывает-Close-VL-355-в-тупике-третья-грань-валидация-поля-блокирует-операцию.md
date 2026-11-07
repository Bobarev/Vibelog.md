---
id: VL-356
title: 'lesson_create без content жёстко отказывает — Close VL-355 в тупике (третья грань: валидация поля блокирует операцию)'
status: Review
assignee: []
reporter: ''
created_date: '2026-11-07 15:38'
updated_date: '2026-11-07 15:50'
due_date: ''
labels:
  - mcp
  - lessons
  - regression
  - bug
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
  - src/mcp/tools.ts
  - src/core/lesson.ts
  - src/mcp/lesson-tools.test.mjs
  - src/agent/loop.test.mjs
lessons: []
token_usage:
  input: 3102731
  output: 12290
  cache: 3015680
  total: 3115021
  requests: 57
  duration_ms: 444346
  reasoning: 2501
  by_phase:
    code:
      input: 2365214
      output: 9910
      cache: 2301440
      requests: 38
    close:
      input: 737517
      output: 2380
      cache: 714240
      requests: 19
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Close VL-355 упал кодом 1 (сессия `agent-1794054631174`): модель 6 раз дословно повторила `lesson_create` и умерла по `MAX_ERROR_REPEATS_PER_RUN`.

```
assistant: «Продолжаю с шага 7.5 — создаю урок с обязательным телом.»
lesson_create {title:"Не блокируй частичное обновление валидацией одного поля…"}   ← без content
→ {"ok":false,"error":"Урок без тела не создаётся…","missing":[…],"hint":"Добавь content…"}
× 6 → fail
```

Модель сама написала «создаю урок с обязательным телом» — и не передала `content`. Дальше тупик: `lesson_create` жёстко отказывает, файл не создаётся, придумать markdown модель не может.

## Корень — решение VL-349

`src/mcp/tools.ts:2687`:

```ts
if (rawContent === undefined || String(rawContent).trim() === '') {
  return ackErrorDetailed('Урок без тела не создаётся…');   // файл НЕ создан
}
```

VL-349 заменил «молча подставить скелет» на «жёсткий отказ». Первое давало уроки-пустышки, второе даёт **замкнутый тупик**: урок не создан → привязать нечего → модель повторяет.

## Общая картина — три задачи подряд об одном

| Задача | Что блокировало | Итог |
|---|---|---|
| VL-349 | `lesson_update` без `content` на скелете → отказ | Close VL-346 упал |
| VL-355 | то же, но блокировало **все** поля | Close VL-346 упал снова |
| **эта** | `lesson_create` без `content` → отказ | Close VL-355 упал |

Все три — «валидация одного поля блокирует операцию целиком». VL-355 уже нашёл правильный ответ: **применить что можно, предупредить через `missing`/`hint`**. Здесь нужно то же самое.

## Решение

`lesson_create` без `content` создаёт урок со скелетом и отвечает `ackOkDetailed` с `missing: [{field:'content'}]` + `hint`. Урок существует → `lesson_link`/`lesson_update` работают → модель не в тупике. Скелет виден в `lesson_audit` (finding `empty_body`), поэтому «склад пустышек» остаётся контролируемым.

Это частичный откат решения VL-349 («урок с пустым телом больше не создаётся»), но осознанный: жёсткий отказ порождает петлю, а `missing`/`hint` + аудит дают тот же контроль без блокировки.

## Связанные задачи

VL-349 (ввёл жёсткий отказ — источник), VL-355 (тот же принцип для `lesson_update`), VL-319 (первая версия проверки), VL-351 (контракт ack).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `lesson_create` без `content` (или с пустым/пробельным) СОЗДАЁТ урок со скелетом `LESSON_BODY_SKELETON` и отвечает `ackOkDetailed`: `ok:true`, `applied` с фактическими значениями (id, title, status, длина тела), `missing: [{field:'content', reason:…}]`, `hint` с требованием заполнить тело
- [x] #2 Файл урока реально создаётся (проверяется чтением файла), `lesson_link`/`lesson_update` с `linkedTasks` на нём работают сразу
- [x] #3 Ответ содержит явный признак, что тело — заглушка: `message` упоминает «тело не заполнено (скелет)», чтобы модель не считала урок готовым
- [x] #4 `lesson_audit` finding `empty_body` по-прежнему ловит такие уроки (регресс VL-349 не ломается) — скелет виден в аудите
- [x] #5 Регресс-тест на сессию `agent-1794054631174`: `lesson_create {title:'…'}` без `content` → `ok:true`, файл создан, `missing` содержит `content`; повтор того же вызова НЕ даёт серию отказов (второй вызов создаёт второй урок либо отвечает осмысленно — зафиксировать поведение тестом)
- [x] #6 Существующий кейс VL-349 «MCP без content → ошибка» переписан на новый контракт (создание со скелетом + `missing`), CLI-путь не меняется
- [x] #7 `pnpm build && pnpm test` проходят без регрессий
- [ ] #8 Документация: doc-8 (поведение `lesson_create` без тела: создание со скелетом + `missing`/`hint`), doc-10 §6 (разбор инцидента `agent-1794054631174`, общий принцип «валидация поля не блокирует операцию»), CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `src/mcp/tools.ts` — `toolLessonCreate` (~:2687): отказ → создание со скелетом + `missing`.
- `src/mcp/tool-result.ts` — `ackOkDetailed` уже есть (VL-355), переиспользовать.
- Тесты: `src/mcp/lesson-tools.test.mjs`, `src/mcp/write-ack.test.mjs`, `src/agent/loop.test.mjs`.
- Документация: `backlog/docs/doc-8`, `backlog/docs/doc-10` §6, `CHANGELOG.md`.

## Шаг 1. `toolLessonCreate` — создавать со скелетом

`src/mcp/tools.ts:2687`. Заменить блок отказа:

```ts
const rawContent = args.content as string | undefined;
const bodyUnfilled = rawContent === undefined || String(rawContent).trim() === '';

// VL-356: жёсткий отказ (VL-349) замыкал петлю — урок не создан, привязать
// нечего, модель повторяла вызов до капа. Теперь урок создаётся со скелетом
// (createLessonFile подставляет LESSON_BODY_SKELETON), а про незаполненное
// тело сообщают missing/hint. Контроль «склада пустышек» — finding empty_body
// в lesson_audit, а не блокировка создания.
const lesson = createLessonFile(cwd, {
  title: args.title as string,
  tags: (args.tags as string[] | undefined) || [],
  source_tasks: (args.sourceTasks as string[] | undefined) || [],
  content: rawContent,
});
const entry = getLesson(cwd, lesson.id);
const applied = {
  id: lesson.id,
  title: lesson.title,
  status: lesson.status,
  content: entry ? entry.body.length : 0,
};
if (bodyUnfilled) {
  return ackOkDetailed(
    `Lesson ${lesson.id} создан: ${lesson.title} (${lesson.status}) — тело не заполнено (скелет)`,
    applied,
    [],
    {
      missing: [{ field: 'content', reason: 'content не передан — тело урока осталось скелетом' }],
      hint: 'Заполни тело: lesson_update {"id": "' + lesson.id + '", "content": "## Проблема\\n\\n…\\n\\n## Решение\\n\\n…\\n\\n## Пример\\n\\n…"}.',
    },
  );
}
return ackOk(`Lesson ${lesson.id} создан: ${lesson.title} (${lesson.status})`, applied);
```

`createLessonFile` уже подставляет `LESSON_BODY_SKELETON` при пустом `content` (`src/core/lesson.ts:375`) — менять ядро не нужно.

## Шаг 2. Тесты

`src/mcp/lesson-tools.test.mjs`:

- **регресс `agent-1794054631174`**: `lesson_create {title:'…'}` без `content` → `ok:true`, `missing` содержит `content`, `hint` непустой; **прочитать файл** — он создан, тело = скелет;
- `lesson_create` с `content` → `ok:true` без `missing` (регресс не задет);
- после создания без `content` сразу `lesson_link {lessonId, taskId}` → успех (тупика нет);
- существующий кейс VL-349 «MCP без content → ошибка» переписать на новый контракт.

`src/mcp/write-ack.test.mjs` — если там есть кейс VL-349 про `lesson_create`, привести к новому контракту.

`src/agent/loop.test.mjs`:

- регресс `agent-1794054631174`: заглушка `lesson_create` возвращает `ackOk` с `missing` → ран доходит до финального текста, нет 6 повторов.

## Шаг 3. Проверка и документация

- `pnpm build && pnpm test` — полный прогон.
- Ручная проверка: `lesson_create {title:'x'}` → файл создан, `lesson_audit` показывает `empty_body`.
- `backlog/docs/doc-8`: поведение `lesson_create` без тела — создание со скелетом + `missing`/`hint`; убрать формулировку «урок без тела не создаётся».
- `backlog/docs/doc-10` §6: разбор инцидента `agent-1794054631174` + общий принцип «валидация одного поля не блокирует операцию: применяй остальное, предупреждай через `missing`/`hint`».
- `CHANGELOG.md` → `## [Unreleased]` / «Исправлено».

## Риски

- **Частичный откат VL-349.** Уроки-скелеты снова могут появляться. Контроль — `lesson_audit` finding `empty_body` (VL-349 его добавил) + `missing`/`hint` в ответе. Зафиксировать в CHANGELOG как осознанное решение.
- **Модель может проигнорировать `missing`** и не заполнить тело. Приемлемо: урок существует, привязка работает, аудит покажет.
- **Повторный `lesson_create` с теми же аргументами создаст второй урок** (create не идемпотентен). Это не регресс — так было всегда; но в регресс-тесте зафиксировать поведение, чтобы не удивляться.
- **CLI-путь не трогать**: `vibelog lesson create` без `-d` уже даёт скелет, поведение не меняется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 15:47
---
Фаза 3 (Code) выполнена. Коммит 3afa8e3.
**Изменено:**
- `src/mcp/tools.ts` (`toolLessonCreate`): жёсткий отказ VL-349 заменён на создание урока со скелетом + `ackOkDetailed`. `bodyUnfilled` вычисляется до вызова `createLessonFile` (ядро само подставляет `LESSON_BODY_SKELETON`), ответ несёт `applied` с фактическими значениями (id, title, status, длина тела), `missing: [{field:'content', reason:'content не передан — тело урока осталось скелетом'}]` и `hint` с готовым `lesson_update`-вызовом. `message` содержит «тело не заполнено (скелет)» — модель не считает урок готовым. Ветка с `content` — прежний `ackOk` без `missing`/`hint`.
- `src/core/lesson.ts`: обновлён JSDoc `createLessonFile` (скелет — единственное поведение и для MCP-пути; контроль пустышек — finding `empty_body` в `lesson_audit`). Код ядра не менялся.
- `src/mcp/lesson-tools.test.mjs`: кейс VL-349 «MCP без content → ошибка» переписан на новый контракт — `ok:true`, `missing[0].field==='content'`, непустой `hint`, `message` про скелет, `applied` с фактическими значениями; файл реально создан (проверка `lesson_list` + чтение файла: тело = `LESSON_BODY_SKELETON`); сразу после создания без `content` `lesson_link` к задаче проходит и `linked_tasks` записан; повтор того же вызова создаёт ВТОРОЙ урок (create не идемпотентен — поведение зафиксировано тестом), но не даёт серии отказов; CLI/ядро-путь по-прежнему даёт скелет. Добавлен кейс «create с content → ok:true без missing/hint».
- `src/agent/loop.test.mjs`: регресс `agent-1794054631174` — заглушка `lesson_create` возвращает `ackOk` с `missing`; два дословных повтора не упираются в кап, ран доходит до финального текста, первый tool-результат — успех (`"ok":true` + `missing`), отказа нет.
**Проверки:** `pnpm build` — успешно; полный `pnpm test` — 3496 passed, 4 skipped (все 4 — `src/core/compat.test.mjs`/`compat-full.test.mjs`, скипаются автоматически при отсутствии оригинала Backlog.md, к задаче не относятся), регрессий нет. Целевой прогон затронутых файлов (`lesson-tools`, `write-ack`, `write-ack-contract`, `loop`) — 194 passed.
**Что осталось (Фаза Close):** AC8 — документация (doc-8: поведение `lesson_create` без тела; doc-10 §6: разбор инцидента `agent-1794054631174` и общий принцип «валидация одного поля не блокирует операцию»; CHANGELOG `## [Unreleased]` / «Исправлено» с фиксацией осознанного частичного отката VL-349). В Фазе 3 документы backlog/ и CHANGELOG по регламенту не правятся. Ручная проверка `lesson_audit` finding `empty_body` на созданном скелете покрыта существующим тестом `src/core/lesson-audit.test.mjs` (VL-349) — предикат `isLessonBodyUnfilled` не менялся.
---
author: @agent
created: 2026-11-07 15:50
---
Фаза close не удалась (код выхода 1): ет, блокировок=0, payload последнего запроса=179478 байт (макс 179478), usage={"input_tokens":737517,"output_tokens":2380,"cache_read_input_tokens":714240,"total_tokens":739897,"reasoning_tokens":725} — статус возвращён к Review.
---
<!-- COMMENTS:END -->