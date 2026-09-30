---
id: VL-7
title: 'VL-5.2: help --no-mcp + обновление MCP-SETUP.md'
status: Done
assignee: []
reporter: ''
created_date: '2026-09-30 22:53'
updated_date: '2026-09-30 23:10'
due_date: ''
labels: []
dependencies:
  - VL-6
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
Документация и справка для MCP-автонастройки (после VL-6):

1. src/cli/router.mjs — в help-текст команды init добавить --no-mcp (по аналогии с --no-skills).

2. MCP-SETUP.md — обновить:
   - раздел «Настройка в Qwen Code» → «Автоматическая настройка» через `vibelog init` (секция mcpServers пишется сама; перезапуск Qwen Code; проверка через /mcp);
   - текущий вариант с `qwen mcp add` сохранить как альтернативу;
   - ручной JSON-формат — как в описании VL-5 (command vibelog, trust: true);
   - обновить таблицу инструментов (16 инструментов, milestone_* и type).

Зависимость: VL-6 (flag --no-mcp и сама функциональность).
Файлы: src/cli/router.mjs, MCP-SETUP.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vibelog init --help` показывает флаг --no-mcp с описанием
- [x] #2 MCP-SETUP.md содержит раздел «Автоматическая настройка (vibelog init)» с форматом JSON из VL-5; ручная настройка сохранена как фолбэк
- [x] #3 Существующие тесты help/CLI проходят (pnpm test)
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: VL-5.2 — help --no-mcp + MCP-SETUP.md (VL-7)

Зависимость VL-6 выполнена: --no-mcp реализован в init.mjs.

### Файлы для изменения

1. **src/cli/router.mjs** (help-текст init, строки 120–128)
   - Строка 120 (шапка): добавить `[--no-mcp]`:
     `vibelog init [name] [--prefix LB] [--skills[=qwen]] [--no-skills] [--no-mcp] [--force]`
   - После строки 127 (`--no-skills`) добавить строку:
     `  --no-mcp   — не настраивать MCP-сервер (.qwen/settings.json)`

2. **MCP-SETUP.md** (80 строк, переработка двух секций)
   - Таблица инструментов (строки 11–20): расширить с 6 до 16 — добавить v1.1 (backlog_update_task, backlog_manage_ac, backlog_manage_dod, backlog_add_comment, backlog_update_dependencies) и v1.3 (milestone_list/add/rename/remove/archive); в описаниях create/list/update упомянуть параметр type. Сверить с фактическим listTools() через node --input-type=module -e.
   - Секция «Настройка в Qwen Code» (19–51):
     - «Автоматическая настройка (vibelog init)» — основной путь: init сам пишет mcpServers.vibelog в .qwen/settings.json (JSON из VL-5: command vibelog, args [mcp start], trust true); перезапуск Qwen Code; проверка через /mcp; отключение --no-mcp.
     - «Альтернатива: qwen mcp add» — сохранить текущий вариант (строки 21–26).
     - «Ручная настройка» — JSON в формате VL-5 как основной; вариант с node /путь/к/vibelog.mjs как фолбэк, если vibelog не в PATH.
   - Секция «Автоматическая инициализация» (63–70): добавить, что init также настраивает MCP (кросс-ссылка, --no-mcp).

3. **src/cli/init-mcp.test.mjs** — +1 тест: `runCli('init', '--help')` вывод содержит `--no-mcp` (подстрока, не точный формат — защита от хрупкости).

### Порядок действий
1. router.mjs — help init
2. init-mcp.test.mjs — тест help
3. MCP-SETUP.md — таблица + секции настройки
4. Сверка таблицы с listTools() (node -e)
5. pnpm test

### Проверки
- pnpm test (все)
- Ручной: node bin/vibelog.mjs init --help → виден --no-mcp

### Риски
- Таблица инструментов в docs может разойтись с кодом — сверять по listTools() перед коммитом
- Тест help хрупок — проверяем только подстроку `--no-mcp`
- README.md не трогаем (вне AC; при желании — отдельной задачей)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-09-30 23:10
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/cli/router.mjs: help init — [--no-mcp] в шапке + описание флага (строка --no-mcp — не настраивать MCP-сервер).
- MCP-SETUP.md: таблица инструментов расширена с 6 до 16 (v1.1 + milestone_*), сверена с listTools(); тип type упомянут для create/list/update. Секция «Настройка в Qwen Code»: основной путь — автонастройка через vibelog init (JSON из VL-5: command vibelog, args [mcp start], trust true), qwen mcp add — альтернатива, ручной JSON — фолбэк с вариантом node /путь (если vibelog не в PATH); кросс-ссылка в секции «Автоматическая инициализация».
- src/cli/init-mcp.test.mjs: +1 тест — init --help содержит --no-mcp.
Проверки: pnpm test — 236/236 ✓; node --check ✓; ручной init --help ✓; сверка таблицы docs с listTools() (16=16) ✓.
VL-5 (Init не добавляет mcp) закрыт: VL-6 + VL-7 Done.
---
<!-- COMMENTS:END -->