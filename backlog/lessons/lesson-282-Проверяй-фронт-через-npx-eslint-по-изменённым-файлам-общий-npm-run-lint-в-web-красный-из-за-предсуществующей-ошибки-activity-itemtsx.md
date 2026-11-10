---
id: lesson-282
title: 'Проверяй фронт через npx eslint по изменённым файлам: общий npm run lint в web/ красный из-за предсуществующей ошибки activity-item.tsx'
status: active
tags:
  - web
  - lint
  - проверки
source_tasks:
  - VL-409
linked_tasks:
  - VL-409
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Общий `npm run lint` в `web/` падает на предсуществующей ошибке в файле, который задача не трогала (`activity-item.tsx:107`), поэтому его красный результат ничего не говорит о качестве изменений задачи — и соблазн либо объявить регрессию, либо молча проигнорировать весь lint.

## Решение
Проверяй фронт точечно: `npx eslint` по явному списку изменённых файлов из `git diff --name-only`, а общий `npm run lint` упоминай в отчёте с указанием предсуществующей ошибки и её файла — так видно, что lint не проверял задачу, а не что он «сломан задачей».

## Пример
VL-409: `cd web && npm run lint` падает на `activity-item.tsx:107` (ошибка была до задачи). Проверка изменённых файлов: `cd web && npx eslint src/components/chat/subagent-card.tsx src/components/chat/tool-meta.ts ...` — чисто. В отчёте фазы указано, что общий lint красный по предсуществующей причине, не связанной с задачей.