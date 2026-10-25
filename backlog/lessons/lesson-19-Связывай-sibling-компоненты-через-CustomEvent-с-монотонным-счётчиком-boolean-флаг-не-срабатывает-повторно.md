---
id: lesson-19
title: Связывай sibling-компоненты через CustomEvent с монотонным счётчиком — boolean-флаг не срабатывает повторно
status: active
tags:
  - web
  - react
  - events
  - quick-create
  - kanban
source_tasks:
  - VL-163
linked_tasks:
  - VL-163
  - VL-172
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

Quick Create в шапке сайдбара и Kanban — соседние компоненты без общего родителя с state. Boolean-флаг («открыть модалку») не срабатывает повторно: второй клик при уже `true` не вызывает эффект подписки.

## Решение

Связывай их через `CustomEvent` с монотонным счётчиком команд (`web/src/lib/quick-create.ts`): каждое событие несёт новое число, подписчик (`Kanban.tsx`) реагирует на каждое, а не на смену boolean. Паттерн «subscribes to external store» — без setState-in-effect, реактивный линтер чист.

## Пример

```ts
// отправитель: window.dispatchEvent(new CustomEvent('vibelog:quick-create', { detail: ++counter }))
// получатель: useEffect(...addEventListener..., []) — один раз, реакция по detail
```