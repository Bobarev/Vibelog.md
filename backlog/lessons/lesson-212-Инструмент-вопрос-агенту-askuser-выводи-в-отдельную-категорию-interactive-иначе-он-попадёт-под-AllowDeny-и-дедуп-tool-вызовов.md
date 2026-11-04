---
id: lesson-212
title: Инструмент-вопрос агенту (ask_user) выводи в отдельную категорию interactive — иначе он попадёт под Allow/Deny и дедуп tool-вызовов
status: active
tags:
  - web
  - chat
  - hitl
  - tool-calls
  - policy
source_tasks:
  - VL-330
linked_tasks:
  - VL-330
created_date: 2026-11-04
updated_date: 2026-11-04
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

HITL-инструмент `ask_user` (пауза хода с вопросом и вариантами) похож на write-вызов: он тоже останавливает ход и ждёт решения клиента. При fail-safe классификации он попадает в write-категорию, и пользователь видит «Allow/Deny» и «Always allow» на вопрос, а дедуп одинаковых tool-вызовов схлопывает второй такой же вопрос — карточка не появляется.

## Решение

Заведи явную категорию `interactive` (функция вроде `isInteractiveTool`) и проверяй её ДО write-ветки гейта; ветки `checkGrant`/`isToolAllowed` к ней не применяются (разрешать вопрос заранее нельзя), а в списке исключений дедупа `ask_user` присутствует. Закрепи тестом `isWriteOperation('ask_user') === false` и тестом «два одинаковых ask_user подряд дают две карточки».

## Пример

VL-330: `src/core/tool-classify.ts` — категория `interactive`; `src/web/chat.ts` — ветка `isInteractiveTool(tc.name)` пишет событие `question` и делает `return` (как approval-ветка); `src/web/tool-dedup.ts` — исключение для `ask_user`. Тест `src/web/chat-ask-user.test.mjs`.
