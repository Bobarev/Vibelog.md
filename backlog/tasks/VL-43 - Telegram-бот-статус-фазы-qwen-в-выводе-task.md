---
id: VL-43
title: 'Telegram-бот: статус фазы qwen в выводе /task'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-02 22:34'
updated_date: '2026-10-02 22:39'
due_date: ''
labels:
  - telegram-bot
  - spec
dependencies:
  - VL-42
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Расширить вывод /task (src/bot/formatting.ts): для задачи показывать состояние её запусков фаз через getRun из оркестратора: «Фаза spec: выполняется (PID N)» / «Фаза spec: завершена (код 0)». Данные in-memory (activeRuns/lastRuns) — по аналогии с web UI. Задача без запусков — прежний вывод.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Для /spec VL-42 (активный запуск) ответ /task показывает строку вида «Фаза spec: выполняется (PID N)»
- [ ] #2 После завершения — «Фаза spec: завершена (код 0)» либо с кодом ошибки; задача без запусков — вывод как раньше (без строки о фазе)
- [ ] #3 pnpm test без регрессий
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
- src/bot/formatting.ts — форматирование статуса фазы.
- src/bot/handlers.ts — передать данные запуска в formatTaskDetail.
- src/bot/formatting.test.mjs — тесты новой строки.

## Изменения
1. formatting.ts — formatTaskDetail(task: Task, phaseRun?: { phase: string; running: boolean; pid?: number; exitCode?: number | null }): новый необязательный параметр. Если phaseRun — добавить строку после *Статус:*:
   - running: `*Фаза ${phase}: выполняется (PID ${pid})*`;
   - завершена с кодом 0: `*Фаза ${phase}: завершена (код 0)*`;
   - код ≠ 0/null: `*Фаза ${phase}: ошибка (код ${code})*`.
   - Экранировать через escapeMarkdownV2.
2. handlers.ts — в bot.command('task') перед вызовом formatTaskDetail: run = getRun(parsed id); если run — вторым аргументом. Импорт getRun из '../web/orchestrator.js'. Rich-путь (VL-39) НЕ трогаем — строка добавляется только в MarkdownV2-фолбэк и в sendMd.
3. formatting.test.mjs — кейсы: running/PID, завершена код 0, ошибка код 1, без run — без строки фазы.

## Порядок
formatting.ts → handlers.ts → тесты → pnpm test.

## Проверка
- pnpm build && node --test src && pnpm typecheck.
- Ручной: /spec … → /task VL-XX показывает «выполняется (PID …)»; после завершения — «завершена (код 0)».

## Риски
- Низкий. Необязательный параметр не ломает существующие вызовы (formatTaskDetail(task) в тестах VL-34/38 остаётся валидным).
- getRun — in-memory: после рестарта бота строка фазы не появится (как и в web — known limitation).
<!-- SECTION:PLAN:END -->