---
id: VL-107
title: Параллельная разработка в git-ветках vb/vl-N с перезапуском бота
status: Done
assignee: []
reporter: ''
created_date: '2026-10-06 19:29'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/worktree.ts
  - src/core/worktree.test.mjs
  - src/bot/settings.ts
  - src/bot/settings.test.mjs
  - src/bot/commands.ts
  - src/bot/commands.test.mjs
  - src/bot/restart.ts
  - src/bot/handlers.ts
  - src/bot/registry.ts
  - src/bot/registry.test.mjs
  - src/cli/commands/mcp.ts
  - src/web/orchestrator.ts
  - README.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#agent Сейчас многие задачи висят в статусе Review и тем самым затрудняют параллельную разработку, так как результат ещё не проверен и не закоммичен.
1. Предлагается рассмотреть параллельную разработку в разных git ветках именованых "vb/vl-N" под каждую задачу
2. В качестве референса можно использовать refs/vibe-kanban но не факт что там хорошее решение
3. Режим должен включаться/выключаться через настройки (команда бота set)
4. Так же должна быть возможность рестарта бота из этой ветки, для этого я так предполагаю нужно собирать проект из ветки в отдельную папку, например dist/VL-N (если это не ломает публикацию пакета, если ломает то выбрать/создать другую директорию для сборки из веток) и перезапускать бот командой с опциональным аргументом restart <VL-N> , без него перезапуск из корня dist
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Архитектурные решения

1. **Worktree, а не `dist/VL-N`**. Ветка собирается в git worktree `git worktree add -b vb/vl-107 .vibelog/worktrees/vl-107 HEAD`. Директория `.vibelog/worktrees/` выбрана вместо `dist/VL-N`, потому что:
   - `package.json.files` включает `dist` — сборки веток попали бы в npm-пакет;
   - `pnpm build` делает `rmSync('dist')` — каждая сборка стирала бы worktree-сборки;
   - `.vibelog/` уже в `.gitignore` — `git status` главного репо не засоряется.
   Побочный бонус: worktree лежит ВНУТРИ проекта, поэтому `node_modules` рантайм-зависимостей (grammy, ink, react, undici) резолвится walk-up в главный `node_modules` — перезапущенный бот из ветки работает без `pnpm install` в worktree.
2. **Backlog — только в главном репо**. Агент (qwen/vb) спавнится с `cwd` = worktree (код изолирован в ветке), но MCP-сервер получает `VIBELOG_CWD` = главный репозиторий: статусы/комментарии задач пишутся в единый `backlog/`, worktree-копия backlog остаётся нетронутой (merge ветки не конфликтует с задачами).
3. **Сборка ветки — главным `tsc`** (без сети): `node <main>/node_modules/typescript/lib/tsc.js -p <worktree>` после `rmSync(worktree/dist)`. Фолбэк при отсутствии typescript — понятная ошибка с подсказкой `pnpm install`.
4. **Режим включается настройкой** `branch_mode: true` в `.vibelog/bot.yml` через `/set branch-mode on|off`; читается перед каждым запуском фазы (как `default_agent`, VL-94).

## Файлы для изменения

| Файл | Что меняем |
|---|---|
| `src/core/worktree.ts` | **Новый модуль**: имена, ensure, сборка |
| `src/bot/settings.ts` | поле `branch_mode` |
| `src/bot/commands.ts` | `/set branch-mode`, `/restart [VL-N]` |
| `src/bot/handlers.ts` | handler'ы `/set` и `/restart` |
| `src/bot/restart.ts` | параметр `cliPath` в `spawnReplacementBot` |
| `src/bot/registry.ts` | usage-строки |
| `src/web/orchestrator.ts` | выбор рабочей директории фазы |
| `src/cli/commands/mcp.ts` | override корня через `VIBELOG_CWD` |
| `src/bot/commands.test.mjs`, `src/core/worktree.test.mjs` (новый), `README.md` | тесты и документация |

