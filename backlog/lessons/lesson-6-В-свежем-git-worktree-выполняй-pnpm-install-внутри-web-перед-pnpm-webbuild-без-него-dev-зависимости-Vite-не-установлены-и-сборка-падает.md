---
id: lesson-6
title: 'В свежем git worktree выполняй pnpm install внутри web/ перед pnpm web:build — без него dev-зависимости Vite не установлены и сборка падает'
status: active
tags:
  - web
  - build
  - worktree
  - pnpm
source_tasks:
  - VL-156
linked_tasks:
  - VL-156
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

В git worktree новой ветки `pnpm web:build` (и `pnpm --dir web typecheck`) падает с `error TS2688: Cannot find type definition file for 'vite/client'` / `Cannot find module '@vitejs/plugin-react'` — worktree копирует только исходники, а `web/node_modules` в git не входит.

## Решение

Перед сборкой web-UI в свежем worktree выполняй `pnpm install --frozen-lockfile` **внутри каталога `web/`** (там отдельный pnpm-workspace/lockfile), затем повторяй `pnpm web:build`. Корневой `pnpm install` не устанавливает зависимости вложенного web-проекта.

## Пример

```bash
cd web && pnpm install --frozen-lockfile && cd .. && pnpm web:build
```
