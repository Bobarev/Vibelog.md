---
id: VL-114
title: 'VL-110 meta-дыра: оркестраторный путь фаз не пишет meta.json сессии (env VIBELOG_PHASE_TASK_ID)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 14:46'
updated_date: '2026-10-12 14:46'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Дыра фикса VL-110 (C3): оркестратор спавнит vb с готовым отрендеренным промптом (один позиционный аргумент), CLI идёт в режиме «готовый промпт», isPhaseMode=false → saveSessionMeta НЕ вызывается. Доказательство — инцидент VL-113 2026-10-12: у реальной фазовой сессии agent-1791802592105 meta.json отсутствует, поэтому startResume не найдёт taskId и reply «Продолжи» снова уйдёт в главный cwd — инцидент VL-98 (патчи не в ту копию) повторится.

Решение: env-путь. Оркестратор в spawnEnv задачных фаз кладёт VIBELOG_PHASE_TASK_ID (runKey) и VIBELOG_PHASE_NAME (phase); cli.ts при создании сессии читает env и пишет meta.json (taskId/phase/cwd) независимо от того, как пришёл промпт — позиционный фазовый или отрендеренный. Это закрывает боевой путь оркестратора; прямые CLI-запуски фаз работают как раньше.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 spawnQwenRun для задачных фаз (runKey VL-N, включая worktree-вариант и resume с worktreeTaskId) кладёт VIBELOG_PHASE_TASK_ID и VIBELOG_PHASE_NAME в spawnEnv
- [ ] #2 cli.ts: при создании новой сессии в фазовом режиме или при наличии VIBELOG_PHASE_TASK_ID пишется <id>.meta.json (taskId/phase/cwd); resume/--continue мету не перезаписывают
- [ ] #3 orchestrator.test: оркестраторный спавн задачной фазы через заглушку создаёт meta.json в .vibelog/agent-sessions; cli.test: env-путь пишет мету
- [ ] #4 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->