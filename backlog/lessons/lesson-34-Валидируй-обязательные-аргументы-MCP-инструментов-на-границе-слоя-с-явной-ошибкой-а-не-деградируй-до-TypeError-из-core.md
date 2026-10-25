---
id: lesson-34
title: 'Валидируй обязательные аргументы MCP-инструментов на границе слоя с явной ошибкой, а не деградируй до TypeError из core'
status: active
tags:
  - mcp
  - валидация
  - schema
source_tasks:
  - VL-183
linked_tasks:
  - VL-183
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

Влад backlog_update_task падал с TypeError «Cannot read properties of undefined (reading 'toLowerCase')» из core (`getTask` → `findTaskFilePath`, `id.toLowerCase()`), потому что JSON-RPC схема MCP-инструментов — только метаданные: сервер не валидирует обязательность `id`, и undefined уходил в core.

## Решение

Валидируй обязательные аргументы инструментов на границе MCP-слоя (в начале handler'а) с явной русской ошибкой, а не деградируй до TypeError из core: `if (typeof args.id !== 'string' || !args.id.trim()) throw new Error('Не передан id задачи (параметр "id").')`. Core (`store.ts`) не трогать — валидация только на границе, чтобы не менять семантику CLI/web.

## Пример

VL-183: `toolUpdateTask` получает проверку id первым шагом; тест в types.test.mjs assert'ит точное сообщение И `NOT match /toLowerCase/` — регрессия на симптом (TypeError из core) ловится напрямую.