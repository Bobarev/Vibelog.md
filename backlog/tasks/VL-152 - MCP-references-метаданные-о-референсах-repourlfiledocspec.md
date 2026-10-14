---
id: VL-152
title: 'MCP: references — метаданные о референсах (repo/url/file/doc/spec)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 09:56'
updated_date: '2026-10-14 14:50'
due_date: ''
labels:
  - core
  - mcp
  - cli
  - refs
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - .gitignore
  - AGENTS.md
  - MCP-SETUP.md
  - README.md
  - vitest.config.mts
  - scripts/clone-refs.mjs
  - src/cli/commands/doctor.ts
  - src/cli/commands/reference.ts
  - src/cli/diagnostics.test.mjs
  - src/cli/reference-cli.test.mjs
  - src/cli/router.ts
  - src/cli/update-check.ts
  - src/core/compat-full.test.mjs
  - src/core/compat.test.mjs
  - src/core/paths.ts
  - src/core/reference.ts
  - src/core/reference.test.mjs
  - src/core/worktree.test.mjs
  - src/core/worktree.ts
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/tools.ts
  - src/web/phase-prompt.test.mjs
  - src/web/phase-prompt.ts
  - templates/qwen-commands/phase-2.md
  - templates/qwen-commands/phase-3.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Управление референсами: метаданные о внешних источниках (репозитории, URL, файлы, документация, спецификации).

## Архитектура (Вариант A)

Всё, связанное с референсами, живёт внутри backlog/references/:
- `backlog/references/*.md` — метаданные (frontmatter + описание). Коммитятся в git.
- `backlog/references/data/` — клоны репозиториев. В .gitignore.

Существующая папка refs/ (создана в VL-76) переносится в backlog/references/data/ — без изменения содержимого, только путь.

## Ключевое решение: vibelog сам клонирует

`vibelog reference add --type repo --url <url>` САМ клонирует репозиторий в backlog/references/data/<dir>. Идемпотентно: если папка уже есть — пропускает.

`vibelog reference sync` — клонирует отсутствующие репозитории для всех references type=repo. Нужен для разработчиков, которые клонировали проект без data/ (папка в .gitignore).

scripts/clone-refs.mjs (VL-76) УДАЛЯЕТСЯ — его логика переезжает в MCP/CLI.

## Что нужно реализовать

1. Core-модуль src/core/reference.ts — CRUD + search + findByPath + findByTask + cloneReferenceRepo + syncReferenceRepos.
2. MCP-инструменты: reference_list, reference_add (с clone: boolean), reference_view, reference_search, reference_remove, reference_link, reference_sync.
3. CLI-команды: vibelog reference list/add/view/search/link/remove/sync.
4. Перенос refs/ → backlog/references/data/ (mv, обновление .gitignore, обновление упоминаний путей в AGENTS.md, docs, plan, тестах, doc-3).
5. Двусторонняя связь с задачами: reference.linked_tasks ↔ task.references.
6. Обновление промптов фаз: Plan читает references задачи, Code добавляет (см. раздел «Интеграция в workflow фаз» ниже).
7. Удаление scripts/clone-refs.mjs.
8. Round-trip с Backlog.md сохраняется (поле references уже есть, backlog/references/ — расширение, оригинал его игнорирует).

## Интеграция в workflow фаз (зачем и как)

### Проблема без интеграции

References — просто справочник. Агенты его не используют.

- Plan для задачи «использовать подход из vibe-kanban» НЕ ЗНАЕТ, где искать vibe-kanban. Начнёт гуглить, гадать, или спросит пользователя. Потратит токены и время.
- Code, найдя полезный источник (например, документацию Node.js fs API), НЕ СОХРАНИТ его. В следующей задаче другой агент снова будет искать то же самое.

### Решение: интеграция в фазы

#### Plan ЧИТАЕТ references

В phase-2.md (Plan) добавить шаг:
- Прочитать поле references из задачи.
- Для каждого ID вызвать reference_view.
- Для type=repo — смотреть backlog/references/data/<dir>/.
- Для type=url — web_fetch (если доступно).
- Для type=file — прочитать файл через sed/grep.
- Использовать эти источники в плане, ссылаться на них.
- Если нашёл новый релевантный источник — добавить через reference_add и связать через reference_link.

#### Code ДОБАВЛЯЕТ references

В phase-3.md (Code) добавить шаг:
- Если использовал новые внешние источники — добавить их через reference_add.
- Если использовал уже существующие — связать через reference_link.
- Обновить поле references задачи через backlog_update_task.
- Пример: backlog_update_task {id: {{taskId}}, references: [ref-5, ref-8]}

