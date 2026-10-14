---
id: VL-137
title: 'Фазы: подстановка задачи (title/type/description/plan/AC/DoD/status/lastComment) в первый промпт + пакетирование shell-шагов'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 10:57'
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
  - src/web/phase-prompt.ts
  - src/web/orchestrator.ts
  - src/agent/cli.ts
  - src/web/phase-prompt.test.mjs
  - src/web/orchestrator.test.mjs
  - src/agent/cli.test.mjs
  - templates/qwen-commands/phase-1.md
  - templates/qwen-commands/phase-2.md
  - templates/qwen-commands/phase-3.md
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-close-worktree.md
  - templates/qwen-commands/phase-comment.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Профиль реальных сессий (2026-10-12/13): каждая фаза начинается с backlog_view_task (~1.2 вызова на фазу), close дополнительно делает manage_dod list, comment-фаза читает последний комментарий — это ровно то, что можно подставить в промпт. Оркестратор уже импортирует getTask (orchestrator.ts:21) и читает задачу для worktree-блока — подстановка технически trivial.

Решение: перед renderPrompt в startPhase/startResume — getTask(cwd, taskId), поля кладутся в extraVars: taskTitle, taskType, taskDescription, taskPlan (implementationPlan), taskAC, taskDoD (списки с номерами), taskStatus, taskLastComment. Шаблоны получают блок «Задача (подставлена автоматически): ...»; шаги view_task убираются как обязательные (остаётся фолбэк «если блок не подставлен — прочитай через MCP», для web-триггера без extraVars). ВАЖНО: не ломать контракт {{comment}} (VL-80) — подстановки только новыми переменными.

+ Пакетирование shell (промпт-правило в phase-3 и close-шаблонах): последовательные git/shell-команды объединять в один вызов через && (git status+ls; pnpm build && pnpm test уже упомянут) — экономит 2-4 вызова на фазу close/code.

Экономия по профилю: view_task −1..−2 во всех фазах, close дополнительно −DoD-list, comment/spec −последний-комментарий, shell-пакетирование −2..−4 в close/code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 orchestrator.startPhase/startResume и CLI vibelog-agent (phase-режим): getTask(cwd, taskId) → новые extraVars {{taskTitle}} {{taskType}} {{taskDescription}} {{taskPlan}} {{taskAC}} {{taskDoD}} {{taskStatus}} {{taskLastComment}} {{taskModifiedFiles}}; задача не найдена или не читается → фаза НЕ запускается (ошибка, промпт с {{...}} не уходит); контракт {{comment}} VL-80 сохранён — подстановки только новыми переменными
- [x] #2 шаблоны phase-1/2/3/close/close-worktree/comment: блок «Задача (подставлена автоматически)» (taskTitle/taskType/taskDescription/taskPlan/taskAC/taskDoD/taskModifiedFiles/taskStatus/taskLastComment); шаги backlog_view_task и «прочитай последний комментарий» заменены ссылкой на блок; в phase-3 и оба close-шаблона добавлено правило пакетирования: последовательные git/shell-команды объединять в один вызов через &&
- [x] #3 orchestrator.test.mjs: подстановка полей задачи в промпт startPhase (task и epic), фолбэк «задача не найдена → ошибка, фаза не запускается», компактный блок задачи в startResume; phase-prompt.test.mjs: шаблоны содержат блок подстановки и правило пакетирования, taskExtraVars/taskBlockText возвращают корректные значения (9 ключей для задачи, null/'' для отсутствующей)
- [x] #4 pnpm test зелёный (874 теста); запись CHANGELOG — работа Фазы Close (VL-126: в Фазе 3 CHANGELOG и backlog/docs не обновляются)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-137 — План реализации

Подстановка полей задачи в первый промпт фазы + пакетирование shell-шагов.

## Архитектурные решения

