---
id: VL-278
title: 'Создание задачи сразу в Planned через чат должно поднимать worktree, как запуск фазы plan'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 18:48'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - worktree
  - branch-mode
  - mcp
  - chat
  - workflow
dependencies: []
milestone: v1.11
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/worktree.ts
  - src/web/orchestrator.ts
  - src/mcp/tools.ts
  - src/core/worktree-trigger.test.mjs
lessons:
  - lesson-144
token_usage:
  input: 6688259
  output: 41840
  cache: 6537216
  total: 6730099
  requests: 88
  duration_ms: 692990
  reasoning: 22044
  by_phase:
    code:
      input: 5557493
      output: 33718
      cache: 5443584
      requests: 63
    close:
      input: 1130766
      output: 8122
      cache: 1093632
      requests: 25
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Worktree для задачи создаётся ТОЛЬКО оркестратором при запуске фазы (`src/web/orchestrator.ts:846-877`):

```ts
if (wtExists || ((phase === 'plan' || phase === 'do') && taskType !== 'epic')) {
  runDir = ensureTaskWorktree(cwd, branchTask);   // + linkWorktreeDeps: симлинки node_modules, backlog/references/data
  runCwd = runDir;
  spawnEnv = { ...spawnEnv, VIBELOG_CWD: cwd };
}
```

Плюс `src/agent/cli.ts:455-461` выбирает worktree-вариант шаблона close по `existsSync(taskWorktreeDir(...))`.

Путь создания задачи (`backlog_create_task` через чат → `src/core/store.ts` `createTask`/`addTask`) файл задачи пишет, но никаких git-действий не выполняет. Если задача создаётся сразу в статусе Planned (фаза spec выполнена «в чате» ролью Архитектор, план пишется в том же вызове), фаза plan никогда не запускается — а значит ветка `vb/<id>` и worktree не появляются.

## Последствие (наблюдено на VL-277)

Фаза code идёт в главном рабочем дереве без изоляции, close берёт обычный `phase-close.md` без merge-шага (`closeWorktree=false`), и весь design «одна задача = одна ветка = изолированный worktree» тихо отключается. Это не падение, а расхождение поведения: «одинаковый статус задачи, разные условия работы» — зависит от того, через какой путь пришли (фаза vs чат).

## Цель

Всё, что делает код при запуске фазы plan (создание worktree, симлинки dev-зависимостей, переключение последующих фаз в ветку), должно отрабатывать и при создании задачи сразу в статусе Planned через чат. Поведение должно определяться статусом/типом задачи и branch-mode, а не тем, каким путём задачу создали.

## Границы

- Условие создания worktree — ОДИН общий хелпер (напр. `shouldEnsureWorktree(cwd, taskId, trigger)`), использующий и оркестратор, и путь создания задачи; дублировать условие нельзя (иначе снова разъедется).
- Триггеры, при которых worktree нужен: запуск фазы plan/do (как сейчас) и создание задачи со статусом, эквивалентным «plan уже выполнен» (Planned/Plan), при включённом branch-mode; epic — исключение.
- Fail-open: ошибка git при создании worktree не отменяет создание задачи (задача создана, предупреждение в ответе и stderr) — паттерн ensure/build в боте.
- Сборка dist (buildTaskWorktree) при создании задачи НЕ выполняется — как и при штатном запуске plan: сборка происходит при перезапуске бота из ветки.

## Открытые вопросы

