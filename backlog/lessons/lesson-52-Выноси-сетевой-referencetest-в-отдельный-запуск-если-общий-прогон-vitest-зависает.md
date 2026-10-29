---
id: lesson-52
title: 'Выноси сетевой reference.test в отдельный запуск, если общий прогон vitest зависает'
status: active
tags:
  - tests
  - vitest
  - network
source_tasks:
  - VL-195
linked_tasks:
  - VL-195
  - VL-225
created_date: 2026-10-26
updated_date: 2026-10-29
supersedes: ''
---
## Проблема
Общий прогон `pnpm test` (vitest run) зависал на сетевом `src/core/reference.test` — git clone зависал до 120 с на офлайн-DNS (type=repo фикстуры с внешними `https://` URL в общем testRoot), общий прогон не завершался в разумное время (инцидент agent-1793292869113).

## Решение
1. **Источник зависания устранён (VL-225)**: в тестах type=repo фикстуры обязаны использовать `file:///*.invalid` URL (не внешние `https://`), а в `cloneReferenceRepo` — `spawnSync` c `timeout: 15_000` (продуктовая защита от зависания `vibelog reference sync` при офлайн-DNS). Сейчас reference.test мгновенный (~2 с офлайн).
2. Если общий прогон vitest всё же зависает или падает на `reference.test` — прогони остальные тесты общим пакетом, а `reference.test` запусти отдельно (`vitest run src/core/reference.test.mjs`) и зафиксируй результат отдельно.

## Пример
- Отчёт VL-195: «прогон общим пакетом дважды висел на СЕТОВОМ reference.test — прогнан отдельно: 22 passed ✓».
- VL-225: после перевода фикстур на `file:///nonexistent/*.invalid.git` и таймаута 15 с — «одиночный прогон офлайн (HTTPS_PROXY): 22 passed, ~0,8 с (было ~120 с)».