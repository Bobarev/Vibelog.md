---
id: VL-38
title: 'Telegram-бот: форматирование сообщений MarkdownV2 (parse_mode + экранирование)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 20:39'
updated_date: '2026-10-02 20:50'
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
Ответы бота отправляются без форматирования. Применить Telegram MarkdownV2 (parse_mode) ко всем ответам: жирные ID/заголовки/метки, статусы в скобках. Динамический текст из backlog (заголовки, описания, статусы) может содержать спецсимволы MarkdownV2 — обязана экранироваться (escapeMarkdownV2). При ошибке парсинга (400 can't parse entities) — фолбэк на plain-text повтор. Форматирование — в formatting.ts (чистые функции, юнит-тесты обновить).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все ответы бота отправляются с parse_mode MarkdownV2; динамический текст (id, заголовки, статусы, описания) экранируется функцией escapeMarkdownV2 (спецсимволы _ * [ ] ( ) ~ ` > # + - = | { } . !)
- [x] #2 Форматирование: /tasks — жирный ID + статус в скобках; /task — жирный заголовок, жирные метки Статус/Приоритет/Исполнители/Метки/Срок; /board — жирные названия колонок. Фолбэк: при ошибке парсинга — повтор без parse_mode
- [x] #3 Юнит-тесты обновлены под MarkdownV2-вывод + pnpm test без регрессий; ручная проверка в Telegram — форматирование видно
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->