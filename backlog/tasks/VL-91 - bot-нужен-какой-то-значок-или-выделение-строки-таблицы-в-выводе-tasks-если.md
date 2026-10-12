---
id: VL-91
title: '#bot нужен какой-то значок или выделение строки таблицы в выводе tasks, если…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-05 18:48'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#bot нужен какой-то значок или выделение строки таблицы в выводе tasks, если сейчас выполняется какая-то фаза (активна сессия агента над этой задачей)

## Контекст (Фаза 1: Spec)

Команда `/tasks` (src/bot/handlers.ts) выводит невыполненные задачи rich-таблицей `renderTasksRich` (src/bot/rich.ts, HTML `<table bordered striped compact>` + кнопки `task:<id>`) c MarkdownV2-фолбэком `formatTaskList` (src/bot/formatting.ts) для старых клиентов.

Сейчас пользователь не видит по списку задач, над какой уже крутится сессия агента — эта информация есть только в карточке `/task VL-N` (строка фазы из `formatPhaseRun`, источник — in-memory `getRun(taskId)` оркестратора src/web/orchestrator.ts, `running: true, phase, pid`).

## Решение

В выводе `/tasks` помечать значком (например 🔄) строки задач, у которых в оркестраторе активен запуск фазы (`getRun(id)?.running === true`), с указанием выполняемой фазы (spec/plan/code/close/comment). Пометка — и в rich-таблице (`renderTasksRich`), и в MarkdownV2-фолбэке (`formatTaskList`). Источник активности — `getRun` для каждой задачи списка (бот и оркестратор — один процесс).

## Ограничение

Состояние оркестратора in-memory: фазы, запущенные из web UI (`vibelog browser`, отдельный процесс), бот не видит — как и сейчас в `/task` (VL-43). Для фаз, запущенных из бота, пометка работает.

## Изменения (оценка)

- src/bot/rich.ts — renderTasksRich: пометка активных строк (3-й параметр — map taskId→phase)
- src/bot/formatting.ts — formatTaskList: пометка во фолбэке
- src/bot/handlers.ts — /tasks: собрать активные запуски через getRun, передать в рендеры
- тесты rich.test.mjs / formatting.test.mjs (+ обработчик)
- docs/user-guide.md (раздел бота), CHANGELOG.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Вывод /tasks помечает значком (например 🔄 + название фазы) строки задач с активной фазой агента — и в rich-таблице (renderTasksRich), и в MarkdownV2-фолбэке (formatTaskList); у неактивных задач пометки нет
- [x] #2 Активность определяется по getRun(taskId).running in-memory оркестратора (тот же процесс, что и бот); завершённые/ошибочные запуски (lastRuns) не помечаются
- [x] #3 Тесты рендеров (rich.test.mjs, formatting.test.mjs) покрывают пометку активной/неактивной задачи; pnpm test проходит; docs/user-guide.md (раздел бота) и CHANGELOG обновлены
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

В выводе `/tasks` (Telegram-бот) помечать значком 🔄 + фазой строки задач, у которых в оркестраторе активен запуск фазы (`getRun(id).running === true`). Пометка — и в rich-таблице (`renderTasksRich`), и в MarkdownV2-фолбэке (`formatTaskList`). Завершённые/ошибочные запуски (lastRuns) не помечаются.

## Файлы для изменения

1. `src/bot/rich.ts` — renderTasksRich
2. `src/bot/formatting.ts` — formatTaskList
3. `src/bot/handlers.ts` — sendTasksView + хендлер /tasks
4. `src/bot/rich.test.mjs` — тесты пометки
5. `src/bot/formatting.test.mjs` — тесты пометки
6. `docs/user-guide.md` — раздел «Telegram-бот», подраздел /tasks
7. `CHANGELOG.md` — Unreleased → Добавлено

## Изменения по файлам

### 1. src/bot/rich.ts

- Строка 400: сигнатура → `renderTasksRich(tasks: Task[], styles: Record<string, string>, active: Record<string, string> = {}): string`
  - `active` — map taskId → phase (spec/plan/code/close/comment); дефолт `{}` сохраняет совместимость вызовов.
- Строки 411-415 (rows map): если задан `active[t.id]` — в ячейке ID после `<b>id</b>` добавить ` 🔄 ${cellSafe(phase)}`: `<td><b>${cellSafe(t.id)}</b> 🔄 ${cellSafe(active[t.id])}</td>`; иначе — как сейчас.
- JSDoc: описать 3-й параметр (по образцу @param styles).

### 2. src/bot/formatting.ts

- Строка 34: сигнатура → `formatTaskList(tasks: Task[], active: Record<string, string> = {}): string`
- Строки 36-41 (map): для активных — префикс `🔄 ` и фаза в экранированных скобках:
  `🔄 *${escapeMarkdownV2(t.id)}* — ${escapeMarkdownV2(t.title)} \\[${escapeMarkdownV2(t.status)}\\] \\(${escapeMarkdownV2(active[t.id])}\\)`
  (фазу — через escapeMarkdownV2: спецсимволы MarkdownV2; эмодзи не экранируется).
