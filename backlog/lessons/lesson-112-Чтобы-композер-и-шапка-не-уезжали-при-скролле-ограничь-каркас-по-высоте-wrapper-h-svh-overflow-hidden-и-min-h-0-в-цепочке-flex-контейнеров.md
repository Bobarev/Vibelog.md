---
id: lesson-112
title: 'Чтобы композер и шапка не уезжали при скролле, ограничь каркас по высоте: wrapper h-svh overflow-hidden и min-h-0 в цепочке flex-контейнеров'
status: active
tags:
  - web
  - layout
  - css
  - tailwind
  - chat
source_tasks:
  - VL-263
linked_tasks:
  - VL-263
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Хедер приложения и композер чата «уезжали» при прокрутке, а внутренний viewport (`min-h-0 flex-1 overflow-y-auto`) не скроллился вообще: скроллился `body`. Причина — каркас не ограничен по высоте: `SidebarProvider` был `flex min-h-svh` (не `h-svh`), `SidebarInset` — без height, `main` — `flex-1 overflow-y-auto`, поэтому `h-full` у страницы схлопывался по контенту и документ рос вместе с ним.

## Решение

Ограничь высоту на каждом уровне flex-цепочки: wrapper `flex h-svh w-full overflow-hidden`, `SidebarInset h-full min-h-0 flex-col overflow-hidden`, `main min-h-0 min-w-0 flex-1` (на странице с внутренним скроллом — `overflow-hidden`, у обычных списковых — `overflow-y-auto`). Внутренние скролл-контейнеры (viewport сообщений, `nav` сайдбара) обязательно получают `min-h-0 flex-1 overflow-y-auto` — без `min-h-0` flex-элемент не сжимается ниже контента и скролла не будет. Проверяй инвариант `documentElement.scrollHeight === clientHeight` на всех страницах.

## Пример

```tsx
<SidebarProvider className="h-svh min-h-0 overflow-hidden">
  <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
    <AppHeader className="h-12 shrink-0" />
    <main className="min-h-0 min-w-0 flex-1 overflow-hidden">   {/* чат */}
```
