---
id: VL-379
title: 'lesson_create/lesson_update: заменить content на problem/solution/example (в required) — markdown-тело больше не генерирует модель, урок-скелет исчезает как класс'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-08 17:55'
updated_date: '2026-11-08 18:20'
due_date: ''
labels: []
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
  - src/mcp/update-pipeline.ts
  - src/mcp/lesson-tools.test.mjs
  - src/mcp/write-ack.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/mcp/update-pipeline.test.mjs
  - src/web/phase-prompt.test.mjs
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - templates/phases/phase-code.md
lessons:
  - lesson-258
token_usage:
  input: 18535538
  output: 100392
  cache: 16512512
  total: 18635930
  requests: 184
  duration_ms: 1257511
  reasoning: 44223
  by_phase:
    plan:
      input: 3099086
      output: 28077
      cache: 2598912
      requests: 36
    code:
      input: 13285767
      output: 60657
      cache: 12113408
      requests: 110
    close:
      input: 2150685
      output: 11658
      cache: 1800192
      requests: 38
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст — четвёртый рецидив одного места

Close VL-377 упал кодом 1 (сессия `agent-1794146250210`, 30 запросов). Траектория по транскрипту:

```
lesson_update {id: lesson-256, linkedTasks:[VL-377], tags:[...], verifiedBy:"agent"}   ← БЕЗ content
→ ok:true, outcome:partial, missing:[content], hint:"Заполни тело урока…", retryWith:{content:"## Проблема…"}

× 4 дословных повтора ТЕХ ЖЕ аргументов
→ каждая: "Вызов уже применён ранее — повтор НЕ выполнен"
→ appliedRepeatCount > MAX_APPLIED_REPEATS_PER_RUN → fail()
```

Модель при этом писала: **«Нужно передать параметр `content`»** — и снова отправляла вызов без него. Работа фазы (merge, build, тесты, уборка worktree) была выполнена полностью.

## Корень: модель не может сгенерировать markdown внутри JSON

`content` — одна большая строка с literal `\n` и заголовками `##`:

```json
{"content": "## Проблема\n\n<что было не так>\n\n## Решение\n\n<что сделали>\n\n## Пример\n\n<конкретный пример>"}
```

Слабая модель на этом спотыкается. В транскрипте видно: намерение сформулировано, а в JSON поле не вставлено. Это **не** «не поняла требование» — это неспособность сгенерировать экранированный markdown в аргументе. Все предыдущие фиксы (VL-319 → 349 → 355 → 356 → 362 → 364) правили формулировки, `missing`, `hint`, `retryWith` и образец в промпте — но **форма аргумента оставалась прежней**.

### Почему задача не попадает в эту ловушку

`backlog_create_task` тоже генерирует текст (`description`), но у него **content не является обязательным** и не подставляется заглушкой. Разница принципиальная:

| | `backlog_create_task` без `description` | `lesson_create` без `content` |
|---|---|---|
| Что происходит | задача создаётся, описание пустое | урок создаётся со **скелетом** `## Проблема\n\n## Решение\n\n## Пример` |
| Как выглядит | честно пустое поле | **непустой текст**, похожий на заполненный |
| Что дальше | модель/человек видит пробел | модель пытается «дозаполнить» тем же способом, каким создала |

Подстановка `LESSON_BODY_SKELETON` (VL-356) создала сущность, которую **невозможно дозаполнить**: чтобы дописать тело, нужен `content`; чтобы сформировать `content`, нужен текст урока.

## Решение: три поля вместо одной строки

```ts
// lesson_create
properties: { title, tags, sourceTasks, problem, solution, example }
required: ['title', 'problem', 'solution']

// lesson_update
properties: { id, title, status, tags, sourceTasks, linkedTasks, supersedes,
              lastVerified, verifiedBy, appliesTo, kind, problem, solution, example }
required: ['id']
```

- `example` **опционален**: не для каждого урока есть пример, требование заставило бы выдумывать.
- `lesson_update` с `problem`/`solution` — **полная замена тела** (семантика прежнего `content` сохраняется, меняется только форма передачи).
- Сервер склеивает:

```ts
const content = [
  '## Проблема', problem, '',
  '## Решение', solution, '',
  ...(example ? ['## Пример', example] : []),
].join('\n');
```

- **`content` удаляется** из обоих инструментов, не остаётся рядом. Два способа передать одно и то же — тот же класс «двойная форма», который вычищался в VL-369 (`next.*` и поля в корне): модель выберет худший, как выбирала `content` все шесть предыдущих раз.

## Что закрывается окончательно

