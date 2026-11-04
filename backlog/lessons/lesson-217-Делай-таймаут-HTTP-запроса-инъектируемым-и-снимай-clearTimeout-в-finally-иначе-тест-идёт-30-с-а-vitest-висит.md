---
id: lesson-217
title: 'Делай таймаут HTTP-запроса инъектируемым и снимай clearTimeout в finally — иначе тест идёт 30 с, а vitest висит'
status: active
tags:
  - network
  - http
  - tests
  - vitest
  - timeout
source_tasks:
  - VL-335
linked_tasks:
  - VL-335
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

HTTP-клиент с таймаутом 30 с при наивной реализации ломает тесты двумя способами: (1) тест на таймаут идёт полминуты и раздувает прогон; (2) `setTimeout` без `clearTimeout` оставляет висящий хендл — vitest не завершает worker, процесс висит. Плюс лимит размера тела, реализованный через `await response.text()` и последующую проверку длины, буферизует все 5 МБ+ в память и не является реальной защитой от подмены реестра.

## Решение

- Таймаут инъектируемый: параметр `timeoutMs` в опциях запроса с дефолтом `REQUEST_TIMEOUT_MS = 30_000`; тест передаёт 20–50 мс и проверяет `kind: 'timeout'` за миллисекунды.
- `setTimeout` + `AbortController` всегда в паре с `clearTimeout` в `finally` — иначе таймер держит event loop и vitest зависает.
- Лимит тела — только стримингом: читать `response.body` ридером чанками, считать байты, при превышении `reader.cancel()` и ошибка `too_large` до парсинга. `Content-Length` не проверять как единственный барьер (заголовок может отсутствовать/лгать).
- GitVerse отвечает `400` вместо `404` и `text/plain` вместо `application/json`: классифицировать по статусу кода и факту `JSON.parse`, а не по `content-type`; `400` и `404` принимать оба как `not_found` — иначе клиент завязывается на один хост.

## Пример

`src/core/registry-fetch.ts` (VL-335): `fetchOnce(url, {timeoutMs = REQUEST_TIMEOUT_MS})` — `AbortController` + `setTimeout`, `clearTimeout` в `finally`, тело через `response.body.getReader()` с суммированием `chunk.byteLength`; тест на таймаут (`src/core/registry-fetch.test.mjs`) проходит с `timeoutMs: 20` и не тормозит прогон, тест на лимит отдаёт 6 МБ и получает `too_large` без полной загрузки.
