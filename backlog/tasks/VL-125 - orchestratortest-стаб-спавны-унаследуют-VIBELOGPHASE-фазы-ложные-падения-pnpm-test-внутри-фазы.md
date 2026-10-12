---
id: VL-125
title: 'orchestrator.test: стаб-спавны унаследуют VIBELOG_PHASE_* фазы — ложные падения pnpm test внутри фазы'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 19:27'
updated_date: '2026-10-12 19:27'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Регрессия фикса VL-114: оркестратор кладёт VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME в env фазы, поэтому pnpm test, запущенный агентом ВНУТРИ фазы (стандартный рабочий цикл по AGENTS.md — проверки проекта), унаследовал эти переменные. Стаб-тесты оркестратора spawn'ят заглушки с наследуемым окружением — заглушка видит envPhaseTaskId='VL-117' от родительской фазы, и тесты «startPrompt: задачный env не передаётся»/«close не получает env» и смежные падают ложно.

Инцидент VL-117 (2026-10-12, сессия agent-1791820621047): 4 ложных падения съели ~20 ходов и 10-12 минут чистой диагностики (агент прошел stash-метод, нашёл корень: «в env сессии задан VIBELOG_PHASE_NAME=code — он утекает в стаб-тесты оркестратора») — сама задача (правка агент-промпта) заняла ~4 минуты. VL-116 чинил похожую утечку для CLI/MCP-спавнов в тестах, но стаб-спавны самого orchestrator.test.mjs остались уязвимыми.

Фикс: в before() orchestrator.test.mjs удалить VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME/VIBELOG_CWD из process.env тест-процесса (тестам родительский env не нужен), в after() восстановить. Это делает файл индифферентным к окружению запуска — будь то фаза branch-mode, ручной shell или CI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 orchestrator.test.mjs: VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME/VIBELOG_CWD удаляются из process.env тест-процесса в before() файла и восстанавливаются в after() — стаб-тесты индифферентны к окружению запускающей фазы
- [ ] #2 проверка: прогон pnpm test при установленных VIBELOG_PHASE_TASK_ID=VL-9 и VIBELOG_PHASE_NAME=code (как внутри фазы) — orchestrator.test зелёный, включая тесты «envPhaseTaskId === null»
- [ ] #3 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->