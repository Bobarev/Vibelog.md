---
id: VL-128
title: Сократить кнопки в команде tasks до 5 в ряду
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 22:24'
updated_date: '2026-10-12 22:54'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/rich.ts
  - src/bot/rich.test.mjs
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#bot по команде tasks сейчас внизу выводится ряд из 8 кнопок, надо сократить до 5 в ряду, так как на них не видно текста.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План VL-128: сократить кнопки /tasks до 5 в ряду

## Контекст

Кнопки /tasks рендерятся в renderTasksRich (src/bot/rich.ts) и дробятся на ряды по BUTTONS_PER_ROW = 8 (строка 33) — это лимит Telegram (RICH_MESSAGE_BUTTONS_TOO_MANY при больших рядах). При 8 кнопках в ряду подписи-ID (VL-128) узкие и текст не виден.

Архитектурное решение: не менять BUTTONS_PER_ROW (жёсткий лимит спецификации Telegram, используется и в renderDocsRich), а ввести отдельную константу TASK_BUTTONS_PER_ROW = 5 рядом с ней: 5 меньше 8, поэтому фикс RICH_MESSAGE_BUTTONS_TOO_MANY (VL-82) сохраняется; /docs не трогаем — задача только про /tasks.

## Файлы для изменения

### 1. src/bot/rich.ts

- Строка 33 и ниже — после export const BUTTONS_PER_ROW = 8; добавить константу TASK_BUTTONS_PER_ROW = 5 с JSDoc (VL-128: при 8 в ряду подписи-ID не видны). В JSDoc BUTTONS_PER_ROW (строки 26-32) уточнить, что это лимит Telegram, а TASK_BUTTONS_PER_ROW — UI-лимит для /tasks.
- Строка 385 (JSDoc renderTasksRich) — «дробятся по BUTTONS_PER_ROW=8» заменить на «дробятся по TASK_BUTTONS_PER_ROW=5 (VL-128; Telegram-лимит 8 остаётся верхней границей)».
- Строки 432-440 (цикл дробления) — заменить BUTTONS_PER_ROW на TASK_BUTTONS_PER_ROW в i += и slice(i, i + ...); обновить комментарий: 5 в ряду — читаемость подписей, лимит Telegram 8 не превышается.
- renderDocsRich (строки 450, 469-473) — не менять, там остаётся BUTTONS_PER_ROW.

### 2. src/bot/rich.test.mjs

- Тест «больше 8 кнопок → несколько tg-button-row по ≤8 кнопок» (строки 535-549) — переименовать («больше 5 кнопок → ряды по ≤5 (TASK_BUTTONS_PER_ROW, VL-128)»), в цикле проверки count <= 8 заменить на count <= 5, комментарий «(8 + 2)» заменить на «(5 + 5)» (10 задач → 2 ряда, число рядов не меняется).
- Тест «ровно 8 кнопок → один ряд» (строки 551-554) — ожидание ломается: 8 кнопок теперь 2 ряда (5+3). Заменить на «ровно 5 кнопок → один ряд» (5 кнопок → 1 tg-button-row) и добавить «6 кнопок → 2 ряда (5+1)».
- Тесты renderDocsRich про ряды (строки 657-664) — без изменений (проверяют BUTTONS_PER_ROW).
- Тест «tg-button-row: data task:VL-N» (строка 491) — одна кнопка, не задет.

## Порядок действий

1. src/bot/rich.ts: константа, JSDoc, цикл renderTasksRich.
2. src/bot/rich.test.mjs: два теста (переименование + ожидания).
3. Сборка и тесты.
4. CHANGELOG.md — в Фазе Close (по регламенту VL-126 Фаза 3 CHANGELOG не трогает).

## Проверка

- pnpm build
- pnpm test (build + node --test src; особенно rich.test.mjs)
- node --test src/bot/rich.test.mjs — точечно

Ручная верификация в браузере не нужна — это Telegram-бот, рендер — чистая функция, проверяется юнит-тестами. Опционально в живом Telegram: /tasks с более чем 5 задачами → ряды по 5.

