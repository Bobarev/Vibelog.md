---
id: VL-398
title: 'Конструктор кастомного workflow: персона workflow-designer + `vibelog workflow show/validate/apply` (+ read/write-доступ агенту) — чтобы в новом проекте workflow обсуждался и настраивался'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 23:56'
updated_date: '2026-11-16 16:02'
due_date: ''
labels:
  - workflow
  - personas
  - cli
  - mcp
  - onboarding
dependencies: []
milestone: v1.14
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow-config.ts
  - src/core/workflow-config.test.mjs
  - src/cli/commands/workflow.ts
  - src/cli/workflow-cli.test.mjs
  - src/mcp/workflow-tools.ts
  - src/mcp/workflow-tools.test.mjs
  - templates/prompts/personas/workflow-designer.md
  - src/core/workflow.ts
  - src/web/personas.ts
  - src/web/personas.test.mjs
  - web/src/components/chat/pickers.tsx
  - src/mcp/tools.ts
  - src/core/tool-kinds.ts
  - src/cli/router.ts
  - src/cli/command-registry.ts
  - src/cli/commands/doctor.ts
  - src/cli/commands/instructions.ts
  - src/core/capabilities.ts
  - scripts/npm-smoke.mjs
  - src/cli/diagnostics.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/core/compat-full.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
lessons:
  - lesson-276
token_usage:
  input: 38044963
  output: 137867
  cache: 35994112
  total: 38182830
  requests: 346
  duration_ms: 3532937
  reasoning: 62949
  by_phase:
    plan:
      input: 20663354
      output: 67125
      cache: 18964480
      requests: 186
    code:
      input: 15555480
      output: 61604
      cache: 15248384
      requests: 124
    close:
      input: 1826129
      output: 9138
      cache: 1781248
      requests: 36
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст и проблема

В новом проекте агент не смог обсудить с пользователем и собрать кастомный workflow. Всё для этого в системе **уже есть**, но нет связующего звена:

- кастомные статусы — `statuses` в `backlog/config.yml` (`defaultConfig()`, правится `vibelog config set statuses "To Do,Spec,..."`);
- кастомные переходы/фазы — секции `workflows` и `task_workflows` в `.vibelog/settings.json` (`src/core/workflow.ts:437` `loadWorkflows`, `DEFAULT_WORKFLOW` как fallback); схема и валидация есть;
- правила неполноты по фазам — `completeness` (`DEFAULT_COMPLETENESS`, `src/core/workflow.ts:96`, валидатор `validateCompleteness`, VL-370/VL-377);
- персоны — реестр `chat_personas` + `templates/prompts/personas/*.md` (`src/web/personas.ts`), роли уже умеют задавать `default_status`;
- шаблоны фаз — `templates/phases/*.md` с проектным переопределением `.vibelog/prompts/phases/` (`src/web/phase-prompt.ts:92`).

Чего нет:
1. **Роли/сценария «конструктор workflow»** — никто не ведёт разговор «расскажи про проект → вот подходящий workflow». Встроенные персоны: helper, architect, supervisor.
2. **CLI-точки работы с workflow** — в роутере нет команды `workflow` (только `config`, `doctor`). Посмотреть эффективный workflow (`дефолт из кода` vs `из settings`) и провалидировать новый нельзя, кроме косвенной диагностики `vibelog doctor`.
3. **MCP-инструмента для конфигурации** — среди инструментов (`src/mcp/tools.ts`) нет ни одного для `settings.json`/workflow: агент вынужден править файл через `write_file`/`edit` (с подтверждением), а валидацию результата увидеть неоткуда. Отсюда и исходный тупик: «пришли схему секции workflow» — схему негде взять машинно, кроме чтения исходников Vibelog, которых в новом проекте нет.

## Цель

Дать возможность в новом проекте пройти путь: обсудили проект → агент предложил workflow → применили → провалидировали → фазы работают.

## Что сделать (состав)

**A. Персона `workflow-designer`**
- Текст промпта: интервью по проекту (какие типы работ: фичи/баги/chore/исследования; нужен ли отдельный план; нужен ли review-шаг; один исполнитель или несколько), затем 2–3 варианта workflow с плюсами/минусами и рекомендацией, затем применение через инструмент/CLI.
- Регистрация: встроенная роль (`BUILTIN_PERSONAS`) или проектная через `chat_personas` — решить в плане (встроенная удобнее: доступна в любом проекте без настройки).

**B. CLI `vibelog workflow`**
- `workflow show [--json]` — эффективный workflow: имя, источник (дефолт в коде / settings.json), transitions, task_workflows, completeness.
- `workflow validate` — переходы: недостижимые статусы, статусы вне `config.statuses`, фазы без шаблона в `templates/phases`/`.vibelog/prompts/phases`, висячие ссылки `task_workflows`, ошибки `completeness` (переиспользовать `validateCompleteness` и проверки doctor).
- `workflow apply <file|->` — принять JSON/YAML-фрагмент, провалидировать ДО записи (ничего не писать при ошибке), записать в `.vibelog/settings.json` через `saveSettingsPatch` (сохраняя остальные ключи), поддержать `--sync-statuses`.
- `--dry-run` — показать, что будет записано.

**C. Доступ агента**
- MCP-инструмент `workflow_get` (read) + `workflow_apply` (write, с подтверждением) — предпочтительно, чтобы агент работал без shell и без `write_file` в конфиг;
- если решено не добавлять MCP-инструменты — явно зафиксировать в плане, что путь «CLI через shell + write_file» достаточен, и описать его в промпте персоны.

**D. Связки**
- `vibelog capabilities` (VL-394) и `instructions workflow` (VL-396) ссылаются на конструктор.
- `vibelog doctor` использует те же проверки, что `workflow validate` (без дублирования логики).

## Границы

