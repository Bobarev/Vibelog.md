---
id: VL-394
title: 'vibelog capabilities [--json]: справочник возможностей Vibelog, генерируемый из кода (фазы, статусы, MCP/CLI, ключи settings)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 23:47'
updated_date: '2026-11-10 01:56'
due_date: ''
labels:
  - cli
  - docs
  - agent
  - onboarding
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/capabilities.ts
  - src/cli/command-registry.ts
  - src/cli/commands/capabilities.ts
  - src/cli/capabilities-cli.test.mjs
  - src/cli/router.ts
  - src/core/setup.ts
  - src/cli/commands/instructions.ts
lessons:
  - lesson-273
token_usage:
  input: 11577193
  output: 87218
  cache: 10127360
  total: 11664411
  requests: 139
  duration_ms: 1201058
  reasoning: 39577
  by_phase:
    plan:
      input: 1408363
      output: 22340
      cache: 1038336
      requests: 24
    code:
      input: 8759564
      output: 58973
      cache: 7812096
      requests: 86
    close:
      input: 1409266
      output: 5905
      cache: 1276928
      requests: 29
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Новый проект Vibelog (создан `vb init`) — агент ничего не знает о возможностях системы. Реальный инцидент: на запрос «настроить workflow» агент потратил ~250k токенов на поиск схемы и в итоге ответил «схему подтвердить не могу — файлов Vibelog CLI тут нет». Причина не в невнимательности агента: **знание о фазах задано дефолтом в коде** (`DEFAULT_WORKFLOW`, `src/core/workflow.ts:381`), а в проекте его нет ни в `backlog/config.yml`, ни в `.vibelog/settings.json` — искать в файлах нечего.

Проверено:
- `vibelog instructions` (`src/cli/commands/instructions.ts`) — 4 темы (overview, task-creation, task-execution, task-finalization), только CLI-азы; фаз, MCP, ключей settings, правил доступа read/write там нет.
- MCP `initialize` (`src/mcp/server.ts:170`) отдаёт только `serverInfo` + `tools:{}`.
- `AGENTS.md` из `vb init` (`src/core/setup.ts:287`) — 3 команды; расширять его нельзя (место под правила проекта, плюс лимит `AGENTS_MD_MAX_CHARS = 8000` в `src/agent/system-prompt.ts:29`).
- `doc-10` («Агент Vibelog») — большой и частично устаревший, как референс для нового проекта не годится.

## Цель

Одна команда, вызываемая агентом (и человеком) по требованию, которая отдаёт **полный и актуальный** справочник возможностей Vibelog — не руками написанный текст, а собранный из источников в коде, чтобы он не мог устареть по конструкции.

## Что должно попасть в справочник

1. Статусы и фазы: дефолтный workflow из `DEFAULT_WORKFLOW` — с явной пометкой «дефолт в коде; переопределяется ключом `workflows` в `.vibelog/settings.json`, при отсутствии ключа работает этот».
2. `task_workflows` и `completeness` (`DEFAULT_COMPLETENESS`, VL-370) — какие поля обязательны в какой фазе.
3. Список фаз: имя + назначение (первая содержательная строка/заголовок из `templates/phases/*.md`) + как переопределить шаблон (`.vibelog/prompts/phases/`, `src/web/phase-prompt.ts:92`).
4. Список MCP-инструментов с одной строкой описания — из `listTools()` (`src/mcp/tools.ts`), не из документации.
5. Список CLI-команд с одной строкой — из реестра роутера (`src/cli/router.ts`).
6. Ключи `backlog/config.yml` — из `defaultConfig()` (`src/core/config.ts`).
7. Ключи `.vibelog/settings.json`, которые реально читаются (workflows, task_workflows, completeness, models, supervisor и т.п.).
8. Правило доступа read/write (чтение — сразу, запись — с подтверждением Allow/Deny) и контракт ответа write-инструментов `{ok, applied, skipped}`.
9. Подсказка «что делать дальше» — например, для нового проекта: статусы уже совпадают с дефолтным workflow, секцию `workflows` писать не обязательно.

## Ограничения

