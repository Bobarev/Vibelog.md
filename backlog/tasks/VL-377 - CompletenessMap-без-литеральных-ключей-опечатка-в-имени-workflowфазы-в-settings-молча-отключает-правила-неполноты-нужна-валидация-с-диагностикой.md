---
id: VL-377
title: 'CompletenessMap без литеральных ключей: опечатка в имени workflow/фазы в settings молча отключает правила неполноты — нужна валидация с диагностикой'
status: Review
assignee: []
reporter: ''
created_date: '2026-11-08 16:03'
updated_date: '2026-11-08 17:26'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow.ts
  - src/core/workflow.test.mjs
  - src/cli/commands/doctor.ts
  - src/cli/diagnostics.test.mjs
lessons: []
token_usage:
  input: 12652069
  output: 100686
  cache: 10860032
  total: 12752755
  requests: 147
  duration_ms: 2558168
  reasoning: 64504
  by_phase:
    plan:
      input: 3029445
      output: 37963
      cache: 2412032
      requests: 40
    code:
      input: 8232679
      output: 55712
      cache: 7230464
      requests: 77
    close:
      input: 1389945
      output: 7011
      cache: 1217536
      requests: 30
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Найдено при аудите после закрытия VL-370.

`CompletenessMap` (`src/core/workflow.ts:79`) объявлен так:

```ts
export type CompletenessMap = Record<string, Record<string, Record<string, string[]>>>;
```

**Три уровня `string` без литеральных ключей.** Следствие: любая опечатка в `.vibelog/settings.json` проходит валидацию и просто не применяется.

### Что именно остаётся незамеченным

**Опечатка в имени workflow:**
```json
"completeness": {
  "defualt": { "close": { "task": ["acceptanceCriteria"] } }
}
```
→ `loadCompleteness` положит запись как `result['defualt']`, `getCompletenessFields` её не найдёт (имя workflow задачи — `default`) → сработает fallback на `map.default` → **пользовательские правила молча проигнорированы**.

**Опечатка в имени фазы:**
```json
"completeness": {
  "default": { "clsoe": { "task": ["acceptanceCriteria"] } }
}
```
→ `entry['clsoe']` не совпадёт с `phase='close'` → фаза получит только правила `'*'` → **требование к AC/DoD молча отключено**.

**Опечатка в имени поля:**
```json
"close": { "task": ["acceptanceCriterias"] }
```
→ `taskCompletenessMissing` ищет `task['acceptanceCriterias']` → `undefined` → `isEmptyFieldValue(undefined) === true` → поле попадает в `missing` **всегда**, при любой задаче. Обратный эффект: не ложный пропуск, а вечная неполнота.

**Опечатка в имени сущности:**
```json
"close": { "tsak": ["acceptanceCriteria"] }
```
→ `source?.['task']` пуст → правил нет → задача считается полной.

### Почему это важно

Правило неполноты — это гейт: «нельзя закрыть задачу с неотмеченными пунктами», «в фазе plan должен быть план». Молчаливое отключение гейта означает, что задача закроется без проверки, и **никто об этом не узнает** — ни в логе, ни в ответе инструмента, ни в тесте.

Это ровно тот класс, что мы закрывали в VL-369/VL-370: ответ системы не соответствует её состоянию. Там — ответ инструмента врал о записи; здесь — конфигурация молча не действует.

### Отличие от `workflows`

У `workflows` та же слабость (`isValidWorkflow` проверяет структуру, не имена), но там цена ниже: невалидный переход виден по отсутствию кнопки фазы, а несуществующая фаза всплывает при запуске (`isPhaseAllowed` вернёт false). У `completeness` нет ни одного пути, где опечатка проявится наблюдаемо.

## Цель

Опечатка в `completeness` (и, попутно, в `workflows`/`task_workflows`) должна диагностироваться, а не молча отключать правило.

## Варианты решения

**Вариант А. Валидация со сверкой имён при загрузке.**
`loadCompleteness` сверяет ключи с известными: имя workflow — против `loadWorkflows(cwd).workflows`, имя фазы — против множества фаз этого workflow (`transitions[].phase` + `'*'`), имя сущности — против литерала (`task`/`lesson`), имя поля — против `Object.keys` известных полей `Task`.

