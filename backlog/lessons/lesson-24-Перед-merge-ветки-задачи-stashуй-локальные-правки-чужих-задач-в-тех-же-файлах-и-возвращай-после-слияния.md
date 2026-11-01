---
id: lesson-24
title: Перед merge ветки задачи stash'уй локальные правки чужих задач в тех же файлах и возвращай после слияния
status: superseded
tags:
  - git
  - merge
  - close
  - worktree
  - parallel
source_tasks:
  - VL-172
linked_tasks:
  - VL-172
created_date: 2026-10-25
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

При Фазе Close `git merge` ветки задачи падал: «Your local changes would be overwritten by merge» — в главном репозитории были незакоммиченные правки чужой параллельной задачи (VL-175) в тех же файлах, что меняет сливаемая ветка.

## Решение

Перед merge сохраняй только конфликтные файлы в stash и возвращай после слияния:

```bash
git stash push -m "<описание>" -- <файлы-блокеры>
git merge --no-ff vb/vl-<id> -m "merge: VL-<id> — <заголовок>"
git stash pop   # после успешного commit merge
```

Так параллельная работа не теряется и не блокирует закрытие задачи.

## Пример

VL-172: stash из `web/src/components/kanban/api.ts` + `web/src/types/kanban.ts` → merge (конфликт только в `web/dist/index.html`) → `git checkout --theirs web/dist/index.html` (build-артефакт берётся версией ветки) → commit merge → `git stash pop` без конфликтов → сборка и тесты зелёные.