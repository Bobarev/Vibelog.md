---
id: lesson-125
title: 'Не анимируй раскрытие Radix Collapsible через h-(--radix-collapsible-content-height): используй grid-rows 0fr↔1fr с forceMount'
status: active
tags:
  - web
  - chat
  - css
  - tailwind
  - radix
  - collapsible
source_tasks:
  - VL-271
linked_tasks:
  - VL-271
created_date: 2026-10-31
updated_date: 2026-10-31
supersedes: ''
---
## Проблема

Панель `CollapsibleContent` была стилизована как
`h-(--radix-collapsible-content-height) overflow-hidden transition-[height]`.
Radix пишет в переменную высоту содержимого **на момент открытия**. Любой рост контента
после этого (раскрытие вложенного `ToolCall` внутри `ToolGroup`, перенос длинного `Result`
по строкам, дорендер) обрезается `overflow-hidden` — панель «разворачивается в невидимую
область под следующее сообщение». Симптом проявлялся и без вложенности.

## Решение

Анимировать `grid-template-rows`, а не высоту:

```tsx
<CollapsibleContent
  forceMount
  className="grid overflow-hidden transition-[grid-template-rows] duration-200
             grid-rows-[1fr] data-[state=closed]:grid-rows-[0fr] motion-reduce:transition-none"
>
  <div className="min-h-0 overflow-hidden">{children}</div>
</CollapsibleContent>
```

- `1fr` при `height: auto` контейнера = max-content → высота всегда по контенту, вложенность
  любой глубины (внешний `1fr` тоже растёт).
- `forceMount` обязателен: Radix `Presence` ждёт `animationend`, а не `transitionend`, и без
  него узел вымонтируется сразу — двусторонняя анимация не проигрывается.
- Побочка `forceMount` — скрытый контент остаётся в a11y-дереве и Tab-порядке; закрывать
  `aria-hidden` + `inert` на внутренней обёртке по `data-state=closed`.
- В Tailwind v4 arbitrary `grid-rows-[0fr]` собирается — проверять `grep -c 0fr dist/assets/*.css`.

## Пример

VL-271: `web/src/components/chat/surfaces.tsx` (`collapsePanel` + компонент `CollapseContent`),
потребители — `web/src/components/chat/tool-call.tsx` (`ToolCall`, `ToolGroup`).
Тест-инвариант: `src/web/chat-collapse.test.mjs` проверяет отсутствие
`radix-collapsible-content-height` и наличие `grid-rows-[0fr]`/`grid-rows-[1fr]`.
