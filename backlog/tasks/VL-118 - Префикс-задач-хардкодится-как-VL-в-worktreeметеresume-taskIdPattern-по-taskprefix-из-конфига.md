---
id: VL-118
title: Префикс задач хардкодится как VL в worktree/мете/resume — taskIdPattern по task_prefix из конфига
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 16:01'
updated_date: '2026-10-12 18:38'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/config.ts
  - src/core/config.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Хардкод /^VL-\d+$/i в четырёх местах (orchestrator.ts: branchTask, phaseTaskId, startResume-мета; cli.ts: env-фильтр меты) молча отключает branch-mode, мету сессии и worktree-resume у проектов с чужим task_prefix (LB-, ot-, mcpcli-…): worktree не создаётся, мета не пишется, resume идёт в главном cwd — никаких ошибок, только деградация. Ирония: в ревью плана VL-114 фазовый режим защищён аргументом «task_prefix конфигурируем», а env-путь оставлен на хардкоде.

Решение: helper taskIdPattern(cwd) в core/config.ts — читает task_prefix через loadConfig, экранирует (префикс — пользовательские данные), дефолт 'VL' при отсутствии конфига или пустом префиксе. Применение в 4 точках. Уже генерично и не меняется: taskWorktreeDir/taskBranchName (пути из id в нижнем регистре), шаблоны ({{branch}}/{{worktreeDir}}).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/config.ts: taskIdPattern(cwd) — regex из task_prefix backlog/config.yml с escape-ом спецсимволов; дефолт VL при отсутствии/пустом префиксе; юнит-тесты (обычный префикс, префикс со спецсимволами regex, отсутствие конфига)
- [x] #2 4 точки применяют taskIdPattern(cwd): branchTask и phaseTaskId (spawnQwenRun), мета worktree-resume (startResume), env-фильтр меты (cli.ts) — хардкода /^VL-\d+$/i в src не остаётся
- [x] #3 orchestrator.test: branch-mode с task_prefix ot — worktree ot-5 создаётся, envPhaseTaskId=OT-5, примечание ветки vb/ot-5; cli.test: env-путь с ot-7 пишет мету OT-7
- [x] #4 pnpm test зелёный; CHANGELOG: запись
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
created: 2026-10-12 16:12
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code; feat 59939d9).

Реализовано: core/config.ts — taskIdPattern(cwd): regex из task_prefix backlog/config.yml с escape-ом спецсимволов (префикс — данные пользователя; тест a.b+ матчится литералом), дефолт VL при отсутствии backlog/конфига или пустом префиксе. Четыре точки переведены: branchTask и phaseTaskId (spawnQwenRun), мета worktree-resume (startResume), env-фильтр меты (cli.ts) — хардкода /^VL-\d+$/i в коде не осталось (остался исторический комментарий). taskWorktreeDir/taskBranchName и шаблоны не менялись — уже генеричны.

Тесты (+7): config.test.mjs (новый: обычный префикс, экранирование спецсимволов, нет конфига → VL, пустой префикс → VL); orchestrator +1 (branch-mode task_prefix ot: worktree ot-5, env OT-5, cwd фазы — worktree); cli +2 (env-путь ot-7 пишет мету OT-7; без конфига weird-7 отфильтрован). Сопутствующая правка: E2E-тест VL-114 переведён на ot-88 — общий testRoot использует task_prefix ot, и VL-88 после фикса корректно перестал считаться задачей проекта (тест и поймал регрессию).

Проверки: pnpm build (tsc strict) OK; pnpm test — 841/841, fail 0.

Что осталось: live-проверка на проекте с чужим префиксом; DoD закрывается Фазой Close.
---
author: @agent
created: 2026-10-12 18:38
---
Фаза Close выполнена вручную (исполнитель — Qwen Code). Код: feat 59939d9 (taskIdPattern(cwd) в core/config.ts — префикс из task_prefix с escape-ом, дефолт VL; 4 точки переведены с /^VL-\d+$/i). Тесты: config.test.mjs +4 (новый), orchestrator +1 (branch-mode ot-5), cli +2; E2E VL-114 переведён на ot-88 — поймал регрессию; pnpm test 841/841. DoD 3/3. Статус Done.
---
<!-- COMMENTS:END -->