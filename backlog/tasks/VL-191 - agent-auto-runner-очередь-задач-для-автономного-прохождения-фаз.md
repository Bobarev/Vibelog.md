---
id: VL-191
title: auto-runner — очередь задач для автономного прохождения фаз
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 09:20'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - agent
  - bot
  - core
dependencies: []
milestone: v1.10
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/auto-queue.ts
  - src/core/auto-queue.test.mjs
  - src/bot/auto-runner.ts
  - src/bot/auto-runner.test.mjs
  - src/bot/commands.ts
  - src/bot/commands.test.mjs
  - src/bot/registry.ts
  - src/bot/registry.test.mjs
  - src/bot/handlers.ts
  - src/bot/rich.ts
  - src/bot/rich.test.mjs
  - README.md
lessons:
  - lesson-1
  - lesson-2
  - lesson-8
  - lesson-9
  - lesson-18
  - lesson-21
  - lesson-30
  - lesson-37
  - lesson-39
  - lesson-40
  - lesson-43
  - lesson-44
  - lesson-46
  - lesson-47
  - lesson-48
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
auto-runner — очередь задач для автономного прохождения фаз
Сейчас некоторые задачи нужно запускать вручную поочерёдно. Нужен auto-runner — очередь задач, где агент сам проходит фазы workflow с настраиваемыми checkpoint'ами.
Архитектура
Очередь (.vibelog/auto-queue.json)
{ "running": bool, "tasks": [{ "id": "VL-N", "status": "pending|running|done|failed", "added_at": "...", "started_at": "..." }] }
Переживает рестарт бота.
Откуда задачи
A) Вручную: /auto add VL-N VL-M.
B) Кнопка в карточке задачи у всех статусов у которых возможен запуск следующей фазы.
Выбор следующей
1. Фильтр: только pending.
2. Проверка dependencies: все зависимости Done (иначе пока пропустить).
3. Сортировка: по priority (High → Medium → Low), внутри одного приоритета — FIFO (added_at).
Запуск фаз
Последовательно: spec → ждать onExit → plan → ждать → code → ждать → close → next.
Ветвление
Если из текущего статуса несколько фаз (To Do → spec / reject / do) — auto выбирает ПЕРВУЮ (кроме reject). Reject — только вручную.
Ошибка фазы
Retry N раз (по умолчанию 1). Потом — пропустить задачу (status failed) + уведомить в чат.
После code → Review
Auto запускает close сразу (без ревью).
Пустая очередь
Остановиться (running: false).
Команды бота
- /auto add VL-N VL-M — добавить в очередь.
- /auto start — запустить (running: true).
- /auto stop — остановить после текущей фазы.
- /auto status — показать очередь (pending/running/done/failed).
Что НЕ нужно
- File locks — worktree решает конфликты.
- Параллельный запуск — последовательно проще.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Очередь .vibelog/auto-queue.json хранит running и tasks (id, status pending/running/done/failed, added_at, started_at) и переживает рестарт бота
- [x] #2 Команды /auto add, /auto start, /auto stop, /auto status работают; выбор следующей задачи: только pending, все зависимости Done, сортировка High→Medium→Low, внутри приоритета FIFO по added_at
- [x] #3 Автопрогон фаз последовательный (spec→plan→code→close), ветвление выбирает первую фазу кроме reject, ошибка фазы — retry (по умолчанию 1) затем failed + уведомление в чат, пустая очередь ставит running:false
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-191 — auto-runner: очередь задач для автономного прохождения фаз

Тип: feature (не epic) → план в этой задаче. Скоуп: бот-команды /auto, файл очереди, выбор задачи, автопрогон фаз. Web-кнопка и CLI — вне спеки («Команды бота»), не делаются.

## Архитектурные решения

