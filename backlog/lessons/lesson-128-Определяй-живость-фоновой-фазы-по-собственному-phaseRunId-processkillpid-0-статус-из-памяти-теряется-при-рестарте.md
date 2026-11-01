---
id: lesson-128
title: 'Определяй живость фоновой фазы по собственному phaseRunId + process.kill(pid, 0) — статус из памяти теряется при рестарте'
status: active
tags:
  - supervisor
  - pid
  - restart
  - state
  - фоновые-процессы
source_tasks:
  - VL-270
linked_tasks:
  - VL-270
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
last_verified: 2026-11-01
verified_by: agent
applies_to: []
kind:
---
## Проблема

`PhaseRun` в оркестраторе живёт в памяти (`activeRuns`); после рестарта процесса узнать, идёт ли фаза, нечем. Также нельзя верить одному pid — ОС переиспользует номера, «фаза-зомби» будет считаться живой.

## Решение

При запуске фазы генерируй собственный идентификатор раня (`run-<taskId>-<phase>-<attempt>`) и пиши его в `state.json` вместе с `pid` и `startedAt`. Живость = `status === 'running'` И совпадение `phaseRunId` И `process.kill(pid, 0)` без исключения ESRCH (EPERM — процесс чужой, но живой). Мёртвый pid: сверяй статус задачи с ожидаемым `getStatusAfterPhase(...)` — сменился → фаза успешна (`done`), иначе `failed` + `lastError` и в лечение. Добавь возраст фазы: старше wall-time лимита — принудительно failed.

## Пример (VL-270)

`src/core/supervisor-state.ts`: `isPidAlive`, `phaseAlive`. Тест: `isPidAlive(process.pid) === true`, заведомо свободный pid → false, несовпадение `phaseRunId` → false.

> Путь уточнён при санитарном проходе (VL-281): модуль лежит в `src/core/`, а не в `src/web/` — аудит показывал его как `missing_path`.
