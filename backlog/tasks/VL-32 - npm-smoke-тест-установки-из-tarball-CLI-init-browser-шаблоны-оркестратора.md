---
id: VL-32
title: 'npm: smoke-тест установки из tarball — CLI, init, browser, шаблоны оркестратора'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 15:01'
updated_date: '2026-10-01 16:33'
due_date: ''
labels: []
dependencies:
  - VL-31
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
После VL-31 пакет должен реально работать у пользователя. Smoke-тест:
1. npm pack — получить vibelog.md-<версия>.tgz.
2. Чистый каталог /tmp/vibelog-smoke: npm install <tarball> (без -g, через node_modules/.bin).
3. Проверить цепочку: vibelog --help → vibelog init в пустом /tmp-проекте → vibelog task create "Тест" → vibelog task list (вывод содержит задачу) → vibelog browser --no-open --port 3040 + curl / (React UI) + curl /api/tasks (JSON).
4. Убедиться, что шаблоны оркестратора (templates/qwen-commands/) и web/dist доступны из установленного пакета — резолв путей через import.meta.url работает при установке из tarball (не только из репозитория).
5. Все проверки — Node.js/bash, тестовые каталоги в /tmp (не в репозитории).

Ловушка, которую ловит этот тест: npm НЕ уважает .gitignore как источник истины для файлов, перечисленных в files — но если files указан неверно, dist/ не попадёт и шим упадёт с ERR_MODULE_NOT_FOUND. Тест ловит это до публикации.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 npm pack создаёт tarball; установка в чистый каталог /tmp/vibelog-smoke через npm install <tarball> проходит без ошибок
- [x] #2 Из установленного пакета работают: vibelog --help, vibelog init (в /tmp-проекте создаёт backlog/), vibelog task create/list; vibelog browser отдаёт React UI (web/dist/index.html) — проверено curl-ом
- [x] #3 Проверено, что templates/qwen-commands/phase-*.md читаются из установленного пакета (путь резолвится относительно dist/web/orchestrator.js); в /tmp-каталоге после установки нет backlog/, .qwen/
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

- npm 10.8.2, node v20.19.0; пакет vibelog.md — **zero runtime dependencies** → `npm install <tarball>` работает офлайн.
- `npm pack` запускает `prepack`/`prepare`, НЕ `prepublishOnly` (тот — только на `npm publish`) → tarball собирается из текущего dist/ на диске; dist/ gitignored, поэтому перед pack скрипт обязан прогнать `pnpm build` (ловит и случай «свежий клон без сборки»).
- `init` создаёт backlog/ + config.yml + подкаталоги (init.ts:5-10).
- CLI печатает ошибки в stderr с exit 0 (память) → проверять объединённый stdout+stderr через spawnSync.
- Тестовые каталоги — только /tmp (память об изоляции: findBacklogDir поднимается вверх).

## Изменяемые/создаваемые файлы

### 1. scripts/npm-smoke.mjs (новый, постоянный артефакт)
Повторяемый smoke-тест перед релизом (переиспользуем в VL-33). Структура:
- Шаг 0: `pnpm build` (spawnSync, cwd=корень репо) — иначе pack упакует пустой dist/.
- Шаг 1: `npm pack --pack-destination <tmp>` → vibelog.md-<версия>.tgz (tmp = mkdtempSync в os.tmpdir()).
- Шаг 2: чистый installDir = mkdtempSync; npm init -y; `npm install <tarball> --no-audit --no-fund` (cwd=installDir).
- Шаг 3: проверки через installDir/node_modules/.bin/vibelog (spawnSync, merged stdout+stderr):
  a. `--help` → код 0, вывод содержит "vibelog".
  b. `init` в пустом projectDir (тоже в /tmp): создаётся backlog/config.yml + backlog/tasks/.
  c. `task create "Smoke Тест"` → `task list` → вывод содержит "Smoke Тест".
  d. `browser --no-open --port 3041` (spawn, фон) → fetch http://127.0.0.1:3041/ → 200, body содержит `id="root"` (React UI из web/dist); fetch /api/tasks → 200 JSON-массив; сервер — kill в finally.
- Шаг 4: проверки содержимого установленного пакета (node_modules/vibelog.md/):
  - templates/qwen-commands/phase-1.md, phase-2.md, phase-3.md существуют и читаются (резолв import.meta.url работает из tarball);
  - web/dist/index.html существует;
  - НЕТ backlog/ и .qwen (whitelist VL-31 отработал).
- Итог: сводка PASS/FAIL по пунктам, exit 1 при любом провале; finally — rmSync всех tmp-каталогов.

### 2. CHANGELOG.md
Запись в [Unreleased]: добавлен scripts/npm-smoke.mjs — smoke-тест установки из tarball (использовать перед npm publish).

### 3. AGENTS.md (одна строка)
В раздел про релиз/проверки: перед публикацией в npm гонять `node scripts/npm-smoke.mjs`.

## Порядок действий
1. scripts/npm-smoke.mjs.
2. Запуск: `node scripts/npm-smoke.mjs` — все пункты PASS.
3. CHANGELOG + AGENTS.md.
4. `pnpm test` — без регрессий.
5. Уборка: проверить, что tarball/tmp удалены, git status чистый кроме ожидаемого.

## Верификация
- Сам скрипт и есть верификация: `node scripts/npm-smoke.mjs` → exit 0, все пункты PASS (pack, install, --help, init, create/list, browser+curl, шаблоны, отсутствие backlog/.qwen).
- `pnpm test` — 318+/318+.
- Побочно: `git status --short` — тарболл *.tgz не остался в репо (npm pack пишет в tmp-каталог).

## Риски
1. **Порт 3041 занят** — сервер упадёт с EADDRINUSE (exit 1); скрипт даст понятный FAIL по пункту browser. Mitigation: захардкоженный редкий порт + понятный текст ошибки.
2. **Свежий клон без dist/** — ловится шагом 0 (pnpm build в скрипте).
3. **Офлайн-среда** — npm install локального tarball без сети работает (нет runtime-зависимостей); если npm всё же полезет в сеть (audit/fund) — отключаем флагами --no-audit --no-fund.
4. **Долгий прогон** — pack+install ~10-30с, одноразово перед релизом; в pnpm test НЕ включаем (не замедляем CI/повседневные прогоны).
<!-- SECTION:PLAN:END -->