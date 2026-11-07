---
id: lesson-238
title: 'Считай прогрессом рана только вызов, чей ответ разобран: shell-команда — работа лишь при успехе и принадлежности к классу изменяющих/проверяющих'
status: active
tags:
  - agent
  - loop
  - runHasProgress
  - shell
  - regression
source_tasks: []
linked_tasks:
  - VL-361
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`runHasProgress()` в `src/agent/loop.ts` определял «была ли работа» по имени инструмента: `WORK_EVIDENCE_TOOLS = new Set(['edit', 'write_file', 'git_commit'])`. В фазе Close-worktree вся работа идёт через `run_shell_command` (merge, build, тесты, уборка worktree), поэтому при полностью выполненной задаче функция возвращала `false` и ран падал кодом 1 (сессия `agent-1794064942811`, VL-361). Наивно добавить имя в набор нельзя: `run_shell_command` отдаёт плоский текст, и упавшая команда (`exit code 1`, `fatal:`) выдала бы себя за работу — это регресс VL-124 («ран завершён штатно» при недоработанной задаче).

## Решение

Прогресс определяется не именем инструмента, а разбором его ответа. Для shell введён предикат `shellCallIsWork(command, output)`: команда должна относиться к классу «меняет состояние / проверяет результат» (`SHELL_WORK_PATTERNS`: `git merge|commit|rebase|cherry-pick|worktree remove|branch -d`, `pnpm build|test`, `npx vitest`, `npm run build|test`) И не нести маркеров провала (`SHELL_FAILURE_MARKERS`: `^exit code: [1-9]`, `^fatal:`, `ERR_*`, `command not found`, `N failed`, `^error`). В `runHasProgress()` для `run_shell_command` — отдельная ветка, `WORK_EVIDENCE_TOOLS` остаётся из трёх инструментов. Надёжность кода возврата проверена: `makeRunShellCommand` (`src/agent/tools.ts`) всегда печатает первой строкой `exit code: N`, поэтому ненулевой код ловится без правки `tools.ts`.

## Пример

`run_shell_command {command: "git merge --no-ff vb/vl-361"}` с выводом `exit code: 0 …` → работа; тот же вызов с `exit code: 1` или `fatal: …` → не работа; `ls`/`cat` вне `SHELL_WORK_PATTERNS` → не работа. Регресс-тесты: `src/agent/loop-repeat-cap.test.mjs` (сценарий `agent-1794064942811` завершается штатно с блоком `buildRunProgress`; VL-124 — `fatal:` → `fail()`).
