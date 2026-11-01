---
id: VL-217
title: 'Пустой ответ модели: диагностика и один повтор вместо мгновенного fail'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 14:11'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - agent
  - core
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
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/cli.test.mjs
lessons:
  - lesson-76
  - lesson-77
token_usage:
  input: 4469466
  output: 89511
  cache: 4252800
  total: 4558977
  requests: 73
  duration_ms: 2793608
  reasoning: 75529
  by_phase:
    spec:
      input: 107381
      output: 3542
      cache: 78464
      requests: 4
    plan:
      input: 1350525
      output: 37515
      cache: 1268864
      requests: 26
    code:
      input: 3011560
      output: 48454
      cache: 2905472
      requests: 43
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-214. Guard VL-110 (src/agent/loop.ts:335) падает с первого раза без диагностики — в stderr/logTail не попадают ни payload, ни признаки истории (пары с пустым id), ни usage (lesson-55: контент-отказы детектируются в точке финализации). Добавить: (1) лог [vibelog-agent] пустой финал: payload=..., сообщений=..., есть-пустые-tool_calls=... для logTail оркестратора; (2) один повтор запроса после санации истории (см. задачу по санации wire); (3) если повтор тоже пуст — падать с текстом ошибки, указывающим на вероятную отравленную историю/отказ провайдера. Учесть порог VL-197 (payload >~140 КБ) как гипотезу в диагностике.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Пустой финал фиксируется stderr-строкой с payload и usage, она доходит до logTail (как строка VL-203).
- [x] #2 При первой пустоте выполняется ≤1 повтор; при повторной пустоте — fail с диагностическим текстом.
- [x] #3 Тесты: мок-ответ пустой → повтор → вторая пустота → is_error; лог содержит payload/usage.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

Guard пустого финала (src/agent/loop.ts:340-350) сейчас падает с первого раза без диагностики. Добавить: (1) stderr-лог в точке пустого финала (payload/сообщений/пустые tool_calls/usage + гипотеза порога VL-197 >~140 КБ), (2) ≤1 повтор запроса после санации wire-истории (VL-216, payload пересобирается на src/agent/loop.ts:314 — повтор = continue цикла, ничего дополнительного строить не надо), (3) при повторной пустоте — fail с диагностическим текстом (отравленная история / отказ провайдера).

## Файлы для изменения

1. `src/agent/loop.ts`
2. `src/agent/loop.test.mjs`
3. `src/agent/cli.test.mjs`
4. `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` (раздел guard'ов, ~строка 308)
5. `CHANGELOG.md` (секция Unreleased)

## Правки по файлам

### 1. src/agent/loop.ts

**а) Стейт** — после `let phantomStreak = 0;` (строка 241):
```ts
// Стейт guard'а пустого финала (VL-217): false — пустой финал ещё не
// повторялся, true — повтор исчерпан (следующая пустота → fail).
let emptyFinalRetried = false;
```

**б) Перехватка guard'а** (строки 345-350, тело `if (!response.text || response.text.trim() === '')`) — вместо прямого `return fail(...)`:

1. Вычислить диагностику (до ветвления):
   - `payload=` + `response.payloadBytes ?? lastPayload ?? 'н/д'` байт; гипотеза VL-197: `>140КБ=да/нет/н/д` (140 * 1024);
   - `сообщений=` + `messages.length`;
   - `есть-пустые-tool_calls=да/нет` — обход messages: `assistant.tool_calls.some(tc => !isValidToolCall(tc))` (`isValidToolCall` уже импортирован) либо `tool` с пустым/нестроковым `tool_call_id`;
   - `usage=` + `JSON.stringify(response.usage)`.
2. `console.error('[vibelog-agent] пустой финал (попытка 1|2): payload=... байт (>140КБ=...), сообщений=..., есть-пустые-tool_calls=..., usage=...')` — по образцу логов llm.ts:950/968 (VL-199): stderr → logTail оркестратора; при активном TUI допустимо (прецедент VL-199).
3. Ветвление:
   - `!emptyFinalRetried` → `emptyFinalRetried = true; continue;` — повтор запроса: payload пересоберётся на строке 314 (компакшн + `sanitizeWireMessages` VL-216 = «санация после которой повтор»); в messages ничего не дописывается (пустой финал не пишет сообщений) — транскрипт чист, onMessage не зовётся;
   - иначе → `return fail(...)` с текстом, который СОХРАНЯЕТ подстроку «Пустой ответ модели» (матчат тесты VL-110 loop.test.mjs:476/487/504) и добавляет: «повтор после санации истории (VL-216/217) тоже пуст — вероятна отравленная история (пары с пустым id) либо отказ провайдера; payload=..., сообщений=..., есть-пустые-tool_calls=..., usage=...».

Порядок guard'ов не менять: пустой финал (345) → high-risk (355) → финализация. Сброс `emptyFinalRetried` не нужен: цикл финализируется сходу (непустой текст → return, tool_calls → финал фазы через другую ветвь) — флаг живёт в пределах одной фазы.

