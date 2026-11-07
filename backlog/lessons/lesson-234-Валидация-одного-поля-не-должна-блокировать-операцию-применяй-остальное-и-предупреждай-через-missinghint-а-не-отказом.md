---
id: lesson-234
title: 'Валидация одного поля не должна блокировать операцию — применяй остальное и предупреждай через missing/hint, а не отказом'
status: active
tags:
  - mcp
  - lessons
  - ack
  - loop-detection
  - create
source_tasks:
  - VL-355
  - VL-356
linked_tasks:
  - VL-355
  - VL-356
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Валидация одного поля (`content`) в `toolLessonUpdate` стояла ДО noop-сверки и возвращала отказ на любой вызов: на уроке-скелете нельзя было обновить ни `linkedTasks`, ни `status`, ни `tags`. Сессия `agent-1794053090709` (Close VL-346) пришла привязать урок к задаче, получила `ok:false` «в вызове нет `content`» и повторила вызов дословно 6 раз → `MAX_ERROR_REPEATS_PER_RUN`.

## Решение

Валидация одного поля не должна отменять применение остальных переданных полей. Разделяй случаи: явно испорченное поле → отказ; поле не передано, но есть другие изменения → применяй их и возвращай `missing`/`hint` (`ackOkDetailed`); не передано вообще ничего меняющего → отказ; повтор уже применённых полей → noop с `missing`, но НЕ отказ (серия отказов на повторе и есть механизм падения по капу повторов).

## Пример

```ts
if (bodyUnfilled && updates.content === undefined && !unchanged) {
  const entry = updateLesson(cwd, id, updates);       // поля применяются
  return ackOkDetailed(message, appliedFrom(entry, updates), [], {
    missing: [{ field: 'content', reason: 'тело урока не заполнено' }],
    hint: 'Добавь в вызов `content` с непустым markdown',
  });
}
```
