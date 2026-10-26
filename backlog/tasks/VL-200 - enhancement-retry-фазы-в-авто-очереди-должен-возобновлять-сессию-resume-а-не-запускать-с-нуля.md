---
id: VL-200
title: Retry фазы авто-очереди возобновляет сессию через --resume
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 23:59'
updated_date: '2026-10-27 02:10'
due_date: ''
labels:
  - core
  - agent
dependencies: []
milestone: ''
references: []
priority: high
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/orchestrator.ts
  - src/bot/auto-runner.ts
  - src/bot/auto-runner.test.mjs
lessons:
  - lesson-56
  - lesson-57
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-197. При ошибке фазы auto-runner.ts (handlePhaseFailure → autoTick → startTaskPhase) перезапускает фазу с полным промптом в НОВОЙ сессии — инцидент VL-197: после обрыва plan VL-193 создана agent-1793028420789.jsonl вместо продолжения agent-1793026414766.jsonl, 36 tool-вызовов и 34 минуты исследования потеряны. startTaskPhase умеет принимать extraArgs с --resume, но auto-runner их не передаёт; при этом механизм findTaskPhaseSessionSync уже существует (им пользуется code_same_session). Передавать при retry --resume <последняя сессия задачи/фазы>; учесть, что resume возможен не в worktree, если сессия создавалась вне его (комментарий session.ts:121, инцидент VL-98).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Retry фазы после ошибки дописывает новые сообщения в существующий JSONL сессии этой фазы (не создаёт agent-*.jsonl), при этом промпт retry-рана — штатный фазовый.
- [x] #2 Тест auto-runner.test.mjs: после exitCode!=0 следующий startTaskPhase вызван с --resume корректного sessionId; счётчик attempts и max_retries не ломаются.
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
Retry фазы авто-очереди передаёт `--resume <sessionId>` последней сессии ЭТОЙ фазы, вместо запуска в новой сессии (инцидент VL-197: потеря 36 tool-вызовов/34 мин).

## Расхождение с описанием (скорректировано при Plan)
В описании сказано «startTaskPhase умеет принимать extraArgs с --resume» — по факту НЕ умеет: `startTaskPhase` (src/web/orchestrator.ts:350-372) принимает opts только `{comment, onExit, agent, sameSession}`, а `startPhase` (orchestrator.ts:156-164) — `{sameSession}`. extraArgs строится внутри startPhase только для code_same_session (orchestrator.ts:235-256) и передаётся в spawnQwenRun (orchestrator.ts:309, 317). Значит, часть работы — ДОБАВИТЬ проброс extraArgs через startTaskPhase → startPhase.

## Файлы для изменения
1. `src/web/orchestrator.ts` — проброс extraArgs.
2. `src/bot/auto-runner.ts` — вычисление resume-аргументов при retry + тестовый шов.
3. `src/bot/auto-runner.test.mjs` — тесты (AC2 + юнит).
4. `CHANGELOG.md` — запись VL-200 (DoD «документация обновлена»; README /auto-секции не содержит — документация авто-очереди живёт в CHANGELOG).

## Изменения по файлам (точные места)

### 1. src/web/orchestrator.ts
- **:354-360** `startTaskPhase` opts: добавить `extraArgs?: string[]`; в вызове startPhase (:367-371) пробросить `{ sameSession: opts?.sameSession, extraArgs: opts?.extraArgs }`. Обновить JSDoc @param opts.
- **:163** `startPhase` opts: `opts?: { sameSession?: boolean; extraArgs?: string[] }`; JSDoc.
- **:235** `let extraArgs: string[] = [];` → `let extraArgs: string[] = opts?.extraArgs ?? [];`
- **:241-256** блок code_same_session: обернуть резолв план-сессии условием `!extraArgs.includes('--resume')` (lesson-18: дубль --resume запрещён). Явный retry-resume приоритетнее: при retry-фазе code продолжается УПАВШАЯ code-сессия, а не plan. При пропуске sameSessionStatus остаётся 'off' (поле читает только бот/API, auto-runner его не использует). Prompt-примечание «Сессия продолжает фазу plan…» добавлять только при реальном резолве (промпт retry — штатный фазовый, AC1).
- **:106-112** `QueuedClose`: добавить `extraArgs?: string[]`.
- **:296** `closeQueue.push({cwd, taskId, onExit, extraVars, agent})` → добавить `extraArgs: opts?.extraArgs` (иначе retry close в очереди branch-mode теряет --resume).
- **:389** `drainCloseQueue` → `startPhase(next.cwd, next.taskId, 'close', next.onExit, next.extraVars, next.agent, { extraArgs: next.extraArgs })`.

