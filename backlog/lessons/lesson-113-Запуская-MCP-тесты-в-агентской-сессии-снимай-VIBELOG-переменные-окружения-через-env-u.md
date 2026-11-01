---
id: lesson-113
title: 'Запуская MCP-тесты в агентской сессии, снимай VIBELOG_*-переменные окружения через env -u'
status: superseded
tags:
  - tests
  - mcp
  - env
source_tasks:
  - VL-266
linked_tasks:
  - VL-266
  - VL-265
  - VL-286
created_date: 2026-10-30
updated_date: 2026-11-01
supersedes: ''
last_verified: 2026-11-01
verified_by: agent
applies_to: []
kind: workaround
---
## Проблема

Полный `pnpm test` в агентской сессии падал на `src/mcp/server.test.mjs` («fallback: meta без usage → jsonl»): тест спавнил MCP-сервер, тот наследовал env сессии (`VIBELOG_PHASE_NAME`, `VIBELOG_RUN_PHASE`, `VIBELOG_CWD`, `VIBELOG_SESSION_ID`), и meta новой сессии получала поле `phase`, которого тест не ожидал. Падение не связано с правками задачи и выглядело как регрессия.

## Решение (актуальное)

Спавны CLI/MCP в тестах собирают env через `testSpawnEnv(extra)` из `src/test-env.mjs` (VL-286): хелпер снимает `VIBELOG_CWD`, `VIBELOG_SESSION_ID` и всё с префиксами `VIBELOG_PHASE_`/`VIBELOG_RUN_`, а явно нужные значения принимает параметром. Так `src/mcp/server.test.mjs` (`startServer`, `callMcpWithEnv`, кейс с env сессии) и все CLI-тесты перестали наследовать env агентской сессии.

Ритуал `env -u VIBELOG_PHASE_NAME -u VIBELOG_RUN_PHASE -u VIBELOG_CWD -u VIBELOG_SESSION_ID pnpm test` **устарел**: полный прогон в фазе зелёный без него (VL-286: 2398 passed, 4 skipped). Если MCP-тест падает только внутри фазы — искать в тесте `{ ...process.env }` без хелпера, а не добавлять префикс.

## Пример (исторический, VL-266)

Без `env -u` — падение MCP-теста, с `env -u` — 98 файлов зелёные.
