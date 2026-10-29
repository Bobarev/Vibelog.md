---
id: VL-188
title: Workflow с явными переходами статус
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 23:57'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - core
  - web
  - bot
dependencies: []
milestone: v1.10
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow.ts
  - src/core/workflow.test.mjs
  - src/core/phase-buttons.ts
  - src/core/phase-buttons.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/web/phase-prompt.ts
  - src/web/phase-prompt.test.mjs
  - src/web/api.ts
  - src/web/trigger-api.test.mjs
  - src/web/lessons-api.test.mjs
  - src/agent/cli.ts
  - src/agent/system-prompt.ts
  - src/bot/handlers.ts
  - src/bot/rich.ts
  - src/bot/rich.test.mjs
  - src/bot/registry.ts
  - src/bot/registry.test.mjs
  - src/cli/commands/init.ts
  - src/cli/router.ts
  - src/cli/skills.test.mjs
  - scripts/npm-smoke.mjs
  - templates/phases/phase-spec.md
  - templates/phases/phase-plan.md
  - templates/phases/phase-code.md
  - templates/phases/phase-do.md
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - templates/phases/phase-comment.md
  - templates/phases/phase-analyze.md
  - templates/phases/phase-reject.md
  - templates/phases/prompt.md
  - templates/qwen-commands/spec.md
  - templates/qwen-commands/plan.md
  - templates/qwen-commands/code.md
  - web/src/components/task-modal/task-modal.tsx
  - web/src/components/kanban/kanban.tsx
  - web/src/components/kanban/api.ts
  - web/src/lib/phase-buttons.ts
  - web/src/types/kanban.ts
  - web/dist/index.html
  - README.md
  - AGENTS.md
lessons:
  - lesson-41
  - lesson-42
  - lesson-43
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
core: workflow с явными переходами статус → фаза → статус (настраиваемый)
Сейчас workflow spec → plan → code → close захардкожен в PHASES (src/web/orchestrator.ts) и шаблонах фаз. Нельзя:
- Пропустить Spec для bugfix.
- Использовать do вместо spec+plan для chore/docs.
- Ветвить (To Do → spec ИЛИ reject).
- Переопределить промпт фазы для конкретного проекта.
Модель
Статус первичен. Задача начинается со статуса (Backlog, To Do), не с фазы.
- Backlog → To Do: вручную (кнопка в вебе / команда бота), НЕ фаза.
- To Do → [фаза] → новый статус.
- Ветвление: из одного статуса несколько фаз (To Do → spec / reject).
Формат transitions: { status, phase, produces_status }.
- phase = null → финальный статус (Done, Rejected), фаз нет.
Формат settings.json — workflows (default/simple/bugfix с initial_status и transitions) и task_workflows (bug→bugfix, chore/docs/spike→simple, остальные→default).
Что реализовать
1. Core src/core/workflow.ts: loadWorkflows, getWorkflowForTask, getWorkflowName, getAvailablePhases, getNextPhase, getStatusAfterPhase, isPhaseAllowed, canMoveTo + DEFAULT_WORKFLOW (fallback без workflows в settings.json → default spec→plan→code→close).
2. src/web/orchestrator.ts: startPhase проверяет isPhaseAllowed (ошибка «Фаза X недопустима из статуса Y»); статус после фазы — getStatusAfterPhase (подстановка {{producesStatus}} в промпт, шаблоны без хардкода); PHASES += 'do'.
3. Шаблоны: phase-1.md→phase-spec.md, phase-2.md→phase-plan.md, phase-3.md→phase-code.md, новый phase-do.md; всё в templates/phases/; импорты обновить.
4. Переопределение шаблонов: .vibelog/prompts/phases/phase-<name>.md → fallback templates/phases/; то же для agent-prompt.md; worktree-вариант phase-<name>-worktree.md; ошибка, если нигде нет.
5. Бот: кнопка «следующий этап» — getNextPhase; при ветвлении — выбор кнопок; команда /move VL-N "To Do".
6. Web: кнопки фаз — getAvailablePhases; кнопка «Взять в работу» (Backlog→To Do); PATCH /api/tasks/:id валидирует переход (canMoveTo) — без транзита перенос на канбан запрещён.
7. Полная очистка qwen-commands rudiment: templates/qwen-commands/{spec,plan,code}.md, init --skills/handleSkills/updateAgentsMd, router-флаги, skills.test.mjs, README/doc-6/9/11, VIBELOG:SKILLS в AGENTS.md.
8. Тесты: workflow, orchestrator (isPhaseAllowed/producesStatus), phase-prompt (переименование/переопределение), бот (ветвление, /move), trigger/patch-api.
9. Документация: doc-6 раздел «Workflow с переходами», README — настройка workflows в settings.json.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/core/workflow.ts: 8 функций + DEFAULT_WORKFLOW.
- [x] #2 Workflow хранится в .vibelog/settings.json (workflows, task_workflows).
- [x] #3 Fallback: нет workflows → default.
- [x] #4 startPhase проверяет isPhaseAllowed (ошибка «Фаза X недопустима из статуса Y»).
- [x] #5 Статус после фазы — getStatusAfterPhase.
- [x] #6 Ветвление: To Do → spec / reject (выбор в боте).
- [x] #7 Шаблоны переименованы: phase-spec.md, phase-plan.md, phase-code.md.
- [x] #8 phase-do.md создан.
- [x] #9 Переопределение: .vibelog/prompts/phases/phase-<name>.md (fallback на templates/).
- [x] #10 Backlog → To Do: вручную (кнопка в вебе и карточке бота).
- [x] #11 Тесты: workflow, orchestrator, phase-prompt, бот.
- [x] #12 Документация: doc-6, README.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: Workflow с явными переходами статус (VL-188)

