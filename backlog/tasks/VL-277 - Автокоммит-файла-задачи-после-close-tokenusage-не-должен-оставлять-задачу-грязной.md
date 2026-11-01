---
id: VL-277
title: 'Автокоммит файла задачи после close: token_usage не должен оставлять задачу грязной'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 18:35'
updated_date: '2026-11-01 19:04'
due_date: ''
labels:
  - agent
  - billing
  - git
  - close
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/task-commit.ts
  - src/agent/task-commit.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/web/phase-prompt.test.mjs
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
lessons:
  - lesson-143
token_usage:
  input: 27890676
  output: 146632
  cache: 14535168
  total: 28037308
  requests: 326
  duration_ms: 169666
  reasoning: 18515
  by_phase:
    code:
      input: 13945338
      output: 73316
      cache: 13724160
      requests: 163
    close:
      input: 13945338
      output: 73316
      cache: 811008
      requests: 163
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст (проблема)

Фаза Close коммитит файл задачи изнутри агента (шаг 6 шаблона `templates/phases/phase-close.md`: `git add backlog/tasks/<ID>*.md && git commit -m "docs(task): <ID> — закрытие задачи (Done)"`). Учёт токенов пишется ПОЗЖЕ — пост-раном уже завершившегося процесса:

- `src/agent/cli.ts` (~843–900): блок «Post-run учёт токенов» → `addTaskTokenUsage` (`src/core/store.ts:186-208` → `updateTaskFile`) для vb-ранов;
- `src/web/orchestrator.ts` (~1140–1146, внутри `.then()` после записи меты): тот же `addTaskTokenUsage` для qwen-ранов (основной путь close, агент по умолчанию — qwen);
- `backlog_finish_phase` (`src/mcp/tools.ts:1775+`) пишет дельту в момент вызова из фазы.

В момент шага 6 агент физически не знает расход рана (usage приходит в конце рана), поэтому фронтмэттер `token_usage` дописывается после docs(task)-коммита → задача остаётся незакоммиченной ровно один раз, после каждого close.

## Цель

Файл задачи должен быть закоммичен после того, как `token_usage` рана записан в фронтмэттер. Выбран вариант 1: коммит файла задачи переносится из шаблона в пост-ран (детерминированный порядок: usage записан → коммит), с `--amend` вместо нового коммита, когда HEAD — уже docs(task)-коммит этой задачи и он не запушен.

## Границы

- Меняется поведение ТОЛЬКО для фаз, где шаблон сам коммитит файл задачи (сейчас это close / close-worktree). В spec/plan/code/comment автокоммита файла задачи нет — иначе framework начнёт коммитить backlog во всех фазах.
- Хелпер коммитит исключительно явный путь файла задачи в главном репозитории (`taskCwd = VIBELOG_CWD`); `backlog/references/data/` и любые иные файлы не трогаются, `git add -A` запрещён.
- Любая git-ошибка глушится в stderr и не меняет exit-код и статус уже завершившейся фазы (паттерн `commitProgressChanges`, VL-254, риск R4).

## Открытые вопросы (уточнить при реализации)

