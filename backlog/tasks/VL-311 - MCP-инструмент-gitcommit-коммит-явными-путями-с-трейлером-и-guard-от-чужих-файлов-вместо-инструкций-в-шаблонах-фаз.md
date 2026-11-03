---
id: VL-311
title: 'MCP-инструмент git_commit: коммит явными путями с трейлером и guard от чужих файлов вместо инструкций в шаблонах фаз'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 00:03'
updated_date: '2026-11-03 22:30'
due_date: ''
labels:
  - agent
  - mcp
  - git
  - templates
dependencies: []
milestone: v1.12
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - .gitignore
  - CHANGELOG.md
  - backlog/docs/doc-8-MCP-справочник-Vibelogmd.md
  - backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md
  - backlog/lessons/lesson-179-Узел-nodemodules-в-worktree-симлинк-шаблон-nodemodules-в-gitignore-его-не-покрывает-добавляй-и-nodemodules.md
  - backlog/lessons/lesson-180-Правило-фазы-про-git-коммит-трейлер-явные-пути-переноси-из-текста-промпта-в-write-инструмент-иначе-оно-держится-на-дисциплине-модели.md
  - src/mcp/git-commit.ts
  - src/mcp/git-commit.test.mjs
  - src/mcp/tools.ts
  - src/mcp/write-ack-contract.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/documents.test.mjs
  - src/core/tool-classify.ts
  - src/core/commit-trailer.ts
  - src/core/commit-trailer.test.mjs
  - src/core/compat-full.test.mjs
  - src/cli/commands/doctor.ts
  - src/cli/diagnostics.test.mjs
  - src/web/phase-prompt.ts
  - src/web/phase-prompt.test.mjs
  - src/web/tool-policy.test.mjs
  - src/web/supervisor-grant.test.mjs
  - templates/phases/phase-code.md
  - templates/phases/phase-do.md
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
lessons:
  - lesson-179
  - lesson-180
token_usage:
  input: 32304948
  output: 229202
  cache: 31241472
  total: 32534150
  requests: 315
  duration_ms: 2424111
  reasoning: 153852
  by_phase:
    code:
      input: 29510056
      output: 212697
      cache: 28624640
      requests: 265
    close:
      input: 2794892
      output: 16505
      cache: 2616832
      requests: 50
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст (после разбора VL-302). VL-302 добавил трейлер `Co-authored-by: vibelog-agent <vb@xw2.ru>` в ДВУХ механизмах: (1) кодом — `src/core/commit-trailer.ts` + `src/agent/task-commit.ts` + `src/agent/run-progress.ts` (framework-коммиты); (2) подстановкой `{{commitTrailer}}` в 9 местах `git commit -m` в `templates/phases/{phase-code,phase-do,phase-close,phase-close-worktree}.md` (close: строки 27/50/63/81; close-worktree: 75/82/95; code: 47; do: 38).

Второй механизм — не гарантия, а инструкция модели («если `{{commitTrailer}}` не пусто — передай его вторым `-m`»): забыла — трейлера нет, никто не заметит. Это тот же класс дефекта, что VL-303/304/306/309/310: правило в промпте вместо проверки в коде. Плюс те же текстовые запреты в шаблонах («никогда git add -A», «явные пути») держатся только на дисциплине модели — а инциденты VL-137/VL-169/VL-172 показывают, что close реально коммитил чужие файлы и «остаток», плюс существовал guard «проверь ps aux — не идёт ли параллельная фаза».

Цель: один write-инструмент `git_commit { paths: string[], message: string, amend?: boolean }`, который делает коммит детерминированно — трейлер, только явные пути, сверка с задачей, отказ при чужих/незакоммиченных конфликтах. Текстовые правила из шаблонов удаляются: они становятся ненужными.

Граница (сознательно НЕ делаем «git-tool вообще»): `status`, `log`, `diff`, `merge`, `worktree remove`, `branch -d`, `stash` остаются `run_shell_command` — это чтение и редкие операции, обёртка не даёт выигрыша. Инструмент узкий: только commit (и amend).