- Никаких внешних рантаймов (Node.js only).
- README не расширять (лимит 150 строк, тест `src/web/readme-standard.test.mjs`).
- Существующий `DEFAULT_WORKFLOW` не менять — конструктор только про добавление/переопределение.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Есть персона `workflow-designer` (templates/prompts/personas/workflow-designer.md + запись в BUILTIN_PERSONAS, либо проектная роль через `chat_personas`): ведёт интервью по проекту (типы работ, нужны ли review/планирование, кто исполнители) и предлагает 2–3 варианта workflow с обоснованием, не навязывая дефолт
- [x] #2 Есть CLI: `vibelog workflow show` (текущий эффективный workflow с пометкой «дефолт из кода» или «из settings.json: <имя>»), `vibelog workflow validate` (диагностика transitions: недостижимые статусы, статусы вне config.statuses, фазы без шаблона, висячие ссылки task_workflows, ошибки completeness — переиспользовать validateCompleteness и логику doctor), `vibelog workflow apply <file|->` (запись секций workflows/task_workflows/completeness в .vibelog/settings.json с валидацией ДО записи и отказом при ошибках)
- [x] #3 MCP-инструмент для конфигурации workflow (read — `workflow_get`, write — `workflow_apply` с подтверждением) ИЛИ документированное решение «конфиг через CLI/write_file», зафиксированное в описании задачи явно (выбор обосновать в плане фазы)
- [x] #4 apply синхронизирует статусы: если в transitions встречается статус, отсутствующий в backlog/config.yml statuses — предупреждение с предложением дополнить список (или флаг --sync-statuses)
- [x] #5 Идемпотентность и безопасность: повторный apply того же файла не меняет settings.json (noop), битый/невалидный вход не пишет ничего, текущий settings.json сохраняется (ошибка чтения не затирает файл)
- [x] #6 Сквозной сценарий проверен тестом: пустой проект (mkdtemp) → apply workflow с фазами spec→code и статусами To Do/Spec/In Progress/Done → `vibelog workflow show` отражает применённое → `backlog_trigger_phase`/getAvailablePhases дают правильные фазы из новых статусов
- [x] #7 В `vibelog capabilities` (VL-394) и `vibelog instructions workflow` (VL-396) добавлена отсылка к конструктору как рекомендованному пути настройки
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решения фазы Plan

**A. Персона — встроенная** (`BUILTIN_PERSONAS` + `templates/prompts/personas/workflow-designer.md`). Причина: встроенная роль доступна в любом проекте без настройки (`src/web/personas.ts:84` — реестр работает без секции `chat_personas`), а проектная роль требовала бы правки `settings.json` — ровно того, что задача и хочет упростить. `default_status: 'Spec'` (как у helper/supervisor).

**C. MCP-инструменты добавляем** (`workflow_get` read + `workflow_apply` write), а не «CLI через shell + write_file». Причина: исходный тупик задачи — агент в новом проекте не может ни получить схему, ни провалидировать результат; `write_file` в `.vibelog/settings.json` требует подтверждения и не даёт валидации. Инструменты — тонкие обёртки над ядром (как `src/mcp/supervisor.ts` над `src/web/supervisor.ts`), подтверждение даёт существующий approval-gate по `TOOL_KINDS` (`src/core/tool-kinds.ts:32`).

**Ядро — новый модуль `src/core/workflow-config.ts`** (не расширяем `workflow.ts`: там 914 строк и «единственный источник истины» для исполнения; конфигуратор — отдельный домен, как supervisor). CLI и MCP делят одну генерацию — дублирования логики нет (паттерн `capabilities`/`map`).

---

## Файлы и порядок действий

### Шаг 1. Ядро: `src/core/workflow-config.ts` (новый, ~260 строк)

Экспорты:

1. `describeWorkflow(cwd): WorkflowDescription` — эффективный workflow:
   - `name: 'default'`, `source: 'default-in-code' | 'settings'` — сравнение по ссылке, как в `src/core/capabilities.ts:271-290` (`workflow === DEFAULT_WORKFLOW`);
   - `initial_status`, `transitions`, `task_workflows` (`loadWorkflows`, `src/core/workflow.ts:437`), `completeness` (`loadCompleteness`, `:511`), `statuses` из `backlog/config.yml` (`loadConfig`, `src/core/config.ts:89`, в try/catch — `loadConfig` бросает при отсутствии `backlog/`).
2. `validateWorkflowConfig(cwd): WorkflowFinding[]` — `{kind, path, message, severity: 'error'|'warning'}`:
   - `statuses`: статус из `transitions[].status`/`produces_status`/`initial_status` отсутствует в `config.statuses` → warning с подсказкой `--sync-statuses`;
   - `unreachable`: статус встречается только как `status` перехода, но не `initial_status` и не `produces_status` ни одного перехода → warning «недостижим»;
   - `phase`: `t.phase !== null` и фаза не в `PHASES` (`src/web/phase-prompt.ts:32`) → error; фаза в `PHASES`, но `loadPhaseTemplate(phase, {cwd})` (`:100`) бросает → error «нет шаблона»;
   - `task_workflow` / `completeness`: **переиспользуем** `validateCompleteness(cwd)` (`src/core/workflow.ts:239`) — она уже даёт висячие ссылки `task_workflows` и ошибки `completeness`; маппим её `CompletenessWarning` в `WorkflowFinding` (kind сохраняем, severity `warning`). Дублирования логики нет — это требование AC2/D.