1. **Где берутся поля**: `getTask(cwd, taskId)` уже импортирован в `src/web/orchestrator.ts:21`. Подстановка — ВНУТРИ `startPhase`/`startResume` (не в вызывающих): web-trigger (`api.ts:68`), бот (`handlers.ts`) и любой caller автоматически получают блок без правок.
2. **Формат — новые extraVars** (`{{taskTitle}}`, …), контракт `{{comment}}` VL-80 не трогаем: подстановка только новых ключей, порядок merge `...extraVars` сохранён.
3. **Фолбэк как в VL-80**: задача не найдена/битая → vars не передаются → в промпте остаются литеральные `{{taskTitle}}` и т.д. — по этому признаку шаблонная инструкция «неподставленные {{...}} → прочитай через MCP (backlog_view_task)». Фаза не падает.
4. **Правка AC (упущение)**: close-шаблоны требуют `modified_files` (phase-close.md шаг 1,4; phase-close-worktree.md шаг 1) — добавляю 9-ю переменную `taskModifiedFiles`, иначе close не избавится от view_task.
5. **startResume** не вызывает renderPrompt (raw promptText) — компактный блок состояния задачи добавляется конкатенацией к promptText, только для задачных сессий (worktreeTaskId из меты).

## Файлы для изменения (проверены ls — все существуют)

| Файл | Что делаем |
|---|---|
| `src/web/phase-prompt.ts` | Новые экспорт-функции (после renderPrompt, ~стр. 82) |
| `src/web/orchestrator.ts` | startPhase (~стр. 102–113), startResume (~стр. 193–196) |
| `templates/qwen-commands/phase-1.md` | Блок + фолбэк шага 1 |
| `templates/qwen-commands/phase-2.md` | Блок + фолбэк шага 1 |
| `templates/qwen-commands/phase-3.md` | Блок + фолбэк шага 1 + правило пакетирования shell |
| `templates/qwen-commands/phase-close.md` | Блок + фолбэк шага 1 + пакетирование shell |
| `templates/qwen-commands/phase-close-worktree.md` | Блок + фолбэк шага 1 + пакетирование shell |
| `templates/qwen-commands/phase-comment.md` | Блок + фолбэк шага 1 и последнего комментария |
| `src/web/orchestrator.test.mjs` | +3–4 теста подстановки |
| `src/web/phase-prompt.test.mjs` | +3 теста, адаптация 2 существующих assert'ов |
| `CHANGELOG.md` | Запись в [Unreleased] |

## Шаг 1 — src/web/phase-prompt.ts (новые функции)

Импортировать `getTask` из `../core/store.js` и тип `Task`/`ChecklistItem` из `../core/task.js`. После `renderPrompt` (стр. 82) добавить:

- `formatChecklist(items: (ChecklistItem | string)[]): string` — нумерованный список `1. [x] Текст` / `1. [ ] Текст` (строка-формат хранения задачи); пусто → `(нет)`.
- `taskExtraVars(cwd: string, taskId: string): Record<string, string>` — `getTask` в try/catch; null/throw → `{}` (фолбэк). Успех → 9 ключей:
  - `taskTitle` (title), `taskType` (type), `taskStatus` (status);
  - `taskDescription` (description; пусто → `(нет)`), `taskPlan` (implementationPlan; пусто → `(нет)`);
  - `taskAC` / `taskDoD` — formatChecklist по acceptanceCriteria/definitionOfDone (ChecklistItem|string[]);
  - `taskModifiedFiles` — modified_files.join(', '); пусто → `(нет)`;
  - `taskLastComment` — `${author} (${created}): ${text}` последнего comments[]; пусто → `(нет комментариев)`.
- `taskBlockText(cwd: string, taskId: string): string` — компактный блок для resume из тех же полей (заголовок; тип; статус; последний комментарий); `''` если задача не найдена.

Порядок ключей в объекте — фиксированный (description/plan первыми, скаляры после): защита от подмены внутри значений при replaceAll-цикле renderPrompt.

