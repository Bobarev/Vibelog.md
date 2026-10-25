---
id: lesson-31
title: 'Ветвляй шаблоны фаз по «type ≠ epic», а не по «type = task»'
status: active
tags:
  - templates
  - workflow
  - prompts
  - types
source_tasks:
  - VL-184
linked_tasks:
  - VL-184
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

Формулировки шаблонов фаз вроде «Если type=task» или «(task или epic)» жёстко предполагают два типа. Когда Spec начал ставить типы из config.types (bug, docs, feature…), агент Фазы Code получал type=bug и не понимал, что делать — ветка workflow в коде от epic отличает любой другой тип.

## Решение

Во всех шаблонах (templates/ и .qwen/commands/) ветвление формулируй только как «type ≠ epic → обычная задача-исполнитель» / «type=epic → ветвление фазы». Списки типов упоминай только как «task, bug, …», не как закрытый набор.

## Пример

Было: `Если type=task — реализуй План`. Стало: `Если type ≠ epic (task, bug, feature, …) — реализуй План`. Страховочный чек перед закрытием: `grep -rn "type=task\|task или epic" templates/ .qwen/commands/` — должен быть пуст.