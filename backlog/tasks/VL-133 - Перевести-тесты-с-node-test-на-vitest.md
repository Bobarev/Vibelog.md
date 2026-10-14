---
id: VL-133
title: Перевести тесты с node --test на vitest
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 23:12'
updated_date: '2026-10-14 22:59'
due_date: ''
labels:
  - tests
  - vitest
  - infra
dependencies:
  - VL-130
  - VL-131
  - VL-132
milestone: v1.8
references: []
priority: high
type: task
project: ''
parent_task_id: VL-129
ordinal: 0
documentation: []
modified_files:
  - AGENTS.md
  - package.json
  - pnpm-lock.yaml
  - vitest.config.mts
  - scripts/migrate-node-test.mjs
  - src/test-setup.mjs
  - src/agent/cli.test.mjs
  - src/agent/interactive.test.mjs
  - src/agent/llm.test.mjs
  - src/agent/loop.test.mjs
  - src/agent/mcp-client.test.mjs
  - src/agent/session.test.mjs
  - src/agent/system-prompt.test.mjs
  - src/agent/tools.test.mjs
  - src/agent/tui-format.test.mjs
  - src/bot/commands.test.mjs
  - src/bot/env.test.mjs
  - src/bot/formatting.test.mjs
  - src/bot/pin.test.mjs
  - src/bot/registry.test.mjs
  - src/bot/restart.test.mjs
  - src/bot/rich.test.mjs
  - src/bot/settings.test.mjs
  - src/cli/batch-checklist.test.mjs
  - src/cli/cli.test.mjs
  - src/cli/config-cli.test.mjs
  - src/cli/create-flags.test.mjs
  - src/cli/create-plan-notes.test.mjs
  - src/cli/decision-cli.test.mjs
  - src/cli/diagnostics.test.mjs
  - src/cli/draft-cli.test.mjs
  - src/cli/init-mcp.test.mjs
  - src/cli/search-cli.test.mjs
  - src/cli/skills.test.mjs
  - src/cli/update-check.test.mjs
  - src/core/add-comment.test.mjs
  - src/core/compat-full.test.mjs
  - src/core/compat.test.mjs
  - src/core/config.test.mjs
  - src/core/core.test.mjs
  - src/core/frontmatter.test.mjs
  - src/core/git.test.mjs
  - src/core/no-network.test.mjs
  - src/core/project-settings.test.mjs
  - src/core/store.test.mjs
  - src/core/worktree.test.mjs
  - src/core/yaml.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/milestones.test.mjs
  - src/mcp/parent.test.mjs
  - src/mcp/search-filters.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/types.test.mjs
  - src/mcp/v11.test.mjs
  - src/web/orchestrator.test.mjs
  - src/web/phase-prompt.test.mjs
  - src/web/qwen-result.test.mjs
  - src/web/static.test.mjs
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Подтверждено Фазой 1: перейти с node --test на vitest. Тесты — *.test.mjs, импортируют dist/ (сборка обязательна: test = build + vitest run). Конвертация: импорт describe/it/before/after из node:test → vitest; node:assert/strict остаётся (vitest не мешает). Особые случаи: t.skip() в контексте теста (frontmatter.test.mjs, compat*.test.mjs) → ctx.skip() vitest; {skip: cond} опция — поддерживается vitest natивно. Тесты используют before/after (≈85 вызовов) → beforeAll/afterAll. Риск: vitest тянет esbuild (prebuilt-бинарники, без node-gyp) — проверить работу на macOS 10.15 Catalina; если проблемы — откат на node --test и эскалация. Зависимости: делается ПОСЛЕ чистки (VL-130, VL-131) и network-guard (VL-133), чтобы конвертировать уже очищенный набор.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 vitest добавлен в devDependencies; vitest.config.mts задаёт include src/**/*.test.mjs, исключает node_modules/refs/dist
- [x] #2 pnpm test = pnpm build && vitest run; все тесты проходят
- [x] #3 Во всех src/**/*.test.mjs импорт из node:test заменён на vitest (describe/it/before/after → vitest-эквиваленты, t.skip → ctx.skip, {skip:...} — нативная опция vitest)
- [x] #4 node:assert/strict оставлен как есть (vitest совместим с assert)
- [x] #5 AGENTS.md и CHANGELOG.md обновлены: упоминание node --test заменено на vitest
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Предусловие
Зависимости VL-130, VL-131, VL-132 выполнены: набор тестов очищен, хрупкие проверки убраны — конвертируем минимальный актуальный набор.

