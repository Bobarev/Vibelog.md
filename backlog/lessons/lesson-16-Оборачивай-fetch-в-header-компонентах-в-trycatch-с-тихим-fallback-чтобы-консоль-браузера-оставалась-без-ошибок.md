---
id: lesson-16
title: 'Оборачивай fetch в header-компонентах в try/catch с тихим fallback, чтобы консоль браузера оставалась без ошибок'
status: active
tags:
  - web
  - браузер
  - console
  - api
  - деградация
source_tasks:
  - VL-166
linked_tasks:
  - VL-166
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

В VL-166 AC требовал: `list_console_messages` по итогу без ошибок. AccountSwitcher делает fetch GET /api/settings — при недоступном API необработанный промис даёт console.error и проверка проваливается.

## Решение

Все fetch из header-компонентов оборачивай в try/catch (или .catch), при ошибке — тихий fallback-стейт (например, имя @agent, аватар «?»), без console.error/console.warn. Ошибка API не должна ронять компонент и засорять консоль.

## Пример

```tsx
try {
  const res = await fetch("/api/settings");
  const s = await res.json();
  setUserName(s.git_user_name || "@agent");
} catch {
  setUserName("@agent"); // тихий fallback, консоль чиста
}
```