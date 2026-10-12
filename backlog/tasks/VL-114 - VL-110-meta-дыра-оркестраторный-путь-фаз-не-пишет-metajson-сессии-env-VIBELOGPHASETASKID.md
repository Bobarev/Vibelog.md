---
id: VL-114
title: 'VL-110 meta-дыра: оркестраторный путь фаз не пишет meta.json сессии (env VIBELOG_PHASE_TASK_ID)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 14:46'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
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
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/agent/session.ts
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Дыра фикса VL-110 (C3): оркестратор спавнит vb с готовым отрендеренным промптом (один позиционный аргумент), CLI идёт в режиме «готовый промпт», isPhaseMode=false → saveSessionMeta НЕ вызывается. Доказательство — инцидент VL-113 2026-10-12: у реальной фазовой сессии agent-1791802592105 meta.json отсутствует, поэтому startResume не найдёт taskId и reply «Продолжи» снова уйдёт в главный cwd — инцидент VL-98 (патчи не в ту копию) повторится.

Решение: env-путь. Оркестратор в spawnEnv задачных фаз кладёт VIBELOG_PHASE_TASK_ID (runKey) и VIBELOG_PHASE_NAME (phase); cli.ts при создании сессии читает env и пишет meta.json (taskId/phase/cwd) независимо от того, как пришёл промпт — позиционный фазовый или отрендеренный. Это закрывает боевой путь оркестратора; прямые CLI-запуски фаз работают как раньше.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 spawnQwenRun для задачных фаз (runKey VL-N, включая worktree-вариант и resume с worktreeTaskId; КРОМЕ close — по VL-112) кладёт VIBELOG_PHASE_TASK_ID и VIBELOG_PHASE_NAME в spawnEnv
- [x] #2 cli.ts: при создании новой сессии в фазовом режиме или при наличии VIBELOG_PHASE_TASK_ID пишется <id>.meta.json (taskId/phase/cwd); resume/--continue мету не перезаписывают
- [x] #3 orchestrator.test: оркестраторный спавн задачной фазы через заглушку создаёт meta.json в .vibelog/agent-sessions; cli.test: env-путь пишет мету
- [x] #4 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-114: env-путь меты сессии (VIBELOG_PHASE_TASK_ID)

## Диагноз (подтверждён кодом)

- `src/web/orchestrator.ts:236-320` (`spawnQwenRun`): промпт фазы спавнится как один позиционный аргумент. `spawnEnv` задаётся ТОЛЬКО в branch-mode (строка 272), в нём только `VIBELOG_CWD`.
- `src/agent/cli.ts:203-204`: `isPhaseMode = positionals.length === 2` → у оркестраторного спавна false.
- `src/agent/cli.ts:296-302`: `saveSessionMeta` вызывается только `if (isPhaseMode)` → мета не пишется → `startResume` (`orchestrator.ts:163-201`) не находит `worktreeTaskId` → инцидент VL-98 (патчи не в ту копию).

## Файлы для изменения

1. `src/web/orchestrator.ts`
2. `src/agent/cli.ts`
3. `src/agent/session.ts` (только JSDoc)
4. `src/web/orchestrator.test.mjs`
5. `src/agent/cli.test.mjs`

## Шаг 1 — orchestrator.ts: env задачной фазы в spawnEnv

В `spawnQwenRun` (строки 255-272):

- После вычисления `branchTask` (после строки ~265) добавить вычисление taskId для env:
  ```ts
  // VL-114: задачный env нужен фазам задач (worktree-спавн не обязателен):
  // CLI пишет по нему мету сессии даже когда промпт пришёл готовым
  // (isPhaseMode=false). runKey 'prompt'/'resume' сюда не попадают; у resume
  // taskId берётся из worktreeTaskId (мета VL-110). Close исключён по
  // VL-112: фаза закрытия работает в главном репо — её resume не должен
  // уходить в worktree (без меты close-сессии продолжаются прежним путём).
  const phaseTaskId =
    /^VL-\d+$/i.test(runKey) && phase !== 'close' ? runKey.toUpperCase() : (worktreeTaskId ?? '');
  ```
