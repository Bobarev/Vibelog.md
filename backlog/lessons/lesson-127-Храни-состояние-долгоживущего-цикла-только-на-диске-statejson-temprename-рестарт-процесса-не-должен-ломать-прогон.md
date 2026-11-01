---
id: lesson-127
title: 'Храни состояние долгоживущего цикла только на диске (state.json, temp+rename) — рестарт процесса не должен ломать прогон'
status: active
tags:
  - supervisor
  - state
  - restart
  - atomic-write
  - web
source_tasks:
  - VL-270
linked_tasks:
  - VL-270
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Тик-цикл супервизора живёт в процессе `vibelog browser`, который может быть перезапущен посреди прогона. Если состояние (какие фазы идут, какие упали, номера попыток) держать в памяти (`activeRuns` оркестратора), после рестарта оно теряется: зависшая фаза выглядит вечно идущей, лечение не запускается.

## Решение

Всё состояние прогона — в файлах `.vibelog/supervisor/state.json` (машинное) и `heartbeat.md` (человекочитаемое). Каждый тик: прочитать state → собрать наблюдения из файлов/меты сессий → записать state атомарно (запись во временный файл в том же каталоге + `renameSync`) → записать heartbeat. В памяти — только guard-флаг против наложения тиков.

## Пример (VL-270)

`src/core/supervisor-state.ts`: `loadState`/`saveState`/`updateState`; `snapshotKey` по файловому состоянию — сравнение с `state.snapshotHash` даёт wake gate без обращения к LLM. Тест: `state.json` всегда валидный JSON, `.tmp` после записи нет.