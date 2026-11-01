---
id: VL-260
title: 'backlog_view_task: fields не документированы в схеме, один неизвестный ключ валит весь вызов — вернуть остальные поля + подсказку/алиасы'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 12:17'
updated_date: '2026-10-30 13:00'
due_date: ''
labels:
  - mcp
  - tools
  - dx
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/view-task-fields.test.mjs
  - MCP-SETUP.md
  - README.md
lessons:
  - lesson-102
token_usage:
  input: 6482387
  output: 70271
  cache: 6304768
  total: 6552658
  requests: 126
  duration_ms: 1759261
  reasoning: 38781
  by_phase:
    plan:
      input: 799680
      output: 16844
      cache: 761344
      requests: 21
    code:
      input: 3033549
      output: 31419
      cache: 2962944
      requests: 53
    close:
      input: 2649158
      output: 22008
      cache: 2580480
      requests: 52
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В этой сессии `backlog_view_task` вызывался с `fields: ["id","title","status","phase","notes"]` и вернул только:

```
{"error":"Неизвестные поля: phase, notes. Допустимые: id, title, status, priority, assignee, reporter, ..."}
```

Ошибка перечисляет допустимые ключи, но: (а) в описании инструмента (схема, которую видит модель) допустимые ключи и camelCase-алиасы не перечислены, поэтому агент выбирает наугад; (б) один неверный ключ из пяти валит весь вызов вместо того, чтобы вернуть запрошенные поля + предупреждение; (в) имена полей в задаче (`phase`, `notes`) и в инструменте (`implementationNotes`, `implementationPlan`) не совпадают, хотя это естественные слова для модели.

## Цель

Убрать холостые ходы из-за «угадывания» имён полей.

## Предлагаемое решение (уточнить в Plan)

1. В `description` параметра `fields` перечислить допустимые ключи и алиасы (или хотя бы сослаться на список), чтобы модель видела их до вызова.
2. Неизвестный ключ → не ошибка, а: вернуть остальные запрошенные поля + строку-предупреждение «неизвестные поля проигнорированы: phase, notes; ближайшие: implementationPlan, implementationNotes» (fuzzy-подсказка по расстоянию имён).
3. Принять очевидные алиасы: `notes` → `implementationNotes`, `plan` → `implementationPlan`, `ac` → `acceptanceCriteria`, `dod` → `definitionOfDone` (если не создаёт конфликтов с реальными ключами).
4. Аналогично для `backlog_list_tasks`/`backlog_search` — та же валидация одним общим хелпером.
5. Тест: `fields: ["id","notes","phase"]` → `id` и `implementationNotes` в ответе + предупреждение о `phase`, без ошибки.

## Связанное

VL-162 (`fields` в backlog_view_task — здесь добавлен отбор полей), VL-255 (дедуп/лимит вызовов: снижает цену ошибки, но не устраняет причину), VL-257 (подсказки при несуществующем пути — та же логика «подскажи, а не просто откажи»).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В `description` параметра `fields` у `backlog_view_task`, `backlog_list_tasks` и `backlog_search` перечислены допустимые ключи и поддерживаемые алиасы, а также указано, что неизвестный ключ не прерывает вызов
- [x] #2 Неизвестный ключ в `fields` больше не бросает ошибку: остальные запрошенные поля возвращаются, а в ответе появляется `_warning` со списком проигнорированных имён и fuzzy-подсказкой ближайших
- [x] #3 Принимаются алиасы `notes`→`implementationNotes`, `plan`→`implementationPlan`, `ac`→`acceptanceCriteria`, `dod`→`definitionOfDone`; алиас не перебивает реальный ключ `Task`
- [x] #4 Отбор полей в `backlog_view_task`, `backlog_list_tasks` и `backlog_search` выполняется одним общим хелпером (единая валидация и текст предупреждения)
- [x] #5 Тест `fields: ['id','notes','phase']` → в ответе `id` и `implementationNotes` + `_warning` о `phase`, без ошибки; существующие кейсы VL-162/VL-236 (порядок ключей, `fields: []`, невалидный тип) остаются зелёными
- [x] #6 Документация обновлена: `MCP-SETUP.md`, `README.md`, doc-8 (MCP-справочник), CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель плана

