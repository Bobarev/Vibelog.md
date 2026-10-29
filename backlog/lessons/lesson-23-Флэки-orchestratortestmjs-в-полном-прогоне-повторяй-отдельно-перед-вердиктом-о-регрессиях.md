---
id: lesson-23
title: Флэки orchestrator.test.mjs в полном прогоне повторяй отдельно перед вердиктом о регрессиях
status: active
tags:
  - tests
  - flaky
  - orchestrator
  - vitest
source_tasks:
  - VL-174
linked_tasks:
  - VL-174
  - VL-209
created_date: 2026-10-25
updated_date: 2026-10-29
supersedes: ''
---
## Проблема

При полном `pnpm test` в VL-174 упали 6 тестов `src/web/orchestrator.test.mjs` (спавн/stub qwen), хотя в отдельном прогоне и на повторе они проходили — параллелизм по файлам даёт флэки на спавн-тестах.

## Решение

После падения orchestrator-тестов в полном прогоне запускай их отдельно (`vitest run src/web/orchestrator.test.mjs`) и на повторе — только затем делай вердикт о регрессии; не прерывай фазу из-за единичного падения, а зафиксируй флэк в отчёте.

## Пример

`pnpm test` → «6 failed orchestrator.test.mjs» → `vitest run src/web/orchestrator.test.mjs` → все зелёные → регрессий нет, флэк упомянут в отчёте.