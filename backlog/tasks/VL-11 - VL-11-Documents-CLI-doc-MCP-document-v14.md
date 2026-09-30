---
id: VL-11
title: 'VL-11: Documents — CLI doc + MCP document_* (v1.4)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 00:27'
updated_date: '2026-10-01 00:41'
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
Documents (P1, v1.4) — markdown-документы для спецификаций/гайдов в backlog/docs/. Оригинал: CLI doc create/update/list/search/view + MCP document_* (5 инструментов, src/mcp/tools/documents/).

Формат файла (по Document в types/index.ts оригинала): YAML-фронтматтер id, title, type (spec|readme|guide|other), created_date, tags[] + markdown-тело (rawContent).

Реализация:
1. src/core/document.mjs — модель (по образцу milestone.mjs): write/read/list/search, slug-имена, типы.
2. src/cli/commands/doc.mjs — runDoc: create <title> [-t type] [--tags], list [--type], view <id>, update <id> [--title/--tags/--content-file?], search <query>.
3. src/cli/router.mjs — case 'doc' + help.
4. src/mcp/tools.mjs — +5 document_* (listTools + handleToolCall + хендлеры).
5. src/cli/commands/doctor.mjs — счётчик 16→21 + имена; тесты diagnostics/compat-full/server/v11 — 16→21.
6. Тесты: src/mcp/documents.test.mjs (CLI+MCP).

Внимание: чек-лист памяти «MCP tool count» — 5 файлов со счётчиками при добавлении инструментов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLI: doc create/list/view/update/search работают (файлы backlog/docs/<id>-<slug>.md с YAML-фронтматтером: id, title, type, created_date, tags)
- [x] #2 MCP: +5 инструментов document_list/view/create/update/search зарегистрированы в tools.mjs и отвечают; счётчики MCP обновлены (doctor.mjs, diagnostics/compat-full/server/v11 тесты — чек-лист из памяти)
- [x] #3 Тесты CLI+MCP проходят; round-trip markdown сохраняется; pnpm test зелёный
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: Documents — CLI doc + MCP document_* (VL-11)

### Файлы для изменения/создания

1. **Создать src/core/document.mjs** (~90 строк, по образцу milestone.mjs)
   - DOCUMENT_TYPES = ['readme', 'guide', 'specification', 'other'] — строго как оригинал
   - documentFilename(id, title) → `<id>-<slug>.md` (slug по правилам milestoneFilename)
   - createDocument/documentToMarkdown/markdownToDocument — frontmatter: id, title, type, created_date, tags[] + тело (rawContent)
   - writeDocument(backlogDir, input) — генерит следующий id doc-N (max+1), запись в backlog/docs/
   - listDocuments(backlogDir, opts), getDocument(backlogDir, id) — поиск по id case-insensitive
   - updateDocument(backlogDir, id, updates)
   - searchDocuments(backlogDir, query) — substring по id/title/tags/телу

2. **Создать src/cli/commands/doc.mjs** (~110 строк) — runDoc(subcommand, positional, flags, cwd)
   - create <title> [--type T] [--tags a,b] — валидация типа (case-insensitive → канонический), printSuccess
   - list [--type T] — таблица id/title/type/date
   - view <id> — frontmatter + тело
   - update <id> [--title ...] [--type ...] [--tags ...]
   - search <query> — совпадения

3. **Обновить src/cli/router.mjs** — case 'doc' → runDoc + help (main help + showCommandHelp)

4. **Обновить src/mcp/tools.mjs** (+5 инструментов, 16→21)
   - document_list (query опционален, required []) — как оригинал
   - document_view (required: [id])
   - document_create (required: [title, content], опц. type/tags)
   - document_update (required: [id], title/content/type/tags)
   - document_search (required: [query])
   - Схемы + case в handleToolCall + хендлеры (использовать core/document.mjs)

5. **Счётчики MCP 16→21 — 5 файлов (чек-лист памяти, пропуск = 5 падений)**
   - src/cli/commands/doctor.mjs: expected = 21 + имена document_* в checkMcpToolsList
   - src/cli/diagnostics.test.mjs: assert mcp_tools_count = 21
   - src/core/compat-full.test.mjs: listTools() = 21 + имена в expected
   - src/mcp/server.test.mjs: tools/list = 21
   - src/mcp/v11.test.mjs: listTools() = 21

6. **Тесты — создать src/mcp/documents.test.mjs** (~150 строк)
   - MCP: create (в т.ч. невалидный type → ошибка), list, view, update, search, create без type
   - CLI: doc create/list/view/update/search через runCli (spawnSync, /tmp/vibelog-doc-test)
   - Round-trip: markdownToDocument(documentToMarkdown())
   - listTools().length === 21

### Порядок действий
1. core/document.mjs
2. cli/commands/doc.mjs + router.mjs
3. tools.mjs (+5)
4. Счётчики 16→21 (5 файлов)
5. Тесты documents.test.mjs
6. pnpm test + ручной прогон в /tmp

### Проверки
- node --check всех изменённых файлов
- pnpm test (все)
- Ручной: /tmp/vl11 — doc create/list/view/search

### Риски
- Счётчики MCP в 5 файлах — обязательно обновить все (чек-лист из памяти VL-3)
- Типы — строго из списка оригинала; невалидный type → ошибка (как normalizeTaskType)
- Имена файлов с кириллицей — slug-транслитерация по правилам milestoneFilename (проверено на v1.3)
- Подкаталоги в docs/ оригинала упрощаем до плоских файлов — отклонение от оригинала, приемлемое для v1.4 (совместимость по данным, не по размещению)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 00:40
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/core/document.mjs (новый): DOCUMENT_TYPES = readme/guide/specification/other (как оригинал), id doc-N, frontmatter id/title/type/created_date/tags + markdown-тело; write/list/get/update/search; normalizeDocumentType case-insensitive; created_date по умолчанию = сегодня (исправлено в Фазе 3 — при ручном тесте обнаружен пустой created_date).
- src/cli/commands/doc.mjs (новый): create [--type/--tags] / list [--type] / view / update / search.
- src/cli/router.mjs: case 'doc' + help (main + command).
- src/mcp/tools.mjs: +5 document_* (list с опциональным query как required [] в оригинале, view, create required [title, content], update, search) — итого 21 инструмент.
- Счётчики 16→21 обновлены во всех 5 файлах (doctor, diagnostics, compat-full, server, v11) — чек-лист соблюдён.
- src/mcp/documents.test.mjs (новый, 11 тестов): MCP CRUD + валидация типа, CLI-сценарий, round-trip, listTools()=21.
Замечания:
- Валидация типа строгая как у оригинала: 'spec' отклоняется, канонический тип — 'specification'.
- Подкаталоги docs/ оригинала упрощены до плоских файлов (совместимость по данным).
Проверки: pnpm test — 274/274 ✓; node --check ✓; ручной CLI-тест в /tmp ✓ (created_date: 2026-10-01 в файле).
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->