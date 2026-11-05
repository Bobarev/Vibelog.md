---
id: lesson-222
title: При git < 2.25 в коде нужен fallback на core.sparseCheckout вместо git sparse-checkout
status: active
tags:
  - git
  - cli
  - совместимость
  - create
source_tasks: []
linked_tasks:
  - VL-339
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Целевая ОС проекта — macOS 10.15 Catalina с git 2.24.3, где подкоманды `git sparse-checkout` ещё нет (`git: 'sparse-checkout' is not a git command`). Код, написанный только на `git sparse-checkout init --cone` / `set`, на целевой машине не работает вообще.

## Решение

Любую реализацию sparse-checkout делать двухветочной: пробуем `git sparse-checkout`; если stderr содержит «not a git command» — включаем эквивалент `git config core.sparseCheckout true` + запись путей в `.git/info/sparse-checkout`. Порядок «set до checkout» сохраняется в обоих вариантах, иначе рабочее дерево развернётся целиком.

## Пример

`cloneTemplate` в `src/core/create.ts`: `sparse-checkout init --cone` → при отказе `sparseCandidates` пишутся в `.git/info/sparse-checkout` → `checkout <branch>`. Проверка на реальной машине: `git --version` = 2.24.3, `git sparse-checkout` отвечает «is not a git command».