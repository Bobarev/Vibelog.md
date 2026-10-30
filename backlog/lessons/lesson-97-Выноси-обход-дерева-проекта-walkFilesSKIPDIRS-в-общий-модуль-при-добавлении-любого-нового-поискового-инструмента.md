---
id: lesson-97
title: Выноси обход дерева проекта (walkFiles/SKIP_DIRS) в общий модуль при добавлении любого нового поискового инструмента
status: active
tags:
  - search
  - refactor
  - agent-tools
  - web-chat
source_tasks: []
linked_tasks:
  - VL-234
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

До VL-234 обход файлов проекта (`walkFiles` + `SKIP_DIRS`) жил прямо в `src/agent/tools.ts` рядом с `grep_search`/`glob`. Добавление третьего поискового инструмента (`search_files`) без выноса означало бы вторую копию правил обхода и игнора — и рассинхрон при следующем изменении списка исключённых каталогов (`dist` добавили в VL-234, а старые копии остались бы без него).

Дополнительно: `search_files` нужен в двух слоях (локальный набор агента `src/agent/tools.ts` и веб-чат `src/web/tool-policy.ts`). Копия handler'а в веб-слое дублировала бы и обход, и резолв границ проекта, и кап вывода.

## Решение

При появлении N-го инструмента, которому нужен обход дерева, вынеси обход и список исключаемых каталогов в отдельный модуль (`src/agent/search-files.ts`) и оставь в слоях тонкие обёртки-регистрации:

- `walkFiles(root, limit, { skipDirs })` + `SKIP_DIRS` — единственный экземпляр;
- `searchProjectFiles(cwd, args)` — единственный handler, который переиспользуют и `makeSearchFiles` (агент), и `makeSearchFilesTool` (чат);
- старые инструменты (`grep_search`, `glob`) переводи на тот же walker, не меняя их схему — обратная совместимость с промптами и guard'ом повторов сохраняется.

Слои-обёртки обязаны остаться раздельными: у агента `ToolSpec.handler`, у чата — `ChatLocalTool` с approval-политикой.

## Пример

`src/agent/search-files.ts` (VL-234): `SKIP_DIRS`, `walkFiles`, `isBinaryContent`, `buildSearchRegex`, `formatSearchResults`, `searchProjectFiles`. В `src/agent/tools.ts` — импорт `walkFiles` для `grep_search`/`glob` и `makeSearchFiles`; в `src/web/tool-policy.ts` — `makeSearchFilesTool`. Тест `src/agent/search-files.test.mjs` проверяет поведение модуля один раз, а не дважды через каждый слой.
