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
---
## Проблема

`PhaseRun` в оркестраторе живёт в памяти (`activeRuns`); после рестарта процесса узнать, идёт ли фаза, нечем. Также нельзя верить одному pid — ОС переиспользует номера, «фаза-зомби» будет считаться живой.

## Решение

При запуске фазы генерируй собственный идентификатор раня (`run-<taskId>-<phase>-<attempt>`) и пиши его в `state.json` вместе с `pid` и `startedAt`. Живость = `status === 'running'` И совпадение `phaseRunId` И `process.kill(pid, 0)` без исключения ESRCH (EPERM — процесс чужой, но живой). Мёртвый pid: сверяй статус задачи с ожидаемым `getStatusAfterPhase(...)` — сменился → фаза успешна (`done`), иначе `failed` + `lastError` и в лечение. Добавь возраст фазы: старше wall-time лимита — принудительно failed.

## Пример (VL-270)

`src/web/supervisor-state.ts`: `isPidAlive`, `phaseAlive`. Тест: `isPidAlive(process.pid) === true`, заведомо свободный pid → false, несовпадение `phaseRunId` → false.