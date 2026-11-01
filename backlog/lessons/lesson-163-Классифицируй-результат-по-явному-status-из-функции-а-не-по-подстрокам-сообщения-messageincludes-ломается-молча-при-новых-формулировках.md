---
id: lesson-163
title: 'Классифицируй результат по явному `status` из функции, а не по подстрокам сообщения — `message.includes(...)` ломается молча при новых формулировках'
status: active
tags:
  - core
  - api-design
  - cache
  - tests
source_tasks:
  - VL-291
linked_tasks:
  - VL-291
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

`syncReferenceCaches` определял судьбу элемента через `res.message.includes('без изменений')` / `includes('пропуск')`. Добавление нового исхода (частичный сбой при нескольких ссылках) не сломало тесты — оно молча записало partial в «skipped», то есть неполный успех выглядел успехом.

## Решение

Функция, у которой больше двух исходов, возвращает явный дискриминант (`status: 'updated'|'skipped'|'partial'|'failed'|'none'`), а вызывающий классифицирует по нему. Подстроки в `message` при этом СОХРАНЯЮТСЯ — на них могут быть завязаны другие потребители (MCP-обработчик, тесты), так что это чисто additive-правка, а не переписывание текстов. Новый исход сразу попадает в правильную корзину без правок вызывающего.

## Пример

VL-291: `CacheResult`/refresh получили `status`, `syncReferenceCaches` и MCP `toolReferenceSync` переведены на `switch (res.status)`; partial → `failed` с текстом; регрессионный тест «одиночная ссылка → skipped» и «изменилось → updated» остался зелёным, потому что тексты сообщений не тронуты.
