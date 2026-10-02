---
id: VL-51
title: 'Telegram-бот: обработчик /plan — запуск Фазы 2 (Plan) через startPhase'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:46'
updated_date: '2026-10-03 00:05'
due_date: ''
labels: []
dependencies:
  - VL-50
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
Обработчик bot.command('plan') в src/bot/handlers.ts по аналогии с /spec (VL-42/48): requireBind → parsePlanCommand (VL-50) → getTask(cwd, id) для проверки существования → startPhase(cwd, id, 'plan', onExit) с колбэком уведомления о завершении (статус фазы + лог qwen + карточка задачи, паттерн VL-48). В отличие от /spec задача НЕ создаётся — аргумент это ID существующей задачи (обычно после /spec, статус Planned). Зарегистрировать команду до catch-all message:text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /plan VL-49 в привязанном чате: задача существует → startPhase(cwd, 'VL-49', 'plan', onExit) из src/web/orchestrator.ts (без дублирования spawn-логики), ответ «🚀 Фаза Plan запущена для VL-49, PID N»
- [x] #2 Задача не найдена (getTask вернул null) → сообщение об ошибке в чат, qwen не запускается; guard «Фаза для этой задачи уже выполняется» от startPhase тоже отдаётся в чат
- [x] #3 По завершении фазы (onExit, паттерн VL-48): в чат уходит статус фазы + лог qwen (≤3000 символов в pre-блоке) + карточка задачи через sendTaskView; ошибки сети не роняют бот; pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 00:05
---
Фаза 3 (Code) выполнена. Обработчик bot.command('plan') в src/bot/handlers.ts: requireBind → parsePlanCommand → getTask (не найдена → сообщение, qwen не стартует) → startPhase(cwd, id, 'plan', onExit) — колбэк VL-48-паттерна (статус фазы + лог qwen ≤3000 в pre-блоке + карточка через sendTaskView); guard «уже выполняется» → в чат. Зарегистрирован до catch-all message:text. Проверки: headless smoke 11/11 (старт+PID, уведомление, лог pre, rich-карточка, строка фазы, VL-999 не найдена, guard, exit-3), pnpm test 370/370.
---
<!-- COMMENTS:END -->