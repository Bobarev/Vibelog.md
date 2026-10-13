---
id: VL-137
title: 'Фазы: подстановка задачи (title/type/description/plan/AC/DoD/status/lastComment) в первый промпт + пакетирование shell-шагов'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-13 10:57'
updated_date: '2026-10-13 10:57'
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
Профиль реальных сессий (2026-10-12/13): каждая фаза начинается с backlog_view_task (~1.2 вызова на фазу), close дополнительно делает manage_dod list, comment-фаза читает последний комментарий — это ровно то, что можно подставить в промпт. Оркестратор уже импортирует getTask (orchestrator.ts:21) и читает задачу для worktree-блока — подстановка технически trivial.

Решение: перед renderPrompt в startPhase/startResume — getTask(cwd, taskId), поля кладутся в extraVars: taskTitle, taskType, taskDescription, taskPlan (implementationPlan), taskAC, taskDoD (списки с номерами), taskStatus, taskLastComment. Шаблоны получают блок «Задача (подставлена автоматически): ...»; шаги view_task убираются как обязательные (остаётся фолбэк «если блок не подставлен — прочитай через MCP», для web-триггера без extraVars). ВАЖНО: не ломать контракт {{comment}} (VL-80) — подстановки только новыми переменными.

+ Пакетирование shell (промпт-правило в phase-3 и close-шаблонах): последовательные git/shell-команды объединять в один вызов через && (git status+ls; pnpm build && pnpm test уже упомянут) — экономит 2-4 вызова на фазу close/code.

Экономия по профилю: view_task −1..−2 во всех фазах, close дополнительно −DoD-list, comment/spec −последний-комментарий, shell-пакетирование −2..−4 в close/code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 orchestrator.startPhase/startResume: getTask(cwd, taskId) → extraVars {{taskTitle}} {{taskType}} {{taskDescription}} {{taskPlan}} {{taskAC}} {{taskDoD}} {{taskStatus}} {{taskLastComment}}; отсутствие/битая задача не ломает фазу (подстановки пропускаются); контракт {{comment}}-fallback VL-80 сохранён (подстановки — только новые переменные)
- [ ] #2 шаблоны phase-1/2/3/close/close-worktree/comment: блок «Задача (подставлена автоматически)»; шаги backlog_view_task и «прочитай последний комментарий» сведены к фолбэку «если блок не подставлен — прочитай через MCP»; в phase-3 и close-шаблоны добавлено правило пакетирования: последовательные git/shell-команды объединять в один вызов (&&)
- [ ] #3 orchestrator.test.mjs: подстановка полей (task и epic), фолбэк без задачи; phase-prompt.test.mjs: шаблоны содержат блок подстановки и фолбэк
- [ ] #4 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->