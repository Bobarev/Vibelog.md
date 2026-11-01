---
id: VL-261
title: 'CLI: vibelog agent-session summary &lt;id&gt; — готовая сводка рана (фазы, tool-calls, payload, правки файлов) вместо ручного чтения транскрипта'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 12:20'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - cli
  - sessions
  - diagnostics
  - tools
dependencies: []
milestone: v1.11
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/session-summary.ts
  - src/agent/session-summary.test.mjs
  - src/agent/session.ts
  - src/cli/commands/session.ts
  - src/cli/router.ts
  - src/cli/session-cli.test.mjs
  - README.md
lessons:
  - lesson-104
  - lesson-106
token_usage:
  input: 15097426
  output: 137177
  cache: 14469632
  total: 15234603
  requests: 193
  duration_ms: 3204250
  reasoning: 82887
  by_phase:
    plan:
      input: 2433947
      output: 33692
      cache: 2210816
      requests: 40
    code:
      input: 10301887
      output: 76895
      cache: 9959424
      requests: 108
    close:
      input: 2361592
      output: 26590
      cache: 2299392
      requests: 45
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Разбор сессии VL-235 в этом чате шёл вручную: читать 238 строк JSONL по 8 КБ, вручную считать «сколько было `run_shell_command`», «сколько `edit`», «какие раны», «какой payload по ранам». Часть этих цифр нужна в каждом разборе (VL-242, VL-254, VL-243 — один и тот же набор вопросов), и каждый раз они считаются заново с ошибками (в VL-254 из-за этого в описание попала неверная фаза и неверные границы ранов).

## Цель

Одна команда, которая по `<sessionId>` (или по задаче) печатает готовую сводку — чтобы разбор начинался с фактов, а не с чтения килобайтов.

## Предлагаемое решение (уточнить в Plan)

1. `vibelog agent-session summary <sessionId>` (и `--json`), плюс `vibelog session summary --task VL-N` (взять последнюю сессию задачи из меты/billing).
2. Вывод: строк и ранов; по каждому рану — `phase`, начало/конец из меты и billing, `requests`, `input/output/cache/reasoning`, `max payload_bytes`; смена фазы — где именно в транскрипте (строка-маркер промпта фазы).
3. Агрегаты по инструментам: `tool -> count`, отдельной строкой `run_shell_command` с топ-5 повторяющихся «скелетов» команд (переиспользовать `repeat-tracker`), топ-5 путей, которые читались/писались.
4. Агрегаты по файлам: какие файлы правились (`edit`/`write_file`) и сколько раз.
5. Проверка на живых данных: сводка для `agent-1793328615846` должна дать 3 рана (plan → code → code), 110 tool-calls, 72 shell, 18 edit, 5 write_file — то есть воспроизвести цифры, которые сейчас считаются руками.
6. В `--json` — стабильная схема (`schemaVersion`), чтобы использовать в `/analyze` и тестах.

## Связанное

VL-258 (обзорный режим чтения JSONL — основа для подсчётов; логично делать после него), VL-250/VL-252 (читаемость транскриптов), VL-243 и VL-259 (мета/billing как источник таймингов и фаз), VL-141 (`/analyze`), VL-254 (мотивация: разбор потребовал ручного счёта).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новая команда `vibelog session summary <sessionId>` (алиас `vibelog agent-session summary`) печатает сводку сессии: число строк/ранов и по каждому рану — фаза, начала/концы из меты и billing, requests, input/output/cache/reasoning, max payload_bytes, строка-маркер промпта фазы в jsonl
- [x] #2 `--task VL-N` берёт последнюю сессию задачи из меты (createSessionId-формат + `*.meta.json`), `--json` печатает стабильную схему с `schemaVersion` (kind=session-summary) для /analyze и тестов
- [x] #3 Агрегаты: `tool -> count` по всему транскрипту и по ранам; для `run_shell_command` — топ-5 повторяющихся скелетов команд; топ-5 путей чтения и топ-5 путей записи (edit/write_file) с числом правок
- [ ] #4 Проверка на живых данных: сводка для `agent-1793328615846` даёт 3 рана (plan → code → code), 110 tool-calls, 72 shell, 18 edit, 5 write_file
- [x] #5 Юнит-тесты на фикстуре jsonl (раны/границы/агрегаты/пустой транскрипт/битые строки) и CLI-тест (аннотированный вывод и --json), полный `pnpm test` зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решение (архитектура)

