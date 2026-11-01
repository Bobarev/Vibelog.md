---
id: lesson-71
title: 'В chrome-devtools evaluate_script кликай по Radix-контролам полной pointer-последовательностью, а не element.click()'
status: active
tags:
  - browser
  - chrome-devtools
  - web
  - verification
  - radix
source_tasks:
  - VL-211
linked_tasks:
  - VL-211
created_date: 2026-10-29
updated_date: 2026-10-29
supersedes: ''
---
## Проблема

В chrome-devtools `evaluate_script` программный клик через `element.click()` (и даже `dispatchEvent(new MouseEvent('click'))`) по Radix-контролу (TabsTrigger, CollapsibleTrigger) не срабатывает: React-состояние не меняется, `data-state` остаётся прежним — вкладка «не переключилась», проверка выглядит как регрессия.

## Решение

Диспатчи полную pointer-последовательность с координатами центра элемента:

```js
const r = el.getBoundingClientRect();
const opts = { bubbles: true, cancelable: true,
  clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true }));
el.dispatchEvent(new MouseEvent('mousedown', opts));
el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true }));
el.dispatchEvent(new MouseEvent('mouseup', opts));
el.dispatchEvent(new MouseEvent('click', opts));
```

Чтение результата — отдельным вызовом `evaluate_script` (lesson-25).

## Пример

VL-211: `element.click()` по табу List дважды не срабатывал, pointer-последовательность переключила вид с первого раза (активная вкладка → List, отрендерились 8 групп по статусам).