---
id: VL-323
title: 'Loop detection убивает Close-фазу на дословных повторах вызова, вернувшего ackError — директива не содержит текста ошибки и готового исправления (Close VL-320)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 19:20'
updated_date: '2026-11-03 20:10'
due_date: ''
labels:
  - agent
  - prompts
  - bug
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
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-198
token_usage:
  input: 7425122
  output: 65385
  cache: 6788096
  total: 7490507
  requests: 136
  duration_ms: 2076613
  reasoning: 37933
  by_phase:
    code:
      input: 4101879
      output: 51513
      cache: 3762176
      requests: 61
    close:
      input: 3323243
      output: 13872
      cache: 3025920
      requests: 75
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Фаза Close VL-320 (ветка, шаг 7.6 «refs и lessons») упала кодом 1: «Loop detection: инструмент git_commit вызван 3 раза подряд с одинаковыми аргументами — вызов повторно заблокирован (та же сигнатура уже отклонялась в этой сессии), фаза прервана» (сессия `.vibelog/agent-sessions/agent-1793720932286.jsonl`, строки 60–70).

Это **следующий** инцидент после VL-318, и он показывает, что VL-318 закрыл не тот слой.

### Что произошло (реальные строки сессии)

1. `git_commit {paths: ["backlog/references/ref-25-Svelte-CLI.md", "backlog/lessons/lesson-195-…"], message: "docs(task): VL-320 — refs и lessons"}` — **без** `allowForeign`.
2. Ответ — корректный `ackError`: `{"ok": false, "error": "git_commit: эти файлы не принадлежат задаче VL-320: … передай allowForeign: true"}`. Ошибка до модели ДОШЛА (VL-318 работает: ложного «уже применено» больше нет).
3. Модель повторила вызов **дословно** → тот же `ackError`.
4. Третий дословный повтор → `loopDetectionDirective` («вызов НЕ выполнен и заблокирован… смени аргументы или инструмент»).
5. Четвёртый повтор → «та же сигнатура уже отклонялась в этой сессии» → `fail()`, код 1.
6. После `Продолжить` (resume) модель добавила `allowForeign: true` — коммит прошёл (`c10ce6b`), затем CHANGELOG. Работа доведена, но ценой падения фазы и лишнего рана.

### Причина (три слоя)

**1. `loopDetectionDirective` не несёт информации об ошибке.** `src/agent/loop.ts:388` — текст общий: «смени аргументы или инструмент, прочитай актуальное состояние…». Модель уже видела в tool-результате точную подсказку (`allowForeign: true`), но директива её не повторяет и не связывает с конкретным вызовом. Слабая модель читает «смени аргументы» как «попробуй ещё раз» и повторяет дословно.

**2. Серия `ackError`-повторов трактуется как обычный луп.** Три отказа подряд — это не «модель крутится на уже сделанной работе» (как в VL-303/304/310), а «модель не поняла, что чинить». Фатальный исход на 3-м повторе здесь несоразмерен: эффекта не было ни разу, работа не сделана, а ран уже потерян. При этом `ackError` — единственный класс ответа, где повтор БЕЗ изменения аргументов гарантированно бесполезен, то есть модель обязана получить исправление, а не запрет.

**3. Шаблон шага 7.6 содержит `allowForeign: true`, а модель его не передала.** `templates/phases/phase-close-worktree.md:61` уже пишет флаг — значит модель отступила от шаблона (вероятно, «оптимизировала» вызов, скопировав форму из шага 8 без флага, либо потеряла флаг при переписывании). Одной правки кода мало: нужен явный предупреждающий маркер в шаблоне, чтобы флаг не выпадал.

## Цель

1. Директива блокировки для write-инструмента, чей предыдущий ответ был `ackError`, содержит **текст ошибки** и **готовое исправление** (например, «добавь `"allowForeign": true` в аргументы»), а не общее «смени аргументы».
2. Серия дословных повторов вызова, вернувшего `ackError`, не приводит к фазовому `fail()` на 3-м повторе: либо не считается терминальной серией, либо фаталится позже (5-й повтор) — с сохранением защиты от вечного круга.
3. В close-шаблонах флаг `allowForeign: true` в шагах коммита refs/lessons и документации сопровождается явным предупреждением «без флага коммит отклоняется ВСЕГДА: файлы не входят в modified_files задачи».

