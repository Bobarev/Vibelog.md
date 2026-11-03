---
id: lesson-186
title: 'Пробрасывай сырой argv в делегирующую подкоманду, а не собирай флаги обратно из разобранного объекта'
status: active
tags:
  - cli
  - argv
  - делегирование
  - парсер
source_tasks: []
linked_tasks:
  - VL-305
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`vibelog` разбирает argv своим парсером (`src/cli/args.ts`) и передаёт в `runAgent(subcommand, positional, flags, cwd)`. Когда подкоманда должна делегировать запуск другому CLI (агентскому `dist/agent/cli.js`), сборка аргументов обратно из `flags` теряет данные: повторяющиеся флаги схлопываются, порядок меняется, значения с пробелами рвутся.

## Решение

Передавай в делегирующую функцию **сырой массив argv** additive-параметром (`runAgent(subcommand, positional, flags, cwd, args)`); в ней вырежь хвост после имени подкоманды и отдай его целево��у `main()` как есть. Парсер `vibelog` тогда вообще не интерпретирует флаги фазы.

## Пример

`vibelog agent run plan VL-111 --model "routerai/x" --comment "текст с пробелами"` — в `main()` уходит `['plan', 'VL-111', '--model', 'routerai/x', '--comment', 'текст с пробелами']`; агентский `parseArgs` видит ровно то, что набрал пользователь.

Дополнительно: делегирующий модуль подключай динамическим `import()`, чтобы тяжёлый стек (grammy/bot для чата, агентский клиент для `run`) не грузился в путях, которым он не нужен.
