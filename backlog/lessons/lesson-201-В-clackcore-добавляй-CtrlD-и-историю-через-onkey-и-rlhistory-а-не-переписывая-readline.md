---
id: lesson-201
title: 'В @clack/core добавляй Ctrl+D и историю через on(''key'') и rl.history, а не переписывая readline'
status: active
tags:
  - clack
  - tui
  - agent
  - stdin
  - prompt
source_tasks: []
linked_tasks:
  - VL-321
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Базовый `Prompt` из `@clack/core` считает cancel-клавишами только Ctrl+C и Esc (алиасы `cancel` в `settings.aliases`), а истории ввода не имеет вовсе. Соблазн — перехватить `keypress`/`data` на stdin самому: тогда появляется второй владелец потока (lesson-195) и ломается трекинг строки внутри Prompt (`rl.line` перезаписывает `userInput` на каждом нажатии, ручные правки затираются).

## Решение

Расширяй `TextPrompt` подписками, а не перехватом потока:

1. Ctrl+D — `this.on('key', (char, key) => { if (key?.name === 'd' && key.ctrl) this.state = 'cancel'; })`. Базовый `onKeypress` после `emit('key')` видит `state === 'cancel'` и закрывает промпт отменой (резолв cancel-символом, без `process.exit`).
2. История ↑/↓ — сидируй `rl.history` в переопределённом `prompt()`: `const r = super.prompt(); const rl = this.rl; if (rl) rl.history = [...history].slice(-50).reverse();` (у readline `history[0]` — самое свежее). Тогда стрелки работают штатным механизмом readline, и Prompt подхватывает строку через `rl.line`.
3. Лимит длины — через `validate`, а не обрезкой: пользователь видит ошибку, промпт не закрывается.

## Пример

VL-321: `src/agent/tui-input.ts` — `ChatInputPrompt extends TextPrompt` (9 тестов на PassThrough: печать/Backspace, ↑ из истории, Enter, Ctrl+C, Ctrl+D, лимит 500 символов, abort signal). `rl` — private-поле `@clack/core`, доступ через структурное приведение типа с комментарием «осознанно»: prompt() создаёт readline синхронно, до первого await.
