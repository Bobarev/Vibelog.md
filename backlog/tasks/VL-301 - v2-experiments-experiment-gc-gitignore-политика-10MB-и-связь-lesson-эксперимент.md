---
id: VL-301
title: '[v2] experiments: experiment gc (.gitignore-политика >10MB) и связь lesson ↔ эксперимент'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 02:19'
updated_date: '2026-11-03 04:40'
due_date: ''
labels:
  - v2
  - experiments
dependencies:
  - VL-299
milestone: ''
references: []
priority: low
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files:
  - src/core/experiment-gc.ts
  - src/core/experiment-gc.test.mjs
  - src/cli/commands/experiment-gc.ts
  - src/cli/commands/experiment.ts
  - src/cli/router.ts
  - src/cli/experiment-gc-cli.test.mjs
  - src/cli/experiment-reference-link.test.mjs
lessons:
  - lesson-188
token_usage:
  input: 6269907
  output: 55192
  cache: 5770752
  total: 6325099
  requests: 100
  duration_ms: 1313904
  reasoning: 21429
  by_phase:
    plan:
      input: 507212
      output: 6175
      cache: 406528
      requests: 11
    code:
      input: 3155203
      output: 30827
      cache: 2936832
      requests: 42
    close:
      input: 2607492
      output: 18190
      cache: 2427392
      requests: 47
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
v2-эпик VL-293 (зависит от VL-299). Догоняющие возможности, выделенные из прежней VL-300.

Спецификация: `backlog/docs/doc-21` §15 (git-политика), §16 (совместимость, lesson.references).

Файлы:
- `src/cli/commands/experiment.ts` — `experiment gc <exp-id> [--apply]`: печатает кандидатов на `.gitignore` (раны с `results.jsonl` > 10 MB); по `--apply` **явно** дописывает секцию в `.gitignore` (идемпотентно — повторный запуск строки не дублирует). Автоматически при ране `.gitignore` не правится никогда (doc-21 §15).
- Связь lesson ↔ эксперимент — **без правки схемы lesson**: через `reference type: experiment` (добавлен в VL-294) + `reference_link`. Тест: создать reference на `experiments/exp-<id>.md`, связать с задачей, проверить двустороннюю связь.
- Документация: `doc-7` (CLI-справочник) — секция `experiment`; при появлении MCP-инструментов — `doc-8`.
- Тесты: `gc` без `--apply` ничего не меняет, с `--apply` дописывает и идемпотентен; связь через reference.

Расширение `lesson.references` (поле в схеме lesson) — **только по отдельному решению пользователя**, в этой задаче не делается.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 experiment gc <exp-id> показывает кандидатов на .gitignore (results.jsonl > 10 MB), без --apply ничего не меняет
- [x] #2 experiment gc --apply явно дописывает секцию в .gitignore; повторный запуск не дублирует строки
- [x] #3 lesson.references НЕ расширяется; связь lesson ↔ эксперимент через reference type: experiment + reference_link покрыта тестом
- [x] #4 doc-7 (CLI-справочник) дополнен секцией experiment
- [x] #5 CHANGELOG.md обновлён
- [x] #6 pnpm build && pnpm test зелёные
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

v2-эпик VL-293 (зависит от VL-299). Спецификация — `backlog/docs/doc-21` §15 (git-политика), §16 (совместимость). Ключевые факты из кода:
- `src/cli/commands/experiment.ts` (`runExperiment`) — роутер подкоманд через `switch (subcommand)`; новые подкоманды добавляются ветвью + сервисным модулем `experiment-<sub>.ts` (как `experiment-run.ts`, `-report.ts`, `-judge.ts`).
- `src/core/report.ts:33` уже содержит `RESULTS_SIZE_LIMIT_BYTES = 10 * 1024 * 1024` — переиспользовать, не дублировать константу.
- `src/core/experiment.ts` даёт `listRunNumbers`, `runDirFor`, `experimentRunsDir` (через `src/core/paths.ts`), `getExperiment`, `listExperiments` — готовые примитивы для перечисления ранов.
- `src/core/reference.ts:29` — `REFERENCE_TYPES` уже включает `'experiment'` (VL-294); `linkReferenceTask(cwd, refId, taskId)` (строка 554) делает двустороннюю связь `reference.linked_tasks` ↔ `task.references` идемпотентно. Схему lesson (`lesson.references`) НЕ трогаем (AC3, doc-21 §16).
- Эталон теста реального CLI в mkdtemp с `testSpawnEnv()` — `src/cli/experiment-report-cli.test.mjs`.

