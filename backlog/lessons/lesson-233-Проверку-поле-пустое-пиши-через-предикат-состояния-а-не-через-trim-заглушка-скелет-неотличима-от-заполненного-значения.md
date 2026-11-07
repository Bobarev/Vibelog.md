---
id: lesson-233
title: 'Проверку «поле пустое» пиши через предикат состояния, а не через trim() === '''' — заглушка-скелет неотличима от заполненного значения'
status: active
tags:
  - mcp
  - noop
  - lessons
  - loop-detection
  - agent
source_tasks: []
linked_tasks:
  - VL-349
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Защита «поле не заполнено → ошибка вместо noop» (VL-319) была написана как `body.trim() === ''`. Но `createLessonFile` подставляет скелет `LESSON_BODY_SKELETON` (`## Проблема\n\n## Решение\n\n## Пример\n`), и урок-заглушка перестал отличаться от заполненного. Вызов `lesson_update {id, title, tags}` без `content` уходил в noop-сверку с `hint: «Переходи к следующему шагу»`, модель повторяла его дословно 4 раза → `MAX_NOOP_REPEATS_PER_RUN` → fail (сессия agent-1794045441657, Close VL-346; восьмой рецидив семейства VL-303/304/309/310/318/319/323).

## Решение

Состояние «значение по умолчанию / заглушка» — это отдельное состояние, и проверять его надо **одним экспортируемым предикатом**, а не инлайновой проверкой пустоты. В `src/core/lesson.ts` появился `isLessonBodyUnfilled(body)`: `trim() === ''` ИЛИ нормализованное тело равно скелету. Все потребители (ветка ошибки `toolLessonUpdate`, ветка noop `toolLessonUpdate`, finding `empty_body` в `lesson-audit`, валидация `lesson_create`) используют только его — одна точка правды. Ошибка вместо noop важна механически: `ok:false` без `noop:true` не попадает в `noopSignatures`, поэтому повтор **исполняется** и снова отдаёт текст с требованием `content`, а не глушится директивой «изменений нет».

## Пример

```ts
// Плохо: скелет — непустая строка, проверка не срабатывает
if (updates.content === undefined && current.body.trim() === '') { /* ошибка */ }

// Хорошо: единый предикат состояния
export function isLessonBodyUnfilled(body: string | undefined | null): boolean {
  const text = String(body ?? '').trim();
  if (text === '') return true;
  return text === LESSON_BODY_SKELETON.trim(); // trim с обеих сторон: файл мог потерять \n
}
if (updates.content === undefined && isLessonBodyUnfilled(current.body)) { /* ошибка */ }
```

Проверка: `src/core/lesson.test.mjs` (предикат), `src/mcp/write-ack.test.mjs` (ошибка + исполняемый повтор), `src/core/lesson-audit.test.mjs` (finding с `details.skeleton`), `src/agent/loop.test.mjs` (регресс 4 повторов).
