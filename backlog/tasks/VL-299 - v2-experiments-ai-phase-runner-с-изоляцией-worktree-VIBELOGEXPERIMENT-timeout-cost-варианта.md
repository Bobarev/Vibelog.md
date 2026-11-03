---
id: VL-299
title: '[v2] experiments: ai-phase runner с изоляцией (worktree, VIBELOG_EXPERIMENT, timeout, cost варианта)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-03 22:30'
due_date: ''
labels:
  - v2
  - experiments
dependencies:
  - VL-296
  - VL-297
  - VL-298
milestone: v1.12
references: []
priority: medium
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files:
  - src/core/worktree.ts
  - src/core/billing.ts
  - src/core/analytics.ts
  - src/core/experiment.ts
  - src/core/experiment-runner.ts
  - src/core/experiment-runner.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/cli/commands/experiment-run.ts
  - src/cli/commands/experiment.ts
lessons:
  - lesson-184
  - lesson-185
token_usage:
  input: 9546373
  output: 55238
  cache: 9235456
  total: 9601611
  requests: 100
  duration_ms: 895746
  reasoning: 19902
  by_phase:
    code:
      input: 8417294
      output: 48622
      cache: 8156672
      requests: 75
    close:
      input: 1129079
      output: 6616
      cache: 1078784
      requests: 25
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
- [x] #1 До старта кода: решения по doc-21 §19 (1) дефолт --timeout, (2) блокировка параллельных прогонов (lock по pid), (3) pass_fail = 1/0 — зафиксированы в doc-21 и в этой задаче в разделе Implementation Notes; без них реализация не начинается
- [x] #2 Прогон идёт в отдельном worktree; после каждой задачи откат (reset --hard + clean -fd) в try/finally
- [x] #3 VIBELOG_EXPERIMENT=exp-<id>/run-<N>: usage в run-каталог, .vibelog/billing не пишется
- [x] #4 tool_calls из stdout type=result.tool_calls_total, fallback countToolCallsInMessages
- [x] #5 cost по models.available[variant.model].pricing → calculateCost через новый getModelPricingById; нет pricing → cost: null (+pricing_missing)
- [x] #6 SIGINT → status failed с частичными results; timeout задачи → error_kind='timeout'
- [x] #7 run --dry-run показывает число прогонов и оценку стоимости
- [x] #8 env в тестах только через testSpawnEnv()
- [x] #9 CHANGELOG.md обновлён
- [x] #10 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) ensureExperimentWorktree + откат между вариантами (src/core/worktree.ts). 2) getModelPricingById в src/core/analytics.ts + cost: null без pricing. 3) VIBELOG_EXPERIMENT: billing.ts + agent/cli.ts → usage.json в run-dir. 4) Цикл dataset × variants, timeout, SIGINT→failed, error_kind. 5) tool_calls из stdout type=result (fallback countToolCallsInMessages). 6) --dry-run с оценкой стоимости. 7) Тесты на моках spawn + env через testSpawnEnv(). 8) pnpm build && pnpm test. Риски: изоляция (откат должен быть и при падении рана — try/finally), параллельный запуск вариантов в одном worktree запрещён, billing-загрязнение.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Решения по doc-21 §19 (блокер старта снят до кода)

1. **Дефолт `--timeout` на задачу — 600 с** (`DEFAULT_TASK_TIMEOUT_SEC` в `src/core/experiment-runner.ts`). Приоритет: флаг `--timeout <сек>` → `timeout_sec` в frontmatter карточки → 600. Поле `timeout_sec` добавлено в схему `Experiment` (round-trip: пишется только когда задано).
2. **Блокировка параллельных прогонов — lock по pid, отказ, не очередь.** `assertNoActiveRun` читает `meta.json` последнего рана: `status: running` + живой `pid` (`detectStaleRun`) → `ExperimentRunError` с подсказкой `--recover`. Очередь отклонена: два прогона делили бы `results.jsonl` и worktree-каталоги.
3. **`judge.scale: pass_fail` → `1`/`0`** (не `true`/`false`): `median`/`win_rate` работают без отдельной ветки.

Все три зафиксированы в doc-21 §19 (статус «решено в VL-299»).

## Реализация

