---
id: lesson-289
title: 'Не клади идентификаторы в callback_data кнопок Telegram — лимит 64 байта, контекст держи в module-state'
status: active
tags:
  - bot
  - telegram
  - callbacks
  - trap
source_tasks:
  - VL-414
linked_tasks:
  - VL-414
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
В `callback_data` inline-кнопки Telegram нельзя класть произвольные идентификаторы: лимит 64 байта, а `toolCallId` модели плюс `optionId` легко его превышают — кнопка молча не создаётся или обработчик получает обрезанные данные.

## Решение
В `callback_data` держи только короткое решение или индекс (`chata:allow`, `chatq:2`), а полный контекст (threadId, toolCallId, список вариантов) храни в module-state по `chatId` и доставай его в обработчике. Состояние теряется при рестарте процесса — это принимается и документируется, а не чинится.

## Пример
VL-414: кнопки пауз хода веб-чата в боте — `chata:allow|deny|always` и `chatq:<индекс варианта>`; `toolCallId` и `optionId` в `callback_data` не попадают, они берутся из module-state `chatPauses` по `chatId`.