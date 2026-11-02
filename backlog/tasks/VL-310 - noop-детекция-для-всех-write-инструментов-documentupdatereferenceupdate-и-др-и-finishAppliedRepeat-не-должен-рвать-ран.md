---
id: VL-310
title: noop-детекция для всех write-инструментов (document_update/reference_update и др.) и finishAppliedRepeat не должен рвать ран
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 23:55'
updated_date: '2026-11-03 00:15'
due_date: ''
labels:
  - agent
  - mcp
  - noop
  - loop
  - auto-report
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons:
  - lesson-176
token_usage:
  input: 17986990
  output: 181115
  cache: 17292288
  total: 18168105
  requests: 208
  duration_ms: 1067431
  reasoning: 116391
  by_phase:
    code:
      input: 16424663
      output: 172749
      cache: 15876608
      requests: 175
    close:
      input: 1562327
      output: 8366
      cache: 1415680
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Симптом (сессия agent-1793637056809, Code VL-124): фаза завершилась кодом 0 с текстом «Изменения применены, модель зациклилась на уже применённом вызове document_update — ран завершён штатно», при 4 tool-calls и 5 LLM-запросах. Реально было 20+ вызовов `document_update {id:'doc-2', type:'guide'}` — поле `type` в документе УЖЕ было `guide`, то есть вызов не менял ничего. Payload вырос с 267 662 до 394 156 байт, ни документ, ни задача не были доработаны.

Причины (по коду):
1. `toolDocumentUpdate` (`src/mcp/tools.ts:2283`) не имеет noop-детекции — она реализована только у двух инструментов из всех write-инструментов MCP: `backlog_update_task` (`tools.ts:1341`) и `lesson_update` (`tools.ts:2520`). Поэтому `document_update` на неизменяющих аргументах отвечает `ackOk` — модель теряет сигнал «изменений нет» и повторяет вызов, пытаясь добиться эффекта.
2. `src/agent/loop.ts:1179-1200`: ответ `ok:true` → сигнатура попадает в `appliedSignatures`; первый же повтор → `blockAndPush()` + `finishAppliedRepeat()` (`loop.ts:663`) — ран завершается `is_error:false` («штатно»). VL-309 развёл `ok` и `noop`, но noop появляется только там, где инструмент его ВОЗВРАЩАЕТ; для document_update он не возвращается никогда, и ран обрывается на повторе «пустого» вызова.

Цель: (а) любой write-инструмент MCP, у которого переданные поля совпадают с текущими, отвечает noop — модель получает «изменений нет, переходи к следующему шагу»; (б) повтор уже применённого вызова не обрывает ран терминально, а отдаёт директиву и продолжает цикл — фаза доходит до отчёта/следующих шагов; исчерпание капа — честный fail с откатом статуса.

Входные данные: VL-303/VL-304 (appliedSignatures, finishAppliedRepeat), VL-306 (единый JSON-ack, `ackNoop`, `sameValue` в tools.ts:1375), VL-309 (noopSignatures, MAX_NOOP_REPEATS_PER_RUN, гейт isTerminalStatus в авто-отчёте), VL-124 (пострадавшая задача).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 document_update при аргументах, не меняющих состояние, отвечает {ok:false, noop:true, reason:'noop'} через ackNoop (не переписывает файл, updated_date не сдвигается)
- [x] #2 Инвариант «каждый write-инструмент MCP умеет noop» закреплён тестом: новый write-инструмент без noop-детекции валит write-ack-contract.test.mjs (по образцу инварианта списка инструментов)
- [x] #3 reference_update и остальные write-инструменты MCP с полями-значениями (milestone_rename и т.п.) получают ту же семантику либо явно задокументированы как noop-неприменимые в комментарии/списке-исключении теста
- [x] #4 Повтор уже применённого вызова (appliedSignatures) НЕ завершает ран терминально: модели уходит директива «изменения применены — переходи к отчёту (backlog_finish_phase)», цикл продолжается; кап MAX_APPLIED_REPEATS_PER_RUN, исчерпание — fail() с is_error:true (оркестратор откатит статус)
- [x] #5 Регресс-тест на сессию agent-1793637056809: 20+ повторов document_update {id,type} → ран не обрывается на 4-м вызове, модель доходит до следующего шага/отчёта; payload не растёт линейно
- [x] #6 pnpm build и полный pnpm test зелёные; поведение зафиксировано в CHANGELOG и doc-10 §6
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-310

