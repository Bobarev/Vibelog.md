---
id: VL-22
title: 'Инфраструктура TypeScript: tsconfig, build, devDeps'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 02:22'
updated_date: '2026-10-01 02:41'
due_date: ''
labels:
  - typescript
  - migration
dependencies: []
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
Подготовить проект к миграции на TypeScript без нарушения ключевых ограничений: zero runtime dependencies (TypeScript — только devDependency, чистый JS-пакет без нативных модулей, работает на Node.js 20/Catalina), ESM, совместимость с Backlog.md. Схема: исходники .ts → tsc компилирует в dist/ обычный ESM; bin/vibelog.mjs остаётся точкой входа и импортирует из dist. allowJs — для постепенной миграции, пока часть src остаётся .mjs. Открытый вопрос для Фазы 2: судьба тестов *.test.mjs (компиляция в dist или импорт dist из .mjs-тестов) и declaration-файлы (.d.ts) для типов ядра.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 typescript и @types/node добавлены только в devDependencies; поле dependencies в package.json остаётся пустым (zero runtime deps сохранён), pnpm install без нативных модулей
- [x] #2 tsconfig.json в корне: strict, module NodeNext, target ES2022, outDir dist, allowJs включён для .mjs-исходников на время миграции; скрипты package.json build (tsc) и typecheck (tsc --noEmit) существуют и проходят
- [x] #3 pnpm build компилирует src → dist; бинарь работает из dist-сборки: vibelog --version и vibelog task list --json выполняются без ошибок, pnpm test зелёный
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
Цель: инфраструктура TS без изменения поведения. Сейчас: src — чистые .mjs, тесты тестируют src, bin импортирует src.

## Файлы
- package.json — devDeps + скрипты
- tsconfig.json — новый
- .gitignore — +dist/
- bin/vibelog.mjs:9 — импорт роутера → dist

## Шаги
1. pnpm add -D typescript @types/node (чистый JS, без нативных модулей; dependencies остаётся пустым — zero runtime deps)
2. tsconfig.json: target ES2022; module/moduleResolution NodeNext; rootDir src; outDir dist; allowJs true; checkJs false; strict true; noEmitOnError true; skipLibCheck true; forceConsistentCasingInFileNames true; types ["node"]; include src/**/*; exclude src/**/*.test.mjs, dist. checkJs:false — .mjs компилируются в dist без проверки типов (постепенная миграция)
3. package.json scripts: "build": "tsc"; "typecheck": "tsc --noEmit"; "test": "pnpm build && node --test src"; lint без изменений
4. .gitignore: +dist/
5. pnpm build — dist зеркалит src (*.mjs скомпилированы, тесты исключены)
6. bin/vibelog.mjs: импорт '../src/cli/router.mjs' → '../dist/cli/router.mjs' (router пока .mjs → dist .mjs; в VL-24 сменится на .js)
7. Верификация: pnpm typecheck && pnpm build; node bin/vibelog.mjs --version; --version --json; task list --json; search --json; pnpm test (unit на src + CLI/MCP-тесты спавнят бинарь через шим → dist); ls dist/cli/router.mjs

## Решения по открытым вопросам
- Тесты: остаются .mjs, исключены из компиляции, импортируют src (переключение на dist — в VL-23/24)
- .d.ts: не нужны (private-проект, публикации в npm нет)

## Риски
- После переключения шима vibelog в PATH работает через dist — обязателен pnpm build после pnpm install (задокументировать в VL-24)
- dyld/SIGABRT на Catalina — при падениях смотреть содержимое вывода, не exit code
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 02:41
---
Фаза 3 (Code) VL-22 выполнена 2026-10-01.

Изменения:
- package.json: devDependencies typescript@7.0.2 + @types/node@26.6.3 (dependencies пуст — zero runtime deps сохранён); скрипты build (tsc), typecheck (tsc --noEmit), test (pnpm build && node --test src)
- tsconfig.json (новый): strict, NodeNext, ES2022, rootDir src, outDir dist, allowJs true, checkJs false, noEmitOnError, skipLibCheck, exclude *.test.mjs
- .gitignore: +dist/
- bin/vibelog.mjs: импорт роутера '../src/cli/router.mjs' → '../dist/cli/router.mjs'

Проверки:
- pnpm typecheck — OK
- pnpm test — 306/306, fail 0
- node bin/vibelog.mjs --version → vibelog.md 1.4.0 (пути/Node корректны)
- --version --json, task list --json, search --json — OK из dist
- MCP round-trip через шим: initialize + tools/list → server vibelog-md 1.4.0 (версия из package.json), 21 инструмент
- dist зеркалит src, тестов в dist нет (исключены)

Открытый момент для VL-24: README/AGENTS.md ещё не отражают обязательность pnpm build после pnpm install (bin теперь работает через dist).
---
<!-- COMMENTS:END -->