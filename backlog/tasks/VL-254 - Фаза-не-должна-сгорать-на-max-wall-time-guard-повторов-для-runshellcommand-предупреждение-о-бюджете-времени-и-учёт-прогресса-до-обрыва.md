---
id: VL-254
title: 'Не сжигать фазу на wall-time: guard shell, бюджет времени, прогресс до обрыва'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 09:06'
updated_date: '2026-10-30 22:46'
due_date: ''
labels:
  - agent
  - core
  - prompt
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/tools.ts
  - src/agent/tools.test.mjs
  - src/agent/run-progress.ts
  - src/agent/run-progress.test.mjs
  - src/agent/run-progress-cli.test.mjs
  - src/agent/session.ts
  - src/agent/cli.ts
  - templates/phases/phase-code.md
  - templates/phases/phase-plan.md
  - templates/agent-prompt.md
  - src/web/phase-prompt.test.mjs
  - src/mcp/server.test.mjs
lessons:
  - lesson-122
  - lesson-123
token_usage:
  input: 28497283
  output: 132066
  cache: 27245568
  total: 28629349
  requests: 273
  duration_ms: 2742228
  reasoning: 56517
  by_phase:
    spec:
      input: 114653
      output: 1367
      cache: 86016
      requests: 4
    plan:
      input: 13599629
      output: 59497
      cache: 13220352
      requests: 115
    code:
      input: 12809090
      output: 59141
      cache: 12024320
      requests: 117
    close:
      input: 1973911
      output: 12061
      cache: 1914880
      requests: 37
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Разбор авто-прогона 30.10 (auto start 05:50): VL-235 «Карта проекта» — **фаза Plan завершилась штатно**, а сгорела на `max_wall_time: 2400` с **фаза Code** после 3 ранов resume (05:50–07:58): 157 LLM-запросов, 110 tool-вызовов, ~10.6 млн входных токенов, payload до 486 КБ → `failed_permanent` (attempts=2/max=1), задача зависла, очередь встала.

Важно про учёт фазы: в `.meta.json` сессии стоит `"phase":"plan"`, но это неверно — в транскрипте на строке 106 агент записал `implementationPlan` и ответил «Готово», а на строке 107 пришёл промпт «Фаза 3: Code». Т.е. поле `phase` пишется при старте сессии и не обновляется при смене фазы (см. VL-243); заодно в `billing/VL-235.json` у 4 из 5 записей одинаковый `startedAt` — раны resume неразличимы.

Что делал агент (по транскрипту `agent-1793328615846`):
- ран 1 (0–106) — **Plan**: 43 `run_shell_command`, из них **~10 одноразовых `node -e`-скриптов** (обход дерева `fs.readdirSync` вместо `glob`/`read_file` каталога), многострочные `grep -rn` по всему `src` с `--include`; правок кода нет — фаза закрыта успешно;
- ран 2 (107–170) — **Code** (промпт «Фаза 3: Code», статус Planned): 12 `run_shell_command` + **12 `edit`**, 3 `write_file` — штатная реализация плана (правки `src/core/project-map.ts`, тесты, затем переписывание текста теста через `node -e` вместо `edit`);
- ран 3 (171–224) — продолжение **Code**: 17 `run_shell_command` + 6 `edit` + 2 `write_file`, два полных `pnpm test` с `timeout_ms: 1500000`, падение `src/core/project-map.test.mjs`, починка, правка счётчиков MCP-инструментов 37→38 по пяти файлам — и обрыв по wall-time сразу после запуска `pnpm build && pnpm test` (486 КБ payload).

То есть никакого «незаметного переезда Plan в реализацию» не было: переход Plan → Code штатный, правки кода — нормальная работа фазы Code. Проблема в том, что **фаза Code сгорела на wall-time, не оставив ни коммита, ни отчёта о прогрессе**.

Почему это системная проблема, а не разовая ошибка модели:
1. **`run_shell_command` вне guard'а повторов.** VL-229 добавил `repeat-tracker`, но для shell возвращает `null` (сознательно — «команда как ключ шумит»). Именно shell-вызовы составили 72 из 110 tool-calls (65%), причём шаблон «проверим ещё раз то же самое через node -e» guard не видит.
2. **Нет бюджета времени как обратной связи агенту.** wall-time проверяется только между итерациями (`src/agent/loop.ts:451`) и просто убивает фазу текстом «превышен лимит». Агент не знает, что у него осталось 3 минуты, и стартует полный `pnpm test` на 1500 с — гарантированный обрыв. После обрыва теряется вся работа рана (нет запуска `pnpm test` → нет DoD, статус не менялся).
3. **Нет предупреждения о приближении к payload-лимиту в терминах задачи.** VL-230 компактит историю на 70% от 900 КБ, но агент этого не видит: в ране 3 payload 486 КБ и при следующем полном прогоне теста он бы упёрся в лимит.
4. **Обрыв фазы Code без коммита и отчёта.** Ветка vl-235 осталась с незакоммиченными M-файлами, блока «что сделано / что осталось» нет ни в мете сессии, ни в комментарии задачи — транскрипт единственный источник правды. В «Экономии ходов» `templates/phases/phase-code.md` нет правила про остаток бюджета времени; нет и запрета на `node -e`-обходчики там, где есть `glob`/`read_file` каталога (VL-233) и `project_map` (VL-235).

## Цель

Чтобы фаза не сгорала целиком на wall-time: агент (а) видит оставшийся бюджет и не стартует заведомо длинные команды, (б) получает предупреждение при зацикливании на однотипных shell-вызовах, (в) при обрыве оставляет пригодный к resume прогресс (коммит + отчёт «что сделано / что осталось»).

