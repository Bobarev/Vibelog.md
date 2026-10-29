---
id: VL-241
title: 'CLI-тесты: заменить фиксированные /tmp-пути на mkdtemp (плавающие падения при параллельных worktree)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:05'
updated_date: '2026-10-30 02:56'
due_date: ''
labels:
  - tests
  - vitest
  - flaky
  - worktree
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.test.mjs
  - src/cli/batch-checklist.test.mjs
  - src/cli/config-cli.test.mjs
  - src/cli/create-flags.test.mjs
  - src/cli/create-plan-notes.test.mjs
  - src/cli/decision-cli.test.mjs
  - src/cli/diagnostics.test.mjs
  - src/cli/draft-cli.test.mjs
  - src/cli/init-mcp.test.mjs
  - src/cli/model-cli.test.mjs
  - src/cli/search-cli.test.mjs
  - src/core/core.test.mjs
  - src/core/reject.test.mjs
  - src/core/store.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/milestones.test.mjs
  - src/mcp/parent.test.mjs
  - src/mcp/search-filters.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/types.test.mjs
  - src/mcp/v11.test.mjs
  - src/mcp/view-task-fields.test.mjs
  - AGENTS.md
  - vitest.config.mts
lessons:
  - lesson-89
  - lesson-90
token_usage:
  input: 4186206
  output: 114816
  cache: 3802112
  total: 4301022
  requests: 79
  duration_ms: 974480
  reasoning: 88169
  by_phase:
    plan:
      input: 4186206
      output: 114816
      cache: 3802112
      requests: 79
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В фазе Close VL-227 полный `pnpm test` давал **плавающие** падения: 29 → 7 → 33 → 12 тестов, каждый раз в разных файлах. Причина (диагностирована в сессии `agent-1793312743226` и зафиксирована в **lesson-89**): CLI-тесты используют **фиксированные** каталоги —

- `/tmp/vibelog-search-cli-test` (`src/cli/search-cli.test.mjs`);
- `/tmp/vibelog-config-cli-test` (`src/cli/config-cli.test.mjs`);
- `.test-create-flags`, `.test-batch` (`src/cli/create-flags.test.mjs` и др.);
- `/tmp/vibelog-agent-tools-test` (`src/agent/tools.test.mjs`).

Параллельный `vitest run` в worktree `vl-233` затирал эти каталоги, и собственный прогон VL-227 получал `AssertionError: 0 !== 1` в случайных файлах. Обход из lesson-89 — «дождись чужого прогона, потом гоняй свой» — это лечение симптома.

## Цель

Сделать тесты полностью параллельными и независимыми от числа запущенных прогонов: у каждой сессии тестов свой временный каталог.

## Что менять (проверить в Plan)

- Все найденные наборы: заменить константный путь на `mkdtempSync(join(tmpdir(), 'vibelog-<suite>-'))`, создаваемый в `beforeAll` (или на уровне модуля) и удаляемый в `afterAll` с `force: true`.
- Проверить `spawnSync`-вызовы: cwd дочернего процесса должен указывать на временный каталог, а не на фиксированный.
- Проверить, не сравниваются ли в ассертах абсолютные пути (`/tmp/vibelog-...`): если да — подставлять фактический путь из переменной.
- Комментарии-шапки файлов, где упоминается «фиксированный путь»/паттерн `init-mcp.test.mjs` — обновить (в шапке `search-cli.test.mjs` прямо описан паттерн с фиксированным testDir).
- Учесть исторический контекст: часть тестов специально держала путь фиксированным для проверки поведения CLI в «не-backlog» каталоге — инвариант сохранить (каталог всё равно вне проекта, просто уникальный).

## Почему приоритет High

Дефект делает результаты любых прогонов недетерминированными: агент в фазе не может отличить реальную регрессию от флака, и, как видно по VL-227, тратит на это полные прогоны и десятки минут. Также блокирует параллельную разработку в нескольких worktree (штатный режим проекта — VL-107).

