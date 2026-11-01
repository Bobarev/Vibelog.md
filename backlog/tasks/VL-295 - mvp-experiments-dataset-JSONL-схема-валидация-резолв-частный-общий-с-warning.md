---
id: VL-295
title: '[mvp] experiments: dataset JSONL — схема, валидация, резолв «частный → общий» с warning'
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
  - VL-294
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
MVP-шаг 2 эпика VL-293 (зависит от VL-294). Форматы dataset и резолв.

Файлы:
- `src/core/dataset.ts` (новый): `parseDatasetJsonl(text)` → `{rows, errors[]}`; `DatasetRow = {task_id, expected_ac?, input?, payload?, custom?, meta?}`; валидация: `task_id` обязателен и уникален (дубликат → ошибка строки, не падение); синоним `expected` читается как `expected_ac` с warning; битые JSON-строки → в `errors`, не бросают.
- `resolveDataset(backlogDir, expId, name)` — порядок: `backlog/experiments/<expId>/datasets/<name>.jsonl` → `backlog/experiments/datasets/<name>.jsonl`; при наличии обоих — warning в stderr (`console.error`) и запись `resolution: {dataset: 'private'|'shared', shadowed: '…'}` для meta рана (возвращает структуру с полем `warnings: string[]`).
- Escape hatch: параметр `explicitPath` для `--dataset-path`.
- `src/cli/commands/experiment.ts` — `dataset` не отдельной командой; резолв используется в `run`/`record` (VL-296), но в этой задаче добавить `vibelog experiment dataset <exp-id> [--dataset-path]` — показать резолв, число строк, ошибки.
- Тесты `src/core/dataset.test.mjs`: резолв частный/общий/оба, warning при коллизии, `expected`-синоним, битые строки, дубликат task_id; mkdtemp.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DatasetRow: task_id обязателен, expected_ac + синоним expected, input/payload, custom, meta
- [ ] #2 Резолв частный exp-<id>/datasets → общий experiments/datasets + warning при коллизии
- [ ] #3 Битые JSONL-строки и дубликаты task_id попадают в errors, не бросают
- [ ] #4 --dataset-path переопределяет резолв
- [ ] #5 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) src/core/dataset.ts — парс/валидация JSONL + резолв с warnings[]. 2) хелпер `resolveShadowing(backlogDir, expId, kind, name)` общий для dataset и prompts (переиспользуется в VL-296). 3) вывод `experiment dataset`. 4) Тесты на резолв/валидацию (mkdtemp). 5) pnpm build && pnpm test. Риск: warning нельзя глотать — он должен попадать и в stderr, и в meta (VL-296).
<!-- SECTION:PLAN:END -->