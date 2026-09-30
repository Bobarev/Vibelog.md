---
id: VL-7
title: 'VL-5.2: help --no-mcp + обновление MCP-SETUP.md'
status: To Do
assignee: []
reporter: ''
created_date: '2026-09-30 22:53'
updated_date: '2026-09-30 22:53'
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
- [ ] #1 `vibelog init --help` показывает флаг --no-mcp с описанием
- [ ] #2 MCP-SETUP.md содержит раздел «Автоматическая настройка (vibelog init)» с форматом JSON из VL-5; ручная настройка сохранена как фолбэк
- [ ] #3 Существующие тесты help/CLI проходят (pnpm test)
<!-- AC:END -->