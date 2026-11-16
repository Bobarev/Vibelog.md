---
id: VL-418
title: 'MCP `reference_tasks`: чтение задач из reference-клона — сейчас чужой backlog доступен только через `read_file` по путям, без фильтра по статусу и с обрезкой листинга на 200'
status: Review
assignee: []
reporter: ''
created_date: '2026-11-10 22:38'
updated_date: '2026-11-10 23:57'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/reference-tasks.ts
  - src/core/reference-tasks.test.mjs
  - src/mcp/reference-tasks-tool.ts
  - src/mcp/reference-tasks-tool.test.mjs
  - src/mcp/tools.ts
  - src/core/tool-kinds.ts
  - src/cli/commands/instructions.ts
  - src/cli/diagnostics.test.mjs
  - src/core/compat-full.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - MCP-SETUP.md
lessons: []
token_usage:
  input: 4442616
  output: 23654
  cache: 4335104
  total: 4466270
  requests: 56
  duration_ms: 829055
  reasoning: 6858
  by_phase:
    code:
      input: 4247760
      output: 22332
      cache: 4151808
      requests: 51
    close:
      input: 194856
      output: 1322
      cache: 183296
      requests: 5
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Агент из проекта Vibelog UI назвал это «самым больным»: `backlog_view_task` и `backlog_list_tasks` жёстко привязаны к `findBacklogDir(cwd)`, поэтому задачи чужого проекта он смотрел через `read_file` по путям. В `backlog/tasks/` 383 файла — листинг обрезается на 200 записей, и нет способа спросить «покажи открытые задачи Vibelog» или «что нового с прошлого раза».

**Что есть сейчас:**
- `backlog_list_tasks` / `backlog_view_task` — только текущий проект (`findBacklogDir(cwd)`).
- `reference_view` — метаданные референса + `linked_tasks` + тело, но не задачи клона.
- `read_file` по `backlog/references/data/<dir>/backlog/tasks/*.md` — работает, но: листинг обрезается на 200, нет фильтра по статусу/метке, нет парсинга фронтматтера (агент читает сырой markdown и разбирает сам).

**Цель.** Read-only инструмент `reference_tasks`, который читает задачи из клона референса и отдаёт их как задачи: фильтр по статусу/меткам/типу, лимит, сортировка, и `reference_task_view` (или параметр `id`) для деталей.

**Что уже есть (не дублировать):**
- `referenceCloneDir(cwd, ref)` — `src/core/reference.ts:472`, резолвит каталог клона из `path`/`url`.
- `markdownToTask(content)` — `src/core/task.ts:319`, парсит markdown-файл задачи в `Task` (id, title, status, priority, labels, description, AC, plan, …). Работает на произвольном тексте, привязки к cwd нет.
- `listTasks(cwd)` — `src/core/store.ts:35`, но принимает **cwd** и сам ищет `backlog/`; для клона нужен вариант, принимающий каталог напрямую (или локальный обход `readdirSync` + `markdownToTask`).
- `getTask(cwd, id)` — `src/core/store.ts:52`, та же привязка к cwd.
- `resolveInProject` (`src/agent/tools.ts`) — образец защиты от выхода за границы; здесь нужен аналог для клона.

