---
id: VL-361
title: runHasProgress не видит работу через run_shell_command — Close-worktree падает кодом 1 после merge+build+3541 теста (сессия agent-1794064942811)
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 18:32'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - agent
  - loop-detection
  - close
  - regression
  - bug
dependencies: []
milestone: v1.13
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/loop.ts
  - src/agent/repeat-tracker.ts
  - src/agent/loop-repeat-cap.test.mjs
  - src/agent/loop.test.mjs
  - src/agent/repeat-tracker-vl357.test.mjs
lessons:
  - lesson-238
  - lesson-237
token_usage:
  input: 9754102
  output: 46255
  cache: 9333248
  total: 9800357
  requests: 123
  duration_ms: 826894
  reasoning: 21956
  by_phase:
    code:
      input: 6807958
      output: 27921
      cache: 6675968
      requests: 66
    close:
      input: 2946144
      output: 18334
      cache: 2657280
      requests: 57
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Фаза Close-worktree VL-359 упала кодом 1 (сессия `agent-1794064942811`), хотя работа была выполнена полностью.

```
run_shell_command: git merge --no-ff vb/vl-359          ✅
run_shell_command: pnpm build                            ✅
run_shell_command: npx vitest run → 190 файлов, 3541 passed ✅
run_shell_command: git worktree remove                   ✅
→ lesson_update (lesson-237) ×2 «уже применён ранее»
→ «Продолжить» (resume)
→ lesson_update → noop (JSON, missing: content)
→ lesson_update ×4 → «Изменений нет: вызов НЕ исполнен…» (плоский текст)
→ MAX_NOOP_REPEATS_PER_RUN → failOnRepeatCap → runHasProgress() = false → fail
```

## Корень 1 — `runHasProgress` не видит shell-работу

`src/agent/loop.ts:349`:

```ts
const WORK_EVIDENCE_TOOLS = new Set(['edit', 'write_file', 'git_commit']);
```

`run_shell_command` в наборе нет. В фазе Close-worktree вся работа идёт через shell: merge, build, тесты, уборка worktree. `git_commit` модель не вызывала — merge делался через `run_shell_command`.

Итог: `runHasProgress()` = `false` при полностью выполненной работе → `fail()` вместо штатного завершения. Это тот же регресс VL-349, который VL-357 шаг 5 устранял, но только для трёх инструментов из шести.

**Риск решения:** наивно добавить `run_shell_command` в набор нельзя — `run_shell_command` возвращает плоский текст, и упавшая команда (`exit code 1`, `fatal:`) выдаст себя за работу. Это регресс VL-124 («ран завершён штатно» при недоработанной задаче). Нужен разбор вывода.

## Корень 2 — директивы цикла в плоском тексте

`noopRepeatDirective` (`src/agent/repeat-tracker.ts:839`) и `appliedNoopDirective` (`:820`) отдают строки, а не JSON с `outcome`. Модель видит два формата: инструмент — JSON с `outcome`/`missing`/`hint`, директива блокировки — плоский текст.

Плюс текст «добавь отсутствующее поле» не называет **какое**. В сессии модель даже написала «Понял — проблема была в том, что я не передавал content» — и повторила вызов без `content`. Директива должна нести `missing` и готовый `retryWith`, как `loopDetectionDirective` (VL-353).

VL-359 шаг 3 закрывает этот класс только для веб-чата (`duplicateCallResult` и др.) — агентский цикл остался.

## Что НЕ входит

- Поведение `lesson_update` на уроке-скелете (VL-355/VL-356) — работает корректно, ответ содержит `missing: content` и `hint`.
- `ToolSpec.kind`, дубли порогов, guard-ответы веб-чата — это VL-359.

## Связанные задачи