### 2. src/bot/auto-runner.ts
- Импорты: `agentSessionsDir, findTaskPhaseSessionSync, loadSessionMetaSync` из `../agent/session.js`; `taskWorktreeDir` из `../core/worktree.js`; `existsSync` из `node:fs`; `join` из `node:path`.
- **Новая экспорт-функция `retryResumeArgs(cwd, taskId, phase): string[]`** (после nextFailureAction, ~:77):
  1. `sid = findTaskPhaseSessionSync(agentSessionsDir(cwd), taskId, phase)` — только главный репо: в branch-mode агент пишет/читает сессии через VIBELOG_CWD=главный cwd (cli.ts:336, VL-107 fix). Если сессия только в worktree-каталоге (legacy) — JSONL недоступен агенту, resume упал бы на «Сессия не найдена» → возвращаем `[]`.
  2. Guard: `existsSync(join(dir, sid + '.jsonl'))` — meta без jsonl → `[]` (надёжнее новая сессия, чем endless-retry).
  3. Guard cwd (VL-98, session.ts:121): `meta = loadSessionMetaSync(dir, sid)`; если `meta.cwd` задан и (после realpathSync, с try/catch) не совпадает ни с `cwd`, ни с `taskWorktreeDir(cwd, taskId)` — чужой каталог → `[]` + console.log-диагностика.
  4. Возврат `['--resume', sid]`.
- **Тестовый шов** (паттерн setSpawnEnvBaseForTests VL-140), рядом с `autoActive` (~:46): `let startPhaseImpl = startTaskPhase;` + `export function setStartPhaseForTests(fn | null)` (null → вернуть оригинал). Обязателен сброс в finally теста (isolate:false — шов иначе утечёт в другие файлы воркера).
- **autoTick :247-251**: перед вызовом:
  ```ts
  const isRetry = (item.attempts ?? 0) > 0;          // attempts>0 ⇔ предыдущая попытка ЭТОЙ фазы упала (успех сбрасывает в 0, finishCurrentPhase)
  const extraArgs = isRetry ? retryResumeArgs(cwd, item.id, phase) : [];
  const result = startPhaseImpl(cwd, item.id, phase, { onExit, agent: ..., extraArgs });
  ```
- Шапка файла (:1-27): дополнить комментарий — retry идёт с --resume в существующую сессию фазы (VL-200).

Семантика attempts/max_retries НЕ меняется — resume влияет только на extraArgs (AC2).

### 3. src/bot/auto-runner.test.mjs
- **Тест A (основной, AC2)** — seam `setStartPhaseForTests`:
  1. freshDir + `createTaskFile(dir, {id: 'VL-7', title: …})` (статус To Do → фаза spec) + mkdir `.vibelog/agent-sessions`.
  2. Создать `agent-test1.jsonl` (2 строки) + `agent-test1.meta.json` `{taskId:'VL-7', phase:'spec', cwd: dir}`.
  3. `saveAutoQueue(dir, {running:true, tasks:[{id:'VL-7', status:'pending', attempts:0}]})`.
  4. Стаб startTaskPhase: 1-й вызов — захватить opts, вызвать `opts.onExit({exitCode:1, logTail:'упало', phase:'spec', running:false})` → handlePhaseFailure → attempts=1 ≤ max_retries(1) → retry → setImmediate(autoTick) → 2-й вызов.
  5. Assert: 1-й вызов `extraArgs` пуст/[]; 2-й вызов `deepEqual(opts.extraArgs, ['--resume','agent-test1'])`; прочие opts (comment и т.п.) не изменились (штатный фазовый промпт, AC1); очередь `attempts===1`, status 'running'.
  6. 2-й стаб → onExit exitCode:1 снова → attempts=2 > max → `status==='failed'`, attempts===2 (счётчики не сломаны).
  7. finally: `setStartPhaseForTests(null)`, `stopAutoPoll()`.
