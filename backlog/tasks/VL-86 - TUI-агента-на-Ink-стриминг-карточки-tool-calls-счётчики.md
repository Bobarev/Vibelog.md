---
id: VL-86
title: 'TUI агента на Ink: стриминг, карточки tool calls, счётчики'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 21:30'
updated_date: '2026-10-05 20:30'
due_date: ''
labels: []
dependencies:
  - VL-83
  - VL-85
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: VL-75
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
TUI агента на Ink (компонент 5 эпика). Зависит от VL-83 (loop + onToken-события) и VL-85 (CLI, который решает TUI vs headless).

Зависимости package.json: ink, react (runtime), @types/react (dev) — без нативных модулей (ограничение Catalina). tsconfig.json: "jsx": "react-jsx", "jsxImportSource": "react" — tsc собирает .tsx → dist/agent/tui.js.

Создаются:
- src/agent/tui-format.ts — чистые функции форматирования (без React): строки статуса tool call, счётчики, обрезка аргументов — тестируются на dist/.
- src/agent/tui.tsx — компоненты Ink: <StreamText> (стриминг onToken из llm.ts), <ToolCard> (имя, аргументы — JSON.stringify с обрезкой ~120 символов, статус, мс), <Counters> (токены input/output/cache, elapsed, ход), <ErrorBlock> (LLM/MCP/лимиты). Обновление — на событиях loop (onToolStart/onToolEnd/onToken/onUsage).

Интеграция: loop (VL-83) расширяется опциональными колбэками события (без них — headless-поведение не меняется); cli.ts (VL-85) при isTTY и не-головном режиме рендерит TUI и по завершении печатает JSON-результат (в stdout — без TUI-разметки, TUI живёт на stderr/альтернативном буфере — чтобы headless-контракт не пострадал при TTY-запуске в pipe).

Тесты: src/agent/tui-format.test.mjs (форматирование строк/счётчиков); сборка .tsx проверяется pnpm build (tsc не пропустит ошибки JSX). Полный рендер TUI визуально (chrome-devtools/ручной запуск не требуется — AC — юниты + сборка).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/agent/tui.tsx — TUI на Ink: стриминг токенов ответа модели (посимвольно по мере SSE), карточки tool calls (имя инструмента, ключевые аргументы, статус pending/ok/error, длительность), счётчики (input/output/cache-токены, время фазы, номер хода), блок ошибок (LLM API, MCP, лимиты) на русском
- [x] #2 TUI запускается только в интерактивном режиме (stdout.isTTY) и только когда не передан --headless/--output-format json; в headless TUI не рендерится вообще (контракт stdout для оркестратора сохраняется)
- [x] #3 Стриминг токенов работает через поток SSE из LLM-клиента (VL-83): callback onToken в llm.ts вызывается по мере получения чанков
- [x] #4 tsconfig.json: добавить jsx (react-jsx) и jsxImportSource для сборки .tsx через tsc; package.json: ink + react (+@types/react в dev) — runtime-зависимости агента, без нативных модулей
- [x] #5 pnpm build и pnpm test проходят; TUI-логика (рендер-строки, форматирование) покрыта юнит-тестами на чистых функциях (src/agent/tui-format.ts) в src/agent/*.test.mjs
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
TUI агента на Ink: стриминг, карточки tool calls, счётчики. Зависит от VL-83 (события loop) и VL-85 (ветка в CLI).

## Файлы
- package.json — dependencies += ink, react; devDependencies += @types/react
- tsconfig.json — compilerOptions += "jsx": "react-jsx", "jsxImportSource": "react"
- src/agent/tui-format.ts (новый)
- src/agent/tui.tsx (новый)
- src/agent/tui-format.test.mjs (новый)
- src/agent/cli.ts — замена текстовой заглушки VL-85 на renderTui

## Шаги

### 1. Зависимости
pnpm add ink react && pnpm add -D @types/react. Совместимость: ink 5.x требует react >=18 — при конфликте pnpm зафиксировать react 18. Без нативных модулей.
tsconfig.json: "jsx": "react-jsx", "jsxImportSource": "react". Проверить сборку .tsx tsc (typescript@7) в module NodeNext; если NodeNext требует .js-расширения в импортах — собрать и поправить по факту ошибки.

### 2. src/agent/tui-format.ts (чистые функции, без React)
- formatToolArgs(args, max=120): JSON.stringify → обрезка с '…'.
- formatToolCard(call): имя, аргументы, статус (⏳/✅/❌/⏱), длительность мс.
- formatCounters(c): «ход N | in: X | out: X | cache: X | время MM:SS».
- formatErrorBlock(lines): строки с префиксом '  ✖ '.

### 3. src/agent/tui.tsx
- renderTui(deps) — <AgentApp>: подписка на события loop (onToken → <StreamText> с автопрокруткой; onToolStart/onToolEnd → список <ToolCard>; onUsage/onTurn → <Counters>; ошибки → <ErrorBlock>).
- Рендер — в альтернативном буфере stdout (Ink useStdout); process.stdout остаётся для финального JSON (контракт VL-85 сохраняется).
- По завершении loop: unmount → JSON печатает cli.ts (как в headless).

### 4. cli.ts
- Условие: isTTY && !headless && phase!=='prompt' && !--no-tui → renderTui; иначе headless.
- Добавить флаг --no-tui (отладка).

### 5. Тесты
- src/agent/tui-format.test.mjs: formatToolArgs (обрезка), formatToolCard (все статусы), formatCounters (MM:SS), formatErrorBlock.
- pnpm build — tsc собирает .tsx (проверка контуров рендера).
- pnpm test — полный прогон.

