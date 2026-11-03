---
id: lesson-196
title: 'После pnpm add в worktree с симлинком node_modules восстанавливай .bin-шимы главного репо через rm -rf node_modules/.bin && pnpm install'
status: active
tags:
  - worktree
  - pnpm
  - node_modules
  - build
  - close
source_tasks:
  - VL-322
linked_tasks:
  - VL-322
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

В git worktree проекта `node_modules` — симлинк на каталог основного репозитория. `pnpm add <pkg>` из worktree переписывает `node_modules/.bin/*` шимы главного репо путями, рассчитанными на глубину worktree (`$basedir/../../../../../node_modules/.pnpm/...`). После удаления worktree эти пути ведут в никуда, и `pnpm build` в главном репо падает с `Cannot find module '.../node_modules/.pnpm/typescript@7.0.2/node_modules/typescript/bin/tsc'` — при том что сам пакет на месте и `node node_modules/typescript/bin/tsc` работает.

## Решение

После любой `pnpm add`/`pnpm install` из worktree, прежде чем собирать главный репо, пересоздай шимы: `rm -rf node_modules/.bin && pnpm install --offline --frozen-lockfile`. Проверка — `grep basedir/ node_modules/.bin/tsc`: путь должен быть коротким (`$basedir/../typescript/bin/tsc`), без `../../../../../`. Не диагностируй это как поломку кода и не правь `src/` — это артефакт окружения.

## Пример

VL-322: `pnpm add @clack/prompts@1.5.0` из `.vibelog/worktrees/vl-322` (с `--virtual-store-dir` главного репо) сломал `.bin/tsc`; `pnpm build` в master упал на MODULE_NOT_FOUND. `rm -rf node_modules/.bin && pnpm install --offline --frozen-lockfile` вернул короткие шимы, `pnpm build` — exit 0, полный `pnpm test` — 161 файл, 3048 тестов passed.
