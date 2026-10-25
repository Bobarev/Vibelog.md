---
id: lesson-22
title: Защищай fetch детальной hash-страницы guard'ом пустого id — route-хук и id-хук обновляются отдельными слушателями hashchange
status: active
tags:
  - web
  - hash-routing
  - api
source_tasks:
  - VL-174
linked_tasks:
  - VL-174
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

В hash-роутинге с двумя хуками (`useHashRoute` возвращает route, `useReferenceId` — id из `#/reference/<id>`) при навигации кликом оба состояния обновляются отдельными слушателями `hashchange`. Между их обновлениями возможен промежуточный рендер, где route уже `'reference'`, а id ещё `null`: детальная страница монтируется с пустым id и делает `GET /api/references/` → transient-404 в сети (страница на секунду показывает ошибку загрузки).

## Решение

Защищай fetch в `useEffect` детальной страницы ранним выходом при пустом id (`if (!id) return;`) до каких-либо сетевых вызовов. Пустой id → показывай «Загрузка…», реальный запрос уйдёт, когда хук id догонит.

## Пример

```ts
React.useEffect(() => {
  if (!id) return; // guard: transient-404 GET /api/references/ устранён
  let cancelled = false;
  fetchReference(id).then(...).catch(...);
  return () => { cancelled = true; };
}, [id]);
```

Проверка: перезагрузка `#/reference/ref-1` в DevTools Network — только `GET /api/references/ref-1 [200]`, без `GET /api/references/ [404]`.
