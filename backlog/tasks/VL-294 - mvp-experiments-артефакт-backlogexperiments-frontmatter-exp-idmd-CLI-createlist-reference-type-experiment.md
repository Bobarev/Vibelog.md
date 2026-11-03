---
id: VL-294
title: '[mvp] experiments: артефакт backlog/experiments/, frontmatter exp-<id>.md, CLI create/list, reference type experiment'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-03 22:31'
due_date: ''
labels:
  - mvp
  - experiments
dependencies: []
milestone: v1.12
references: []
priority: high
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files:
  - src/core/paths.ts
  - src/core/experiment.ts
  - src/core/experiment.test.mjs
  - src/core/reference.ts
  - src/core/reference.test.mjs
  - src/mcp/tools.ts
  - src/cli/commands/experiment.ts
  - src/cli/experiment-cli.test.mjs
  - src/cli/router.ts
  - CHANGELOG.md
lessons:
  - lesson-165
  - lesson-166
token_usage:
  input: 4108092
  output: 42265
  cache: 3995648
  total: 4150357
  requests: 71
  duration_ms: 670141
  reasoning: 22144
  by_phase:
    code:
      input: 2884620
      output: 34467
      cache: 2809344
      requests: 44
    close:
      input: 1223472
      output: 7798
      cache: 1186304
      requests: 27
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MVP-шаг 1 эпика VL-293. Создать артефакт экспериментов как сущность проекта и CLI-каркас.

Спецификация: `backlog/docs/doc-21` (§3 структура, §4 frontmatter, §10 CLI).

Файлы:
- `src/core/paths.ts` — добавить `experimentsDir(backlogDir)`, `experimentsDatasetsDir(backlogDir)`, `experimentsPromptsDir(backlogDir)`, `experimentRunsDir(backlogDir, expId)` (по образцу `lessonsDir`/`referencesDir`, строки 139–157).
- `src/core/experiment.ts` (новый) — типы `Experiment`, `VariantConfig`, `ExperimentStatus`, `ExperimentMetrics`, `JudgeConfig`; константы `EXPERIMENT_STATUSES`, `SCHEMA_VERSION = 1`; `experimentFilename(id, title)`, `createExperiment(input)`, `parseExperimentMarkdown(content)`, `experimentToMarkdown(exp, body)`, `listExperiments(backlogDir)`, `getExperiment(backlogDir, id)`; `nextExperimentId(entries)` (exp-<n>).
  - **Важно:** секции `metrics` (`score_field`, `higher_is_better`, `baseline`, `custom[]`) и `judge` (`enabled`, `model?`, `prompt?`, `scale`, `score_min`, `score_max`) парсятся и сохраняются round-trip **в этой задаче**, даже если логика judge появится только в VL-298. Иначе VL-298 начнёт с переделки парсера.
  - `variant.prompt` — просто строка: имя файла в `prompts/` **или** `builtin:<phase>` (формат фиксируется здесь, резолв — VL-296).
- `src/core/reference.ts` — добавить `'experiment'` в `REFERENCE_TYPES` (строка 28), чтобы ссылаться на эксперименты через `reference_link` без изменения схемы lesson.
  - **Обязательно попутно:** `src/core/reference.test.mjs:52` содержит `deepEqual(REFERENCE_TYPES, ['repo','url','file','doc','spec'])` — обновить массив; `src/mcp/tools.ts:499,511` (`enum: REFERENCE_TYPES`) проверить — тянется из константы, но описание «repo/url/file/doc/spec» поправить; `doc-8` (MCP-справочник) — перечень типов.
- `src/cli/commands/experiment.ts` (новый) — `runExperiment(args)`: подкоманды `create`, `list`.
- `src/cli/router.ts` — case 'experiment' (рядом со строками 111–113) + импорт + строка в usage-блоке.
- `CHANGELOG.md` — строка в Unreleased.
- Тесты: `src/core/experiment.test.mjs` (round-trip frontmatter включая metrics/judge, nextExperimentId, listExperiments на mkdtemp), `src/cli/experiment-cli.test.mjs` (create → файл появился, list выводит).

Frontmatter exp-<id>.md: `id, title, status: draft|running|completed|failed, schema_version: 1, dataset, runner, metrics, variants (map A/B/…), judge?, created_date, updated_date, notes?`.