- **Тест B (юнит retryResumeArgs)**: сессия есть → `['--resume', sid]`; нет сессии → `[]`; meta без jsonl → `[]`; meta.cwd чужой (напр. другой временный каталог) → `[]`.
- **Тест C (интеграция, реальный спавн — доказывает AC1 «штатный фазовый промпт»)** — паттерн stub-бинаря из orchestrator.test: `setSpawnEnvBaseForTests({...process.env, VIBELOG_QWEN_BIN: stub, VL28_STUB_EXIT:'1', VL28_STUB_MARKER: marker})`; stub дописывает `JSON.stringify(process.argv.slice(2))\n` в marker (append!), печатает stdout, exit 1. autoTick → spawn1 (нет --resume, exit 1) → retry → spawn2. Poll marker до 2 строк (timeout ~6с) или queue.status==='failed'. Assert: строка 2 содержит `['--resume','agent-…']`; `argv[0]` (промпт) строки1 === строки2 — штатный фазовый промпт не изменён; итог `attempts===2, status==='failed'` (ровно 2 спавна — нет третьего). finally: `setSpawnEnvBaseForTests(null)`.

### 4. CHANGELOG.md
- Новая сверху запись `- **VL-200: …**` (retry авто-очереди с --resume: проброс extraArgs в startTaskPhase/startPhase, retryResumeArgs, тесты A/B/C).

## Порядок действий
1. orchestrator.ts: проброс extraArgs (opts → startPhase → merge) + QueuedClose/drain.
2. auto-runner.ts: retryResumeArgs + шов + wiring в autoTick + шапка.
3. Тесты A, B, C в auto-runner.test.mjs.
4. CHANGELOG.
5. Сборка и проверки.

## Как проверить
```bash
pnpm build                      # tsc → dist (обязательно: тесты импортируют dist/)
pnpm test:fast src/bot/auto-runner.test.mjs   # целевой файл
pnpm test                       # полный прогон (build + vitest run) — DoD «нет регрессий»
```

