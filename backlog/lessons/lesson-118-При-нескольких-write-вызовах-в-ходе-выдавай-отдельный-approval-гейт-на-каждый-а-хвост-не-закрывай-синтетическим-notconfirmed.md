---
id: lesson-118
title: 'При нескольких write-вызовах в ходе выдавай отдельный approval-гейт на каждый, а хвост не закрывай синтетическим not_confirmed'
status: active
tags:
  - web
  - chat
  - approval
  - sse
  - hitl
source_tasks:
  - VL-256
linked_tasks:
  - VL-256
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Ход LLM с несколькими write-вызовами: сервер останавливался на первом и после решения по нему **молча закрывал остальные** синтетическим `ackDenied('not_confirmed')`. Пользователь видел `Отменено: не было подтверждения пользователя` без Allow/Deny, а по ответу инструмента нельзя было отличить отказ от потери подтверждения (VL-254/VL-256).

## Решение

- Гейт живёт на tool-call part (ref-22 local-runtime: «once every pending approval is decided … adapter invoked again»), значит естественная модель — **последовательные гейты**: после решения по вызову N исполняются read-only вызовы хвоста, а первый встретившийся write получает собственное событие `approval`; ход завершается, только когда решены все write-вызовы.
- `not_confirmed` оставляй только для реальной потери: пользователь прислал новое сообщение вместо решения, предохранитель лимитов итераций/времени (там хвост закрывается валидным для провайдера результатом).
- Пиши диагностический лог `<threadId>.approvals.jsonl` с `requested`/`decided` и номером хода — «запрошено без решения» = потерянное подтверждение, видно постфактум.
- Во фронте при повторном `approval` с тем же `toolCallId` **заменяй** part, а не пушил дубль: иначе два диалога, а `findIndex` в `tool_end`/`tool_start` сработает по первому.

## Пример

VL-256: `closeRemainingPending` → `advanceToNextApproval` в `src/web/chat.ts`; тест «три write → Allow/Allow/Deny» проверяет и состояние задач, и лог (3 requested / 3 decided, один turn).
