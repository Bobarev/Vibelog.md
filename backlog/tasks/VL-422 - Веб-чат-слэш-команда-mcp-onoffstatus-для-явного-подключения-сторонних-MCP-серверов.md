---
id: VL-422
title: 'Веб-чат: слэш-команда /mcp on|off|status для явного подключения сторонних MCP-серверов'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-17 13:51'
updated_date: '2026-11-25 15:42'
due_date: ''
labels:
  - web
  - mcp
  - chat
dependencies: []
milestone: v1.15
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/external-chat-mcp.ts
  - src/web/chat-commands.ts
  - src/web/tool-policy.ts
  - src/web/chat.ts
  - src/web/server.ts
  - src/web/chat-mcp.test.mjs
  - src/web/tool-policy.test.mjs
  - src/web/chat-commands.test.mjs
lessons:
  - lesson-293
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 63
  duration_ms: 1550089
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 42
    close:
      input: 0
      output: 0
      cache: 0
      requests: 21
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: веб-чат (src/web/chat.ts) собирает инструменты только из chatToolDefs — listTools() встроенного vibelog-MCP + локальные инструменты. Внешние MCP-серверы из секции mcpServers .vibelog/settings.json (VL-149, connectExternalMcpServers в src/agent/external-mcp.ts) подключаются только в агентских путях — src/agent/interactive.ts:149 (при старте TUI-сессии) и src/agent/cli.ts:715 (при каждом ране фазы), всегда eager. В веб-процессе их нет вообще.

Цель: дать веб-чату доступ к сторонним MCP-серверам (первичный сценарий — chrome-devtools для веб-тестирования), универсально: механика работает для любой секции mcpServers в любом проекте, без упоминаний конкретного сервера; проект без mcpServers ничего не платит. Запуск подключения — по явному требованию пользователя слэш-командой /mcp (решение принято пользователем: не лениво по роли, не eager при старте).

Входные данные из обсуждения:
- MCP chicken-and-egg: список инструментов известен только после handshake, поэтому «по первому вызову инструмента» поднять невозможно — команда печатает человек;
- state браузера живёт в процессе сервера — соединение одно на процесс с refcount по тредам, не per-тред;
- toolsAsSpecs (src/agent/mcp-client.ts) возвращает spec с handler, executeTool в chat.ts уже маршрутизирует по 'handler' in t — исполнение подхватится без нового кода.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Внешние серверы из mcpServers подключаются только по /mcp on и видны модели со следующего хода
- [x] #2 /mcp off закрывает клиенты при нулевом refcount и убирает инструменты из chatToolDefs
- [x] #3 /mcp status показывает настроенные и подключённые серверы с числом инструментов
- [x] #4 В проекте без mcpServers /mcp on отвечает «внешние серверы не настроены» и ничего не спавнится
- [x] #5 Refcount двух тредов: off в одном треде не разрывает соединение другого; остановка startWebServer закрывает все клиенты
- [x] #6 Вызов внешнего инструмента идёт через Allow/Deny (классификация write) с возможностью always-allow
- [x] #7 В коде/тестах нет упоминаний chrome-devtools — только общий mcpServers и toolPrefixFor
- [x] #8 Тесты зелёные: pnpm test
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

1. **src/web/external-chat-mcp.ts (новый)** — кэш соединения и refcount
2. **src/web/chat-commands.ts** — метаданные /mcp в CHAT_COMMANDS
3. **src/web/tool-policy.ts** — chatToolDefs: параметр externalTools
4. **src/web/chat.ts** — обработчик команды, подстановка externalTools, флаг треда
5. **templates/prompts/chat-system.md** — НЕ трогать (решение пользователя: без секции промпта)
6. **Тесты**: src/web/chat-mcp.test.mjs (новый), правки src/web/tool-policy.test.mjs

## Порядок действий

### 1. src/web/external-chat-mcp.ts

- `interface ExternalChatMcpState { clients: McpClient[]; specs: ToolSpec[]; refcount: number }`
- Процессный `Map<string /* cwd */, ExternalChatMcpState>`.
- `async connectExternalForChat(cwd): Promise<{connected: number; tools: number} | {error: string}>`:
  - `loadExternalMcpServers(cwd)` (синхронный, из src/agent/external-mcp.ts) → пусто → `{error: 'внешние серверы не настроены'}` (без спавна);
  - состояние уже есть → refcount++, вернуть счётчики;
  - иначе `connectExternalMcpServers(cwd)` (там же fail-safe: битый сервер — warning, остальные подключаются), сохранить в map.
