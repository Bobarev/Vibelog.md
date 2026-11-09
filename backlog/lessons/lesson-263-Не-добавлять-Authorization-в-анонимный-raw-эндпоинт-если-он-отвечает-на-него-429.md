---
id: lesson-263
title: 'Не добавлять Authorization в анонимный raw-эндпоинт, если он отвечает на него 429'
status: active
tags:
  - gitverse
  - registry
  - http
  - regression
source_tasks:
  - VL-382
linked_tasks:
  - VL-382
created_date: 2026-11-09
updated_date: 2026-11-09
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
VL-380 добавила в raw-запрос GitVerse заголовок Authorization: Bearer «для более высокого лимита», и vb install в проекте с GITVERSE_TOKEN стал падать всегда: raw-эндпоинт отвечает 429 на любой запрос с этим заголовком (замеры 2026-11-09), а без него — 200.

## Решение
Держать две схемы доступа раздельно: анонимный raw без Authorization и Contents API (api.gitverse.ru) с Bearer и кастомным Accept. Зафиксировать факты замерами в шапке модуля, защитить тестом-регрессией «в raw-запросе нет заголовка authorization при любом наличии токена» и явным параметром transport для выбора схемы.

## Пример
VL-382: resolveRegistryTransport выбирает raw при пустом GITVERSE_TOKEN и Contents API при непустом; в raw-ветке заголовок authorization не формируется вообще, а тест registry-fetch.test.mjs проверяет его отсутствие при токене из опций и из .env.