Убрать холостые ходы «угадывания» имён полей в `fields`: (1) перечислить допустимые ключи и алиасы прямо в `description` схемы, (2) неизвестный ключ больше не валит вызов — остальные поля возвращаются + строка-предупреждение с fuzzy-подсказкой, (3) принять очевидные алиасы (`notes`/`plan`/`ac`/`dod`), (4) общий хелпер используется и в списковых инструментах.

## Изученное состояние кода (факты)

- `src/mcp/tools.ts`
  - `camelToSnake(name)` — строки ~850-852 (VL-236): `name.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase()`.
  - `resolveFieldName(field, valid)` — строки ~859-876: точное совпадение → snake_case → обратный поиск по `camelToSnake(key) === snake`.
  - `toolViewTask(args, cwd)` — строки ~879-925: валидация `fields` (не массив / не-строки → throw), сбор `resolved`/`unknown`, при `unknown.length > 0` — `throw new Error('Неизвестные поля: … Допустимые: …')` (строка 918), затем `picked`.
  - `toolListTasks` — строки 779-840: возвращает `simplified` из фиксированного набора ключей (`id,title,status,priority,labels,assignee,milestone,type,parent_task_id`) — параметра `fields` нет.
  - `toolSearch` — строки 1574-1594: `simplified` (`id,title,status,priority,type,project,labels,milestone`), параметра `fields` нет.
  - Схемы `TOOLS` (объявление `inputSchema`): `backlog_list_tasks` — ~110-125, `backlog_view_task` (в т.ч. `fields.description`) — ~124-138, `backlog_search` — ~239-256.
- `src/core/task.ts:54-93` — интерфейс `Task`: ключи фронтматтера snake_case (`modified_files`, `parent_task_id`), поля тела camelCase (`acceptanceCriteria`, `definitionOfDone`, `implementationPlan`, `implementationNotes`, `finalSummary`).
- `src/mcp/view-task-fields.test.mjs` (227 строк) — 2 существующих кейса ждут **throw** на неизвестное поле: строка ~105 (`fields: ['id','nope']`, ассерт «Неизвестные поля: nope.») и строка ~211 (`['id','nopeField']`) — их поведение меняется, тесты надо переписать.
- Документация с упоминанием `fields`: `MCP-SETUP.md:14`, `README.md` (таблица MCP-инструментов), `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` (раздел про `backlog_view_task`).

## Файлы к изменению

1. `src/mcp/tools.ts` — основной код.
2. `src/mcp/view-task-fields.test.mjs` — тесты (переписать 2 throw-кейса + новые).
3. `MCP-SETUP.md` — строка 14 (`backlog_view_task`), добавить упоминание `fields` у `backlog_list_tasks`/`backlog_search`.
4. `README.md` — таблица/раздел MCP-инструментов: поведение `fields` (алиасы, предупреждение вместо ошибки).
5. `backlog/docs/doc-8-...md` — через `document_update` (не edit): раздел `backlog_view_task`/`backlog_list_tasks`/`backlog_search`.
6. `CHANGELOG.md` — запись VL-260 (фаза Code/Close по конвенции проекта).

## Порядок действий

### 1. Константы алиасов и keys рядом с `camelToSnake` (после ~стр. 852)

```ts
/** Явные смысловые алиасы: слово модели → канонический ключ Task. */
const FIELD_ALIASES: Record<string, string> = {
  notes: 'implementationNotes',
  note: 'implementationNotes',
  plan: 'implementationPlan',
  ac: 'acceptanceCriteria',
  dod: 'definitionOfDone',
  summary: 'finalSummary',
};
```
Применять в `resolveFieldName` **после** точного совпадения и нормализации `camelToSnake`, **до** fuzzy: алиас не должен перебивать реальный ключ (`resolveFieldName` уже сначала проверяет `valid.includes(field)`, поэтому `notes` (не ключ Task) → `implementationNotes`; конфликтов нет — в интерфейсе `Task` ключей `notes/plan/ac/dod/summary` нет, проверено по `src/core/task.ts:54-93`). Добавить комментарий «почему» со ссылкой на VL-260.

