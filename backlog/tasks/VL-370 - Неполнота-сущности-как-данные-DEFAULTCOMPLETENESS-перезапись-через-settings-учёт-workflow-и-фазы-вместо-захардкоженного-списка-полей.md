---
id: VL-370
title: 'Неполнота сущности как данные: DEFAULT_COMPLETENESS + перезапись через settings, учёт workflow и фазы вместо захардкоженного списка полей'
status: Spec
assignee: []
reporter: ''
created_date: '2026-11-08 01:46'
updated_date: '2026-11-08 01:46'
due_date: ''
labels: []
dependencies:
  - VL-369
milestone: ''
references: []
priority: high
type: enhancement
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
- [ ] #1 В `src/core/workflow.ts` есть `DEFAULT_COMPLETENESS` и чтение ключа `completeness` из `.vibelog/settings.json` по той же семантике, что `loadWorkflows`: отсутствие ключа / битый JSON / невалидная запись → fallback на дефолт, валидные именованные записи сохраняются
- [ ] #2 Неполнота считается от СОСТОЯНИЯ сущности с учётом workflow задачи и текущей фазы; `missingTaskFields` (`src/mcp/tools.ts:1346`) удалён
- [ ] #3 Для workflow `simple` (фаза `do`) неполнота НЕ требует `acceptanceCriteria` и `implementationPlan` — задача без них считается полной; проверено тестом на фикстуре simple-workflow
- [ ] #4 Для `default`-workflow: фаза `spec` требует `description`, фаза `plan` — `implementationPlan`, фаза `close` — все AC и DoD отмечены
- [ ] #5 Правило терминального статуса читается из одного источника: `finalizePhaseStatus` (`src/core/phase-transient.ts`) и `writeAutoReportIfMissing` (`src/agent/auto-report.ts`) используют общий расчёт неполноты, второй копии правила нет
- [ ] #6 Добавление нового workflow с другим набором обязательных полей — запись в `.vibelog/settings.json`, без правки кода инструментов; проверено тестом с кастомным workflow
- [ ] #7 `pnpm build && pnpm test` зелёный; действующий проект (без секции `workflows` в settings) не меняет поведения
- [ ] #8 Документация обновлена: doc-6 (секция workflow — ключ `completeness`), doc-8 (расчёт missing), doc-10 §6, CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->