## Шаг 1. Установка vitest
- `pnpm add -D vitest` (Node 20.19 — vitest 3.x поддерживает Node ≥18; проверить совместимость с macOS 10.15: vitest тянет esbuild (prebuilt-бинарники без node-gyp) — если esbuild не стартует на Catalina, эскалировать: оставить node --test и сообщить пользователю).
- Создать `vitest.config.mts`:
  - `test.include: ['src/**/*.test.mjs']`
  - `test.exclude: ['node_modules/**', 'refs/**', 'dist/**', '.vibelog/**', 'example-backlog/**']`
  - `test.fileParallelism: false` — тесты используют spawn/git/tmp-каталоги и process.chdir-подобные паттерны; параллелизация по файлам в первый заход выключается ради стабильности (можно включить позже отдельной задачей).
- `package.json`: `"test": "pnpm build && vitest run"` (оставить build — тесты импортируют dist/).

## Шаг 2. Конвертация тестов (51 файл содержит `from 'node:test'`)
Механика замены в каждом src/**/*.test.mjs:
1. `import { describe, it } from 'node:test'` → `import { describe, it } from 'vitest'`.
2. `before`/`after` (≈85 вызовов, файлы: store, worktree, core, project-settings, add-comment, git, orchestrator, static, session, tools и др.) → `beforeAll`/`afterAll` из vitest.
3. `import assert from 'node:assert/strict'` — ОСТАВИТЬ как есть (vitest совместим с node:assert; замена на expect — отдельная опциональная задача, не входит в VL-129).
4. Особые случаи:
   - `src/core/frontmatter.test.mjs` (стр. 142-193): `async (t) => { ... t.skip(...) }` → контекст vitest: `async (ctx) => { ctx.skip() }` (vitest поддерживает ctx.skip()).
   - `src/core/compat.test.mjs`: `it.skip('...')` — нативно поддерживается vitest, не трогаем.
   - `src/core/worktree.test.mjs:182`: `it('...', { skip: !existsSync(realTsc) }, fn)` — опция `{skip}` есть и в vitest, не трогаем.
5. Автоконвертация: написать node-скрипт `scripts/migrate-node-test.mjs` (sed-замены по шаблонам выше, прогон по списку файлов из glob) — ручная правка 51 файла ненадёжна. После автоконверта — ручной проход по файлам с before/after и t.skip.
6. Удалить из `package.json` устаревшее упоминание, обновить scripts/lint по желанию (`node --check bin/*.mjs` не трогаем).

## Шаг 3. Документация
- `AGENTS.md` стр. 35: «`pnpm test` = build + `node --test src`» → «`pnpm test` = build + `vitest run`»; «Тесты — `*.test.mjs` (импортируют `dist/`)» — уточнить: vitest, include src/**/*.test.mjs.
- `CHANGELOG.md` — запись о переходе на vitest.

## Проверка
1. `pnpm test` — все тесты проходят (сравнить итоговое число passed с `node --test src` до миграции — не должно отличаться более чем на удалённые в VL-130/131).
2. `pnpm lint` — зелёный.
3. Негативная: сломать один assert → vitest показывает падение с читаемым выводом.
4. `grep -rn "node:test" src --include="*.test.mjs"` — пусто.

## Риски
- esbuild на macOS 10.15 Catalina — главный риск; mitigation: проверить сразу после pnpm add (`pnpm exec vitest run src/core/config.test.mjs`), при старте бинарника не запускается — откат + комментарий в эпик.
- vitest транспайлит .mjs — может по-другому обрабатывать top-level await; тесты используют ESM import dist/ — ожидаемо работает.
- Порядок beforeAll vs подсетап tmp-каталогов: в node:test before() в describe выполняется перед всеми it в describe; в vitest beforeAll — так же. Поведение эквивалентно.
- `{skip}`/ctx.skip — сверить, что cond вычисляется одинаково (vitest вычисляет options при регистрации).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 00:42
---
## Фаза 3 (Code) выполнена. Коммит `76f0dee` (feat: VL-133 — перевести тесты с node --test на vitest).
### Что сделано по Implementation Plan
**Шаг 1 — установка vitest:**
- `pnpm add -D vitest` → vitest 5.0.4 (Node v20.19.0, darwin-x64 — esbuild/vite prebuilt-бинарники стартуют, риск Catalina не реализовался; проверено сразу: `pnpm exec vitest --version`).
- Создан `vitest.config.mts`: `include: ['src/**/*.test.mjs']`, `exclude: node_modules/refs/dist/.vibelog/example-backlog`, `fileParallelism: false` (тесты спавнят git/CLI и мок-серверы — параллелизм выключен ради стабильности).
- **Дополнительно к плану (право на корректировку):**
  - `setupFiles: ['./src/test-setup.mjs']` — глобальный fetch-guard VL-132 перенесён в vitest (бонус, предложенный VL-132: в node --test он подключался через `--import`, в vitest эквивалент — setupFiles; файл идемпотентен, комментарий в нём обновлён).
  - `testTimeout/hookTimeout: 120_000` — в node:test таймаутов по умолчанию не было, в vitest дефолт 5s, а тесты спавнят git/CLI и ждут мок-серверы.