## Порядок действий

### 1. `src/core/worktree.ts` (новый)

- `taskBranchName(taskId): string` → `'vb/' + taskId.toLowerCase()` (VL-107 → `vb/vl-107`).
- `taskWorktreeDir(cwd, taskId): string` → `join(cwd, '.vibelog', 'worktrees', taskId.toLowerCase())`.
- `ensureTaskWorktree(cwd, taskId): string`:
  - директория уже worktree на нужной ветке → вернуть путь (идемпотентность);
  - ветка существует, worktree нет → `git worktree add <dir> <branch>`;
  - нет ни того, ни другого → `git worktree add -b <branch> <dir> HEAD` (база — текущий HEAD главного репо; грязные изменения главного дерева в ветку НЕ попадают — задокументировать);
  - все git-вызовы — `spawnSync('git', …, { cwd })` по образцу `src/core/git.ts` (L216-237);
  - in-process кэш `Map<taskId, Promise<string>>` — защита от параллельного ensure двух фаз (паттерн-референс: глобальная синхронизация worktree в `refs/vibe-kanban/crates/worktree-manager/src/worktree_manager.rs`);
  - ошибки git → `throw new Error('Не удалось создать worktree для <taskId>: <stderr>')` на русском.
- `buildTaskWorktree(cwd, taskId): void`:
  - `rmSync(join(dir, 'dist'), { recursive: true, force: true })`;
  - `spawnSync(process.execPath, [join(cwd, 'node_modules', 'typescript', 'lib', 'tsc.js'), '-p', dir], { cwd })`;
  - status≠0 или нет tsc → throw с хвостом stderr и подсказкой;
  - проверка результата: `existsSync(join(dir, 'dist', 'cli', 'router.js'))`.
- `worktreeCliPath(cwd, taskId)` → `join(dir, 'bin', 'vibelog.mjs')`.

### 2. `src/bot/settings.ts`

- `BotSettings` (L17-28): + `branch_mode?: boolean`.
- `loadBotSettings` (L82-107): `raw.branch_mode === true` (битое значение → undefined, по образцу `default_agent`).
- `saveBotSettings` payload (L131-143): `...(settings.branch_mode !== undefined ? { branch_mode: settings.branch_mode } : {})`.
- Экспорт `resolveBranchMode(cwd): boolean` (дефолт `false`) — по образцу `resolveDefaultAgent` (L160-163).

### 3. `src/bot/commands.ts`

- `SetCommand` (L70-76): + вариант `| { key: 'branch-mode'; value: boolean }`.
- `parseSetCommand` (L293-320): принять ключ `branch-mode`, значения `on|off|true|false` → boolean; обновить `hint` (L294): `Синтаксис: /set agent <qwen|vb> | max-wall-time <сек> | max-requests <N> | branch-mode <on|off> (0/пусто — сброс у числовых)`.
- Новый `parseRestartCommand(text): { taskId?: string } | { error }` (рядом с `CloseCommand`, L60-64): пусто → `{}`; `VL-\d+` (без учёта регистра) → `{ taskId: 'VL-107' }` (нормализация к верхнему регистру); мусор → `{ error: 'Синтаксис: /restart [VL-N]' }`.

### 4. `src/bot/restart.ts`

- `spawnReplacementBot(cwd, stdio, cliPath = vibelogCliPath())` — третий параметр (L36-43): спавн `[cliPath, 'bot']` вместо жёсткого `vibelogCliPath()`. `cwd` остаётся главным — новый бот читает токен/backlog из главного репо, но исполняет `dist` ветки.

### 5. `src/cli/commands/mcp.ts`

- `runMcp` (L33): `startMcpServer(process.env.VIBELOG_CWD ? resolve(process.env.VIBELOG_CWD) : cwd)` + JSDoc: env задаёт оркестратор при запуске фазы в worktree, чтобы MCP писал в основной `backlog/`.

### 6. `src/web/orchestrator.ts`