При расхождении — не отбрасывать молча, а:
- вернуть список предупреждений из `loadCompleteness` (второй элемент кортежа или отдельная функция `validateCompleteness`),
- показывать их в CLI (`vibelog config list`/`check`), в ответе `backlog_update_task` не нужно (шум).

**Вариант Б. Литеральные типы + runtime-проверка.**
Сузить типы до известных имён, но имена workflow и фаз настраиваемые — литералы невозможны для пользовательских. Работает только для `entity` и `field`.

**Вариант В. Строгий режим: неизвестный ключ → ошибка загрузки.**
Отбрасывать всю секцию `completeness` при опечатке. Плюс: заметно сразу. Минус: одна опечатка ломает всю конфигурацию — против принятого в проекте принципа «битая запись выпадает, остальные остаются» (`loadWorkflows`, `loadSettings`).

Рекомендуется **А + Б**: литералы там, где возможно; валидация с предупреждениями для настраиваемых имён. Принцип «частичная валидность» сохраняется.

## Точки правки

1. `src/core/workflow.ts` — `validateCompleteness(cwd)` рядом с `loadCompleteness`.
2. `src/core/workflow.ts:511` — `CHECKLIST_FIELDS` уже задаёт список полей-чеклистов; расширить до полного набора известных полей задачи (или сверять с `Object.keys` `Task`).
3. CLI: `vibelog check` / `vibelog config` — вывод предупреждений (проверить, есть ли подходящая команда).
4. Тесты: опечатка в workflow / фазе / сущности / поле → предупреждение с указанием, что не так; валидная конфигурация → пусто.

## Связанные задачи

- **VL-370** — ввела `CompletenessMap`.
- **VL-369** — общий пайплайн (потребитель `missing`).

## Риск

Валидация добавляет чтение settings при каждом `loadCompleteness` — уже происходит, дополнительной стоимости нет. Риск ложных предупреждений для кастомных workflow: имя проверяется против фактически объявленных в `workflows`, а не против дефолтного списка, поэтому корректные пользовательские конфигурации предупреждений не дают.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `validateCompleteness(cwd)` в `src/core/workflow.ts` сверяет ключи `completeness` с фактическими: имя workflow — против `loadWorkflows(cwd).workflows`, имя фазы — против `transitions[].phase` этого workflow (+ `'*'`), имя сущности — `task`/`lesson`, имя поля — против известных полей `Task`
- [x] #2 Опечатка в имени workflow, фазы, сущности или поля даёт ПРЕДУПРЕЖДЕНИЕ с указанием, что не так, а не молчаливое отключение правила; проверено тестом на каждый из четырёх случаев
- [x] #3 Валидная конфигурация (включая кастомный workflow с собственными фазами) предупреждений не даёт — проверено тестом
- [x] #4 Предупреждения видны пользователю: выводятся командой CLI (`vibelog check` или эквивалент), а не только в коде; проверено запуском
- [x] #5 Принцип «частичная валидность» сохранён: битая запись выпадает с предупреждением, валидные остаются (как в `loadWorkflows`)
- [x] #6 `pnpm build && pnpm test` зелёный; существующие тесты `workflow.test.mjs` не сломаны
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Задача

Тип: bug. Ветвление по эпику не требуется — обычная задача, план пишется сюда.

Опечатка в `.vibelog/settings.json` → секция `completeness` молча не действует (гейт неполноты отключается). Решение — **вариант А + Б из описания**: литеральные наборы имён там, где это возможно (сущность, поле), и валидация со сверкой настраиваемых имён (workflow, фаза) при чтении конфигурации. Принцип «частичная валидность» (битая запись выпадает, валидные остаются) сохраняется.

## Файлы и порядок шагов

### 1. `src/core/workflow.ts` — новые константы имён и `validateCompleteness`

1.1. Рядом с `CompletenessMap` (`src/core/workflow.ts:79-82`) добавить:

