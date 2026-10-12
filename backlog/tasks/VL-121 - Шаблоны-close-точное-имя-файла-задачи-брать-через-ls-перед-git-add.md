---
id: VL-121
title: 'Шаблоны close: точное имя файла задачи брать через ls перед git add'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-12 19:13'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: low
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент close VL-113: агент в шаге docs(task)-коммита угадал имя файла задачи по её заголовку (Фаза 1 переименовала заголовок — slug файла изменился) — git add упал «fatal: pathspec did not match»; агент восстановился сам за 2 хода через ls. Это классическая ловушка git+кириллица (VL-6: угаданные имена не матчатся).

Фикс — промптовый: в обоих close-шаблонах перед git add явный шаг «получи точное имя: ls backlog/tasks/{{taskId}}* и используй его; не угадывай имя по заголовку — slug может отличаться от заголовка после правок Фазы 1».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 phase-close.md и phase-close-worktree.md: перед git add — шаг ls backlog/tasks/{{taskId}}* для точного имени файла; подсказка «не угадывай имя по заголовку задачи»
- [ ] #2 phase-prompt.test.mjs: оба шаблона содержат ls-подсказку
- [ ] #3 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->