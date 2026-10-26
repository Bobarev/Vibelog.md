---
id: lesson-57
title: 'Тестовые швы-override в модулях сбрасывай в finally — при isolate:false шов утекает в другие файлы воркера'
status: active
tags:
  - tests
  - seam
  - vitest
  - isolate
  - auto-runner
source_tasks:
  - VL-200
linked_tasks:
  - VL-200
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема
Тестовый шов (переменная-override типа `startPhaseImpl` + `setStartPhaseForTests`) в модуле, который переиспользуется воркером Vitest (`isolate: false`, VL-139), утекает в другие файлы тестов того же воркера — следующий файл получает подменённую функцию и падает необъяснимо.

## Решение
В каждом тесте, подменяющем шов, обнуляй его в `finally` (`setStartPhaseForTests(null)`) вместе с остановкой поллеров (`stopAutoPoll()`). Шов возвращай в оригинал при передаче `null`. То же для env-швов (`setSpawnEnvBaseForTests(null)`).

## Пример
VL-200: seam-тест auto-runner.test.mjs — `try { ... } finally { setStartPhaseForTests(null); stopAutoPoll(); }`; env-шов интеграционного теста сбрасывается тем же finally.