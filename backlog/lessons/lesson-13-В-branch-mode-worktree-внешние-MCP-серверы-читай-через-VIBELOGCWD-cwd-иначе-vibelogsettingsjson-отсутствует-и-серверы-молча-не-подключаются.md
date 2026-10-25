---
id: lesson-13
title: 'В branch-mode (worktree) внешние MCP-серверы читай через VIBELOG_CWD ?? cwd — иначе .vibelog/settings.json отсутствует и серверы молча не подключаются'
status: active
tags:
  - mcp
  - worktree
  - branch-mode
  - external-mcp
  - vibeLOG_CWD
source_tasks:
  - VL-167
linked_tasks:
  - VL-167
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема
В branch-mode (worktree) фазы vibelog-агента работают с cwd = worktree каталога задачи. `.vibelog/settings.json` (per-machine конфиг с mcpServers) находится в `.gitignore` и отсутствует в worktree → `loadExternalMcpServers(worktreeCwd)` возвращает пустой список → внешние MCP-серверы (chrome-devtools и др.) молча не подключаются, хотя настройки в главном репо корректны.

## Решение
Внешние MCP-серверы читать из `.vibelog/settings.json` **главного репо**, резолвя `settingsCwd = process.env.VIBELOG_CWD ?? cwd`, а спавн процессов сервера оставить на `cwd` фазы (worktree). Тот же паттерн уже применён для сессий в `src/agent/cli.ts` и `src/agent/interactive.ts`.

## Пример
`src/agent/external-mcp.ts` (VL-167): `connectExternalMcpServers(cwd)` → `const settingsCwd = process.env.VIBELOG_CWD ?? cwd; loadExternalMcpServers(settingsCwd);` — конфиг читается из главного репо, серверы спавнятся в worktree.