## Риски

- Низкий: тест «ровно 8 кнопок → один ряд» сломается — он в списке правок заранее.
- Низкий: если позже захочется 5 в ряду и для /docs — правка в renderDocsRich отдельной задачей (сейчас вне scope).
- Тексты и данные кнопок (task:id, стили по типу) не меняются — поведение callback-ветки task: (handlers.ts:979) не затрагивается.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 22:25
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Сократить кнопки в команде tasks до 5 в ряду». Масштаб: task. Уточнено: заголовок сокращён (оригинальный был обрезан), тип task, добавлены критерии приёмки (максимум 5 кнопок в ряду, текст подписей виден полностью, состав и поведение кнопок не меняются). Вопросов нет.
---
author: @agent
created: 2026-10-12 22:34
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 2 файла (src/bot/rich.ts — новая константа TASK_BUTTONS_PER_ROW = 5 и использование её в цикле дробления renderTasksRich, строки 33/385/432-440; src/bot/rich.test.mjs — обновление двух тестов дробления рядов, строки 535-554). Архитектурное решение: BUTTONS_PER_ROW=8 не менять (жёсткий лимит Telegram, используется renderDocsRich) — ввести отдельную UI-константу 5 для /tasks; 5 < 8, фикс RICH_MESSAGE_BUTTONS_TOO_MANY (VL-82) сохраняется. Проверка: pnpm build && pnpm test. Риски: низкий — тест «ровно 8 кнопок → один ряд» сломается (предусмотрен в плане); /docs и callback-ветка task: не затрагиваются.
---
author: @agent
created: 2026-10-12 22:39
---
Фаза 3 (Code) выполнена. Изменено: src/bot/rich.ts (новая константа TASK_BUTTONS_PER_ROW = 5 с JSDoc; цикл дробления в renderTasksRich переведён на неё; JSDoc renderTasksRich обновлён; BUTTONS_PER_ROW=8 не менялся — остаётся лимитом Telegram, renderDocsRich не тронут), src/bot/rich.test.mjs (тест дробления переименован и обновлён под ≤5 в ряду; тест «ровно 8 → один ряд» заменён на «ровно 5 → один ряд» + новый тест «6 кнопок → 2 ряда (5+1)»). Коммит 8ffb34d. Проверки: pnpm build + pnpm test (полный прогон node --test src) — все тесты проходят, включая rich.test.mjs. Что осталось: DoD «Документация обновлена» — CHANGELOG.md обновит Фаза Close по регламенту VL-126.
---
author: @agent
created: 2026-10-12 22:45
---
Доработка по фидбэку: подпись кнопки /tasks теперь только номер без префикса «VL-» (label = id.split('-').pop(), src/bot/rich.ts) — «128» вместо «VL-128». Callback data остался полным task:VL-N, ветка task: в handlers.ts не меняется. Тест подписи кнопки обновлён (rich.test.mjs). Проверки: pnpm build + pnpm test — 867/867 проходят. Коммит 356d575.
---
author: @agent
created: 2026-10-12 22:54
---
Фаза Close выполнена. Ветка vb/vl-128 слита в master (2 коммита: 8ffb34d feat — дробление рядов по TASK_BUTTONS_PER_ROW=5, 356d575 fix — подпись кнопки только номер без «VL-»; merge-коммит 2104236), сборка и тесты после merge в главном репо проходят (pnpm build + pnpm test — все зелёные). Worktree .vibelog/worktrees/vl-128 удалена (--force: только untracked-симлинки node_modules/refs от оркестратора), ветка vb/vl-128 удалена. DoD: 3/3 — «Тесты проходят» ✓, «Нет регрессий» ✓ (были отмечены ранее), «Документация обновлена» ✓ (CHANGELOG.md — запись в Unreleased; backlog/docs/doc-6 «Руководство пользователя» — абзац /tasks: ряды по 5, подпись без префикса, лимит Telegram 8 и /docs не менялись; docs-коммит c94b37d). Статус — Done.
---
<!-- COMMENTS:END -->