- Считать ли триггером только Planned или любое создание с непустым plan? (по умолчанию — только статус Planned + branch-mode)
- Нужно ли ретроспективно создавать worktree для уже существующих Planned-задач (например VL-277) — отдельное решение, не входит в эту задачу.
- Какие статусы считать эквивалентом «plan выполнен» в кастомных workflow из backlog/config.yml — брать `getStatusAfterPhase(task, 'plan')` вместо хардкода.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При включённом branch-mode создание задачи сразу в статусе Planned через чат (MCP backlog_create_task) создаёт ветку vb/<id> и worktree .vibelog/worktrees/<id>, если для данной задачи это первая «кодовая» фаза по workflow (в simple-workflow — Do) — то есть повторяет поведение запускаемой фазы plan
- [x] #2 Создание задачи в Planned при выключенном branch-mode не создаёт ни ветки, ни worktree (поведение не меняется)
- [x] #3 Эпик (type=epic) в Planned worktree НЕ создаёт — как и фаза plan для epic сегодня
- [x] #4 Логика «нужен ли worktree для (status, type, workflow)» вынесена в один общий хелпер в src/core/worktree.ts и используется и оркестратором фаз (src/web/orchestrator.ts:846-877), и путём создания задачи — две копии условия не появляются
- [x] #5 Остальные шаги кода запуска фазы plan, нужные для работы в ветке, тоже отработаны: симлинки node_modules и backlog/references/data из главного репо (linkWorktreeDeps) присутствуют в свежем worktree
- [x] #6 Ошибка git при создании worktree не роняет создание задачи: задача создаётся, в результат/ответ добавляется предупреждение, в stderr — диагностика (fail-open, паттерн ensure/build в боте)
- [x] #7 Поверхность создания задачи сообщает о созданном worktree: backlog_create_task возвращает путь worktree (или признак созданного worktree), чтобы вызывающая сторона знала, где работать
- [x] #8 Тесты: создание в Planned при branch-mode → worktree существует и на ветке vb/<id>; выключенный branch-mode → worktree нет; epic → worktree нет; ошибка git → задача создана, worktree нет, предупреждение есть
- [x] #9 Документация: CHANGELOG.md и README (раздел про параллельную разработку / branch-mode) — указано, что Planned-при-создании сразу поднимает ветку так же, как фаза plan
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 19:18
---
Фаза 3 (Code) выполнена. Изменено: src/core/worktree.ts (новые экспорты `WorktreeTrigger`, `WORKTREE_CREATING_PHASES`, `shouldEnsureWorktree(cwd, taskId, trigger)`, `ensureWorktreeOnCreate(cwd, taskId, status)` + приватный `isPlanDoneStatus`), src/web/orchestrator.ts (условие создания worktree заменено вызовом общего хелпера — собственная копия `wtExists || ((phase === 'plan' || phase === 'do') && taskType !== 'epic')` удалена), src/mcp/tools.ts (`toolCreateTask` после записи задачи вызывает `ensureWorktreeOnCreate`; путь worktree попадает в `applied.worktree`, предупреждение — в `message`), src/core/worktree-trigger.test.mjs (новый, 12 тестов). Коммит 2d9073e.
Механика: единое условие в одном месте (AC4) — порядок проверок: branch-mode выключен → false; type=epic → false; worktree уже есть → true (ensure идемпотентен, resume/comment остаются в ветке); триггер `{kind:'phase'}` → true для plan/do (plan — default-workflow, do — simple, VL-188); триггер `{kind:'create', status}` → true, если статус совпадает с `produces_status` перехода фазы plan в workflow ЭТОЙ задачи (`getWorkflowForTask` + transitions, без хардкода «Planned» — кастомные workflow из .vibelog/settings.json уважаются; в simple-workflow перехода plan нет, там worktree поднимет запуск do). AC5: `ensureWorktreeOnCreate` идёт через `ensureTaskWorktree`, то есть повторяет все шаги запуска plan, включая `linkWorktreeDeps` (симлинки node_modules и backlog/references/data из главного репо); `buildTaskWorktree` при создании НЕ вызывается — как и при штатном plan. AC6: fail-open — ошибка git ловится, задача остаётся созданной, предупреждение уходит в ответ и диагностика в stderr (`[vibelog-worktree] …`). AC7: ответ `backlog_create_task` содержит `applied.worktree` с абсолютным путём (или поле отсутствует, если worktree не требовался).
Проверки: `pnpm build` (tsc strict) — OK; целевые `npx vitest run src/core/worktree-trigger.test.mjs src/core/worktree.test.mjs` — 23/23; полный `pnpm test` — 122 файла, 2305 passed, 4 skipped (скипы — compat-тесты без клона references, как и раньше), без `--exclude`/`--skip`. Тесты покрывают: Planned+branch-mode → ветка vb/<id> и worktree на ней + симлинки; branch-mode off → ни ветки, ни worktree; epic → worktree нет (и на create, и на фазе plan); создание в Spec/To Do → worktree не поднимается; ошибка git → задача создана, worktree нет, warning в message; MCP-путь: `applied.worktree` в ответе.
Что осталось: AC9 (CHANGELOG.md + README, раздел branch-mode) и DoD «Документация обновлена» — по правилам фазы Code документация пишется в фазе Close после merge; поэтому эти пункты не отмечены. Пути создания через CLI `vibelog task create` и `POST /api/tasks` не подключались (в задаче и AC речь о MCP-поверхности `backlog_create_task`); при необходимости их можно подключить тем же одним вызовом `ensureWorktreeOnCreate` — условие для этого уже общее. Ретроспективное создание worktree для уже существующих Planned-задач (VL-277) в границы задачи не входит (см. «Открытые вопросы»).
---
author: @agent
created: 2026-11-01 19:25
---
Фаза Close выполнена. Статус: Done.
Коммиты:
- feat 2d9073e — общий хелпер shouldEnsureWorktree и подъём worktree при создании задачи в Planned (сделан в фазе Code, уже в истории).
- docs 535a8a0 — CHANGELOG.md (раздел Unreleased → Добавлено) и README (§«Супервизор: тик, лечение и планировщик» — новый абзац «Worktree задачи поднимается и при создании сразу в Planned»): AC9 и DoD «Документация обновлена» закрыты здесь, после merge.
- docs(task) c2badec — backlog/lessons/lesson-144 (refs у задачи нет, references/data не коммитился — он в .gitignore).
Проверки после merge в master: `pnpm build` (tsc strict) — OK; ранний точечный фильтр `npx vitest run src/core/worktree-trigger.test.mjs src/core/worktree.test.mjs` — 23/23; полный `pnpm test:fast` — 123 файла, 2313 passed, 4 skipped (скипы — compat-тесты без клона references, как и раньше), без --exclude/--skip, полный прогон один раз.
Не закоммичено: нет (файл задачи VL-278 коммитит framework после записи token_usage).
Lessons: lesson-144 «Если поведение зависит от статуса задачи, вынеси условие в один хелпер и зови его из всех путей создания — иначе „фаза vs чат“ даст разное окружение» — создан и связан с задачей.
---
<!-- COMMENTS:END -->