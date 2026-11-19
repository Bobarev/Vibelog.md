---
id: lesson-303
title: Не ставь крохотный maxTokens на reasoning-модели и логируй raw/usage ответа до парсинга
status: active
tags:
  - llm
  - gate
  - interbot
  - diagnostics
  - maxtokens
source_tasks:
  - VL-437
linked_tasks:
  - VL-437
created_date: 2026-11-19
updated_date: 2026-11-19
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Гейт-классификатор (VL-436) с maxTokens: 16 на reasoning-модели mimo возвращал пустой text — reasoning съедал весь бюджет ответа, а парсеры пропускают reasoning-итемы; пустота маскировалась под «непонятный ответ гейта: » с пустым хвостом, диагностировать было нечем. Плюс оценка doc-34 «таймаут 2–3 с» оказалась неверной (факт 3–5 с), из-за чего дефолт 2500 мс давал 100% fail-open на живце.

## Решение
Крохотный maxTokens на reasoning-модели не ставить (минимум с запасом на формат ответа: 16 → 64); в результат вызова возвращать raw-текст и usage (output/reasoning-токены) и логировать их в trace до парсинга; пустой ответ — отдельная ясная причина fail-open, а не подмена «непонятным»; оценки latency проверять живым вызовом до фиксации в спеке.

## Пример
VL-437: на живце 2026-11-19 гейт 7 раз из 7 падал — 6× «таймаут 2500 мс», 2× «непонятный ответ гейта: » пусто. Probe: streamChat с maxTokens 16 → textLen 0 за 3.2 с; тот же вызов с maxTokens 64 → «read_only».