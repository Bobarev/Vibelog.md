---
id: VL-303
title: 'backlog_update_task: no-op вызов возвращает ok и зацикливает модель → loop detection убивает фазу'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 17:31'
updated_date: '2026-11-02 17:57'
due_date: ''
labels:
  - mcp
  - agent
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
  - src/mcp/tool-result.ts
  - src/mcp/tools.ts
  - src/agent/loop.ts
  - src/mcp/write-ack.test.mjs
  - src/agent/loop.test.mjs
lessons:
  - lesson-173
token_usage:
  input: 8816485
  output: 60729
  cache: 8488448
  total: 8877214
  requests: 146
  duration_ms: 1015555
  reasoning: 31290
  by_phase:
    plan:
      input: 749921
      output: 14259
      cache: 702976
      requests: 15
    code:
      input: 4280364
      output: 30275
      cache: 4194816
      requests: 56
    close:
      input: 3786200
      output: 16195
      cache: 3590656
      requests: 75
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Симптом: фаза падает с кодом 1 «Loop detection: инструмент backlog_update_task вызван 3 раза подряд с одинаковыми аргументами — вызов повторно заблокирован… фаза прервана», хотя все изменения задачи уже применены.

Воспроизведение (сессия .vibelog/agent-sessions/agent-1793628348682.jsonl, фаза Spec для VL-302, 7 LLM-запросов, 0 tool-calls рана):
1. backlog_update_task {id, title, type} → ok, applied
2. backlog_update_task {id, priority, type} → ok, applied
3. backlog_update_task {id, labels, type} → ok, applied
4. backlog_update_task {id, type:"feature"} → ok, applied (фактически no-op: type уже feature)
5. то же → ok, applied (снова no-op)
6. то же → Loop detection: вызов заблокирован
7. то же → повторная блокировка → fail, код 1

Причина (подтверждена чтением кода):
- src/mcp/tools.ts:1324-1340 — backlog_update_task всегда выполняет updateTaskFile и возвращает ok:true, даже если переданные значения совпадают с текущими. У модели нет сигнала «работа сделана», она видит «Задача VL-302 обновлена: type» и продолжает вызывать.
- src/agent/loop.ts:890-950 — детектор работает корректно, но по VL-253 вторая блокировка той же сигнатуры = немедленный fail(), независимо от того, что эффект вызова уже достигнут. Итог: фаза формально упала, хотя title/type/priority/labels записаны.
- Промпт-фикс VL-292 (templates/phases/phase-spec.md, шаг 5: «ОДНИМ вызовом», «читай applied») на месте, но модель его игнорирует — текстовые директивы не дают обратной связи о состоянии.

Ожидаемое поведение: no-op write-вызов возвращает явный маркер noop и модель переходит к backlog_finish_phase; повтор уже применённого вызова не убивает фазу.

Вне scope: templates/phases/prompt.md не трогать (решение пользователя).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backlog_update_task при вызове, где все переданные поля уже имеют запрошенные значения, НЕ пишет файл и возвращает {ok: true, noop: true} с сообщением «Изменений нет: <поля> уже имеют эти значения. Не повторяй вызов — переходи к следующему шагу (backlog_finish_phase)»
- [x] #2 Loop detection не прерывает фазу (fail) на повторной блокировке сигнатуры, чей предыдущий результат был ok/noop: модели уходит директива «вызов уже применён, переходи к отчёту», фатальный счётчик не растёт
- [x] #3 Регресс-тест: сессия agent-1793628348682 (Spec VL-302, 6× backlog_update_task с повтором {id, type}) воспроизводится в тесте — фаза завершается без fail, лишние вызовы не исполняются
- [x] #4 Тесты проходят (pnpm test), документация обновлена (README — контракт ответа write-инструментов: noop; doc-10 §6 loop detection)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-303 (no-op write-вызов → маркер noop; loop detection не убивает фазу)

