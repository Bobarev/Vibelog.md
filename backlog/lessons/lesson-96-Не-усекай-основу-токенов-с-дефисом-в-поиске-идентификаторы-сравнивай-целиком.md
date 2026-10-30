---
id: lesson-96
title: Не усекай основу токенов с дефисом в поиске — идентификаторы сравнивай целиком
status: active
tags:
  - search
  - core
  - tokenization
source_tasks:
  - VL-237
linked_tasks:
  - VL-237
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

При усечении основы токенов в поиске (первые N символов) токены-идентификаторы с дефисом («findme-desc», «VL-237») теряют различимость: «findme-label» и «findme-desc» дают одну основу «findm», из-за чего выдача включает лишние задачи и падают тесты поиска по конкретному полю (VL-237: `src/web/search-api.test.mjs` ожидал 1 результат, получил 2).

## Решение

Усекать основу только для «обычных» слов: если токен содержит дефис или подчёркивание — сравнивать его целиком (тем же `includes`). Стемминг служит морфологии кириллицы/английских словоформ, а не идентификаторам.

## Пример

```ts
const needle = token.includes('-') ? token : stemToken(token);
if (title.includes(needle)) score += FIELD_WEIGHTS.title;
```
