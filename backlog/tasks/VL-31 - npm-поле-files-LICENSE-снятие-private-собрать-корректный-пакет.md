---
id: VL-31
title: 'npm: поле files + LICENSE + снятие private — собрать корректный пакет'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 15:01'
updated_date: '2026-10-01 16:14'
due_date: ''
labels: []
dependencies: []
milestone: ''
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
Сейчас npm pack даёт сломанный и мусорный пакет: (1) корневой dist/ НЕ попадает в пакет (npm уважает .gitignore без поля files), а bin/vibelog.mjs импортирует ../dist/cli/router.js — установленный пакет падает на любой команде; (2) в пакет попадает внутренний мусор: backlog/ (33 файла — dogfooding-задачи), .qwen (конфиг), plan/ (13 файлов), src/ (64 TS-файла), web/src, example-backlog, AGENTS.md — 172 файла / 1.6 МБ; (3) private: true блокирует публикацию; (4) license: MIT объявлен, но файла LICENSE нет.

Что сделать:
1. package.json: поле files — ['bin', 'dist', 'templates', 'web/dist', 'README.md', 'CHANGELOG.md', 'LICENSE']; удалить private; добавить prepublishOnly: 'pnpm build'.
2. Создать LICENSE (MIT, copyright Vibelog.md / Pavel Bobarev, 2026).
3. Проверить npm pack --dry-run: состав только по files; размер падает с 1.6 МБ; dist/cli/router.js и templates/qwen-commands/phase-*.md на месте (оркестратор и статика резолвят их через import.meta.url относительно dist/web/).
4. pnpm test без регрессий.

Имя vibelog.md в npm СВОБОДНО (проверено: npm view → 404); занято короткое vibelog@0.3.4 — конфликта нет.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В package.json добавлено поле files: bin, dist, templates, web/dist, README.md, CHANGELOG.md, LICENSE; приватность private удалена; добавлен LICENSE (MIT)
- [x] #2 npm pack --dry-run: пакет содержит dist/cli/router.js, templates/qwen-commands/phase-1.md, web/dist/index.html; НЕ содержит backlog/, .qwen/, plan/, src/, web/src/, example-backlog/, AGENTS.md
- [x] #3 Добавлен скрипт prepublishOnly (pnpm build); pnpm test по-прежнему 318+/318+
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Факты

- package.json: private: true (блокирует публикацию), поля files НЕТ, prepublishOnly НЕТ; license: MIT объявлен, файла LICENSE нет.
- npm pack --dry-run СЕЙЧАС: 172 файла / 1.6 МБ. Корневой dist/ НЕ в пакете (gitignored, files нет) → шим bin/vibelog.mjs импортирует ../dist/cli/router.js → установленный пакет падает с ERR_MODULE_NOT_FOUND. В пакет лезет: backlog/ (33), .qwen (4), plan/ (13), src/ (64), web/src, example-backlog, AGENTS.md.
- web/dist попадает только потому, что в .gitignore сделана negation !web/dist/ (VL-26).
- Имя vibelog.md свободно (npm view → 404); занято vibelog@0.3.4.
- npm всегда включает сам: package.json, README*, LICENSE*, CHANGELOG* — их не нужно перечислять в files.

## Решение: поле files (whitelist), не .npmignore

Файлы из files не исключаются .gitignore (документация npm) — лечит баг с dist/. Whitelist безопаснее для догфудинг-репозитория: backlog/ и .qwen не утекут никогда. Риск whitelist (забытый новый runtime-каталог) ловится smoke-тестом VL-32. .npmignore — запасной вариант, добавим если dry-run покажет, что dist/ не попал.

## Изменяемые файлы

### 1. package.json
- Удалить строку `"private": true,` (2 строки в файле — в блоке после license).
- Добавить поле files (после bin):
```json
"files": [
  "bin",
  "dist",
  "templates",
  "web/dist"
],
```
- Добавить скрипт: `"prepublishOnly": "pnpm build",` — перед публикацией всегда свежая сборка (web/dist коммитится, пересборка web не обязательна).
- Опционально (безболезненно для npm-страницы): keywords/repository/bugs/homepage — спросить у Pavel, включать ли; без них публикация работает.

### 2. LICENSE (новый файл, корень)
MIT, текст стандартный; строка copyright: `Copyright (c) 2026 Pavel Bobarev` (уточнить у Pavel формулировку — возможно, «Vibelog.md contributors»).

## Порядок действий
1. package.json: files + удалить private + prepublishOnly.
2. LICENSE.
3. Верификация dry-run (см. ниже).
4. pnpm test.
5. Коммит отдельно (feat или chore: npm-упаковка VL-31).

## Верификация
- `npm pack --dry-run 2>&1 | grep` — присутствуют: dist/cli/router.js, templates/qwen-commands/phase-1.md, web/dist/index.html, bin/vibelog.mjs.
- `npm pack --dry-run 2>&1 | grep` — ОТСУТСТВУЮТ: backlog/, .qwen, plan/, src/, web/src, example-backlog, AGENTS.md.
- Количество файлов в пакете падает с 172 до ~25-35.
- `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` — валидный JSON.
- `pnpm test` — без регрессий.
- Если dist/ не попал при files → добавить .npmignore (исключить backlog, .qwen, plan, src, web/src, example-backlog, docs, AGENTS.md) и повторить dry-run.

## Риски
1. **files и старый npm**: документация утверждает, что files перекрывает .gitignore; эмпирическая проверка dry-run — истина в последней инстанции; запасной путь — .npmignore.
2. **Забытый каталог в будущем**: новый runtime-каталог вне files не попадёт в пакет — приучаемся прогонять VL-32 smoke перед релизом (это и есть назначение VL-32).
3. **prepublishOnly требует devDeps** на машине публикатора (tsc) — на машине Pavel есть; в CI-контейнере без pnpm install упадёт — в рамках VL-31 не трогаем.
4. **Copyright в LICENSE** — формулировка требует подтверждения Pavel.
<!-- SECTION:PLAN:END -->