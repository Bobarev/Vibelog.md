---
id: VL-134
title: Перенести создание worktree на фазу Plan
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 00:55'
updated_date: '2026-10-13 09:49'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - README.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Worktree сейчас создаётся при создании задачи, а нужно впервые его создавать только на фазе Plan — к моменту Plan ветка ещё актуальна, а на более ранних фазах создание ветки преждевременно.

Уточнено:
- Worktree создаётся впервые при переводе задачи в Plan (ранее — никогда).
- Для задач типа epic worktree не создаётся вовсе.
- Уже созданные worktree-каталоги у задач, не дошедших до Plan, не удаляются и не пересоздаются — меняется только поведение для новых созданий.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Git worktree не создаётся при создании задачи и на фазах Spec; он создаётся впервые только при переводе задачи в Plan
- [x] #2 Для задач типа epic worktree не создаётся ни на одной из фаз воркфлоу
- [x] #3 Существующие worktree-каталоги у задач, не дошедших до Plan, не удаляются и не пересоздаются автоматически
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Суть

Сейчас worktree создаётся при спавне ЛЮБОЙ фазы задачи: `spawnQwenRun` (src/web/orchestrator.ts:282-299) при branch_mode вызывает `ensureTaskWorktree` для всех фаз кроме close — т.е. фактически при первой фазе (spec, запускаемой сразу после создания задачи). Нужно: создание впервые — только на фазе `plan`; для epic — никогда; фазы до Plan и без worktree работают в главном cwd.

## Изменяемые файлы

### 1. src/web/orchestrator.ts (блок строк ~282-299)

В `spawnQwenRun`, внутри `if (resolveBranchMode(cwd) && branchTask !== '')`, перед `ensureTaskWorktree` вычислить:

```ts
// VL-134: worktree создаётся впервые только на фазе plan; для epic — никогда.
// Остальные фазы (spec/code/comment/resume) используют worktree ТОЛЬКО если
// он уже существует (ensure идемпотентен); иначе — главный cwd.
const wtDir = taskWorktreeDir(cwd, branchTask);
const wtExists = existsSync(wtDir);
const taskType = (getTask(cwd, branchTask)?.type ?? '').toLowerCase();
```

Условие входа в блок (заменяет прямой вызов ensure): `wtExists || (phase === 'plan' && taskType !== 'epic')`.
- `phase === 'plan'` && !epic → `ensureTaskWorktree` (создаёт);
- иначе если `wtExists` → `ensureTaskWorktree` (идемпотентно возвращает путь);
- иначе блок пропускается целиком: runCwd = главный cwd, VIBELOG_CWD не задаётся, «Режим параллельной разработки» не добавляется в промпт.

`getTask` уже импортирован (строка 21); `taskWorktreeDir`, `existsSync` — тоже. Close-исключение (VL-112) и env VIBELOG_PHASE_TASK_ID (VL-114) не меняются.

### 2. src/web/orchestrator.test.mjs

Адаптация существующих тестов (они завязаны на «создаётся на любой фазе»):
- Стр. 693, `startResume: сессия возобновляется в worktree (VL-110)`: предсоздать worktree vl-77 перед startResume — `ensureTaskWorktree(wtRoot, 'VL-77')` (добавить импорт из `../../dist/core/worktree.js`). Assert'ы без изменений.
- Стр. 853, `startPhase: code с branch_mode — спавн в worktree`: сменить фазу `code` → `plan` (创建工作tree теперь plan-ом), поправить имя теста; assert'ы (cwd в worktree, примечание веток) остаются.
- Стр. ~988, `startResume с worktreeTaskId: env несёт taskId (VL-114)`: предсоздать worktree vl-77 — иначе resume пойдёт в главный cwd и `envCwd` станет null.
- Стр. ~1072, `branch-mode с task_prefix ot (VL-118)`: сменить фазу `code` → `plan`.

Новые тесты (блок VL-134):
- spec + branch_mode, worktree нет → worktree НЕ создаётся, cwd агента — главный, в промпте нет «Режим параллельной разработки».
- plan для задачи `type: 'epic'` (создать через `createTaskFile(..., { type: 'epic' })`) → worktree не создаётся, cwd главный.
- code без существующего worktree → не создаётся, cwd главный.
- существующий worktree + фаза comment → идёт в worktree (регресс «уже созданные не пересоздаются/используются»).

### 3. README.md (раздел branch-mode, ~строка 239)

Формулировка: worktree создаётся впервые при запуске Фазы Plan (до этого, включая Spec, фазы работают в главном репозитории); для задач типа epic worktree не создаётся. Коммит README — Фазой Close (docs-коммит VL-126).

## Порядок действий

1. Правка `src/web/orchestrator.ts` (условие выше) + комментарий VL-134.
2. Адаптация 4 существующих тестов + добавление 4 новых в `orchestrator.test.mjs`.
3. `pnpm build && pnpm test` (собирает dist и гоняет все тесты, включая worktree.test.mjs и orchestrator.test.mjs).
4. Обновить README (без коммита — Фаза 3 коммитит только код, docs-коммит делает Фаза Close).

## Как проверить

