---
id: lesson-84
title: При падении тестов llm.test.mjs проверяй локальный .vibelog/settings.json — api_mode=responses меняет дефолт клиента
status: outdated
tags:
  - тесты
  - настройки
  - llm
  - изоляция
source_tasks:
  - VL-226
linked_tasks:
  - VL-226
created_date: 2026-10-30
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

При закрытии VL-226 полный прогон `pnpm test` дал 24 падения в одном файле `src/agent/llm.test.mjs` (стриминговые тесты: `res.text === ''`, `state.bodies[0]` undefined). Причина не в коде задачи и не в merge: локальный (gitignored) `.vibelog/settings.json` содержит `models.available.*.api_mode: "responses"`, поэтому `createLlmClient` с дефолтным `cwd` выбирает `/responses` вместо `/chat/completions`, которого ждут мок-тесты (они передают baseUrl/model/apiKey, но не apiMode и не cwd).

## Почему урок устарел

**Диагностический ритуал («временно переименуй `.vibelog/settings.json`») больше не нужен.**

- VL-240 закрыл причину в самих тестах: `src/agent/llm.test.mjs` передаёт `apiMode: 'chat'` явно в `CLIENT_OPTS` (строки 68–74 файла) и `cwd` на пустой каталог в кейсах про `models` — локальная настройка на них больше не влияет.
- Правило «тесты модели не должны зависеть от машины разработчика» перешло в `lesson-78` (`apiMode` явно) и `lesson-140`-соседнюю область инвариантов; здесь остаётся только история инцидента.

## Что делать вместо ритуала

Если `llm.test.mjs` всё же падает — сначала смотри, не появился ли новый тест **без** явного `apiMode`/`cwd`; прогон с `env -u VIBELOG_CWD` и настройка `models.default` относятся к другой проблеме (`lesson-88`, `lesson-120`).

## Пример (исторический)

```bash
mv .vibelog/settings.json .vibelog/settings.json.bak
npx vitest run src/agent/llm.test.mjs   # 52 passed — регрессии нет
mv .vibelog/settings.json.bak .vibelog/settings.json
```