- В `startPhase` (L73-104) / `spawnQwenRun` (L192+):
  - если `resolveBranchMode(cwd)` и `runKey` под `^VL-\d+$i`:
    - `runDir = ensureTaskWorktree(cwd, taskId)`; ошибка ensure → `{ error }` (фаза не стартует, сообщение в чат);
    - спавн с `cwd: runDir` и `env: { ...process.env, VIBELOG_CWD: cwd }`;
    - к промпту дописывается примечание: «Режим параллельной разработки: работаешь в git worktree ветки vb/vl-N (директория …). Backlog живёт в основном репозитории — MCP уже настроен на него. Код коммить в текущую ветку; файлы backlog/ не коммить» (через `prompt += …` перед spawn, шаблоны не трогаем — аналог `extraVars`);
  - `startPrompt`/`startResume` (не привязаны к задаче) всегда в главном `cwd` — без изменений.
- `spawnLimitFlags` (L169+) не меняется — читает bot.yml по главному `cwd`.

### 7. `src/bot/handlers.ts`

- `/set` (L553-587): перевести ветку `if (parsed.key === 'agent')` на `switch`; case `'branch-mode'` → `settings.branch_mode = parsed.value; saveBotSettings(...)`; ответ: `⚙️ Режим параллельной разработки (ветки vb/vl-N): вкл/выкл`.
- `/restart` (L860-890):
  - `const parsed = parseRestartCommand((ctx.match ?? '').toString())`; ошибка → `sendMd(ctx, parsed.error)`;
  - если `parsed.taskId`: сообщение «🔧 Сборка ветки vb/vl-N…»; `dir = ensureTaskWorktree(deps.cwd, taskId)` в try/catch → ошибка в чат, процесс не трогаем; `buildTaskWorktree(...)` в try/catch → ошибка в чат; затем `spawnReplacementBot(deps.cwd, 'inherit', worktreeCliPath(deps.cwd, taskId))`;
  - без аргумента — прежнее поведение (`vibelogCliPath()`).

### 8. `src/bot/registry.ts`

- L37 (`set`): usage `… | branch-mode <on|off>`.
- L44 (`restart`): description `Перезапустить бота: /restart [VL-N] — из ветки vb/vl-N, без аргумента — из корневого dist/`.

### 9. Тесты

- `src/core/worktree.test.mjs` (новый, по образцу `src/core/git.test.mjs`): temp-директория `git init` + commit; `taskBranchName`/`taskWorktreeDir`; `ensureTaskWorktree` — создание ветки+worktree, идемпотентность второго вызова, reuse существующей ветки; `buildTaskWorktree` — пропускать, если `node_modules/typescript` нет (guard в тесте).
- `src/bot/commands.test.mjs`: `parseSetCommand` — `branch-mode on|off|true|false`, мусор, неизвестный ключ с обновлённым hint; `parseRestartCommand` — пусто, `VL-107`, `vl-7`, мусор.
- `src/bot/settings` roundtrip `branch_mode` — в существующий тест настроек или в `worktree.test.mjs`.

### 10. Документация

- `README.md`: раздел про бота — `/set branch-mode`, `/restart [VL-N]`, схема «worktree для кода + общий backlog», ответ на вопрос публикации (`.vibelog/worktrees` не попадает в npm: не в `files`, в `.gitignore`).

## Как проверить

```bash
pnpm build          # tsc, strict
pnpm test           # build + node --test src
pnpm lint           # node --check bin/*.mjs
```

Ручной смоук (в тестовом git-репо):
1. `git init tmp && cd tmp && git commit --allow-empty -m init` + `node <repo>/bin/vibelog.mjs init`;
2. `/set branch-mode on` → в `.vibelog/bot.yml` появилось `branch_mode: true`;
3. запуск фазы для VL-1 → появился `.vibelog/worktrees/vl-1` на ветке `vb/vl-1`, `git status` главного репо чист;
4. `/restart VL-1` → worktree собран (`dist/cli/router.js` существует), бот перезапущен из `…/vl-1/bin/vibelog.mjs` с `cwd` главного репо (токен найден);
5. `/restart` → прежнее поведение (корневой dist).

