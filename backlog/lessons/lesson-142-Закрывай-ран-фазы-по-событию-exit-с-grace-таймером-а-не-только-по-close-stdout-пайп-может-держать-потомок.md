---
id: lesson-142
title: 'Закрывай ран фазы по событию exit с grace-таймером, а не только по close — stdout-пайп может держать потомок'
status: active
tags:
  - orchestrator
  - child_process
  - locks
source_tasks:
  - VL-276
linked_tasks:
  - VL-276
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Запись `activeRuns` в `src/web/orchestrator.ts` удалялась только из `finish()`, а `finish()` вызывался лишь из события `close` дочернего процесса. Node эмитит `close` не по факту смерти процесса, а после закрытия stdio-потоков: если stdout-пайп удерживает живой потомок (MCP-сервер агента, `npx`/node-обёртка), `close` не приходит никогда. Итог — вечный лок «Запуск уже выполняем (VL-N)», `getRun` показывает `running: true` по мёртвому процессу, а лечебные ретраи супервизора повторяют один и тот же шаг без прогресса (VL-248 → VL-276).

## Решение

1. Снимай лок по `child.on('exit')` с grace-таймером (`RUN_CLOSE_GRACE_MS`): после `exit` заведи `setTimeout(() => finish(code), graceMs)` и `clearTimeout` в обработчике `close`; `finish` идемпотентен по флагу `finished`, двойной вызов безопасен.
2. Добавь `reapStaleRuns()` — снимает записи, у которых `child.exitCode !== null || child.signalCode !== null || !isPidAlive(pid)`, вызывая сохранённый в записи `finalize`-замыкание (а не просто удаляя запись, иначе теряются `lastRuns`/`onExit`). Вызывай reap в гардах спавна, в очереди close, в `getRun`/`countActiveRuns` — так мёртвый ран не блокирует и не врёт про `running`.
3. Ошибка доставки директивы супервизора (`'error' in res`) должна расходовать бюджет: `healAttempts += 1`, `status = 'failed'`, различимый текст причины (`classifyDeliveryError`), иначе `DEFAULT_HEAL_ATTEMPTS` не исчерпывается и авто-баг никогда не создаётся.

## Пример

```ts
child.on('exit', (code, signal) => {
  entry.exitCode = code; entry.signalCode = signal;
  exitTimer = setTimeout(() => { log('close не пришёл за grace — завершаю ран по exit'); finish(code); }, graceMs);
  exitTimer.unref?.();
});
child.on('close', (code) => { clearTimeout(exitTimer); finish(code); });
```