### 2. Fuzzy-подсказка (новая функция, ~стр. 876)

`function suggestFieldNames(field: string, valid: string[], limit = 3): string[]`
- нормализовать вход и ключи через `camelToSnake`, сравнивать по расстоянию Левенштейна (своя реализация на 15-20 строк, без зависимостей — запрет нативных/внешних рантаймов не нарушается);
- порог: `distance <= Math.max(2, Math.floor(len/3))` **или** вхождение подстроки (`merged.includes(token)` / наоборот — ловит `phase` → `implementationPlan`? нет; ловит `notes` → `implementationNotes` при отключённом алиасе, `plan` → `implementationPlan`);
- вернуть до `limit` ближайших в порядке возрастания расстояния; пустой массив — если ничего близко.

### 3. Общий хелпер отбора полей (заменить тело `toolViewTask`, ~стр. 883-925)

`function pickFields<T extends Record<string, unknown>>(obj: T, fields: string[], validKeys: string[]): string`
- валидация `fields` (не массив / не-строки → прежние throw с текстом «Параметр fields должен быть массивом имён полей.» — сохраняем, lesson-34);
- резолв каждого имени (`resolveFieldName` + fuzzy только для подсказки, **не** для автоподстановки), дедуп по каноническому ключу (порядок первого вхождения);
- если `unknown.length > 0` — **не throw**, а добавить в конец объекта ключ `_warning`:
  `неизвестные поля проигнорированы: phase; ближайшие: implementationPlan, implementationNotes. Допустимые: <validKeys.join(', ')>`;
  если подсказок нет — `…; допустимые значения: <список>`;
- вернуть `JSON.stringify(pickedObj, null, 2)`, где `pickedObj = { ...picked, _warning? }`. Ключ `_warning` префиксом `_` не конфликтует с ключами `Task`; без неизвестных полей ключа в ответе нет (контракт VL-162 «ровно запрошенные ключи» сохраняется — существующие тесты остаются зелёными).
- если **все** запрошенные поля неизвестны — тоже вернуть `{_warning}` (не ошибку): агент видит и подсказку, и список допустимых (lesson-92: явный следующий шаг вместо нейтрального отказа).

`toolViewTask` сокращается до: `getTask` → пустой/отсутствующий `fields` → полный JSON → иначе `return pickFields(task, fields, Object.keys(task))`.

### 4. `fields` в списковых инструментах (п.4 задачи)

- `toolListTasks` (стр. 833-840) и `toolSearch` (стр. 1585-1593): опциональный `args.fields`; при наличии — `simplified.map(item => JSON.parse(pickFields(item, fields, Object.keys(item))))`… **нет**: чтобы не парсить/сериализовать по кругу, хелпер разделить на два слоя:
  - `resolveFields(fields, validKeys): { resolved: string[]; unknown: string[] }` (чистая логика),
  - `pickFields(obj, fields, validKeys): string` — обёртка `resolveFields` + `_warning` + `JSON.stringify`,
  - для списков: `const { resolved, unknown } = resolveFields(...)`, `tasks.map(t => pickObject(t, resolved))` и один общий `_warning` в корне ответа (`backlog_search` → `{ found, returned, tasks, _warning? }`, `backlog_list_tasks` → массив + предупреждение некуда — поэтому при `fields` в list_tasks возвращать `{ tasks, _warning? }` только если есть `_warning`; сохранить совместимость: без `fields` — прежний массив).
- Схемы: добавить `fields` в `backlog_list_tasks` и `backlog_search` (необязательный, `type: 'array', items: {type:'string'}`).

### 5. Описания схем (`description`) — п.1 задачи

- `fields` у `backlog_view_task` (стр. ~130-135): перечислить канонические ключи `Task` (фронтматтер snake_case + тело camelCase) и алиасы, плюс явно: «неизвестные ключи не прерывают вызов: они игнорируются, в ответе появляется `_warning` с ближайшими именами». Пример полного текста — в реализации; статический список допустим как **подсказка** в описании (`Object.keys(task)` остаётся источником истины в рантайме — так соблюдается lesson-32: enum не закрепляем, список в тексте).
- `fields` у `backlog_list_tasks`/`backlog_search`: ключи карточки (`id,title,status,priority,type,project,labels,assignee,milestone,parent_task_id`) + те же правила.