3. `applyWorkflowConfig(cwd, patch, opts): ApplyResult` — `opts: {dryRun?: boolean; syncStatuses?: boolean}`:
   - принимает объект с ключами `workflows` / `task_workflows` / `completeness` (остальные ключи — в `skipped` с причиной);
   - **валидация ДО записи**: `isValidWorkflow`-совместимая проверка формы (не экспортируется — продублировать локально по образцу `src/core/workflow.ts:404-425` ИЛИ экспортировать `isValidWorkflow` из `workflow.ts`; выбираю **экспорт** `isValidWorkflow` — одна правка строки `function` → `export function`, дрейф исключён) + `validateWorkflowConfig` на «виртуальном» settings (временный объект, без записи) → при `severity: 'error'` **ничего не пишем**, возвращаем `{ok:false, errors}`;
   - **безопасность чтения** (AC5): если `.vibelog/settings.json` существует, но `JSON.parse` падает — отказ «файл не читается, запись отменена» (иначе `loadSettings` вернёт `{}` и `saveSettingsPatch` затрёт файл);
   - **идемпотентность** (AC5): сравнить `JSON.stringify` нормализованных секций с текущими (`loadSettings`) → совпало → `{ok:true, noop:true}`, файл не трогаем;
   - запись — `saveSettingsPatch(cwd, patch)` (`src/core/settings.ts:197`, read-modify-write: чужие ключи целы);
   - `syncStatuses`: статусы из `transitions` (+ `initial_status`), отсутствующие в `config.statuses`, дописываются в конец и `saveConfig` (`src/core/config.ts:137`); без флага — только warning в результате;
   - `dryRun`: возвращает `{wouldWrite: patch, noop}` без записи.
4. `parseWorkflowInput(text): {patch} | {error}` — JSON (`JSON.parse`) либо YAML (`parseYaml`, `src/core/yaml.ts:30`) по эвристике «первый непробельный символ `{` → JSON».

### Шаг 2. CLI: `src/cli/commands/workflow.ts` (новый, ~150 строк)

`runWorkflow(subcommand, positional, flags, cwd)`:
- `show [--json]` — `describeWorkflow`; human-вывод: имя, источник («дефолт из кода (DEFAULT_WORKFLOW)» / «из settings.json: default»), `initial_status`, переходы строками `To Do --spec--> Spec` (формат как `src/cli/commands/instructions.ts:157-160`), `task_workflows`, `completeness`; `--json` → `{schemaVersion:1, kind:'workflow', data}` (форма как `vibelog map`, `src/cli/commands/map.ts:57-70`);
- `validate [--json]` — `validateWorkflowConfig`; exit code 1 при наличии `error` (warning — не роняет, как `completeness_config` в doctor, `src/cli/commands/doctor.ts:681-700`);
- `apply <file|-> [--dry-run] [--sync-statuses]` — читает файл или stdin (`readFileSync(0,'utf-8')` при `-`), `parseWorkflowInput` → `applyWorkflowConfig`; печатает applied/skipped/warnings; при ошибке — `printError` + exit 1, файл не тронут.

Регистрация:
- `src/cli/router.ts` — импорт + `case 'workflow': return runWorkflow(subcommand, positional, flags, cwd);` (рядом с `case 'config'`, `:149`); **склейка `[subcommand, ...positional]` не нужна** — подкоманда передаётся отдельным аргументом (lesson-275: subcommand и positional передаются вместе);
- `src/cli/router.ts#showHelp` — строка `workflow show|validate|apply` в блоке команд (после `config`);
- `src/cli/command-registry.ts:35` — запись `{ name: 'workflow', summary: 'Workflow проекта: show (эффективная схема), validate (диагностика), apply (запись в settings.json)' }` (иначе `capabilities` не покажет команду — AC7).

### Шаг 3. MCP: `src/mcp/workflow-tools.ts` (новый, ~180 строк)

По образцу `src/mcp/supervisor.ts` (отдельный домен, `tools.ts` только подключает):
- `WORKFLOW_TOOL_DEFS: ToolDefinition[]` — `workflow_get` (read, без аргументов) и `workflow_apply` (write: `patch` — объект, `dryRun?`, `syncStatuses?`, `idempotencyKey?`);
- `handleWorkflowTool(name, args, cwd): Promise<string>` — ответы через `ackOk`/`ackNoop`/`ackError` (`src/mcp/tool-result.ts:210/287/531`), JSON-ack обязателен (контракт VL-306/VL-351);
- `workflow_get` → `ackRead`-подобный ответ с `describeWorkflow` + `validateWorkflowConfig` (агент видит и схему, и проблемы одним вызовом).

Регистрация:
- `src/mcp/tools.ts:149` (`listTools`) — `...WORKFLOW_TOOL_DEFS` рядом с `...SUPERVISOR_TOOL_DEFS`; `:941` (`handleToolCall`) — `case 'workflow_get': case 'workflow_apply': return handleWorkflowTool(name, args, cwd);`
- `src/core/tool-kinds.ts:32` — `workflow_get: 'read'`, `workflow_apply: 'write'` (иначе тест паритета `src/core/tool-classify.test.mjs` упадёт);
- `src/cli/commands/doctor.ts:270` (`MCP_TOOL_PREFIXES`) — добавить `'workflow_'` (иначе `mcp_tools_invariants` красный: имена вне политики префиксов);
- `src/cli/commands/instructions.ts:71` (`MCP_GROUPS`) — новая группа «Workflow (конструктор)» с двумя именами (иначе попадут в «прочее»; тест «в MCP_GROUPS нет протухших имён» не ломается);
- `src/cli/diagnostics.test.mjs:38` (`EXPECTED_MCP_TOOLS`) — добавить `workflow_apply`, `workflow_get`;
- `src/mcp/write-ack-contract.test.mjs` — `ACK_SCENARIOS.workflow_apply` (вызов с валидным патчем на mkdtemp-проекте, ответ JSON с `ok`).

### Шаг 4. Персона

