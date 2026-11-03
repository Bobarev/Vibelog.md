---
id: lesson-185
title: 'Подавляй биллинг эксперимента по env-маркеру VIBELOG_EXPERIMENT, а не по отсутствию taskId'
status: active
tags:
  - billing
  - usage
  - experiments
  - env
source_tasks:
  - VL-299
linked_tasks:
  - VL-299
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Headless-ран эксперимента не имеет `taskId`, поэтому блок учёта токенов в `src/agent/cli.ts` (ветка `if (taskId)`) его пропускает, а fallback оркестратора создаёт `.vibelog/billing/<taskId>.json` — биллинг задач загрязняется прогонами эксперимента.

## Решение

Подавление биллинга делать по **env-маркеру**, а не по отсутствию taskId: `VIBELOG_EXPERIMENT=exp-<id>/run-<N>` → `billingSuppressed(env)` истинно, usage пишется в `<run-dir>/usage.json` (`experimentUsagePath`), а маркер `billing_recorded` ставится явно, чтобы fallback не создал файл. Проверка должна стоять ДО ветки `if (taskId)`.

## Пример

`src/core/billing.ts` → `parseExperimentMarker`/`billingSuppressed`/`experimentUsagePath`/`appendExperimentUsage`; в `src/agent/cli.ts` блок эксперимента стоит выше `if (taskId)`. Тест: `src/agent/cli.test.mjs` — при `VIBELOG_EXPERIMENT` создан `usage.json` и НЕ создан `.vibelog/billing/*`.
