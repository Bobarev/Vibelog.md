---
id: VL-146
title: 'Сериализация фазы close в бранч-режиме: очередь агентов'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 18:12'
updated_date: '2026-10-14 22:59'
due_date: ''
labels: []
dependencies: []
milestone: v1.8
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/orchestrator.ts
  - src/bot/handlers.ts
  - src/web/orchestrator.test.mjs
  - README.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#core При параллельной работе в режиме бранчей требуется чтобы одновременно в фазе close работал только один агент. Если пользователь запускает ещё один, то нужно поставить его в очередь.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При активной фазе close у второго запущенного агента в бранч-режиме close не стартует — он ожидает в очереди до освобождения
- [x] #2 После завершения close текущим агентом следующий агент из очереди начинает close автоматически, без ручного вмешательства
- [x] #3 Конкурентный запуск двух агентов покрыт тестом: в каждый момент времени фазу close выполняет не более одного агента
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-146 — Сериализация фазы close в бранч-режиме: очередь агентов

## Контекст (найдено в коде)

- Точки запуска close: бот `/close` (`src/bot/handlers.ts:828-858`) и веб-API `POST /api/tasks/:id/trigger` (`src/web/api.ts:61-79`) — обе идут через `startPhase` (`src/web/orchestrator.ts:106`), финальный `return spawnQwenRun(...)` — строка 178.
- В branch-mode close исключён из worktree (`orchestrator.ts:463`, VL-112): close любой задачи идёт в **главном репозитории** (merge ветки + docs-коммит) — поэтому два одновременных close разных задач конфликтуют по git. Гвард `activeRuns` (`orchestrator.ts:71,439-446`) защищает только одну задачу, не разные.
- Очередь делается **в процессе оркестратора** (бот/vibelog browser) — единственная точка запуска фаз; guard общий для агентов qwen/vb.

## Архитектурное решение

Модульная очередь в `orchestrator.ts`: флаг `closeActive` + массив `closeQueue`. При `phase === 'close' && resolveBranchMode(cwd)`: если close уже идёт — запрос ставится в очередь и возвращается `{ started: true, pid: 0, queued: true }`; при завершении текущего close (обёртка onExit) — из очереди стартует следующий автоматически (рекурсивный drain). Вне branch-mode — прежнее поведение без изменений.

## Файлы для изменения

### 1. `src/web/orchestrator.ts` (основной)

- **Строка 53** `StartResult`: `{ started: true; pid: number; queued?: boolean } | { error: string }` — `queued: true` = поставлен в очередь (процесс ещё не создан, `pid: 0`).
- **Строки 38-50** `PhaseRun`: добавить опциональное `queued?: boolean` (состояние «в очереди на close» для `getRun`).
- **После строк 71-73** (карты запусков) — новое module state:
  ```ts
  interface QueuedClose { cwd: string; taskId: string; onExit?: PhaseExitCallback;
    extraVars?: Record<string, string>; agent: 'qwen' | 'vb' }
  const closeQueue: QueuedClose[] = [];
  let closeActive = false;   // true ⇔ close-фаза активна или стартует из очереди
  ```
- **Строка 178** `startPhase`: заменить прямой `return spawnQwenRun(...)` на close-очередь (код single-threaded — гонок нет):
  1. Если `phase === 'close' && resolveBranchMode(cwd)`:
     - задача уже активна (`activeRuns`) → прежний guard spawnQwenRun («Запуск уже выполняется (VL-N)») — не ставить в очередь;
     - taskId (канонический UPPER, как в VL-145) уже в `closeQueue` → `{ error: 'Close уже в очереди: VL-N' }` (двойной /close одной задачи);
     - `closeActive === true` → `closeQueue.push(...)`, return `{ started: true, pid: 0, queued: true }`;
     - иначе: `closeActive = true`; обернуть onExit: `try { onExit?.(run) } finally { drainCloseQueue() }`; `const res = spawnQwenRun(...wrapped, extraArgs)`; если `'error' in res` → `closeActive = false; drainCloseQueue()`; return res.
  2. Иначе — прежний `return spawnQwenRun(cwd, taskId, phase, prompt, onExit, agent, extraArgs)`.
