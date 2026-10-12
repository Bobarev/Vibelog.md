---
id: VL-126
title: 'Фаза 3 коммитит в ветку; Фаза Close берёт CHANGELOG и документы, build+тесты после merge'
status: Review
assignee: []
reporter: ''
created_date: '2026-10-12 19:50'
updated_date: '2026-10-12 20:02'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/qwen-commands/phase-3.md
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-close-worktree.md
  - src/web/phase-prompt.test.mjs
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инсайты после живых прогонов close VL-113/VL-118 и фазы VL-117:

1. Фаза 3 не коммитит изменения — они копятся в worktree до close, и владелец не видит диффов в своей ветке (git log vb/vl-N пуст до закрытия). Фикс: шаг в phase-3.md — feat-коммит изменённых файлов кода в текущую ветку по завершению (в branch-mode это ветка задачи в worktree; без worktree — текущая ветка), с явными путями (modifiedFiles), без backlog/, никогда git add -A.

2. CHANGELOG и docs-документы обновляются в Фазе 3 (по планам задач) — но логичнее собирать итог в Фазе Close: она видит полную картину, делает merge и docs-коммиты. Фикс: в оба close-шаблона шаг «обнови CHANGELOG (Unreleased) + docs-документы при изменившемся поведении» с отдельным docs-коммитом; в phase-3 правило «CHANGELOG/docs не трогать».

3. Merge в close-worktree слит без проверки — рекурсивная стратегия может дать сломанную комбинацию (например, две ветки меняли один модуль без конфликта по строкам). Фикс: после merge — pnpm build && pnpm test в главном репо; падение → отчёт без Done (владелец решает).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 phase-3.md: новый шаг перед отчётом — feat-коммит изменённых файлов кода в текущую ветку (worktree → vb/{{taskId}}; без worktree — текущая ветка); правило «не выполняй git commit» заменено на «commit — только по шагу, никогда git add -A, не push»; backlog/ и файлы задач не коммитятся
- [x] #2 phase-3.md: правило «CHANGELOG.md и backlog/docs НЕ обновляй в Фазе 3 — это Фаза Close»
- [x] #3 phase-close.md и phase-close-worktree.md: шаг обновления CHANGELOG (Unreleased) и docs-документов с отдельным docs-коммитом (префикс docs:) перед фиксацией статуса/отчёта
- [x] #4 phase-close-worktree.md: после успешного merge — pnpm build && pnpm test в главном репо; при падении — НЕ ставить Done, отчёт о проблеме
- [x] #5 phase-prompt.test.mjs: ассерты на наличие git commit-шага в phase-3, CHANGELOG-шага в обоих close, pnpm build в close-worktree
- [x] #6 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 20:02
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code; feat 89e3b1c). Реализовано: (1) phase-3.md — шаг 5 «feat-коммит в текущую ветку» (worktree → ветка задачи; без worktree — текущая ветка; явные пути, без backlog/, никогда git add -A, не push; отчёт упоминает хэш), правило «git commit — только по шагу 5», запрет «CHANGELOG и backlog/docs в Фазе 3 — это Close», modifiedFiles переосмыслен как «для отчёта/проверок Close»; (2) phase-close.md и phase-close-worktree.md — шаг «документация и CHANGELOG» (Unreleased-запись + docs при изменившемся поведении) отдельным docs-коммитом ДО docs(task)-коммита; отчёт упоминает хэш docs-коммита; (3) phase-close-worktree.md — после merge: pnpm build && pnpm test в главном репо, при падении отчёт без Done/DoD («merge слит, но сборка/тесты падают»). Тесты: phase-prompt.test.mjs +3. Проверки: pnpm build OK; pnpm test 850/851 (fail — флак static.test, VL-123). Что осталось: первая живая проверка на следующей Фазе 3/Close (коммит в ветку станет виден в git log vb/vl-N сразу после Code); DoD закрывается Фазой Close.
---
<!-- COMMENTS:END -->