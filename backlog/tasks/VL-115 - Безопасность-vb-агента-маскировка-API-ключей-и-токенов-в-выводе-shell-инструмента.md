---
id: VL-115
title: 'Безопасность vb-агента: маскировка API-ключей и токенов в выводе shell-инструмента'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 14:46'
updated_date: '2026-10-12 14:46'
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
Инцидент VL-113 2026-10-12 (запись сессии agent-1791802592105, tool-вывод ~240 символов): агент выполнил env | grep VIBELOG для диагностики и реальный API-ключ Selectel (VIBELOG_LLM_API_KEY=sk-sl-v1-...) попал в stdout → осел в jsonl-транскрипте на диске → при resume этот ключ уйдёт в контекст модели. Транскрипты читаются многими процессами и копируются — ключ фактически утёк.

Решение: маскировка на стороне tools.ts (единая точка вывода модели) — значения переменных с именами, содержащими API_KEY/TOKEN/SECRET/PASSWORD, заменяются на *** в stdout/stderr перед возвратом. Плюс запрет «не выводи env целиком» в базовом промпте vb (templates/agent-prompt.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tools.ts: run_shell_command (и другие инструменты с текстовым выводом) маскирует значения переменных, чьи имена содержат API_KEY, TOKEN, SECRET, PASSWORD — вместо значения подставляется ***
- [ ] #2 тест tools.test: вывод команды с VIBELOG_LLM_API_KEY содержит *** и НЕ содержит реальное значение; обычный вывод без секретов не меняется
- [ ] #3 templates/agent-prompt.md: правило не выводить env целиком (только printenv <имя_переменной> по необходимости)
- [ ] #4 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->