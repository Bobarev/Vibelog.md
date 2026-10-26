---
id: lesson-56
title: 'Для retry с --resume проверяй jsonl, meta.cwd и главный репозиторий сессий — при любом отказе возвращай пустые аргументы (fail-open)'
status: active
tags:
  - auto-runner
  - resume
  - fail-open
  - sessions
  - retry
source_tasks:
  - VL-200
linked_tasks:
  - VL-200
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема
Retry фазы с `--resume` без проверок давал бы endless-retry: ветка session только в worktree (legacy без VIBELOG_CWD) или meta без jsonl — агент падает на «Сессия не найдена» каждый retry, attempts растут до max без прогресса (инцидент VL-98: resume в чужом каталоге).

## Решение
Перед передачей `--resume` проверяй три условия и возвращай пустые аргументы при любом отказе: (1) JSONL реально существует рядом с meta (`existsSync`), (2) `meta.cwd` (после realpath) совпадает с cwd задачи или её worktree-каталогом, (3) сессия найдена в главном репо (`findTaskPhaseSessionSync(agentSessionsDir(cwd))`). Пустой массив → штатный запуск новой сессии — fail-open лучше вечного retry.

## Пример
VL-200: `retryResumeArgs` в auto-runner.ts — три guard'а, при отказе `[]`; при успехе `['--resume', sid]`. Юнит-тест покрывает 4 кейса отказа.