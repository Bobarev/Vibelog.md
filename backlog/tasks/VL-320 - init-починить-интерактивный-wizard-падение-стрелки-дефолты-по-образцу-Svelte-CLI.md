---
id: VL-320
title: 'init: починить интерактивный wizard (падение, стрелки, дефолты) по образцу Svelte CLI'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 17:33'
updated_date: '2026-11-03 19:00'
due_date: ''
labels:
  - cli
  - init
  - wizard
  - ux
dependencies: []
milestone: ''
references:
  - ref-25
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/cli/prompt.ts
  - src/cli/prompt.test.mjs
  - src/cli/commands/init-wizard.ts
  - src/cli/commands/init.ts
  - src/cli/init-wizard.test.mjs
  - src/core/setup.ts
  - src/core/setup.test.mjs
lessons:
  - lesson-186
  - lesson-187
  - lesson-188
  - lesson-167
  - lesson-171
  - lesson-195
token_usage:
  input: 11175525
  output: 110337
  cache: 10122752
  total: 11285862
  requests: 175
  duration_ms: 2922245
  reasoning: 67056
  by_phase:
    plan:
      input: 2421903
      output: 28963
      cache: 2180096
      requests: 34
    code:
      input: 4973611
      output: 57890
      cache: 4621824
      requests: 67
    close:
      input: 3780011
      output: 23484
      cache: 3320832
      requests: 74
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Wizard `vibelog init`, созданный в VL-210, нерабочий. Проверено вживую на новом проекте.

## Воспроизведение

```
$ vibelog init
ℹ Режим: fresh. Настройка нового проекта Vibelog.md.
Имя проекта [templares]: Vibelog Templates
Prefix задач [VL]: VT
ℹ Агенты (space — отметить, ↑/↓ — выбор, Enter — подтвердить):
❯ [x] vb (встроенный Vibelog-агент, нужен LLM)

Где хранить API-ключи и токены (env|settings|both) [env]: %   ← упал
```

## Дефекты

1. **Падение на шаге «Где хранить API-ключи»** — после ввода/Enter процесс аварийно завершается (нужен стек-трейс; вероятно, не-TTY/некорректный readline-переход после мультивыбора).
2. **Prefix задач не выводится из имени проекта** — при имени «Vibelog Templates» предложен `VL` (дефолт из конфига), а не `VT`. Нужен автодефолт: инициалы слов имени проекта (Vibelog Templates → VT), с fallback на `VL`/текущий.
3. **Мультивыбор агентов сломан:**
   - `vb` показан отмеченным, хотя по спецификации VL-210 он по умолчанию НЕ отмечен (и других агентов не обнаружено — значит должен быть единственный неотмеченный пункт).
   - Стрелки ↑/↓ не работают, курсор отрисован на другой строке, чем активный пункт (рассинхрон отрисовки и состояния).
4. **Флаг `--web` игнорируется** — запуск `vibelog init --web` всё равно стартует консольный wizard вместо web-режима `/setup`.

## Ориентация на эталон

Референс ref-25 (Svelte CLI, `packages/sv/src/cli/create.ts`) — образец качественного TUI: `@clack/prompts` + `p.group` (шаги с зависимостями), `p.select`/`p.multiselect` с `initialValue` и `hint`, `p.isCancel` после каждого промпта, `p.cancel` + `exit(0)` на отмене, `p.note` с итоговыми шагами, флаги полностью выключают соответствующий промпт, валидация флагов через valibot/commander `.choices()`/`.conflicts()`.

## Цель

