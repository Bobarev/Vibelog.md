---
id: lesson-82
title: 'Если в главном репо идёт чужой незакоммиченный merge (MERGE_HEAD), не резолвь и не abort''и — отчитайся и жди его завершения'
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
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Фаза Close параллельной задачи начала `git merge --no-ff vb/vl-212` и получила `error: Merging is not possible because you have unmerged files`. Причина — в главном репозитории уже шёл ЧУЖОЙ merge другой задачи (VL-219, `MERGE_HEAD` + `UU CHANGELOG.md`), оставленный прерванным закрывателем. Ожидание 10 минут не помогло: конфликт оставался нетронутым.

## Решение

- Проверь состояние ДО merge: `git rev-parse --verify -q MERGE_HEAD` и `git diff --name-only --diff-filter=U`. Если merge уже идёт и он не твой — слияние невозможно, это не конфликт твоей ветки.
- НЕ резолвь и НЕ делай `git merge --abort`: конфликтные/staged-файлы принадлежат другому merge, abort отбросит чужую staged-работу.
- Отчитайся через `backlog_finish_phase` (только `comment`, без status/dodChecks): укажи `MERGE_HEAD`, файлы конфликта, что это чужая задача, и что состояние своей ветки/worktree цело.
- После того как чужой merge очистится (пользователь сообщит), просто повтори с шага merge — ветка и worktree остались на месте, пересоздавать ничего не нужно.

## Пример

```
git rev-parse --verify -q MERGE_HEAD   # есть → чужой merge
git diff --name-only --diff-filter=U   # UU CHANGELOG.md
# отчёт: «Close прервана: чужой merge VL-219»
# позже, после очистки MERGE_HEAD → git merge --no-ff vb/vl-212 (успех)
```