### 6. Тесты — `src/mcp/view-task-fields.test.mjs`

- **Переписать** два кейса, ждущих throw: «неизвестное поле» (~стр. 100-112) и «мусорное имя в camelCase» (~стр. 205-218) → теперь `assert.doesNotReject`, в ответе запрошенные поля + `_warning`, содержащий имя неизвестного поля и подсказку/список допустимых.
- **Новый describe «VL-260»** (по аналогии с VL-236, тот же `mkdtemp` setup):
  1. `fields: ['id','notes','phase']` → `JSON.parse(result)` содержит `id` и `implementationNotes` (алиас), `_warning` упоминает `phase` и `implementationPlan`; ключа `notes`/`phase` нет (ключевой AC задачи).
  2. Алиасы: `plan` → `implementationPlan`, `ac` → `acceptanceCriteria`, `dod` → `definitionOfDone` (дополнить задачу через `createTaskFile` с соответствующими полями).
  3. Алиас не перебивает реальный ключ: `fields: ['modified_files']` остаётся `modified_files`.
  4. Все поля неизвестны (`['phase','sprint']`) → ответ `{_warning}` без throw.
  5. Дедуп alias+canonical: `['implementationNotes','notes']` → один ключ.
  6. `backlog_list_tasks` с `fields:['id','nope']` → карточки содержат `id`, `_warning` есть, throw нет; без `fields` — прежний формат (массив).
  7. `backlog_search` с `fields:['id','title','bogus']` → `{found, returned, tasks}` + `_warning`, `tasks[0]` только `id`/`title`.
- Существующие кейсы VL-162/VL-236 (порядок ключей, `fields: []`, строка вместо массива, `[null]`, дедуп) — сохранить без изменений: поведение для валидных имён и для невалидных типов не меняется.

## Как проверить

```bash
cd /Users/bob/Dev/ton/ai/Vibelog.md/.vibelog/worktrees/vl-260
pnpm build && npx vitest run src/mcp/view-task-fields.test.mjs
```
затем полный прогон (DoD «Тесты проходят» закрывается **только** полным прогоном):
```bash
pnpm test
```
Ручная проверка через реальный MCP-сервер (по возможности): вызвать `backlog_view_task` с `fields: ["id","notes","phase"]` и убедиться, что в ответе есть `id`, `implementationNotes`, `_warning` и нет ошибки.

## Риски