- Никаких внешних рантаймов (запрет в AGENTS.md проекта) — только Node.js.
- `--json` — машиночитаемая форма для агента (`{schemaVersion, kind:'capabilities', data}` — по образцу `vibelog map`, VL-235); без флага — компактный markdown для человека.
- Размер текстового вывода — в разумных пределах (ориентир: до ~8 КБ, чтобы влезало в один tool-ответ); `--json` — полный.
- Источники истины не дублировать: если данные есть в структуре кода (`DEFAULT_WORKFLOW`, `listTools`, `defaultConfig`) — читать оттуда, а не переписывать списки в шаблон.

## Возможный побочный эффект

`vibelog instructions` может стать тонкой обёрткой над capabilities (темы-срезы), но это отдельная задача — здесь только новая команда.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vibelog capabilities` печатает markdown-справочник: статусы/фазы (из DEFAULT_WORKFLOW), фазы + назначение из templates/phases, MCP-инструменты (из listTools), CLI-команды, ключи config.yml (из defaultConfig) и читаемые ключи settings.json, правила доступа и контракт write-ответа
- [x] #2 `vibelog capabilities --json` возвращает `{schemaVersion, kind:'capabilities', data}` с машиночитаемыми секциями
- [x] #3 В выводе явно сказано, что workflow по умолчанию задан в коде и что при отсутствии ключа `workflows` в settings.json работает именно он; переопределение описано с примером секции
- [x] #4 Списки MCP-инструментов и CLI-команд не заданы литералами в шаблое текста — берутся из реестров (тест: добавили инструмент/команду в реестр → он появился в выводе)
- [x] #5 Справка доступна из `vibelog --help` и упомянута в `vibelog instructions overview`
- [x] #6 Есть тест (vitest, mkdtemp), проверяющий наличие ключевых секций в markdown- и json-выводе, и тест на отсутствие падения при битом/отсутствующем settings.json
- [x] #7 Шаблон AGENTS.md из `vb init` (`agentsMdTemplate`, src/core/setup.ts:287) заменяет строку «Подробные инструкции для агента: `vibelog instructions`» на отсылку к `vibelog capabilities` (полный справочник) + `vibelog instructions` (краткое); новых разделов не добавляется — место под правила проекта не сокращается, строка остаётся одной
- [x] #8 Тест-инвариант: шаблон AGENTS.md ссылается на `vibelog capabilities`, остаётся в пределах ~20 строк и укладывается в AGENTS_MD_MAX_CHARS (8000) с запасом
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

Команда `vibelog capabilities [--json]` — справочник возможностей Vibelog, собираемый из реестров кода (не из литералов в шаблоне текста).

## Архитектурное решение

Двухслойно, как `vibelog map` (VL-235):

1. **`src/core/capabilities.ts`** — чистая сборка данных: `buildCapabilities(cwd, opts?) → CapabilitiesData` (структурированные секции) + `renderCapabilitiesMarkdown(data) → string`. Тесты и MCP-обёртки могут звать без спавна.
2. **`src/cli/commands/capabilities.ts`** — тонкая обёртка: `runCapabilities(args, flags, cwd)`; `--json` → `{schemaVersion: 1, kind: 'capabilities', data}` (по образцу `src/cli/commands/map.ts:56-68`), иначе markdown через `console.log`.
3. **`src/cli/command-registry.ts`** (новый) — реестр CLI-команд: `export interface CliCommandEntry { name: string; summary: string }`, `export const CLI_COMMANDS: readonly CliCommandEntry[]`. Источник для секции «CLI-команды» в capabilities. `showHelp()`/`showCommandHelp()` в роутере НЕ переписываем на реестр (там формат с флагами и он объёмнее) — но добавляем строки про `capabilities`; расхождение реестра и роутера ловится тестом-инвариантом (см. шаг «тесты»): каждый `case` роутера из списка команд обязан присутствовать в реестре.

Секции данных (`CapabilitiesData`):
- `workflow` — `{initial_status, transitions, source: 'default-in-code' | 'settings'}` из `getWorkflow...`/`loadWorkflows(cwd).workflows.default`; обязательно пометка «дефолт в коде (`DEFAULT_WORKFLOW`, `src/core/workflow.ts:381`); переопределяется ключом `workflows` в `.vibelog/settings.json`».
- `taskWorkflows` — `loadWorkflows(cwd).task_workflows` (+ текст «неизвестный тип → default»).
- `completeness` — `loadCompleteness(cwd)` (дефолт `DEFAULT_COMPLETENESS`, `src/core/workflow.ts:99`).
- `phases` — по `PHASES` (`src/web/phase-prompt.ts:32-45`): имя + назначение из шаблона (`loadPhaseTemplate(phase, {cwd})`, первая содержательная строка, обрезка ~120 символов) + путь переопределения `PROJECT_PROMPTS_DIR` (`src/web/phase-prompt.ts:76`, константа, не литерал).
- `servicePhases` — `SERVICE_PHASES` (`src/core/workflow.ts:404`).
- `mcpTools` — `listTools()` (`src/mcp/tools.ts:149`): `{name, description}`.
- `cliCommands` — `CLI_COMMANDS` (новый реестр).
- `configKeys` — `Object.keys(defaultConfig('<project>', '<PREFIX>'))` (`src/core/config.ts:26`), т.е. ключи `backlog/config.yml` с дефолтными значениями (значения схлопывать: массивы → `[…]`).
- `settingsKeys` — статический список РЕАЛЬНО читаемых ключей `.vibelog/settings.json` с одной строкой назначения. Список — константа в `capabilities.ts` с комментарием, что он отражает фактические чтения (`loadSettings(cwd).<key>`); проверено grep по `src`: `api_mode`, `catalog`, `chat`, `chat_max_tool_calls`, `chat_personas`, `commit_coauthor`, `completeness`, `git_user_name`, `lessons`, `max_wall_time`, `mcp`, `models`, `pricing`, `pricing_guard`, `supervisor`, `task_workflows`, `upstream`, `workflows`. Дополнительно — ключи `loadBotSettings` (`src/bot/settings.ts:30-115`): `task_type_styles`, `default_agent`, `max_requests`, `loop_detection_repeat`, `reset_limits_on_resume`, `idle_timeout_seconds`, `branch_mode`, `compact`, `code_same_session`. Пометка «секреты и chat_id — в `.env`, секция `env` не читается (VL-329)» — источник `src/core/settings.ts:220-245`.
- `access` — правила: чтение сразу / запись с подтверждением Allow|Deny; контракт write-ответа `{ok, applied, skipped}` + `outcome`/`reason` (`src/mcp/tool-result.ts:89-150`); различие `denied`/`not_confirmed`; idempotencyKey.
- `nextSteps` — подсказка «статусы уже совпадают с дефолтным workflow → секцию `workflows` писать не обязательно», плюс отсылка к `vibelog instructions`, `vibelog map`, `vibelog status`.

Устойчивость: битый/отсутствующий `settings.json` не должен ронять команду — `loadSettings` уже возвращает `{}` при битом JSON (`src/core/settings.ts:57-71`), `loadWorkflows`/`loadCompleteness` падают в дефолты (`src/core/workflow.ts:441-460`, `505-520`). В `buildCapabilities` обернуть каждую потенциально бросающую часть (`loadConfig` внутри `defaultConfig` не нужен — `defaultConfig` чистый; `loadPhaseTemplate` может бросить при отсутствии шаблона) в try/catch с fallback-подписью «(описание недоступно)».

## Файлы и порядок действий

1. **`src/cli/command-registry.ts`** (новый, ~40 строк) — `CliCommandEntry`, `CLI_COMMANDS`: все команды из `switch` роутера (`src/cli/router.ts:74-176`): init, install, create, upstream, task, board, search, map, instructions, capabilities, mcp, browser, bot, qwen-debug, agent, session, doctor, status, milestone, doc, reference, lesson, experiment, config, model, provider, gateway, draft, decision. Каждая — одна строка назначения (перенос смысла из `showHelp`, `src/cli/router.ts:166-200`).
2. **`src/core/capabilities.ts`** (новый, ~220 строк) — типы + `buildCapabilities` + `renderCapabilitiesMarkdown`. Пример секции `workflows` в markdown печатать как JSON-блок (образец — комментарий формата в `src/core/workflow.ts:1-26`).
3. **`src/cli/commands/capabilities.ts`** (новый, ~50 строк) — `runCapabilities`: `--json` → `console.log(JSON.stringify({schemaVersion: 1, kind: 'capabilities', data}, null, 2))`; иначе `console.log(renderCapabilitiesMarkdown(data))` + `printInfo` с подсказкой про `--json`.
4. **`src/cli/router.ts`** — импорт `runCapabilities` (рядом с `runMap`, строка ~32), `case 'capabilities': return runCapabilities(positional, flags, cwd);` после `case 'map'` (строки 126-129), строка в `showHelp()` после `map` (строка 182), добавляемый блок в `showCommandHelp()` (`capabilities: \`…\`` рядом с `map:` — строка ~404).
5. **`src/core/setup.ts:306`** — заменить строку шаблона AGENTS.md
   `- Подробные инструкции для агента: \`vibelog instructions\`.`
   на одну строку (без новых разделов):
   `- Полный справочник возможностей: \`vibelog capabilities\`; краткие азы — \`vibelog instructions\`.`
   Ограничение по длине: файл-шаблон остаётся 20 строк (сейчас 22 строки текста в функции, `src/core/setup.ts:288-308`) — не добавлять абзацев.
