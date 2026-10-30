---
id: lesson-81
title: 'Разрешай конфликт merge ветки в master подстановкой блоба из коммита ветки, а не ручной правкой'
status: active
tags:
  - merge
  - close-phase
  - git
  - changelog
  - worktree
source_tasks:
  - VL-219
linked_tasks:
  - VL-219
  - VL-235
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Фаза Close сливает ветку в master из главного cwd; если конфликт в CHANGELOG.md, ручной разбор «простыни» из dozens строк легко теряет чужие записи или оставляет маркеры, а `git merge --abort` запрещён шаблоном фазы.

## Решение

Конфликтующий файл уже разрешён в ветке (в merge-коммите ветки с master). Поэтому в главном репо: `git show <merge-коммит-ветки>:CHANGELOG.md | git hash-object -w --stdin` → `git update-index --add --cacheinfo 100644,<blob>,CHANGELOG.md` → `git diff --name-only --diff-filter=U` (пусто) → `git commit --no-edit`. Итоговое дерево master сверяй с деревом ветки: `git diff --stat <master-merge> <branch-merge>` должен быть пустым.

## Пример

VL-219: конфликт только в `CHANGELOG.md`; блоб взят из `3524cdb` (merge master→ветка), индексирован через `update-index`, коммит `c589e7c`. Сверка деревьев дала пустой diff — значит проверка `pnpm build` + полный `vitest` на ветке (1564 passed) валидна и для master.