### 2. src/agent/loop.test.mjs — новый describe «Пустой финал: диагностика и один повтор (VL-217)»

Перехват console.error — по образцу llm.test.mjs:474-485 (запомнить origError, перехват, восстановить в finally).

1. **Повтор → вторая пустота → is_error** (AC3): `fakeLlm([{text:''},{text:''}])` → `res.is_error===true`, `state.calls===2` (ровно один повтор), `res.result` содержит «Пустой ответ модели» и упоминание отравленной истории/отказа провайдера; в перехваченном логе есть строка с `пустой финал`, `payload=` и `usage=`.
2. **Повтор успешен**: `fakeLlm([{text:''},{text:'Готово!'}])` → `is_error===false`, `result==='Готово!'`, `state.calls===2`.
3. **payload и гипотеза VL-197 в логе**: сценарий с `payloadBytes: 150000` → лог содержит `150000` и `>140КБ=да`; сценарий без payloadBytes → `н/д`.
4. **Признак отравленной истории**: начальные `messages` содержат пару `assistant(tool_calls id:"") + tool(tool_call_id:"")` → лог содержит `есть-пустые-tool_calls=да`.
5. **Регрессия VL-110**: существующие 4 теста describe «runLoop guard пустого финального ответа» остаются зелёными (fakeLlm с 1 элементом повторяет последний → вторая пустота → fail; текст по-прежнему матчит /Пустой ответ модели/; `seen.length===1` — повтор не пишет сообщений).

### 3. src/agent/cli.test.mjs — интеграционный тест AC1

По образцу VL-203 (строка 669): `llmHandler` возвращает дважды пустой content (`delta:{content:''}` + usage) → `runCli(['comment', ...])` → `code===1`, `stdout` JSON `is_error=true`, **stderr содержит `пустой финал` с `payload=`/`usage=`** (доказательство, что строка доходит до logTail, как строка VL-203).

### 4. backlog/docs/doc-10 (раздел guard'ов финализации, ~строка 308)

Добавить пункт: «Guard пустого финала (VL-217)» — диагностика в stderr в точке пустоты (payload/сообщений/пустые tool_calls/usage, гипотеза порога VL-197 >~140 КБ), ≤1 повтор после wire-санации VL-216, повторная пустота → fail с текстом о вероятной отравленной истории/отказе провайдера. Связать со ссылкой на VL-199/VL-216.

### 5. CHANGELOG.md — запись в [Unreleased] по образцу VL-216 (строка 17).

## Порядок действий

1. loop.ts (стейт → guard → текст fail) → `pnpm build`.
2. loop.test.mjs (5 тестов) → `pnpm test:fast -- src/agent/loop.test.mjs`.
3. cli.test.mjs (AC1-тест) → `pnpm test:fast -- src/agent/cli.test.mjs`.
4. doc-10 + CHANGELOG.
5. Полная проверка: `pnpm test` (build + vitest run).

## Как проверить

```bash
pnpm build && pnpm test:fast -- src/agent/loop.test.mjs && pnpm test:fast -- src/agent/cli.test.mjs
pnpm test   # полный прогон — нет регрессий (DoD 3)
```

## Риски

