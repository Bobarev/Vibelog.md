---
id: VL-139
title: 'Тесты: быстрые ускорители — isolate: false, один MCP-сервер на файл, test:fast'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 11:21'
updated_date: '2026-10-14 22:59'
due_date: ''
labels: []
dependencies: []
milestone: v1.8
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - vitest.config.mts
  - src/mcp/server.test.mjs
  - src/agent/mcp-client.test.mjs
  - package.json
  - AGENTS.md
  - README.md
lessons: []
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
- [x] #1 vitest.config.mts: isolate: false — прогон зелёный, замер до/после в комментарии задачи (ожидание −8…10 с)
- [x] #2 package.json: скрипт test:fast = vitest run (без build) для итераций; в README/AGENTS.md упомянут
- [x] #3 3 последовательных полных pnpm test зелёные; CHANGELOG: запись
- [x] #4 src/mcp/server.test.mjs: MCP-сервер спавнится один раз на файл (beforeAll: spawn + initialize, afterAll: stdin.end/graceful exit), tools/call идут пачками через stdin/stdout одного процесса; документация AC: documents.test.mjs/types.test.mjs MCP не спавнят (in-process handleToolCall) — не изменяются; поведение тестов не изменилось
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Фактическая корректировка описания

Проверено grep'ом: MCP-сервер спавнится только в `src/mcp/server.test.mjs` (15 вызовов `callMcp`, 12 тестов; каждый `callMcp` = spawn + stdin.end). Файлы `documents.test.mjs` и `types.test.mjs` MCP не спавнят вообще — они импортируют `handleToolCall` из `dist/mcp/tools.js` in-process и используют `spawnSync` для CLI (`runCli`, 11 и 16 вызовов — реальные CLI-интеграционные проверки, батчить без смены семантики нельзя). Поэтому пункт 2 плана применяется целиком к `server.test.mjs`; documents/types не трогаем. Соответствующий AC скорректирован.

## Файлы для изменения

