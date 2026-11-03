---
id: VL-296
title: '[mvp] experiments: резолв prompts вариантов + manual runner и record (upsert, --run, --from-json)'
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
  - VL-294
  - VL-295
milestone: v1.12
references: []
priority: high
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files:
  - src/core/results.ts
  - src/core/prompts.ts
  - src/core/experiment.ts
  - src/core/dataset.ts
  - src/cli/commands/experiment.ts
  - src/cli/commands/experiment-run.ts
  - src/core/results.test.mjs
  - src/core/prompts.test.mjs
  - src/core/experiment.test.mjs
  - src/cli/experiment-run-cli.test.mjs
  - src/cli/experiment-cli.test.mjs
lessons:
  - lesson-168
  - lesson-169
token_usage:
  input: 7802912
  output: 67547
  cache: 7636992
  total: 7870459
  requests: 103
  duration_ms: 1303053
  reasoning: 21901
  by_phase:
    code:
      input: 5873944
      output: 53405
      cache: 5755904
      requests: 65
    close:
      input: 1928968
      output: 14142
      cache: 1881088
      requests: 38
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MVP-шаг 3 эпика VL-293 (зависит от VL-294, VL-295). Manual runner и record — основной путь для не-AI проектов.

Спецификация: `backlog/docs/doc-21` §6 (резолв prompt), §7 (results, upsert), §8 (meta), §4 (stale running), §10 (CLI).

Файлы:
- `src/core/experiment.ts` — добавить run-инфраструктуру: `nextRunNumber(runsDir)` = max+1, `createRunDir(backlogDir, expId)` (атомарное создание `mkdir` без recursive на листовом уровне — при EEXIST повтор с N+1), `RunMeta` тип, `writeMetaJson/readMetaJson`.
- `src/core/results.ts` (новый): `readResults(jsonl)` → `{rows, errors}`, `upsertResult(rows, row)` по ключу `(task_id, variant)` (НЕ append), `appendResultsJsonl/rewriteResultsJsonl` (запись атомарна: temp-файл + rename, чтобы SIGINT не оставил половину строки).
- `src/core/prompts.ts` (новый): `resolvePrompt(backlogDir, expId, name)` по тому же правилу частный→общий с warning; **`builtin:<phase>` — не ищется в файловой системе**: возвращается `{kind: 'builtin', phase: '<phase>', text: <встроенный промпт фазы>}` (резолв текста — из `templates/phases/phase-<phase>.md` с приоритетом `.vibelog/prompts/phases/phase-<phase>.md`, как в существующем phase-prompt); неизвестная фаза → ошибка со списком доступных. Escape hatch `--variant-a-prompt-path` / `--variant-b-prompt-path`.
- `src/cli/commands/experiment.ts` — подкоманды:
  - `record <exp-id> --variant A --task <id> [--score <n>] [--output <text>] [--error <text>] [--error-kind <k>] [--tool-calls N] [--duration <ms>] [--cost <n>] [--custom '<json>'] [--run N] [--from-json <file>]`: дефолт — последний run; если run'ов >1 и `--run` не задан — предупреждение в stderr. Семантика upsert по (task_id, variant).
  - `run <exp-id> --dry-run`: печатает матрицу «строк датасета × вариантов» + резолвнутые файлы prompts (с пометкой общий/частный/builtin), без создания рана.
  - `run <exp-id>` (manual): создаёт run-N каталог с meta.json (status: running, pid, started_at), печатает инструкцию + список задач, ждёт `record`. Прогон manual не завершается сам — статус закрывает `report` (VL-297).
  - `--from-json <file>`: массив объектов results-строк, upsert пачкой.
