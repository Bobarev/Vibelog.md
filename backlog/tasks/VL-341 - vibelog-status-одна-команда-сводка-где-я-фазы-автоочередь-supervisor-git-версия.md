---
id: VL-341
title: 'vibelog status: одна команда-сводка «где я» (фазы, автоочередь, supervisor, git, версия)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-05 13:21'
updated_date: '2026-11-05 16:34'
due_date: ''
labels:
  - cli
  - ux
  - infra
dependencies: []
milestone: ''
references: []
priority: low
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/status.ts
  - src/cli/commands/status.ts
  - src/cli/router.ts
  - src/core/status.test.mjs
  - src/cli/status-cli.test.mjs
lessons:
  - lesson-226
token_usage:
  input: 8174580
  output: 48361
  cache: 7719936
  total: 8222941
  requests: 120
  duration_ms: 1702956
  reasoning: 27356
  by_phase:
    code:
      input: 6395941
      output: 39959
      cache: 6086144
      requests: 78
    close:
      input: 1778639
      output: 8402
      cache: 1633792
      requests: 42
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инженерное улучшение из doc-22 §5.2. Небольшая read-only команда, не пересекается с кодом doc-25 (задачи `install`/`create`/реестр готовы, `router.ts` они больше не правят), поэтому может уехать в релиз вместе с ними.

**Проблема.** Ответ на вопрос «где я» размазан по пяти источникам: `backlog_phase_status` (MCP, по одной задаче), `backlog_auto_queue status`, `backlog_supervisor status`, `git status`, `vibelog version`. В терминале приходится запускать 3–5 команд, а часть состояния (grant, автоочередь) вообще доступна только через MCP.

**Что нужно.** Одна команда `vibelog status` (алиас `vb status`), собирающая сводку: версия, проект/префикс и счётчики задач по статусам, идущие фазы (задача/фаза/pid/время старта), состояние автоочереди, активный grant супервизора, git-состояние (ветка, изменённые файлы, ahead/behind). Плюс `--json` для скриптов и агента и `--short` для одной строки на пункт.

**Границы.** Только чтение: ничего не запускает, не пишет файлов, не отзывает grant. Транскрипты сессий не читаются — состояние берётся из `getRun`/`listRuns`, `auto-queue.ts`, `supervisor-grant.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vibelog status` (алиас `vb status`) печатает сводку без обязательных аргументов и завершается с кодом 0 при рабочем проекте
- [x] #2 Сводка включает: версию, имя проекта и префикс задач из `backlog/config.yml`, счётчики задач по статусам
- [x] #3 Сводка включает текущее состояние фаз: идущие раны (задача, фаза, pid, время старта) — через `getRun`/`listRuns` оркестратора, без чтения JSONL транскриптов
- [x] #4 Сводка включает состояние автоочереди (`src/core/auto-queue.ts`): running/stopped, pending/running/done/failed с причинами
- [x] #5 Сводка включает активный grant супервизора (`src/web/supervisor-grant.ts`): runId, задачи, срок; при отсутствии — «прогона нет»
- [x] #6 Сводка включает git-состояние: текущая ветка, число изменённых/нетрекнутых файлов, ahead/behind (вне git-репозитория — пометка, не ошибка)
- [x] #7 Флаг `--json` отдаёт те же данные структурированно (один объект, стабильные ключи); `--short` — одна строка на строку сводки без заголовков
- [x] #8 Команда только читает: не стартует фазы, не трогает очередь и grant, не пишет файлов
- [x] #9 Новый модуль `src/core/status.ts` собирает данные (тестируемо на mkdtemp-фикстуре), `src/cli/commands/status.ts` — только форматирование
- [x] #10 Тесты: `src/core/status.test.mjs` (пустой проект, проект с задачами и активным раном, автоочередь в трёх состояниях, вне git) и `src/cli/status-cli.test.mjs` (человекочитаемый вывод и `--json`)
- [x] #11 Нет пересечений с кодом doc-25: `install`/`create`/реестр/`installed.lock.json` не трогаются; в `router.ts` — одна строка `case 'status'` и строка общей справки
- [x] #12 CHANGELOG.md обновлён, doc-7 (CLI-справочник) дополнен разделом `status`
- [x] #13 `pnpm build && pnpm test` зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `src/core/status.ts` (новый) — сбор данных, без форматирования.
- `src/cli/commands/status.ts` (новый) — только печать (человекочитаемо / `--json` / `--short`).
- `src/cli/router.ts` — `import { runStatus }`, `case 'status'`, строка в `showHelp()` (и в `showCommandHelp`).
- `src/core/status.test.mjs`, `src/cli/status-cli.test.mjs` (новые).
- `doc-7` (CLI-справочник), `CHANGELOG.md`.

