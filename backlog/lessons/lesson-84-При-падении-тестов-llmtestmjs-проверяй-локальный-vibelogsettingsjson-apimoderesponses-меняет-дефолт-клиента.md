---
id: lesson-84
title: При падении тестов llm.test.mjs проверяй локальный .vibelog/settings.json — api_mode=responses меняет дефолт клиента
status: active
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
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

При закрытии VL-226 полный прогон `pnpm test` дал 24 падения в одном файле `src/agent/llm.test.mjs` (стриминговые тесты: `res.text === ''`, `state.bodies[0]` undefined). Причина не в коде задачи и не в merge: локальный (gitignored) `.vibelog/settings.json` содержит `models.available.*.api_mode: "responses"`, поэтому `createLlmClient` с дефолтным `cwd` выбирает `/responses` вместо `/chat/completions`, которого ждут мок-тесты (они передают baseUrl/model/apiKey, но не apiMode и не cwd).

## Решение

Перед разбором падений llm-тестов сначала проверь окружение: временно переименуй `.vibelog/settings.json` и прогони файл ещё раз. Если он зелёный — это локальный конфиг, а не регрессия; в отчёте закрытия это надо описать явно, а не чинить «чужие» тесты в фазе Close.

## Пример

```bash
mv .vibelog/settings.json .vibelog/settings.json.bak
npx vitest run src/agent/llm.test.mjs   # 52 passed — регрессии нет
mv .vibelog/settings.json.bak .vibelog/settings.json
```

Тесты, зависящие от дефолтов реестра моделей, должны передавать `cwd` на пустой каталог (как уже делают кейсы VL-209), иначе результат зависит от машины разработчика.