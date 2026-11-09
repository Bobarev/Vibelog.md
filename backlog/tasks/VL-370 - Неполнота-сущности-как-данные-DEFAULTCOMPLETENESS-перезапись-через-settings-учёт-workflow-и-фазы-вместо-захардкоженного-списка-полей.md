---
id: VL-370
title: 'Неполнота сущности как данные: DEFAULT_COMPLETENESS + перезапись через settings, учёт workflow и фазы вместо захардкоженного списка полей'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-08 01:46'
updated_date: '2026-11-09 21:42'
due_date: ''
labels: []
dependencies:
  - VL-369
milestone: v1.13
references: []
priority: high
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/update-pipeline.test.mjs
lessons:
  - lesson-254
token_usage:
  input: 12365669
  output: 90149
  cache: 11026432
  total: 12455818
  requests: 154
  duration_ms: 1757677
  reasoning: 42782
  by_phase:
    plan:
      input: 958259
      output: 16986
      cache: 769024
      requests: 17
    code:
      input: 8659724
      output: 48044
      cache: 7867392
      requests: 84
    close:
      input: 2747686
      output: 25119
      cache: 2390016
      requests: 53
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас «чего не хватает» в ответе write-инструмента считается двумя неверными способами:

**1. Гадание по списку популярных полей.** `missingTaskFields` (`src/mcp/tools.ts:1346`) возвращает `['description','acceptanceCriteria','plan','notes','labels','priority','status']`, отфильтрованный по «не передано в args». Функция не смотрит на состояние задачи: если описание уже есть, а модель его не передала, поле попадёт в `missing` ложно. И наоборот — если описание отсутствует, но модель передала что-то другое, поле в `missing` не попадёт.

**2. Отсутствие расчёта вообще.** `document_update` и `reference_update` не заполняют `missing` ни при каких условиях.

**3. Специфика, зашитая в инструмент.** `lesson_update` считает неполноту через `isLessonBodyUnfilled(current.body)` — это правильно по принципу (от состояния), но реализовано внутри инструмента, а не как общее правило.

## Требование: неполнота зависит от workflow и фазы

Наивный вариант «обязательные поля задачи = описание, критерии, план» ломается на простом workflow. В проекте уже есть механизм простого workflow и шаблон фазы `do`:

- `templates/phases/phase-do.md` прямо говорит: «Фаза Do — самостоятельная реализация: фаз Spec/Plan в этом workflow нет, **поэтому плана в задаче может не быть**».
- `src/core/workflow.test.mjs` содержит фикстуры `simple` и `task_workflows: { bug: 'bugfix', feature: 'default', chore: 'simple', docs: 'simple' }`.
- В `DEFAULT_WORKFLOW` (`src/core/workflow.ts:77`) фазы `do` нет — она существует только через пользовательскую конфигурацию.

Для задачи вида «сделать → проверить → закрыть» критериев приёмки и плана не будет вообще. Инструмент, требующий их, вечно сообщал бы о неполноте, которой нет.

Значит неполнота — функция трёх вещей: **тип сущности**, **workflow задачи** и **текущая фаза**.

## Механизм: третий уровень той же схемы «дефолт + перезапись»

Проект уже использует этот шаблон дважды, и он работает:

| Что | Дефолт в коде | Перезапись в `.vibelog/settings.json` |
|---|---|---|
| Граф переходов | `DEFAULT_WORKFLOW` (`src/core/workflow.ts:77`) | ключ `workflows` |
| Workflow по типу задачи | `default` | ключ `task_workflows` |
| **Неполнота по фазе** | **новый `DEFAULT_COMPLETENESS`** | **новый ключ `completeness`** |

`loadWorkflows` (`src/core/workflow.ts:129`) уже реализует нужную семантику: отсутствие ключа / битый JSON / невалидная запись → fallback на дефолт, частичная валидность сохраняется (валидные именованные записи остаются, битые выпадают). Новый ключ читается тем же способом, в том же модуле.

### Форма описания

```
completeness: {
  "<workflow>": {
    "<phase>": { "<entity>": ["<field>", ...] }
  }
}
```

Дефолт для `default`-workflow:
- фаза `spec` → задача: `description`
- фаза `plan` → задача: `implementationPlan`
- фаза `close` → задача: все `acceptanceCriteria` и `definitionOfDone` отмечены
- урок (любая фаза) → `content` заполнен (не пустой и не дефолтный скелет)

Дефолт для `simple`-workflow: только `title` и `description`, критериев и плана не требуем.

## Что это меняет в коде

**1. `missingTaskFields` удаляется целиком.** Вместо него — расчёт от состояния сущности с учётом workflow и фазы.

**2. Правило терминального статуса сводится в одну точку.** Сейчас гейт «нельзя закрыть задачу с неотмеченными пунктами» живёт в `writeAutoReportIfMissing` (`src/agent/auto-report.ts:113-145`), а `finalizePhaseStatus` (`src/core/phase-transient.ts:370-378`) его обходит — это ровно та же ошибка «правило в точке вызова вместо ядра», что и в уроках. `terminalStatusGate` уже вынесен в `src/core/workflow.ts` (используется в `auto-report.ts:128`), но второй путь его не зовёт. Оба пути должны читать один источник неполноты.

**3. Для простого workflow гейт терминальности не находит, что проверять** — и это правильное поведение, а не исключение из правила.

**4. Добавление нового workflow — запись в settings**, инструменты не трогаются.

## Связанные задачи

- **VL-369** — общий пайплайн обновления. Эта задача встраивает расчёт неполноты в пайплайн (`completeness(e, ctx)` в описании сущности). Зависит от VL-369.
- **VL-371** — пересмотр тестов.

## Риск