## Связанные

VL-318 (классификация `ackError` — сделана, ошибка теперь доходит), VL-310 (кап серии повторов), VL-311 (`git_commit`/`allowForeign`), VL-316 (первый инцидент), VL-320 (этот инцидент), lesson-191.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Директива блокировки для write-инструмента, чей предыдущий ответ был ackError, содержит текст ошибки и готовое исправление аргументов (например, «добавь allowForeign: true»), а не общее «смени аргументы или инструмент»
- [x] #2 Серия дословных повторов вызова, вернувшего ackError, не приводит к фазовому fail() на 3-м повторе: серия считается отдельно (или фаталится позже), защита от вечного круга сохраняется, эффекта-обмана нет
- [x] #3 Регресс-тест на сессию agent-1793720932286: git_commit без allowForeign → ackError, затем 4 дословных повтора → ран не падает на 3-м повторе, модель получает директиву с текстом ошибки и подсказкой allowForeign
- [x] #4 Директива остаётся короткой (инвариант VL-310: < 400 байт) и содержит маркер «Loop detection» (lesson-76), существующие тесты на маркер не ломаются
- [x] #5 В templates/phases/phase-close.md и phase-close-worktree.md шаги коммита refs/lessons и документации содержат allowForeign: true и явное предупреждение, что без флага коммит отклоняется всегда
- [x] #6 Тесты проходят (pnpm build && pnpm test), документация обновлена (doc-10 §6 — поведение loop detection при ackError, CHANGELOG)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-323

Тип: bug. Правки кода — в фазе Code.

### Диагноз (подтверждён чтением кода и сессии)

- `src/agent/loop.ts:388` — `loopDetectionDirective(name, repeatLimit)` собирает общий текст без знания о причине отказа. Вызывающий код (`blockAndPush`, строки ~1044-1075) в момент блокировки уже имеет `output` (текст `ackError`) и `failed`, но в директиву их не передаёт.
- `src/agent/loop.ts:1189-1215` — ветка `if (streak >= repeatLimit)`: `blockAndPush()`, затем при `blockedStreak >= 2 || blockCounts >= 2` → фазовый `fail()`. Для `ackError`-серии это преждевременно.
- `templates/phases/phase-close.md:64`, `phase-close-worktree.md:61` — флаг есть, но без предупреждения о последствиях его отсутствия (модель в сессии `agent-1793720932286` его выбросила).

### Решения

- **Директива знает причину.** Расширить `loopDetectionDirective(name, repeatLimit, opts?: { lastError?: string })`: если передан `lastError` (последний ответ по этой сигнатуре был `ackError`), текст становится «Loop detection: … предыдущий вызов отклонён: <первые ~200 символов error>. Повтор с теми же аргументами даст ТОТ ЖЕ отказ — исправь аргументы по тексту ошибки». Маркер «Loop detection» сохраняется (lesson-76), длина держится < 400 байт — `lastError` обрезать.
- **Отдельная серия для ackError.** Новый набор `errorSignatures` + счётчик `errorRepeatCount`/`errorRepeatSig` (по образцу `noopSignatures`, VL-309): сигнатуры, чей последний ответ был `ok:false`. Реальная работа (`resetRepeatSeries`) его сбрасывает. Порог фазового прерывания — `MAX_ERROR_REPEATS_PER_RUN = 5` вместо 3, чтобы модель успела применить подсказку. При исчерпании — честный `fail()` с текстом ошибки в сообщении (сейчас в тексте ошибки нет причины отказа — добавить).
- **Не считать `ackError`-серию через `streak`.** В ветке `if (streak >= repeatLimit)` для `errorSignatures` уходить в `errorRepeatOutcome()` с порогом 5, а не фаталить на 3.
- **Шаблоны — предупреждение.** К `git_commit` шага 7.6 (worktree) и шага 6.6 (`phase-close.md`) добавить в текст предложения явное «`allowForeign` обязателен: файлы refs/lessons и документации не входят в modified_files задачи, без флага git_commit отклоняет коммит ВСЕГДА». Флаг уже присутствует — правка только текстовая (шаблонные инварианты VL-105/lesson-29: без ID задач и `pnpm`).

### Файлы и точки правки

