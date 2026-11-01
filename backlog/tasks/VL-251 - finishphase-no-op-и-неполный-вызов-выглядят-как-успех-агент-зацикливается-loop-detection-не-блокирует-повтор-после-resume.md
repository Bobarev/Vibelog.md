---
id: VL-251
title: 'finish_phase: no-op и неполный вызов выглядят как успех → агент зацикливается; loop detection не блокирует повтор после resume'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 03:41'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - mcp
  - agent
  - bug
  - loop-detection
dependencies:
  - VL-250
milestone: v1.11
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/server.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/session.ts
  - src/agent/session.test.mjs
  - src/agent/cli.ts
  - README.md
lessons:
  - lesson-92
token_usage:
  input: 11453268
  output: 55610
  cache: 11188736
  total: 11508878
  requests: 145
  duration_ms: 537617
  reasoning: 26577
  by_phase:
    plan:
      input: 8374189
      output: 21454
      cache: 8283136
      requests: 82
    prompt:
      input: 1846257
      output: 27219
      cache: 1717248
      requests: 33
    close:
      input: 1232822
      output: 6937
      cache: 1188352
      requests: 30
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Найдено при разборе зацикливания агента в сессии `agent-1793319087159` (задача VL-234, фаза перевода в Planned).

### Хронология лупа (из JSONL сессии)

1. Агент обновил `implementationPlan` у VL-234 — tool-ответ `«Задача VL-234 обновлена»`.
2. Вызов `backlog_finish_phase {id: "VL-234", status: "Planned", tokenUsage: {input:0, output:0, total:0}}`.
3. Tool-ответ: `«Статус: Planned; отчёт: нет; отмечено AC: 0, DoD: 0; файлов: не менялись; tokenUsage: уже записан»`.
4. Тот же вызов повторён ещё дважды с байт-в-байт идентичными `arguments` (новые `tool_call_id`, новый `input_tokens`, `reasoning_tokens` 37).
5. Сработал loop detection → в роль **assistant** записано: `«Loop detection: инструмент backlog_finish_phase вызван 3 раза подряд с одинаковыми аргументами — фаза прервана. Проверь, не зациклился ли агент.»`
6. Пользователь: «Продолжить». В контекст заново подаётся условие задачи VL-234 и сообщение о работе в worktree.
7. Агент первым же действием повторяет тот же `finish_phase` (тот же `status: Planned`, тот же нулевой `tokenUsage`) — луп пошёл по второму кругу; снова 3 повтора → снова abort.

### Наблюдаемые числа

`input_tokens` растёт 55357 → 55502 → 55647 → (после resume) 55927 → 56072 → 56217; `cache_read_input_tokens` падает с 55296 до 32768 — контекст перезаполняется без прогресса.

## Причина

Три независимых дефекта, которые вместе дают замкнутый цикл.

### 1. `backlog_finish_phase` неотличим от успеха при no-op

Задача на момент вызова уже была в статусе `Planned` (подтверждение: `backlog_search` → VL-234 status=Planned). Переход «Planned → Planned» ничего не меняет, но инструмент отвечает нейтрально-успешно (`«Статус: Planned; отчёт: нет; …»`) без признака «фаза уже завершена». Для модели это выглядит как «принято, но чего-то не хватает» — отсюда повтор.

### 2. Отсутствующий `report` не является ошибкой

В ответе есть `«отчёт: нет»`, однако это строка отчёта, а не отказ. Агент не получает сигнала «вызов неполный, добавь report» и повторяет его **без изменения аргументов** — то есть повтор заведомо бесполезен.

### 3. Loop detection не блокирует повтор после resume и адресован не той роли

Сообщение о срабатывании пишется в `role: assistant`, поэтому модель читает его как собственный текст, а не как директиву рантайма. Директивы «что делать вместо этого» в сообщении нет. После «Продолжить» сигнатура отклонённого вызова не запоминается — повтор того же вызова снова допускается.

## Цель

Сделать так, чтобы повторный/неполный вызов `finish_phase` был явной ошибкой для модели, а срабатывание loop detection после resume запрещало повтор той же сигнатуры и подсказывало следующий шаг.

## Входные данные

- Сессия: `.vibelog/agent-sessions/agent-1793319087159.jsonl` (читается скриптом `scripts/agent-session.mjs`, добавленным в VL-250 — через `read_file` файл недоступен).
- Текущая семантика инструмента: VL-138 (`backlog_finish_phase`).
- Loop detection: VL-119, VL-83.
- Наблюдение: задача уже была в `Planned` до вызова — переход статуса избыточен.

