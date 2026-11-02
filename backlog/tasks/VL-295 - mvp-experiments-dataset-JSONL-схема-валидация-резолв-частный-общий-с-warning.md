---
id: VL-295
title: '[mvp] experiments: dataset JSONL — схема, валидация, резолв «частный → общий» с warning'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 03:02'
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
modified_files:
  - src/core/dataset.ts
  - src/core/dataset.test.mjs
  - src/cli/commands/experiment.ts
  - src/cli/experiment-dataset-cli.test.mjs
  - src/cli/router.ts
lessons:
  - lesson-167
token_usage:
  input: 5075310
  output: 37866
  cache: 4955648
  total: 5113176
  requests: 90
  duration_ms: 989543
  reasoning: 8906
  by_phase:
    code:
      input: 3489701
      output: 28294
      cache: 3414016
      requests: 56
    close:
      input: 1585609
      output: 9572
      cache: 1541632
      requests: 34
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MVP-шаг 2 эпика VL-293 (зависит от VL-294). Форматы dataset, резолв и управление датасетами.

Спецификация: `backlog/docs/doc-21` §5 (схема), §6 (резолв).

Файлы:
- `src/core/dataset.ts` (новый): `parseDatasetJsonl(text)` → `{rows, errors[]}`; `DatasetRow = {task_id, expected_ac?, input?, payload?, custom?, meta?}`; валидация: `task_id` обязателен и уникален (дубликат → ошибка строки, не падение); синоним `expected` читается как `expected_ac` с warning; битые JSON-строки → в `errors`, не бросают; при наличии и `input`, и `payload` — warning, выигрывает `payload` (doc-21 §5).
- `resolveDataset(backlogDir, expId, name)` — порядок: `backlog/experiments/<expId>/datasets/<name>.jsonl` → `backlog/experiments/datasets/<name>.jsonl`; при наличии обоих — warning в stderr (`console.error`) и структура `resolution: {chosen: 'private'|'shared', path, shadowed?}` для meta рана. Параметр `explicitPath` для `--dataset-path`.
- `datasetFromCompleted(backlogDir, opts)` — сбор строк из завершённых задач (`backlog/tasks/**` со status Done): `task_id` = ID задачи, `title`+`description` → `input`, `acceptanceCriteria[].text` → `expected_ac`, `type`/`priority` → `custom`. `--limit N` ограничивает число строк (по умолчанию 20).
- `src/cli/commands/experiment.ts` — подкоманды:
  - `dataset create <name> [--from-completed] [--limit N]` — создаёт общий файл `backlog/experiments/datasets/<name>.jsonl`; без `--from-completed` — пустой файл + печать шаблона строки; существующий файл → отказ без `--force`.
  - `dataset list` — общие и частные датасеты с пометкой происхождения.
  - `dataset view <name> [--exp <exp-id>]` — валидация и число валидных/битых строк, список task_id.
  - `dataset <exp-id>` (как в doc-21 §10) — показать резолв для эксперимента, число строк, ошибки.