### Диагноз (подтверждён чтением кода)
- `src/mcp/tools.ts:1324-1340` (`toolUpdateTask`): `updateTaskFile` вызывается всегда, ответ — `ackOk("Задача X обновлена: type")` даже когда `type` уже равен запрошенному. Модель не получает сигнала «работа сделана» и повторяет вызов.
- `src/agent/loop.ts:900-950`: `blockAndPush()` + `blockCounts`/`blockedStreak` → вторая блокировка той же сигнатуры = `fail()`, независимо от того, что эффект вызова уже достигнут (VL-253).
- `src/mcp/tool-result.ts:57` (`ackOk`) — контракт `{ok, message, applied, skipped, idempotentReplay?}`; поля `noop` нет.

### Файлы и правки

**1. `src/mcp/tool-result.ts`** (контракт ответа)
- В `interface WriteAck` добавить `noop?: true` (комментарий: «вызов не изменил состояние — все переданные поля уже имели запрошенные значения; повтор бесполезен»).
- Новая экспортируемая функция `ackNoop(message: string, applied: Record<string, unknown> = {}): string` — возвращает `JSON.stringify({ ok: true, noop: true, message, applied, skipped: [] }, null, 2)`. Отдельная функция, а не 5-й параметр `ackOk`: noop — самостоятельная семантика, и её нельзя случайно получить из общего пути.
- Обновить шапку модуля (перечень форм ответа: успех / noop / отказ / ошибка).

**2. `src/mcp/tools.ts` — `toolUpdateTask` (стр. 1244-1340)**
- После валидации `id` и сборки `updates` (перед `updateTaskFile`, стр. ~1324) добавить проверку «всё уже так»:
  - `const current = getTask(cwd, id)`; если `current` нет — идти прежним путём (ошибку «не найдена» бросает `updateTaskFile`, поведение не меняем).
  - Хелпер `sameValue(field, next, current)` (локальная функция рядом с `parseAcList`):
    - строки/числа — строгое `===` (после нормализации `type` через `normalizeTaskType`, которая уже применена при сборке `updates`);
    - массивы (`labels`, `assignee`, `references`, `lessons`, `modified_files`, `dependencies`) — сравнение как множеств (`Set`), порядок не значим;
    - `acceptanceCriteria` — сравнение по текстам в порядке + все пункты `checked === false` (переданный чеклист всегда создаётся неотмеченным);
    - `parent_task_id` — `===` (пустая строка = сброс, тоже сравнивается);
    - секции тела (`implementationPlan`/`implementationNotes`/`finalSummary`) — `===` по строке.
  - `append_notes` — **никогда** не noop (дописывание всегда меняет файл): если `args.append_notes !== undefined`, проверку noop пропускаем целиком.
  - Если все ключи `updates` совпали: **не вызывать** `updateTaskFile` (файл и `updated_date` не трогаются) и вернуть
    `ackNoop('Изменений нет: ' + Object.keys(updates).join(', ') + ' уже имеют эти значения. Не повторяй вызов — переходи к следующему шагу (backlog_finish_phase)', appliedFromCurrent)`.
    `applied` заполняется значениями из `current` (как в обычном пути — фактическое состояние).
  - Иначе — прежний путь без изменений.
- Комментарий в коде: почему noop не пишет файл (AC1) и почему `append_notes` исключён.

**3. `src/agent/loop.ts` — loop detection не убивает фазу на применённом вызове**
- Рядом с `blockCounts`/`blockedTotal` (стр. ~440-450) добавить:
  - `const appliedSignatures = new Set<string>()` — сигнатуры, чей вызов **успешно выполнен** и вернул JSON с `ok: true` (включая `noop: true`);
  - `let appliedRepeatCount = 0` + константа `MAX_APPLIED_REPEATS_PER_RUN = 3` (рядом с `MAX_BLOCKED_CALLS_PER_RUN`, стр. 288) — защита от вечного повтора уже применённого вызова: сами директивы не должны крутиться бесконечно.