Переписать интерактивный слой `vibelog init` по образцу Svelte CLI: предсказуемая отрисовка, работающие стрелки/space, корректная отмена, дефолты из контекста, отсутствие падений, работающий `--web`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vibelog init` проходит все шаги fresh-режима без падений (в т.ч. шаг «Где хранить API-ключи»); при любом сбое — понятное сообщение, а не аварийное завершение
- [x] #2 Prefix задач предлагается по умолчанию из имени проекта (Vibelog Templates → VT); при невозможности вывести — fallback на текущий/`VL`
- [x] #3 Мультивыбор агентов: стрелки ↑/↓ перемещают активный пункт, space переключает галочку, Enter подтверждает; отрисовка курсора совпадает с активным пунктом
- [x] #4 `vb` по умолчанию НЕ отмечен; отмеченными по умолчанию идут только обнаруженные внешние агенты (.qwen/, .opencode/); необнаруженные пункты скрыты
- [x] #5 Ctrl+C на любом шаге — корректная отмена с сообщением и кодом выхода 0, без стек-трейса
- [x] #6 `vibelog init --web` запускает web-режим /setup, а не консольный wizard
- [x] #7 Поведение в не-TTY (пайп/CI): wizard не падает — берёт дефолты либо требует явные флаги
- [x] #8 Добавлены тесты на интерактивный слой (навигация/переключение/отмена/дефолт prefix) и на разбор флага --web
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (по коду, без запуска)

**Дефект 1 — «падение» на шаге секретов.** `createPrompter()` (init-wizard.ts:172) создаёт ОДИН `readline.Interface` на весь wizard. `chooseAgents` в TTY-ветке (init-wizard.ts:255-305) делает `stdin.setRawMode(true)`, `stdin.resume()`, `stdin.setEncoding('utf8')`, а на выходе — `stdin.pause()` + `setRawMode(false)`. После `pause()` readline-интерфейс больше не получает данные, а держать event loop нечему → Node завершает процесс посреди следующего `rl.question` (в выводе виден «оборванный» промпт `... [env]: %`). Это не исключение, поэтому и нет стек-трейса. Дополнительно `setEncoding('utf8')` на общем stdin меняет контракт readline.

**Дефект 3 — мультивыбор.** `render()` (init-wizard.ts:236-247) на каждой итерации пишет `\x1b[?25l` … `\x1b[?25h` (курсор мигает/сбивается), `clear()` поднимается на `items.length` строк, но заголовок печатается через `console.log` (другой буфер, чем `process.stdout.write`), а disabled-пункты («Скоро») не пропускаются навигацией — курсор может стоять на невыбираемой строке. `initial` берётся из `state.agents.filter(a => a.enabled)`, т.е. vb не отмечен — но отрисовка/состояние расходятся, поэтому пользователь видит `[x] vb`.

**Дефект 4 — `--web`.** `interactive` (init.ts:58-63) вычисляется без учёта `flags.web`, поэтому в TTY сначала полностью проходит консольный wizard, и только после `applySetup` + `runChecks` (init.ts:148) стартует web-сервер. Флаг фактически не выключает промпты.

**Дефект 2 — prefix.** `runWizard` (init-wizard.ts:333) берёт `state.prefix` (для fresh это всегда `'VL'` из `readSetupState`, setup.ts:155) — вывода из имени проекта нет нигде.

## Архитектурное решение

Свой TUI-слой без внешних зависимостей (проект держит zero runtime deps — см. args.ts:8; `@clack/prompts` из ref-25 не подключаем, переносим только модель поведения: `p.group`-подобная последовательность шагов, `initialValue`/`hint`, `isCancel` после каждого промпта, `cancel` + exit 0).

## Файлы и правки

### 1. `src/cli/prompt.ts` (новый, ~200 строк)
Единый интерактивный слой, инъектируемые потоки (для тестов):
- `export class PromptCancelledError extends Error` — отмена (Ctrl+C / Esc).
- `export function isInteractive(input?, output?): boolean` — оба потока TTY.
- `export interface PromptSession { askText(q, def, validate?): Promise<string>; askConfirm(q, def): Promise<boolean>; askSelect<T>(q, options: {value,label,hint?,disabled?}[], initialIndex?): Promise<T>; askMultiselect<T>(q, items: {value,label,hint?,disabled?}[], initial: T[]): Promise<T[]>; close(): void }`
- `export function createPromptSession(opts?: {input?, output?}): PromptSession`
  - **Один** `readline.Interface` на сессию; `askText`/`askConfirm` — через `rl.question` с валидацией в цикле (невалидный ввод → `printError` + повтор).
  - `askSelect`/`askMultiselect` — raw-mode на том же stdin: перед входом `rl.pause()`, после выхода `rl.resume()`; `setRawMode(true)` → в `finally` `setRawMode(false)`; `setEncoding` НЕ вызывать (читать `Buffer`, декодировать `toString('utf8')`).
  - Отрисовка списка: один блок из N строк, курсор скрыт на время блока (`\x1b[?25l` один раз при входе, `\x1b[?25h` в `finally`); перерисовка = `\x1b[<N>A` + перерисовка всех N строк с `\r\x1b[2K`; активная строка помечается `❯` и рисуется инвертированным цветом (`\x1b[7m…\x1b[0m`) — курсор визуально всегда на активном пункте.
  - Навигация: `↑`/`↓` (`\u001b[A`/`\u001b[B`) пропускают `disabled`-пункты (по кругу); `space` переключает только не-disabled; `Enter` (`\r`/`\n`) подтверждает; `Ctrl+C` (`\u0003`) и `Esc` (`\u001b`) → `PromptCancelledError`.
  - Не-TTY: `askText` → `def`, `askConfirm` → `def`, `askSelect` → значение по `initialIndex`, `askMultiselect` → `initial` (никаких падений, AC7).
- JSDoc на русском, комментарии «почему» (почему один readline, почему pause/resume, почему не setEncoding).

### 2. `src/core/setup.ts` — `derivePrefix`
Добавить рядом с `validatePrefix` (setup.ts:263):
```ts
export function derivePrefix(projectName: string): string | null
```
- Разбить по не-буквам/цифрам, взять первые символы слов, uppercase, отбросить пустое; `Vibelog Templates` → `VT`, `api` → `A` (одно слово — первые 2 буквы? нет: одно слово → первые 2 символа, если длина ≥2, иначе 1), `My Cool App` → `MCA`.
- Результат прогнать через `validatePrefix`; невалиден/пусто → `null` (fallback на текущий/`VL`).

### 3. `src/cli/commands/init-wizard.ts` — переписать интерактив
- Удалить `createPrompter` (172-204) и TTY-ветку `chooseAgents` (206-305); `chooseAgents` заменить на вызов `session.askMultiselect` с `items = state.agents` (label из `AGENT_LABELS`, `hint = reason`, `disabled = Boolean(reason)`), `initial = state.agents.filter(a => a.enabled).map(a => a.id)` — vb остаётся неотмеченным (AC4), необнаруженные агенты в `state.agents` отсутствуют (setup.ts:201-215) — значит скрыты.
- `runWizard`: `const session = createPromptSession()` + `try/finally session.close()`; каждый шаг — `askText`/`askConfirm`/`askSelect`; после каждого промпта отмена ловится в одном `catch (err) { if (err instanceof PromptCancelledError) throw err; … }` — наверх пробрасываем `PromptCancelledError`, обрабатывает `init.ts`.
- Prefix: `const defPrefix = derivePrefix(projectName) ?? state.prefix;` — вопрос `Prefix задач` с этим дефолтом (AC2).
- `defaultAgent` — через `askSelect` (варианты = выбранные агенты), а не свободный текст.
- `secretsLocation` — через `askSelect` (`env`/`settings`/`both`, `initialValue: 'env'`) вместо текстового ввода с парсингом — убирает шаг, на котором падало.
- `answersFromFlags`: при `mode === 'fresh'` и отсутствии `--prefix` — `prefix = derivePrefix(projectName) ?? state.prefix` (согласованность интерактива и `--yes`).

### 4. `src/cli/commands/init.ts` — `--web` и отмена
- Вынести web-ветку (148-171) в `async function runWebWizard(cwd, flags): Promise<void>` и вызвать её **в начале** `runInit` — сразу после вычисления `modeOverride`/`force`, до проверки «уже инициализирован» и до `interactive` (AC6): `if (flags.web === true) { await runWebWizard(cwd, flags); return; }`. Внутри — прежняя логика (порт из config, `resolveWebHost`, `startWebServer(..., '#/setup')`, сообщение), ошибка → `printError` + `process.exitCode = 1`.
- В `catch` вокруг `runWizard`: `if (err instanceof PromptCancelledError) { printInfo('Отменено. Настройки не изменены.'); process.exitCode = 0; return; }` (AC5).
- `interactive` дополнить `&& flags.web !== true` (страховка).

### 5. Тесты
- `src/cli/prompt.test.mjs` (новый): `createPromptSession({input: PassThrough, output: PassThrough})` — навигация `↓`/`↑` меняет активный пункт (проверять по последнему кадру вывода: `❯` на нужной строке), `space` переключает галочку, `Enter` резолвит выбор, `Ctrl+C` → `PromptCancelledError`, `disabled`-пункт пропускается навигацией и не переключается, не-TTY → дефолты. Каталог — `mkdtempSync` (AGENTS.md).
- `src/core/setup.test.mjs`: `derivePrefix` — `Vibelog Templates`→`VT`, `My Cool App`→`MCA`, `api`→`AP`, `''`/`123`→`null`.
- `src/cli/init-wizard.test.mjs`: `init --yes` без `--prefix` в каталоге с именем-проектом → `task_prefix` выведен из имени; `init --web` (spawnSync, `timeout: 8000`) — в выводе есть «Веб-мастер настройки» и НЕТ «Режим: fresh» (сервер держит процесс — тест опирается на таймаут, проверяя stdout).
- Все спавны — через `testSpawnEnv()` (VL-286).

### 6. Документация
`backlog/docs/doc-7-CLI-справочник-Vibelogmd.md`, раздел `## init` (строка 19): описать автодефолт prefix из имени проекта, приоритет `--web` (сразу web-мастер, без консольных вопросов), поведение Ctrl+C (отмена, код 0), не-TTY (дефолты). README не трогать (лимит 150 строк, тест readme-standard).

## Порядок действий
1. `src/cli/prompt.ts` + `src/cli/prompt.test.mjs` → `pnpm build && pnpm test:fast src/cli/prompt.test.mjs`.
2. `derivePrefix` в `src/core/setup.ts` + тест.
3. Переписать `init-wizard.ts` на `createPromptSession`.
4. `init.ts`: `runWebWizard` первым, обработка `PromptCancelledError`.
5. Тесты init-wizard, документация.
6. `pnpm build && pnpm test` (полный прогон — DoD).

## Проверка
```bash
pnpm build && pnpm test:fast src/cli/prompt.test.mjs src/core/setup.test.mjs src/cli/init-wizard.test.mjs
pnpm test   # полный прогон перед DoD
```
Ручная проверка в TTY: `vibelog init` в пустом каталоге — все шаги, стрелки/space, Ctrl+C на каждом шаге, `vibelog init --web`.

## Риски
- **Смена дефолта prefix в non-interactive** (`--yes` без `--prefix`) может затронуть чужие тесты/скрипты: митигация — применять только при `mode === 'fresh'`, прогнать полный `pnpm test`; при падении — оставить вывод prefix только в интерактиве.
- **readline + raw-mode на одном stdin**: `rl.pause()`/`rl.resume()` вокруг raw-блоков; если readline всё равно конфликтует — перейти на полностью ручной ввод текста в raw-mode (без readline) внутри `prompt.ts`, интерфейс сессии не меняется.
- **Тест `--web`** опирается на таймаут блокирующего сервера — флейки при медленном старте; при нестабильности заменить на юнит-тест `isWebMode(flags)` + проверку, что `runInit` с `--web` не печатает «Режим: fresh».
- **Отрисовка в терминалах без ANSI** (CI-логи): при `!isInteractive` raw-ветка не используется вовсе.
- Совместимость с Backlog.md не затрагивается (внутренний CLI-слой).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 18:03
---
Фаза 2 (Plan) выполнена. Тип: bug.
Диагноз по коду (без запуска):
1. Падение на шаге секретов — `createPrompter` держит один readline на весь wizard, а TTY-ветка `chooseAgents` делает `stdin.pause()` + `setRawMode(false)` + `setEncoding('utf8')` на общем stdin; после `pause()` readline не получает данные и event loop пуст → процесс завершается посреди следующего `rl.question` (поэтому нет стек-трейса).
2. Prefix — `runWizard` берёт `state.prefix`, для fresh это всегда `'VL'`; вывода из имени проекта нет нигде.
3. Мультивыбор — `render()` дёргает `\x1b[?25l`/`\x1b[?25h` на каждой итерации, `clear()` считает строки без учёта заголовка (console.log vs stdout.write), disabled-пункты не пропускаются навигацией → рассинхрон курсора и состояния.
4. `--web` — `interactive` вычисляется без учёта флага, web-сервер стартует только после полного консольного wizard + applySetup + runChecks.
План записан в задачу: 6 файлов — новый `src/cli/prompt.ts` (единый интерактивный слой: PromptCancelledError, isInteractive, createPromptSession с askText/askConfirm/askSelect/askMultiselect, один readline + pause/resume вокруг raw-блоков, инверсная подсветка активной строки, пропуск disabled, не-TTY → дефолты), `src/core/setup.ts` (+`derivePrefix`: Vibelog Templates → VT, fallback null), перепись интерактива `src/cli/commands/init-wizard.ts` (мультивыбор агентов с vb неотмеченным, prefix из имени, secretsLocation через select), `src/cli/commands/init.ts` (web-ветка первой строкой runInit, обработка отмены с кодом 0), тесты (`src/cli/prompt.test.mjs` новый, `src/core/setup.test.mjs`, `src/cli/init-wizard.test.mjs`), документация — doc-7 раздел `## init` (README не трогаем: лимит 150 строк).
Решение: `@clack/prompts` из ref-25 не подключаем (zero runtime deps проекта) — переносим модель поведения (initialValue/hint, isCancel после каждого промпта, cancel + exit 0, флаги выключают промпт).
Риски: смена дефолта prefix в non-interactive (`--yes` без `--prefix`) может затронуть чужие тесты — митигация: только при `mode === 'fresh'` + полный `pnpm test`; возможный конфликт readline и raw-mode на одном stdin — резервный вариант «ручной ввод без readline» внутри prompt.ts; тест `--web` опирается на таймаут блокирующего сервера — при флейках заменить на юнит-проверку отсутствия «Режим: fresh».
---
author: @agent
created: 2026-11-03 18:33
---
Фаза code не удалась (код выхода 1): окировок=0, payload последнего запроса=411200 байт (макс 411200), usage={"input_tokens":4062682,"output_tokens":34053,"cache_read_input_tokens":3750400,"total_tokens":4096735,"reasoning_tokens":15841} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 18:41
---
Фаза 3 (Code) выполнена. Коммит e0423ed.
Изменено (7 файлов):
- `src/cli/prompt.ts` (новый) — единый интерактивный слой: `PromptCancelledError`, `isInteractive`, `createPromptSession` с `askText`/`askConfirm`/`askSelect`/`askMultiselect`. Readline полностью убран (главная причина падения): один raw-mode обработчик stdin, Buffer декодируется вручную (без `setEncoding`), восстановление режима в `finally`, списки рисуются блоком с перерисовкой `\x1b[NA` и инверсной подсветкой активной строки, disabled-пункты пропускаются навигацией, Ctrl+C/Esc → отмена, не-TTY → дефолты.
- `src/cli/commands/init-wizard.ts` — интерактив переведён на `createPromptSession`; мультивыбор агентов (`vb` не отмечен: initial = `state.agents.filter(a => a.enabled)`; необнаруженные агенты отсутствуют в состоянии — скрыты); prefix выводится из имени проекта; `defaultAgent` и `secretsLocation` — через список выбора вместо текстового ввода; удалены `createPrompter` и старый raw-mode `chooseAgents`.
- `src/cli/commands/init.ts` — `--web` обрабатывается в начале `runInit` (web-мастер `#/setup` вместо консольного wizard), `PromptCancelledError` → «Отменено. Настройки не изменены.» с кодом 0; `answersFromFlags` при fresh без `--prefix` выводит prefix из имени проекта; `runWebWizard` принимает `--port`/`--no-open` (нужны тестам и CI).
- `src/core/setup.ts` — `derivePrefix` (Vibelog Templates → VT, My Cool App → MCA, api → AP, мусор → null → fallback на текущий/`VL`).
- `src/cli/prompt.test.mjs` (новый, 12 тестов) — навигация ↓/↑, space, Enter, disabled-пропуск, снятие галочки, Ctrl+C/Esc, валидация в цикле, дефолты в не-TTY.
- `src/core/setup.test.mjs` — кейсы `derivePrefix`.
- `src/cli/init-wizard.test.mjs` — prefix из имени проекта, приоритет `--prefix`, `init --web` запускает web-мастер и НЕ печатает «Режим: fresh».
Проверки: `pnpm build` — ok; полный `pnpm test` — 161 файл / 3048 тестов passed, 4 skipped (пропуски — существующие `it.skip` в `src/core/frontmatter.test.mjs`, к задаче не относятся). Первый полный прогон дал одно падение `src/web/orchestrator.test.mjs` (assert про `token_usage` в коммите) — изолированный прогон файла: 88/88 passed, при повторном полном прогоне — зелёный: флейк из-за параллельного прогона в другом worktree, к диффу VL-320 не относится.
Урок: создан и связан `lesson-195` (один владелец stdin на интерактивную сессию; readline + raw-mode = тихое падение процесса).
Не сделано в Code (по правилам фазы): обновление `backlog/docs/doc-7` — документацию пишет Фаза Close.
---
author: @agent
created: 2026-11-03 18:42
---
Повтор завершения фазы Code: отчёт о реализации уже записан выше (коммит e0423ed, 7 файлов, полный pnpm test — 161 файл / 3048 passed, 4 существующих skip). Статус переводится в Review с явной фазой code (первый вызов шёл с метой фазы plan, из-за чего переход Planned → Review не применился).
---
author: @agent
created: 2026-11-03 18:47
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Review
AC отмечено: 8 из 8
DoD отмечено: 2 из 3
DoD не отмечены (1): 2. Документация обновлена
Файлы (7): src/cli/prompt.ts, src/cli/prompt.test.mjs, src/cli/commands/init-wizard.ts, src/cli/commands/init.ts, src/cli/init-wizard.test.mjs, src/core/setup.ts, src/core/setup.test.mjs
Фрагмент плана: ## Диагноз (по коду, без запуска) **Дефект 1 — «падение» на шаге секретов.** `createPrompter()` (init-wizard.ts:172) создаёт ОДИН `readline.Interface` на весь wizard. `chooseAgents` в TTY-ветке (init-wizard.ts:255-305) делает `stdin.setRawMode(true)`, `stdin.resume()`, `stdin.setEncoding('utf8')`, а…
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
---
author: @agent
created: 2026-11-03 18:58
---
Фаза close не удалась (код выхода 1): локировок=0, payload последнего запроса=253624 байт (макс 253624), usage={"input_tokens":1632978,"output_tokens":10829,"cache_read_input_tokens":1415680,"total_tokens":1643807,"reasoning_tokens":5744} — статус возвращён к Review.
---
author: @agent
created: 2026-11-03 18:59
---
Фаза Close выполнена. Ветка vb/vl-320 слита в master (1 коммит: e0423ed, merge 5e78191), worktree удалена (force — в ней был только untracked-симлинк backlog/references/data), ветка vb/vl-320 удалена.
Проверки после merge: `pnpm build` — успешно; ранний точечный прогон затронутых diff'ом тестов (`src/cli/prompt.test.mjs`, `src/core/setup.test.mjs`, `src/cli/init-wizard.test.mjs`) — 41 тест зелёный; полный `pnpm test` — 161 файл, 3048 тестов passed, 4 skipped, падений нет (повторных прогонов не было).
DoD: 1. Тесты проходят — да (полный прогон); 2. Документация обновлена — да (doc-7 раздел `init`: автодефолт prefix из имени проекта, приоритет `--web`, поведение Ctrl+C/Esc, не-TTY-дефолты; CHANGELOG.md — запись в Unreleased/Исправлено); 3. Нет регрессий — да.
Коммиты: c10ce6b — refs (ref-25) и lesson-195; 93e2825 — документация и CHANGELOG.
Замечание для будущих задач: в описании VL-321 указано, что `@clack/prompts` добавляется в dependencies в VL-320 — фактически VL-320 реализован на собственном TUI-слое без внешних зависимостей (`src/cli/prompt.ts`, zero deps), поэтому VL-321 не сможет «переиспользовать» пакет из VL-320 и должен вводить его сам.
---
<!-- COMMENTS:END -->