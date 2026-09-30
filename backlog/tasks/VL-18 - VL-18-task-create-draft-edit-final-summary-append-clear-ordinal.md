---
id: VL-18
title: 'VL-18: task create --draft + edit --final-summary/--append/--clear/--ordinal'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 01:32'
updated_date: '2026-10-01 01:41'
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
--draft в create + финальные флаги edit (P2 из ресёрча; cli.ts:1975, 638-643).

Реализация:
1. src/cli/commands/task.mjs:
   - taskCreate: флаг --draft → writeDraft (ядро из VL-13) вместо createTaskFile: запись в backlog/drafts/, id draft-N, статус Draft; printSuccess «Черновик draft-N создан».
   - taskEdit: --final-summary (замена finalSummary), --append-final-summary (дописывает в конец с разделителем), --clear-final-summary (очистка в ''), --ordinal N (Number + валидация).
2. src/cli/router.mjs: help create [--draft], edit новые флаги.
3. Тесты: --draft → файл в drafts/, в tasks/ пусто; edit-флаги (замена/дописывание/очистка/ordinal) через view --json; ошибки невалидного ordinal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task create --draft создаёт черновик в backlog/drafts/ (id draft-N, статус Draft) через ядро VL-13; в tasks/ ничего не появляется
- [x] #2 task edit --final-summary (замена) / --append-final-summary (дописывание) / --clear-final-summary (очистка) / --ordinal N работают
- [x] #3 help обновлён; pnpm test зелёный
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: create --draft + edit --final-summary/--append/--clear/--ordinal (VL-18)

1. **src/cli/commands/task.mjs**:
   - taskCreate: флаг --draft → writeDraft (ядро VL-13, loadConfig) вместо createTaskFile: backlog/drafts/, id draft-N, статус Draft; printSuccess «Черновик draft-N создан».
   - taskEdit: --final-summary (замена finalSummary), --append-final-summary (дописывает в конец с \n), --clear-final-summary (очистка ''), --ordinal N (Number + валидация ≥ 0).
2. **src/cli/router.mjs — help**: create [--draft]; edit [--final-summary ...] [--append-final-summary ...] [--clear-final-summary] [--ordinal N].
3. **Тесты** — в src/cli/create-flags.test.mjs: --draft → файл в drafts/ (ls), в tasks/ пусто; edit-флаги через view --json (замена/дописывание/очистка/ordinal); невалидный ordinal → ошибка.

Риски: --draft не должен добавлять DoD-дефолты в черновик (writeDraft без definitionOfDone — ок); edit --ordinal парсинг как --limit.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 01:41
---
Фаза 3 завершена. 3/3 AC. P2-хвост v1.3 полностью закрыт (VL-16..VL-18).
- src/cli/commands/task.mjs: taskCreate --draft → writeDraft (ядро VL-13: backlog/drafts/, id draft-N, статус Draft; DoD-дефолты в черновик не попадают). taskEdit: --final-summary (замена), --append-final-summary (дописывание с \n), --clear-final-summary (очистка), --ordinal N (целое ≥ 0).
- src/cli/router.mjs: help create [--draft], edit --final-summary/--append-final-summary/--clear-final-summary/--ordinal.
- Тесты: src/cli/create-flags.test.mjs.
Проверки: pnpm test 306/306 ✓; ручной прогон ✓ (draft-1 в drafts/, tasks/ не тронут).
Реализовано в общем патче с VL-16/VL-17 (одна сессия по подтверждению на все 3 задачи).
---
<!-- COMMENTS:END -->