- После выполнения вызова (там, где `output` уже получен и `toolError` известен, стр. ~1040-1060): если `!toolError` — попытаться `JSON.parse(output)`; при `parsed.ok === true` добавить `signature` в `appliedSignatures`. Парсинг в `try/catch`, ошибки молча игнорируются (текстовые ответы внешних MCP-инструментов не должны ломать цикл).
- Новая экспортируемая функция `appliedNoopDirective(name: string): string` (рядом с `loopDetectionDirective`, стр. 327): текст «Вызов <name> уже применён ранее (ответ ok/noop) — повтор с теми же аргументами ничего не изменит. Следующий шаг: переходи к отчёту — backlog_finish_phase (или к следующему шагу плана).» Маркерная подстрока «уже применён» — для тестов.
- В `blockAndPush()` (стр. ~905): если `appliedSignatures.has(signature)` — **не** инкрементировать `blockedStreak`/`blockCounts`/`blockedTotal` (фатальный счётчик не растёт, AC2), вместо `loopDetectionDirective` отдать `appliedNoopDirective(call.name)`, инкрементировать `appliedRepeatCount`; при `appliedRepeatCount > MAX_APPLIED_REPEATS_PER_RUN` — `fail()` с текстом «модель N раз повторила уже применённый вызов <name> — фаза прервана» (защита от бесконечности, не путать с loop detection).
- В обеих ветках `fail` (стр. 923 и 944) добавить условие `&& !appliedSignatures.has(signature)` — повтор применённого вызова фазу не прерывает.
- Обновить шапку модуля/комментарии у констант (почему применённый вызов — не луп).

**4. Тесты**
- `src/mcp/write-ack.test.mjs` (+4 кейса, mkdtemp уже есть):
  1. `backlog_update_task {id, type}` дважды: второй ответ `{ok:true, noop:true}`, `message` содержит «Изменений нет» и «backlog_finish_phase»; `updated_date` задачи не изменился (файл не переписан).
  2. Частичное совпадение (`{title: тот же, priority: новый}`) → обычный `ok:true` без `noop`, `applied` содержит оба поля.
  3. `labels` в другом порядке → `noop:true` (сравнение как множеств).
  4. `append_notes` с тем же текстом → **не** noop (файл дописан).
- `src/agent/loop.test.mjs` (+1 регресс-тест, `describe('runLoop loop detection (VL-83)')`): инструмент-заглушка возвращает `JSON.stringify({ok:true, noop:true, message:'Изменений нет'})`; сценарий сессии `agent-1793628348682` — 6 ходов: 3 вызова с разными аргументами (`{id,title}`, `{id,priority}`, `{id,labels}`), затем 3× `{id, type}` (одинаковая сигнатура), финал — текст. Ожидание: `is_error === false`, `toolState.calls === 3` (лишние вызовы не исполняются), в `messages` есть tool-результат с «уже применён» для 4-го вызова, `blocked_signatures` не содержит применённую сигнатуру.
- Проверить, что существующие тесты VL-253 (fail на повторной блокировке) остаются зелёными: их заглушка возвращает `ok:t` (не JSON) → `appliedSignatures` не пополняется → поведение прежнее.

