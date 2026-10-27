---
id: lesson-67
title: Стартовые проверки и уведомления выполняй до route() для долгоживущих команд
status: superseded
tags:
  - cli
  - update-check
  - архитектура
  - долгоживущие-команды
source_tasks: []
linked_tasks: []
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

В `bin/vibelog.mjs` вызов `maybeNotifyUpdate()` стоял в `.then()` после `route()` — для долгоживущих команд (`bot`, `browser`) route не завершается, уведомление о новой версии не наступало никогда (VL-101 → VL-206).

## Решение

Любую стартовую проверку/уведомление (кэш с TTL, сеть) для сервисных команд выполняй ДО `route()`: определи команду заранее (`shouldNotifyAtStartup(argv)`) и делай `await maybeNotifyUpdate(argv)` перед route; для обычных коротких команд оставляй после. Семантику `catch` ошибок route (stderr + exit 1) при перестроении цепочки сохраняй.

## Пример

```js
const notifyFirst = shouldNotifyAtStartup(argv);
if (notifyFirst) await maybeNotifyUpdate(argv);
await route(argv);
// пост-route вызов — только если !notifyFirst
```
