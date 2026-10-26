---
id: lesson-42
title: Нормализуй даты в тестах к одному часовому поясу (local vs UTC)
status: active
tags:
  - tests
  - даты
  - флаки
  - TZ
source_tasks:
  - VL-188
linked_tasks:
  - VL-188
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема

В VL-188 тест lessons-api флакал: одна часть форматировала дату в local-часовом поясе, другая сравнивала с UTC (или наоборот) — на машине с другим TZ падение/непадение было случайным.

## Решение

В тестах даты приводи к одному часовому поясу до сравнения: либо всё через `toISOString()` (UTC), либо всё через локальные компоненты; никогда не сравнивай `new Date().toLocaleDateString()` с `toISOString().slice(0,10)`.
