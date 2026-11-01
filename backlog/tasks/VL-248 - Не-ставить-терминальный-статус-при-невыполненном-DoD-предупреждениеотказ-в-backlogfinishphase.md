---
id: VL-248
title: Не ставить Done при невыполненном DoD в backlog_finish_phase
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - mcp
  - core
dependencies: []
milestone: v1.11
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow.ts
  - src/mcp/tools.ts
  - src/core/workflow.test.mjs
  - src/mcp/server.test.mjs
  - README.md
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - templates/phases/phase-do.md
lessons:
  - lesson-140
token_usage:
  input: 9470642
  output: 201557
  cache: 8730624
  total: 9672199
  requests: 141
  duration_ms: 1246281
  reasoning: 168511
  by_phase:
    spec:
      input: 67055
      output: 1038
      cache: 56576
      requests: 3
    plan:
      input: 1906873
      output: 82837
      cache: 1763328
      requests: 32
    code:
      input: 5899376
      output: 107527
      cache: 5382912
      requests: 69
    close:
      input: 1597338
      output: 10155
      cache: 1527808
      requests: 37
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. VL-212 закрыта с отмеченным DoD «Тесты проходят» при красном полном прогоне (1539 passed / 24 failed в `src/agent/llm.test.mjs`), VL-219 — аналогично. `toolFinishPhase` принимает `dodChecks` без проверки, а `status: Done` без требования пройденных DoD. Добавить в сводку `backlog_finish_phase` явное предупреждение «терминальный статус при непройденных DoD: #…», а для перехода в Done — требование явного `dodOverride` с причиной, которая попадает в комментарий-отчёт.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `backlog_finish_phase {status: "Done"}` при непройденных DoD без `dodOverride` (с причиной) возвращает ошибку/предупреждение и НЕ меняет статус задачи
- [x] #2 При переданном `dodOverride` с непустой причиной статус Done ставится, а причина попадает в комментарий-отчёт фазы
- [x] #3 В сводке ответа `backlog_finish_phase` для любого терминального статуса при непройденных DoD выводится явное предупреждение с номерами невыполненных пунктов
- [x] #4 Тест в `src/mcp/server.test.mjs` покрывает оба исхода: отказ без override и успех с override + записанная причина
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации (VL-248)

### Решения
1. **Терминальность статуса — по workflow задачи, без хардкода имён** (lesson-32): новый экспорт `isTerminalStatus(workflow, status)` в `src/core/workflow.ts`. Статус терминальный, если у него нет исходящих фаз (`phase !== null`) и он либо объявлен финальным маркером (запись `phase: null`, как `Done`/`Rejected` в `DEFAULT_WORKFLOW`), либо достижим как `produces_status` / `initial_status`. Неизвестный статус (`Backlog`) — не терминальный.
2. **Отказ — жёсткая ошибка ДО любых записей** (MCP `isError: true`, тот же приём, что VL-251 для no-op статуса): файл задачи, комментарий и usage не трогаются, статус гарантированно не меняется (AC1). В тексте ошибки — номера невыполненных пунктов и точный следующий шаг: `dodOverride` с причиной, либо отметка пунктов, либо `aborted: true`, если фаза реально не выполнена.
3. **`dodOverride` НЕ в `required` схемы** — иначе сломается обычный close без замечаний; условная обязательность enforced явной ошибкой с именем поля (уточнение lesson-94 для условного требования). Формулировка «передай `dodOverride`» должна быть и в description схемы, и в тексте ошибки.
4. **Проверка учитывает `dodChecks` этого же вызова**: эффективный список DoD = `updates.definitionOfDone ?? task.definitionOfDone`, поэтому «`status: Done` + `dodChecks: [1]` при непройденном #2» отклоняется (иначе обход через «отмечу что есть»).
5. **Предупреждение в сводке (AC3)** — по итоговому статусу: валидный `args.status` либо, если `status` не передан, текущий статус задачи. Формат: `терминальный статус при непройденных DoD: #2, #3` (+ `(override: <причина>)`). Жёсткое требование override применяется только к явно запрошенному терминальному статусу — вызовы только с комментарием к закрытой задаче не блокируются.
6. **Причина override попадает в комментарий-отчёт** (AC2): после сборки `reportText` (и для явного `comment`, и для авто-отчёта) дописывается строка `DoD override: <причина>`.

