---
id: lesson-264
title: 'Обслуживай в HTTP-фикстуре оба маршрута транспорта и подменяй обе базовые env-переменные, если выбор схемы зависит от токена'
status: active
tags:
  - testing
  - http
  - fixture
  - registry
  - env
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
Когда выбор HTTP-транспорта зависит от наличия токена в окружении, фикстура, подменяющая только базовый URL одного транспорта, молча перестаёт покрывать тест: после появления токена запрос уходит на второй хост, локальный сервер отвечает 404, и падение выглядит как регрессия кода, а не теста.

## Решение
Держать в HTTP-фикстуре оба маршрута сразу и подменять обе переменные базового URL на один локальный сервер — тогда тест проходит при любом состоянии токена и проверяет именно ту схему, которую заявляет.

## Пример
В install-progress.test.mjs (VL-381) фикстура обслуживала только /raw/branch/ и подменяла лишь VIBELOG_REGISTRY_BASE_URL; после VL-382 тест писал GITVERSE_TOKEN в .env, CLI уходил на Contents API, фикстура отвечала 404 → CLI падал с кодом 3 вместо 0. Исправление: createServer отдаёт оба маршрута (/contents/ с конвертом {type,encoding:base64,content,size,sha}, raw как раньше), runCli подменяет и VIBELOG_GITVERSE_API_BASE, и VIBELOG_REGISTRY_BASE_URL на один локальный сервер.