1. **Скелет исчезает как класс.** `problem`/`solution` в `required` → урок без тела создать нельзя **на уровне схемы MCP**: сервер не примет вызов. `LESSON_BODY_SKELETON` остаётся только в CLI (`vibelog lesson create` без `-d`), где сидит живой человек и может сохранить черновик.
2. **Маркдаун больше не генерирует модель.** Ни `\n`, ни `##` — три обычные строки.
3. **`isLessonBodyUnfilled` нужен только для накопленных скелетов.** Новые неполными быть не могут по конструкции. Старые — разовая уборка (`lesson_audit` finding `empty_body` + `lesson_update` с частями).
4. **`missing: content` и `retryWith.content` для уроков больше не возникают** — упрощается `lessonSpec.completeness`, `next`, `beforeWrite`.

## Атомарность правки (критично)

Изменение затрагивает инструменты **и** шаблоны фаз. Шаблоны должны перейти на новую форму **в том же коммите**, иначе Close передаст несуществующий `content` и упадёт:

- `templates/phases/phase-close-worktree.md:48` — образец `lesson_update` с `content`
- `templates/phases/phase-close-worktree.md:52` — образец `lesson_create` с `content`
- `templates/phases/phase-close-worktree.md:53` — правило «следующий вызов ОБЯЗАН нести content»
- `templates/phases/phase-close.md:54-55` — оба образца
- `templates/phases/phase-code.md:41` — образец `lesson_create`

## Точки правки в коде

1. `src/mcp/tools.ts:634-638` — схема `lesson_create`: `problem`/`solution`/`example` в `properties`, `problem`+`solution` в `required`, `content` убрать.
2. `src/mcp/tools.ts:~655` — схема `lesson_update`: те же три поля, `content` убрать.
3. `src/mcp/tools.ts:2874` (`toolLessonCreate`) — склейка из частей; `bodyUnfilled` по отсутствию `problem`/`solution` (но при `required` эта ветка недостижима для MCP — оставить как защиту).
4. `src/mcp/tools.ts:2958` (`lessonSpec`) — `build`: склейка `problem`/`solution`/`example` в `content`; `fields` обновить; `completeness`/`next`/`beforeWrite` упростить.
5. `src/core/lesson.ts` — не меняется (принимает готовый `content`).
6. `src/cli/commands/lesson.ts:117` — CLI сохраняет флаг `-d content` (человеческий путь, скелет допустим).

## Связанные задачи

- **VL-319, VL-349, VL-355, VL-356, VL-362, VL-364** — предыдущие попытки лечить симптом (формулировки, `missing`, `hint`, `retryWith`, образец в промпте). Все правки формы ответа; форма аргумента не менялась.
- **VL-377** — задача, чей Close упал на этом дефекте. Вернуть в Review и перезапустить после реализации.
- **VL-369** — её урок про «двойную форму» (`next.*` и поля в корне) — обоснование, почему `content` не оставляем для совместимости.

## Риск

1. **Атомарность инструменты+шаблоны** — см. выше, требуют одного коммита.
2. **Нарушение внешних потребителей** — нет: MCP-инструменты не публичный API, все вызывающие внутри проекта.
3. **Модель передаст `content` по привычке** — попадёт в `skipped` с причиной «поле удалено, используй problem/solution», а не молча проигнорируется (механизм `unknownFields` в пайплайне VL-369 уже есть).
4. **Накопленные уроки-скелеты** остаются неполными — не блокер: `lesson_audit` их перечисляет, `lesson_update {problem, solution}` дозаполняет. Отдельная разовая уборка, не часть этой задачи.

## Не проверено (предположения)

1. **Точное число уроков-скелетов в `backlog/lessons/`** — оценить `lesson_audit` прогоном; от этого зависит объём разовой уборки (вне объёма).
2. **Поведение конкретной модели (qwen) с тремя строковыми полями** — принимается по аналогии с `backlog_create_task` (там `title`/`description` работают); проверить первым боевым Close после релиза.
3. **Влияние на `lesson_classify`/`lesson_audit`** — они читают готовое тело, форма аргумента их не касается; проверить, что тесты зелены.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `lesson_create`: в схеме `problem`/`solution`/`example` вместо `content`; `problem` и `solution` в `required` (урок без тела невозможно создать на уровне схемы MCP); `example` опционален
- [x] #2 `lesson_update`: те же три поля вместо `content`; передача `problem`/`solution` — полная замена тела (семантика прежнего `content` сохранена); `content` из схемы удалён
- [x] #3 Сервер склеивает тело из частей с заголовками «## Проблема / ## Решение / ## Пример»; пример опускается, если не передан; проверено тестом на файле урока (тело читается, структура корректна)
- [x] #4 `content` рядом с `problem`/`solution` НЕ оставлен: передача `content` попадает в `skipped` с причиной «поле удалено, используй problem/solution», а не молча игнорируется
- [x] #5 Все шаблоны фаз переведены на новую форму в ТОМ ЖЕ коммите: `phase-close-worktree.md:48,52,53`, `phase-close.md:54-55`, `phase-code.md:41`; ни один шаблон не передаёт `content` (закреплено тестом-инвариантом в `phase-prompt.test.mjs`)
- [x] #6 MCP-путь больше не создаёт урок-скелет: `LESSON_BODY_SKELETON` остаётся только в CLI (`vibelog lesson create` без `-d`); `lessonSpec.completeness`/`next`/`beforeWrite` упрощены — `missing: content` для новых уроков не возникает
- [x] #7 Регресс сессии `agent-1794146250210`: сценарий «урок создан без тела → `lesson_update` без content» невозможен по конструкции — `lesson_create` без `problem`/`solution` отклоняется валидацией схемы; проверено тестом MCP-вызова
- [x] #8 `pnpm build && pnpm test` зелёный; `lesson_audit`/`lesson_classify` работают с готовым телом без изменений
- [x] #9 Документация обновлена: doc-8 (новые поля `lesson_create`/`lesson_update`), doc-10 §6 (разбор: форма аргумента, а не формулировка), CHANGELOG.md
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

