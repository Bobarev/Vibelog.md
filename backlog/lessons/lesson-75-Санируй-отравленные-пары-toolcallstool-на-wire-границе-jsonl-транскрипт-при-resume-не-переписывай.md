---
id: lesson-75
title: 'Санируй отравленные пары tool_calls/tool на wire-границе, jsonl-транскрипт при resume не переписывай'
status: active
tags:
  - llm
  - agent
  - wire-payload
  - jsonl
  - resume
  - sanitization
source_tasks:
  - VL-216
linked_tasks:
  - VL-216
created_date: 2026-10-29
updated_date: 2026-10-29
supersedes: ''
---
## Проблема

Старые jsonl-сессии (VL-214, agent-1793269309877) содержат отравленные пары `assistant.tool_calls` с пустым `id`/`name` и парный `tool` с `tool_call_id=""`. Контракт resume (VL-103) запрещает переписывать транскрипт (append-only источник правды), но такие пары уходили провайдеру и мгновенно роняли guard VL-110.

## Решение

Санируй на wire-границе, а не в файле: одна функция `sanitizeWireMessages` (src/agent/llm.ts) применяется во всех точках ухода запроса — `toWireMessages` (chat), `messagesToInput` (Responses) и payload-точке `runLoop` (loop.ts) — jsonl не мутируется. Алгоритм — один forward-pass: валидные tool_calls сохраняются (объявленные id — в trim-Set), assistant только из фантомов переписывается в текстовую форму или вырезается, `tool` с пустым/необъявленным `tool_call_id` вырезается. Функция идемпотентна, поэтому двойное применение loop→wire безопасно, а prefix-caching не ломается (детерминирована между запросами).

## Пример

```ts
// Точка входа провайдера (llm.ts):
export function toWireMessages(messages: ChatMessage[]) {
  messages = sanitizeWireMessages(messages); // VL-216: jsonl полон, чистится только уходящее
  ...
}
```