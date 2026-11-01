---
id: lesson-120
title: Снимай VIBELOG_RUN_PHASE/VIBELOG_PHASE_NAME перед полным прогоном тестов внутри агентской фазы
status: active
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
kind: workaround
---
## Проблема

Полный `pnpm test` внутри агентской фазы (Code/Close) падает не по вине кода: тест `src/mcp/server.test.mjs` («fallback: meta без usage → jsonl») получает `VIBELOG_RUN_PHASE=code` из окружения самого агентского рана (оркестратор кладёт его в env спавна, VL-259) и ожидает «фаза close» — получает «фаза code». При прогоне вне фазы (руками) тест зелёный.

## Решение

Перед полным прогоном внутри агентской сессии снимай env-маркеры рана, а не правь тест:

```
env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_PHASE_TASK_ID pnpm test
```

Одиночный прогон упавшего файла так же проверяется через `env -u … npx vitest run <файл>` — если без переменных зелёный, падение классифицируется как env-артефакт и указывается причиной в отчётном комментарии фазы (не как регрессия задачи).

**Устранение: VL-286** — причина (наследование env при спавне CLI/MCP в тестах) закрывается общим тестовым хелпером; после этого `env -u` перестаёт быть обязательным ритуалом, а урок уходит в `outdated`.

## Пример

VL-246: `pnpm test` → 1 failed (`src/mcp/server.test.mjs`, «фаза из меты не использована: … (фаза code, источник jsonl)»); `env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_PHASE_TASK_ID pnpm test` → 105 файлов, 1921 passed, 4 skipped.
