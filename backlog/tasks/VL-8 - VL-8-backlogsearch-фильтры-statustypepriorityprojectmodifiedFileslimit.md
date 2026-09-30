---
id: VL-8
title: 'VL-8: backlog_search — фильтры status/type/priority/project/modifiedFiles/limit'
status: Done
assignee: []
reporter: ''
created_date: '2026-09-30 23:23'
updated_date: '2026-09-30 23:51'
due_date: ''
labels: []
dependencies: []
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
Расширить backlog_search фильтрами из оригинала Backlog.md (task_search).

Оригинальная схема (../Backlog.md/src/mcp/utils/schema-generators.ts, generateTaskSearchSchema): query, status, type, project, priority, modifiedFiles (массив строк, подстрока case-insensitive по modified_files), limit (1–100). Всё optional (required: []).

Изменения:
1. src/core/search.mjs — searchTasks(cwd, filters): query + фильтры status/type/priority/project/modifiedFiles/limit. AND-семантика, case-insensitive (как в toolListTasks).
2. src/mcp/tools.mjs — схема backlog_search (все поля optional, query maxLength 200, limit minimum 1 maximum 100); toolSearch применяет фильтры, вывод расширяется: id, title, status, priority, type, project, labels, milestone.

Файлы: src/core/search.mjs, src/mcp/tools.mjs, тесты (новый src/mcp/search-filters.test.mjs или дополнить существующие).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backlog_search принимает фильтры status, type, priority, project, modifiedFiles, limit (query опционален — как в оригинале Backlog.md); каждый фильтр проверен тестом
- [x] #2 Фильтры комбинируются (AND), сравнение case-insensitive; modifiedFiles — подстрока по modified_files задачи; limit 1–100 обрезает выдачу
- [x] #3 Обратная совместимость: вызов только с query работает как раньше; вывод расширен (type, project, labels, milestone); pnpm test проходит
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: backlog_search — расширенные фильтры (VL-8)

### Файлы для изменения

1. **src/core/search.mjs** (44 строки, переписать searchTasks)
   - Новая сигнатура: `searchTasks(cwd, filters = {})` — объект {query, status, type, priority, project, modifiedFiles, limit}.
   - Обратная совместимость: строковый второй аргумент → `{query: строка}` (CLI search.mjs:27 передаёт строку — не ломаем до VL-9).
   - Фильтры AND, case-insensitive (по образцу toolListTasks):
     1. query — как сейчас (id/title/description/labels substring); пустой → без текстового фильтра
     2. status — равенство lowercase
     3. type — равенство lowercase (поле t.type)
     4. priority — равенство lowercase
     5. project — равенство lowercase
     6. modifiedFiles — массив строк: задача проходит, если ХОТЯ БЫ ОДИН путь из t.modified_files содержит хотя бы один фильтр как подстроку (lowercase); пустой modified_files → не проходит
     7. limit — slice(0, limit), limit > 0

2. **src/mcp/tools.mjs**
   - Схема backlog_search (строки 177–186): description → «Поиск задач с фильтрами (query, status, type, project, priority, modifiedFiles, limit)»; properties: query (string, maxLength 200), status (string), type (string), project (string), priority (string), modifiedFiles (array of string), limit (number, minimum 1, maximum 100); убрать `required: ['query']` (required: [] — как оригинал).
   - toolSearch (строки 626–635): `searchTasks(cwd, {query: args.query, status: args.status, type: args.type, project: args.project, priority: args.priority, modifiedFiles: args.modifiedFiles, limit: args.limit})`; вывод расширить: id, title, status, priority, type, project, labels, milestone.

3. **Тесты — новый src/mcp/search-filters.test.mjs** (~120 строк, паттерн v11.test.mjs, in-process handleToolCall + createTaskFile)
   - Каждый фильтр отдельно + комбинации (query+status+type)
   - limit обрезает выдачу
   - modifiedFiles: совпадение подстроки, case-insensitive, несовпадение не проходит
   - Обратная совместимость: searchTasks(cwd, 'строка') — строковый аргумент
   - Вызов MCP без query (только фильтры) работает
   - Вывод содержит type/project/labels/milestone

### Порядок действий
1. core/search.mjs (ядро + строковый фолбэк)
2. tools.mjs (схема + toolSearch)
3. search-filters.test.mjs
4. pnpm test

### Проверки
- pnpm test (все)
- Ручной: node --input-type=module -e "import {handleToolCall}..." вызов backlog_search со статусом в тестовом каталоге

### Риски
- Снятие required ['query'] — намеренно (фича, как в оригинале); прежние вызовы с query работают
- CLI search.mjs передаёт строку — строковый fallback в searchTasks обязателен (иначе сломается CLI до VL-9)
- priority в файлах хранится lowercase (task.mjs пишет priority.toLowerCase()) — сравнение через toLowerCase корректно
- modified_files парсится как массив или одиночная строка (task.mjs:259) — фильтр нормализует до массива
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-09-30 23:51
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/core/search.mjs: searchTasks(cwd, filters) — фильтры query/status/type/priority/project/modifiedFiles/limit (AND, case-insensitive). Строковый второй аргумент = query (обратная совместимость с CLI search.mjs). modifiedFiles — подстрока по modified_files задачи (нормализация одиночной строки в массив).
- src/mcp/tools.mjs: схема backlog_search — все поля optional (как required: [] в оригинале task_search), query maxLength 200, limit 1–100; toolSearch передаёт фильтры, вывод расширен: + type, project, labels, milestone.
- src/mcp/search-filters.test.mjs (новый, 15 тестов): каждый фильтр, комбинации, limit, modifiedFiles, строковый фолбэк, вызов MCP без query.
- src/core/compat-full.test.mjs: compat-тест обновлён — вместо «query обязателен» проверяется соответствие оригиналу (все 7 параметров, query опционален).
Проверки: pnpm test — 251/251 ✓; node --check ✓; ручной MCP-вызов (фильтр status+limit без query; modifiedFiles) ✓.
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->