- `package.json`: `"test": "pnpm build && vitest run"` (build оставлен — тесты импортируют dist/).
**Шаг 2 — конвертация 52 тестовых файлов:**
- Написан автоконвертер `scripts/migrate-node-test.mjs` (идемпотентен): импорт `from 'node:test'` → `from 'vitest'` с переименованием before→beforeAll/after→afterAll (в импорте и в ~85 вызовах; beforeEach/afterEach не тронуты — имена совпадают в обоих рантаймах).
- `node:assert/strict` — оставлен везде как есть (AC-4).
- Особые случаи: `frontmatter.test.mjs` — 4 места `async (t) => { t.skip(msg); return; }` → `async (ctx) => { ctx.skip(); }` (сообщение-аргумент у vitest не поддерживается); `compat.test.mjs`/`compat-full.test.mjs` `it.skip` и `worktree.test.mjs:182` `{ skip: cond }` — нативны в vitest, не тронуты; `no-network.test.mjs` `import { test } from 'vitest'`.
- Проверка чистоты: `grep node:test src --include=*.test.mjs` — пусто; случайных замен в комментариях/строках нет (сверка диффа).
**Шаг 3 — документация:**
- `AGENTS.md` (стр. 35): «`pnpm test` = build + `node --test src`» → «`pnpm test` = build + `vitest run` (Vitest, конфиг — vitest.config.mts…».
- `CHANGELOG.md` — **НЕ обновлён**: по правилам Фазы 3 итоговую документацию пишет Фаза Close после слияния (VL-126).
### Проверки
1. `pnpm test` — **52 файла / 838 тестов, 0 падений** (2 прогона; 838 = 831 после VL-131 + 7 no-network из VL-132 — регрессий нет). Сборка tsc чистая.
2. `pnpm lint` — зелёный.
3. Негативная: подмена assert на `assert.ok(false, ...)` в config.test.mjs → vitest показывает читаемый `FAIL … AssertionError` с именем describe/it и номером строки; правка откатена.
4. `grep node:test` по тестам — пусто.
### Отмечено / осталось
- Отмечены AC 1–4, DoD «Тесты проходят» и «Нет регрессий».
- **Не отмечено:** AC-5 «AGENTS.md и CHANGELOG.md обновлены» и DoD «Документация обновлена» — AGENTS.md обновлён, но CHANGELOG.md в Фазе 3 обновлять запрещено (пишет Фаза Close, VL-126); после её выполнения оба пункта можно закрыть.
- Рекомендация Фазе Close: запись в CHANGELOG о переходе тестов на vitest.
### Замечание для ревьюера
При негативной проверке `git checkout -- <файл>` откатывает и миграцию этого файла (он уже изменён VL-133) — восстановление через повторный запуск `node scripts/migrate-node-test.mjs` (скрипт идемпотентен).
---
author: @agent
created: 2026-10-13 00:47
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 76f0dee (закоммичен Фазой 3, дополнительно не требовался — все modified_files уже в нём), docs 130785c (CHANGEAGEL.md — запись Unreleased о переходе тестов на vitest). Отмечены AC-5 (AGENTS.md обновлён в Фазе 3, CHANGELOG.md — в этой фазе) и DoD «Документация обновлена». Не закоммичено: нет — рабочее дерево по файлам задачи чистое. Подзадачи VL-130/131/132 — независимые задачи-зависимости, уже закрыты своими коммитами; эпик VL-129 закрывается отдельно.
---
<!-- COMMENTS:END -->