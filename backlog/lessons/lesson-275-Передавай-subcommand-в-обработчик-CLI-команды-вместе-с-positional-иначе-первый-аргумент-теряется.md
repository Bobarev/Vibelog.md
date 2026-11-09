---
id: lesson-275
title: Передавай subcommand в обработчик CLI-команды вместе с positional — иначе первый аргумент теряется
status: active
tags:
  - cli
  - router
  - tests
source_tasks:
  - VL-396
linked_tasks:
  - VL-396
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
В `src/cli/router.ts` ветка команды передавала в обработчик только `positional`, но парсер кладёт первый позиционный аргумент в `subcommand` — тема `vibelog instructions workflow` не доходила до команды, и всегда печатался `overview`. Тесты этого не ловили: они вызывали `runInstructions` напрямую, минуя роутер.

## Решение
Передавай в обработчик `[subcommand, ...positional].filter(Boolean)` (как у `map`/`capabilities`) и добавляй хотя бы один спавн-тест через `bin/vibelog.mjs`, проверяющий, что позиционный аргумент реально доходит до команды: прямой вызов функции дефект парсинга не видит.

## Пример
`case 'instructions': return runInstructions([subcommand, ...positional].filter(Boolean), flags, cwd)` — как у `map` и `capabilities`. Проверка: `node bin/vibelog.mjs instructions workflow` печатает тему workflow, а не overview.