---
id: lesson-111
title: Перехватывай нестандартные клавиши композера assistant-ui своим onKeyDown с preventDefault — он выполняется до встроенного handleKeyPress
status: active
tags:
  - assistant-ui
  - composer
  - web
  - react
source_tasks:
  - VL-263
linked_tasks:
  - VL-263
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

В `@assistant-ui/react` у `ComposerPrimitive.Input` есть проп `submitMode`, но нужной раскладки клавиш в либе нет: `"enter"` — Enter отправляет, Shift+Enter переносит; `"ctrlEnter"` — наоборот, Ctrl/Cmd+Enter отправляет; `"none"` — только кнопка отправки. Требование «plain Enter отправляет, Ctrl/Cmd+Enter даёт перенос строки» невыразимо через `submitMode`.

## Решение

Свой `onKeyDown` на `ComposerPrimitive.Input`: либа собирает обработчики как `composeEventHandlers(onKeyDown, handleKeyPress)`, поэтому пользовательский проп выполняется ПЕРВЫМ, а `preventDefault()` в нём отменяет встроенный `requestSubmit()` (radix-composeEventHandlers уважает `defaultPrevented`). Текст композера контролируемый — вставляй `\n` не через `setRangeText`, а через `aui.composer.setText(next, { origin: "user" })`, иначе состояние разъедется; каретку восстанавливай в `useLayoutEffect` по `useAuiState(s => s.composer.text)` (значение в реф, `textarea.setSelectionRange`). `shiftKey` и `isComposing` (IME) в перехвате отбрасывай — Shift+Ctrl+Enter оставь либе (steer).

## Пример

```tsx
const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.nativeEvent.isComposing) return
  e.preventDefault()                                  // гасит requestSubmit либы
  const el = e.currentTarget
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  caretRef.current = start + 1
  aui.composer.setText(el.value.slice(0, start) + "\n" + el.value.slice(end), { origin: "user" })
}
```
