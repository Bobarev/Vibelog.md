---
id: VL-183
title: Исправить ошибки backlog_update_task и manage_ac в MCP-слое
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-25 15:35'
updated_date: '2026-10-25 15:49'
due_date: ''
labels:
  - core
  - mcp
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Две ошибки в MCP-слое, проявившиеся при выполнении фазы spec к VL-182. Исправить обе.

1. backlog_update_task падал с «Cannot read properties of undefined (reading 'toLowerCase')», пока type задачи был не определён — обработка пустого/неопределённого type в валидации упала.

2. manage_ac (action=add) с переданным массивом text записывал JSON массива одним критерием вместо добавления каждого элемента отдельным критерием.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 backlog_update_task с неопределённым (отсутствующим) type не падает с «Cannot read properties of undefined (reading 'toLowerCase')» — валидация/дефолт корректны; исправление покрыто тестом
- [ ] #2 manage_ac с action=add и массивом text добавляет каждый элемент отдельным критерием (а не одной JSON-строкой массива); исправление покрыто тестом
- [ ] #3 pnpm test проходит без регрессий: новые и существующие тесты MCP-слоя зелёные
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
created: 2026-10-25 15:36
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (информативный, <80 символов). Масштаб: не определён (описание неполное). Labels: пропущено (описание неполное). References: нет (VL-182 — внутренняя задача-контекст, прочитана для понимания: в её комментарии spec-фазы упомянуты две ошибки: «Cannot read properties of undefined (reading 'toLowerCase')» при backlog_update_task с неопределённым type и запись массива manage_ac add одним JSON-критерием). Жду ответов на вопросы:
### 1. Что именно за ошибка во время фазы spec к VL-182?
- [ ] «Cannot read properties of undefined (reading 'toLowerCase')» при вызове backlog_update_task, пока type задачи не определён
- [ ] Передача массива в manage_ac (action=add) записывает JSON одним критерием вместо нескольких
- [ ] Другая ошибка → 
### 2. Что требуется сделать в этой задаче?
- [ ] Исправить ошибку в коде (баг-фикс в core/агенте)
- [ ] Только описать и задокументировать проблему без исправления
- [ ] Другое → 
### 3. Есть ли дополнительные детали (шаги воспроизведения, полный текст/стек ошибки)?
→ 
### Дополнительные комментарии
→ 
---
author: @agent
created: 2026-10-25 15:49
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Исправить ошибки backlog_update_task и manage_ac в MCP-слое». Масштаб: task (две локальные ошибки в MCP-слое, укладываются в одну задачу). Уточнено по ответам пользователя: (1) воспроизведены ОБЕ ошибки из комментария VL-182 — падение backlog_update_task с «Cannot read properties of undefined (reading 'toLowerCase')» при неопределённом type и запись manage_ac action=add массива как одного JSON-критерия (обе фактически воспроизведены ещё при заполнении этой же задачи — баг подтверждён вживую); (2) цель — исправить обе ошибки в коде; добавлены 3 проверяемых AC. Labels: core, mcp. References: нет. Примечание: баг проявился и на этой фазе — первые вызовы backlog_update_task падали той же ошибкой «toLowerCase», пока type не был записан отдельным вызовом; AC добавлены отдельными вызовами manage_ac (массив в add записывается одним критерием). Вопросов нет.
---
<!-- COMMENTS:END -->