Поведение инструмента:
1. `paths` — обязательный непустой массив; `git add -- <paths>` (никогда `-A`, никогда `.`); пути резолвятся внутри проекта, выход за пределы — отказ.
2. Сверка с задачей: пути вне `modified_files` задачи (если список непуст) — отказ с перечислением («эти файлы не принадлежат задаче; если это осознанно — передай `allowForeign: true`»), потому что close-фазы коммитили чужую работу.
3. Guard от гонки: файл, изменённый позже начала рана (mtime > runStartedAt) в другом worktree/процессе — предупреждение в ответе (не блокировка: mtime не доказывает авторство).
4. Сообщение: `appendCommitTrailer(message, resolveCommitCoauthor(cwd))` — переиспользовать `src/core/commit-trailer.ts` из VL-302 (не дублировать логику). `amend: true` — `git commit --amend -m <полное %B с трейлером>`, тело сохраняется (как уже сделано в `task-commit.ts`).
5. JSON-ack по контракту VL-306 (`ackOk`/`ackError`), с полями `hash`, `subject`, `paths`; `noop` при «нечего коммитить» (все пути чистые) — чтобы `appliedSignatures`/`noopSignatures` из VL-310 работали корректно.
6. Классификация: `isWriteOperation('git_commit')` → true (маркер `commit` добавить в WRITE_MARKERS `src/core/tool-classify.ts`, иначе имя неизвестно → fail-safe write, но явный маркер лучше). В `GRANTABLE_TOOLS` супервизора НЕ входит.

Входные данные: VL-302 (commit-trailer.ts, amend через %B), VL-306 (JSON-ack), VL-310 (noop), инциденты VL-137/VL-169/VL-172/VL-219 (чужие файлы в коммитах close).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MCP-инструмент git_commit { paths, message, amend?, allowForeign? } зарегистрирован в реестре, отвечает JSON-ack (ackOk/ackError) с полями hash/subject/paths
- [x] #2 paths обязателен и непуст; выполняется только `git add -- <paths>` — git add -A, `.` и путь вне проекта отклоняются с понятной ошибкой
- [x] #3 Трейлер Co-authored-by всегда дописывается через appendCommitTrailer/resolveCommitCoauthor (переиспользование src/core/commit-trailer.ts), настройка commit_coauthor соблюдается; amend сохраняет полное тело исходного коммита (%B) и не дублирует трейлер
- [x] #4 Пути вне modified_files задачи отклоняются с перечислением и подсказкой allowForeign (инциденты VL-137/VL-169/VL-172); при allowForeign коммит выполняется
- [x] #5 Нет изменений по переданным путям → {ok:false, noop:true, reason:'noop'} без создания коммита (совместимо с VL-310)
- [x] #6 Шаблоны фаз: все 9 мест `git commit -m` (phase-code:47, phase-do:38, phase-close:27/50/63/81, phase-close-worktree:75/82/95) переведены на git_commit; текстовые запреты «никогда git add -A» и подстановка {{commitTrailer}} удалены как ненужные
- [x] #7 isWriteOperation('git_commit') === true; git_commit отсутствует в GRANTABLE_TOOLS супервизора (тест-инвариант)
- [x] #8 Тесты: успешный коммит с трейлером в mkdtemp-репо, amend сохраняет тело, отказ при чужих путях, noop, отказ на пути вне проекта, выключенный commit_coauthor; pnpm build и полный pnpm test зелёные; документация (CHANGELOG, doc-8 §git_commit, doc-10 §контракт)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-311

### Архитектурное решение

Инструмент узкий и живёт в MCP-слое: `src/mcp/git-commit.ts` (новый модуль) + регистрация в `src/mcp/tools.ts`. Почему не в `src/agent/tools.ts`: коммит нужен и агенту, и (потенциально) веб-чату через тот же реестр MCP; логика трейлера уже в `src/core/commit-trailer.ts` — третьего места не заводим.

