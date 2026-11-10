---
id: VL-416
title: 'MCP: read-only `git_status` и точный фильтр по тегам в `document_list` — агенту не видно незакоммиченного и не спросить «все документы с тегом X»'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 22:33'
updated_date: '2026-11-10 23:16'
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
  - src/mcp/git-status.ts
  - src/mcp/git-status.test.mjs
  - src/mcp/tools.ts
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/core/status.ts
  - src/core/tool-kinds.ts
  - src/core/compat-full.test.mjs
  - src/cli/commands/doctor.ts
  - src/cli/commands/instructions.ts
  - src/cli/diagnostics.test.mjs
  - MCP-SETUP.md
lessons:
  - lesson-256
token_usage:
  input: 5543452
  output: 24599
  cache: 5423104
  total: 5568051
  requests: 85
  duration_ms: 1667420
  reasoning: 6833
  by_phase:
    code:
      input: 3772553
      output: 17110
      cache: 3695104
      requests: 51
    close:
      input: 1770899
      output: 7489
      cache: 1728000
      requests: 34
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Агент из проекта Vibelog UI (отчёт UI-1, принят как VL-388) перечислил, чего ему не хватает при работе с чужими backlog. Два пункта дешёвые и закрываются одной задачей.

**1. git-статус.** `git_commit` есть, а посмотреть, что не закоммичено, — нет. В той сессии незакоммиченные настройки заметил человек, а не агент: инструмента для чтения состояния рабочего дерева не существует.

**2. Поиск по тегам документов.** `document_search` и `document_list {query}` ищут подстрокой по id/title/type/tags/телу. «Все документы с тегом `week`» не спросить: подстрока `week` найдёт и `weekly-report`, и совпадение в теле. Нужен точный фильтр по тегам.

**Что уже есть (не дублировать):**
- `src/core/status.ts` — `collectStatus(cwd, {noGit})` уже возвращает секцию `git: StatusGit | null` (`branch`, `changed`, `untracked`, `ahead`, `behind`, `upstream`, `error`), собранную через `spawnSync('git', …)` без shell. Новый git-код не нужен — нужна MCP-обёртка.
- `src/core/document.ts` — `listDocuments(backlogDir)` отдаёт `DocumentEntry[]` с `document.tags: string[]`. Фильтр по тегам — чистая функция поверх готового списка.

**Цель:** read-only `git_status` и точный фильтр `tags` (+ опциональный `excerpt`) в `document_list`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MCP-инструмент `git_status` зарегистрирован в `listTools()`, объявлен как `read` в `TOOL_KINDS`, счётчик реестра обновлён во всех тест-файлах
- [x] #2 `git_status` возвращает branch/changed/untracked/ahead/behind; вне git-репозитория — `git: null` и `ok: true` (не ошибка); сбой git — `ackError` с исходным текстом
- [x] #3 `git_status {paths}` ограничивает вывод явными путями (без shell, пути в пределах проекта)
- [x] #4 `document_list {tags}` фильтрует по точному совпадению тега (case-insensitive, AND по нескольким), `tags: ['week']` не матчит `weekly`
- [x] #5 `tags: []` не фильтрует; `query` и `tags` комбинируются через AND
- [x] #6 `document_list {excerpt: N}` отдаёт первые N символов тела; без аргумента тело не отдаётся
- [x] #7 Тесты: новый `src/mcp/git-status.test.mjs` (чисто/грязно/untracked/вне git/paths/TOOL_KINDS) и кейсы тегов в `src/mcp/documents.test.mjs`
- [x] #8 Документация: doc-8 (раздел `git_status`, обновлённое описание `document_list`), MCP-SETUP.md, CHANGELOG.md
- [x] #9 `pnpm build && pnpm test` — зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст

Агент из другого проекта (Vibelog UI) в отчёте перечислил, чего ему не хватает. Два пункта — дешёвые и закрываются одной задачей:

1. **git-статус.** `git_commit` есть, а посмотреть, что не закоммичено, — нет. В той сессии незакоммиченные настройки заметил человек, а не агент.
2. **Поиск по тегам документов.** `document_search`/`document_list {query}` ищут подстрокой по id/title/type/tags/телу — «все документы с тегом `week`» не спросить: подстрока `week` найдёт и `weekly-report`, и текст в теле.

## Что уже есть (не дублировать)

- `src/core/status.ts` — `collectStatus(cwd, {noGit})` уже возвращает секцию `git: StatusGit | null` (`branch`, `changed`, `untracked`, `ahead`, `behind`, `upstream`, `error`). Собирается через `spawnSync('git', …)` без shell, каждая секция в своём try/catch. **Новый git-код писать не нужно** — нужна MCP-обёртка.
- `src/core/document.ts` — `listDocuments(backlogDir)` отдаёт `DocumentEntry[]` с `document.tags: string[]`. Фильтр по тегам — чистая функция поверх готового списка.