Ядро подсчётов — новый **чистый** модуль `src/agent/session-summary.ts` (по образцу `repeat-tracker.ts`: без fs, без MCP → тестируется на массиве `ChatMessage[]`). Чтение файлов — тонкая обёртка в `src/cli/commands/session.ts` через существующие sync-парсеры `session.ts` (`loadSession`-семантика с пропуском битых строк, как `sumUsageFromJsonlSync`). Команда: `vibelog session summary <sessionId|--task VL-N> [--json]`, плюс алиас `agent-session` (второй `case` в роутере). Подсчёты — одна реализация на CLI и будущий `/analyze` (никакого дублирования логики в шаблоне промпта).

### Структура ранов

Границы рана определяются по user-сообщениям (промпт рана = первое сообщение рана):
- маркер промпта фазы: `/^Ты — /` (все `templates/phases/*.md` начинаются с «Ты — автоматический/автоматическая …»);
- маркер resume-рана: `/^Продолжи/` (кнопка «▶ Продолжить» VL-212 и авто-повтор VL-178).
Первый ран начинается с первого user-сообщения (или с индекса 0, если user ещё нет — ран пуст). Остальные user-сообщения внутри рана (повторы-guard VL-229, «Ошибка ответа модели» VL-215, «Замечание: проигнорировано … tool_call» VL-215) границей НЕ являются.

### Разрешение фазы рана (приоритет)

1. Запись billing задачи (`readBilling(cwd, taskId)` → `sessions[]`), отфильтрованная по `sessionId`, упорядоченная по `finishedAt` asc; для рана i берётся запись i, поле `phase` (fallback `sessionPhase`).
2. Разбор текста маркера: `(Фаза 1: Spec)`→spec, `Фаза 2: Plan`→plan, `Фаза 3: Code`→code, `Фаза Do`→do, `Фаза Close`→close, `Фаза Comment`→comment, `Фаза Reject`→reject, `Фаза Analyze`→analyze, `Фаза Investigate`→investigate, `Фаза Materialize`→materialize, `(команда prompt:`→prompt; `Продолжи…` → `meta.phase`.
3. `meta.phase` сессии.
Число ранов vs записей billing расходится → в отчёте `⚠️ billing: N записей на M ранов` (не ошибка: billing пишется только для задачных ранов).

### Схема JSON (`--json`, стабильная, AC2)

```
{ "schemaVersion": 1, "kind": "session-summary",
  "sessionId": "agent-…", "path": ".vibelog/agent-sessions/<id>.jsonl",
  "taskId": "VL-N" | null, "meta": { "phase", "cwd", "startedAt", "finishedAt", "durationMs", "model", "agent" },
  "lines": 238, "runs": [ { "index": 1, "phase": "plan", "startLine": 1, "endLine": 61,
     "startedAt", "finishedAt", "durationMs", "requests", "input", "output", "cache", "reasoning", "total",
     "maxPayloadBytes": 123456, "toolCalls": 40,
     "tools": { "read_file": 10, … }, "editedFiles": { "src/x.ts": 3 },
     "shellTop": [ { "skeleton": "git status", "count": 5 } ] } ],
  "totals": { "lines", "runs", "requests", "toolCalls", "input", "output", "cache", "reasoning", "total",
     "tools": { … }, "shellTop": [ … ], "topReadPaths": [ { "path", "count" } ], "editedFiles": [ { "path", "count" } ],
     "repeatStats": { "tool_calls_total", "repeat_calls", "repeat_share", "top" } } }
```
Порядок ключей фиксирован, все числа — числа (не строки), отсутствующие данные — `null`/`0`/`[]` (никаких `undefined` в JSON). `repeatStats` — готовый `analyzeToolRepeats(messages)` (переиспользование `repeat-tracker`, AC3).

