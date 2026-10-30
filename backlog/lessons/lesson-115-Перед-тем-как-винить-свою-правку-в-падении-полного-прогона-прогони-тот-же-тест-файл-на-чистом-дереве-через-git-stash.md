---
id: lesson-115
title: 'Перед тем как винить свою правку в падении полного прогона, прогони тот же тест-файл на чистом дереве через git stash'
status: active
tags:
  - тесты
  - фазовый-процесс
  - code
  - диагностика
source_tasks: []
linked_tasks:
  - VL-264
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Полный `pnpm test` в фазе Code упал на `src/mcp/server.test.mjs` (VL-198, tokenUsage fallback: «фаза из меты не использована»). Легко принять за регрессию своей правки и начать чинить чужой тест — при том, что правка вообще не касается MCP-фазы.

## Решение

Первым делом проверь падение на **чистом дереве**: `git stash push -- <изменённые файлы>` → `pnpm build` → `npx vitest run <упавший файл>` → `git stash pop`. Если тест падает и там — это пре-существующее падение (в данном случае: тест `backlog_finish_phase` зависит от окружения сессии агента — `VIBELOG_PHASE_NAME`/`VIBELOG_SESSION_ID`, которые прогон из-под агента неизбежно подставляет).

Правило: чужое падение фиксируй в отчётном комментарии фазы с указанием файла и причины, DoD «Тесты проходят» не отмечай; своё — чини.

## Пример

```bash
git stash push -- src/web/api.ts src/web/chat.ts
pnpm build >/dev/null && npx vitest run src/mcp/server.test.mjs   # падает так же
git stash pop && pnpm build
```