- `templates/prompts/personas/workflow-designer.md` (новый, ~60 строк): интервью (типы работ: фичи/баги/chore/исследования; нужен ли отдельный план; нужен ли review-шаг; один исполнитель или несколько) → 2–3 варианта workflow с плюсами/минусами и рекомендацией → применение через `workflow_apply` (или `vibelog workflow apply`), затем `workflow validate`; явный запрет навязывать дефолт и менять `DEFAULT_WORKFLOW` в коде.
- `src/web/personas.ts:84` — запись `{ id: 'workflow-designer', label: 'Конструктор workflow', description: 'Обсуждает проект и собирает кастомный workflow', prompt: 'workflow-designer', defaultStatus: 'Spec' }`.
- `web/src/components/chat/pickers.tsx:64` — `'workflow-designer': Workflow` в `PERSONA_ICONS` **вместе с импортом** `Workflow` из `lucide-react` (иначе lint фронта падает на unused import — lesson-132).
- `scripts/npm-smoke.mjs:166` — добавить `'workflow-designer'` в список шаблонов ролей.
- `src/web/personas.test.mjs` — обновить 7 мест со списками ролей (`:81, :88, :134, :257, :288, :313, :329`): `BUILTIN_PERSONAS.length` 3 → 4, списки `['helper','architect','supervisor']` → `+ 'workflow-designer'` (порядок: встроенные как объявлены, новая — последней).

### Шаг 5. Связки (D)

- `src/core/capabilities.ts:219` (`NEXT_STEPS`) — строка «Свой workflow: обсуди с ролью `workflow-designer` в веб-чате или собери через `vibelog workflow apply`; проверка — `vibelog workflow validate`»;
- `src/core/capabilities.ts:144` (`SETTINGS_KEYS`) — у ключей `workflows`/`task_workflows`/`completeness` дописать в summary «правится `vibelog workflow apply`» (правка существующих строк, не новых);
- `src/cli/commands/instructions.ts` — в `workflowTopic` (`:259`) блок «Как настроить свой workflow»: роль `workflow-designer`, `vibelog workflow show|validate|apply`, `--sync-statuses`; в `overviewTopic` (`:209`) — одна строка в «Куда смотреть дальше»;
- `src/cli/commands/doctor.ts` — **не дублировать**: `checkCompletenessConfig` (`:681`) остаётся, но `workflow validate` использует тот же `validateCompleteness`; в hint проверки добавить «подробнее: `vibelog workflow validate`».

### Шаг 6. Тесты (новые файлы)

- `src/core/workflow-config.test.mjs` — `describeWorkflow` (дефолт vs settings), `validateWorkflowConfig` (статус вне config.statuses, недостижимый статус, фаза без шаблона, висячая ссылка `task_workflows`), `applyWorkflowConfig`: noop при повторе, отказ при битом входе (файл не изменён), отказ при нечитаемом settings.json (файл не затёрт), `dryRun` ничего не пишет, `syncStatuses` дополняет `config.statuses`;
- `src/cli/workflow-cli.test.mjs` — **сквозной сценарий AC6**: mkdtemp-проект (`backlog/config.yml` со статусами `To Do/Spec/In Progress/Done`) → `runWorkflow('apply', [file])` с workflow `To Do --spec--> Spec --code--> In Progress --close--> Done` → `runWorkflow('show')` отражает применённое и источник `settings` → `getWorkflowForTask`/`getAvailablePhases` дают `['spec']` из `To Do` и `['code']` из `Spec`; плюс `validate` на битом конфиге → exit code 1;
- `src/mcp/workflow-tools.test.mjs` — регистрация в `listTools`, схемы (`properties`/`required`), `workflow_get` отдаёт схему, `workflow_apply` пишет и повтор даёт `noop`, невалидный патч → `{ok:false}` без записи.

### Шаг 7. Документация (DoD «Документация обновлена»)

- `backlog/docs/doc-7` (CLI-справочник) — раздел `## workflow` после `## config` (`:438`): show/validate/apply, флаги, коды выхода;
- `backlog/docs/doc-8` (MCP-справочник) — раздел «Workflow (конструктор)» с `workflow_get`/`workflow_apply`;
- `backlog/docs/doc-30` (фазовый процесс) — в §3 «Свой workflow в settings.json» (`:65`) подраздел «Конструктор: роль `workflow-designer` и `vibelog workflow`»;
- `README.md` — **не расширять** (лимит 150 строк, `src/web/readme-standard.test.mjs`); если в README есть перечень ролей — правка существующей строки (проверить первым шагом Code).

---

## Как проверить

```bash
pnpm build && pnpm test:fast          # быстрый цикл
pnpm test                             # полный прогон перед DoD (обязателен)
node bin/vibelog.mjs workflow show    # в этом проекте: источник default-in-code
node bin/vibelog.mjs workflow validate
node bin/vibelog.mjs capabilities | head -40   # команда и инструменты видны
node bin/vibelog.mjs doctor --json | grep -E 'mcp_tools_invariants|completeness_config'
```

## Риски

1. **Размер `capabilities` markdown** — тест `src/cli/capabilities-cli.test.mjs:96` держит потолок 12 000 байт; добавление CLI-команды, двух MCP-инструментов и строки `NEXT_STEPS` может приблизить к лимиту. Мера: `NEXT_STEPS` — одна строка, summary команды короткий; при превышении — сократить существующие summary (не удалять секции).
2. **Пять тестов-инвариантов реестров** падают при пропуске любой регистрации: `tool-classify.test.mjs` (TOOL_KINDS), `write-ack-contract.test.mjs` (ACK_SCENARIOS), `diagnostics.test.mjs` (EXPECTED_MCP_TOOLS), `instructions-cli.test.mjs` (MCP_GROUPS), `capabilities-cli.test.mjs` (CLI_COMMANDS). Все пять правок — в шагах 2–3.
3. **`personas.test.mjs`** — 7 мест с жёсткими списками ролей; пропуск любого = красный прогон.
4. **`loadConfig` бросает** при отсутствии `backlog/` — все вызовы в ядре оборачиваем в try/catch (иначе `workflow show` в пустом каталоге упадёт; `capabilities` в пустом каталоге работает — `src/cli/capabilities-cli.test.mjs:196`).
5. **Затирание settings.json** при битом JSON — закрыто явной проверкой чтения до записи (AC5).
6. **`isValidWorkflow` экспорт** — правка `function` → `export function` в `src/core/workflow.ts:404`; проверить, что нет второго объявления с тем же именем.

