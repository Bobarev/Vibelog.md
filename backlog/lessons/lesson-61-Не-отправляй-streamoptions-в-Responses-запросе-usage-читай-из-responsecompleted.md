---
id: lesson-61
title: Не отправляй stream_options в Responses-запросе — usage читай из response.completed
status: active
tags:
  - llm
  - responses
  - streaming
  - usage
  - api
source_tasks: []
linked_tasks:
  - VL-205
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

В запросах OpenAI-совместимых провайдеров есть поля, которые работают только в одном API: `stream_options: { include_usage: true }` валидно для Chat Completions, но строгий Responses-провайдер (RouterAI/MiMo) ответит 400 на неизвестное поле тела.

## Решение

Собирай тело запроса раздельно по режиму: `stream_options` добавляй только при chat, usage в responses-стриме читай из события `response.completed` (`obj.response.usage` → mapUsage с `input_tokens_details`/`output_tokens_details`).

## Пример

```ts
// llm.ts VL-205
stream ? JSON.stringify(
  apiMode === 'responses'
    ? { ...body, stream: true }
    : { ...body, stream: true, stream_options: { include_usage: true } }
) : ...
```

Тест фиксирует: тело responses-запроса не содержит stream_options, usage приходит в response.completed.