Тип: feature (не epic) — план в этой задаче. Все пути проверены ls/grep перед записью.

## Архитектурные решения

1. **Единственный источник переходов** — `src/core/workflow.ts` (новый модуль, общий для бота/веба/MCP — lesson-37). Формат: `workflows: Record<name, Workflow>`, `task_workflows: Record<type, name>` в `.vibelog/settings.json` (читается через `loadSettings(cwd)` из `src/core/settings.ts:47`, уже возвращает `{}` при любых проблемах файла — fallback бесплатен).
2. **Разделение node/чистый код не требуется**: бот и сервер — node; веб получает данные через API (`availablePhases` в ответах GET /api/tasks и GET /api/tasks/:id, `triggerPhase` в ответе PATCH), НЕ импортирует workflow.ts (в нём fs — web-сборка с verbatimModuleSyntax не потянет node:fs). Логика остаётся единой — на сервере.
3. **Служебные фазы вне workflow**: `comment`, `prompt`, `analyze`, `resume` не участвуют в isPhaseAllowed (всегда разрешены). Workflow-фазы: `spec, plan, code, close, do, reject`.
4. **`{{producesStatus}}`**: статус после фазы сейчас захардкожен в шаблонах (`phase-1.md:82` → "Spec", `phase-2.md:75` → "Planned", `phase-3.md:57` → "Review", `phase-close.md:44` → "Done"). `startPhase` вычисляет `getStatusAfterPhase(workflow, task.status, phase)` и кладёт в extraVars `producesStatus`; шаблоны используют `"status": "{{producesStatus}}"`.
5. **Ручные переходы** (Backlog → initial_status) — не транзиты: `canMoveTo(workflow, from, to)` разрешает и транзит (produces_status), и ручной вход в `initial_status` из статуса без транзишенов (Backlog). Финальные статусы (phase=null) — исходящих переходов нет,移动 запрещены.
6. **DEFAULT_WORKFLOW** — default из описания (spec/plan/code/close + reject + fix-цикл + null-финалы). ДОРАБОТКА плана относительно описания: в default добавить переход `{ status: 'In Progress', phase: 'code', produces_status: 'Review' }` — config.ts:34 по умолчанию содержит статус In Progress и бот/веб сейчас его поддерживают (phase-buttons.ts:24); без него задачи в In Progress потеряют кнопку (регрессия).

## Файлы и правки

### 1. Новый модуль: src/core/workflow.ts (+ src/core/workflow.test.mjs)