## Связанное

- VL-240 (`llm.test.mjs` × settings.json) — вторая, независимая причина тех же плавающих падений; делать совместно, чтобы закрыть весь класс.
- lesson-89 — закрывается этой задачей.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В src/**/*.test.mjs нет ни одного фиксированного абсолютного пути для тестовых каталогов: `grep -rn "'/tmp/vibelog" src --include=*.test.mjs` → пусто
- [x] #2 Ни один тестовый файл не создаёт каталог с фиксированным именем в корне проекта: `grep -rn "join(__dirname, '..', '..', '\\.test-" src --include=*.test.mjs` → пусто; `git status --porcelain` после полного прогона не содержит `.test-*`
- [x] #3 Все тестовые каталоги создаются через mkdtempSync(join(tmpdir(), 'vibelog-<suite>-')) и удаляются в afterAll/cleanup с { recursive: true, force: true }
- [x] #4 Инвариант «каталог вне проекта» сохранён: поиск backlog вверх по дереву (findBacklogDir) не находит ни project backlog, ни backlog worktree
- [x] #5 Два одновременных прогона одного и того же набора (vitest run <file> в двух процессах) проходят — коллизий по каталогам нет
- [x] #6 Шапки файлов с упоминанием «testDir в /tmp / фиксированный путь» обновлены; правило про mkdtemp зафиксировано в AGENTS.md и vitest.config.mts
- [x] #7 Полный `pnpm test` проходит (без --exclude/--skip, кроме штатного разделения static.test.mjs из scripts.test)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Итог исследования

Причина плавающих падений (lesson-89) подтверждена: тестовые каталоги заданы **константами**, общими для всех процессов на машине:

- абсолютные `/tmp/vibelog-*` — 11 файлов (+ 4 фиктивных `CWD` в tools.test.mjs, они лексические и не создаются);
- относительные `.test-*` в **корне проекта** — 12 файлов. Они не пересекаются между worktree (у каждого свой корень), но: (а) два одновременных прогона в одном worktree затирают друг друга, (б) оставляют untracked-мусор в корне (`.test-*` нет в .gitignore).

Образец правильного паттерна уже есть в репозитории — `src/cli/cli.test.mjs:36` (`mkdtempSync(join(tmpdir(), 'vibelog-cli-test-'))` + `afterAll` с `rmSync(..., {force:true})`); на него же ссылается комментарий в `vitest.config.mts` («tmp-каталоги уникальны per-file (mkdtempSync)»). Правка приводит код в соответствие с этим комментарием.

Проверено (важно для правок): **ни один ассерт не сравнивает путь с testDir/cliDir/TMP** (`grep "assert.*\(testDir\|cliDir\|TMP\)"` — только вызовы store/MCP-API с testDir как аргументом; сравнений путей нет). Абсолютные `/tmp/x` в `session.test.mjs`, `formatting.test.mjs`, `rich.test.mjs`, `orchestrator.test.mjs`, `phase-prompt.test.mjs`, `tool-policy.test.mjs` — литеральные значения в фикстурах/метаданных, каталоги не создаются → **правки не требуются**. `agent/cli.test.mjs`, `agent/session.test.mjs`, `bot/*`, `cli/lesson-cli`, `cli/reference-cli`, `cli/update-check`, `core/add-comment` уже на mkdtemp → не трогаем.

Инвариант «каталог вне проекта» сохраняется: `tmpdir()` на Catalina = `/var/folders/...` — тоже вне репозитория, апстрим-поиск `findBacklogDir` (src/core/paths.ts:33-59) не найдёт ни project backlog, ни backlog worktree. Для `.test-*` файлов, которые передают `cwd: testDir` в spawn CLI (mcp/server, documents, milestones, types, v11), переезд наружу проекта даже строже текущего поведения.

## Порядок действий

### Этап 1 — абсолютные /tmp-константы (корневая причина меж-worktree коллизий), 11 файлов

