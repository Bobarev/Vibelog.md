---
id: VL-284
title: '[авто] close VL-280: 5 попыток в close без прогресса: цикл edit tools.ts + pnpm build, payload зап...'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 21:05'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - auto-bug
  - close
dependencies: []
milestone: v1.11
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/repeat-tracker.ts
  - src/agent/loop.ts
  - src/agent/cli.ts
  - src/core/supervisor-config.ts
  - src/agent/repeat-tracker.test.mjs
  - src/agent/loop.test.mjs
  - src/core/supervisor-config.test.mjs
  - src/web/supervisor-healing.test.mjs
  - src/web/phase-prompt.test.mjs
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - README.md
lessons:
  - lesson-152
  - lesson-153
token_usage:
  input: 16860636
  output: 125166
  cache: 16565248
  total: 16985802
  requests: 179
  duration_ms: 1458000
  reasoning: 80069
  by_phase:
    plan:
      input: 4799138
      output: 90053
      cache: 4630528
      requests: 68
    code:
      input: 10011512
      output: 25649
      cache: 9938944
      requests: 73
    close:
      input: 2049986
      output: 9464
      cache: 1995776
      requests: 38
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Причина
5 попыток в close без прогресса: цикл edit tools.ts + pnpm build, payload запроса в максимуме (508387 байт), ~6.2M токенов. Повтор воспроизведёт payload-лимит; требуется пересмотр объёма/декомпозиция close-фазы, а не перезапуск.

## Последние строки лога
```
[vibelog-agent] инструмент: edit
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: search_files
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] повтор обращения: Ты уже обращался к run_shell_command|cd /Users/bob/Dev/ton/ai/Vibelog.md /Users/bob/Dev/ton/ai/Vibelog.md 4 раз — используй ранее полученный результат (используй её вывод; для обзора дерева/модулей — project_map или read_file каталога), не повторяй вызов.
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] повтор обращения: Ты уже обращался к run_shell_command|pnpm build 3 раз — используй ранее полученный результат (используй её вывод; для обзора дерева/модулей — project_map или read_file каталога), не повторяй вызов.
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: run_shell_command
[vibelog-agent] инструмент: lesson_search_lessons
[vibelog-agent] инструмент: lesson_search_lessons
[vibelog-agent] инструмент: lesson_create
[vibelog-agent] инструмент: lesson_link
[vibelog-agent] инструмент: backlog_finish_phase
[vibelog-agent] фаза: запросов=68 (LLM-запросы/ходы модели), tool-calls=80 (лимит 100, счётчик рана — VL-221), повторов=10/80 (13%), shell-повторов=5/15 (33%), топ-повторов=edit|src/mcp/tools.ts×5, run_shell_command|cd /Users/bob/Dev/ton/ai/Vibelog.md /Users/bob/Dev/ton/ai/Vibelog.md×4, run_shell_command|pnpm build×3, payload последнего запроса=508387 байт (макс 508387), usage={"input_tokens":6207794,"output_tokens":41301,"cache_read_input_tokens":6089216,"total_tokens":6249095,"reasoning_tokens":18817}
```

## Сессия
agent-1793555721955 — .vibelog/agent-sessions/agent-1793555721955.jsonl

## Цепочка лечения
- попытка 1: l2:bug

## Исходная задача
VL-280: Классификация lessons и генерация задач техдолга из уроков-обходов (workaround)

