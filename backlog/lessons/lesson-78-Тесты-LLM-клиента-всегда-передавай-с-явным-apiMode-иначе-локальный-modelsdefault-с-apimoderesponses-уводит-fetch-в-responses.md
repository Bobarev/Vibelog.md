---
id: lesson-78
title: 'Тесты LLM-клиента всегда передавай с явным apiMode: иначе локальный models.default с api_mode=responses уводит fetch в /responses'
status: active
tags:
  - tests
  - llm
  - settings
  - api_mode
  - vl-209
source_tasks:
  - VL-218
linked_tasks:
  - VL-218
  - VL-223
  - VL-221
  - VL-228
  - VL-227
  - VL-240
created_date: 2026-10-29
updated_date: 2026-10-30
supersedes: lesson-86
---
### Проблема

`createLlmClient` резолвит активную модель из `.vibelog/settings.json` (`models.default` → `resolveActiveModel`, VL-209): при активной модели с `api_mode: responses` полный `pnpm test` падает 24 тестами `llm.test.mjs` — фейковый fetch получает URL `/responses`, а тесты ожидают `/chat/completions`, текст собирается пустым. Инцидент VL-218: конфиг с routerai-моделью добавлен в 17:46 (после зелёного прогона VL-217 в 17:04), код с тех пор не менялся — ложная «регрессия» в docs-фазе. Повторялось в каждой фазе Close (VL-221/223/226/227/228) — ручное переименование settings.json каждый раз съедало полный прогон.

### Решение

Дефект устранён в VL-240: `CLIENT_OPTS` в `src/agent/llm.test.mjs` содержит явный `apiMode: 'chat'`, поэтому тесты больше не зависят от локального (gitignored) `.vibelog/settings.json`. Правило на будущее: любой тест, создающий LLM-клиент, обязан передать `apiMode` явно (или `cwd` на пустой временный каталог) — иначе результат зависит от машины разработчика. Рантайм `resolveActiveModel(options.cwd ?? process.cwd())` не меняем: активная модель из cwd — боевое поведение `vibelog agent`/`bot`.

Если массовое падение llm-тестов всё же случилось — сверяй `models.default` в `.vibelog/settings.json` перед вердиктом «регрессия».

### Пример

```js
// src/agent/llm.test.mjs — изоляция от локальной конфигурации (VL-240)
const CLIENT_OPTS = { baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', retryDelayMs: 1, apiMode: 'chat' };
// тесты на responses перекрывают: createLlmClient({ ...CLIENT_OPTS, apiMode: 'responses' })
```