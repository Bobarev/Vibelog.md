---
id: lesson-14
title: При добавлении хедера в layout заменяй calc-высоты виджетов на h-full и делай main flex-1 overflow-y-auto
status: active
tags:
  - web
  - layout
  - header
  - высота
  - kanban
source_tasks:
  - VL-166
linked_tasks:
  - VL-166
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

В VL-166 в layout добавили фиксированную шапку `AppHeader` (h-12) над `<main>`. Канбан использовал `h-[calc(100dvh-2rem)]` — с учётом хедера контент вылезал за экран (регрессия высоты).

## Решение

При добавлении фиксированного хедера в layout:
1. Заменяй calc-высоты дочерних виджетов (`h-[calc(100dvh-Nrem)]`) на `h-full`.
2. Делай `<main>` scroll-контейнером: `className="min-h-0 flex-1 overflow-y-auto"` внутри `SidebarInset` (flex-col), хедер всегда виден, скроллится только контент.

## Пример

```tsx
// App.tsx
<SidebarInset>
  <AppHeader />                                    {/* h-12 shrink-0 */}
  <main className="min-h-0 flex-1 overflow-y-auto p-2">
    <Kanban />                                     {/* kanban: h-full вместо calc */}
  </main>
</SidebarInset>
```