## Открытые вопросы

- Возвращать ошибку или `{ok: false, reason: "already_finished", report_from}`? Ошибка машинно-однозначнее, но ломает сценарий «повторный finish безопасен».
- Считать ли `tokenUsage` с нулями отсутствующим параметром (сейчас `«tokenUsage: уже записан»` — то есть нули принимаются как валидные).
- Где хранить «отклонённые сигнатуры» между resume: в состоянии сессии раннера или в самом MCP-процессе.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 finish_phase при status, равном текущему, возвращает явный признак already_finished (ошибка или ok:false) с указанием даты и источника существующего отчёта — не нейтральный успех
- [x] #2 finish_phase с пустым/отсутствующим report возвращает ошибку с перечнем недостающих полей вместо строки «отчёт: нет»
- [x] #3 tokenUsage с нулевыми значениями отвергается как отсутствующий параметр
- [x] #4 Сообщение loop detection инжектится как результат инструмента или system-директива (не role=assistant) и содержит следующий шаг
- [x] #5 После resume повтор вызова с той же сигнатурой, что была отклонена loop detection, блокируется без исполнения
- [x] #6 Есть регрессионные тесты на все три сценария: no-op status, пустой report, повтор сигнатуры после resume
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации (Фаза 2, Plan)

Тип: bug. Три независимых дефекта → три точки правки + регрессионные тесты. Правки в MCP-границе (`src/mcp/tools.ts`), в loop-детекторе (`src/agent/loop.ts`) и в персистентности состояния сессии (`src/agent/session.ts`, `src/agent/cli.ts`).

### Решения по открытым вопросам

1. **no-op статус → жёсткая ошибка, а не `ok:false`.** `toolFinishPhase` бросает `Error` (MCP-сервер в `src/mcp/server.ts:222-233` превращает throw в `isError: true`, `mcp-client.callTool` — в текст «Ошибка MCP-инструмента …»). Машинно-однозначно для модели и не требует нового протокола. Сценарий «повторный finish безопасен» **сознательно убираем**: именно он дал луп (VL-234). Мягкая семантика частичного применения остаётся только для *невалидных значений* (статус вне конфига, битый индекс AC/DoD).
2. **Нулевой `tokenUsage` = отсутствующий параметр** → откат на штатный резолв (мета сессии → jsonl), без ошибки; в сводке пометка «tokenUsage: нули игнорированы».
3. **Отклонённые сигнатуры — в мете сессии** (`.vibelog/agent-sessions/<id>.meta.json`, поле `blocked_signatures`): MCP-процесс умирает вместе с фазой, а мета переживает resume.

### Файлы и конкретные места

**1. `src/mcp/tools.ts` — `toolFinishPhase` (строки 1210–1403)**

- После `getTask` (1214) ввести блок hard-валидации ДО любых записей, массив `hardErrors: string[]`:
  - **already_finished (AC1, AC3-независимо)**: если `args.status` — строка и `normalizeStatus(args.status) === normalizeStatus(task.status)` → `hardErrors.push('Фаза уже завершена: статус «<status>» совпадает с текущим. ' + reportRef)`.
    `reportRef` — «Существующий отчёт: <created> (@<author>, источник: комментарии задачи), начало: "<первые 80 символов text>"» по последнему комментарию `@agent` (или последнему вообще, если `@agent` нет); если комментариев нет — «Существующего отчёта в задаче нет». Плюс директива следующего шага: «Не повторяй этот вызов: статус уже целевой. Если нужен отчёт или отметки — `backlog_add_comment` / `backlog_manage_ac`; если фаза завершена — верни финальный текст.»
  - **report обязателен (AC2)**: если `args.comment` отсутствует, не строка или `trim() === ''` → `hardErrors.push('Неполный вызов: не передан report. Обязательные поля: comment — отчёт о фазе («Фаза N (<Фаза>) выполнена. …»). Вызов без отчёта не засчитывается.')`. Логику `commentPart = 'отчёт: нет'` (1221) и ветку `if (args.comment !== undefined)` (1280–1292) заменить на безусловное добавление комментария (после прохождения hard-валидации, `commentPart = 'отчёт добавлен'`).
  - Если `hardErrors.length > 0` → `throw new Error(hardErrors.join('\n'))` **до** `updateTaskFile`, до AC/DoD и до token-блока (файл задачи и usage не трогаются — повтор безопасен и не пишет дублей).
