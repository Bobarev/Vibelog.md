---
id: lesson-72
title: 'Фиксируй ширину шапки через min-w-0/overflow-x-clip на SidebarInset в layout, а не в ui/sidebar.tsx'
status: active
tags:
  - layout
  - sidebar
  - overflow
  - ref-2
  - web
source_tasks: []
linked_tasks:
  - VL-211
created_date: 2026-10-29
updated_date: 2026-10-29
supersedes: ''
---
## Проблема

Канбан-грид с `repeat(N, minmax(20rem, 1fr))` формирует min-content ширину, которая пробрасывается вверх через flex-цепочку: `SidebarInset` (flex-item с `min-width: auto`) не сжимается ниже min-content → `AppHeader` растягивается → кнопки шапки уходят за вьюпорт, документ скроллится по горизонтали.

## Решение

В точке layout (не в shadcn `ui/sidebar.tsx`, чтобы копия осталась близкой к канону) ставь `min-w-0 overflow-x-clip` на `SidebarInset` и `min-w-0 overflow-x-hidden` на контент-обёртку `<main>` — как в ref-2 `dashboard/layout.tsx`. Тогда шапка всегда по ширине вьюпорта и не зависит от числа колонок.

## Пример

```tsx
<SidebarInset className="min-w-0 overflow-x-clip">
  <main className="min-w-0 overflow-x-hidden overflow-y-auto p-2">
```

Проверка: `document.documentElement.scrollWidth === document.documentElement.clientWidth` при 8 колонках.