Почему не «git-tool вообще»: `status`/`log`/`diff`/`merge`/`worktree remove`/`branch -d` — чтение и редкие операции, обёртка не даёт выигрыша и раздувает реестр (43 → 44 уже проблема для `doctor`, см. doc-22 §1.2).

### Сигнатура

```ts
git_commit {
  paths: string[];          // обязательный, непустой, только файлы задачи
  message: string;          // тема + опционально тело
  amend?: boolean;          // true — переписать последний коммит
  allowForeign?: boolean;   // разрешить пути вне modified_files задачи
}
```

Ответ: `ackOk('Коммит <hash> создан: <subject>', { hash, subject, paths })` либо `ackNoop(...)` при «нечего коммитить» либо `ackError` (из `src/mcp/tool-result.ts`).

### Файлы и порядок

1. **`src/mcp/git-commit.ts`** (новый):
   - `resolvePaths(cwd, paths)` — каждый путь через `resolveInProject` (переиспользовать из `src/agent/tools.ts`); отказ, если путь абсолютный/вне проекта/корень;
   - `assertOwnedByTask(cwd, taskId, paths, allowForeign)` — сверка с `modified_files` задачи через `getTask`; при непустом списке и наличии «чужих» — отказ с перечислением и подсказкой `allowForeign: true`;
   - `commitFiles(cwd, { paths, message, amend })` — `git add -- <paths>`, затем проверка «есть ли staged» (`git diff --cached --name-only`); пусто → noop; иначе `git commit -m <appendCommitTrailer(message, resolveCommitCoauthor(cwd))>`; при `amend` — предварительно `git log -1 --pretty=%B`, собрать сообщение и `git commit --amend -m <...> --no-verify` (по образцу `src/agent/task-commit.ts`, VL-302);
   - `hash`/`subject` — из `git log -1 --pretty=%H%n%s` после коммита.
   - Все вызовы — `spawnSync('git', args, { cwd })`, без shell (как в `src/core/git.ts`), поэтому инъекция через message невозможна (аргумент, не строка команды).
2. **`src/mcp/tools.ts`** — `listTools()` + `handleToolCall`: добавить `git_commit` с `inputSchema`, handler → `commitFiles`. Task ID берётся из `process.env.VIBELOG_PHASE_TASK_ID` (для сверки с `modified_files`); вне фазовой сессии сверка пропускается.
3. **`src/core/tool-classify.ts`** — маркер `commit` в `WRITE_MARKERS` (явная семантика вместо fail-safe).
4. **Шаблоны фаз** — 9 мест заменяются на `git_commit {paths: [<явные пути>], message: "feat: {{taskId}} — <суть>"}`:
   - `phase-code.md:47`, `phase-do.md:38`;
   - `phase-close.md:27/50/63/81`, `phase-close-worktree.md:75/82/95`;
   - из `Правил` удалить «никогда git add -A» (недостижимо) и весь блок `{{commitTrailer}}` (VL-302) — текст «второй -m» больше не нужен;
   - `{{commitTrailer}}` из `taskExtraVars` (`src/web/phase-prompt.ts`) удалить + счётчик подстановок в `phase-prompt.test.mjs` вернуть 15 → 14.
5. Тесты:
   - новый `src/mcp/git-commit.test.mjs` (mkdtemp + `git init`): успешный коммит с трейлером; `commit_coauthor: false` → без трейлера; amend сохраняет тело и не дублирует трейлер; чужой путь → отказ, `allowForeign` → успех; нет изменений → noop и коммита нет; путь вне проекта → отказ; `git add -A`/`.` в `paths` → отказ;
   - `src/mcp/write-ack-contract.test.mjs` — `git_commit` в таблицу write-инструментов;
   - `src/web/phase-prompt.test.mjs` — шаблоны больше не содержат `{{commitTrailer}}` и текстов «git add -A»;
   - `src/core/tool-classify.test.mjs` — `isWriteOperation('git_commit') === true`;
   - `src/web/supervisor-grant.test.mjs` — `git_commit` не в `GRANTABLE_TOOLS`.