### Скелет shell-команды (AC3)

Новая чистая функция `shellCommandSkeleton(command: string): string` в `session-summary.ts` (в `repeat-tracker` не лезем — там ключ `null` для shell и это осознанно): берём первый сегмент до `&&`/`||`/`;`/`|`, разбиваем по пробелам, оставляем первые 2 токена, остальные → `<arg>`; чисело-/хеш-/путя-подобные токены → `<arg>`; результат обрезаем до 60 символов. Пример: `node -e "…"` → `node -e`, `git status --porcelain` → `git status`, `ls src/a.ts` → `ls src/a.ts`, `grep -rn x src` → `grep -rn`.

## Файлы и конкретные места

1. **NEW `src/agent/session-summary.ts`** (~200 строк): экспорты
   - `interface SessionSummary`, `interface SummaryRun`, `interface SessionSummaryInput` { messages, sessionId, meta, billingSessions, maxPathItems?, maxShellItems? };
   - `isPhasePromptMarker(text: string): boolean`, `phaseFromPromptText(text: string): string | null`;
   - `shellCommandSkeleton(command: string): string`;
   - `buildSessionSummary(input: SessionSummaryInput): SessionSummary` — один forward-pass: раны, usage по `m.usage` assistant-сообщений (`input_tokens/output_tokens/cache_read_input_tokens/total_tokens/reasoning_tokens`), `payload_bytes` → `maxPayloadBytes`, tool-calls только валидные (`isValidToolCall` из `llm.js`, семантика = `countToolCallsInMessages`), `tools` по `tc.name` (без учёта регистра не нормализуем — имена точные), `editedFiles` по `edit`/`write_file` (`path` через `toolRepeatTarget`, падение в `args.path` напрямую; `write_file` перезапись тоже считается правкой), `topReadPaths` по `read_file`, `shellTop` по `run_shell_command.command`;
   - `formatSessionSummary(summary): string` — человекочитаемый вывод (раны списком + агрегаты, кириллица, без ANSI-кодов — тесты матчат подстроки).

2. **NEW `src/cli/commands/session.ts`** (~120 строк), экспорт `runSession(subcommand, positional, flags, cwd)`:
   - `subcommand !== 'summary'` → ошибка справки (`printError` + `process.exitCode = 1`), паттерн `runAgent` (`src/cli/commands/agent.ts:59-71`);
   - id из `positional[0]` (нормализация префикса `vb:`/`qwen:` — снять) либо из `--task` через новый `findLatestTaskSessionSync`; нет ни того, ни другого → ошибка синтаксиса;
   - `--json` → `console.log(JSON.stringify(..., null, 2))`;
   - чтение: `agentSessionsDir(cwd)` (в claw-режиме — `process.env.VIBELOG_CWD ?? cwd`, как `src/agent/cli.ts:382`), файл `<id>.jsonl` (нет → «Сессия <id> не найдена: <path>», exitCode 1), `loadSessionMetaSync`, billing — кандидаты каталогов `[cwd, meta.cwd]`, первый существующий `<dir>/.vibelog/billing/<taskId>.json` (`readBilling`, битый JSON → предупреждение и `billingSessions: []`, resume не роняем);
   - `--task` без `sessionId`: `findLatestTaskSessionSync` по всем `*.meta.json` (taskId регистронезависимо) → sessionId с максимальным mtime jsonl.

3. **`src/agent/session.ts`** — новый экспорт после `listTaskSessionMetas` (строка ~349): `findLatestTaskSessionSync(dir, taskId): string | null` — как `findTaskPhaseSessionSync` (289–321), но БЕЗ фильтра `meta.phase`; переиспользовать её нельзя (фаза обязательна) — вынести общий селектор `pickLatestSessionBy(entries, predicate)` локально (двумя функциями не дублировать mtime-логику).

