---
id: VL-13
title: 'VL-13: Drafts — CLI draft create/list/view/edit/promote/archive (v1.4)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 00:27'
updated_date: '2026-10-01 01:04'
due_date: ''
labels: []
dependencies: []
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
Drafts (v1.4) — черновики задач для быстрого захвата идей до формализации. Оригинал: CLI draft list/create/edit/archive/promote/view (cli.ts:4064-4286). MCP у оригинала НЕТ — только CLI (совместимость).

Реализация:
1. src/core/draft.mjs — модель (по образцу milestone.mjs): write/read/list/delete, slug-имена, id D-<n> или по счёту (сверить формат id с оригиналом cli.ts:4121 draft create).
2. src/cli/commands/draft.mjs — runDraft: create <title> [-d desc], list, view <id>, edit <id> [--title/-d], archive <id>, promote <id>.
3. promote: черновик → createTaskFile (title/description) + перенос черновика в backlog/completed/ или удаление (сверить с оригиналом).
4. src/cli/router.mjs — case 'draft' + help.
5. Тесты: src/cli/draft-cli.test.mjs (/tmp, spawnSync): цикл create→list→view→edit→promote (задача появилась в tasks/)→archive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLI: draft create <title> [-d desc] / list / view <id> / edit <id> / archive <id> / promote <id> работают; файлы в backlog/drafts/ с фронтматтером (id, title, description, created_date)
- [x] #2 promote <id> создаёт полноценную задачу в backlog/tasks/ (префикс конфига) и архивирует черновик
- [x] #3 Тесты CLI проходят; pnpm test зелёный
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: Drafts — CLI draft (VL-13)

Оригинал: черновики — task-shaped markdown (id draft-N) в backlog/drafts/; promote = новая задача с task-префиксом + удаление черновика (cli.ts:4241, backlog.ts:3532); archive = перенос в completed/ (backlog.ts:3515). CLI-only.

### Файлы для изменения/создания

1. **Создать src/core/draft.mjs** (~80 строк)
   - Реиспользуем taskToMarkdown/markdownToTask из core/task.mjs (черновик = задача со статусом 'Draft' и id draft-N)
   - nextDraftId(backlogDir) — max draft-N + 1
   - writeDraft(backlogDir, {title, description, labels}) — запись в backlog/drafts/<taskFilename>, статус 'Draft'
   - listDrafts(backlogDir) → массив задач из drafts/*.md
   - getDraft(backlogDir, id) — поиск case-insensitive (+ путь к файлу)
   - updateDraft(backlogDir, id, updates) — через store-паттерн (findTaskFilePath-аналог для drafts/)
   - archiveDraft(backlogDir, id) — перенос файла в backlog/completed/

2. **Создать src/cli/commands/draft.mjs** (~100 строк) — runDraft
   - create <title> [-d desc] [-l labels]
   - list
   - view <id>
   - edit <id> [--title ...] [-d ...] [-l ...]
   - promote <id> — core.getDraft → store.createTaskFile(cwd, {...поля, без id}) → удалить черновик → printSuccess(«Черновик X → задача Y»)
   - archive <id>

3. **Обновить src/cli/router.mjs** — case 'draft' → runDraft + help (main + command)

4. **Создать src/cli/draft-cli.test.mjs** (~90 строк, /tmp/vibelog-draft-test, spawnSync)
   - create → list (черновик виден) → view (поля) → edit (title/desc изменены)
   - promote → задача появилась в tasks/ с task-префиксом (cfg-N), статус из конфига; черновик удалён из drafts/
   - archive → файл в completed/, из drafts/ убран
   - create без заголовка → ошибка; view несуществующего → ошибка

### Порядок действий
1. core/draft.mjs
2. cli/commands/draft.mjs
3. router.mjs (help)
4. draft-cli.test.mjs
5. pnpm test + ручной прогон в /tmp

### Проверки
- node --check всех файлов
- pnpm test (все)
- Ручной: /tmp/vl13 — draft create/list/promote/archive

### Риски
- Реиспользование task-модели: статус 'Draft' не входит в statuses конфига — это ок (как в оригинале: статус черновика свободный, при promote заменяется default_status)
- promote через createTaskFile(cwd) — префикс задачи берётся из конфига; черновик удаляется только после успешного создания задачи
- Имена файлов с кириллицей — taskFilename уже проверен (V-серия)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 01:04
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/core/draft.mjs (новый): черновики — task-shaped markdown (реиспользованы taskToMarkdown/markdownToTask/taskFilename), id draft-N, статус Draft; write/list/get/update/archive (archive — rename в completed/), removeDraftFile.
- src/cli/commands/draft.mjs (новый): create <title> [-d/-l] / list / view / edit / promote / archive. promote: getDraft → createTaskFile (id из префикса конфига, статус default_status) → удаление черновика только после успешного создания задачи.
- src/cli/router.mjs: case 'draft' + help (main + command).
- src/cli/draft-cli.test.mjs (новый, 5 тестов): полный цикл create→list→view→edit, promote (задача dr-1 в tasks/, черновик удалён), archive (completed/), ошибки, help.
MCP-инструментов нет — CLI-only, как в оригинале.
Проверки: pnpm test — 286/286 ✓; node --check ✓; ручной CLI-тест в /tmp ✓ (promote draft-1 → d13-1, статус To Do).
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->