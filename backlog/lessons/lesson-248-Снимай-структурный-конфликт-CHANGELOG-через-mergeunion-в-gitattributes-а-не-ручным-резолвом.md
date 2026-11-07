---
id: lesson-248
title: 'Снимай структурный конфликт CHANGELOG через merge=union в .gitattributes, а не ручным резолвом'
status: active
tags:
  - git
  - merge
  - changelog
  - close
  - workaround
source_tasks:
  - VL-364
linked_tasks:
  - VL-364
created_date: 2026-11-08
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Close регулярно падал на конфликте `CHANGELOG.md` при merge ветки задачи в master. Причина структурная, а не «сложное слияние»: CHANGELOG пишет только Close и пишет в главный репо после merge, а все Close вставляют запись в одну и ту же позицию `[Unreleased]` — поэтому две любые правки конфликтуют по определению. Конфликт появляется, когда правка всё-таки попала в ветку (дрейф Code/Do, WIP-коммит шага «грязный worktree», батч/подзадача).

## Решение

Не «умный резолв», а merge-политика: строку `CHANGELOG.md merge=union` в корневой `.gitattributes` — встроенный драйвер git объединяет строки обеих сторон без конфликт-маркеров (записи — однострочные буллеты `- **VL-NNN: …**`). Оговорки: `union` даст дубль заголовка раздела, если обе стороны независимо вводят новый `### Добавлено` (разделы заводить заранее, фазами не создавать); порядок записей не хронологический — для Unreleased нормально. Атрибуты читаются из дерева, поэтому файл действует только для merge, начатых после его коммита. Резолв вручную разрешать только для прозы (`CHANGELOG.md`, `backlog/docs/*`) по правилу «оставить оба варианта целиком»; для `backlog/tasks/*.md` — никогда: там AC/DoD, статус, комментарии и `token_usage`, резолв теряет их молча и ни один тест этого не покажет.

## Пример

VL-364: `.gitattributes` с `CHANGELOG.md merge=union` (проверка `git check-attr merge CHANGELOG.md` → `union`) + узкая ветка резолва в шаге merge `phase-close-worktree.md`: все конфликтные пути ∈ {`CHANGELOG.md`, `backlog/docs/*`} → «оставить оба варианта целиком», `git add` по явным путям, `git commit --no-edit`; любой другой путь → `aborted: true`; `git merge --abort` запрещён в любом случае.