### Диагноз (подтверждён транскриптом agent-1793637056809)

| Место | Что сейчас | Что нужно |
|---|---|---|
| `src/mcp/tools.ts:2283` `toolDocumentUpdate` | Всегда `ackOk` — noop-детекции нет | Сверка переданных полей с текущими (`title`/`content`/`type`/`tags`) → `ackNoop('Изменений нет: … уже имеют эти значения. Следующий шаг: …')`, файл НЕ перезаписывается |
| `tools.ts:1341` `backlog_update_task`, `tools.ts:2520` `lesson_update` | noop есть (эталон) | Вынести общую сверку в хелпер, переиспользовать (lesson-37: не копипаста) |
| `src/agent/loop.ts:1096` и далее `if (appliedSignatures.has(signature)) { … return finishAppliedRepeat(call.name); }` | Терминальный выход на первом повторе | Директива + продолжение цикла; кап `MAX_APPLIED_REPEATS_PER_RUN = 3`; исчерпание → `fail()` |
| `src/agent/loop.ts:663` `finishAppliedRepeat` | Единственный способ «доотчитаться» | Оставить только для случая «отчёт уже записан» (проверка комментария `@agent` за текущий ран, как guard в `src/agent/auto-report.ts`) |

### Файлы и порядок

1. `src/mcp/tool-result.ts` — экспортировать `sameFieldsUpToDate(current, updates)` (или перенести туда `sameValue` из `tools.ts:1375`), семантика массивов — как множества (уже так в `backlog_update_task`).
2. `src/mcp/tools.ts` — `toolDocumentUpdate`: сверка → `ackNoop`; затем `toolReferenceUpdate` (`:2400`) аналогично; `milestone_rename`/`backlog_update_status` — либо сверка, либо явное исключение с комментарием-обоснованием.
3. `src/agent/loop.ts` — заменить `return finishAppliedRepeat(...)` на директиву `appliedNoopDirective` + счётчик `appliedRepeatCount`; новый кап; `fail()` при исчерпании. Ветку ok:true (`appliedSignatures`) НЕ ломать: сам вызов исполняется как обычно.
4. Тесты:
   - `src/mcp/write-ack.test.mjs` — `document_update {id, type:'guide'}` дважды → второй noop, `updated_date`/mtime не изменились;
   - `src/mcp/write-ack-contract.test.mjs` — инвариант: каждый write-инструмент, объявленный noop-способным (список-исключение в тесте), отвечает `{ok:false, noop:true}` на повторной идентичной записи; новый инструмент без покрытия валит тест;
   - `src/agent/loop.test.mjs` — регресс на сессию `agent-1793637056809`: 20+ повторов `document_update` → ран не обрывается на 4-м вызове, модель доходит до финального текста; кап: >3 повторов → `is_error:true`.
5. Документация: `CHANGELOG.md` (Unreleased), `backlog/docs/doc-10` §6 (абзац «noop универсален; повтор применённого вызова не терминален»), при необходимости doc-8 (§контракт write-инструментов).

### Как проверить

```bash
pnpm build && pnpm test            # полный прогон один раз
node -e "import('./dist/mcp/tools.js').then(async m=>{const a={id:'doc-2',type:'guide'};console.log(await m.handleToolCall('document_update',a));console.log(await m.handleToolCall('document_update',a))})"
```
Второй вызов должен вернуть `{"ok":false,"noop":true,"reason":"noop",...}`.

### Риски