Шаблон правки для файлов с `const testDir = '/tmp/...'`: в блок импортов добавить `mkdtempSync` в существующий импорт `node:fs` и `tmpdir` из `node:os`, константу заменить на модульный вызов:

```js
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-<suite>-'));
```

`fresh()`/`cleanup()` оставить как есть — они уже делают `rmSync(..., {force:true})` + `mkdirSync` внутри уникального каталога (это корректно и сохраняет изоляцию между `describe`-блоками). `spawnSync`/`execFileSync` с `cwd: testDir` менять не нужно — путь берётся из переменной.

1. `src/cli/search-cli.test.mjs` — стр. 25 (`/tmp/vibelog-search-cli-test` → `'vibelog-search-cli-'`); шапка стр. 12-14: переписать «testDir в /tmp (findBacklogDir не поднимается к backlog проекта)» → «testDir = mkdtemp вне проекта (инвариант: findBacklogDir не поднимается…)»; импорты стр. 19-22.
2. `src/cli/config-cli.test.mjs` — стр. 23 (`vibelog-config-cli-`), шапка стр. 11-12, импорты стр. 17-20.
3. `src/cli/create-flags.test.mjs` — стр. 28 `cliDir` (`vibelog-create-flags-cli-`) + стр. 101 `join(__dirname,'..','..','.test-create-flags')` → `mkdtempSync(join(tmpdir(), 'vibelog-create-flags-mcp-'))` (каталог уже удаляется в `finally`, стр. 120-122); шапка стр. 8 («CLI — /tmp + spawnSync; MCP — in-process (in-project .test-create-flags)») → «CLI/MCP — mkdtemp в tmpdir».
4. `src/cli/batch-checklist.test.mjs` — стр. 31 `cliDir` (`vibelog-batch-cli-`) + стр. 120-133 `testDir/.test-batch` → mkdtemp (setup/afterAll стр. 123-137 сохранить, setup уже создаёт подкаталоги с `recursive:true`); шапка стр. 4.
5. `src/cli/init-mcp.test.mjs` — стр. 23 (`vibelog-init-mcp-`); `settingsPath` (стр. 25) остаётся производным от testDir; `spawnSync('git', ['init'], {cwd: testDir})` (стр. 134, 144, 149) — без изменений.
6. `src/cli/model-cli.test.mjs` — стр. 21 (`vibelog-model-cli-`); шапка стр. 4-6 (оставить оговорку lesson-51 про spawnSync).
7. `src/cli/draft-cli.test.mjs` — стр. 22 (`vibelog-draft-cli-`); производные `draftsDirPath/tasksDirPath/completedDirPath` (24-26) — без изменений.
8. `src/cli/decision-cli.test.mjs` — стр. 22 (`vibelog-decision-cli-`); шапка стр. 10.
9. `src/cli/create-plan-notes.test.mjs` — стр. 22 (`vibelog-plan-notes-`); шапка стр. 10.
10. `src/cli/diagnostics.test.mjs` — стр. 23 `.test-diagnostics` → `mkdtempSync(join(tmpdir(), 'vibelog-diagnostics-'))`; стр. 155 `'/tmp/vibelog-doctor-empty'` → `mkdtempSync(join(tmpdir(), 'vibelog-doctor-empty-'))` (строку 156 `rmSync` убрать — каталог уже пустой; стр. 159 `rmSync` в `try/finally`); импорты стр. 16.
11. `src/agent/tools.test.mjs` — стр. 16 `TMP` → модульный mkdtemp (`vibelog-agent-tools-`), `beforeAll` (20-34) упростить: убрать `rmSync(TMP)` (стр. 21), оставить `mkdirSync(..., {recursive:true})`; **добавить `afterAll` с `rmSync(TMP, {force:true})`** (сейчас afterAll нет — файл импортирует только `beforeAll`, стр. 9); шапка стр. 4-6. Фиктивные `CWD` (стр. 233, 304, 343) **не менять** — они не создают файлов и проверяют лексические правила.

