---
id: lesson-65
title: 'Для долгоживущих команд (bot/browser) проверку обновления выполняй до route, иначе уведомление не покажется никогда'
status: active
tags:
  - update-check
  - cli
  - long-running
  - bot
  - browser
source_tasks:
  - VL-206
linked_tasks:
  - VL-206
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

В VL-101 уведомление о новой версии вызывалось в `.then()` после `route()`, а команды `bot`/`browser` — долгоживущие: route не завершается, уведомление не показывалось никогда. Дополнительно `bot`/`browser` стояли в `SKIP_COMMANDS` — проверка пропускалась даже до сетевого вызова.

## Решение

- Для долгоживущих команд проверку выполняй **await-ом до `route()`** (`shouldNotifyAtStartup(argv)` в bin), для остальных — после, как раньше.
- Не держи долгоживущие команды в `SKIP_COMMANDS` — skip оставляй только для `mcp`/`qwen-debug`, где stdout занят протоколом.
- Момент вызова выноси в отдельную экспортную функцию с юнит-тестами, а не размазывай по bin.

## Пример

VL-206: `bin/vibelog.mjs` — `const notifyFirst = shouldNotifyAtStartup(argv)`; если true → `await maybeNotifyUpdate(argv)` до `route()`, пост-route вызов пропускается; `STARTUP_NOTIFY_COMMANDS = ['bot', 'browser']`.