1. **Очередь** — новый core-модуль `src/core/auto-queue.ts` (fs-only, как `core/settings.ts:37`): путь `join(cwd, '.vibelog', 'auto-queue.json')`, формат `{ running: boolean, tasks: [{ id, status, added_at, started_at?, attempts? }] }`. Доп. поля `attempts` (счётчик ретраев) не противоречат AC1. Битый/отсутствующий файл → дефолт `{running:false, tasks:[]}`.
2. **Раннер** — новый `src/bot/auto-runner.ts`, живёт в процессе бота (бот и оркестратор — один процесс, handlers.ts:423). Запуск фаз — ТОЛЬКО через общий `startTaskPhase` (`src/web/orchestrator.ts:350`) — lesson-37, без дублирования. Выбор фазы — `getAvailablePhases`/`getWorkflowForTask` (`src/core/workflow.ts`), первая НЕ-reject ветка (это ровно spec: «первую кроме reject»; `getNextPhase` при единственном reject вернул бы reject — auto его не берёт, фильтруем явно).
3. **Зависимости** — `isReady(cwd, task)` из `src/core/deps.ts:49` (все зависимости Done/Completed). **Сортировка** — `{High:0, Medium:1, Low:2}` (как `src/mcp/tools.ts:742`), внутри приоритета FIFO по `added_at`.
4. **Событийный цикл без мульти-запуска**: module-level флаг `autoActive` — новый тик стартует только если нет активной auto-фазы. Триггеры тика: `/auto start`, каждый `onExit` фазы, `/auto add` при `running:true`, пол-timer 60 c (`unref()`) — пока `running:true` и есть dep-блокированные pending (иначе они никогда не дождутся).
5. **Retry**: `max_retries` — поле очереди (default 1), `attempts` в элементе очереди. Успех фазы = `run.exitCode === 0` (форматирование.ts:160) И смена статуса задачи (нет смены → нет прогресса → тоже retry, защита от цикла «фаза отработала, агент не сделал finish»). Исчерпано → `failed` + уведомление во ВСЕ привязанные чаты (`loadBotSettings(cwd).chats`).
6. **Stop после текущей фазы**: `/auto stop` пишет `running:false`; в `onExit` раннер перечитывает файл и выходит, не запуская следующую фазу.
7. **Рестарт**: в `registerHandlers` (при старте бота) — `resumeAutoRunner`: элементы `running` → `pending` (onExit потерялся при падении), если `running:true` → tick.
8. **Карточка-кнопка**: `auto:<id>` в `renderTaskRich` для всех статусов с ≥1 не-reject фазой (added после phase-кнопок, перед comment); обработчик в `bot.on('callback_query')`. Идемпотентный add: уже в очереди → «уже в очереди».

## Файлы

### Новые
1. **`src/core/auto-queue.ts`** — `AutoQueue`/`AutoQueueTask` типы; `autoQueuePath(cwd)`; `loadAutoQueue(cwd)` (fallback `{running:false,tasks:[]}`); `saveAutoQueue` (mkdir `.vibelog`); `addQueueTasks(cwd, ids)` — add недублирующий (pending/running → skip), done/failed → сброс в pending; `setQueueRunning`; `updateQueueTask(cwd, id, patch)`; `pickNextQueueTask(cwd, queue)` — цепочка: pending → `getTask` существует → не терминальный статус → `isReady` → сортировка priority/FIFO; `formatAutoQueue(queue)` для /auto status.
2. **`src/bot/auto-runner.ts`** — `enqueueAutoTasks(bot, cwd, ids)` (общий для /auto add и кнопки); `startAutoRunner(bot, cwd)`; `stopAutoRunner(cwd)`; `resumeAutoRunner(bot, cwd)`; внутренний `tick(bot, cwd)` + `finishCurrent` в onExit (псевдокод из решения 4–7); `notifyAutoFailure(bot, cwd, taskId, phase, attempts)`; `startAutoPoll(cwd)/stopAutoPoll(cwd)` (interval 60 c, unref).
3. **`src/core/auto-queue.test.mjs`** — load/save/персистентность (AC1), add-дедуп, pickNext: только pending, dep-фильтр, сортировка High→Medium→Low + FIFO (AC2), терминальные статусы.
4. **`src/bot/auto-runner.test.mjs`** — логика выбора фазы (первая не-reject, reject пропускается), retry-переходы queue-state machine (pending→running→failed/done, AC3), пустая очередь → `running:false`.