### Этап 2 — `.test-*` в корне проекта, 11 файлов

Тот же шаблон; убирать ставшие ненужными `fileURLToPath`/`dirname`/`const __dirname`, **кроме** файлов, где `__dirname` используется для `cliPath` (mcp/server:13, mcp/documents:26, mcp/milestones:29, mcp/types:30, mcp/v11:32, cli/diagnostics:22-26) — там `__dirname` сохраняется.

1. `src/core/core.test.mjs` — стр. 18 `.test-tmp` → `vibelog-core-`; `setupTestDir`/`cleanupTestDir` (23-41) без изменений (mkdir recursive создаёт сам testDir); `describe`-хуки 44-45, 201-202, 224-237, 274-286 не трогать.
2. `src/core/store.test.mjs` — стр. 15 `.test-store` → `vibelog-store-`.
3. `src/core/reject.test.mjs` — стр. 29 `.test-reject` → `vibelog-reject-`.
4. `src/mcp/server.test.mjs` — стр. 11 `.test-mcp` → `vibelog-mcp-server-`; `spawn('node', [...,'mcp','start'], {cwd: testDir})` (стр. 55, 586) — без изменений.
5. `src/mcp/documents.test.mjs` — стр. 23 `.test-documents` → `vibelog-mcp-documents-`.
6. `src/mcp/milestones.test.mjs` — стр. 25 `.test-milestones` → `vibelog-mcp-milestones-`.
7. `src/mcp/parent.test.mjs` — стр. 23 `.test-parent` → `vibelog-mcp-parent-`.
8. `src/mcp/search-filters.test.mjs` — стр. 23 `.test-search` → `vibelog-mcp-search-`.
9. `src/mcp/types.test.mjs` — стр. 27 `.test-types` → `vibelog-mcp-types-` (`setup(types)` на стр. 37 сохраняет `rmSync`+пересоздание внутри уникального каталога).
10. `src/mcp/view-task-fields.test.mjs` — стр. 22 `.test-view-fields` → `vibelog-mcp-view-fields-`.
11. `src/mcp/v11.test.mjs` — стр. 29 `.test-v11` → `vibelog-mcp-v11-`.

После Этапа 2 удалить оставшиеся артефакты прошлых прогонов: `rm -rf .test-tmp .test-store .test-reject .test-mcp .test-documents .test-milestones .test-parent .test-search .test-types .test-view-fields .test-v11 .test-create-flags .test-batch .test-diagnostics` (в текущем worktree их нет — проверено `ls -d .test-*`).

### Этап 3 — документация (DoD п.2)

1. `AGENTS.md`, раздел «Важные правила» — новый пункт: «Тестовые каталоги — только `mkdtempSync(join(tmpdir(), 'vibelog-<suite>-'))` + `rmSync(..., {force:true})` в `afterAll`; фиксированные `/tmp/...` и `.test-*` в корне проекта запрещены (VL-241, lesson-89: коллизии при параллельных прогонах в разных worktree)».
2. `vitest.config.mts` — комментарий (строки ~8-13) уже утверждает «tmp-каталоги уникальны per-file (mkdtempSync)»; дописать ссылку `(VL-241)`, чтобы утверждение не расходилось с кодом.
3. Шапки файлов из Этапа 1 (перечислены по строкам выше) — переписать формулировки «testDir в /tmp» / «фиксированный путь» на «mkdtemp вне проекта».

### Проверка (после каждого этапа — точечно, в конце — полный прогон)