VL-357 (шаг 5 — источник `runHasProgress`), VL-349 (исходный регресс), VL-124 (риск ложного «штатно»), VL-353 (образец директивы с `retryWith`), VL-359 (соседний слой).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `WORK_EVIDENCE_TOOLS` (`src/agent/loop.ts:349`) учитывает `run_shell_command`: успешный shell-вызов с признаком работы (merge/commit/build/test) считается следом работы в `runHasProgress()`
- [x] #2 Ответ `run_shell_command` разбирается, а не считается работой по имени: вывод с ошибкой (`exit code 1`, `fatal:`, `ERR_`, `failed`) работой НЕ считается — иначе регресс VL-124 («ран завершён штатно» при недоработанной задаче)
- [x] #3 Регресс-тест на сессию `agent-1794064942811`: merge + build + полный прогон тестов через `run_shell_command`, затем 4 noop-повтора `lesson_update` → ран завершается ШТАТНО (не код 1), в результате есть блок `buildRunProgress`
- [x] #4 Регресс VL-124 сохранён: shell-вызовы с ошибкой + noop-повторы → по-прежнему `fail()`
- [x] #5 `noopRepeatDirective` (`src/agent/repeat-tracker.ts:839`) отдаёт JSON через `serializeAck` с `outcome: 'noop'` и несёт `missing`/`hint` из последнего ответа инструмента — модель видит тот же формат, что и от инструмента
- [x] #6 Директива noop-повтора называет КОНКРЕТНОЕ недостающее поле (из `missing` последнего ответа) и, если инструмент его отдал, готовый `retryWith` — по образцу `loopDetectionDirective` (VL-353)
- [x] #7 `appliedNoopDirective` (`src/agent/repeat-tracker.ts:820`) переведён на тот же JSON-контракт — плоского текста в директивах цикла не остаётся
- [x] #8 `pnpm build && pnpm test` без регрессий
- [x] #9 Документация: doc-10 §6 (признаки прогресса рана, формат директив цикла), doc-27 §9, CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Порядок работ

Два независимых шага. Шаг 1 — корень падения, шаг 2 — корень «модель не понимает, что чинить». Каждый отдельным коммитом.

---

## Шаг 1. `runHasProgress` учитывает shell-работу

**Файлы:** `src/agent/loop.ts` (`WORK_EVIDENCE_TOOLS:349`, `runHasProgress:734`), `src/agent/loop-repeat-cap.test.mjs`.

### 1.1. Разбор ответа shell

Наивное `WORK_EVIDENCE_TOOLS.add('run_shell_command')` даст регресс VL-124: упавшая команда выдаст себя за работу. Нужен предикат «shell-вызов реально что-то сделал».

`run_shell_command` возвращает плоский текст (не JSON), поэтому `isFailureResponse` его не ловит. Добавить отдельную проверку:

```ts
/**
 * VL-361: shell-вызов считается работой, только если команда завершилась
 * успешно И относится к классу «изменяет состояние/проверяет результат».
 * Признаки успеха — отсутствие маркеров провала в выводе; признаки класса —
 * подстрока команды (merge/commit/build/test/worktree).
 */
const SHELL_WORK_PATTERNS = [
  /\bgit\s+(merge|commit|rebase|cherry-pick|worktree\s+remove|branch\s+-d)\b/,
  /\bpnpm\s+(build|test)\b/,
  /\bnpx\s+vitest\b/,
  /\bnpm\s+(run\s+)?(build|test)\b/,
];

const SHELL_FAILURE_MARKERS = [
  /exit code [1-9]/i,
  /^fatal:/im,
  /\bERR_[A-Z_]+\b/,
  /\bcommand not found\b/i,
  /\b\d+ failed\b/i,
  /^error\b/im,
];

function shellCallIsWork(command: string, output: string): boolean {
  if (!SHELL_WORK_PATTERNS.some(re => re.test(command))) return false;
  return !SHELL_FAILURE_MARKERS.some(re => re.test(output));
}
```

В `runHasProgress` — отдельная ветка для `run_shell_command`:

```ts
if (tc.name === 'run_shell_command') {
  const content = responses.get(tc.id);
  if (content === undefined) continue;
  const command = String((tc.arguments as Record<string, unknown> | undefined)?.command ?? '');
  if (shellCallIsWork(command, content)) return true;
  continue;
}
if (!WORK_EVIDENCE_TOOLS.has(tc.name)) continue;
```

`WORK_EVIDENCE_TOOLS` оставить как есть (три инструмента) — shell обрабатывается отдельно, потому что требует разбора вывода.

### 1.2. Тесты

`src/agent/loop-repeat-cap.test.mjs`:

