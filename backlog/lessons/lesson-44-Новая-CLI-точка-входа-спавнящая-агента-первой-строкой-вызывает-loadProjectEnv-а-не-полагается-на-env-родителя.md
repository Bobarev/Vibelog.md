---
id: lesson-44
title: 'Новая CLI-точка входа, спавнящая агента, первой строкой вызывает loadProjectEnv, а не полагается на env родителя'
status: active
tags:
  - env
  - CLI
  - spawn
  - дублирование
  - browser
  - bot
  - agent
source_tasks:
  - VL-189
linked_tasks:
  - VL-189
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема

VL-189: `vibelog browser` не вызывал `loadDotEnv`/`applySettingsEnv` при старте (в отличие от `vibelog bot`) → спавн фазы падал с «не задан VIBELOG_LLM_API_KEY», а путь `/web start` из бота работал случайно (наследование env родителя).

## Решение

Каждая CLI-точка входа, которая спавнит агента (`bot`, `browser`, `agent` — чат и `analyze`), обязана первой строкой после объявления `cwd` вызывать общий `loadProjectEnv(cwd)` (порядок: `loadDotEnv` → `applySettingsEnv`, VL-143). Дублирующиеся пары вызовов и проверки LLM-env выноси в общие модули (`src/bot/env.ts`, `src/agent/llm-env.ts`), а тексты ошибок переноси дословно — тесты матчат по подстроке.

## Пример

```ts
// src/cli/commands/browser.ts (VL-189)
loadProjectEnv(cwd); // .env/settings-env при старте → spawn фаз наследует VIBELOG_LLM_*
const server = await startWebServer(...);
```