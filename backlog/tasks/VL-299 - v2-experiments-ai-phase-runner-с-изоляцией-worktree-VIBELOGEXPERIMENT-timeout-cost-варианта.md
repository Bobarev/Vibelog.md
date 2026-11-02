---
id: VL-299
title: '[v2] experiments: ai-phase runner с изоляцией (worktree, VIBELOG_EXPERIMENT, timeout, cost варианта)'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 02:19'
due_date: ''
labels:
  - v2
  - experiments
dependencies:
  - VL-296
  - VL-297
  - VL-298
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
v2-эпик VL-293 (зависит от VL-296, VL-297, VL-298). Автоматический прогон фазы агентом с гарантией изоляции — главный риск фичи.

Спецификация: `backlog/docs/doc-21` §11 (cost варианта), §12 (источник tool_calls), §13 (изоляция + billing), §14 (прерывание/таймаут), §19 (открытые вопросы).

**БЛОКЕР СТАРТА:** три открытых вопроса doc-21 §19 должны быть решены до кода и записаны в раздел Implementation Notes этой задачи:
1. дефолт `--timeout` на задачу (рекомендация doc-21: 600 с, переопределяется `timeout_sec` в frontmatter и флагом);
2. блокировка параллельных прогонов одного эксперимента (рекомендация: lock по pid, второй `run` при живом pid — отказ, не очередь);
3. `judge.scale: pass_fail` → `1`/`0` (рекомендация doc-21 §19 п.3).
Без этих решений реализация начнёт угадывать — тогда задача возвращается в Plan.

Файлы:
- `src/core/worktree.ts` — `ensureExperimentWorktree(cwd, expId, runN)`: отдельный worktree на прогон (не переиспользовать ветку задачи), путь `.vibelog/worktrees/exp-<id>-run-<N>`, ветка `exp/<id>-run-<N>`; после каждой dataset-задачи — откат (`git reset --hard && git clean -fd`) внутри worktree, в `try/finally`.
- `src/agent/cli.ts` — env-маркер `VIBELOG_EXPERIMENT=exp-<id>/run-<N>`; при нём usage пишется в `<run-dir>/usage.json`, а `.vibelog/billing/<taskId>.json` НЕ пишется. Правка блока учёта токенов (строки ~1000–1045).
- `src/core/billing.ts` — `billingSuppressed(env)` и маршрут `experimentUsagePath(cwd, expId, runN)`.
- `src/core/experiment-runner.ts` (новый) — цикл: dataset-строки × варианты; на задачу — spawn headless-рана с `--max-tool-calls`/`--timeout`; SIGINT → `status: failed` + частичные results; timeout задачи → строка с `error_kind: 'timeout'`.
- **`tool_calls` источник:** stdout JSON `type=result`.`tool_calls_total` (`src/agent/cli.ts:1088`, парсится `parseQwenResult`), fallback — `countToolCallsInMessages` (`src/agent/session.ts:547`) по jsonl рана. `run-progress` метрики tool_calls НЕ содержит — не использовать.
- **cost по модели варианта:** `models.available[<variant.model>].pricing` → новый `getModelPricingById(cwd, id)` в `src/core/analytics.ts` → `calculateCost`; pricing нет → `cost: null` (+`pricing_missing: true` в meta), НЕ 0.
- `run --dry-run` — матрица «строк датасета × вариантов» + оценка стоимости (средний usage прошлых ранов либо «оценки нет» при отсутствии данных).
- Тесты: `src/core/experiment-runner.test.mjs` (моки spawn; откат worktree, failed при SIGINT, cost: null без pricing, timeout → error_kind), правки `src/agent/cli.test.mjs` (VIBELOG_EXPERIMENT не пишет billing).

Проверка: `pnpm build && pnpm test`; env в тестах — только через `testSpawnEnv()` (VL-286).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 До старта кода: решения по doc-21 §19 (1) дефолт --timeout, (2) блокировка параллельных прогонов (lock по pid), (3) pass_fail = 1/0 — зафиксированы в doc-21 и в этой задаче в разделе Implementation Notes; без них реализация не начинается
- [ ] #2 Прогон идёт в отдельном worktree; после каждой задачи откат (reset --hard + clean -fd) в try/finally
- [ ] #3 VIBELOG_EXPERIMENT=exp-<id>/run-<N>: usage в run-каталог, .vibelog/billing не пишется
- [ ] #4 tool_calls из stdout type=result.tool_calls_total, fallback countToolCallsInMessages
- [ ] #5 cost по models.available[variant.model].pricing → calculateCost через новый getModelPricingById; нет pricing → cost: null (+pricing_missing)
- [ ] #6 SIGINT → status failed с частичными results; timeout задачи → error_kind='timeout'
- [ ] #7 run --dry-run показывает число прогонов и оценку стоимости
- [ ] #8 env в тестах только через testSpawnEnv()
- [ ] #9 CHANGELOG.md обновлён
- [ ] #10 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) ensureExperimentWorktree + откат между вариантами (src/core/worktree.ts). 2) getModelPricingById в src/core/analytics.ts + cost: null без pricing. 3) VIBELOG_EXPERIMENT: billing.ts + agent/cli.ts → usage.json в run-dir. 4) Цикл dataset × variants, timeout, SIGINT→failed, error_kind. 5) tool_calls из stdout type=result (fallback countToolCallsInMessages). 6) --dry-run с оценкой стоимости. 7) Тесты на моках spawn + env через testSpawnEnv(). 8) pnpm build && pnpm test. Риски: изоляция (откат должен быть и при падении рана — try/finally), параллельный запуск вариантов в одном worktree запрещён, billing-загрязнение.
<!-- SECTION:PLAN:END -->