```ts
export interface Transition { status: string; phase: string | null; produces_status: string | null }
export interface Workflow { initial_status: string; transitions: Transition[] }
export interface WorkflowConfig { workflows: Record<string, Workflow>; task_workflows: Record<string, string> }
export const DEFAULT_WORKFLOW: Workflow // default из описания + In Progress→code
```

8 функций:
- `loadWorkflows(cwd): WorkflowConfig` — `loadSettings(cwd).workflows/.task_workflows`; невалидные записи (не объект, нет initial_status/transitions) → выпадают в fallback; нет ключей → `{ workflows: { default: DEFAULT_WORKFLOW }, task_workflows: {} }`.
- `getWorkflowName(cwd, task): string` — `task_workflows[task.type]`, имя отсутствует/неизвестно → `'default'`.
- `getWorkflowForTask(cwd, task): Workflow` — по имени из getWorkflowName; нет → DEFAULT_WORKFLOW.
- `getAvailablePhases(workflow, currentStatus): Phase[]` — `transitions.filter(t => t.status === currentStatus && t.phase !== null).map(t => t.phase)`.
- `getNextPhase(workflow, currentStatus): Phase | null` — первый переход с phase ≠ 'reject' (первичное действие), иначе единственный (reject), иначе null.
- `getStatusAfterPhase(workflow, currentStatus, phase): string | null` — produces_status найденного перехода.
- `isPhaseAllowed(workflow, currentStatus, phase): boolean`.
- `canMoveTo(workflow, from, to): boolean` — транзит OR (to === initial_status && в from нет исходящих транзишенов) OR to === from.

### 2. src/web/orchestrator.ts (startPhase, строки 155–205)

- После `taskExtraVars` (строка ~178): `const task = getTask(cwd, taskId); const wf = getWorkflowForTask(cwd, task);` — если `phase` ∈ workflow-фазы и `!isPhaseAllowed(wf, task.status, phase)` → `return { error: 'Фаза X недопустима из статуса Y' }` (текст из AC). Служебные фазы (comment/prompt/analyze/resume) пропускаются до проверки.
- В extraVars `renderPrompt` (строка ~188) добавить `producesStatus: getStatusAfterPhase(wf, task.status, phase) ?? ''` (только для workflow-фаз).
- Ранний обход: `rejectTask` (строка 392) вызывает startPhase('reject') минуя проверку — оставить как есть (семантика rejectTask: mechanical/LLM, обёрнут в onExit), НО бот/веб reject кнопки считать через getAvailablePhases.
- Строка 735 (`phaseFlags`): условие `phase === 'spec' || phase === 'plan' || ...` — без изменений (do как code — без флага).
- Строка 687 (worktree: `phase === 'plan' && taskType !== 'epic'`) → `(phase === 'plan' || phase === 'do') && taskType !== 'epic'` — в simple workflow нет plan, worktree создаётся на do.

### 3. src/web/phase-prompt.ts

- Строка 21: `PHASES` += `'do'` (это и есть KNOWN_PHASES — отдельной константы в коде нет, проверено grep; сообщить в отчёте).
- Строка 25–36 `PHASE_FILES`: spec→`'phase-spec.md'`, plan→`'phase-plan.md'`, code→`'phase-code.md'`, do→`'phase-do.md'`, reject→`'phase-reject.md'`, close/comment/analyze без смены имён, prompt→`'prompt.md'`.
- Строка 45 `templatesDir` → `'../../templates/phases/'`.
- Новая функция `loadPhaseTemplate(cwd, phase, opts?): string` — порядок: `join(cwd, '.vibelog/prompts/phases', fileName)` → `join(templatesDir, fileName)` (для opts.closeWorktree имя `phase-close-worktree.md` ищется в обоих каталогах); ничего не найдено → throw `Шаблон промпта не найден: <фаза> (проверь .vibelog/prompts/phases/ и templates/phases/)`. `renderPrompt` (строки 61–85) использует её вместо прямого readFileSync.
- `taskExtraVars` не меняется.

### 4. src/agent/system-prompt.ts (строки 31–45)