## Риски
1. **Дубль --resume (lesson-18)** при code-фазе + включённом code_same_session → guard `!extraArgs.includes('--resume')` в startPhase; retry-сессия приоритетнее plan-сессии.
2. **Утечка тестовых швов** (isolate:false, fileParallelism:true) — оба шва сбрасывать в finally.
3. **Сессия только в worktree-каталоге** (legacy без VIBELOG_CWD) — агент её не найдёт → resume skip, новая сессия (better fail-open, иначе endless-retry «Сессия не найдена»).
4. **Тайминги теста C** (async onExit → setImmediate → spawn) — polling с таймаутом; 409 «Запуск уже выполняется» исключён: activeRuns.delete(key) (orchestrator.ts:895) вызывается в finish() ДО onExit.
5. **attempts>0 при смене фазы** (ручная смена статуса между ретраями) — findTaskPhaseSessionSync фильтрует по текущей phase, сессии другой фазы не вернутся → `[]`, поведение прежнее.
6. Ограничение scope: restart процесса ДО первой попытки (attempts=0, но jsonl уже существует) не покрывается — AC привязан к «после exitCode!=0»; отметить в финальном отчёте.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 00:02
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Retry фазы авто-очереди возобновляет сессию через --resume» (был длиннее 80 символов и содержал дублирующий тип). Тип: enhancement. Масштаб: task. Приоритет: High (по предложению №2 из VL-197/doc-14, потеря 36 tool-вызовов/34 мин — блокирует штатную работу авто-режима). Уточнено: цель (retry через --resume в existing-JSONL вместо новой сессии), контекст (инцидент VL-197), ограничение worktree (VL-98, session.ts:121) добавлено в AC; AC переформулированы в 3 проверяемых критерия (включая обход --resume вне worktree). Labels: core, agent. References: нет (упомянуты только внутренние файлы/задачи — внешних источников нет). Вопросов нет.
---
author: @agent
created: 2026-10-27 01:18
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача — план записан в задачу). Изучены: src/bot/auto-runner.ts (handlePhaseFailure/autoTick:247), src/web/orchestrator.ts (startTaskPhase:350, startPhase:156, extraArgs:235, code_same_session:241-274, QueuedClose:106, drainCloseQueue:389), src/agent/session.ts (findTaskPhaseSessionSync:174, meta cwd/VL-98), src/agent/cli.ts (VIBELOG_CWD→главный репо, VL-107), тесты-заготовки. Ключевое уточнение против описания: startTaskPhase НЕ принимает extraArgs (только {comment,onExit,agent,sameSession}) — план включает проброс extraArgs через startTaskPhase→startPhase (с guard дубля --resume по lesson-18) плюс новую функцию retryResumeArgs в auto-runner (главный репо, existsSync jsonl, guard чужого cwd) и три теста: seam-тест AC2 (после exitCode!=0 второй вызов с ['--resume', sid], attempts/max_retries не ломаются), юнит retryResumeArgs, интеграционный со stub-бинарём (штатный фазовый промпт retry == первому рану). 4 файла: orchestrator.ts, auto-runner.ts, auto-runner.test.mjs, CHANGELOG.md. Риски: дубль --resume (code_same_session), утечка тестовых швов (isolate:false → finally), legacy-сессии только в worktree (fail-open), async-тайминги интеграционного теста.
---
author: @agent
created: 2026-10-27 01:51
---
Фаза 3 (Code) выполнена. Изменено: src/web/orchestrator.ts (проброс extraArgs через startTaskPhase→startPhase, guard дубля --resume в code_same_session по lesson-18, QueuedClose.extraArgs + drainCloseQueue), src/bot/auto-runner.ts (retryResumeArgs: main-репо + existsSync jsonl + guard чужого meta.cwd по VL-98; тестовый шов setStartPhaseForTests по паттерну VL-140; wiring isRetry→extraArgs в autoTick), src/bot/auto-runner.test.mjs (+3 теста: seam-тест AC2, юнит retryResumeArgs на 5 кейсов, интеграционный со stub-бинарём AC1). Коммит 90a3a74 (ветка vb/vl-200). Проверки: pnpm build — ок; pnpm test:fast src/bot/auto-runner.test.mjs — 15/15; pnpm test — 1348 passed/1 failed: reference.test.mjs VL-152 (сетевой git-clone, таймаут 120с под параллельной нагрузкой) — при отдельном прогоне 22/22 проходит, к изменениям не относится (flaky). AC1: интеграционный тест доказывает, что retry-spawn получает --resume agent-vl200 и argv[0] (штатный фазовый промпт) идентичен первому рану; дописывание в тот же JSONL — свойство CLI-продпути --resume (покрыто cli.test VL-95). AC2: seam-тест — второй вызов startTaskPhase с ['--resume','agent-test1'], попытки 0→1→2, max_retries=1 → failed, без сбросов. DoD: тесты — ок; документация — JSDoc обновлён в обоих файлах, запись CHANGELOG отложена в Close (правило фазы Code не обновлять CHANGELOG); регрессий нет (полный прогон). References не использовались; lesson-18 применён (уже связан). Ограничение scope (из плана): restart процесса до первой попытки (attempts=0) с существующим jsonl — вне AC, resume не передаётся.
---
author: @agent
created: 2026-10-27 02:10
---
Фаза Close выполнена. Ветка vb/vl-200 слита в master (1 коммит 90a3a74, merge без конфликтов), worktree удалён (force: только untracked-симлинки node_modules/refs), ветка удалена. Сборка и тесты после merge: pnpm build — ок; pnpm test — 75/75 файлов, 1356+7 passed, 0 failed (первый прогон дал 3 flaky-падения в config-cli/search-cli — «Backlog-директория не найдена»/фильтр поиска; отдельные повторные прогоны обоих файлов — 15/15 и полный прогон — чисто, к изменениям VL-200 не относятся, lesson-20/23 применимы). Lessons: созданы lesson-56 (fail-open guard'ы для retry --resume) и lesson-57 (сброс тестовых швов в finally при isolate:false), связаны с задачей; refs отсутствовали. Документация: запись VL-200 в CHANGELOG.md (Unreleased → Добавлено) — коммит f350e82; docs-коммит refs/lessons — 30512cb. DoD: 1 (тесты проходят) — ок, 2 (документация обновлена) — CHANGELOG, 3 (нет регрессий) — полный прогон чист. Ограничение scope (из плана): restart процесса до первой попытки (attempts=0) с существующим jsonl — вне AC, resume не передаётся.
---
<!-- COMMENTS:END -->