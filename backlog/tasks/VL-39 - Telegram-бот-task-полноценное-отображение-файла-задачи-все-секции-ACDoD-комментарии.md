---
id: VL-39
title: 'Telegram-бот: /task — полноценное отображение файла задачи (все секции, AC/DoD, комментарии)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-02 20:51'
updated_date: '2026-10-02 20:51'
due_date: ''
labels: []
dependencies: []
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
Уточнение Pavel (2026-10-02): /task VL-34 показывает только summary-карточку. Нужно полноценное отображение markdown-файла задачи в чате: все заполненные секции (описание, Implementation Plan, Implementation Notes, Final Summary), чек-листы AC/DoD с отметками, комментарии (автор + дата + текст). Формат — MarkdownV2 (как VL-38). Учёт лимита 4096 символов на сообщение — разбивка по секциям/частям. Секции без данных не показывать.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда /task <id> показывает карточку задачи полноценно: заголовок, статус/приоритет/исполнителей/метки/срок, секции Implementation Plan и Implementation Notes (если заполнены), комментарии — каждая секция с собственным заголовком
- [ ] #2 Длинные секции разбиваются на несколько сообщений (лимит Telegram 4096 символов); спецсимволы MarkdownV2 в контенте экранированы
- [ ] #3 Юнит-тесты разбивки на части + pnpm test без регрессий; ручная проверка в Telegram на VL-34 (есть plan/notes) и VL-25 (много комментариев)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->