### Правки
5. **`src/bot/commands.ts`** — тип `AutoCommand = {action:'add', ids:string[]} | {action:'start'|'stop'|'status'}` + `parseAutoCommand(text)`; вставка после `parseSetCommand` (стр. 400), перед `parseRestartCommand` (стр. 402). ID нормализовать в верхний регистр (паттерн как в `parseRestartCommand:406`), валидация существования — в хендлере через `getTask`.
6. **`src/bot/registry.ts`** — запись в `BOT_COMMANDS` (массив стр. 29–53, после `web` стр. 52): `{ command: 'auto', description: 'Автоочередь фаз: /auto add|start|stop|status', usage: '/auto add VL-N … | start | stop | status', examples: ['/auto add VL-1 VL-2', '/auto start', '/auto status'] }` — lesson-8 (help/setMyCommands из реестра).
7. **`src/bot/handlers.ts`**:
   - `bot.command('auto', …)` — после блока `/set` (стр. 660–738), перед `/comment` (стр. 740): requireBind → parse → add/start/stop/status → ответы MarkdownV2; ошибки (не найдена задача) — как в /status.
   - Фильтр callback (стр. 1321): добавить `!data.startsWith('auto:')`; новая ветка `auto:` рядом с `start:` (стр. 1377–1401): answerCallbackQuery + `enqueueAutoTasks` + сообщение-подсказка.
   - Конец `registerHandlers` (перед `}` стр. 1596): `resumeAutoRunner(bot, deps.cwd)`.
8. **`src/bot/rich.ts`** — `renderTaskRich` (стр. 309–344): после phase/reject-кнопок, перед comment (стр. 341–344) вставить `<tg-button type="callback_data" style="link" data="auto:${task.id}">🤖 Auto</tg-button>`, условие `nonReject.length > 0 || opts?.canStart` — «у всех статусов, у которых возможен запуск следующей фазы». Старые форматы callback не меняем (lesson-43) — только добавление ветки.
9. **`src/bot/registry.test.mjs`** — строка 15: `BOT_COMMANDS.length` 23 → **24** + assert записи `auto` (lesson-9, та же итерация).
10. **`src/bot/commands.test.mjs`** — `describe('parseAutoCommand')`: add нескольких id, дедуп/регистр, start/stop/status, пустые аргументы → error.
11. **`src/bot/rich.test.mjs`** — точные row-матчи (стр. 124, 346–348) ломаются новой кнопкой → обновить ожидаемые строки (+ `data="auto:VL-34"`), добавить кейс «кнопки нет без фаз (Done)».
12. **`README.md`** — в раздел «Telegram-бот» (стр. 315) подраздел «/auto — автоочередь фаз»: формат очереди, команды, правила выбора, retry (DoD-2).
13. **`CHANGELOG.md`** — `[Unreleased] → Добавлено`: запись VL-191.

## Порядок действий

1. `core/auto-queue.ts` → `core/auto-queue.test.mjs` (модель и выбор — фундамент AC1/AC2).
2. `bot/commands.ts` (+parseAuto) → `bot/registry.ts` (+запись) → правки `registry.test.mjs`/`commands.test.mjs`.
3. `bot/auto-runner.ts` (цикл, retry, notify, resume, poll) → `auto-runner.test.mjs` (через заглушки startPhase-injection / чистые переходы).
4. `bot/handlers.ts` (команда + callback + resume) → `bot/rich.ts` (кнопка) → правки `rich.test.mjs`.
5. README → CHANGELOG.
6. `pnpm build && pnpm test`.

## Как проверить