<!-- auto-bug: VL-280|3b103e9f -->
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В `src/agent/repeat-tracker.ts` write-повторы (`edit`/`write_file` по одному пути) учитываются guard'ом: `RepeatGuardOptions.writeLimit` (дефолт `REPEAT_WRITE_LIMIT_DEFAULT = 6`) даёт модели предупреждение, а не только метрику
- [x] #2 Guard повторов эскалирует: после `blockMultiplier`× порога (дефолт 2×; для write — `REPEAT_WRITE_BLOCK_DEFAULT = 8`) вызов НЕ выполняется, модели уходит tool-результат-директива с маркером «Повтор заблокирован» и следующим шагом (по образцу `loopDetectionDirective`)
- [x] #3 Блокировки ограничены `REPEAT_BLOCK_MAX_PER_RUN` (дефолт 5) за ран; `repeatGuardDisabled` по-прежнему полностью выключает guard (fail-open), `repeat_stats` считается всегда
- [x] #4 Шаблоны `templates/phases/phase-close.md` и `phase-close-worktree.md` содержат правило «Close не правит код (упавшая сборка/тесты → `aborted`), `pnpm build` один раз за фазу»
- [x] #5 Тесты: новые кейсы в `src/agent/repeat-tracker.test.mjs` (write-порог, `shouldBlock` после эскалации, write-block порог), `src/agent/loop.test.mjs` (заблокированный вызов: handler не вызван, tool-результат с директивой, кап блокировок), `src/web/phase-prompt.test.mjs` (маркеры новых правил close); полный `pnpm test` зелёный
- [x] #6 "В `DEFAULT_HEAL_RULES` (`src/core/supervisor-config.ts`) добавлено правило `repeat-loop-stuck` (строже `repeat-loop`: `repeat_share_min` 0.3 / `repeat_calls_min` 15) с действием `bug` — зацикленный ран не перезапускается (повтор воспроизводит payload-лимит), а сразу становится авто-багом; тест `supervisor-config.test.mjs` на состав дефолтных правил обновлён"
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (по транскрипту и коду)

Инцидент VL-280-close: 68 LLM-запросов, 80 tool-calls, payload 508387 байт, 6.2M токенов, 5 попыток close без прогресса. Топ-повторы: `edit|src/mcp/tools.ts`×5, `run_shell_command|cd …`×4, `pnpm build`×3.

Два механизма, которые НЕ сработали:

1. **Guard повторов (`createRepeatGuard`, VL-229/VL-254) write-операции не предупреждает вовсе** — `src/agent/repeat-tracker.ts:336` держит `write: 0` («0 = никогда, write только в метрике»). Именно `edit` был главным зацикленным вызовом (5×), и модель не получила ни одного предупреждения. Более того, даже сработавший guard только *советует* («используй ранее полученный результат»), а вызов всё равно выполняется — на длинном ране модель этот совет игнорирует, и payload продолжает расти за счёт новых tool-результатов и повторных правок.
2. **Фаза Close правит код** — шаблоны `templates/phases/phase-close.md` и `phase-close-worktree.md` содержат шаги 3.5/5 «сборка обязательна… если падает — `aborted`», но НЕ содержат запрета править код и НЕ ограничивают `pnpm build` одним запуском. Агент в close лечил код (`edit src/mcp/tools.ts` + `pnpm build` по кругу) вместо аварийного итога — то есть делал работу фазы Code, раздувая историю.
3. **Healing по умолчанию перезапускает зацикленный close** — `DEFAULT_HEAL_RULES` (`src/core/supervisor-config.ts:139`) для `repeat-loop` даёт `comment_and_retry`, для `no-progress` — `retry_once_then_bug`: повтор воспроизводит тот же payload-лимит (что и наблюдалось — 5 попыток).

Лечение — в рантайме агента (guard эскалирует до блокировки) + в контракте шаблонов close + в дефолтных правилах лечения. Правок кода в самом close нет — это задача фазы Code этой ветки.

## Файлы и конкретные правки

### 1. `src/agent/repeat-tracker.ts` (~360 строк)

- **`RepeatGuardOptions` (стр. 297–305)** → добавить `writeLimit?: number` (порог предупреждения для `edit`/`write_file`, дефолт `REPEAT_WRITE_LIMIT_DEFAULT = 6`).
- **Новые экспортируемые константы** рядом с `REPEAT_SHELL_LIMIT_DEFAULT` (стр. ~35–45):
  - `REPEAT_WRITE_LIMIT_DEFAULT = 6` — предупреждение (6 правок одного файла за ран: итеративная правка легитимна, 6 — уже подозрительно);
  - `REPEAT_WRITE_BLOCK_DEFAULT = 8` — блокировка;
  - `REPEAT_BLOCK_MAX_PER_RUN = 5` — жёсткий кап блокировок за ран (по образцу `REPEAT_WARN_MAX_PER_RUN` в loop.ts, чтобы сами директивы не раздували контекст).
