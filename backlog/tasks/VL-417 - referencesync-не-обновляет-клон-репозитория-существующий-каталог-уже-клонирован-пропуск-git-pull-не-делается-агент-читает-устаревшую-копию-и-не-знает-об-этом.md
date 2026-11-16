---
id: VL-417
title: '`reference_sync` не обновляет клон репозитория: существующий каталог = «уже клонирован, пропуск», `git pull` не делается — агент читает устаревшую копию и не знает об этом'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 22:37'
updated_date: '2026-11-16 16:02'
due_date: ''
labels: []
dependencies: []
milestone: v1.14
references: []
priority: ''
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/reference.ts
  - src/core/reference.test.mjs
  - src/mcp/tools.ts
  - src/mcp/reference-tools.test.mjs
  - src/cli/commands/reference.ts
  - src/cli/reference-cli.test.mjs
  - src/web/references-sync-api.ts
  - src/web/references-api.test.mjs
  - web/src/components/references/api.ts
  - web/src/components/references/references-page.tsx
lessons: []
token_usage:
  input: 16637560
  output: 91508
  cache: 16323584
  total: 16729068
  requests: 233
  duration_ms: 3269838
  reasoning: 37473
  by_phase:
    code:
      input: 14906574
      output: 83125
      cache: 14637568
      requests: 199
    close:
      input: 1730986
      output: 8383
      cache: 1686016
      requests: 34
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Агент из проекта Vibelog UI работает с чужим backlog через reference-клон (`backlog/references/data/<dir>`) и не может узнать, что изменилось с прошлого раза. Разбор показал: это не незнание, а реальный пробел в коде.

**Симптом.** `reference_sync` (MCP) и `vibelog reference sync` для `type: repo` вызывают `syncReferenceRepos` → `cloneReferenceRepo`, а тот при существующем каталоге возвращает `{cloned: false, message: 'Reference ref-N: уже клонирован (<path>), пропуск'}` (`src/core/reference.ts:500-510`). `git pull` не выполняется никогда. Итог: клон создаётся один раз и навсегда застывает; `sync` рапортует «пропущено: N», что читается как «всё актуально».

**Асимметрия.** Для `type: url/doc/spec` кэш перекачивается по-настоящему: `refreshReferenceCache` сравнивает `source_hash` и возвращает `status: updated|skipped|partial|failed` (`src/core/reference-cache.ts`). Для `repo` такой логики нет — хотя `git pull` дешевле скачивания HTML.

**Цель.** `sync` для `type: repo` действительно обновляет клон (`git pull --ff-only`) и сообщает, что изменилось: новые/закрытые задачи, новые решения, новые документы — по разнице до/после pull.

**Почему `--ff-only`.** В клоне могут быть локальные правки (агент что-то поправил руками, или `data/` в `.gitignore` не полностью). `--ff-only` падает вместо создания merge-коммита; ошибка должна быть понятной, без авто-`reset`/`checkout` — молчаливая потеря чужих правок недопустима.

