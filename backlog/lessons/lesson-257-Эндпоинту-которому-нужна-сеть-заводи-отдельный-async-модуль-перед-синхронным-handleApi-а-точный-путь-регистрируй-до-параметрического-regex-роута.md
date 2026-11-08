---
id: lesson-257
title: 'Эндпоинту, которому нужна сеть, заводи отдельный async-модуль перед синхронным handleApi, а точный путь регистрируй до параметрического regex-роута'
status: active
tags:
  - web
  - api
  - async
  - роутинг
  - server
source_tasks:
  - VL-358
linked_tasks:
  - VL-358
created_date: 2026-11-08
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`handleApi` в веб-сервере Vibelog синхронный (`src/web/api.ts`), поэтому эндпоинт, которому нужна сеть (обновление markdown-кэша url/doc-референсов через `downloadText` → `fetch`), в него не помещается: пришлось бы либо делать вид, что кэш «синхронизирован», либо терять одну из семантик URL. Второй капкан — порядок матчинга: точный путь `/api/references/sync` и параметрический `/api/references/:id/sync` похожи, и параметрический роут, проверенный первым, перехватывает точный (инцидент transient-404 из VL-174).

## Решение

1. Async-эндпоинт — отдельный модуль (`src/web/references-sync-api.ts`) с сигнатурой `handle... (method, url, body, cwd, deps): Promise<ApiResponse | null>`, где `null` = «URL не мой», дальше работает синхронный `handleApi`. Регистрация — в `server.ts` отдельной веткой **до** вызова `handleApi`, тем же `.then/.catch` паттерном, что у `catalog-api`.
2. Роут не дублируется в двух местах: старый синхронный вариант «только клоны» **переносится** в новый модуль, иначе у одного URL появляются две разные семантики (in-process вызовы получают урезанный результат).
3. Точный путь проверяется ДО regex параметрического: `url === '/api/references/sync'` первым, затем `url.match(/^\/api\/references\/([^/]+)\/sync$/)`; порядок закрепляется тестом «sync не попадает в :id-роут».

## Пример

```ts
// server.ts — ДО const result = handleApi(...)
const syncMatch = url === '/api/references/sync' || /^\/api\/references\/[^/]+\/sync$/.test(url);
if (method === 'POST' && syncMatch) {
  handleReferencesSyncApi(method, url, parsed, cwd)
    .then((result) => { /* null → 404, иначе writeHead(result.status) */ })
    .catch(/* 500 */);
  return;
}
```

Проверка: `POST /api/references/sync` → общий sync (клоны + кэш), `POST /api/references/ref-1/sync` → поштучный; тесты в `src/web/references-api.test.mjs` фиксируют обе ветки и отсутствие второй семантики в `handleApi` (там роут отдаёт 404).
