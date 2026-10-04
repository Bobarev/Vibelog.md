---
id: VL-57
title: 'Telegram-бот: команда /close VL-N (парсер + обработчик + реестр + CHANGELOG)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 01:16'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies:
  - VL-56
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
Команда /close VL-N в Telegram-боте — запуск Фазы Close через headless qwen.

Контекст: /spec /plan /code (VL-42/51/53) уже работают по паттерну: парсер в commands.ts + bot.command + startPhase + PhaseExitCallback (VL-48). /close идентичен по коду, фаза — 'close' (шаблон и оркестратор — VL-56).

Что сделать:
1. src/bot/commands.ts: parseCloseCommand + интерфейс CloseCommand — копия parseCodeCommand с hint «Синтаксис: /close VL-<id>».
2. src/bot/handlers.ts: bot.command('close') — копия обработчика /code: getTask → onExit (сообщение «✅ Фаза Close завершена для <id>» / «⚠️ ... с ошибкой», logTail ≤3000 в ```, карточка задачи) → startPhase(cwd, task.id, 'close', onExit) → «🚀 Фаза Close запущена для <id>, PID ...». Добавить JSDoc-комментарий с паттерном VL-53.
3. src/bot/registry.ts: BOT_COMMANDS += { command: 'close', description: 'Закрыть задачу и закоммитить файлы через qwen' }.
4. CHANGELOG.md: запись о /close.
5. Юнит-тесты парсера + smoke-проверка (по образцу VL-53: pnpm test + ручной прогон бота).

Зависимость VL-56: startPhase('close') без фазы в PHASES вернёт ошибку renderPrompt.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 parseCloseCommand в src/bot/commands.ts (паттерн parseCodeCommand: ID — первое слово, hint «Синтаксис: /close VL-<id>»); юнит-тесты в src/bot/commands.test.mjs: валидный ID, пустой ввод → {error}, хвостовой текст игнорируется
- [x] #2 Обработчик bot.command('close') в src/bot/handlers.ts по паттерну /code (VL-53): requireBind, parse, getTask (задача не найдена → сообщение), PhaseExitCallback VL-48 (✅/⚠️ заголовок + logTail в pre-блоке + карточка задачи sendTaskView), startPhase(cwd, id, 'close', onExit)
- [x] #3 /close добавлен в BOT_COMMANDS (src/bot/registry.ts) с русским описанием — меню Telegram и help /start автоматически актуальны (VL-54); CHANGELOG дополнен
- [x] #4 pnpm build и pnpm test проходят (без регрессий в существующих тестах)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 01:38
---
Фаза 3 (Code) выполнена. Изменено: src/bot/commands.ts (CloseCommand + parseCloseCommand — копия parseCodeCommand с hint «Синтаксис: /close VL-<id>»), src/bot/handlers.ts (импорт parseCloseCommand + bot.command('close') после /code и до catch-all message:text: requireBind, parse, getTask → «не найдена», PhaseExitCallback VL-48 — ✅/⚠️ заголовок + logTail ≤3000 в pre-блоке + карточка sendTaskView, startPhase(cwd, id, 'close', onExit), ответ «🚀 Фаза Close запущена …»), src/bot/registry.ts (запись close в BOT_COMMANDS — меню Telegram и help /start генерируются из реестра, VL-54), src/bot/commands.test.mjs (+4 теста parseCloseCommand: ID, пробелы, хвостовой текст, пустой ввод), src/bot/registry.test.mjs (length 10→11, help-строка += /close), CHANGELOG.md (пункт VL-55). Проверки: pnpm build OK, pnpm test — 384/384 (включая сверку порядка bot.command в handlers.ts с реестром). Что осталось: git commit (по правилам Фазы 3 не выполняется), ручная smoke-проверка бота (vibelog bot → /close VL-N в привязанном чате).
---
<!-- COMMENTS:END -->