```ts
/** Сущности, для которых completeness реально применяется (литералы вместо string). */
export const COMPLETENESS_ENTITIES: readonly string[] = ['task', 'lesson'];

/**
 * Поля `Task`, которые понимает taskCompletenessMissing: фронтматтер + секции тела.
 * Список — контракт «что можно требовать», а не «что есть в типе»: TS-типы в рантайме
 * не существуют, поэтому набор продублирован явно, а тест сверяет его с
 * Object.keys(createTask({id,title}, {})) — дрейф при добавлении поля ловится тестом (lesson-224).
 */
export const KNOWN_TASK_FIELDS: readonly string[] = [
  'id','title','status','priority','assignee','reporter','created_date','updated_date',
  'due_date','labels','dependencies','milestone','type','project','parent_task_id','ordinal',
  'references','documentation','modified_files','lessons','description',
  'acceptanceCriteria','definitionOfDone','implementationPlan','implementationNotes',
  'finalSummary','comments',
];

/** Единственное поле урока, которое реально проверяется (тело). Остальные имена для lesson инертны. */
export const KNOWN_LESSON_FIELDS: readonly string[] = ['content'];

/** Предупреждение валидации completeness. */
export interface CompletenessWarning {
  /** Что не так: структура записи / имя workflow / фаза / сущность / поле. */
  kind: 'structure' | 'workflow' | 'phase' | 'entity' | 'field' | 'task_workflow';
  /** Путь в конфигурации: `completeness.defualt.close.task[0]`, `task_workflows.bugg`. */
  path: string;
  /** Готовый текст для пользователя: что не так и почему правило не применится. */
  message: string;
}

export function validateCompleteness(cwd: string): CompletenessWarning[];
```

1.2. `validateCompleteness(cwd)` читает **сырой** settings (`loadSettings(cwd).completeness`), не `loadCompleteness` — иначе структурно битые записи уже выпали бы и о них нельзя предупредить. `loadCompleteness` (`:260`) и `getCompletenessFields` (`:289`) **не меняются** — поведение расчёта неполноты остаётся прежним (AC5, AC6).

Алгоритм:

- `config = loadWorkflows(cwd)` (`:186`), `declared = Object.keys(config.workflows)` (там всегда есть `default`).
- Допустимые имена workflow = `declared` ∪ `Object.keys(DEFAULT_COMPLETENESS)` — `simple` не объявлен в большинстве проектов, но его дефолтная запись легитимна.
- Для каждого ключа `completeness`:
  - имя не в множестве → warning `kind:'workflow'`, `path: 'completeness.' + name`, текст «workflow «X» не объявлен (объявлены: …) — запись не применяется, задача получит правила 'default'». Если рядом есть близкое имя (расстояние Левенштейна ≤ max(2, len/3)) — «возможно, имелось в виду «default»». Левенштейн — локальная функция ~15 строк (не импортировать из `src/mcp/tools.ts`: core не должен зависеть от mcp; там же `levenshtein` в `tools.ts:1176`).
  - структура записи невалидна (`isValidCompletenessEntry` (`:240`) === false) → warning `kind:'structure'`, `path: 'completeness.' + name`, «запись не соответствует формату фаза → сущность → массив строк и пропускается» (сегодня пропуск молчаливый — это и есть часть дефекта).
  - имя workflow валидно и объявлено в `config.workflows` → допустимые фазы = `new Set(workflow.transitions.map(t => t.phase).filter(p => p !== null))` ∪ `{'*'}` ∪ `SERVICE_PHASES` (`:153`). Иначе (например `simple`) проверку фаз для этого workflow ПРОПУСТИТЬ — переходы неизвестны, предупреждать не о чем.
    - фаза не в множестве → warning `kind:'phase'`, текст «фазы «clsoe» нет в workflow «default» (есть: spec, plan, code, close, reject, *) — правило не применится».
  - для каждой сущности: имя не в `COMPLETENESS_ENTITIES` → warning `kind:'entity'` («сущность «tsak» не поддерживается, допустимы task/lesson»).
  - для каждого поля: сущность `task` → сверка с `KNOWN_TASK_FIELDS`; сущность `lesson` → с `KNOWN_LESSON_FIELDS` (`content`). Несовпадение → warning `kind:'field'` с разным текстом для двух случаев: для `task` «поля «acceptanceCriterias» нет в Task — оно всегда будет считаться незаполненным»; для `lesson` «для урока проверяется только content — поле «title» не применяется». Подсказка-ближайшее имя — тем же `nearestName`.
