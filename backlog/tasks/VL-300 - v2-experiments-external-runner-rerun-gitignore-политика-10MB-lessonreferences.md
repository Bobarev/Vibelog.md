---
id: VL-300
title: '[v2] experiments: external runner, --rerun, .gitignore-политика >10MB, lesson.references'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 02:06'
due_date: ''
labels:
  - v2
  - experiments
dependencies:
  - VL-299
milestone: ''
references: []
priority: low
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
v2-эпик VL-293 (зависит от VL-299). Догоняющие возможности, оставленные за MVP.

Файлы:
- `src/core/experiment-runner.ts` — external runner: `runner: 'external'` в meta, `--runner-cmd '<shell>'` получает JSON-строку датасета на stdin, ожидает results-строку на stdout; health-check/таймаут через spawn с `timeout`.
- `src/cli/commands/experiment.ts` — `run --rerun N --yes`: новый каталог `run-(max+1)` с `rerun_of: run-N`; `--rerun` без `--yes` — отказ с подсказкой (защита от случайного дубля дорогого прогона).
- Явная команда git-политики: `experiment gc <exp-id>` — печатает кандидатов на `.gitignore` (results.jsonl > 10 MB) и по флагу `--apply` правит `.gitignore`; автоматически при ране НЕ правится (побочный эффект в репо пользователя).
- `src/core/lesson.ts` — расширение `lesson.references` (связь lesson → эксперимент), только если решено расширять схему lesson; иначе связь остаётся через `reference type: experiment` + `reference_link` (в MVP/v2 без правки схемы lesson).
- Документация: добавить секцию про `experiment` в `doc-7` (CLI-справочник) и `doc-8` (MCP-справочник, если появится MCP-инструмент).
- Тесты: external runner на простом `node -e`-скрипте; `--rerun` без `--yes` отказывает; `gc --apply`.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 external runner: --runner-cmd, JSON-строка датасета на stdin → results-строка на stdout, таймаут
- [ ] #2 run --rerun N --yes создаёт run-(max+1) с rerun_of: run-N; без --yes отказ
- [ ] #3 experiment gc показывает кандидатов >10MB, --apply правит .gitignore явно
- [ ] #4 lesson.references не меняется без решения пользователя; связь через reference type experiment
- [ ] #5 doc-7/doc-8 дополнены секцией experiment
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
1) external runner (stdin JSON → stdout results-строка, timeout). 2) --rerun/--yes + rerun_of. 3) experiment gc (+--apply для .gitignore). 4) lesson.references — только по решению пользователя; иначе оставить reference type experiment. 5) Обновить doc-7/doc-8. 6) Тесты на node-скрипте-заглушке. 7) pnpm build && pnpm test. Риск: external runner = произвольный код пользователя — запуск только с явным подтверждением; .gitignore не трогать автоматически.
<!-- SECTION:PLAN:END -->