Изменение поведения `backlog_update_task`: сейчас `missing` в его ответе — эвристика, после правки — расчёт от состояния. Тесты, закрепляющие текущий список полей, придётся переписать (см. VL-371). Также меняется поведение гейта терминальности для задач в простом workflow — сейчас такого workflow в проекте не включено (в `.vibelog/settings.json` секции `workflows` нет), поэтому действующий проект не затрагивается.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В `src/core/workflow.ts` есть `DEFAULT_COMPLETENESS` и чтение ключа `completeness` из `.vibelog/settings.json` по той же семантике, что `loadWorkflows`: отсутствие ключа / битый JSON / невалидная запись → fallback на дефолт, валидные именованные записи сохраняются
- [x] #2 Для workflow `simple` (фаза `do`) неполнота НЕ требует `acceptanceCriteria` и `implementationPlan` — задача без них считается полной; проверено тестом на фикстуре simple-workflow
- [x] #3 Для `default`-workflow: фаза `spec` требует `description`, фаза `plan` — `implementationPlan`, фаза `close` — все AC и DoD отмечены
- [x] #4 Правило терминального статуса читается из одного источника: `finalizePhaseStatus` (`src/core/phase-transient.ts`) и `writeAutoReportIfMissing` (`src/agent/auto-report.ts`) используют общий расчёт неполноты, второй копии правила нет
- [x] #5 Добавление нового workflow с другим набором обязательных полей — запись в `.vibelog/settings.json`, без правки кода инструментов; проверено тестом с кастомным workflow
- [x] #6 `pnpm build && pnpm test` зелёный; действующий проект (без секции `workflows` в settings) не меняет поведения
- [x] #7 Документация обновлена: doc-6 (секция workflow — ключ `completeness`), doc-8 (расчёт missing), doc-10 §6, CHANGELOG.md
- [x] #8 Неполнота считается от СОСТОЯНИЯ сущности с учётом workflow задачи и текущей фазы; эвристика `TASK_SUGGEST`/`isEmptyTaskField` (`src/mcp/tools.ts:1309-1345`) и жёсткий `taskSpec.completeness` удалены
- [x] #9 Правило `'*'` в `DEFAULT_COMPLETENESS` содержит `task: ['description']`, поэтому задача без описания неполна и при неизвестной фазе (`phase === null`); контрактный тест `PARTIAL_SCENARIOS` (`write-ack-contract.test.mjs`) остаётся зелёным БЕЗ правок — сценарий `backlog_update_task` без env фазы даёт `partial` + `missing[0].field === 'description'`
- [x] #10 Fallback на `default` НЕ протекает в объявленный кастомный workflow: если имя workflow есть в settings, но записи в `completeness` нет — набор правил пуст (проверено тестом на `investigation`-подобном workflow)
- [x] #11 Пустой чеклист считается ПОЛНЫМ: задача без AC и DoD не попадает в `missing` по этим полям (проверено тестом)
- [x] #12 `terminalStatusGateForTask` раскладывает `missing` в номера через `CompletenessField.numbers`; существующий экспорт `terminalStatusGate` сохранён и вызывается изнутри (тесты и doc-10 §6 не ломаются)
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

Неполнота сущности становится ДАННЫМИ: `DEFAULT_COMPLETENESS` (workflow → фаза → сущность → поля) + перезапись ключом `completeness` в `.vibelog/settings.json`, тем же способом, каким уже читаются `workflows`/`task_workflows`. `missing` в ответе write-инструментов и гейт терминального статуса читают ОДИН источник.

Тип: enhancement. Правок кода в фазе Plan нет — только план.

## Проверенные точки в коде (актуальные номера строк)

| Файл | Место | Что там сейчас |
|---|---|---|
| `src/core/workflow.ts` | 77-100 | `DEFAULT_WORKFLOW` |
| `src/core/workflow.ts` | 129-155 | `loadWorkflows` — образец fallback-семантики |
| `src/core/workflow.ts` | 160-180 | `getWorkflowName` / `getWorkflowForTask` |
| `src/core/workflow.ts` | 330-384 | `isTerminalStatus`, `TerminalStatusGateResult`, `terminalStatusGate` |
| `src/mcp/update-pipeline.ts` | 154-235 | `runUpdate`: шаги 6 (noop) и 8 (partial) зовут `spec.completeness` (строки 206 и 227) |
| `src/mcp/tools.ts` | 1309-1345 | `TASK_SUGGEST` + `isEmptyTaskField` (остатки прежней эвристики) |
| `src/mcp/tools.ts` | 1420-1432 | `taskSpec.completeness` — ЖЁСТКО `description` |
| `src/mcp/tools.ts` | 1762-1779 | `resolveGuardPhase(cwd)` — единственный доверенный источник фазы (env рана → мета сессии) |
| `src/mcp/tools.ts` | 2493, 2715 | `completeness: () => []` у document/reference (осознанно пусто) |
| `src/mcp/tools.ts` | 2939-2948 | `lessonSpec.completeness` — `isLessonBodyUnfilled` (по принципу верно, но локально) |
| `src/core/phase-transient.ts` | 370-400 | `finalizePhaseStatus`: локальный расчёт `uncheckedAcNumbers`/`uncheckedDodNumbers` + `terminalStatusGate` |
| `src/agent/auto-report.ts` | 96-151 | `writeAutoReportIfMissing`: ВТОРАЯ копия того же расчёта + `terminalStatusGate` |
| `src/core/workflow.test.mjs` | 40-130 | фикстуры `named` (simple/bugfix), `project()` |
| `src/mcp/update-pipeline.test.mjs` | 1-234 | таблица исходов VL-369 |
| `src/mcp/write-ack-contract.test.mjs` | 545-549 | сценарий `backlog_update_task` в `PARTIAL_SCENARIOS` (VL-369) — **без env фазы** |

`missingTaskFields` в коде уже отсутствует (удалён VL-369); остались `TASK_SUGGEST`/`isEmptyTaskField` и жёсткий `completeness` — их снимаем здесь. AC2 переформулирован соответственно.

## КРИТИЧНО: правило `'*'` обязано содержать `task: ['description']`

Первая редакция плана описывала `'*': { lesson: ['content'] }` — без task-полей. Тогда при `phase === null` (ручной вызов MCP, чужой клиент, тесты без env) набор task-полей пуст → `missing: []` → задача всегда полная → `outcome: 'applied'`.

Это **роняет** контрактный тест VL-369 (`src/mcp/write-ack-contract.test.mjs:545-549`): сценарий вызывает `backlog_update_task` без env фазы, а тест `AC4: сценарии возвращают outcome=partial` требует `partial` + `missing[0].field === 'description'`.

**Решение:** `'*'` содержит и task-, и lesson-правила:

```ts
'*': { task: ['description'], lesson: ['content'] }
```

Обоснование продуктовое, а не «чтобы тест прошёл»: задача без описания неполна в любой фазе. Это снимает зависимость ответа от того, известна ли фаза, — поведение становится предсказуемым.

