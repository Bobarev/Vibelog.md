---
id: VL-140
title: 'Тесты: явные env-объекты для spawn-спавнов и включение fileParallelism (параллелизм по файлам)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 11:21'
updated_date: '2026-10-14 22:59'
due_date: ''
labels: []
dependencies: []
milestone: v1.8
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/bot/restart.ts
  - src/bot/restart.test.mjs
  - src/cli/cli.test.mjs
  - vitest.config.mts
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Главный рычаг ускорения тестов: сейчас fileParallelism: false (VL-133 выключил осознанно — глобальные process.env-хаки в тестах сделали бы параллелизм гоночным). Причина: orchestrator.test пишет process.env.VL28_STUB_MARKER/VL28_STUB_SLEEP/VIBELOG_QWEN_BIN и др., а llmEnv() в cli.test spreads process.env — при параллельном запуске файлов тесты видят env друг друга (это же была природа инцидентов VL-117/VL-125).

План:
1. Явные env-объекты: каждый spawn/spawnSync в тестах получает env, собранный явно ({ ...process.env, ...нужные } внутри СПАВНА, без записи в process.env родителя; заглушки читают env из аргументов spawn, а не из глобала). Убрать process.env-мутации из orchestrator.test (VL28_STUB_*), restart-тестов и подобных.
2. fileParallelism: true — на 4 CPU ожидание −50…70 с (144 → ~70-90).
3. Разгрузка cli.test: интеграционный spawnSync оставить там, где проверяется сам CLI-процесс (JSON-контракт, exit); чистую логику проверять импортом dist напрямую — минус десятки spawn'ов по 300-500 мс.
4. Обязательная верификация: 3 полных прогона подряд + прогон с VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME/VIBELOG_CWD в окружении (регрессия VL-125) + замер времени.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 все тест-файлы со спавном не полагаются на process.env родителя: spawn/spawnSync получают явный env-объект (база process.env + только нужные ключи); глобальные process.env.VL28_STUB_*/VIBELOG_QWEN_BIN убраны или локализованы в конкретный спавн
- [x] #2 vitest.config.mts: fileParallelism: true — 3 последовательных полных pnpm test без флаков и падений (включая прогоны с VIBELOG_PHASE_* в окружении — регрессия VL-125)
- [x] #3 cli.test.mjs: часть проверок переведена на прямой импорт dist (без spawnSync node CLI) там, где не проверяется сам процесс CLI; замер доли до/после
- [x] #4 итоговый замер: pnpm test ≤ ~80 с (цель ~50-70); CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
Включить fileParallelism в Vitest, устранив корневую причину его выключения (VL-133): глобальные process.env-мутации в тестах, от которых зависят spawn'ы оркестратора и CLI. Плюс — разгрузить cli.test.mjs переводом чистой логики на прямой импорт dist.

## Файлы для изменения
1. `src/web/orchestrator.ts` — тестовый шов явного env для spawn фаз
2. `src/web/orchestrator.test.mjs` — убрать 100% process.env-мутаций (202 упоминания process.env)
3. `src/bot/restart.ts` — необязательный параметр env у spawnReplacementBot
4. `src/bot/restart.test.mjs` — явный env вместо delete TELEGRAM_BOT_TOKEN из process.env
5. `vitest.config.mts` — fileParallelism: true + новый doc-комментарий
6. `src/cli/cli.test.mjs` — перевод ~12 spawnSync-проверок на прямой импорт dist
7. `CHANGELOG.md` — запись в Unreleased

## Шаг 1. src/web/orchestrator.ts — шов spawnEnvBase
Прод-код спавнит стаб-скрипт тестов; тесты управляют стабом через env. Решение — тестовый шов (внутренние API развиваются свободно):

