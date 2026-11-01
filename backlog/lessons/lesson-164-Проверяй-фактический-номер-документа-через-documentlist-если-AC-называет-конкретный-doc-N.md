---
id: lesson-164
title: 'Проверяй фактический номер документа через document_list, если AC называет конкретный doc-N'
status: active
tags:
  - specification
  - documents
  - backlog
  - vl-293
source_tasks:
  - VL-293
linked_tasks:
  - VL-293
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

AC задачи-спецификации назвал «документ backlog/docs/doc-20», но doc-20 был уже занят (документ про lessons) — фактически создан doc-21. Номер документа назначается автоматически и не совпадает с предполагаемым в тексте AC.

## Решение

Перед созданием документа вызывай `document_list` (или `vibelog doc list`), чтобы узнать реальный следующий свободный id, и явно фиксируй расхождение в отчёте фазы: «AC требует doc-20, фактический id — doc-21, причина — номер занят; суть AC выполнена».

## Пример

VL-293: `document_create` выдал doc-21 вместо ожидаемого doc-20 (doc-20 — «Lessons»); в отчёте фазы Code указана причина расхождения, AC отмечен как выполненный по сути.