- **Обратная несовместимость контракта VL-162** («неизвестное поле → ошибка»): агент, рассчитывавший на ошибку для валидации, теперь получит ответ. Смягчение: `_warning` в ответе + обновление схем/документации/CHANGELOG; в боевых вызовах проекта неизвестных полей нет (grep по `fields:`: `["references","lessons"]`, `["id","title","description"]` — все канонические).
- **Ключ `_warning` в JSON**: может «просочиться» в парсеры, ожидающие только запрошенные ключи. Префикс `_` + отсутствие ключа при валидных полях делают регрессию маловероятной; тесты фиксируют оба состояния.
- **Смена формата `backlog_list_tasks` при `fields`** (массив → `{tasks,_warning}`): применяется только когда `fields` передан явно — прежние вызовы (без `fields`) формат не меняют.
- **Fuzzy-подсказки могут быть «шумными»**: ограничить 3 кандидатами и порогом расстояния; в тексте всегда дублировать полный список допустимых — подсказка не единственный ориентир.
- **Ложный алиас**: `notes`/`plan`/`ac`/`dod`/`summary` не являются ключами `Task`, конфликт исключён проверкой `github`-списка `src/core/task.ts:54-93`; при добавлении такого поля в `Task` точное совпадение сработает первым (алиас не применится).
- Реестр допустимых полей остаётся `Object.keys(task)` (не статический enum) — новые поля `Task` автоматически валидны; документация в схеме может отстать, но рантайм не сломается (lesson-32).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 12:34
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, не epic).
План записан в ## Implementation Plan. Ключевые решения:
1. **Алиасы** — таблица `FIELD_ALIASES` (`notes`/`note`→`implementationNotes`, `plan`→`implementationPlan`, `ac`→`acceptanceCriteria`, `dod`→`definitionOfDone`, `summary`→`finalSummary`), применяется в `resolveFieldName` (`src/mcp/tools.ts:859-876`) ПОСЛЕ точного совпадения и camelToSnake-нормализации — конфликт с реальными ключами `Task` исключён (проверено по `src/core/task.ts:54-93`: таких ключей нет).
2. **Неизвестный ключ больше не ошибка** — вместо `throw` на `src/mcp/tools.ts:918` в ответ добавляется `_warning` («неизвестные поля проигнорированы: …; ближайшие: …»), а валидные запрошенные поля возвращаются. Fuzzy-подсказка — своя функция `suggestFieldNames` (Левенштейн + подстрочное вхождение, до 3 кандидатов, без внешних зависимостей).
3. **Общий хелпер** — `resolveFields` (чистая логика резолва/дедупа/unknown) + `pickFields` (JSON + `_warning`); используется в `toolViewTask`, а также даёт `fields` для `toolListTasks` (`src/mcp/tools.ts:779-840`) и `toolSearch` (`src/mcp/tools.ts:1574-1594`), где параметра `fields` сейчас нет.
4. **Схемы** — перечислить ключи и алиасы в `description` `fields` (три инструмента); рантайм-реестр остаётся `Object.keys(task)` (lesson-32: enum в inputSchema не закрепляем).
5. **Тесты** (`src/mcp/view-task-fields.test.mjs`): 2 существующих кейса, ожидающих throw (стр. ~105 «nope», стр. ~211 «nopeField»), переписываются на «поля + `_warning`, без ошибки»; новый describe VL-260 из 7 кейсов, включая `fields: ['id','notes','phase']` → `id` + `implementationNotes` + `_warning` о `phase`.
Файлы к изменению (все существуют, проверено ls): `src/mcp/tools.ts`, `src/mcp/view-task-fields.test.mjs`, `MCP-SETUP.md:14`, `README.md` (таблица MCP), `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` (через document_update), `CHANGELOG.md`.
Риски: (а) ломается контракт VL-162 «неизвестное поле → ошибка» — смягчено `_warning` + обновлением документации, боевые вызовы проекта используют только канонические имена; (б) ключ `_warning` в JSON — префикс `_`, при валидных `fields` отсутствует (тесты фиксируют оба состояния); (в) при `fields` в `backlog_list_tasks` формат ответа становится `{tasks,_warning}` — только при явной передаче `fields`, без него прежний массив; (г) шумные fuzzy-подсказки — порог расстояния, лимит 3, полный список допустимых дублируется в тексте.
Проверка: `pnpm build && npx vitest run src/mcp/view-task-fields.test.mjs`, затем полный `pnpm test` (DoD «Тесты проходят» закрывается только полным прогоном). AC (6 пунктов) записаны в задачу.
---
author: @agent
created: 2026-10-30 12:47
---
Фаза 3 (Code) выполнена. Коммит 6d8d1f7 «feat: VL-260 — неизвестные поля в fields не валят вызов, алиасы и _warning».
Изменено (4 файла, вне backlog/):
- `src/mcp/tools.ts` — вместо throw на неизвестное поле: `FIELD_ALIASES` (notes/note→implementationNotes, plan/plans→implementationPlan, ac→acceptanceCriteria, dod→definitionOfDone, summary→finalSummary), `levenshtein` + `suggestFieldNames` (fuzzy-подсказка, порог max(2,len/3) либо вхождение подстроки, до 3 кандидатов), `resolveFields` (валидация типа + дедуп по каноническому ключу), `unknownFieldsWarning` (текст «Неизвестные поля проигнорированы: … Ближайшие: … Допустимые: …»), `pickFields` и `pickFieldsList` (одно предупреждение на ответ списка). `toolViewTask` сведён к `getTask` → полное представление → `pickFields`. Параметр `fields` добавлен в `toolListTasks` (без `fields` — прежний массив; с `fields` — `{tasks,_warning}` при неизвестных) и в `toolSearch` (`{found,returned,tasks,_warning}`). Описания `fields` в трёх схемах (`backlog_view_task`, `backlog_list_tasks`, `backlog_search`) теперь перечисляют допустимые ключи, алиасы и правило «неизвестный ключ не прерывает вызов».
- `src/mcp/view-task-fields.test.mjs` — 2 кейса, ожидавших throw (vf-5, vf-16), переписаны на «поля + `_warning`, без ошибки»; новый describe «VL-260» из 8 кейсов (ключевой `['id','notes','phase']` → id + implementationNotes + `_warning` про phase и implementationPlan; алиасы plan/ac/dod; алиас не перебивает `modified_files`; все поля неизвестны → `{_warning}`; дедуп alias+canonical; `backlog_list_tasks` с/без `fields`; `backlog_search` с `fields`). Итого файл: 21 тест.
- `MCP-SETUP.md` — строки таблицы для трёх инструментов (`fields` и правило `_warning`).
- `README.md` — подпункт «Отбор полей `fields`» в разделе инструментов веб-чата (алиасы, `_warning`, единая логика).
Проверки:
- `pnpm build` — чисто.
- `npx vitest run src/mcp/view-task-fields.test.mjs` — 21/21 passed.
- Полный `pnpm test` (дважды): первый прогон дал 6 падений в `src/web/orchestrator.test.mjs` (спавн-тесты с таймингами — «startPhase: result парсится, хотя stderr вклинился…» и др.); изолированный повтор того же файла — 79/79 passed, второй полный прогон `pnpm test` — **92 файла / 1726 тестов passed, 4 skipped, 0 failed**. Исключённых/пропущенных файлов нет. Классификация первого падения: флак по таймингам спавна (не связан с diff'ом — изменение затрагивает только `src/mcp/tools.ts`, тесты и доки).
Что осталось (для Фазы Close): по правилу фазы Code `backlog/docs` и CHANGELOG не правил — AC6 закрыт частично (`MCP-SETUP.md`, `README.md` обновлены; doc-8 «MCP-справочник» через `document_update` и запись в CHANGELOG — за Close). Поэтому AC6 не отмечен полностью, DoD 2 «Документация обновлена» тоже оставлен незакрытым. DoD 1 («Тесты проходят», полный прогон) и DoD 3 («Нет регрессий») отмечены. References и lessons не использовались/не создавались.
---
author: @agent
created: 2026-10-30 12:59
---
Фаза Close выполнена. Ветка vb/vl-260 слита в master (1 коммит кода + merge 0f…, docs-коммит 0fd696b «docs: VL-260 — документация и CHANGELOG»), worktree .vibelog/worktrees/vl-260 удалена (остались только untracked-симлинки node_modules/backlog/references/data — удалена с --force), ветка vb/vl-260 удалена (`git branch -d`).
Проверки после merge: `pnpm build` — чисто; ранний точечный прогон `npx vitest run src/mcp/view-task-fields.test.mjs` — 21/21; полный `pnpm test` — 92 файла / 1726 passed, 4 skipped, 0 failed (параллельного vitest не было, повторных прогонов не потребовалось).
Документация (остаток AC6/DoD2): doc-8 «MCP-справочник» обновлён через core `updateDocument` — `fields` в таблицах `backlog_list_tasks` и `backlog_search`, полный список канонических ключей и алиасов + правило `_warning` у `backlog_view_task`, поясняющий абзац и пример вызова с алиасами; CHANGELOG.md — запись VL-260 в Unreleased/Изменено. MCP-SETUP.md и README.md пришли из ветки.
Lessons: lesson-102 «Перечисляй допустимые ключи и алиасы полей в description схемы MCP и не вали весь вызов из-за одного неизвестного ключа» (создан, связан с задачей, закоммичен в e002cf1 «docs(task): VL-260 — refs и lessons»).
DoD: 1 «Тесты проходят» — полный прогон на master после merge, 2 «Документация обновлена» — MCP-SETUP.md, README.md, doc-8, CHANGELOG, 3 «Нет регрессий» — сборка и полный прогон зелёные.
---
<!-- COMMENTS:END -->