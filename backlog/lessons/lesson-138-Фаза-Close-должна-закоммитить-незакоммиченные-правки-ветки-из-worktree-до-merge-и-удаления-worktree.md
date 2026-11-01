---
id: lesson-138
title: Фаза Close должна закоммитить незакоммиченные правки ветки из worktree до merge и удаления worktree
status: active
tags:
  - close-phase
  - git
  - worktree
  - commit
  - changelog
source_tasks:
  - VL-232
linked_tasks:
  - VL-232
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Предыдущая фаза (Comment/идle) может оставить в worktree незакоммиченную правку файлов задачи — например, запись в `CHANGELOG.md`, добавленную в конце фазы Comment. При закрытии `git log --oneline master..vb/<id>` показывает только коммиты Code, а правка висит как `M CHANGELOG.md`. Если сразу выполнить merge, `git worktree remove` её уничтожит (файл существует только в рабочем каталоге worktree), и запись о задаче потеряется молча — заметить это можно лишь сверкой diff/CHANGELOG.

## Решение

В Фазе Close **первым делом** проверяй `git -C .vibelog/worktrees/<id> status --porcelain`. Любые `M`/`A`-файлы задачи (не untracked-симлинки `node_modules`/`backlog/references/data`) коммить в ветку явными путями до merge: `git -C .vibelog/worktrees/<id> add <пути> && git -C .vibelog/worktrees/<id> commit -m "docs: <ID> — ..."`. После коммита повторно посмотри `master..vb/<id>` — в списке должно быть столько коммитов, сколько ожидается.

## Пример

VL-232: фаза Comment добавила запись о конвертере в `CHANGELOG.md`, но коммит не делала («git-операции в этой фазе запрещены»). `git -C .vibelog/worktrees/vl-232 status --porcelain` → ` M CHANGELOG.md`. Закоммичено в ветку отдельным `docs:` коммитом (`394b167`), затем merge — запись попала в master.