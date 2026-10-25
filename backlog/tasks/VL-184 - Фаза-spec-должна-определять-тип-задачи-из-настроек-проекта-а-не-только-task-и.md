---
id: VL-184
title: Определять тип задачи и приоритет в фазе spec
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 15:38'
updated_date: '2026-10-25 19:40'
due_date: ''
labels:
  - agent
  - core
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
  - src/web/phase-prompt.ts
  - src/web/phase-prompt.test.mjs
  - src/mcp/tools.ts
  - templates/qwen-commands/phase-1.md
  - templates/qwen-commands/phase-2.md
  - templates/qwen-commands/phase-3.md
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-close-worktree.md
  - templates/qwen-commands/spec.md
  - templates/qwen-commands/plan.md
  - templates/qwen-commands/code.md
  - .qwen/commands/vibelog/spec.md
  - .qwen/commands/vibelog/plan.md
  - .qwen/commands/vibelog/code.md
  - README.md
lessons:
  - lesson-31
  - lesson-32
  - lesson-33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Фаза spec должна определять тип задачи из настроек проекта, а не только task и epic. Например если задача явно про ошибку - устанавливать тип Bug. А так же по возможности установить приоритет.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

Фаза Spec (headless-шаблон `phase-1.md` + интерактивный skill `spec.md`) определяет type из `types` backlog/config.yml (не только task/epic: bug для явных ошибок и т.д.) и, когда описание позволяет, priority из `priorities` конфига. Ниже по workflow (Plan/Code/Close) ветвление приводится к семантике «epic vs НЕ epic», чтобы не-epic типы не ломали фазы (DoD «Нет регрессий»).

Ключевые находки (по коду):
- Подстановки собирает `taskExtraVars` в `src/web/phase-prompt.ts` (общая для orchestrator и `src/agent/cli.ts`): уже есть `availableLabels` из конфига (VL-154) — добавляем `availableTypes`/`availablePriorities` по тому же образцу.
- Ветка workflow в коде — только `taskType !== 'epic'` (`src/web/orchestrator.ts:586-590`), код безопасен для любых не-epic типов; опасны только формулировки шаблонов «(task или epic) / Если type=task».
- MCP `backlog_update_task` валидирует type через `normalizeTaskType` по конфигу (`src/mcp/tools.ts:830`) — `type: "bug"` проходит; а вот у priority enum `['High','Medium','Low']` в inputSchema (строки 81 и 153) — кастомные значения из config.priorities клиент с валидацией отвергнет.

## Изменяемые файлы (16)

### 1. src/web/phase-prompt.ts — подстановки availableTypes / availablePriorities
- Строка 14 (import): добавить `DEFAULT_TASK_TYPES` в import из `../core/config.js` (сейчас только `loadConfig`).
- `taskExtraVars` (строки 122–172): три отдельных IIFE с `loadConfig` (сейчас только `availableLabels`, ~строки 154–160) заменить на ОДИН try/catch `loadConfig` после `getTask`, из него собрать:
  - `availableLabels` — как сейчас (непустой массив labels → `join(', ')`, иначе `''`);
  - `availableTypes` — непустой `config.types` → `join(', ')`, иначе `DEFAULT_TASK_TYPES.join(', ')`; ошибка чтения конфига → `DEFAULT_TASK_TYPES.join(', ')` (зеркалит fallback `normalizeTaskType`, src/core/config.ts:64);
  - `availablePriorities` — непустой `config.priorities` → `join(', ')`, иначе `'High, Medium, Low'`; ошибка → `'High, Medium, Low'`;
  - оба новых ключа — ПОСЛЕ `availableLabels` в возвращаемом объекте (порядок replaceAll сохраняется: длинные тексты первыми).
- Комментарий к коду: VL-184 — Spec классифицирует тип/приоритет по конфигу так же, как labels (VL-154).

### 2. templates/qwen-commands/phase-1.md — сам промпт Фазы Spec
- После строки 16 («Доступные labels:») добавить:
  `Доступные типы: {{availableTypes}}`
  `Доступные приоритеты: {{availablePriorities}}`
