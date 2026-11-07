---
id: VL-352
title: '.vibelog/billing никто не коммитит: история трат не попадает в git, рабочее дерево вечно грязное'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 14:03'
updated_date: '2026-11-07 15:04'
due_date: ''
labels:
  - infra
  - repo-hygiene
  - billing
  - bug
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/task-commit.ts
  - src/agent/task-commit.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/cli/commands/doctor.ts
  - src/cli/diagnostics.test.mjs
lessons: []
token_usage:
  input: 10083459
  output: 40028
  cache: 9820160
  total: 10123487
  requests: 165
  duration_ms: 682973
  reasoning: 8471
  by_phase:
    code:
      input: 7393232
      output: 28919
      cache: 7193600
      requests: 104
    close:
      input: 2690227
      output: 11109
      cache: 2626560
      requests: 61
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`.vibelog/.gitignore` (VL-329) явно разрешает `billing/` и `settings.json` в git — политика «история трат должна жить рядом с задачами». Но **никто их не коммитит**: `.vibelog/billing/*.json` копится грязным после каждого рана, история трат в репозиторий не попадает.

## Почему так вышло

VL-277 перенёс коммит **файла задачи** в пост-ран (`src/agent/task-commit.ts`, `commitTaskFile`), но коммитится ровно один путь и только в фазе close (`TASK_COMMIT_PHASES = ['close']`). `appendBilling` пишется в пост-ране каждой фазы, причём в CLI — **после** `commitTaskFile` (`cli.ts:1072` → `:1093`), поэтому billing гарантированно остаётся грязным.

## Решение (уточнено после обсуждения)

Отдельный коммит на каждый ран — слишком много шума. Вместо этого **billing уходит в тот же коммит, что и файл задачи с `token_usage`** (close):

- `commitTaskFile` получает `extraPaths` и коммитит файл задачи + `.vibelog/billing/<TASK>.json` одним `git add -- <пути>`;
- в CLI переставляется порядок: `appendBilling` **до** `commitTaskFile` (в оркестраторе порядок уже верный);
- в фазах кроме close billing не коммитится — копится до close и уходит одним коммитом;
- выключатель `billing.commit` не нужен — шума нет.

`settings.json` остаётся ручным (правки тарифов/моделей — осознанное действие), но `doctor` предупреждает, если он грязный.

## Связанные задачи

VL-329 (git-политика `.vibelog/`), VL-277 (автокоммит файла задачи в пост-ране), VL-348 (init: git-политика и первый коммит).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `.vibelog/billing/<TASK>.json` попадает в ТОТ ЖЕ коммит, что и файл задачи с `token_usage` (close) — отдельного `chore(billing)`-коммита нет, коммит-шума не добавляется
- [x] #2 `commitTaskFile` (`src/agent/task-commit.ts`) принимает дополнительные пути (`extraPaths`): коммитит файл задачи + существующие billing-файлы одним `git add -- <пути>`; несуществующие пути отфильтровываются (appendBilling мог упасть)
- [x] #3 В `src/agent/cli.ts` порядок пост-рана исправлен: `appendBilling` вызывается ДО `commitTaskFile` (сейчас наоборот — :1072 коммит, :1093 billing), иначе billing не попадает в коммит
- [x] #4 В `src/web/orchestrator.ts` порядок уже верный (`appendBilling` :1321 → `commitTaskFile` :1368) — передать billing-путь в `commitTaskFile`; в fallback-ветке (:1403) после `appendBilling` вызвать `commitTaskFile` повторно (идемпотентно: грязно → закоммитит, чисто → null)
- [x] #5 В фазах кроме close billing НЕ коммитится (гейт `TASK_COMMIT_PHASES` не меняется) — копится до close и уходит одним коммитом; это осознанный компромисс, зафиксирован в документации
- [x] #6 `vibelog doctor` предупреждает, если `.vibelog/billing/` грязный (задача не дошла до close) или `settings.json` изменён — с подсказкой закоммитить вручную
- [x] #7 Выключатель `billing.commit` НЕ добавляется — при таком подходе он не нужен (шума нет)
- [x] #8 Тесты: `src/agent/task-commit.test.mjs` (billing в том же коммите, что файл задачи; несуществующий billing-путь не ломает коммит; amend своего docs(task)-коммита включает billing; чужой HEAD → новый коммит с обоими путями), `src/agent/cli.test.mjs` (порядок: billing записан до коммита), doctor-тест (грязный billing → предупреждение)
- [x] #9 `pnpm build && pnpm test` проходят без регрессий
- [x] #10 Документация: doc-6 (git-политика `.vibelog/`: billing уходит с коммитом задачи в close, settings.json — вручную), doc-10 (состав пост-рана), CHANGELOG.md
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