- `pnpm build` — сборка без ошибок (strict TS).
- `pnpm test` — все тесты проходят (сейчас 841; станет ~845).
- Ручная проверка в тестовом репо: branch_mode on → создать задачу → запустить spec → `.vibelog/worktrees/` пуст; запустить plan → каталог `vl-N` создан; повторный comment → идёт в тот же worktree.

## Риски

- Тесты VL-110/112/114/118 проверяли старую семантику «создаётся на любой фазе» — адаптировать предсозданием worktree/сменой фазы; поведение resume и существующих задач при этом не меняется (ensure идемпотентен).
- Задачи, переведённые в In Progress мимо Plan (ручной статус) — фаза code без worktree пойдёт в главный cwd: это новая семантика, соответствует AC, но отличается от старого поведения.
- `getTask` вернёт null, если файла задачи нет (экзотика) — трактуется как не-epic, worktree plan-ом создаётся.
- Фаза comment для задачи Spec теперь идёт в главном cwd (раньше создавала worktree) — ожидаемое изменение, покрыто новым тестом.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 00:56
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Перенести создание worktree на фазу Plan/Code». Масштаб: не определён (описание неполное). Жду ответов на вопросы:
### 1. В какой момент фазы воркфлоу впервые создавать git worktree?
- [ ] На фазе Plan (при переходе задачи в Plan — чтобы ветка готова к работе плана)
- [ ] На фазе Code (при переходе в Code — ветка создаётся только когда есть код)
- [ ] При первом реальном изменении файлов в рамках задачи (лениво)
- [ ] Другое → 
### 2. Создавать ли worktree для эпиков?
- [ ] Нет, для эпиков worktree никогда не создаётся
- [ ] Да, но с задержкой — до начала работы с подзадачами
- [ ] Другое → 
### 3. Что делать с уже созданными worktree-каталогами у задач, которые ещё не дошли до Plan/Code?
- [ ] Ничего — оставить как есть, только изменить поведение для новых задач
- [ ] Удалять/пересоздавать при переходе по фазам
- [ ] Другое → 
### Дополнительные комментарии
→ 
---
author: @agent
created: 2026-10-13 01:00
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Перенести создание worktree на фазу Plan». Масштаб: task. Уточнено (по ответам пользователя): worktree создаётся впервые только при переводе задачи в Plan; для эпиков worktree не создаётся вовсе; уже созданные каталоги существующих задач не удаляются и не пересоздаются — меняется только поведение для новых созданий. Добавлены критерии приёмки. Вопросов нет.
---
author: @agent
created: 2026-10-13 09:09
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 3 файла (src/web/orchestrator.ts — условие создания worktree в spawnQwenRun только на фазе plan и не для epic, строки ~282-299; src/web/orchestrator.test.mjs — адаптация 4 существующих тестов VL-110/112/114/118 + 4 новых теста VL-134; README.md — уточнение семантики branch-mode, коммитит Фаза Close). Риски: тесты завязаны на старую семантику «создаётся на любой фазе» (нужна адаптация предсозданием worktree); фазы code/comment без worktree идут в главный cwd (новая ожидаемая семантика); getTask=null трактуется как не-epic.
---
author: @agent
created: 2026-10-13 09:37
---
Фаза 3 (Code) выполнена.
**Изменено:**
- `src/web/orchestrator.ts` — в `spawnQwenRun` (branch_mode-блок) worktree создаётся впервые только на фазе `plan` и не для `epic` (`wtExists || (phase === 'plan' && taskType !== 'epic')`); остальные фазы используют worktree только если она уже есть, иначе идут в главный cwd без `VIBELOG_CWD` и примечания веток.
- `src/web/orchestrator.test.mjs` — адаптированы 4 существующих теста (VL-110 resume, VL-112 «спавн в worktree» — фаза code→plan, VL-114 resume с worktreeTaskId — предсоздание worktree, VL-118 task_prefix — code→plan) + добавлены 4 новых теста VL-134: spec без worktree, plan для epic, code без worktree, comment с существующей worktree.
- `README.md` — раздел branch-mode уточнён (worktree впервые на Фазе Plan, для epic не создаётся). **Не закоммичен** — по плану docs-коммит делает Фаза Close (VL-126).
**Коммит:** `26cb766` (`feat: VL-134 — worktree создаётся впервые только на фазе Plan, для epic не создаётся`) — только код и тесты.
**Проверки:** `pnpm build` (strict TS) — OK; `pnpm test` — все тесты проходят (orchestrator.test.mjs: 42/42, включая 4 новых).
**Отмечено:** AC #1–#3; DoD #1 (тесты), #3 (нет регрессий). DoD #2 «Документация обновлена» оставлен незакрытым: README отредактирован, но его коммит — зона Фазы Close.
**Осталось:** docs-коммит README при закрытии задачи; ручная проверка в боевом репо (spec → worktree не создаётся, plan → создаётся) — по желанию владельца.
---
author: @agent
created: 2026-10-13 09:49
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 26cb766 (код и тесты — Фаза 3), docs 7744de3 (CHANGELOG.md + README.md + backlog/docs/doc-6: семантика worktree — впервые на Фазе Plan, для epic не создаётся). Не закоммичено: нет.
---
<!-- COMMENTS:END -->