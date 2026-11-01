---
id: lesson-52
title: Выноси зависший файл тестов в отдельный запуск — но сетевой reference.test больше не висит (фикс VL-225)
status: outdated
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
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Общий прогон `pnpm test` (vitest run) зависал на сетевом `src/core/reference.test` — git clone зависал до 120 с на офлайн-DNS (type=repo фикстуры с внешними `https://` URL в общем testRoot), общий прогон не завершался в разумное время (инцидент agent-1793292869113).

## Почему урок устарел

**Причина исчезла, вместе с ней и повод выносить файл в отдельный запуск.**

- VL-225 перевёл фикстуры type=repo на `file:///nonexistent/*.invalid.git` и добавил в `cloneReferenceRepo` жёсткий `spawnSync` с `timeout: 15_000` — сетевого clone в тестах больше нет, файл проходит за ~0.8 с.
- `package.json` в скрипте `test` делит **только** `src/web/static.test.mjs` (он поднимает сервер на том же процессе), `src/core/reference.test.mjs` идёт в общем пакете.

## Что осталось верным (общее правило)

Если общий прогон vitest зависает на конкретном файле, сначала прогони этот файл отдельно, а остальные — пакетом без него, и зафиксируй оба результата в отчёте. Это правило не про `reference.test` конкретно, а про любой файл с внешним ресурсом.

## Пример

VL-195: «прогон общим пакетом дважды висел на сетевом reference.test — прогнан отдельно: 22 passed ✓». VL-225 (после фикса): одиночный прогон офлайн — 22 passed, ~0,8 с (было ~120 с).