---

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `DEFAULT_WORKFLOW` — 13 переходов, `initial_status: 'To Do'` | `src/core/workflow.ts:381-400` |
| `loadWorkflows` падает в `DEFAULT_WORKFLOW` при отсутствии/битом ключе, сравнение источника — по ссылке | `src/core/workflow.ts:437-462`; `src/core/capabilities.ts:271-290` |
| `loadCompleteness` мержит `DEFAULT_COMPLETENESS` с валидными записями settings | `src/core/workflow.ts:511-525` |
| `validateCompleteness` уже проверяет висячие `task_workflows`, имена workflow/фаз/сущностей/полей | `src/core/workflow.ts:239-380` |
| `getAvailablePhases(workflow, status)` — чистая функция, фильтр по `t.status === currentStatus && t.phase !== null` | `src/core/workflow.ts:589-595` |
| `getWorkflowForTask` берёт `task_workflows[type]` → `default` | `src/core/workflow.ts:478-486` |
| `saveSettingsPatch` — read-modify-write, `undefined` удаляет ключ, чужие ключи целы | `src/core/settings.ts:197-205` |
| `loadSettings` при битом JSON возвращает `{}` (значит запись затрёт файл — нужна явная проверка) | `src/core/settings.ts:50-66` |
| `settingsPath` = `<cwd>/.vibelog/settings.json` | `src/core/settings.ts:39-41` |
| `loadConfig` бросает «Backlog-директория не найдена» | `src/core/config.ts:89-99` |
| `saveConfig` пишет YAML через `stringifyYaml` | `src/core/config.ts:137-146`; `src/core/yaml.ts:247` |
| `parseYaml` экспортируется | `src/core/yaml.ts:30` |
| `PHASES` — 11 фаз; `loadPhaseTemplate` бросает на неизвестной фазе и на отсутствии шаблона | `src/web/phase-prompt.ts:32-46, 100-124` |
| `PROJECT_PROMPTS_DIR` = `.vibelog/prompts/phases` | `src/web/phase-prompt.ts:76` |
| `BUILTIN_PERSONAS` — helper/architect/supervisor, `defaultStatus` задаётся полем | `src/web/personas.ts:84-107` |
| `loadPersonas` сливает встроенные с `chat_personas`, порядок встроенных сохраняется | `src/web/personas.ts:138-200` |
| `loadPersonaPrompt` — проектное переопределение → встроенный шаблон, fail-closed | `src/web/personas.ts:298-313` |
| `PERSONA_ICONS` в пикере, неизвестная роль → `Bot` | `web/src/components/chat/pickers.tsx:64-77` |
| `npm-smoke` перечисляет шаблоны ролей литерально | `scripts/npm-smoke.mjs:166` |
| `personas.test.mjs` жёстко ждёт 3 встроенные роли в 7 местах | `src/web/personas.test.mjs:81,88,134,257,288,313,329` |
| `listTools()` — литеральный массив, `SUPERVISOR_TOOL_DEFS` подключается спредом | `src/mcp/tools.ts:149, 920` |
| `handleToolCall` — switch по имени, supervisor-ветки отдельным case | `src/mcp/tools.ts:941, 1065-1070` |
| `TOOL_KINDS` — таблица вид→инструмент, тест паритета с `listTools()` | `src/core/tool-kinds.ts:32-96`; `src/core/tool-classify.test.mjs:26-33` |
| `MCP_TOOL_PREFIXES` — политика префиксов, чужое имя = красный doctor | `src/cli/commands/doctor.ts:270-282, 300-320` |
| `checkCompletenessConfig` использует `validateCompleteness`, не входит в `requiredNames` | `src/cli/commands/doctor.ts:681-700, 110` |
| `MCP_GROUPS` — литеральные группы, незнакомое имя уходит в «прочее» | `src/cli/commands/instructions.ts:71-125, 138-153` |
| `EXPECTED_MCP_TOOLS` — фикстура теста doctor | `src/cli/diagnostics.test.mjs:38-80` |
| `ACK_SCENARIOS`/`ACK_OUT_OF_SCOPE` — покрытие write-инструментов JSON-ack | `src/mcp/write-ack-contract.test.mjs:215-340` |
| `ackOk`/`ackNoop`/`ackError` — JSON-ack хелперы | `src/mcp/tool-result.ts:210, 287, 531` |
| `CLI_COMMANDS` — реестр команд для `capabilities` | `src/cli/command-registry.ts:35-65` |
| Роутер: `case 'config'` на `:149`, `capabilities` `:107`, `instructions` `:109` | `src/cli/router.ts:107-150` |
| `capabilities` markdown ограничен 12 000 байт тестом | `src/cli/capabilities-cli.test.mjs:96-100` |
| `NEXT_STEPS`/`SETTINGS_KEYS` — литеральные списки в `capabilities.ts` | `src/core/capabilities.ts:144-230` |
| `buildInstructions` собирает темы, `workflowTopic` на `:259` | `src/cli/commands/instructions.ts:259, 481-490` |
| `parseArgs` кладёт первый позиционный в `subcommand` | `src/cli/args.ts:38-70` |
| `map`/`capabilities` — тонкие обёртки над ядром, `--json` = `{schemaVersion, kind, data}` | `src/cli/commands/map.ts:57-70`; `src/cli/commands/capabilities.ts:36-46` |
| `core` уже импортирует `web/phase-prompt` (импорт core→web допустим) | `src/core/capabilities.ts:28` |

