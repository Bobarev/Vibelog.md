---
id: lesson-33
title: 'Новую подстановку промпта добавляй в код, шаблон, тесты и .qwen-копии одним заходом'
status: active
tags:
  - phase-prompt
  - tests
  - templates
  - skills
source_tasks:
  - VL-184
linked_tasks:
  - VL-184
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

Новая подстановка в taskExtraVars (src/web/phase-prompt.ts) живёт в четырёх местах сразу: код подстановок, текст шаблона, счётчик «N подстановок» в phase-prompt.test.mjs и копии .qwen/commands/vibelog/*. Пропуск любого места даёт незаметный расхождение: {{переменная}} остаётся литералом в промпте или копии навыков расходятся байт-в-байт.

## Решение

Добавляя подстановку, правь атомарно: taskExtraVars → шаблон phase-N.md → счётчик и тест «без остаточных литералов» → `cp templates/qwen-commands/{spec,plan,code}.md .qwen/commands/vibelog/` → проверка `renderPrompt('spec', …)` на отсутствие `{{…}}`.

## Пример

VL-184: availableTypes/availablePriorities добавлены вместе со счётчиком 12→14 в phase-prompt.test.mjs и cp-синхронизацией копий — grep по неподставленным {{availableTypes}} прошёл чисто.