- **Тип `RepeatKind`/докблок (стр. ~40 и ~25–40)** — обновить комментарий: write больше не «только в метрике», порог есть.
- **`createRepeatGuard` (стр. 329–359)**:
  - `limits` (стр. 330–337): `write: options.writeLimit ?? REPEAT_WRITE_LIMIT_DEFAULT`;
  - `limit <= 0` остаётся выключателем порога для конкретной категории (обратная совместимость: `writeLimit: 0` — поведение как до задачи, только метрика);
  - **эскалация**: новая чистая функция `shouldBlockRepeat(count, limit, kind)` → `count >= limit * blockMultiplier` (по умолчанию `blockMultiplier = 2`; для `write` эскалация считается отдельным порогом `writeBlockLimit = REPEAT_WRITE_BLOCK_DEFAULT`). Возвращать через расширенный интерфейс guard'а:
    - `note(name, args): string | null` — как раньше (предупреждение);
    - **новый** `shouldBlock(name, args): boolean` — «этот вызов надо заблокировать» (порог достигнут по уже накопленному счётчику, БЕЗ инкремента — инкремент делает `note`, который loop передаёт ПЕРЕД проверкой; см. п.2);
    - `blockedCount(): number` — для диагностики в stderr.
  - Блокировка доступна только для `search`/`read`/`write`/`shell` с заданным `*Block` порогом; для `read` — `REPEAT_READ_LIMIT_DEFAULT * 2`, для `search`/`shell` — `limit * 2` (никакой эскалации при `limit <= 0`).
- **Текст директивы блокировки** — новая экспортируемая функция `repeatBlockDirective(key, count, kind)`: маркер `Повтор заблокирован: <key> — <count> обращений за ран.` + следующий шаг по категории (write: «правь другой участок или зафиксируй прогресс/аварийный итог фазы»; read: «возьми нужный диапазон одним read_file»; shell: «используй ранее полученный вывод»). Формулировка не должна пересекаться с маркером loop detection (`Loop detection:`) — у них разные причины и разные тесты.

### 2. `src/agent/loop.ts` (~1013 строк)

- **`LoopLimits` (стр. 88–110)** → добавить `repeatWriteLimit?: number`, `repeatBlockMultiplier?: number`, `repeatGuardDisabled` уже есть (полное выключение, fail-open).
- **`RepetitionWarnCap` / константы (стр. 276)** → рядом `REPEAT_BLOCK_MAX_PER_RUN = 5` (или импорт из repeat-tracker — предпочтительно импорт, единая точка).
- **Создание guard'а (стр. 426–433)** → прокинуть `writeLimit: options.limits?.repeatWriteLimit ?? REPEAT_WRITE_LIMIT_DEFAULT`, `blockMultiplier`.
- **Цикл `for (const call of validCalls)` (учёт повтора — стр. ~942–958)**:
  1. вызвать `repeatGuard.note(...)` (инкремент + предупреждение) — как сейчас;
  2. **затем** `if (repeatGuard.shouldBlock(call.name, args) && blockCount < REPEAT_BLOCK_MAX_PER_RUN)` → **не выполнять handler**, `blockCount++`, `output = repeatBlockDirective(...)`, `toolError = false`, `console.error('[vibelog-agent] повтор заблокирован: …')`, и далее обычный путь `truncateToolOutput` → `onToolEnd` → `pushMessage({role:'tool', tool_call_id…})`. Парность `assistant(tool_calls)`↔`tool` обязательна — блокировка НЕ выбрасывает вызов из истории (иначе провайдер отклонит payload).
  3. Блокированный вызов попадает в блок `if (!spec)`-ветку? Нет — реализовать отдельной ветвью ДО `if (!spec)`, чтобы `idleGuard.pause()/resume()` не ломались: блокировка мгновенная, пауза не нужна, но `resume()` вызывать безопасно.
