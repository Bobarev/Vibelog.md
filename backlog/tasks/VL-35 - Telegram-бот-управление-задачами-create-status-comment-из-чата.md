---
id: VL-35
title: 'Telegram-бот: управление задачами — /create, /status, /comment из чата'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-02 18:31'
updated_date: '2026-10-02 18:31'
due_date: ''
labels: []
dependencies:
  - VL-34
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
Управление задачами из Telegram-команд. Команды: /create <заголовок> [-d описание] [--priority High|Medium|Low] — создание через createTaskFile; /status <id> <статус> — смена статуса через updateTaskFile; /comment <id> <текст> — комментарий. Бот отвечает подтверждением (ID, статус). Все операции через core-функции — никаких прямых правок файлов. Парсинг аргументов команд — чистые функции (юнит-тесты).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команды: /create <заголовок> — создаёт задачу через createTaskFile; /status <id> <статус> — смена статуса; /comment <id> <текст> — комментарий через addComment; бот отвечает подтверждением с ID задачи
- [ ] #2 Все операции идут через существующие core-функции (createTaskFile, updateTaskFile, addComment) — формат backlog/ не меняется, совместимость с Backlog.md сохранена
- [ ] #3 Тесты: минимум 2 unit-теста (парсинг команд create/status/comment) + pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->