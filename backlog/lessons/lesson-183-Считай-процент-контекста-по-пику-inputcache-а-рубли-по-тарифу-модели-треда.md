---
id: lesson-183
title: 'Считай процент контекста по пику (input+cache), а рубли — по тарифу модели треда'
status: active
tags:
  - web
  - chat
  - tokens
  - cost
  - context
source_tasks:
  - VL-313
linked_tasks:
  - VL-313
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Процент заполнения контекстного окна в чате, посчитанный как сумма токенов по всем ходам треда, завышен: usage каждого запроса уже включает весь промпт, поэтому ринг упирается в 100% на 2–3-м ходу. А стоимость, посчитанная по `models.default`, врёт после смены модели в пикере — прошлые ходы пересчитываются по чужому тарифу.

## Решение

Процент контекста считать по **ПИКУ** `input + cache` среди запросов треда, а деньги — по `pricingForModelId(cwd, modelId)` той модели, что реально отвечала в треде; `modelId` фиксировать в состоянии usage треда вместе с агрегатами.

## Пример

VL-313: `src/web/chat-usage.ts` хранит `peakInput`, кумулятивные input/output/cache/reasoning/requests и `modelId`, персистится в `.vibelog/chat-sessions/<threadId>.usage.json` (рядом с jsonl, gitignored).