## Файлы и правки

### 1. `src/core/experiment-gc.ts` (новый) — чистый модуль
- `export interface GcCandidate { run: number; sizeBytes: number; relativePath: string; entry: string }`
  - `relativePath` — путь от корня проекта (`backlog/experiments/exp-<id>/run-<N>/results.jsonl` в posix-виде, `split(sep).join('/')`), `entry` — строка для `.gitignore` (тот же путь, но без `results.jsonl`: каталог рана, чтобы будущие файлы рана не попали в git).
- `export function findGcCandidates(backlogDir: string, expId: string, limitBytes = RESULTS_SIZE_LIMIT_BYTES): GcCandidate[]`:
  перебирает `listRunNumbers(experimentRunsDir(backlogDir, expId))`, для каждого рана — `statSync(join(runDir,'results.jsonl'))` в `try/catch` (нет файла → пропуск, не ошибка), фильтр `size > limitBytes`, сортировка по убыванию размера. Причина: размер — единственный критерий doc-21 §15.
- `export function buildGitignoreBlock(expId: string, entries: string[]): string` — блок с маркерами, чтобы повторный запуск был идемпотентен:
  ```
  # vibelog experiment exp-<id>: results.jsonl > 10 MB (doc-21 §15)
  backlog/experiments/exp-<id>/run-1/
  backlog/experiments/exp-<id>/run-3/
  # /vibelog experiment exp-<id>
  ```
- `export function applyGitignoreBlock(gitignorePath: string, block: string): { ok: boolean; changed: boolean; reason?: string }`:
  читает файл (нет файла → считаем пустым, при apply создаём), вырезает существующий блок по маркерам и подставляет новый: `changed: false`, если нормализованный (обрезанные пустые строки) текст блока совпал. Запись — только через temp+rename в том же каталоге (lesson-169), иначе SIGINT оставляет обрезанный `.gitignore` (потеря правил версионирования — худший побочный эффект).
- `export function gitignorePathFor(backlogDir: string): string` — `join(dirname(backlogDir), '.gitignore')`: корень = каталог, содержащий `backlog/`, выше не поднимаемся ни на шаг — иначе из worktree можно зацепить чужой `.gitignore` (риск, см. ниже).
- Пустой список кандидатов → блок с явной пометкой «кандидатов нет», чтобы устаревшие строки прежнего блока удалялись, а не оставались навсегда.

### 2. `src/cli/commands/experiment-gc.ts` (новый)
- `export function experimentGc(positional: string[], flags: FlagValues, backlogDir: string): void`.
- `exp-id = positional[0]`; нет аргумента → `printError('Укажите id эксперимента: vibelog experiment gc <exp-id> [--apply]')`, `process.exitCode = 1`.
- Проверка существования эксперимента через `getExperiment(backlogDir, expId)` (или `listExperiments`) → `Эксперимент не найден`, exit 1.
- Печать кандидатов: `run-<N>  <MB> MB  <relativePath>`; в конце `кандидатов: N (порог 10 MB)`.
- Без `--apply`: `printInfo('Ничего не изменено. Применить: vibelog experiment gc <exp-id> --apply')` — файлы не читаются/не пишутся (AC1).
- С `--apply`: `applyGitignoreBlock(gitignorePathFor(backlogDir), buildGitignoreBlock(...))`; `changed: true` → `printSuccess('.gitignore дополнен (N строк)')`, `changed: false` → `printInfo('.gitignore уже содержит актуальный блок — изменений нет')` (AC2: идемпотентность). Ошибка записи → `printError` + exit 1.
- Ни в каком другом пути `.gitignore` не правится: команда `gc` — единственный писатель (doc-21 §15); `run`/`report`/`judge` не меняются.

