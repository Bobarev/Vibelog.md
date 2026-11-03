---
id: ref-25
title: Svelte CLI
type: repo
url: 'https://github.com/sveltejs/cli'
tags:
  - cli
  - svelte
  - wizard
  - prompts
  - ux
created_date: 2026-11-03
linked_tasks:
  - VL-320
---
Официальный CLI Svelte (`sv` / `npx sv create`). Эталон интерактивного wizard-а для `vibelog init`: аккуратный TUI на `@clack/prompts` (стрелки, space-галочки, курсор на активной строке, корректная работа в не-TTY), группировка вопросов через `p.group` с зависимостями между шагами, разумные дефолты из контекста, явные флаги для non-interactive режима, аккуратные сообщения об ошибках и отмена по Ctrl+C без падения.

Что смотреть при переносе в `vibelog init` (VL-210):
- `packages/sv/src/cli/create.ts` — оркестрация wizard-а: `p.group({...})` (шаги как ключи, зависимости через `results`), `p.select` с `initialValue`/`hint`, `p.confirm`, `p.note` с итоговыми шагами, `p.cancel` + `process.exit(0)` на отмене, `p.isCancel` после каждого промпта.
- `packages/sv/src/cli/add.ts` — множественный выбор (галочки) и валидация выбора.
- `packages/sv/src/core/common.ts` — `runCommand` (единый обработчик ошибок/отмены), `cliOptions`, `helpConfig`, `normalizePosix`.
- `packages/sv/src/core/package-manager.ts` — детект окружения и промпт выбора.
- Валидация флагов — `valibot` (`v.strictObject`, `v.picklist`), `commander` с `.choices()` и `.conflicts()`; при невалидном флаге — `console.error` + `exit(1)`.
- Non-interactive: «Provide --template, --types, --add, and --install (or --no-install) to skip prompts entirely» — флаги полностью выключают соответствующий промпт (проверка `if (options.x) return Promise.resolve(options.x)`).