## Шаги

### 1. `git_status` (MCP, read)

- Новый файл `src/mcp/git-status.ts` (по образцу `src/mcp/git-commit.ts` — отдельный модуль, не раздувать `tools.ts`).
- Хендлер: `collectStatus(cwd, { noGit: false })`, вернуть `ackRead` с `{ git, branch, changed, untracked, ahead, behind, upstream }`.
- `git === null` (не git-репозиторий) — **не ошибка**: `ackRead` с `git: null` и текстом «не git-репозиторий».
- `git.error` — `ackError` с исходным текстом (сбой git не выдавать за «чисто»).
- Опциональный аргумент `paths?: string[]` — если передан, дополнительно вернуть `git status --porcelain -- <paths>` по явным путям (тот же `spawnSync`, без shell, пути через `resolveInProject`). Нужно для вопроса «грязен ли файл задачи перед коммитом».
- Регистрация: `listTools()` (+1), `TOOL_KINDS.git_status = 'read'`, группа «Прочее» в `MCP_GROUPS` (`src/cli/commands/instructions.ts`), счётчик реестра в `doctor` и в тестах (`compat-full`, `server`, `reference-tools`, `documents`, `diagnostics`).

### 2. `document_list { tags }` — точный фильтр

- `src/mcp/tools.ts:2629` `toolDocumentList`: добавить аргумент `tags?: string[]`.
- Семантика — **AND по точному совпадению** (case-insensitive), не подстрока: `tags: ['week']` не должен матчить `weekly`. Нормализация: `trim().toLowerCase()` с обеих сторон.
- `query` и `tags` комбинируются через AND (оба фильтра применяются последовательно).
- Пустой массив `tags: []` — фильтра нет (не «ничего не найдено»).
- Схема инструмента: `tags: { type: 'array', items: { type: 'string' }, description: 'Точный фильтр по тегам (AND, case-insensitive)' }`.
- Опционально `excerpt?: number` — первые N символов тела в ответе (по умолчанию 0 = не отдавать). Закрывает половину запроса «сводка по портфелю» без LLM: агент видит заголовок + начало тела одним вызовом вместо N × `document_view`.

### 3. Тесты

- `src/mcp/git-status.test.mjs` (новый): чистый репозиторий → `changed: 0`; изменённый файл → `changed: 1`; untracked → `untracked: 1`; вне git → `git: null`, `ok: true`; `paths` фильтрует вывод; `TOOL_KINDS.git_status === 'read'`.
- `src/mcp/documents.test.mjs` (+): `tags: ['week']` не матчит `weekly`; AND по двум тегам; `tags: []` = без фильтра; `query` + `tags` вместе; `excerpt` обрезает тело.
- Счётчик реестра MCP обновить во всех файлах, где он проверяется.

### 4. Документация

- doc-8: раздел `git_status` + обновлённое описание `document_list` (теги, excerpt), счётчик инструментов.
- MCP-SETUP.md: строка в таблице.
- CHANGELOG.md: буллет.

## Как проверить

```
pnpm build && pnpm test
```

Ручная проверка: в проекте с грязным деревом вызвать `git_status` — числа совпадают с `git status --short | wc -l`; `document_list {tags: ['project']}` возвращает только документы с этим тегом.

## Риски

