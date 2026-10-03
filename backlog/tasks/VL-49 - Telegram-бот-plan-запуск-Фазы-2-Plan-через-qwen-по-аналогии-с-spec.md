---
id: VL-49
title: 'Telegram-бот: /plan — запуск Фазы 2 (Plan) через qwen (по аналогии с /spec)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:42'
updated_date: '2026-10-03 02:37'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Telegram-бот: /plan — запуск Фазы 2 (Plan) через qwen (по аналогии с /spec)
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-02 23:46
---
Фаза 1 (Spec) выполнена. Созданы задачи: VL-50 — парсер команды /plan (parsePlanCommand в src/bot/commands.ts + тесты); VL-51 — обработчик bot.command('plan') в src/bot/handlers.ts (requireBind → parsePlanCommand → проверка существования задачи через getTask → startPhase(cwd, id, 'plan', onExit) с уведомлением о завершении по паттерну VL-48); VL-52 — документация (CHANGELOG [Unreleased] + актуализация справки команд в /start). Краткое описание разбиения: в отличие от /spec (создаёт задачу из описания фичи), команда /plan принимает ID существующей задачи и запускает Фазу 2 (Plan) через headless qwen — оркестратор src/web/orchestrator.ts уже поддерживает фазу 'plan' (шаблон templates/qwen-commands/phase-2.md, guard от двойного запуска, onExit-колбэк VL-48), поэтому spawn-логика не дублируется. Зависимости последовательные: VL-51 зависит от VL-50 (парсер), VL-52 от VL-51 (доки после реализации). Бонус-находка: справка команд в /start (handlers.ts:120) устарела ещё с /create, /status, /comment, /spec — VL-52 закрывает это.
---
<!-- COMMENTS:END -->