6. **`src/cli/commands/instructions.ts`** — в текст темы `overview` добавить одну строку-отсылку: «Полный справочник возможностей (фазы, MCP, ключи settings): `vibelog capabilities`» (AC5: упомянута в `instructions overview`). Темы/логику не трогать.
7. **Документация (DoD)**: `doc-7` (CLI-справочник) — новый раздел `vibelog capabilities`; `doc-8` (MCP-справочник) — короткая отсылка «полный актуальный перечень инструментов — `vibelog capabilities --json`». README не расширять (лимит 150 строк, `src/web/readme-standard.test.mjs`).

## Тесты

8. **`src/cli/capabilities-cli.test.mjs`** (новый, mkdtemp):
   - фикстура: `mkdtempSync(join(tmpdir(), 'vibelog-capabilities-'))`, подкаталоги `backlog/` + `config.yml` (минимальный YAML), `.vibelog/settings.json`; перехват `console.log` как в `src/cli/map-cli.test.mjs:20-31`; вызов `runCapabilities([], parseArgs(['capabilities']).flags, dir)`.
   - markdown: есть заголовки/ключевые слова секций — `DEFAULT_WORKFLOW`-пометка («дефолт в коде»), `workflows`, `task_workflows`, `completeness`, `MCP`, `CLI`, `backlog/config.yml`, `settings.json`, `Allow`, `applied`, `skipped`.
   - `--json`: `schemaVersion === 1`, `kind === 'capabilities'`, массивы `data.mcpTools`/`data.cliCommands` непусты, `data.workflow.transitions` совпадает по длине с `DEFAULT_WORKFLOW.transitions`.
   - **AC4 (реестры, не литералы)**: каждый элемент `listTools()` присутствует в markdown-выводе по имени; каждый элемент `CLI_COMMANDS` — тоже; плюс отдельный кейс «добавили в реестр → появился»: замокать нельзя (import статический), поэтому инвариант формулируется как `data.mcpTools.length === listTools().length` и `data.cliCommands.length === CLI_COMMANDS.length` — любое расхождение шаблона с реестром валит тест.
   - **AC6 (битый/отсутствующий settings.json)**: два кейса — файл отсутствует; файл содержит `'{битый json'`. Команда завершилась, вывод содержит дефолтный workflow (To Do → spec) и не бросила.
   - **AC8 (AGENTS.md-инвариант)**: через `applySetup` в mkdtemp-проекте (как `src/core/setup.test.mjs:131-142`) прочитать `AGENTS.md`: содержит `vibelog capabilities`, `vibelog instructions`, число строк ≤ 30, длина < `AGENTS_MD_MAX_CHARS` (импорт из `dist/agent/system-prompt.js`) с запасом ≥ 2000 символов.
   - **Инвариант реестра CLI**: `CLI_COMMANDS` содержит `capabilities`, у всех записей непустые `name`/`summary`, дублей нет.

