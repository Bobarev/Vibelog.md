---
id: VL-62
title: 'Бот /comment: после комментария запуск фазы Comment через startPhase + ответ в чат VL-48'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 03:43'
updated_date: '2026-10-03 13:52'
due_date: ''
labels: []
dependencies:
  - VL-61
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
Интегрировать фазу 'comment' (VL-61) в команду /comment Telegram-бота.

Контекст: по VL-60 команда /comment VL-N <текст> должна не только добавлять комментарий, но и запускать headless-qwen с промптом-шаблоном (по аналогии с /spec /plan /code /close, хендлеры в src/bot/handlers.ts строки 237-430), который читает комментарий через MCP, выполняет его для задачи, оставляет отчёт комментарием и по завершении присылает в чат ответ по тому же шаблону (PhaseExitCallback VL-48).

Что сделать:
1. src/bot/handlers.ts, bot.command('comment') (строки ~220-235): после addComment — startPhase(cwd, task.id, 'comment', onExit). Текст комментария передаётся в промпт (учесть сигнатуру renderPrompt из VL-61).
2. onExit — паттерн VL-48: head «✅ Фаза Comment завершена для *VL-N*» / «⚠️ … с ошибкой — код …», logTail в ```-блоке (обрезка 3000), sendTaskView с актуальной задачей.
3. Guard «Фаза для этой задачи уже выполняется» — предупреждение в чат, комментарий при этом уже добавлен (не терять).
4. CHANGELOG.md: запись о новой возможности /comment → фаза Comment.
5. Тесты: парсер parseCommentCommand не меняется (VL-35) — проверить, что существующие тесты парсеров проходят; по возможности smoke-тест хендлера по образцу VL-51/53.

Зависит от VL-61 (фаза и шаблон должны существовать).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В src/bot/handlers.ts хендлер bot.command('comment'): после успешного addComment вызывается startPhase(cwd, task.id, 'comment', onExit) — комментарий добавляется всегда, а запуск qwen не блокирует ответ (fire-and-forget, guard «фаза уже выполняется» показывается как предупреждение)
- [ ] #2 onExit повторяет паттерн VL-48 (как у /spec /plan /code /close): сообщение «✅/⚠️ Фаза Comment завершена для VL-N», log tail в code-блоке (до 3000 символов), карточка задачи через sendTaskView
- [ ] #3 Текст комментария передаётся в фазу (через renderPrompt с {{comment}} или эквивалент из VL-61) — qwen выполняет именно этот комментарий; CHANGELOG.md обновлён; pnpm test проходит
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->