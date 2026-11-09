---
id: VL-396
title: 'vibelog instructions: темы workflow, mcp, settings — справочник фаз, MCP-правил и ключей настроек вместо устаревшего «To Do → In Progress → Done»'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 23:48'
updated_date: '2026-11-10 02:43'
due_date: ''
labels:
  - cli
  - docs
  - agent
  - onboarding
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/cli/commands/instructions.ts
  - src/cli/router.ts
  - src/cli/command-registry.ts
  - src/cli/instructions-cli.test.mjs
lessons:
  - lesson-275
token_usage:
  input: 8936679
  output: 83772
  cache: 8250368
  total: 9020451
  requests: 123
  duration_ms: 915946
  reasoning: 48747
  by_phase:
    plan:
      input: 2693833
      output: 31156
      cache: 2457088
      requests: 39
    code:
      input: 5045479
      output: 46592
      cache: 4646400
      requests: 58
    close:
      input: 1197367
      output: 6024
      cache: 1146880
      requests: 26
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`vibelog instructions` (`src/cli/commands/instructions.ts`) — единственная штатная точка, куда отсылает шаблон `AGENTS.md` из `vb init` («Подробные инструкции для агента: `vibelog instructions`»). Сейчас там 4 темы: overview, task-creation, task-execution, task-finalization. Все — про CLI-команды задач.

Чего нет и из-за чего агент в новом проекте «не знает ничего о vibelog»:
- workflow/фаз (и того, что дефолт задан **в коде**, а не в конфиге проекта);
- MCP-инструментов и правил их применения (в т.ч. «backlog/ править только через MCP, не через edit/write_file»);
- ключей `.vibelog/settings.json` (`workflows`, `task_workflows`, `completeness`, models, supervisor и т.п.).

Дополнительно: `vibelog instructions overview` описывает workflow как «To Do → In Progress → Done» — это устаревшая упрощённая картина по сравнению с фазовым процессом (`src/core/workflow.ts:381`).

## Цель

Сделать `vibelog instructions` полноценным справочником «как работает Vibelog» по темам, а не только про CLI задач. Размер одной темы — ориентир до ~8 КБ (tool-ответ агента).

## Содержание новых тем

**workflow**
- Цепочка по умолчанию: `To Do → spec → Spec → plan → Planned → code → Review → close → Done`; ветки `To Do/Spec/Planned/In Progress/Review → reject → Rejected`, `Review → code → Review` (fix-цикл).
- Ключевое: `workflows` в `.vibelog/settings.json` — **переопределение**; нет ключа → работает `DEFAULT_WORKFLOW`. Пример секции (взять из шапки `src/core/workflow.ts`).
- `task_workflows` (тип задачи → workflow, напр. `simple` с единственной фазой `do`) и `completeness` (обязательные поля по фазам).
- Как переопределить шаблон фазы: `.vibelog/prompts/phases/<файл>` (`src/web/phase-prompt.ts:92`).

**mcp**
- Группы инструментов и когда что брать (задачи/AC/DoD/комментарии, документы, вехи, lessons, references, project_map/search_files, супервизор/фазы, служебные вроде session-outline).
- Правила: `backlog/` правится только MCP-инструментами; write — с подтверждением Allow/Deny; контракт ответа `{ok, applied, skipped}` и `idempotencyKey`; read-only операции — без подтверждения.

**settings**
- Читаемые ключи `.vibelog/settings.json` и `backlog/config.yml` с назначением в одну строку; что коммитится, что локально (`.vibelog/.gitignore`, VL-329).

## Ограничения

