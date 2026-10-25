---
id: lesson-8
title: 'Собирай help-строки, меню и справку бота из единого реестра BOT_COMMANDS'
status: active
tags:
  - bot
  - telegram
  - registry
  - help
source_tasks:
  - VL-150
linked_tasks:
  - VL-150
  - VL-169
created_date: 2026-10-15
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

В VL-150 при добавлении /help в Telegram-боте help-строки, меню и справка собирались из разных мест; исторически (VL-54) списки команд расходились.

## Решение

Все представления команд бота (меню setMyCommands, help-строка /start, текст /help) собирай из единого реестра `BOT_COMMANDS` в `src/bot/registry.ts`; новые поля (например `examples`) добавляй в интерфейс реестра, а не хардкоди в обработчиках.

## Пример

`helpText()` в `src/bot/registry.ts` перебирает `BOT_COMMANDS` — новая команда автоматически появляется в /help без правок обработчика.
