---
id: lesson-204
title: 'Локация секретов `system` в setup должна только сообщать имена переменных и не писать ничего на диск'
status: active
tags:
  - init
  - wizard
  - secrets
  - env
  - setup
source_tasks:
  - VL-324
linked_tasks:
  - VL-324
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

В wizard-е `vibelog init` пункт «где хранить API-ключи» исторически означал «куда записать секрет». Когда пользователь выбирает «env (приоритет env → .env)» — то есть «я сам заведу переменные окружения» — наивная реализация всё равно пишет `.env` или секцию `env` в `settings.json`, затирая ручную настройку и создавая дубль источника правды.

## Решение

Раздели «локация секретов» на два поведения: `system` — НИЧЕГО не писать на диск, только вывести список имён переменных, которые пользователь должен завести (`ROUTERAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, …); `env`/`settings`/`both` — писать как раньше. Чтение секретов при этом уже идёт `env → .env`, поэтому `system` не требует изменений в рантайме. Старые ключи из секции `env` в `settings.json` продолжают читаться — секцию убираем отдельной задачей, когда `.vibelog` уйдёт из `.gitignore`.

## Пример

VL-324: `src/core/setup-secrets.ts` — `SecretsLocation = 'system' | 'env' | 'settings' | 'both'`, `writeSecrets(cwd, secrets, 'system')` возвращает пустой список записанных файлов; `applySetup` для `system` печатает предупреждение с именами переменных. Тест `setup.test.mjs` «локация system не пишет .env» и `init-wizard.test.mjs` «--secrets-location system не пишет .env, но сообщает имена» фиксируют отсутствие файла.