## Предлагаемое решение (проверить в Plan)

1. **`repeat-tracker`: ключ для shell.** Для `run_shell_command` брать не всю команду, а нормализованный «скелет»: первая команда цепочки (`&&`/`;`/`|`) + отсортированный набор путей/паттернов из аргументов, `node -e`/`node --input-type=module -e` → ключ `node-e` с хэшем первых 200 символов скрипта. Guard предупреждает на 3-м одинаковом скелете («ты уже выполнял эту команду N раз — используй полученный вывод»), в метрику (`repeat_stats`) shell-вызовы попадают отдельной строкой.
2. **Мягкий wall-time guard в `loop.ts`.** Кроме жёсткой проверки `duration() > maxWallTimeMs` (остаётся) — на 70% бюджета и на 90% инжектировать агенту `role: 'user'` сообщение: «осталось N с из M; не запускай команды дольше остатка — сократи проверку до затронутых тестов, при нехватке времени заверши фазу с честным отчётом». В это же сообщение добавлять текущий `payload_bytes` и порог компакта (VL-230), чтобы агент видел приближение к лимиту байт.
3. **Проверка длительности команды против остатка бюджета.** В `run_shell_command` передавать `timeout_ms` и сравнивать с оставшимся wall-time: если `timeout_ms` больше остатка — возвращать агенту предупреждение в tool-выводе («timeout 1500 с превышает остаток фазы 180 с; команда может быть убита») и усекать таймаут до остатка, чтобы shell-таймаут не наложился на wall-time фазы.
4. **Прогресс до обрыва.** При выходе по wall-time (и по `max-requests`) писать в мету сессии и в отчётный комментарий задачи блок «что сделано / что осталось»: список завершённых шагов из последних assistant-сообщений (или явный чек-лист плана, отмечаемый агентом) + коммит незакоммиченных изменений в ветку, если фаза code. Сейчас ветка vl-235 осталась с M-файлами, а транскрипт — единственный источник правды. В `templates/phases/phase-code.md` («Экономия ходов») — правило про бюджет: при остатке < N мин не запускать полные прогоны и фиксировать прогресс в задаче.
5. **Правила против `node -e`-обходчиков в промптах.** В `templates/phases/phase-plan.md` («Экономия ходов») и `agent-prompt.md`: «для обзора дерева/модулей используй `project_map` (VL-235) и `read_file` каталога, не пиши `node -e`-обходчики»; «для выборки строк из файла — `read_file` с диапазоном, `sed`/`node -e` — только если диапазон выводится в `&&`-цепочке проверки» (сейчас `node -e` разрешён как замена BSD-sed, и агент воспринимает это как разрешение на любые скрипты).

## Связанное

VL-229 (guard повторов — shell не покрыт), VL-230 (компакт по payload — нет обратной связи агенту), VL-104 (введение wall-time), VL-242 (три полных прогона тестов в Close), VL-124 (политика инструментов вместо патч-скриптов), VL-243 (неполный учёт фаз — почему теряются раны и почему `phase` в мете лжёт), VL-239 (модель в мете сессии).

## Входные данные

- `.vibelog/agent-sessions/agent-1793328615846.jsonl` (VL-235, 3 рана, 238 сообщений; строка 106 — запись плана и «Готово», строка 107 — промпт «Фаза 3: Code») + `.meta.json` (`phase: plan` — неверно для ранов 2–3, `repeat_stats`, `max_payload_bytes: 486004`), `.vibelog/billing/VL-235.json` (5 записей, у 4 одинаковый `startedAt`), `.vibelog/auto-queue.json` (VL-235 `failed_permanent`, `fail_reason` с payload/usage).
- `.vibelog/agent-sessions/agent-1793336294892.jsonl` (VL-237, зелёный план за 30 мин — контрольный пример «как надо»).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Guard повторов покрывает run_shell_command: третье повторение того же скелета команды даёт агенту предупреждение «используй полученный вывод», а shell-вызовы учитываются в repeat_stats отдельной строкой (тест на фикстуре с тремя node -e/grep-вызовами)
- [x] #2 На 70% и 90% бюджета wall-time агенту инжектируется сообщение с остатком времени и текущим payload_bytes; в тесте при лимите 10 с фаза получает предупреждения и продолжает работу
- [x] #3 Если timeout_ms команды больше остатка wall-time, run_shell_command возвращает предупреждение в tool-выводе и усекает таймаут до остатка (тест: timeout 1500 с при остатке 5 с)
- [x] #4 При обрыве по wall-time/max-requests в мете сессии и комментарии задачи фиксируется блок «что сделано / что осталось», а незакоммиченные изменения фазы code коммитятся в ветку (тест)
- [x] #5 pnpm test зелёный (полный прогон), документация агента (doc-10) обновлена
- [x] #6 Промпты: в templates/phases/phase-code.md («Экономия ходов») есть правило про остаток бюджета времени (при остатке < N мин не запускать полные прогоны, фиксировать прогресс в задаче); в templates/phases/phase-plan.md и templates/agent-prompt.md — правила «project_map/read_file каталога вместо node -e-обходчиков» и «read_file с диапазоном вместо sed/node -e для выборки строк»; инвариант-тест на наличие всех трёх правил
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Архитектурное решение

Три независимых механизма + прогресс-отчёт, без изменения wire-формата LLM:

