---
id: lesson-46
title: 'Для FIFO-сортировки по timestamp генерируй added_at монотонным счётчиком, а не голым Date.now()'
status: active
tags:
  - queue
  - fifo
  - timestamp
  - testing
  - auto-runner
source_tasks:
  - VL-191
linked_tasks:
  - VL-191
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема

FIFO-очередь сортировалась по полю `added_at` (ISO-строка), которое генерировалось через `new Date().toISOString()` при добавлении. Батч-добавление нескольких элементов в одном вызове давало одинаковую миллисекунду → сравнение `added_at` вырождалось в равенство → порядок внутри приоритета зависел от порядка в массиве и от стабильности sort, а не от реального порядка добавления. Тест AC2 («внутри приоритета FIFO по added_at») это поймал: элемент, добавленный вторым, выбирался первым.

## Решение

Генерируй timestamp-базу FIFO-порядка монотонным счётчиком: модульный `let lastMs = 0` и `nextIsoDate()`, который возвращает `Date.now()`, но всегда строго больше предыдущего вызова (`if (ms <= lastMs) ms = lastMs + 1`). Лексикографическое сравнение ISO-строк совпадает с хронологией, поэтому строгое увеличение внутри процесса гарантирует FIFO независимо от миллисекундных коллизий; между процессами база — реальное `Date.now()`.

## Пример

```ts
let lastAddedAtMs = 0;
function nextIsoDate(): string {
  let ms = Date.now();
  if (ms <= lastAddedAtMs) ms = lastAddedAtMs + 1;
  lastAddedAtMs = ms;
  return new Date(ms).toISOString();
}
// addQueueTasks(dir, ['VL-2', 'VL-4', 'VL-1', 'VL-3']) →
// added_at: VL-2 < VL-4 < VL-1 < VL-3 строго, FIFO восстановлен
```

Применимо к любой очереди/аудит-логу, где порядок восстанавливается по timestamp, пишущемуся batch-ем.
