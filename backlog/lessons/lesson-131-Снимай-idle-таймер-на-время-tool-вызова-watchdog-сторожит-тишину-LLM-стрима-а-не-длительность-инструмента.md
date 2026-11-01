---
id: lesson-131
title: 'Снимай idle-таймер на время tool-вызова: watchdog сторожит тишину LLM-стрима, а не длительность инструмента'
status: active
tags:
  - agent
  - loop
  - timeout
  - watchdog
  - tests
source_tasks:
  - VL-274
linked_tasks:
  - VL-274
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Idle-watchdog фазы агента (`src/agent/idle-guard.ts`, VL-274) считает простой по последней активности — токену стрима или завершённому tool-вызову. Если таймер тикает и во время выполнения инструмента, легитимный долгий tool (`pnpm test` на Catalina идёт 20+ минут молча) впишется в «простой» и фазу оборвёт по ложному срабатыванию.

## Решение

Перед вызовом tool-хендлера снимай таймер (`idleGuard.pause()`), после — взводи заново (`resume()`): окно отсчитывается от момента завершения tool, а не от старта. Зависший инструмент ловится не watchdog'ом, а своими таймаутами (`bashTimeoutMs` + усечение по `remainingWallTimeMs` у `run_shell_command`, таймаут запроса у MCP-клиента) и жёстким wall-time. `pause()`/`resume()` вызывай и на error-ветке handler'а, и для неизвестного инструмента, иначе таймер останется снятым навсегда.

## Пример

VL-274: `src/agent/loop.ts` — `idleGuard.pause()` перед `spec.handler(...)`, `idleGuard.resume()` после `truncateToolOutput`; двойное детектирование (реальный таймер + `idleGuard.timedOut() || idleMs() > idleTimeoutMs` в начале итерации) делает тесты детерминированными через инъекцию `now`, без sleep.