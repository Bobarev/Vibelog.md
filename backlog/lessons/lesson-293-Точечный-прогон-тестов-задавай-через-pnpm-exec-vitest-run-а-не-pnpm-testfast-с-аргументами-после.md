---
id: lesson-293
title: 'Точечный прогон тестов задавай через pnpm exec vitest run, а не pnpm test:fast с аргументами после --'
status: active
tags:
  - tests
  - vitest
  - cli
  - close
source_tasks:
  - VL-422
linked_tasks:
  - VL-422
created_date: 2026-11-17
updated_date: 2026-11-17
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Точечный прогон вида `pnpm test:fast -- <файлы>` молча запускает ВЕСЬ набор тестов: аргументы после `--` не доходят до vitest как фильтр, в выводе «230 passed (230)» без единого предупреждения, и точечная проверка в фазе тратит ~170 с, оставляя ложное впечатление узкого фильтра.

## Решение
Для узкого прогона по именам файлов вызывай `pnpm exec vitest run <файлы...>` — аргументы доходят до vitest и фильтр применяется (подтверждается счётчиком «N passed» равным числу переданных файлов); `pnpm test:fast` используй только когда нужен полный прогон без сборки.

## Пример
В Close VL-422 команда `pnpm test:fast -- src/web/chat-mcp.test.mjs src/web/tool-policy.test.mjs src/web/chat-commands.test.mjs` выполнила все 230 файлов за 169.9s; `pnpm exec vitest run src/bot/pin.test.mjs` выполнила ровно 1 файл за 214ms.