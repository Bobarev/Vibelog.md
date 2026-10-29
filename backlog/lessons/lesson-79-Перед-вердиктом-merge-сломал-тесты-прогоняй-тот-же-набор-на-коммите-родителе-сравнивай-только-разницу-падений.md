---
id: lesson-79
title: Перед вердиктом «merge сломал тесты» прогоняй тот же набор на коммите-родителе — сравнивай только разницу падений
status: active
tags:
  - merge
  - tests
  - baseline
  - close-phase
  - regression
source_tasks:
  - VL-223
linked_tasks:
  - VL-223
created_date: 2026-10-29
updated_date: 2026-10-29
supersedes: ''
---
## Проблема

После слияния ветки в master `pnpm test` упал (24 падения в `src/agent/llm.test.mjs`). Легко принять это за регрессию merge и прервать Фазу Close, хотя падение предшествовало слиянию.

## Решение

Сразу после падения сделать `git stash push -- <чужие/рабочие файлы>`, `git checkout <родитель merge-коммита>`, `pnpm build` и прогнать тот же файл/набор. Совпадающий набор падений = предсуществующая проблема, а не регрессия; вердикт выносить по разнице, а не по абсолютному числу.

## Пример

VL-223: `llm.test.mjs` дал 24 падения и на master после merge, и на родителе `ae5d72c`. Причина — `models.default` с `api_mode=responses` в `.vibelog/settings.json` (lesson-78), к задаче отношения не имеет. Целевые файлы задачи (`session/loop/cli.test.mjs`) — 143/143 зелёные. Важно: после `git checkout` родителя обязательно пересобрать `dist/`, иначе vitest гоняет старый код и картина искажается.