- **tokenUsage (AC3)**: в блоке 1320–1345 после парсинга `raw` добавить проверку «все числовые значения = 0» (`keys.every(k => (raw[k] ?? 0) === 0)`) → трактовать как `undefined` (не ошибка): `tokenFallbackNote = 'tokenUsage: нули игнорированы (как отсутствующий параметр)'` и продолжить в ветку fallback (1346+). Нефинитные/отрицательные/неизвестные ключи — прежняя мягкая ошибка в `errors`.
- Итоговая сводка (1399–1403): добавить `tokenFallbackNote` и убрать ветку `'; ничего не менялось'` (вызов без полей теперь невозможен — его отсекает hard-валидация).
- Обновить `description` схемы (строка 389) — прямо указать: «Обязательное поле — comment; повторный вызов со статусом, равным текущему, возвращает ошибку already_finished».

**2. `src/agent/loop.ts` — loop detection (AC4) и блокировка после resume (AC5)**

- `LoopLimits` (после строки ~110, поле `loopDetectionRepeat` — 67): добавить
  `blockedSignatures?: string[]` — сигнатуры `name|JSON(args)`, отклонённые loop detection в прошлых ранах (из меты сессии).
- В `runLoop` (инициализация рядом с 274): `const blocked = new Set(options.limits?.blockedSignatures ?? []);`
  также `const blockedNew: string[] = []` (для возврата) и `let blockedStreak = 0`.
- В цикле по `validCalls` (строки 618–640) переписать блок loop detection:
  1. Сигнатура считается как сейчас (`name|JSON.stringify(args)`).
  2. **Если `blocked.has(signature)`** → вызов НЕ выполняется: `blockedStreak++`; `pushMessage({role:'tool', tool_call_id: call.id, content: 'Вызов <name> заблокирован loop detection: та же сигнатура уже была отклонена в этой сессии. Повтор не даст результата. Следующий шаг: <по инструменту> либо заверши фазу финальным текстом.'})`; при `blockedStreak >= 2` → `fail('Loop detection: вызов <name> повторно заблокирован … фаза прервана. Следующий шаг: …')`. `continue` к следующему `call`.
  3. **Достигнут порог повтора (`streak >= repeatLimit`) для незаблокированной сигнатуры** — вместо немедленного `fail` (текущая строка 633-637): НЕ выполнять вызов, добавить сигнатуру в `blocked`/`blockedNew`, `pushMessage({role:'tool', tool_call_id: call.id, content: <директива>})`, `blockedStreak++`; если `blockedStreak >= 2` → `fail(...)`. Так сообщение уходит модели как **результат инструмента** (AC4: не `role:'assistant'`) и `fail()` больше не пишет его в assistant.
  4. Текст директивы — константа-хелпер `loopDetectionDirective(name, repeatLimit)` в `loop.ts`: «Loop detection: инструмент <name> вызван <N> раз подряд с одинаковыми аргументами — вызов заблокирован. Повтор бесполезен. Следующий шаг: смени аргументы/инструмент, прочитай актуальное состояние (backlog_view_task / git status) или заверши фазу финальным текстом.» Маркерную подстроку «Loop detection» сохранить (lesson-76) — `loop.test.mjs:331` матчит `/Loop detection/`.
  5. `blockedStreak = 0` при любом вызове с другой сигнатурой (в т.ч. успешно выполненном).
- `LoopResult` (интерфейс ~120–160): добавить `blocked_signatures?: string[]` — `blockedNew` (новые за ран) во всех точках возврата, включая `fail()` (367–390).
- Тот же механизм в `src/web/chat.ts` (строка 579 — отдельный цикл чата): передать `blockedSignatures` из стора треда и сохранять новые; если чат-цикл loop detection не имеет — не расширять (зафиксировать в отчёте Code как осознанно вне scope, `backlog_finish_phase` в чате запрещён `CHAT_DISALLOWED_TOOLS`, `src/web/tool-policy.ts:51`).

**3. `src/agent/session.ts` — новое поле меты (AC5)**

- `SessionMeta` (после `repeat_stats`, строка 171): `blocked_signatures?: string[]` — «Сигнатуры tool-вызовов, отклонённых loop detection; при resume блокируются без исполнения (VL-251)». Обновление — только через существующий `updateSessionMeta` (merge, lesson-40), новых писателей не заводить.