Заменить у `lesson_create`/`lesson_update` единственный аргумент-тело `content` (большой экранированный markdown) на три обычные строки `problem`/`solution`/`example`. Склейка в markdown — на сервере. `content` удаляется из схем и из спеки сущности (не остаётся «для совместимости» — иначе модель снова выберет худшую форму, ср. VL-369 про «двойную форму»). Шаблоны фаз переходят на новую форму в ТОМ ЖЕ коммите.

Ключевой факт, определяющий архитектуру: `inputSchema.required` — это НЕ серверная валидация. `src/mcp/server.ts` (`handleToolsCall`) вызывает `handleToolCall` без проверки схемы; `validateArgs` (`src/agent/tools.ts:321`) применяется только к локальным инструментам агента, а MCP-инструменты идут через `toolsAsSpecs` → `client.callTool` (`src/agent/mcp-client.ts:300-315`) без валидации. Значит `required` влияет только на генерацию аргументов моделью, а серверная защита реализуется в `toolLessonCreate` (отказ `ackErrorDetailed` при отсутствии `problem`/`solution`).

## Файлы и порядок правок

### 1. `src/mcp/tools.ts` — схемы (одним куском, чтобы коммит был атомарным)

- `:625-638` (`lesson_create`): в `properties` добавить `problem` (string, «Что было не так — текст без markdown-разметки»), `solution` (string, «Что сделали»), `example` (string, «Конкретный пример (необязателен)»); строку `content` (`:634`) удалить. `required: ['title']` (`:635`) → `required: ['title', 'problem', 'solution']`.
- `:650-668` (`lesson_update`): удалить `content` (`:663`), добавить те же три поля; `required: ['id']` оставить. `description` инструмента дополнить: «`problem`+`solution` — полная замена тела урока».
- Обновить `description` у `lesson_create` (`:626`): урок без тела создать нельзя — `problem`/`solution` обязательны.

### 2. `src/mcp/tools.ts` — создание урока (`toolLessonCreate`, `:2874-2907`)

- Убрать чтение `args.content`; собрать тело хелпером (см. п.3) из `args.problem/args.solution/args.example`.
- Серверная защита (AC7): если `problem` или `solution` не переданы ИЛИ после `trim()` пусты — вернуть `ackErrorDetailed` (исход rejected) с `missing: [{field:'problem', reason:'тело урока не может быть пустым'}]`, `hint` и `retryWith: {problem: '<что было не так>', solution: '<что сделали>', example: '<конкретный пример>'}`; файл НЕ создаётся. Урок-скелета MCP-путь больше не порождает (AC6).
- `bodyUnfilled`-ветка (`:2891-2902`) удаляется: при `required` она недостижима, а отказ выше её заменяет.
- `skipped`: считать `unknownFields(args, LESSON_CREATE_FIELDS)`, где новая константа `LESSON_CREATE_FIELDS = ['title','status','tags','sourceTasks','problem','solution','example','idempotencyKey']`; переданный `content` попадёт туда с причиной «поле удалено, используй problem/solution» (см. п.4). Отдать `skipped` в `ackOk`.
- Комментарий VL-356 (`:2875-2885`) переписать: скелет остаётся только у CLI-пути.

### 3. Новый хелпер склейки (рядом с `LESSON_BODY_TEMPLATE`, `:2935`)

```ts
function lessonBodyFromParts(problem: string, solution: string, example?: string): string {
  return [
    '## Проблема', String(problem).trim(), '',
    '## Решение', String(solution).trim(), '',
    ...(example !== undefined && String(example).trim() !== ''
      ? ['## Пример', String(example).trim()] : []),
  ].join('\n');
}
```
`LESSON_BODY_TEMPLATE`/`LESSON_BODY_HINT` (`:2935-2941`) переписать под три поля: каркас `retryWith` теперь `{problem: '<что было не так>', solution: '<что сделали>', example: '<конкретный пример>'}` (AC: «`##`/`\n` в аргументах больше нет»).