- Дополнительно (в описании задачи: «попутно в `workflows`/`task_workflows`»): для `task_workflows` — значение не в `declared` → warning `kind:'task_workflow'`, текст «тип «bugg»/«bug» ссылается на необъявленный workflow «X» — задача получит default». Ключ типа (`bugg`) не проверяем: типы настраиваемые (`DEFAULT_TASK_TYPES` в `config.ts:17` — дефолт, не истина).

### 2. `src/cli/commands/doctor.ts` — проверка `completeness_config`

2.1. Импорт: `import { validateCompleteness } from '../../core/workflow.js';` (в файле уже импортируются core-модули — `core/config.js`, `core/store.js`, `core/integrity.js`).

2.2. Новая функция рядом с `checkTaskIntegrityReport` (`src/cli/commands/doctor.ts:637-665`), по её образцу:

```ts
/** Проверка 13: ключи `completeness` в .vibelog/settings.json (VL-377). */
function checkCompletenessConfig(cwd: string): CheckResult {
  const warnings = validateCompleteness(cwd);
  const ok = warnings.length === 0;
  return {
    name: 'completeness_config',
    ok,
    value: { count: warnings.length, warnings: warnings.slice(0, 20) },
    hint: ok ? undefined : 'Ключи completeness в .vibelog/settings.json не совпадают с объявленными workflow/фазами/полями — правило неполноты молча не применяется. Исправьте имена или удалите запись.',
  };
}
```

2.3. Регистрация в `runDoctor`: `checks.push(checkCompletenessConfig(cwd));` после `checkRootGitignore` (`:95-99`).

2.4. В `requiredNames` (`src/cli/commands/doctor.ts:107`) **НЕ добавлять**: опечатка в конфигурации — не поломка окружения; блокировать exit code из-за неё значит чинить doctor на легаси-конфигах (тот же компромисс, что у `task_integrity` — `:636`). Порядок проверок в человекочитаемом выводе сохраняется автоматически (`printHuman` идёт по массиву).

### 3. Тесты

3.1. `src/core/workflow.test.mjs` — новый `describe('validateCompleteness (VL-377)')` с собственным `mkdtempSync`-root (VL-241; не переиспользовать `root` других describe). Кейсы:
  - опечатка workflow (`{ completeness: { defualt: { close: { task: ['acceptanceCriteria'] } } } }`) → одно предупреждение `kind:'workflow'`, текст содержит `defualt` и `default`; при этом `loadCompleteness(dir).defualt` существует, а `getCompletenessRules` для задачи типа feature даёт дефолтные правила (демонстрация исходного дефекта);
  - опечатка фазы (`default: { clsoe: ... }`) → `kind:'phase'`, текст упоминает `clsoe`;
  - опечатка сущности (`default: { close: { tsak: [...] } }`) → `kind:'entity'`;
  - опечатка поля (`default: { close: { task: ['acceptanceCriterias'] } }`) → `kind:'field'`; плюс поведенческая проверка: `taskCompletenessMissing` с этим полем даёт вечную неполноту (фиксируем, почему это дефект);
  - валидная конфигурация с КАСТОМНЫМ workflow (объявленный `investigation` с фазами `investigate`/`materialize`/`reject`, `'*'`, сущности task+lesson, поля `description`/`implementationPlan`/`content`) → `[]` (AC3);
  - структурно битая запись + валидная рядом → `kind:'structure'` на битую, `loadCompleteness` по-прежнему сохраняет валидную (AC5);
  - `task_workflows: { bugg: 'nope' }` → `kind:'task_workflow'`;
  - дрейф-гард: `KNOWN_TASK_FIELDS` ⊇ `Object.keys(createTask({ id: 'VL-1', title: 't' }, {}))` и не содержит лишних имён (импорт `createTask` из `dist/core/task.js`); `KNOWN_LESSON_FIELDS` = `['content']`.
  - `validateCompleteness` на пустом/отсутствующем каталоге → `[]` (нет файла — нечего проверять).

