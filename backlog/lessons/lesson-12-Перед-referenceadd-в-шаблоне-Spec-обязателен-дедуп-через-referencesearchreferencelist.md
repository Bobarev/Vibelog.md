---
id: lesson-12
title: Перед reference_add в шаблоне Spec обязателен дедуп через reference_search/reference_list
status: active
tags:
  - spec
  - references
  - dedup
  - templates
  - phase-1
source_tasks:
  - VL-168
linked_tasks:
  - VL-168
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема
Фаза Spec (VL-166 → инцидент в VL-168) при регистрации источника из текста пользователя сразу вызывала `reference_add`, создавая дубликат ref, хотя источник уже был зарегистрирован в проекте (ref-2, а создан — ref-15).

## Решение
В шаблоне phase-1.md (шаг 5.6) перед `reference_add` обязателен дедуп: сначала `reference_search` (при необходимости `reference_list`); при совпадении url/path/title — связывать НАЙДЕННЫЙ ref через `reference_link`, не создавая новый. `reference_add` — только при отсутствии совпадений.

## Пример
Правило в шаблоне: «СНАЧАЛА проверь, не зарегистрирован ли источник уже в проекте: reference_search … Если найден ref с совпадающим url/path — НЕ создавай дубликат через reference_add: свяжи существующий: reference_link …».