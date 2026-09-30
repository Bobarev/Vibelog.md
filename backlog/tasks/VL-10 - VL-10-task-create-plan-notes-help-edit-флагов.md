---
id: VL-10
title: 'VL-10: task create --plan/--notes + help edit-флагов'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 00:06'
updated_date: '2026-10-01 00:15'
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
Последний P1 v1.3 из ресёрча (FEATURES-COMPARISON.md:321): запись плана и заметок при создании задачи (сейчас только через edit).

Изменения:
1. src/cli/commands/task.mjs — taskCreate: флаги --plan/--notes → implementationPlan/implementationNotes в createTaskFile (те же поля, что edit). Позиция — рядом с acceptanceCriteria/definitionOfDone.
2. src/cli/router.mjs — help task:
   - create: добавить [--plan ...] [--notes ...]
   - edit: задокументировать работающие флаги [--plan ...] [--notes ...] [--append-notes ...] (сейчас не показаны).
3. MCP backlog_create_task НЕ трогаем: у оригинала в task_create нет plan/notes (проверено по generateTaskCreateSchema) — добавление сломало бы совместимость. finalSummary в create — P2, вне скоупа.

Файлы: src/cli/commands/task.mjs, src/cli/router.mjs, тесты (дополнить cli.test.mjs или новый файл).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task create --plan "..." записывает текст в Implementation Plan; --notes — в Implementation Notes (round-trip через getTask/taskToMarkdown)
- [x] #2 help task: create показывает [--plan] [--notes]; edit показывает работающие [--plan] [--notes] [--append-notes]
- [x] #3 MCP backlog_create_task НЕ получает plan/notes (оригинал не имеет — совместимость); pnpm test проходит
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: task create --plan/--notes (VL-10)

Ядро не меняется: createTask (src/core/task.mjs:74-75) уже принимает implementationPlan/implementationNotes из input — правки только в CLI и help.

### Файлы для изменения

1. **src/cli/commands/task.mjs**
   - После строки 94 (`const definitionOfDone = getFlagArray(flags, 'dod');`) добавить чтение флагов:
     ```js
     // План и заметки при создании (как в оригинале task create --plan/--notes)
     const plan = getFlag(flags, 'plan', '');
     const notes = getFlag(flags, 'notes', '');
     ```
   - В блоке createTaskFile (строки 96–108) после `definitionOfDone,` (строка 108) добавить:
     ```js
     implementationPlan: plan,
     implementationNotes: notes,
     ```

2. **src/cli/router.mjs** (help task)
   - Строка 137 (create): добавить `[--plan ...] [--notes ...]` в конец строки.
   - Строка 140 (edit): добавить `[--plan ...] [--notes ...] [--append-notes ...]` — документируем уже работающие флаги.

3. **Тесты — новый src/cli/create-plan-notes.test.mjs** (~70 строк, паттерн search-cli.test.mjs: testDir /tmp/vibelog-plan-notes-test, spawnSync со слиянием stdout/stderr)
   - create --plan/--notes → `task view <id> --json` содержит тексты в implementationPlan/implementationNotes
   - round-trip: перечитывание файла (grep '## Implementation Plan' в tasks/*.md)
   - create без флагов — секции пустые, ничего не ломается
   - help: create --help содержит --plan; edit --help содержит --append-notes

### Порядок действий
1. task.mjs (флаги + передача в createTaskFile)
2. router.mjs (help)
3. create-plan-notes.test.mjs
4. pnpm test

### Проверки
- pnpm test (все)
- Ручной: /tmp — task create X --plan "1. Сделать" --notes "Заметка" → task view --json

### Риски
- --plan/--notes — одиночные строковые флаги (как -d): многословный текст передаётся одним аргументом в кавычках
- view --json формат вывода — в тесте проверяем подстроку, не строгий парс
- MCP create не трогаем — в оригинале task_create нет plan/notes (проверено по generateTaskCreateSchema)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 00:15
---
Фаза 3 (Code) завершена. 3/3 AC. Последний P1 v1.3 закрыт.
Реализовано (правки минимальны — ядро createTask уже поддерживало поля):
- src/cli/commands/task.mjs: taskCreate читает --plan/--notes и передаёт implementationPlan/implementationNotes в createTaskFile.
- src/cli/router.mjs: help task — create показывает [--plan] [--notes]; edit — задокументированы работающие [--plan] [--notes] [--append-notes].
- src/cli/create-plan-notes.test.mjs (новый, 4 теста): запись секций, round-trip через markdown-файл, отсутствие пустых секций без флагов, help.
- MCP backlog_create_task не менялся — в оригинале task_create нет plan/notes (сверено по generateTaskCreateSchema), finalSummary в create остаётся P2.
Проверки: pnpm test — 263/263 ✓; node --check ✓; ручной CLI-тест в /tmp ✓.
v1.3 roadmap: Milestones ✓, Types ✓, task_search ✓, --plan/--notes ✓ — все P1 закрыты.
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->