### Полный цикл (пример)

Задача VL-N: «Реализовать drag-and-drop в веб-UI»

1. Spec — уточняет постановку.
2. Plan — читает задачу. Видит references: [] (пусто). НО Plan знает, что в проекте есть ref-next-shadcn (референс на admin dashboard с drag-and-drop). Plan добавляет его в задачу: backlog_update_task {references: [ref-5]}. Plan пишет план: «Использовать @dnd-kit как в backlog/references/data/next-shadcn-admin-dashboard/».
3. Code — читает план. Видит ref-5. Открывает backlog/references/data/next-shadcn-admin-dashboard/. Копирует подход. Реализует. В отчёте — «Использован ref-5».
4. Следующая задача про drag-and-drop — Plan сразу видит ref-5 (потому что Code его записал) и НЕ ищет заново.

### Что это даёт

- Экономия токенов: агент не ищет источники заново, читает готовые.
- Точность: агент использует проверенные источники, не гадает.
- Накопление знаний: с каждой задачей база references растёт.
- Прозрачность: в задаче видно, какие источники использованы.
- Связь задача ↔ источник: vibelog reference view ref-5 показывает linked_tasks: [VL-42, VL-56, VL-78].

### Почему это ключевой пункт

Без интеграции references — мёртвый справочник. С интеграцией — живая база знаний, которая растёт с каждой задачей. Это превращает references из фичи в рабочий инструмент.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Core-модуль src/core/reference.ts: listReferences, getReference, createReference, updateReference, removeReference, searchReferences, findByPath, findByTask, cloneReferenceRepo, syncReferenceRepos
- [x] #2 7 MCP-инструментов: reference_list, reference_add (с clone: boolean, default=true для type=repo), reference_view, reference_search, reference_remove, reference_link, reference_sync
- [x] #3 CLI-команды: vibelog reference list/add/view/search/link/remove/sync
- [x] #4 References в backlog/references/<id> — <title>.md с frontmatter: id, title, type, url?, path?, tags, created_date, linked_tasks, body
- [x] #5 Типы references: repo, url, file, doc, spec
- [x] #6 vibelog reference add --type repo --url <url> сам клонирует репозиторий в backlog/references/data/<dir> (идемпотентно: если есть — пропускает)
- [x] #7 vibelog reference sync клонирует отсутствующие репозитории для всех references type=repo
- [x] #8 refs/ перенесён в backlog/references/data/; .gitignore обновлён; scripts/clone-refs.mjs удалён
- [x] #9 Двусторонняя связь: reference.linked_tasks ↔ task.references
- [x] #10 Phase-2 (Plan) читает references задачи через reference_view и использует источники в плане
- [x] #11 Phase-3 (Code) добавляет references в задачу через reference_add/reference_link
- [x] #12 Round-trip с Backlog.md сохраняется (поле references в frontmatter не меняется)
- [x] #13 Тесты: core/reference, MCP-инструменты, CLI-команды, clone/sync
- [x] #14 Документация: docs/user-guide.md, docs/cli-reference.md, docs/mcp-reference.md, обновление doc-3 (путь refs/ → backlog/references/data/)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan — VL-152: MCP references

Тип: task. Архитектура — Вариант A из описания: метаданные в `backlog/references/*.md` (в git), клоны в `backlog/references/data/` (в .gitignore).

## Файлы для изменения/создания

### 1. Core: `src/core/reference.ts` (новый, ~350 строк; образец — `src/core/document.ts`)
- `REFERENCE_TYPES = ['repo','url','file','doc','spec']`, интерфейс `Reference` { id (`ref-N`), title, type, url?, path?, tags[], created_date, linked_tasks[] }, `ReferenceEntry` { reference, body, path }.
- Формат файла: `backlog/references/<id>-<slug>.md` (frontmatter + описание); генерация slug/`nextReferenceId` — по образцу `documentFilename`/`nextDocumentId` (document.ts:69, 135).
- Функции: `listReferences`, `getReference(cwd,id)`, `createReference/writeReference`, `updateReference`, `removeReference`, `searchReferences(query — substring по id/title/url/tags/body)`, `findByPath(cwd, path)` (префикс `path` или data-каталога репо), `findByTask(cwd, taskId)` (linked_tasks содержит taskId).
- `cloneReferenceRepo(cwd, ref)`: `spawnSync('git', ['clone','--depth','1', url, dataDir/<dir>])` (образец — git.ts:217, spawnSync + encoding utf-8). Идемпотентно: `existsSync(dataDir)` → skip с сообщением «уже клонирован». Ошибка clone не роняет список (сообщение + продолжить).
- `syncReferenceRepos(cwd)`: обход `listReferences` где type=repo, clone отсутствующих; возвращает {cloned:[], skipped:[], failed:[]}.
- `linkReferenceTask(cwd, refId, taskId, action: 'add'|'remove')` — двусторонняя связь: правит `linked_tasks` референса (updateReference) И `references` задачи (updateTaskFile, поле Task.references уже есть — task.ts:71).