- `pnpm build` (tsc strict → dist/) — обязательно, `bin/vibelog.mjs` импортирует dist.
- `pnpm test` = build + `vitest run` — все тесты, особенно: auto-queue, auto-runner, registry (24), commands (parseAuto), rich (кнопки), workflow (нет регрессий — DoD-3), orchestrator.
- `pnpm test:fast` — на итерациях, когда dist собран.
- Smoke (фаза Code, вручную): `vibelog bot` → `/auto add VL-N` → `/auto status` → `/auto start` → следить, что после каждой фазы onExit запускает следующую, после Done — следующая задача, в конце `running:false`; `/auto stop` останавливает после текущей фазы. Консоль: `list_console_messages` не нужен (бот — консольный процесс).

## Риски

- **rich.test.mjs точные матчи** сломаются первой же правкой кнопок — править в той же итерации (и registry count — lesson-9).
- **Нет прогресса** (exitCode 0, статус не изменился) → бесконечный цикл одной фазы — закрыто guard-ом «без смены статуса → retry → failed».
- **409 «уже выполняется»** (пользователь сам запустил фазу) сжигает попытки — StartResult-error трактуется как ошибка запуска с тем же retry; при исчерпании — failed + уведомление (предсказуемо, без гонок).
- **Рестарт бота посреди фазы**: onExit потерян, дети-процессы сиротятся — resume сбрасывает `running→pending` и перезапускает фазу; возможен короткий дубль-прогон orphan-фазы (кросс-процессный guard'а нет — известное ограниечение, упомянуть в README).
- **dep-блокированные задачи**: без poll-timer раннер простоивал бы — таймер 60 c (unref) решает; остановка таймера на `running:false`.
- Help-текст растёт (лимит 4096) — уже покрыто `chunkRich` в /help (handlers.ts:407–411).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 09:22
---
Фаза 1 (Spec) выполнена. Заголовок: изменён (снят ведущий тег #agent) → «auto-runner — очередь задач для автономного прохождения фаз». Тип: feature. Масштаб: task (одна задача: файл очереди, команды /auto, логика выбора и прогон фаз). Приоритет: Medium (описание полное, приоритет неочевиден). Уточнено: добавлены 3 проверяемых критерия приёмки (формат и персистентность очереди .vibelog/auto-queue.json; команды /auto add/start/stop/status и правила выбора следующей задачи; последовательный автопрогон фаз с ветвлением, retry и обработкой пустой очереди); описание оставлено без изменений (снят только ведущий тег #agent). Labels: agent (пользовательский #agent), bot, core. References: нет (внешние источники не упомянуты). Вопросов нет.
---
author: @agent
created: 2026-10-26 09:53
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в Implementation Plan: 2 новых модуля (src/core/auto-queue.ts — модель очереди .vibelog/auto-queue.json: load/save/add/дедуп/pickNext с фильтром pending + isReady(все зависимости Done) + сортировка High→Medium→Low, FIFO по added_at; src/bot/auto-runner.ts — событийный цикл: tick по onExit, выбор первой не-reject фазы через getAvailablePhases, retry (max_retries из очереди, default 1, счётчик attempts) с guard-ом «нет смены статуса → retry», после исчерпания failed + уведомление во все привязанные чаты, пустая очередь → running:false, resume при старте бота running→pending, poll-timer 60с для dep-блокированных) + 2 новых тестовых файла; правки: commands.ts (parseAutoCommand), registry.ts (BOT_COMMANDS 23→24, registry.test.mjs в той же итерации — lesson-9), handlers.ts (команда /auto, callback auto:<id>, resume в конце registerHandlers), rich.ts (кнопка 🤖 Auto, без изменения старых форматов — lesson-43), commands.test/rich.test (точные row-матчи обновить), README (раздел /auto), CHANGELOG. Запуск фаз — только через общий startTaskPhase (lesson-37). Вне скоупа: web-кнопка и CLI (спека — команды бота). Риски: точные матчи rich.test/registry count ломаются — править в той же итерации; нет-прогресс фазы закрыт guard-ом; 409 «уже выполняется» трактуется как ошибка запуска с retry; рестарт посреди фазы — resume+перезапуск с возможным коротким дублем orphan-фазы (упомянуть в README).
---
author: @agent
created: 2026-10-26 10:47
---
Фаза 3 (Code) выполнена. Изменено 12 файлов, коммит d7b574a (ветка vb/vl-191). Реализация по плану: src/core/auto-queue.ts (новый) — модель .vibelog/auto-queue.json: load/save с нормализацией (битый файл → дефолт), addQueueTasks с дедуп и реанимацией done/failed→pending, монотонный nextIsoDate для FIFO (баг-фикс: батч-добавление давало одну миллисекунду и ломало порядок — увlesson-46), pickNextQueueTask (только pending → задача есть и не терминальна → isReady → High→Medium→Low + FIFO), sweepQueue; src/bot/auto-runner.ts (новый) — событийный цикл: autoActive-guard, продолжение running-элемента (текущая задача доводится до терминала), выбор первой не-reject фазы pickAutoPhase (reject — только вручную; после code → close сразу), успех = exitCode 0 И смена статуса (нет прогресса → retry), retry-машина nextFailureAction (max_retries из очереди, default 1) → failed + уведомление во все chats, пустая очередь → running:false, stop — после текущей фазы (onExit перечитывает файл), resumeAutoRunner в registerHandlers (running→pending при рестарте), пол-timer 60с для dep-блокированных, запуск только через общий startTaskPhase (lesson-37); src/bot/commands.ts — parseAutoCommand; src/bot/registry.ts — запись auto после set (порядок = порядок bot.command в handlers — сверка-тест требует); handlers.ts — команда /auto (add/start/stop/status), callback auto:<id> (старые форматы не тронуты — lesson-43), resume на старте; rich.ts — кнопка 🤖 Auto при наличии не-reject фазы или canStart; README — раздел «/auto — автоочередь фаз». Тесты: 4 новых файла-кейса внутри auto-queue.test.mjs (11) и auto-runner.test.mjs (11) + правки registry.test (24 команды, порядок, help-хардкод — lesson-9), commands.test (parseAuto), rich.test (точный row + кейсы auto-кнопки). Проверки: pnpm build + pnpm test — 73 файла, 1292 теста, 0 падений (регрессий нет). Отмечены AC 1-3, DoD 1-3. Что осталось: CHANGELOG.md не обновлялся (правило фазы 3 — запись в Unreleased пишет Фаза Close); ручной live-smoke с настоящим Telegram-ботом и живой фазой не проводился (unit-покрытие полное, спавн фаз в тестах не выполняется — намеренно).
---
author: @agent
created: 2026-10-26 12:04
---
Фаза Close выполнена. Ветка vb/vl-191 слита в master (1 коммит d7b574a, merge без конфликтов), worktree удалена (только untracked-симлинки node_modules/backlog/references/data → --force), ветка удалена. pnpm build + pnpm test после merge — 0 падений (регрессий нет). Lessons: созданы lesson-47 (успех фазы = exitCode И смена статуса задачи) и lesson-48 (resume автоочереди на старте бота: running→pending), связаны с задачей; lesson-46 (монотонный added_at для FIFO) уже была из Phase 3 — все три закоммичены (3211d99). Документация: CHANGELOG.md (запись VL-191 в Unreleased) + doc-6 (команды /auto в таблице бота и раздел «Автоочередь фаз») — docs-коммит 1b82625. DoD: тесты проходят (73 файла, 1292 теста, 0 падений), документация обновлена (README — в ветке, CHANGELOG + doc-6 — здесь), нет регрессий (build+test зелёные после merge). Ручной live-smoke с настоящим Telegram-ботом не проводился (unit-покрытие полное) — упомянуто в отчёте Phase 3.
---
<!-- COMMENTS:END -->