---
id: VL-300
title: '[v2] experiments: external runner (--runner-cmd) и run --rerun N --yes'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 02:19'
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
v2-эпик VL-293 (зависит от VL-299). Внешний раннер и перезапуск прогона.

Спецификация: `backlog/docs/doc-21` §10 (CLI), §13 (runner'ы).

Файлы:
- `src/core/experiment-runner.ts` — external runner: `runner: 'external'` в meta, `--runner-cmd '<shell>'` получает JSON-строку датасета на stdin, ожидает results-строку на stdout; health-check/таймаут через spawn с `timeout`, ошибка команды → `error_kind: 'runner'`.
- `src/cli/commands/experiment.ts` — `run --rerun N --yes`: новый каталог `run-(max+1)` с `rerun_of: run-N`; `--rerun` без `--yes` — отказ с подсказкой (защита от случайного дубля дорогого прогона). Старый ран не перезаписывается (run неизменяем, doc-21 §17 п.6).
- Тесты: external runner на `node -e`-скрипте (stdin→stdout), таймаут команды → error_kind runner, `--rerun` без `--yes` отказывает, с `--yes` создаёт новый каталог с `rerun_of`.

Разделено из прежней VL-300: `experiment gc` и `lesson.references` вынесены в VL-301 — четыре независимых куска в одной задаче не давали закрыть её частично.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 external runner: --runner-cmd, JSON-строка датасета на stdin → results-строка на stdout, таймаут
- [ ] #2 run --rerun N --yes создаёт run-(max+1) с rerun_of: run-N; без --yes отказ
- [ ] #3 CHANGELOG.md обновлён
- [ ] #4 pnpm build && pnpm test зелёные
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