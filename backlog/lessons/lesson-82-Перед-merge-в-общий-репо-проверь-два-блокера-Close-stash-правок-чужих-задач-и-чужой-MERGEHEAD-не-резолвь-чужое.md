---
id: lesson-82
title: 'Перед merge в общий репо проверь два блокера Close: stash правок чужих задач и чужой MERGE_HEAD — не резолвь чужое'
status: active
tags:
  - close
  - git
  - merge
  - parallel
  - worktree
source_tasks:
  - VL-212
linked_tasks:
  - VL-212
created_date: 2026-10-30
updated_date: 2026-11-01
supersedes: lesson-24
last_verified: 2026-11-01
verified_by: agent
applies_to: []
kind:
---
## Проблема

Phase Close сливает ветку задачи в **общий** главный репозиторий, где параллельно живёт чужая работа. Два независимых блокера ломают merge, и у каждого своё лечение — их легко перепутать, потому что сообщения git похожи:

1. **Незакоммиченные правки чужой задачи в тех же файлах**: `git merge` падает с «Your local changes would be overwritten by merge» (VL-172 — в главном репо лежали правки VL-175 в тех же `web/src/...`).
2. **Чужой незавершённый merge (`MERGE_HEAD`)**: `git merge --no-ff vb/vl-212` падает «Merging is not possible because you have unmerged files», хотя свои файлы чисты (VL-212 — в главном репо висел прерванный merge VL-219 с `UU CHANGELOG.md`).

## Решение

Перед merge — короткая диагностика, затем один из двух путей:

```bash
git rev-parse --verify -q MERGE_HEAD          # есть → путь (2)
git diff --name-only --diff-filter=U          # непусто → путь (2)
git status --porcelain                        # M-файлы чужих задач → путь (1)
```

**Путь 1 — свои чужие правки (stash).** Сохраняй в stash только конфликтные файлы и возвращай их после слияния:

```bash
git stash push -m "<описание>" -- <файлы-блокеры>
git merge --no-ff vb/vl-<id> -m "merge: VL-<id> — <заголовок>"
git stash pop   # после успешного commit merge
```

Параллельная работа не теряется и не блокирует закрытие задачи.

**Путь 2 — чужой merge (MERGE_HEAD).** НЕ резолвь и НЕ делай `git merge --abort`: конфликтные/staged-файлы принадлежат другому merge, abort отбросит чужую staged-работу. Отчитайся через `backlog_finish_phase` (только `comment`, без status/dodChecks): укажи `MERGE_HEAD`, файлы конфликта, что это чужая задача, и что состояние своей ветки/worktree цело. Когда чужой merge очистится (пользователь сообщит), просто повтори шаг merge — ветка и worktree остались на месте.

## Пример

Путь 1 (VL-172): stash из `web/src/components/kanban/api.ts` + `web/src/types/kanban.ts` → merge (конфликт только в `web/dist/index.html`) → `git checkout --theirs web/dist/index.html` (build-артефакт берётся версией ветки) → commit merge → `git stash pop` без конфликтов → сборка и тесты зелёные.

Путь 2 (VL-212):

```
git rev-parse --verify -q MERGE_HEAD   # есть → чужой merge
git diff --name-only --diff-filter=U   # UU CHANGELOG.md
# отчёт: «Close прервана: чужой merge VL-219»
# позже, после очистки MERGE_HEAD → git merge --no-ff vb/vl-212 (успех)
```

> Объединено при санитарном проходе (VL-281): прежний отдельный урок про stash чужих правок (lesson-24) описывал первый блокер того же шага Close.
