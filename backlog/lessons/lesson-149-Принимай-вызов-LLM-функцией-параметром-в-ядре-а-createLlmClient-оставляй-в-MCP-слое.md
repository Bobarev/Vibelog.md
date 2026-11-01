---
id: lesson-149
title: 'Принимай вызов LLM функцией-параметром в ядре, а createLlmClient оставляй в MCP-слое'
status: active
tags:
  - tests
  - llm
  - architecture
source_tasks:
  - VL-280
linked_tasks:
  - VL-280
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

LLM-путь (классификация, разбор, сводка) соблазнительно реализовать прямо в MCP-инструменте: там уже есть `createLlmClient` и `cwd`. Тогда ядро нельзя протестировать без сети/фейкового fetch — тесты либо мокают глобальный `fetch` (хрупко, зависит от `apiMode`/`models.default` локального settings, lesson-78/84), либо вообще не пишутся, и логика (парсинг ответа, откаты ошибок, идемпотентность) остаётся непокрытой.

## Решение

Разделяй «что делать с ответом модели» и «как вызвать модель»: ядро объявляет тип функции (`type LessonClassifyFn = (prompt) => Promise<string>`) и принимает её параметром, а создание `createLlmClient` + сборка сообщений живут в MCP-слое (`src/mcp/tools.ts`). Тесты ядра передают мок-функцию (в т.ч. бросающую ошибку для проверки, что сбой по одному элементу не пишет файлы), а прод-проводка остаётся тонкой и без логики.

## Пример

VL-280: `src/core/lesson-classify.ts` — `classifyLessons(cwd, opts, classify)`; `src/mcp/tools.ts` — `toolLessonClassify` создаёт клиент и передаёт `async (prompt) => (await client.streamChat([...])).text`. Тесты `src/core/lesson-classify.test.mjs` не делают ни одного сетевого вызова и покрывают AC3/AC8/AC9 без моков fetch.