## Риски

- **Грязный главный репо**: worktree создаётся от HEAD — незакоммиченные изменения не переносятся. Сообщать пользователю в ответе `/restart` и при ensure (комментарий в коде).
- **Ветка меняет зависимости**: build главным `tsc` не увидит новые пакеты, рантайм упадёт на импорте. Фолбэк — `pnpm install` в worktree вручную (задокументировать в README).
- **MCP в worktree**: qwen поднимает `vibelog mcp start` из PATH (`.qwen/settings.json` в worktree — трекаемая копия); backlog резолвится верно через `VIBELOG_CWD`, но сам бинарь MCP может быть глобальной (старой) установкой — для проверки MCP-изменений ветки потребуется PATH на сборку ветки. Не блокер; зафиксировано.
- **Фаза Close в worktree**: шаблон закоммичивает файл задачи — в worktree backlog не менялся, `git commit` вернёт «nothing to commit». Решено: примечание к промпту (п. 6) запрещает коммитить backlog-файлы в режиме веток; feat-коммит кода уходит в ветку vb/vl-N — это и есть цель.
- **Параллельные фазы одной задачи**: guard `activeRuns` по runKey уже есть (orchestrator L200) — regressий нет.
- **`vibelog browser`/web-API**: `api.ts` вызывает тот же `startPhase` — режим веток включится и там автоматически; задокументировать как ожидаемое поведение.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 19:30
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Параллельная разработка в git-ветках vb/vl-N с перезапуском бота». Масштаб: task. Уточнено: критерии приёмки (команда set для режима, ветки vb/vl-N, restart с опциональным аргументом без ущерба публикации npm). Вопросов нет.
---
author: @agent
created: 2026-10-06 23:48
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу (10 файлов: 1 новый модуль `src/core/worktree.ts` + 8 правок + тесты/документация). Ключевые решения: worktree в `.vibelog/worktrees/vl-N` на ветке `vb/vl-N` вместо `dist/VL-N` (не ломает npm-публикацию: не входит в `files`, лежит в `.gitignore`; `pnpm build` не смывает); backlog остаётся общим в главном репо (MCP получает `VIBELOG_CWD`); сборка ветки — главным `tsc` без сети; режим включается `/set branch-mode on|off` (bot.yml `branch_mode`); `/restart [VL-N]` собирает ветку и спавнит бота из `…/vl-N/bin/vibelog.mjs` с cwd главного репо. Риски: грязный HEAD не переносится в ветку, смена зависимостей веткой требует ручного `pnpm install` в worktree, MCP-бинарь в worktree берётся из PATH.
---
author: @agent
created: 2026-10-07 00:24
---
Фаза 3 (Code) выполнена.
## Изменено (13 файлов вне backlog/)
| Файл | Что сделано |
|---|---|
| `src/core/worktree.ts` | **Новый модуль**: `taskBranchName` (VL-107 → vb/vl-107), `taskWorktreeDir` (.vibelog/worktrees/vl-N), `ensureTaskWorktree` (идемпотентный ensure с in-process кэшем по `cwd\0taskId`; 3 исхода: worktree на ветке / ветка есть / создание `-b … HEAD`), `buildTaskWorktree` (rmSync dist + главный `node_modules/typescript/lib/tsc.js -p <worktree>`, проверка `dist/cli/router.js`), `worktreeCliPath` |
| `src/bot/settings.ts` | поле `branch_mode?: boolean` в BotSettings, валидация при чтении (только строгое `true`), запись в save, экспорт `resolveBranchMode(cwd)` (дефолт false) |
| `src/bot/commands.ts` | `SetCommand` + вариант `{ key: 'branch-mode'; value: boolean }`; `parseSetCommand` принимает `on\|off\|true\|false` (обновлён hint); новый `parseRestartCommand` (пусто → `{}`, `VL-\d+` без учёта регистра → нормализация к верхнему, мусор → error) |
| `src/bot/restart.ts` | `spawnReplacementBot(cwd, stdio, cliPath = vibelogCliPath())` — третий параметр; cwd остаётся главным |
| `src/cli/commands/mcp.ts` | `VIBELOG_CWD` override корня для MCP (backlog живёт в главном репо при работе агента в worktree) |
| `src/web/orchestrator.ts` | `spawnQwenRun`: при `resolveBranchMode(cwd)` и runKey `^VL-\d+$` — `ensureTaskWorktree` до спавна (ошибка → `{ error }`, фаза не стартует), спавн с `cwd: runDir` и `env.VIBELOG_CWD`, примечание о режиме дописывается к промпту. `startPrompt`/`startResume` — всегда в главном cwd |
| `src/bot/handlers.ts` | `/set` переведён на switch + case `'branch-mode'` (ответ «⚙️ Режим параллельной разработки (ветки vb/vl-N): вкл/выкл»); `/restart` парсит аргумент, при VL-N — ensure + build в try/catch (ошибка в чат, процесс не трогается), затем `spawnReplacementBot` с CLI worktree |
| `src/bot/registry.ts` | usage `/set … \| branch-mode <on|off>`; описание `/restart [VL-N]` |
| `README.md` | раздел «Telegram-бот»: `/set branch-mode`, `/restart [VL-N]`, схема «worktree для кода + общий backlog», ответ на вопрос публикации (.vibelog/worktrees не в files, в .gitignore, pnpm build не стирает) |
| тесты | новый `src/core/worktree.test.mjs` (9 тестов: имена/пути, создание ветки+worktree от HEAD, идемпотентность, reuse ветки, не-git → throw, чужая ветка → throw, нет typescript → подсказка, полная сборка через симлинк node_modules: dist/cli/router.js + удаление stale-dist); `commands.test.mjs` (+branch-mode парсер, +parseRestartCommand); `settings.test.mjs` (+roundtrip/resolve/невалидное branch_mode); `registry.test.mjs` (обновлены ожидания usage + тест restart) |
## Проверки
- `tsc` (strict) — сборка без ошибок
- `node --test "src/**/*.test.mjs"` — **781/781 pass, 0 fail** (включая 9 новых worktree-тестов с реальным git)
- `node --check bin/vibelog.mjs && node --check bin/vibelog-agent.mjs` — lint OK
- DoD: все 3 пункта отмечены (тесты / документация / нет регрессий — полный прогон зелёный)
Примечание: `pnpm build`/`pnpm test` в этой среде падают из-за окружения (dyld `_pwritev` в /usr/local/bin/node на старом macOS — не связано с кодом); проверки выполнены эквивалентными прямыми вызовами `node node_modules/typescript/lib/tsc.js` и `node --test`.
## Отклонения от плана (мелкие)
- Кэш ensure — `Map<string, string>` по ключу `cwd\0taskId`, а не `Map<taskId, Promise<string>>`: ensure синхронный (spawnSync), Promise-кэш бессмыслен; включение cwd в ключ обязательно (иначе тесты/несколько проектов получили бы чужой путь).
- Перед `git worktree add` создаётся родительская директория `.vibelog/worktrees` (git создаёт только последний сегмент пути).
- Документация обновлена не только в README, но и в `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` (таблица /set, разделы /restart и «Параллельная разработка в ветках») — там были действующие описания этих команд.
## Что осталось (вне рамок Фазы 3)
- Ручной смоук в реальном Telegram: `/set branch-mode on` → запуск фазы → проверить worktree и общий backlog; `/restart VL-N` → проверить пин и dist ветки (п.4 плана «Как проверить»).
- Если ветка изменит зависимости — ручной `pnpm install` в worktree (задокументировано).
---
<!-- COMMENTS:END -->