## Шаг 2 — src/web/orchestrator.ts

- **startPhase** (стр. 102–113): в literal extraVars (стр. 104–109) добавить `...taskExtraVars(cwd, taskId)` (импорт из './phase-prompt.js' рядом с renderPrompt, стр. 19). Порядок: после `...extraVars`, до branch/worktreeDir.
- **startResume** (стр. 165–204): перед `return spawnQwenRun(...)` (~стр. 196), если задан `worktreeTaskId` — `promptText += '\n\n' + taskBlockText(cwd, worktreeTaskId)` (пустой блок → ничего не добавляется).

## Шаг 3 — шаблоны (6 файлов)

Единый блок вставить после вступительного абзаца «Работай через Vibelog MCP…» (phase-1/2/3/comment — после стр. 3; phase-close/close-worktree — после стр. 5):

```
Задача (подставлена автоматически):
ID: {{taskId}}; тип: {{taskType}}; статус: {{taskStatus}}
Заголовок: {{taskTitle}}

Описание: {{taskDescription}}
План: {{taskPlan}}
Критерии приёмки (AC): {{taskAC}}
Definition of Done (DoD): {{taskDoD}}
Изменённые файлы: {{taskModifiedFiles}}
Последний комментарий: {{taskLastComment}}

Если в блоке выше остались неподставленные {{...}} (задача не найдена или не читается) — прочитай её через MCP (backlog_view_task {"id": "{{taskId}}"}) и продолжай по шагам.
```

Правки шагов:
- **phase-1.md** стр. 12–16 (шаг 1): «Задача подставлена в блок выше; шаг backlog_view_task — только фолбэк, если блок не подставлен». Стр. 122 — «(фолбэк, шаг 1)».
- **phase-2.md** стр. 12–16: то же (шаг 1 → фолбэк).
- **phase-3.md** стр. 7–10: шаг 1 → фолбэк (план уже в блоке). В «Экономия ходов» (стр. 38–44) добавить: «Пакетируй последовательные git/shell-команды в ОДИН вызов через && (например: git status --porcelain && git log -1)».
- **phase-close.md** стр. 7–9: шаг 1 → фолбэк (type/modifiedFiles в блоке). В «Экономия ходов» (стр. 50–51) — то же правило пакетирования.
- **phase-close-worktree.md** стр. 8–9: шаг 1 → фолбэк. В «Правила» (после стр. 70) — правило пакетирования (git -C … && …).
- **phase-comment.md** стр. 7–8: шаг 1 → фолбэк. Стр. 12 (фолбэк {{comment}}): «сначала возьми последний комментарий из блока ({{taskLastComment}}); блок не подставлен — из backlog_view_task (шаг 1)».

## Шаг 4 — тесты

**phase-prompt.test.mjs**:
1. Все 6 шаблонов (readFileSync) содержат «Задача (подставлена автоматически)» и фолбэк-инструкцию про неподставленные {{...}}.
2. phase-3.md, phase-close.md, phase-close-worktree.md содержат правило пакетирования (объединение команд через &&).
3. `taskExtraVars`: tmp-backlog с задачей (createTaskFile + AC/DoD/комментарий через addComment) → 9 ключей, нумерация AC `1. [x]`; несуществующий ID → `{}`.
4. **Адаптация существующих** (стр. 46 и 56): assert `!p.includes('{{')` сломается — в промпт попадут неподставленные task-переменные. Передавать в renderPrompt полный набор task-переменных (или смячить проверку на `{{taskId}}/{{branch}}/{{worktreeDir}}`).

**orchestrator.test.mjs** (по образцу теста VL-60, стр. 214 — stub-marker + чтение argv):
1. startPhase('plan') задачи с описанием/AC/DoD/комментарием → в промпте «Заголовок: <title>», текст AC, последний комментарий; нет '{{taskTitle}}'.
2. epic-задача → в блоке 'тип: epic'.
3. Несуществующая taskId → промпт содержит '{{taskTitle}}' и фолбэк-инструкцию «прочитай через MCP» (фаза не падает, started=true).
4. startResume задачной сессии (meta-файл <sessionId>.meta.json c taskId, как в VL-110-тестах) → в promptText компактный блок задачи.

