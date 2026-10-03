---
id: VL-59
title: 'Хендлеры бота: общий notifуPhase + ветка «отчёт получен» (раннее уведомление)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 02:53'
updated_date: '2026-10-03 12:23'
due_date: ''
labels:
  - bot
  - qwen
  - refactor
dependencies:
  - VL-58
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
Продолжение VL-58: onExit-колбэки продублированы в 4 хендлерах (handlers.ts: /spec, /plan, head «Фаза Plan…», /code, /close — каждый ~40 строк). Вынести общий makePhaseExitNotifier(bot, deps, taskId, phaseLabel): замыкание с notifyChat, try/catch, void-async — паттерн VL-48. Ветвление по run.source: 'report' → head «✅ *Фаза <Label>: отчёт получен* — процесс завершается» + sendTaskView(bot, chatId, fresh, run) (rich-рендер показывает отчёт-комментарий); иначе (обычный exit/error) — текущая логика без изменений (✅/⚠️ + код + лог pre ≤3000 + карточка). Сокращение: ~160 строк дублирования → 1 общий notifу + 4 коротких вызова. Файлы: src/bot/handlers.ts, smoke /tmp (vl58/59), pnpm test.

Зависимость: VL-58 (нужен run.source в PhaseRun).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Обработчики /spec /plan /code /close переведены на общий notifуPhase (дублирование ~40 строк ×4 убрано); тексты обычного пути не изменились
- [ ] #2 Раннее срабатывание (run.source==='report'): в чат «✅ Фаза X: отчёт получен — процесс завершается» + карточка sendTaskView (отчёт-комментарий виден в rich-рендере)
- [ ] #3 Smoke «отчёт раньше выхода»: заглушка пишет маркер-отчёт и висит → в чат сразу «отчёт получен» (без «завершена (код …)»); kill → дубля нет; pnpm test без регрессий
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
created: 2026-10-03 12:22
---
ЗАКРЫТА по решению Pavel (2026-10-03) вместе с VL-58: первопричина (память qwen в settings) устранена на стороне qwen — общий notifуPhase и ветка «отчёт получен» не требуются. Дублирование onExit в 4 хендлерах остаётся как есть (рефактор — при желании позже, отдельной задачей).
---
<!-- COMMENTS:END -->