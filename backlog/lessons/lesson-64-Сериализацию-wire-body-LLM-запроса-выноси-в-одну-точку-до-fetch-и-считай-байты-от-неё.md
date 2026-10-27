---
id: lesson-64
title: Сериализацию wire-body LLM-запроса выноси в одну точку до fetch и считай байты от неё
status: active
tags:
  - llm
  - diagnostics
  - wire-payload
  - agent
source_tasks:
  - VL-203
linked_tasks:
  - VL-203
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

При диагностике LLM-запросов (VL-203) размер payload считался через повторный `Buffer.byteLength(JSON.stringify(baseBody))` — но фактическое тело в `fetch` включает ещё `stream`/`stream_options`/`session_id`, добавляемые при сериализации. Два места сериализации расходились: лог отказа показывал байты, отличные от реально ушедших на wire.

## Решение

Выноси сериализацию тела в `const wireBody = JSON.stringify(...)` ДО `fetch` в одной точке (`requestWithRetry`), сразу за ней записывай `lastRequestBytes = Buffer.byteLength(wireBody, 'utf8')` в closure-переменную клиента. Все логи и `LlmResponse.payloadBytes` берут байты из неё — одно источник правды, байты всегда от фактического wire-body даже при отказе (fetch не вызван — а байты уже записаны).

## Пример

```ts
const wireBody = JSON.stringify(stream ? { ...body, stream: true } : body);
lastRequestBytes = Buffer.byteLength(wireBody, 'utf8');
res = await fetchImpl(url, { method: 'POST', body: wireBody, signal });
// ... позже в логе отказа: payload=${lastRequestBytes} байт
```