### 4. `EntitySpec` — причина для удалённого поля (`src/mcp/update-pipeline.ts`)

- В интерфейс `EntitySpec` (`:70-160`) добавить необязательный хук:
  `removedFields?: Record<string, string>` — «имя аргумента → причина, по которой он больше не принимается».
- В `collectSkipped` (`:279-292`) при обходе `unknownFields` подменять `reason` из `spec.removedFields[field]`, если он есть. Это точечная правка (~4 строки), поведение остальных сущностей не меняется.
- `src/mcp/tool-result.ts` не меняется: `skipped` уже сериализуется (`serializeAck`, `:112+`).

### 5. `src/mcp/tools.ts` — `lessonSpec` (`:2958-3046`)

- `fields` (`:2964-2968`): убрать `'content'`, добавить `'problem','solution','example'`.
- `removedFields: { content: 'поле удалено: передай problem и solution (markdown-тело сервер склеит сам)' }` (AC4).
- `bodyArg: 'content'` СОХРАНИТЬ: в ядре тело по-прежнему называется `content` (`UpdateLessonInput`), и на этом держится `comparableKey` → `BODY_FIELD` (`update-pipeline.ts:158-161`), то есть noop-сверка тела продолжает работать.
- `build` (`:2973-2987`): вместо `if (args.content !== undefined)` — если переданы `problem`/`solution`, положить `updates.content = lessonBodyFromParts(...)`; `example` учитывается только вместе с ними.
- `beforeWrite` (`:3036-3046`) переписать: испорченный аргумент — передан только один из `problem`/`solution` (или `example` без них), либо любой из них после `trim()` пуст → rejected с `hint`/`retryWith` (каркас из п.3). Это замена прежней проверки «пустой `content`».
- `completeness` (`:3005-3017`): predicate `isLessonBodyUnfilled(entity.body)` СОХРАНИТЬ, но поле в `missing` теперь `problem` (не `content`) с reason «тело урока не заполнено (пустое или дефолтный скелет) — передай problem и solution». Смысл: новые уроки неполными быть не могут по конструкции, predicate нужен только для накопленных скелетов (AC6); `getCompletenessFields(..., 'lesson')` продолжает читать `DEFAULT_COMPLETENESS` с полем `content` (`src/core/workflow.ts:99-111`), поэтому сопоставление «`content` из настроек → пара `problem`/`solution`» делается в `lessonSpec.completeness` (одно место), `workflow.ts` не трогаем.
- `next` (`:3021`): `hint` + `retryWith` с тремя строками (см. п.3).
- `noopHint` (`:3023-3026`) и `message` (`:3027-3033`): в тексте «передай problem и solution» вместо `content`.
- `applied` (`:2990-3000`): ключи `problem`/`solution`/`example` не существуют в `Lesson` → для них возвращать `content: String(entity.body).length` под общим ключом `content` (одна длина тела на вызов, без дублей), остальные ключи — как сейчас.

### 6. `src/core/lesson.ts` — НЕ меняется

`createLessonFile` по-прежнему подставляет `LESSON_BODY_SKELETON` при пустом `content` (`:352, :399`) — это CLI-путь (`src/cli/commands/lesson.ts:117`), где сидит человек. `isLessonBodyUnfilled` (`:368`) остаётся (нужен `lesson_audit` `src/core/lesson-audit.ts:328`) — здесь не трогаем.

### 7. Шаблоны фаз (в том же коммите, AC5)

- `templates/phases/phase-close-worktree.md:48` — образец `lesson_update`: `{"id": "lesson-N", "linkedTasks": [...], "problem": "<что было не так>", "solution": "<что сделали>", "example": "<конкретный пример>"}`.
- `:50` — правило про «`content` — ПОЛНАЯ замена тела» переписать: «`problem`+`solution` — ПОЛНАЯ замена тела; `example` необязателен».
- `:52` — создание: `lesson_create {"title", "tags", "sourceTasks": ["{{taskId}}"], "problem", "solution", "example"}`; убрать «`content` ОБЯЗАТЕЛЕН» → «`problem`/`solution` ОБЯЗАТЕЛЬНЫ: урок без тела создать нельзя».
- `:53` — правило по ответу: `partial` (`missing: [{field: 'problem'}]`) → следующий вызов ОБЯЗАН нести `problem`+`solution`; `retryWith` несёт три поля со плейсхолдерами.
- `templates/phases/phase-close.md:54-55` — оба образца аналогично.
- `templates/phases/phase-code.md:41` — образец `lesson_create` аналогично.
- Ни один шаблон не должен передавать `content` уроку (в `document_create` в `phase-investigate.md:34` `content` остаётся — это документ, не урок).

### 8. Тесты (правка существующих + новые)

