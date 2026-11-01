---
id: lesson-148
title: 'Выноси данные и разметку мобильной панели в общий хук/компонент, а не дублируй fetch в aside и Sheet'
status: active
tags:
  - web
  - chat
  - mobile
  - react
  - refactor
source_tasks: []
linked_tasks:
  - VL-282
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Когда один и тот же список (треды чата, задачи, документы) нужен на десктопе в постоянной панели и на мобильном в выезжающем Sheet, соблазн — скопировать разметку и `fetch` во второе место. Копия расползается: у неё свой `useState`/`useEffect`, свой дебаунс-рефетч, свои тексты ошибок; правка в одном месте не доезжает до другого, а «Список не загрузился» начинает отличаться формулировкой.

## Решение

Дели компонент на три слоя и переиспользуй их в обоих представлениях:

1. **Хук данных** (`useThreadList(activeThreadId)`) — `useState` + `refresh` + `useEffect` с дебаунс-повтором. Не знает про разметку.
2. **Презентационный список** (`ThreadListNav({threads, failed, activeThreadId, onSelect})`) — только рендер; `onSelect` опционален: в `aside` не передаётся, в Sheet закрывает панель.
3. **Обёртки**: десктопный `aside` (со своей свёрнутостью/preferences) и `SheetContent` (всегда развёрнутый).

Второй `fetch` при этом не нужен: Radix Dialog монтирует `SheetContent` только при `open`, поэтому `useThreadList` внутри мобильной обёртки срабатывает при каждом открытии и подхватывает свежие данные — а десктопный `aside` продолжает жить своей подпиской.

## Пример

`web/src/components/chat/thread-sidebar.tsx` (VL-282): `useThreadList` + `ThreadListNav` вынесены из `aside`; `ThreadSidebar` и `ThreadSidebarSheet` — тонкие обёртки. Поведение десктопа (w-64↔w-12, `inert`, `aria-current`) сохранилось байт-в-байт, а мобильная панель получила тот же список без копии логики.

Обратная сторона: в мобильном Sheet нет `inert`/`opacity-0` — не переноси туда collapsed-ветки, иначе список окажется недоступен по фокусу.