- Строка 23 (цель Spec): «…определить масштаб (task или epic)» → «…определить тип задачи по списку доступных и масштаб (обычная задача или epic)».
- Строка 29 (шаг 1): убрать «(task или epic)»; добавить: workflow ветвится только по epic — любой другой тип (task, bug, feature, …) обычная задача-исполнитель.
- Строка 45 (шаг 4 «Определи масштаб») → «Определи масштаб и тип (по описанию, БЕЗ чтения кода)»:
  - type=epic: фича явно не укладывается в одну задачу (несколько подзадач);
  - иначе выбери тип из «Доступные типы»: явная ошибка/баг → bug; документация → docs; исследование/эксперимент → spike; поддержка/рутина → chore; улучшение существующего → enhancement; новая функциональность → feature; сомневаешься → task;
  - приоритет из «Доступные приоритеты»: критично/блокирует/ломает → High; явно несрочно/nice-to-have → Low; описание полное и приоритет неочевиден → Medium; описание неполное → приоритет не передавай.
- Строка 50 (пример вызова `backlog_update_task`): добавить в пример `"priority": "High|Medium|Low"` + примечание: type и priority — ТОЛЬКО значения из «Доступные типы»/«Доступные приоритеты».
- Строка 78 (finish_phase, описание полное): в комментарий добавить `Тип: <тип из списка>. Приоритет: <High|Medium|Low|не определён>.` («Масштаб: task|epic» сохранить).
- Строка 81 (описание неполное): добавить `Тип: не изменён. Приоритет: не определён.`

