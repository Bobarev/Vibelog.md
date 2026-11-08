---
id: lesson-253
title: 'При разрешении конфликта в тест-таблице-реестре выбирай формат, который читает код ниже в файле, а не «свою» версию ветки'
status: active
tags:
  - git
  - merge
  - tests
  - close
source_tasks: []
linked_tasks:
  - VL-369
created_date: 2026-11-08
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Merge ветки задачи в master упал на конфликте в `src/mcp/tool-outcome-trace.test.mjs` — таблице-реестре `TRACE`, где обе стороны переписали одну и ту же структуру: master держал короткий формат `'VL-303': ['P1']` (ID → массив свойств P1..P5), ветка — расширенный `'VL-303': [['src/mcp/write-ack.test.mjs', 'AC1: …']]` (ID → пары «файл, имя теста»). Выбор «своей» версии наугад ломает тест: ниже в том же файле код обходит `Object.values(TRACE).flat()` и проверяет `id in PROPERTIES`, то есть ожидает именно массив строк-свойств.

## Решение

При разрешении конфликта в тест-таблице-реестре не выбирай версию по принципу «наша/их» — прочитай код-потребитель ниже в файле (обход таблицы, `assert`-ы, счётчик `Object.keys(TRACE).length`) и оставь формат, который этот код принимает. Второй сигнал — соседние задачи: если master-версия согласована с `PROPERTIES`/`PARTIAL_SCENARIOS` в других файлах, расширенный формат ветки потребовал бы править и их.

## Пример

VL-369: конфликт `TRACE` разрешён в формате HEAD (`'VL-303': ['P1']`), потому что строки 78-93 того же файла делают `for (const [task, ids] of Object.entries(TRACE))` и `new Set(Object.values(TRACE).flat())` — пары `[файл, тест]` дали бы `unknown` для каждого элемента. Проверка: `npx vitest run src/mcp/tool-outcome-trace.test.mjs` — 4 теста зелёные.