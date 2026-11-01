---
id: lesson-132
title: 'Удаляя встроенную роль чата, правь все её внешние точки: PERSONA_ICONS (вместе с импортом иконки), npm-smoke, chat-system.md и README'
status: active
tags:
  - web
  - personas
  - lint
  - npm-smoke
  - docs
source_tasks:
  - VL-273
linked_tasks:
  - VL-273
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Удаление роли `orchestrator` из `BUILTIN_PERSONAS` (VL-273) — это не одна правка в `src/web/personas.ts`: роль прошита ещё в четырёх местах, которые падают или дают расхождение, если их пропустить.

## Решение

При удалении встроенной роли пройти чек-лист: `BUILTIN_PERSONAS`, шаблон `templates/prompts/personas/<id>.md`, `PERSONA_ICONS` в `web/src/components/chat/pickers.tsx` (ВМЕСТЕ с импортом иконки, иначе `npm run lint` фронта падает на unused import), список шаблонов ролей в `scripts/npm-smoke.mjs` (иначе smoke падает на удалённом файле), перечисление ролей в `templates/prompts/chat-system.md` и README. Плюс тесты: длины/индексы массивов ролей во всех ассертах (сдвигаются все последующие).

## Пример

В VL-273 достаточно было 8 файлов: `personas.ts`, `personas.test.mjs`, `chat.test.mjs`, `pickers.tsx`, `npm-smoke.mjs`, `README.md`, `chat-system.md`, удалённый `orchestrator.md`. Ссылка в `chat-system.md` не была указана в плане и нашлась только шагом поисковой проверки остатков.