---
id: lesson-48
title: 'Возобновляй автоочередь на старте бота: сбрасывай running→pending и перезапускай тик'
status: active
tags:
  - auto-runner
  - restart
  - queue
  - resume
source_tasks:
  - VL-191
linked_tasks:
  - VL-191
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема
Auto-runner живёт в процессе бота и продолжает очередь через `onExit` колбэкр запущенной фазы. Если бот падает/перезапускается посреди фазы, onExit теряется навсегда: элемент очереди остаётся в `status: "running"`, а `pickNextQueueTask` выбирает только `pending` — очередь зависает до ручного вмешательства.

## Решение
При старте бота (в `registerHandlers`) вызывай `resumeAutoRunner`: перечитай файл очереди, все элементы в `running` сбрасывай в `pending` (фаза-сирота не получит onExit), и если `running: true` — сразу запускай тик. Фаза перезапустится заново; возможен короткий дубль-прогон orphan-процесса (кросс-процессного guard'а нет — известное ограничение, упомянуто в README), но зависшая очередь хуже редкого дубля.

## Пример
```ts
// в конце registerHandlers(bot, deps)
resumeAutoRunner(bot, deps.cwd);
// resumeAutoRunner: loadAutoQueue → tasks.map(t =>
//   t.status === 'running' ? {...t, status: 'pending'} : t) → save →
//   queue.running && tick(bot, cwd)
```
Применимо к любому долгоживущему раннеру с onExit-continuation: состояние «в процессе» должно переживать рестарт через пересборку из persisted-очереди, а не ждать потерянный колбэк.