## Шаг 5 — проверка и CHANGELOG

- `pnpm build && pnpm test` (в worktree vb/vl-137; node_modules есть).
- CHANGELOG.md, [Unreleased] → «Изменено»: VL-137 — подстановка полей задачи в промпты фаз (9 переменных, фолбэк через MCP при битой задаче), пакетирование shell-команд в phase-3/close, компактный блок в resume.

## Порядок выполнения (Фаза 3)

phase-prompt.ts → orchestrator.ts → 6 шаблонов → тесты (phase-prompt, orchestrator) → pnpm test → CHANGELOG → коммит в ветку vb/vl-137.

## Риски

- **Существующие тесты phase-prompt.test.mjs (стр. 46, 56)** упадут на `!includes('{{')` — обязательна адаптация (шаг 4.4).
- Длина промпта каждой фазы вырастает на размер описания+плана — компенсируется экономией 1.2+ MCP-вызовов на фазу; при раздувании — усечение description/plan с маркером «…» (не в этой задаче).
- Подмена внутри значений: если description содержит литерал `{{taskStatus}}`, replaceAll подставит его при следующем ключе — фиксированный порядок ключей + редкость кейса; тест не требуется.
- resume-блок дублирует контекст сессии — дёшево (≈100 токенов), спасает от view_task на «Продолжи».
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## VL-137 — Фаза 3 (код)

Реализация подстановки полей задачи в первый промпт фазы и пакетирования shell-команд.

### Код
- `src/web/phase-prompt.ts` — `taskExtraVars(cwd, taskId)` (9 полей → extraVars), `taskBlockText` (компактный блок для resume), `formatChecklist`. Все в `try/catch`; `null`/`''` при битой/отсутствующей задаче.
- `src/web/orchestrator.ts` — `startPhase` (подстановка через extraVars + guard: нет задачи → `{error}`, фаза не спавнится), `startResume` (компактный блок задачи конкатенируется к promptText задачной сессии).
- `src/agent/cli.ts` — phase-режим CLI получает те же extraVars и такой же guard (иначе ручной запуск фазы остался бы без подстановок).

### Решение по фолбэку (вопрос Pavel)
Фолбэк-инструкции «неподставленные {{...}} → прочитай через MCP» в шаблонах НЕТ. Вместо этого при неподчитанной задаче фаза не запускается вовсе: `startPhase`/CLI возвращают ошибку, промпт с литеральными `{{...}}` не уходит модели. Обоснование: пустой блок модель не исправит сама, а незапущенная фаза не тратит ходы и не правит файлы вслепую. `{{comment}}`-контракт VL-80 не тронут — подстановки только новыми переменными, порядок merge сохранён.

### Правки плана (AC/шаблоны)
- Пакетирование shell в `phase-3` НЕ упоминает `pnpm` — в шаблонах запрещено дублировать правила проекта (инвариант `src/cli/skills.test.mjs`), пример через `git status --porcelain && git log -1`.
- Шаблон `phase-1` получил блок подстановки (в плане он был только «шаг 1 → фолбэк»).

### Проверки
`pnpm build` + `pnpm test`: 874 теста, 52 файла — зелёные. Правки в существующих тестах обусловлены guard'ом «фаза не запускается без читаемой задачи»: в `orchestrator.test.mjs`/`cli.test.mjs` добавлены createTaskFile для реально существующих задач.

