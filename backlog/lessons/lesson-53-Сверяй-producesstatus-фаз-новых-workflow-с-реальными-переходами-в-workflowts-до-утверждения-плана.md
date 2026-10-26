---
id: lesson-53
title: Сверяй produces_status фаз новых workflow с реальными переходами в workflow.ts до утверждения плана
status: active
tags:
  - workflow
  - plan
  - statuses
source_tasks:
  - VL-195
linked_tasks:
  - VL-195
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема
В плане VL-195 был заложен переход `To Do → [investigate] → In Progress`, но в DEFAULT_WORKFLOW (workflow.ts) ни одна фаза default не производит In Progress — там есть только переходы ИЗ In Progress. Нарушение обнаружено на ревью.

## Решение
Планируя новый workflow, сверяй `produces_status` каждой фазы с фактическими переходами в `src/core/workflow.ts`: фаза может производить только статус, из которого есть продолжение, и не производи In Progress, если это не предусмотрено canMoveTo/переходами. Transient-статус во время фазы — отдельная задача, не пихай в базовый workflow.

## Пример
VL-195: investigate → Review (а не In Progress); transient In Progress вынесен в VL-196.