**Что уже есть (не дублировать):**
- `cloneReferenceRepo` / `syncReferenceRepos` — `src/core/reference.ts:490-560`, `spawnSync('git', …)` с `timeout: 15_000` (VL-225), без shell.
- `referenceCloneDir(cwd, ref)` — `src/core/reference.ts:472`, резолвит каталог клона из `path`/`url`.
- `SyncResult {cloned, skipped, failed}` — расширять аддитивно, не ломая CLI-вывод и веб-API (`POST /api/references/sync` в `src/web/references-sync-api.ts`).
- `listTasks` / `markdownToTask` — `src/core/store.ts:35`, `src/core/task.ts:319`; парсинг задач из произвольного каталога уже возможен.
- `listDocuments` — `src/core/document.ts`, принимает `backlogDir` (не cwd) — годится для чтения `docs/` из клона.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `pullReferenceRepo` обновляет существующий клон через `git pull --ff-only` (spawnSync без shell, `-C <dir>`, timeout 15 с); отсутствующий каталог делегирует в `cloneReferenceRepo`
- [x] #2 `SyncResult` получил аддитивное поле `updated: string[]`; `skipped` теперь означает «клон актуален», а не «не трогали»; `cloned`/`failed` не изменились
- [x] #3 `diffReferenceClone(dir, before, after)` возвращает добавленные/удалённые задачи, смены статуса (`from`/`to`), добавленные/удалённые документы и решения — по `git diff --name-status`
- [x] #4 MCP `reference_sync` возвращает `updated` и `diff`; текст сообщения называет «обновлено N, без изменений M, ошибок K»
- [x] #5 CLI `vibelog reference sync` печатает строку «Обновлено: …» с diff-сводкой; `--json` отдаёт объект целиком
- [x] #6 `POST /api/references/sync` добавляет `updated` и `diff` в тело ответа аддитивно (старые ключи на месте)
- [x] #7 Локальные незакоммиченные правки в клоне → `failed` с текстом stderr git, без авто-reset/checkout; каталог без `.git` → `failed` с подсказкой, каталог не удаляется
- [x] #8 Тесты на локальном bare-репозитории (mkdtemp, file://, без сети): pull без изменений, pull с изменениями + diff, конфликт локальных правок, каталог без .git, пустой diff
- [x] #9 Документация: doc-8 (`reference_sync`), doc-6 §13 (Sync обновляет клоны), MCP-SETUP.md, CHANGELOG.md
- [x] #10 `pnpm build && pnpm test` — зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Шаги

### 1. `src/core/reference.ts` — `pullReferenceRepo`

Новая функция рядом с `cloneReferenceRepo`:

```ts
export function pullReferenceRepo(
  cwd: string,
  ref: Reference,
  env: NodeJS.ProcessEnv = process.env
): { pulled: boolean; changed: boolean; message: string }
```

- `type !== 'repo'` → `{pulled: false, changed: false, message: '…только для type=repo'}`.
- Каталога нет → делегировать в `cloneReferenceRepo` (первый sync = клон).
- Каталог есть, но не git-репозиторий (нет `.git`) → `{pulled: false, changed: false, message: '…каталог не git-репозиторий, удалите и повторите sync'}`. **Не** удалять автоматически.
- Иначе: `spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'])` → `before`; затем `spawnSync('git', ['-C', dir, 'pull', '--ff-only'], {timeout: 15_000, env})`.
  - `status !== 0` → `{pulled: false, changed: false, message: '…ошибка git pull --ff-only: <stderr>'}`. Текст stderr пробрасывать как есть — там будет и «local changes would be overwritten», и «not possible to fast-forward».
  - Успех → `rev-parse HEAD` снова → `changed = before !== after`.
- `spawnSync` без shell, `-C <dir>` вместо `cwd` (не менять процессный cwd).

### 2. `syncReferenceRepos` — использовать pull

- В цикле: `cloneReferenceRepo` заменить на `pullReferenceRepo`.
- `SyncResult` расширить аддитивно:
  ```ts
  interface SyncResult {
    cloned: string[];
    skipped: string[];   // без изменений (было «уже клонирован»)
    updated: string[];   // НОВОЕ: pull принёс изменения
    failed: Array<{ id: string; error: string }>;
  }
  ```
- `skipped` теперь означает «клон актуален», а не «не трогали» — это и есть исправление семантики. Существующие потребители (`src/web/references-sync-api.ts`, CLI) читают `cloned/skipped/failed` — поле `updated` аддитивно, старые ключи на месте.

### 3. «Что нового» — `diffReferenceClone`

Новая функция (тот же файл или `src/core/reference-diff.ts`, если разрастётся):

```ts
export interface CloneDiff {
  tasks: { added: string[]; removed: string[]; statusChanged: Array<{id: string; from: string; to: string}> };
  documents: { added: string[]; removed: string[] };
  decisions: { added: string[]; removed: string[] };
}
export function diffReferenceClone(dir: string, before: string, after: string): CloneDiff
```

