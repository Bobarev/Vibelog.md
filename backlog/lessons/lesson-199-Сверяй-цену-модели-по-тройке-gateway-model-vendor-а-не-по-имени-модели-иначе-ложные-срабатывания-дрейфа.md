---
id: lesson-199
title: 'Сверяй цену модели по тройке (gateway, model, vendor), а не по имени модели — иначе ложные срабатывания дрейфа'
status: active
tags:
  - pricing
  - catalog
  - models
  - vendor
  - drift
source_tasks:
  - VL-317
linked_tasks:
  - VL-317
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Шлюз (RouterAI) обслуживает одну и ту же модель через разных вендоров, и цены у вендоров разные: у `xiaomi/mimo-v2.6-flash` вендор `makora` даёт 13/29, а `xiaomi` — 14/29. Сверка тарифа из `.vibelog/settings.json` с каталогом «по имени модели» (взять первую/любую цену из `GET /v1/models/{author}/{model}/endpoints`) даёт ложный дрейф: цена в settings верна для своего вендора, но не совпадает с ценой чужого.

## Решение

Ключ сверки — тройка `(gateway, model, vendor)` из `ModelConfig` (VL-315). Вендор обязателен: без него сверка неоднозначна, поэтому `checkPricingDrift` ищет в каталоге именно эндпоинт запрошенного вендора, а не «цену модели вообще». Если вендор не задан или не найден в каталоге — состояние `unknown`, а не `drift` (не выдумываем расхождение).

## Пример

`src/core/pricing-guard.ts`: `checkPricingDrift(cwd, modelId)` берёт `conf.gateway`/`conf.model`/`conf.vendor`, зовёт `listCatalogVendors` и сравнивает `pricing` только с вендором `conf.vendor`; альтернативой для `on_drift: 'auto'` служит другой вендор ТОЙ ЖЕ модели из каталога. Тест в `src/core/pricing-guard.test.mjs` фиксирует, что при двух вендорах с разными ценами дрейф считается по своему.