- Перед branch-блоком (строка ~266) инициализировать spawnEnv, если phaseTaskId не пуст:
  ```ts
  let spawnEnv: NodeJS.ProcessEnv | undefined;
  if (phaseTaskId !== '') {
    spawnEnv = { ...process.env, VIBELOG_PHASE_TASK_ID: phaseTaskId, VIBELOG_PHASE_NAME: phase };
  }
  ```
- Строка 272 (branch-блок) заменить на:
  ```ts
  spawnEnv = { ...(spawnEnv ?? process.env), VIBELOG_CWD: cwd };
  ```
  (branch-блок остаётся единственным источником `VIBELOG_CWD`; task-env и branch-env не мешают друг другу).
- Строки 315-319 (spawn с `...(spawnEnv ? { env: spawnEnv } : {})`) — без изменений: когда env пуст (prompt/resume без worktree), spawn наследует process.env как раньше.
- Обновить JSDoc `spawnQwenRun` (@param worktreeTaskId, ~строки 224-235): упомянуть VL-114 — VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME для задачных фаз.

Замечание: guard `/^VL-\d+$/i` уже существует в этом коде (branchTask, startResume) — единообразие; префикс task_prefix из конфига не нужен (реальные задачи — VL-N).

## Шаг 2 — cli.ts: запись меты по env для новых сессий

Блок меты, строки 285-302:

- Строка 285-293 (if/else resume vs новая сессия): не переносить, но завести флаг `const isNewSession = opts.resume === undefined && !opts.continue;` (для ясности; структурно это else-ветка `sessionId = createSessionId()`).
- Заменить блок 296-302 на:
  ```ts
  // Метаданные сессии (VL-110/114): два источника taskId/phase —
  // позиционные <фаза> <taskId> (прямой CLI-запуск, работает как раньше)
  // и env оркестратора VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME (боевой
  // путь: спавн готовым промптом, isPhaseMode=false). Resume/--continue
  // мету не перезаписывают (сессия продолжается, мета уже записана).
  if (isNewSession) {
    try {
      if (isPhaseMode) {
        // Фазовый режим (прямой CLI): без фильтров — как в VL-110. taskId
        // может не совпадать с VL-N: task_prefix конфигурируем
        // (backlog/config.yml; сервер-тесты используют 'ot-…')
        await saveSessionMeta(sessionsDir, sessionId, { taskId: positionals[1], phase, cwd });
      } else {
        // Env-путь (боевой спавн оркестратора): фильтруем мусор — только VL-N
        const envTaskId = process.env.VIBELOG_PHASE_TASK_ID;
        if (envTaskId && /^VL-\d+$/i.test(envTaskId)) {
          await saveSessionMeta(sessionsDir, sessionId, {
            taskId: envTaskId.toUpperCase(),
            phase: process.env.VIBELOG_PHASE_NAME,
            cwd,
          });
        }
      }
    } catch (err) {
      console.error(`Предупреждение: метаданные сессии не записаны — ${(err as Error).message}`);
    }
  }
  ```
- В фазовом режиме taskId сохраняется как есть (positionals[1], прежнее поведение без регрессий); в env-пути нормализуется в верхний регистр (orchestrator кладёт уже верхний).
- Обновить комментарий-заголовок блока (VL-110, строки 288-295): добавить «VL-114: env-путь для оркестраторного спавна готовым промптом».
- `sessionsDir` (строка 282) уже учитывает `VIBELOG_CWD` (главный репо) — мета ляжет туда же, `startResume` её найдёт. Без изменений.

## Шаг 3 — session.ts: JSDoc

`SessionMeta` (~строки 117-125): в комментарии добавить, что мету пишет CLI и в env-пути VL-114 (VIBELOG_PHASE_TASK_ID от оркестратора), не только в режиме `<фаза> <taskId>`.

## Шаг 4 — orchestrator.test.mjs: тесты (секция VL-110, после строки ~780)

ВАЖНО: тесты передают taskId явно вида `VL-88` (паттерн VL-112-тестов, задача не обязана существовать в backlog) — task1.id префикса 'ot' не подходит под guard.