### Файлы и места
1. `src/core/workflow.ts` — новый экспорт `isTerminalStatus(workflow: Workflow, status: string): boolean` рядом с `canMoveTo` (~236–256); новых зависимостей нет (модуль уже импортирует только `settings.js`/`task.js`).
2. `src/mcp/tools.ts`:
   - схема `backlog_finish_phase` (436–473): в `properties` добавить `dodOverride: { type: 'string', description: 'Причина закрытия задачи с невыполненными пунктами DoD (VL-248)…' }`; `required` оставить `['id','comment']`; в `description` инструмента — абзац про терминальный статус + `dodOverride`.
   - импорт `getWorkflowForTask, isTerminalStatus` из `../core/workflow.js` (~строка 48).
   - `toolFinishPhase` (1525–1795): после блока батч-отметки DoD (1621–1636) — вычисление `effectiveDod`, `uncheckedDod`, `targetTerminal`, `overrideReason`; при терминальном результате + непустых `uncheckedDod` без override — `throw` (до единственной записи в 1657–1660); при override — строка в `reportText` (после 1645–1652); в сборке `summary` (1791–1795) — `dodWarnPart`.
3. `src/mcp/server.test.mjs` — describe `tools/call — backlog_finish_phase (VL-138)`, после теста невалидного статуса (~486): два теста (AC4).
4. `src/core/workflow.test.mjs` — юнит-тесты `isTerminalStatus` в блоке около `canMoveTo` (~187–270): DEFAULT_WORKFLOW → `Done`/`Rejected` true, `To Do`/`Spec`/`Review`/`Backlog` false; кастомный workflow с другим финалом.
5. Документация: `README.md` (контракт `backlog_finish_phase`, ~677–700), `templates/phases/phase-close.md` (52–53), `templates/phases/phase-close-worktree.md` (84–88), `templates/phases/phase-do.md` (42–46) — правило «пункт DoD выполнить нельзя, а задача закрывается → `dodOverride` с причиной»; `backlog/docs/doc-8` (таблица: строка `dodOverride` + абзац) — правка через `document_update` в Фазе Close (lesson-63); запись в `CHANGELOG.md` — Close.

### Тесты (AC4)
- **Отказ:** фикстура `mcp-*` (статусы `To Do/In Progress/Done`, `definition_of_done: []`), `backlog_manage_dod add` ×2, затем `backlog_finish_phase { status: 'Done', dodChecks: [1], comment: … }` → `isError: true`, текст содержит номера невыполненных пунктов (`#2`) и упоминание `dodOverride`; `backlog_view_task` → статус остался `To Do`, `comments.length === 0` (записи не было); `backlog_manage_dod list` → пункт 1 не отмечен (жёсткая ошибка не персистит частичные отметки).
- **Успех:** те же два пункта, `backlog_finish_phase { status: 'Done', dodChecks: [1], dodOverride: 'пункт 2 перенесён в VL-XXX', comment: … }` → не `isError`; в сводке есть предупреждение с `#2` и текст override; `status === 'Done'`; текст записанного комментария содержит причину; DoD #1 отмечен.
- Дополнительно (AC3, дешёвый кейс): вызов без `status` к задаче в `Done` с непройденным DoD → предупреждение в сводке, статус не меняется (behavior-free фиксация формата предупреждения).

### Порядок действий
1. `isTerminalStatus` в `workflow.ts` + юнит-тесты.
2. Схема + проверка/предупреждение в `tools.ts`.
3. Тесты в `server.test.mjs`.
4. Прогон: `pnpm build && npx vitest run src/mcp/server.test.mjs src/core/workflow.test.mjs`, затем полный `pnpm test` (обязателен для DoD «Тесты проходят»; частичный прогон DoD не закрывает).
5. README + шаблоны в ветке; `doc-8` и `CHANGELOG.md` — Фаза Close.

