---
id: VL-311
title: 'MCP-инструмент git_commit: коммит явными путями с трейлером и guard от чужих файлов вместо инструкций в шаблонах фаз'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-03 00:03'
updated_date: '2026-11-03 00:03'
due_date: ''
labels:
  - agent
  - mcp
  - git
  - templates
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
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
- [ ] #1 MCP-инструмент git_commit { paths, message, amend?, allowForeign? } зарегистрирован в реестре, отвечает JSON-ack (ackOk/ackError) с полями hash/subject/paths
- [ ] #2 paths обязателен и непуст; выполняется только `git add -- <paths>` — git add -A, `.` и путь вне проекта отклоняются с понятной ошибкой
- [ ] #3 Трейлер Co-authored-by всегда дописывается через appendCommitTrailer/resolveCommitCoauthor (переиспользование src/core/commit-trailer.ts), настройка commit_coauthor соблюдается; amend сохраняет полное тело исходного коммита (%B) и не дублирует трейлер
- [ ] #4 Пути вне modified_files задачи отклоняются с перечислением и подсказкой allowForeign (инциденты VL-137/VL-169/VL-172); при allowForeign коммит выполняется
- [ ] #5 Нет изменений по переданным путям → {ok:false, noop:true, reason:'noop'} без создания коммита (совместимо с VL-310)
- [ ] #6 Шаблоны фаз: все 9 мест `git commit -m` (phase-code:47, phase-do:38, phase-close:27/50/63/81, phase-close-worktree:75/82/95) переведены на git_commit; текстовые запреты «никогда git add -A» и подстановка {{commitTrailer}} удалены как ненужные
- [ ] #7 isWriteOperation('git_commit') === true; git_commit отсутствует в GRANTABLE_TOOLS супервизора (тест-инвариант)
- [ ] #8 Тесты: успешный коммит с трейлером в mkdtemp-репо, amend сохраняет тело, отказ при чужих путях, noop, отказ на пути вне проекта, выключенный commit_coauthor; pnpm build и полный pnpm test зелёные; документация (CHANGELOG, doc-8 §git_commit, doc-10 §контракт)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
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