- JSDoc: описать `active`.

### 3. src/bot/handlers.ts

- Строки 129-145 (sendTasksView): 4-й параметр `active: Record<string, string>`; передать в `renderTasksRich(tasks, styles, active)` (строка 136) и `formatTaskList(tasks, active)` (строка 142).
- Строки 311-323 (bot.command('tasks')): перед sendTasksView собрать карту активности одним проходом:
  ```ts
  const active: Record<string, string> = {};
  for (const t of tasks) {
    const run = getRun(t.id);
    // running === true — только у активных; lastRuns (завершённые) не помечаем
    if (run?.running === true && run.phase) active[t.id] = run.phase;
  }
  ```
  - `getRun` уже импортирован (строка 43). getRun вызывать один раз на задачу.
  - Путь пустого списка (строки 313-316, `formatTaskList(tasks)`) не менять — «Задач нет» без пометок.

### 4. src/bot/rich.test.mjs (describe 'renderTasksRich (VL-82)', строки 435-529)

Добавить `it`-кейсы:
- активная задача: `renderTasksRich([task()], {}, { 'VL-1': 'code' })` → содержит `🔄 code` в ячейке ID;
- неактивная: карта пуста / задача вне карты → `🔄` отсутствует;
- вызов без 3-го аргумента → поведение как раньше (нет `🔄`);
- фаза с HTML-спецсимволами экранируется cellSafe (ячейка не ломается).

### 5. src/bot/formatting.test.mjs (строки 45-53)

Добавить `it`-кейсы:
- активная: `formatTaskList([task], { 'VL-1': 'plan' })` → `assert.match(text, /🔄 \*VL\\-1\*/)` и `\\(plan\\)`;
- неактивная/дефолт: старый формат строк без `🔄` (регресс-контроль).

### 6. docs/user-guide.md (строки 326-328, подраздел «Список /tasks — rich-таблица (VL-82)»)

Добавить абзац: строки задач с активной фазой агента помечаются 🔄 + название фазы (и в rich-таблице, и в MarkdownV2-фолбэке); активность — из in-memory оркестратора того же процесса, что и бот, поэтому фазы, запущенные из web UI (`vibelog browser`, отдельный процесс), не видны — то же ограничение, что у `/task` (VL-43).

### 7. CHANGELOG.md (после строки 6, «### Добавлено» в Unreleased)

Новый пункт VL-91 (наверх списка): пометка 🔄 + фаза в `/tasks` для задач с активной фазой агента — renderTasksRich (3-й параметр active), formatTaskList (2-й параметр), хендлер собирает карту через getRun (running === true); обновлены тесты rich/formatting, user-guide.

## Порядок действий

1. rich.ts → formatting.ts → handlers.ts (сигнатуры + логика).
2. `pnpm build` — убедиться, что tsc чистый.
3. Тесты: rich.test.mjs, formatting.test.mjs.
4. `pnpm test` — полный прогон (= build + node --test src).
5. docs/user-guide.md + CHANGELOG.md.
6. Фиксация (Фаза 3): коммиты по правилам проекта (`feat: VL-91 — ...`).

## Как проверить

```bash
pnpm build          # tsc → dist, strict
pnpm test           # build + node --test src (все тесты, включая новые)
```

Ручная проверка (Фаза 3, по желанию): `vibelog bot` → `/tasks` при запущенной из бота фазе — строка с 🔄; без активных фаз — без пометок.

## Риски

