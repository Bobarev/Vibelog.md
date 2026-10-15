---
id: lesson-17
title: 'Каждый MCP-шаг, пишущий файлы в главный репо (refs/lessons), требует парного шага коммита в close-шаблоне'
status: active
tags:
  - close
  - templates
  - git
  - prompt-level
  - backlog
source_tasks: []
linked_tasks:
  - VL-170
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

MCP-инструменты `reference_add`/`reference_link`/`lesson_create`/`lesson_update` пишут файлы в ГЛАВНЫЙ репозиторий, но ни один close-шаблон их не коммитил — после Фазы Close `git status` показывал незакоммиченные `backlog/references/*.md` и `backlog/lessons/*.md` (VL-170).

## Решение

При добавлении в close-шаблон шага, который пишет файлы через MCP в главный репо, сразу добавляй парный шаг коммита этих файлов явными путями (пути — только через `ls`, slug ≠ ID — ловушка VL-121). Инвариант закрепи тестом в `phase-prompt.test.mjs` с явным комментарием «не удалять при рефакторинге» (паттерн VL-142).

## Пример

VL-170: шаги 6.6 (`phase-close.md`) и 7.6 (`phase-close-worktree.md`) — коммит refs/lessons одним `docs(task)`-коммитом; `backlog/references/data/` не коммитится (.gitignore).