### Что осталось
- DoD «Документация обновлена» — не закрыт: по правилам Фазы 3 (VL-126) CHANGELOG и backlog/docs пишет Фаза Close после слияния.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 13:21
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 11 файлов (src/web/phase-prompt.ts, src/web/orchestrator.ts, 6 шаблонов templates/qwen-commands/, 2 тестовых файла, CHANGELOG.md). Ключевые решения: подстановка 9 полей задачи (taskTitle/Type/Description/Plan/AC/DoD/Status/LastComment + taskModifiedFiles — правка AC, т.к. close-шаблоны требуют modified_files) внутри startPhase/startResume через getTask; фолбэк-механик по образцу VL-80 (битая задача → неподставленные {{...}} → инструкция «прочитай через MCP»); контракт {{comment}} не трогается; пакетирование shell-команд (&&) в phase-3 и обоих close-шаблонах. Риски: существующие assert'ы phase-prompt.test.mjs (стр. 46, 56) на !includes('{{') сломаются — обязательна адаптация в Фазе 3; рост длины промпта (компенсируется экономией MCP-вызовов); theoretical подмена литералов {{...}} внутри значений полей.
---
author: Pavel Bobarev
created: 2026-10-13 14:02
---
Фолбэк не нужен! Если задача не нашлась на уровне кода, то зачем вообще запускать промпт фазу ? Каким образом модель выполнит сама "Если в блоке выше остались неподставленные {{...}} (задача не найдена или не читается) — прочитай её через MCP (backlog_view_task {"id": "{{taskId}}"}) и продолжай по шагам." ???
---
author: @agent
created: 2026-10-13 14:57
---
Фаза 3 (Code) выполнена. Коммит `a787aba` (ветка vb/vl-137), 12 файлов, +500/−33.
**Код:**
- `src/web/phase-prompt.ts` — новые `taskExtraVars` (9 полей задачи → extraVars: title/type/description/plan/AC/DoD/modifiedFiles/status/lastComment), `taskBlockText` (компактный блок для resume), `formatChecklist`.
- `src/web/orchestrator.ts` — `startPhase` подставляет поля задачи в промпт; `startResume` добавляет компактный блок задачи к promptText задачной сессии.
- `src/agent/cli.ts` — phase-режим CLI получил те же подстановки.
- 6 шаблонов (`phase-1/2/3/close/close-worktree/comment`) — блок «Задача (подставлена автоматически)»; шаги `backlog_view_task`/«прочитай последний комментарий» сведены к ссылке на блок; `phase-3` + оба close — правило пакетирования shell-команд через `&&`.
**По замечанию Pavel (фолбэк не нужен):** инструкции «неподставленные {{...}} → прочитай через MCP» в шаблонах НЕТ. При неподчитанной/битой задаче `startPhase` и CLI возвращают ошибку и фаза НЕ запускается — промпт с литеральными `{{...}}` модели не уходит. Контракт `{{comment}}` (VL-80) сохранён: подстановки только новыми переменными.
**Тесты:** `orchestrator.test.mjs` +4 (подстановка полей task/epic, ошибка при ненайденной задаче, компактный блок в resume); `phase-prompt.test.mjs` +4 (блок во всех шаблонах, отсутствие фолбэк-инструкции, правило пакетирования, taskExtraVars/taskBlockText/formatChecklist). Правки в существующих тестах — добавлены createTaskFile, т.к. фаза теперь не стартует без читаемой задачи. Временный «пинок» кейса без задачи сохранён тестом на error-ветку.
**Проверки:** `pnpm build` + `pnpm test` — 874 теста / 52 файла, зелёные.
**Осталось (не закрыто честно):** DoD «Документация обновлена» — по правилам Фазы 3 (VL-126) CHANGELOG и backlog/docs пишет Фаза Close после слияния; запись AC4 соответствующим образом отредактирована.
---
author: @agent
created: 2026-10-13 16:07
---
Фаза Close прервана: конфликт слияния vb/vl-137 → master (merge Aborting: "Your local changes to the following files would be overwritten by merge: templates/qwen-commands/phase-1.md"; файлы: ` M "backlog/tasks/VL-137 - Фазы-подстановка-задачи-titletypedescriptionplanACDoDstatuslastComment-в-первый-промпт-пакетирование-shell-шагов.md"`, ` M templates/qwen-commands/phase-1.md`, `?? backlog/tasks/VL-129 - tests-Оптимизировать-тесты.md`, `?? backlog/tasks/VL-143 - core-Создать-единый-файл-настроек.md`, `?? backlog/tasks/VL-144 - workflow-Нужен-механизм-отказа-от-задачи.md`, `?? backlog/tasks/VL-145 - bot-Высказывает-ошибки-Запуск-уже-выполняется-При-попытке-параллельно.md`). В главном репозитории есть незакоммиченная локальная правка шаблона phase-1.md (строка «Экономия ходов»), которую merge не может перезаписать; ветка vb/vl-137 тоже меняет этот файл. Разреши конфликт вручную (закоммить или stash локальной правки phase-1.md) и повтори Фазу Close. Статус и DoD не изменены, worktree и ветка не удалялись.
---
author: @agent
created: 2026-10-13 16:11
---
Фаза Close прервана: конфликт слияния vb/vl-137 → master (файлы: `UU src/web/orchestrator.test.mjs`; в конфликте участвуют также уже слитые `M src/web/orchestrator.ts`, `M src/web/orchestrator.test.mjs` — см. git status). Разреши конфликт вручную и повтори Фазу Close. Статус и DoD не изменены, worktree и ветка не удалялись.
---
author: @agent
created: 2026-10-13 16:19
---
Фаза Close прервана: merge vb/vl-137 слит в master (коммит 116bfc2, конфликт src/web/orchestrator.test.mjs разрешён вручную пользователем), но сборка/тесты падают: `pnpm build` — ок; `vitest run` — 6 failed / 868 passed из 874, все в `src/web/orchestrator.test.mjs`:
1. «startPhase: close не получает задачный env (VL-112-гард, VL-114)»;
2. «spec с branch_mode: worktree не создаётся, фаза идёт в главном cwd (VL-134)»;
3. «code без worktree: не создаётся, фаза идёт в главном cwd (VL-134)» — ошибка «Задача не найдена или не читается: VL-91» (guard подстановки VL-137 падает, тест не создаёт файл задачи);
4. «startPhase: поля задачи подставляются в промпт (VL-137)» — ENOENT marker-vl137.txt (фаза не стартовала);
5. «startPhase: epic-задача → тип: epic (VL-137)» — ENOENT marker-vl137-epic.txt;
6. «startResume: компактный блок задачи (VL-137)» — ENOENT marker-rb.txt.
Возможная причина — ручной резолюв merge-конфликта в orchestrator.test.mjs либо несовместимость guard'а «фаза не запускается без читаемой задачи» с фикстурами VL-112/VL-134. Статус и DoD не изменены, worktree и ветка не удалялись. Разреши падения тестов и повтори Фазу Close.
---
author: @agent
created: 2026-10-13 16:40
---
Фаза Close выполнена. Ветка vb/vl-137 слита в master (1 коммит a787aba; merge-коммит 116bfc2 — конфликт src/web/orchestrator.test.mjs разрешён вручную Pavel'ем), затем починка 6 тестов после merge (коммит 02d192c: смешение стилей VL-140 `setStubEnv` и VL-137 `createTaskFile`-гардов при резолюше — часть тестов осталась на `process.env`-мутациях, которые после VL-140 не попадают в spawn-env). `pnpm build` + `pnpm test`: 52 файла / 874 теста зелёные. Worktree .vibelog/worktrees/vl-137 удалена (force — только untracked-симлинки node_modules/refs), ветка vb/vl-137 удалена. DoD: 3/3 — тесты проходят, документация обновлена (CHANGELOG, docs-коммит fac5c67 «docs: VL-137 — документация и CHANGELOG»), нет регрессий. Статус: Done.
---
<!-- COMMENTS:END -->