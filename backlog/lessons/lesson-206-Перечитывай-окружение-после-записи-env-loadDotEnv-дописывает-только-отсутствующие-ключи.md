---
id: lesson-206
title: Перечитывай окружение после записи .env — loadDotEnv дописывает только отсутствующие ключи
status: active
tags:
  - env
  - init
  - cli
  - проверки
source_tasks:
  - VL-327
linked_tasks:
  - VL-327
created_date: 2026-11-04
updated_date: 2026-11-04
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

`vibelog init` читал `.env` один раз ДО wizard-а, а wizard дописывал туда `ROUTERAI_API_KEY`/`TELEGRAM_PROXY`. Так как `loadDotEnv` пишет в `process.env` только отсутствующие ключи, повторного чтения не происходило: финальные проверки работали на устаревшем окружении — LLM-ping уходил без `Authorization` (401 Unauthorized), а `getMe` Telegram шёл напрямую мимо прокси и падал по таймауту. Снаружи это выглядело как «wizard записал неверные настройки», хотя файл был корректным.

## Решение

Любой код, который пишет секреты в `.env`/settings и ЗАТЕМ их проверяет, обязан перечитать окружение (`loadProjectEnv(cwd)`) между записью и проверкой. Проверки, которым нужен прокси, принимают его параметром (`checkTelegramToken(token, { proxy })`) и используют undici `ProxyAgent`, а не голый `globalThis.fetch`. Отдельно: при пустом ключе проверка должна сообщать «ключ <ENV_NAME> не найден в окружении», а не отдавать неинформативный 401 от сервера.

## Пример

```ts
loadProjectEnv(cwd);            // первый раз — дефолты для wizard-а
const answers = await runWizard(settings);
applySetup(cwd, answers);       // дописал .env
loadProjectEnv(cwd);            // VL-327: без этого проверки видят старое окружение
await runChecks(cwd, { proxy: process.env.TELEGRAM_PROXY });
```