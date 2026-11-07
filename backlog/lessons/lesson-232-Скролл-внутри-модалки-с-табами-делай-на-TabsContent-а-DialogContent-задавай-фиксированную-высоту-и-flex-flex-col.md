---
id: lesson-232
title: 'Скролл внутри модалки с табами делай на TabsContent, а DialogContent задавай фиксированную высоту и flex flex-col'
status: active
tags:
  - web
  - ui
  - css
  - tabs
  - dialog
  - scroll
source_tasks:
  - VL-346
linked_tasks:
  - VL-346
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: 2026-11-07
verified_by: agent
applies_to: []
kind: rule
---
## Проблема

В модалке задачи (VL-346) при 7–8 вкладках переключатель ломался на 2–3 строки, а поле «Комментарий» и кнопки фаз уезжали вниз и визуально перекрывались длинной секцией. Две независимые причины: (1) `TabsList` с `h-auto flex-wrap` поверх пилюли `bg-muted h-8 p-[3px]` — многострочная пилюля с `rounded-lg` и разной высотой строк; (2) `DialogContent` был `grid` с `max-h-… overflow-y-auto`, то есть скроллился весь диалог, а `TabsContent` с `min-h-0 flex-1 overflow-y-auto` внутри контейнера без заданной высоты скролл-области не создавал — контент растягивал родителя.

## Решение

Скролл-контейнер — ровно один, и это `TabsContent`. Чтобы `flex-1` реально работал, у `DialogContent` должна быть **фиксированная** высота (`h-[calc(100%-2rem)]`, не только `max-h-`) плюс `flex flex-col overflow-hidden`; `Tabs` — `flex min-h-0 flex-1 flex-col gap-0`; всё, что должно оставаться на месте (заголовок, поле комментария, `DialogFooter`), — `shrink-0`. Вкладки не переносятся: `TabsList` с `variant="line"` оборачивается в контейнер `overflow-x-auto` + `w-max min-w-full` + `*:data-[slot=tabs-trigger]:flex-none` и `border-y` — одна строка с горизонтальным скроллом на узком экране. Двойной скролл (обёртка + `TabsContent`) недопустим: либо скролл на `TabsContent`, либо на обёртке, но не на обоих.

## Пример

```tsx
<DialogContent className="flex h-[calc(100%-2rem)] max-h-[calc(100%-2rem)] flex-col gap-4 overflow-hidden sm:max-w-2xl">
  <DialogHeader className="shrink-0">…</DialogHeader>
  <Tabs defaultValue="description" className="flex min-h-0 flex-1 flex-col gap-0">
    <div className="shrink-0 touch-pan-x overflow-x-auto overscroll-x-contain border-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <TabsList variant="line" className="w-max min-w-full justify-start gap-4 px-1 *:data-[slot=tabs-trigger]:flex-none">
        …
      </TabsList>
    </div>
    <TabsContent value="description" className="min-h-0 flex-1 overflow-y-auto pt-3">…</TabsContent>
  </Tabs>
  <div className="shrink-0">поле комментария</div>
</DialogContent>
```

Проверка: открыть задачу с максимумом секций, переключить все вкладки, сузить окно до 375 px — вкладки скроллятся, поле ввода и кнопки на месте.
