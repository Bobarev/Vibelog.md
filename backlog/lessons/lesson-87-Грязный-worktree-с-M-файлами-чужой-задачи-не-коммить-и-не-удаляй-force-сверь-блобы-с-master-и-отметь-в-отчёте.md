---
id: lesson-87
title: Грязный worktree с M-файлами чужой задачи не коммить и не удаляй force — сверь блобы с master и отметь в отчёте
status: active
tags:
  - worktree
  - close-phase
  - git
source_tasks:
  - VL-230
linked_tasks:
  - VL-230
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

При Close VL-230 в `.vibelog/worktrees/vl-230` висели `M src/test-setup.mjs` и `M src/core/no-network.test.mjs` — правки задачи VL-226 (spawn-guard), чей коммит-отчёт был сделан до того, как в worktree доехали доработки. `git worktree remove` отказался («contains modified or untracked files»), а `--force` разрешён только когда в worktree лишь untracked-симлинки node_modules/refs.

## Решение

1. Не коммить чужие файлы в ветку задачи — шаг 2 говорит «только явные пути файлов задачи».
2. Проверить, что правки не потеряются: `git -C <worktree> hash-object <файл>` + `git log --all --oneline --find-object=<blob>` — если коммитов с таким блобом нет, посмотреть `git -C <worktree> diff master -- <файл>`: только удаления относительно master ⇒ в worktree лежит устаревшая версия, master её содержит целиком.
3. `worktree remove` без force не делать «на всякий случай силой»: оставить worktree и ветку (branch -d упадёт с «checked out at»), упомянуть в отчёте Close.

## Пример

VL-230: `git diff master` показал для `src/test-setup.mjs` 47 строк изменений, где все `+`-строки — подмножество master (потеряны два теста spawn-guard и exec-сканирование из VL-226), `find-object` не нашёл блоб ни в одной ветке. Итог: worktree и ветка `vb/vl-230` оставлены, коммит задачи (`c20bce8`) слит в master, замечание зафиксировано в отчёте.