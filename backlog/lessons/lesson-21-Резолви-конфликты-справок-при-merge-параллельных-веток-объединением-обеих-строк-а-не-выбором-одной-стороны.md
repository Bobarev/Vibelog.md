---
id: lesson-21
title: 'Резолви конфликты справок при merge параллельных веток объединением обеих строк, а не выбором одной стороны'
status: active
tags:
  - git
  - merge
  - conflicts
  - bot
  - cli
  - close
source_tasks:
  - VL-169
linked_tasks:
  - VL-169
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

При merge параллельной ветки в master конфликтуют файлы справок, которые правили обе ветки (VL-169 и VL-171 одновременно меняли BOT_COMMANDS в src/bot/registry.ts, help-строку в registry.test.mjs, JSDoc в src/cli/commands/agent.ts и usage в src/cli/router.ts).

## Решение

Резолви такой конфликт объединением обеих сторон: сохрани чужую строку/флаг (resume/--resume) и накладывай свою (comment к analyze) — никогда не выбирай одну сторону целиком, иначе теряется функционал другой ветки.

## Пример

Конфликт в registry.ts:

```
<<<<<<< HEAD
  { command: 'analyze', ... usage: '/analyze[:agent] <session-ref>', ... },
  { command: 'resume', ... },          ← чужая строка VL-171
=======
  { command: 'analyze', ... usage: '... [комментарий]', ... },  ← своя VL-169
>>>>>>> vb/vl-169
```

Правильно: взять analyze из своей стороны + resume из HEAD; в help-строке registry.test.mjs склеить оба изменения (`/analyze... [комментарий], /resume... [комментарий]`). После резолва прогони pnpm build && pnpm test — сборка ловит утерянные строки справки через deepEqual-тесты.