- **`repeat_stats`** — форма `RepeatStats` не меняется (метрика считается по сообщениям, блокированные вызовы в неё попадают как обычные — это верно: они были обращениями).
- **Диагностика в stderr** (стр. ~958): дополнить итоговую строку рана счётчиком `блокировок=N` (по образцу `повторов=N/M`), чтобы оркестратор видел в `logTail`.

### 3. `templates/phases/phase-close.md` (102 строки) и `templates/phases/phase-close-worktree.md` (112 строк) — шаг «Правила»

Добавить в «Правила» обоих шаблонов 2–3 буллета (одинаковые формулировки, чтобы инвариант-тест матчил один маркер в обоих файлах):

- **«Close не правит код»**: любые `edit`/`write_file` по `src/`, `web/src/`, `templates/` в этой фазе запрещены — падение сборки/тестов оформляется `aborted: true`, исправление делается новой фазой Code. (Причина — инцидент VL-284: close лечил `src/mcp/tools.ts` в цикле с `pnpm build`.)
- **«`pnpm build` — не более одного раза за фазу»** (и только если diff затронул `src/`); повторная сборка после неудачной сборки без правок кода бессмысленна — фиксируй аварийный итог.
- **«Один полный прогон тестов — один раз»** уже есть в шаге 3.5/5; в «Правилах» — ссылка на него же, без дублирования текста.

Маркеры для теста (стабильные подстроки): `Close не правит код`, `не более одного раза за фазу`.

### 4. `src/core/supervisor-config.ts` (~569 строк)

- **`DEFAULT_HEAL_RULES` (стр. 139–164)** → добавить ПЕРЕД `repeat-loop` правило застревания:
  `{ id: 'repeat-loop-stuck', when: { repeat_share_min: 0.3, repeat_calls_min: 15 }, action: 'bug' }` — «много повторов и рана уже не лечится предупреждением → авто-баг вместо перезапуска» (повтор воспроизводит payload-лимит; ровно этот сценарий и произошёл). Порядок важен: `matchHealRule` берёт ПЕРВОЕ совпадение, поэтому `repeat-loop-stuck` идёт раньше `repeat-loop` (0.25/8).
- **`KNOWN_HEAL_WHEN_KEYS`** — новых ключей не добавляем (переиспользуем существующие).

### 5. Тесты

- `src/agent/repeat-tracker.test.mjs` (18 кейсов): +порог write (6-я правка того же пути → предупреждение, 5-я — нет); `shouldBlock` для write на 8-й правке, для read на 2×5=10-м чтении; `writeLimit: 0` → предупреждений и блокировок нет (fail-open совместимость); `repeatBlockDirective` содержит маркер `Повтор заблокирован` и ключ.
- `src/agent/loop.test.mjs`: +2 кейса — (а) 8 подряд `edit` одного пути: handler вызывается 7 раз, 8-й НЕ вызван (стаб-handler считает вызовы), в сообщениях есть `role:'tool'` с директивой, парность tool_calls↔tool сохранена; (б) `repeatGuardDisabled: true` → handler вызван все 8 раз.
- `src/web/phase-prompt.test.mjs`: инвариант — маркеры `Close не правит код` и `не более одного раза за фазу` присутствуют в `templates/phases/phase-close.md` и `phase-close-worktree.md`.
- `src/core/supervisor-config.test.mjs:127`: обновить ожидаемый список id дефолтных правил → `['repeat-loop-stuck','repeat-loop','payload-limit','wall-timeout','no-progress']`.
- `src/web/supervisor-healing.test.mjs`: кейс «repeat_share 0.35 / repeat_calls 20 → правило `repeat-loop-stuck` (bug), не `repeat-loop`».

### 6. Документация

