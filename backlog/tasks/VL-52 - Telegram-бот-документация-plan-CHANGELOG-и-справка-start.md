---
id: VL-52
title: 'Telegram-бот: документация /plan — CHANGELOG и справка /start'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:46'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies:
  - VL-51
milestone: v1.6
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
Документация фичи /plan: 1) CHANGELOG.md — запись в [Unreleased]/«Добавлено» (аналог записей VL-35/39/34); 2) справка команд в обработчике /start (src/bot/handlers.ts) — сейчас «Команды: /tasks, /task <id>, /board» устарела (нет /create, /status, /comment, /spec), обновить полный список с учётом /plan.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CHANGELOG.md, раздел [Unreleased] → «Добавлено»: запись про /plan (команда запуска Фазы 2 Plan через headless qwen для существующей задачи, по аналогии с /spec)
- [x] #2 Справка в ответе /start (src/bot/handlers.ts) обновлена: полный актуальный список команд бота, включая /plan <id>
- [x] #3 pnpm build и pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 00:05
---
Фаза 3 (Code) выполнена. 1) CHANGELOG.md: запись VL-51 в [Unreleased] → «Добавлено» (строка 12, после VL-34). 2) Справка команд в handlers.ts обновлена в двух местах: «Чат уже привязан» (строка 123) и «Чат привязан ✅» (строка 353) — полный список: /tasks, /task, /board, /create, /status, /comment, /spec, /plan. Ловушка: первый guard !includes('/plan') сработал на существующей строке VL-28 («spec/plan/code») — фикс по якорю VL-34-записи. Проверки: pnpm build чистый, pnpm test 370/370.
---
<!-- COMMENTS:END -->