- `src/agent/task-commit.ts` — `commitTaskFile` + параметр `extraPaths`.
- `src/agent/cli.ts` — перестановка порядка пост-рана (~:1055–1100).
- `src/web/orchestrator.ts` — передача billing-пути (~:1368), повторный вызов в fallback (~:1403).
- `src/cli/commands/doctor.ts` — проверка незакоммиченности billing и settings.
- Тесты: `src/agent/task-commit.test.mjs`, `src/agent/cli.test.mjs`, doctor-тест.
- Документация: `backlog/docs/doc-6`, `backlog/docs/doc-10`, `CHANGELOG.md`.

## Шаг 1. `commitTaskFile` — дополнительные пути

`src/agent/task-commit.ts:109`. Добавить необязательный параметр:

```ts
export function commitTaskFile(
  cwd: string,
  taskId: string,
  phase: string,
  extraPaths: string[] = [],
): string | null
```

Логика:

1. `taskPath` — как сейчас (`resolveTaskPath`).
2. `paths = [taskPath, ...extraPaths.filter(p => existsSync(join(cwd, p)))]` — несуществующие отбрасываются: `appendBilling` мог упасть, и `git add` на отсутствующем пути вернул бы ошибку.
3. Грязь проверять по ВСЕМ путям: `git status --porcelain -- <paths...>`; пусто → `null`.
4. `git add -- <paths...>` (явные пути, `-A` не используется).
5. Amend-логика без изменений: если HEAD — свой `docs(task): <ID>` (закрытие/token_usage) и не запушен → `--amend`; иначе новый коммит. Billing попадает в тот же коммит автоматически, потому что он в индексе.

## Шаг 2. `src/agent/cli.ts` — порядок пост-рана

Сейчас (~:1055–1100): `addTaskTokenUsage` → `writeAutoReportIfMissing` → `commitTaskFile` → `appendBilling`.

Нужно: `addTaskTokenUsage` → `writeAutoReportIfMissing` → **`appendBilling`** → `commitTaskFile(taskCwd, taskId, runPhase, [billingPath(taskCwd, taskId)])`.

`appendBilling` остаётся в своём `try/catch` (ошибка учёта не должна ломать коммит), но физически выше. Импорт `billingPath` из `../core/billing.js` уже есть в файле — проверить.

## Шаг 3. `src/web/orchestrator.ts`

- Основной путь (~:1368): `commitTaskFile(cwd, phaseTaskId, byPhaseKey, [billingPath(cwd, phaseTaskId)])` — порядок уже верный (`appendBilling` :1321 выше).
- Fallback-ветка (~:1403): после `appendBilling` и `updateSessionMeta` вызвать `commitTaskFile(cwd, phaseTaskId, vbRunPhase, [billingPath(cwd, phaseTaskId)])`. Идемпотентно: грязно → закоммитит, чисто → `null`. Ошибку глушить в `.catch` того же `.then()`, чтобы не всплывала в учёт токенов.

## Шаг 4. `doctor` — незакоммиченность

`src/cli/commands/doctor.ts`, рядом с `policyChecks` (~:470):

