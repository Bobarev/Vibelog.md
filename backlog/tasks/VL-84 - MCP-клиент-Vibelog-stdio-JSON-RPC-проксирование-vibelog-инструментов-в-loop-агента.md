---
id: VL-84
title: 'MCP-клиент Vibelog: stdio JSON-RPC, проксирование vibelog-инструментов в loop агента'
status: Planned
assignee: []
reporter: ''
created_date: '2026-10-04 21:29'
updated_date: '2026-10-05 00:28'
due_date: ''
labels: []
dependencies:
  - VL-83
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: VL-75
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MCP-клиент Vibelog для агента (компонент 4 эпика): stdio-подключение к `vibelog mcp start`, проксирование vibelog-инструментов в tool-calling loop.

Зависит от VL-83 (ядро): loop принимает дополнительный набор инструментов поверх локальных.

Создаётся src/agent/mcp-client.ts:
- spawn `node bin/vibelog.mjs mcp start` (путь к CLI — параметр клиента для тестируемости; в проде — bin/vibelog.mjs пакета или `vibelog` из PATH), cwd = корень проекта (в нём backlog/ и конфиг — без этого MCP-сервер не найдёт задачи, см. src/mcp/server.ts handleToolsCall(id, params, cwd)).
- JSON-RPC 2.0 поверх stdin/stdout, NDJSON (по одной JSON-строке на сообщение — формат сервера, src/mcp/server.ts:77).
- Handshake: initialize (protocolVersion, capabilities, clientInfo) → notifications/initialized → tools/list.
- tools/call: проксирование вызова модели → ответ сервера {content:[{type:'text',text}], isError?} → text возвращается модели как tool-результат; isError=true — тоже tool-результат с пометкой об ошибке (не исключение).
- Таймаут на каждый вызов (60 сек по умолчанию) — зависший сервер не должен вешать фазу.
- close(): отправка EOF stdin (сервер выходит сам — src/mcp/server.ts:145-147), kill процесса через 2 сек если не завершился.

Интеграция с loop (VL-83): новый параметр loop — массив внешних инструментов {name, description, inputSchema, handler}; MCP-инструменты подмешиваются к локальным перед стартом цикла. Конфликт имён (локальный vs vibelog) — отказ при старте, текст ошибки на русском.

Фазы: MCP подключается всегда, кроме prompt (шаблон prompt.md не требует Vibelog MCP — см. orchestrator.ts phaseFlags).

Проверка: pnpm build && node --test src/agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/agent/mcp-client.ts — stdio JSON-RPC 2.0 клиент: spawn vibelog mcp start (путь к CLI — параметр, дефолт `vibelog`), initialize → notifications/initialized → tools/list → tools/call; все ответы — по JSON-RPC 2.0 (id, method, params), stdout разбирается построчно (NDJSON)
- [ ] #2 Проксирование: vibelog-инструменты из tools/list попадают в tool-calling loop агента под своими именами (backlog_view_task и т.д.); результат tools/call (content[0].text) возвращается модели как tool-результат
- [ ] #3 Запуск MCP-сервера с cwd проекта (там backlog/ и конфиг) — иначе сервер не найдёт директорию задач
- [ ] #4 Завершение: закрытие stdin MCP-сервера при выходе loop (сервер сам выходит на close stdin — src/mcp/server.ts:145-147); ошибки протокола не роняют процесс агента — итог фазы is_error=true с текстом на русском
- [ ] #5 Тесты src/agent/mcp-client.test.mjs на dist/: реальный запуск node bin/vibelog.mjs mcp start в /tmp-проекте (изолированно от репозитория); кейсы: initialize+tools/list (backlog_* присутствуют), tools/call backlog_list_tasks возвращает JSON с задачами, ошибка метода → JSON-RPC error, корректное завершение процесса
- [ ] #6 pnpm build и pnpm test проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
MCP-клиент vibelog (stdio JSON-RPC) и проксирование его инструментов в tool-calling loop. Зависит от VL-83.

