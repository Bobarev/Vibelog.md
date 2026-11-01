---
id: VL-296
title: '[mvp] experiments: резолв prompts вариантов + manual runner и record (upsert, --run, --from-json)'
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
  - VL-295
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
MVP-шаг 3 эпика VL-293 (зависит от VL-294, VL-295). Manual runner и record — основной путь для не-AI проектов.

Файлы:
- `src/core/experiment.ts` — добавить run-инфраструктуру: `nextRunNumber(runsDir)` = max+1, `createRunDir(backlogDir, expId)` (атомарное создание `mkdir` без recursive на листовом уровне — при EEXIST повтор с N+1), `RunMeta` тип, `writeMetaJson/readMetaJson`.
- `src/core/results.ts` (новый): `readResults(jsonl)` → `{rows, errors}`, `upsertResult(rows, row)` по ключу `(task_id, variant)` (НЕ append), `appendResultsJsonl/rewriteResultsJsonl` (запись атомарна: temp-файл + rename).
- `src/core/prompts.ts` (новый) или в dataset.ts: `resolvePrompt(backlogDir, expId, name)` по тому же правилу частный→общий с warning; escape hatch `--variant-a-prompt-path` / `--variant-b-prompt-path`.
- `src/cli/commands/experiment.ts` — подкоманды:
  - `record <exp-id> --variant A --task <id> --score <n> [--run N] [--output] [--error] [--from-json <file>]`: дефолт — последний run; если run'ов >1 и `--run` не задан — предупреждение в stderr. Семантика upsert по (task_id, variant).
  - `run <exp-id> --dry-run`: для manual-runner печатает матрицу «строк датасета × вариантов» + список файлов prompts, которые надо заполнить; без `--dry-run` создаёт run-N каталог с meta.json (status: running), печатает инструкцию и список задач, ждёт `record`.
  - `--from-json <file>`: массив объектов results-строк, upsert пачкой.
- Статусы: `draft → running → completed|failed`; правило «stale running» (meta.status=running, pid не жив → подсказка `--recover`: перевод в failed, частичные results валидны) — реализовать хелпер `detectStaleRun(meta)` (проверка `process.kill(pid, 0)`).
- Тесты: `src/core/results.test.mjs` (upsert не дублирует, rewrite атомарен), `src/core/experiment.test.mjs` (+nextRunNumber, recover), `src/cli/experiment-cli.test.mjs` (record → results.jsonl, повторный record перезаписывает).

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 nextRunNumber = max+1, создание каталога атомарно (EEXIST → следующий номер)
- [ ] #2 record: upsert по (task_id, variant), не append; повторный record перезаписывает строку
- [ ] #3 record --run N + предупреждение при >1 run без --run; --from-json пачкой
- [ ] #4 run --dry-run печатает матрицу «строк × вариантов» + файлы prompts
- [ ] #5 stale running: pid не жив → подсказка --recover → failed с частичными results
- [ ] #6 resolvePrompt частный→общий с warning + --variant-a-prompt-path/--variant-b-prompt-path
- [ ] #7 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) nextRunNumber/createRunDir (atomic mkdir, EEXIST → N+1). 2) src/core/results.ts — upsert по (task_id, variant) + атомарная перезапись. 3) resolvePrompt через общий хелпер shadowing из VL-295. 4) CLI record/run(--dry-run). 5) detectStaleRun + --recover. 6) Тесты (mkdtemp): upsert, nextRunNumber под гонкой, recover, CLI record. 7) pnpm build && pnpm test. Риск: upsert требует перезаписи файла — обязательна атомарность (temp+rename), иначе потеря results при SIGINT.
<!-- SECTION:PLAN:END -->