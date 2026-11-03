---
id: lesson-184
title: 'Откат экспериментального worktree делай через `git clean -fd` без `-x`, иначе удаляется симлинк node_modules'
status: active
tags:
  - worktree
  - git
  - experiments
  - изоляция
source_tasks:
  - VL-299
linked_tasks:
  - VL-299
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Экспериментальный прогон в отдельном worktree должен откатывать дерево между задачами датасета, но `git clean -fdx` удаляет и симлинк `node_modules`, из-за чего следующий ран падает на отсутствии зависимостей (а пересоздание симлинка — лишний шаг и источник флаки).

## Решение

Откат worktree между прогонами — `git reset --hard` + `git clean -fd` **без `-x`**: untracked-файлы задачи удаляются, а игнорируемые артефакты (симлинк `node_modules`, `.vibelog/`) выживают. Откат ставить в `try/finally`, чтобы падение рана не оставляло грязи следующей строке матрицы.

## Пример

`src/core/worktree.ts` → `resetExperimentWorktree`: `git reset --hard` затем `git clean -fd`; вызов обёрнут в `try/finally` в `src/core/experiment-runner.ts` вокруг спавна рана.