3.2. `src/cli/diagnostics.test.mjs` — в describe про doctor (фикстуры — собственный `mkdtemp`, как в VL-340/VL-348):
  - `doctor --json` на чистом проекте → есть проверка `completeness_config` с `ok: true`, `value.count === 0`;
  - фикстура с `.vibelog/settings.json`, где опечатка в workflow → проверка `ok: false`, `value.warnings[0].kind === 'workflow'`, есть `hint`; `json.ok` при этом остаётся `true` (проверка не обязательная).

3.3. Существующие тесты `src/core/workflow.test.mjs` (VL-370/VL-188) не меняются: `loadCompleteness`/`getCompletenessFields`/`getCompletenessRules` не тронуты (AC6).

### 4. Документация (DoD «Документация обновлена»)

- `CHANGELOG.md` — запись в Unreleased → Исправлено: `validateCompleteness` + проверка `completeness_config` в doctor, четыре вида предупреждений, литеральные наборы имён.
- `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md` (раздел `doctor`) — новый абзац про `completeness_config` (ok = нет предупреждений, в `--json` — `value.count` + первые 20 предупреждений, в `requiredNames` не входит) + строка в примере вывода.
- `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` (раздел про неполноту сущности, рядом со строкой про `completeness`) — абзац: опечатка в имени workflow/фазы/сущности/поля даёт предупреждение в `vibelog doctor`, а не молчаливое отключение правила; список известных полей задачи — из `KNOWN_TASK_FIELDS`, для урока проверяется только `content`.
- `README.md` не трогать (лимит 150 строк и белый список H2 закреплён `src/web/readme-standard.test.mjs`).

## Как проверить

```bash
pnpm build
node --test 2>/dev/null || true            # не используется: тесты — vitest
pnpm test:fast src/core/workflow.test.mjs src/cli/diagnostics.test.mjs   # точечно после сборки
pnpm test                                  # полный прогон перед DoD (без --exclude/--skip)
node bin/vibelog.mjs doctor --json | grep -c completeness_config          # AC4: предупреждения видны в CLI
```

Ручная проверка AC4 (обязательна, DoD): во временном каталоге `mkdtemp` создать `.vibelog/settings.json` с опечаткой `defualt`, запустить `node bin/vibelog.mjs doctor --json` из него → `completeness_config.ok === false`, в `value.warnings` — текст с «defualt». Дополнительно в этом же каталоге `node bin/vibelog.mjs doctor` (человекочитаемо) — строка `✗ completeness_config` + hint.

## Риски

