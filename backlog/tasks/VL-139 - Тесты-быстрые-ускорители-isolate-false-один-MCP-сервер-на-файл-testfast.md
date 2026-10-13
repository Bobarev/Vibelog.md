---
id: VL-139
title: 'Тесты: быстрые ускорители — isolate: false, один MCP-сервер на файл, test:fast'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-13 11:21'
updated_date: '2026-10-13 11:21'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Профиль 2026-10-13: pnpm test = 144 с (build всего 1.5 с — tsc быстрый; tests 98%). Быстрые дешёвые победы:

1. isolate: false в vitest.config.mts — сам vitest подсказывает «at least ~8.10s faster» (переиспользование workers вместо 52 spawn'ов по 159 мс). Тесты уже чистят env (VL-125) и tmp уникальны — риск минимален.

2. Один MCP-сервер на файл: server.test/documents.test/types.test спавнят node cli mcp start через callMcp НА КАЖДЫЙ tools/call (spawnSync ~100-400 мс × десятки вызовов). Фикс: before() — один сервер + initialize, вызовы пачками через stdin (JSON-RPC), after() — graceful exit. Тесты останутся интеграционными (живой сервер), но без N spawn'ов.

3. test:fast = vitest run без сборки — для итераций разработки (в pnpm test build остаётся).

Замер до/после обязателен (time pnpm test).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 vitest.config.mts: isolate: false — прогон зелёный, замер до/после в комментарии задачи (ожидание −8…10 с)
- [ ] #2 src/mcp/server.test.mjs, documents.test.mjs, types.test.mjs: MCP-сервер спавнится один раз на файл (before/after: spawn + initialize + exit), tools/call идут пачками через stdin/stdout одного процесса; поведение тестов не изменилось
- [ ] #3 package.json: скрипт test:fast = vitest run (без build) для итераций; в README/AGENTS.md упомянут
- [ ] #4 3 последовательных полных pnpm test зелёные; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->