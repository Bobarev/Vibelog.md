---
id: VL-23
title: Миграция ядра src/core на TypeScript
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 02:22'
updated_date: '2026-10-01 02:34'
due_date: ''
labels:
  - typescript
  - migration
dependencies:
  - VL-22
milestone: v1.5
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Перевести слой ядра на TypeScript: все модули src/core/*.mjs → .ts со строгой типизацией (frontmatter, YAML-парсер, store, git-хелперы, поиск, задачи, вехи, документы, черновики, решения). Это сердце совместимости с Backlog.md — поведение и формат данных не должны измениться, типы усиливают контракт, а не меняют логику. Публичные API ядра экспортируются с типами (JSDoc убирается как дублирующий слой или заменяется на типы TS). Тесты core переводятся на ту же схему, что выбрана в VL-22.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все 15 модулей src/core/*.mjs (config, yaml, frontmatter, markdown, task, store, deps, id, paths, git, search, milestone, document, draft, decision) переведены на TypeScript; pnpm typecheck без ошибок, strict-режим без as any и необоснованных any
- [ ] #2 Формат данных Backlog.md не изменился: round-trip задач/вех/решений сохраняет все поля (совместимость frontmatter, AC/DoD, статусов) — существующие compat-тесты проходят против dist-сборки
- [ ] #3 Тесты ядра зелёные: pnpm test проходит по модулям core (схема запуска тестов против dist определена в VL-22)
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
Цель: 15 модулей core → .ts, строгие типы; поведение и формат Backlog.md не меняются. Механика: .ts компилируется в dist/*.js; specifier'ы всех импортёров '.mjs' → '.js'; тесты мигрированных модулей импортируют dist (src больше не содержит этих файлов).

## Файлы
- src/core/*.mjs → .ts (15): yaml, markdown, frontmatter, id, paths, config, git, task, deps, store, search, milestone, document, draft, decision
- Специфайтеры импортёров (grep-driven): src/cli/commands/*.mjs (board, browser, draft, init, milestone, decision, doc, doctor, task, config, search — только строки импортов core), src/web/api.mjs:13-14, тесты: src/core/*.test.mjs (6), src/cli/create-flags.test.mjs, src/cli/batch-checklist.test.mjs, src/mcp/types.test.mjs, src/mcp/search-filters.test.mjs + все остальные по grep -rn "from '.*core/"

## Порядок (слои зависимостей снизу вверх; после каждого слоя: pnpm typecheck && pnpm build && pnpm test)
1. Листья: yaml, markdown, frontmatter, id, paths
2. config, git
3. task, deps
4. store (ядро round-trip — максимальная аккуратность)
5. search, milestone, document, draft, decision

## На каждый модуль
git mv X.mjs X.ts (сохранить историю); strict-типизация: сигнатуры экспортов, интерфейсы Task/Milestone/Document/Decision (JSDoc частично уже есть — переиспользовать); @param/@type/@returns убрать (дублируют TS-типы), русские пояснительные комментарии и краткий JSDoc-блок сохранить (правило AGENTS.md); обновить specifier'ы: grep -rn "from '.*X\.mjs'" src → X.js; в тестах путь на dist: './X.mjs' → '../../dist/core/X.js' (src/core) / '../core/X.mjs' → '../../dist/core/X.js' (src/mcp, src/cli).

## Верификация (финал)
pnpm typecheck && pnpm build && pnpm test — без падений; grep -rn "\.mjs'" src --include="*.ts" → пусто; grep импортёров core на '.mjs' → пусто; compat-тесты (../Backlog.md) зелёные — форматы не изменились.

## Риски
- tsc может репортить unresolved-import в непроверяемых .mjs-импортёрах ('../../core/store.js' нет в src) — проверить на первом модуле (yaml) до масштабирования; fallback: @ts-nocheck в этих .mjs
- store.mjs — центральный модуль; мигрировать в конце своего слоя, сразу compat-тесты
- git.mjs/execSync, process.cwd() — типы из @types/node; логику не менять
- Смешанное состояние specifier'ов (.js у мигрированных, .mjs у остальных) — норма перехода; финальный grep обязателен
<!-- SECTION:PLAN:END -->