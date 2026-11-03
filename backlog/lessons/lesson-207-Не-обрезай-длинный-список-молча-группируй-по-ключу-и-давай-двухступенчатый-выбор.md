---
id: lesson-207
title: Не обрезай длинный список молча — группируй по ключу и давай двухступенчатый выбор
status: active
tags:
  - cli
  - wizard
  - ui
  - обрезка
  - каталог
source_tasks:
  - VL-327
linked_tasks:
  - VL-327
created_date: 2026-11-04
updated_date: 2026-11-04
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Длинный список для `askSelect` обрезали по лимиту поиска (`models.slice(0, CATALOG_SEARCH_LIMIT)` — 50 из ~582 моделей RouterAI в порядке каталога). Пользователь не находил нужную модель и считал, что её нет в каталоге; обрезка при этом была незаметной — список выглядел полным.

## Решение

Длинные списки группируй по естественному ключу (для моделей — автор: сегмент `id` до `/`) и делай двухступенчатый выбор: сначала группа с числом элементов, затем все элементы выбранной группы без `slice`. Единственную группу показывать не нужно — шаг пропускается. Обрезка допустима только тогда, когда она видна пользователю (сообщение «показаны первые N»), а не молча.

## Пример

```ts
const authors = [...new Set(models.map((m) => m.id.split('/')[0]))].sort();
const author = authors.length === 1 ? authors[0] : await askSelect('Автор модели', authors.map(...), 0);
const own = models.filter((m) => m.id.startsWith(author + '/'));   // без slice
await askSelect('Модель', own.map((m) => ({ label: `${m.id.slice(author.length + 1)} — ${price(m)}` })), 0);
```