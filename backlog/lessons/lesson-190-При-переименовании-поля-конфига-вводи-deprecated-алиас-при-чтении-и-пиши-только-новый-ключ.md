---
id: lesson-190
title: При переименовании поля конфига вводи deprecated-алиас при чтении и пиши только новый ключ
status: active
tags:
  - settings
  - refactor
  - compat
  - models
source_tasks:
  - VL-315
linked_tasks:
  - VL-315
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Переименование ключа/поля в `.vibelog/settings.json` (VL-315: секция `providers` → `gateways`, `ModelConfig.provider` → `gateway`, мета сессии `model_provider` → `model_gateway`) ломает существующие конфиги и resume старых сессий, если читать только новое имя.

## Решение

Читать оба имени (новое приоритетнее по совпадающим id), записывать только новое. Старое имя объявить deprecated-алиасом в одном месте чтения — не размазывать `if (settings.providers ?? settings.gateways)` по потребителям. Функцию-экспортёр старого имени (`loadProviders` → `loadGateways`) оставить тонким алиасом на переходный период. Идентичность ресурса в мете/кэше переводить парой (новое поле + неизменная часть), не добавляя в неё новые необязательные поля: `vendor` не входит в пару `gateway + model`, иначе смена апстрима ломала бы resume.

## Пример

```ts
// src/core/models.ts
for (const section of [settings.providers, settings.gateways]) { /* gateways поверх */ }
export function loadProviders(cwd: string) { return loadGateways(cwd); } // @deprecated
```

Правило нормализации старого синтаксиса (`@provider=X` в строке модели) держать в ОДНОЙ функции (`parseVendorSuffix`) и использовать её и при чтении, и при разборе записи — иначе правила чтения и записи разъедутся.