Проверка: `pnpm build && pnpm test`. Тестовые каталоги — только `mkdtempSync(join(tmpdir(), 'vibelog-experiment-'))`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 paths.ts: experimentsDir/experimentsDatasetsDir/experimentsPromptsDir/experimentRunsDir + тест
- [x] #2 src/core/experiment.ts: frontmatter exp-<id>.md round-trip (schema_version, variants-map, statuses, metrics, judge) — поля judge и metrics парсятся и сохраняются БЕЗ потери (даже если реализация judge — VL-298)
- [x] #3 reference type 'experiment' добавлен в REFERENCE_TYPES + обновлён src/core/reference.test.mjs (deepEqual-массив) + enum в src/mcp/tools.ts + описание типов в doc-8
- [x] #4 Формат prompt поддерживает builtin:<phase> наравне с именем файла (поле хранится как строка, резолв — в VL-296)
- [x] #5 CLI: experiment create / experiment list работают, файл создаётся в backlog/experiments/
- [x] #6 CHANGELOG.md обновлён
- [x] #7 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) paths.ts — 4 функции-пути (образец lessonsDir). 2) src/core/experiment.ts — модель + frontmatter round-trip (по образцу src/core/reference.ts:163/193/219). 3) reference.ts:28 — тип 'experiment'. 4) src/cli/commands/experiment.ts + router.ts case. 5) Тесты: experiment.test.mjs (mkdtemp), experiment-cli.test.mjs. 6) pnpm build && pnpm test. Риск: id exp-<n> должен игнорировать неэкспериментальные файлы в каталоге; коммит git — эксперименты это данные проекта.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 02:31
---
Фаза 3 (Code) выполнена. Коммит e26c6a5.
Изменено (10 файлов): `src/core/paths.ts` (+experimentsDir/experimentsDatasetsDir/experimentsPromptsDir/experimentRunsDir), новый `src/core/experiment.ts` (типы Experiment/VariantConfig/ExperimentStatus/ExperimentMetrics/JudgeConfig; EXPERIMENT_STATUSES; SCHEMA_VERSION=1; experimentFilename/createExperiment/parseExperimentMarkdown/experimentToMarkdown/nextExperimentId/listExperiments/getExperiment/writeExperiment — секции metrics и judge round-trip'ят уже сейчас, prompt хранится строкой и `builtin:<phase>` парсится целиком), `src/core/reference.ts` (+'experiment' в REFERENCE_TYPES, описание в шапке), `src/core/reference.test.mjs` (deepEqual-массив), `src/mcp/tools.ts` (enum-описания reference_list/reference_add), новый `src/cli/commands/experiment.ts` (create/list, `--variant A:builtin:spec[:label]`, по умолчанию A/B-заготовки), `src/cli/router.ts` (case + импорт + строка справки), `CHANGELOG.md` (строка в Unreleased), тесты `src/core/experiment.test.mjs` (13) и `src/cli/experiment-cli.test.mjs` (6). Документация: doc-8 — перечень типов reference дополнен `experiment` (в справочнике reference_list/reference_add и в описании раздела).
Проверки: `pnpm build` — чисто; целевые прогоны (experiment/experiment-cli/reference/reference-tools — 76 тестов) зелёные; ПОЛНЫЙ `pnpm test` — 131 файл, 2467 passed, 4 skipped, 0 failed (исключённых файлов нет).
Технические детали: тестовые каталоги — только `mkdtempSync(join(tmpdir(), 'vibelog-experiment-…'))`; CLI-тесты собирают env через `testSpawnEnv()`; `listExperiments` берёт только файлы с id вида `exp-<n>` (посторонний markdown в `backlog/experiments/` не сбивает нумерацию и не ломает листинг), сортировка числовая (exp-2 < exp-10).
Что осталось (за рамками задачи): резолв промптов и датасетов — VL-295/VL-296, прогоны/record/report — VL-296/VL-297, judge — VL-298.
---
author: @agent
created: 2026-11-02 02:44
---
Фаза Close выполнена. Статус: Done.
Коммиты:
- feat e26c6a5 — артефакт экспериментов (Code; 10 файлов: paths/experiment/reference/tools/router/CHANGELOG + тесты) — код уже был закоммичен фазой Code, перекоммит не требовался.
- docs 3807a21 — `doc-8` (тип reference `experiment`) и `doc-21` (уточнение спецификации: `builtin:<phase>`, шаги MVP) — эти правки через MCP остались вне Code-коммита, закоммичены в Close.
- docs(task) cc1b2ca — lessons lesson-165 и lesson-166.
Проверки: `pnpm build` — чисто (один раз); ранний точечный фильтр по затронутым модулям (experiment.test.mjs, experiment-cli.test.mjs, reference.test.mjs) — 48 passed; ПОЛНЫЙ `pnpm test` — 132 файла, 2475 passed, 4 skipped, 0 failed (повторных полных прогонов не было, исключённых файлов нет). Diff затрагивал src/ и CHANGELOG, поэтому полный прогон обязателен и выполнен.
Не закоммичено: файлы задач дочерних VL-295…VL-300 и `backlog/completed/VL-287/288`, `backlog/tasks/VL-301` — чужие правки (параллельная работа над планами эпика), не принадлежат VL-294; файл VL-294 коммитит framework. Незакоммиченных файлов кода нет.
Lessons: lesson-165 (сверять git status по backlog/docs перед закрытием — doc-*, изменённые через MCP, не попадают в Code-коммит), lesson-166 (в первом шаге эпика парсить round-trip все секции frontmatter, включая metrics/judge, чья логика будет позже); обе связаны с VL-294.
---
<!-- COMMENTS:END -->