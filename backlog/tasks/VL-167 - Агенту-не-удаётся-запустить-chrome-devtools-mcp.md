---
id: VL-167
title: Агенту не удаётся запустить chrome-devtools-mcp
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 10:08'
updated_date: '2026-10-15 11:22'
due_date: ''
labels: []
dependencies: []
milestone: ''
references:
  - ref-15
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/external-mcp.ts
  - src/agent/external-mcp.test.mjs
  - MCP-SETUP.md
lessons:
  - lesson-13
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Агенту не удаётся запустить chrome-devtools-mcp
В задаче VL-149 было реализовано подключение сторонних mcp к агенту и в рамках этой задачи я видел что агент открывал браузер, но на реальных задачах ему это не удаётся. Вот последняя неудачная:
Задача: VL-165
Сессия агента: vb:agent-1792044682885

Для начала надо проверить настройки - может быть я не правильно их сделал.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (выполнен в Фазе 2)

Причина найдена — это **branch-mode (worktree) баг конфигурации**, а не сломанный MCP-сервер:

1. **Основная причина.** Внешние MCP-серверы vibelog-агента читаются из `.vibelog/settings.json` (секция mcpServers, VL-149) через loadExternalMcpServers(cwd) → loadSettings(cwd) → join(cwd, '.vibelog', 'settings.json') (src/core/settings.ts:36). В branch-mode оркестратор спавнит фазу с cwd = **worktree** (src/web/orchestrator.ts:566-580, ensureTaskWorktree), а .vibelog/ в .gitignore — в worktree **нет** .vibelog/settings.json (проверено: ls .vibelog в worktree vl-167 пуст). Итог: loadSettings(worktreeCwd) возвращает пустой объект → список серверов пуст → chrome-devtools молча не подключается. В VL-149 проверка шла скриптом из главного репо — там файл есть, поэтому браузер открывался; в реальных фазах (VL-165, cwd=worktree) — нет.
2. **Проверить настройки пользователя** (просьба из инцидента): запись chrome-devtools лежит в .qwen/settings.json — это конфиг Qwen Code, vibelog-агент его НЕ читает. Нужно убедиться, что такая же запись mcpServers.chrome-devtools есть в .vibelog/settings.json **главного** репо; если нет — добавить (read-modify-write, сохранив существующие ключи).
3. Усилитель (не корень): в записе пользователя нет timeoutMs — npx -y chrome-devtools-mcp@latest при холодном кэше может не успеть за дефолтные 60 с handshake (engines: node ^20.19||^22.12||>=23 — ref-15, backlog/references/data/chrome-devtools-mcp/package.json:108).

Механизм исправления — тот же паттерн VIBELOG_CWD ?? cwd, что уже применён для сессий в src/agent/cli.ts:321 и src/agent/interactive.ts:92.

## Файлы для изменения

1. **src/agent/external-mcp.ts** — connectExternalMcpServers (строка ~126): перед вызовом loadExternalMcpServers(cwd) резолвить const settingsCwd = process.env.VIBELOG_CWD ?? cwd; и читать конфиг из settingsCwd (главный репо), а спавн процессов сервера оставить на cwd (worktree). Комментарий — почему (VL-167).
2. **src/agent/external-mcp.test.mjs** — в beforeEach чистить VIBELOG_CWD (паттерн src/agent/mcp-client.test.mjs:65) + 2 теста: (a) VIBELOG_CWD задан → серверы читаются из settingsCwd/.vibelog/settings.json, а не из cwd; (b) без env — прежнее поведение (cwd).
3. **MCP-SETUP.md** — раздел «Где конфиг» (строки ~149-153): добавить примечание — в branch-mode/worktree агент читает .vibelog/settings.json главного репо через VIBELOG_CWD; per-machine файл настраивается один раз в главном репо.
4. **.vibelog/settings.json главного репо** (gitignored, НЕ коммитить) — если нет секции mcpServers.chrome-devtools: записать через node -e read-modify-write по process.env.VIBELOG_CWD (запись — копия из .qwen/settings.json + timeoutMs 120000).

## Порядок действий (Фаза Code)

1. Правка external-mcp.ts (1 строка + комментарий) → правка тестов → pnpm build && pnpm test:fast src/agent/external-mcp.test.mjs.
2. Диагностика настроек главного репо: node -e (existsSync + показ ключей mcpServers, без секретов).
3. При отсутствии — записать mcpServers.chrome-devtools в .vibelog/settings.json главного репо (сохранить существующие ключи; добавить timeoutMs 120000).
4. Live-проверка AC#3: node-скрипт через connectExternalMcpServers с VIBELOG_CWD=главный репо → chrome_devtools__new_page (example.com) + chrome_devtools__take_screenshot → без ошибок.
5. Обновить MCP-SETUP.md; pnpm build && pnpm test; закоммитить код (без backlog/, без .vibelog/settings.json).

## Как проверить

- pnpm build && pnpm test (полный прогон — регрессии).
- Live: шаг 4 выше (тот же код-путь, что у агента).

## Риски