- Статусы: `draft → running → completed|failed`; правило «stale running»: хелпер `detectStaleRun(meta)` (проверка `process.kill(pid, 0)`); `run <exp-id> --recover` переводит зависший ран в failed с частичными results.
- Тесты: `src/core/results.test.mjs` (upsert не дублирует, rewrite атомарен), `src/core/experiment.test.mjs` (+nextRunNumber, recover), `src/core/prompts.test.mjs` (частный→общий, builtin:spec отдаёт текст шаблона, неизвестная фаза — ошибка), CLI-тест (record → results.jsonl, повторный record перезаписывает).

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 nextRunNumber = max+1, создание каталога атомарно (EEXIST → следующий номер)
- [x] #2 record: upsert по (task_id, variant), не append; повторный record перезаписывает строку
- [x] #3 record --run N + предупреждение при >1 run без --run; --from-json пачкой
- [x] #4 run --dry-run печатает матрицу «строк × вариантов» + файлы prompts
- [x] #5 stale running: pid не жив → подсказка --recover → failed с частичными results
- [x] #6 resolvePrompt: частный→общий с warning + --variant-a-prompt-path/--variant-b-prompt-path; builtin:<phase> НЕ резолвится в файл, отдаётся как есть с пометкой kind=builtin
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
1) nextRunNumber/createRunDir (atomic mkdir, EEXIST → N+1). 2) src/core/results.ts — upsert по (task_id, variant) + атомарная перезапись. 3) resolvePrompt через общий хелпер shadowing из VL-295. 4) CLI record/run(--dry-run). 5) detectStaleRun + --recover. 6) Тесты (mkdtemp): upsert, nextRunNumber под гонкой, recover, CLI record. 7) pnpm build && pnpm test. Риск: upsert требует перезаписи файла — обязательна атомарность (temp+rename), иначе потеря results при SIGINT.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 03:20
---
Фаза 3 (Code) выполнена. Коммит 71f8a1c.
Изменено:
- `src/core/results.ts` (новый): `ResultRow`/`ParsedResults`, `parseResultsJsonl`, `readResultsFile`, `normalizeResultRow` (общая валидация строки для `record` и `--from-json`), `upsertResult` по ключу `(task_id, variant)` — перезапись на прежней позиции (диффы точечные, не append), `serializeResultsJsonl`, `rewriteResultsJsonl` (temp-файл в ТОМ ЖЕ каталоге + `rename` — `rename` атомарен только в пределах одной ФС; при ошибке temp убирается, исходный цел), `appendResultsJsonl`, `RESULT_ERROR_KINDS` (timeout|api|runner|judge|interrupted). Дубликат пары при разборе — побеждает последняя строка (семантика upsert).
- `src/core/prompts.ts` (новый): `resolvePrompt(backlogDir, expId, name, opts)` — `builtin:<phase>` в ФС НЕ ищется: проверяется по `PHASES`, текст берётся через `loadPhaseTemplate(phase, {cwd})` (приоритет `.vibelog/prompts/phases/phase-<phase>.md` → `templates/phases/`), неизвестная фаза → ошибка со списком доступных, пустая — отдельная ошибка. Файловый резолв — через общий хелпер `resolveShadowing` из VL-295 (частный → общий) с warning при затенении; `--variant-a-prompt-path`/`--variant-b-prompt-path` (любой `--variant-<k>-prompt-path`) перебивает резолв полностью и предупреждает о затенённом общем файле. `resolveVariantPrompts` — ошибка одного варианта не ломает остальные.
- `src/core/experiment.ts`: run-инфраструктура — `listRunNumbers`, `nextRunNumber` (max+1 по каталогам, а не count+1: дырка не переиспользуется), `createRunDir` (`mkdir` БЕЗ recursive на листовом уровне, EEXIST → N+1, до 100 попыток), `RunMeta` (doc-21 §8), `writeMetaJson` (temp+rename) / `readMetaJson` (битый → null, лечится `--recover`), `runDirFor`, `latestRunNumber`, `detectStaleRun` (running + пустой finished_at + `process.kill(pid,0)` → ESRCH = stale; EPERM = жив; manual-ран с `pid: null` зависшим не считается — закрывает report), `recoverRun` (failed + finished_at + reason, `results.jsonl` не трогается), `syncExperimentStatus` (статус карточки — производная от последнего рана).
- `src/cli/commands/experiment-run.ts` (новый): `run <exp-id>` (`--dry-run` печатает матрицу «строки датасета × варианты» + резолвнутые промпты с пометкой частный/общий/builtin/по пути, ран не создаёт; без `--dry-run` создаёт run-N с meta.json status=running/pid/started_at/resolution и печатает инструкцию + список задач; manual-прогон сам не завершается — статус закрывает `report` VL-297), `--recover [--reason]`, `--variant A,B`, escape hatch путей; `record <exp-id>` (`--variant/--task/--score/--output/--error/--error-kind/--tool-calls/--duration/--cost/--custom/--run/--from-json`): дефолт — последний ран, при >1 ране без `--run` предупреждение в stderr, upsert по `(task_id, variant)` с атомарной перезаписью, `--from-json` пачкой.
- `src/cli/commands/experiment.ts`: подключение `run`/`record`, фикс парсера `--variant` для `builtin:<phase>:<label>` (разделитель label ищется ПОСЛЕ префикса — раньше `builtin:spec:текущий` уезжал целиком в prompt и падал на «неизвестная фаза»).
- `src/core/dataset.ts`: `ResolutionInfo.chosen` расширен значением `builtin` (структура резолва промпта пишется в meta.json).
- Тесты: `src/core/results.test.mjs` (13), `src/core/prompts.test.mjs` (11), `src/core/experiment.test.mjs` (+12: nextRunNumber/EEXIST-гонка/meta round-trip/битый meta/detectStaleRun живой-мёртвый pid/recover с частичными results/syncExperimentStatus), `src/cli/experiment-run-cli.test.mjs` (11, реальный CLI в mkdtemp), правка `src/cli/experiment-cli.test.mjs` (`run` стал подкомандой — тест неизвестной подкоманды переведён на `nonsense`).
Проверки: `pnpm build` ✓; полный прогон `npx vitest run` (эквивалент `pnpm test` без повторной сборки, dist собран этим же билдом) — 137 файлов, 2564 passed, 4 skipped, 0 failed. Первый полный прогон упал на `src/web/orchestrator.test.mjs > VL-277 AC1` (fire-and-forget автокоммит close в гонке с параллельными воркерами); повторный полный прогон зелёный — падение не связано с diff'ом (файл не менялся), классифицировано как флейк. Файлов-исключений в прогоне нет.
Что осталось: AC7 «CHANGELOG.md обновлён» и DoD «Документация обновлена» — по правилам фазы Code CHANGELOG и backlog/docs пишет фаза Close; `report`/завершение рана — VL-297, judge — VL-298. Урок: lesson-168.
---
author: @agent
created: 2026-11-02 03:24
---
Фаза Close выполнена. Статус: Done.
Коммиты:
- feat 71f8a1c (сделан в фазе Code) — прогоны экспериментов: резолв промптов, manual run и record (upsert).
- docs 322cd81 — CHANGELOG.md (запись VL-296 в Unreleased/Добавлено) + backlog/docs/doc-7 (раздел `experiment`: новые подкоманды `run` (--dry-run/--recover/--variant/escape hatch путей промптов, правило stale running, статусы) и `record` (upsert по (task_id, variant), флаги, --run, --from-json), обновлён блок подкоманд).
- docs(task) — lessons: lesson-168 (парсинг «префикс:значение:label») и новый lesson-169 (перезапись файла через temp+rename в том же каталоге), оба связаны с задачей.
Проверки в Close: `pnpm build` ✓; ранний точечный прогон затронутых модулей (results/prompts/experiment + оба CLI-набора) — 66 passed; полный прогон `npx vitest run` — 137 файлов, 2564 passed, 4 skipped, 0 failed (один прогон, файлов-исключений нет).
Не закоммичено: нет. Правки файлов задач VL-297, VL-298, VL-299, VL-300, VL-301 и backlog/completed/VL-287, VL-288 — чужие (не этой задачи), не коммитил. Файл задачи VL-296 коммитит framework после записи token_usage.
---
<!-- COMMENTS:END -->