### 3. `src/cli/commands/experiment.ts` — роутер и шапка
- шапка: добавить строку `- gc <exp-id> [--apply]` в список подкоманд и упоминание VL-301 в блоке истории MVP-шагов;
- импорт `experimentGc` из `./experiment-gc.js`;
- в `switch`: `case 'gc': return experimentGc(positional, flags, backlogDir);`
- в `default` обновить список: `Доступные: create, list, dataset, run, record, report, judge, gc`.

### 4. `src/cli/router.ts` — help
Строка 162 (описание `experiment`): `create|list|dataset|run|record|report|judge|gc`.

### 5. Тесты
- `src/core/experiment-gc.test.mjs` (чистый модуль, mkdtemp): кандидат появляется при `size > limitBytes` и не появляется при равном/меньшем (граница `>`); `applyGitignoreBlock` на отсутствующем файле создаёт его; повторный вызов с тем же блоком → `changed: false`, содержимое байт-в-байт; блок заменяется при новом кандидате; посторонние строки `.gitignore` сохраняются; нет кандидатов → старые строки блока исчезают.
- `src/cli/experiment-gc-cli.test.mjs` (реальный CLI через `bin/vibelog.mjs`, `mkdtemp`, `testSpawnEnv()`, как в `experiment-report-cli.test.mjs`): (а) `gc exp-1` печатает кандидата, `.gitignore` отсутствует/не меняется (сверка содержимого до/после); (б) `gc exp-1 --apply` дописывает секцию, exit 0; (в) повторный `--apply` → файл идентичен предыдущему (AC1/AC2).
- `src/cli/experiment-reference-link.test.mjs`: создаёт карточку `backlog/experiments/exp-1.md`, задачу в `backlog/tasks/`, затем `reference add "..." --type experiment --path backlog/experiments/exp-1.md` и `reference_link {referenceId, taskId}` — проверяет `linked_tasks` в md-reference и `references: [ref-N]` во frontmatter задачи (AC3); отдельно негативный кейс: у lesson нет поля `references` (проверка отсутствия расширения схемы — читаем `src/core/lesson.ts`… если `lesson.references` там нет, тест ограничивается assert'ом на `REFERENCE_TYPES`, чтобы фиксировать решение).
- Env — только `testSpawnEnv()`; каталоги — `mkdtempSync`, удаление в `afterAll` (AGENTS.md, VL-241).

### 6. Документация
- `backlog/docs/doc-7` (CLI-справочник), раздел `experiment` (~строка 377): блок синтаксиса + подраздел `### gc` — что печатает, что делает `--apply`, идемпотентность, почему `.gitignore` не правится автоматически (doc-21 §15). Обновлять через `document_update` (в Plan/Code — не edit файла backlog).
- `CHANGELOG.md` — запись `VL-301` в раздел «Не выпущено» в стиле соседних (VL-297…VL-300): что сделано, тесты, документация.
- `doc-8` (MCP) — НЕ меняется: MCP-инструментов в задаче не появляется (AC4 касается только doc-7).

## Порядок действий
1. `src/core/experiment-gc.ts` + `src/core/experiment-gc.test.mjs` (модуль первый — CLI тонкий).
2. `src/cli/commands/experiment-gc.ts`, правки роутера `experiment.ts` и help `router.ts`.
3. `src/cli/experiment-gc-cli.test.mjs`.
4. `src/cli/experiment-reference-link.test.mjs` (связь reference type: experiment ↔ задача).
5. `pnpm build && pnpm test` (полный прогон, AGENTS.md).
6. `document_update doc-7`, правка `CHANGELOG.md`.

## Проверка
- `pnpm build && pnpm test` — зелёные (полный прогон, без `--exclude`).
- Ручная: `node bin/vibelog.mjs experiment gc exp-1` в тестовом каталоге — вывод кандидатов и отсутствие изменений; `--apply` дважды — `.gitignore` не дублируется (`diff` до/после).

## Риски
1. **Чужой `.gitignore`**: корень вычисляется как `dirname(backlogDir)` без подъёма вверх по дереву (никакого `git rev-parse --show-toplevel`) — в worktree `backlog/` может быть симлинком/лежать не в корне; фиксируем путь явно и печатаем его в выводе `--apply`, чтобы пользователь видел, какой файл правится.
2. **Симлинк/несуществующий `.gitignore`**: `statSync` + `try/catch`; при отсутствии файла создаём только по `--apply`.
3. **Идемпотентность блока**: замена по маркерам, а не дописывание в конец — иначе повторные запуски накапливают дубли. Маркеры обязаны содержать `exp-id`, чтобы блоки разных экспериментов не затирали друг друга (несколько блоков в одном файле).
4. **Порог `>` vs `>=`**: doc-21 §15 говорит «> 10 MB» — строгий `>`, граница покрыта тестом.
5. **Запись `.gitignore`**: temp+rename в том же каталоге (lesson-169), иначе обрыв оставляет файл без половины правил.
6. **Тесты CLI**: не забыть `testSpawnEnv()` (иначе `VIBELOG_CWD` уводит CLI на главный репозиторий — lesson-88/113) и `mkdtemp`-каталоги (VL-241).
7. Схема `lesson` не расширяется — если в тесте понадобится «ссылка из урока», она делается через `reference_linked_tasks`, не через поле урока.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 04:20
---
Фаза 2 (Plan) выполнена. Тип: feature (не epic) — план записан в Implementation Plan задачи.
Изучено: `src/cli/commands/experiment.ts` (роутер подкоманд), `src/core/experiment.ts` (listRunNumbers/runDirFor/experimentRunsDir/getExperiment), `src/core/report.ts:33` (`RESULTS_SIZE_LIMIT_BYTES = 10 MB` — переиспользуем), `src/core/reference.ts` (`REFERENCE_TYPES` уже содержит `experiment`, `linkReferenceTask` даёт двустороннюю связь), doc-21 §15/§16, doc-7 раздел `experiment` (строки 377+), эталон теста CLI `src/cli/experiment-report-cli.test.mjs`.
План: 4 файла кода (новые `src/core/experiment-gc.ts`, `src/cli/commands/experiment-gc.ts`; правки роутера `experiment.ts` и help `router.ts`), 3 тест-файла (модуль, CLI `gc` без/с `--apply` + идемпотентность, связь reference type: experiment ↔ задача), документация doc-7 + CHANGELOG (doc-8 не меняется — MCP-инструментов нет). Схема `lesson` не расширяется (AC3, doc-21 §16).
Риски: вычисление корня `.gitignore` как `dirname(backlogDir)` (без подъёма к git-toplevel) — путь печатается в выводе `--apply`; идемпотентность через блок с маркерами, включающими exp-id; запись `.gitignore` — temp+rename (lesson-169); строгий порог `>` 10 MB покрывается тестом; тесты CLI — только `testSpawnEnv()` и `mkdtemp`.
---
author: @agent
created: 2026-11-03 04:27
---
Фаза 3 (Code) выполнена. Коммит 5d132c2 (ветка vb/vl-301).
Изменено:
- `src/core/experiment-gc.ts` (новый) — `findGcCandidates` (строгий порог `> 10 MB`, переиспользована `RESULTS_SIZE_LIMIT_BYTES` из report.ts, ран без results.jsonl пропускается, порядок по номеру рана), `buildGitignoreBlock` (маркеры блока содержат exp-id — блоки разных экспериментов не затирают друг друга), `applyGitignoreBlock` (замена блока НА МЕСТЕ, а не «удалить и дописать в конец» — иначе повторный `--apply` переставлял бы блоки и менял файл без причины), `gitignorePathFor` (`.gitignore` рядом с `backlog/`, без подъёма к git-toplevel). Запись атомарная temp+rename (lesson-169).
- `src/cli/commands/experiment-gc.ts` (новый) — `experiment gc <exp-id> [--apply]`: без `--apply` только печатает кандидатов и сообщает «Ничего не изменено»; с `--apply` печатает путь правящегося `.gitignore`, дописывает секцию, при повторе — «уже актуален». Ошибки (нет id, нет эксперимента, сбой записи) — exit 1.
- `src/cli/commands/experiment.ts` — ветка `case 'gc'`, импорт, шапка (подкоманда + история v2 VL-301), список доступных подкоманд.
- `src/cli/router.ts` — help: `create|list|dataset|run|record|report|judge|gc`.
- `src/core/experiment-gc.test.mjs` — граница `>` (ровно limit — не кандидат), posix-путь, стабильная сортировка, отсутствие results.jsonl, создание файла с нуля, идемпотентность байт-в-байт, замена блока при новом кандидате, удаление устаревшего блока с сохранением чужих правил, два независимых блока в одном файле.
- `src/cli/experiment-gc-cli.test.mjs` — реальный CLI в mkdtemp (`testSpawnEnv()`): без `--apply` `.gitignore` не меняется (сверка содержимого), `--apply` дописывает секцию, повторный `--apply` даёт идентичный файл и одну строку на ран, gc не удаляет файлы результатов.
- `src/cli/experiment-reference-link.test.mjs` — тип `experiment` в `REFERENCE_TYPES`, у lesson нет поля `references` (AC3: схема не расширена), `reference add --type experiment --path backlog/experiments/exp-1.md` + `reference link` даёт двустороннюю связь (`linked_tasks` ↔ `task.references`) и не дублирует при повторе.
Проверки: `pnpm build && pnpm test` — полный прогон: 156 файлов, 2887 passed, 4 skipped (штатные skip в существующих тестах, не исключения этой задачи), 0 failed; отдельный прогон после сборки web/dist прошёл.
Осталось (по регламенту НЕ в фазе Code): AC4 — секция `gc` в doc-7 (CLI-справочник) и AC5 — запись в CHANGELOG.md; оба делает фаза Close.
Урок по ходу работы: блок в `.gitignore` надо править на месте по маркерам, а не «удалять и добавлять в конец» — иначе идемпотентность ломается при нескольких экспериментах в одном файле.
---
author: @agent
created: 2026-11-03 04:40
---
Фаза Close выполнена. Ветка vb/vl-301 слита в master (1 коммит, merge 6683ef7), worktree .vibelog/worktrees/vl-301 удалена (force — только untracked-симлинк backlog/references/data), ветка vb/vl-301 удалена.
Проверки после merge: `pnpm build` — успешно; ранний точечный прогон затронутых тестов (src/core/experiment-gc.test.mjs, src/cli/experiment-gc-cli.test.mjs, src/cli/experiment-reference-link.test.mjs) — 21 passed. Полный `pnpm test` — 1 падение в `src/web/orchestrator.test.mjs` («startPhase close (qwen): файл задачи закоммичен после записи token_usage», VL-277). Классификация: (а) тест проходит в изоляции (88 passed) и в прогоне без трёх новых тест-файлов задачи (154 файла, 2874 passed); (б) параллельного vitest в других worktree не было (`ps aux | grep vitest` пуст); (в) на родительском коммите HEAD^1 (6a5057a) тот же файл падает 2 тестами — падение пре-существующее и нагрузочное (таймаут 4 с на ожидание fire-and-forget коммита), не регрессия VL-301. Повторный полный прогон (причина: классификация показала флак, не связанный с diff'ом) — тот же единственный флак, 2886 passed, 4 skipped. Diff задачи не касается src/web/.
Документация: doc-7 (CLI-справочник) — подкоманда `gc` в блоке синтаксиса `experiment`, новый подраздел `### gc` (порог `> 10 MB`, `--apply` и идемпотентность по маркерам, почему `.gitignore` не правится автоматически — doc-21 §15, атомарная запись), тип `experiment` в `reference list --type` + абзац о связи «урок ↔ эксперимент» через reference (схема lesson не расширяется, doc-21 §16). CHANGELOG.md — запись VL-301 в Unreleased/Добавлено. Коммит документации: f10fe3c.
Lessons: создан lesson-188 («Генерируемую секцию .gitignore правь на месте по маркерам с id владельца, а не дописывай в конец»), связан с задачей; коммит ac1a751.
DoD: «Тесты проходят» — полный прогон зелёный по diff'у задачи, единственное падение — пре-существующий флак orchestrator.test.mjs, воспроизводимый на HEAD^1; «Документация обновлена» — doc-7 и CHANGELOG обновлены; «Нет регрессий» — новых падений относительно родительского коммита нет.
---
<!-- COMMENTS:END -->