### Порядок действий

1. `src/mcp/git-commit.ts` + тест (TDD: чистые функции → mkdtemp-интеграция).
2. Регистрация в `tools.ts` + `tool-classify.ts`.
3. Шаблоны фаз + `phase-prompt.ts` (+ тесты).
4. Документация (Close): CHANGELOG, `doc-8` (§git_commit: сигнатура, отказы, noop), `doc-10` (§5 «Инструменты» — число локальных/ MCP, §контракт коммитов вместо подстановки).

### Как проверить

```bash
pnpm build && pnpm test
# живая проверка в mkdtemp-репо:
node -e "import('./dist/mcp/tools.js').then(async m=>console.log(await m.handleToolCall('git_commit',{paths:['a.txt'],message:'feat: тест'})))"
git log -1 --pretty=%B    # должен содержать Co-authored-by
```

### Риски

- **Совместимость Backlog.md** — не затрагивается: инструмент только вызывает git, формат данных не меняется.
- **Фазы в worktree** — инструмент должен работать и в `taskCwd` (worktree задачи), и в главном cwd (close). Источник cwd — тот же, что у остальных MCP-инструментов (`findBacklogDir`/VIBELOG_CWD).
- **Регресс VL-302** — тест `task-commit.test.mjs` на трейлер остаётся валидным: framework-коммиты (token_usage, WIP) по-прежнему идут кодом через `commit-trailer.ts`. Удаляется только шаблонная половина.
- **Сверка с modified_files может быть неполной** — поле заполняет только фаза code; в close фаза-шаблон уже собирает пути из отчётов. Поэтому сверка мягкая: предупреждающий отказ с `allowForeign`, а не жёсткий запрет.
- **doctor.ts** — счётчик инструментов (хардкод 44) придётся поправить; заодно проверить, не пора перейти на инварианты (doc-22 §1.2).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 00:42
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/mcp/git-commit.ts
- src/mcp/tools.ts
- src/core/tool-classify.ts
- src/mcp/git-commit.test.mjs
- templates/phases/phase-code.md
- templates/phases/phase-do.md
- templates/phases/phase-close.md
- templates/phases/phase-close-worktree.md
- I'll start by orienting myself in the project structure.
The worktree branch is based on an older commit and lacks the VL-302/306/310 dependencies (commit-trailer.ts, JSON-ack, noop). Let me check topology and fast-forward to master.
The worktree branch is 22 commits behind master and lacks VL-302…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 575 с, payload 524599 байт_
Незакоммиченные изменения сохранены в ветку: коммит `e5f8127`.
---
author: @agent
created: 2026-11-03 00:42
---
Фаза code не удалась (код выхода 1): окировок=0, payload последнего запроса=524599 байт (макс 524599), usage={"input_tokens":7161403,"output_tokens":82626,"cache_read_input_tokens":6905856,"total_tokens":7244029,"reasoning_tokens":60358} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 00:58
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/mcp/git-commit.ts
- src/mcp/tools.ts
- src/core/tool-classify.ts
- src/mcp/git-commit.test.mjs
- templates/phases/phase-code.md
- templates/phases/phase-do.md
- templates/phases/phase-close.md
- templates/phases/phase-close-worktree.md
- src/web/phase-prompt.ts
- src/core/commit-trailer.ts
- The WIP commit accidentally included a `node_modules` entry. Let me check and fix:
Now let me finish the template edits (removing the last text bans and `git commit` steps):
Now remove the `commitTrailer` substitution from `phase-prompt.ts`:
Now the `commitTrailerText` function becomes dead — bu…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 862 с, payload 691204 байт_
Незакоммиченные изменения сохранены в ветку: коммит `55fd7b0`.
---
author: @agent
created: 2026-11-03 01:09
---
Фаза 3 (Code) выполнена. Коммиты в ветке vb/vl-311: feat `5e894fa` + продолжение после обрыва по лимиту запросов `55fd7b0`.
**Что сделано**
1. Новый `src/mcp/git-commit.ts` — узкий write-инструмент `git_commit {paths, message, amend?, allowForeign?, cwd?}`:
   - `paths` обязателен и непуст; резолв через `resolveInProject` (вне проекта — отказ), запрещены `-A`/`.`/`--all`/маски/флаги;
   - `git add -- <paths>` (никогда `-A` и `.`), затем проверка индекса: посторонние staged-файлы чужих процессов → отказ;
   - сверка с `modified_files` задачи (`getTask`): чужие пути → отказ с перечислением и подсказкой `allowForeign: true`; пустой список задачи сверку не блокирует; `allowForeign: true` — коммит проходит;
   - трейлер только через `appendCommitTrailer`/`resolveCommitCoauthor` из VL-302 (логика не дублируется, lesson-37); `amend` пересобирает полное сообщение из `git log -1 --pretty=%B` (lesson-177), тело сохраняется, трейлер идемпотентен;
   - guard от гонки: файлы в `.vibelog/worktrees/<другая-задача>/` с mtime > `VIBELOG_RUN_STARTED_AT` → `applied.warnings` (предупреждение, не блокировка);
   - JSON-ack по VL-306: `ackOk` с `hash`/`subject`/`paths`, `ackNoop` (`reason:'noop'`, совместимо с VL-310), `ackError` для всех отказов; все git-вызовы — `spawnSync('git', args)` без shell (инъекция через message невозможна).
   - `cwd` (путь внутри проекта) — для шага 2 `phase-close-worktree.md`, который коммитит worktree задачи из фазы close (иначе инструмент работал бы в главном репо); вне проекта — отказ.
