---
id: VL-24
title: 'Миграция CLI, MCP и web-слоя на TypeScript'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 02:23'
updated_date: '2026-10-01 03:29'
due_date: ''
labels:
  - typescript
  - migration
dependencies:
  - VL-23
milestone: v1.5
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Завершить миграцию: перевести оставшиеся слои — src/cli (роутер, аргументы, UI, все 14 команд), src/mcp (stdio-сервер, 21 инструмент), src/web (kanban-интерфейс) — на TypeScript, выключить allowJs, откалибровать bin/vibelog.mjs, обновить документацию и поднять версию до 1.5.0. Особое внимание: MCP-сервер (JSON-RPC поверх stdin/stdout) и гонка process.exit из VL-4 — типизация не должна изменить семантику вывода.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все модули src/cli (router, args, ui, 14 команд), src/mcp (server, tools), src/web переведены на TypeScript; pnpm build и pnpm typecheck зелёные, allowJs в tsconfig выключен (весь src — .ts)
- [x] #2 Интеграционная проверка: vibelog doctor --json показывает все проверки ok; vibelog mcp start отвечает на initialize/listTools — 21 инструмент, включая milestone_* и document_*
- [x] #3 pnpm test зелёный на всём наборе; README.md, CHANGELOG.md и AGENTS.md отражают TS-схему (импорты с .js-расширением, скрипты build/typecheck); версия поднята до 1.5.0
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
Цель: завершить миграцию — cli (14 команд + router/args/ui), mcp (server/tools), web (api/assets/server) → .ts; allowJs выключить; версия 1.5.0; документация.

## Файлы
- src/cli: args.mjs, router.mjs, ui.mjs + commands/*.mjs (14) → .ts
- src/mcp: server.mjs, tools.mjs → .ts
- src/web: api.mjs, assets.mjs, server.mjs → .ts
- bin/vibelog.mjs:9 — импорт '../dist/cli/router.mjs' → '../dist/cli/router.js' (router теперь .ts)
- tsconfig.json: allowJs → false
- package.json: version 1.5.0
- README.md, CHANGELOG.md, AGENTS.md

## Порядок (после каждого слоя: pnpm typecheck && pnpm build && pnpm test)
1. src/cli: args, ui, router → команды (board, browser, config, decision, doc, draft, doctor, init, instructions, milestone, mcp, search, task, version)
2. src/mcp: tools.mjs → server.mjs — СОХРАНИТЬ семантику гонки VL-4: rl.on('close', () => process.stdout.write('', () => process.exit(0))) — типизация не менять поведение вывода
3. src/web: api → assets → server
4. tsconfig: allowJs false — весь src .ts, typecheck строгий по всем файлам
5. package.json: version 1.5.0; CHANGELOG.md: запись v1.5.0 (миграция на TS, zero runtime deps сохранены); README.md: схема сборки (pnpm build → dist, импорты с .js); AGENTS.md: правило «Только чистый Node.js (ES modules, .mjs)» → «TypeScript-исходники (.ts) → tsc → dist ESM; TypeScript/@types/node — devDependencies; zero runtime dependencies; bin/vibelog.mjs — шим»
6. Пути __dirname в dist — автоматически корректны (rootDir src → dist зеркалит): version.mjs 3 уровня до package.json из dist/cli/commands ✓, server.mjs 2 уровня из dist/mcp ✓, init.mjs templates 3 уровня ✓ — проверить grep-ом каждый

## Верификация (финал)
pnpm typecheck && pnpm build && pnpm test — зелёные; find src -name '*.mjs' → пусто (весь src — .ts); node bin/vibelog.mjs --version → 1.5.0; doctor --json → все проверки ok, 21 инструмент; MCP round-trip: echo initialize/tools-list через stdin → 21 инструмент (milestone_*, document_*); compat round-trip ../Backlog.md; grep "\.mjs'" src --include="*.ts" → пусто.

## Риски
- MCP-гонка VL-4 — самое хрупкое место; типизация не должна менять порядок write/exit; покрытие — server.test.mjs + ручной round-trip
- assets.mjs (13.7 КБ HTML-строки) — типизация тривиальна, но легко случайно отформатировать; менять только объявление модуля
- doctor.mjs содержит магические числа (счётчики инструментов) — не трогать
- .qwen/settings.json mcpServers указывает 'vibelog' — шим остаётся, PATH не меняется
- dyld/SIGABRT Catalina — проверять содержимое, не exit code
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 03:29
---
Фаза 3 (Code) VL-24 выполнена 2026-10-01. Весь src на TypeScript, allowJs выключен, версия 1.5.0.

Мигрировано: src/cli (args, ui, router + 14 команд), src/mcp (tools — 21 схема дословно, server — гонка VL-4 сохранена: rl.on('close') → process.stdout.write('', () => process.exit(0))), src/web (api, server, assets — скопирован без изменений).

Финализация: bin/vibelog.mjs → '../dist/cli/router.js'; tsconfig allowJs=false; package.json version 1.5.0; CHANGELOG.md — секция v1.5.0; README.md — pnpm build в установке; AGENTS.md — правило «только .mjs» заменено на схему «.ts → tsc → dist», JSDoc-правило уточнено.

Типизация на границах: ToolArgs = Record<string, unknown> + касты по контрактам схем (JSON со stdio); FlagValues = Record<string, unknown>; createTaskFile body как CreateTaskFileInput (id опционален — Omit<TaskInput,'id'>); двойные касты unknown → интерфейсы там, где overlap недостаточен.

Инциденты: guard слой-скрипта пропустил '../args.mjs'/'../../web/server.mjs' — решено универсальным sweep-скриптом (переписывает .mjs→.js, если цель существует как .ts в src или .js в dist); sweep нужно гонять ПОСЛЕ сборки (первый прогон до build дал 8 падений тестов — dist/mcp/tools.mjs).

Проверки: pnpm typecheck — 0 ошибок; pnpm test — 306/306; doctor --json — все 10 проверок ok, mcp_tools_count=21; MCP round-trip — server 1.5.0, 21 инструмент; --version → vibelog.md 1.5.0; в src не-test .mjs нет, .mjs-импортов в .ts нет.
---
<!-- COMMENTS:END -->