- `src/web/phase-prompt.test.mjs:1183-1206` (блок VL-319) — переписать: каждый `lesson_create` в `templates/phases/*.md` передаёт `"problem"` и `"solution"`; Close-шаблоны тоже. Добавить инвариант AC5: ни один `lesson_create`/`lesson_update` в шаблонах не содержит `"content"` (это и есть тест-сторож формы аргумента).
- `src/web/phase-prompt.test.mjs:1365-1380` (блок VL-364) — образец `lesson_update` содержит `problem`/`solution`, не содержит `content`.
- `src/mcp/lesson-tools.test.mjs`: `:54-60`, `:67`, `:75`, `:155`, `:200-201` — `content` → `problem`/`solution`; кейс `:107-150` («create без content → скелет») заменить на AC7: `lesson_create {title}` → `ok:false` с `missing[0].field === 'problem'`, файл урока НЕ создан (`list` не вырос). Добавить AC3-кейс: `lesson_create`/`lesson_update` с частями → `lesson_view.body` содержит `## Проблема`/`## Решение`/`## Пример` (и что пример опускается, если не передан). Добавить AC4-кейс: `lesson_update {id, content: '...'}` → `skipped` содержит `content` с причиной «поле удалено».
- `src/mcp/write-ack.test.mjs`: `:300-304` (пустой `content` → отказ), `:308-320`, `:326-360`, `:370-400`, `:405-460`, `:463-...` — все ожидания `missing[0].field === 'content'` → `'problem'`; заполнение тела — через `problem`/`solution`; `applied.content` (длина тела) сохраняется как контракт ответа.
- `src/mcp/write-ack-contract.test.mjs:277` — фабрика `lesson_create` передаёт `problem`/`solution` вместо `content`.
- `src/mcp/update-pipeline.test.mjs` — фикстуры создают уроки через `createLessonFile` (ядро, `content` остаётся) — правки не нужны; проверить прогоном.
- `src/agent/loop.test.mjs`, `loop-properties.test.mjs`, `loop-repeat-cap.test.mjs`, `repeat-tracker*` — заглушки инструментов, схемы из `dist/mcp/tools.ts`; правок не требуют, проверить прогоном.

### 9. Документация (AC9)

- doc-8 (`backlog/docs/doc-8-MCP-справочник-Vibelogmd.md`, таблицы `lesson_create` ~`:521` и `lesson_update`, абзац `:540` про незаполненное тело) — обновить через `document_update` (MCP пишет в главный репо; `backlog/` Code-фаза не коммитит).
- doc-10 §6 (`:433-437`) — добавить разбор: дефект был в ФОРМЕ аргумента (markdown внутри JSON), а не в формулировке; все фиксы VL-319→364 правили форму ответа.
- `CHANGELOG.md` — запись в Unreleased (коммитится Code-фазой, файл в корне репо).

## Порядок действий

1. `src/mcp/update-pipeline.ts` — хук `removedFields` + `collectSkipped`.
2. `src/mcp/tools.ts` — хелпер `lessonBodyFromParts`, схемы обоих инструментов, `toolLessonCreate`, `lessonSpec` (одним проходом).
3. Шаблоны фаз (5 мест) — сразу же, иначе Close начнёт передавать несуществующий `content`.
4. Тесты (п.8), начиная с `phase-prompt.test.mjs` (сторож шаблонов) и `lesson-tools.test.mjs`.
5. `pnpm build` → точечный прогон: `node_modules/.bin/vitest run src/mcp/lesson-tools.test.mjs src/mcp/write-ack.test.mjs src/mcp/write-ack-contract.test.mjs src/web/phase-prompt.test.mjs` → полный `pnpm test`.
6. Документация (doc-8, doc-10 через MCP; CHANGELOG) и коммит: код+шаблоны+тесты одним коммитом `feat: VL-379 — lesson_create/lesson_update: problem/solution/example вместо content`.

## Как проверить

```
pnpm build && node_modules/.bin/vitest run src/mcp/lesson-tools.test.mjs src/mcp/write-ack.test.mjs src/web/phase-prompt.test.mjs
pnpm test    # полный прогон обязателен (DoD «Тесты проходят»)
```
Ручные проверки после сборки: `grep -rn 'lesson_create\|lesson_update' templates/phases/` — ни одного `content`; `node -e` по `dist/mcp/tools.js` — `listTools().find(t=>t.name==='lesson_create').inputSchema.required` = `['title','problem','solution']`, в `properties` нет `content`.

## Риски

