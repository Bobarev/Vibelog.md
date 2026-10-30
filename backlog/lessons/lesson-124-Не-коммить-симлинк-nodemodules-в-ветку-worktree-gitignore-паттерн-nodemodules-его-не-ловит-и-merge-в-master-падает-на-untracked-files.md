---
id: lesson-124
title: Не коммить симлинк node_modules в ветку worktree — gitignore-паттерн node_modules/ его не ловит и merge в master падает на «untracked files»
status: active
tags:
  - git
  - worktree
  - merge
  - close-phase
  - gitignore
  - symlink
source_tasks:
  - VL-268
linked_tasks:
  - VL-268
created_date: 2026-10-31
updated_date: 2026-10-31
supersedes: ''
---
## Проблема

Оркестратор создаёт в worktree симлинк `node_modules -> <главный репо>/node_modules` и `backlog/references/data -> <главный репо>/backlog/references/data`. В `.gitignore` паттерны записаны со слэшем на конце (`node_modules/`, `backlog/references/data/`), а такой паттерн **не матчит симлинк** (это файл, а не каталог). В результате:

- `git add -A` (или добавление каталога целиком) в фазе Code затягивает симлинк `node_modules` (mode 120000) в коммит ветки;
- `git merge --no-ff vb/<id>` из главного cwd падает с `error: Updating the following directories would lose untracked files in them: node_modules` и `Aborting` — потому что в master такого файла нет, а в рабочем каталоге есть реальный каталог `node_modules`;
- `git worktree remove` затем тоже отказывается: «contains modified or untracked files».

## Решение

1. В ветке снять симлинк из индекса: `git -C .vibelog/worktrees/<id> rm --cached node_modules`, закоммитить отдельным `fix(...)` — merge после этого проходит.
2. Лучше не допускать: в фазах Code не использовать `git add -A`; добавлять явные пути файлов задачи.
3. `git worktree remove --force` допустим, когда `git status --porcelain` показывает только untracked-симлинки `node_modules`/`backlog/references/data` (это ссылки на главный репо, данные не теряются).

## Пример

```
$ git merge --no-ff vb/vl-268
error: Updating the following directories would lose untracked files in them:
	node_modules
Aborting

$ git ls-tree vb/vl-268 node_modules
120000 blob a773bbc	node_modules          # ← симлинк, попал в wip-коммит

$ git -C .vibelog/worktrees/vl-268 rm --cached node_modules
$ git -C .vibelog/worktrees/vl-268 commit -m "fix(VL-268): убрать симлинк node_modules из индекса"
$ git merge --no-ff vb/vl-268   # ← ок
```