- Рядом с activeRuns (~стр. 40-50): модульная переменная `let spawnEnvBaseOverride: NodeJS.ProcessEnv | null = null;` + экспорт `setSpawnEnvBaseForTests(env: NodeJS.ProcessEnv | null)` с JSDoc «тестовый шов VL-140: заменяет process.env как базу env спавна фаз; null — прод-режим».
- В spawnQwenRun (стр. 244-354) ввести хелпер `baseEnv() = spawnEnvBaseOverride ?? process.env` и применить:
  - стр. 279-283: `spawnEnv = { ...baseEnv(), VIBELOG_PHASE_TASK_ID..., VIBELOG_PHASE_NAME... }` (было ...process.env);
  - стр. 305: `spawnEnv = { ...(spawnEnv ?? baseEnv()), VIBELOG_CWD: cwd }`;
  - стр. 319-323: резолв бинаря читать VIBELOG_AGENT_BIN/VIBELOG_QWEN_BIN из baseEnv(), а не process.env;
  - стр. 348-354: spawn ВСЕГДА получает явный env — `env: spawnEnv ?? baseEnv()` (убрать условный `...(spawnEnv ? { env: spawnEnv } : {})`).
- Прод-поведение при override=null не меняется (baseEnv() === process.env).

## Шаг 2. src/web/orchestrator.test.mjs — явные env-объекты
- Импортировать setSpawnEnvBaseForTests из ../../dist/web/orchestrator.js.
- Хелпер `setStubEnv(patch)`: собирает полный объект `{ ...process.env }` MINUS ключи VL-125-гварда (VIBELOG_CWD, VIBELOG_PHASE_TASK_ID, VIBELOG_PHASE_NAME), плюс `VIBELOG_QWEN_BIN: stubBin`, плюс patch — и передаёт в setStubEnvBaseForTests. Это даёт: (а) стаб-спавн получает только нужные ключи, (б) регрессия VL-125 закрыта без записи в process.env.
- beforeAll (стр. 96-117): вместо savedEnv-цикла save/delete + process.env.VIBELOG_QWEN_BIN = stubBin — один вызов setStubEnv({}); afterAll: setStubEnvBaseForTests(null).
- Заменить все присваивания process.env.* в тестах (строки 104, 168-172, 199-233, 264-295, 329-332, 360-380, 401-441, 471-503, 536-570, 601-635, 668-674, 732-735, 753, 769-772, 811-843) на setStubEnv({...}) — стаб-скрипт (стр. 36-64) не меняется: его process.env — это и есть явно переданный spawn-env.
- Контроль: `grep -nE "process\.env\.[A-Z_0-9]+\s*=" src/web/orchestrator.test.mjs` → 0 совпадений.

## Шаг 3. restart: явный env
- src/bot/restart.ts (стр. 38-50): 4-й необязательный параметр `env?: NodeJS.ProcessEnv`; в опции spawn `...(env ? { env } : {})`.
- src/bot/restart.test.mjs (стр. 27-33, 39, 54): убрать beforeAll/afterAll save/delete TELEGRAM_BOT_TOKEN; в обоих тестах собрать `const { TELEGRAM_BOT_TOKEN: _omit, ...env } = process.env;` и передать: spawnReplacementBot(cwd, 'pipe', undefined, env).