1. `vitest.config.mts` — после строки 26 (`fileParallelism: true,`) добавить `isolate: false,` + JSDoc-комментарий (переиспользование workers вместо 52 spawn'ов, ожидание −8…10 с; опора на VL-125/VL-140: env чистится, tmp уникальны, мок-серверы на эфемерных портах).
2. `src/mcp/server.test.mjs` — строки 37-83: заменить `callMcp` (spawn на каждый вызов) на постоянный клиент:
   - модульные `let proc / received[] / buffer`;
   - `startServer()`: spawn один раз с тем же env-гардом (строки 50-55: удалить VIBELOG_CWD/VIBELOG_PHASE_*, VIBELOG_SKIP_UPDATE_CHECK=true, cwd=testDir), парсинг stdout построчно в `received`;
   - `callMcp(messages)`: снапшот `received.length` до записи, `stdin.write` всех сообщений БЕЗ `stdin.end()`, ждать ответы на все id батча в `received.slice(start)`, вернуть в порядке появления; per-batch таймаут 5 с + kill (как сейчас, строка 80). Дубли id между батчами безопасны: батчи последовательны (await), slice отсекает старые ответы;
   - `beforeAll` (строка 85): setup() + startServer(); `afterAll` (строка 86): `proc.stdin.end()` (сервер сам выходит: src/mcp/server.ts:143-147 rl close -> process.exit(0)), ожидание close до 2 с, иначе kill, затем cleanup();
   - тесты (строки 88-310) НЕ менять: каждый батч по-прежнему шлёт initialize, сервер отвечает идемпотентно (src/mcp/server.ts:116, handleInitialize без состояния). Поведение тестов не изменилось.
3. `package.json` — в scripts (после строки 21) добавить `"test:fast": "vitest run"` (без build).
4. `AGENTS.md` — в блок «Сборка обязательна» дописать: `pnpm test:fast` = vitest run без сборки для итераций (build остаётся в pnpm test).
5. `README.md` — секция тестов: упомянуть pnpm test:fast.
6. `CHANGELOG.md` — запись в unreleased: ускорение тестов (isolate: false, постоянный MCP-сервер, test:fast).

## Порядок действий

1. Замер до: `time pnpm test` (зафиксировать в комментарии задачи).
2. vitest.config.mts: isolate: false -> pnpm test (зелёный?).
3. server.test.mjs: постоянный клиент -> pnpm test (зелёный?).
4. package.json: test:fast -> проверка `pnpm test:fast`.
5. Документация: AGENTS.md, README.md, CHANGELOG.md.
6. Замер после: `time pnpm test` ×3 подряд (все зелёные) + один `time pnpm test:fast`.
7. Замер до/после -> комментарий задачи; отметить AC.

## Как проверить

```bash
pnpm build && time pnpm test   # базовый замер (до правок)
pnpm test                      # после каждой правки
pnpm test:fast                 # итерации без сборки
time pnpm test && time pnpm test && time pnpm test   # 3× подряд
```

## Риски

- `isolate: false`: утечки состояния между файлами в одном worker (env, глобалы). Mitigation: VL-125 чистит env, VL-140 вернул fileParallelism; 3 прогона подряд как регресс-проверка; при флаке — откатить только эту строку.
- Постоянный MCP-сервер: накопленное состояние между тестами. Сервер stateless (читает fs на каждый tools/call, cwd фиксируется при spawn = testDir) — риск низкий; порядок тестов внутри файла sequential.
- Дубли id в батчах — решены срезом received.slice(start).
- Зависший сервер в afterAll — таймаут 2 с + kill.
- Ожидаемый эффект: −8…10 с (isolate) + ~14 спавнов × 100-400 мс ≈ −2…4 с (сервер); если факт меньше — зафиксировать фактические цифры.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 18:18
---
Фаза 2 (Plan) выполнена. Тип: task. План записан (Implementation Plan).
**Ключевая корректировка описания:** grep показал, что MCP-сервер спавнится через `callMcp` **только в `src/mcp/server.test.mjs`** (15 вызовов / 12 тестов). `documents.test.mjs` и `types.test.mjs` MCP не спавнят — они работают in-process через `handleToolCall` из `dist/mcp/tools.js` + `spawnSync` для CLI-проверок (`runCli` 11 и 16 раз — реальные интеграционные CLI-тесты, батчить без смены семантики нельзя). План и AC #2 скорректированы соответственно.
**План (6 файлов):**
1. `vitest.config.mts` — `isolate: false` после `fileParallelism: true` (стр. 26)
2. `src/mcp/server.test.mjs` — замена `callMcp` (стр. 37–83) на постоянный процесс: `startServer()` в beforeAll с тем же env-гардом, `callMcp` пишет батч в живой stdin и ждёт ответы по id через `slice(start)` (защита от дублей id), graceful exit в afterAll через `stdin.end()` (server.ts:143–147 сам выходит); тесты (стр. 88–310) не меняются
3. `package.json` — `test:fast = vitest run`
4. `AGENTS.md`, 5. `README.md`, 6. `CHANGELOG.md` — документация
**Порядок:** замер до (`time pnpm test`) → isolate → постоянный сервер → test:fast → доки → 3× прогона + замер после → отчёт в комментарии.
**Риски:** isolate:false — возможны утечки между файлами в worker (3 прогона как регресс-проверка, VL-125/VL-140 уже чистят env); постоянный сервер — состояние между тестами (сервер stateless, cwd фиксируется); таймаут 2с + kill на зависший afterAll.
---
author: @agent
created: 2026-10-13 19:23
---
Фаза 3 (Code) выполнена. Коммит `41d1a5c` (ветка vb/vl-139).
**Изменено (6 файлов):**
- `vitest.config.mts` — `isolate: false` (+ комментарий: опора на VL-125/VL-140)
- `src/mcp/server.test.mjs` — постоянный MCP-процесс на файл: `startServer()` в beforeAll (один spawn с env-гардом VL-116/VL-132, построчный парс stdout), `callMcp` пишет батчи в живой stdin без `stdin.end()`, ждёт ответы по id через `received.slice(start)` (защита от дублей id), per-batch таймаут 5 с + kill; afterAll — `stdin.end()` → graceful exit (server.ts rl close → process.exit(0)), ожидание 2 с, иначе kill. Тесты (строки 88–310) не менялись. `documents.test.mjs`/`types.test.mjs` не тронуты (MCP не спавнят — in-process `handleToolCall`).
- `package.json` — скрипт `"test:fast": "vitest run"` (без build)
- `AGENTS.md`, `README.md` — упоминание `pnpm test:fast` и `isolate: false`
- `src/agent/mcp-client.test.mjs` — починка флака, пойманного при регресс-серии: тест «таймаут запроса → reject» был гонкой «1 мс vs быстрый ответ реального сервера» (~1 прогон из 5 падал ещё до VL-139 — воспроизведён и на изолированном прогоне). Фикс: тихий стаб `silent-mcp.mjs` (отвечает только на initialize, на tools/list молчит) — таймаут детерминирован, клиент проверяется на живость после reject.
**Замеры (macOS, user time стабильно ~1m33):**
- до: `time pnpm test` = **52.3 s**
- isolate: false = 50.0 s; + постоянный сервер = 47.3 s
- после (3 подряд): **48.9 / 48.7 / 47.7 s** — все зелёные, 52 файла / 886 тестов
- `pnpm test:fast` = 46.9 s зелёный (без ~1.5 с build; выгода test:fast малая, т.к. build и так быстрый — tsc)
- Итог: −4…5 с (~8–9%). Факт меньше ожидания (−8…10 с isolate + −2…4 с сервер): профиль 2026-10-13, вероятно, снимался на более нагруженной машине; цифры фиксирую фактические.
**Примечания:**
- В сериях 2 раза ловились падения CLI spawnSync-тестов («Backlog-директория не найдена», timeout 5s) — диагностика показала внешнюю нагрузку (load average 38, wall-time прогона 91s при том же user-time), не связь с isolate:false; после спада нагрузки 3+2 прогона подряд зелёные.
- **AC #3 не отмечен**: «3 прогона зелёные» — выполнено, но запись в CHANGELOG не делал — по правилам Фазы 3 CHANGELOG обновляет Фаза Close после слияния (VL-126). Если владелец хочет запись здесь — скажите, допишу отдельным коммитом.
**Проверки:** `pnpm test` ×3 подряд зелёные + `pnpm test:fast` зелёный + точечный прогон `mcp-client.test.mjs` после фикса. Что осталось: запись CHANGELOG (Фаза Close).
---
author: @agent
created: 2026-10-13 20:38
---
Фаза Close выполнена. Ветка vb/vl-139 слита в master (1 коммит: 41d1a5c, merge 8a0dc8b; позже docs-коммит 6d94fe0), worktree удалена (в worktree были только untracked-симлинки node_modules/refs — удалена с --force), ветка удалена. После merge в master: `pnpm build` + `pnpm test` зелёные. CHANGELOG.md: в Unreleased добавлены 2 записи VL-139 (test:fast в «Добавлено», ускорение тестов isolate:false + постоянный MCP-сервер в «Изменено» с фактическими замерами 52.3 → 47.7–48.9 с). DoD: 1 (тесты проходят — проверено после merge), 2 (документация — CHANGELOG + README/AGENTS из ветки), 3 (нет регрессий — сборка и полный прогон зелёные) — выполнены.
---
<!-- COMMENTS:END -->