## Пробел: fallback на `default` не должен протекать в кастомный workflow

Первая редакция: `rules = map[name] ?? map.default`. Для действующего проекта `task_workflows: { investigation: 'investigation' }`, записи `investigation` в `completeness` нет → fallback на `default` → investigation получил бы дефолтные правила (включая новый `'*'` с `task: ['description']`) → **AC7 нарушился бы**.

**Решение:** fallback на `default` — только если workflow НЕ объявлен в settings. Если объявлен, но записи в `completeness` нет — набор пуст (пользователь не настроил; дефолт не протекает). Согласуется с уже принятой мердж-семантикой «запись workflow заменяет дефолтную целиком».

```ts
// loadWorkflows уже знает, какие имена объявлены в settings
const declared = Object.keys(loadWorkflows(cwd).workflows);   // всегда содержит 'default'
const entry = declared.includes(name) && name !== 'default'
  ? (map[name] ?? {})      // объявлен пользователем, своих правил нет → пусто
  : (map[name] ?? map.default);
```

## Пробел: обратное преобразование в `terminalStatusGate`

Первая редакция не описала, как `terminalStatusGateForTask` вызывает существующую `terminalStatusGate(workflow, targetStatus, uncheckedAc: number[], uncheckedDod: number[], prevStatus)`.

**Решение (простое, фиксируется в плане):** фильтрация по именам полей, без магии:

```ts
const numbers = (field: string): number[] =>
  missing
    .filter(m => m.field === field && Array.isArray(m.numbers))
    .flatMap(m => m.numbers ?? []);
```

Значит `CompletenessField` расширяется опциональным `numbers?: number[]` — `taskCompletenessMissing` заполняет его для `acceptanceCriteria`/`definitionOfDone`. Это единственное место, где код знает про эти два поля; больше нигде знание не дублируется.

## Пробел: пустой чеклист — это «полный»

Правило `close: { task: ['acceptanceCriteria', 'definitionOfDone'] }` с семантикой «все пункты отмечены». Если AC у задачи **нет вовсе** — считать полной (нечего отмечать), иначе simple-workflow и задачи без чеклиста навсегда останутся неполными.

**Фиксируется явно + тест:** пустой массив → `[-]` (нет missing). То же для DoD.

## Архитектурное решение

### 1. `src/core/workflow.ts` — новые типы и источник данных

```ts
/** Поля, отсутствие которых означает неполноту: workflow → фаза → сущность → поля. */
export type CompletenessMap = Record<string, Record<string, Record<string, string[]>>>;

export const DEFAULT_COMPLETENESS: CompletenessMap = {
  default: {
    spec:  { task: ['description'] },          // избыточно при '*' с description, но фиксирует намерение фазы
    plan:  { task: ['implementationPlan'] },
    close: { task: ['acceptanceCriteria', 'definitionOfDone'] },
    '*':   { task: ['description'], lesson: ['content'] },
  },
  simple: {
    do:    { task: ['description'] },          // AC/плана НЕ требуем (AC3)
    '*':   { task: ['description'], lesson: ['content'] },
  },
};
```

- `'*'` в позиции фазы — правило для любой фазы; при наличии конкретной фазовой записи наборы **объединяются** (`phase` + `'*'`, дедуп).
- Смысл полей: `acceptanceCriteria`/`definitionOfDone` — «все пункты отмечены, пустой список = полно»; остальные — «значение непустое» (строка не из пробелов, массив непуст).

Новые функции в `workflow.ts` (модуль остаётся единственным источником, не тянет `node:fs` в веб-клиент):

```ts
function isValidCompletenessEntry(value: unknown): value is Record<string, Record<string, string[]>>
export function loadCompleteness(cwd: string): CompletenessMap
export function getCompletenessRules(cwd: string, task: Task, phase: string | null): { task: string[]; lesson: string[] }
export interface CompletenessField { field: string; reason: string; numbers?: number[] }
export function taskCompletenessMissing(task: Task, fields: string[]): CompletenessField[]
export function terminalStatusGateForTask(cwd, task, targetStatus, phase, prevStatus): TerminalStatusGateResult
```

Семантика `loadCompleteness` (AC1) — как `loadWorkflows`: нет файла/ключа, битый JSON → `DEFAULT_COMPLETENESS`; валидные именованные записи сохраняются, битые выпадают; запись workflow из settings **полностью заменяет** одноимённую дефолтную (не сливается по фазам).

`getCompletenessRules`:
- имя workflow — через `getWorkflowName(cwd, task)`;
- набор — `map[name]` либо `map.default` (правило fallback выше);
- `phase` + `'*'` объединяются; `phase === null` → только `'*'`;
- нет правил → пустые массивы (задача полная).

`terminalStatusGateForTask` внутри зовёт `terminalStatusGate` (существующий экспорт сохраняется — его вызывают тесты и он описан в doc-10 §6), раскладывая `missing` в номера через `numbers`.

### 2. `src/mcp/update-pipeline.ts` — контекст в `completeness`

- `export interface UpdateContext { cwd: string; phase: string | null }`.
- `EntitySpec.completeness?(entity: E, ctx: UpdateContext): SkippedField[]`.
- `EntitySpec.resolvePhase?(cwd: string): string | null` — по умолчанию `null`; `runUpdate` вычисляет `const phase = spec.resolvePhase?.(cwd) ?? null` и передаёт `{ cwd, phase }` в ОБА места вызова (строки 206 и 227).
- Источник фазы — только `resolveGuardPhase`; `args.phase` не читается (аргумент модели не может ослабить проверку).

### 3. `src/mcp/tools.ts`

- Удалить `TASK_SUGGEST` и `isEmptyTaskField` (1309-1345). Noop-подсказка «какие ещё поля можно передать» — из `taskCompletenessMissing(entity, rules.task)`.
- `taskSpec`: `resolvePhase: resolveGuardPhase`; `completeness: (entity, ctx) => taskCompletenessMissing(entity, getCompletenessRules(ctx.cwd, entity, ctx.phase).task)`; `next` — `retryWith` с правильным именем аргумента (`implementationPlan` → `plan`); `noopHint` — из того же расчёта.
- `lessonSpec`: `isLessonBodyUnfilled` остаётся, но набор полей берётся из правил (`getCompletenessRules(...).lesson`) — `content` приходит из данных, а не из литерала.
- `documentSpec`/`referenceSpec`: остаются `completeness: () => []`; в комментарии сослаться на `DEFAULT_COMPLETENESS` (для них правила не объявлены).

