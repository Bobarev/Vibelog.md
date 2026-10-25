---
id: lesson-30
title: Cap tool-выводов ставь в единой точке loop после handler — handler-капы встроенных инструментов не покрывают MCP
status: active
tags:
  - agent
  - loop
  - mcp
  - truncation
  - tool-output
  - high-risk
source_tasks:
  - VL-178
linked_tasks:
  - VL-178
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

`truncateToolOutput` (8KB) вызывался только внутри handler'ов встроенных инструментов (`src/agent/tools.ts`). Внешние MCP-инструменты шли через `toolsAsSpecs` → `client.callTool()` без обрезки — два вывода `chrome_devtools__take_snapshot` по 624 КБ попали в историю целиком и вызвали отказ провайдера «high risk» (VL-178).

## Решение

Cap tool-выводов применяй в ЕДИНОЙ точке цикла агента — в `loop.ts` сразу после вызова `spec.handler(...)` (включая catch-ветку), до `onToolEnd` и записи в историю. Тогда один `truncateToolOutput(output)` покрывает все инструменты: встроенные, MCP и будущие. Дополнительно cap'ай tool-сообщения в `toWireMessages` (llm.ts) — защита при resume старых jsonl-сессий, где гигантские выводы уже лежат на диске.

## Пример

Плохо: обрезка внутри каждого handler в `tools.ts` — внешние MCP-инструменты её не проходят.
Хорошо: `loop.ts` — `output = await spec.handler(...); output = truncateToolOutput(output);` + `toWireMessages` усекает `role==='tool'` при отправке.