- **Счётчик инструментов продублирован в 5 тест-файлах** — забыть один = красный прогон. Митигация: обновлять все сразу, `grep -rn "MCP-инструмент" src/**/*.test.mjs`.
- **`collectStatus` тянет весь `ProjectStatus`** (задачи, очередь, grant) — для `git_status` это лишняя работа. Митигация: либо принять (listTasks на 400 задач — единицы миллисекунд), либо вынести `collectGit(cwd)` из `status.ts` отдельным экспортом и переиспользовать. Предпочтительно второе — чище и не тянет `web/orchestrator` в MCP-слой.
- **`git status` в большом репозитории медленный** — аргумент `paths` ограничивает область; без него — как у `vibelog status`.
- **`excerpt` может утечь лишнее** — это осознанно: документы и так читаемы через `document_view`, ограничение только по объёму ответа.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 22:58
---
Фаза 3 (Code) выполнена. Коммит d345a9b.
**Реализовано:**
1. `src/mcp/git-status.ts` (новый) — read-only `git_status`: `collectGit` из `core/status.ts` (нового git-кода нет), `ackRead` с `{git, branch, changed, untracked, ahead, behind, upstream}`; вне git — `git: null` + `ok: true`; `git.error` → `ackError` с исходным текстом; `paths` → `git status --porcelain -- <paths>` через `spawnSync` без shell, пути через `resolveInProject` (выход наружу — отказ), разбор в `parsePorcelain` (включая `R old -> new`).
2. `src/core/status.ts` — `collectGit` экспортирован (план, риск 2: не тянуть `collectStatus`/`web/orchestrator` в MCP-слой).
3. `src/mcp/tools.ts` — регистрация `git_status` в `listTools()` + диспетчер; `document_list` получил `tags` (AND по точному совпадению, `trim().toLowerCase()`, `tags: []` = без фильтра, комбинируется с `query` через AND) и `excerpt: N` (первые N символов тела, без аргумента тело не отдаётся).
4. `src/core/tool-kinds.ts` — `git_status: 'read'`; `src/cli/commands/instructions.ts` — группа «Код и git»; `src/cli/commands/doctor.ts` — префикс `git_status`.
5. Счётчик реестра 56 → 57 обновлён во всех 5 файлах: `compat-full`, `server`, `reference-tools`, `documents`, `diagnostics` (+ `git_status` в фикстуру `EXPECTED_MCP_TOOLS` и в ожидаемый список compat-full).
6. Тесты: новый `src/mcp/git-status.test.mjs` (7 кейсов: регистрация/TOOL_KINDS, чисто, changed/untracked, вне git, paths-сужение, путь вне проекта, parsePorcelain); `src/mcp/documents.test.mjs` — 5 кейсов тегов/excerpt (`week` не матчит `weekly-report`, AND, `tags: []`, query+tags, excerpt).
7. `MCP-SETUP.md` — строки `git_status` и обновлённое описание `document_list`.
**Проверки:** `pnpm build` — зелёная; полный `pnpm test` — 224 файла, 4306 passed / 4 skipped, зелёный. Первый полный прогон дал 2 падения (`core/report.test.mjs`, `web/orchestrator.test.mjs` — billing-коммит), оба прошли в изолированном прогоне и в повторном полном прогоне: это параллельная интерференция (соседний vitest в другом worktree), не регрессия diff'а.
**Что осталось:** doc-8 и CHANGELOG.md — по правилам фазы Code их пишет Фаза Close после слияния. AC8 (документация) поэтому не отмечен: doc-8/CHANGELOG не тронуты, MCP-SETUP.md обновлён.
---
author: @agent
created: 2026-11-10 23:16
---
Фаза Close выполнена. Ветка vb/vl-416 слита в master (1 коммит d345a9b, merge 6a01b66), worktree удалена (force — только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-416 удалена.
**Проверки после merge:** `pnpm build` — зелёная. Ранний точечный фильтр по diff'у (git-status, documents, server, reference-tools, diagnostics, compat-full) — 6 файлов, 135 тестов зелёные. Полный `npx vitest run` — первый прогон дал 2 падения в `src/web/orchestrator.test.mjs` (сверка состава billing-коммита: в коммит попали `.vibelog/settings.json` и `backlog/config.yml` вместо `.vibelog/billing/VL-94.json`). Классификация: файл изолированно зелёный (89/89), в `ps aux` виден параллельный `vitest run` в worktree vl-417 — интерференция нагрузки, не регрессия diff'а (diff не касается billing/orchestrator). Дождался завершения чужого прогона, один повтор полного прогона: **227 файлов, 4345 passed / 4 skipped — зелёный**.
**Документация (AC8, DoD2):** doc-8 — счётчик 56 → 57, новый раздел «git_status — состояние рабочего дерева (read, VL-416)» с таблицей параметров и семантикой (вне git → `git: null` + `ok: true`, `git.error` → `ackError`, `paths` → porcelain), обновлённое описание `document_list` (`tags` — точный AND case-insensitive, `excerpt`), поправлена «граница» `git_commit` (status теперь есть). CHANGELOG.md — буллет в Unreleased. MCP-SETUP.md был обновлён ещё в Фазе 3. Коммит 78cb961.
**Lessons:** обновлён lesson-256 (флейк нагрузки под параллельным vitest в чужом worktree) — добавлен кейс VL-416 и правило «дождись завершения чужого прогона перед повтором»; связь с задачей проставлена. Коммит 5399907.
DoD: 1 (тесты) — выполнен полным прогоном; 2 (документация) — doc-8 + CHANGELOG + MCP-SETUP; 3 (нет регрессий) — падения классифицированы как интерференция, повторный полный прогон зелёный.
---
<!-- COMMENTS:END -->