## Проверки

```
pnpm build
pnpm test:fast -- src/cli/capabilities-cli.test.mjs
node bin/vibelog.mjs capabilities | head -40
node bin/vibelog.mjs capabilities --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.kind, j.data.mcpTools.length, j.data.cliCommands.length)})"
node bin/vibelog.mjs capabilities | wc -c    # ориентир ≈ 6-9 КБ
pnpm test                                     # полный прогон перед DoD
```
Плюс `vibelog doctor` (инварианты MCP-реестра, `src/cli/commands/doctor.ts`) — не должен упасть.

## Риски

- **Размер markdown > 8 КБ**: 50 MCP-инструментов + 29 CLI-команд + фазы + ключи. Митигация: строка на элемент `- name — description` (описание обрезать до 100 символов в markdown; `--json` — полный). Тест фиксирует «≤ 200 строк» и не роняет на мягком размере; при выходе за ~10 КБ — сокращать описания, а не убирать элементы.
- **`listTools()` в CLI**: импорт `src/mcp/tools.ts` тянет ядро; побочных эффектов на модульном уровне не обнаружено (импорты + `void completeTaskFile`), но Code обязан проверить запуск `vibelog capabilities` в чистом каталоге без `backlog/` — команда должна работать (справочник не требует проекта), т.е. `loadConfig` не вызывать; `loadWorkflows`/`loadCompleteness` вызывать только под try/catch.
- **Чтение шаблонов фаз**: `loadPhaseTemplate` бросает при отсутствии `templates/phases/` (в репозитории есть); в собранном пакете каталог включён (`package.json files: ["bin","dist","templates","web/dist"]`). В тестах dist-путь `../../templates/phases` резолвится в корень репозитория.
- **Дубль знаний**: `settingsKeys` — единственный ручной список (имена ключей не экспортируются как реестр). Это осознанно: значения не дублируются, только имена+одна строка назначения. Риск дрейфа снижается grep-проверкой в тесте не обязателен (нет механизма), но Code обязан перечитать grep-вывод по `loadSettings(` перед фиксацией списка.
- **lesson-262** (проверять глобальные флаги роутера): `--help`/`-h` перехватываются ДО switch (`src/cli/router.ts:85-88`), а `--version`/`-v` — ещё раньше (`79-82`); флаг `--json` глобальным не является → коллизий нет. Короткий алиас `-c` НЕ вводить (`-c` не в shortFlagMap — стал бы позиционным).

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `DEFAULT_WORKFLOW` = initial_status 'To Do' + 13 переходов (spec/plan/code/close/reject, Done/Rejected финалы) | `src/core/workflow.ts:381-402` |
| `SERVICE_PHASES = ['comment','prompt','analyze','resume']` | `src/core/workflow.ts:404` |
| `DEFAULT_COMPLETENESS` — workflow→фаза→сущность→поля, ключ `'*'` | `src/core/workflow.ts:99-112` |
| `loadWorkflows` при битом/отсутствующем settings падает в `DEFAULT_WORKFLOW` | `src/core/workflow.ts:435-455` |
| `loadCompleteness` при битом JSON/отсутствии → `DEFAULT_COMPLETENESS` | `src/core/workflow.ts:505-520`, тест `src/core/workflow.test.mjs:437-442` |
| `loadSettings` на битом JSON/массиве → `{}` (команду не роняет) | `src/core/settings.ts:57-71` |
| Секция `env` не читается, секреты в `.env` (VL-329) | `src/core/settings.ts:220-258` |
| `defaultConfig` возвращает 16 ключей (project_name…max_column_width) | `src/core/config.ts:26-58` |
| `listTools()` — массив `{name, description, inputSchema}`, 50+ инструментов | `src/mcp/tools.ts:145-152` (далее по файлу до `project_map`/`upstream_*`, строки 805-905) |
| `PHASES` = spec, plan, code, do, close, comment, prompt, analyze, reject, investigate, materialize | `src/web/phase-prompt.ts:32-44` |
| Шаблон фазы: `<cwd>/.vibelog/prompts/phases/<file>` → встроенный `templates/phases/` | `src/web/phase-prompt.ts:76`, `:88-118` |
| `PROJECT_PROMPTS_DIR = '.vibelog/prompts/phases'` | `src/web/phase-prompt.ts:76` |
| `PHASE_FILES` — имя файла = `phase-<фаза>.md`, `prompt` → `prompt.md` | `src/web/phase-prompt.ts:47-68` |
| Шаблон AGENTS.md содержит строку «Подробные инструкции для агента: `vibelog instructions`.» | `src/core/setup.ts:306` |
| AGENTS.md пишется только при отсутствии файла | `src/core/setup.ts:376-382` |
| `AGENTS_MD_MAX_CHARS = 8000` | `src/agent/system-prompt.ts:29` |
| `--json`-формат map: `{schemaVersion: 1, kind: 'map', data}` | `src/cli/commands/map.ts:56-68` |
| Роутер: `--version`/`-v` перехват до switch; `--help`/`-h` — до switch; `case 'map'` — строки 126-129 | `src/cli/router.ts:79-88`, `:126-129` |
| `showHelp()` — строки карты/инструкций на 182-183; `showCommandHelp` — блок `instructions` на 411-415 | `src/cli/router.ts:166-200`, `:411-415` |
| Контракт write-ответа: `ok`, `outcome`, `applied`, `skipped`, `reason`, `denied`, `idempotentReplay` | `src/mcp/tool-result.ts:89-150` |
| `instructions` — 4 темы-литерала (overview, task-creation, task-execution, task-finalization) | `src/cli/commands/instructions.ts:15-140` |
| Тестовый стиль map-CLI: mkdtemp + перехват console.log | `src/cli/map-cli.test.mjs:20-50` |
| Ключи бота/фаз читаются через `loadBotSettings` (BotSettings: task_type_styles, default_agent, max_wall_time, max_requests, loop_detection_repeat, reset_limits_on_resume, idle_timeout_seconds, branch_mode, compact, code_same_session, commit_coauthor, chat, pricing_guard) | `src/bot/settings.ts:30-115` |
| Читаемые ключи settings.json по grep `loadSettings(cwd).X`: api_mode, catalog, chat, chat_max_tool_calls, chat_personas, commit_coauthor, env, git_user_name, lessons, max_wall_time, mcp, models, pricing, pricing_guard, supervisor, upstream | grep по `src/**/*.ts` (вывод получен в этой фазе) |
| `package.json.files` включает `templates` (шаблоны фаз доедут до пакета) | `package.json` |
| `vibelog doctor` проверяет инварианты MCP-реестра (не должен упасть от нового кода) | `src/cli/commands/doctor.ts`, `src/cli/diagnostics.test.mjs:27-29` |