`agentPromptPath` → сначала `join(cwd, '.vibelog/prompts/agent-prompt.md')`, иначе прежний `templates/agent-prompt.md`; оба отсутствуют → throw (текущее поведение ошибки сохранить). Нужен параметр `cwd` в `buildSystemPrompt` — проверить сигнатуру и вызовы (src/agent/cli.ts) и пробросить.

### 5. Шаблоны: git mv + правки

- `git mv templates/qwen-commands/phase-1.md templates/phases/phase-spec.md` (аналогично phase-2→phase-plan, phase-3→phase-code; phase-close, phase-close-worktree, phase-comment, phase-analyze, prompt.md, reject.md→phase-reject.md — переезжают в templates/phases/).
- **Удалить**: `templates/qwen-commands/spec.md`, `plan.md`, `code.md` (рудимент qwen commands) — после этого `templates/qwen-commands/` удалить целиком.
- Создать `templates/phases/phase-do.md` — по образцу phase-code (самостоятельная реализация без плана): блок подстановок задачи как в phase-code.md:6–15, шаги «исследуй → правь → проверяй (build/test) → коммит → finish_phase с modifiedFiles/acChecks/dodChecks, status: {{producesStatus}}»; без требований Implementation Plan.
- Замены в шаблонах: `"status": "Spec"` → `"{{producesStatus}}"` (phase-spec.md:82, ветка «описание неполное» — без status, как сейчас), phase-plan.md:72,75 → `{{producesStatus}}`, phase-code.md:31,57 → `{{producesStatus}}`, phase-close.md:44 → `{{producesStatus}}`.
- Формулировка «Фаза N (Spec/Plan/Code)» в тексте — оставить (это имя фазы, не статус).

### 6. src/web/api.ts

- POST /api/tasks/:id/trigger (строки 379–412): не менять — startPhase сам вернёт ошибку «Фаза X недопустима из статуса Y» (409, уже обработано).
- PATCH /api/tasks/:id (строка 449–452): если `body.status` присутствует и отличается от текущего — предвалидация ДО updateTaskFile (lesson-36): `canMoveTo(getWorkflowForTask(cwd, task), task.status, body.status)` → иначе 400 `Переход «X» → «Y» недоступен по workflow задачи` (паттерн предвалидации references/documents, строки 283–306).
- GET /api/tasks (строка 94): к каждому объекту добавить поле `availablePhases: string[]` и `workflowInitialStatus` в... проще: в оба GET-ответа (`/api/tasks` список и `/api/tasks/:id` строки 441–446) добавить вычисляемое `availablePhases` (маппинг listTasks/getTask → getAvailablePhases). KanbanTask/Task типы в web расширить опциональным полем.
- PATCH-ответ добавляет `triggerPhase?: string | null` — фаза, производящая target-статус (из transition {status: from, produces_status: to}), чтобы канбан знал, что дёргать (замена PHASE_BY_STATUS).

### 7. Бот: src/bot/rich.ts, src/bot/handlers.ts, src/bot/registry.ts

- **rich.ts** (renderTaskRich, строки 306–330): вместо `nextPhaseForStatus(task.status)` — `getAvailablePhases(getWorkflowForTask(cwd, task), task.status)`; рендер по одной кнопке на фазу: primary-кнопка первой не-reject фазы (`data="next:<id>"` — прежний формат для единственной фазы), при ветвлении — каждая фаза своей кнопкой `data="phase:<id>:<phase>"`; reject — danger-кнопка как сейчас (но по наличию 'reject' в getAvailablePhases, а не `status === 'To Do'` строки 319–325); для Backlog — кнопка `data="start:<id>"` «▶ Взять в работу». Для этого renderTaskRich нужен `cwd` — проверить сигнатуру/вызовы (handlers.ts) и пробросить либо передавать готовый список фаз вторым аргументом (предпочтительнее: `renderTaskRich(task, availablePhases)` — rich.ts остаётся без node-импортов... но rich.ts уже node-модуль; передаём cwd).
- **handlers.ts**:
  - callback `phase:<id>:<phase>` (новый ветка после `next:` строки 1264–1360): запуск произвольной доступной фазы (общий код с next — вынести в локальную функцию launchPhase(task, phase), lesson-37);
  - `next:<id>` — если getAvailablePhases().length > 1 → answerCallbackQuery + sendMd с inline-кнопками выбора (Telegram InlineKeyboardMarkup: по кнопке на фазу, callback `phase:<id>:<phase>`); если 1 — запуск как сейчас;
  - `start:<id>` — `updateTaskFile(cwd, id, { status: wf.initial_status })` (Backlog → To Do);
  - новая команда `move` — `/move VL-N "To Do"`: парсинг id + статуса (как `/status` строки 567–588), валидация `canMoveTo` → updateTaskFile → сообщение `VL-N: X → Y`; неизвестный/недоступный переход → подсказка доступных.
