---
id: lesson-280
title: 'Подсветку подпункта сайдбара на детальной странице задавай полем activeWhen, а не совпадением url'
status: active
tags:
  - web
  - sidebar
  - hash-routing
source_tasks:
  - VL-403
linked_tasks:
  - VL-403
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Подпункт сайдбара с `url: 'personas'` подсвечивается только при точном совпадении route, поэтому на детальной странице `#/persona/<id>` (другой route) пункт гаснет — пользователь теряет ориентацию, хотя находится внутри того же раздела.

## Решение
Добавляй в `NavSubItem` поле `activeWhen: string[]` (список route, при которых пункт активен) и проверяй `activeWhen.includes(route)` в `nav-main.tsx`; для раздела «список + детальная» указывай оба route (`["personas","persona"]`).

## Пример
VL-403: пункт «Персоны» (`url: 'personas'`) не подсвечивался на `#/persona/helper`, пока в `NavSubItem` не добавили `activeWhen: ["personas","persona"]` и проверку `activeWhen.includes(route)` в `nav-main.tsx`.