1. **Ложные предупреждения на кастомных конфигурациях.** Фазы сверяются с фактическими `transitions` объявленного workflow, а для workflow из `DEFAULT_COMPLETENESS`, но не объявленных в settings (`simple`), проверка фаз пропускается — это и есть страховка из «Риска» описания. Остаточный риск: пользователь пишет `completeness` для workflow, который объявлен в другом файле/проекте — предупреждение будет корректным (запись действительно не применяется).
2. **Дрейф `KNOWN_TASK_FIELDS`.** Новое поле `Task` без правки списка → ложные предупреждения «поля нет в Task». Страховка — дрейф-гард в тесте (3.1), он падает первым.
3. **doctor становится красным в чужих проектах.** Проверка НЕ входит в `requiredNames`, exit code не меняется (как `task_integrity`), human-вывод показывает `✗` — это осознанно: молчаливое отключение гейта хуже видимого крестика.
4. **Импорт `createTask` в тесте** тянет `core/task.js` (+ `analytics` → `models` → `settings`) — только в тесте, не в рантайме workflow.ts. Если циклический импорт всё же проявится при `pnpm build`, дрейф-гард сделать через `Object.keys(DEFAULT_TASK_FIELDS_ФИКСТУРУ)`… нет: тогда сверка бессмысленна — вместо этого читать список полей из `src/core/task.ts` регэкспом в тесте (`readFileSync` + `match(/^  (\w+)\??:/gm)`) — резервный путь, зафиксировать выбор в комментарии.
5. **Порядок проверок в `runDoctor`** влияет только на вывод, не на результат; `printHuman` усечения не имеет, 20 предупреждений в JSON — по образцу `task_integrity`.
6. **`getCompletenessFields` fallback (`:296-299`)** остаётся как есть: правило «запись workflow заменяет дефолтную целиком» не меняется — валидация только сообщает, ничего не переписывает и не удаляет.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `CompletenessMap` — три уровня `string` без литералов | `src/core/workflow.ts:79-82` |
| `DEFAULT_COMPLETENESS` содержит `default` и `simple`, `simple` может быть не объявлен в settings | `src/core/workflow.ts:99-111`; `.vibelog/settings.json` (объявлен только `investigation`) |
| `isValidCompletenessEntry` проверяет структуру, не имена; битая запись выпадает молча | `src/core/workflow.ts:240-249` |
| `loadCompleteness` возвращает `CompletenessMap` (не кортеж) → менять сигнатуру нельзя, нужна отдельная функция | `src/core/workflow.ts:260-275` |
| `loadCompleteness` кладёт записи по имени как есть (опечатка `defualt` сохраняется в карте) | `src/core/workflow.ts:270-273` |
| `getCompletenessFields` ищет `entry[phase]`/`entry['*']` и падает в fallback `map.default` | `src/core/workflow.ts:289-307` |
| Фазы workflow — множество `transitions[].phase` (+ `'*'`), `SERVICE_PHASES` — отдельный литерал | `src/core/workflow.ts:153`, `DEFAULT_WORKFLOW:132-150`, `getAvailablePhases:341-345` |
| `loadWorkflows` всегда добавляет `default` и сохраняет валидные именованные записи | `src/core/workflow.ts:186-206` |
| `CHECKLIST_FIELDS` — сейчас на строке 512 (в описании задачи указано 511) | `src/core/workflow.ts:512` |
| `FIELD_LABELS` перечисляет 7 полей с человекочитаемыми причинами | `src/core/workflow.ts:528-536` |
| `taskCompletenessMissing` для неизвестного не-чеклист поля полагается на `isEmptyFieldValue(record[field])` → `undefined` = пусто → вечная неполнота | `src/core/workflow.ts:549-575`, `isEmptyFieldValue:515-520` |
| Поля `Task`: фронтматтер + секции тела, полный список — в интерфейсе | `src/core/task.ts:54-92`; значения по умолчанию — `createTask` `src/core/task.ts:134-171` |
| Список полей урока и то, что тело — отдельно (`LessonEntry.body`), а `lesson.content` в карте — единственное проверяемое поле | `src/core/lesson.ts:109-130`, `src/core/lesson.ts:154-158`; `src/mcp/tools.ts:3001-3012` |
| Для урока используется workflow `default` и сущность `lesson` | `src/mcp/tools.ts:3004-3006` |
| `doctor` собирает `checks[]`, `requiredNames` влияет на exit code | `src/cli/commands/doctor.ts:88-108` |
| Образец не-блокирующей проверки с ограничением вывода — `task_integrity` (первые 20 находок, свой hint) | `src/cli/commands/doctor.ts:637-665` |
| `printHuman` печатает `✗ name: value` + hint, порядок = порядок массива | `src/cli/commands/doctor.ts:668-702` |
| Тесты doctor используют `mkdtemp`-фикстуры и `testSpawnEnv()` | `src/cli/diagnostics.test.mjs:20-25, 258-290` |
| Тесты workflow уже импортируют `settingsPath` и создают проекты через `mkdtemp` | `src/core/workflow.test.mjs:16-41, 403-420` |
| Левенштейн для подсказок уже есть, но в слое mcp (в core импортировать нельзя) | `src/mcp/tools.ts:1176-1194` |
| Типы задач настраиваемые — ключ `task_workflows` не валидируем по списку | `src/core/config.ts:17` (дефолт), `loadWorkflows:200-205` (любой строковый ключ) |
| `README.md` защищён тестом стандарта — правки только в doc-* | `AGENTS.md` (правило README), `src/web/readme-standard.test.mjs` |

## Не проверено (предположения)

