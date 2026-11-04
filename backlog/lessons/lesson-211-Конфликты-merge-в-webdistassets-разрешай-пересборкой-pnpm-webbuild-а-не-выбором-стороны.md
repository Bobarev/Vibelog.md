---
id: lesson-211
title: 'Конфликты merge в web/dist/assets разрешай пересборкой `pnpm web:build`, а не выбором стороны'
status: active
tags:
  - git
  - merge
  - web
  - dist
  - build
source_tasks:
  - VL-330
linked_tasks:
  - VL-330
created_date: 2026-11-04
updated_date: 2026-11-04
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Ветка задачи и master независимо пересобрали `web/dist`: индексированный бандл получает хеш от содержимого, поэтому у обеих сторон свои `assets/index-<hash>.js` и `index.html` ссылается на «свой» хеш. `git merge` даёт rename/rename-конфликт (`UU web/dist/index.html`, `AU/UA/DD` по бандлам), причём обе стороны по отдельности «правильные» — выбор любой из них оставит `index.html` со ссылкой на файл, которого нет в дереве.

## Решение

Конфликт в чекауте `web/dist` — не содержательный, а производный: разрешай его одной пересборкой в главном репозитории (`pnpm web:build`) после merge, затем `git add web/dist` с полученным деревом. Не «оптимизируй» резолв выбором `--ours`/`--theirs`: хешированные имена бандлов не совпадают никогда, а `src/web/static.test.mjs` и `web/dist/index.html` поймают расхождение.

## Пример

VL-330: конфликт `UU web/dist/index.html` + `AU/UA/DD index-YIlf626T.js|index-BCbqqSU4.js|index-PYUvZz7L.js`. Резолв: merge отложен, конфликтующие пути перезаписаны свежим `pnpm web:build`, проверка — по совпадению имени бандла в `index.html` и наличии файла в `web/dist/assets`.
