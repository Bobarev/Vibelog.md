---
id: lesson-29
title: 'Не вставляй ID задач (VL-N) в шаблоны templates/*.md — тесты VL-117/VL-157 падают'
status: superseded
tags:
  - templates
  - prompts
  - tests
  - VL-117
  - VL-157
source_tasks:
  - VL-178
linked_tasks:
  - VL-178
created_date: 2026-10-25
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

В `templates/agent-prompt.md` (базовый системный промпт агента) была добавлена строка со ссылкой «инцидент VL-178». Тесты `system-prompt.test.mjs` (VL-117: «в базовой части нет упоминаний VL-N») и `phase-prompt.test.mjs` (VL-157: «в шаблонах промптов нет внутренних ID задач») упали — `pnpm test:fast` их не прогонял в тот момент из-за раннего grep-фильтра, и падение всплыло только на полном `pnpm test`.

## Решение

> **Заменён: `lesson-140`.** Полное правило (все файлы `templates/`, оба инвариант-теста, формулировки без ID) собрано там. Этот урок оставлен как история первого случая.

Во **всех** файлах `templates/*.md` и `templates/qwen-commands/*.md` не упоминать внутренние ID задач Vibelog (VL-178, VL-N, VL-XX) — шаблоны уходят во внешние проекты, где эти ID ничего не значат. Писать без ID: «инцидент: два вывода по 624 КБ → отказ провайдера». ID задач можно оставлять в `AGENTS.md`/`MCP-SETUP.md` проекта — они не покрыты тестами переносимости.

## Пример

Плохо: `- Не используй take_screenshot … (инцидент VL-178: …)` в `templates/agent-prompt.md`.
Хорошо: `- Не используй take_screenshot … (инцидент: два вывода по 624 КБ → отказ провайдера «high risk»)…` — тот же текст в `AGENTS.md` с `VL-178` допустим.