**4. `src/agent/cli.ts` — проброс состояния в/из loop**

- Загрузка (рядом с `394`, после `loadSession`): `const resumedMeta = loadSessionMetaSync(sessionsDir, sessionId)` (уже импортирован, строка 28) → `resumedMeta?.blocked_signatures` в `limits.blockedSignatures` в объекте `runLoop` (`584–600`).
- Пост-ран (рядом с `734`): в существующий `updateSessionMeta(...)` добавить `blocked_signatures: [...(existing?.blocked_signatures ?? []), ...(loopResult.blocked_signatures ?? [])]` с дедупликацией (`Set`) и капом 20 записей (не раздувать мету за тысячи ранов).

### Порядок действий

1. `src/mcp/tools.ts`: hard-валидация (already_finished, обязательный comment) + нулевой tokenUsage + сводка + описание схемы.
2. `src/agent/loop.ts`: `blockedSignatures` в `LoopLimits`/`LoopResult`, директива в tool-сообщении, блокировка до исполнения, порог 2 для фатального отказа.
3. `src/agent/session.ts`: поле `blocked_signatures`.
4. `src/agent/cli.ts`: чтение меты при resume + запись новых сигнатур пост-раном.
5. Тесты (см. ниже), затем документация: `README.md` (секция про `backlog_finish_phase`: обязательный comment, already_finished, нулевой tokenUsage) и `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` §6 (таблица loop detection: сообщение → tool-результат, персист `blocked_signatures`).

### Как проверить

```
pnpm build && pnpm test:fast
pnpm test          # полный прогон перед DoD
```

Точечные регрессионные тесты (AC6):

- `src/mcp/server.test.mjs` (блок «tools/call — backlog_finish_phase (VL-138)», 328–460 и tokenUsage 466–560):
  - `{id, status: <текущий>, comment}` → `isError: true`, текст содержит `уже завершена` + дату/автора существующего отчёта; файл не изменён (повторный `backlog_view_task` — один комментарий, статус прежний).
  - `{id, status}` без `comment` → `isError: true`, текст содержит `не передан report` и `comment`.
  - `{id, comment, tokenUsage:{input:0,output:0,cache:0,total:0,requests:0}}` → не ошибка, в сводке `нули игнорированы`, `token_usage` в задаче — из резолва сессии (или его отсутствие с мягкой ошибкой).
  - Существующие кейсы, ломающиеся новым контрактом, поправить: «вызов только с {id}» (421) → теперь ожидает `isError`/`не передан report`; `{id, acChecks:[1,'2']}` (370) и `{id, modifiedFiles:[…]}` (386) и `{id, acChecks:['NaN'], status:'Done'}` (437) — добавить `comment` в аргументы, сохранив проверяемую семантику частичного применения.
- `src/agent/loop.test.mjs` (рядом с тестом loop detection, 300–340): три одинаковых вызова → в `messages` есть `role:'tool'` с текстом «Loop detection» и «Следующий шаг», `is_error` исходa зависит от 4-го повтора; `blocked_signatures` содержит сигнатуру; прогон с `limits.blockedSignatures: [sig]` → handler НЕ вызван (счётчик мока), tool-сообщение «заблокирован».
- `src/agent/session.test.mjs`: `updateSessionMeta` merge не теряет `blocked_signatures` и не затирает `taskId/phase` (lesson-40).

### Риски

