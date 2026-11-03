---
id: VL-297
title: '[mvp] experiments: report (mean/median/win-rate/n/dropped) и --compare run-N'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-03 22:30'
due_date: ''
labels:
  - mvp
  - experiments
dependencies:
  - VL-296
milestone: v1.12
references: []
priority: high
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files:
  - src/core/report.ts
  - src/core/report.test.mjs
  - src/core/experiment.ts
  - src/cli/commands/experiment-report.ts
  - src/cli/commands/experiment.ts
  - src/cli/router.ts
  - src/cli/experiment-report-cli.test.mjs
lessons:
  - lesson-170
token_usage:
  input: 5103841
  output: 40763
  cache: 4978688
  total: 5144604
  requests: 77
  duration_ms: 598212
  reasoning: 11424
  by_phase:
    code:
      input: 4032596
      output: 33870
      cache: 3944448
      requests: 54
    close:
      input: 1071245
      output: 6893
      cache: 1034240
      requests: 23
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MVP-шаг 4 эпика VL-293 (зависит от VL-296). Отчёт и сравнение прогонов.

Спецификация: `backlog/docs/doc-21` §9 (метрики отчёта), §10 (CLI), §15 (>10 MB).

Файлы:
- `src/core/report.ts` (новый): `buildReport(results, meta, exp)` → структура по вариантам:
  - `n` — валидных строк (score не null), `dropped` — ошибки и `score: null`, исключённые из средних (обязательно оба поля);
  - mean, median, дельта к baseline-варианту (`metrics.baseline`, по умолчанию `A`, с учётом `metrics.higher_is_better`), win-rate (доля пар, где вариант строго лучше baseline), custom-метрики из `row.custom` (только перечисленные в `metrics.custom`), число errors по `error_kind`;
  - `formatReportMarkdown(report)` → `report.md`.