**Главный риск — безопасность.** Инструмент открывает чтение **чужого** репозитория. Путь обязан резолвиться только через `referenceCloneDir` (никаких `../`, абсолютных путей, симлинков наружу). Это тот же класс, что VL-360 (`slugify` от не-ASCII ломал сравнение путей) и `assertExplicitPath` в `upstream-git.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новый `src/core/reference-tasks.ts`: `listCloneTasks(cloneDir, opts)` и `getCloneTask(cloneDir, id)` — без cwd, без поиска `backlog/`, парсинг через `markdownToTask`
- [x] #2 Фильтры: `status` (точное, case-insensitive), `labels` (AND), `type`; `includeCompleted` добавляет `backlog/completed/`; пустой `labels` не фильтрует
- [x] #3 `limit` (дефолт 50, максимум 200) применяется после сортировки; ответ содержит `total` (полное число совпадений) и `returned`
- [x] #4 Сортировка: `id` — натуральная (`VL-9` < `VL-10` < `VL-100`), `updated` — по `updated_date` убыв., `priority` — High → Medium → Low → пусто
- [x] #5 MCP `reference_tasks` (read) и `reference_task_view` (read) зарегистрированы в `listTools()`, объявлены в `TOOL_KINDS`, счётчик реестра обновлён
- [x] #6 Путь клона резолвится ТОЛЬКО через `referenceCloneDir`; аргумента `path`/`dir` в схеме нет; `realpath`-проверка не даёт выйти за `references/data/` (симлинк наружу → отказ)
- [x] #7 `type !== 'repo'` → `ackError` «только type=repo»; клон отсутствует → `ackError` с подсказкой `reference_sync`; неизвестный ref → `ackError`
- [x] #8 `reference_task_view` на неизвестный id → `ackError` со списком ближайших ID
- [x] #9 Тесты: новый `src/core/reference-tasks.test.mjs` (фильтры, лимит, натуральная сортировка, completed, пустой каталог) и `src/mcp/reference-tasks-tool.test.mjs` (ошибки, симлинк наружу, TOOL_KINDS)
- [ ] #10 Документация: doc-8 (оба инструмента + оговорка «`since` нет, используйте `sort: 'updated'`»), MCP-SETUP.md, doc-6 §13, CHANGELOG.md
- [x] #11 `pnpm build && pnpm test` — зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Шаги

### 1. `src/core/reference-tasks.ts` (новый модуль)

Ядро без MCP-зависимостей — по образцу `src/core/reference.ts` (чистые функции, тестируются без сервера).

```ts
export interface CloneTasksOptions {
  status?: string;
  labels?: string[];
  type?: string;
  limit?: number;      // дефолт 50, максимум 200
  sort?: 'id' | 'updated' | 'priority';
  includeCompleted?: boolean;  // читать и backlog/completed/
}
export function listCloneTasks(cloneDir: string, opts?: CloneTasksOptions): Task[]
export function getCloneTask(cloneDir: string, id: string): Task | null
```

- `cloneDir` — **уже резолвленный** абсолютный путь (резолв делает вызывающий слой, см. шаг 2). Модуль не принимает cwd и не ищет `backlog/` — это разделяет ответственность и делает его тестируемым на `mkdtemp`.
- Обход: `join(cloneDir, 'backlog', 'tasks')` + опционально `'completed'`; `readdirSync().filter(f => f.endsWith('.md'))`; `markdownToTask(readFileSync(...))`.
- Фильтры — точное совпадение по `status` (case-insensitive), AND по `labels`, точное по `type`. Пустой массив `labels` = без фильтра.
- `limit` — после сортировки; по умолчанию 50 (не 200: агент обычно спрашивает «открытые», а не «все»).
- `sort: 'updated'` — по `updated_date` убыв.; `'priority'` — High → Medium → Low → пусто; `'id'` — натуральная сортировка (`VL-9` < `VL-10`, не лексикографическая — иначе `VL-100` встанет перед `VL-11`).
- `getCloneTask` — поиск по префиксу имени файла (`<ID> - `), как в `getTask` (`src/core/store.ts:52`), но без cwd.

### 2. Резолв пути — единственная точка входа

В `src/mcp/reference-tools.ts` (или новом `src/mcp/reference-tasks-tool.ts`):

```ts
function resolveCloneDir(cwd: string, refId: string): string {
  const entry = getReference(cwd, refId);
  if (!entry) throw new Error(`Reference ${refId} не найден.`);
  const ref = entry.reference;
  if (ref.type !== 'repo') throw new Error(`Reference ${refId}: задачи читаются только из type=repo (сейчас ${ref.type}).`);
  const dir = referenceCloneDir(cwd, ref);   // единственный источник пути
  if (!existsSync(dir)) throw new Error(`Reference ${refId}: клон не найден (${dir}). Выполните reference_sync.`);
  return dir;
}
```

**Инвариант безопасности:** путь приходит только из `referenceCloneDir`; аргумент `path`/`dir` в схеме инструмента **отсутствует** — модель не может подсунуть произвольный путь. Дополнительно: `realpathSync(dir)` и проверка, что результат начинается с `realpathSync(referencesDataDir(backlogDir))` — защита от симлинка, ведущего наружу (тот же класс, что `resolveInProject`).

### 3. MCP-инструменты

**`reference_tasks`** (read):
```
{ reference: 'ref-N' (required), status?, labels?, type?, limit?, sort?, includeCompleted? }
```
Ответ — `ackRead` с `{ reference, cloneDir, total, returned, tasks: [...] }`. `total` — сколько всего совпало до `limit` (чтобы агент знал, что список усечён, — прямая замена обрезанному листингу на 200).

**`reference_task_view`** (read):
```
{ reference: 'ref-N' (required), id: 'VL-123' (required) }
```
Ответ — `ackRead` с полной задачей (включая `description`, `acceptanceCriteria`, `implementationPlan`, `finalSummary`). Неизвестный id → `ackError` со списком ближайших ID (по префиксу), чтобы агент не гадал.

Регистрация: `listTools()` (+2), `TOOL_KINDS.reference_tasks = 'read'`, `TOOL_KINDS.reference_task_view = 'read'`, группа «References» в `MCP_GROUPS`, счётчик реестра в `doctor` и 5 тест-файлах.

### 4. «Что нового с прошлого раза» — не в этой задаче

Полноценный `since` требует хранения отметки последней синхронизации. Это делает VL-417 (`diffReferenceClone` уже отдаёт added/removed/statusChanged по diff двух коммитов). Здесь достаточно `sort: 'updated'` + `limit` — агент видит свежие задачи первыми. Явно записать это в doc-8, чтобы не искали `since` в схеме.

### 5. Тесты

`src/core/reference-tasks.test.mjs` (новый, `mkdtemp` + фикстуры задач):
- листинг из `backlog/tasks/`, `includeCompleted: true` добавляет `completed/`;
- фильтр по статусу, по меткам (AND), по типу;
- `limit` усекает, `total` показывает полное число;
- сортировка `id` натуральная (`VL-9` < `VL-10` < `VL-100`);
- `sort: 'updated'` и `'priority'`;
- `getCloneTask` находит по ID, неизвестный → `null`;
- каталог без `backlog/tasks/` → пустой массив, не исключение.

`src/mcp/reference-tasks-tool.test.mjs` (новый):
- `reference_tasks` на несуществующем ref → `ackError`;
- ref с `type: url` → `ackError` с текстом «только type=repo»;
- клон отсутствует → `ackError` с подсказкой `reference_sync`;
- успешный вызов возвращает `total`/`returned`/`tasks`;
- `reference_task_view` находит задачу, неизвестный id → `ackError` со списком;
- **симлинк из клона наружу → отказ** (проверка `realpath`);
- `TOOL_KINDS` обоих инструментов = `read`.

### 6. Документация

- doc-8: разделы `reference_tasks` и `reference_task_view`, счётчик инструментов, явная оговорка «`since` нет — используйте `sort: 'updated'` + `reference_sync` (VL-417)».
- MCP-SETUP.md: две строки в таблице.
- doc-6 (§13 references): «задачи чужого проекта читаются через `reference_tasks`, а не `read_file` по путям».
- CHANGELOG.md: буллет.

## Как проверить

```
pnpm build && pnpm test
```

Ручной кейс: `vibelog reference add "Vibelog" --type repo --url <url>` → `reference_sync` → `reference_tasks {reference: 'ref-N', status: 'Planned', limit: 20}` возвращает 20 задач с `total: <полное число>`; `reference_task_view {reference: 'ref-N', id: 'VL-416'}` отдаёт полную задачу.

## Риски

- **Чтение чужого репозитория.** Митигация: путь только из `referenceCloneDir`, `realpath`-проверка на выход за `references/data/`, в схеме нет аргумента пути. Тест на симлинк обязателен.
- **383 файла × `markdownToTask` на каждый вызов** — парсинг всех задач при каждом запросе. Замер: `listTasks` на 400 задачах в `vibelog status` уже работает (VL-341), это единицы миллисекунд. Кэш не нужен; если станет медленно — кэш по `mtime` каталога отдельной задачей.
- **Расхождение формата.** Чужой проект может быть на другой версии Vibelog/Backlog.md — `markdownToTask` терпим к отсутствующим полям, но `status` может быть незнакомым. Не валидировать статус по конфигу **своего** проекта: фильтр — простое сравнение строк.
- **`limit` по умолчанию 50** может скрыть нужное. Митигация: `total` в ответе + текст «показано 50 из 383» в `message`.
- **Дублирование с VL-417.** Обе задачи трогают `src/core/reference*.ts` и `src/mcp/reference-tools.ts`. Порядок: VL-417 (sync/diff) → VL-418 (чтение задач), либо наоборот, но не параллельно.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 23:55
---
Фаза 3 (Code) выполнена. Коммит 4dea8e6.
**Что сделано:**
- `src/core/reference-tasks.ts` (новый) — ядро без cwd: `listCloneTasks(cloneDir, opts)` → `{tasks, total}`, `getCloneTask(cloneDir, id)`, `suggestCloneTaskIds`, `naturalCompare`. Парсинг через `markdownToTask`, отсутствующий каталог/битый файл — не исключение.
- `src/mcp/reference-tasks-tool.ts` (новый) — `resolveCloneDir` (единственная точка пути: `getReference` → проверка `type=repo` → `referenceCloneDir` → `existsSync` → `realpathSync` внутри `realpathSync(referencesDataDir)`), `toolReferenceTasks`, `toolReferenceTaskView`. В схемах НЕТ аргумента `path`/`dir`.
- `src/mcp/tools.ts` — регистрация `reference_tasks` / `reference_task_view` в `listTools()` + dispatch-ветки.
- `src/core/tool-kinds.ts` — оба `read`; `src/cli/commands/instructions.ts` — группа «References».
- Счётчик реестра 56 → 58 синхронизирован в 5 тест-файлах (`compat-full`, `documents`, `reference-tools`, `server`, `diagnostics` EXPECTED_MCP_TOOLS).
- `MCP-SETUP.md` — две строки в таблице.
**Тесты:** новые `src/core/reference-tasks.test.mjs` (17 тестов: фильтры status/labels-AND/type, пустой labels, includeCompleted, лимит+total, натуральная сортировка VL-9<VL-10<VL-100, updated/priority, getCloneTask, пустой каталог) и `src/mcp/reference-tasks-tool.test.mjs` (13 тестов: неизвестный ref, type=url, отсутствующий клон, **симлинк наружу → отказ**, успешный листинг с total/returned, фильтры, view, ближайшие ID, TOOL_KINDS, отсутствие path/dir в схеме).
**Проверки:** `pnpm build` — ок; полный `pnpm test` — 227 файлов / 4355 тестов passed, 4 skipped (skipped — предсуществующие в `frontmatter.test.mjs`), 0 failed. Прогон полный, без `--exclude`/`--skip`.
**Что осталось (AC10, DoD2):** doc-8 (разделы обоих инструментов + оговорка «`since` нет — используйте `sort: 'updated'` + `reference_sync`»), doc-6 §13 и CHANGELOG.md — по правилам фазы Code документация backlog/docs и CHANGELOG в Code НЕ обновляются, их пишет фаза Close после merge. MCP-SETUP.md обновлён здесь. Поэтому AC10 и DoD2 оставлены незакрытыми.
---
author: @agent
created: 2026-11-10 23:56
---
Фаза Close прервана: конфликт слияния vb/vl-418 → master. Конфликтные пути (git diff --name-only --diff-filter=U): MCP-SETUP.md, src/core/compat-full.test.mjs, src/mcp/documents.test.mjs, src/mcp/reference-tools.test.mjs, src/mcp/server.test.mjs. Все они вне разрешённого множества (CHANGELOG.md, backlog/docs/*) — резолв в фазе Close запрещён, `git merge --abort` не выполнялся, merge остаётся в состоянии «в процессе» в главном репозитории.
Причина конфликтов: обе стороны правили счётчик реестра MCP-инструментов (56 → 58) в одних и тех же тест-файлах и таблицу MCP-SETUP.md — в master уже есть аналогичные правки от соседней задачи (VL-417).
Что нужно сделать человеку/агенту, чтобы повторить Close:
1. В главном репозитории разрешить конфликты вручную в 5 файлах: MCP-SETUP.md, src/core/compat-full.test.mjs, src/mcp/documents.test.mjs, src/mcp/reference-tools.test.mjs, src/mcp/server.test.mjs — счётчик инструментов должен стать единым актуальным числом (58 + возможные инструменты из master), таблица MCP-SETUP.md должна содержать строки обеих задач.
2. `git add` разрешённых файлов и `git commit --no-edit` (завершить merge), либо `git merge --abort` и перезапустить Close после ручного ребейза ветки vb/vl-418 на master.
3. Повторить Фазу Close (новым раном).
DoD и статус не менялись: задача остаётся в Review, AC10 (документация doc-8/doc-6/CHANGELOG) и DoD2 по-прежнему не закрыты.
---
author: @agent
created: 2026-11-10 23:57
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-418 → master. Конфликтные пути (git diff --name-only --diff-filter=U): MCP-SETUP.md, src/core/compat-full.test.mjs, src/mcp/documents.test.mjs, src/mcp/reference-tools.test.mjs, src/mcp/server.test.mjs. Все они вне разрешённого множества (CHANGELOG.md, backlog/docs/*) — резолв в фазе Close запрещён, `git merge --abort` не выполнялся, merge остаётся в состоянии «в процессе» в главном репозитории.

Причина конфликтов: обе стороны правили счётчик реестра  — статус возвращён к Review.
---
<!-- COMMENTS:END -->