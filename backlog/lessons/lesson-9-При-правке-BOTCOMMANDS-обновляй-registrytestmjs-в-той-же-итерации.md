---
id: lesson-9
title: При правке BOT_COMMANDS обновляй registry.test.mjs в той же итерации
status: active
tags:
  - bot
  - telegram
  - tests
  - registry
source_tasks:
  - VL-150
linked_tasks:
  - VL-150
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

В VL-150 `registry.test.mjs` фиксировал длину реестра (20) и точную строку `commandsHelp()` — добавление команды в `BOT_COMMANDS` ломает `pnpm test`, если тесты не обновлены.

## Решение

При изменении реестра команд бота в той же итерации правь `src/bot/registry.test.mjs`: счётчик длины массива и точные строки help-вывода.

## Пример

Добавление записи `help` в `BOT_COMMANDS` сопровождалось правкой 20→21 и обновлением ожидаемой строки `commandsHelp()` — тесты прошли с первого прогона после правки.
