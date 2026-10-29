---
id: lesson-77
title: Диагностику guard'ов пиши console.error в точке срабатывания — так она доходит до logTail
status: active
tags:
  - agent
  - logging
  - diagnostics
  - orchestrator
source_tasks:
  - VL-217
linked_tasks:
  - VL-217
created_date: 2026-10-29
updated_date: 2026-10-29
supersedes: ''
---
## Проблема
Диагностика, напечатанная после return fail() или в обход stderr, не доходит до logTail оркестратора — при пустом ответе модели (VL-217) не было видно ни payload, ни usage.

## Решение
Пиши диагностику guard'а console.error в точке срабатывания (до ветвления/return) — stderr цепляется logTail оркестратора и тестами перехватывается напрямую; прецедент VL-199 (llm.ts пишет в stderr во время запроса, допустимо и при активном TUI).

## Пример
VL-217: console.error('[vibelog-agent] пустой финал (попытка N): payload=..., usage=...') до ветвления повтор/ fail — строка видна в stderr CLI-теста и в logTail фазы.