```bash
pnpm build
# 1) не осталось фиксированных путей
grep -rn "'/tmp/vibelog" src --include=*.test.mjs            # пусто
grep -rn "join(__dirname, '..', '..', '\.test-" src --include=*.test.mjs   # пусто
# 2) затронутые файлы по отдельности (быстро, по одной группе)
env -u VIBELOG_CWD pnpm exec vitest run src/cli src/agent/tools.test.mjs
env -u VIBELOG_CWD pnpm exec vitest run src/core src/mcp
# 3) стресс-проверка цели бага: два одновременных прогона одного набора
( env -u VIBELOG_CWD pnpm exec vitest run src/cli/search-cli.test.mjs & \
  env -u VIBELOG_CWD pnpm exec vitest run src/cli/search-cli.test.mjs & wait )
# 4) отсутствие мусора в корне
git status --porcelain | grep -E '\.test-'                  # пусто
# 5) DoD: полный прогон (lesson-88: без VIBELOG_CWD; lesson-89 больше не требует «дождаться чужого прогона»)
env -u VIBELOG_CWD pnpm test
```

Если какой-то набор останется красным — повторить его отдельно (lesson-20/23) до вердикта «регрессия».

## Риски

1. **macOS `/var` → `/private/var` симлинк.** `tmpdir()` возвращает физический `/var/folders/...`, но `process.cwd()` дочернего процесса может быть `/private/var/...`. Сравнений `cwd === testDir` в затронутых файлах нет (проверено), но если при прогоне появится такое падение — использовать `realpathSync(...)` в ассерте (шаблон из `src/agent/cli.test.mjs:729-730`).
2. **Длина пути/лимит имени unix-сокета.** Каталоги mkdtemp глубже, чем `/tmp/vibelog-x`; в CLI/агенте есть unix-сокеты (`agent/cli.test.mjs:599`). Если тест сокета упадёт с `ENAMETOOLONG` — не путь теста, а лимит 104 байта; при появлении — применить короткий префикс (`vb-w-`).
3. **`isolate: false` + `fileParallelism: true`.** Модульные `mkdtempSync` вычисляются при импорте файла в worker; при переиспользовании воркера каталоги одного файла живут до его `afterAll` — конфликтов между файлами нет (у каждого свой префикс). Не полагаться на `process.env.TMPDIR` для уникальности.
4. **Потеря «in-project» семантики в mcp-тестах.** Часть сценариев (upward-поиск backlog) косвенно опиралась на то, что `.test-mcp` лежит внутри репозитория. Апстрим-поиск после переезда вернёт `null`, что для всех текущих ассертов ожидаемо (они всегда кладут `backlog/config.yml` внутрь testDir). Если после Этапа 2 какой-то тест позеленеет/покраснеет неожиданно — проверить наличие `backlog/` в testDir перед вызовом.
5. **VL-240 (`llm.test.mjs` × settings.json)** — независимая причина того же класса; файлы не пересекаются с нашими → merge-конфликтов быть не должно, но прогон после вливания VL-240 нужно повторить.
6. **Объём правок (23 файла).** Правки механические, но широкие: делать Этап 1 → прогон, Этап 2 → прогон, чтобы локализовать ошибку на группу; шапки/доки — отдельным коммитом (`test:` / `docs:`).

