---
id: lesson-74
title: Валидируй name/id tool_call до записи пары assistant+tool в историю — фантом отравляет jsonl и роняет следующий ход
status: active
tags:
  - agent
  - loop
  - llm
  - tool-calls
  - валидация
  - jsonl
  - web
source_tasks:
  - VL-215
linked_tasks:
  - VL-215
  - VL-216
created_date: 2026-10-29
updated_date: 2026-10-29
supersedes: ''
---
## Проблема

VL-214: модель mimo-v2.6-flash вернула `tool_call` с пустыми `name`/`id` (строка 36 jsonl). `src/agent/loop.ts` не валидировал их — дописал в историю пару `assistant(tool_calls id="") + tool(tool_call_id="")`, и следующий ход LLM API отклонил из-за отравленного ключа. Зеркальная уязвимость — `src/web/chat.ts` (фикс VL-213).

## Решение

Фильтруй tool_calls **ДО** записи assistant-сообщения в диалог/jsonl: общая функция `isValidToolCall(tc)` (name и id непустые после `trim()`) живёт в `src/agent/llm.ts` — обе точки (loop и web/chat) импортируют её, копии не создаются (lesson-37). Только фантомы → отдельное user-сообщение с текстом-ошибкой + повтор хода (без пары с пустым ключом), со счётчиком подряд до `fail()`. Фантом + валидный → выполняется только валидный + user-заметка «проигнорировано N».

## Пример

```ts
// src/agent/loop.ts — строго ДО pushMessage(assistant):
const validCalls = response.toolCalls.filter(isValidToolCall);
if (validCalls.length === 0) {
  await pushMessage({ role: 'user', content: 'Ошибка ответа модели: tool_call с пустым name/id проигнорирован (VL-215).' });
  continue; // повтор хода, пара с пустым ключом не создана
}
// assistant-push: tool_calls: validCalls; цикл выполнения: for (const call of validCalls)
```