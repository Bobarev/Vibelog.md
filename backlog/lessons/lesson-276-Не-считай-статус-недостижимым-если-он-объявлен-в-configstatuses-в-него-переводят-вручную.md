---
id: lesson-276
title: 'Не считай статус недостижимым, если он объявлен в config.statuses — в него переводят вручную'
status: active
tags:
  - workflow
  - validation
  - statuses
  - cli
source_tasks:
  - VL-398
linked_tasks:
  - VL-398
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Валидатор workflow, помечающий статус «недостижимым» по одному признаку «нет перехода, который его производит», даёт ложные предупреждения на штатной конфигурации: статусы вроде `In Progress` объявлены в `backlog/config.yml` и в них переводят вручную, без перехода с produces_status.

## Решение
Считай статус недостижимым только если он не объявлен в `config.statuses` И не является initial_status/produces_status ни одного перехода; статусы из config.statuses — легитимные ручные состояния. Закрепи это тестом, иначе следующий правщик валидатора вернёт ложные предупреждения.

## Пример
В DEFAULT_WORKFLOW статус `In Progress` не встречается ни как initial_status, ни как produces_status ни одного перехода (в него переводят вручную), поэтому проверка «недостижим» ограничена статусами, которых нет в `config.statuses`; иначе `vibelog workflow validate` на дефолтном проекте выдавал бы ложные предупреждения.