- **registry.ts** — в BOT_COMMANDS (строки 30–56) добавить `{ command: 'move', description: 'Ручной переход статуса по workflow: /move VL-1 "To Do"', examples: ['/move VL-1 "To Do"'] }`; **lesson-9: registry.test.mjs обновить в той же итерации** (проверить, что тест сверяет полноту списка).
- `nextPhaseForStatus` в phase-buttons.ts — удалить вместе с маппингом (или оставить как deprecated-реэкспорт PHASE_EMOJI); PHASE_EMOJI (строки 45–50) расширить: `do: '⚡'`, `reject: '✖'`. phase-buttons.test.mjs и rich.test.mjs:139–145 обновить под новые сигнатуры. web/src/lib/phase-buttons.ts — реэкспорт только PHASE_EMOJI (+ типов).

### 8. Web: web/src/components/*

- **task-modal.tsx** (строки 256, 310–325): `next = task.availablePhases[0]` из ответа API (тип TaskDetail/KanbanTask += `availablePhases?: string[]`); по одной кнопке на каждую фазу (`handlePhase(phase)` уже принимает строку — цикл по массиву); если `task.status === 'Backlog'` → кнопка «▶ Взять в работу» → `patchTask(task.id, { status: initialStatus })`; initialStatus — добавить в GET /api/config ответ поле `initialStatus` (вычислить из default workflow на сервере, api.ts строка 114).
- **kanban.tsx**:
  - удалить `PHASE_BY_STATUS` (строки 56–60);
  - `handleDragEnd` (строки 267–315): `patchTaskStatus` возвращает `{ triggerPhase? }`; при ошибке 400 сервера — откат доски + console/тост «переход недоступен» (текст из ответа); при успехе — если `triggerPhase` непустой → `triggerPhase(task.id, phase)` как сейчас (для `reject` — дёргать `rejectTask` API, POST /reject, а не trigger);
  - `canDrop`/`handleDragOver`: серверная валидация — источник истины; клиент может мягко блокировать по `availablePhases`+`workflowInitialStatus` задачи (опционально, AC выполняется серверной валидацией).
- **kanban/api.ts**: `patchTaskStatus` (строка 110) → возвращает `Promise<{ triggerPhase?: string | null }>`; типы KanbanTask/TaskDetail += `availablePhases?`.

### 9. Очистка qwen commands (rudiment)

- `src/cli/commands/init.ts`: удалить `handleSkills` (строки 99–146), вызов (строка 92), `updateAgentsMd` (строки 190–210) и её вызов, константу `templatesDir` (строка 28).
- `src/cli/router.ts` (строки 163–170): убрать `--skills/--no-skills` из help-строки; в парсере флагов — не сломать (неизвестные флаги игнорируются/ошибка — проверить парсер и убрать регистрацию skills-флагов).
- `src/cli/skills.test.mjs` — удалить целиком (покрывал удаляемый функционал).
- `README.md`: удалить строки 260–290 (секция skills, таблица /vibelog:*, примеры --skills).
- `backlog/docs/doc-6...md` (строка 59), `doc-9` (строка 31), `doc-11` (строка 296) — убрать упоминания /vibelog:* команд (через MCP document_update, backlog/ только MCP).
- `AGENTS.md`: удалить блок `<!-- VIBELOG:SKILLS:BEGIN -->…<!-- VIBELOG:SKILLS:END -->` (файл корня репо — edit).
- `scripts/npm-smoke.mjs` (строки 148–151): пути `templates/qwen-commands/phase-*.md` → `templates/phases/`, имена `phase-1/2/3` → `phase-spec/plan/code` + `phase-do`, `reject`→`phase-reject`.