- Регресс VL-304 (там ok:true-повтор штатно завершал ран) — тест этого кейса нужно осознанно переписать: теперь ран продолжается. Это изменение поведения, его надо отразить в CHANGELOG.
- `sameFieldsUpToDate` на `content` документа — сравнение длинное (тело целиком); сравнивать по хэшу или длине+равенству, но не через `===` на 100 КБ в цикле.
- Авто-отчёт (VL-309) остаётся второй линией защиты: если кап применённых повторов исчерпан, `fail()` → `is_error:true` → статус откатится.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 00:08
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/mcp/tool-result.ts
- src/mcp/tools.ts
- src/agent/loop.ts
- scripts/tmp-vl310-patch.mjs
- scripts/tmp-vl310-patch2.mjs
- scripts/tmp-vl310-tests.mjs
- scripts/tmp-vl310-loop-tests.mjs
- scripts/tmp-vl310-reset.mjs
- scripts/tmp-vl310-fix.mjs
- I'll start by orienting myself in the project and reading the relevant code sections.
Now let me implement. First, move `sameValue` into `tool-result.ts` and add a shared helper:
Now `toolReferenceUpdate`:
Let me simplify that convoluted url logic:
Превышен лимит --max-requests (80) — фаза прервана…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 695 с, payload 545554 байт_
Незакоммиченные изменения сохранены в ветку: коммит `2be45cd`.
---
author: @agent
created: 2026-11-03 00:08
---
Фаза code не удалась (код выхода 1): окировок=5, payload последнего запроса=545554 байт (макс 545554), usage={"input_tokens":7197910,"output_tokens":82892,"cache_read_input_tokens":6934528,"total_tokens":7280802,"reasoning_tokens":56700} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 00:11
---
Фаза 3 (Code) выполнена. Коммиты: `2be45cd` (WIP предыдущего рана) + **`fd69995`** — `fix: VL-310 — noop-детекция для write-инструментов и повтор применённого вызова не рвёт ран` (из него же убран случайно закоммиченный симлинк `node_modules`).
**Что сделано**
1. `src/mcp/tool-result.ts` — `sameValue` переехал из `tools.ts` (lesson-37: больше не одна копия на инструмент); добавлены общий набор `SET_FIELDS`, ключ тела `BODY_FIELD` (тело документа/reference лежит не в метаданных, а в `entry.body`) и хелпер `sameFieldsUpToDate(current, updates, setFields)` — одна точка noop-сверки для всех write-инструментов.
2. `src/mcp/tools.ts` — noop-детекция добавлена (переданные поля совпадают с текущими → `ackNoop`, файл НЕ перезаписывается):
   - `document_update` (title/type/tags по значениям, `content` — сравнение с телом записи, массивы — как множества);
   - `reference_update` (tags как множество, `description` против тела, `url`/`urls` — по полному упорядоченному набору ссылок, т.к. `normalizeExtraUrls` выкидывает первый url из `urls`);
   - `backlog_update_status`, `backlog_update_dependencies`, `milestone_rename`;
   - `lesson_link`, `reference_link` — сверяются ОБЕ стороны связи (`lesson.linked_tasks ↔ task.lessons`, `reference.linked_tasks ↔ task.references`): расхождение означает, что запись реально что-то чинит.
   - Инструменты, где noop неприменим по природе (create/remove/sync/add/audit/classify), задокументированы списком-исключением в тесте с причиной — AC3.
3. `src/agent/loop.ts`:
   - `finishAppliedRepeat` больше не вызывается на первом повторе: `appliedRepeatOutcome()` отдаёт директиву `appliedNoopDirective` («изменения применены — переходи к следующему пункту/отчёту») и продолжает цикл; терминальный штатный выход остаётся ТОЛЬКО при `reportWritten` (успешный `backlog_finish_phase`/`backlog_add_comment` в этом ране — guard по образцу `src/agent/auto-report.ts`);
   - кап `MAX_APPLIED_REPEATS_PER_RUN = 3` считает СЕРИЮ подряд (сбрасывается любым реально исполненным вызовом, `resetRepeatSeries`) — иначе ран падал на повторе, перемежающемся нормальной работой; исчерпание → честный `fail()` (`is_error:true` → оркестратор откатывает статус);
   - то же для noop-серии (`MAX_NOOP_REPEATS_PER_RUN` теперь считает серию, а не сумму за ран);
   - новый `buildResult()` убирает дублирование полей LoopResult в двух точках завершения.
