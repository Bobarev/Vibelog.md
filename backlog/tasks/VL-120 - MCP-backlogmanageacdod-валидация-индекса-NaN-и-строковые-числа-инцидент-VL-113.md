---
id: VL-120
title: 'MCP backlog_manage_ac/dod: валидация индекса — NaN и строковые числа (инцидент VL-113)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-12 19:13'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент VL-113 (запись сессии): модель передала manage_ac/manage_dod индекс не того типа — два вызова упали «Неверный индекс: NaN», фаза потеряла ходы на повтор с исправлением (агент потом передал шесть корректных вызовов параллельно).

Решение: валидация на границе MCP-инструмента — index парсить через parseInt (принимать и число, и строку-число); при NaN/пустой/дроби — ошибка с подсказкой формата и текущим количеством пунктов чек-листа, чтобы модель могла исправиться с первого раза.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 сервер: index нормализуется через parseInt — 3 и '3' принимаются; NaN/пусто/дробь → ошибка с подсказкой формата («индекс — целое число, начиная с 1») и текущим количеством пунктов
- [ ] #2 server.test.mjs/mcp-client.test.mjs: кейсы index='3' (успех), 'NaN' и 2.5 (понятная ошибка)
- [ ] #3 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->