- `async releaseExternalForChat(cwd): Promise<void>` — refcount-- ; на 0 → `closeExternalMcpClients(clients)` + delete из map.
- `getExternalSpecs(cwd): ToolSpec[]` — синхронный доступ для chatToolDefs (пусто, если не подключено).
- `async shutdownExternalChatMcp(): Promise<void>` — дренировать весь map; вызвать в startWebServer (src/web/server.ts) рядом с resetOrphanedChatRuns, в try/catch (сбой не мешает закрытию сервера).
- Флаг треда: хранить в meta-файле треда (там, где живёт persona) ключом `mcp: boolean` (по умолчанию false). Чтение — readThreadPersona-путь в chat.ts; запись — при исполнении команды. В off-состоянии refcount не держится (см. п.3).

### 2. src/web/chat-commands.ts

В CHAT_COMMANDS добавить:
```
{ name: 'mcp', usage: '/mcp on|off|status',
  description: 'Внешние MCP-серверы из mcpServers settings.json: подключить/отключить в этом треде/показать состояние',
  examples: ['/mcp on', '/mcp status'] }
```
Попадает в /help и GET /api/chat/commands автоматически (реестр — единственный источник).

### 3. src/web/tool-policy.ts — chatToolDefs

- Сигнатура: `chatToolDefs(cwd, persona?, externalTools: ToolSpec[] = [])`.
- Внешние добавляются ПОСЛЕ локальных, ДО фильтра `allow_tools` (иначе ограничение роли не действует на внешние — урок VL-407).
- Порядок: listTools() → локальные → externalTools → ask_user → memory → ask_persona → фильтр allow.
- Внешние маппить в ToolDef-форму (`{name, description, inputSchema}`) — handler у них уже есть, но chat.ts собирает localHandlers по `'handler' in t` из общего массива, поэтому сохранять handler (spread спеца).

### 4. src/web/chat.ts

- Рядом с обработчиками /trim, /compact (ищем по `findCommand`/parseCommand): обработчик `/mcp`:
  - `on` — если тред уже mcp: «уже подключено»; иначе `connectExternalForChat` → событие в ленту (текст «Подключено серверов N, инструментов M»), флаг треда = true;
  - `off` — `releaseExternalForChat`, флаг треда = false; инструменты исчезают со следующего хода;
  - `status` — список из `loadExternalMcpServers(cwd)` (настроено) + состояние map (подключено, инструментов N) + флаг треда;
  - неизвестный аргумент → подсказка формата.
- В runChat, где `const tools = chatToolDefs(cwd, activePersona)` (chat.ts:1517): подставлять `getExternalSpecs(cwd)`, только если флаг треда true.
- Refcount-семантика: флаг треда true → тред держит единицу refcount, пока mcp on; `/mcp off` в треде — снять свою единицу. Повторный on в одном треде — не дублировать (guard по флагу).

### 5. Классификация — без изменений

`isWriteOperation('chrome_devtools__click')` → неизвестное имя → write → Allow/Deny (fail-safe: клик в браузере может менять задачи). Компенсация — существующая allow-list «Always allow». Внешние имена в `knownToolNames()` для валидации allow_tools НЕ добавлять (allow_tools по внешним именам — вне скоупа этой задачи).

### 6. Тесты (src/web/chat-mcp.test.mjs, паттерн external-mcp.test.mjs)

Фейковый stdio-сервер (как в src/agent/external-mcp.test.mjs), tmp-проект с .vibelog/settings.json:
- AC: mcpServers настроен, `/mcp on` → инструменты в chatToolDefs (через getExternalSpecs + внешний префикс), вызов handler доходит до сервера;
- `/mcp off` → refcount 0 → клиенты закрыты, specs пустые, chatToolDefs без внешних;
- два треда: on в обоих, off в одном → соединение живо; off во втором → закрыто;
- проект без mcpServers → connectExternalForChat возвращает ошибку «не настроены», map пуст;
- shutdownExternalChatMcp закрывает всё;
- внешний инструмент классифицируется как write (isWriteOperation → true);
- /mcp есть в CHAT_COMMANDS и в helpText.
Плюс точечная проверка в tool-policy.test.mjs: externalTools идут до фильтра allow_tools (роль с allow_tools без внешнего имени → внешний отфильтрован).