**Тесты (полный `pnpm test`, без exclude/skip)**: 147 файлов, **2752 passed, 4 skipped** (skipped — предсуществующие в `src/core/frontmatter.test.mjs`), сборка `pnpm build` зелёная.
- `src/mcp/write-ack.test.mjs` (+7 кейсов): document_update — повтор `{id,type}` → noop и mtime файла не изменился; реальное изменение → обычный успех; тот же `content` → noop; reference_update с тегами в другом порядке → noop; `backlog_update_status`/`backlog_update_dependencies`/`lesson_link`/`reference_link` на неизменяющих аргументах → noop.
- `src/mcp/write-ack-contract.test.mjs` (+2 кейса): таблица `NOOP_SCENARIOS` (9 инструментов — повтор обязан дать `{ok:false, noop:true, reason:'noop'}` с «Изменений нет») и инвариант `NOOP_NOT_APPLICABLE` — новый write-инструмент без noop-детекции и без документированной причины валит тест (AC2).
- `src/agent/loop.test.mjs`: кейс VL-304 переписан на новый контракт (повтор применённого вызова → директива, ран доходит до финального текста, вызов не исполняется повторно); новый кейс «исчерпание капа 3 → `is_error:true`»; регресс-тест AC5 на сессию `agent-1793637056809` — 24 хода, повторы `document_update {id:'doc-2',type:'guide'}` перемежаются чтениями: ран не обрывается, доходит до финального текста, документный вызов исполнен ровно 1 раз, директивы <400 байт (payload не растёт линейно); кейс VL-306 (14 повторов `lesson_update`) приведён к новому контракту — вечная серия даёт честный fail.
**Ручная проверка из плана**: `document_update {id:'doc-2',type:'guide'}` дважды подряд → оба раза `{"ok":false,"noop":true,"reason":"noop","message":"Изменений нет: type документа doc-2 уже имеют эти значения…"}`.
**Что осталось (для фазы Close)**: CHANGELOG.md (Unreleased) и doc-10 §6 / doc-8 — по правилам фазы Code документация пишется в Close. Регресс VL-304 осознанно изменён (ран больше не завершается на первом повторе) — это отражено в комментариях кода и должно попасть в CHANGELOG.
---
author: @agent
created: 2026-11-03 00:15
---
Фаза Close выполнена. Ветка vb/vl-310 слита в master (3 коммита: `2be45cd` WIP, `fd69995` основная реализация, `7e12abf` — удалён случайно закоммиченный временный патч-скрипт `scripts/tmp-vl310-fix.mjs`; в worktree оставались только симлинки `node_modules`/`backlog/references/data`, worktree удалена с force, ветка удалена). Merge `--no-ff` прошёл без конфликтов (6 файлов, +705/−109).
**Проверки в главном репо после merge:** `pnpm build` зелёная (один раз); ранний точечный фильтр по diff'у (`src/agent/loop.test.mjs`, `src/mcp/write-ack.test.mjs`, `src/mcp/write-ack-contract.test.mjs`) — 139 тестов passed; полный `pnpm test:fast` (dist уже собран) — **148 файлов, 2760 passed, 4 skipped** (skipped — предсуществующие в `src/core/frontmatter.test.mjs`). Параллельного `vitest` в других worktree не было (проверено `ps aux`).
**Документация (коммит `157832c`)**: CHANGELOG.md (Unreleased → Исправлено, запись VL-310 с явной фиксацией осознанного изменения поведения VL-304), doc-10 §6 (два абзаца переписаны: универсальный noop для write-инструментов + повтор применённого вызова не терминален, кап считает серию), doc-8 (контракт ack: noop приходит от любого write-инструмента, список инструментов и исключений, семантика сравнения). Lessons: lesson-176 (noop-детекция обязательна для каждого write-инструмента, ран не завершается на повторе применённого вызова) — source_tasks и связь с задачей зафиксированы, коммит `c38cefc`.
DoD: 1 «Тесты проходят» — полный прогон зелёный; 2 «Документация обновлена» — CHANGELOG + doc-10 §6 + doc-8; 3 «Нет регрессий» — тесты VL-304/VL-306 осознанно переписаны на новый контракт (поведение изменено намеренно и отражено в CHANGELOG), остальной прогон без падений.
---
<!-- COMMENTS:END -->