Кол-во файлов к изменению: 23 тест-файла + `AGENTS.md` + `vitest.config.mts`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 02:24
---
Фаза 2 (Plan) выполнена. Тип: bug.
**Что изучено:** целевые тест-файлы (grep по `'/tmp/vibelog`, `'\.test-`, `mkdtemp`) — найдено 23 файла: 11 с абсолютными `/tmp/vibelog-*` константами (search-cli, config-cli, create-flags, batch-checklist, init-mcp, model-cli, draft-cli, decision-cli, create-plan-notes, diagnostics, agent/tools) + 11 с `.test-*` в корне проекта (core×3, mcp×8), плюс `diagnostics.test.mjs:155` (`/tmp/vibelog-doctor-empty`). Образец верного паттерна уже есть: `src/cli/cli.test.mjs:36` — `mkdtempSync(join(tmpdir(), ...))`; на него же ссылается комментарий `vitest.config.mts`. Инвариант «каталог вне проекта» после переезда сохраняется (`tmpdir()` на Catalina = `/var/folders/...`, `findBacklogDir` из src/core/paths.ts:33-59 не найдёт project/worktree backlog).
**Проверено, чтобы не править лишнее:** ни один ассерт не сравнивает путь с testDir/cliDir/TMP (в сравнениях testDir только как аргумент store/MCP-API); абсолютные `/tmp/x` в session/formatting/rich/orchestrator/phase-prompt/tool-policy — литеральные фикстуры без создания каталогов; `agent/cli`, `agent/session`, `bot/*`, `lesson-cli`, `reference-cli`, `update-check`, `add-comment` уже на mkdtemp.
**План записан**, 3 этапа: (1) 11 файлов с `/tmp`-константами → модульный `mkdtempSync` + правка шапок; (2) 11 файлов `.test-*` → `mkdtempSync` (с сохранением `__dirname` там, где он нужен для `cliPath`), удаление легаси-каталогов; (3) документация — правило в AGENTS.md, ссылка VL-241 в vitest.config.mts, шапки файлов. Отдельно: `agent/tools.test.mjs` сейчас вообще без `afterAll` — добавить очистку; фиктивные `CWD` (VL-99/179/201) не трогать (лексические).
**Файлов к изменению:** 23 тест-файла + AGENTS.md + vitest.config.mts. **7 AC** добавлены (отсутствие фиксированных путей, отсутствие `.test-*` в `git status`, mkdtemp+force-очистка, сохранение инварианта «вне проекта», два параллельных прогона одного файла, обновление шапок/доков, полный `pnpm test`).
**Проверка в плане:** `pnpm build` → `vitest run src/cli src/agent/tools.test.mjs` и `vitest run src/core src/mcp` → стресс «два одновременных прогона search-cli» → `git status | grep .test-` → полный `env -u VIBELOG_CWD pnpm test` (lesson-88; обход из lesson-89 больше не нужен).
**Риски:** macOS `/var`→`/private/var` (при появлении — `realpathSync`, шаблон agent/cli.test.mjs:729-730); лимит длины unix-сокета при появлении ENAMETOOLONG; `isolate:false` с модульными mkdtemp (конфликтов нет, префиксы разные); потеря косвенной «in-project» семантики mcp-тестов (всегда кладут свой config.yml внутрь testDir); VL-240 — независимая причина того же класса, пересечения файлов нет, но прогон после вливания повторить; объём 23 файла — идти по этапам с прогонами.
---
author: @agent
created: 2026-10-30 02:25
---
Фаза code не удалась (код выхода 1):  рана — VL-221), payload последнего запроса=280844 байт (макс 280844), usage={"input_tokens":144407,"output_tokens":7683,"cache_read_input_tokens":135168,"total_tokens":152090,"reasoning_tokens":7270} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 02:53
---
Фаза 3 (Code) выполнена. Коммит **8f2aa50** (`fix: VL-241 — тестовые каталоги через mkdtemp вместо фиксированных /tmp и .test-*`), 24 файла, +89/−79.
**Изменено (22 тест-файла):**
- Этап 1 — `/tmp`-константы → `mkdtempSync(join(tmpdir(), 'vibelog-<suite>-'))`: `cli/search-cli`, `cli/config-cli`, `cli/init-mcp`, `cli/model-cli`, `cli/draft-cli`, `cli/decision-cli`, `cli/create-plan-notes`, `cli/create-flags` (плюс `.test-create-flags` → `vibelog-create-flags-mcp-`), `cli/batch-checklist` (плюс `.test-batch` → `vibelog-batch-mcp-`), `cli/diagnostics` (плюс `/tmp/vibelog-doctor-empty` → mkdtemp), `agent/tools.test.mjs` (TMP → mkdtemp, **добавлен отсутствовавший `afterAll`** с `rmSync(force)`).
- Этап 2 — `.test-*` в корне проекта → mkdtemp: `core/core`, `core/store`, `core/reject`, `mcp/server`, `mcp/documents`, `mcp/milestones`, `mcp/parent`, `mcp/search-filters`, `mcp/types`, `mcp/view-task-fields`, `mcp/v11`; неиспользуемые `fileURLToPath`/`dirname`/`__dirname` удалены там, где не нужны для `cliPath`.
- Этап 3 — `AGENTS.md`: новый пункт «Тестовые каталоги — только mkdtemp» (с отсылкой к lesson-89); `vitest.config.mts`: комментарий об инварианте дополнен отсылкой к VL-241; шапки файлов с «testDir в /tmp» переписаны на «mkdtemp вне проекта».
- Фиктивные `CWD` в `agent/tools.test.mjs` (VL-99/179/201) не менялись — они лексические, файлов не создают.
**Проверки (все выполнены в этом worktree):**
1. `grep -rn "'/tmp/vibelog" src --include=*.test.mjs` → остались только 3 фиктивных `CWD` (лексические, каталоги не создаются); `grep -rn "join(__dirname, '..', '..', '\.test-"` → пусто.
2. `pnpm build` — успешно (tsc без ошибок).
3. `env -u VIBELOG_CWD pnpm exec vitest run src/core src/mcp src/cli src/agent/tools.test.mjs` → 50 файлов, 746 passed / 4 skipped.
4. Стресс-проверка цели бага: два **одновременных** прогона `vitest run src/cli/search-cli.test.mjs src/cli/create-flags.test.mjs src/mcp/server.test.mjs` → оба 42/42 passed (до правки такие прогоны затирали друг друга).
5. `git status --porcelain | grep -E '\.test-'` → пусто (мусор в корне не появляется).
6. Полный `env -u VIBELOG_CWD pnpm test` (build + два прогона vitest по штатному scripts.test, **без --exclude/--skip**) → 1591 passed / 4 skipped, затем `src/web/static.test.mjs` 7/7 passed. Регрессий нет.
**Не закрыто / на заметку:** параллельно VL-240 (`llm.test.mjs` × settings.json) — вторая независимая причина того же класса; файлы не пересекаются, но после вливания VL-240 прогон стоит повторить. DoD 1–3 отмечены по полному прогону.
---
author: @agent
created: 2026-10-30 02:56
---
Фаза Close выполнена. Ветка `vb/vl-241` слита в master (`merge --no-ff`, 1 коммит 8f2aa50 → merge-коммит), worktree `.vibelog/worktrees/vl-241` удалена (`--force`: внутри были только untracked-симлинки `node_modules`/`backlog/references/data` от оркестратора), ветка удалена (`git branch -d`).