1. **shell-скелет в repeat-tracker** (новый RepeatKind `'shell'`, отдельная строка метрики).
2. **Мягкий wall-time guard в loop.ts** (пороги 70%/90% → user-сообщение с остатком времени и `payload_bytes`).
3. **Согласование timeout_ms с остатком бюджета** (чистая функция `clampShellTimeout` + `remainingWallTimeMs` в `ToolHandlerContext`).
4. **Отчёт «что сделано / что осталось» при обрыве** (новый модуль `src/agent/run-progress.ts`: чистый билдер + коммит WIP-изменений в ветку) + запись в мету сессии и комментарий задачи из CLI.

Детерминированность тестов времени: в `RunLoopOptions` добавляется необязательный тест-хук `now?: () => number` (дефолт `Date.now`), `duration()` считается от него — тесты AC2/AC4 не спят.

## Файлы для изменения

### 1. `src/agent/repeat-tracker.ts` (существующий, ключ shell)
- **строки 24–26** (константы порогов): добавить `export const REPEAT_SHELL_LIMIT_DEFAULT = 3;`.
- **тип RepeatKind (стр. ~30–38)**: добавить член `'shell'` с комментарием «shell-цепочки: однотипные `node -e`/`grep` — 65% tool-calls в VL-235, guard ловил их как уникальные».
- **стр. 47–60 `toolRepeatTarget`**: в `switch` добавить `case 'run_shell_command': return typeof args.command === 'string' ? shellCommandKey(args.command) : null;` (остальные возвращают null как раньше).
- **новая экспортируемая функция `shellCommandKey(command: string): string`** (перед `toolRepeatTarget`):
  - нормализация: первый сегмент цепочки `split(/&&|\|\||;|\|/)[0]`;
  - `node -e` / `node --eval` / `node --input-type=module -e` / `node -p` → `node-e|<sha1 первых 200 символов скрипта>` (для `--input-type` учитывать следующий `-e`);
  - иначе: первая команда + отсортированный набор «значимых» аргументов-путей/паттернов (токены, содержащие `/`, `*`, `.ts|.mjs|.md`, либо после флагов `-e/--include/-rn`); флаги одного вида схлопываются; длина ключа ≤ 80 (усечение);
  - пустая команда → `''`.
  - Импорт `createHash` из `node:crypto` — модуль перестаёт быть полностью «без Node-API», поэтому докблок дополнить пометкой; альтернатива — собственная дешёвая хэш-функция (FNV-1a, 8 hex) без импортов. **Выбор: FNV-1a** (модуль остаётся чистым, тестируется на массивах).