## Источники данных (всё уже есть, новых модулей состояния не нужно)

| Пункт | Источник |
|---|---|
| версия | `src/cli/commands/version.ts` (или `package.json` через существующий хелпер) |
| проект/префикс, задачи по статусам | `loadConfig(cwd)` + `listTasks(cwd)` (`src/core/store.ts`) |
| идущие фазы | `getRun(taskId)` / `listRuns()` из `src/agent/orchestrator.ts` (без чтения JSONL — поля `phase`, `pid`, `startedAt`) |
| автоочередь | `readAutoQueue()` / статус из `src/core/auto-queue.ts` |
| grant | `findActiveGrant(cwd)` из `src/web/supervisor-grant.ts` |
| git | `spawnSync('git', [...])` без shell: `rev-parse --abbrev-ref HEAD`, `status --porcelain`, `rev-list --left-right --count @{u}...HEAD` |

## Шаг 1. `src/core/status.ts`

```ts
export interface ProjectStatus {
  version: string;
  project: { name: string; taskPrefix: string } | null;   // null — backlog/ не найден
  tasks: { byStatus: Record<string, number>; total: number };
  runs: Array<{ taskId: string; phase: string; pid?: number; startedAt?: string }>;
  queue: { running: boolean; pending: string[]; runningIds: string[]; failed: Array<{ id: string; reason: string }> };
  grant: { runId: string; taskIds: string[]; expiresAt: string } | null;
  git: { branch: string; changed: number; untracked: number; ahead: number; behind: number } | null; // null — не git-репозиторий
}

export function collectStatus(cwd: string): ProjectStatus
```

Правила:
- отсутствие `backlog/` — `project: null`, `tasks` нули, остальные секции всё равно собираются (команда не падает);
- отсутствие автоочереди — `queue.running === false`, пустые массивы (не ошибка);
- `git rev-list @{u}...HEAD` падает при отсутствии upstream — `ahead`/`behind` = 0 и флаг «upstream не настроен» в `git`-секции (отдельным булевым полем, не текстом в числах);
- каждая секция в своём `try/catch`: сбой одного источника не рушит сводку, в результат пишется `error` этой секции (чтобы `--json` оставался стабильным).

## Шаг 2. `src/cli/commands/status.ts`

`runStatus(positional, flags, cwd)`:
- `flags.json` → `console.log(JSON.stringify(collectStatus(cwd), null, 2))`;
- `flags.short` → по строке на пункт, без рамок и заголовков;
- по умолчанию → блоки с заголовками (`Vibelog.md 1.12.0`, `Проект`, `Задачи`, `Фазы`, `Очередь`, `Прогон`, `Git`), пустые секции — одной строкой «—»;
- код возврата: `0` всегда, кроме отсутствия `backlog/` → `1` с подсказкой `vibelog init` (совместимо с поведением `doctor` для обязательной проверки).

## Шаг 3. Роутер и справка

- `case 'status': return runStatus(positional, flags, cwd);`
- в `showHelp()` — строка после `doctor`, в `showCommandHelp` — описание флагов.

## Шаг 4. Тесты

`src/core/status.test.mjs` (mkdtemp-фикстура, lesson-104):
1. пустой каталог без `backlog/` → `project === null`, `collectStatus` не бросает;
2. проект с 3 задачами в разных статусах → `byStatus`/`total` верны;
3. автоочередь: файл с pending/running/failed → секция `queue` соответствует;
4. git-репозиторий с `git init` + один коммит → `branch` и `untracked` считаются; каталог вне git → `git === null`;
5. битый `auto-queue.json` → секция с `error`, остальные секции на месте.

`src/cli/status-cli.test.mjs`: вызов реального CLI (как `src/cli/diagnostics.test.mjs`) — человекочитаемый вывод содержит `Фазы`/`Git`, `--json` парсится и имеет ключи `version`/`tasks`/`runs`/`queue`/`grant`/`git`.

## Шаг 5. Проверка

`pnpm build && pnpm test`; вручную `node bin/vibelog.mjs status` и `status --json` в этом репозитории — секции отражают реальное состояние; запуск в каталоге без `backlog/` не падает.

## Риски

