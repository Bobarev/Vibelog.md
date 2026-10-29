---
id: lesson-80
title: 'Обёртка child_process в тестах должна бросать исключение, а не возвращать Promise — иначе spawn теряет ChildProcess'
status: active
tags:
  - тесты
  - child_process
  - guard
  - vitest
source_tasks:
  - VL-226
linked_tasks:
  - VL-226
created_date: 2026-10-29
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

При добавлении offline-guard'а на `node:child_process` (VL-226) асинхронные функции (`spawn`, `exec`, `execFile`) были обёрнуты в `async function`. Итог: `spawn` стал возвращать Promise вместо `ChildProcess`, и 130 тестов web/agent/bot упали с `child.kill is not a function` / `Cannot read properties of undefined (reading 'on')`.

## Решение

Guard'ы в setup-файле тестов должны **бросать** (`throw`) при нарушении и возвращать ровно результат оригинала иначе — без `async`, без подмены типа возврата. Для теста throw на месте вызова `spawn(...)` и есть нужный fail-fast; оборачивать в Promise не требуется.

## Пример

```js
cp[name] = function guarded(cmd, ...rest) {
  const target = findNetworkTarget(cmd, args);
  if (target) throw new Error(`[VL-226] … сеть в тестах запрещена`);
  return orig.call(cp, cmd, ...rest); // ChildProcess сохраняется
};
```

Дополнительно: у `exec`/`execSync` первый аргумент — вся командная строка, поэтому имя команды нужно брать как первый токен (`cmd.trim().split(/\s+/)[0]`), а URL искать по всей строке, иначе `exec('git clone https://…')` проходит мимо guard'а.