- **Новая функция `drainCloseQueue()`** (рядом со startPhase): `const next = closeQueue.shift()`; пуста → `closeActive = false` и выход; иначе `closeActive = false` (startPhase снова выставит флаг при успешном спавне) и рекурсивный `startPhase(next.cwd, next.taskId, 'close', next.onExit, next.extraVars, next.agent)`; при `'error' in res` (задача удалена и т.п.) — `next.onExit?.({ running: false, phase: 'close', exitCode: 1, logTail: res.error })` и переход к следующему элементу. Prompt рендерится заново при dequeue — это идемпотентно и берёт актуальный шаблон close-worktree (worktree предыдущей close-задачи на очередь не влияет).
- **Строка 784** `getRun`: после проверки `activeRuns` — если taskId в `closeQueue` (lookupCI по каноническому ключу) → вернуть `{ running: false, queued: true, phase: 'close' }`; затем прежний `lastRuns`.

### 2. `src/bot/handlers.ts` (строка ~857, хендлер `/close`)

После `startPhase`: если `'queued' in result && result.queued` → `await sendMd(ctx, `⏳ Фаза Close (${agent}) для *${task.id}* поставлена в очередь — стартует после завершения текущего close (VL-146)`)`; иначе прежнее сообщение с PID. `onExit` уже зарегистрирован в очередь — карточка завершения (`notifyPhaseDone`) придёт штатно при фактическом старте.

### 3. `src/web/orchestrator.test.mjs` (AC-3)

Новый тест (describe «VL-146: очередь close в branch-mode»), по паттернам VL-140/147:
- tmp-проект: `backlog/tasks/` c задачами VL-1/VL-2/VL-3 (core store), `.vibelog/settings.json` c `branch_mode: true` (loadBotSettings);
- `VIBELOG_QWEN_BIN` → фейковый исполняемый скрипт (shebang `#!/usr/bin/env node`, chmod 755): taskId выцепляет regex `VL-\d+` из process.argv[2] (промпт — позиционный аргумент), дописывает в lock-файл строки `${taskId} start ${Date.now()}` / `${taskId} end ${Date.now()}`, спит ~400 мс, exit 0;
- `setSpawnEnvBaseForTests({... VIBELOG_QWEN_BIN: fakeBin})`;
- assertions: close VL-1 → `{ started: true }` (не queued); close VL-2 и VL-3 → `{ queued: true, pid: 0 }`; повторный close VL-1 → `{ error: 'Запуск уже выполняется (VL-1)' }`; `getRun('VL-2')` до старта → `queued: true`;
- ожидание (polling до ~10 с) завершения трёх запусков; по lock-файлу: порядок VL-1 → VL-2 → VL-3, интервалы `start..end` параллельно НЕ пересекаются (инвариант «не более одного close в каждый момент»);
- регрессия: branch-mode **выключен** — два close разных задач стартуют параллельно (очередь не применяется, прежнее поведение).

### 4. `README.md` (секция «Параллельная разработка в git-ветках (VL-107)», буллеты «Как работает», ~строка 274)

Добавить буллет: в branch-mode Фаза Close сериализована — одновременно работает только один close (merge в главном репо требует эксклюзивного доступа); второй запуск ставится в очередь и стартует автоматически после завершения текущего; бот отвечает сообщением «поставлена в очередь».

## Порядок действий

1. `orchestrator.ts`: типы → module state → ветка очереди в startPhase → `drainCloseQueue` → `getRun`.
2. `handlers.ts`: сообщение бота для queued.
3. Тест в `orchestrator.test.mjs`.
4. README.
5. Проверки.

## Как проверить

```bash
pnpm build                     # tsc strict
pnpm test:fast                 # vitest run (dist уже собран); полный pnpm test = build + тесты
# целевой файл:
pnpm exec vitest run src/web/orchestrator.test.mjs
```