### Риски
1. Жёсткая ошибка ломает легитимный close при честно невыполненном пункте DoD — снимается `dodOverride` и правкой шаблонов close/do (в том же diff).
2. Автоматический Done оркестратора (`finalizePhaseStatus` → `produces_status` Review→Done) вне зоны действия инструмента: если агент просто завершит ран без смены статуса, Done будет поставлен механикой. Скоуп VL-248 — только сводка/валидация `backlog_finish_phase`; это отдельный gap (кандидат в задачу-последователя по аналогии с `aborted` VL-244) — фиксирую как открытый риск.
3. Ложное предупреждение для комментария к уже закрытой задаче — безвредно (текст в сводке, поведение не меняется); при пустом DoD предупреждения нет.
4. Риск лупа модели на отказе — снят тем, что в ошибке назван конкретный следующий шаг (`dodOverride`/`aborted`), lesson-92.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 02:23
---
Фаза 1 (Spec) выполнена. Заголовок: изменён незначительно — «Не ставить Done при невыполненном DoD в backlog_finish_phase» (сокращён до предела 80 символов, суть сохранена). Тип: bug. Масштаб: task (одна задача, правка toolFinishPhase + тест). Приоритет: Medium. Уточнено: критерии приёмки расширены до 4 проверяемых пунктов — отказ при Отсутствии override, успех с записанной причиной override, явное предупреждение в сводке для любого терминального статуса при непройденных DoD, тест на оба исхода в src/mcp/server.test.mjs. Факт проблемы (VL-212 закрыта с отмеченным DoD «Тесты проходят» при красном прогоне 1539/24 failed в src/agent/llm.test.mjs; VL-219 аналогично) сохранён как контекст. Labels: mcp, core. References: нет (внешних источников не упомянуто). Вопросов нет.
---
author: @agent
created: 2026-11-01 17:00
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic). План записан в Implementation Plan.
Решения: (1) терминальность статуса — новый экспорт `isTerminalStatus(workflow, status)` в `src/core/workflow.ts`, без хардкода имён статусов (lesson-32): Done/Rejected по `DEFAULT_WORKFLOW` терминальны, кастомные финалы — тоже; (2) отказ при `status: Done` с непройденными DoD — жёсткая ошибка (`isError: true`) ДО любых записей, тем же приёмом, что VL-251 для no-op статуса: файл задачи/комментарий/usage не трогаются, статус гарантированно не меняется (AC1); (3) `dodOverride: string` добавлен в `properties` схемы, но НЕ в `required` (иначе сломается обычный close) — условная обязательность enforced явной ошибкой с именем поля и конкретным следующим шагом (иначе луп, lesson-92); (4) проверка учитывает `dodChecks` этого же вызова (эффективный DoD = `updates.definitionOfDone ?? task.definitionOfDone`) — обход «отмечу что есть» закрыт; (5) предупреждение в сводке (AC3) считается по итоговому статусу (валидный `args.status` либо текущий) с номерами невыполненных пунктов и пометкой override; жёсткое требование override — только к явно запрошенному терминальному статусу; (6) причина override дописывается в комментарий-отчёт (и явный, и авто-отчёт) — AC2.
Файлов к изменению: 5 (2 кодовых — `src/core/workflow.ts`, `src/mcp/tools.ts`; 2 тестовых — `src/mcp/server.test.mjs`, `src/core/workflow.test.mjs`; документация `README.md` + шаблоны `templates/phases/phase-close.md`, `phase-close-worktree.md`, `phase-do.md`; `doc-8` и `CHANGELOG.md` — Фаза Close, lesson-63). Все пути проверены через ls.
Тесты: два теста на оба исхода в `server.test.mjs` (отказ без override — проверка статуса, отсутствия комментария и неприменённых отметок; успех с override — статус Done + причина в записанном комментарии) + юнит-тесты `isTerminalStatus` в `workflow.test.mjs` + дешёвый кейс предупреждения без смены статуса. Проверки: `pnpm build && npx vitest run src/mcp/server.test.mjs src/core/workflow.test.mjs`, затем полный `pnpm test` (DoD «Тесты проходят» без полного прогона не закрывается).
Риски: (1) жёсткая ошибка меняет поведение close при честно невыполненном DoD — снимается `dodOverride` + правкой шаблонов в том же diff; (2) автоматический Done оркестратора (`finalizePhaseStatus` → `produces_status` Review→Done в close-фазе «обычным текстом») остаётся вне зоны инструмента — зафиксировано как открытый gap (кандидат в задачу-последователя по аналогии с `aborted` VL-244), скоуп VL-248 не расширялся; (3) ложное предупреждение при комментарии к уже закрытой задаче безвредно; (4) риск лупа снят указанием следующего шага в тексте ошибки.
References у задачи нет — новых не добавлял.
---
author: @agent
created: 2026-11-01 17:17
---
Фаза 3 (Code) выполнена. Коммит `8706de3` в ветке vb/vl-248 (worktree); файлы backlog/ не коммичены.
**Изменено (8 файлов):**
- `src/core/workflow.ts` — новый экспорт `isTerminalStatus(workflow, status)`: терминален статус без исходящих фаз, объявленный финальным маркером (`phase: null`), достижимый как `produces_status` либо равный `initial_status`; хардкода имён нет (lesson-32).
- `src/mcp/tools.ts` — (1) `dodOverride: string` в `properties` схемы `backlog_finish_phase` (НЕ в `required` — условная обязательность через явную ошибку, lesson-94) + абзац в description инструмента; (2) импорт `getWorkflowForTask/isTerminalStatus`; (3) в `toolFinishPhase` блок VL-248 между батч-отметкой DoD и сборкой отчёта: эффективный DoD = `updates.definitionOfDone ?? task.definitionOfDone` (обходить «отмечу что есть» нельзя), при явно запрошенном терминальном статусе и непустых неотмеченных пунктах без `dodOverride` — `throw` ДО единственной записи (файл/комментарий/usage не трогаются, статус не меняется), текст ошибки называет номера пунктов и два следующих шага (`dodOverride` / `aborted: true`); (4) причина override дописывается строкой `DoD override: …` к комментарию-отчёту (и явному, и авто); (5) в сводку добавлен фрагмент `терминальный статус при непройденных DoD: #N (override: …)`.
- `src/core/workflow.test.mjs` — +2 теста `isTerminalStatus` (DEFAULT_WORKFLOW: Done/Rejected true, остальные false; кастомный финал Archive; статус вне workflow; бесфазный initial).
- `src/mcp/server.test.mjs` — +3 теста (AC4): отказ без override (isError, `#2` в тексте, `dodOverride` в подсказке; статус остался To Do, комментарий не записан, DoD #1 не отмечен — жёсткая ошибка не персистит частичные отметки); успех с override (статус Done, пункт #2 остался неотмеченным, в сводке предупреждение с `#2` и пометкой override, причина записана в комментарий-отчёт строкой `DoD override: …`); терминальный статус при полном DoD — без предупреждения и без требования override.
- `README.md` — раздел «Контракт backlog_finish_phase»: новый абзац «Терминальный статус при непройденных DoD (VL-248)» (DoD «Документация обновлена» — частично: `doc-8` и `CHANGELOG.md` по правилам фазы пишет Close).
- `templates/phases/phase-close.md`, `phase-close-worktree.md`, `phase-do.md` — правило `dodOverride` в шагах завершения (без внутренних ID — см. ниже).
**Проверки:** `pnpm build` + `npx vitest run src/core/workflow.test.mjs src/mcp/server.test.mjs` — 56 passed; затем полный `pnpm test`. Полный прогон прошёл, но первым заходом упал ровно 1 тест: `src/web/phase-prompt.test.mjs` (VL-157) — `phase-close-worktree.md: не должно быть внутренних ID задач VL-*`; это была моя регрессия (упоминание «VL-248» в переносимом шаблоне промпта). Исправлено удалением ID из трёх шаблонов, точечный прогон `phase-prompt.test.mjs` зелёный (69 passed), затем по правилу AGENTS.md выполнен **один** повторный полный прогон: 119 файлов, 2189 passed, 4 skipped, 0 failed; исключений/`--skip` не было — DoD «Тесты проходят» закрыт полным прогоном. Регрессий нет.
**Что осталось:** `backlog/docs/doc-8` (строка `dodOverride` в таблице + абзац) и запись в `CHANGELOG.md` — Фаза Close (lesson-63). Открытый gap (зафиксирован в плане): автоматический Done оркестратора (`finalizePhaseStatus` → `produces_status` Review→Done) вне зоны инструмента — кандидат в задачу-последователя.
**Lesson:** lesson-140 (не вставлять внутренние ID `VL-N` в `templates/` — падает тест переносимости промптов VL-157), связан с задачей.
---
author: Pavel Bobarev
created: 2026-11-01 17:18
---
Не повторяй один и тот же run_shell_command, в частности `cd /Users/bob/Dev/ton/ai/Vibelog.md/.vibelog/worktrees/vl-248 /Users/bob/Dev/ton` — используй уже полученный вывод, а для обзора дерева/модулей project_map или read_file каталога. Не редактируй src/mcp/tools.ts больше одного раза за одну логическую правку. По сути задачи: в toolFinishPhase реализуй явное предупреждение «терминальный статус при непройденных DoD: #…» в сводке backlog_finish_phase и не допускай переход в status Done, если хоть один DoD не отмечен пройденным; перед backlog_finish_phase сверь список DoD и отметь только фактически выполненные.
---
author: @agent
created: 2026-11-01 17:18
---
Фаза Close прервана: конфликт слияния vb/vl-248 → master (файлы: UU src/core/workflow.test.mjs, UU src/mcp/tools.ts, UU templates/phases/phase-close.md). Ветка vb/vl-248 содержит коммит 8706de3. Merge не откатывался и конфликты не резолвились — состояние master оставлено как есть (merge in progress) для ручного разбора. Разреши конфликт вручную (git status / git diff показывают маркеры <<<<<<<) и повтори Фазу Close.
---
author: @agent
created: 2026-11-01 17:18
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-248 → master (файлы: UU src/core/workflow.test.mjs, UU src/mcp/tools.ts, UU templates/phases/phase-close.md). Ветка vb/vl-248 содержит коммит 8706de3. Merge не откатывался и конфликты не резолвились — состояние master оставлено как есть (merge in progress) для ручного разбора. Разреши конфликт вручную (git status / git diff показывают маркеры <<<<<<<) и повтори Фазу Close. — статус возвращён к Review.
---
author: @agent
created: 2026-11-01 19:35
---
Фаза Close выполнена (повторный ран после прерванного из-за конфликта слияния).
**Merge.** Ветка `vb/vl-248` уже была слита в master до этого рана — merge-коммит `cbae860` (`merge: VL-248 — Не ставить Done при невыполненном DoD в backlog_finish_phase`), рабочее дерево чистое, `git diff --name-only --diff-filter=U` пуст, `MERGE_HEAD` отсутствует (конфликт из прерванного рана разрешён, `vb/vl-248` — предок master). Состав слитого: `src/core/workflow.ts`, `src/core/workflow.test.mjs`, `src/mcp/tools.ts`, `src/mcp/server.test.mjs`, `README.md`, `templates/phases/phase-close.md`, `phase-close-worktree.md`, `phase-do.md` (+223/−3). Worktree `.vibelog/worktrees/vl-248` удалена (`--force`: внутри оставались только untracked-симлинки `node_modules` и `backlog/references/data`), ветка `vb/vl-248` удалена (`-d`, was 8706de3).
**Проверки.** `pnpm build` — успех. Ранний точечный фильтр по diff'у: `npx vitest run src/core/workflow.test.mjs src/mcp/server.test.mjs` — 69 тестов зелёные. Полный прогон `pnpm test` в главном репо — **122 файла, 2305 passed, 4 skipped, 0 failed** (параллельный `vitest` в другом worktree проверен `ps aux` — отсутствовал; повторных полных прогонов не делалось).
**Документация (DoD #2).** В ветке: README (контракт `backlog_finish_phase`) и шаблоны `phase-close.md`, `phase-close-worktree.md`, `phase-do.md` (правило «пункт DoD выполнить нельзя, а задача закрывается → непустой `dodOverride` с причиной», без внутренних ID — lesson-140). В главном репо сейчас: `backlog/docs/doc-8` через `document_update` — строка `dodOverride` в таблице параметров + абзац «Терминальный статус при невыполненном DoD» (workflow-based терминальность, учёт `dodChecks` этого же вызова, формат предупреждения, известное ограничение с автоматическим `produces_status` оркестратора); запись в `CHANGELOG.md` (Unreleased → Исправлено). Коммит документации: `3c9182f` (`docs: VL-248 — терминальный статус при невыполненном DoD (CHANGELOG, doc-8)`). Отдельный коммит refs/lessons: `e72e585` (`docs(task): VL-248 — refs и lessons`, новый lesson-140).
**Lessons.** Похожих активных уроков по теме (`dodOverride`, терминальный DoD) не нашлось — зафиксирован новый lesson-140 про запрет внутренних ID `VL-*` в `templates/` (падение `src/web/phase-prompt.test.mjs` при правке шаблонов этой задачи), связан с VL-248.
**DoD: 1 ✓ Тесты проходят (полный `pnpm test` зелёный), 2 ✓ Документация обновлена (README, doc-8, CHANGELOG, три шаблона фаз), 3 ✓ Нет регрессий (2305 passed, 0 failed после merge).** Все пункты выполнены — терминальный статус ставится без `dodOverride`.
**Открытый риск (не в скоупе):** автоматический `produces_status` оркестратора (`finalizePhaseStatus`) по-прежнему может выставить Done в обход валидации `backlog_finish_phase` — кандидат в задачу-последователя по аналогии с `aborted` (VL-244).
---
<!-- COMMENTS:END -->