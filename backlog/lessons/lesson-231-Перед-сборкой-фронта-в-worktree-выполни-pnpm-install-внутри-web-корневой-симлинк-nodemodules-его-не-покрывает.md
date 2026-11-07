---
id: lesson-231
title: Перед сборкой фронта в worktree выполни pnpm install внутри web/ — корневой симлинк node_modules его не покрывает
status: active
tags:
  - web
  - build
  - worktree
  - pnpm
  - node_modules
source_tasks:
  - VL-347
linked_tasks:
  - VL-347
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

В worktree задачи `web/node_modules` отсутствует: оркестратор кладёт симлинк только на корневой `node_modules`, а у `web/` свой `package.json` и свой набор зависимостей. `pnpm --dir web build` в такой ветке падает на отсутствующих пакетах (vite/tsc не найдены), хотя корневая сборка `pnpm build` проходит — и легко принять это за поломку кода.

## Решение

Перед сборкой фронта в worktree выполни `pnpm install` внутри `web/` (или `pnpm --dir web install`), затем `pnpm --dir web build`. Установка в `web/` не трогает корневой lockfile и не конфликтует с симлинком корневого `node_modules`. После сборки обязательно закоммить `web/dist` (lesson-150) — иначе master получит старый бандл.

## Пример

VL-347: `pnpm --dir web build` в `.vibelog/worktrees/vl-347` упал на отсутствующих зависимостях; `pnpm install` в `web/` + повторный build собрали бандл, `web/dist/assets/index-ByR3A-aC.js` и `index-CK8YopPe.css` ушли в коммит ветки.
