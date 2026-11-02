---
id: lesson-170
title: 'В агрегатах отчётов возвращай null, а не NaN, и печатай «—» в markdown'
status: active
tags:
  - отчёты
  - агрегаты
  - typescript
  - эксперименты
source_tasks: []
linked_tasks:
  - VL-297
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Среднее/медиана по пустому набору строк даёт `NaN` (деление на ноль), и это протекает в `--json`-вывод, ломая машинную обработку, и в markdown-таблицу, где `NaN` неотличим от ошибки расчёта.

## Решение

В агрегирующих функциях (`mean`, `median`, `win_rate`, `delta`) при пустом входе возвращай `null`. В markdown — единый форматтер `fmt()`, который на `null` печатает `—`. `n` и `dropped` при этом печатаются всегда (даже при `n = 0`): иначе «среднее по двум строкам из сорока» читается как результат.

## Пример

```ts
function mean(values: number[]): number | null {
  if (values.length === 0) return null;  // не NaN
  return round(values.reduce((s, v) => s + v, 0) / values.length);
}
function fmt(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}
```