## Не проверено (предположения)

1. **Импорт `src/mcp/tools.ts` из CLI безопасен** (нет побочных эффектов на модульном уровне, приемлемое время загрузки). Проверить: `node -e "import('./dist/mcp/tools.js').then(m=>console.log(m.listTools().length))"` и `vibelog capabilities` в пустом каталоге. При расхождении (побочка/падение) — вынести `listTools` в отдельный лёгкий модуль-реестр без импорта ядра, а `tools.ts` реэкспортирует её.
2. **Первая содержательная строка шаблона фазы годится как «назначение»** и укладывается в 120 символов для всех 11 фаз (проверено глазами для spec/plan/do/close-worktree; для prompt и остальных — нет). Проверить: прогон и вывод секции «Фазы»; при длинных/неудачных строках — добавление коротких подписей в константу `PHASE_PURPOSES` внутри `capabilities.ts` (fallback: если шаблон не прочитан, брать оттуда).
3. **Полный markdown ≤ ~8 КБ**. Оценка по числу элементов (50 инструментов + 29 команд + 11 фаз + 18 ключей settings + 16 ключей config + workflow) даёт 6-9 КБ — точная длина не измерена. Проверить: `node bin/vibelog.mjs capabilities | wc -c`. При > 10 КБ — обрезать описания (60 символов) и/или сворачивать `workflow.transitions` в компактный вид `To Do --spec--> Spec`.
4. **Расхождения реестра и роутера нет**: список команд в `CLI_COMMANDS` сверяется с `case`-ветками switch вручную. Проверить: `grep -n "    case '" src/cli/router.ts` и сравнить; при расхождении — синхронизировать реестр (или сгенерировать его из того же массива, если правок окажется много).
5. **Число строк шаблона AGENTS.md** (~22) и текущая длина (~600 символов) — измерено приблизительно по тексту функции. Проверить тестом: длина < `AGENTS_MD_MAX_CHARS - 2000`. При превышении — сокращать, но не выкидывать блок «Правила работы».
6. **Документы doc-7/doc-8 принимают новый раздел без ломки структуры** (там есть белый список H2? — для README такой тест есть, для doc-* не обнаружен). Проверить: `pnpm test:fast -- src/web/readme-standard.test.mjs` после правки доков и убедиться, что правка доков не влияет на README-тест.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 01:40
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача, не epic).
План записан в задачу. Суть: двухслойная реализация по образцу `vibelog map` (VL-235) — `src/core/capabilities.ts` (чистая сборка `CapabilitiesData` + `renderCapabilitiesMarkdown`) и тонкая CLI-обёртка `src/cli/commands/capabilities.ts` с `--json`-формой `{schemaVersion:1, kind:'capabilities', data}`.
Файлы (8): новые `src/core/capabilities.ts`, `src/cli/commands/capabilities.ts`, `src/cli/command-registry.ts` (реестр CLI-команд — источник секции «CLI-команды», а не литерал), `src/cli/capabilities-cli.test.mjs`; правки `src/cli/router.ts` (case + help), `src/core/setup.ts:306` (строка AGENTS.md → отсылка на `vibelog capabilities`), `src/cli/commands/instructions.ts` (одна строка в overview), docs doc-7/doc-8.
Источники истины по коду: `DEFAULT_WORKFLOW`/`DEFAULT_COMPLETENESS`/`SERVICE_PHASES` (src/core/workflow.ts:99,381,404), `listTools()` (src/mcp/tools.ts:149), `PHASES` + `PROJECT_PROMPTS_DIR` + `loadPhaseTemplate` (src/web/phase-prompt.ts:32,45,76,88), `defaultConfig()` (src/core/config.ts:26), контракт write-ответа (src/mcp/tool-result.ts:89-150).
Риски: (1) markdown может превысить целевые ~8 КБ — митигация: обрезка описаний до 100 симв. в markdown, полный текст только в `--json`, тест на размер; (2) импорт `src/mcp/tools.ts` в CLI — Code обязан первым шагом проверить отсутствие побочных эффектов на модульном уровне; (3) список ключей settings.json — единственная ручная константа (имена не экспортируются реестром), дрейф ограничен пометкой в плане; (4) расхождение `CLI_COMMANDS` и `case`-веток роутера — тест-инвариант.
В плане есть оба обязательных раздела: «Проверено по коду» (23 строки с файл:строка, все утверждения о существующем коде подтверждены чтением) и «Не проверено (предположения)» (6 пунктов с процедурой проверки первым шагом Code).
---
author: @agent
created: 2026-11-10 01:50
---
Фаза 3 (Code) выполнена. Коммит `1d9d89f` (ветка vb/vl-394).
## Что сделано
Новые файлы:
- `src/core/capabilities.ts` — `buildCapabilities(cwd)` (структурированные секции: workflow+source, taskWorkflows, completeness, phases из `templates/phases`, servicePhases, mcpTools из `listTools()`, cliCommands из реестра, configKeys из `defaultConfig()`, settingsKeys, access, nextSteps) + `renderCapabilitiesMarkdown(data)`.
- `src/cli/command-registry.ts` — `CLI_COMMANDS` (29 команд) и `CliCommandEntry`: единственный источник списка CLI для справочника (AC4 — не литерал в шаблоне).
- `src/cli/commands/capabilities.ts` — `runCapabilities`: markdown либо `--json` → `{schemaVersion:1, kind:'capabilities', data}`.
- `src/cli/capabilities-cli.test.mjs` — 10 тестов (mkdtemp).
Правки: `src/cli/router.ts` (import + `case 'capabilities'` + строка в `showHelp` + блок `showCommandHelp` + отсылка в help темы instructions), `src/core/setup.ts:306` (одна строка AGENTS.md → `vibelog capabilities` + `vibelog instructions`), `src/cli/commands/instructions.ts` (раздел «Полный справочник» в overview).
## Проверки
- `pnpm build` — чисто.
- **Полный прогон `pnpm test`: 205 файлов, 3990 тестов прошло, 4 skipped (pre-existing skip в `src/core/frontmatter.test.mjs`, не связан с задачей), 0 падений.** Повторный прогон `src/web/static.test.mjs` — 8/8 (перезапуск после первого захода, второй прогон зелёный).
- `node bin/vibelog.mjs capabilities` — **9740 байт** (ориентир ~8 КБ; ужато с исходных 20.6 КБ: элементы по 2–4 в строке, описания MCP — только имена, полные описания в `--json`).
- `node bin/vibelog.mjs help` — строка `capabilities` присутствует.
- `node bin/vibelog.mjs instructions overview` — отсылка на capabilities есть.
- `node bin/vibelog.mjs doctor` — все проверки ✓ (инварианты MCP-реестра не задеты).
- `vibelog capabilities --json | node -e …` — kind=capabilities, mcpTools=49, cliCommands=29.
## Отклонения от плана
1. **Размер markdown**: целевые ~8 КБ недостижимы при полном перечне 49 MCP-инструментов + 29 CLI-команд + 45 ключей. Достигнуто 9.7 КБ: имена MCP-инструментов без описаний (описания — в `--json`), CLI и ключи по 2–4 в строке. Тест держит мягкий потолок 12 КБ.
2. **Назначения фаз** берутся из таблицы `PHASE_PURPOSES` (содержательные: «изучение кода и план реализации»), а не из скобок первой строки шаблона — в шаблоне там только заголовок («Фаза 2: Plan»), бесполезный в справочнике. Шаблон по-прежнему читается (проверка наличия и переопределения в `.vibelog/prompts/phases/`).
3. **Пример секции `workflows`** в markdown — минимальный валидный (5 переходов), не полный DEFAULT_WORKFLOW: полный раздувал вывод на ~2 КБ. Пометка «сокращённо; нужны все переходы» присутствует.
## Не сделано в этой фазе (по правилам фазы)
Документация `doc-7`/`doc-8` — по инструкции фазы Code документы backlog/docs пишет Close после слияния. DoD «Документация обновлена» поэтому не отмечаю.
## Отмечены AC
Все 8 AC выполнены и покрыты тестами (`src/cli/capabilities-cli.test.mjs`): секции markdown, `--json` форма, пометка «дефолт в коде» + пример секции, совпадение списков с реестрами (`deepEqual` с `listTools()`/`CLI_COMMANDS`), справка в `--help` и `instructions overview`, тесты битого/отсутствующего settings.json, замена строки AGENTS.md, инвариант AGENTS.md (≤30 строк, запас >2000 символов до `AGENTS_MD_MAX_CHARS`).
---
author: @agent
created: 2026-11-10 01:56
---
Фаза Close выполнена. Ветка vb/vl-394 слита в master (1 коммит, merge без конфликтов), worktree удалена (force — только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-394 удалена.
## Проверки после merge
- `pnpm build` — чисто.
- Точечный фильтр: `src/cli/capabilities-cli.test.mjs`, `src/core/setup.test.mjs`.
- **Полный прогон `pnpm test` (один, полный): 206 файлов, 3998 тестов прошло, 4 skipped (pre-existing skip во frontmatter-тесте), 0 падений.** Параллельного vitest в других worktree не было (проверено до прогона).
## Документация (шаг 9)
Коммит `a65e630`: CHANGELOG.md (запись в Unreleased), doc-7 — новый раздел `vibelog capabilities`, doc-8 — отсылка «полный актуальный перечень — `vibelog capabilities --json`». README не расширялся.
## Lessons
Создан `lesson-273` «Генерируемый справочник сжимай по форме вывода, а не по составу элементов» (коммит `e8f35e5`), связан с задачей.
## DoD
1. Тесты проходят — да (полный прогон выше).
2. Документация обновлена — да (doc-7, doc-8, CHANGELOG).
3. Нет регрессий — да (сборка чиста, полный набор зелёный).
Все три пункта DoD выполнены и отмечены.
---
<!-- COMMENTS:END -->