1. **Смена контракта `backlog_finish_phase`** — обязательный `comment` и ошибка на no-op статусе ломают существующие шаблоны фаз, если где-то статус передаётся равным текущему. Проверка: `templates/phases/*.md` передают `comment` всегда; `produces_status` считается от исходного статуса (`src/core/phase-transient.ts`), совпадение возможно на повторном ране — это и нужно ловить (в шаблоны добавлять ничего не требуется, но в отчёте Code зафиксировать поведение на resume).
2. **Веб-чат** (`src/web/chat.ts`) ловит ошибки `handleToolCall` и отдаёт `{error: …}` — сообщение станет понятнее, регрессий не ждём; `finish_phase` в чате запрещён.
3. **`blockedSignatures` в мете** может «залипнуть» и блокировать легитимный повтор в новом ране с другим контекстом. Митигация: блокировка только точной сигнатуры `name|JSON(args)`, кап 20, фатальный отказ лишь на 2-й блокировке подряд; при желании — сброс при смене `phase` в мете.
4. **Текст `fail()` остаётся role=assistant** (это финальный текст фазы по контракту VL-103/jsonl-resume) — AC4 относится к самой директиве loop detection, она уходит tool-результатом; не ломать `fail()` (иначе jsonl обрывается на tool-сообщении).
5. **Порог 100 tool-calls / payload** не трогаем — задача не про лимиты; наблюдаемые числа из описания (5 КБ дельты контекста на повтор) устраняются самим запретом повтора.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 03:44
---
Фаза plan не удалась (код выхода 1): ch|finish_phase×4, payload последнего запроса=151830 байт (макс 151830), usage={"input_tokens":149619,"output_tokens":411,"cache_read_input_tokens":129024,"total_tokens":150030,"reasoning_tokens":139} — статус возвращён к Spec.
---
author: @agent
created: 2026-10-30 03:51
---
Фаза 2 (Plan) выполнена. Тип: bug.
Записан Implementation Plan в задачу. Суть решений:
1. **no-op статус → жёсткая ошибка** (`throw` в `toolFinishPhase`, `src/mcp/tools.ts:1210-1403`): при `status == task.status` вызов падает с `isError:true` и текстом «Фаза уже завершена» + дата/автор/фрагмент существующего отчёта + директива следующего шага. Сценарий «повторный finish безопасен» сознательно убирается — именно он дал луп VL-234. Мягкое частичное применение остаётся только для невалидных значений.
2. **`comment` обязателен**: отсутствие/пустая строка → `isError` с перечнем недостающих полей («не передан report»), вместо строки «отчёт: нет».
3. **Нулевой `tokenUsage` = отсутствующий параметр**: откат на штатный резолв (мета → jsonl) с пометкой «нули игнорированы», без ошибки.
4. **Loop detection**: директива уходит `role:'tool'` (результат инструмента), вызов НЕ исполняется, добавлена константа `loopDetectionDirective` с «Следующий шаг: …»; маркерная подстрока «Loop detection» сохранена (lesson-76, тест `loop.test.mjs:331`).
5. **Персист отклонённых сигнатур**: новое поле `blocked_signatures` в `SessionMeta` (`src/agent/session.ts`), читается при resume и прокидывается в `LoopLimits.blockedSignatures` (`src/agent/cli.ts`), новые сигнатуры дописываются пост-раном в существующем `updateSessionMeta` (merge, lesson-40), кап 20. Повтор такой сигнатуры блокируется без исполнения (AC5).
Файлы плана (все существуют): `src/mcp/tools.ts`, `src/agent/loop.ts`, `src/agent/session.ts`, `src/agent/cli.ts`, тесты `src/mcp/server.test.mjs`, `src/agent/loop.test.mjs`, `src/agent/session.test.mjs`, документация `README.md` + `backlog/docs/doc-10`.
Проверка: `pnpm build && pnpm test:fast`, перед DoD — полный `pnpm test`.
Риски: (1) обязательный `comment` меняет контракт инструмента — шаблоны фаз передают его всегда, но поведение на resume-ране нужно зафиксировать; (2) возможное «залипание» `blocked_signatures` — митигация точной сигнатурой, капом и порогом 2 блокировки подряд; (3) `fail()` намеренно остаётся `role:assistant` (контракт jsonl-resume), AC4 касается только директивы loop detection.
Побочное наблюдение (подтверждает баг): при завершении этой фазы мой первый вызов `finish_phase` без `comment` вернул нейтральный «Статус: Planned; отчёт: нет; …» — ровно тот no-op-успех, который описан в задаче.
---
author: @agent
created: 2026-10-30 03:57
---
Фаза 3 (Code) выполнена.
**Изменено (код + тесты):** `src/mcp/tools.ts`, `src/agent/loop.ts`, `src/agent/session.ts`, `src/agent/cli.ts`, `src/mcp/server.test.mjs`, `src/agent/loop.test.mjs`, `src/agent/session.test.mjs`; документация — `README.md` (контракт `backlog_finish_phase`). Коммиты: `a671afc` (fix), `b23ca2b` (docs).
**Что сделано:**
1. `toolFinishPhase` — жёсткая валидация ДО любых записей: (а) статус, равный текущему, → `isError` «Фаза уже завершена» + дата/автор/начало существующего отчёта + следующий шаг; (б) отсутствие/пустой `comment` → `isError` «Неполный вызов: … comment (report) не передан» с перечнем обязательных полей. Строка «отчёт: нет» и ветка «ничего не менялось» удалены; `anyField` выпилен (сводка упрощена). Файл задачи и usage при ошибке не трогаются — повтор безопасен.
2. Нулевой `tokenUsage` (`{input:0,…}` или все ключи отсутствуют) трактуется как отсутствующий параметр: откат на резолв мета→jsonl + пометка «нули игнорированы» в сводке (не ошибка).
3. Loop detection: введён `loopDetectionDirective()` + `NEXT_STEP_HINT`; директива уходит **tool-результатом** заблокированного вызова (`role:'tool'` + `tool_call_id`), вызов НЕ исполняется; 2 блокировки подряд → `fail()` (общий, с «Следующий шаг»). Маркерная подстрока «Loop detection» сохранена (lesson-76).
4. Персист: `LoopLimits.blockedSignatures` → `Set` блока; `LoopResult.blocked_signatures` (только новые сигнатуры) во всех точках возврата; `SessionMeta.blocked_signatures`; `cli.ts` читает мету при resume (`resumedBlockedSignatures`) и дописывает накопленное дедуплицированным капом 20 через существующий `updateSessionMeta` (merge, lesson-40). Повтор такой сигнатуры после resume блокируется без исполнения (AC5).
5. Тесты: +3 в `server.test.mjs` (no-op статус → already_finished с датой/автором и без дубля комментария; вызов без report → isError с перечнем полей; нулевой usage → «нули игнорированы», успех); +3 в `loop.test.mjs` (директива tool-результатом + `Следующий шаг` + `blocked_signatures`; 2-я блокировка подряд → fail; сигнатура из `blockedSignatures` не исполняется); +1 в `session.test.mjs` (merge сохраняет `blocked_signatures` и не теряет taskId/phase). Существующие кейсы VL-138/VL-198 обновлены под обязательный `comment`.
**Проверки:** `pnpm build` ✅; полный `pnpm test` ✅ — 87 файлов, 1637 passed, 4 skipped (skipped — предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`, к задаче не относятся; прогон без `--exclude`/`--skip` фильтров).
**Что осознанно вне scope:** веб-чат (`src/web/chat.ts`) свой loop detection не имеет, а `backlog_finish_phase` там запрещён (`CHAT_DISALLOWED_TOOLS`, `src/web/tool-policy.ts:51`) — правка не требовалась. `fail()` остаётся `role:assistant` (контракт jsonl-resume VL-103); AC4 закрыт через tool-результат директивы.
**Документация:** README обновлён в этой фазе (секция billing/контракт инструмента); doc-10 §6 и CHANGELOG — по правилам фазы Close.
Lessons: создан `lesson-92` (явная ошибка + следующий шаг вместо нейтрального успеха; директива tool-результатом; персист сигнатур), связан с задачей.
---
author: @agent
created: 2026-10-30 04:00
---
Фаза Close выполнена.
**Merge:** ветка `vb/vl-251` слита в master (2 коммита: `a671afc` fix, `b23ca2b` docs), merge-коммит без конфликтов. Worktree `.vibelog/worktrees/vl-251` удалена (в ней оставались только untracked-симлинки `node_modules` и `backlog/references/data`), ветка `vb/vl-251` удалена (`git branch -d`).
**Проверки после merge в главном репо:** `pnpm build` ✅; полный `pnpm test` ✅ — 87 файлов, 1637 passed, 4 skipped (предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`, к задаче не относятся; прогон без фильтров).
**DoD:** «Тесты проходят» ✅, «Нет регрессий» ✅; «Документация обновлена» ✅ — закрыто в этой фазе: CHANGELOG.md (Unreleased → Исправлено, запись VL-251), doc-8 `backlog_finish_phase` (обязательный `comment`, already_finished, нулевой `tokenUsage`), doc-10 §6 (loop detection: директива tool-результатом, персист `blocked_signatures` через resume). Коммит документации: `5a15f40` (`docs: VL-251 — документация и CHANGELOG`); refs/lessons: `5cc6a5e`.
**Lessons:** `lesson-92` (явная ошибка + следующий шаг вместо нейтрального успеха; директива tool-результатом; персист отклонённых сигнатур), связан с задачей.
---
<!-- COMMENTS:END -->