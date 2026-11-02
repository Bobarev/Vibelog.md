---
id: lesson-177
title: 'При дописывании трейлера в amend бери сообщение из `git log -1 --pretty=%B`, а не `--no-edit`'
status: active
tags:
  - git
  - commit
  - agent
source_tasks:
  - VL-302
linked_tasks:
  - VL-302
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

`commitTaskFile` досылал трейлер `Co-authored-by` в новый коммит, но ветка amend использовала `git commit --amend --no-edit` — сообщение не пересобиралось, и трейлер в amend-коммит не попадал (а заодно нельзя было ничего дописать в тело).

## Решение

Для amend читать полное сообщение как `git log -1 --pretty=%B` (не `%s` — иначе теряется тело), прогонять через идемпотентный `appendCommitTrailer` и вызывать `git commit --amend --no-verify -m <полное сообщение>`. `--no-edit` несовместим с изменением сообщения.

## Пример

`src/agent/task-commit.ts`: ветка amend собирает `appendCommitTrailer(fullMessage, resolveCommitCoauthor(cwd))`; тест проверяет, что тема и тело сохранены, а повторный amend не дублирует трейлер (идемпотентность по `includes(COMMIT_TRAILER)`).
