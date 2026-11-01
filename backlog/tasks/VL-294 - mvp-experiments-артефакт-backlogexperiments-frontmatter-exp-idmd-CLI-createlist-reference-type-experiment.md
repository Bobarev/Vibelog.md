---
id: VL-294
title: '[mvp] experiments: артефакт backlog/experiments/, frontmatter exp-<id>.md, CLI create/list, reference type experiment'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 02:06'
due_date: ''
labels:
  - mvp
  - experiments
dependencies: []
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
MVP-шаг 1 эпика VL-293. Создать артефакт экспериментов как сущность проекта и CLI-каркас.

Файлы:
- `src/core/paths.ts` — добавить `experimentsDir(backlogDir)`, `experimentsDatasetsDir(backlogDir)`, `experimentsPromptsDir(backlogDir)`, `experimentRunsDir(backlogDir, expId)` (по образцу `lessonsDir`/`referencesDir`, строки 139–157).
- `src/core/experiment.ts` (новый) — типы `Experiment`, `VariantConfig`, `ExperimentStatus`, константы `EXPERIMENT_STATUSES`, `SCHEMA_VERSION = 1`; `experimentFilename(id, title)`, `createExperiment(input)`, `parseExperimentMarkdown(content)`, `experimentToMarkdown(exp, body)`, `listExperiments(backlogDir)`, `getExperiment(backlogDir, id)`; `nextExperimentId(entries)` (exp-<n>).
- `src/core/reference.ts` — добавить `'experiment'` в `REFERENCE_TYPES` (строка 28), чтобы ссылаться на эксперименты через `reference_link` без изменения схемы lesson.
- `src/cli/commands/experiment.ts` (новый) — `runExperiment(args)`: подкоманды `create`, `list`.
- `src/cli/router.ts` — case 'experiment' (рядом со строками 111–113) + импорт + строка в usage-блоке.
- Тесты: `src/core/experiment.test.mjs` (round-trip frontmatter, nextExperimentId, listExperiments на mkdtemp), `src/cli/experiment-cli.test.mjs` (create → файл появился, list выводит).

Frontmatter exp-<id>.md: `id, title, status: draft|running|completed|failed, schema_version: 1, dataset, variants (map A/B/…), metrics, judge?, created_date, updated_date, notes?`.

Проверка: `pnpm build && pnpm test`. Тестовые каталоги — только `mkdtempSync(join(tmpdir(), 'vibelog-experiment-'))`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 paths.ts: experimentsDir/experimentsDatasetsDir/experimentsPromptsDir/experimentRunsDir + тест
- [ ] #2 src/core/experiment.ts: frontmatter exp-<id>.md round-trip (schema_version, variants-map, statuses)
- [ ] #3 reference type 'experiment' добавлен в REFERENCE_TYPES
- [ ] #4 CLI: experiment create / experiment list работают, файл создаётся в backlog/experiments/
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
1) paths.ts — 4 функции-пути (образец lessonsDir). 2) src/core/experiment.ts — модель + frontmatter round-trip (по образцу src/core/reference.ts:163/193/219). 3) reference.ts:28 — тип 'experiment'. 4) src/cli/commands/experiment.ts + router.ts case. 5) Тесты: experiment.test.mjs (mkdtemp), experiment-cli.test.mjs. 6) pnpm build && pnpm test. Риск: id exp-<n> должен игнорировать неэкспериментальные файлы в каталоге; коммит git — эксперименты это данные проекта.
<!-- SECTION:PLAN:END -->