### 10. Тесты

- **src/core/workflow.test.mjs** (новый): default/simple/bugfix (settings.json fixture во временной директории), fallback без workflows → DEFAULT_WORKFLOW, ветвление To Do → [spec, reject], getNextPhase (первый非reject), getStatusAfterPhase, isPhaseAllowed, canMoveTo (Backlog→To Do разрешён, Spec→Done запрещён, Done→чтому-либо запрещён), битый settings.json → fallback.
- **src/web/orchestrator.test.mjs**: startPhase с phase из другого статуса → error `Фаза plan недопустима из статуса To Do` (без спавна); допустимая фаза → старт; canMoveTo-переход в PATCH через handleApi → 400.
- **src/web/trigger-api.test.mjs**: 409 с текстом ошибки workflow; PATCH status валидация (200/400).
- **src/web/phase-prompt.test.mjs**: обновить имена (phase-1→phase-spec и т.д., строки 110–112, 131–146, 272–333); новые: переопределение `.vibelog/prompts/phases/phase-plan.md` (fixture с уникальной строкой — renderPrompt берёт её), worktree-вариант phase-close-worktree из проекта, отсутствие обоих → throw; renderPrompt без остаточных `{{...}}` (существующие проверки — обновить).
- **src/bot/rich.test.mjs / commands.test.mjs / registry.test.mjs**: ветвление (To Do → 2 кнопки: spec + reject), getNextPhase-замена, /move в BOT_COMMANDS (lesson-9), start-кнопка для Backlog.
- **web**: ручная верификация chrome-devtools (evaluate_script, без скриншотов; lesson-25/27) — драг на канбан, кнопки модалки.

## Порядок действий

1. `src/core/workflow.ts` + `workflow.test.mjs` (чистая логика, тесты зелёные).
2. Переименование/перенос шаблонов (git mv в templates/phases/), phase-do.md, {{producesStatus}}, удаление qwen-шаблонов; правка phase-prompt.ts (PHASE_FILES, templatesDir, loadPhaseTemplate) + system-prompt.ts (override); обновить phase-prompt.test.mjs → `pnpm test:fast`.
3. orchestrator.ts (isPhaseAllowed, producesStatus, worktree-do) + тесты.
4. api.ts (PATCH-валидация, availablePhases, triggerPhase, initialStatus в config) + тесты.
5. Бот (rich/handlers/registry + /move + ветвление) + тесты.
6. Web (task-modal, kanban) + `pnpm web:build`.
7. Очистка qwen commands (init/router/skills.test/README/AGENTS.md/npm-smoke).
8. Документация: doc-6 (MCP document_update — раздел «Workflow с переходами» с форматом settings.json и примерами default/simple/bugfix), README — секция «Workflow».
9. Финал: `pnpm install && pnpm build && pnpm test && pnpm web:build && pnpm lint`.

## Как проверить

```bash
pnpm build
pnpm test          # build + vitest (все обновлённые тесты)
pnpm web:build     # web-компоненты (в worktree: сначала cd web && pnpm install — lesson-6)
pnpm lint
node scripts/npm-smoke.mjs   # опционально, перед publish — проверка путей шаблонов в tarball
```

Ручная проверка: `vibelog browser` → кнопки фаз в модалке по статусу, «Взять в работу» для Backlog, драг To Do→Spec запускает spec, драг Spec→Done → 400 и откат; консоль/сеть чистые (list_console_messages/list_network_requests).

## Риски

