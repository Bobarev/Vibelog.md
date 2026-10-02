---
id: VL-41
title: 'Telegram-бот: парсер команды /spec'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 22:34'
updated_date: '2026-10-02 22:42'
due_date: ''
labels:
  - telegram-bot
  - spec
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Чистый парсер parseSpecCommand в src/bot/commands.ts: строка после /spec → {description} | {error}. По аналогии с parseCreateCommand (VL-35). Весь текст после команды — описание фичи; флагов нет. Пустой ввод — {error} с подсказкой синтаксиса на русском. Типы — в сигнатуре TS, JSDoc краткий.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 parseSpecCommand("текст фичи") возвращает {description: "текст фичи"}; пустая строка или только пробелы — {error} с подсказкой «Синтаксис: /spec описание фичи»
- [x] #2 Окружающие кавычки снимаются (unquote): parseSpecCommand('"фича"') → {description: "фича"}
- [x] #3 Юнит-тесты в src/bot/commands.test.mjs проходят, pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы
- src/bot/commands.ts — добавить интерфейс SpecCommand (~строка 20, после CommentCommand) и функцию parseSpecCommand (после parseCommentCommand, ~строка 127).
- src/bot/commands.test.mjs — новый describe('parseSpecCommand (VL-41)') в конце файла.

## Изменения
1. commands.ts: interface SpecCommand { description: string }.
2. commands.ts: parseSpecCommand(text: string): SpecCommand | { error: string }.
   - hint = 'Синтаксис: /spec описание фичи'.
   - rest = unquote(text.trim()); если пусто → { error: hint }.
   - вернуть { description: rest }.
   - Повторяем unquote как в create — снятие кавычек вокруг всего описания.
3. commands.test.mjs: импорт parseSpecCommand; кейсы:
   - обычный текст → { description: '...' };
   - текст в кавычках снимает кавычки;
   - пустая строка и пробелы → error с /Синтаксис/.

## Порядок
commands.ts (тип → функция) → commands.test.mjs → pnpm test.

## Проверка
- pnpm build && node --test src (парсер + все прежние тесты без регрессий).
- grep -n parseSpecCommand src/bot/ подтверждает экспорт.

## Риски
- Низкий. Функция чистая, side-effect нет. Единственное — не ломать сигнатуры соседних парсеров.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-02 22:42
---
Фаза 3 (Code) выполнена. parseSpecCommand добавлен в src/bot/commands.ts (интерфейс SpecCommand + функция через unquote; пустой ввод → {error} с подсказкой). Тесты: +3 кейса в commands.test.mjs. Проверки: pnpm build (tsc чистый), команда парсеров 13/13, полный pnpm test 359/359 без регрессий.
---
<!-- COMMENTS:END -->