2. Регистрация: `src/mcp/tools.ts` (`listTools` + `handleToolCall`, схема с required `paths`/`message`), `src/core/tool-classify.ts` — маркер `commit` в `WRITE_MARKERS`.
3. Шаблоны фаз: все коммит-шаги переведены на `git_commit` (phase-code, phase-do, phase-close — feat/docs/docs(task)-подзадачи/refs-lessons, phase-close-worktree — worktree, refs-lessons, docs, подзадачи). Текстовые запреты «никогда git add -A» и подстановка `{{commitTrailer}}` удалены: в `templates/` не осталось ни одного `git commit`/`git add -A`/`{{commitTrailer}}`; `commitTrailerText` и `taskExtraVars.commitTrailer` удалены (счётчик подстановок 15 → 14).
4. Счётчики реестра: doctor 44 → 45, список инструментов; тесты `compat-full`/`server`/`reference-tools`/`documents`/`diagnostics` обновлены.
5. Попутно исправлено: WIP-коммит прошлого рана втянул симлинк `node_modules` (шаблон `node_modules/` его не матчит) — `git rm --cached node_modules` + строка `node_modules` в `.gitignore` (lesson-179).
**Проверки**
- `pnpm build` — успешно (tsc, strict).
- Полный `pnpm test` — **зелёный**: 150 файлов, 2798 passed, 4 skipped, exit 0 (прогон без `--exclude`/`--skip`/отдельных файлов). Ранее в полном прогоне дважды наблюдались падения `src/web/orchestrator.test.mjs` (3 и 1 тест); файл, запущенный отдельно, проходит 88/88, последующие полные прогоны — зелёные без изменений в диффе: классифицирую как параллельная интерференция окружения (в том числе одновременный `vitest` в соседнем worktree), не регрессию VL-311.
- Живая проверка в mkdtemp-репо: коммит создан, `git log -1 --pretty=%B` содержит `Co-authored-by: vibelog-agent <vb@xw2.ru>`; повтор по тем же путям → `noop`.
- Новые/обновлённые тесты: `src/mcp/git-commit.test.mjs` (14 кейсов: трейлер, `commit_coauthor: false`, amend с сохранением тела и без дубля, чужой путь + `allowForeign`, noop, путь вне проекта, `-A`/`.`/флаги, посторонний staged, пустые paths/message, схема, `foreignPaths`, явный `cwd`); `write-ack-contract` (git_commit в таблице + noop-кейс), `tool-policy` (write), `supervisor-grant` (не в `GRANTABLE_TOOLS`), `phase-prompt` (шаблоны без `git commit -m`/`{{commitTrailer}}`/`git add -A`, 14 подстановок), `commit-trailer` (без удалённого `commitTrailerText`).
**Что осталось (Фаза Close)**
- AC8 частично: документация (CHANGELOG, doc-8 §git_commit, doc-10 §контракт коммитов) НЕ обновлялась — правки docs/CHANGELOG в фазе Code прямо запрещены правилом фазы, это работа Close. Поэтому AC8 и DoD «Документация обновлена» оставлены незакрытыми.
- Ветка vb/vl-311 содержит feat-коммит и один wip-коммит продолжения (после обрыва по лимиту запросов); merge в master — за фазой Close.
- Инцидент прошлого рана: WIP-коммит `e5f8127` втянул `node_modules`; исправлено в feat-коммите.
Урок: lesson-179 (симлинк `node_modules` в worktree не покрывается шаблоном `node_modules/`), связан с задачей.
---
author: @agent
created: 2026-11-03 01:19
---
Фаза Close выполнена. Ветка vb/vl-311 слита в master (3 коммита: `e5f8127` wip, `5e894fa` feat, `55fd7b0` wip-продолжение) через `git merge --no-ff` → merge-коммит `a86e23f`; конфликтов не было. Worktree удалена (`git worktree remove` отказался из-за untracked-симлинков `node_modules` и `backlog/references/data` → orchestrator-симлинки на главный репозиторий, удалено через `--force`; это штатный путь из шаблона), ветка `vb/vl-311` удалена (`git branch -d`).
**Проверки после merge (главный репо)**
- `pnpm build` — успешно (tsc, strict), одна сборка за фазу.
- Ранний точечный фильтр (только фильтр, не замена полному): `git diff --name-only HEAD^1..HEAD` → 22 файла; прогнаны тесты затронутых модулей — `git-commit`, `write-ack-contract`, `phase-prompt`, `tool-classify`, `supervisor-grant`, `commit-trailer`, `tool-policy` → 10 файлов, 197 passed, exit 0.
- **Полный `pnpm test` — зелёный**: 149 файлов, 2790 passed, 4 skipped, exit 0. Прогон без `--exclude`/`--skip` и без запусков отдельных файлов; повторных полных прогонов не было, классификация падений не требовалась. Параллельный `vitest` в другом worktree перед прогоном проверен (`ps aux`) — не обнаружен.
**Документация (закрывает AC8/DoD2)**
- CHANGELOG.md — запись про `git_commit` в Unreleased/Добавлено.
- doc-8 (MCP-справочник) — число инструментов 38 → 45, новый раздел «Git → git_commit» (сигнатура, отказы, noop, guard от гонки).
- doc-10 §5 — число MCP-инструментов 36 → 45 и абзац «Контракт коммитов» (правило живёт в коде, а не в тексте промпта).
- Коммит документации — `346a1da` (`docs: VL-311 — документация и CHANGELOG`, с трейлером).
**Прочее**
- Lessons: обновлён/связан lesson-179 (симлинк `node_modules` в worktree) и создан lesson-180 (правило фазы про коммит переносить в write-инструмент) — закоммичены вместе с lesson-179 в `6f8fca2` (`docs(task): VL-311 — refs и lessons`). References у задачи нет — коммитить было нечего.
- Счётчик реестра MCP (45) синхронизирован в `doctor.ts` и тестах ещё в фазе Code; здесь сверен с фактическим `listTools().length === 45`.
- README не трогался (лимит 150 строк и белый список H2 — витрина, не справочник).
**DoD**: все три пункта выполнены — тесты зелёные (полный прогон), документация обновлена, регрессий не обнаружено. **AC**: закрыт и AC8 (тесты + документация) — по отчётам фаз Code и Close выполнены все 8 критериев.
---
<!-- COMMENTS:END -->