### 2. `src/core/paths.ts`
- Добавить `referencesDir(backlogDir)` → `join(backlogDir,'references')` и `referencesDataDir(backlogDir)` (после milestonesDir, ~стр. 115).

### 3. MCP: `src/mcp/tools.ts`
- 7 tool-описаний в `listTools()` (вставить перед `];`, ~стр. 368, после backlog_finish_phase): `reference_list` (фильтры type/tags), `reference_add` (title, type, url?, path?, tags?, description?, clone:boolean default=true для repo), `reference_view` (id — метаданные+linked_tasks+body), `reference_search` (query), `reference_remove` (id), `reference_link` (referenceId, taskId, action add|remove), `reference_sync`.
- 7 case в `handleToolCall` (перед default, ~стр. 428) + 7 handler-функций после `toolDocumentSearch` (~стр. 1121) — JSON-ответы по образцу document_*.
- `toolUpdateTask` (стр. 561): добавить `if (args.references !== undefined) updates.references = args.references as string[];` + свойство в inputSchema `backlog_update_task` (~стр. 127) — нужно для фазы Code (AC11) и двусторонней связи.

### 4. CLI: `src/cli/commands/reference.ts` (новый, образец — `src/cli/commands/doc.ts`)
- Подкоманды `list [--type T] [--tags a,b] [--json]`, `add "Title" [--type repo|url|file|doc|spec] [--url ...] [--path ...] [--tags ...] [-d desc] [--no-clone]`, `view <id>`, `search <query>`, `link <refId> <taskId> [--remove]`, `remove <id>`, `sync`.
- `src/cli/router.ts`: import (~стр. 32), `case 'reference'` (~стр. 101), строка в `showHelp()` (~стр. 135), help-текст в `showCommandHelp` (после doc, ~стр. 240).

### 5. Миграция refs/ → backlog/references/data/
- В ГЛАВНОМ репо (refs/ — untracked, в worktree его нет): `mkdir -p backlog/references && mv refs backlog/references/data`.
- `.gitignore` (стр. 3-4): комментарий + `refs/` → `backlog/references/data/`.
- `vitest.config.mts` стр. 25: exclude `refs/**` → `backlog/references/data/**` (комментарий стр. 22 тоже).
- `AGENTS.md` стр. 69, 83: `refs/Backlog.md` → `backlog/references/data/Backlog.md`.
- `src/core/compat.test.mjs` стр. 25 и `src/core/compat-full.test.mjs` стр. 29: BACKLOG_ROOT → `backlog/references/data/Backlog.md`.
- `src/core/worktree.ts` `linkWorktreeDeps` (стр. 129-146): звенить `backlog/references/data` вместо `refs` — для вложенного пути mkdirSync(dirname(link), recursive) перед symlinkSync; цикл заменить на список относительных путей ['node_modules', 'backlog/references/data']. Комментарий стр. 111 обновить.
- `src/core/worktree.test.mjs` стр. 136-160: пути теста → backlog/references/data.
- `scripts/clone-refs.mjs` — удалить; его REPOS-список (12 репо с URL) использовать для создания 12 metadata-файлов `backlog/references/ref-N-*.md` (id ref-1..ref-12, type=repo, path=data/<dir>) — одна команда `vibelog reference add` на репо или ручная генерация через CLI.
- `src/cli/update-check.ts` стр. 5 (комментарий): путь референса обновить.

### 6. Интеграция в фазы
- `src/web/phase-prompt.ts` `taskExtraVars` (стр. 127-141): добавить `taskReferences: (task.references && task.references.length > 0) ? task.references.join(', ') : '(нет)'`.
- `templates/qwen-commands/phase-2.md`: в блок «Задача фазы»/шаг 2 — прочитать `{{taskReferences}}`; для каждого ID — `reference_view`; type=repo → читать `backlog/references/data/<dir>/`; type=url → web_fetch если доступен; type=file → sed/grep; использовать источники в плане со ссылками; нашёл новый релевантный — `reference_add` + `reference_link`.
- `templates/qwen-commands/phase-3.md`: новый шаг — использовал внешние источники → `reference_add` (новые) / `reference_link` (существующие), затем `backlog_update_task {id, references:[...]}`.
- `src/web/phase-prompt.test.mjs`: стр. 41-42 дефолты + `taskReferences: '(нет)'`; стр. 122, 170: 9 → 10 подстановок; отдельная проверка, что `{{taskReferences}}` есть в phase-2.md и phase-3.md (остальные шаблоны — не обязана).