1. **Атомарность инструменты+шаблоны.** Шаблоны должны перейти на новую форму в том же коммите; иначе Close передаст `content` и получит `skipped` → урок без тела → прежний класс падений. Смягчение: тест-сторож в `phase-prompt.test.mjs` в том же коммите.
2. **Старые уроки-скелеты.** Их тело по-прежнему `isLessonBodyUnfilled` → `partial` с `missing: [{field:'problem'}]`; дозаполняются `lesson_update {problem, solution}`. Разовая уборка — вне объёма задачи.
3. **`missing[].field` меняет имя `content` → `problem`.** Это ломает текстовые ожидания в нескольких тестах (`write-ack.test.mjs`, `lesson-tools.test.mjs`) и, возможно, эвристики `repeat-tracker`/`loop` по полю. Проверять полным прогоном; при падении — искать сравнения с литералом `'content'` в `src/agent/*.ts`.
4. **`applied.content` остаётся, но ключа `problem` в ответе нет.** Контракт ответа (`applied` = значения из сущности) сохраняется сворачиванием длины тела; смена имени ключа не нужна.
5. **Модель по привычке передаст `content`** — попадает в `skipped` с явной причиной (не молча) — механизм `unknownFields` уже есть.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `lesson_create`: `content` в `properties`, `required: ['title']` | `src/mcp/tools.ts:625-638` |
| `lesson_update`: `content` в `properties`, `required: ['id']` | `src/mcp/tools.ts:650-668` (`content` — `:663`) |
| `toolLessonCreate` читает `args.content`, при пустом создаёт скелет и отвечает `ackOkDetailed` с `missing: content` | `src/mcp/tools.ts:2874-2907` |
| `LESSON_BODY_TEMPLATE`/`LESSON_BODY_HINT` — каркас markdown в `retryWith.content` | `src/mcp/tools.ts:2935-2941` |
| `lessonSpec`: `fields` содержит `'content'`, `bodyArg: 'content'`, `completeness` по `isLessonBodyUnfilled`, `next` → `retryWith.content`, `beforeWrite` отклоняет пустой `content` | `src/mcp/tools.ts:2964-3046` |
| `runUpdate` применяет `build`→`updates`, дальше noop-сверка по `snapshot`/`comparableKey` | `src/mcp/update-pipeline.ts:180-260`, `:158-161` |
| `skipped` собирается `unknownFields(args, spec.fields)` + обработка `null` | `src/mcp/update-pipeline.ts:279-292` |
| `unknownFields` даёт общую причину «неизвестное поле инструмента: не записано» | `src/mcp/tool-result.ts:589-597` |
| `skipped` сериализуется в `serializeAck` и виден в любом исходе (включая noop) | `src/mcp/tool-result.ts:112-150`, `:255-300`, `:330-360` |
| MCP-сервер НЕ валидирует `inputSchema` при `tools/call` | `src/mcp/server.ts` (`handleToolsCall` → `handleToolCall` без проверки) |
| `validateArgs` существует, но применяется к локальным инструментам агента | `src/agent/tools.ts:321-349`; MCP-путь — `src/agent/mcp-client.ts:300-315` |
| `behavioral`: `createLessonFile` подставляет `LESSON_BODY_SKELETON` при пустом `content`; `isLessonBodyUnfilled` — предикат «скелет/пусто» | `src/core/lesson.ts:352, :368-372, :399` |
| CLI-путь создания урока с флагом `-d` (скелет допустим) | `src/cli/commands/lesson.ts:117` |
| `DEFAULT_COMPLETENESS` требует для урока поле `content` (`'*': {task:[…], lesson:['content']}`) | `src/core/workflow.ts:99-111` |
| `getCompletenessFields` читает правила по workflow/фазе | `src/core/workflow.ts:540-561` |
| `lesson_audit` использует `isLessonBodyUnfilled` для finding `empty_body` | `src/core/lesson-audit.ts:328` |
| Шаблоны: образцы с `content` в `lesson_update` (`:48`), `lesson_create` (`:52`), правило про следующий вызов (`:53`) | `templates/phases/phase-close-worktree.md:48-53` |
| Шаблоны: оба образца `lesson_create`/`lesson_update` с `content` | `templates/phases/phase-close.md:54-55` |
| Шаблоны: образец `lesson_create` с `content` | `templates/phases/phase-code.md:41` |
| Инвариант-тест сейчас ТРЕБУЕТ `content` в `lesson_create` шаблонов | `src/web/phase-prompt.test.mjs:1183-1206` |
| Инвариант-тест VL-364 требует `content` в образце `lesson_update` | `src/web/phase-prompt.test.mjs:1365-1380` |
| Тесты `lesson-tools` вызывают `lesson_create`/`lesson_update` с `content` и ждут скелет | `src/mcp/lesson-tools.test.mjs:54-60,67,75,107-150,155` |
| Тесты `write-ack` ждут `missing[0].field === 'content'` и `applied.content`-длину | `src/mcp/write-ack.test.mjs:300-320,326-360,405-460` |
| Контрактный тест создаёт урок через `lesson_create` с `content` | `src/mcp/write-ack-contract.test.mjs:277` |

## Не проверено (предположения)