- **регресс `agent-1794064942811`**: скрипт — `run_shell_command` с `git merge` (успех), `pnpm build` (успех), `npx vitest run` (успех), затем 4 noop-повтора `lesson_update` → `res.is_error === false`, в `res.result` есть блок прогресса;
- **регресс VL-124**: `run_shell_command` с `fatal: merge conflict` + noop-повторы → `res.is_error === true`;
- shell-команда вне `SHELL_WORK_PATTERNS` (`ls`, `cat`) работой не считается;
- `run_shell_command` с `exit code 1` в выводе работой не считается.

---

## Шаг 2. Директивы цикла — JSON с `outcome`

**Файлы:** `src/agent/repeat-tracker.ts` (`appliedNoopDirective:820`, `noopRepeatDirective:839`), `src/agent/loop.ts` (точки вызова `:1109`, `:1129`), `src/agent/repeat-tracker-vl357.test.mjs`.

### 2.1. Формат

Обе директивы переводятся на `serializeAck` из `src/mcp/tool-result.ts`:

```ts
export function noopRepeatDirective(
  name: string,
  lastAck?: { missing?: SkippedField[]; hint?: string; retryWith?: Record<string, unknown> },
): string {
  return serializeAck({
    outcome: 'noop',
    reason: 'noop_repeat',
    message:
      `Изменений нет: вызов ${name} НЕ исполнен (поля уже такие). Повтор ничего не изменит. ` +
      'Следующий шаг: прочитай состояние или смени аргумент.',
    next: {
      ...(lastAck?.missing ? { missing: lastAck.missing } : {}),
      ...(lastAck?.hint ? { hint: lastAck.hint } : {}),
      ...(lastAck?.retryWith ? { retryWith: lastAck.retryWith } : {}),
    },
  });
}
```

**Важно:** `serializeAck` не умеет произвольные поля (`noop_repeat`). Нужен аддитивный `extra?: Record<string, unknown>` в `ToolAckInput` — тот же приём, что в VL-359 шаг 3. Если VL-359 уже добавила `extra`, переиспользовать.

### 2.2. Проброс `missing` из последнего ответа

`loop.ts` уже хранит `lastErrorBySignature` для отказов (VL-323). Нужен аналогичный `lastAckBySignature` для noop-ответов: при получении noop-ответа сохранять `{missing, hint, retryWith}` по сигнатуре, при блокировке повтора — передавать в директиву.

Точка сохранения — там же, где ответ классифицируется как noop (`loop.ts:1456`, блок «классифицируем ответ write-вызова»).

### 2.3. Тесты

`src/agent/repeat-tracker-vl357.test.mjs`:

- `noopRepeatDirective` возвращает валидный JSON с `outcome: 'noop'`, `noop: true`, `noop_repeat: true`;
- при переданном `lastAck.missing` директива содержит `missing: [{field: 'content'}]` и `hint`;
- при `retryWith` директива содержит готовые аргументы.

`src/agent/loop.test.mjs`:

- **регресс `agent-1794064942811`**: noop-ответ с `missing: content` → директива блокировки содержит `missing` и `hint` (модель видит, ЧТО дописать);
- маркер «Изменений нет» сохранён (на него матчат существующие тесты).

---

## Финальная проверка

- `pnpm build && pnpm test` — полный прогон (190 файлов, ~3541 тест).
- Ручная: повторить сценарий Close-worktree на любой задаче — merge/build/test через shell, затем noop-повтор → ран завершается штатно.
- Документация: doc-10 §6 (признаки прогресса рана — shell-команды и их разбор; формат директив цикла), doc-27 §9, CHANGELOG.md.

## Риски