### 3. templates/qwen-commands/spec.md (интерактивный /vibelog:spec)
- Строки 16–17 (шаг 2): тип выбирать из `types` backlog/config.yml (файл читается bash'ем на шаге 1; конфига нет → task/epic), epic — когда не укладывается в одну задачу.
- Строка 22 (шаг 3): «Установи type (task или epic)» → «Установи type (значение из types конфига) и priority (из priorities конфига, если из описания однозначно; иначе не ставь)».

### 4. Шаблоны ниже по потоку — ветвление «epic vs НЕ epic» (защита от регрессии)
- `phase-2.md:27` — «(task или epic)» → «…; epic — ветвление фазы, любой другой тип (task, bug, …) — обычная задача»; `:44` «Если type=task» → «Если type ≠ epic»; `:75` «Тип: <task|epic>» → «Тип: <из задачи>».
- `phase-3.md:19` — «Для type=task реализуй План» → «Для type ≠ epic (task, bug, feature, …) реализуй План» (`:26` «Если type=epic» — без изменений).
- `phase-close.md:18` — убрать «(task или epic)», явно: ниже важно только epic/не-epic (`:20` «Если type=epic» — ок).
- `phase-close-worktree.md:19` — то же (`:98` «Если type=epic» — ок).
- `plan.md:13` «task или epic» → «epic или обычная задача (task, bug, …)»; `:20` «Если type=task» → «Если type ≠ epic»; `:39` «(type=task)» → «(type ≠ epic)».
- `code.md:12` — как plan.md:13; `:14` «Если type=task» → «Если type ≠ epic» (`:18` — ок).
- Синхронизировать установленные копии байт-в-байт (иначе расхождение templates ↔ .qwen): `cp templates/qwen-commands/{spec,plan,code}.md .qwen/commands/vibelog/`.

### 5. src/mcp/tools.ts — приоритет из конфига
- Строки 81 и 153 (inputSchema `backlog_create_task` и `backlog_update_task`): `priority: { enum: ['High','Medium','Low'] }` → свободная строка с description «Приоритет (High/Medium/Low или значение из config.priorities)» — зеркало статуса «читаются из конфига». Сервер enum и так не валидирует (схема нигде не исполняется), снимаем enum, чтобы клиенты с валидацией не отвергали кастомные приоритеты.

### 6. Тесты — src/web/phase-prompt.test.mjs
- Строки 174/179: «12 подстановок» → 14 (`Object.keys(vars).length`, текст кейса).
- Новый describe «VL-184 — availableTypes/availablePriorities» (после VL-154, ~строка 278):
  - конфиг с types/priorities → значения через запятую;
  - конфиг без ключей types/priorities → `DEFAULT_TASK_TYPES` и `'High, Medium, Low'`;
  - битый YAML → дефолты (не исключение, как у labels в строке 265);
  - `phase-1.md` содержит `{{availableTypes}}` и `{{availablePriorities}}`; `renderPrompt('spec', …)` — без остатков литералов (шаблон проверки строк 271–276).

### 7. Документация
- CHANGELOG.md, `## [Unreleased] → ### Добавлено`: запись «**VL-184: Spec определяет type из config.types и priority из config.priorities** — …» по формату соседних записей.
- README.md, строка 256 (таблица «Команды Vibelog»): «Уточнить фичу и определить масштаб» → «Уточнить фичу, определить тип (из config types) и приоритет».

## Порядок действий

1. `src/web/phase-prompt.ts` (подстановки) → 2. `phase-1.md` (промпт Spec) → 3. `spec.md` → 4. шаблоны ниже по потоку (раздел 4) + `cp` в `.qwen/commands/vibelog/` → 5. `src/mcp/tools.ts` → 6. тесты → 7. сборка и прогоны → 8. CHANGELOG + README.

## Как проверить

```bash
pnpm build && pnpm test        # build + vitest (phase-prompt, skills, compat-full и др.)
grep -rn "type=task\|task или epic" templates/ .qwen/commands/   # ветвлений, игнорирующих не-epic, не остаётся
diff -r templates/qwen-commands/spec.md .qwen/commands/vibelog/spec.md  # и plan/code — пусто
node --input-type=module -e "import {renderPrompt} from './dist/web/phase-prompt.js'; const p = renderPrompt('spec','VL-1',{taskTitle:'t',taskType:'task',taskStatus:'Spec',taskDescription:'',taskPlan:'',taskAC:'(нет)',taskDoD:'(нет)',taskModifiedFiles:'(нет)',taskLastComment:'(нет)',taskReferences:'(нет)',taskLessons:'(нет)',availableLabels:'core',availableTypes:'bug, task',availablePriorities:'High, Medium, Low',comment:''}); if (p.includes('{{availableTypes}}')||p.includes('{{availablePriorities}}')) throw new Error('не подставлено'); console.log('ok')"
```

## Риски

1. **Кастомные types/priorities**: `normalizeTaskType` отклонит тип не из списка конфига — промпт ограничивает выбор списком «Доступные типы»; priority сервер не валидирует (enum снят) — опечатка запишется как есть (как status).
2. **Субъективность приоритета**: модель может поставить Medium неверно — в промпте правило «не додумывай при неполном описании»; поле остаётся пустым, это безопасно.
3. **Пропущенная формулировка ниже по потоку**: если где-то останется «Если type=task», агент Фазы Code может не понять, что делать с type=bug — страхует grep-чек из «Как проверить» по `templates/` и `.qwen/commands/`.
4. **Рассинхрон копий навыков**: `.qwen/commands/vibelog/*` живут отдельно от templates (skills.test.mjs сравнивает байт-в-байт только в testDir) — шаг `cp` обязателен.
5. **AC задачи пусты** (Spec отчитался про 3 AC, но поле acceptanceCriteria не записалось) — приёмка идёт по шагам этого плана; в Code отмечать их как AC задачи.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 15:39
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Определять тип задачи и приоритет в фазе spec». Масштаб: task. Уточнено: цель — расширить фазу spec: определять тип задачи из настроек проекта (не только task/epic, например Bug для явных ошибок) и по возможности устанавливать приоритет; добавлено 3 проверяемых AC. Labels: agent, core. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-25 19:08
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 16 файлов — подстановки availableTypes/availablePriorities в src/web/phase-prompt.ts (по образцу availableLabels из VL-154, один loadConfig на фазу), промпт Spec templates/qwen-commands/phase-1.md (блок «Доступные типы/Приоритеты», шаг классификации bug/docs/spike/chore/enhancement/feature/task + правила приоритета High/Medium/Low, type/priority в backlog_update_task и отчёте), интерактивный spec.md, ветвление «epic vs НЕ epic» в 6 шаблонах ниже по потоку (phase-2/3/close/close-worktree, plan, code) + синхрон cp копий в .qwen/commands/vibelog, снятие enum у priority в src/mcp/tools.ts (строки 81/153 — приоритеты из config.priorities), тесты phase-prompt.test.mjs (12→14 подстановок + новый describe VL-184), CHANGELOG + README. Проверка: pnpm build && pnpm test, grep-чек «type=task/task или epic» по templates/. Риски: кастомные типы валидируются normalizeTaskType (ограничение списком в промпте), субъективность приоритета (правило «не додумывать»), рассинхрон копий навыков (шаг cp). Замечание: AC в задаче пусты, хотя Spec отчитался о 3 добавленных — приёмка по шагам плана.
---
author: @agent
created: 2026-10-25 19:29
---
Фаза 3 (Code) выполнена. Изменено: 15 файлов, коммит 8cc562c (feat: VL-184 — Spec определяет тип задачи и приоритет из конфига проекта). Суть: (1) src/web/phase-prompt.ts — taskExtraVars даёт {{availableTypes}} (types из config, дефолт DEFAULT_TASK_TYPES) и {{availablePriorities}} (priorities из config, дефолт High/Medium/Low), один loadConfig на фазу вместо трёх IIFE; (2) templates/qwen-commands/phase-1.md — блок «Доступные типы/Приоритеты», шаг 4 классифицирует тип (bug/docs/spike/chore/enhancement/feature/task из списка конфига) и приоритет (High/Medium/Low, не додумывать при неполном описании), type/priority в backlog_update_task и в отчёте finish_phase; (3) spec.md — тип/приоритет из config.yml; (4) ветвление «epic vs НЕ epic» в phase-2/3/close/close-worktree, plan, code (все «Если type=task» → «type ≠ epic»), копии .qwen/commands/vibelog синхронизированы байт-в-байт; (5) src/mcp/tools.ts — снят enum у priority в схемах create/update (кастомные значения config.priorities). Проверки: pnpm build && pnpm test — 69 test files / 1197 тестов зелёные (в т.ч. +4 теста VL-184 в phase-prompt.test.mjs, счётчик подстановок 12→14); grep «type=task|task или epic» по templates/ и .qwen/commands/ — чисто; renderPrompt('spec',…) — без неподставленных {{availableTypes}}/{{availablePriorities}}. Что осталось: CHANGELOG.md в Фазе 3 не обновлял по регламенту (пишет Close), doc-6 не менялась; AC в задаче пусты — приёмка по шагам Implementation Plan.
---
author: @agent
created: 2026-10-25 19:40
---
Фаза Close выполнена. Ветка vb/vl-184 слита в master (1 коммит 8cc562c + merge), worktree удалена (untracked-симлинки node_modules/refs — через --force), ветка удалена. Проверки после merge: pnpm build + pnpm test — 69 test files / 1197 тестов зелёные. DoD: 1) Тесты проходят — весь набор зелёный (1190+7, 4 skipped); 2) Документация обновлена — CHANGELOG.md (запись VL-184 в Unreleased/Добавлено), README обновлён в Фазе 3; 3) Нет регрессий — grep «type=task|task или epic» по templates/ и .qwen/commands/ чист, build/test без падений. Уроки: lesson-31/32/33 созданы и связаны с задачей (коммит 81dc68e). Документация: коммит 2c95b74 (docs: VL-184 — документация и CHANGELOG). AC в задаче пусты — приёмка по шагам Implementation Plan (все выполнены).
---
<!-- COMMENTS:END -->