- `README.md` §«Лимиты агента» (стр. ~90) — write-порог guard'а, эскалация в блокировку, `repeatBlockMultiplier`.
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` — подраздел про guard повторов: write больше не «только метрика», эскалация и кап блокировок, `repeatBlockDirective`.
- `README.md` §«Супервизор» + `backlog/docs/doc-19` §12 — дефолтное правило `repeat-loop-stuck`.
- CHANGELOG.md (Unreleased/Исправлено) — делает фаза Close.

## Порядок действий

1. `repeat-tracker.ts`: константы → `RepeatGuardOptions.writeLimit`/`blockMultiplier` → `shouldBlock`/`repeatBlockDirective` → тесты модуля (`pnpm test:fast src/agent/repeat-tracker.test.mjs`).
2. `loop.ts`: `LoopLimits` → точка учёта повтора (note → shouldBlock → блокирующая ветвь) → диагностика → тесты loop.
3. Шаблоны close (2 файла) + инвариант в `phase-prompt.test.mjs`.
4. `supervisor-config.ts` (дефолтные правила) + тест состава правил + healing-кейс.
5. Документация (README, doc-10, doc-19).
6. `pnpm build && pnpm test` (полный прогон обязателен — правки `src/` и `templates/`).

## Как проверить

```bash
pnpm build
node --test  # нет — только vitest: 
pnpm test:fast src/agent/repeat-tracker.test.mjs   # точечно, dist уже собран
pnpm test                                          # полный прогон (build + vitest run)
```

Ручная проверка эскалации без сети: временно запустить агента с `--max-requests 3` на промпте, заставляющем править один файл, и убедиться, что в stderr появилась строка `[vibelog-agent] повтор заблокирован: edit|…`, а фаза завершилась отчётом, а не циклом.

## Риски

1. **Блокировка вызова ломает парность `assistant(tool_calls)`↔`tool`** → провайдер отклоняет payload. Митигация: блокировка реализуется как tool-результат (всегда `pushMessage({role:'tool', tool_call_id})`), а не как «пропуск» вызова.
2. **Ложные блокировки легитимной итеративной правки** (`edit` одного файла 8 раз бывает нормой при крупной правке). Митигация: порог 6/8 за РАН, кап 5 блокировок за ран, полное выключение `repeatGuardDisabled`, пороги через `LoopLimits` без новых CLI-флагов (новых флагов не добавляем — lesson-18).
3. **Правило `repeat-loop-stuck` с действием `bug` может порождать авто-баг там, где фаза просто долго шла.** Митигация: условие требует одновременно `repeat_share_min 0.3` И `repeat_calls_min 15` (AND-семантика `matchHealRule`), то есть только действительно зацикленный ран; правило упорядочено раньше `repeat-loop`.
4. **Правка шаблонов close ломает существующий инвариант-тест `phase-prompt.test.mjs`**, который матчит конкретные подстроки шаблонов (lesson-130: не проверять литеральные формулировки). Митигация: проверять короткие стабильные маркеры (`Close не правит код`), а не целые абзацы.
5. **`REPEAT_WRITE_BLOCK_DEFAULT = 8` может не спасти от payload-лимита**, если раздувает контекст не правка, а чтения/сборка — по инциденту главным был именно `edit`, но диагностика `блокировок=N` в stderr позволит проверить следующую сессию.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 21:26
---
Фаза plan не удалась (код выхода 1): |grep -n×5, payload последнего запроса=436902 байт (макс 436902), usage={"input_tokens":2295447,"output_tokens":44565,"cache_read_input_tokens":2215424,"total_tokens":2340012,"reasoning_tokens":37282} — статус возвращён к Spec.
---
author: @agent
created: 2026-11-01 21:36
---
Фаза 2 (Plan) выполнена. Тип: bug (авто-баг по close VL-280).
Диагноз: (1) guard повторов `createRepeatGuard` в `src/agent/repeat-tracker.ts:336` держал `write: 0` — `edit`/`write_file` не давали модели ни одного предупреждения, хотя главный повтор инцидента был именно `edit|src/mcp/tools.ts`×5; более того, guard только советует, вызов всё равно выполняется; (2) шаблоны close (`phase-close.md`, `phase-close-worktree.md`) не запрещают править код и не ограничивают `pnpm build` одним запуском — агент лечил `src/mcp/tools.ts` в цикле; (3) `DEFAULT_HEAL_RULES` перезапускал зацикленный close (`repeat-loop` → `comment_and_retry`), воспроизводя payload-лимит.
План (4 блока правок + тесты + доки): `repeat-tracker.ts` — порог `REPEAT_WRITE_LIMIT_DEFAULT=6`, эскалация `shouldBlock` + `repeatBlockDirective` (маркер «Повтор заблокирован»), кап `REPEAT_BLOCK_MAX_PER_RUN=5`; `loop.ts` — `LoopLimits.repeatWriteLimit/repeatBlockMultiplier`, блокирующая ветвь как tool-результат (парность `tool_calls↔tool` сохраняется), диагностика `блокировок=N`; шаблоны close — правила «Close не правит код» и «`pnpm build` не более одного раза за фазу»; `supervisor-config.ts` — дефолтное правило `repeat-loop-stuck` (0.3/15 → `bug`) перед `repeat-loop`. Тесты: `repeat-tracker`, `loop`, `phase-prompt` (инвариант маркеров), `supervisor-config` (состав правил), `supervisor-healing`.
Файлов в плане: 11 (5 src/templates, 5 тестов, README + doc-10 + doc-19).
Риски: парность `assistant(tool_calls)↔tool` при блокировке (лечится тем, что блокировка уходит tool-результатом, а не пропуском вызова); ложные блокировки легитимной итеративной правки (порог 6/8 за ран, кап 5, `repeatGuardDisabled`, без новых CLI-флагов — lesson-18); `repeat-loop-stuck` с `bug` может порождать авто-баг на долгой, но живой фазе (условие AND: share≥0.3 И calls≥15); хрупкие проверки литеральных формулировок в шаблонах (проверяются короткие стабильные маркеры — lesson-130).
Примечание: предыдущий ран Plan упал по пустому ответу провайдера на payload 436902 байт — план к тому моменту уже был записан в задачу, исследование не повторялось.
---
author: @agent
created: 2026-11-01 21:48
---
Фаза 3 (Code) выполнена. Коммит 82d2dea.
Реализовано по плану:
1. `src/agent/repeat-tracker.ts` — дефолт `write: 0` заменён на реальный порог: `REPEAT_WRITE_LIMIT_DEFAULT = 6` (предупреждение), `REPEAT_WRITE_BLOCK_DEFAULT = 8` (блокировка), `REPEAT_BLOCK_MAX_PER_RUN = 5` (кап). `RepeatGuardOptions` получил `writeLimit`/`writeBlockLimit`/`blockMultiplier`; `RepeatGuard` расширен `shouldBlock()`/`noteBlocked()`/`blockedCount()`/`countOf()`; новая чистая `repeatBlockDirective(key, count, kind)` с маркером «Повтор заблокирован» и следующим шагом по категории (write: другой участок либо аварийный итог фазы).
2. `src/agent/loop.ts` — `LoopLimits.repeatWriteLimit`/`repeatBlockMultiplier`; в точке учёта повтора после `note()` вызывается `shouldBlock()`; заблокированный вызов НЕ исполняется (handler не вызывается), а уходит tool-результатом с директивой — парность `assistant(tool_calls)↔tool` сохранена (риск 1 плана снят). Кап `REPEAT_BLOCK_MAX_PER_RUN=5` за ран. Новое поле `LoopResult.repeat_blocked`, диагностика `блокировок=N` в stderr (`src/agent/cli.ts`).
3. `templates/phases/phase-close.md` и `phase-close-worktree.md` — правила «Close не правит код» (упавшая сборка/тесты → `aborted: true`, исправление — новой фазой Code) и «Сборка проекта — не более одного раза за фазу». Формулировки без `pnpm`/VL-ID — инварианты VL-105/VL-157 в `phase-prompt.test.mjs` соблюдены.
4. `src/core/supervisor-config.ts` — перед `repeat-loop` добавлено правило `repeat-loop-stuck` (`repeat_share_min` 0.3, `repeat_calls_min` 15) с действием `bug`: зацикленный ран не перезапускается.
Тесты: `repeat-tracker.test.mjs` (+7 кейсов: write-порог 6, `writeLimit: 0` fail-open, `shouldBlock` на 8-м write / 10-м read, нулевой порог, текст директивы, дефолтные константы), `loop.test.mjs` (+3: блокировка 8-й правки с проверкой паринга и счётчика исполнений handler'а, `repeatGuardDisabled` fail-open, кап 5 блокировок), `phase-prompt.test.mjs` (+2 инварианта маркеров close), `supervisor-config.test.mjs` (состав дефолтных правил + два места с `rules.length`), `supervisor-healing.test.mjs` (+1: `repeat-loop-stuck` перехватывает 0.35/20, мягкое `repeat-loop` остаётся для 0.26/9).
Проверки: `pnpm build` — успешно; полный `pnpm test` — 128 файлов, 2406 passed, 4 skipped, исключённых/пропущенных тест-файлов нет. Первый полный прогон дал 1 падение (`src/web/orchestrator.test.mjs` — тест авто-коммита файла задачи: `assert.match(log, /docs(task): VL-93/)`, получено «init» — git-коммит в mkdtemp-репо не создался); файл изолированно зелёный (84 passed), падение интерференционное, повторный полный прогон по правилу — один — зелёный.
Документация (README: guard повторов — write-порог 6, эскалация до блокировки, `repeatBlockMultiplier`, дефолтное правило `repeat-loop-stuck`) обновлена в ветке; CHANGELOG.md и `backlog/docs/` (doc-10, doc-19) — по правилу фазы Code оставлены фазе Close.
Что осталось: CHANGELOG + doc-10/doc-19 в Close; слияние ветки в master и, при желании, ручная проверка эскалации на живом ране (в stderr должна появиться строка `[vibelog-agent] повтор заблокирован: …`).
---
author: @agent
created: 2026-11-01 21:53
---
Фаза Close выполнена. Ветка vb/vl-284 слита в master (1 коммит: 82d2dea — guard повторов эскалирует до блокировки, close не правит код), merge-коммит d20a8f8, worktree удалена (force — только untracked-симлинки node_modules и backlog/references/data), ветка vb/vl-284 удалена.
Проверки: `pnpm build` — успешно; ранний точечный фильтр по diff merge (`repeat-tracker`, `loop`, `supervisor-config`, `supervisor-healing`, `phase-prompt`) — 5 файлов, 242 passed; полный `pnpm test` — 127 файлов, 2398 passed, 4 skipped, исключённых/пропущенных тест-файлов нет, повторных полных прогонов не потребовалось.
Документация (DoD 2) закрыта в этой фазе: CHANGELOG.md (раздел Unreleased/Исправлено — полное описание VL-284), `backlog/docs/doc-10` (новый §6.7 «Guard повторов: write-порог и эскалация до блокировки»), `backlog/docs/doc-19` §12 (дефолтное правило `repeat-loop-stuck` в примере `heal_rules` + обоснование порядка перед `repeat-loop`). Коммит 2bd45ca. README §«Лимиты агента» и §«Супервизор» обновлены ещё в фазе Code (в ветке).
Lessons: созданы lesson-152 (guard повторов обязан эскалировать до блокировки исполнения — предупреждение на длинном ране игнорируется) и lesson-153 (в шаблон фазы пиши явные запреты соседних фаз, а не только позитивный сценарий), обе связаны с VL-284; коммит refs/lessons отдельным docs(task)-коммитом.
Изменённые файлы: 12 из ветки + CHANGELOG.md, doc-10, doc-19, lessons 152/153.
---
<!-- COMMENTS:END -->