**1. `src/agent/loop.ts`**
- Экспорт `MAX_ERROR_REPEATS_PER_RUN = 5` (рядом с `MAX_APPLIED_REPEATS_PER_RUN`/`MAX_NOOP_REPEATS_PER_RUN`).
- `loopDetectionDirective(name, repeatLimit, lastError?: string)` — необязательный третий параметр, обрезка ошибки, текст с конкретным исправлением.
- В обработке ответа: `if (failed) { errorSignatures.add(signature); lastErrorBySignature.set(signature, errorText); }` — `errorText` извлечь из `parsed.error` (или `parsed.message` при `denied`).
- `resetRepeatSeries()` — сбрасывает `errorRepeatCount`/`errorRepeatSig` (набор `errorSignatures` НЕ чистим: он про факт отказа, а сигнатуры при изменённых аргументах иные).
- `errorRepeatOutcome(name)` по образцу `appliedRepeatOutcome`: `null` пока `<= MAX_ERROR_REPEATS_PER_RUN`, иначе `fail(...)` с текстом последней ошибки.
- `blockAndPush()` — передавать `lastErrorBySignature.get(signature)` в `loopDetectionDirective`.
- Ветки `if (streak >= repeatLimit)` и `if (blocked.has(signature))` — для `errorSignatures` вызывать `errorRepeatOutcome`, а не `fail()` на 3-м повторе.

**2. `templates/phases/phase-close-worktree.md:61`, `templates/phases/phase-close.md:64`** — предупреждение про обязательность `allowForeign`.

**3. Тесты**
- `src/agent/loop.test.mjs` — регресс на сессию `agent-1793720932286`: заглушка write-инструмента возвращает `{"ok":false,"error":"… передай allowForeign: true"}`; 4 дословных повтора → ран НЕ падает, tool-результат с директивой содержит «allowForeign: true»; 5-й и последующие повторы → `fail()` с текстом ошибки в `res.result`.
- `src/agent/loop.test.mjs` — сохранить кейсы VL-306 (плоский текст → applied) и VL-309 (noop) без изменений; проверить, что обычный луп read-инструментов по-прежнему фаталится на 3-м повторе (не задели общий путь).
- `src/web/phase-prompt.test.mjs` — инвариант: в обоих close-шаблонах `git_commit` с `allowForeign` сопровождается словами про modified_files/отклонение.

**4. Документация (Close)** — doc-10 §6 (поведение loop detection при ackError: директива с текстом ошибки, порог 5), CHANGELOG (Исправлено).

### Проверка

`pnpm build && pnpm test`.

### Риски

- **R1. Задержка честного fail.** Порог 5 вместо 3 добавляет до 2 ходов в патологическом случае; ограничение по wall-time/idle (VL-274) остаётся страховкой.
- **R2. Рост размера директивы.** Текст ошибки обрезается, директива остаётся < 400 байт (инвариант VL-310).
- **R3. Маркер «Loop detection».** Сохраняется обязательно — по нему матчат существующие тесты и разборы сессий (lesson-76).
- **R4. Взаимодействие с VL-319.** `noopSignatures` и `errorSignatures` — соседние, но разные наборы; noop-ветка проверяется раньше, регресса быть не должно (покрыть тестом).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 19:59
---
Фаза 3 (Code) выполнена. Коммит e3007ea (ветка vb/vl-323).
Изменено:
- `src/agent/loop.ts`:
  - `loopDetectionDirective(name, repeatLimit, lastError?)` — при наличии текста отказа директива принимает вид «Loop detection: <имя> — предыдущий вызов отклонён: <текст ошибки>. Повтор даст тот же отказ — исправь аргументы.» Маркер «Loop detection» сохранён (lesson-76), длина < 400 байт (инвариант VL-310): текст ошибки сжимается по пробелам и режется до 100 символов с сохранением ХВОСТА (готовая подсказка «передай allowForeign: true» стоит в конце сообщения — усечение по голове её съедало, поймано тестом).
  - Новый хелпер `parsedErrorText(output)` — извлекает `error` (ackError) либо `message` (ackDenied) из JSON-ответа.
  - Новые состояния: `errorSignatures` (сигнатуры, чей последний ответ `ok:false`), `lastErrorBySignature` (текст последнего отказа), `errorRepeatCount`/`errorRepeatSig` (серия подряд), `noteErrorRepeat()` — считает и исполненные отказы, и заблокированные повторы (иначе после порога streak счётчик застывал бы и вечный круг стал бы возможен).
  - `MAX_ERROR_REPEATS_PER_RUN = 5` (экспортирован) вместо фазового fail на 3-м повторе; `errorRepeatOutcome()` даёт честный `fail()` с текстом последней ошибки и маркером «Loop detection» только после исчерпания серии.
  - Ветки `streak >= repeatLimit` и `blocked.has(signature)` для `errorSignatures` уходят в `errorRepeatOutcome`, а не в немедленный fail.
  - `resetRepeatSeries(signature)` не обнуляет серию отказов, если сброс вызван исполнением ТОГО ЖЕ отказавшего вызова (иначе защита от вечного круга не сработала бы никогда); работа с другими аргументами серию рвёт.
  - `blockAndPush()` передаёт `lastErrorBySignature.get(signature)` в директиву.
