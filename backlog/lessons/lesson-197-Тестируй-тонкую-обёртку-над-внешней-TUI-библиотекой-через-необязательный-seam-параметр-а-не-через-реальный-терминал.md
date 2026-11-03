---
id: lesson-197
title: 'Тестируй тонкую обёртку над внешней TUI-библиотекой через необязательный seam-параметр, а не через реальный терминал'
status: active
tags:
  - тесты
  - cli
  - tui
  - seam
  - clack
source_tasks:
  - VL-322
linked_tasks:
  - VL-322
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

После перевода интерактивного слоя на внешнюю библиотеку (`@clack/prompts`) юнит-тесты прежней самописной реализации (кадры ANSI, `❯`, `\x1b[A/B`) теряют смысл — это зона библиотеки. Но и проверять поведение только реальным промптом на `PassThrough` нельзя: clack создаёт `readline` с `terminal: true` и `setRawMode` лишь для TTY, на не-TTY-потоке keypress-события приходят с гонкой (`escapeCodeTimeout` 50 мс) → флак.

## Решение

Раздели тесты на два уровня. (1) Маппинг параметров и отмена — через необязательный seam-параметр: `createPromptSession({ input, output, prompts })`, где `prompts` — `Pick<typeof import('@clack/prompts'), 'text'|'confirm'|'select'|'multiselect'|'isCancel'>`; фейк записывает переданные опции и возвращает `CANCEL_SYMBOL`. Seam не расширяет публичный контракт сессии (второй аргумент/поле опций), документируется JSDoc «только тесты» и не попадает в README/доки. (2) Реальный интерактив — 1–2 теста с настоящим промптом на `PassThrough` + `await tick(50)`, остальное поведение покрывает spawn-тест CLI без TTY.

## Пример

VL-322: `src/cli/prompt.test.mjs` — seam-тесты проверяют `message`/`defaultValue`/`placeholder`/`validate` у `text`, `initialValue` из `initialIndex` (с пропуском disabled), `initialValues` + `required: false` у `multiselect`, `CANCEL_SYMBOL` → `PromptCancelledError` для всех четырёх методов; реальный Ctrl+C (`'\u0003'` в `PassThrough`) — только для `askText` и `askSelect`. Тесты кадров удалены.
