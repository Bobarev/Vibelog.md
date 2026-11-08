---
id: lesson-258
title: 'Лечи форму аргумента MCP-инструмента, а не формулировку ответа — слабая модель не генерирует markdown внутри JSON'
status: active
tags:
  - mcp
  - prompt
  - agent
source_tasks: []
linked_tasks:
  - VL-379
created_date: 2026-11-08
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Close-сессии падали циклом из-за `lesson_update` без `content`: модель писала «нужно передать content» и снова отправляла вызов без поля. Шесть предыдущих задач (VL-319 → 364) правили формулировки, `missing`, `hint`, `retryWith` и образец в промпте — то есть форму ОТВЕТА инструмента, а форма АРГУМЕНТА (`content` — одна строка с экранированным markdown: `\n`, `##`) оставалась прежней. Слабая модель физически не вставляет такую строку в JSON.

## Решение

Менять форму аргумента, а не текст требования: `lesson_create`/`lesson_update` принимают три обычные строки `problem`/`solution`/`example`, markdown склеивает сервер. Удалённое поле не оставляй «для совместимости» — модель выберет худшую форму: переданный `content` попадает в `skipped` с собственной причиной через хук `removedFields` в `EntitySpec`.

## Пример

Было: `{"content": "## Проблема\n\n…\n\n## Решение\n\n…"}` — 4 дословных повтора → кап → fail. Стало: `{"problem": "…", "solution": "…"}` — форма та же, что у `title`/`description` в `backlog_create_task`, где ловушки никогда не было.