---
id: lesson-286
title: 'Объявляй отписку от подписки через let до вызова subscribe, если колбэк может сработать синхронно'
status: active
tags:
  - bot
  - web-chat
  - async
  - trap
source_tasks:
  - VL-408
linked_tasks:
  - VL-408
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Подписка на прогон веб-чата через `subscribeChatRun(run, since, cb)` дренирует уже накопленный буфер синхронно, поэтому колбэк может сработать ещё до того, как `const unsubscribe = subscribeChatRun(...)` присвоит переменную. Обращение к `unsubscribe` внутри колбэка в этот момент даёт TDZ-ошибку `Cannot access 'unsubscribe' before initialization` — причём только на ветке «прогон уже завершился/уже идёт», то есть нестабильно.

## Решение
Объявляй переменную отписки через `let` до вызова подписки и вызывай её в колбэке опционально (`unsubscribe?.()`), а не через `const` из результата вызова. То же правило — для любой подписки, чей колбэк может быть вызван синхронно в момент регистрации.

## Пример
В `forwardChatMessage` (src/bot/chat-bridge.ts): `let unsubscribe: (() => void) | undefined; unsubscribe = subscribeChatRun(run, 0, cb);` — колбэк, вызванный синхронно, видит `unsubscribe === undefined` и не падает на TDZ; отписка в колбэке вызывается через `unsubscribe?.()`.