1. **«startPhase: env задачной фазы — VIBELOG_PHASE_TASK_ID/NAME в spawnEnv (VL-114)»** — по образцу stubWt (строки 708-721): заглушка пишет в маркер `{argv, cwd, envPhaseTaskId: process.env.VIBELOG_PHASE_TASK_ID || null, envPhaseName, envCwd}`. `startPhase(testRoot, 'VL-88', 'code')` (branch_mode выключен) → маркер: `envPhaseTaskId === 'VL-88'`, `envPhaseName === 'code'`, `envCwd === null`. Убедиться, что LL28_STUB_* окружения чистится в finally.
2. **«startPrompt: задачный env не передаётся (VL-114)»** — та же заглушка, `startPrompt(testRoot, 'привет')` → `envPhaseTaskId === null`.
2а. **«startPhase: close не получает задачный env (VL-112-гард, VL-114)»** — та же заглушка, `startPhase(testRoot, 'VL-88', 'close')` → `envPhaseTaskId === null`: close всегда работает в главном репо, его resume не должен уходить в worktree.
3. **«startResume с worktreeTaskId: VIBELOG_PHASE_TASK_ID = taskId задачи (VL-114)»** — по образцу VL-110-теста (строки 692-750): git-корень wtRoot, branch_mode, мета agent-999 `{taskId:'VL-77', phase:'code', cwd: wtPath}` → `startResume(wtRoot, 'agent-999', ...)` → маркер: `envPhaseTaskId === 'VL-77'`.
4. **E2E по AC: «оркестраторный спавн задачной фазы создаёт meta.json в .vibelog/agent-sessions»** — паттерн VL-85-теста (строки 637-692): `VIBELOG_QWEN_BIN = bin/vibelog-agent.mjs` (настоящий агент) + мок-LM (node:http, SSE), `VIBELOG_BIN=no-such` (MCP деградирует), `startPhase(testRoot, 'VL-88', 'comment')` → `run.result.session_id` → файл `testRoot/.vibelog/agent-sessions/<sid>.meta.json` существует: `taskId==='VL-88'`, `phase==='comment'`, `cwd===realpathSync(testRoot)`. Таймаут waitDone 8000.

## Шаг 5 — cli.test.mjs: тесты env-пути (секция VL-110, после строки ~497)

1. **«env-путь: готовый промпт + VIBELOG_PHASE_TASK_ID → мета пишется (VL-114)»** — `runCli(['Просто запрос', '--no-mcp'], {...llmEnv(), VIBELOG_PHASE_TASK_ID: 'vl-88', VIBELOG_PHASE_NAME: 'code'}, projDir)` → `<sid>.meta.json`: `taskId==='VL-88'` (верхний регистр), `phase==='code'`, `cwd===realpathSync(projDir)`.
2. **«env-путь: resume не перезаписывает мету (VL-114)»** — сначала запуск с env (как п.1) → session_id; вручную перезаписать meta полем-маркером `{taskId:'VL-OLD', phase:'x', cwd:'old'}`; `runCli(['Продолжи', '--resume', sid, '--no-mcp'], env с VIBELOG_PHASE_*)` → код 0, meta осталась с маркером (не перезаписана).
3. Существующие тесты VL-110 («фаза пишет метаданные», «готовый промпт мету не создаёт») остаются зелёными: llmEnv() не содержит VIBELOG_PHASE_*; фазовый режим хранит positionals как есть.

## Порядок действий

1. Шаг 1 (orchestrator.ts) → Шаг 2 (cli.ts) → Шаг 3 (JSDoc).
2. Шаг 4 (orchestrator.test.mjs), Шаг 5 (cli.test.mjs).
3. Проверки.

## Как проверить

```bash
pnpm build
node --test src/web/orchestrator.test.mjs src/agent/cli.test.mjs   # целевые файлы
pnpm test   # полный прогон = build + node --test src, AC «pnpm test зелёный»
```

## Риски

