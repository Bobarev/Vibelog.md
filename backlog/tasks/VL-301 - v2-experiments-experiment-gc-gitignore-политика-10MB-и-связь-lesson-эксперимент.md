---
id: VL-301
title: '[v2] experiments: experiment gc (.gitignore-политика >10MB) и связь lesson ↔ эксперимент'
status: Spec
assignee: []
reporter: ''
created_date: '2026-11-02 02:19'
updated_date: '2026-11-02 02:20'
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
v2-эпик VL-293 (зависит от VL-299). Догоняющие возможности, выделенные из прежней VL-300.

Спецификация: `backlog/docs/doc-21` §15 (git-политика), §16 (совместимость, lesson.references).

Файлы:
- `src/cli/commands/experiment.ts` — `experiment gc <exp-id> [--apply]`: печатает кандидатов на `.gitignore` (раны с `results.jsonl` > 10 MB); по `--apply` **явно** дописывает секцию в `.gitignore` (идемпотентно — повторный запуск строки не дублирует). Автоматически при ране `.gitignore` не правится никогда (doc-21 §15).
- Связь lesson ↔ эксперимент — **без правки схемы lesson**: через `reference type: experiment` (добавлен в VL-294) + `reference_link`. Тест: создать reference на `experiments/exp-<id>.md`, связать с задачей, проверить двустороннюю связь.
- Документация: `doc-7` (CLI-справочник) — секция `experiment`; при появлении MCP-инструментов — `doc-8`.
- Тесты: `gc` без `--apply` ничего не меняет, с `--apply` дописывает и идемпотентен; связь через reference.

Расширение `lesson.references` (поле в схеме lesson) — **только по отдельному решению пользователя**, в этой задаче не делается.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 experiment gc <exp-id> показывает кандидатов на .gitignore (results.jsonl > 10 MB), без --apply ничего не меняет
- [ ] #2 experiment gc --apply явно дописывает секцию в .gitignore; повторный запуск не дублирует строки
- [ ] #3 lesson.references НЕ расширяется; связь lesson ↔ эксперимент через reference type: experiment + reference_link покрыта тестом
- [ ] #4 doc-7 (CLI-справочник) дополнен секцией experiment
- [ ] #5 CHANGELOG.md обновлён
- [ ] #6 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->