- `templates/phases/phase-close.md` (шаг 6.6) и `phase-close-worktree.md` (шаг 7.6): добавлено явное предупреждение «`allowForeign: true` здесь ОБЯЗАТЕЛЕН: файлы backlog/references/* и backlog/lessons/* не входят в modified_files задачи, без флага git_commit отклоняет коммит ВСЕГДА».
- `src/agent/loop.test.mjs`: новый блок «VL-323 — серия ackError не убивает фазу на 3-м повторе» (5 тестов): регресс agent-1793720932286 (4 дословных повтора → ран не падает, директива содержит «allowForeign: true» и < 400 байт, исправленный вызов доходит до handler); 5 повторов не фатальны, 6-й исчерпывает серию с текстом ошибки в `res.result`; обычный read-луп по-прежнему фаталится на 3-м повторе (общий путь не задет); директива с длинным текстом ошибки < 400 байт; перемежение реальной работой сбрасывает серию.
- `src/web/phase-prompt.test.mjs`: инвариант — в обоих close-шаблонах шаг refs/lessons с `allowForeign` сопровождается словами «ОБЯЗАТЕЛЕН», `modified_files` и «отклоняет».
Проверки: `pnpm build` — успешно; `npx tsc --noEmit` — чисто; полный `pnpm test` — 161 файл, 3054 passed, 4 skipped, 0 failed (пропуски — штатные `it.skip` проекта, не связаны с задачей). Точечные прогоны `src/agent/loop.test.mjs` (115) и `src/web/phase-prompt.test.mjs` (95) — зелёные.
Что осталось (Фаза Close): doc-10 §6 (поведение loop detection при ackError: директива с текстом ошибки, порог 5) и запись в CHANGELOG — по правилам фазы Code документация не правится.
---
author: @agent
created: 2026-11-03 20:05
---
Фаза close не удалась (код выхода 1): ет, блокировок=0, payload последнего запроса=174134 байт (макс 174134), usage={"input_tokens":842538,"output_tokens":2920,"cache_read_input_tokens":767488,"total_tokens":845458,"reasoning_tokens":726} — статус возвращён к Review.
---
author: @agent
created: 2026-11-03 20:10
---
Фаза Close выполнена. Ветка vb/vl-323 слита в master (1 коммит e3007ea, merge 739d265), worktree удалена (force — только untracked-симлинк backlog/references/data), ветка vb/vl-323 удалена.
Проверки после merge: `pnpm build` — успешно; ранний точечный фильтр по diff'у (src/agent/loop.test.mjs 115, src/web/phase-prompt.test.mjs 95) — зелёный; полный `npx vitest run` — 162 файла, 3062 passed, 4 skipped, 0 failed (пропуски — штатные it.skip проекта).
DoD: 1 «Тесты проходят» — выполнен (полный прогон после merge); 2 «Документация обновлена» — выполнен: doc-10 §6 (новый пункт «Директива блокировки при ackError несёт текст ошибки, серия отказов не фатальна на 3-м повторе (VL-323)») и CHANGELOG.md (Unreleased → Исправлено), коммит ae50dab; 3 «Нет регрессий» — выполнен (полный прогон зелёный, кейсы VL-306/VL-309 и обычный read-луп на 3-м повторе покрыты тестами).
Lessons: создан lesson-198 (тело заполнено, связан с VL-323), закоммичен в 9a20d6a. Refs у задачи нет.
---
<!-- COMMENTS:END -->