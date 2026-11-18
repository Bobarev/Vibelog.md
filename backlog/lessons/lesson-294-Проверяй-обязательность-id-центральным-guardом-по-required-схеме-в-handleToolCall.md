---
id: lesson-294
title: Проверяй обязательность id центральным guard'ом по required-схеме в handleToolCall
status: active
tags:
  - mcp
  - guard
  - валидация-схемы
  - инцидент
source_tasks:
  - VL-425
linked_tasks:
  - VL-425
created_date: 2026-11-18
updated_date: 2026-11-18
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Модель стабильно НЕ передавала обязательный args.id в backlog_finish_phase (инцидент lb-gift LB-16: 24 вызова подряд): MCP SDK не валидирует required схемы на входе, а description поля на генерацию аргументов не влияет. Падал TypeError «Cannot read properties of undefined (reading 'toLowerCase')» в getTask ДО проверки «задача не найдена» — модель получала бессмысленный текст и повторяла упавший вызов до исчерпания wall-time фазы. Обязательность comment была защищена VL-253 (авто-отчёт), обязательность id — нет; та же уязвимость (args.id as string без проверки) была в toolAddComment/toolViewTask/toolUpdateDependencies и других.

## Решение
Центральный guard в handleToolCall ДО диспетчеризации: по required-схеме инструмента из listTools() (единый источник правды) проверять id и нормализовывать его — не-строковый/пустой → контролируемая ошибка, отдаёмая транспортом как isError с текстом «Не передан обязательный аргумент id…» (без вставки конкретного id), без единой записи; целое число 16 и числовая строка "16" → canonical «<task_prefix>-N» по taskPrefix из backlog/config.yml (та же логика, что taskIdPattern). Коммент guard не трогает — контракт VL-253. Домены с контрактом «никогда не бросает» (supervisor, VL-268 AC3) получают нормализацию, но непригодный id валидируют сами. Fail-safe в getTask/findTaskFilePath (не-строковый id → null) — последний рубеж для путей мимо guard (CLI/веб/тесты).

## Пример
lb-gift LB-16 (vb 1.14.0): 24 вызова {aborted, comment, status, phase, tokenUsage} без id подряд падали TypeError. После фикса тот же вызов отвечает isError «Не передан обязательный аргумент id задачи (обязательное поле схемы)», а {id: 16} в проекте с task_prefix: LB применяется к LB-16.