- `compareRuns(a, b)` — дельты метрик между run-N и run-M, markdown-таблица.
- `src/cli/commands/experiment.ts` — `report <exp-id> [--run N] [--compare run-M] [--json]`: пишет `report.md` в каталог рана (перегенерация разрешена — report производный, `results.jsonl` неизменяем) и печатает в stdout.
- **Завершение прогона:** `report` проверяет полноту — для всех строк датасета × всех вариантов должна быть строка с `score` или `error`. Полно → `meta.status = completed`, `finished_at`, `meta.summary = {n, dropped, cost_total}`, статус эксперимента пересчитывается. Неполно → печатает список недостающих пар `(task_id, variant)` и статус НЕ меняет (иначе `completed` на половине данных). Это закрывает дыру «manual-ран навсегда running».
- Правило `results.jsonl > 10 MB`: при чтении в отчёте файл парсится локально, но в meta ставится `results_ignored: true` и warning в stderr.
- Тесты `src/core/report.test.mjs`: mean/median на фикстуре, `score: null` исключается и считается в dropped, win-rate (с higher_is_better true и false), ошибки по kind, compare двух run'ов, пустой набор (n=0 → «—», не NaN), перевод рана в completed при полноте и отказ при недостающих парах.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 report: mean/median/дельта/win-rate/custom/errors по каждому варианту
- [x] #2 обязательно n (валидные) и dropped (ошибки + score:null) в отчёте и в meta.summary
- [x] #3 report.md пишется в каталог рана, report --json печатает структуру
- [x] #4 report --compare run-M даёт дельты между прогонами
- [x] #5 report переводит прогон в completed, если по всем строкам датасета × вариантов есть score или error; иначе печатает список недостающих и статус НЕ меняет (со stale-running правило не конфликтует)
- [x] #6 эксперимент status пересчитывается из последнего рана: draft (нет ранов) | completed | failed | running
- [x] #7 пустой набор (n=0) даёт '—'/null, не NaN
- [x] #8 CHANGELOG.md обновлён
- [x] #9 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) src/core/report.ts — агрегаты per-variant (n, dropped, mean, median, дельта, win_rate, custom, errors by kind). 2) formatReportMarkdown + report.md в run-каталог. 3) compareRuns для --compare. 4) CLI report (+--json). 5) Тесты на фикстурах, включая n=0 и score:null. 6) pnpm build && pnpm test. Риск: деление на ноль при n=0 — отдавать null/'—', не NaN.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 03:31
---
Фаза 3 (Code) выполнена. Коммит ae32072.
Изменено:
- `src/core/report.ts` (новый) — `buildReport(results, meta, exp, {taskIds})` → структура по вариантам (n, dropped, mean, median, delta + delta_pct к `metrics.baseline` с учётом `higher_is_better`, win_rate только по парам с валидными оценками обоих вариантов, custom-средние строго по `metrics.custom`, errors по `error_kind`, cost_total с `null` при отсутствии тарифов); `formatReportMarkdown`; `checkRunCompleteness` (матрица «строки датасета × варианты», пара закрыта при конечном `score` ИЛИ непустом `error`); `compareRuns` + `formatCompareMarkdown`; константа `RESULTS_SIZE_LIMIT_BYTES` = 10 MB.
- `src/cli/commands/experiment-report.ts` (новый) — `report <exp-id> [--run N] [--compare run-M] [--json]`: пишет `report.md` в каталог рана (results.jsonl не меняется — проверено тестом), печатает отчёт/stdout-JSON, при полной матрице ставит `meta.status = completed`, `finished_at`, `meta.summary = {n, dropped, cost_total}` и пересчитывает статус эксперимента через `syncExperimentStatus`; при неполной — печатает недостающие пары `(task_id, variant)` и статус не меняет; при `results.jsonl > 10 MB` — warning в stderr + `results_ignored: true` в meta (файл всё равно парсится локально, §15).
- `src/core/experiment.ts` — в `RunMeta` добавлены `summary?: RunSummary | null` и тип `RunSummary`.
- `src/cli/commands/experiment.ts` — подкоманда `report` в роутере, обновлены doc-блок и список доступных.
- `src/cli/router.ts` — строка помощи включает run|record|report.
- `src/core/report.test.mjs` (27 тестов): mean/median (включая чётный набор), `score: null` исключается и считается в dropped, win-rate при `higher_is_better` true/false, равенство — не победа, custom-метрики, ошибки по kind, cost с null-тарифами, дельта и delta_pct, смена baseline, полнота матрицы (полная/неполная/без датасета), compareRuns (дельты, only_a/only_b, markdown), n=0 → null/«—» без NaN, CLI-часть (`report.md`, completed + summary, отказ при неполной матрице, --json, --compare, пустой набор).
- `src/cli/experiment-report-cli.test.mjs` (7 тестов, spawn реального CLI через `testSpawnEnv`): неполный ран не закрывается, `--json` структура, перевод в completed + meta.summary + статус карточки, `--compare run-M` в stdout и report.md, отсутствующий эксперимент, `results.jsonl > 10 MB` → warning + `results_ignored`.
Проверки: `pnpm build` — чисто; `pnpm test` — полный прогон, 138 файлов / 2590 passed, 4 skipped (предсуществующие skip в `src/core/frontmatter.test.mjs`, не связаны с задачей), исключённых файлов нет.
Осталось незакрытым (намеренно):
- AC 8 «CHANGELOG.md обновлён» — по правилам фазы Code CHANGELOG и docs пишет фаза Close после слияния; здесь не трогал.
- DoD «Документация обновлена» — то же: пользовательский/CLI-справочник (doc-7) обновляется в Close.
- DoD «Тесты проходят» и «Нет регрессий» отмечены по полному зелёному прогону.
Попутно создан lesson-170 (null вместо NaN в агрегатах, «—» в markdown) и связан с задачей.
---
author: @agent
created: 2026-11-02 03:34
---
Фаза Close выполнена. Статус: Done. Коммиты: feat ae32072 (код и тесты из фазы Code — уже были в master), docs 6cc89a7 (CHANGELOG.md + doc-7 CLI-справочник: раздел `experiment` → подкоманда `report`).
Документация: CHANGELOG (Unreleased → Добавлено, запись VL-297 с метриками n/dropped/mean/median/delta/win_rate/custom/errors, завершением прогона и правилом >10 MB) и doc-7 §experiment → report (флаги `--run/--compare/--json`, состав метрик, правила завершения, results_ignored).
Проверки: `pnpm build` — чисто; ранний точечный прогон `src/core/report.test.mjs` + `src/cli/experiment-report-cli.test.mjs` — 34 passed; полный `pnpm test` — 138 файлов, 2590 passed, 4 skipped (предсуществующие skip в `src/core/frontmatter.test.mjs`, не связаны с задачей), исключённых файлов нет.
Не закоммичено: файлы других задач (VL-298, VL-299, VL-300, VL-301) в backlog/tasks — черновики соседних фаз, к VL-297 не относятся; `backlog/completed/VL-287`, `VL-288` — результаты чужих ранов, не трогал. Файл задачи VL-297 коммитит framework после записи token_usage.
---
<!-- COMMENTS:END -->