### 4. `src/core/phase-transient.ts` (370-400) и `src/agent/auto-report.ts` (96-151)

Обе копии расчёта `uncheckedAcNumbers`/`uncheckedDodNumbers` + `terminalStatusGate` заменяются одним вызовом `terminalStatusGateForTask`. Локальные `isChecked`-лямбды удаляются. Тексты отчёта сохраняются байт-в-байт (`auto-report.test.mjs`, `phase-transient.test.mjs` — регресс-барьер); при блокировке причина по-прежнему из `gate.reason`, исход `failed`.

## Порядок действий

1. `src/core/workflow.ts`: типы, `DEFAULT_COMPLETENESS`, `loadCompleteness`, `getCompletenessRules`, `taskCompletenessMissing`, `terminalStatusGateForTask`. Шапка модуля — третий уровень схемы «дефолт + перезапись» и формат `completeness`.
2. `src/mcp/update-pipeline.ts`: `UpdateContext`, `resolvePhase`, передача контекста в оба места.
3. `src/mcp/tools.ts`: удалить эвристику, `taskSpec`/`lessonSpec` на правилах, `resolvePhase: resolveGuardPhase`.
4. `src/core/phase-transient.ts` и `src/agent/auto-report.ts`: убрать дубли, звать `terminalStatusGateForTask`.
5. Тесты:
   - `src/core/workflow.test.mjs`: `DEFAULT_COMPLETENESS` для default/simple; `loadCompleteness` — нет ключа / битый JSON / битая запись → fallback, валидные именованные сохраняются; `getCompletenessRules`: simple+do → `['description']` (+`'*'`), `phase: null` → `['description']` из `'*'`, объявленный-но-не-настроенный workflow → пусто; `taskCompletenessMissing`: close с отмеченными/неотмеченными AC/DoD, **пустой чеклист → пусто** (`numbers` не заполняется); `terminalStatusGateForTask`: simple при неотмеченных AC/DoD не блокирует.
   - `src/mcp/update-pipeline.test.mjs`: фикстура `workflows.simple` + `task_workflows: { chore: 'simple' }` → задача без AC и плана в фазе `do` даёт `applied` (AC3); кастомный workflow с другим набором → `missing` называет его поля (AC6); default в фазе `plan` → `missing: implementationPlan`; **без env фазы** — `missing: description` из `'*'` (совместимость с контрактным тестом VL-369).
   - `src/mcp/write-ack-contract.test.mjs`: блок `PARTIAL_SCENARIOS` должен остаться зелёным без правок (сценарий `backlog_update_task` без env фазы → `partial` + `description`) — это регресс-барьер на правило `'*'`.
   - `src/core/phase-transient.test.mjs` / `src/agent/auto-report.test.mjs`: поведение и текст при блокировке не изменились.
6. Документация: doc-6 (секция workflow — ключ `completeness`, формат и пример simple), doc-8 (таблица `EntitySpec` + раздел `missing`: от состояния, с учётом workflow/фазы), doc-10 §6 (гейт и директива читают один источник), `CHANGELOG.md`.

## Как проверить

```bash
pnpm build && pnpm test
npx vitest run src/core/workflow.test.mjs src/mcp/update-pipeline.test.mjs \
  src/mcp/write-ack-contract.test.mjs src/core/phase-transient.test.mjs src/agent/auto-report.test.mjs
# действующий проект не меняет поведения (investigation без записи в completeness):
node -e "const s=require('fs').readFileSync('.vibelog/settings.json','utf8'); console.log(JSON.parse(s).completeness ?? 'нет ключа — работает DEFAULT_COMPLETENESS')"
```
Полный `pnpm test` обязателен для DoD; частичный прогон DoD не закрывает.

## Риски и митигации

1. **Фаза не резолвится** (ручной MCP-вызов, чужой клиент): `resolvePhase` → `null`, работают правила `'*'` — задача без описания остаётся неполной (`partial`), с описанием — полной. Поведение предсказуемо и не зависит от фазы (см. раздел «КРИТИЧНО»).
2. **Изменение ответов `backlog_update_task`**: задача без `description` даёт `partial` с `missing` в любой фазе. Это ожидаемое поведение; контрактный тест VL-369 (`PARTIAL_SCENARIOS`) — регресс-барьер.
3. **Действующий проект** (`workflows.investigation`, `task_workflows: {investigation}`): запись `investigation` объявлена в settings, но не в `completeness` → набор пуст → `missing: []`, поведение не меняется (AC7). Проверяется тестом `getCompletenessRules` на «объявленный-но-не-настроенный workflow → пусто».
4. **Мердж-семантика перезаписи**: запись workflow из settings заменяет дефолтную целиком, не сливается по фазам — иначе дефолт протекал бы в пользовательскую конфигурацию. Зафиксировано в комментарии и покрыто тестом.
5. **Двойной источник текста причины**: тексты собираются только в `taskCompletenessMissing`/`terminalStatusGate`; в `auto-report.ts` и `phase-transient.ts` остаётся лишь `gate.reason`. Проверяется регресс-тестами (lesson-250).
6. **Циклические импорты**: `core/workflow.ts` импортирует только `./settings.js` и тип `Task`; новые функции остаются там же.
7. **`numbers` в `CompletenessField`** — единственное место, где код знает про `acceptanceCriteria`/`definitionOfDone` как про чеклисты. Если появится третье поле-чеклист, оно пополнит этот список, а не размножит фильтрацию по файлам.

## Границы задачи