## Проверка
pnpm build; node --test src/agent; pnpm test; ручной smoke (не для AC): VIBELOG_LLM_* + node dist/agent/cli.js comment VL-40 в терминале — виден стриминг.

## Риски
- TypeScript 7 + react-jsx — проверить на шаге 1; фолбэк "jsx": "react" + import React в tsx.
- Ink + NodeNext ESM: react — CJS-модуль, default-import; ловится сборкой.
- TUI не должна писать в stdout — иначе сломается JSON-контракт оркестратора; проверка — smoke с piped stdout.

## Уточнение по VL-77 (2026-10-05)

1. **Версия Ink — новые данные (doc-4 §10.4):** у qwen-code (целевой агент, работает на Catalina + Node 20) — официальный ink 7.0.3 + react ^19.2.4 (refs/qwen-code/packages/cli/package.json:78, :91); у gemini-cli — форк @jrichman/ink@6.6.9 (decision-2 proposed). Официальный ink 7 проверен в проде целевой среды — приоритетный кандидат; проверить его package.json на отсутствие нативных модулей. Устаревшую оговорку «ink 5.x / react 18» из шага 1 заменить на: ink 7.0.3 + react 19 (дефолт) либо @jrichman/ink@6.6.9 + react 19.2 (фолбэк по decision-2). Если выбор меняет decision-2 — обновить статус ADR при реализации.
2. **Рендер-паттерны (doc-4 §4.1/§4.3):** useGeminiStream (событийная обработка стриминга), StatsDisplay/ContextUsageDisplay (счётчики токенов/времени), ToolConfirmationQueue (очередь tool calls) — переиспользовать как референс; opencode TUI (@opentui/solid) по технологиям не релевантен.
3. **Позиция в roadmap (doc-4 §8/§10.4):** разделение core (cli/core) ↔ оболочка у qwen-code подтверждает roadmap v1.7→v1.8: сначала headless-ядро, TUI потом — порядок задач эпика сохраняется (VL-86 после VL-85).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 16:34
---
Фаза 3 (Code) выполнена.
**Изменено/создано:**
- `src/agent/tui.tsx` (новый) — TUI на Ink 7.0.3: `<StreamText>` (посимвольный стриминг onToken), `<ToolCard>` (имя, аргументы с обрезкой ~120 символов, статус ⏳/✅/❌, длительность мс — pending тикает live), `<Counters>` (ход, токены in/out/cache, время MM:SS), `<ErrorBlock>` (лимиты/LLM API на русском); внешний стор + useSyncExternalStore, рендер на stderr в альтернативном буфере — stdout остаётся под единственную JSON-строку (контракт VL-63). Экспорт `renderTui()` возвращает handle с колбэками loop + unmount.
- `src/agent/tui-format.ts` (новый) — чистые функции форматирования (без React): formatToolArgs/formatToolCard/formatDuration/formatCounters/formatErrorBlock.
- `src/agent/tui-format.test.mjs` (новый) — 12 юнит-тестов чистых функций.
- `src/agent/loop.ts` — расширен опциональными колбэками (headless не меняется): `onUsage(usage, turn)` после каждого ответа модели, `onError(text)` в fail(), `onToolEnd(name, output, isError?)` — хук теперь вызывается и для неизвестного инструмента (isError=true).
- `src/agent/cli.ts` — TUI вместо текстовой заглушки VL-85: запуск только при `interactive && !--no-tui` (interactive = !headless && phase!=='prompt', headless включает !stdout.isTTY и --output-format json); динамический импорт `./tui.js` — в headless ink/react не грузятся; fallback на текстовый прогресс при сбое TUI; новый флаг `--no-tui`; SIGINT → tui.unmount() до exit; TUI размонтируется ДО печати JSON.
- `tsconfig.json` — `"jsx": "react-jsx"`, `"jsxImportSource": "react"`.
- `package.json` — ink 7.0.3 + react 19 (runtime), @types/react (dev); yoga-layout — WASM, нативных модулей нет (Catalina ок; версия ink 7.0.3 — по уточнению VL-77/doc-4 §10.4: официальный ink у qwen-code).
- Документация: `docs/cli-reference.md` (TUI + --no-tui), `CHANGELOG.md` (пункт VL-86), тест `--no-tui` в cli.test.mjs.
**Проверки:** pnpm build OK (tsc собирает .tsx); pnpm test — 560/560 (было 547, +12 tui-format, +1 --no-tui). Headless-контракт: существующие spawn-тесты cli.test.mjs (piped stdout) зелёные + новый тест --no-tui.
**Отмечено:** AC 1-5 ✓, DoD 1-3 ✓. Визуальный smoke TUI в терминале не выполнялся (нет TTY в окружении исполнителя) — юниты + сборка по AC; ручная проверка стриминга в терминале возможна: `VIBELOG_LLM_* node dist/agent/cli.js comment VL-40`.
---
author:  @agent
created: 2026-10-05 20:30
---
Фаза Close выполнена. Статус: Done. Коммит feat: 0bc9d49 — TUI агента на Ink: стриминг, карточки tool calls, счётчики (tui.tsx, tui-format.ts + тесты, tsconfig jsx, ink/react в package.json). CHANGELOG.md и docs/cli-reference.md с пунктом VL-86 остаются незакоммиченными — по паттерну эпика их закоммитит VL-87 (документация агента).
---
<!-- COMMENTS:END -->