1. **Нет ли в агенте эвристик, завязанных на литерал `content` в `missing`/`retryWith`.** Предполагается, что после переименования поля повторные директивы (applied/noop) работают как раньше. Проверить: `grep -n "retryWith" src/agent/repeat-tracker.ts src/agent/loop.ts`, `grep -n "'content'" src/agent/*.ts`. При находке — обобщить (читать поле из `missing[0].field`, а не литерал).
2. **`applied` с ключом `content` после удаления поля из `fields`.** Предполагается, что `runUpdate` не сверяет ключи `applied` со `spec.fields` (сверка идёт по `updates`/`snapshot`). Проверить: прогон `write-ack.test.mjs`; при падении — вернуть ключи частей тела в `applied` без сворачивания.
3. **`completeness` с переименованием поля.** Предполагается, что замену «`content` из `DEFAULT_COMPLETENESS` → `problem`/`solution` в `missing`» можно сделать целиком внутри `lessonSpec.completeness` без правки `workflow.ts`. Проверить: `src/mcp/write-ack.test.mjs` (VL-370 блок о неполноте) + `src/core/workflow.test.mjs`. Если `getCompletenessFields` окажется не единственным источником — править только спеку, `DEFAULT_COMPLETENESS` не трогать (это данные пользователя).
4. **Фактическое число уроков-скелетов в `backlog/lessons/`.** Предполагается, что их немного и они не блокируют тесты. Проверить: `node -e` вызов `lesson_audit {write:false}` или `grep -c` по маркеру скелета; на объём разовой уборки не влияет (вне объёма задачи).
5. **Поведение qwen с тремя строковыми полями.** Принято по аналогии с `backlog_create_task` (`title`/`description` работают). Проверить смоук-тестом схемы (`inputSchema.required` и `properties`) в тестах; боевая проверка — первый Close после релиза (вне объёма).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 18:04
---
Фаза 2 (Plan) выполнена. Тип: bug — план записан в задачу (Implementation Plan), код не правился.
Суть решения: у `lesson_create`/`lesson_update` аргумент-тело `content` (экранированный markdown) заменяется тремя строками `problem`/`solution`/`example`; склейка в `## Проблема / ## Решение / ## Пример` — на сервере; `content` удаляется из схем и из спеки (без «совместимого» дубля).
Файлы в плане (16): `src/mcp/tools.ts` (схемы :625-638/:650-668, `toolLessonCreate` :2874-2907, `lessonSpec` :2958-3046, новый хелпер склейки), `src/mcp/update-pipeline.ts` (хук `removedFields` для причины «поле удалено»), `templates/phases/phase-close-worktree.md:48,50,52,53`, `phase-close.md:54-55`, `phase-code.md:41`; тесты `src/web/phase-prompt.test.mjs:1183-1206,1365-1380`, `src/mcp/lesson-tools.test.mjs`, `src/mcp/write-ack.test.mjs`, `src/mcp/write-ack-contract.test.mjs`; документация doc-8, doc-10 §6, CHANGELOG (через MCP/document_update + коммит Code-фазы).
Проверено чтением (ключевое, влияет на архитектуру): `inputSchema.required` НЕ валидируется сервером — `src/mcp/server.ts::handleToolsCall` вызывает `handleToolCall` без проверки схемы, `validateArgs` (`src/agent/tools.ts:321`) применяется только к локальным инструментам, MCP-путь идёт через `toolsAsSpecs`/`callTool` (`src/agent/mcp-client.ts:300-315`). Значит AC «урок без тела невозможно создать» реализуется не только `required`, но и отказом в `toolLessonCreate` — это явно в плане.
Риски: (1) атомарность инструменты+шаблоны — тот же коммит, сторож в `phase-prompt.test.mjs`; (2) переименование поля в `missing` (`content` → `problem`) ломает текстовые ожидания в тестах и, возможно, эвристики repeat-tracker — проверка полным прогоном; (3) накопленные уроки-скелеты остаются неполными (разовая уборка вне объёма); (4) `bodyArg: 'content'` в спеке сознательно сохраняется — на нём держится noop-сверка тела.
Разделы «Проверено по коду» (30 строк, все со ссылками файл:строка) и «Не проверено (предположения)» (5 пунктов с планом проверки) в плане присутствуют.
---
author: @agent
created: 2026-11-08 18:15
---
Фаза 3 (Code) выполнена. Коммит 6b1dc78 «feat: VL-379 — lesson_create/lesson_update: problem/solution/example вместо content».
Что сделано:
- `src/mcp/tools.ts`: схемы `lesson_create` (required `['title','problem','solution']`, `content` убран) и `lesson_update` (три поля, `content` убран); новый хелпер `lessonBodyFromParts` склеивает `## Проблема / ## Решение / ## Пример` (пример опускается, если пуст); `toolLessonCreate` собирает тело из частей и ОТКАЗЫВАЕТ до записи, если `problem`/`solution` отсутствуют или пусты (в схеме `required` есть, но сервер её не валидирует — защита в коде обязательна); `lessonSpec`: `fields` на три поля, `removedFields.content`, `build` склеивает части, `beforeWrite` отклоняет неполную пару, `completeness` называет `problem`, `next`/`noopHint`/`message` упрощены, `applied` сворачивает части в длину тела; `LESSON_BODY_TEMPLATE` стал объектом из трёх строк (markdown в аргументах больше нет).
- `src/mcp/update-pipeline.ts`: необязательный хук `EntitySpec.removedFields` — переданное удалённое поле идёт в `skipped` со своей причиной, а не с общей «неизвестное поле».
- Шаблоны фаз в том же коммите: `phase-close-worktree.md` (образец `lesson_update`, правило про полную замену, создание, правило по ответу), `phase-close.md` (оба образца), `phase-code.md` — ни один не передаёт уроку `content`.
- `src/core/lesson.ts` и CLI не менялись: `LESSON_BODY_SKELETON` остался только у `vibelog lesson create` без `-d`.
- Тесты: `phase-prompt.test.mjs` — инвариант «каждый `lesson_create` в шаблонах несёт problem+solution и ни один шаблон не передаёт уроку content»; `lesson-tools.test.mjs` — новые кейсы (склейка с примером и без, отказ без частей с проверкой «файл не создан», пустой problem, `content` в skipped, полная замена тела, `example` без пары); `write-ack.test.mjs`, `write-ack-contract.test.mjs`, `update-pipeline.test.mjs` переведены на `missing[0].field === 'problem'` и на отказ `lesson_create` без тела.
Проверки: `pnpm build` — успех. Полный `pnpm test` — 199 файлов, 3802 теста, зелёный. Первый полный прогон упал на 2 тестах `update-pipeline.test.mjs` (ждали rejected на `content: ''` и `retryWith.content`) — это моя регрессия от смены формы аргумента, исправлена правкой тестов на `problem: ''`; повторный полный прогон чистый. Ручные инварианты: `grep '"content"'` по `lesson_create`/`lesson_update` в `templates/phases/` — 0 совпадений; `listTools()` → `lesson_create.required = ["title","problem","solution"]`, `properties` без `content`; `lesson_update.required = ["id"]`, `properties` без `content`.
Lessons: создан linked lesson-258 «Форму аргумента, а не формулировку ответа» (sourceTasks/lessons VL-379). Отмечены AC 1–8. AC9 (документация: doc-8, doc-10 §6, CHANGELOG) НЕ выполнена — по правилам фазы Code документацию пишет Close; `pnpm build && pnpm test` зелёный, `lesson_audit`/`lesson_classify` не затронуты (читают готовое тело).
---
author: @agent
created: 2026-11-08 18:20
---
Фаза Close выполнена. Ветка vb/vl-379 слита в master одним merge-коммитом f0ce4ca (коммит задачи 6b1dc78, конфликтов не было), worktree удалена (`--force`: единственный untracked-путь — симлинк `backlog/references/data` от оркестратора, данные не терялись), ветка vb/vl-379 удалена штатно (`git branch -d`).
Проверки после merge: `pnpm build` — успех; ранний точечный прогон по затронутым модулям (`lesson-tools`, `write-ack`, `write-ack-contract`, `phase-prompt`, `update-pipeline`) — 222 теста зелёные; полный `pnpm test` — 199 файлов, 3802 теста, зелёный (4 skipped), параллельного vitest в другом worktree не было. Повторных полных прогонов не делал.
Документация (AC9): CHANGELOG.md — запись VL-379 в Unreleased (ломающее изменение схемы инструментов, полный разбор рецидива и что закрыто); doc-8 — таблицы `lesson_create`/`lesson_update` переписаны на `problem`/`solution`/`example`, добавлены абзацы «урок-скелет на MCP-пути исчез как класс» и «`content` удалён, переданный идёт в `skipped` через `EntitySpec.removedFields`», случаи `(а)–(г)` в `lesson_update` переведены на `missing[0].field === 'problem'`; doc-10 §6 — новый пункт «Форма аргумента, а не формулировка ответа» (диагностический признак класса: правки не меняют того, что модели труднее всего сгенерировать) плюс явная пометка в пункте VL-356, что решение пересмотрено. Коммит документации — 7f62ce1.
Урок: linked lesson-258 (создан Code-фазой) — форма аргумента, а не формулировка ответа; связан с задачей (`lessons: [lesson-258]`), файл урока закоммичен в главный репо (3a59ce5). Шаг 7 отработал как дополнение существующего урока: новый урок не понадобился — знание задачи уже зафиксировано lesson-258, повторный `lesson_update` дал noop (поля уже такие).
DoD: 1 — тесты проходят (полный зелёный прогон после merge); 2 — документация обновлена (CHANGELOG + doc-8 + doc-10 §6); 3 — регрессий нет. AC9 отмечен.
---
<!-- COMMENTS:END -->