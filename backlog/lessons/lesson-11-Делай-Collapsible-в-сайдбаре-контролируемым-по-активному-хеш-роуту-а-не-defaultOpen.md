---
id: lesson-11
title: 'Делай Collapsible в сайдбаре контролируемым по активному хеш-роуту, а не defaultOpen'
status: active
tags:
  - web
  - sidebar
  - react
  - hash-routing
  - shadcn
source_tasks:
  - VL-165
linked_tasks:
  - VL-165
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

В сайдбаре с вложенными пунктами (Collapsible + SidebarMenuSub) `defaultOpen` вычисляется только при монтировании: при переходе по хеш-роуту (#/ → #/config) подменю, привязанное к активному разделу, не раскрывается.

## Решение

Делай Collapsible контролируемым: вычисляй `open` из активного хеш-маршрута (например, `open={route === 'settings' || route === 'config'}` + `onOpenChange`) и/или передавай `key` на Collapsible при смене роута, чтобы компонент перемонтировался.

## Пример

VL-165: nav-main.tsx — NavCollapsibleItem использует контролируемый open из useHashRoute(); активный роут #/config открывает parent-пункт «Настройки».