- branch-mode: файл задачи лежит в главном репо, close идёт в worktree задачи — нужно подтвердить, что коммит делается в главный репо и не конфликтует с merge-механизмом close-worktree (шаблон `phase-close-worktree.md`).
- Стоит ли расширить автокоммит на фазу comment (тот же класс расхождения) — решить по факту в реализации, по умолчанию нет.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После успешной фазы close файл задачи закоммичен: `git status --porcelain -- <путь файла задачи>` в главном репо пуст (и для vb-, и для qwen-ранов)
- [x] #2 token_usage рана и смена статуса/комментарий из finish_phase попадают в коммит: либо одним docs(task)-коммитом через --amend HEAD-коммита задачи, либо новым docs-коммитом — грязного остатка нет ни в одном из случаев
- [x] #3 Шаг 6 шаблона close больше не коммитит файл основной задачи (только файлы подзадач); шаблоны phase-close.md и phase-close-worktree.md согласованы и не порождают двойной коммит одного файла
- [x] #4 Хелпер коммитит только явный путь файла задачи в главном репо: git add -A не используется, файлы backlog/references/data/ и чужие пути не коммитятся
- [x] #5 Ошибка git (нечего коммитить, падение add/commit, отсутствие upstream) не меняет exit-код и статус фазы: предупреждение в stderr, фаза завершается как раньше
- [x] #6 Идемпотентность: при чистом файле коммит не создаётся (пустых коммитов нет); --amend применяется только если HEAD-сообщение — docs(task) этой задачи и коммит ещё не запушен (иначе новый коммит)
- [x] #7 Поведение вне close не изменилось: в spec/plan/code/comment пост-ран не коммитит файл задачи (тест на отсутствие коммита)
- [x] #8 Тесты: cli.test.mjs — пост-ран close коммитит файл задачи в тестовом репо; orchestrator.test.mjs — qwen-путь делает то же; инвариант по templates/ обновлён под новую формулировку шага 6
- [x] #9 Документация: запись в CHANGELOG.md и уточнение в README (раздел «Учёт токенов (billing)») о том, что файл задачи коммитится после записи usage
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Подход

Коммит файла задачи переносится из фазы (шаг 6 шаблона) в пост-ран, который уже пишет `token_usage`. Порядок становится детерминированным: usage записан → файл задачи закоммичен. Если HEAD уже `docs(task)`-коммит этой задачи и не запушен — `--amend`, иначе отдельный коммит.

## Изменения по шагам

### 1. Хелпер `commitTaskFile` (новый модуль `src/agent/task-commit.ts`)
- `commitTaskFile(cwd: string, taskId: string, phase: string): string | null`.
- Резолв пути: `findBacklogDir(cwd)` → `tasksDir()` → поиск файла по ID (логика `findTaskFilePath` в `src/core/store.ts:328` — вынести в экспортируемый хелпер или реэкспортировать; НЕ угадывать slug).
- Грязь: `git status --porcelain -- <path>` по явному пути (в главном репо). Пусто → `null`, без коммита.
- `git add -- <path>` (никогда `git add -A`), затем проверка HEAD:
  - `git log -1 --pretty=%s` — тема начинается с `docs(task): <ID>`?
  - запушенность: `git rev-parse HEAD` vs `git rev-parse @{u}` (нет upstream → считаем «не запушен»); равенство означает, что амендить нельзя.
  - условие выполнено → `git commit --amend --no-edit`, иначе → `git commit -m "docs(task): <ID> — token_usage (<phase>)"`.
- Всё в try/catch: ошибка → `console.error('[vibelog-agent] …')` в stderr, `null` (паттерн `commitProgressChanges`, VL-254; exit-код фазы не меняем).
- Гейт по фазе: список `TASK_COMMIT_PHASES = ['close']` (расширение на comment — отдельным решением, по умолчанию нет).

### 2. CLI пост-ран (`src/agent/cli.ts`, блок «Post-run учёт токенов», ~843–900)
- Сразу после успешного `addTaskTokenUsage` (и `updateSessionMeta`, если он был) вызвать `commitTaskFile(taskCwd, taskId, runPhase)` только если `TASK_COMMIT_PHASES` содержит `runPhase`; отдельный try/catch, чтобы git не влиял на уже вычисленный exit-код.

### 3. Qwen-путь оркестратора (`src/web/orchestrator.ts`, ~1105–1215)
- Внутри существующего `.then()` после меты, сразу после `addTaskTokenUsage(cwd, phaseTaskId, byPhaseKey, …)` — тот же вызов `commitTaskFile(cwd, phaseTaskId, byPhaseKey)` под тем же гейтом фазы (main-репо `cwd` = где живут файлы задач; в branch-mode это не worktree — проверить на тесте branch-mode, см. «Риски»).
- Размещать ПОСЛЕ `updateSessionMeta` с `billing_recorded` — чтобы падение коммита не отменяло запись учёта.

