---
id: VL-21
title: 'VL-21: docs/cli-reference.md + mcp-reference.md + навигация README'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 01:57'
updated_date: '2026-10-01 02:09'
due_date: ''
labels: []
dependencies:
  - VL-20
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
Справочники CLI и MCP + навигация по документации (замыкает документационный эпик).

Файлы:
1. docs/cli-reference.md (~250 строк): таблицы/списки всех команд, подкоманд, флагов с описаниями. Источник истины — help-тексты router.mjs (сверять через запуск help, не копировать вслепую).
2. docs/mcp-reference.md (~200 строк): 21 инструмент, inputSchema в таблицах (параметр/тип/required/описание), пример JSON-RPC вызова. Источник — listTools().
3. README.md: сводный раздел «Документация» — ссылки на все 5 доков (user-guide, best-practices, cli-reference, mcp-reference, MCP-SETUP).

Зависимость: VL-19 (навигация ссылками на уже созданный user-guide); best-practices ссылается из README — учитывать наличие VL-20 (ссылки добавлять после создания файлов — порядок: VL-19 → VL-20 → VL-21).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/cli-reference.md: все CLI-команды (init/task/board/search/browser/instructions/mcp/milestone/doc/config/draft/decision/doctor) с подкомандами и ВСЕМИ флагами — сверено с help (node bin/vibelog.mjs <cmd> --help), без выдуманных флагов
- [x] #2 docs/mcp-reference.md: все 21 MCP-инструмент с параметрами/типами/required — сверено с listTools() (node --input-type=module -e); пример вызова каждого инструмента
- [x] #3 README.md: раздел «Документация» со ссылками на user-guide, best-practices, cli-reference, mcp-reference, MCP-SETUP; нигде нет битых ссылок
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: cli-reference + mcp-reference + навигация (VL-21)

1. **Источники истины**:
   - CLI: полный дамп help — `node bin/vibelog.mjs <cmd> --help` для всех 13 команд (init, task, board, search, browser, instructions, mcp, milestone, doc, config, draft, decision, doctor) + общий help
   - MCP: `node --input-type=module -e "import {listTools}..." ` — имена, descriptions, inputSchema всех 21 инструмента

2. **Создать docs/cli-reference.md** (~250 строк): по команде — синтаксис, подкоманды, таблица флагов (флаг/описание), примечания. Сверять с help, не выдумывать.

3. **Создать docs/mcp-reference.md** (~200 строк): по инструменту — описание, таблица параметров (параметр/тип/required), пример JSON-RPC tools/call.

4. **README.md**: сводный раздел «Документация» — ссылки user-guide, best-practices, cli-reference, mcp-reference, MCP-SETUP (порядок: VL-19 уже добавил user-guide — дополнить остальными).

5. **Проверки**: node-скрипт ссылок (все пути существуют); pnpm test; выборочная сверка справки с help (grep пары флагов).

Риски: 21 инструмент — не пропустить при генерации (сверять count со listTools()); таблицы длинные — писать скелетом через write_file.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 02:09
---
Фаза 3 завершена. 3/3 AC. Документационный эпик VL-19..VL-21 закрыт.
- docs/cli-reference.md (246 строк): 13 команд, подкоманды, таблицы всех флагов — сверено с дампом help (включая --check-ac N[,N], --no-dod-defaults и др.).
- docs/mcp-reference.md (220 строк): 21 инструмент, таблицы параметров/required по listTools(), примеры JSON-RPC вызовов.
- README.md: раздел «Документация» — ссылки на все 5 доков; исправлен устаревший mcp_tools_count: 11 → 21 в примере doctor.
Проверки: node-скрипт ссылок (битых нет), pnpm test без падений, выборочная сверка с help/listTools.
Итог эпика: 4 дока, 984 строки; навигация README ↔ docs.
---
<!-- COMMENTS:END -->