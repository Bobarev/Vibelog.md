---
id: lesson-191
title: 'Классифицируй ответ write-инструмента по трём исходам (ok:true / noop:true / ok:false) — JSON-отказ нельзя считать «применённым»'
status: active
tags:
  - agent-loop
  - mcp
  - write-tools
  - applied-signatures
source_tasks:
  - VL-318
linked_tasks:
  - VL-318
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind: rule
---
## Проблема

Страховка VL-306 в `src/agent/loop.ts` («не-JSON ответ write-инструмента = применён») ловила JSON-отказ `{"ok":false,"error":…}`: он начинается с `{`, а не с «Ошибка», поэтому сигнатура навсегда попадала в `appliedSignatures`. Модель при повторе получала ложную директиву «уже применено, переходи к отчёту» вместо текста ошибки и упиралась в кап `MAX_APPLIED_REPEATS_PER_RUN` (инцидент `agent-1793705489953`, Close VL-316).

## Решение

Классифицируй ответ write-инструмента по трём исходам: `ok:true` → «применён» (в `appliedSignatures`), `noop:true` → «изменений нет» (`noopSignatures`), `ok:false` (`ackError`/`ackDenied`) → **ошибка**, сигнатура не пополняет ни один из наборов и повтор исполняется заново со свежим текстом ошибки. Страховку для не-JSON ответов ограничивай условием `!failed`: она существует ровно для «ответ не распарсился», а не для распознанного отказа.

## Пример

`git_commit {paths:["CHANGELOG.md","backlog/docs/doc-6-…"]}` → `ackError` с подсказкой `allowForeign: true`; после правки повтор исполняется и отдаёт модель той же подсказкой, а шаг документации в close-шаблонах передаёт `allowForeign: true` сразу.