- **стр. 68–80 `toolRepeatKind`**: `case 'run_shell_command': return 'shell';`.
- **стр. 113–133 `RepeatStats`**: добавить поля `shell_tool_calls: number`, `shell_repeat_calls: number`, `shell_share: number`, `shell_top: RepeatEntry[]` (докблок: «shell-вызовы отдельной строкой — AC1 VL-254; в `tool_calls_total`/`top` они теперь тоже попадают, поэтому доля по файлам/поиску не маскируется shell'ом, но видна раздельно»).
- **стр. 135–180 `analyzeToolRepeats`**: параллельный счётчик `shellCounts` по тем же правилам (второй и далее — repeat); `emptyRepeatStats` (стр. ~125) дополнить нулями.
- **стр. 195–221 `createRepeatGuard`**: в `limits` добавить `shell: options.shellLimit ?? REPEAT_SHELL_LIMIT_DEFAULT`; в тексте предупреждения для shell — hint «команда уже выполнялась N раз — используй её вывод; для обзора — `project_map`/`read_file` каталога»; маркерная подстрока «используй ранее полученный результат» сохраняется (lesson-76).
- `RepeatGuardOptions`: поле `shellLimit?: number`.

### 2. `src/agent/loop.ts` (мягкий guard + ctx для shell)
- **импорты (стр. 45–56)**: `REPEAT_SHELL_LIMIT_DEFAULT`.
- **`LoopLimits` (после `repeatReadLimit`)**: `repeatShellLimit?: number` (дефолт 3).
- **`LoopLimits` (после `payloadWarnBytes`)**: `wallTimeWarnRatios?: number[]` (дефолт `[0.7, 0.9]`, для тестов).
- **`LoopResult`**: `progress?: RunProgress` (импорт типа из `./run-progress.js`).
- **`RunLoopOptions`**: `now?: () => number` — тест-хук (докблок «только для тестов; дефолт Date.now»).
- **стр. ~415**: `const duration = (): number => (options.now?.() ?? Date.now()) - startedAt;`; `startedAt` тоже через `now()`.
- **стр. 349–355 (перед `messages`)**: вынести `maxPayloadLimit` и `payloadWarn` из try-блока наверх (сейчас вычисляются внутри цикла на стр. ~478–485) — нужны мягкому guard'у; в try оставить только локальное использование.
- **guard создания (стр. ~330–340)**: прокинуть `shellLimit: options.limits?.repeatShellLimit ?? REPEAT_SHELL_LIMIT_DEFAULT`.
- **жёсткая проверка wall-time (стр. 450–459)**: перед `return fail(...)` — `return failWithProgress(<тот же текстом>, 'wall-time')`; аналогично `max-requests` → `'max-requests'`.
- **новая экспортируемая функция `wallTimeWarnText(remainingMs, totalMs, payloadBytes, warnBytes)`** (рядом с `loopDetectionDirective`): текст «Осталось N с из M (X%). Payload последнего запроса: B байт, порог компакта: W байт. Не запускай команды дольше остатка: сократи проверку до затронутых тестов; при нехватке времени — заверши фазу честным отчётом «что сделано / что осталось».» Маркер `Осталось` и `payload` — для инвариант-тестов.
- **в цикле, сразу после жёстких проверок (после стр. 459, до `let response`)**: мягкий guard:
  - `const ratio = maxWallTimeMs > 0 ? duration() / maxWallTimeMs : 0;`
  - для каждого `r` из `wallTimeWarnRatios`, если `ratio >= r && !warnedRatios.has(r)` → `warnedRatios.add(r)` и `await pushMessage({ role: 'user', content: wallTimeWarnText(...) })` (payload — `lastPayload ?? 0`, порог — `payloadWarn`);
  - инъекция на границе хода (после всех tool-результатов прошлого хода) — паринг assistant↔tool не ломается (lesson-91).
- **конец fail-пути / успешного пути**: `progress` заполняется только в `failWithProgress`.
- **новая внутренняя `failWithProgress(errorText, reason)`**: вызывает `fail`, но перед этим собирает `buildRunProgress({ messages, reason, wallTimeMs: maxWallTimeMs, durationMs: duration(), payloadBytes: maxPayload, limits })` и приклеивает `progress` к результату.
- **вызов handler (стр. ~805)**: `output = await spec.handler(call.arguments ?? {}, { signal: options.signal, remainingWallTimeMs: () => Math.max(maxWallTimeMs - duration(), 0) });`

### 3. `src/agent/tools.ts` (усечение таймаута + ctx)
- **стр. 38–40 `ToolHandlerContext`**: добавить `remainingWallTimeMs?: () => number;` с докблоком «VL-254: колбэк остатка бюджета фазы — run_shell_command усекает timeout_ms».
- **новая экспортируемая чистая функция `clampShellTimeout(requestedMs, remainingMs)`** (перед `makeRunShellCommand`, стр. ~1245) → `{ timeoutMs: number; warning: string | null }`:
  - `remainingMs === undefined` → `{ requestedMs, null }`;
  - `requestedMs <= remainingMs` → `{ requestedMs, null }`;
  - иначе `{ timeoutMs: max(1000, remainingMs), warning: 'timeout N мс превышает остаток бюджета фазы M мс — таймаут усечён до M мс; команда может быть убита, сократи проверку' }`.
- **стр. 1262–1266 (расчёт `timeout`)**: заменить на `const { timeoutMs: timeout, warning: timeoutWarning } = clampShellTimeout(запрошенный, ctx?.remainingWallTimeMs?.());`, где запрошенный — прежняя логика (`args.timeout_ms` либо `TIMEOUT_DEFAULT`).
- **сборка вывода (стр. ~1300–1320)**: при `timeoutWarning` добавить его первой строкой в `parts` (модель видит предупреждение до stdout/stderr).
- Докблок `makeRunShellCommand` дополнить правилом усечения.

### 4. `src/agent/run-progress.ts` (НОВЫЙ модуль)
Чистый билдер + git-хелпер:
- `export interface RunProgress { reason: 'wall-time' | 'max-requests' | 'other'; text: string; done: string[]; pending: string[]; commit?: string | null; }`
- `export function buildRunProgress(input: { messages: ChatMessage[]; reason: RunProgress['reason']; durationMs?: number; payloadBytes?: number }): RunProgress`:
  - `done`: уникальные пути из `edit`/`write_file` (до 10) + последняя непустая assistant-текстовая реплика (≤300 символов) как «последнее сообщение модели»;
  - `pending`: фиксированный чек-лист для обрыва — «проверки (сборка/полные тесты) не завершены в этом ране», «нет отчёта фазы (backlog_finish_phase не вызван)», «DoD не отмечен»;
  - `text` — markdown-блок `### Прогресс до обрыва (<reason>)` + `**Сделано:**` + `**Осталось:**` + строка `duration_ms`/`payload` (маркеры «Сделано», «Осталось» обязательны — по ним тесты и разбор).
- `export function commitProgressChanges(cwd: string, taskId: string, reason: string): string | null`
  - `git status --porcelain` (execFile `/usr/bin/git`) → если пусто, `null`;
  - отфильтровать пути начинающиеся с `backlog/` (файлы задач не коммитим);
  - `git add -u` + явный `git add <каждый новый путь>` (никогда `-A`);
  - `git commit -m "wip(<taskId>): прогресс фазы code до обрыва ($reason)"` → вернуть short-hash (`git rev-parse --short HEAD`);
  - любая ошибка → `console.error` + `null` (не менять exit-код фазы).
- `export function appendCommitToProgress(progress: RunProgress, hash: string): RunProgress`.

### 5. `src/agent/cli.ts` (запись прогресса: мета + комментарий + коммит)
- **импорты (стр. 27–44)**: `buildRunProgress, commitProgressChanges, appendCommitToProgress` из `./run-progress.js`; `addComment` из `../core/store.js` (уже импортируется `getTask` из стора — объединить импорт).
- **после блока пост-ран учёта токенов (после стр. ~855, перед итоговой диагностикой)**: новый `try/catch`-блок «VL-254: прогресс обрыва»:
  - условие: `loopResult.is_error === true && loopResult.progress !== undefined`;
  - `phase` рана: `existing?.lastRunPhase ?? process.env.VIBELOG_RUN_PHASE ?? existing?.phase ?? process.env.VIBELOG_PHASE_NAME` (не зависит от учёта токенов);
  - если `phase === 'code'` — `const hash = commitProgressChanges(cwd, taskId, reason)` и `progress = appendCommitToProgress(progress, hash)`;
  - `updateSessionMeta(sessionsDir, sessionId, { cwd, run_progress: { ...progress, phase, finishedAt } })`;
  - если `taskId` — `addComment(taskCwd, taskId, progress.text, '@agent')` (taskCwd = `VIBELOG_CWD ?? cwd`, как в блоке токенов — в worktree-режиме задачи живут в главном репо);
  - ошибка любой ветки → предупреждение в stderr, фаза не падает.
- Итоговая stderr-диагностика (стр. ~870–880): добавить `shell-повторов=${loopResult.repeat_stats.shell_repeat_calls}/${loopResult.repeat_stats.shell_tool_calls}`.

### 6. `src/agent/session.ts` (`SessionMeta.run_progress`)
- **после `runs?: SessionRun[]` (стр. 206)**: поле `run_progress?: { reason: string; phase?: string; finishedAt?: string; text: string; done: string[]; pending: string[]; commit?: string | null }` с докблоком «VL-254: блок «что сделано / что осталось» при обрыве по wall-time/max-requests — транскрипт перестаёт быть единственным источником правды».

### 7. `src/agent/session-summary.ts` (сводка видит shell-повторы)
- **стр. 203 `shellCommandSkeleton`**: НЕ переиспользовать новый `shellCommandKey` (разные задачи: сводка группирует «git status», guard — «git status|path»); в докблок добавить одну строку-ссылку на `repeat-tracker.shellCommandKey` (осознанное различие).
- **`SummaryTotals`**: добавить `shellRepeatStats` — подмножество `RepeatStats` (shell_*) из `repeatStats`, чтобы `/analyze` показывал долю без разбора топов. (Если правка покажется избыточной — допустимо опустить; AC1 требует только repeat_stats, поэтому поле помечено опциональным в плане.)

### 8. Промпты
- **`templates/phases/phase-code.md`, раздел «## Экономия ходов» (после пункта про `--max-tool-calls`, стр. ~71)**: новый пункт: «Бюджет времени фазы: перед длинной командой прикинь остаток (`ваll-time` предупреждения приходят в чат на 70% и 90%). При остатке менее 5 минут — НЕ запускай полный прогон tests/сборку: проверь только затронутые файлы (`vitest run <файл>`), а прогресс и остаток работ зафиксируй комментарием в задаче; иначе фаза сгорит без отчёта.»
- **`templates/phases/phase-plan.md`, «## Экономия ходов» (после пункта про пакетное чтение)**: два пункта: «Для обзора дерева/модулей — `project_map` и `read_file` каталога; `node -e`-обходчики `fs.readdirSync` вместо них запрещены»; «Для выборки строк из файла — `read_file` с диапазоном (`файл:N-M`); `sed`/`node -e` — только внутри `&&`-цепочки проверки, не как способ читать файл».
- **`templates/agent-prompt.md`, список правил (после правила про sed на macOS)**: пункт «Для обзора дерева/модулей — `project_map`/`read_file` каталога, не `node -e`-обходчики; для выборки строк — `read_file` с диапазоном, не `sed`/`node -e` (sed — только BSD-диапазоны внутри проверочной `&&`-цепочки).»

### 9. Документация (AC5)
- **doc-10 (guide «Агент Vibelog»)** через `document_update`: в раздел про лимиты/loop-detection добавить подраздел «Бюджет времени и прогресс до обрыва (VL-254)»: мягкие пороги 70%/90%, текст предупреждения с `payload_bytes`, усечение `timeout_ms` до остатка бюджета, shell-скелет в `repeat_stats`, автокоммит WIP фазы code + блок «что сделано / что осталось» в мете (`run_progress`) и комментарии задачи.
- `AGENTS.md` — не трогаем (правило про полный прогон не меняется).

## Порядок действий

1. `repeat-tracker.ts`: константы, `RepeatKind`, `shellCommandKey`, `toolRepeatTarget`, `toolRepeatKind`, `RepeatStats`/`emptyRepeatStats`/`analyzeToolRepeats`, `createRepeatGuard`. Тесты: `src/agent/repeat-tracker.test.mjs` — обновить ожидания старых тестов (`toolRepeatTarget('run_shell_command')` больше не null, `toolRepeatKind` → `'shell'`), добавить фикстуру AC1: три `node -e`-вызова с разными скриптами → один `node-e|<hash>`; три `grep -rn foo src` → один ключ; `analyzeToolRepeats` на 3 shell + 3 grep даёт `shell_tool_calls=3, shell_repeat_calls=2`; guard выдаёт предупреждение на 3-м shell-вызове с маркером «используй ранее полученный результат».
2. `run-progress.ts` + `src/agent/run-progress.test.mjs` (mkdtemp): билдер (done из edit-путей и последнего assistant-текста, маркеры «Сделано»/«Осталось», reason), `commitProgressChanges` на `git init`-репозитории в tmp (файл вне backlog → коммит, hash; файл `backlog/tasks/x.md` не попадает; пустой статус → null), `appendCommitToProgress`.
3. `tools.ts`: `ToolHandlerContext.remainingWallTimeMs`, `clampShellTimeout`, использование в handler. Тесты `src/agent/tools.test.mjs`: `clampShellTimeout(1500000, 5000)` → timeout 5000 + warning с обоими числами; `clampShellTimeout(1000, 5000)` → без warning; handler `run_shell_command` с `ctx.remainingWallTimeMs = () => 5000` и `timeout_ms: 1500000` на быстрой команде (`node -e "console.log(1)"`) → в выводе есть предупреждение про усечение.
4. `loop.ts`: `now`, hoist `payloadWarn`, `wallTimeWarnText`, мягкие пороги, `progress` в fail-путях, `remainingWallTimeMs` в ctx. Тесты `src/agent/loop.test.mjs`: (а) `maxWallTimeMs: 10000`, `now` — управляемая функция (двигаем часы на +7500 и +9500 мс после первого хода мока) → в `res.messages` ровно 2 user-сообщения с «Осталось» и `payload`, фаза продолжается и завершается успешно; (б) обрыв по wall-time (`maxWallTimeMs: 1`) → `res.progress.reason === 'wall-time'` и в `progress.text` маркеры «Сделано»/«Осталось»; (в) guard shell: три одинаковых `run_shell_command` за ран → в messages есть предупреждение о повторе.
5. `session.ts` (поле `run_progress`) + при необходимости тест в `session.test.mjs` (merge не затирает `taskId/phase`, `run_progress` читается).
6. `cli.ts`: блок прогресса (мета + комментарий + WIP-коммит), stderr-строка shell-повторов. Тест — `src/agent/cli.test.mjs` (если покрытие CLI-пустоты позволяет): сквозной прогон с `VIBELOG_PHASE_TASK_ID` на tmp-проекте с задачей, падение по wall-time → в мете `run_progress`, в задаче комментарий с «Осталось». Если сквозной прогон в тесте дорог — покрыть связку «мета + addComment» как отдельную функцию-обёртку, вынесенную из `main` (сделать `export async function recordRunProgress(...)` в `cli.ts` или в `run-progress.ts`).
7. Промпты (`phase-code.md`, `phase-plan.md`, `agent-prompt.md`) + инвариант-тест в `src/web/phase-prompt.test.mjs`: assert `phase-code.md` содержит «остат» и «полный прогон»/«бюджет»; `phase-plan.md` — «project_map» и «node -e» и «read_file с диапазоном»; `agent-prompt.md` — «project_map» и «node -e» и «read_file с диапазоном».
8. `doc-10` через `document_update`.
9. Проверки: `pnpm build && pnpm test` (полный прогон — AC5, DoD «Тесты проходят»). Точечно на итерациях: `pnpm build && npx vitest run src/agent/repeat-tracker.test.mjs src/agent/run-progress.test.mjs src/agent/tools.test.mjs src/agent/loop.test.mjs`.
10. Коммит: `git add` явными путями (src/agent/*.ts, *.test.mjs, templates/*, без backlog/), сообщение `feat: VL-254 — guard shell-повторов, мягкий бюджет времени, прогресс до обрыва`.

## Риски и решения

- **R1. `node -e`-ключ может «склеить» легитимные разные скрипты.** Хэш первых 200 символов различает скрипты с разным началом; повторная итерация по одному скрипту — как раз то зацикливание, которое надо ловить. Порог 3, предупреждение (не блок) — ложное срабатывание стоит одну строку контекста.
- **R2. `analyzeToolRepeats` теперь видит shell → меняются цифры `repeat_share` в существующих тестах и в отчётах `/analyze`.** Тесты, ожидающие «run_shell_command входит в total, но не в топ», обновляются; семантика `repeat_share` документируется в докблоке (теперь включает shell — это честнее: 65% вызовов были shell).
- **R3. Мягкие предупреждения раздувают контекст.** Два сообщения за ран (70%/90%), каждое ≤400 символов, дедуп по `Set` — максимум +800 байт на ран; кап жёсткий по конструкции.
- **R4. Автокоммит в fail-пути может закоммитить чужие/временные файлы.** Правила: только `phase === 'code'`, `git add -u` + явные новые пути, фильтр `backlog/`, никакого `-A`, ошибки гасятся в `console.error` (exit-код не меняется). В worktree-режиме cwd — рабочее дерево задачи, коммит идёт в vb/vl-254.
- **R5. `now()`-хук в проде.** Дефолт `Date.now`; поле необязательное, CLI его не передаёт — поведение не меняется.
- **R6. Усечение таймаута до остатка может убить легитимно долгую команду раньше срока.** Это осознанный обмен: команда всё равно была бы убита wall-time'ом фазы, но без предупреждения и с потерей отчёта. Минимум 1000 мс, чтобы короткие команды успевали.
- **R7. Формат AC3 (текст предупреждения в tool-выводе) должны матчить тест и AGENTS/промпты** — маркер `превышает остаток бюджета фазы` фиксируется в одном месте (`clampShellTimeout`) и проверяется тестом (lesson-76).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 09:11
---
Создана по разбору auto-прогона 30.10 (VL-235 сгорела на wall-time; диагностика — в описании задачи, транскрипт `.vibelog/agent-sessions/agent-1793328615846.jsonl`). Проверено, что среди открытых задач дубля нет: VL-229 покрывает guard только для grep/read_file (shell намеренно исключён), VL-230 — компакт по payload без обратной связи агенту, VL-242 — повторные прогоны в Close, VL-124 — устаревшая политика патч-скриптов. Ни одна из них не закрывает связку «shell вне guard + нет бюджета времени + потеря прогресса при обрыве + промпт Plan не останавливает реализацию».
---
author: @agent
created: 2026-10-30 21:36
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Не сжигать фазу на wall-time: guard shell, бюджет времени, прогресс до обрыва» (прежний был длиннее 80 символов). Тип: bug (тип исходно bug — подтверждён). Масштаб: task (обычная задача-исполнитель). Приоритет: High (обрыв фазы сжигает авто-прогон и останавливает очередь). Уточнено: постановка полная — есть контекст инцидента с транскриптом, цель, 5 пунктов решения, входные данные и 6 проверяемых AC; правки описания не потребовались, AC оставлены как есть (все конкретны и проверяемы тестами). Labels: agent, core, prompt. References: нет (внешних источников не упомянуто; .vibelog/*-файлы — локальные входные данные задачи, не references). Вопросов нет.
---
author: @agent
created: 2026-10-30 21:46
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача — план записан в ту же задачу).
План: 4 механизма + промпты + документация.
1) `src/agent/repeat-tracker.ts` — новый `RepeatKind: 'shell'`, `REPEAT_SHELL_LIMIT_DEFAULT=3`, чистая `shellCommandKey()` (первый сегмент цепочки + отсортированные значимые аргументы; `node -e/--input-type/-p` → `node-e|<FNV-1a хэш первых 200 символов>`), отдельные поля метрики `shell_tool_calls/shell_repeat_calls/shell_share/shell_top` в `RepeatStats`, порог в `createRepeatGuard`.
2) `src/agent/loop.ts` — тест-хук `now?: () => number` (детерминированные тесты времени без sleep), hoist `payloadWarn`/`maxPayloadLimit` из try-блока, `wallTimeWarnText()` с маркерами «Осталось»/`payload`, мягкий guard 70%/90% (dedupe по `Set`, инъекция user-сообщением на границе хода — lesson-91), `failWithProgress()` на путях wall-time и max-requests, проброс `remainingWallTimeMs` в ctx handler'ов.
3) `src/agent/tools.ts` — `ToolHandlerContext.remainingWallTimeMs`, чистая `clampShellTimeout()` (усечение до остатка, минимум 1000 мс, warning первой строкой tool-вывода).
4) `src/agent/run-progress.ts` (новый) — `buildRunProgress` (блок «Сделано»/«Осталось», done из путей edit/write_file + последнего assistant-текста), `commitProgressChanges` (git status → фильтр `backlog/`, `add -u` + явные новые пути, никогда `-A`, ошибки → console.error, exit-код не меняется), `appendCommitToProgress`.
5) `src/agent/cli.ts` — при `is_error && progress`: WIP-коммит (только фаза code), `updateSessionMeta({run_progress})`, `addComment` в задачу (taskCwd = `VIBELOG_CWD ?? cwd`); shell-повторы в итоговую stderr-диагностику.
6) `src/agent/session.ts` — поле меты `run_progress`.
7) `src/agent/session-summary.ts` — `shellCommandSkeleton` осознанно не сливается с `shellCommandKey` (разные задачи группировки; ссылка в докблоке).
8) Промпты: `templates/phases/phase-code.md` — правило бюджета (остаток < 5 мин → не запускать полный прогон, фиксировать прогресс в задаче); `templates/phases/phase-plan.md` и `templates/agent-prompt.md` — правила «project_map/read_file каталога вместо `node -e`-обходчиков» и «read_file с диапазоном вместо sed/node -e для выборки строк».
9) doc-10 через `document_update` — подраздел про мягкие пороги, усечение timeout, shell-скелет в repeat_stats, `run_progress` и автокоммит WIP.
Тесты: обновить существующие ожидания (`toolRepeatTarget('run_shell_command')` больше не null, `toolRepeatKind` → `'shell'`, семантика `repeat_share` теперь включает shell), новые файлы `run-progress.test.mjs` (mkdtemp + `git init`) и точечные кейсы в `repeat-tracker/tools/loop/session/cli`-тестах + инвариант-тест правил в `src/web/phase-prompt.test.mjs`. Проверки: `pnpm build && pnpm test` (полный прогон).
Риски: R1 склейка разных `node -e` одним ключом (порог 3, предупреждение, не блок); R2 сдвиг цифр `repeat_share` в существующих тестах/`/analyze` (документируется); R3 +≤800 байт контекста на ран; R4 автокоммит в fail-пути (только code, фильтр `backlog/`, без `-A`, ошибки гасятся); R5 `now()`-хук необязателен, CLI его не передаёт; R6 усечение таймаута убивает долгую команду раньше — осознанный обмен (wall-time убил бы её без отчёта); R7 маркер текста предупреждения фиксируется в одной точке (`clampShellTimeout`) и проверяется тестом (lesson-76).
Файлов в плане: 9 (7 в `src/agent/`, 3 шаблона + doc-10).
---
author: @agent
created: 2026-10-30 22:11
---
Фаза code не удалась (код выхода 1): cli.ts×7, payload последнего запроса=648178 байт (макс 648178), usage={"input_tokens":10618337,"output_tokens":34071,"cache_read_input_tokens":10030080,"total_tokens":10652408,"reasoning_tokens":6374} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 22:27
---
Фаза 3 (Code) выполнена по плану. Коммит: e5acbcd «feat: VL-254 — guard shell-повторов, мягкий бюджет wall-time, прогресс до обрыва».
Изменено:
- `src/agent/repeat-tracker.ts` — `RepeatKind: 'shell'`, `REPEAT_SHELL_LIMIT_DEFAULT=3`, чистая `shellCommandKey()` (первый сегмент цепочки + подкоманда + флаги + значимые пути; `node -e/--eval/-p` и `--input-type=module -e` → `node-e|<FNV-1a первых 200 символов>`, модуль остался без Node-API), `toolRepeatTarget`/`toolRepeatKind` для `run_shell_command`, поля `shell_tool_calls`/`shell_repeat_calls`/`shell_share`/`shell_top` в `RepeatStats` и `analyzeToolRepeats` (общий помощник `topRepeats`/`shareOf`), порог `shellLimit` в `createRepeatGuard`.
- `src/agent/loop.ts` — тест-хук `now?: () => number` (детерминированные тесты времени, дефолт `Date.now`), hoist `maxPayloadLimit`/`payloadWarn` до цикла, экспортируемая `wallTimeWarnText()` («Осталось N с из M», payload, порог компакта), мягкий guard 70%/90% с дедупом по `Set` и инъекцией ОДНИМ user-сообщением на границе хода (lesson-91), `failWithProgress()` на путях wall-time и max-requests (LoopResult.progress), проброс `remainingWallTimeMs` в ctx handler'ов, `repeatShellLimit` в LoopLimits.
- `src/agent/tools.ts` — `ToolHandlerContext.remainingWallTimeMs`, чистая `clampShellTimeout()` (усечение до остатка, минимум 1000 мс, маркер «превышает остаток бюджета фазы»), предупреждение — первой строкой tool-вывода.
- `src/agent/run-progress.ts` (новый) — `buildRunProgress` (блок «Сделано»/«Осталось» из путей edit/write_file и последней реплики модели), `committablePaths` (фильтр `backlog/`, `--untracked-files=all`), `commitProgressChanges` (`git add -u` + явные пути, без `-A`, `--no-verify`, ошибки → console.error), `appendCommitToProgress`.
- `src/agent/cli.ts` — экспортируемая `recordRunProgress()` (WIP-коммит только для фазы code, `run_progress` в мету, `addComment` в задачу через `VIBELOG_CWD`), вызов после блока учёта токенов; shell-повторы в итоговой stderr-диагностике.
- `src/agent/session.ts` — поле меты `SessionMeta.run_progress`.
- Промпты: `templates/phases/phase-code.md` (правило бюджета: остаток < 5 мин → без полного прогона, прогресс комментарием), `templates/phases/phase-plan.md` и `templates/agent-prompt.md` (project_map/read_file каталога вместо `node -e`-обходчиков; read_file с диапазоном вместо sed/node -e).
Тесты (новые/обновлённые): `repeat-tracker.test.mjs` (shell-скелет, AC1-фикстура node -e ×3), `run-progress.test.mjs` (билдер + git в mkdtemp), `run-progress-cli.test.mjs` (AC4 сквозной: мета + комментарий задачи + WIP-коммит, план не коммитит), `tools.test.mjs` (clampShellTimeout: 1500 с при остатке 5 с), `loop.test.mjs` (AC2 предупреждения 70%/90% без sleep, AC4 progress по wall-time/max-requests, AC1 guard shell в loop, проброс остатка в ctx), `phase-prompt.test.mjs` (инвариант трёх правил). Попутно исправлена env-изоляция в `src/mcp/server.test.mjs` (VL-254: `VIBELOG_RUN_PHASE` рана протекал в тест и подменял фазу из меты — тест падал вне зависимости от правок).
Проверки: `pnpm build` + полный `npx vitest run` — 107 файлов, 1944 passed, 4 skipped, падений нет (полный прогон, без --exclude/--skip).
Что осталось: **doc-10 не обновлён** — по правилу фазы Code («документы backlog/docs в Фазе 3 НЕ обновляй — итоговую документацию пишет Фаза Close после слияния»); AC5 закрыт частично (только «pnpm test зелёный»), поэтому пункт не отмечен. DoD «Документация обновлена» — за фазой Close (подраздел doc-10 «Бюджет времени и прогресс до обрыва»: пороги 70%/90%, усечение timeout_ms, shell_* в repeat_stats, run_progress + автокоммит WIP).
---
author: @agent
created: 2026-10-30 22:46
---
Фаза Close выполнена. Ветка `vb/vl-254` слита в master (`git merge --no-ff`, коммит 65ad3fe; 1 коммит кода e5acbcd, 16 файлов), worktree `.vibelog/worktrees/vl-254` удалена, ветка `vb/vl-254` удалена.
**Проверки после merge (из главного cwd):** `pnpm build` — чисто; ранний точечный фильтр по diff'у (repeat-tracker, run-progress, run-progress-cli, tools, loop, phase-prompt) — 6 файлов, 279 passed; полный `npx vitest run` — **108 файлов, 1975 passed, 4 skipped, падений нет** (один полный прогон за фазу, без --exclude/--skip).
**Документация (AC5 / DoD 2 закрыты в этой фазе):** doc-10 получил новый раздел §6.6 «Бюджет времени, shell-повторы и прогресс до обрыва (VL-254)» — пороги 70%/90%, текст `wallTimeWarnText` с payload_bytes, `clampShellTimeout` и маркер предупреждения, `shellCommandKey`/shell_* в `repeat_stats`, `run-progress` (мета `run_progress`, комментарий задачи, WIP-коммит фазы code), правила промптов + перечень тестов. CHANGELOG.md — запись в Unreleased/«Исправлено» (коммит 1f61ce7).
**Lessons:** lesson-122 («Инжектируй агенту предупреждение об остатке wall-time на 70% и 90% бюджета…»), lesson-123 («Ключ guard'а повторов для shell строй по скелету команды…») — созданы, наполнены и связаны с VL-254; refs и lessons закоммичены (86a2efe).
DoD: «Тесты проходят» — полный прогон зелёный; «Документация обновлена» — doc-10 §6.6 + CHANGELOG; «Нет регрессий» — полный прогон после merge без падений (попутно в Code исправлена env-изоляция `src/mcp/server.test.mjs`: `VIBELOG_RUN_PHASE` протекал из рана).
---
<!-- COMMENTS:END -->