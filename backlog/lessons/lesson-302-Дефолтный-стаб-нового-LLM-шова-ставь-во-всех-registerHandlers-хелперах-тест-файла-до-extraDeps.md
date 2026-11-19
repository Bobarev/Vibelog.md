---
id: lesson-302
title: Дефолтный стаб нового LLM-шова ставь во всех registerHandlers-хелперах тест-файла до extraDeps
status: active
tags:
  - tests
  - llm
  - bot
  - handlers
  - seam
  - vl-436
source_tasks:
  - VL-436
linked_tasks:
  - VL-436
created_date: 2026-11-19
updated_date: 2026-11-19
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Новый LLM-шов в HandlerDeps (VL-436 — `gate`) по умолчанию резолвится в реальный `runGate` → `createLlmClient`: без дефолтного стаба в тест-хелперах все существующие тесты dispatch/handleUpdate уходят в настоящий сетевой вызов модели на каждое входящее сообщение — медленно, падает без API-ключа и ловит локальную конфигурацию (паттерн VL-240/lesson-78).

## Решение
Добавляя новый LLM-шов (или вообще новый необязательный deps-колбэк с сетевым эффектом) в HandlerDeps, сразу ставь дефолтный стаб во ВСЕ registerHandlers-хелперах тест-файла ДО `...extraDeps`, чтобы конкретный тест мог его переопределить, а остальные не уходили в сеть.

## Пример
VL-436: в handlers.test.mjs оба registerHandlers-хелпера получили `gate: async () => ({ verdict: 'react' })` ДО `...extraDeps` — иначе 20+ существующих тестов dispatch ушли бы в реальный вызов модели на каждое входящее (паттерн VL-240/lesson-78 для LLM-клиента).