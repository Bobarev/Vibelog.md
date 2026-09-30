---
id: VL-9
title: 'VL-9: CLI search — флаги --status/--type/--priority/--limit'
status: Done
assignee: []
reporter: ''
created_date: '2026-09-30 23:23'
updated_date: '2026-10-01 00:02'
due_date: ''
labels: []
dependencies:
  - VL-8
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
CLI-флаги фильтров для vibelog search (поверх ядра из VL-8).

Изменения:
1. src/cli/commands/search.mjs — флаги --status, --type, --priority, --limit → фильтры в searchTasks(cwd, filters). Сохранить поведение без флагов.
2. src/cli/router.mjs — help команды search: новые флаги.

Зависимость: VL-8 (расширенное ядро searchTasks).
Файлы: src/cli/commands/search.mjs, src/cli/router.mjs, тесты CLI (search --json + флаги).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 vibelog search "query" --status/--type/--priority/--limit фильтруют результаты (каждый флаг проверен тестом)
- [x] #2 Флаги комбинируются с query и --json; без флагов поведение не меняется
- [x] #3 help команды search показывает новые флаги; pnpm test проходит
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: CLI search — флаги фильтров (VL-9)

Зависимость VL-8 выполнена: searchTasks(cwd, filters) принимает объект.

### Файлы для изменения

1. **src/cli/commands/search.mjs** (42 строки, переработка runSearch)
   - Собрать фильтры: query (позиционные, join), status/type/priority (getFlag), limit (getFlag → Number).
   - Валидация limit: если флаг передан, но не число или ≤0 → printError, выход.
   - Валидация «пустого запроса»: ошибка только если НЕТ ни query, ни одного фильтра (текст ошибки — с перечнем флагов).
   - Вызов searchTasks(cwd, filters) — объект вместо строки.
   - Вывод: если query пустой — заголовок «Результаты поиска (фильтры)» со списком активных фильтров; printInfo «ничего не найдено» — учитывать фильтры.
   - --json: без изменений (data: tasks), работает и с фильтрами.

2. **src/cli/router.mjs** (строки 148–151, help search)
   - Шапка: `vibelog search "query" [--status S] [--type T] [--priority P] [--limit N] [--json]`
   - Описание: запрос + фильтры полей; запрос необязателен при наличии хотя бы одного фильтра.

3. **Тесты — новый src/cli/search-cli.test.mjs** (~90 строк, паттерн init-mcp.test.mjs: testDir /tmp/vibelog-search-cli-test, spawnSync со слиянием stdout/stderr, проверка содержимого не exit code)
   - search с query работает (обратная совместимость, без флагов)
   - --status фильтрует; --type + --priority комбинация (AND)
   - --limit обрезает
   - без query и фильтров → ошибка в выводе
   - --json с фильтрами: поле data отфильтровано
   - невалидный --limit → ошибка в выводе

### Порядок действий
1. search.mjs (ядро команды)
2. router.mjs (help)
3. search-cli.test.mjs
4. pnpm test

### Проверки
- pnpm test (все; cli.test.mjs:101 — существующий тест query-режима должен пройти без правок)
- Ручной: /tmp/vl9 — init, задачи, search --status "To Do" --json

### Риски
- query был обязательным — делаем необязательным: обратная совместимость сохраняется (со query всё как раньше)
- limit приходит строкой (getFlag) — парсим Number и валидируем
- Существующий тест cli.test.mjs «search — поиск задач» — не трогаем, query-режим сохраняется
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 00:01
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/cli/commands/search.mjs: флаги --status/--type/--priority/--limit → фильтры searchTasks(cwd, filters). Query необязателен при наличии фильтра; валидация --limit (число > 0); заголовок/сообщения учитывают активные критерии; --json без изменений.
- src/cli/router.mjs: help search — новые флаги, «запрос необязателен при фильтре».
- src/cli/search-cli.test.mjs (новый, 8 тестов): query-режим, каждый фильтр, комбинации, limit, ошибки, --json, help.
В Фазе 3 найден и исправлен скрытый баг роутера (существовал до VL-9): в search передавались сырые args — значения флагов попадали в поисковый запрос (search --status Done искал "Done"); плюс parseArgs кладёт первое слово запроса в subcommand. Теперь роутер передаёт [subcommand, ...positional]. Из-за этого старый вызов search CLI --json тоже искал "CLI json" — регрессия закрыта тестами.
Проверки: pnpm test — 259/259 ✓; node --check ✓; ручной CLI-тест в /tmp ✓.
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->