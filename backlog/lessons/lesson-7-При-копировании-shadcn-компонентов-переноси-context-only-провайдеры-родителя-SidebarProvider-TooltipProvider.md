---
id: lesson-7
title: При копировании shadcn-компонентов переноси context-only провайдеры родителя (SidebarProvider → TooltipProvider)
status: active
tags:
  - web
  - shadcn
  - radix
  - regression
  - sidebar
source_tasks:
  - VL-160
linked_tasks:
  - VL-160
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

При копировании shadcn-компонентов в VL-156 из sidebar.tsx был потерян wrap дерева в `<TooltipProvider>` внутри `SidebarProvider`. Radix Tooltip без Provider кидает исключение «Tooltip must be used within TooltipProvider» при первом рендере — белый экран всего приложения (VL-160).

## Решение

Копируя shadcn-компонент, переноси ВСЕ context-only провайдеры родительского компонента (без DOM-узла — легко не заметить глазами): у shadcn `SidebarProvider` обязателен `<TooltipProvider delayDuration={0}>` вокруг `div[data-slot=sidebar-wrapper]`. Быстрая проверка без браузера — `renderToStaticMarkup(<App/>)`: radix «must be used within Provider» кидает исключение именно при рендере.