## Файлы
- src/agent/mcp-client.ts (новый)
- src/agent/loop.ts — правка: opts.externalTools: ToolSpec[] (подмешиваются к локальным; конфликт имён → throw при старте, русский текст)
- src/agent/mcp-client.test.mjs (новый)

## Шаги

### 1. src/agent/mcp-client.ts
- McpClient.create({bin, cwd, requestTimeoutMs=60000}): spawn(bin, ['mcp','start'], {cwd, stdio:'pipe'}); bin по умолчанию 'vibelog', в тестах — путь к bin/vibelog.mjs через process.execPath.
- NDJSON: readline по stdout; ответы сопоставляются по id (Map<number, {resolve,reject,timer}>); уведомления сервера (без id) игнорируются (лог в stderr при VIBELOG_AGENT_DEBUG).
- request(method, params) → Promise; notify(method, params) — без ответа.
- handshake(): request('initialize', {protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'vibelog-agent'}}) → notify('notifications/initialized').
- listTools(): request('tools/list') → ToolDef[]; входная схема инструмента — поле inputSchema|parameters (нормализовать по фактическому listTools() из src/mcp/tools.ts:58).
- callTool(name, args): request('tools/call', {name, arguments:args}) → {content, isError?}; текст = content.filter(type=text).map(t=>t.text).join('\n'); isError=true → префикс «Ошибка MCP-инструмента name: » (tool-результат модели, не исключение).
- toolsAsSpecs(client): ToolSpec[] — handler=(args)=>client.callTool(name,args) в обёртке: исключение протокола → текст «MCP-вызов name не выполнен: <msg>».
- close(): stdin.end(); через 2000мс child.kill('SIGTERM') если жив; ENOENT спавна → reject «MCP-сервер не запущен: vibelog mcp start недоступен (проверь VIBELOG_BIN / PATH)».

### 2. loop.ts
- externalTools ?? []; конфликт имён с локальными → throw «Конфликт имён инструментов: X есть и локально, и в MCP».

### 3. Тесты (реальный сервер в /tmp — изоляция, память cli-test-isolation)
- fs.mkdtempSync(os.tmpdir()+'/vl-agent-mcp-') + backlog/ и конфиг — по паттерну из src/mcp/server.test.mjs.
- spawn node bin/vibelog.mjs mcp start с cwd=/tmp-проекта.
- Кейсы: handshake ok; listTools содержит backlog_view_task; callTool backlog_create_task {title:'X'} → backlog_list_tasks видит задачу; неизвестный метод → ошибка -32601; close() завершает процесс (exitCode 0 в пределах 3с).
- Конфликт имён — дополнение в loop.test.mjs.

### 4. Сборка/тесты
pnpm build && node --test src/agent.

## Проверка
pnpm build; node --test src/agent/mcp-client.test.mjs; pnpm test.

## Риски
- Сервер пишет последний ответ и сразу exit (src/mcp/server.ts:145-147 буферизует через write-callback) — таймаут 3с + kill-фолбэк в тестах.
- Строки сервера вне JSON — фильтр: начинаются с '{', остальное в stderr.
- Пути с пробелами — все аргументы spawn массивом.
- tools/list может вернуть схему с полем parameters вместо inputSchema — нормализация в listTools().

## Уточнение по VL-77 (2026-10-05)

Подтверждение подхода (decision-1 — proposed; doc-4 §3, §10.3): формат vibelog mcp start (newline-delimited JSON-RPC, protocolVersion 2024-11-05, tools-only, 21 инструмент) идентичен StdioClientTransport из @modelcontextprotocol/client/stdio, который использует qwen-code (refs/qwen-code/packages/core/src/tools/mcp-client.ts:21) — минимальный самописный клиент из плана выше корректен, typescript-sdk не нужен. Своя MCP-конфигурация агенту не нужна: сервер спавнится напрямую (`vibelog mcp start`, cwd проекта); .qwen/settings.json (refs/qwen-code packages/core/src/config/storage.ts:210/649) остаётся конфигом qwen и агентом не читается. Структурных изменений плана не требуется.
<!-- SECTION:PLAN:END -->