**5. Документация**
- `README.md` — раздел «Контракт ответа write-инструментов»: добавить `noop: true` (что значит, что файл не переписан, что делать модели).
- `backlog/docs/doc-8-...` §«Контракт ответа write-инструментов (VL-262)» — тот же пункт + пример JSON.
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` §6 (стр. 365-380): строка про loop detection — «повтор сигнатуры, чей вызов уже вернул `ok:true`/`noop:true`, фазу не прерывает: модели уходит директива «уже применён, переходи к отчёту», фатальный счётчик не растёт; кап `MAX_APPLIED_REPEATS_PER_RUN = 3`».

### Порядок действий
1. `src/mcp/tool-result.ts` — `noop` + `ackNoop`.
2. `src/mcp/tools.ts` — сравнение в `toolUpdateTask` + `sameValue`.
3. `src/agent/loop.ts` — `appliedSignatures`, `appliedNoopDirective`, правки `blockAndPush` и двух `fail`-веток.
4. Тесты (write-ack, loop).
5. Документация (README, doc-8, doc-10).
6. `pnpm build && pnpm test:fast` (итерации), затем полный `pnpm test` перед DoD.

### Как проверить
- `pnpm build` — сборка без ошибок TS.
- `pnpm test:fast` — целевые файлы: `src/mcp/write-ack.test.mjs`, `src/agent/loop.test.mjs`, `src/mcp/tool-result.test.mjs`, `src/mcp/server.test.mjs`.
- Полный `pnpm test` (обязателен для DoD «Тесты проходят»).
- Ручная проверка контракта: `node -e` с `handleToolCall('backlog_update_task', {id, type})` дважды на mkdtemp-проекте — второй ответ `noop:true`.

### Риски
- **Ложный noop** при неверном сравнении (порядок массивов, `type`-нормализация, AC с `checked`): митигация — сравнение массивов как множеств, `type` сравнивается уже нормализованным, AC — по текстам + все неотмечены; тесты 2-4 покрывают.
- **`updated_date` не обновляется при noop** — следствие AC1 («НЕ пишет файл»); сортировка по `updated` не сдвинется, это ожидаемо.
- **`appliedSignatures` только для JSON-ответов с `ok:true`** — текстовые ответы (внешние MCP) не считаются применёнными; строгий `JSON.parse` в `try/catch`, ложных срабатываний нет.
- **Вечный повтор применённого вызова** — закрыт капом `MAX_APPLIED_REPEATS_PER_RUN = 3` (fail с отдельным текстом, не «Loop detection»).
- **Регресс VL-253** — существующие тесты проверяют fail на повторной блокировке с не-JSON ответом; условие `!appliedSignatures.has(signature)` их не затрагивает (проверяется прогоном).
- Вне scope: `templates/phases/prompt.md` не трогаем (решение пользователя).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 17:35
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic) — план записан в саму задачу VL-303.
Изучено: `src/mcp/tools.ts` (`toolUpdateTask`, стр. 1244-1340), `src/mcp/tool-result.ts` (контракт `ackOk`/`WriteAck`), `src/agent/loop.ts` (loop detection: `blockAndPush`, `blockCounts`/`blockedStreak`/`blockedTotal`, `MAX_BLOCKED_CALLS_PER_RUN`, `loopDetectionDirective`), тесты `src/agent/loop.test.mjs` (VL-251/VL-253 кейсы) и `src/mcp/write-ack.test.mjs`, документация README/doc-8/doc-10 §6.
План (5 файлов кода/тестов + 3 документа):
1. `src/mcp/tool-result.ts` — поле `noop?: true` в `WriteAck` + новая `ackNoop(message, applied)`.
2. `src/mcp/tools.ts` — в `toolUpdateTask` сравнение `updates` с текущей задачей (`sameValue`: строки `===`, массивы как множества, AC по текстам + все неотмечены, `type` уже нормализован); при полном совпадении файл НЕ пишется, ответ `{ok:true, noop:true}` с текстом «Изменений нет: … Не повторяй вызов — переходи к следующему шагу (backlog_finish_phase)». `append_notes` исключён из noop.
3. `src/agent/loop.ts` — `appliedSignatures` (сигнатуры, чей вызов вернул JSON `ok:true`), `appliedNoopDirective()` («уже применён, переходи к отчёту»), в `blockAndPush` для применённой сигнатуры фатальные счётчики не растут, обе `fail`-ветки получают условие `!appliedSignatures.has(signature)`; кап `MAX_APPLIED_REPEATS_PER_RUN = 3` против вечного повтора.
4. Тесты: +4 в `src/mcp/write-ack.test.mjs` (noop, частичное совпадение, порядок labels, append_notes), +1 регресс в `src/agent/loop.test.mjs` — сценарий сессии `agent-1793628348682` (6 вызовов, повтор `{id,type}`): `is_error === false`, лишние вызовы не исполняются.
5. Документация: README (контракт write-инструментов — `noop`), doc-8 §«Контракт ответа write-инструментов», doc-10 §6 (loop detection не прерывает фазу на применённом вызове).
Проверка: `pnpm build`, `pnpm test:fast` по целевым файлам, полный `pnpm test` перед DoD. Риски: ложный noop при неверном сравнении (покрыт тестами), `updated_date` не обновляется при noop (следствие AC1), регресс VL-253 (проверяется прогоном — заглушки VL-253 возвращают не-JSON). Вне scope: `templates/phases/prompt.md` не трогаем.
---
author: @agent
created: 2026-11-02 17:43
---
Фаза 3 (Code) выполнена. Коммит `0197c9f` — «feat: VL-303 — no-op write-вызов отвечает noop, повтор применённого вызова не убивает фазу».
Изменено (5 файлов, +255/−1):
1. `src/mcp/tool-result.ts` — поле `noop?: true` в `WriteAck`, новая экспортируемая `ackNoop(message, applied)`; шапка модуля описывает четыре формы ответа (успех / noop / отказ / ошибка).
2. `src/mcp/tools.ts` — в `toolUpdateTask` перед `updateTaskFile` проверка «всё уже так»: хелпер `sameValue(field, next, current)` (массивы-множества `labels`/`assignee`/`references`/`lessons`/`modified_files`/`dependencies` — порядок не значим; `acceptanceCriteria` — по текстам + все текущие неотмечены; остальное `===`, `type` уже нормализован). При полном совпадении файл НЕ пишется (`updated_date` не трогается), ответ `{ok:true, noop:true}` с текстом «Изменений нет: <поля> уже имеют эти значения. Не повторяй вызов — переходи к следующему шагу (backlog_finish_phase)». `append_notes` исключён из noop (дописывание всегда меняет файл).
3. `src/agent/loop.ts` — `appliedSignatures` (сигнатуры, чей вызов вернул JSON `ok:true`, включая `noop:true`; парсинг в `try/catch`, текстовые ответы внешних MCP не ломают цикл), `appliedNoopDirective(name)` («уже применён … переходи к отчёту — backlog_finish_phase»), в `blockAndPush` для применённой сигнатуры фатальные счётчики (`blockedStreak`/`blockCounts`/`blockedTotal`) не растут, обе `fail`-ветки получили условие `!appliedSignatures.has(signature)`; кап `MAX_APPLIED_REPEATS_PER_RUN = 3` с отдельным текстом fail (не «Loop detection»).
4. `src/mcp/write-ack.test.mjs` — +4 кейса (AC1: повтор → `noop:true` + `updated_date` не изменился; частичное совпадение → обычный успех; `labels` в другом порядке → noop; `append_notes` никогда не noop).
5. `src/agent/loop.test.mjs` — +1 регресс-тест (AC3): сценарий сессии `agent-1793628348682` — 6 вызовов `backlog_update_task` (3 разных + 3× `{id, type}`), заглушка отвечает `{ok:true, noop:true}`; `is_error === false`, повторы не исполняются (4 исполнения из 6), директива «уже применён» приходит tool-результатом, `blocked_signatures` пуст.
Проверки:
- `pnpm build` — успешно.
- `npx vitest run src/mcp/write-ack.test.mjs src/agent/loop.test.mjs src/mcp/tool-result.test.mjs` — 123 passed.
- Полный `pnpm test` — 144 файла passed, 1 failed: `src/web/readme-standard.test.mjs` («README должен начинаться с H1»). **Падение предсуществующее**: проверено прогоном того же теста на родительском коммите `281f790` (master tip) — падает так же; README начинается с `<p align="center">`, мой diff README не касается. Исключённых/пропущенных тест-файлов нет, прогон полный (2700 passed, 4 skipped).
Что осталось (для фазы Close): документация — по правилам фазы Code `backlog/docs/*` и README в Code не правятся. Нужно в Close: doc-8 §«Контракт ответа write-инструментов» — пункт `noop: true` + пример JSON; doc-10 §6 — «повтор сигнатуры, чей вызов уже вернул `ok:true`/`noop:true`, фазу не прерывает: директива «уже применён, переходи к отчёту», фатальный счётчик не растёт, кап `MAX_APPLIED_REPEATS_PER_RUN = 3`»; README — только правка существующей строки/ссылки (расширять нельзя, лимит 150 строк). AC4 поэтому не отмечен (тесты — да, документация — нет). DoD «Тесты проходят» не отмечен: полный прогон содержит предсуществующее падение README-теста (не регресс этой задачи).
---
author: @agent
created: 2026-11-02 17:47
---
Фаза close не удалась (код выхода 1): т, блокировок=0, payload последнего запроса=169207 байт (макс 169207), usage={"input_tokens":753504,"output_tokens":3084,"cache_read_input_tokens":731648,"total_tokens":756588,"reasoning_tokens":1321} — статус возвращён к Review.
---
author: @agent
created: 2026-11-02 17:57
---
Фаза Close выполнена. Ветка `vb/vl-303` слита в master коммитом merge `badd20d` (1 коммит кода `0197c9f`), worktree `.vibelog/worktrees/vl-303` удалён (force — только untracked симлинк `backlog/references/data` и ignored `dist/`/`node_modules/`), ветка `vb/vl-303` удалена.
**Документация (шаг 8, коммит `b8ee8bb` «docs: VL-303 — контракт noop в doc-8, loop detection в doc-10, CHANGELOG»):**
- `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` §«Контракт ответа write-инструментов (VL-262)» — новый пункт `noop: true` (файл не переписан, `updated_date` не сдвинулся, что делать модели) + пример JSON и описание семантического сравнения полей (`labels`-множества, AC по текстам, `append_notes` из noop исключён).
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` §6 — новый буллет «Повтор уже применённого вызова фазу не прерывает (VL-303)»: `appliedSignatures`, директива «уже применён — переходи к отчёту», фатальные счётчики не растут, кап `MAX_APPLIED_REPEATS_PER_RUN = 3`, не-JSON ответы внешних MCP применёнными не считаются.
- `CHANGELOG.md` (Unreleased → Исправлено) — запись VL-303 с причиной, правками и тестами.
- `README.md` — правка одной существующей строки таблицы документации (упоминание `noop` в описании MCP-справочника); витрина не расширялась (90 строк, лимит 150).
**Lessons:** создан `lesson-173` («Возвращай no-op write-вызову маркер noop и не убивай фазу повтором уже применённого вызова»), связан с задачей; коммит `437bb5a`.
**Проверки после merge:** `pnpm build` — OK. Точечный фильтр по diff'у (`src/mcp/write-ack.test.mjs`, `src/agent/loop.test.mjs`, `src/mcp/tool-result.test.mjs`, `src/mcp/server.test.mjs`) — 160 passed. Полный `pnpm test` — 145 файлов: 144 passed, 1 failed — `src/web/readme-standard.test.mjs` («README должен начинаться с H1»). Падение **предсуществующее, не регрессия**: README на родительском коммите `HEAD^1` (`281f790`) начинается с `<p align="center">` так же, diff merge файла `README.md` не касается (`git diff --name-only HEAD^1..HEAD` — только 5 файлов src); параллельного vitest не было (`ps aux | grep vitest` — 0). Итого 2700 passed, 4 skipped, исключённых/пропущенных тест-файлов нет, повторный полный прогон не требовался.
DoD: «Тесты проходят» отмечен по полному прогону (единственное падение — предсуществующий README-тест, воспроизведён на родительском коммите); «Документация обновлена» — doc-8, doc-10, README, CHANGELOG; «Нет регрессий» — новых падений 0. AC4 отмечен (тесты + документация).
---
<!-- COMMENTS:END -->