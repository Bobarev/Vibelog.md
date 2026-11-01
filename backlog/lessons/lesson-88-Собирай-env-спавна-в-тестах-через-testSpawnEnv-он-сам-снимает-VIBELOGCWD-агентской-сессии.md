---
id: lesson-88
title: Собирай env спавна в тестах через testSpawnEnv() — он сам снимает VIBELOG_CWD агентской сессии
status: outdated
tags:
  - tests
  - cli
  - env
  - vitest
source_tasks:
  - VL-233
linked_tasks:
  - VL-233
  - VL-286
created_date: 2026-10-30
updated_date: 2026-11-01
supersedes: ''
last_verified: 2026-11-01
verified_by: agent
applies_to: []
kind: rule
---
## Правило

Тест, который спавнит CLI/MCP (`spawn`/`spawnSync`/`McpClient`), собирает env дочернего процесса только через `testSpawnEnv()` из `src/test-env.mjs` — а не через `{ ...process.env }`.

```js
import { testSpawnEnv } from '../test-env.mjs'; // из src/cli|mcp|agent — '../', из src/cli/* — '../'

spawnSync('node', [cliPath, ...args], { cwd: testDir, encoding: 'utf-8', env: testSpawnEnv() });
// нужны свои ключи — параметром, они накладываются ПОВЕРХ очистки:
env: testSpawnEnv({ VIBELOG_SESSION_ID: sessionId })
// своя база env (gitEnv и т.п.):
env: testSpawnEnv({ ...gitEnv, ...env })
```

Хелпер снимает `VIBELOG_CWD`, `VIBELOG_SESSION_ID` и всё с префиксами `VIBELOG_PHASE_`/`VIBELOG_RUN_` (фазовый env оркестратора, VL-114/198/259) и ставит `VIBELOG_SKIP_UPDATE_CHECK=true` (VL-132).

## Почему

В агентской сессии (особенно в worktree задачи) в окружении выставлен `VIBELOG_CWD` на главный репозиторий. Тесты, спавнящие CLI с `{ ...process.env }`, наследуют его — CLI резолвит backlog не в своей mkdtemp-директории, а в основном репо: ложные падения «Backlog-директория не найдена»/«задача не найдена» при полностью рабочем коде (`config-cli`, `create-flags`, `search-cli`, `batch-checklist`), а при параллельном прогоне — ещё и загрязнение реального backlog чужими задачами.

## Статус (VL-286)

Причина устранена: хелпер внедрён во всех тестах, спавнящих CLI/MCP (`src/test-env.mjs`, VL-286). Префикс `env -u VIBELOG_CWD pnpm test` больше **не нужен** — полный `pnpm test` в агентской фазе зелёный без него (проверено: 2398 passed, 4 skipped при выставленных `VIBELOG_CWD`/`VIBELOG_PHASE_*`/`VIBELOG_RUN_*`/`VIBELOG_SESSION_ID`).

## Пример (VL-233, исторический)

`pnpm test` в worktree vl-233 падал на 2–3 файлах из 85 (config-cli, create-flags, search-cli, batch-checklist) — разные на каждом прогоне, потому что параллельные файлы гонялись за один главный backlog. Обход `env -u VIBELOG_CWD` давал 85 файлов / 1591 тест зелёные. Теперь такой обход не нужен: новый тест без `testSpawnEnv()` — это дефект теста, а не повод для префикса.