- **Маркер «Пустой ответ модели»** обязателен в финальном тексте ошибки — его матчат 4 существующих теста VL-110; потеря → регрессия.
- **`--max-requests 1`**: лимит проверяется ДО streamChat (loop.ts:297) — при выставленном лимите 1 повтор упрётся в fail «Превышен лимит --max-requests» после диагностического лога (диагностика при этом уже в stderr — приемлемо; в тестах лимит не выставлять).
- **console.error при активном TUI** — прецедент VL-199 (llm.ts:950 пишет в stderr во время запроса); альтернатива (печатать из cli.ts как строку VL-203) не даёт диагностику в точке пустоты и не покрывает контейнерный путь интерактивного режима.
- **Повтор идентичного payload** при детерминированном провайдере может вернуть ту же пустоту — это ожидаемо (вторая пустота → fail); AC требует именно ≤1 повтор.
- Тип task (не epic) — план в этой задаче, дочерние задачи не создаются.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 14:21
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Пустой ответ модели: диагностика и один повтор вместо мгновенного fail» (был >80 символов). Тип: enhancement. Масштаб: task. Приоритет: Medium (подтверждён предложением из VL-214/materialize). Уточнено: (1) диагностическая строка в stderr — payload (с гипотезой порога >~140 КБ из VL-197), число сообщений, признак пустых tool_calls, usage — доходит до logTail как строки VL-203; (2) ≤1 повтор после санации истории (VL-216), при повторной пустоте — fail с текстом о вероятной отравленной истории/отказе провайдера; (3) AC дополнены проверяемыми формулировками. Контекст VL-214 (расследование сессии vb:agent-1793269309877, doc-15) прочитан: предложение задачи №3 согласовано пользователем. Labels: agent, core. References: нет (внешних источников не упомянуто; VL-214/VL-216/VL-197/lesson-55 — внутренние объекты). Вопросов нет.
---
author: @agent
created: 2026-10-29 16:21
---
Фаза 2 (Plan) выполнена. Тип: task (enhancement) — план записан в задачу. Изучен код: src/agent/loop.ts (guard пустого финала строки 340-350, payload-точка VL-216 строка 314, счётчики стейта строка 241, fail() строка 267), src/agent/llm.ts (isValidToolCall/sanitizeWireMessages, образцы stderr-логов VL-199 строки 950/968), тесты loop.test.mjs (describe VL-110, строки 475-508) и cli.test.mjs (образец AC1-теста VL-203 строка 669), doc-10 (раздел guard'ов ~строка 308), CHANGELOG [Unreleased]. План: 5 файлов — loop.ts (стейт emptyFinalRetried + stderr-лог диагностики payload/сообщений/пустые tool_calls/usage с гипотезой VL-197 >140КБ + ≤1 повтор через continue (payload пересобирается с санацией VL-216) + fail с сохранением маркера «Пустой ответ модели»), loop.test.mjs (+5 тестов AC2/AC3), cli.test.mjs (+1 интеграционный AC1 stderr→logTail), doc-10, CHANGELOG. Порядок, команды проверки (pnpm build / test:fast по файлам / pnpm test) и 5 рисков (маркер VL-110, interaction с --max-requests, console.error при TUI по прецеденту VL-199, детерминизм повтора, отсутствие сброса флага — не нужен) зафиксированы в плане. Дочерние задачи не создавались (не epic). References: нет (внешних источников в задаче не было; весь контекст — внутренние файлы).
---
author: @agent
created: 2026-10-29 16:39
---
Фаза 3 (Code) выполнена. Изменено: src/agent/loop.ts (стейт emptyFinalRetried; guard пустого финала: stderr-лог [vibelog-agent] «пустой финал (попытка N)» с payload/сообщений/есть-пустые-tool_calls/usage и гипотезой >140КБ VL-197; ≤1 повтор через continue — payload пересобирается с компакшном и санацией VL-216; повторная пустота → fail с текстом о вероятной отравленной истории/отказе провайдера с сохранением маркера «Пустой ответ модели» для guard'ов VL-110), src/agent/loop.test.mjs (+5 тестов: две пустоты → is_error с одним повтором и логом payload/usage; успешный повтор; payload 150000 и >140КБ=да; payload=н/д; отравленная пара → есть-пустые-tool_calls=да), src/agent/cli.test.mjs (+1 интеграционный AC1: мок-LM дважды пустой content → exit 1, ровно 2 запроса, обе строки «пустой финал (попытка 1|2)» с payload/usage в stderr → logTail). Коммит 1d78f92 (ветка vb/vl-217, только файлы кода/тестов). Проверки: pnpm build; полный pnpm test:fast — 1528 passed / 4 skipped, регрессий нет (единственное падение reference.test.mjs в одном прогоне — флаки file://-clone, в контрольном полном прогоне зелёный). Что осталось: DoD2 «Документация обновлена» не отмечен — по регламенту Фазы 3 CHANGELOG.md и backlog/docs/doc-10 не обновляются, их допишет Фаза Close (в плане были пункты по doc-10 и CHANGELOG). References: внешние источники не использовались. Lessons: не создавались/не применялись (контекстные уроки задачи учтены в реализации).
---
author: @agent
created: 2026-10-29 17:03
---
Фаза Close выполнена. Ветка vb/vl-217 слита в master (1 коммит 1d78f92, merge 4ed69fc), worktree удалена, ветка удалена; pnpm build + полный pnpm test после merge — зелёные (84 файла, 1521 passed + 4 skipped, плюс static), регрессий нет. Документация: CHANGELOG.md (запись VL-217 в Unreleased) и backlog/docs/doc-10 §6.5 «Guard пустого финала: диагностика и один повтор (VL-217)» — коммит 7795617 (docs: VL-217 — документация и CHANGELOG). Lessons: созданы lesson-76 (сохраняй маркерные подстроки тестов при расширении текста fail) и lesson-77 (диагностику guard'ов пиши console.error в точке срабатывания — доходит до logTail), связаны с задачей — коммит 0c5ba67. DoD: 1 тесты проходят ✓, 2 документация обновлена ✓ (CHANGELOG + doc-10 §6.5), 3 нет регрессий ✓ — все три отмечены. Замечание: существует задача VL-218 (Docs: обновить doc-10 и CHANGELOG после фиксов пустого ответа модели, статус Spec) — её предмет в этой фазе закрыт, потребность в ней стоит пересмотреть. Отчётный хэш docs-коммита: 7795617.
---
<!-- COMMENTS:END -->