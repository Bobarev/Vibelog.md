---
id: lesson-20
title: При таймауте сетевого теста reference.test.mjs повтори его отдельно перед вердиктом — флаки не прерывают фазу
status: superseded
tags:
  - tests
  - flaky
  - network
  - reference
source_tasks:
  - VL-163
linked_tasks:
  - VL-163
  - VL-178
  - VL-182
  - VL-218
created_date: 2026-10-25
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Полный `pnpm test` упал на `src/core/reference.test.mjs` с таймаутом 120с в тесте `sync: cloned/skipped/failed` — он делает реальный git clone по сети, под нагрузкой параллельных воркеров сеть не укладывается.

## Решение

При падении полного прогона с таймаутом в сетевом тесте — повтори этот файл отдельно (`npx vitest run src/core/reference.test.mjs`) перед вердиктом «тесты падают». Если отдельный прогон зелёный — это флаки, а не регрессия; решение о прерывании фазы принимай по повторному прогону.

## Пример

```bash
npx vitest run src/core/reference.test.mjs --reporter=dot  # 22/22 passed → флаки, не регрессия
```