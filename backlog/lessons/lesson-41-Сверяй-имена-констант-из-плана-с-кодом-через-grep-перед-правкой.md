---
id: lesson-41
title: Сверяй имена констант из плана с кодом через grep перед правкой
status: active
tags:
  - план
  - grep
  - код
  - workflow
source_tasks:
  - VL-188
linked_tasks:
  - VL-188
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема

В описании/плане VL-188 значилась константа `KNOWN_PHASES` для проверки известных фаз, но grep показал, что в коде её нет — роль выполняет `PHASES` в `src/web/phase-prompt.ts`. Правка «по описанию» создала бы дубликат или упала на несуществующем импорте.

## Решение

Перед правкой любого имени из плана/описания делай один `grep_search` по репозиторию и сверяй фактическую константу/функцию; если имя не найдено — ищи, какая сущность выполняет эту роль, и фиксируй расхождение в отчёте фазы.

## Пример

```bash
grep_search {"pattern": "KNOWN_PHASES"}   # → пусто
grep_search {"pattern": "export const PHASES"}  # → src/web/phase-prompt.ts:21 — вот она
```
