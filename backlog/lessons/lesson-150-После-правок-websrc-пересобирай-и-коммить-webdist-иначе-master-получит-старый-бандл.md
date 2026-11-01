---
id: lesson-150
title: После правок web/src пересобирай и коммить web/dist — иначе master получит старый бандл
status: active
tags:
  - web
  - build
  - worktree
  - git
source_tasks: []
linked_tasks:
  - VL-283
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`web/dist/` в этом репозитории коммитится (VL-26: `!web/dist/` в .gitignore). Если в фазе Code править `web/src/**`, но не прогнать `pnpm --dir web run build` и не закоммитить получившийся `web/dist/`, в ветке остаётся старый бандл. Merge в master проходит без конфликта (файлы те же), но master отдаёт старую UI-сборку — правки пользователь не увидит, а тесты этого не ловят (static.test.mjs проверяет только что ассеты отдаются).

Симптом в Фазе Close: `git -C <worktree> status --porcelain` показывает ` M web/dist/index.html`, ` D web/dist/assets/index-<old>.js`, `?? web/dist/assets/index-<new>.js` — то есть сборка в worktree была сделана, но не закоммичена.

## Решение

В Фазе Close при грязном worktree сначала проверить, что изменения `web/dist` — это результат сборки (хэши `index-*.js/.css` в `index.html` совпадают с новыми именами файлов), и закоммитить их явными путями в ветку задачи ДО merge. Только после этого сливать ветку.

В фазе Code — не забывать про `pnpm --dir web run build` + коммит `web/dist` вместе с исходниками (в worktree для этого нужен `web/node_modules`; если их нет — `pnpm --dir web install`).

## Пример

```bash
git -C .vibelog/worktrees/vl-283 status --porcelain
#  M web/dist/index.html, ?? web/dist/assets/index-eG0HY1c7.js, D web/dist/assets/index-CBADKVOf.js
git -C .vibelog/worktrees/vl-283 add web/dist/index.html web/dist/assets/index-eG0HY1c7.js \
  web/dist/assets/index-BiXO5vmL.css web/dist/assets/index-CBADKVOf.js web/dist/assets/index-beid_l-s.css
git -C .vibelog/worktrees/vl-283 commit -m "feat: VL-283 — пересобрать web/dist под бейдж роли треда"
```