## Риски

- Очередь живёт в памяти процесса оркестратора: рестарт бота/browser теряет ожидающие запуски (known limitation — как поллинг доски); пользователь стартует такой close заново вручную.
- Прямой CLI-запуск close вне оркестратора (`vibelog agent close ...` отдельным процессом) в очередь не попадает — межпроцессная блокировка вне масштаба (в branch-mode close запускается оркестратором).
- Close при выключенном branch-mode между разными задачами не сериализуется — прежнее поведение (scope ограничен AC).
- Тайминг-тест полагается на sleep фейкового qwen (~400 мс) и polling; инвариант проверяется детерминированно по lock-файлу, таймауты щедрые.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 18:15
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Сериализация фазы close в бранч-режиме: очередь агентов». Масштаб: task. Уточнено: тип (task), критерии приёмки (очередь второго агента в фазе close, автозапуск следующего из очереди, тест на взаимное исключение). Вопросов нет.
---
author: @agent
created: 2026-10-13 23:16
---
Фаза 2 (Plan) выполнена. Тип: task. План записан: 4 файла (src/web/orchestrator.ts — модульная очередь closeActive/closeQueue + drain при завершении текущего close, поле queued в StartResult/PhaseRun, getRun показывает «в очереди»; src/bot/handlers.ts — сообщение бота «поставлена в очередь» для /close; src/web/orchestrator.test.mjs — тест AC-3 с фейковым qwen и lock-файлом: инвариант «не более одного close в момент времени», автозапуск из очереди, порядок; README.md — документация секции branch-mode). Механика: очередь в процессе оркестратора (бот/веб-API — обе точки идут через startPhase), guard только при phase=close && resolveBranchMode, вне branch-mode поведение прежнее. Риски: очередь в памяти (рестарт теряет ожидающие запуски), прямой CLI-запуск вне оркестратора не сериализуется, тайминг-тест детерминирован по lock-файлу.
---
author: @agent
created: 2026-10-13 23:46
---
Фаза 3 (Code) выполнена. Изменено: src/web/orchestrator.ts (модульная очередь closeQueue/closeActive + drainCloseQueue при завершении текущего close, queued в StartResult/PhaseRun, getRun показывает «в очереди»), src/bot/handlers.ts (сообщение бота «поставлена в очередь» для /close), src/web/orchestrator.test.mjs (2 теста VL-146), README.md (документация секции branch-mode), коммит 8b5444f. Проверки: pnpm build (tsc strict), pnpm test — 55 файлов / 972 теста прошли, целевой файл orchestrator.test.mjs 62/62. Тест AC-3: фейковый qwen пишет lock-файл start/end — инвариант «не более одного close в момент времени», порядок VL-1→VL-2→VL-3, автозапуск из очереди; guard: повторный close активной задачи и двойной запуск из очереди дают ошибку; регрессия — без branch-mode два close идут параллельно (прежнее поведение). Механика: очередь в процессе оркестратора (бот/веб-API через startPhase), guard только при phase=close && resolveBranchMode. Что осталось: ограничения задокументированы в README (очередь в памяти — рестарт теряет ожидающие; прямой CLI-запуск вне оркестратора не сериализуется).
---
author: @agent
created: 2026-10-13 23:57
---
Фаза Close выполнена. Ветка vb/vl-146 слита в master (1 коммит 8b5444f, merge --no-ff), worktree удалена (только force из-за untracked-симлинков node_modules/refs — модифицированных файлов не было), ветка удалена. Проверки после merge: pnpm build (tsc strict) и pnpm test — прошли (exit 0). DoD: все 3 пункта выполнены (тесты проходят — 972 теста, документация обновлена — README в ветке + CHANGELOG запись в Unreleased, регрессий нет — полный прогон зелёный). Документация: запись VL-146 в CHANGELOG.md (docs-коммит c15e7d6).
---
<!-- COMMENTS:END -->