---
id: lesson-229
title: 'Перед повторным merge в Close проверяй, не выполнен ли он уже (git log, MERGE_HEAD, branch --merged)'
status: active
tags:
  - close
  - merge
  - git
  - worktree
source_tasks:
  - VL-342
linked_tasks:
  - VL-342
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Фаза Close задачи VL-342 была прервана на конфликте слияния `vb/vl-342` → `master` в `src/cli/commands/doctor.ts` (обе стороны правили файл: задача добавляла проверку `task_integrity`, master менялся другой задачей). Конфликт разрешили вручную, merge-коммит создан, но задача осталась в статусе Review — при повторном запуске Close легко попытаться слить ветку заново и получить «Already up to date» или новый конфликт.

## Решение

Перед повторным слиянием в фазе Close проверяй фактическое состояние репозитория, а не полагайся на статус задачи: `git log --oneline -5` (есть ли уже merge-коммит с сообщением `merge: <ID> — …`), `ls .git/MERGE_HEAD` (нет файла — незавершённого merge нет), `git branch --merged master` (ветка уже слита). Если merge-коммит есть и `MERGE_HEAD` отсутствует — слияние уже выполнено, переходи сразу к проверке сборки/тестов и уборке worktree, не выполняя `git merge` повторно.

## Пример

VL-342: `git log --oneline -5` показал `763edf1 merge: VL-342 — проверка целостности ссылок задач`, `.git/MERGE_HEAD` отсутствовал, `git branch --merged master` содержал `vb/vl-342`. Ветку не сливали повторно — сразу прогнали `pnpm build` + точечные тесты + полный `pnpm test` (182 файла, 3432 теста — зелёные), затем `git worktree remove --force` (в worktree был только untracked-симлинк `backlog/references/data` на главный репозиторий) и `git branch -d vb/vl-342`.
