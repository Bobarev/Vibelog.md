---
id: VL-28
title: 'Vibelog Web: оркестратор событий — запуск фаз Qwen Code по смене статуса на Kanban-доске'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 11:36'
updated_date: '2026-10-01 11:36'
due_date: ''
labels: []
dependencies:
  - VL-27
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
Реализовать event-driven оркестратор: перемещение карточки на Kanban-доске запускает фазу работы Qwen Code (аналоги /vibelog:spec, /vibelog:plan, /vibelog:code). 1) Расширить статусы конфига: Backlog, Spec, Planned (код уже читает статусы из конфига). 2) Новый эндпоинт POST /api/tasks/:id/trigger — сервер запускает qwen (child_process.spawn) с промптом из templates/qwen-commands/, в промпт подставляется ID задачи, контекст: vibelog task view + комментарии. 3) Qwen по инструкции промпта выполняет фазу, оставляет отчёт через backlog_add_comment и меняет статус. 4) Сервер подхватывает изменения файла задачи и отображает комментарий на доске. Статус-триггеры: Backlog→Spec (Фаза 1), Spec/Planned→In Progress (Фаза 2), In Progress→Review (Фаза 3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Статусы Backlog, Spec, Planned добавлены в backlog/config.yml; Kanban отображает их отдельными колонками
- [ ] #2 POST /api/tasks/:id/trigger приходит с параметром phase (spec|plan|code); сервер запускает qwen через child_process.spawn с промптом из templates/qwen-commands/phase-N.md, подставляя ID задачи
- [ ] #3 После завершения qwen сервер читает обновлённый файл задачи: отчёт-комментарий отображается в вебе, статус меняется согласно инструкции промпта (spec→Planned, plan→In Progress, code→Review)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->