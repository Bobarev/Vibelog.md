---
id: lesson-158
title: 'Проверяй, что wip-коммит в worktree не захватил симлинк node_modules — иначе merge в master падает до конфликтов'
status: active
tags:
  - git
  - worktree
  - merge
  - node_modules
  - close
source_tasks: []
linked_tasks:
  - VL-289
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

В worktree оркестратор кладёт симлинк `node_modules -> <главный репо>/node_modules`. Если фаза Code делает `git add` без явных путей (или `git add -A`) и попадает в аварийный `wip(...)`-коммит, симлинк оказывается **tracked** в ветке. В master он не отслеживается (`.gitignore` содержит `node_modules/`, но tracked-запись игнорирует это правило).

Тогда `git merge --no-ff vb/<id>` из главного репо падает **ещё до разбора конфликтов**:

```
error: Updating the following directories would lose untracked files in them:
	node_modules
Aborting
```

Фаза Close видит `merge` с кодом 128, не находит конфликтных путей и рискует оформить аварийный итог «непонятно почему», хотя правка тривиальна.

## Решение

1. Диагностика: `git ls-tree vb/<id> node_modules` — если выводит blob `120000` (симлинк), он tracked в ветке; для сравнения `git ls-tree master node_modules` пуст.
2. Лечение в ветке (единственные законные git-команды с `-C`, закоммитить можно и из worktree):
   ```bash
   git -C .vibelog/worktrees/<id> rm --cached node_modules
   git -C .vibelog/worktrees/<id> commit -m "chore: <ID> — убрать случайно закоммиченный симлинк node_modules"
   ```
   Затем обычный `git merge --no-ff vb/<id>` из главного cwd — идёт нормально, конфликты (если есть) уже содержательные.
3. Профилактика для агента Code: коммить только явные пути файлов задачи; никогда `git add -A`/`git add .` в worktree.

## Пример

VL-289: `wip(VL-289)` в `e934d29` содержал строку `node_modules | 1 +`, `git merge` падал с «would lose untracked files in them». После `rm --cached` + коммит `975aad9` merge прошёл и дал единственный содержательный конфликт в `templates/phases/phase-close.md`.
