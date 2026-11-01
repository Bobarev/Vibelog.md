---
id: lesson-161
title: Задавай в промпте фазы критерий завершения write-шага и правило чтения applied — иначе модель дробит вызов и попадает в loop detection
status: active
tags:
  - prompt
  - phases
  - mcp
  - loop-detection
source_tasks:
  - VL-292
linked_tasks:
  - VL-292
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Промпт фазы Spec требовал «backlog_update_task РОВНО ОДИН РАЗ», но перечислял поля одной строкой-примером и не задавал критерий завершения шага. Модель трактовала это как «одно поле на вызов» (безопасная стратегия), применяла type/priority/labels тремя вызовами, а после применения всех полей не понимала, что работа сделана, и повторяла последний вызов с идентичными аргументами → loop detection (2-я блокировка) → немедленный fail фазы. Итог VL-291: 6 из 7 LLM-запросов — backlog_update_task, acceptanceCriteria пусты, отчёта нет, 200k токенов сгорело.

## Решение

В шаблоне фазы явно опиши (а) ОДИН объект аргументов со всеми полями и (б) **критерий завершения шага по ответу инструмента**: `applied` — поле уже записано, повторно не передавай; `skipped` — не «дожимать» повтором; `idempotentReplay: true` — эффект уже был; `ok: true` → сразу следующий шаг (отчёт), без проверочных вызовов; `ok: false` → разделить `not_confirmed` (один повтор с `idempotencyKey`) и `denied` (не повторять). Детектор повторов при этом не трогай — он сработал корректно.

## Пример

`templates/phases/phase-spec.md`, шаг 5: «Все определённые поля — title, type, priority, labels, description, references, acceptanceCriteria — передаются в ОДНОМ объекте аргументов одного вызова» + подпункт «Критерий завершения шага 5 (читай ответ инструмента!)». Инварианты закреплены текстовыми тестами в `src/web/phase-prompt.test.mjs` (describe VL-292): проверяют наличие подстрок `ОДНОМ объекте аргументов`, `applied`, `skipped`, `НЕ передавай его повторно`, `idempotentReplay`, `not_confirmed`.