4. **`src/cli/router.ts`**: импорт `runSession` (после строки 42); `case 'session': case 'agent-session': return runSession(subcommand, positional, flags, cwd);` рядом с `case 'agent'` (строка ~97) — алиас обязателен (AC1: команда в описании задачи шла как `agent-session`); строка справки в `showHelp` (после `agent`, ~140); блок `session:`/`agent-session:` в `showCommandHelp` (`helpTexts`, ~285-300).

5. **NEW `src/agent/session-summary.test.mjs`** (`vitest`, фикстура-массив сообщений): раны — 3 маркера `Ты — автоматический … (Фаза 2: Plan)` / `(Фаза 3: Code)` / `Продолжи` → 3 рана с правильными `startLine`; повторы-guard и «Замечание: проигнорировано» не режут ран; usage/payload max по рану; tool-агрегаты и `editedFiles`; `shellCommandSkeleton` (git status, node -e, пайп); `phaseFromPromptText` на всех 11 фазах + неизвестный текст → null; пустой транскрипт → `runs: []`, totals нулями; битые/фантомные tool_calls (`name: ''`) не считаются (VL-215); `formatSessionSummary` содержит «ранов», «tool-calls», имена топ-файлов.

6. **NEW `src/cli/session-cli.test.mjs`** (CLI через `bin/vibelog.mjs` + `mkdtemp` временный проект, паттерн `src/cli/map-cli.test.mjs`): создаёт `.vibelog/agent-sessions/<id>.jsonl` + `<id>.meta.json` + `.vibelog/billing/VL-9.json`; проверки — `--json` с `schemaVersion:1` и `kind:'session-summary'`, число ранов/фаз; текстовый вывод содержит «ранов»; `--task VL-9` находит ту же сессию; несуществующий id → exitCode 1 и «не найдена»; алиас `agent-session summary` работает.

7. **Документация**: `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` — новый раздел «Сводка сессии (VL-261)» через MCP `document_update` (НЕ edit — файл в backlog/); `README.md` — строка команды в списке CLI. `CHANGELOG.md` — фаза Close (правило VL-203/VL-242).

## Порядок действий

1. `src/agent/session.ts` → `findLatestTaskSessionSync` (+ вынос селектора).
2. `src/agent/session-summary.ts` — ядро (типы, маркеры, скелет shell, агрегаты, форматтер).
3. `src/cli/commands/session.ts` — CLI-обёртка.
4. `src/cli/router.ts` — роутинг + справка (проследить флаг `--json`/`--task` через все слои, lesson-18).
5. Тесты 5 и 6; `pnpm build && pnpm test:fast` на итерациях, финал — полный `pnpm test`.
6. Проверка на живых данных (AC4): `vibelog session summary agent-1793328615846` в главном репо (jsonl в `.vibelog/agent-sessions/` главного репозитория — в worktree их нет; при отсутствии файла зафиксировать в отчёте Code и проверить на копии фикстуры).

## Проверка

- `pnpm build` (tsc strict, `verbatimModuleSyntax`).
- `pnpm test:fast` по новым файлам, затем полный `pnpm test` (AGENTS.md: `env -u VIBELOG_CWD pnpm test` — lesson-88).
- Ручная: `node bin/vibelog.mjs session summary --help`, `... summary <id> --json | node -e` (валидация схемы), `... agent-session summary --task VL-235`.

## Риски