### 4. Шаблоны фаз (source of truth для промпта)
- `templates/phases/phase-close.md`, шаг 6: файл ОСНОВНОЙ задачи больше не коммитится агентом — добавить явную строку «файл {{taskId}} коммитит framework после записи token_usage; здесь только подзадачи», из шага 6 убрать `git add/commit` для {{taskId}}.
- `templates/phases/phase-close-worktree.md` — та же правка (проверить, что ветка worktree-close не коммитит файл задачи в главный репо дважды).
- Шаг 5 остаётся: `finish_phase` пишет комментарий/статус ДО коммита — так комментарий попадает в тот же коммит (в т.ч. через `--amend`).
- Согласовать отчёт шага 5: строка «Не закоммичено: …» — файл задачи исключить из перечня (его коммитит framework), оставить только подзадачи/refs.

### 5. Рефы/lessons (шаг 6.6) — без изменений
Отдельный `docs(task): … — refs и lessons` остаётся: он тоже может стать HEAD, но `--amend` применяется только к `docs(task): <ID> — закрытие задачи`, поэтому чужой коммит не переписывается (проверить предикатом темы).

### 6. Тесты
- `src/agent/task-commit.test.mjs` — новый: temp-репо + задача; (а) грязный файл → коммит создан; (б) HEAD=`docs(task): <ID> — закрытие задачи (Done)` и не запушен → один коммит, тема сохранена (`--amend --no-edit`), в нём есть и `token_usage`; (в) чистый файл → `null`, коммитов не добавилось; (г) ошибка git (нет репо) → `null`, исключения нет.
- `src/agent/cli.test.mjs` — пост-ран с `runPhase='close'` коммитит файл задачи; с `runPhase='code'` — не коммитит (AC «поведение вне close не изменилось»).
- `src/web/orchestrator.test.mjs` — qwen-путь close делает то же.
- `src/web/phase-prompt.test.mjs` — инвариант по `templates/`: шаг 6 без `git commit` файла {{taskId}}, упоминание framework-коммита присутствует.

### 7. Документация
- `CHANGELOG.md` (Unreleased) — «файл задачи после close коммитится автоматически после записи token_usage».
- `README.md`, раздел «Учёт токенов (billing)» — абзац о том, что грязного остатка после close нет.

## Проверка
- Сборка + полный прогон тестов (`src/**/*.test.mjs`, ~98 файлов).
- Ручной сценарий: close на тестовой задаче → `git status --porcelain -- backlog/tasks/<ID>*.md` пуст, `git log -1` содержит правку `token_usage`.

## Риски
- **R1 (branch-mode)** — файл задачи в главном репо, close идёт в worktree: коммит обязан идти в `taskCwd`/главный репо, иначе файл останется грязным в главном. Проверить тестом branch-mode; при конфликте с merge-механизмом `phase-close-worktree` — отложить автокоммит до после merge.
- **R2 (amend поверх чужого коммита)** — защита предикатом темы + проверкой «не запушен»; при сомнении выбирать новый коммит.
- **R3 (агент всё ещё коммитит шаг 6)** — если шаблон не обновить, будет amend того же файла (безвредно, но лишний шаг автора); закрывается шагом 4 + инвариантным тестом.
- **R4 (git ломает фазу)** — все вызовы глушатся в stderr, exit-код и статус фазы не меняются.

