---
id: VL-15
title: 'VL-15: task edit batch AC/DoD + task list --limit/--skip (v1.4)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 00:28'
updated_date: '2026-10-01 01:24'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: low
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Мелкие пункты v1.4-раздела ресёрча (строки 361-362):

1. task edit: batch AC/DoD — оригинальный флаг task_edit acceptanceCriteriaCheck: [1,2,3] (MCP) + CLI --check-ac/--check-dod с несколькими индексами через запятую (сейчас поддерживается один индекс). Проверить поддержку массива в backlog_manage_ac/mcp + CLI args.
2. task list: --limit N, --skip N, --max-count (алиас limit?) — обрезка после фильтрации/сортировки.
--watch (cli.ts watch-json.ts) — интерактивный режим, вне скоупа: вынести в v1.5 или отдельную задачу по решению пользователя.

Файлы: src/cli/commands/task.mjs, src/mcp/tools.mjs (если массив индексов), router.mjs help, тесты.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task edit --check-ac 1,2,3 / --check-dod 1,2 (через запятую) отмечает несколько критериев за вызов
- [x] #2 task list --limit N / --skip N ограничивают выдачу (комбинируются с фильтрами/sort)
- [x] #3 --watch НЕ реализуется в этой задаче (интерактивный — отдельное решение); pnpm test проходит
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: batch AC/DoD + task list --limit/--skip (VL-15)

Оригинал: task_edit имеет acceptanceCriteriaCheck: [1,2,3] (массивы). У нас: CLI --check-ac одиночный индекс (task.mjs:282/294/329/341), MCP manage_ac/manage_dod — одиночный index (manageChecklist, tools.mjs:579+). taskList: сортировка заканчивается на строке ~167, дальше JSON (169) / printTaskTable (180).

### Файлы для изменения

1. **src/cli/commands/task.mjs**
   - Хелпер parseIndexes(raw) → number[] (split ',', trim, Number, валидация ≥1).
   - 4 блока taskEdit (--check-ac/--uncheck-ac/--check-dod/--uncheck-dod): вместо одного idx — цикл по индексам; невалидный индекс → printError («Неверный индекс N»), валидные обрабатываются.
   - taskList: после блока сортировки (после строки ~167), до JSON — обрезка: skip (slice(skip)) потом limit (slice(0, limit)); валидация: не число/отрицательное → printError + выход.

2. **src/mcp/tools.mjs — manageChecklist**
   - args.index: number ИЛИ массив (как acceptanceCriteriaCheck оригинала): нормализация `const indexes = Array.isArray(args.index) ? args.index : [args.index]`.
   - check/uncheck: отмечают/снимают все индексы; remove: удаляет несколько (по убыванию, чтобы не сдвигать).
   - Валидация каждого индекса (1..length), невалидный → ошибка с перечнем.
   - Схемы backlog_manage_ac/backlog_manage_dod: index — anyOf [number, array of number], описание обновить.

3. **src/cli/router.mjs — help task**
   - list: `[--limit N] [--skip N]`
   - edit: `[--check-ac N[,N]]` `[--check-dod N[,N]]`

4. **Тесты — создать src/cli/batch-checklist.test.mjs** (~100 строк, два describe)
   - CLI (/tmp/vibelog-batch-test, spawnSync): create с --ac/--dod (повторные флаги) → edit --check-ac 1,3 (обе отмечены через view --json), --uncheck-dod 1,2; невалидный индекс в списке → ошибка + валидные отмечены; list --limit/--skip/--json (комбинация с фильтром); --limit abc → ошибка.
   - MCP (in-process, in-project .test-batch, паттерн search-filters.test.mjs): manage_ac check с массивом [1,2]; manage_dod remove с массивом; невалидный индекс в массиве → reject.

### Порядок действий
1. task.mjs (parseIndexes + 4 блока + list limit/skip)
2. tools.mjs (manageChecklist массивы + схемы)
3. router.mjs (help)
4. batch-checklist.test.mjs
5. pnpm test + ручной прогон

### Проверки
- node --check всех файлов
- pnpm test (все)
- Ручной: /tmp/vl15 — edit --check-ac 1,2; list --limit 2

### Риски
- Сдвиг индексов при remove нескольких — удаляем по убыванию
- limit/skip применяются ПОСЛЕ фильтрации и сортировки (как в оригинале list)
- --watch остаётся вне скоупа (решение пользователя)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 01:23
---
Фаза 3 (Code) завершена. 3/3 AC. Эпик v1.4 закрыт (VL-11..VL-15).
Реализовано:
- src/cli/commands/task.mjs: parseIndexes (--check-ac 1,3 через запятую); 4 блока edit (--check-ac/--uncheck-ac/--check-dod/--uncheck-dod) — цикл по индексам, невалидный → printError, валидные обрабатываются; task list --skip/--limit после фильтрации/сортировки с валидацией (целое ≥ 0).
- src/mcp/tools.mjs: manageChecklist — index принимает число ИЛИ массив (как acceptanceCriteriaCheck оригинала task_edit); check/uncheck — по всем индексам; remove — по убыванию (без сдвига); схемы manage_ac/manage_dod — anyOf [number, array].
- src/cli/router.mjs: help — list [--limit N] [--skip N], edit [--check-ac N[,N]] [--check-dod N[,N]].
- src/cli/batch-checklist.test.mjs (новый, 6 тестов): CLI-блок (/tmp) + MCP-блок (in-process, массивы индексов, remove по убыванию, ошибки).
В Фазе 3: якорь патча не совпал из-за комментария // JSON-вывод (исправлено); строка схемы index встречается дважды — replace-all (обе копии обновлены, проверено anyOf).
Проверки: pnpm test — 297/297 ✓; node --check ✓; ручной CLI-тест в /tmp ✓ (--check-ac 1,3 → 2 отметки; list --limit 1).
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->