1. **`Object.keys(createTask(...))` в тесте не создаёт циклический импорт.** Проверить первым шагом: `pnpm build`, затем `node -e "import('./dist/core/task.js').then(m=>console.log(Object.keys(m.createTask({id:'x',title:'t'},{}))))"`. При ошибке/цикле — резерв: парсить список полей из `src/core/task.ts` через `readFileSync` + регэксп `^  (\w+)\??:` (без рантайм-импорта).
2. **`createTask` возвращает все ключи интерфейса `Task`** (включая `token_usage` только при наличии). Проверить выводом из п.1: если какого-то поля в объекте нет (например `token_usage`), дрейф-гард формулировать как «`KNOWN_TASK_FIELDS` ⊇ ключи `createTask`» и отдельно допускать `token_usage`. Точный список сверить с `src/core/task.ts:54-92` при написании теста.
3. **В проекте нет отдельной команды `vibelog check`** — AC4 закрывается проверкой `completeness_config` в `vibelog doctor`. Проверить: `node bin/vibelog.mjs --help | grep -E 'check|doctor'` (в справке `router.ts` есть `task check` и `doctor`). Если Code решит, что нужен ещё и вывод в `vibelog config list` — это допустимо, но целиком в рамках той же проверки (не дублировать логику).
4. **Структура `completeness` в `.vibelog/settings.json` этого репозитория отсутствует** → `doctor` на самом репозитории даёт `ok: true`. Проверить: `node bin/vibelog.mjs doctor --json` до и после правки — `count: 0`. Если появились предупреждения, значит сверка фаз слишком строга (см. риск 1) — разбирать, а не ослаблять `requiredNames`.
5. **`value.warnings` в `--json` сериализуется как есть** (объекты `{kind,path,message}`) — проверить на фикстуре: `doctor --json` даёт валидный JSON (dyld-фильтр в тесте не мешает). Если формат `--json` требует только примитивов — сериализовать строками.
6. **Название проверки не конфликтует** с существующими (`node`, `path`, `symlink`, `sources_match`, `mcp_tools_invariants`, `backlog_dir`, `config`, `tasks_count`, `roundtrip`, git-политика, `vibelog_billing_clean`, `vibelog_settings_clean`, `task_integrity`, `root_gitignore_exists`). Проверить `grep -n "name: '" src/cli/commands/doctor.ts` перед реализацией.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 16:50
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, шаг 3).
План записан в задачу. Решение — вариант А+Б из описания: литеральные наборы имён там, где возможно (`COMPLETENESS_ENTITIES`, `KNOWN_TASK_FIELDS`, `KNOWN_LESSON_FIELDS`), плюс `validateCompleteness(cwd)` со сверкой настраиваемых имён (workflow — против `loadWorkflows(cwd).workflows`, фаза — против `transitions[].phase` + `'*'` + `SERVICE_PHASES`, `task_workflows` — против объявленных workflow). `loadCompleteness`/`getCompletenessFields` не меняются — принцип частичной валидности и текущее поведение расчёта неполноты сохраняются (AC5/AC6).
Файлы плана (5): `src/core/workflow.ts` (константы имён + `CompletenessWarning` + `validateCompleteness`, читает СЫРОЙ settings, чтобы ловить и структурно битые записи), `src/cli/commands/doctor.ts` (проверка `completeness_config`, не входит в `requiredNames` — как `task_integrity`), `src/core/workflow.test.mjs` (новый describe: 4 вида опечаток + валидный кастомный workflow + структурная битость + дрейф-гард `KNOWN_TASK_FIELDS`), `src/cli/diagnostics.test.mjs` (2 кейса doctor, AC4 — проверено запуском CLI), `CHANGELOG.md` + doc-7 + doc-6 (README не трогаем — тест стандарта).
Риски: (1) ложные предупреждения на кастомных конфигурациях — снят сверкой против фактических `transitions`, для необъявленных workflow из `DEFAULT_COMPLETENESS` (`simple`) проверка фаз пропускается; (2) дрейф `KNOWN_TASK_FIELDS` при новом поле `Task` — ловится дрейф-гардом теста; (3) doctor краснеет по `ok` в human-выводе — осознанно, exit code не меняется (проверка вне `requiredNames`); (4) возможный цикл импорта `createTask` в тесте — резервный путь (регэксп по `src/core/task.ts`) описан в плане; (5) `value.warnings` в `--json` — проверить сериализацию на фикстуре.
Разделы «Проверено по коду» (24 утверждения с ссылками файл:строка, включая уточнение: `CHECKLIST_FIELDS` на строке 512, а не 511 как в описании) и «Не проверено (предположения)» (6 пунктов с первым шагом проверки) в плане присутствуют. AC1–AC6 покрыты шагами плана.
---
author: @agent
created: 2026-11-08 16:57
---
Фаза 3 (Code) выполнена. Коммит 72cf073.
Изменено (4 файла):
- `src/core/workflow.ts` — `COMPLETENESS_ENTITIES`, `KNOWN_TASK_FIELDS` (28 полей `Task`, включая опциональное `token_usage`), `KNOWN_LESSON_FIELDS` (`content`), интерфейс `CompletenessWarning`, локальные `levenshtein`/`nearestName`, `validateCompleteness(cwd)`. Читает СЫРОЙ settings (ловит и структурно битые записи) и сверяет: имя workflow — против `loadWorkflows(cwd).workflows` ∪ ключей `DEFAULT_COMPLETENESS` (легитимный `simple`); фаза — против `transitions[].phase` этого workflow + `'*'` + `SERVICE_PHASES` (для необъявленных workflow проверка фаз пропускается); сущность — `task`/`lesson`; поле — по таблице известных; плюс `task_workflows` на необъявленный workflow. `loadCompleteness`/`getCompletenessFields`/`getCompletenessRules` не тронуты.
- `src/cli/commands/doctor.ts` — проверка `completeness_config` (`ok = warnings.length === 0`, в `--json` — `value.count` + первые 20 предупреждений, свой hint); в `requiredNames` НЕ добавлена. Попутно исправлена печать объектного `value` в не-ok ветке `printHuman`: было `[object Object]` (касалось и `task_integrity`), стало JSON.
- `src/core/workflow.test.mjs` — новый describe `validateCompleteness (VL-377)`, 9 кейсов: опечатки workflow/фазы/сущности/поля (каждая с проверкой kind/path/текста и подсказки ближайшего имени), поведенческая демонстрация «вечной неполноты» для опечатанного поля, валидная конфигурация с кастомным `investigation` (+`simple`, `'*'`, lesson) → `[]`, структурно битая запись → `structure` при сохранении валидной рядом, `task_workflows` → `task_workflow`, пустой/несуществующий каталог → `[]`, дрейф-гард `KNOWN_TASK_FIELDS` ⊇ ключи `createTask` (без лишних имён, `token_usage` как опциональное).
- `src/cli/diagnostics.test.mjs` — 2 кейса: чистая конфигурация → `completeness_config` ok/count 0; фикстура с опечаткой `defualt` → не ok, `warnings[0].kind === 'workflow'`, hint есть, `json.ok` остаётся true.
Проверки: `pnpm build` — ok; полный `pnpm test` — **198 файлов, 3752 passed, 4 skipped** (без `--exclude`/`--skip`); ручной запуск AC4: `vibelog doctor` во временном `mkdtemp`-каталоге с опечатками `defualt`/`clsoe`/`tsak` → `✗ completeness_config: {"count":3, ...}` с текстами «возможно, имелось в виду «default»/«close»/«task»»; на самом репозитории — `completeness_config: {"count":0,"warnings":[]}` (ложных предупреждений нет).
Отклонения от плана: (1) в `KNOWN_TASK_FIELDS` добавлено `token_usage` — `createTask` пишет его только при наличии, поэтому дрейф-гард допускает его как опциональное; (2) исправлен `[object Object]` в `printHuman` — без этого AC4 («предупреждения видны пользователю») выполнялся формально: структура была в `--json`, но в человекочитаемом выводе пользователь видел бесполезную строку.
Что осталось (для фазы Close): CHANGELOG.md и документы (doc-7 раздел `doctor`, doc-6 раздел о неполноте сущности) по правилам фазы Code не обновлялись — это работа Close. `backlog/references/data` в рабочем дереве — не файл этой задачи, не коммитился.
---
author: @agent
created: 2026-11-08 17:26
---
Фаза close не удалась (код выхода 1): блокировок=0, payload последнего запроса=216011 байт (макс 216011), usage={"input_tokens":1389945,"output_tokens":7011,"cache_read_input_tokens":1217536,"total_tokens":1396956,"reasoning_tokens":3461} — статус возвращён к Review.
---
<!-- COMMENTS:END -->