---
id: lesson-4
title: После npm publish проверяй версию через npm view только после задержки — registry показывает новую версию лишь через 1–2 минуты
status: active
tags:
  - release
  - npm
source_tasks:
  - VL-159
linked_tasks:
  - VL-159
created_date: 2026-10-14
updated_date: 2026-10-14
supersedes: ''
---
## Проблема

После `npm publish` сразу вызванный `npm view <pkg> version` возвращает ПРЕДЫДУЩУЮ версию (репликация registry CDN занимает до нескольких минут) — в VL-159 publish вернул `+ vibelog.md@1.8.0`, а первые два `npm view` (через 45 и 90 секунд) ещё показывали 1.7.0.

## Решение

После `npm publish` подождать пропагации: `sleep 45 && npm view <pkg> version` в цикле (обычно достаточно 1–2 минут), и только затем считать publish подтверждённым и продолжать релиз (пуш тега). Сообщение npm «Your package is being processed, may take a few minutes» — норма, не ошибка.

## Пример

```bash
npm publish   # + vibelog.md@1.8.0
sleep 45 && npm view vibelog.md version   # ещё 1.7.0 — ждём
sleep 90 && npm view vibelog.md version   # 1.8.0 — подтверждено, продолжаем
```