- `git status --porcelain` в большом репозитории медленный (в этом — сотни файлов из-за `backlog/`) → секунды; допустимо, но при желании `--no-git` как флаг.
- Секция grant читает `.vibelog/supervisor/grants/` — в worktree задачи путь другой; брать `findBacklogDir(cwd)`-родителя, как в остальном коде (не хардкодить `.vibelog`).
- `listTasks` парсит все `.md` (doc-22 §4.1): для `status` это 300+ чтений, приемлемо, кэш — отдельная задача.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 13:34
---
Фаза code не удалась (код выхода 1): блокировок=0, payload последнего запроса=362577 байт (макс 362577), usage={"input_tokens":1560350,"output_tokens":9566,"cache_read_input_tokens":1362432,"total_tokens":1569916,"reasoning_tokens":7802} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-05 15:21
---
Фаза 3 (Code) выполнена. Изменено: `src/core/status.ts` (новый — сбор данных `collectStatus`: версия из package.json, проект/префикс и счётчики задач по статусам через `loadConfig`+`listTasks`, идущие фазы через `getRun` + транзиент-кэш с проверкой живости pid, автоочередь через `loadAutoQueue`, активный grant через `findActiveGrant`, git через `spawnSync('git', …)` без shell; каждая секция в своём try/catch, `.vibelog/` берётся от родителя `findBacklogDir` — риск worktree из плана учтён), `src/cli/commands/status.ts` (новый — только печать: блоки с заголовками, `--json`, `--short`, `--no-git`; код 1 без `backlog/` с подсказкой `vibelog init`), `src/cli/router.ts` (импорт, `case 'status'`, строка в `showHelp()`, раздел в `showCommandHelp`), тесты `src/core/status.test.mjs` (8 кейсов: пустой каталог, задачи по статусам, автоочередь pending/running/done/failed, отсутствие файла очереди, битый auto-queue.json, git-репозиторий с untracked, вне git, `--no-git`) и `src/cli/status-cli.test.mjs` (5 кейсов: человекочитаемый вывод с секциями Фазы/Git, `--json` со стабильными ключами, `--short`, `--no-git`, код 1 без backlog). Коммит 5e3c766 (ветка vb/vl-341). Проверки: `pnpm build` — успешно; полный `pnpm test` — 180 файлов, 3406 passed, 4 skipped, без исключений и skip-флагов; ручной прогон `node bin/vibelog.mjs status` и `status --json` в этом репозитории — секции отражают реальное состояние (версия 1.12.0, 329 задач, ветка vb/vl-341, upstream не настроен), запуск в каталоге без `backlog/` даёт код 1 и подсказку. Что осталось: AC12 (CHANGELOG.md и раздел `status` в doc-7) — по правилам фазы Code документация пишется в Close; DoD2 (документация) по той же причине не отмечен.
---
author: @agent
created: 2026-11-05 16:10
---
Фаза close не удалась (код выхода 1): 2, блокировок=0, payload последнего запроса=163351 байт (макс 163351), usage={"input_tokens":814057,"output_tokens":3512,"cache_read_input_tokens":760320,"total_tokens":817569,"reasoning_tokens":1346} — статус возвращён к Review.
---
author: @agent
created: 2026-11-05 16:34
---
Фаза Close выполнена. Статус: Done.
**Коммиты:**
- feat `5e3c766` — команда vibelog status (код и тесты; уже был в main после merge b4acd68, остатков кода не требовалось)
- docs `cdf1536` — CHANGELOG.md (запись VL-341 в Unreleased/Добавлено) + doc-7 (новый раздел `status` с флагами и источниками данных)
- docs(task) `f7f9d99` — lesson-226 (сводка по секциям в отдельном try/catch)
**Проверки после merge:** `pnpm build` — успешно; полный прогон `pnpm test:fast` (dist собран шагом выше) — 181 файл, 3421 тест прошёл, 4 skipped, 0 падений. Merge-интерференции нет.
**Документация:** AC 12 закрыт — CHANGELOG.md обновлён, doc-7 дополнен разделом `status` (флаги `--json`/`--short`/`--no-git`, источники данных, поведение при отсутствии backlog/, автоочереди, upstream, вне git; код возврата).
**Не закоммичено:** нет. Файл задачи VL-341 коммитит framework; чужие незакоммиченные изменения (.vibelog/settings.json, doc-25, doc-26, задачи VL-342…VL-345, web/public/vibelog.svg) не относятся к VL-341 и не тронуты.
---
<!-- COMMENTS:END -->