- Тесты `src/core/dataset.test.mjs`: резолв частный/общий/оба, warning при коллизии, `expected`-синоним, битые строки, дубликат task_id, input+payload; `datasetFromCompleted` на mkdtemp с задачами; CLI-тесты create/list/view.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DatasetRow: task_id обязателен, expected_ac + синоним expected, input/payload, custom, meta
- [x] #2 Резолв частный exp-<id>/datasets → общий experiments/datasets + warning при коллизии
- [x] #3 Битые JSONL-строки и дубликаты task_id попадают в errors, не бросают
- [x] #4 --dataset-path переопределяет резолв
- [x] #5 experiment dataset create <name> [--from-completed] [--limit N]: создаёт общий dataset; --from-completed собирает задачи из backlog/tasks (status Done) в строки task_id/title→input/AC→expected_ac, --limit ограничивает число
- [x] #6 experiment dataset list и experiment dataset view <name> работают (list — общие и частные с пометкой)
- [x] #7 CHANGELOG.md обновлён
- [x] #8 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) src/core/dataset.ts — парс/валидация JSONL + резолв с warnings[]. 2) хелпер `resolveShadowing(backlogDir, expId, kind, name)` общий для dataset и prompts (переиспользуется в VL-296). 3) вывод `experiment dataset`. 4) Тесты на резолв/валидацию (mkdtemp). 5) pnpm build && pnpm test. Риск: warning нельзя глотать — он должен попадать и в stderr, и в meta (VL-296).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 02:59
---
Фаза 3 (Code) выполнена. Коммит e7454ee «feat: VL-295 — dataset JSONL экспериментов: схема, валидация, резолв частный→общий».
Изменено:
- `src/core/dataset.ts` (новый): `DatasetRow {task_id, expected_ac?, input?, payload?, custom?, meta?}`, `parseDatasetJsonl(text)` → `{rows, errors[], warnings[]}`. Валидация не бросает: битый JSON / не-объект / отсутствие `task_id` / неверный тип / дубликат `task_id` → запись в `errors[]` с номером строки (1-based), дубликат отбрасывает вторую строку (действует первая). Синоним `expected` читается как `expected_ac` с warning `expected-synonym`; `input`+`payload` одновременно → warning, выигрывает `payload`. Соответствует doc-21 §5.
- `resolveShadowing(backlogDir, expId, kind, name)` — общий хелпер резолва «частный → общий» для `dataset` и `prompt` (расширение `.jsonl`/`.md`, проверка «имя без пути»), переиспользуется в VL-296; возвращает chosen/path/shadowed/checked.
- `resolveDataset(backlogDir, expId, name, {explicitPath, silent})` — порядок `experiments/<expId>/datasets/<name>.jsonl` → `experiments/datasets/<name>.jsonl`; при коллизии warning печатается в stderr (`console.error`, не глотается) и структура `resolution: {chosen: 'private'|'shared', path, shadowed?}` отдаётся для `meta.json` рана; `--dataset-path` даёт `chosen: 'explicit'` и предупреждает, если общий файл остался в тени; «не найден ни один» — ошибка с перечнем проверенных путей.
- `datasetFromCompleted(backlogDir, {limit, status})` — сбор из `backlog/tasks/**` со `status: Done` (+ архив `backlog/completed/`): `task_id` = ID, `title`+`description` → `input`, `acceptanceCriteria[].text` → `expected_ac`, `type`/`priority` → `custom`; сортировка по `updated_date` убыв., `--limit` (по умолчанию 20) режет хвост, `total` = полное число завершённых.
- `listDatasets(backlogDir, expId?)` / `writeSharedDataset(..., {force})` / `serializeDatasetJsonl` / `DATASET_ROW_TEMPLATE`.
- `src/cli/commands/experiment.ts`: `dataset create <name> [--from-completed] [--limit N] [--force]` (без флага — пустой общий файл + печать шаблона строки, существующий файл → отказ без `--force`), `dataset list [--exp]` (общие и частные с пометкой происхождения и счётчиками строк/ошибок), `dataset view <name> [--exp] [--dataset-path]` (валидные/битые строки, список task_id, exit 1 при ошибках), `dataset <exp-id> [--dataset-path]` (резолв: выбран/затенён, разбор, строка `resolution: {...}` для meta). `src/cli/router.ts` — help-строка experiment расширена до `create|list|dataset`.
Тесты: `src/core/dataset.test.mjs` (27 — парс/валидация/синоним/дубликат/битые строки/input+payload, резолв частный-общий-оба + warning в console.error, prompts-резолв, `--dataset-path`, datasetFromCompleted на mkdtemp с Done/In Progress задачами, list/write), `src/cli/experiment-dataset-cli.test.mjs` (15 — create/list/view/резолв через реальный CLI и testSpawnEnv). Все каталоги — mkdtemp, удаляются в afterAll.
Проверки: `pnpm build` — ok; полный `pnpm test` (build + `vitest run --exclude src/web/static.test.mjs` + `vitest run src/web/static.test.mjs`) — зелёный: 133 файла passed + static 1 файл passed, 2517 passed / 4 skipped, 0 failed. Первый прогон дал 6 падений в `src/mcp/types.test.mjs` и др. (общий `backlog/tasks` worktree в параллели), повторный полный прогон — чисто.
Что осталось (на Close): AC-7 «CHANGELOG.md обновлён» и DoD-2 «Документация обновлена» — по правилам фазы Code CHANGELOG и backlog/docs не правятся, их пишет Фаза Close; doc-7 (CLI-справочник) и doc-21 §5–§6 уже описывают поведение, добавленные подкоманды стоит вписать в doc-7 при закрытии.
---
author: @agent
created: 2026-11-02 03:02
---
Фаза Close выполнена. Статус: Done.
Коммиты:
- feat e7454ee «feat: VL-295 — dataset JSONL экспериментов: схема, валидация, резолв частный→общий» (сделан Фазой Code, повторно не требовался — рабочее дерево по путям задачи чисто).
- docs 777eee4 «docs: VL-295 — документация и CHANGELOG»: запись в CHANGELOG.md (Unreleased → Добавлено) и новый раздел `experiment` в doc-7 (CLI-справочник) — `dataset create|list|view|<exp-id>`, схема строки JSONL, резолв частный→общий с warning и `resolution`, `--dataset-path`.
- docs 0dda36a «docs(task): VL-295 — refs и lessons»: lesson-167 (резолв «частный → общий» отдавать структурой resolution + warning в stderr, не глотать).
Проверки: `pnpm build` — ok. Полный прогон `npx vitest run --exclude src/web/static.test.mjs` — 133 файла passed, 2509 passed / 4 skipped; `npx vitest run src/web/static.test.mjs` — 8 passed. Ранний точечный фильтр по затронутым модулям (`src/core/dataset.test.mjs`, `src/cli/experiment-dataset-cli.test.mjs`) — 42 passed.
Отмечено AC-7 (CHANGELOG.md обновлён) и DoD-2 (Документация обновлена: doc-7).
Не закоммичено: нет (файл задачи VL-295 коммитит framework после записи token_usage).
---
<!-- COMMENTS:END -->