- `git status --porcelain -- .vibelog/billing/` непусто → предупреждение с перечнем файлов (до 5) и подсказкой: «задача не дошла до close — billing закоммитится вместе с файлом задачи; закоммитить сейчас: git add .vibelog/billing && git commit -m 'chore(billing): …'».
- `git status --porcelain -- .vibelog/settings.json` непусто → предупреждение «settings.json изменён — правки тарифов/моделей коммитятся вручную».
- Вне git-репозитория обе проверки → `ok: true` (как существующие `policyChecks`).

## Шаг 5. Тесты

`src/agent/task-commit.test.mjs`:

- billing-файл + файл задачи → ОДИН коммит, в нём оба пути (`git show --name-only`);
- несуществующий billing-путь в `extraPaths` → коммит проходит по файлу задачи, ошибки нет;
- amend своего `docs(task)`-коммита включает billing (второй вызов с тем же HEAD);
- чужой HEAD (`feat: …`) → новый коммит с обоими путями;
- только billing грязный (файл задачи чист) → коммит создаётся.

`src/agent/cli.test.mjs`: после close-рана `git status` чист по `.vibelog/billing/`, в последнем коммите есть billing-путь.

doctor-тест: грязный `.vibelog/billing/` → предупреждение; грязный `settings.json` → предупреждение; чистое дерево → `ok`.

## Шаг 6. Проверка и документация

- `pnpm build && pnpm test` — полный прогон.
- Ручная проверка: close-ран → `git status` чист, `git log -1 --name-only` содержит файл задачи и billing.
- `backlog/docs/doc-6`: git-политика `.vibelog/` — billing уходит с коммитом задачи в close, в промежуточных фазах копится; settings.json — вручную.
- `backlog/docs/doc-10`: состав пост-рана (файл задачи + billing одним коммитом).
- `CHANGELOG.md` → `## [Unreleased]` / «Исправлено».

## Риски