- Не дублировать списки инструментов/команд литералами, где есть реестр (`listTools()`, `defaultConfig()`) — переиспользовать (или сослаться на `vibelog capabilities`, VL-394).
- Не превращать в копию doc-10: doc-10 — исторический документ про vb-агента, здесь — краткая инструкция.
- Правки `README.md` не нужны (лимит 150 строк / белый список H2, тест `src/web/readme-standard.test.mjs`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vibelog instructions` получает темы `workflow`, `mcp`, `settings` (сверх существующих overview/task-creation/task-execution/task-finalization)
- [x] #2 Тема `workflow`: фазы по умолчанию и статусы, ветки reject и Review→code, явное указание, что при отсутствии ключа `workflows` в settings.json работает DEFAULT_WORKFLOW, и пример секции `workflows` + `task_workflows` + `completeness`
- [x] #3 Тема `mcp`: назначение MCP-инструментов по группам (задачи, документы, вехи, lessons, references, супервизор, служебные) и ключевые правила (править backlog только через MCP, write — с подтверждением, контракт {ok, applied, skipped})
- [x] #4 Тема `settings`: читаемые ключи .vibelog/settings.json и backlog/config.yml с назначением в одну строку
- [x] #5 `vibelog instructions` без темы и в `vibelog --help` перечисляет полный список тем; неизвестная тема по-прежнему даёт понятную ошибку со списком
- [x] #6 Тексты не переписывают списки инструментов литералами: MCP-группы собираются из реестра listTools (тест: новый инструмент в реестре не ломает партиционирование / попадает в отчёт)
- [x] #7 Тесты в src/cli (mkdtemp, testSpawnEnv при спавне CLI) покрывают новые темы и листинг тем
- [x] #8 Тема `overview` переписана: workflow описан как фазовый процесс (spec → plan → code → close, ветки reject и Review→code) вместо устаревшего «To Do → In Progress → Done», с отсылкой к `vibelog capabilities` за полным списком
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

`vibelog instructions` из «4 тем про CLI задач» превращается в справочник «как работает Vibelog»: добавляются темы `workflow`, `mcp`, `settings`, тема `overview` переписывается под фазовый процесс. Содержимое новых тем **генерируется из реестров кода** (`DEFAULT_WORKFLOW`, `DEFAULT_COMPLETENESS`, `listTools()`, `buildCapabilities()`), а не пишется литералами — иначе оно разъедется с исполнением.

## Файлы для изменения

| Файл | Что делаем |
|---|---|
| `src/cli/commands/instructions.ts` | Основная работа: экспорт списка тем, генерация тем `overview`/`workflow`/`mcp`/`settings`, партиционирование MCP-инструментов по группам, листинг тем при вызове без темы |
| `src/cli/router.ts` | `showCommandHelp('instructions')` (стр. 431-435) и строка общей справки (стр. 189) — полный список тем |
| `src/cli/command-registry.ts` | Стр. 45: summary команды `instructions` (сейчас «overview, task-*») |
| `src/cli/instructions-cli.test.mjs` | **Новый** тест-файл (mkdtemp, без спавна — прямой вызов `runInstructions` с перехватом console) |
| `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md` | Раздел `## instructions` (стр. 320-326): список тем |
| `backlog/docs/doc-30-Фазовый-процесс-…md` | Стр. 20: убрать «расширение тем … в разработке, VL-396» → темы существуют |
| `backlog/docs/doc-11-Сравнение-фич-…md` | Стр. 86 и 225: «4 темы» → «7 тем» |

Правки `README.md` не нужны (лимит 150 строк, тест `src/web/readme-standard.test.mjs`).

## Порядок действий

### 1. `src/cli/commands/instructions.ts` — структура

Сейчас: `const INSTRUCTIONS: Record<string,string>` (стр. 14-138) — 4 литеральных текста; `runInstructions` (стр. 145-160) берёт `positional[0] || 'overview'`, при неизвестной теме печатает `printError` + `printInfo` со списком `Object.keys(INSTRUCTIONS)`.

Новая структура:

```ts
export const INSTRUCTION_TOPICS = [
  'overview', 'workflow', 'mcp', 'settings',
  'task-creation', 'task-execution', 'task-finalization',
] as const;

/** Одна строка назначения темы — для листинга и ошибки. */
const TOPIC_SUMMARIES: Record<string, string> = { ... };

/** Собирает все темы: статические литералы + генерируемые из кода. */
export function buildInstructions(cwd: string): Record<string, string>
```

- `task-creation` / `task-execution` / `task-finalization` остаются литералами (перенести как есть, тексты не меняем).
- `overview`, `workflow`, `mcp`, `settings` — функции-генераторы, вызываемые из `buildInstructions(cwd)`.
- `runInstructions` получает `cwd` уже сейчас (роутер передаёт `process.cwd()`, `src/cli/router.ts:109`) — используем его для `loadWorkflows(cwd)` / `buildCapabilities(cwd)`.

### 2. Тема `overview` (переписать)

Требование AC8: фазовый процесс вместо «To Do → In Progress → Done». Содержание:
- что такое Vibelog (markdown-задачи в `backlog/tasks/`), базовые команды задач (сохранить строку `vibelog task create` — её проверяет существующий тест `src/cli/cli.test.mjs:171-175`);
- **Workflow — фазовый процесс**: `To Do --spec--> Spec --plan--> Planned --code--> Review --close--> Done`, ветки `reject --> Rejected` и fix-цикл `Review --code--> Review`; служебные фазы `comment, prompt, analyze, resume` статус не меняют;
- явно: это дефолт **в коде** (`DEFAULT_WORKFLOW`), секции `workflows` в settings.json может не быть;
- отсылки: `vibelog instructions workflow|mcp|settings`, `vibelog capabilities` (полный список), `vibelog map`.

Переходы в overview/workflow печатаются из `DEFAULT_WORKFLOW.transitions` (или из `loadWorkflows(cwd).workflows.default`, если переопределён) — не литералом.

### 3. Тема `workflow`

Генерируется из кода:
- действующий workflow: `loadWorkflows(cwd)` → `workflows.default` + признак источника (`=== DEFAULT_WORKFLOW` → «дефолт в коде», иначе «из settings.json»); переходы — по одному в строке формата `To Do --spec--> Spec` (хелпер `transitionLine` в `src/core/capabilities.ts:365-368` — приватный, поэтому локальная копия в 3 строки, либо переиспользовать через `buildCapabilities(cwd).workflow`);
- `SERVICE_PHASES` (`src/core/workflow.ts:404`);
- ключ `workflows` — **переопределение**: нет ключа → `DEFAULT_WORKFLOW`; пример секции `workflows` + `task_workflows` + `completeness` (JSON-блок; взять форму из шапки `src/core/workflow.ts:1-40` и `EXAMPLE_WORKFLOW_SECTION` в `src/core/capabilities.ts:184-200` — он приватный, поэтому в instructions.ts свой минимальный пример, форма та же);
- `task_workflows` (тип задачи → workflow, пример `chore → simple` с единственной фазой `do`) и `completeness` (workflow → фаза → сущность → поля; дефолт `DEFAULT_COMPLETENESS`, `src/core/workflow.ts:99-110`);
- переопределение шаблона фазы: `.vibelog/prompts/phases/phase-<фаза>.md` (`PROJECT_PROMPTS_DIR`, `src/web/phase-prompt.ts:76`; порядок поиска — `loadPhaseTemplate`, стр. 100-118).

### 4. Тема `mcp`

- **Группы инструментов** — из реестра `listTools()` (`src/mcp/tools.ts:149`). Реализовать и экспортировать:

```ts
/** Группы MCP-инструментов: заголовок + имена из реестра. */
const MCP_GROUPS: { title: string; names: readonly string[] }[] = [
  { title: 'Задачи и чеклисты', names: ['backlog_create_task', 'backlog_list_tasks', ...] },
  { title: 'Документы', ... }, { title: 'Вехи', ... }, { title: 'Lessons', ... },
  { title: 'References', ... }, { title: 'Фазы и супервизор', ... },
  { title: 'Код и git', ... }, { title: 'Upstream', ... },
];

/** Раскладывает инструменты реестра по группам; незнакомое имя → «прочее». */
export function groupMcpTools(tools: { name: string }[]): { title: string; tools: string[] }[]
```

Алгоритм: для каждого инструмента из `listTools()` ищем группу по имени; не нашли → группа `прочее` (добавляется в конец, только если непуста). Пустые группы не печатаются. Так новый инструмент в реестре **не ломает** партиционирование и попадает в отчёт (AC6).
- **Правила** (текст, источник — `buildCapabilities(cwd).access`, `src/core/capabilities.ts:202-217`): `backlog/` правится только MCP-инструментами (не `edit`/`write_file`); чтение — сразу, запись — через подтверждение Allow/Deny (в фазе агента запись идёт сразу); контракт ответа `{ok, outcome, applied, skipped}`; `idempotencyKey` — повтор не применяет изменение второй раз (`idempotentReplay: true`); причины отказа `denied` / `not_confirmed` / `noop`.
- Отсылка за полными описаниями: `vibelog capabilities --json`.

### 5. Тема `settings`

Генерируется из `buildCapabilities(cwd)`:
- `data.settingsKeys` (29 ключей `.vibelog/settings.json`, `src/core/capabilities.ts:144-178`) — `key — summary` по строке;
- `data.configKeys` (ключи `backlog/config.yml` из `defaultConfig()`, `src/core/config.ts:25-52`) — `key = дефолт`;
- git-политика: коммитятся `config.json`, `installed.lock.json`, `settings.json`, `prompts/`, `billing/`; локальны `agent-sessions/`, `chat-sessions/`, `cache/`, `tmp/`, `supervisor/`, `worktrees/`, `idempotency.json`, `auto-queue.json`, `*.log` (`.vibelog/.gitignore`, VL-329); секреты и `TELEGRAM_CHAT_IDS` — только `.env`, секция `env` в settings.json не читается.

### 6. Листинг тем и ошибка

- `runInstructions` без темы: печатает `overview` + блок «Темы» (`INSTRUCTION_TOPICS` с `TOPIC_SUMMARIES`) — AC5.
- Неизвестная тема: `printError('Неизвестная тема: X')` + `printInfo` со списком `INSTRUCTION_TOPICS` (поведение сохраняется, источник списка — константа).
- `src/cli/router.ts:431-435` — текст `vibelog instructions --help`: полный список тем + строка про `vibelog capabilities`.
- `src/cli/router.ts:189` — строка общей справки: `[topic]` → перечислить темы кратко (например `overview|workflow|mcp|settings|task-*`).
- `src/cli/command-registry.ts:45` — summary: «Инструкции для агента: overview, workflow, mcp, settings, task-*».

### 7. Тесты — новый `src/cli/instructions-cli.test.mjs`

Стиль `src/cli/capabilities-cli.test.mjs`: `mkdtempSync(join(tmpdir(), 'vibelog-instructions-'))` в `beforeAll`, `rmSync` в `afterAll`, прямой вызов `runInstructions` из `dist/` с перехватом `console.log`/`console.error` (спавна нет → `testSpawnEnv` не нужен; при добавлении спавна — только `testSpawnEnv()`).

Кейсы:
1. `workflow`: содержит `DEFAULT_WORKFLOW`, `To Do`, `spec`, `plan`, `code`, `close`, `reject`, `Review`, `task_workflows`, `completeness`, `.vibelog/prompts/phases`; при отсутствии `workflows` в settings — фраза про дефолт в коде; при наличии секции `workflows` в settings — фраза про переопределение (два подкейса, два каталога).
2. `mcp`: содержит заголовки групп, `backlog_create_task`, `idempotencyKey`, `applied`, `skipped`, `Allow/Deny`.
3. `settings`: содержит `workflows`, `task_workflows`, `completeness`, `statuses`, `task_prefix`, `.env`.
4. `overview`: содержит `spec`, `plan`, `code`, `close`, `vibelog capabilities`, `vibelog task create`; **не** содержит `To Do → In Progress → Done`.
5. Без темы: вывод содержит все имена из `INSTRUCTION_TOPICS`.
6. Неизвестная тема: `console.error` содержит «Неизвестная тема», `console.log` — полный список тем.
7. Партиционирование (AC6): `groupMcpTools(listTools())` — объединение всех групп равно множеству имён реестра, дублей нет; добавление фиктивного `{name:'backlog_new_thing'}` → попадает в группу «прочее»; каждый литерал из `MCP_GROUPS` существует в `listTools()` (нет протухших имён).
8. Размер: каждая тема ≤ 12000 символов (ориентир ~8 КБ, запас на кириллицу).

### 8. Проверка

```bash
pnpm build && npx vitest run src/cli/instructions-cli.test.mjs src/cli/cli.test.mjs src/cli/capabilities-cli.test.mjs
node bin/vibelog.mjs instructions workflow | head -40
node bin/vibelog.mjs instructions mcp | head -40
node bin/vibelog.mjs instructions settings | head -40
node bin/vibelog.mjs instructions
node bin/vibelog.mjs instructions --help
node bin/vibelog.mjs instructions нет-такой-темы
pnpm test   # полный прогон перед DoD
```

## Риски

1. **Импорт `core/capabilities.js` из CLI-команды** тянет `web/phase-prompt.js` (fs) и `mcp/tools.js` — для CLI это нормально (node-контекст), но `buildCapabilities` читает шаблоны фаз; в неполной установке он уже обёрнут в try/catch (`src/core/capabilities.ts:271-330`). Если тест упадёт на отсутствии `templates/` — обернуть вызов в try/catch в instructions.ts и печатать fallback-текст.
2. **Дрейф `MCP_GROUPS`**: список имён литеральный → тест-инвариант (кейс 7) ловит протухшее имя; новый инструмент без группы попадает в «прочее», а не теряется.
3. **Размер вывода**: `settings` (29+16 ключей) и `mcp` (50 инструментов) близки к 8 КБ — печатать по одному элементу в строке, без описаний инструментов (только имена), иначе tool-ответ агента распухнет.
4. **Существующий тест** `src/cli/cli.test.mjs:171-175` ждёт в `overview` строки `Vibelog.md` и `vibelog task create` — сохранить их в новом тексте.
5. **`src/core/compat-full.test.mjs:298`** проверяет наличие `instructions` в общей справке — строку команды не удалять, только расширять.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `INSTRUCTIONS` — литеральный Record из 4 тем, `runInstructions` берёт `positional[0] \|\| 'overview'` и печатает список `Object.keys` при неизвестной теме | `src/cli/commands/instructions.ts:14-138`, `:145-160` |
| Роутер передаёт `cwd` в `runInstructions` | `src/cli/router.ts:109` |
| `printError` пишет в `console.error`, `printInfo` — в `console.log` | `src/cli/ui.ts:64-73` |
| `DEFAULT_WORKFLOW` — 13 переходов, включая `Review --code--> Review` и reject из 5 статусов | `src/core/workflow.ts:381-403` |
| `SERVICE_PHASES = ['comment','prompt','analyze','resume']` | `src/core/workflow.ts:404` |
| `DEFAULT_COMPLETENESS` — workflow → фаза → сущность → поля | `src/core/workflow.ts:99-110` |
| `loadWorkflows` кладёт именно `DEFAULT_WORKFLOW` при отсутствии/битом ключе `workflows` | `src/core/workflow.ts:437-470` |
| `loadCompleteness` — та же семантика fallback | `src/core/workflow.ts:511-527` |
| `PROJECT_PROMPTS_DIR = .vibelog/prompts/phases`, переопределение приоритетнее встроенного | `src/web/phase-prompt.ts:76`, `:100-118` |
| `listTools()` — единственный реестр MCP-инструментов (50 имён) | `src/mcp/tools.ts:149` |
| `buildCapabilities(cwd)` отдаёт `settingsKeys`, `configKeys`, `access`, `workflow.source` | `src/core/capabilities.ts:271-330` |
| `SETTINGS_KEYS` — 29 ключей с однострочным summary | `src/core/capabilities.ts:144-178` |
| `ACCESS.ack` — контракт `{ok, outcome, applied, skipped}` + `idempotencyKey`/`idempotentReplay` | `src/core/capabilities.ts:202-217` |
| `defaultConfig()` — ключи `backlog/config.yml` (statuses, task_prefix, …) | `src/core/config.ts:25-52` |
| `TOOL_KINDS` объявляет вид каждого инструмента (read/write/mixed) | `src/core/tool-kinds.ts:32-100` |
| `.vibelog/.gitignore`: коммитятся `config.json`, `installed.lock.json`, `settings.json`, `prompts/`, `billing/` | `.vibelog/.gitignore:1-60` |
| Справка `instructions --help` перечисляет 4 темы | `src/cli/router.ts:431-435` |
| Строка общей справки `instructions [topic]` | `src/cli/router.ts:189` |
| Summary команды в реестре — «overview, task-*» | `src/cli/command-registry.ts:45` |
| Существующий тест ждёт в `overview` `Vibelog.md` и `vibelog task create` | `src/cli/cli.test.mjs:171-175` |
| Тест-стиль mkdtemp + перехват console для CLI-команды | `src/cli/capabilities-cli.test.mjs:1-60` |
| doc-7 перечисляет 4 темы; doc-30 стр. 20 говорит «в разработке, VL-396»; doc-11 — «4 темы» | `backlog/docs/doc-7-…md:320-326`, `doc-30-…md:20`, `doc-11-…md:86,225` |

## Не проверено (предположения)

1. **`buildCapabilities` не падает в каталоге без `templates/`** (тест создаёт mkdtemp-проект без шаблонов фаз). Проверить: прогнать `runInstructions(['settings'], {}, tmpDir)` в новом тесте; при падении — обернуть `buildCapabilities` в try/catch в instructions.ts и печатать статический fallback (ключи из `DEFAULT_WORKFLOW`/`defaultConfig`).
2. **Циклических импортов нет**: `cli/commands/instructions.ts → core/capabilities.ts → cli/command-registry.ts` (реестр — чистые данные, обратной ссылки на instructions нет). Проверить: `pnpm build` + запуск `node bin/vibelog.mjs instructions`; при цикле — вынести генерацию тем в `src/core/instructions.ts`.
3. **`loadWorkflows(cwd)` в mkdtemp-каталоге без `.vibelog/settings.json`** возвращает `DEFAULT_WORKFLOW` по ссылке (сравнение `===` для определения источника). Проверить: кейс 1 теста (два каталога — с секцией и без); при расхождении — определять источник по наличию ключа в `loadSettings(cwd)`.
4. **Точный список 50 имён `listTools()`** для `MCP_GROUPS` — сверять не по памяти, а прогоном `node -e "import('./dist/mcp/tools.js').then(m=>console.log(m.listTools().map(t=>t.name).join('\n')))"` первым шагом Code; тест-инвариант (кейс 7) поймает пропущенное/лишнее имя.
5. **`vibelog instructions --help`** обрабатывается роутером до вызова команды (`flags.help` → `showCommandHelp`, `src/cli/router.ts:74-77`) — значит правка текста в `showCommandHelp` достаточна, отдельный флаг в `runInstructions` не нужен. Проверить: `node bin/vibelog.mjs instructions --help`.
6. **Лимит 8 КБ на тему** — фактический размер после генерации неизвестен (кириллица в UTF-8 = 2 байта/символ). Проверить: кейс 8 теста (≤12000 символов); при превышении — сократить `settings` до ключей без summary для второстепенных.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 02:22
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача, не epic).
План записан в задачу. Изучены: `src/cli/commands/instructions.ts` (4 литеральные темы, `runInstructions`), `src/core/workflow.ts` (DEFAULT_WORKFLOW — 13 переходов, SERVICE_PHASES, DEFAULT_COMPLETENESS, loadWorkflows/loadCompleteness), `src/core/capabilities.ts` (buildCapabilities: settingsKeys/configKeys/access/workflow.source, приватные EXAMPLE_WORKFLOW_SECTION и transitionLine), `src/mcp/tools.ts` (listTools — 50 инструментов), `src/core/tool-kinds.ts`, `src/core/config.ts` (defaultConfig), `src/web/phase-prompt.ts` (PROJECT_PROMPTS_DIR, loadPhaseTemplate), `src/cli/router.ts` (стр. 109, 189, 431-435), `src/cli/command-registry.ts:45`, `.vibelog/.gitignore`, тест-стиль `src/cli/capabilities-cli.test.mjs`.
Решения:
- новые темы `workflow`/`mcp`/`settings` и переписанный `overview` генерируются из реестров кода (`loadWorkflows`, `DEFAULT_COMPLETENESS`, `listTools()`, `buildCapabilities()`), а не литералами — AC6 закрывается партиционированием `groupMcpTools(listTools())` с группой «прочее» для незнакомых имён и тестом-инвариантом «каждое имя из MCP_GROUPS есть в реестре»;
- `INSTRUCTION_TOPICS` — единый источник списка тем для листинга, ошибки, `--help` и реестра CLI-команд;
- тесты — новый `src/cli/instructions-cli.test.mjs` (mkdtemp, прямой вызов без спавна, 8 кейсов);
- документация: doc-7 (список тем), doc-30 стр. 20 (снять «в разработке»), doc-11 (4 темы → 7); README не трогаем.
Файлов к изменению: 7 (3 кода, 1 новый тест, 3 документа). Риски: размер вывода тем (~8 КБ на `settings`/`mcp`), дрейф литерального списка MCP_GROUPS (закрыт тестом-инвариантом), возможный цикл импортов cli→core/capabilities→cli/command-registry (проверяется первым шагом Code), сохранение строк `Vibelog.md`/`vibelog task create` в overview ради существующего теста `src/cli/cli.test.mjs:171-175`. Разделы «Проверено по коду» (23 утверждения с файл:строка) и «Не проверено (предположения)» (6 пунктов с планом проверки) в плане присутствуют.
---
author: @agent
created: 2026-11-10 02:38
---
Фаза 3 (Code) выполнена. Коммит b282242.
Изменено:
- `src/cli/commands/instructions.ts` — переписан: `INSTRUCTION_TOPICS` (7 тем) как единый источник списка, `buildInstructions(cwd)`, генераторы тем `overview`/`workflow`/`mcp`/`settings` из реестров кода (`loadWorkflows`/`DEFAULT_WORKFLOW`/`DEFAULT_COMPLETENESS`/`SERVICE_PHASES`, `listTools()`, `buildCapabilities()`, `PROJECT_PROMPTS_DIR`), экспортируемые `MCP_GROUPS` + `groupMcpTools()` (незнакомое имя → группа «прочее», пустые группы не печатаются), листинг тем без аргумента и в тексте ошибки. Статические темы task-* перенесены без изменения текстов.
- `src/cli/router.ts` — `showCommandHelp('instructions')` перечисляет все 7 тем с назначением; строка общей справки: `overview|workflow|mcp|settings|task-*`. **Исправлен дефект**: `case 'instructions'` передавал только `positional`, а первый позиционный аргумент парсер кладёт в `subcommand` — тема из CLI не доходила до команды и всегда печатался `overview` (обнаружено прогоном `node bin/vibelog.mjs instructions workflow`). Теперь `[subcommand, ...positional].filter(Boolean)`, как у `map`/`capabilities`.
- `src/cli/command-registry.ts` — summary команды обновлён на полный список тем.
- `src/cli/instructions-cli.test.mjs` (новый) — 15 тестов: темы workflow (дефолт в коде и переопределение из settings — два каталога), mcp (группы + правила), settings (ключи обоих конфигов + git-политика), overview (фазовый процесс, отсутствие «To Do → In Progress → Done»), листинг без темы, ошибка неизвестной темы, лимит 12000 символов на тему, партиционирование AC6 (объединение групп = реестр, без дублей; фиктивный `backlog_new_thing` → «прочее»; нет протухших имён в `MCP_GROUPS`), плюс 3 спавн-теста через `bin/vibelog.mjs` с `testSpawnEnv()` — тема доходит через роутер, `vibelog help` перечисляет темы.
Проверки: `pnpm build` — успешно; `npx vitest run` — **полный прогон**: 207 файлов, 4014 passed, 4 skipped, 0 failed (162.8 с). Исключённых/пропущенных файлов нет (4 skipped — штатные skip внутри файлов, не связанные с задачей).
Документация (doc-7, doc-30, doc-11) по правилам фазы Code не правилась — остаётся фазе Close.
Что осталось: обновить doc-7 (список тем), doc-30 стр. 20 (снять «в разработке, VL-396»), doc-11 (4 темы → 7) — в Close.
---
author: @agent
created: 2026-11-10 02:43
---
Фаза Close выполнена. Ветка vb/vl-396 слита в master (1 коммит b282242, merge 78b4857), worktree удалена (--force: только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-396 удалена.
Проверки после merge: `pnpm build` — успешно; точечный фильтр `npx vitest run src/cli/instructions-cli.test.mjs src/cli/cli.test.mjs src/cli/capabilities-cli.test.mjs` — 3 файла, 60 passed; полный прогон `npx vitest run` — 207 файлов, 4014 passed, 4 skipped, 0 failed (154 с). Исключённых файлов нет.
Документация (коммит 670a882): doc-7 — раздел `instructions` переписан (7 тем, генерация из реестров, поведение без темы и при неизвестной теме); doc-30 — снята пометка «расширение тем … в разработке, VL-396»; doc-11 — «4 темы» → «7 тем» (строка сравнения и строка `get_backlog_instructions`); CHANGELOG.md — запись в Unreleased. README не трогался (лимит 150 строк / белый список H2).
Урок (коммит 504f96b): lesson-275 — «Передавай subcommand в обработчик CLI-команды вместе с positional»: дефект роутера (тема из CLI не доходила до команды, всегда печатался overview) не ловился тестами, вызывавшими `runInstructions` напрямую; добавлен спавн-тест через `bin/vibelog.mjs`.
DoD: 1. Тесты проходят — да (полный прогон 4014 passed, 0 failed); 2. Документация обновлена — да (doc-7, doc-30, doc-11, CHANGELOG); 3. Нет регрессий — да (полный прогон зелёный, merge без конфликтов).
---
<!-- COMMENTS:END -->