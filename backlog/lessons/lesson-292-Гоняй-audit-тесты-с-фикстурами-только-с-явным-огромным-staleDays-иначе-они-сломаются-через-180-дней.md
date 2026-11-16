---
id: lesson-292
title: 'Гоняй audit-тесты с фикстурами только с явным огромным staleDays, иначе они сломаются через 180 дней'
status: active
tags:
  - tests
  - date-bomb
  - lesson-audit
  - payload-cap
source_tasks:
  - VL-421
linked_tasks:
  - VL-421
created_date: 2026-11-16
updated_date: 2026-11-16
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Тест аудита с фикстурами-уроками, у которых дата updated_date задана как конкретный день, падает через ~180 дней: фикстуры достигают порога staleDays, находки протухания раздувают JSON-ответ MCP за кап 20 КБ и поля (byLesson) выпадают из ответа.

## Решение
В тестах, читающих реальные/фикстурные уроки через audit, всегда передавай явный огромный staleDays (например 1000000), чтобы порог протухания не зависел от сегодняшней даты; read-only-инварианты при этом сохраняй.

## Пример
VL-421 (Code): уроки-фикстуры с updated_date=2026-05-20 2026-11-16 достигли порога 180 дней — находки раздули JSON за кап 20 КБ, byLesson выпал из ответа; фикс — явный staleDays: 1000000 в src/core/lesson-audit.test.mjs