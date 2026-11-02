---
id: lesson-180
title: 'Правило фазы про git-коммит (трейлер, явные пути) переноси из текста промпта в write-инструмент, иначе оно держится на дисциплине модели'
status: active
tags:
  - mcp
  - git
  - phases
  - prompt
  - write-tools
source_tasks:
  - VL-311
linked_tasks:
  - VL-311
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

VL-302 добавил трейлер `Co-authored-by: vibelog-agent <vb@xw2.ru>` двумя механизмами: кодом (`src/core/commit-trailer.ts` — framework-коммиты) и подстановкой текста в 9 мест `git commit -m` в `templates/phases/*.md`. Второй механизм — не гарантия, а инструкция модели: забыла передать второй `-m` — трейлера нет, и никто не заметит. То же с текстовыми запретами «никогда `git add -A`» и «явные пути»: инциденты VL-137/VL-169/VL-172/VL-219 показали, что close-фазы реально коммитили чужие файлы.

## Решение

Правило, которое должно выполняться всегда, выноси в write-инструмент MCP, а не в текст шаблона фазы. В инструменте это проверка на границе: обязательный непустой `paths`, `git add -- <paths>` (никогда `-A`/`.`), сверка с `modified_files` задачи через `getTask`, трейлер через переиспользование `appendCommitTrailer`/`resolveCommitCoauthor`, JSON-ack `ackOk`/`ackNoop`/`ackError`. После этого текстовый блок из шаблонов УДАЛЯЙ (он становится ненужным и создаёт иллюзию гарантии), а не оставляй «на всякий случай».

## Пример

VL-311: `src/mcp/git-commit.ts` (сигнатура `{paths, message, amend?, allowForeign?, cwd?}`) заменил все 9 `git commit -m` в `phase-code/do/close/close-worktree.md`; из шаблонов убраны «никогда git add -A» и подстановка `{{commitTrailer}}` (счётчик подстановок 15 → 14). Инструмент узкий сознательно: `status`/`log`/`diff`/`merge`/`worktree remove` остаются `run_shell_command` — обёртка чтения выигрыша не даёт.