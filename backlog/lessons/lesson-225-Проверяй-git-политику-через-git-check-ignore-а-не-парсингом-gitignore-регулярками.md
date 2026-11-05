---
id: lesson-225
title: 'Проверяй git-политику через git check-ignore, а не парсингом .gitignore регулярками'
status: active
tags:
  - git
  - doctor
  - tests
  - gitignore
source_tasks:
  - VL-340
linked_tasks:
  - VL-340
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Проверки git-политики каталога (что игнорируется, что коммитится) соблазнительно писать парсингом `.gitignore` регулярками — такой тест ломается на `!`-исключениях, вложенных `.gitignore` и `core.excludesFile`, а на живом репозитории даёт ложные результаты: в worktree задачи действует `.gitignore` worktree, а не главного репозитория.

## Решение

Спрашивать сам git: `spawnSync('git', ['check-ignore', '-q', '--', path], { cwd })` — код 0 = игнорируется, 1 = нет, 128 = не git-репозиторий (тогда проверка `ok: true` со значением «не git-репозиторий», чтобы диагностика не падала вне git). Тесты — на mkdtemp-фикстуре с собственным `git init`, а не на живом репозитории.

## Пример

VL-340: пять проверок `doctor` (`vibelog_gitignore`, `vibelog_settings_tracked`, `vibelog_billing_tracked`, `env_ignored`, `vibelog_root_ignored`) — все через `git check-ignore`; кейсы «нет `.vibelog/.gitignore` → не ok», «`.vibelog/` в корневом `.gitignore` → не ok» и «вне git-репозитория не падает» гоняются на mkdtemp-каталогах.
