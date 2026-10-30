---
id: lesson-108
title: 'Бери время старта рана из env спавна, а не из меты сессии — иначе все resume-раны журнала имеют один startedAt'
status: active
tags:
  - billing
  - session-meta
  - учёт
  - resume
source_tasks:
  - VL-259
linked_tasks:
  - VL-259
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

В журнале `.vibelog/billing/<ID>.json` у всех resume-ранов одной сессии был одинаковый `startedAt` (журнал VL-235: 4 записи с `2026-10-30T03:30:47.654Z` и разными `finishedAt`), а в мете сессии была видна только фаза её создания — по этим данным нельзя было восстановить число ранов, их фазы и реальное начало.

Причина: `startedAt` записи брался из меты (`existing?.startedAt` / `metaNow?.startedAt`), а это время СОЗДАНИЯ сессии — при resume оно не меняется. Аналогично фаза для `by_phase` бралась из `meta.phase` (фаза сессии), поэтому Code-раны в план-сессии схлопывались в ключ `plan`.

## Решение

1. Время старта рана передавай из точки спавна в env: `spawnQwenRun` кладёт `VIBELOG_RUN_STARTED_AT` (и `VIBELOG_RUN_PHASE` — фаза рана) в `spawnEnv` рядом с `VIBELOG_PHASE_TASK_ID/NAME`; эти переменные наследуют и CLI агента, и его MCP-сервер. CLI/оркестратор пишут в billing `startedAt` из env, а `startedAtKind: 'run'` помечает происхождение (у старых записей поля нет → `startedAt` ненадёжен, начало восстанавливается как `finishedAt − durationMs`).
2. Агрегат `by_phase` и `billing.phase` считай по фазе РАНА; фазу сессии оставляй только в `sessionPhase`.
3. Историю ранов держи отдельным массивом `meta.runs[]` (+ `lastRunPhase`, кап 50 записей), а не переприсваиванием `meta.phase`: `phase` — фаза создания сессии, по ней `findTaskPhaseSessionSync` находит план-сессию для `code_same_session`/retry (lesson-40).

## Пример

```ts
// оркестратор: время старта рана уходит в env спавна
const runStartedAt = new Date().toISOString();
spawnEnv = { ...baseEnv(), VIBELOG_RUN_PHASE: runPhase, VIBELOG_RUN_STARTED_AT: runStartedAt };

// CLI post-run
const runStartedAt = process.env.VIBELOG_RUN_STARTED_AT ?? new Date().toISOString();
appendBilling(taskCwd, taskId, { sessionId, phase: runPhase, startedAt: runStartedAt, startedAtKind: 'run', ... });
appendSessionRun(sessionsDir, sessionId, { sessionId, phase: runPhase, startedAt: runStartedAt, finishedAt, usage });
```

Инвариант-тест: 3 рана (plan → code → code) → `meta.runs.length === 3`, три разных `startedAt`, ни один не равен `meta.startedAt`, `by_phase` содержит и план, и код.
