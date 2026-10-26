---
id: lesson-52
title: 'Выноси сетевой reference.test в отдельный запуск, если общий прогон vitest зависает'
status: active
tags:
  - tests
  - vitest
  - network
source_tasks:
  - VL-195
linked_tasks:
  - VL-195
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема
Общий прогон `pnpm test` (vitest run) дважды зависал на сетевом `src/core/reference.test` — таймаут клона репозитория 120с на каждом сетевом тесте, общий прогон не завершался в разумное время.

## Решение
Если общий прогон vitest зависает или падает на `reference.test` — прогони остальные тесты общим пакетом, а `reference.test` запусти отдельно (`vitest run src/core/reference.test.mjs`) и зафиксируй результат отдельно.

## Пример
Отчёт VL-195: «прогон общим пакетом дважды висел на СЕТОВОМ reference.test — прогнан отдельно: 22 passed ✓».