---
id: lesson-136
title: 'В worktree с симлинком node_modules обновляй зависимости через pnpm install --lockfile-only, а не полный install'
status: active
tags:
  - worktree
  - pnpm
  - dependencies
source_tasks:
  - VL-232
linked_tasks:
  - VL-232
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

В git worktree проекта `node_modules` — симлинк на каталог основного репозитория (`node_modules -> /…/Vibelog.md/node_modules`). При удалении зависимости из `package.json` полный `pnpm install` в worktree видит «модульный каталог не соответствует локфайлу», интерактивно предлагает «The modules directory at …/node_modules will be removed and reinstalled from scratch. Proceed?» и в неинтерактивной сессии либо висит до таймаута фазы, либо (при авто-подтверждении) стирает `node_modules` основного репозитория — ломая параллельные worktree, которые этим каталогом пользуются.

## Решение

Для задач, которые только удаляют/добавляют записи в зависимости и не собираются запускать новый пакет, ограничивайся `pnpm install --lockfile-only`: локфайл приводится в соответствие с `package.json` за секунды, физические пакеты в общем `node_modules` не трогаются. Проверка AC «пакет отсутствует в дереве» делается по `pnpm-lock.yaml` (`grep -c <пакет>` → 0) и по `pnpm why <пакет>`; фактическое отсутствие каталога в общем `node_modules` фиксируй в отчёте как ожидаемое поведение симлинка, а не как недоделку.

## Пример

VL-232 (снятие turndown/turndown-plugin-gfm): `pnpm install` дважды убит по таймауту (300 с и 600 с) на интерактивном вопросе; `pnpm install --lockfile-only` завершился за 1.4 с, lock стал чистым (grep turndown/domino → 0), сборка/typecheck/полный `pnpm test` — зелёные.