- Реализация — `git -C <dir> diff --name-status <before> <after>` (один вызов, без shell), разбор строк `A/M/D\t<path>`.
- Классификация по префиксу пути: `backlog/tasks/` → tasks, `backlog/docs/` → documents, `backlog/decisions/` → decisions. Остальное игнорировать.
- Для `M` в `backlog/tasks/` — прочитать файл **после** pull и вытащить `status` через `markdownToTask`; `from` — из `git show <before>:<path>` (тоже `spawnSync`, без shell). Если файл в `before` не читается — `from: '?'`.
- ID задачи — из имени файла (`<ID> - <slug>.md`), не из тела: имя стабильно.
- Пустой diff → все массивы пусты (не `null`).

### 4. MCP `reference_sync` — отчёт

- `src/mcp/tools.ts:661` — в ответ добавить `updated` и `diff` (по каждому обновлённому ref).
- Текст `message`: «обновлено: N (ref-1: +3 задачи, −1 задача, 2 смены статуса; …), без изменений: M, ошибок: K».
- `all: true` — то же по всем repo-референсам.
- `TOOL_KINDS.reference_sync` остаётся `'write'` (меняет файлы в `data/`).

### 5. CLI и веб

- `src/cli/commands/reference.ts` — `sync` печатает строку «Обновлено: …» с diff-сводкой; `--json` отдаёт объект целиком.
- `src/web/references-sync-api.ts` — `POST /api/references/sync` добавляет `updated` и `diff` в тело ответа (аддитивно, `cloned/skipped/failed` на месте).
- `#/references` — вторая строка итога: «Репозитории — клонировано N, обновлено M, без изменений K, ошибок J».

### 6. Тесты

`src/core/reference.test.mjs` (+):
- pull без изменений → `pulled: true, changed: false`, ref в `skipped`;
- после коммита в upstream → `changed: true`, ref в `updated`, `diff.tasks.added` содержит новый ID;
- локальные незакоммиченные правки в клоне → `pulled: false`, ref в `failed`, текст содержит stderr git;
- каталог без `.git` → `failed` с подсказкой, каталог не удалён;
- `diffReferenceClone`: добавленная/удалённая задача, смена статуса (`from`/`to`), добавленный документ, пустой diff.

Тесты на локальном bare-репозитории в `mkdtemp` (как в `upstream-git.test.mjs`), без сети.

`src/mcp/reference-tools.test.mjs` (+): `reference_sync` возвращает `updated` и `diff`; `all: true` обходит все repo.

`src/cli/reference-cli.test.mjs` (+): вывод «Обновлено: …».

### 7. Документация

- doc-8: `reference_sync` — новое поведение (pull, `updated`, `diff`), семантика `skipped`.
- doc-6 (§13 references): кнопка Sync обновляет клоны, а не только создаёт.
- MCP-SETUP.md: строка `reference_sync` — «доклонировать и обновить (git pull --ff-only)».
- CHANGELOG.md: буллет.

## Как проверить

```
pnpm build && pnpm test
```

Ручной кейс: `vibelog reference add "Vibelog" --type repo --url <url>` → `vibelog reference sync` (клон) → в upstream-репо сделать коммит → `vibelog reference sync` снова → в выводе «Обновлено: 1 (ref-N: +1 задача)», в клоне новый файл.

## Риски

