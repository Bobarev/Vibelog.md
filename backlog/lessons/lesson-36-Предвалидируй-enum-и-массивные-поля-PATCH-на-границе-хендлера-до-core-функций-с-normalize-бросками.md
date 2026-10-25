---
id: lesson-36
title: Предвалидируй enum- и массивные поля PATCH на границе хендлера до core-функций с normalize-бросками
status: active
tags:
  - web
  - api
  - валидация
  - http
source_tasks:
  - VL-182
linked_tasks:
  - VL-182
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

В API-слое (`src/web/api.ts`) PATCH-эндпоинты делегируют валидацию core-функциям, которые при невалидном входе бросают исключение (`normalizeLessonStatus` и т.п.) → клиент получает 500 вместо 400, а частично применённые данные могут попасть в md-файл.

## Решение

Перед вызовом core-функции выполняй предвалидацию на границе хендлера:
- enum-поле (status) → `String(value).toLowerCase()` ∈ константный список, иначе 400 с русским текстом ошибки;
- массивное поле (tags) → `Array.isArray` + все элементы строки, иначе 400;
- принимай ТОЛЬКО известные поля патча — остальные молча игнорируй (read-only поля frontmatter не трогаются).

## Пример (VL-182, PATCH /api/lessons/:id)

```ts
if (body.status !== undefined && !LESSON_STATUSES.includes(String(body.status).toLowerCase()))
  return json(res, 400, { error: `Недопустимый статус lesson: ${body.status}` });
if (body.tags !== undefined && !(Array.isArray(body.tags) && body.tags.every(t => typeof t === 'string')))
  return json(res, 400, { error: 'tags должен быть массивом строк' });
```

Тесты фиксируют: невалидный ввод → 400 + файл на диске нетронут (snapshot readFileSync до/после).