- **close-фаза исключена из env** (guard `phase !== 'close'` в Шаге 1, по VL-112): close работает в главном репо, его resume не должен уходить в worktree — иначе reply «Продолжи» на close-сообщении в branch-mode продолжил бы закрытие в worktree с примечанием «Режим параллельной разработки», противоречащим шаблону phase-close-worktree.md. Close-сессии остаются без меты — прежний путь resume.
- **Не-VL префиксы задач**: regex-guard применяется ТОЛЬКО к env-пути; фазовый режим пишет мету без фильтра (регрессия VL-110 недопустима: task_prefix конфигурируем — backlog/config.yml; сервер-тесты создают задачи 'ot-…').
- **Resume-спавн с worktreeTaskId**: env несёт VIBELOG_PHASE_TASK_ID задачи и VIBELOG_PHASE_NAME='prompt' — безвредно: resume не создаёт новую сессию (нет сессии → exit 1 до записи меты) и существующую мету не перезаписывает.
- **Внешний env**: ручной запуск CLI при случайно заданном VIBELOG_PHASE_TASK_ID — отфильтрован regex `/^VL-\d+$/i`; в фазовом режиме позиционалы приоритетнее env.
- **E2E-тест (п.4 Шага 4)** зависит от dist/ через bin/vibelog-agent.mjs и мок-LM; `pnpm test` делает build первым — паттерн уже работает в VL-85/VL-94-тестах.
- **Сохранение positionals как есть** в фазовом режиме (без toUpperCase) — исключает регрессию VL-110-теста `VL-77` и любых не-upper ID.
- Старые сессии без меты — поведение прежнее (fallback startResume без worktree).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 15:08
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 5 файлов (src/web/orchestrator.ts — spawnEnv с VIBELOG_PHASE_TASK_ID/NAME для задачных фаз; src/agent/cli.ts — запись меты новых сессий по env, resume/--continue не перезаписывают; src/agent/session.ts — JSDoc; src/web/orchestrator.test.mjs — 4 теста incl. E2E через настоящий bin/vibelog-agent.mjs + мок-LM; src/agent/cli.test.mjs — 2 теста env-пути). Риски: close-фаза получит env (безвредно, fallback при необходимости — guard как в VL-112); внешний env фильтруется regex /^VL-\d+$/i; все пути файлов проверены ls.
---
author: @agent
created: 2026-10-12 15:49
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code; feat 0161bfd). Реализовано по исправленному плану (docs(plan) bd78980): Шаг 1 — spawnQwenRun: phaseTaskId (VL-N; кроме close по VL-112; у resume — из worktreeTaskId) → VIBELOG_PHASE_TASK_ID/NAME в spawnEnv, merge с VIBELOG_CWD в branch-блоке; Шаг 2 — cli.ts: мета новой сессии по двум источникам (позиционные <фаза> <taskId> без фильтров — task_prefix конфигурируем; env с regex VL-N), resume/--continue не перезаписывают; Шаг 3 — JSDoc SessionMeta. Тесты: orchestrator +5 (env задачной фазы, /prompt без env, close без env — VL-112-гард, resume с worktreeTaskId несёт taskId, E2E «настоящий агент + мок-LM → meta.json с taskId/phase/cwd» — строже AC, заглушка мету не пишет писал бы CLI); cli +2 (env-путь: верхний регистр, cwd через realpathSync; resume не перезаписывает мету-маркер). Проверки: pnpm build (tsc strict) OK; pnpm test — 834/834, fail 0. Что осталось: live-проверка — reply «Продолжи» на реальной фазовой сессии (например, VL-113 после её resume) должен уходить в worktree задачи; DoD закрывается Фазой Close.
---
author: @agent
created: 2026-10-12 18:38
---
Фаза Close выполнена вручную (исполнитель — Qwen Code). Код: feat 0161bfd (env VIBELOG_PHASE_TASK_ID/NAME в spawnQwenRun кроме close; мета в cli.ts по двум источникам; resume не перезаписывает). Доказательство боевого пути — E2E-тест «настоящий агент + мок-LM → meta.json»; дополнительная live-проверка: resume «Продолжи» на сессии VL-113 выполнил ровно один оставшийся шаг (status → Review) и «Готово». Проверки: pnpm test 834/834. DoD 3/3. Статус Done.
---
<!-- COMMENTS:END -->