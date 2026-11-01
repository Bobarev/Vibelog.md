---
id: VL-297
title: '[mvp] experiments: report (mean/median/win-rate/n/dropped) и --compare run-N'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 02:06'
due_date: ''
labels:
  - mvp
  - experiments
dependencies:
  - VL-296
milestone: ''
references: []
priority: high
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
MVP-шаг 4 эпика VL-293 (зависит от VL-296). Отчёт и сравнение прогонов.

Файлы:
- `src/core/report.ts` (новый): `buildReport(results, meta, exp)` → структура по вариантам:
  - `n` — валидных строк (score не null), `dropped` — ошибки и `score: null`, исключённые из средних (обязательно оба поля);
  - mean, median, дельта к baseline-варианту (A по умолчанию, `metrics.baseline`), win-rate (доля пар, где вариант > baseline), custom-метрики из `row.custom`, число errors по `error_kind`;
  - `formatReportMarkdown(report)` → `report.md`.
- `compareRuns(a, b)` — дельты метрик между run-N и run-M, markdown-таблица.
- `src/cli/commands/experiment.ts` — `report <exp-id> [--run N] [--compare run-M] [--json]`: пишет `report.md` в каталоге рана (перегенерация разрешена — report производный, run неизменяем по results.jsonl) и печатает в stdout.
- Правило results.jsonl > 10 MB: при чтении в отчёте файл всё равно парсится (локально), но в meta ставится `results_ignored: true` и warning в stderr — расчёт идёт, просто meta сигналит «в git не класть».
- Тесты `src/core/report.test.mjs`: mean/median на фикстуре, `score: null` исключается и считается в dropped, win-rate, ошибки по kind, compare двух run'ов, пустой набор (n=0 → «нет данных», не NaN).

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 report: mean/median/дельта/win-rate/custom/errors по каждому варианту
- [ ] #2 обязательно n (валидные) и dropped (ошибки + score:null) в отчёте и meta
- [ ] #3 report.md пишется в каталог рана, report --json печатает структуру
- [ ] #4 report --compare run-M даёт дельты между прогонами
- [ ] #5 пустой набор (n=0) даёт '—'/null, не NaN
- [ ] #6 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) src/core/report.ts — агрегаты per-variant (n, dropped, mean, median, дельта, win_rate, custom, errors by kind). 2) formatReportMarkdown + report.md в run-каталог. 3) compareRuns для --compare. 4) CLI report (+--json). 5) Тесты на фикстурах, включая n=0 и score:null. 6) pnpm build && pnpm test. Риск: деление на ноль при n=0 — отдавать null/'—', не NaN.
<!-- SECTION:PLAN:END -->