---
id: lesson-179
title: 'Узел node_modules в worktree — симлинк: шаблон `node_modules/` в .gitignore его не покрывает, добавляй и `node_modules`'
status: active
tags:
  - git
  - worktree
  - gitignore
source_tasks:
  - VL-311
linked_tasks:
  - VL-311
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Оркестратор кладёт в worktree задачи симлинк `node_modules -> <главный репо>/node_modules` (чтобы рантайм-зависимости резолвились без `pnpm install`). `.gitignore` содержал только форму `node_modules/` (каталог с завершающим слэшем) — она НЕ матчит симлинк. Из-за этого WIP-коммит прогресса фазы (`commitProgressChanges`, `src/agent/run-progress.ts` — пути берутся из `git status --porcelain`, а не из явного списка) втянул запись `node_modules` в историю ветки: в `git show --stat` появилась строка `node_modules | 1 +` с blob-режимом 120000.

## Решение

В `.gitignore` держать обе формы: `node_modules/` (каталог) И `node_modules` (симлинк/файл). Если такая запись уже просочилась в коммит — `git rm --cached node_modules` (рабочий симлинк при этом остаётся на месте и продолжает работать).

## Пример

VL-311: WIP-коммит e5f8127 содержал `node_modules`; в feat-коммите сделано `git rm --cached node_modules` и в `.gitignore` добавлена строка `node_modules` рядом с `node_modules/`. Проверка — `git check-ignore -v node_modules` (exit 0 и ссылка на правило).