- `src/core/worktree.ts`: `ensureExperimentWorktree` (worktree `.vibelog/worktrees/exp-<id>-run-<N>`, ветка `exp/<id>-run-<N>`), `resetExperimentWorktree` (`reset --hard` + `clean -fd`, без `-x` — симлинк node_modules сохраняется), `removeExperimentWorktree`.
- `src/core/billing.ts`: `parseExperimentMarker`, `billingSuppressed(env)`, `experimentUsagePath(cwd, expId, runN)`, `appendExperimentUsage`.
- `src/core/analytics.ts`: `getModelPricingById(cwd, modelId)` (id обязателен — пустой не превращается в активную модель).
- `src/core/experiment-runner.ts`: цикл «строки датасета × варианты», спавн `vibelog-agent` с `--max-tool-calls`/`--max-wall-time`, откат worktree в `try/finally`, SIGINT → `failed` + частичные results, timeout → `error_kind: 'timeout'`, `tool_calls` из stdout `type=result.tool_calls_total` с fallback `countToolCallsInMessages`, cost по модели варианта (`null` + `pricing_missing` без тарифа), `--dry-run` с оценкой стоимости по среднему usage прошлых ранов.
- `src/agent/cli.ts`: при `VIBELOG_EXPERIMENT` usage пишется в `<run-dir>/usage.json`, billing задачи не пишется (блок стоит до `if (taskId)` — у эксперимента taskId нет).
- `src/cli/commands/experiment-run.ts`: ветка `runner: ai-phase` → `runAiPhase` (флаги `--timeout`, `--max-tool-calls`, `--variant`, `--dry-run`).
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 03:42
---
Фаза 3 (Code) выполнена. Коммит 9fc7ca4.
**Блокер старта снят до кода** (AC1): три решения doc-21 §19 зафиксированы в doc-21 (статус «решено в VL-299») и в Implementation Notes задачи — (1) дефолт `--timeout` 600 с, приоритет флаг → `timeout_sec` карточки → 600; (2) lock по pid: второй `run` при живом pid — отказ, не очередь; (3) `judge.scale: pass_fail` → `1`/`0`.
Изменено:
- `src/core/worktree.ts` — `ensureExperimentWorktree` (worktree `.vibelog/worktrees/exp-<id>-run-<N>`, ветка `exp/<id>-run-<N>`, не переиспользует ветку задачи), `resetExperimentWorktree` (`reset --hard` + `clean -fd`, без `-x` — симлинк node_modules выживает), `removeExperimentWorktree`.
- `src/core/billing.ts` — `parseExperimentMarker`, `billingSuppressed(env)`, `experimentUsagePath(cwd, expId, runN)`, `appendExperimentUsage`.
- `src/core/analytics.ts` — `getModelPricingById(cwd, modelId)` (id обязателен: пустой не подменяется активной моделью).
- `src/core/experiment.ts` — поле `timeout_sec` в схеме (round-trip: пишется только когда задано).
- `src/core/experiment-runner.ts` (новый) — цикл «строки датасета × варианты», спавн `vibelog-agent` с `--max-tool-calls`/`--max-wall-time`, откат worktree в `try/finally` (в т.ч. при падении рана), SIGINT/SIGTERM → `status: failed` + частичные results, timeout задачи → `error_kind: 'timeout'` с продолжением прогона, `tool_calls` из stdout `type=result.tool_calls_total` с fallback `countToolCallsInMessages` по jsonl, cost по модели варианта (`null` + `pricing_missing` без тарифа), `--dry-run` с матрицей и оценкой стоимости по среднему usage прошлых ранов («оценки нет» без данных).
- `src/agent/cli.ts` — при `VIBELOG_EXPERIMENT` usage пишется в `<run-dir>/usage.json`, `.vibelog/billing/*` не пишется (блок стоит до `if (taskId)` — у эксперимента taskId нет; маркер `billing_recorded` ставится, чтобы fallback оркестратора не создал файл).
- `src/cli/commands/experiment-run.ts` — ветка `runner: ai-phase` → `runAiPhase` (флаги `--timeout`, `--max-tool-calls`, `--variant`, `--dry-run`); `src/cli/commands/experiment.ts` — проброс промиса.
Тесты: новый `src/core/experiment-runner.test.mjs` (11 тестов: откат worktree по факту состояния дерева, cost/null без pricing, timeout → error_kind, SIGINT → failed с частичными results, dry-run без создания рана, lock по pid, дефолт 600 с и `timeout_sec`, fallback tool_calls, parseExperimentMarker/billingSuppressed/buildRunEnv); `src/agent/cli.test.mjs` +1 (VIBELOG_EXPERIMENT → usage.json, billing не создан). env в тестах — только через `testSpawnEnv()`.
Проверки: `pnpm build` — чисто; `pnpm test` — полный прогон, 153 файла / 2847 passed, 4 skipped (пропуски — предсуществующие `it.skip` в чужих файлах, не связаны с задачей).
Что осталось: AC9 (CHANGELOG.md) — по правилам фазы Code CHANGELOG и документы backlog/docs не обновляются, это делает фаза Close после слияния. DoD «Документация обновлена» закрыт частично: спецификация doc-21 §19 обновлена, пользовательская документация (doc-7/doc-6/CHANGELOG) — за Close.
---
author: @agent
created: 2026-11-03 03:46
---
Фаза Close выполнена. Статус: Done.
Коммиты:
- feat `9fc7ca4` — ai-phase runner экспериментов с изоляцией (сделан в фазе Code; остатков кода не было — `git status` по всем 10 modified_files чист).
- docs `c3dcf9f` — CHANGELOG.md (запись VL-299), doc-7 (раздел `experiment run` → runner ai-phase: флаги `--timeout`/`--max-tool-calls`/`--variant`/`--dry-run`, изоляция worktree, lock по pid, `VIBELOG_EXPERIMENT` → `usage.json`, метрики tool_calls/cost), doc-21 §19 (три вопроса помечены «решено в VL-299»).
- docs(task) `616b6db` — lessons lesson-184, lesson-185.
Проверки после merge: `pnpm build` — чисто (один прогон). Ранний точечный фильтр — `experiment-runner`, `cli`, `worktree`, `billing`, `analytics` (5 файлов / 111 тестов) зелёные. Полный прогон `npx vitest run` — 154 файла / 2855 passed, 4 skipped (пропуски — предсуществующие `it.skip` в чужих файлах, не связаны с задачей). Повторных полных прогонов не было.
AC9 (CHANGELOG.md) закрыт в этой фазе. DoD: тесты проходят, документация обновлена, регрессий нет — все отмечены.
Не закоммичено: `backlog/references/ref-24-assistant-ui-Elements-ComposerMenu-меню-слэш-команд.md` — файл чужой задачи (VL-314), не принадлежит VL-299 и не коммитился.
---
<!-- COMMENTS:END -->