- npx -y chrome-devtools-mcp@latest требует сеть и Node ≥20.19 (engines ref-15) — фиксируется timeoutMs в конфиге; старый Node → понятный warn в stderr, фаза продолжается (fail-safe).
- .vibelog/settings.json gitignored — настройка per-machine; документируем в MCP-SETUP.md (worktree-симлинк не делаем: файл может содержать секреты, в ветку/worktree не тянем).
- Протечка VIBELOG_CWD в тесты — чистим в beforeEach (паттерн VL-116).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 10:13
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (информативный, <80 символов). Масштаб: task (диагностика + исправление конфигурации запуска одного MCP-сервера у агента — укладывается в одну задачу). Уточнено: цель — выяснить и устранить причину, по которой агенту не удаётся запустить chrome-devtools-mcp в реальных задачах (в VL-149 браузер открывался, в VL-165 сессии vb:agent-1792044682885 агент прямо отметил «chrome-devtools MCP в этой сессии был недоступен»); пользователь указал начать с проверки настроек. Добавлены 3 конкретных критерия приёмки (выявлена и описана причина; настройки проверены и ошибки исправлены; в реальной сессии агент выполняет new_page + скриншот без ошибок). Labels: mcp, agent. References: ref-15 (chrome-devtools-mcp, официальный репозиторий GitHub) зарегистрирован и связан. Вопросов нет.
---
author: @agent
created: 2026-10-15 10:56
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу (1 вызовом backlog_update_task). Диагноз: причина — branch-mode worktree-баг конфигурации, а не сломанный сервер. Внешние MCP-серверы vibelog-агента читаются из .vibelog/settings.json (VL-149, loadSettings(cwd) → src/core/settings.ts:36), но в branch-mode фаза спавнится с cwd=worktree (orchestrator.ts:566-580), а .vibelog/ gitignored — в worktree файла нет, loadSettings возвращает пусто и chrome-devtools молча не подключается (проверено: ls .vibelog в worktree vl-167 пуст; в VL-149 проверка шла скриптом из главного репо — там файл есть, оттуда и «работало»). Второй пункт (просьба пользователя «проверить настройки»): запись chrome-devtools лежит в .qwen/settings.json — это конфиг Qwen Code, vibelog-агент его не читает; нужная запись должна быть в mcpServers .vibelog/settings.json главного репо (+ timeoutMs 120000 — npx-спавн при холодном кэше). План: 4 файла — src/agent/external-mcp.ts (резолв settingsCwd = VIBELOG_CWD ?? cwd перед loadExternalMcpServers, спавн остаётся на cwd; тот же паттерн, что уже применён для сессий в cli.ts:321/interactive.ts:92), src/agent/external-mcp.test.mjs (+2 теста на VIBELOG_CWD, чистка env в beforeEach), MCP-SETUP.md (раздел «Где конфиг» — примечание про worktree/branch-mode), .vibelog/settings.json главного репо (запись chrome-devtools, gitignored — не коммитится). Порядок, команды проверки (pnpm build && pnpm test, live-проверка new_page + screenshot через connectExternalMcpServers) и риски (npx/сеть/Node engines, секреты в gitignored-конфиге, протечка env в тесты) расписаны в плане. Файлы плана проверены на существование.
---
author: @agent
created: 2026-10-15 11:17
---
Фаза 3 (Code) выполнена. Причина (branch-mode worktree-баг) устранена: connectExternalMcpServers теперь читает .vibelog/settings.json из главного репо через VIBELOG_CWD (тот же паттерн, что cli.ts:321/interactive.ts:92), спавн процессов серверов остался в cwd фазы (worktree). Изменено: src/agent/external-mcp.ts (settingsCwd = VIBELOG_CWD ?? cwd + комментарий VL-167), src/agent/external-mcp.test.mjs (beforeEach чистит VIBELOG_CWD + 2 теста: конфиг из settingsCwd при env / прежнее поведение без env — всего 14/14 зелёных), MCP-SETUP.md (раздел «Где конфиг» — примечание про branch-mode/worktree). Диагностика настроек пользователя: запись mcpServers.chrome-devtools в .vibelog/settings.json главного репо УЖЕ была (command npx, Yandex, isolated, headless=false) — добавлен только timeoutMs 120000 (npx при холодном кэше не успевал за дефолтные 60 с); файл gitignored, не коммитился. Live-проверка тем же код-путём, что у агента (cwd=worktree, VIBELOG_CWD=главный репо): connectExternalMcpServers подключил chrome-devtools — 30 инструментов, new_page(example.com) + take_screenshot прошли без ошибок. Проверки: pnpm build && pnpm test — 1126 passed / 4 skipped, регрессий нет. Коммит 484a55e (ветка vb/vl-167). Осталось: live-проверка выполнена, но рекомендую на реальной задаче агента убедиться, что фаза в worktree видит chrome_devtools__*-инструменты (первый запуск после фикса).
---
author: @agent
created: 2026-10-15 11:22
---
Фаза Close выполнена. Ветка vb/vl-167 слита в master (1 коммит: 484a55e fix: внешние MCP-серверы читают конфиг из главного репо через VIBELOG_CWD в branch-mode), worktree удалена, ветка удалена. DoD: 1) Тесты проходят — pnpm build && pnpm test после merge: 1126 passed / 4 skipped, зелёные; 2) Документация обновлена — MCP-SETUP.md (примечание про branch-mode/worktree) слита с веткой + CHANGELOG.md запись в Unreleased (коммит docs ecb6918); 3) Нет регрессий — полный прогон vitest без падений. Lessons: lesson-13 (чтение .vibelog/settings.json через VIBELOG_CWD ?? cwd в branch-mode).
---
<!-- COMMENTS:END -->