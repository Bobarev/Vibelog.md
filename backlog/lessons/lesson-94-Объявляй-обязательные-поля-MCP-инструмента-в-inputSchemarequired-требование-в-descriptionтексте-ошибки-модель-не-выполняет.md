---
id: lesson-94
title: Объявляй обязательные поля MCP-инструмента в inputSchema.required — требование в description/тексте ошибки модель не выполняет
status: active
tags:
  - mcp
  - tool-calling
  - схема
  - loop
source_tasks:
  - VL-253
linked_tasks:
  - VL-253
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

`backlog_finish_phase` объявлял `comment` в `properties` и требовал его только в `description` и тексте ошибки (`required: ['id']`). Модель при tool-calling генерирует аргументы только по объявленным `properties`+`required`, поэтому `comment` не появлялся ни в одном вызове → `throw` → `isError` → повтор той же сигнатуры → loop detection → падение фазы (VL-250, VL-252).

## Решение

1. Требование к аргументу живёт в `inputSchema.required`, а не в тексте ошибки. `description` на генерацию аргументов не влияет.
2. Сервер не должен падать из-за отсутствия поля, без которого он может собрать результат сам: при отсутствии `comment` — авто-отчёт (статус, AC/DoD, modified_files, фрагмент плана) с маркером «собран сервером автоматически».
3. Тест должен проверять схему по `tools/list` (`inputSchema.required.includes(...)`), а не наличие слова в описании — иначе регресс не ловится.

## Пример

```ts
// плохо: требование только в тексте
{ description: 'comment обязателен…', inputSchema: { required: ['id'] } }

// хорошо
{ inputSchema: { properties: { id: {...}, comment: { type: 'string' } }, required: ['id', 'comment'] } }
```
