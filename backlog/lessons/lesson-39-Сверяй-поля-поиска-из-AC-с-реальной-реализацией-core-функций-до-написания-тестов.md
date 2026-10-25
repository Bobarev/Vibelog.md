---
id: lesson-39
title: Сверяй поля поиска из AC с реальной реализацией core-функций до написания тестов
status: active
tags:
  - core
  - search
  - testing
  - ac
source_tasks: []
linked_tasks:
  - VL-185
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

В VL-185 AC требовал поиск документов по полям title/body/type, но существующая core-функция `searchDocuments` искала только по title/body — поле type было упущено и обнаружено только при сверке тестов с AC.

## Решение

Перед реализацией поиска сверяй каждое поле из AC с сигнатурами существующих core-функций (что реально перебирается в matches); недостающее поле дописывай в core-функцию, а не в обёртку — иначе регресс по AC пройдёт мимо тестов.

## Пример

VL-185: в `searchDocuments` (`src/core/document.ts`) добавлено сравнение `type` по substring case-insensitive, чтобы AC2 («documents — title/body/type») выполнялось.