## Проверка

- `pnpm test` (сборка dist + все тесты)
- Ручная: `vibelog browser` → чат → `/mcp status` (настроен chrome-devtools) → `/mcp on` (долгий первый вызов, npx) → «открой localhost:3030, прочитай консоль» → `/mcp off` → инструменты исчезли.
- Регрессия: `/mcp` в проекте без mcpServers; остановка сервера не оставляет процесс браузера.

## Риски

- Первый `/mcp on` — до ~120 с (timeoutMs в конфиге): npx качает пакет; ход модели при этом не блокируется, команда отвечает событием в ленте.
- Системный промпт подрастает на число схем внешних инструментов (~30 у chrome-devtools) — только пока тред в состоянии on.
- Process-ный кэш по cwd: два проекта в одном процессе (теоретически) — ключ map cwd, изоляция есть.
- Eager-подключение в interactive.ts:149/cli.ts:715 — НЕ в скоупе (отдельная задача, если решим).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-17 14:15
---
Фаза 3 (Code) выполнена. Изменено: src/web/external-chat-mcp.ts (новый — процессный кэш соединения с refcount по тредам: connectExternalForChat/releaseExternalForChat/getExternalSpecs/externalChatMcpStatus/shutdownExternalChatMcp, гейт «не настроены» до спавна, защита от двойного спавна при параллельных /mcp on), src/web/chat-commands.ts (метаданные /mcp on|off|status в CHAT_COMMANDS — попадает в /help и GET /api/chat/commands), src/web/tool-policy.ts (chatToolDefs(cwd, persona?, externalTools=[]): внешние после локальных и ДО фильтра allow_tools VL-407, handler сохраняется), src/web/chat.ts (readThreadMcp/setThreadMcp — флаг mcp в sidecar <threadId>.persona.json; обработчик /mcp в runChatCommand: on/off/status/подсказка; подстановка getExternalSpecs в chatToolDefs при флаге треда), src/web/server.ts (drain кэша в server.on('close') — остановка startWebServer закрывает клиенты, сбой не мешает закрытию), тесты: chat-mcp.test.mjs (новый, 13 тестов), tool-policy.test.mjs (+3: порядок externalTools и применение allow_tools к внешним), chat-commands.test.mjs (реестр с mcp). Коммит 86261b2. Проверки: pnpm build (tsc strict) зелёный; полный pnpm test зелёный — 229 файлов, 4417 тестов, 0 падений; AC7 — grep по новым/изменённым файлам: упоминаний chrome-devtools нет (только общий mcpServers и toolPrefixFor); внешний вызов классифицируется isWriteOperation → write → Allow/Deny (тест), always-allow — через существующую allow-list треда по имени. Диагностика: первый полный прогон дал единичный флейк src/core/report.test.mjs (глобальный process.exitCode=1 от соседа по worker при isolate:false) — на baseline (stash, без изменений) и в парных комбах с моими файлами не воспроизводится; повторный полный прогон зелёный. Что осталось: DoD «Документация обновлена» в Фазе 3 сознательно не отмечается — CHANGELOG и backlog/docs пишет Фаза Close после слияния; ручная сквозная проверка (vibelog browser → /mcp on с реальным сервером) — за счёт долгого npx-first-call, автоматизированные тесты покрывают механику фейковым stdio-сервером.
---
author: @agent
created: 2026-11-17 14:46
---
Фаза Close выполнена. Ветка vb/vl-422 слита в master (1 коммит 86261b2, merge --no-ff без конфликтов), worktree удалена (force: только оркестраторский симлинк backlog/references/data), ветка удалена. Проверки после merge: pnpm build (tsc strict) зелёный; полный прогон тестов зелёный — 230 файлов, 4425 тестов, 0 падений (фильтр точечных файлов молча развернулся в полный прогон — pnpm test:fast не прокидывает аргументы, что зафиксировано уроком lesson-293). DoD: 1 Тесты проходят — полный pnpm test зелёный; 2 Документация обновлена — CHANGELOG.md (Unreleased, запись VL-422) и doc-6 (слэш-команды веб-чата: /mcp on|off|status), коммит c541c37; 3 Нет регрессий — полный прогон без падений. Урок: lesson-293 (ловушка pnpm test:fast -- <файлы>, коммит 71ef3c4). Незакоммиченных файлов задач остаться не должно — файл VL-422 коммитит framework.
---
<!-- COMMENTS:END -->