## Шаг 4. src/cli/cli.test.mjs — разгрузка spawnSync
Было ~14 spawn/execFileSync по 300-500 мс. Перевести на прямой импорт dist (runInit/runTask/runBoard/runSearch/runInstructions из dist/cli/commands/*.js, route(['help']) из dist/cli/router.js) с cwd=testDir и перехватом вывода (vi.spyOn console.log / process.stdout.write — уточнить по src/cli/ui.ts при реализации):
- help-справку, init, task create/list/view/edit/check-ac/labels, search, board, instructions — прямой импорт.
- Оставить spawnSync: «пустой запуск без аргументов (не-TTY) — exit 0» и «повторная инициализация запрещена» (контракт самого процесса CLI). Проверка package.json (алias vb) спавна не имеет — не трогать.
- Замерить долю spawn'ов до/после в файле (цель: 14 → 2).

## Шаг 5. vitest.config.mts
- fileParallelism: false → true (стр. ~20).
- Переписать doc-комментарий (стр. 8-14): причина отключения устранена (VL-140) — тесты больше не полагаются на process.env родителя; мок-серверы на эфемерных портах (listen(0)), /tmp-каталоги уникальны per-file.

## Шаг 6. CHANGELOG.md
Запись в Unreleased: VL-140 — fileParallelism включён; явные env-объекты для spawn в тестах (шов setSpawnEnvBaseForTests, env-параметр spawnReplacementBot); cli.test.mjs разгружен (прямой импорт dist).

## Порядок действий
1. Шаг 1 (orchestrator.ts) → пnpm build.
2. Шаг 2 (orchestrator.test) → шаг 3 (restart) → pnpm test — зелёный прогон при fileParallelism: false.
3. Шаг 4 (cli.test) → pnpm test.
4. Шаг 5 (fileParallelism: true) → верификация (ниже).
5. Шаг 6 (CHANGELOG).

## Верификация
1. `pnpm build && pnpm test` до включения параллелизма — без падений.
2. `time pnpm test` ×3 подряд при fileParallelism: true — без падений/флаков; цель ≤80 с (базовый ориентир ~144 с, цель ~50-70 с). Зафиксировать все три времени в отчёте.
3. Регресс VL-125: `VIBELOG_PHASE_TASK_ID=VL-1 VIBELOG_PHASE_NAME=code VIBELOG_CWD=/tmp/vl125-check pnpm test` — без падений.
4. Контроль мутаций: `grep -rnE "process\.env\.[A-Z_0-9]+\s*=" src --include=*.test.mjs` — остатки только в in-process юнит-тестах без спавна (llm.test, env.test, settings.test): в форк-пуле Vitest они изолированы per-file и на спавны не влияют; при желании — vi.stubEnv отдельной задачей.

## Риски
- orchestrator.test.mjs — крупный механический рефакторинг (1222 строки): риск пропустить мутацию → контроль grep'ом (шаг 2).
- Тест «running===true» (стр. 168-172, VL28_STUB_SLEEP=1200) тайминг-чувствителен под параллельной нагрузкой — при флаке поднять паузу.
- Peak CPU/RAM растёт (~число файлов процессов node на 4 CPU); testTimeout 120s должен покрывать.
- Сигнатура spawnReplacementBot расширяется необязательным параметром — обратно совместима.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 13:31
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу — 7 файлов: orchestrator.ts (тестовый шов setSpawnEnvBaseForTests — spawn фаз всегда получает явный env-объект, прод-поведение при null не меняется), orchestrator.test.mjs (замена всех 202 упоминаний process.env-мутаций на setStubEnv, включая VL28_STUB_*/VIBELOG_QWEN_BIN; регрессия VL-125 закрыта сборкой явного env без VIBELOG_CWD/VIBELOG_PHASE_*), restart.ts + restart.test.mjs (необязательный env-параметр spawnReplacementBot вместо глобального delete TELEGRAM_BOT_TOKEN), vitest.config.mts (fileParallelism: true + новый doc-комментарий), cli.test.mjs (разгрузка: ~12 из 14 spawnSync-проверок → прямой импорт dist-команд; остаётся spawn только для 2 контрактов самого процесса CLI), CHANGELOG.md. Верификация: 3 полных pnpm test подряд + прогон с VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME/VIBELOG_CWD в окружении (регрессия VL-125) + замер времени (цель ≤80 с против ~144 с). Риски: крупный механический рефакторинг orchestrator.test (контроль grep'ом), тайминг-чувствительный тест с VL28_STUB_SLEEP=1200 под параллельной нагрузкой, рост пиковой нагрузки CPU/RAM на 4 CPU.
---
author: @agent
created: 2026-10-13 15:41
---
Фаза 3 (Code) выполнена. Коммит `0927a5a` (ветка vb/vl-140).
## Изменено (6 файлов)
- `src/web/orchestrator.ts` — тестовый шов VL-140: `setSpawnEnvBaseForTests(env)` + `baseEnv()`; spawn фаз ВСЕГДА получает явный env-объект (`env: spawnEnv ?? baseEnv()`), резолв бинаря читает VIBELOG_AGENT_BIN/VIBELOG_QWEN_BIN из baseEnv(). Прод-поведение при null не меняется.
- `src/web/orchestrator.test.mjs` — 100% process.env-мутаций убраны (контроль grep'ом: 0 совпадений): хелперы `setStubEnv(patch)`/`stubEnvGet`/`resetStubEnv` собирают явный env (process.env MINUS VL-125-ключи VIBELOG_CWD/VIBELOG_PHASE_* MINUS VL28_STUB_*/VIBELOG_AGENT_BIN, плюс патчи тестов) и передают в шов; savedEnv-цикла beforeAll/afterAll больше нет; E2E-тесты VL-85/VL-114 используют resetStubEnv().
- `src/bot/restart.ts` — 4-й необязательный параметр `env?` у spawnReplacementBot (обратно совместим; прод-вызов handlers.ts не тронут).
- `src/bot/restart.test.mjs` — глобальные beforeAll/afterAll delete TELEGRAM_BOT_TOKEN убраны; оба теста передают явный env без токена.
- `src/cli/cli.test.mjs` — разгрузка: 12 из 14 spawnSync-проверок переведены на прямой импорт dist (route/runInit/runTask/runBoard/runSearch/runInstructions + перехват console.log через vi.spyOn, флаги через parseArgs); spawnSync оставлен только для 2 контрактов процесса (не-TTY exit 0, повторный init → exit 1). Доля spawn'ов в файле: 14 → 2. Файл: 153 → 158 строк, время: ~10-12s → 1.8s.
- `vitest.config.mts` — fileParallelism: true + новый doc-комментарий (причина VL-133 устранена).
## Верификация (все зелёные)
- `pnpm build` — чистый (tsc strict).
- 3 полных прогона `pnpm test` подряд при fileParallelism: true: **57.2s / 57.6s / 61.3s** (863 теста, 52 файла, 0 флаков) — цель ≤80s перевыполнена (базовый ориентир ~144s → −60%).
- Регресс VL-125: `VIBELOG_PHASE_TASK_ID=VL-1 VIBELOG_PHASE_NAME=code VIBELOG_CWD=/tmp/vl125-check pnpm test` — 863 passed, 57.7s.
- Контроль мутаций: grep `process.env.X = ...` по *.test.mjs — остатки только в in-process юнит-тестах без спавна (llm.test, env.test, settings.test); в форк-пуле Vitest они изолированы per-file и на спавны не влияют.
## Что осталось
- **CHANGELOG.md не обновлялся** — по регламенту Фазы 3 CHANGELOG пишет Фаза Close после слияния (VL-126). AC-4 («CHANGELOG: запись») и DoD «Документация обновлена» поэтому не отмечены — замер в AC-4 выполнен (57-61s ≤ 80s), запись в CHANGELOG за Фазой Close.
- Тайминг-чувствительный тест (VL28_STUB_SLEEP=1200) стабильно прошёл во всех 4 прогонах — паузу поднимать не потребовалось.
---
author: @agent
created: 2026-10-13 16:01
---
Фаза Close выполнена. Ветка vb/vl-140 слита в master (1 коммит: 0927a5a), worktree удалена, ветка удалена. После merge `pnpm build` + `pnpm test` в главном репо — зелёные (863 теста, 52 файла). DoD: 3/3 отмечены («Тесты проходят» и «Нет регрессий» — по отчёту Фазы 3 и пост-merge прогону; «Документация обновлена» — запись VL-140 в CHANGELOG.md Unreleased + уточнение про fileParallelism в AGENTS.md). AC: 4/4 — замер 57.2/57.6/61.3 с ≤ 80 с подтверждён Фазой 3, CHANGELOG-запись сделана docs-коммитом 1bcec54.
---
<!-- COMMENTS:END -->