- **Шаг 1 — главный риск ложного «штатно»** (VL-124). `SHELL_FAILURE_MARKERS` должен ловить провал надёжно: `pnpm build` при ошибке печатает `error TS…` и завершается с ненулевым кодом, но код возврата в тексте ответа может отсутствовать. Проверить, что `run_shell_command` вообще сообщает код возврата — если нет, добавить его в вывод (это отдельная правка `src/agent/tools.ts`, оценить).
- **Шаг 2** зависит от `extra` в `serializeAck` — если VL-359 ещё не влита, добавить здесь и пометить, что VL-359 переиспользует.
- **VL-359 в работе** — она правит `src/web/tool-dedup.ts` и `src/mcp/tool-result.ts` (`extra`). Шаг 2 тоже правит `tool-result.ts`. Merge VL-361 после VL-359.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 18:47
---
Фаза 3 (Code) выполнена. Коммит 8b1b63c.
**Шаг 1 — `runHasProgress` видит shell-работу** (`src/agent/loop.ts`):
- новый экспорт `shellCallIsWork(command, output)`: команда должна относиться к классу «меняет состояние / проверяет результат» (`SHELL_WORK_PATTERNS`: `git merge|commit|rebase|cherry-pick|worktree remove|branch -d`, `pnpm build|test`, `npx vitest`, `npm run build|test`) И не нести маркеров провала (`SHELL_FAILURE_MARKERS`: `^exit code: [1-9]`, `^fatal:`, `ERR_*`, `command not found`, `N failed`, `^error`).
- в `runHasProgress()` — отдельная ветка для `run_shell_command` (ответ плоский, `isFailureResponse` его не ловит); `WORK_EVIDENCE_TOOLS` оставлен как есть (три инструмента). Наивное добавление имени дало бы регресс VL-124 — поэтому разбор вывода, а не имя.
- Надёжность кода возврата проверена: `makeRunShellCommand` (`src/agent/tools.ts:1385`) всегда печатает первой строкой `exit code: N`, так что ненулевой код ловится без правки `tools.ts`.
**Шаг 2 — директивы цикла на JSON-контракте** (`src/agent/repeat-tracker.ts`, `src/agent/loop.ts`):
- `noopRepeatDirective(name, lastAck?)` и `appliedNoopDirective(name, lastAck?)` отдают `serializeAck({outcome:'noop', reason:'noop_repeat', next:{missing,hint,retryWith}, extra:{noop_repeat|applied_repeat}})` — плоского текста в директивах цикла не осталось. `extra` в `ToolAckInput` уже была добавлена VL-359 — переиспользована, правка `tool-result.ts` не потребовалась.
- новый `parsedAckNext(output)` читает `missing`/`hint`/`retryWith` из v2-формы (`next.*`) и старой (поля в корне); в цикле — `lastAckBySignature`, заполняется в точке классификации noop-ответа (`loop.ts:1584`), читается в `blockAndPush` для обеих директив. Модель видит КОНКРЕТНОЕ недостающее поле, а не «добавь отсутствующее».
**Тесты:** `src/agent/loop-repeat-cap.test.mjs` +4 (регресс `agent-1794064942811`: merge+build+vitest через shell → штатное завершение с блоком прогресса; регресс VL-124: `fatal:` → fail; `exit code: 1` → не работа; `ls` вне класса → не работа); `src/agent/repeat-tracker-vl357.test.mjs` +3 (JSON-контракт директив, проброс `missing`/`hint`/`retryWith`, `parsedAckNext`); `src/agent/loop.test.mjs` — регресс-кейс VL-319 дополнен проверкой `missing`/`hint` в директиве (инвариант «< 400 байт» заменён на «< 1200 байт»: JSON-контракт по построению длиннее плоской строки, смысл инварианта — «директива не раздувает payload» — сохранён).
**Проверки:** `pnpm build` — ок; полный `pnpm test` — 189 файлов, 3540 passed, 4 skipped, 0 failed (прогон полный, без `--exclude`/`--skip`).
**Что осталось (не входит в Code):** AC9/DoD2 — документация (doc-10 §6, doc-27 §9, CHANGELOG.md) пишется Фазой Close по правилам проекта; в Фазе 3 эти файлы не правятся. Ручной сценарий Close-worktree (merge/build/test через shell → noop-повтор) покрыт регресс-тестом, живой прогон — на Close.
---
author: @agent
created: 2026-11-07 18:48
---
Фаза Close прервана: конфликт слияния vb/vl-361 → master.
`git merge --no-ff vb/vl-361` дал CONFLICT (add/add) в двух файлах, оба относятся к соседней задаче VL-359 (её ветка была влита в master уже после того, как vb/vl-361 ответвилась, поэтому файлы добавлены дважды):
- `AA .vibelog/billing/VL-359.json`
- `AA backlog/tasks/VL-359 - Доделать-Tool-outcome-protocol-v2-ToolSpeckind-не-читается-пороги-повторов-дублируются-guard-ответы-веб-чата-в-обход-outcome.md`
Код VL-361 (`src/agent/loop.ts`, `src/agent/repeat-tracker.ts` и три тест-файла) слился без конфликтов (статус `M `, staged). Конфликтные файлы оставлены как есть — merge не откатывался, конфликты не резолвились (правило фазы Close).
Что нужно сделать человеку, чтобы повторить Close:
1. В главном репозитории разрешить оба конфликта в пользу версии из master (она новее: содержит `token_usage` и финальный отчёт VL-359), т.е. `git checkout --ours -- .vibelog/billing/VL-359.json "backlog/tasks/VL-359 - ...md"` + `git add` по этим двум путям;
2. Завершить merge (`git commit`), затем прогнать `pnpm build && pnpm test` (полный прогон) и повторить Фазу Close для VL-361 (worktree и ветка vb/vl-361 на месте, коммит 8b1b63c).
DoD и статус не менялись — задача остаётся в Review.
---
author: @agent
created: 2026-11-07 18:48
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-361 → master.
`git merge --no-ff vb/vl-361` дал CONFLICT (add/add) в двух файлах, оба относятся к соседней задаче VL-359 (её ветка была влита в master уже после того, как vb/vl-361 ответвилась, поэтому файлы добавлены дважды):
- `AA .vibelog/billing/VL-359.json`
- `AA backlog/tasks/VL-359 - Доделать-Tool-outcome-protocol-v2-ToolSpeckind-не-читается-пороги-повторов-дублируются-guard-ответы-веб-чата-в-обход-outcome.md`
Код VL-361 (`src/agent/loop.ts`,  — статус возвращён к Review.
---
author: @agent
created: 2026-11-07 18:58
---
Фаза Close выполнена. Ветка `vb/vl-361` слита в master (merge-коммит `664182b`, 1 содержательный коммит `8b1b63c`), worktree `.vibelog/worktrees/vl-361` удалена (force — внутри был только untracked-симлинк `backlog/references/data`), ветка `vb/vl-361` удалена.
**Конфликт слияния (первый ран Close был прерван):** `git merge --no-ff` дал CONFLICT (add/add) в двух файлах соседней задачи VL-359 (`.vibelog/billing/VL-359.json` и её файл задачи) — её ветка была влита в master уже после ответвления `vb/vl-361`. Конфликты разрешены вручную пользователем, merge завершён коммитом `664182b`.
**Проверки после merge:** `pnpm build` — ок; ранний точечный фильтр по diff'у (`src/agent/loop-repeat-cap.test.mjs`, `loop.test.mjs`, `repeat-tracker-vl357.test.mjs`) — 3 файла, 143 passed; полный `pnpm test` — прошёл без падений (цепочка `vitest run --exclude src/web/static.test.mjs` → `vitest run src/web/static.test.mjs`, финальный блок 8 passed, exit 0). Параллельного `vitest` в других worktree не было. Повторных полных прогонов не делал.
**Lessons:** создан lesson-238 («Считай прогрессом рана только вызов, чей ответ разобран: shell-команда — работа лишь при успехе и принадлежности к классу изменяющих/проверяющих»), связан с задачей; lesson-237 (единый сериализатор ответов) дополнен связью с VL-361 — директива цикла переиспользовала `extra` из VL-359. Коммит lessons — `020abb3`.
**Документация (AC9/DoD2):** CHANGELOG.md — запись в Unreleased/«Исправлено»; doc-10 §6 — новый пункт «Прогресс рана считается по разбору ответа: shell-команда — работа только при успехе (VL-361)»; doc-27 — новый §11 «Закрытие остатка (VL-361)» + обновлён статус в шапке. Коммит `ab36eef`.
**DoD:** все три пункта выполнены — тесты проходят (полный прогон после merge), документация обновлена (коммит `ab36eef`), регрессий нет. AC9 отмечен.
---
<!-- COMMENTS:END -->