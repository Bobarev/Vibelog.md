---
id: lesson-38
title: Прокидывай query string в handleApi отдельным параметром и покрывай тестом с 5-м аргументом
status: active
tags:
  - web
  - api
  - testing
  - backend
source_tasks: []
linked_tasks:
  - VL-185
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

В VL-185 сервер (`src/web/server.ts`) отрезал `?...` до вызова `handleApi`, поэтому новый эндпоинт `GET /api/search?q=...` молча получал бы пустой query — backend работал, но поиск всегда пустой.

## Решение

Прежде чем добавлять эндпоинт с query string, проверь, где URL нормализуется до передачи в хендлер; если строка отрезается — прокинь сырой хвост отдельным опциональным параметром (`queryString: string = ''`, обратно совместимо) и покрой тестом вызовом `handleApi(method, url, body, cwd, 'q=...')` с 5-м аргументом. Один тест с query-строкой закрывает риск целиком.

## Пример

VL-185: `server.ts` сохраняет `rawUrl` и передаёт хвост после `?` пятым аргументом в `handleApi`; `src/web/search-api.test.mjs` вызывает `handleApi('GET', '/api/search', null, cwd, 'q=...')`.