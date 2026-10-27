---
id: lesson-60
title: При втором API-режиме LLM ветвляй только URL/body/парсеры — ретраи и фолбэк оставляй общими
status: active
tags:
  - llm
  - api
  - responses
  - refactor
  - agent
source_tasks: []
linked_tasks:
  - VL-205
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

При добавлении второго LLM API-режима (Responses API, VL-205) возникло искушение/риск переписать общий конвейер запроса (ретраи, фолбэк моделей, high-risk shrink-цикл).

## Решение

Ветвляй по режиму ТОЛЬКО в точках, где формат wire отличается: URL, сборка body, парсер ответа (stream/non-stream). Ретраи, attemptWithFallback и работа с ChatMessage[] оставляй общими — они от формата wire не зависят.

## Пример

```ts
// llm.ts VL-205: две точки ветвления — всё остальное общее
const url = apiMode === 'responses' ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
// в attemptWithFallback:
const result = apiMode === 'responses'
  ? await parseSseResponses(streamRes, onToken)
  : await parseSse(streamRes, onToken);
```

Благодаря этому регрессия chat-режима закрыта существующими ~40 тестами без правок.