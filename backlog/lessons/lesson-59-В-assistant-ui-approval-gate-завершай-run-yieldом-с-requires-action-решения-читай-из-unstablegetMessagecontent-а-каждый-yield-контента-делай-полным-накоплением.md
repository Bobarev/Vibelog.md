---
id: lesson-59
title: 'В assistant-ui approval-gate завершай run yield''ом с requires-action, решения читай из unstable_getMessage().content, а каждый yield контента делай полным накоплением'
status: active
tags:
  - assistant-ui
  - chat
  - hitl
  - web
  - sse
source_tasks:
  - VL-204
linked_tasks:
  - VL-204
created_date: 2026-10-27
updated_date: 2026-11-01
supersedes: ''
last_verified: 2026-11-01
verified_by: agent
applies_to: []
kind:
---
## Проблема

В assistant-ui 0.15 approval-gate (human-in-the-loop Allow/Deny) нет в готовых примерах quickstart: нужно знать три неочевидные вещи, иначе run зависает или решения не доходят до бэкенда.

## Решение

1. Генератор `ChatModelAdapter.run` завершается **последним yield'ом со `status: { type: "requires-action", reason: "tool-calls" }`**, а в content есть tool-call part с `approval: { id: toolCallId }` (без поля `approved`) — только тогда рантайм ставит паузу и не перетирает статус в `complete`.
2. После Allow/Deny рантайм вызывает adapter повторно; решения читаются из `unstable_getMessage().content` — у tool-call part поле `approval.approved === boolean`. Отправляй их на сервер и **помечай id отправленных** (Set), иначе повторный run переотправит старое решение.
3. Каждый yield несёт **полный накопленный content текущего run**, а не дельту: рантайм пересобирает сообщение как `[...initialContent, ...yield.content]` — дельта затёрла бы контент предыдущих шагов.

## Пример

VL-204: первый run yield'ит parts с `approval`, статус requires-action; resume-run POST `{threadId, approval:{toolCallId, approved}}` → сервер продолжает цикл → новый текст докидывается в ту же нить.

> Путь уточнён при санитарном проходе (VL-281): фронтенд живёт в отдельном workspace — `web/src/components/chat/chat-runtime.tsx` (не `src/web/components/...`).