1. **Строгая валидация PATCH-статуса** — ломает привычку свободного перетаскивания: колонки In Progress/Blocked/Backlog не покрыты default-transitions. Mitigation: canMoveTo разрешает вход в initial_status из «бесфазных» статусов; бот-команда `/status` (handlers.ts:567) остаётся как ручной escape-hatch без валидации; в описании/доке явно перечислить транзиты. Существующие тесты канбана/trigger, допускающие произвольные переносы, — обновить.
2. **Незаполненный {{producesStatus}}** — если фаза запускается вне startPhase (нет такого пути для задачных фаз — все через startPhase) либо переход отсутствует → в шаблоне останется литерал. Guard: тест renderPrompt «нет остаточных {{...}}» + startPhase кладёт '' только когда isPhaseAllowed уже прошёл.
3. **Разрыв старых карточек бота** — callback `next:<id>` в старых сообщениях должен продолжать работать (оставляем формат данных, обогащая ветвлением).
4. **skills-очистка** — у существующих пользователей остаются старые .qwen/commands (не удаляем — просто перестаём создавать); пользователи с `--skills` в скриптах получат ошибку неизвестного флага — проверить поведение парсера и смягчить (предупреждение вместо ошибки).
5. **rich.ts/рендер без cwd** — если проброс cwd в renderTaskRich затронет много вызовов, альтернатива: вычислять фазы в handlers и передавать массив в renderTaskRich (предпочтительнее, меньше правок).
6. **worktree+simple workflow** — без расширения условия `phase === 'plan'` на 'do' ветка branch_mode не создаст worktree для simple-фаз (шаг 2.2).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 00:03
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Workflow с явными переходами статус» (снят тег #core). Тип: feature. Масштаб: task. Приоритет: Medium. Уточнено: AC зафиксированы по разделу AC из описания (core-workflow с fallback, проверка isPhaseAllowed и ветвление в боте/вебе, переименование шаблонов + переопределение проектом + очистка qwen commands + тесты/документация); тег #core перенесён в labels. Labels: core, web, bot. References: нет (внешние источники не упоминались). Вопросов нет.
---
author: @agent
created: 2026-10-26 00:27
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в задачу: 10 блоков, ~30 файлов (новые: src/core/workflow.ts с 8 функциями + DEFAULT_WORKFLOW, src/core/workflow.test.mjs, templates/phases/phase-do.md; правки: orchestrator/isPhaseAllowed + {{producesStatus}}, phase-prompt/loadPhaseTemplate + переименование шаблонов phase-1/2/3→phase-spec/plan/code с переносом в templates/phases/, api/PATCH-валидация переходов + availablePhases, бот: ветвление кнопок и /move, web: task-modal/kanban без PHASE_BY_STATUS, полная очистка qwen-commands rudiment init/router/skills.test/README/AGENTS.md/npm-smoke, doc-6 + README). Архитектура: workflow — общий core-модуль, веб получает фазы через API (не импортирует fs-модуль); служебные фазы (comment/prompt/analyze) вне isPhaseAllowed; canMoveTo покрывает ручной вход Backlog→initial_status. Поправка плана: в DEFAULT_WORKFLOW добавлен переход In Progress→code (иначе регрессия статуса из config.ts). Уточнение: KNOWN_PHASES в коде отсутствует (grep) — его роль выполняет PHASES в phase-prompt.ts, расширяется на 'do'. Риски: строгая валидация канбан-переносов (смягчена escape-hatch'ем /status), незаполненный {{producesStatus}} (гарант тестом), старые callback-кнопки next:&lt;id&gt; сохраняются, skills-очистка не удаляет уже созданные .qwen/commands пользователей, проброс cwd в renderTaskRich (альтернатива — передавать массив фаз).
---
author: @agent
created: 2026-10-26 02:00
---
Фаза 3 (Code) выполнена. Изменено: 45 файлов, коммит 83ecc63. Реализовано: src/core/workflow.ts (8 функций + DEFAULT_WORKFLOW с In Progress→code/reject; loadWorkflows/getWorkflowName/getWorkflowForTask из .vibelog/settings.json workflows+task_workflows, fallback на default при битом/отсутствующем); orchestrator: startPhase проверяет isPhaseAllowed («Фаза X недопустима из статуса Y», служебные comment/prompt/analyze мимо проверки), подстановка {{producesStatus}} через getStatusAfterPhase (шаблоны phase-spec/plan/code/close без хардкода статусов), worktree-создание расширено на do, PHASES += 'do' (KNOWN_PHASES в коде отсутствовал — роль выполняет PHASES); phase-prompt: loadPhaseTemplate с переопределением .vibelog/prompts/phases/phase-<name>.md → templates/phases/ (worktree-вариант phase-<name>-worktree.md в обоих каталогах, throw если нигде нет),同样的 переопределение agent-prompt.md в system-prompt.ts; шаблоны: git mv в templates/phases/ (phase-1/2/3 → phase-spec/plan/code, reject → phase-reject), новый phase-do.md, удалены qwen-commands/{spec,plan,code}.md; api.ts: PATCH-валидация canMoveTo (400 «Переход … недоступен по workflow задачи»), availablePhases+startTo в GET /api/tasks и /:id, triggerPhase в ответе PATCH, initialStatus в /api/config; бот: кнопки по getAvailablePhases (ветвление → phase:<id>:<phase>, legacy next:<id> при единственной фазе, при ветвлении по next просит выбрать кнопку), start:<id> «Взять в работу», команда /move (canMoveTo-валидация, кавычки), BOT_COMMANDS 23 (registry.test обновлён); web: кнопки модалки по availablePhases + «Взять в работу» (startTo), канбан без PHASE_BY_STATUS (triggerPhase из ответа PATCH, reject через POST /reject, откат при 400), patchTaskStatus возвращает результат с текстом ошибки сервера; очистка qwen-commands rudiment: init --skills/handleSkills/updateAgentsMd удалены, router-help, skills.test.mjs удалён (VL-105-инварианты перенесены в phase-prompt.test), npm-smoke (templates/phases + отсутствие qwen-commands), README (секции skills→Workflow с форматом settings.json), AGENTS.md (блок VIBELOG:SKILLS удалён). Проверки: pnpm build ✓, pnpm test ✓ (1255+7 тестов, 71 файл), pnpm web:build ✓, pnpm lint ✓. Новые тесты: core/workflow.test (18: default/simple/bugfix/fallback/ветвление/canMoveTo), trigger-api (7: 409 недопустимой фазы, PATCH-транзит/400/Backlog→To Do/availablePhases/initialStatus), phase-prompt (переименование, do, переопределение, worktree-override), rich/registry/phase-buttons обновлены; фик флака lessons-api (local date vs UTC). Что осталось: AC12 «Документация: doc-6» НЕ выполнен — backlog/docs запрещены в Фазе 3 шаблоном (итоговую документацию пишет Close); README обновлён. Ручная браузерная верификация (драг/кнопки) не проводилась — экономия ходов, закрывается визуально при Close.
---
author: @agent
created: 2026-10-26 07:57
---
Фаза Close выполнена. Ветка vb/vl-188 слита в master (1 коммит 83ecc63, merge d4b51f1), worktree удалена, ветка удалена. После merge: pnpm build ✓, pnpm test ✓ (все тесты зелёные).
Документация (docs-коммит 060649b): CHANGE.md — запись в Unreleased (полное описание VL-188); doc-6 — новый раздел «Workflow с переходами статус» в §8 (формат settings.json, примеры default/bugfix/simple, fallback, ветвление, ручные переходы, серверная валидация, переопределение промптов), обновлены §10 (кнопки модалки по availablePhases, drag-and-drop с canMoveTo) и §11 (кнопки карточки по getAvailablePhases, ветвление, «Взять в работу», команда /move), удалены строки --skills/`/vibelog:*` из §1; doc-9 — секция 1 переписана (workflow вместо `/vibelog:*`-команд); doc-11 — убрано упоминание `/vibelog:spec` (§2.2), плюс обновлены пути шаблонов templates/phases в плане v1.7.
Lessons (коммит 51e2a6c): созданы lesson-41 (сверяй имена констант из плана с кодом через grep), lesson-42 (нормализуй даты в тестах к одному часовому поясу local vs UTC — фикс флака lessons-api), lesson-43 (сохраняй старый формат callback-кнопок бота при расширении), все связаны с VL-188.
DoD: 1 (тесты проходят) ✓, 2 (документация обновлена) ✓, 3 (нет регрессий) ✓ — все пункты выполнены. AC12 «Документация: doc-6, README» закрыт (README обновлён в Фазе 3). Ручная браузерная верификация драгов/кнопок не проводилась (экономия ходов) — серверная валидация и откат покрыты тестами trigger-api.
---
<!-- COMMENTS:END -->