### 7. Счётчики инструментов 22 → 29
- `src/mcp/documents.test.mjs` стр. 61; `src/mcp/server.test.mjs` стр. 136; `src/core/compat-full.test.mjs` стр. 180-182 (длина + имена: добавить reference_*); `src/cli/diagnostics.test.mjs` стр. 137; `src/cli/commands/doctor.ts` стр. 247 (expected=22 → 29).
- `README.md` стр. 49: «22 MCP-инструмент» → 29. `MCP-SETUP.md` стр. 29: «Всего 16» → 29.

### 8. Тесты (новые)
- `src/core/reference.test.mjs`: CRUD, search, findByPath/findByTask, ссылка двусторонняя (linked_tasks ↔ task.references), round-trip frontmatter, clone из ЛОКАЛЬНОГО репо (git init в mkdtemp + file:// URL — без сети), идемпотентность clone, sync (cloned/skipped/failed).
- `src/mcp/reference-tools.test.mjs`: 7 инструментов через listTools/handleToolCall, clone default, валидация типа, ссылка на задачу.
- `src/cli/reference-cli.test.mjs`: все подкоманды через spawn CLI (образец — documents.test.mjs).

### 9. Документация (через MCP document_update — backlog/ живёт в главном репо, в worktree не коммитится)
- doc-6 (руководство): раздел References.
- doc-7 (CLI-справочник): `vibelog reference ...`.
- doc-8 (MCP-справочник): 7 reference_*-инструментов; 22 → 29.
- doc-3: пути `refs/<dir>` → `backlog/references/data/<dir>`; вместо `node scripts/clone-refs.mjs` — `vibelog reference sync`; ссылка на новую структуру `backlog/references/`.

## Порядок действий
1. paths.ts → core/reference.ts → core тесты.
2. MCP tools + счётчики (22→29) + MCP тесты.
3. CLI reference.ts + router + CLI тесты.
4. toolUpdateTask references-passthrough + inputSchema.
5. Миграция (в главном репо): mv refs, .gitignore, worktree.ts + тест, compat-тесты пути, AGENTS.md, удаление scripts/clone-refs.mjs, создание ref-1..ref-12 metadata.
6. phase-prompt.ts + шаблоны phase-2/3 + их тесты.
7. Документы doc-3/6/7/8 + README/MCP-SETUP счётчики.
8. Финальная проверка.

## Проверка
```bash
pnpm build && pnpm test          # полный прогон
node bin/vibelog.mjs reference --help
node bin/vibelog.mjs reference list
node bin/vibelog.mjs reference sync   # в главном репо с data/
```

## Риски
- **Симлинк worktree**: worktree не имеет backlog/references/data (gitignore) — linkWorktreeDeps должен mkdir -p вложенных родителей перед symlink; если каталог в worktree уже занят — не трогать (linkTaken).
- **Клонирование в тестах** — только локальные file://-репозитории; сеть запрещена test-setup guard'ом, spawn git её не видит, но реальные URL в тестах недопустимы.
- **Счётчики 22→29** разбросаны по 5 файлам — пропуск любого уронит CI; проверить grep'ом `22` в src/ после правок.
- **Миграция в worktree невозможна** (refs/ untracked отсутствует в ветке) — mv выполняется в главном репозитории; compat-тесты в ветке пропускаются (BACKLOG_EXISTS=false → skip), после merge заработают.
- **Round-trip с Backlog.md**: поле references в frontmatter задач не меняется (только чтение/дописывание существующего поля) — оригинал игнорирует backlog/references/ как незнакомую директорию.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 10:30
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в VL-152: core-модуль src/core/reference.ts (10 функций, cloneReferenceRepo через spawnSync git clone --depth 1, идемпотентно), 7 MCP-инструментов (tools.ts: listTools +368, handleToolCall +428, handlers после toolDocumentSearch), CLI vibelog reference (новый commands/reference.ts + router.ts), toolUpdateTask — passthrough поля references. Миграция: mv refs → backlog/references/data (в главном репо), .gitignore, vitest.config.mts, compat-тесты, worktree.ts linkWorktreeDeps → backlog/references/data, удаление scripts/clone-refs.mjs, создание ref-1..ref-12 из его REPOS-списка. Интеграция фаз: taskReferences в taskExtraVars + шаги в phase-2.md/phase-3.md. Счётчики инструментов 22→29 в 5 файлах + README/MCP-SETUP. Новые тесты: core/reference, mcp/reference-tools, cli/reference-cli (clone — только локальные file://-репо). Документы doc-3/6/7/8 — через MCP document_update. Файлов: ~20 (7 новых). Риски: симлинки worktree (вложенный mkdir -p), разброс счётчиков 22→29, миграция только в главном репо (compat-тесты в ветке skip).
---
author: @agent
created: 2026-10-14 14:15
---
Фаза 3 (Code) выполнена. Изменено: 27 файлов (+1609/−122), коммит ebd1146 (ветка vb/vl-152). Реализовано: core/src/reference.ts (462 строки, все 10 функций + linkReferenceTask для двусторонней связи linked_tasks ↔ task.references), 7 MCP-инструментов reference_* (tools.ts, счётчики 22→29 обновлены в doctor/diagnostics/documents/server/compat-full тестах), CLI vibelog reference list/add/view/search/link/remove/sync (commands/reference.ts + router + help), toolUpdateTask — passthrough references (+ в inputSchema), taskReferences в taskExtraVars, шаги Plan/Code в phase-2.md/phase-3.md, worktree.ts симлинки node_modules + backlog/references/data (вложенный mkdir -p), .gitignore: backlog/references/data/, scripts/clone-refs.mjs УДАЛЁН, AGENTS.md/README/MCP-SETUP — пути и счётчики обновлены. Тесты: 1006 passed / 5 skipped, 57 файлов — полный pnpm test зелёный (новые reference.test.mjs, reference-tools.test.mjs, reference-cli.test.mjs — clone/sync на локальных file://-репо). НЕ сделано (пост-merge шаги в главном репо, shell worktree ограничен): (а) mv refs/ → backlog/references/data/ — refs/ untracked отсутствует в ветке, команда: mkdir -p backlog/references && mv refs backlog/references/data; (б) создание 12 metadata-файлов ref-1..ref-12 (список репо — из удалённого scripts/clone-refs.mjs, он в истории git: Backlog.md, next-shadcn-admin-dashboard, vibe-kanban, typescript-sdk, mastra, pi, gemini-cli, opencode, cline, hermes-agent, openclaw, qwen-code) — после (а) достаточно vibelog reference sync, но метаданные добавить через reference add; (в) doc-3/6/7/8 — Фаза 3 не обновляет backlog/docs по правилам (пишет Close); README/MCP-SETUP обновлены в ветке. После merge (а)+(б) оживут compat-тесты (сейчас skip: BACKLOG_EXISTS=false).
---
author: @agent
created: 2026-10-14 14:50
---
Фаза Close выполнена. Ветка vb/vl-152 слита в master (1 коммит ebd1146, --no-ff), сборка и тесты после merge зелёные (1006 passed / 5 skipped + после миграции compat-тесты ожили: 29 passed). Worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена.

Пост-merge шаги в главном репо (выполнены здесь, т.к. в ветке были недоступны):
- refs/ перенесён в backlog/references/data/ (mv); .gitignore и vitest.config.mts уже указывали на новый путь после merge.
- Созданы 12 metadata-файлов ref-1..ref-12 (Backlog.md, next-shadcn-admin-dashboard, vibe-kanban, typescript-sdk, mastra, pi, gemini-cli, opencode, cline, hermes-agent, openclaw, qwen-code) через `vibelog reference add --type repo --no-clone`; `vibelog reference sync` подтверждён (клонировано 0, пропущено 12, ошибок 0). AC8 отмечен.
- Документация: doc-3 (пути refs/ → backlog/references/, вместо clone-refs.mjs — `vibelog reference sync`, id референсов), doc-6 (раздел «13. Референсы» + счётчик 29), doc-7 (секция `vibelog reference ...`), doc-8 (7 инструментов reference_*, поле references в backlog_update_task, 22→29). AC14 отмечен.
- CHANGELOG.md — запись в Unreleased.

Docs-коммиты: 0ee4bd9 (CHANGELOG + doc-3/6/7/8), 4893e18 (переименование doc-3 + metadata ref-1..ref-12).

DoD: тесты проходят ✓, нет регрессий ✓, документация обновлена ✓ — отмечены все 3 пункта.
---
<!-- COMMENTS:END -->