- **Billing копится до close.** Задача, не дошедшая до close (отменена, брошена), оставит billing грязным. Смягчение — предупреждение в `doctor`; автокоммит в каждой фазе отвергнут из-за шума.
- **Перестановка в CLI** меняет порядок побочных эффектов пост-рана. `appendBilling` идемпотентен по маркеру `billing_recorded` (lesson-58), повторный вызов не даёт двойного учёта — проверить тестом.
- **Fallback-ветка** пишет billing асинхронно; повторный `commitTaskFile` там же — ошибка не должна всплывать в `.catch` учёта токенов.
- **`settings.json` остаётся грязным** — осознанно, но `doctor` должен напоминать, иначе вернётся та же жалоба.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 14:12
---
Фаза code не удалась (код выхода 1): локировок=0, payload последнего запроса=425380 байт (макс 425380), usage={"input_tokens":2787579,"output_tokens":11958,"cache_read_input_tokens":2698752,"total_tokens":2799537,"reasoning_tokens":2354} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 14:16
---
Фаза 3 (Code) выполнена. Коммит 03bb07d в ветку vb/vl-352.
Изменено:
- `src/agent/task-commit.ts` — `commitTaskFile(cwd, taskId, phase, extraPaths = [])`: пути = файл задачи + существующие extraPaths (абсолютные берутся как есть, относительные через join(cwd)), грязь проверяется `git status --porcelain -- <все пути>`, `git add -- <все пути>`; amend-логика не менялась (billing попадает в тот же коммит, т.к. он в индексе).
- `src/agent/cli.ts` — порядок пост-рана исправлен: `addTaskTokenUsage` → `writeAutoReportIfMissing` → **`appendBilling`** → `commitTaskFile(taskCwd, taskId, runPhase, [billingPath(taskCwd, taskId)])` под гейтом `isTaskCommitPhase`; импорт `billingPath` добавлен.
- `src/web/orchestrator.ts` — основной путь передаёт `[billingPath(cwd, phaseTaskId)]`; в fallback-ветке после `appendBilling`/`updateSessionMeta`/`appendSessionRun` вызывается `commitTaskFile` повторно (идемпотентно), ошибка глушится локальным try/catch, чтобы не всплывать в `.catch` учёта токенов.
- `src/cli/commands/doctor.ts` — новые проверки `vibelog_billing_clean` и `vibelog_settings_clean` (`checkVibelogDirty` + хелпер `gitStatusPorcelain`): грязный `.vibelog/billing/` → предупреждение с перечнем до 5 файлов и подсказкой `git add .vibelog/billing && git commit -m "chore(billing): …"`; изменённый `settings.json` → предупреждение о ручном коммите; вне git-репозитория обе — `ok: true`. В `requiredNames` не входят (не блокирующие).
Тесты (все зелёные):
- `src/agent/task-commit.test.mjs` +6 кейсов: billing+файл задачи → ОДИН коммит с обоими путями; несуществующий billing-путь не ломает коммит; amend своего `docs(task)`-коммита включает billing; чужой HEAD → новый коммит с обоими путями; только billing грязный → коммит создаётся; оба чистых → `null`.
- `src/agent/cli.test.mjs` +2: close-ран коммитит billing тем же коммитом (в `git show --name-only` оба пути, `chore(billing)` в истории нет); code-ран billing НЕ коммитит (копится до close).
- `src/web/orchestrator.test.mjs` +1: qwen-путь close — billing и файл задачи в одном коммите.
- `src/cli/diagnostics.test.mjs` +4: грязный billing → предупреждение с подсказкой; грязный settings.json → предупреждение; чистое дерево → ok; вне git → ok.
Проверки: `pnpm build` — успешно; полный `pnpm test` — 184 файла, 3476 passed, 4 skipped (пропуски — предсуществующие `src/core/frontmatter.test.mjs`, к задаче не относятся), регрессий нет.
Что осталось (Фаза Close): документация — `backlog/docs/doc-6` (git-политика `.vibelog/`: billing уходит с коммитом задачи в close, в промежуточных фазах копится; settings.json — вручную), `backlog/docs/doc-10` (состав пост-рана), `CHANGELOG.md` → `## [Unreleased]` / «Исправлено». AC10 не отмечен по этой причине.
---
author: @agent
created: 2026-11-07 15:01
---
Фаза close не удалась (код выхода 1): ет, блокировок=0, payload последнего запроса=166116 байт (макс 166116), usage={"input_tokens":644468,"output_tokens":1675,"cache_read_input_tokens":626688,"total_tokens":646143,"reasoning_tokens":505} — статус возвращён к Review.
---
author: @agent
created: 2026-11-07 15:04
---
Фаза Close выполнена. Ветка vb/vl-352 слита в master (1 коммит, 03bb07d → merge ec112e6), worktree удалена (force — внутри был только untracked симлинк backlog/references/data, артефакт оркестратора), ветка vb/vl-352 удалена.
Проверки после merge: `pnpm build` — успешно; ранний точечный прогон затронутых тестов (task-commit, cli, diagnostics, orchestrator) — 4 файла, 193 passed; полный `npx vitest run` — 185 файлов, 3489 passed, 4 skipped (предсуществующие пропуски в src/core/frontmatter.test.mjs, к задаче не относятся), регрессий нет.
Документация (коммит e1d5cba): doc-6 — новый пункт «Кто и когда коммитит .vibelog/billing/ и settings.json (VL-352)»; doc-10 §3.3 — новый абзац «Состав пост-рана и коммит billing (VL-352)»; CHANGELOG.md — запись в Unreleased / Исправлено.
DoD: 1 (Тесты проходят) — выполнен; 2 (Документация обновлена) — выполнен в этой фазе; 3 (Нет регрессий) — выполнен. AC10 отмечен.
Lessons: шаг 7.5 пропущен — MCP-инструмент lesson_create отклонял вызовы без поля content, урок не создан; на закрытие задачи это не влияет (урок можно завести отдельно).
---
<!-- COMMENTS:END -->