Код пишет фаза Code. Пересмотр тестов класса «модель крутится на повторах» — VL-371 (не относится). Правок `.vibelog/settings.json` проекта не требуется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 10:35
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, не epic) — план записан в Implementation Plan VL-370.
Что изучено (адресно, 8 файлов): `src/core/workflow.ts` (`DEFAULT_WORKFLOW`, `loadWorkflows` — образец семантики fallback, `getWorkflowName`/`getWorkflowForTask`, `isTerminalStatus`+`terminalStatusGate`), `src/mcp/update-pipeline.ts` (`EntitySpec`, два вызова `spec.completeness` в шагах 6 и 8), `src/mcp/tools.ts` (эвристика `TASK_SUGGEST`/`isEmptyTaskField`, `taskSpec.completeness`, `resolveGuardPhase` как доверенный источник фазы, `lessonSpec.completeness`, `documentSpec`/`referenceSpec`), `src/core/phase-transient.ts:370-400` и `src/agent/auto-report.ts:96-151` (две копии расчёта `uncheckedAc/Dod` + `terminalStatusGate`), фикстуры `src/core/workflow.test.mjs`, таблица исходов `src/mcp/update-pipeline.test.mjs`, формат `.vibelog/settings.json`.
Решение в плане (7 файлов src + 4 файла документации):
1. `src/core/workflow.ts` — `CompletenessMap`, `DEFAULT_COMPLETENESS` (default: spec→description, plan→implementationPlan, close→все AC/DoD отмечены; simple: do→title+description), `loadCompleteness` с fallback-семантикой `loadWorkflows`, `getCompletenessRules(cwd, task, phase)`, единый `taskCompletenessMissing(task, fields)` и `terminalStatusGateForTask(...)`, который зовёт существующую `terminalStatusGate` внутри.
2. `src/mcp/update-pipeline.ts` — `UpdateContext {cwd, phase}` в `EntitySpec.completeness` + `resolvePhase` (фаза только из `resolveGuardPhase`, `args.phase` не читается).
3. `src/mcp/tools.ts` — удаление `TASK_SUGGEST`/`isEmptyTaskField`, `taskSpec`/`lessonSpec` на правилах, document/reference остаются `[]`.
4. `src/core/phase-transient.ts` и `src/agent/auto-report.ts` — локальные копии расчёта заменяются одним `terminalStatusGateForTask`; тексты отчёта сохраняются байт-в-байт (регресс-тесты обоих файлов — барьер, lesson-250).
5. Тесты: `workflow.test.mjs` (дефолты, fallback/битые записи, simple+do, close с AC/DoD, гейт не блокирует simple), `update-pipeline.test.mjs` (simple-workflow → applied без AC/плана — AC3, кастомный workflow — AC6, plan-фаза → missing implementationPlan).
6. Документация: doc-6 (ключ `completeness`), doc-8 (расчёт `missing`), doc-10 §6, CHANGELOG.
Проверка: `pnpm build && pnpm test` + точечный прогон 4 тест-файлов; полный прогон обязателен для DoD.
Риски: нерезолвящаяся фаза → только правила `'*'` (консервативно «полная»); изменение ответов `backlog_update_task` в фазе plan (ожидаемо, тесты переписывает VL-371); действующий проект не меняет поведения (в settings `workflows` только `investigation`, у него нет spec/plan/close → пустой набор полей, AC7). Правок кода в Plan нет, git-операции не выполнялись.
---
author: @agent
created: 2026-11-08 10:57
---
## План пересмотрен после проверки против кода
Найдена **одна блокирующая проблема** и три пробела. План обновлён, AC переформулированы (было 8, стало 12).
### 1. БЛОКИРУЮЩЕЕ: правило `'*'` роняло контрактный тест VL-369
Первая редакция: `'*': { lesson: ['content'] }` — без task-полей. Тогда при `phase === null` набор task-полей пуст → `missing: []` → задача всегда полная → `outcome: 'applied'`.
VL-369 только что добавила в `src/mcp/write-ack-contract.test.mjs:545-549` сценарий:
```js
backlog_update_task: async () => {
  const t = createTaskFile(cwd, { title: 'Partial-задача VL-369' });
  return handleToolCall('backlog_update_task', { id: t.id, priority: 'High' }, cwd);
},
```
Он вызывается **без env фазы**, а тест `AC4: сценарии возвращают outcome=partial` требует `partial` + `missing[0].field === 'description'`. Первая редакция плана дала бы `applied` → **красный тест**.
Исправлено: `'*': { task: ['description'], lesson: ['content'] }`. Обоснование продуктовое — задача без описания неполна в любой фазе, ответ не зависит от того, известна ли фаза.
### 2. Пробел: fallback на `default` протекал в кастомный workflow
Первая редакция: `rules = map[name] ?? map.default`. Для действующего проекта (`task_workflows: {investigation: 'investigation'}`, записи в `completeness` нет) investigation получил бы дефолтные правила, включая новый `'*'` с `description` → **AC7 («действующий проект не меняет поведения») нарушился бы**.
Исправлено: fallback на `default` — только если workflow НЕ объявлен в settings. Объявлен, но не настроен → набор пуст.
### 3. Пробел: не описано обратное преобразование в `terminalStatusGate`
`terminalStatusGateForTask` получает `CompletenessField[]`, а `terminalStatusGate` ждёт `uncheckedAc: number[], uncheckedDod: number[]`. Как разложить — не было описано.
Исправлено: `CompletenessField` получает опциональный `numbers?: number[]`, заполняемый для `acceptanceCriteria`/`definitionOfDone`. `terminalStatusGateForTask` фильтрует `missing` по имени поля и собирает номера. Это единственное место, где код знает про эти два поля как про чеклисты.
### 4. Пробел: поведение пустого чеклиста не задано
Если AC у задачи нет вовсе — «все отмечены» (полная) или «неполная»? Наивная реализация сломала бы simple-workflow.
Исправлено: пустой список → полный (нечего отмечать). Зафиксировано в плане и покрыто тестом.
### 5. AC2 устарел
Формулировка «`missingTaskFields` (`src/mcp/tools.ts:1346`) удалён» — функция **уже удалена** VL-369. Критерий засчитался бы выполненным до начала работы. Переформулирован на `TASK_SUGGEST`/`isEmptyTaskField` (`:1309-1345`), которые действительно остались и действительно снимаются здесь.
### Добавлен регресс-барьер
В план внесён пункт: `write-ack-contract.test.mjs` — блок `PARTIAL_SCENARIOS` должен остаться зелёным **без правок**. Это механическая защита от повторения проблемы №1 при реализации.
### Проверено по коду (все ссылки верны)
`DEFAULT_WORKFLOW` (`workflow.ts:77-100`), `loadWorkflows` (`:129-155`), `getWorkflowName`/`getWorkflowForTask` (`:160-180`), `isTerminalStatus`/`terminalStatusGate` (`:330-384`), `runUpdate` зовёт `completeness` на строках 206 и 227, `TASK_SUGGEST`/`isEmptyTaskField` (`tools.ts:1309-1345`), `taskSpec.completeness` (`:1420-1432`), `resolveGuardPhase` (`:1762-1779`, не экспортируется, но доступна из `taskSpec` в том же файле), `lessonSpec.completeness` (`:2939-2948`), обе копии расчёта (`phase-transient.ts:370-400`, `auto-report.ts:96-151`).
`.vibelog/settings.json` проверен: `workflows: {investigation}`, `task_workflows: {investigation: 'investigation'}` — именно тот случай, который описан в риске 3.
---
author: @agent
created: 2026-11-08 11:15
---
Фаза 3 (Code) выполнена. Коммит 34a3bea.
## Изменено (8 файлов)
**`src/core/workflow.ts`** — новый третий уровень схемы «дефолт + перезапись»:
- `CompletenessMap` + `DEFAULT_COMPLETENESS`: `default` → `spec: task:[description]`, `plan: task:[implementationPlan]`, `close: task:[acceptanceCriteria, definitionOfDone]`, `'*': {task:[description], lesson:[content]}`; `simple` → `do: task:[description]`, `'*'` то же.
- `loadCompleteness(cwd)` — семантика `loadWorkflows`: нет ключа / битый JSON / невалидная запись → дефолт; валидные именованные записи сохраняются, запись workflow заменяет одноимённую дефолтную ЦЕЛИКОМ (не сливается по фазам).
- `getCompletenessFields(cwd, workflowName, phase, entity)` — объединение записи фазы и `'*'` без дублей; `phase === null` → только `'*'`. Fallback на `default` только если workflow НЕ объявлен в settings (AC10: объявленный-но-не-настроенный → пусто).
- `getCompletenessRules(cwd, task, phase)` — обёртка с `getWorkflowName`.
- `CompletenessField {field, reason, numbers?}`, `isEmptyFieldValue`, `isCheckedItem`, `FIELD_LABELS`, `taskCompletenessMissing(task, fields)` — расчёт ОТ СОСТОЯНИЯ; пустой чеклист = полный (AC11); `numbers` заполняется только для AC/DoD.
- `terminalStatusGateForTask(cwd, task, targetStatus, phase, prevStatus)` — зовёт существующий `terminalStatusGate` (экспорт сохранён, AC12).
**`src/mcp/update-pipeline.ts`** — `UpdateContext {cwd, phase}`, `completeness?(entity, ctx)`, `resolvePhase?(cwd)`, `noopHint?(..., ctx)`; `runUpdate` резолвит фазу из доверенного источника (не из `args.phase`) и передаёт ctx в оба места (noop и partial).
**`src/mcp/tools.ts`** — удалены `TASK_SUGGEST` и `isEmptyTaskField`; добавлены `FIELD_TO_ARG` (поле→аргумент: `implementationPlan`→`plan`) и `taskMissing`; `taskSpec` = `resolvePhase: resolveGuardPhase` + `completeness` из правил + `next` с готовым `retryWith` + `noopHint` из того же расчёта; `lessonSpec.completeness` берёт набор полей из `getCompletenessFields(cwd,'default',phase,'lesson')`, предикат `isLessonBodyUnfilled` сохранён; document/reference остались `[]` (правила для них не объявлены).
**`src/agent/auto-report.ts`, `src/core/phase-transient.ts`** — локальные копии расчёта `uncheckedAcNumbers`/`uncheckedDodNumbers` удалены, оба пути зовут `terminalStatusGateForTask` (AC4). В авто-репорте `isChecked` остался только для статистики «отмечено N из M», не для правила.
**Тесты:** `src/core/workflow.test.mjs` (+15 кейсов: дефолты, fallback/битые записи, замена целиком, simple+do, кастомный strict, AC10 investigation-подобный, пустой чеклист, gate simple не блокирует / default блокирует с тем же текстом); `src/mcp/update-pipeline.test.mjs` (+5: simple-workflow applied без AC/плана, simple без описания → partial только description, кастомный workflow → labels+priority, неизвестная фаза → description из `'*'`); `src/mcp/write-ack.test.mjs` — ожидание `acceptanceCriteria` в noop-hint заменено на «description есть, AC вне close не требуются» (прежнее закрепляло удалённую эвристику; это единственная правка существующего теста).
## Проверки
- `pnpm build` — чисто.
- **Полный `pnpm test` — 198 файлов, 3718 passed, 4 skipped, 0 failed.** Исключений и `--skip` не было. Промежуточный прогон поймал одно падение (`write-ack.test.mjs`, VL-326) — классифицировано как ожидаемое изменение поведения (эвристика удалена) и переписано; повторный полный прогон зелёный.
## Что осталось / замечания
- AC7 (документация: doc-6, doc-8, doc-10 §6, CHANGELOG) — **не отмечен**: правки документов в фазе Code запрещены, их пишет Close.
- Проект `.vibelog/settings.json` не менялся: `workflows: {investigation}` объявлен, записи в `completeness` нет → набор полей пуст, поведение действующего проекта сохранено (проверено тестом AC10).
- Риск VL-371: тесты, закреплявшие прежний список полей, переписаны здесь минимально (один кейс); систематический пересмотр — за VL-371.
---
author: @agent
created: 2026-11-08 11:36
---
Фаза Close прервана: merge vb/vl-370 слит в master (bb0ba39, 1 коммит), сборка `pnpm build` прошла чисто, но полный `pnpm test` красный — 5 падений в `src/mcp/update-pipeline.test.mjs` (197 файлов passed, 1 failed; 3713 passed, 5 failed, 4 skipped).
**Классификация (обязательная по протоколу Close):**
1. Тот же набор на родительском коммите `HEAD^1` (01f84bf) — зелёный: `src/mcp/update-pipeline.test.mjs` 14/14 passed. Пре-существующего красного нет → это регрессия ветки VL-370.
2. Параллельного vitest в другом worktree нет (`ps aux | grep vitest` пусто).
3. Повторный полный прогон с вычищенным env фазы (`env -u VIBELOG_PHASE_NAME -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_TASK_ID …`) — **198 файлов passed, 3718 passed, 0 failed**. То есть падения воспроизводятся ТОЛЬКО при унаследованном env агентской сессии.
**Причина (воспроизводимая):** `src/mcp/update-pipeline.test.mjs` вызывает `handleToolCall` in-process и в блоках VL-369 НЕ изолирован от env сессии. Агентская сессия выставляет `VIBELOG_PHASE_NAME=close` / `VIBELOG_RUN_PHASE=close`; `resolveGuardPhase` в VL-370 начинает видеть фазу `close`, и правила `DEFAULT_COMPLETENESS.default.close` требуют отмеченных AC/DoD. Фикстура теста (`definition_of_done: ['Тесты проходят']`, задачи с неотмеченным DoD) поэтому даёт `missing: [{field:'definitionOfDone', numbers:[1]}]` и `outcome: 'partial'` вместо `applied`. Падающие кейсы: «записали + полная → applied», «записали + неполная → partial…» (ожидала `description`, получила `definitionOfDone`), «нечего менять + полная → noop без missing», «нечего менять + неполная → noop + missing», «AC11 повторное дописывание меняет файл». Блок VL-370 в том же файле env уже чистит (строки 265-268) — блоки VL-369, написанные ранее, этого не делают. Это ровно класс lesson-88/113/120 (VL-116/VL-259): тест, читающий `process.env` в процессе, обязан изолировать env фазы.
**Что нужно сделать, чтобы повторить Close:** новая фаза Code по VL-370 (или отдельная задача) должна изолировать env в `src/mcp/update-pipeline.test.mjs` — в `beforeAll` блоков VL-369 сохранить/удалить `VIBELOG_PHASE_NAME`, `VIBELOG_RUN_PHASE`, `VIBELOG_PHASE_TASK_ID` (по образцу уже существующего блока VL-370, строки 265-268, с восстановлением в `afterAll`), либо перевести все вызовы в файле на общий хелпер из `src/test-env.mjs`. Правки кода в фазе Close запрещены, поэтому тест не тронут.
**Состояние репозитория:** merge выполнен и НЕ откатывался (`git merge --abort` не делался). Worktree `.vibelog/worktrees/vl-370` и ветка `vb/vl-370` сохранены (шаги уборки не выполнялись) — уборку делать после исправления. DoD не отмечался, статус не менялся, документация (doc-6/doc-8/doc-10/CHANGELOG) не писалась. В commit bb0ba39 влиты все 8 файлов задачи.
---
author: @agent
created: 2026-11-08 11:37
---
Фаза close прервана агентом (aborted): Фаза Close прервана: merge vb/vl-370 слит в master (bb0ba39, 1 коммит), сборка `pnpm build` прошла чисто, но полный `pnpm test` красный — 5 падений в `src/mcp/update-pipeline.test.mjs` (197 файлов passed, 1 failed; 3713 passed, 5 failed, 4 skipped).
**Классификация (обязательная по протоколу Close):**
1. Тот же набор на родительском коммите `HEAD^1` (01f84bf) — зелёный: `src/mcp/update-pipeline.test.mjs` 14/14 passed. Пре-существующего красного нет → это регрессия ветки VL-370.
2. Параллельного — статус возвращён к Review.
---
author: @agent
created: 2026-11-08 11:51
---
## Close упал: 5 падений в `update-pipeline.test.mjs` — тест зависит от фазы рана
### Что произошло
Close слил ветку (`bb0ba39`), `pnpm build` чистый, полный `pnpm test` красный — 5 падений. Повтор с очищенным фазовым env: 3718 passed, 0 failed. **Код верен, тест зависит от окружения.**
### Точная механика
`src/mcp/update-pipeline.test.mjs` вызывает `handleToolCall` **in-process**. После этой задачи неполнота задачи зависит от фазы (`getCompletenessRules` ← `resolveGuardPhase` ← `VIBELOG_PHASE_NAME`). Внутри агентской фазы Close наследуется `VIBELOG_PHASE_NAME=close`, применяются правила `DEFAULT_COMPLETENESS.default.close` (`acceptanceCriteria` + `definitionOfDone`).
Усугубляет `src/core/store.ts:99-103`: `createTaskFile` подставляет дефолты `config.definition_of_done` как **неотмеченные**. В тестовом конфиге это `['Тесты проходят']` → каждая фикстура имеет неотмеченный DoD → в фазе `close` неполны ВСЕ задачи, а не только те, где тест явно оставил DoD неотмеченным.
Падают ожидания `applied`: `:57`, `:75`, `:213`, плюс кейсы в блоках AC5/AC10, где `outcome` проверяется мягче и проходит.
### Где дефект
Env чистится **только** внутри `describe('VL-370 — неполнота как данные')` (стр. 264-268). Блоки VL-369 лежат на верхнем уровне файла и работают с унаследованным env. Частичная изоляция — причина падения.
Это класс lesson-88/113/120. `src/test-env.mjs` (`testSpawnEnv`, VL-286) покрывает только **спавн** дочерних процессов, не in-process. Системная часть вынесена в **VL-374**.
### Что сделать в этой задаче (Code)
1. Перенести очистку фазового env с `beforeAll` внутри VL-370-describe на **уровень файла** (`beforeAll`/`afterAll` верхнего уровня), как сделано в `src/mcp/write-ack-contract.test.mjs:48-55` — это образец в проекте.
2. Если VL-374 будет реализована раньше — взять хелпер из `src/test-env.mjs` вместо ручного `delete process.env[...]`.
3. Проверить прогоном **внутри фазы close**: `VIBELOG_PHASE_NAME=close npx vitest run src/mcp/update-pipeline.test.mjs` и полный `pnpm test` с тем же env.
### Замечание по процессу
При проверке плана этой задачи (см. комментарий выше) я выписал риск «изменение ответов `backlog_update_task` в фазе plan» — и не распространил его на фазу `close` и на env-изоляцию тестов. Проверка плана была неполной: искал расхождения план↔код, но не влияние на существующий набор тестов при прогоне внутри разных фаз.
### Состояние после падения
Merge не откатывался (`bb0ba39` в master), worktree и ветка сохранены, DoD/статус/документация не тронуты. AC6 («`pnpm test` зелёный») формально не закрыт — закрывать только после зелёного прогона внутри фазы.
---
author: @agent
created: 2026-11-08 11:55
---
Фаза 3 (Code, повтор после падения Close) выполнена. Коммит eb1a21e.
## Причина падения (подтверждена)
Не код, а тест, зависящий от окружения. `src/mcp/update-pipeline.test.mjs` зовёт `handleToolCall` **in-process**; после VL-370 неполнота зависит от фазы (`getCompletenessRules` ← `resolveGuardPhase` ← `VIBELOG_PHASE_NAME`). Внутри фазы Close наследовался `VIBELOG_PHASE_NAME=close` → применялись правила `DEFAULT_COMPLETENESS.default.close` (`acceptanceCriteria` + `definitionOfDone`), а `createTaskFile` (`src/core/store.ts:99-103`) подставляет `config.definition_of_done` НЕотмеченными — неполной становилась КАЖДАЯ фикстура. Env чистился только внутри `describe('VL-370 …')`, блоки VL-369 на верхнем уровне файла работали с унаследованным env. Класс lesson-88/113/120; `testSpawnEnv` (VL-286) не подходит — вызовы in-process, не спавн.
## Изменено (1 файл)
`src/mcp/update-pipeline.test.mjs`:
- очистка фазового env перенесена в `beforeAll`/`afterAll` **верхнего уровня файла** (по образцу `src/mcp/write-ack-contract.test.mjs:48-55`): снимаются `VIBELOG_CWD`, `VIBELOG_SESSION_ID` и все ключи с префиксами `VIBELOG_PHASE_`/`VIBELOG_RUN_` (префиксы, а не перечисление — новые переменные оркестратора не потребуют правок), сохранённые значения возвращаются в `afterAll`;
- дублирующая очистка внутри VL-370-describe удалена — локальная заплатка маскировала ту же дыру у соседних блоков (частичная изоляция и была причиной падения).
- Код фазы (workflow.ts / tools.ts / update-pipeline.ts / auto-report.ts / phase-transient.ts) не менялся — правка была только в тесте.
## Проверки
- `VIBELOG_PHASE_NAME=close VIBELOG_RUN_PHASE=close npx vitest run src/mcp/update-pipeline.test.mjs src/mcp/write-ack.test.mjs src/mcp/write-ack-contract.test.mjs` → 3 файла, 81 passed, 0 failed (воспроизведение исходного падения устранено).
- `VIBELOG_PHASE_NAME=close VIBELOG_RUN_PHASE=close pnpm test` → **198 файлов, 3718 passed, 4 skipped, 0 failed**. Полный прогон, исключений и `--skip` не было, прогон шёл ВНУТРИ фазы close — то есть именно в тех условиях, где Close упал.
- `pnpm build` чистый (перед прогонами).
## Что осталось
- AC7 и DoD2 (документация: doc-6, doc-8, doc-10 §6, CHANGELOG) — не отмечены: правки документов в фазе Code запрещены, их пишет Close после слияния. Как и в прошлом раунде.
- Системная часть проблемы (env-изоляция in-process тестов как общий механизм, не только для одного файла) вынесена в **VL-374**, как указано в комментарии предшествующей фазы; здесь сделан минимум по образцу проекта.
- Merge `bb0ba39` в master не откатывался — эта правка дополняет его в ветке vb/vl-370 и требует повторного слияния/прогона.
---
author: @agent
created: 2026-11-08 12:01
---
Фаза Close выполнена. Ветка vb/vl-370 слита в master (1 коммит: eb1a21e — фазовый env на уровне файла в update-pipeline.test.mjs), конфликтов не было; worktree удалён, ветка vb/vl-370 удалена.
## Проверки после merge
- `pnpm build` — чистый (diff затронул только `src/mcp/update-pipeline.test.mjs`, сборка не перезапускалась — одна на фазу).
- Ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD`: `npx vitest run src/mcp/update-pipeline.test.mjs` → 19 passed.
- **Полный прогон**: `pnpm test` → зелёный, исключений и `--skip` не было. Повторных прогонов не делал.
- Merge-интерференции не обнаружено: вся содержательная часть VL-370 пришла в master раньше (bb0ba39), слияние добавило только правку изоляции теста.
## DoD
1. Тесты проходят — полный `pnpm test` зелёный.
2. Документация обновлена — коммит 78b6753:
   - **doc-6** (секция workflow): новый пункт «Неполнота сущности — третий уровень той же схемы (VL-370)» — формат `completeness`, семантика чтения, мердж-правило «запись заменяет дефолт целиком», правило `'*'`, дефолты default/simple, JSON-пример.
   - **doc-8**: пункт «`missing` — от состояния сущности с учётом workflow и фазы (VL-370)» переписан вместо прежней пометки «VL-370 расширит расчёт» — `DEFAULT_COMPLETENESS`, `loadCompleteness`/`getCompletenessRules`/`taskCompletenessMissing`/`terminalStatusGateForTask`, смысл полей, пустой чеклист = полно, источник фазы `resolveGuardPhase`, `document`/`reference` без правил.
   - **doc-10 §6**: гейт терминальности и авто-отчёт читают один источник — `terminalStatusGateForTask`, копий расчёта больше нет, простой workflow и пустой чеклист оговорены, `terminalStatusGate` сохранён.
   - **CHANGELOG.md**: запись VL-370 в `### Изменено (ломающие изменения)` рядом с VL-369 (изменение поведения `backlog_update_task` — ломающее, поэтому не в «Добавлено»).
3. Нет регрессий — полный прогон зелёный, поведение действующего проекта (workflow `investigation` без записи в `completeness` → набор пуст) не изменилось.
## AC7
Документация обновлена — отмечен. Остальные AC были отмечены в предыдущих фазах; AC7 оставался неотмеченным именно потому, что правки документов в Code запрещены.
## Lessons
Зафиксирован **lesson-254** (kind: `workaround`, в коммите 73e54c4): в in-process MCP-тестах `testSpawnEnv()` неприменим — фазовый env снимать на уровне файла (`beforeAll`/`afterAll`, по префиксам `VIBELOG_PHASE_`/`VIBELOG_RUN_`). Урок привязан к задаче, системная часть вынесена в VL-374. Новый урок не дублирует lesson-88/113 — те покрывают только спавн.
## Замечание по поведению (не блокер)
Вызов `backlog_update_task` в этой фазе вернул `outcome: 'partial'` с `missing` по AC7/DoD2 — это новая логика VL-370 в действии: фаза Close, правила `default.close` требуют все пункты отмеченными, и они действительно были не отмечены до записи документации. После правки документов оба пункта отмечены в этом вызове.
---
<!-- COMMENTS:END -->