---
id: lesson-143
title: 'Перед --amend уточняй ТИП docs(task)-коммита, а не только его ID — иначе перепишешь чужой refs/lessons-коммит'
status: active
tags:
  - git
  - amend
  - close
  - commit
source_tasks:
  - VL-277
linked_tasks:
  - VL-277
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Автокоммит файла задачи после close амендит HEAD, если тема начинается с `docs(task): <ID>`. Но у задачи в главном репо бывает несколько коммитов с таким префиксом (`— закрытие задачи (Done)`, `— refs и lessons`), и проверки только по префиксу недостаточно: `--amend` переписывал чужой коммит refs/lessons (тест на ac6 это и поймал — ожидался новый коммит, а счётчик коммитов не рос).

## Решение

Предикат аменда уточнять по типу коммита, а не только по ID:
`subject.startsWith(\`docs(task): ${taskId}\`) && (subject.includes('закрытие задачи') || subject.includes('token_usage'))`, плюс проверка «не запушен» (HEAD ≠ @{u} или нет upstream).

## Пример

src/agent/task-commit.ts, `commitTaskFile`: amend только для коммитов закрытия/token_usage этой задачи; `refs и lessons`, `docs:` и `feat:` — всегда новый коммит.