## Порядок
1 → 2 → 3 → 4 → 6 → 7 (тесты по каждому модулю сразу после его правки, полный прогон один раз в конце).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 19:00
---
Фаза 3 (Code) выполнена. Изменено: src/agent/task-commit.ts (новый хелпер commitTaskFile + гейт TASK_COMMIT_PHASES/isTaskCommitPhase; явный путь файла задачи, `git add -- <path>`, amend только для HEAD-коммита «закрытие задачи»/«token_usage» этой задачи и только если не запушен, все ошибки глушатся в stderr), src/agent/cli.ts (вызов commitTaskFile в пост-ране после addTaskTokenUsage под гейтом фазы, отдельный try/catch), src/web/orchestrator.ts (тот же вызов в qwen-пути после записи меты с billing_recorded), templates/phases/phase-close.md (шаг 6 — только подзадачи, файл {{taskId}} коммитит framework после token_usage; шаг 6.6 не добавляет файл задачи; шаг 5 — отчёт без файла задачи в «Не закоммичено»), templates/phases/phase-close-worktree.md (шаг 10 — только подзадачи, файл задачи коммитит framework). Тесты: src/agent/task-commit.test.mjs (новый, 7 кейсов: amend, чужой HEAD, чистый файл, нет репо, несуществующий ID, гейт фаз), src/agent/cli.test.mjs +2 (close коммитит, code — нет), src/web/orchestrator.test.mjs +1 (qwen-путь close), src/web/phase-prompt.test.mjs +3 (инвариант по templates/). Коммит 714d669 (fix: VL-277) в ветку master.
Проверки: `pnpm build` — ок; полный прогон `pnpm test` — 121 файл / 2290 тестов passed, 4 skipped (все штатные), падений нет; прогон полный, без --exclude/--skip отдельных файлов.
Открытые вопросы из плана: (1) branch-mode — close идёт без worktree (VL-112), поэтому файл задачи и коммит живут в главном репо (taskCwd/VIBELOG_CWD) — конфликта с merge-механизмом close-worktree нет; отдельного branch-mode теста не добавлял (close никогда не создаёт worktree, покрыто существующими VL-112-тестами). (2) Автокоммит на фазу comment НЕ расширял (по плану — по умолчанию нет).
Что осталось: AC9 (CHANGELOG + README, раздел «Учёт токенов (billing)») — по правилам фазы Code документацию пишет Фаза Close после слияния; DoD «Документация обновлена» по той же причине не отметил. Lesson: lesson-143 (amend только своего типа docs(task)-коммита).
---
author: @agent
created: 2026-11-01 19:00
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/agent/task-commit.ts
- src/agent/cli.ts
- src/web/orchestrator.ts
- templates/phases/phase-close.md
- templates/phases/phase-close-worktree.md
- src/agent/task-commit.test.mjs
- src/agent/cli.test.mjs
- src/web/orchestrator.test.mjs
- src/web/phase-prompt.test.mjs
- I'll start by orienting in the project and reading the key files mentioned in the plan.
Now let me read the CLI post-run section fully and the remaining part of CLI (need context after line 930 for structure).
Now I'll create the new helper module.
Now the orchestrator (qwen path).
Now the worktree …
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 638 с, payload 445773 байт_
---
author: @agent
created: 2026-11-01 19:01
---
Уточнение к блоку «Прогресс до обрыва» выше: он записан пост-раном уже после того, как фаза Code фактически завершилась — его пункты «отчёт не записан / AC-DoD не отмечены» устарели. Фактическое состояние: коммит 714d669 (`fix: VL-277`), статус Review, отмечены AC 1–8 и DoD 1, 3, полный `pnpm test` — 121 файл / 2290 tests passed / 4 skipped. Обрыв по лимиту LLM-запросов произошёл после отчёта; повторной работы не требуется. Открыто только AC9/DoD-2 (CHANGELOG и README, раздел «Учёт токенов») — их закрывает Фаза Close после слияния.
---
author: @agent
created: 2026-11-01 19:04
---
Фаза Close выполнена. Статус: Done. Документация закрыта: CHANGELOG.md (запись в Unreleased, раздел «Исправлено») и README.md (§«Учёт токенов (billing)» — абзац «Файл задачи коммитится после записи token_usage (VL-277)»).
Коммиты:
- fix: 714d669 — fix: VL-277 — файл задачи коммитится после записи token_usage (перенос из шаблона close) (фаза Code: хелпер src/agent/task-commit.ts, гейт TASK_COMMIT_PHASES=['close'], правки cli.ts/orchestrator.ts и шаблонов close/close-worktree);
- docs: 987b5ac — docs: VL-277 — документация и CHANGELOG;
- docs(task): 1bca133 — docs(task): VL-277 — refs и lessons (lesson-143).
Проверки после merge: `pnpm build` — успешно; полный `pnpm test` — 121 файл / 2290 passed / 4 skipped, повторов не потребовалось. AC 1–9 и DoD 1–3 отмечены.
Не закоммичено: нет (файл VL-277 коммитит framework после записи token_usage — как раз то поведение, которое вводит эта задача).
---
<!-- COMMENTS:END -->