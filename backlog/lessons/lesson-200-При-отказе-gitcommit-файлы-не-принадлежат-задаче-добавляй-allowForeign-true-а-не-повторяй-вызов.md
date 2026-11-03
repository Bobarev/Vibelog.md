---
id: lesson-200
title: 'При отказе git_commit «файлы не принадлежат задаче» добавляй allowForeign: true, а не повторяй вызов'
status: active
tags:
  - git
  - git_commit
  - allowForeign
  - loop-detection
  - close-phase
source_tasks:
  - VL-317
linked_tasks:
  - VL-317
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

`git_commit` отклоняет пути, которых нет в `modified_files` задачи, и в тексте отказа прямо написано: «если это осознанно — передай allowForeign: true». Агент (и я в фазе Close VL-317) повторял тот же вызов с теми же аргументами 6 раз подряд, надеясь на другой результат: loop-detection срабатывал, ходы сгорали, фаза не двигалась.

## Решение

Отказ `git_commit` с формулировкой «эти файлы не принадлежат задаче <ID>» — это НЕ транзиентная ошибка, повтор бессмысленен. Читай хвост сообщения: там готовое исправление. Нужен осознанный коммит служебного/чужого файла (временный патч-скрипт, CHANGELOG, backlog/docs, backlog/lessons, backlog/references) — добавь `allowForeign: true` в ТОТ ЖЕ вызов. Не нужно менять message, cwd или порядок путей — только флаг.

## Пример

VL-317: в wip-коммит фазы Code попал `scripts/.tmp-vl317-patch2.mjs`; Close удалял его из ветки перед merge. Шесть вызовов `git_commit {paths:["scripts/.tmp-vl317-patch2.mjs"], cwd:".vibelog/worktrees/vl-317"}` подряд вернули один и тот же отказ. Сработал первый же вызов с `allowForeign: true` — коммит `64c8fd1`, worktree чист, merge прошёл без конфликтов.
