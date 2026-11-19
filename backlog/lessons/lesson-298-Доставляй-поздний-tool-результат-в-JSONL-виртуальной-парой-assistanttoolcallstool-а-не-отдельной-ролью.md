---
id: lesson-298
title: 'Доставляй поздний tool-результат в JSONL виртуальной парой assistant(tool_calls)→tool, а не отдельной ролью'
status: active
tags:
  - interbot
  - веб-чат
  - jsonl
  - llm
  - провайдер
  - поздняя-доставка
source_tasks: []
linked_tasks:
  - VL-431
created_date: 2026-11-19
updated_date: 2026-11-19
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Поздний ответ interbot-канала нужно было вдать модели в уже закрытый тред веб-чата, а «отдельная роль tool_async» невозможна: контракт LLM API допускает role:'tool' только как непосредственный ответ на assistant с tool_calls — провайдер отклоняет непарную историю; к тому же хвост jsonl с неотвеченным assistant(tool_calls) (approval-пауза) без предварительного закрытия синтетикой ломает payload, а дописка одной строкой посреди чужого живого хода даёт интерливинг.

## Решение
Поздний результат доставляется виртуальной парой в конец истории: assistant(content:null, tool_calls:[{id:'async-<ticketId>', name, arguments:{}}]) → tool(tool_call_id, content) — одной append-записью (парность assistant→tool в одной пачке), после закрытия pending-хвоста синтетикой и под guard'ом межпроцессного хода через sidecar turn.json; старые закрытые tool_call_id не переиспользуются, роль не изобретается.

## Пример
VL-431: deliverLateTicket в бот-процессе дописал пару в .vibelog/chat-sessions/&lt;threadId&gt;.jsonl (одной записью, под guard'ом turn.json) и стартанул авто-ход startChatRun — модель получила поздние данные в следующем POST; при сбое авто-хода дописка остаётся и догоняет следующее событие.