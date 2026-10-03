---
id: VL-68
title: 'Бот: команда /prompt — произвольный запрос через qwen без задачи'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-03 15:21'
updated_date: '2026-10-03 15:21'
due_date: ''
labels: []
dependencies:
  - VL-67
milestone: ''
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
Команда Telegram-бота для мелких запросов, не требующих задачи (VL-66).

Состав:
1. Парсер parsePromptCommand в src/bot/commands.ts — «весь текст после /prompt», пустой → {error: подсказка}. Юнит-тесты в commands.test.mjs.
2. Обработчик bot.command('prompt') в src/bot/handlers.ts: requireBind → парсер → startPrompt(deps.cwd, текст, onExit) из оркестратора (задача VL-67). В отличие от фаз spec/plan/code/close/comment карточка задачи не шлётся — задачи нет; по завершении только информационное сообщение formatPhaseResult (паттерн VL-63/VL-65, sendText по chatId из замыкания).
3. Запись в BOT_COMMANDS (src/bot/registry.ts): { command: 'prompt', description: 'Выполнить запрос через qwen без задачи', usage: '/prompt <текст>' }.
4. Документация: таблица команд в docs/user-guide.md (раздел 11 «Telegram-бот») + запись в CHANGELOG.md.

Зависит от VL-67 (startPrompt в оркестраторе).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда /prompt <текст> зарегистрирована в реестре registry.ts (меню Telegram + help /start) и обрабатывается: после requireBind запускает qwen через startPrompt, отвечает PID в чат
- [ ] #2 Пустой запрос → подсказка синтаксиса на русском (parsePromptCommand в commands.ts, юнит-тесты)
- [ ] #3 По завершении в чат приходит информационное сообщение по шаблону VL-63 (formatPhaseResult): статус, результат qwen, токены, время, session_id; карточка задачи НЕ шлётся (задачи нет)
- [ ] #4 Документация обновлена: docs/user-guide.md (раздел 11, таблица команд бота) и CHANGELOG.md
- [ ] #5 Юнит-тесты проходят (pnpm test = build + node --test src)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->