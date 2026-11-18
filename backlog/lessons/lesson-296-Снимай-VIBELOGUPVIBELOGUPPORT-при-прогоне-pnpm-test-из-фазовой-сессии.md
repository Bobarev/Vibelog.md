---
id: lesson-296
title: Снимай VIBELOG_UP/VIBELOG_UP_PORT при прогоне pnpm test из фазовой сессии
status: active
tags:
  - tests
  - env
  - spawn
source_tasks:
  - VL-428
linked_tasks:
  - VL-428
created_date: 2026-11-18
updated_date: 2026-11-18
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind: workaround
---
## Проблема
Полный pnpm test, запущенный из фазовой сессии оркестратора, падает в тестах спавна: testSpawnEnv наследует process.env и не снимает маркеры VIBELOG_UP=1 и VIBELOG_UP_PORT (в src/test-env.mjs их нет), child-процессы CLI подхватывают их и ведут себя иначе (падает restart.test и соседние спавн-тесты).

## Решение
Прогоняй полный тест из сессии фазы командой `env -u VIBELOG_UP -u VIBELOG_UP_PORT pnpm test`; постоянное решение — дописать VIBELOG_UP и VIBELOG_UP_PORT в stripVibelogEnv/testSpawnEnv в src/test-env.mjs, тогда обход снимется сам.

## Пример
VL-428 (Close): env сессии оркестратора содержал VIBELOG_UP=1/VIBELOG_UP_PORT=6420 — тесты спавна (restart.test) падали на унаследованных маркерах; прогон pnpm test из фазовой сессии шёл через `env -u VIBELOG_UP -u VIBELOG_UP_PORT pnpm test`.