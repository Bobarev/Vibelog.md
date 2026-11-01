---
id: lesson-28
title: 'Конфликты web/dist при merge разрешай пересборкой pnpm web:build из слитых исходников, а не выбором версии'
status: active
tags:
  - git
  - merge
  - close
  - web
  - dist
  - build
source_tasks:
  - VL-181
linked_tasks:
  - VL-181
  - VL-269
created_date: 2026-10-25
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

При merge ветки задачи в master конфликтуют артефакты сборки `web/dist/` (`index.html` со scratch hash-именами JS/CSS, rename/delete старых `index-*.css/js`): master и ветка собирали веб в разные моменты, hash-имена всегда различаются, ручной выбор версии даёт ссылки на несуществующие файлы.

## Решение

Разрешай конфликты `web/dist` не выбором стороны, а пересборкой: `git checkout --theirs web/dist/index.html` (или любая сторона) только чтобы снять UU → `pnpm web:build` из слитых исходников → `git add` новых hash-файлов + `git rm` осиротевших `index-*.{js,css}` → merge-коммит. Затем обязательны `pnpm build && pnpm test` в главном репо.

## Пример

VL-181: конфликты `web/dist/index.html` (UU) и `index-XTk9xSwk.css` (rename/delete) → пересборка дала `index-CVG3Dl33.js`/`index-CbZbgdpg.css`, старые `index-ChqgxU6C.js`/`index-XTk9xSwk.css` удалены, `index-BynvGmqR.css`/`index-CFiCUeyT.js` из ветки заменены — merge завершён без ручного редактирования хэшей.