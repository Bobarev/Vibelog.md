---
id: VL-42
title: 'Telegram-бот: /spec — запуск Фазы 1 (Spec) через qwen'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 22:34'
updated_date: '2026-10-04 18:42'
due_date: ''
labels:
  - telegram-bot
  - spec
  - qwen
dependencies:
  - VL-41
milestone: v1.6
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Обработчик bot.command('spec') в src/bot/handlers.ts: requireBind → parseSpecCommand → createTaskFile → startPhase(cwd, task.id, 'spec') из src/web/orchestrator.ts (без дублирования spawn-логики; при необходимости вынести оркестратор в общий модуль с сохранением пути к templates/qwen-commands/). Headless qwen сам выполнит spec: создаст подзадачи, оставит комментарий-отчёт на родительской задаче, сменит её статус (шаблон phase-1.md). Ответ в чат: ID задачи + PID либо текст ошибки.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /spec <описание> в привязанном чате создаёт задачу (заголовок — первая фраза описания, урезанная; полное описание в description) и запускает headless qwen с phase-1.md; ответ содержит ID задачи и PID
- [x] #2 Отсутствие бинаря qwen / ошибка startPhase — сообщение в чат, процесс бота не падает (child.on('error') уже обрабатывается в оркестраторе)
- [x] #3 Путь к templates/qwen-commands/ работает из dist/ бота; pnpm test без регрессий; код комментируется на русском
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы
- src/bot/handlers.ts — новый обработчик bot.command('spec') после 'comment' (~строка 189, до bot.on('message:text')).
- Импорт: parseSpecCommand из './commands.js'; startPhase из '../web/orchestrator.js'; createTaskFile уже импортирован.

## Изменения
1. handlers.ts — бот.command('spec', ...):
   - requireBind(ctx); parseSpecCommand(ctx.match); при error — sendMd(parsed.error).
   - Заголовок задачи: первая строка/фраза описания, урезанная до 80 символов (без обрыва слова, + '…' если длиннее).
   - task = createTaskFile(deps.cwd, { title, description: parsed.description }).
   - result = startPhase(deps.cwd, task.id, 'spec'); при error — sendMd с текстом, при started — sendMd(`🚀 Фаза Spec запущена для ${task.id} (PID ${result.pid})`).
   - try/catch вокруг createTaskFile/startPhase — как в 'create'.
2. Оркестратор НЕ дублируем: прямой импорт '../web/orchestrator.js'. Путь templates: dist/web/orchestrator.js → ../../templates/ работает и из бота (общий dist). Доп. вынесение в общий модуль НЕ требуется.

## Порядок
Импорты → обработчик → pnpm test.

## Проверка
- pnpm build && node --test src.
- pnpm typecheck.
- Ручной smoke: запустить бота, привязать чат, /spec «...», убедиться что создаётся задача и стартует qwen (PID в ответе).

## Риски
- Средний: import из web/ в bot — связка слоёв; оправдано, т.к. оркестратор уже чистый модуль без web-зависимостей (только node:* и core).
- startPhase спавнит qwen — если бинаря нет, activeRuns всё равно помечает запуск; getRun покажет ошибку через logTail (это нормально, VL-43 покажет статус).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-02 22:57
---
Фаза 3 (Code) выполнена. Обработчик bot.command('spec') добавлен в src/bot/handlers.ts: requireBind → parseSpecCommand → createTaskFile (заголовок — первая фраза ≤80 символов по границе слова) → startPhase(cwd, task.id, 'spec') из ../web/orchestrator.js (без дублирования spawn). Ответ в чат: «🚀 Фаза Spec запущена для VL-X, PID N» либо текст ошибки (escapeMarkdownV2). Проверки: pnpm build чистый, headless smoke 8/8 (temp-backlog + заглушка VIBELOG_QWEN_BIN=/bin/echo: создание задачи, урезание заголовка, PID в ответе, пустой ввод/непривязанный чат, graceful-ошибки), pnpm test 359/359.
---
<!-- COMMENTS:END -->