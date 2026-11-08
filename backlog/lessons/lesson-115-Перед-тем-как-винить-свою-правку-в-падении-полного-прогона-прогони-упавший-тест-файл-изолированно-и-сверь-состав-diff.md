---
id: lesson-115
title: 'Перед тем как винить свою правку в падении полного прогона, прогони упавший тест-файл изолированно и сверь состав diff'
status: active
tags:
  - тесты
  - фазовый-процесс
  - code
  - close
  - диагностика
source_tasks: []
linked_tasks:
  - VL-264
  - VL-373
created_date: 2026-10-30
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Полный `pnpm test` в фазе Code упал на `src/mcp/server.test.mjs` (VL-198, tokenUsage fallback: «фаза из меты не использована»). Легко принять за регрессию своей правки и начать чинить чужой тест — при том, что правка вообще не касается MCP-фазы.

Повтор того же класса в Фазе Close VL-373: полный прогон после merge упал на `src/web/orchestrator.test.mjs` («close в branch-mode: файл задачи закоммичен», `token_usage` не остался грязным). Правка задачи — только `templates/phases/phase-plan.md` и `src/web/phase-prompt.test.mjs`; `orchestrator.test.mjs` в `git diff HEAD^1..HEAD` отсутствует, значит байт-в-байт совпадает с родительским коммитом, а сам файл изолированно проходит 89/89.

## Решение

Первым делом проверь падение на **чистом дереве**: `git stash push -- <изменённые файлы>` → `pnpm build` → `npx vitest run <упавший файл>` → `git stash pop`. Если тест падает и там — это пре-существующее падение (в данном случае: тест `backlog_finish_phase` зависит от окружения сессии агента — `VIBELOG_PHASE_NAME`/`VIBELOG_SESSION_ID`, которые прогон из-под агента неизбежно подставляет).

В Close (правки кода запрещены) stash недоступен — эквивалент: (1) `git diff --name-only HEAD^1..HEAD` — упавший файл вне состава diff ⇒ строка не могла измениться; (2) `pnpm test:fast <упавший файл>` — изолированно зелёный; (3) `ps aux | grep vitest` и `uptime` — параллельный прогон / высокая нагрузка: тесты, ждущие fire-and-forget коммит с дедлайном в несколько секунд, падают только на загруженной машине (load avg 8.8, 198 файлов параллельно); (4) два полных прогона упали на **разных** строках одного файла — признак гонки, а не регрессии.

Правило: чужое падение фиксируй в отчётном комментарии фазы с указанием файла и причины, DoD «Тесты проходят» не отмечай; своё — чини.

## Пример

```bash
git stash push -- src/web/api.ts src/web/chat.ts
pnpm build >/dev/null && npx vitest run src/mcp/server.test.mjs   # падает так же
git stash pop && pnpm build
```

Close, без stash:

```bash
git diff --name-only HEAD^1..HEAD      # упавшего файла нет
pnpm test:fast src/web/orchestrator.test.mjs   # 89 passed
```