1. **Расхождение billing ↔ раны**: billing пишется только для задачных ранов (CLI `src/agent/cli.ts:754` при `taskId`); при несовпадении числа фаз берём маркеры jsonl, в выводе — предупреждение.
2. **Граница рана по маркеру** — эвристика: если шаблон фазы переименуют (перестанет начинаться с «Ты — »), раны склеятся. Митигация: маркер + `^Продолжи` + тест на все `templates/phases/*.md` через чтение первого заголовка (инвариант «первая строка шаблона матчит `/^Ты — /`»).
3. **Каталог billing** при запуске из worktree: `.vibelog/billing` живёт в главном репо, cwd сессии — worktree. Кандидаты `[cwd, meta.cwd]`; если ни один не подошёл — `billingSessions: []` без ошибки.
4. **`write_file` как «правка»**: перезапись файла из шаблона засчитывается — в выводе разделять `edits` (edit) и `writes` (write_file), чтобы цифра 18 edit / 5 write_file из AC4 воспроизводилась буквально.
5. **Объём вывода**: транскрипты в тысячи строк — сводка печатает только агрегаты (топ-5/топ-10), не сами сообщения; `--json` тоже без содержимого сообщений (инвариант экономии контекста, VL-178).
6. **`--task` с фазами**: `findTaskPhaseSessionSync` не трогаем (используется оркестратором для resume) — новая функция рядом, поведение прежнего не меняется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 12:42
---
Фаза 2 (Plan) выполнена. Тип: task (enhancement) — план записан в задачу, новых задач не создавалось.
Изучено: `src/agent/session.ts` (мета, `sumUsageFromJsonlSync`, `analyzeToolRepeatsFromJsonlSync`, `findTaskPhaseSessionSync`), `src/agent/repeat-tracker.ts` (`repeatKey`/`analyzeToolRepeats`, shell ключи отсутствуют осознанно), `src/agent/cli.ts:694-840` (пост-ран: usage за ран, billing по `taskId`, `max_payload_bytes`, `last_run`), `src/core/billing.ts`, `templates/phases/*.md` (маркер первой строки «Ты — »), `src/cli/router.ts` + `src/cli/commands/agent.ts` + `src/cli/commands/map.ts` (паттерны роутинга и `--json`), `src/web/phase-prompt.ts` (список фаз).
Решения плана:
1. Ядро — новый чистый модуль `src/agent/session-summary.ts` (по образцу repeat-tracker: без fs/MCP) — одна реализация подсчётов для CLI и будущего `/analyze`. CLI-обёртка `src/cli/commands/session.ts`, роутинг `session` + алиас `agent-session` в `src/cli/router.ts`.
2. Раны определяются по user-сообщениям-маркерам: `/^Ты — /` (промпт фазы) и `/^Продолжи/` (resume/авто-повтор); внутренние user-сообщения (repeat-guard VL-229, «Ошибка ответа модели», «Замечание: проигнорировано») границей не являются.
3. Фаза рана: запись billing по `sessionId` (упорядочена по finishedAt) → разбор текста маркера (`Фаза N: …`, 11 фаз) → `meta.phase`; расхождение числа записей billing и ранов печатается предупреждением, не ошибкой.
4. `--json` — фиксированная схема `{schemaVersion:1, kind:'session-summary', runs[], totals{...}}`, числа/`null` без `undefined`; `repeatStats` переиспользует `analyzeToolRepeats`.
5. Скелет shell-команды — новая чистая `shellCommandSkeleton` (первый сегмент до `&&`/`|`/`;`, 2 токена + `<arg>`): в `repeat-tracker` не лезем, там `null` для shell осознан.
6. Новая `findLatestTaskSessionSync` в `session.ts` рядом с `findTaskPhaseSessionSync` (без фильтра phase, общий селектор по mtime) — существующая не меняется, чтобы не влиять на resume оркестратора.
7. `write_file` учитывается отдельно от `edit` (`writes` vs `edits`) — иначе AC4-цифры «18 edit / 5 write_file» невозможно воспроизвести буквально.
Файлы плана: NEW `src/agent/session-summary.ts`, NEW `src/cli/commands/session.ts`, `src/agent/session.ts` (+`findLatestTaskSessionSync`), `src/cli/router.ts` (case + алиас + 2 справки), NEW `src/agent/session-summary.test.mjs`, NEW `src/cli/session-cli.test.mjs`, документация: doc-10 (через MCP `document_update`) + README (+CHANGELOG в фазе Close).
Риски: (1) billing пишется только для задачных ранов — расхождение с ранами jsonl нормально, выводим предупреждение; (2) граница рана — эвристика по маркеру шаблона (митигация: тест-инвариант «первая строка каждого `templates/phases/*.md` матчит `/^Ты — /`»); (3) при запуске из worktree `.vibelog/billing` в главном репо — кандидаты каталогов `[cwd, meta.cwd]`, иначе пустой billing без ошибки; (4) объём вывода — только агрегаты, без содержимого сообщений (экономия контекста, VL-178); (5) `--task` без сессии → явная ошибка. AC добавлены (5 шт., включая проверку на живых данных `agent-1793328615846`). Код не менялся.
---
author: @agent
created: 2026-10-30 13:14
---
Фаза 3 (Code) выполнена. Изменено: новый `src/agent/session-summary.ts` (чистое ядро: `buildSessionSummary`/`formatSessionSummary`/`shellCommandSkeleton`/`isPhasePromptMarker`/`phaseFromPromptText`, `SESSION_SUMMARY_SCHEMA_VERSION=1`), новый `src/cli/commands/session.ts` (`runSession`: разбор args, чтение jsonl с пропуском битых строк, мета, billing по кандидатам `[cwd, meta.cwd]`, `--json`), `src/agent/session.ts` (+`findLatestTaskSessionSync` + общий селектор `pickLatestSessionSync`, `findTaskPhaseSessionSync` переведён на него без изменения поведения), `src/cli/router.ts` (`case 'session'`/`case 'agent-session'` + строки в `showHelp` и `showCommandHelp`, справка алиаса резолвится на `session`), README (раздел «Сводка сессии»), новые тесты `src/agent/session-summary.test.mjs` (22) и `src/cli/session-cli.test.mjs` (11). Коммиты: `f897e78` (feat) и `9a9c43a` (test: битые строки).
Что реализовано по плану: раны режутся по user-маркерам `^Ты — ` и `^Продолжи`; внутренние user-сообщения (repeat-guard VL-229, «Ошибка ответа модели»/«Замечание: проигнорировано» VL-215) ран не режут; `endLine` закрывается на последнем содержательном (assistant/tool) сообщении, system-строки ран не создают. Фаза рана: billing (`phase` → `sessionPhase`) → разбор текста маркера (11 фаз + prompt) → `meta.phase`; расхождение числа записей billing и ранов печатается предупреждением. Агрегаты: `tools` по ранам и по сессии, `shellTop` по скелетам (флаги сохраняются, аргументы отбрасываются: `git status` и `git status --porcelain` → один ключ), `topReadPaths`, `editedFiles` + раздельно `edits`/`writes` (риск 4 плана снят — 18 edit / 5 write_file считаются буквально), `repeatStats` через `analyzeToolRepeats`.
Проверки: `pnpm build` (tsc strict) — чисто; полный `env -u VIBELOG_CWD npx vitest run` — **95 файлов, 1758 passed, 4 skipped** (пропуски — pre-existing `it.skip` в `src/core/frontmatter.test.mjs`, не связаны с задачей; `--exclude`/`--skip` не применялись); ручная проверка справки `node bin/vibelog.mjs session --help` и алиаса `agent-session --help`; `session summary <id> --json` и `--task` проверены CLI-тестами на mkdtemp-фикстуре.
AC: 1, 2, 3, 5 отмечены. **AC4 (живые данные) НЕ отмечен**: `.vibelog/agent-sessions/agent-1793328615846.jsonl` лежит в главном репозитории, а фаза Code работает в worktree `vb/vl-261`, где каталог `.vibelog/` отсутствует; run_shell_command отклоняет пути за границей worktree. Вместо живого прогона в тесты добавлена фикстура-эквивалент с точным профилем AC4 (3 рана plan→code→code, 110 tool-calls = 72 shell + 18 edit + 5 write_file + 15 read) — инвариант проверен. Живой прогон `vibelog session summary agent-1793328615846` нужно выполнить в фазе Close на master (там каталог сессий доступен). Урок зафиксирован: lesson-104.
DoD: «Тесты проходят» — отмечен (полный прогон). «Документация обновлена» — не отмечен: по правилам фазы Code CHANGELOG и doc-10 правятся в фазе Close; README уже обновлён здесь. Lesson: создан и связан lesson-104 (sourceTasks VL-261).
---
author: @agent
created: 2026-10-30 13:26
---
Фаза Close выполнена. Ветка `vb/vl-261` слита в master (`git merge --no-ff`, 2 коммита: `f897e78` feat + `9a9c43a` test; merge-коммит `9a040a2`), worktree `.vibelog/worktrees/vl-261` удалена (force — внутри были только untracked-симлинки `node_modules`/`references/data`), ветка удалена (`branch -d`).
Проверки на master после merge:
- `pnpm build` (tsc strict) — чисто.
- Ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD`: `src/agent/session-summary.test.mjs` (22), `src/cli/session-cli.test.mjs` (11), `src/agent/session.test.mjs` (33) — 66 passed.
- Полный прогон (`env -u VIBELOG_CWD`, без `--exclude`/`--skip` по смыслу задачи, в две команды как в `pnpm test`: без `static.test.mjs` и сам `static.test.mjs`): **94 файла 1768 passed / 4 skipped + 1 файл 7 passed**; пропуски — pre-existing `it.skip` в `src/core/frontmatter.test.mjs`. Повторных полных прогонов не делалось.
**Живая проверка (AC4) — выполнена, но цифры в AC не воспроизводятся, и это факт данных, а не дефект команды.** `node bin/vibelog.mjs session summary agent-1793328615846` на master даёт: **237 строк, 5 ранов, 113 LLM-запросов, 115 tool-calls** (`run_shell_command` 76, `edit` 18, `read_file` 12, `write_file` 5, `backlog_finish_phase` 2, `grep_search` 1, `backlog_update_task` 1). Прямая сверка jsonl (`node -e`: подсчёт валидных tool_calls и user-маркеров) полностью совпадает с выводом команды — 115 tool-calls, 5 маркеров промптов. AC4 ожидает 3 рана / 110 tool-calls / 72 shell — это цифры ручного счёта, сделанного **до** последних двух ранов сессии (раны #2 «строки 108–111» и #5 «строки 226–237» — короткие resume-раны, добавившие 4 shell + 1 finish_phase; 110+5=115, 72+4=76). Поэтому **AC4 оставлен неотмеченным честно**: команда цифры своего транскрипта воспроизводит точно, а эталонные числа AC устарели относительно текущего jsonl. Дополнительно вскрылось расхождение: billing `VL-235.json` содержит 5 записей по этой сессии, но **все с `phase: plan`**, тогда как маркеры jsonl — `plan, plan, code, code, code`; команда на такое расхождение печатает предупреждение `⚠️ billing` (риск 1 плана). Это поведение зафиксировано уроком lesson-106.
Документация (шаг 8): CHANGELOG.md — запись VL-261 в Unreleased/Добавлено; doc-10 — новый раздел §3.4 «Сводка сессии (VL-261)» (внесён в главном репо, `doc view doc-10` подтверждает); README (раздел «Сводка сессии») уже пришёл из ветки. Коммит `4af2f8d` — `docs: VL-261 — документация и CHANGELOG`.
Lessons: lesson-104 (проверка сводки в worktree — живые jsonl за границей worktree; уже был создан в Code) + новый lesson-106 (сверяй фазу рана из billing с маркером промпта) — связка через `lessons`. Коммит `docs(task): VL-261 — refs и lessons`.
DoD: «Тесты проходят» — да (полный прогон на master); «Документация обновлена» — да (CHANGELOG + doc-10 §3.4 + README); «Нет регрессий» — да (сборка чиста, полный прогон зелёный, поведение `findTaskPhaseSessionSync` не изменено — `session.test.mjs` 33 passed).
---
<!-- COMMENTS:END -->