## Не проверено (предположения)

1. **`isValidWorkflow` не экспортируется** — предполагаю, что объявление одно (`src/core/workflow.ts:404`). Проверить: `grep -n "isValidWorkflow" src/`. При расхождении — не экспортировать, а продублировать проверку формы локально в `workflow-config.ts` с комментарием-ссылкой.
2. **README содержит перечень ролей** — предполагаю, что да (lesson-132 упоминает §«Роли ассистента»). Проверить: `grep -n "helper\|architect\|supervisor" README.md`. Если есть — правка существующей строки (лимит 150 строк не нарушать); если нет — README не трогать.
3. **`ackRead` пригоден для `workflow_get`** — предполагаю, что хелпер чтения внутри write-инструмента (`src/mcp/tool-result.ts`, ветка `read: true`) подходит и для отдельного read-инструмента. Проверить чтением `tool-result.ts` вокруг `ackRead`. При несоответствии — `ackOk` с `applied` (read-инструменту JSON-ack не обязателен по контракту, но единообразие лучше).
4. **`withIdempotency` не нужен `workflow_apply`** — предполагаю, что noop-сравнения содержимого достаточно (AC5 формулирует идемпотентность как «повтор того же файла не меняет settings.json»). Проверить: `src/mcp/idempotency.ts` — если обёртка тривиальна, добавить `idempotencyKey` в схему и обернуть (как `backlog_update_task`).
5. **`lucide-react` содержит иконку `Workflow`** — предполагаю, что да (стандартный набор). Проверить: `grep -rn "Workflow" web/node_modules/lucide-react/dist/lucide-react.d.ts | head -3` или `grep -n "Workflow" web/src/components/chat/pickers.tsx`. При отсутствии — взять `GitBranch`/`Settings2`.
6. **`readFileSync(0, 'utf-8')` работает для stdin в этом окружении** — предполагаю, что да (Node 20, синхронное чтение fd 0). Проверить прогоном `echo '{}' | node bin/vibelog.mjs workflow apply - --dry-run`. При проблеме — `readFileSync('/dev/stdin')` (macOS) с fallback.
7. **Порядок встроенных ролей в тестах** — предполагаю, что новая роль добавляется последней (после `supervisor`), т.к. `loadPersonas` сохраняет порядок объявления (`src/web/personas.ts:141`). Проверить прогоном `personas.test.mjs` после правки.
8. **`workflow validate` не должен ломать `doctor`** — предполагаю, что общий `validateCompleteness` вызывается дважды независимо и побочных эффектов нет (функция только читает). Проверить: `grep -n "writeFileSync\|saveSettings" src/core/workflow.ts` — ожидается пусто.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 02:50
---
Фаза plan не удалась (код выхода 1): окировок=0, payload последнего запроса=400752 байт (макс 713213), usage={"input_tokens":5807709,"output_tokens":17716,"cache_read_input_tokens":5104640,"total_tokens":5825425,"reasoning_tokens":12936} — статус возвращён к Spec.
---
author: @agent
created: 2026-11-10 02:51
---
Фаза plan не удалась (код выхода 1): 2, блокировок=0, payload последнего запроса=469552 байт (макс 469552), usage={"input_tokens":947085,"output_tokens":3074,"cache_read_input_tokens":813056,"total_tokens":950159,"reasoning_tokens":1721} — статус возвращён к Spec.
---
author: @agent
created: 2026-11-10 08:18
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в задачу.
**Решения:**
- Персона `workflow-designer` — встроенная (`BUILTIN_PERSONAS` + `templates/prompts/personas/workflow-designer.md`): доступна в любом проекте без настройки, что и есть цель задачи.
- MCP-инструменты добавляем (`workflow_get` read + `workflow_apply` write) — обосновано в плане: исходный тупик в том, что агент не может ни получить схему, ни провалидировать результат; `write_file` в settings.json требует подтверждения и не даёт валидации.
- Ядро — новый модуль `src/core/workflow-config.ts` (не расширяем `workflow.ts` на 914 строк): `describeWorkflow` / `validateWorkflowConfig` / `applyWorkflowConfig` / `parseWorkflowInput`; CLI и MCP — тонкие обёртки над ним, дублирования логики нет.
- `validateWorkflowConfig` переиспользует `validateCompleteness` (src/core/workflow.ts:239) и `loadPhaseTemplate` — требование AC2/D «без дублирования логики doctor».
**Объём:** 6 новых файлов (ядро, CLI-команда, MCP-модуль, шаблон персоны, 3 тест-файла) + правки в 12 существующих (router, command-registry, tools.ts, tool-kinds, doctor, instructions, capabilities, personas, pickers.tsx, npm-smoke, personas.test, diagnostics.test, write-ack-contract.test) + документация doc-7/doc-8/doc-30.
**Риски:** (1) потолок 12 000 байт markdown `capabilities` (тест capabilities-cli.test.mjs:96) — добавление команды, двух инструментов и строки NEXT_STEPS может приблизить к лимиту; (2) пять тестов-инвариантов реестров падают при пропуске любой регистрации (tool-classify, write-ack-contract, diagnostics, instructions-cli, capabilities-cli); (3) `personas.test.mjs` жёстко ждёт 3 встроенные роли в 7 местах; (4) `loadConfig` бросает без `backlog/` — все вызовы в try/catch; (5) затирание settings.json при битом JSON — закрыто явной проверкой чтения до записи (AC5).
План содержит обязательные разделы «Проверено по коду» (39 утверждений с файл:строка) и «Не проверено (предположения)» (8 пунктов с планом проверки первым шагом Code).
---
author: @agent
created: 2026-11-10 08:34
---
Фаза code не удалась (код выхода 1): локировок=0, payload последнего запроса=686675 байт (макс 686675), usage={"input_tokens":9906103,"output_tokens":37148,"cache_read_input_tokens":9756672,"total_tokens":9943251,"reasoning_tokens":9390} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 08:49
---
Фаза 3 (Code) выполнена. Коммит 6e1832e.
**Новые файлы:**
- `src/core/workflow-config.ts` — ядро конструктора: `describeWorkflow` (эффективная схема + источник по ссылке на DEFAULT_WORKFLOW), `validateWorkflowConfig` (статусы вне config.statuses, недостижимые статусы, фазы без шаблона, + переиспользован `validateCompleteness` для task_workflows/completeness), `applyWorkflowConfig` (валидация ДО записи, noop по каноническому JSON, отказ при битом settings.json, dryRun, syncStatuses), `parseWorkflowInput` (JSON/YAML).
- `src/cli/commands/workflow.ts` — `vibelog workflow show|validate|apply` (+ `--json`, `--dry-run`, `--sync-statuses`; exit code 1 при ошибках валидации).
- `src/mcp/workflow-tools.ts` — `workflow_get` (read) + `workflow_apply` (write), JSON-ack через ackRead/ackOk/ackNoop/ackError.
- `templates/prompts/personas/workflow-designer.md` — промпт роли: интервью → 2–3 варианта с обоснованием → применение → проверка.
- Тесты: `src/core/workflow-config.test.mjs` (24), `src/cli/workflow-cli.test.mjs` (12, включая сквозной AC6), `src/mcp/workflow-tools.test.mjs` (11).
**Правки:** `src/core/workflow.ts` (экспорт `isValidWorkflow`, опциональный `settingsOverride` у `loadWorkflows`/`validateCompleteness` — для валидации патча без записи), `src/web/personas.ts` (встроенная роль `workflow-designer`), `web/src/components/chat/pickers.tsx` (иконка Workflow + импорт), `src/mcp/tools.ts` (регистрация), `src/core/tool-kinds.ts` (read/write), `src/cli/router.ts` + `command-registry.ts` (команда), `src/cli/commands/doctor.ts` (префикс `workflow_`, hint на `workflow validate`), `src/cli/commands/instructions.ts` (группа MCP + раздел «Как настроить свой workflow»), `src/core/capabilities.ts` (NEXT_STEPS + summary ключей), `scripts/npm-smoke.mjs`, тесты-инварианты (`diagnostics`, `write-ack-contract`, `personas`, `compat-full`, `documents`, `reference-tools`, `server` — счётчик инструментов 49→51).
**Проверки:** `pnpm build` — чисто; полный `pnpm test` — 209 файлов, все passed (4057 тестов, 4 skipped — предсуществующие). Ручная проверка: `vibelog workflow show` печатает дефолт из кода, `workflow validate` — 0 ошибок, `capabilities` — 9933 байта (лимит 12000).
**Отклонение от плана:** проверка «недостижимый статус» не срабатывает для статусов, объявленных в `config.statuses` (например `In Progress` в DEFAULT_WORKFLOW — в него переводят вручную). Без этого правила дефолтный workflow давал бы ложные предупреждения; поведение закреплено тестом.
**Что осталось:** документация (doc-7 CLI, doc-8 MCP, doc-30 фазовый процесс) — по правилам фазы Code документы пишет Close.
---
author: @agent
created: 2026-11-10 08:49
---
Фаза 3 (Code) выполнена. Коммит 6e1832e.
**Новые файлы:**
- `src/core/workflow-config.ts` — ядро конструктора: `describeWorkflow` (эффективная схема + источник по ссылке на DEFAULT_WORKFLOW), `validateWorkflowConfig` (статусы вне config.statuses, недостижимые статусы, фазы без шаблона, + переиспользован `validateCompleteness` для task_workflows/completeness), `applyWorkflowConfig` (валидация ДО записи, noop по каноническому JSON, отказ при битом settings.json, dryRun, syncStatuses), `parseWorkflowInput` (JSON/YAML).
- `src/cli/commands/workflow.ts` — `vibelog workflow show|validate|apply` (+ `--json`, `--dry-run`, `--sync-statuses`; exit code 1 при ошибках валидации).
- `src/mcp/workflow-tools.ts` — `workflow_get` (read) + `workflow_apply` (write), JSON-ack через ackRead/ackOk/ackNoop/ackError.
- `templates/prompts/personas/workflow-designer.md` — промпт роли: интервью → 2–3 варианта с обоснованием → применение → проверка.
- Тесты: `src/core/workflow-config.test.mjs` (24), `src/cli/workflow-cli.test.mjs` (12, включая сквозной AC6), `src/mcp/workflow-tools.test.mjs` (11).
**Правки:** `src/core/workflow.ts` (экспорт `isValidWorkflow`, опциональный `settingsOverride` у `loadWorkflows`/`validateCompleteness` — для валидации патча без записи), `src/web/personas.ts` (встроенная роль `workflow-designer`), `web/src/components/chat/pickers.tsx` (иконка Workflow + импорт), `src/mcp/tools.ts` (регистрация), `src/core/tool-kinds.ts` (read/write), `src/cli/router.ts` + `command-registry.ts` (команда), `src/cli/commands/doctor.ts` (префикс `workflow_`, hint на `workflow validate`), `src/cli/commands/instructions.ts` (группа MCP + раздел «Как настроить свой workflow»), `src/core/capabilities.ts` (NEXT_STEPS + summary ключей), `scripts/npm-smoke.mjs`, тесты-инварианты (`diagnostics`, `write-ack-contract`, `personas`, `compat-full`, `documents`, `reference-tools`, `server` — счётчик инструментов 49→51).
**Проверки:** `pnpm build` — чисто; полный `pnpm test` — 209 файлов, все passed (4057 тестов, 4 skipped — предсуществующие). Ручная проверка: `vibelog workflow show` печатает дефолт из кода, `workflow validate` — 0 ошибок, `capabilities` — 9933 байта (лимит 12000).
**Отклонение от плана:** проверка «недостижимый статус» не срабатывает для статусов, объявленных в `config.statuses` (например `In Progress` в DEFAULT_WORKFLOW — в него переводят вручную). Без этого правила дефолтный workflow давал бы ложные предупреждения; поведение закреплено тестом.
**Что осталось:** документация (doc-7 CLI, doc-8 MCP, doc-30 фазовый процесс) — по правилам фазы Code документы пишет Close.
---
author: @agent
created: 2026-11-10 08:53
---
Фаза 3 (Code) выполнена. Коммит 6e1832e (ветка vb/vl-398).
**Новые файлы:**
- `src/core/workflow-config.ts` — ядро конструктора: `describeWorkflow` (эффективная схема + источник по ссылке на DEFAULT_WORKFLOW), `validateWorkflowConfig` (статусы вне config.statuses, недостижимые статусы, фазы без шаблона, + переиспользован `validateCompleteness` для task_workflows/completeness), `applyWorkflowConfig` (валидация ДО записи, noop по каноническому JSON, отказ при битом settings.json, dryRun, syncStatuses), `parseWorkflowInput` (JSON/YAML).
- `src/cli/commands/workflow.ts` — `vibelog workflow show|validate|apply` (+ `--json`, `--dry-run`, `--sync-statuses`; exit code 1 при ошибках валидации).
- `src/mcp/workflow-tools.ts` — `workflow_get` (read) + `workflow_apply` (write), JSON-ack через ackRead/ackOk/ackNoop/ackError.
- `templates/prompts/personas/workflow-designer.md` — промпт роли: интервью → 2–3 варианта с обоснованием → применение → проверка.
- Тесты: `src/core/workflow-config.test.mjs` (24), `src/cli/workflow-cli.test.mjs` (12, включая сквозной AC6), `src/mcp/workflow-tools.test.mjs` (11).
**Правки:** `src/core/workflow.ts` (экспорт `isValidWorkflow`, опциональный `settingsOverride` у `loadWorkflows`/`validateCompleteness` — валидация патча без записи), `src/web/personas.ts` (встроенная роль `workflow-designer`), `web/src/components/chat/pickers.tsx` (иконка Workflow + импорт), `src/mcp/tools.ts` (регистрация), `src/core/tool-kinds.ts` (read/write), `src/cli/router.ts` + `command-registry.ts` (команда), `src/cli/commands/doctor.ts` (префикс `workflow_`, hint на `workflow validate`), `src/cli/commands/instructions.ts` (группа MCP + раздел «Как настроить свой workflow»), `src/core/capabilities.ts` (NEXT_STEPS + summary ключей), `scripts/npm-smoke.mjs`, тесты-инварианты (`diagnostics`, `write-ack-contract`, `personas`, `compat-full`, `documents`, `reference-tools`, `server` — счётчик инструментов 49→51).
**Проверки:** `pnpm build` — чисто; полный `pnpm test` — 209 файлов, все passed (4057 тестов, 4 skipped — предсуществующие, без --exclude/--skip). Ручная проверка: `vibelog workflow show` печатает дефолт из кода, `workflow validate` — 0 ошибок, `capabilities` — 9933 байта (лимит 12000).
**Отклонение от плана:** проверка «недостижимый статус» не срабатывает для статусов, объявленных в `config.statuses` (например `In Progress` в DEFAULT_WORKFLOW — в него переводят вручную). Без этого правила дефолтный workflow давал бы ложные предупреждения; поведение закреплено тестом.
**Что осталось:** документация (doc-7 CLI, doc-8 MCP, doc-30 фазовый процесс) — по правилам фазы Code документы пишет Close.
---
author: @agent
created: 2026-11-10 09:06
---
Фаза Close выполнена. Ветка vb/vl-398 слита в master (1 коммит 6e1832e, merge --no-ff без конфликтов), worktree `.vibelog/worktrees/vl-398` удалена (force — только untracked-симлинк `backlog/references/data` на главный репозиторий, данные не терялись), ветка vb/vl-398 удалена.
**Проверки после merge:** `pnpm build` — чисто (один раз). Ранний точечный фильтр по затронутым модулям (9 файлов: workflow-config, workflow-cli, workflow-tools, personas, tool-classify, write-ack-contract, diagnostics, instructions-cli, capabilities-cli) — 149 тестов passed. Полный `npx vitest run` — первый прогон дал 1 падение в `src/core/report.test.mjs` (тест не затронут diff'ом, изолированно зелёный — 27/27, параллельного vitest не было → флак); один повтор с причиной: **210 файлов passed, 4061 тест passed, 4 skipped** (предсуществующие).
**DoD:** 1. Тесты проходят — да (полный прогон зелёный). 2. Документация обновлена — да: doc-7 (новый раздел `## workflow` после `## config`: show/validate/apply, флаги, коды выхода), doc-8 (раздел «Workflow (конструктор)» с `workflow_get`/`workflow_apply` и таблицей параметров), doc-30 (§3, подраздел «Конструктор: роль `workflow-designer` и `vibelog workflow`»), CHANGELOG.md (запись в Unreleased). README не расширялся (лимит 150 строк). 3. Нет регрессий — да.
**Коммиты:** 9f5a1d4 (refs и lessons), 6d9f990 (документация и CHANGELOG).
**Урок:** lesson-276 «Не считай статус недостижимым, если он объявлен в config.statuses — в него переводят вручную» (создан, связан с VL-398) — фиксирует отклонение от плана, найденное в фазе Code: без этого правила `workflow validate` давал бы ложные предупреждения на дефолтном workflow (`In Progress` не производится ни одним переходом).
---
<!-- COMMENTS:END -->