- **MarkdownV2-парсинг:** фаза в скобках обязана экранироваться (`\\(phase\\)`), иначе Telegram отклонит сообщение. Решение: escapeMarkdownV2 + тест на формат строки.
- **lastRuns:** getRun возвращает и завершённые запуски — без проверки `running === true` помечались бы завершённые фазы. Решение: строгая проверка `run?.running === true && run.phase`.
- **Совместимость сигнатур:** новые параметры — с дефолтом `{}`, существующие вызовы (тесты, пустой список) не ломаются.
- **Web UI-фазы не видны** (in-memory, другой процесс) — известное ограничение, допустимое по AC; фиксируется в user-guide.
- **Лимиты Telegram:** пометка не добавляет кнопок и не меняет дробление — регрессий RICH_MESSAGE_BUTTONS_TOO_MANY не ожидается.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 18:52
---
Фаза 1 (Spec) выполнена. Тип: **task**.
**Уточнение:** фича укладывается в одну задачу — правки трёх файлов бота (`src/bot/rich.ts` renderTasksRich, `src/bot/formatting.ts` formatTaskList, `src/bot/handlers.ts` /tasks) + тесты + документация. Декомпозиция не нужна.
**Суть:** в выводе `/tasks` строки задач с активной фазой агента помечаются значком (🔄 + название фазы) — и в rich-таблице, и в MarkdownV2-фолбэке. Источник активности — in-memory `getRun(taskId).running` оркестратора (бот и оркестратор — один процесс); завершённые запуски не помечаются. Ограничение: фазы, запущенные из web UI в другом процессе, бот не видит (как и сейчас в `/task`, VL-43).
Описание дополнено, type=task, добавлены 3 критерия приёмки.
---
author: @agent
created: 2026-10-05 19:54
---
Фаза 2 (Plan) выполнена. Тип: **task** — план записан в `## Implementation Plan` этой задачи, декомпозиция не потребовалась.
**Суть плана:** правки трёх файлов бота:
- `src/bot/rich.ts` — `renderTasksRich`: 3-й параметр `active: Record<taskId, phase> = {}`; в ячейке ID активной строки — маркер 🔄 + фаза (через cellSafe);
- `src/bot/formatting.ts` — `formatTaskList`: 2-й параметр `active = {}`; активная строка — префикс 🔄 + фаза в скобках, обязательно экранированных через escapeMarkdownV2 (спецсимволы MarkdownV2);
- `src/bot/handlers.ts` — `sendTasksView` принимает и прокидывает `active`; хендлер `/tasks` собирает карту одним проходом через `getRun` (уже импортирован), строгая проверка `run?.running === true && run.phase` — завершённые запуски (lastRuns) не помечаются.
**Тесты:** +кейсы пометки/регресса в `rich.test.mjs` (активная/неактивная/без 3-го аргумента/HTML-экран фазы) и `formatting.test.mjs` (активная/дефолт без маркера). **Доки:** user-guide.md (раздел /tasks, ограничение web-фаз — то же, что в /task VL-43) + CHANGELOG Unreleased. **Проверка:** `pnpm build && pnpm test`.
**Риски:** экранирование фазы в MarkdownV2 (иначе Telegram отклонит сообщение), проверка `running === true` отсекает lastRuns, новые параметры — с дефолтом `{}` (совместимость вызовов).
---
author: @agent
created: 2026-10-05 20:14
---
Фаза 3 (Code) выполнена.
**Изменено (по плану VL-91):**
- `src/bot/rich.ts` — `renderTasksRich`: новый 3-й параметр `active: Record<taskId, phase> = {}`; в ячейке ID активной строки маркер 🔄 + фаза через `cellSafe`.
- `src/bot/formatting.ts` — `formatTaskList`: новый 2-й параметр `active = {}`; активная строка — префикс 🔄 + фаза в экранированных скобках `\(phase\)` (через `escapeMarkdownV2`).
- `src/bot/handlers.ts` — `sendTasksView` принимает и прокидывает `active` в оба рендера; хендлер `/tasks` собирает карту одним проходом через `getRun` со строгой проверкой `run?.running === true && run.phase` — завершённые/ошибочные запуски (lastRuns) не помечаются. Путь пустого списка («Задач нет») не менялся.
- Тесты: `rich.test.mjs` (+3 кейса: пометка активной строки, регресс без 3-го аргумента/пустой карты, HTML-экран фазы), `formatting.test.mjs` (+3 кейса: активная строка с `\(plan\)`, регресс дефолта без 🔄, смешанный список — у неактивной пометки нет).
- `docs/user-guide.md` — раздел /tasks: абзац о пометке 🔄 + ограничение (фазы из web UI в другом процессе не видны, как в /task VL-43).
- `CHANGELOG.md` — Unreleased → Добавлено: пункт VL-91.
**Проверки:** `pnpm build` — OK (tsc strict); `pnpm test` — **602/602**, fail 0.
**Примечание:** в первом прогоне упали 2 собственных новых теста (ожидание экранирования cellSafe и невалидный regex в тесте) — исправлены тесты, код соответствует плану. Отмечены все 3 AC и 3 DoD.
**Что осталось:** ничего; статус → Review.
---
author: @agent
created: 2026-10-05 20:58
---
Фаза Close выполнена. Статус: **Done**.
Коммит feat: **не требовался** — `modified_files` у задачи пуст, а изменённые Фазой 3 файлы (`src/bot/rich.ts`, `src/bot/formatting.ts`, `src/bot/handlers.ts`, `src/bot/rich.test.mjs`, `src/bot/formatting.test.mjs`, `docs/user-guide.md`, `CHANGELOG.md`) параллельно меняет **активная Фаза 3 VL-90** (общие файлы: реализация `/commits` и слияние git-модулей core в `src/core/git.ts`, процессы обеих фаз запущены одновременно). Коммитить смешанный незавершённый код недопустим — эти файлы закоммитит close VL-90 (в шаблоне — проверка git status по упомянутым путям). Файл задачи VL-91 закоммичен отдельным docs(task)-коммитом.
---
<!-- COMMENTS:END -->