- **`--ff-only` падает на разошедшихся ветках.** Это осознанно: молчаливый merge в чужом клоне хуже ошибки. Текст ошибки должен подсказывать «удалите каталог клона и повторите sync» — но не делать это автоматически.
- **`git show <before>:<path>` на больших репозиториях** — по одному вызову на изменённую задачу. Митигация: только для `M` в `backlog/tasks/`, обычно единицы файлов; при >50 изменённых задачах — не читать `from`, ставить `'?'`.
- **Смена семантики `skipped`.** Кто-то мог трактовать «пропущено» как «не трогали». В вебе и CLI текст меняется вместе с кодом; внешних потребителей `SyncResult` нет (проверить `grep -rn "SyncResult" src/`).
- **`data/` в `.gitignore`** — клон не попадает в коммит проекта, но `git pull` внутри клона работает независимо. Проверить, что `.gitignore` не мешает (он в родительском репо, не в клоне).
- **Сеть в тестах** — только локальный bare-репозиторий через `file://`, как в VL-225/`upstream-git.test.mjs`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 23:02
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/reference.ts
- src/mcp/tools.ts
- src/cli/commands/reference.ts
- src/web/references-sync-api.ts
- web/src/components/references/api.ts
- web/src/components/references/references-page.tsx
- src/core/reference.test.mjs
- src/mcp/reference-tools.test.mjs
- src/cli/reference-cli.test.mjs
- I'll start by orienting in the project and reading the key files.
Now I'll implement the core changes in `src/core/reference.ts`.
Now add the pull/diff functions after `cloneReferenceRepo`.
Now update MCP tool, CLI, and web API.
Now the CLI.
Now the web API.
Now build and check for compile errors.
…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 993 с, payload 366645 байт_
Незакоммиченные изменения сохранены в ветку: коммит `9064bad`.
---
author: @agent
created: 2026-11-10 23:02
---
Фаза code не удалась (код выхода 1): окировок=0, payload последнего запроса=366645 байт (макс 366645), usage={"input_tokens":5431152,"output_tokens":35764,"cache_read_input_tokens":5349376,"total_tokens":5466916,"reasoning_tokens":15198} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 23:30
---
Фаза 3 (Code) выполнена. Коммиты: 9064bad (wip-прогресс после обрыва по max-requests), abff77a (веб-API тесты), 24d3a5a (CLI-тесты).
Реализация:
- `src/core/reference.ts`: новая `pullReferenceRepo(cwd, ref, env)` — `git pull --ff-only` через `spawnSync` без shell, `-C <dir>`, timeout 15 с; отсутствующий каталог делегирует в `cloneReferenceRepo`; каталог без `.git` → понятная ошибка с подсказкой «удалите и повторите sync» (автоудаления нет); ошибка pull пробрасывает stderr git как есть + подсказку, без reset/checkout. `SyncResult` расширен аддитивно: `updated: string[]` и `diffs: Record<string, CloneDiff>`; `skipped` теперь означает «клон актуален» (pull прошёл, HEAD не изменился). `syncReferenceRepos` переведён на pull, `cloned`/`failed` сохранены.
- `diffReferenceClone(dir, before, after)` — один `git diff --name-status`, классификация по префиксам `backlog/tasks|docs|decisions`; для `M` в tasks статус «до» читается `git show <before>:<path>` + `markdownToTask` (при >50 изменённых задачах `from` не читается); ID из имени файла; пустой diff — пустые массивы.
- `src/mcp/tools.ts`: `reference_sync` отдаёт `updated`/`diffs` (без аргументов) и секцию `repos` + `message` вида «обновлено: N (ref-1: +3 задач, …), без изменений: M, ошибок: K» при `all`/`id`; корневые `cloned`/`skipped`/`failed` клонов сохранены для обратной совместимости. `TOOL_KINDS.reference_sync` не менялся.
- `src/cli/commands/reference.ts`: строки «Обновлён: <id> — <diff>», «Без изменений: <id>», итог «Клонировано: N, обновлено: M, без изменений: K, ошибок: J» + строка «Обновлено: …» с diff-сводкой; `--json` печатает объект целиком.
- `src/web/references-sync-api.ts`: общий sync отдаёт `updated`/`diffs` аддитивно; поштучный sync repo-референса использует `pullReferenceRepo` и возвращает `updated: boolean`.
- `web/src/components/references/{api.ts,references-page.tsx}`: тип `SyncResult` дополнен `updated`/`diffs`, итоговая строка — «Репозитории — клонировано N, обновлено M, без изменений K, ошибок J».
Тесты (локальный bare-репозиторий, file://, без сети):
- `src/core/reference.test.mjs` (+7): первый sync = клон, повторный pull без изменений, pull с изменениями + diff (задача/документ), смена статуса from/to и удаление задачи, пустой diff, конфликт локальных правок (failed + stderr + правки целы), каталог без `.git` (failed, каталог не удалён), агрегация в `syncReferenceRepos`.
- `src/mcp/reference-tools.test.mjs`: sync обновляет клон pull'ом, отдаёт `updated`/`diffs`; `all:true` — секция `repos` + `message`.
- `src/cli/reference-cli.test.mjs`: восстановлен прежний файл VL-152/194/291 (был случайно перезаписан в прерванном ране — вернул из 246b501, поправил ожидание «без изменений» вместо «пропущено») + 3 новых теста pull/diff/`--json`.
- `src/web/references-api.test.mjs`: общий sync отдаёт `updated`/`diffs`, каталог без `.git` → `failed` с подсказкой; поштучный sync repo → `updated: false`.
Проверки: `pnpm build` — чисто; полный прогон `npx vitest run` (env без VIBELOG_* агентской сессии) — 226 файлов, 4344 теста passed, 4 skipped, 0 failed. Промежуточные падения `src/web/orchestrator.test.mjs` (VL-277/VL-352) были следствием утечки env агентской сессии (`VIBELOG_CWD` уводил git-операции на главный репозиторий) — в изоляции и в полном прогоне без VIBELOG_* файл зелёный, к правкам VL-417 отношения не имеет.
Что осталось (вне фазы Code по правилам): AC9 — документация (doc-8 `reference_sync`, doc-6 §13, MCP-SETUP.md, CHANGELOG.md) пишется в фазе Close после слияния. DoD «Документация обновлена» поэтому не отмечен.
---
author: @agent
created: 2026-11-10 23:41
---
Фаза Close выполнена. Ветка vb/vl-417 слита в master (3 коммита: 9064bad, abff77a, 24d3a5a; merge-коммит без конфликтов), worktree удалена (force — только untracked-симлинк backlog/references/data), ветка vb/vl-417 удалена.
Проверки после merge: `pnpm build` — чисто (один раз за фазу). Ранний точечный фильтр по diff (src/core/reference.test.mjs, src/mcp/reference-tools.test.mjs, src/cli/reference-cli.test.mjs, src/web/references-api.test.mjs) — 4 файла, 101 тест passed. Полный прогон `npx vitest run` (env без VIBELOG_* агентской сессии): первый прогон — 226 passed / 1 failed (src/web/orchestrator.test.mjs, «E2E: оркестраторный спавн пишет meta.json сессии», SyntaxError: Unexpected end of JSON input). Классификация: файл не входит в diff HEAD^1..HEAD; изолированный прогон файла — 89/89 passed; параллельного vitest в других worktree не было (ps aux — пусто). Один повтор полного прогона с этой причиной — 227 файлов, 4356 passed, 4 skipped, 0 failed. Регрессий нет.
Документация (AC9, DoD2) — в главном репо, коммит 843b1d3: doc-8 (раздел `reference_sync` переписан: pull --ff-only, `updated`/`diffs`, новая семантика `skipped`, поведение при локальных правках и каталоге без `.git`), doc-6 §13 (команда `sync` в примере + новый абзац «`sync` обновляет клоны, а не только создаёт» с форматом вывода CLI и веба), MCP-SETUP.md (строка `reference_sync` — «доклонировать и обновить (git pull --ff-only)»), CHANGELOG.md (буллет в Unreleased → Исправлено).
DoD: 1. Тесты проходят — да (полный прогон зелёный); 2. Документация обновлена — да (коммит 843b1d3); 3. Нет регрессий — да (единственное падение — известный флак orchestrator.test.mjs, изолированно зелёный, вне diff). AC9 отмечен.
Урок не зафиксирован: нового знания нет — классификация одиночного падения изолированным прогоном уже покрыта lesson-116/160/284, а поведение pull/diff видно в диффе.
---
<!-- COMMENTS:END -->