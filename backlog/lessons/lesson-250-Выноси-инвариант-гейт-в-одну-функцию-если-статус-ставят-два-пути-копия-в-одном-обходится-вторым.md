---
id: lesson-250
title: 'Выноси инвариант-гейт в одну функцию, если статус ставят два пути — копия в одном обходится вторым'
status: active
tags:
  - workflow
  - phase
  - gate
  - close
  - agent
source_tasks: []
linked_tasks:
  - VL-368
created_date: 2026-11-08
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Инвариант «терминальный статус нельзя ставить при неотмеченных AC/DoD» (VL-309) был реализован локально внутри `writeAutoReportIfMissing` (`src/agent/auto-report.ts`). Статус же ставит ещё один путь — `finalizePhaseStatus` (`src/core/phase-transient.ts`), и он про гейт не знал: при `exitCode === 0 && !is_error && !aborted` безусловно применял `getStatusAfterPhase(...)`. Достаточно было, чтобы авто-отчёт не записался (ран упал, отчёт уже был, служебная фаза) — и задача уходила в `Done` с висящими пунктами. Ни один тест этого не показывал: каждый путь по отдельности был корректен.

## Решение

Проверку вынес в один экспорт `terminalStatusGate(workflow, targetStatus, uncheckedAc, uncheckedDod, prevStatus)` в `src/core/workflow.ts` (модуль без новых зависимостей, чтобы его могли импортировать и `core/`, и `agent/`), и оба пути вызывают её. Текст причины собирается внутри функции — иначе две копии разъезжаются и регресс-тесты одного пути краснеют от правки другого. При блокировке `finalizePhaseStatus` оставляет `prevStatus`, пишет комментарий-причину и возвращает `outcome: 'failed'` (супервизор видит «нет прогресса», а не «ok»).

Правило: если инвариант защищает состояние, а путей записи этого состояния больше одного — гейт живёт в общей функции, а не в вызывающем коде. Проверять надо не «есть ли гейт», а «сколько путей ставят статус».

## Пример

VL-368: `src/core/workflow.ts` → `terminalStatusGate`; `src/agent/auto-report.ts` и `src/core/phase-transient.ts` вызывают её. Тест `src/core/phase-transient.test.mjs` (VL-912): close с неотмеченным DoD → статус остался `Review`, в комментариях «Статус не изменён» и `#1`, `outcome === 'failed'`; VL-913 (все отмечены) → `Done`/`ok`. `auto-report.test.mjs` остался зелёным байт-в-байт — признак того, что текст действительно один.