---
id: VL-86
title: 'TUI агента на Ink: стриминг, карточки tool calls, счётчики'
status: Planned
assignee: []
reporter: ''
created_date: '2026-10-04 21:30'
updated_date: '2026-10-05 00:31'
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
- [ ] #1 src/agent/tui.tsx — TUI на Ink: стриминг токенов ответа модели (посимвольно по мере SSE), карточки tool calls (имя инструмента, ключевые аргументы, статус pending/ok/error, длительность), счётчики (input/output/cache-токены, время фазы, номер хода), блок ошибок (LLM API, MCP, лимиты) на русском
- [ ] #2 TUI запускается только в интерактивном режиме (stdout.isTTY) и только когда не передан --headless/--output-format json; в headless TUI не рендерится вообще (контракт stdout для оркестратора сохраняется)
- [ ] #3 Стриминг токенов работает через поток SSE из LLM-клиента (VL-83): callback onToken в llm.ts вызывается по мере получения чанков
- [ ] #4 tsconfig.json: добавить jsx (react-jsx) и jsxImportSource для сборки .tsx через tsc; package.json: ink + react (+@types/react в dev) — runtime-зависимости агента, без нативных модулей
- [ ] #5 pnpm build и pnpm test проходят; TUI-логика (рендер-строки, форматирование) покрыта юнит-тестами на чистых функциях (src/agent/tui-format.ts) в src/agent/*.test.mjs
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