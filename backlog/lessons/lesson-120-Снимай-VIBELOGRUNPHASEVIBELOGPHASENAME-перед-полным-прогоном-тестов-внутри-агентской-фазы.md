---
id: lesson-120
title: Снимай VIBELOG_RUN_PHASE/VIBELOG_PHASE_NAME перед полным прогоном тестов внутри агентской фазы
status: outdated
tags:
  - тесты
  - env
  - оркестратор
  - фазы
source_tasks:
  - VL-246
linked_tasks:
  - VL-246
  - VL-286
created_date: 2026-10-30
updated_date: 2026-11-01
supersedes: lesson-113
last_verified: 2026-11-01
verified_by: agent
applies_to: []
kind: rule
---
## Проблема

Полный `pnpm test` внутри агентской фазы (Code/Close) падал не по вине кода: тест `src/mcp/server.test.mjs` («fallback: meta без usage → jsonl») получал `VIBELOG_RUN_PHASE=code` из окружения самого агентского рана (оркестратор кладёт его в env спавна, VL-259) и ожидал «фаза close» — получал «фаза code». При прогоне вне фазы (руками) тест зелёный.

## Решение

Тест, спавнящий MCP/CLI, собирает env дочернего процесса через `testSpawnEnv()` из `src/test-env.mjs` (VL-286): он снимает `VIBELOG_CWD`, `VIBELOG_SESSION_ID` и всё с префиксами `VIBELOG_PHASE_`/`VIBELOG_RUN_`. Кейсам, которым фаза нужна осознанно, она передаётся явно параметром: `testSpawnEnv({ VIBELOG_RUN_PHASE: 'close' })` — `extra` накладывается поверх очистки.

```js
import { testSpawnEnv } from '../test-env.mjs';
const env = testSpawnEnv({ VIBELOG_SESSION_ID: sessionId });
```

Если тест всё же падает внутри фазы, а вне неё — нет, сначала проверь, не собирает ли он env через `{ ...process.env }` напрямую (это дефект теста, а не повод для `env -u`).

## Статус (VL-286)

Устарело как ритуал: `env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_PHASE_TASK_ID` больше не нужен — полный `pnpm test` в агентской фазе зелёный без префикса (проверено прогоном из фазы Code VL-286 с выставленным фазовым env: 2398 passed, 4 skipped).

## Пример (исторический, VL-246)

`pnpm test` → 1 failed (`src/mcp/server.test.mjs`, «фаза из меты не использована: … (фаза code, источник jsonl)»); `env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_PHASE_TASK_ID pnpm test` → 105 файлов, 1921 passed, 4 skipped.