**Проверки в главном репо после merge:**
- `pnpm build` — tsc без ошибок;
- `env -u VIBELOG_CWD pnpm test` — 85 файлов, **1592 passed / 4 skipped**, затем `src/web/static.test.mjs` 7/7 passed. Без `--exclude`/`--skip`. Регрессий нет, конфликтов слияния не было (AGENTS.md auto-merging).

**DoD:** 1) Тесты проходят — по полному прогону выше; 2) Документация обновлена — AGENTS.md (пункт «Тестовые каталоги — только mkdtemp»), `vitest.config.mts`, шапки 11 файлов, запись в CHANGELOG (Unreleased → Исправлено), коммит `e9d406e`; 3) Нет регрессий — полный прогон зелёный, `git status --porcelain | grep '.test-'` пусто.

**Lessons:** lesson-89 (обход «дождись чужого прогона») помечен `superseded`, урок заменён на **lesson-90** («Задавай тестовые каталоги только через mkdtempSync(join(tmpdir(), 'vibelog-<suite>-')) и удаляй их в afterAll»); оба связаны с задачей (коммит `96c04e6`).

**На заметку:** VL-240 — вторая независимая причина того же класса; её CHANGELOG-запись уже в master, повторный прогон после вливания зелёный.
---
<!-- COMMENTS:END -->