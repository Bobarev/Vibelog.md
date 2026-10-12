---
id: VL-112
title: 'Фаза Close для задач в branch-mode: отдельный шаблон с merge ветки vb/vl-N'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 12:46'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/qwen-commands/phase-close-worktree.md
  - src/web/phase-prompt.ts
  - src/web/phase-prompt.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/agent/cli.ts
  - scripts/npm-smoke.mjs
  - README.md
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Фаза Close не знает о worktree/ветках (проверено grep: единственное упоминание — запрет «чужие ветки»): при branch_mode close спавнится в worktree задачи, feat-коммит уходит в vb/vl-N, но docs(task)-коммит не находит изменений (MCP пишет backlog в главный репо через VIBELOG_CWD, копия backlog в worktree неизменна), а слияние ветки в master не делает никто — ветки висят неслитыми (vl-98/vl-101/vl-108). Merge невозможен из worktree (master checked-out в главном репо — git-worktree отказывается), поэтому close обязан работать в главном cwd.

Решение (Вариант 1, выбор Pavel 2026-10-12): отдельный шаблон phase-close-worktree.md для задач с worktree:
1. orchestrator: close исключён из worktree-спавна; выбор шаблона — по факту наличия .vibelog/worktrees/<id>;
2. шаблон: чистка worktree (feat-коммит из ветки при необходимости) → git log master..vb/<id> → merge --no-ff из главного cwd → конфликт: НЕ резолвить/НЕ abort, статус не менять, отчёт → после успеха worktree remove + branch -d (закрывает C7 из doc-12) → DoD → docs(task)-коммит backlog в главном репо → Done → отчёт;
3. {{branch}} (vb/<id в нижнем регистре>) и {{worktreeDir}} (.vibelog/worktrees/<id в нижнем регистре>) подставляет оркестратор.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 templates/qwen-commands/phase-close-worktree.md: шаги проверки worktree (git -C status/commit) → показ master..vb/taskId → merge --no-ff → при конфликте НЕ резолвить и НЕ abort, статус не менять, отчёт → worktree remove + branch -d → DoD → docs(task)-коммит в главном репо → Done → отчёт
- [x] #2 renderPrompt: опция closeWorktree выбирает отдельный шаблон; {{branch}} и {{worktreeDir}} подставляются; обычный close без worktree рендерится по-старому без изменений
- [x] #3 orchestrator: фаза close НЕ спавнится в worktree даже при branch_mode и существующем worktree (cwd — главный репо, примечание «Режим параллельной разработки» не дописывается); фазы code/spec/plan/comment продолжают спавниться в worktree (регресс)
- [x] #4 pnpm test зелёный; npm-smoke.mjs проверяет наличие phase-close-worktree.md и templates/agent-prompt.md в пакете
- [x] #5 README: раздел branch-mode описывает закрытие задач с worktree (close в главном репо, авто-слияние, конфликт-отчёт)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 13:26
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code; feat 2980346).
Реализовано по Варианту 1 (выбор Pavel 2026-10-12):
- templates/qwen-commands/phase-close-worktree.md (новый): протокол закрытия задачи с worktree — чистка worktree (git -C, единственное исключение), git log master..{{branch}}, merge --no-ff из главного cwd; при конфликте — НЕ резолвить и НЕ abort, статус не менять, отчёт с файлами конфликта; после успеха — worktree remove + branch -d (закрывает C7 из doc-12), DoD, docs(task)-коммит backlog в главном репо, Done, отчёт.
- src/web/phase-prompt.ts: RenderPromptOptions.closeWorktree + CLOSE_WORKTREE_FILE; подстановки {{branch}}/{{worktreeDir}}.
- src/web/orchestrator.ts: close исключён из worktree-спавна (branchTask проверяет phase !== close); startPhase передаёт {{branch}}/{{worktreeDir}} и опцию выбора шаблона по наличию .vibelog/worktrees/<id>.
- src/agent/cli.ts: прямой запуск close через CLI выбирает тот же шаблон; блок renderPrompt перенесён ниже объявления cwd (иначе use-before-declaration).
- scripts/npm-smoke.mjs: все 7 шаблонов фаз + templates/agent-prompt.md проверяются в пакете; README (раздел branch-mode) описывает закрытие в веточном режиме.
Проверки: pnpm build (tsc strict) OK; pnpm test — 823/823, fail 0; целевые phase-prompt/orchestrator/cli — 70/70.
Что осталось: первый живой прогон /close на задаче с worktree (например, ветки vb/vl-98-patches после доводки VL-98); DoD закрывается Фазой Close.
---
author: @agent
created: 2026-10-12 18:38
---
Фаза Close выполнена вручную (исполнитель — Qwen Code). Код: feat 2980346 (шаблон phase-close-worktree.md, close вне worktree-спавна, renderPrompt closeWorktree, npm-smoke/README) + fix 00f073d (worktree remove --force для untracked-симлинков linkWorktreeDeps) + fix c32bd08 (docs(task)-коммит последним шагом — конвенция VL-105). Живые проверки шаблона: закрытие VL-113 (feat из worktree, merge --no-ff без конфликтов, worktree/ветка удалены, DoD 3/3) и VL-108 (второй прогон, merge fec65e0, закрыт по исправленному порядку шагов). Проверки: pnpm test 823/823 на момент feat, тесты шаблонов 12/12 после fix. DoD 3/3. Статус Done.
---
<!-- COMMENTS:END -->