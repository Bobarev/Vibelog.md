---
id: lesson-113
title: 'Запуская MCP-тесты в агентской сессии, снимай VIBELOG_*-переменные окружения через env -u'
status: active
tags:
  - tests
  - mcp
  - env
source_tasks:
  - VL-266
linked_tasks:
  - VL-266
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Полный `pnpm test` в агентской сессии падает на `src/mcp/server.test.mjs` («fallback: meta без usage → jsonl»): тест спавнит MCP-сервер, тот наследует env сессии (`VIBELOG_PHASE_NAME`, `VIBELOG_RUN_PHASE`, `VIBELOG_CWD`, `VIBELOG_SESSION_ID`), и meta новой сессии получает поле `phase`, которого тест не ожидает. Падение не связано с правками задачи и выглядит как регрессия.

## Решение

Перед прогоном снимать агентские переменные: `env -u VIBELOG_PHASE_NAME -u VIBELOG_RUN_PHASE -u VIBELOG_CWD -u VIBELOG_SESSION_ID pnpm test`. При падении MCP-тестов в первую очередь проверять именно наследование env, а не код задачи; в отчётном комментарии указать причину и способ прогона, чтобы падение не зачли как регрессию.

## Пример

Observed в VL-266: без `env -u` — падение MCP-теста, с `env -u` — 98 файлов зелёные.
