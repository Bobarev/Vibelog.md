---
id: VL-36
title: 'Telegram-бот: уведомления — fs.watch на backlog/, события задач и комментариев'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-02 18:32'
updated_date: '2026-10-02 18:32'
due_date: ''
labels: []
dependencies:
  - VL-34
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Событийные уведомления: бот следит за backlog/ (fs.watch на tasks/) и шлёт в привязанный чат: новая задача (создана), смена статуса (To Do → In Progress), новый комментарий. Дедупликация: не слать повторно при нескольких изменениях одного файла подряд. Отправка через Telegram Bot API (sendMessage). Только в чаты с /start. Ошибки сети — retry с backoff, процесс не падает.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Бот отслеживает изменения backlog/ (fs.watch или polling) и отправляет уведомления в привязанный чат: новая задача, смена статуса, новый комментарий
- [ ] #2 Уведомления содержат ID и заголовок задачи; отправка только в чаты, привязанные через /start; ошибки отправки не роняют процесс
- [ ] #3 Тесты: парсинг событий из изменений файлов (unit) + pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->