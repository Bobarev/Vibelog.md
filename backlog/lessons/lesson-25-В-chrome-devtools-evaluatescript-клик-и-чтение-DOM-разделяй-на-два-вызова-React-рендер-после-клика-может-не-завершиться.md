---
id: lesson-25
title: В chrome-devtools evaluate_script клик и чтение DOM разделяй на два вызова — React-рендер после клика может не завершиться
status: active
tags:
  - chrome-devtools
  - web
  - testing
  - react
source_tasks:
  - VL-175
linked_tasks:
  - VL-175
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

В chrome-devtools `evaluate_script` клик по React-элементу и чтение DOM в одном вызове (`el.click(); document.querySelectorAll(...)`) может вернуть ДОкликовое состояние: React откладывает рендер, и сортировка/фильтр «не применились» — ложный вывод о баге.

## Решение

Клик и последующее чтение DOM разделять на ДВА вызова `evaluate_script`: первый — только `el.click()` (и подтверждение, что элемент найден), второй — чтение таблицы/классов/иконок. Индикатор применённой сортировки — иконка Arrow в `thead th` (проверять её presence как подтверждение).

## Пример

```js
// вызов 1
() => { document.querySelector('thead th')?.click(); return 'ok'; }
// вызов 2 (DOM уже перерисован)
() => [...document.querySelectorAll('thead th')].filter(th => th.querySelector('svg')).map(th => th.textContent)
```

Применялось в VL-175 (проверка сортировки таблицы #/tasks): после разделения вызовов Labels-порядок читался корректно.