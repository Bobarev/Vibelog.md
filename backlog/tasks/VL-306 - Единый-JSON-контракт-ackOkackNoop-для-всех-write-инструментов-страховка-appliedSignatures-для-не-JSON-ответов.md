---
id: VL-306
title: Единый JSON-контракт ackOk/ackNoop для всех write-инструментов + страховка appliedSignatures для не-JSON ответов
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 19:10'
updated_date: '2026-11-02 20:11'
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
  - src/core/tool-classify.ts
  - src/mcp/tools.ts
  - src/mcp/write-ack.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/bot/settings.ts
  - src/bot/settings.test.mjs
  - src/bot/commands.ts
  - src/bot/handlers.ts
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/web/tool-policy.ts
lessons: []
token_usage:
  input: 24632282
  output: 86255
  cache: 24135680
  total: 24718537
  requests: 259
  duration_ms: 2184824
  reasoning: 29262
  by_phase:
    plan:
      input: 7721225
      output: 29094
      cache: 7568896
      requests: 74
    code:
      input: 14683053
      output: 48374
      cache: 14394368
      requests: 131
    close:
      input: 2228004
      output: 8787
      cache: 2172416
      requests: 54
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Симптом: третья волна одной и той же болезни. VL-303 и VL-304 починили noop-детекцию и защиту appliedSignatures, но только для backlog_update_task. Остальные write-инструменты отдают плоский текст, поэтому механизм для них не включается.

Воспроизведение (сессия .vibelog/agent-sessions/agent-1793634687751.jsonl, фаза Close для VL-304, 27 LLM-запросов, 25 tool-calls):
1. lesson_update {id, tags, title, verifiedBy} → «Lesson lesson-174 обновлён: title, tags, verified_by»
2. lesson_update {id, sourceTasks, supersedes, tags, title, verifiedBy} → «обновлён: …»
3. lesson_update {id, sourceTasks, supersedes, verifiedBy} → «обновлён: …»
4-5. тот же вызов → «обновлён: source_tasks, supersedes, verified_by» (no-op, файл переписан)
6. lesson_update {id, title, verifiedBy} → «обновлён»
7-10. lesson_update {id, verifiedBy} → «обновлён: verified_by» (no-op ×4)
11-14. lesson_update {id, title, verifiedBy} → Loop detection → повторная блокировка → fail, код 1

Причина (подтверждена чтением кода):
- src/mcp/tools.ts:2447-2467 (toolLessonUpdate) возвращает `Lesson ${id} обновлён: ${keys} (updated_date: …)` — плоский текст, не ackOk/ackNoop. То же у toolUpdateStatus (:1230), toolDocumentUpdate (:2245), toolReferenceUpdate (:2359), toolLessonLink (:2474), toolLessonSupersede (:2482), toolMilestoneAdd/Rename/Archive (:2141-2197).
- src/agent/loop.ts:1154 — appliedSignatures пополняется только если JSON.parse(output) дал ok:true или noop:true. Текст не парсится → защита finishAppliedRepeat не включается → срабатывает обычный loop detection → fail.
- Итог: механизм VL-304 работает ровно для одного инструмента из десяти.

Побочный ущерб: VL-304 висит в Review (AC5 и DoD «Тесты проходят»/«Документация обновлена» не отмечены, хотя код уже в master); lesson-174 создан с пустым body и linked_tasks: [], но с уже проставленным supersedes: lesson-173 — урок-замена без содержания.

Дополнительно: LoopLimits.loopDetectionRepeat (src/agent/loop.ts:83) объявлен, но не прокидывается ни из CLI (src/agent/cli.ts:799-810), ни из .vibelog/settings.json (src/web/orchestrator.ts:799-800) — порог всегда 3, изменить без правки кода нельзя. Само по себе увеличение порога падение не устраняет (fail наступает на второй блокировке той же сигнатуры), но поле мёртвое и его стоит оживить.

Ожидаемое поведение: любой write-инструмент отвечает JSON-ack, noop-детекция и appliedSignatures работают единообразно, повтор уже применённого вызова завершает фазу штатно.

Связанные: VL-303, VL-304, VL-253, lesson-92, lesson-173, lesson-174.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все write-инструменты MCP возвращают JSON-ack: lesson_update, lesson_link, lesson_supersede, document_update, reference_update, backlog_update_status, milestone_add/rename/archive — через ackOk/ackNoop (как backlog_update_task)
- [x] #2 noop-детекция работает для lesson_update: повтор с теми же аргументами не пишет файл и возвращает ackNoop (ok:false, noop:true, reason:'noop') с текстом «Изменений нет… Следующий шаг: backlog_finish_phase»
- [x] #3 Страховка в src/agent/loop.ts: ответ write-инструмента, который не парсится как JSON при toolError === false, тоже пополняет appliedSignatures — повтор такого вызова завершает фазу штатно (finishAppliedRepeat, is_error:false), а не fail()
- [x] #4 Регресс-тест на сессию agent-1793634687751 (Close VL-304: 14× lesson_update, из них 10 дословных повторов) — фаза завершается без кода 1
- [x] #5 Инвариант-тест по tools/list: каждый write-инструмент из реестра возвращает JSON с полем ok (защита от появления пятого случая)
- [x] #6 loopDetectionRepeat прокинут из CLI/настроек в runLoop (поле уже есть в LoopLimits, но не читается) — флаг --loop-detection-repeat и/или ключ в .vibelog/settings.json
- [ ] #7 Тесты проходят (pnpm test), документация обновлена (README — контракт ответа write-инструментов; doc-10 §6)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-306 (единый JSON-ack для всех write-инструментов + страховка appliedSignatures)

Тип: bug (обычная задача, не epic). План пишется в саму задачу.

### Диагноз (подтверждён чтением кода)

| Место | Что сейчас | Что нужно |
|---|---|---|
| `src/mcp/tools.ts:1230-1234` `toolUpdateStatus` | уже `ackOk` | проверить тестом (AC1) |
| `src/mcp/tools.ts:2141-2150` `toolMilestoneAdd` | `return \`Веха "…" создана.\`` | `ackOk` |
| `src/mcp/tools.ts:2152-2172` `toolMilestoneRename` | плоский текст | `ackOk` |
| `src/mcp/tools.ts:2197-2203` `toolMilestoneArchive` | плоский текст | `ackOk` |
| `src/mcp/tools.ts:2245-2261` `toolDocumentUpdate` | плоский текст | `ackOk` |
| `src/mcp/tools.ts:2359-2372` `toolReferenceUpdate` | плоский текст | `ackOk` |
| `src/mcp/tools.ts:2447-2467` `toolLessonUpdate` | плоский текст, файл переписывается всегда | `ackOk` + noop-детекция |
| `src/mcp/tools.ts:2474-2480` `toolLessonLink` | плоский текст | `ackOk` |
| `src/mcp/tools.ts:2482-2485` `toolLessonSupersede` | плоский текст | `ackOk` |
| `src/agent/loop.ts:1150-1158` | `appliedSignatures` пополняется только при `JSON.parse` → `ok:true`/`noop:true` | + страховка для write-инструментов с не-JSON ответом |
| `src/agent/loop.ts:83,281,451` | `loopDetectionRepeat` объявлен и читается из `options.limits`, но никто не передаёт | прокинуть из CLI/settings |

### Файлы и конкретные правки

**1. `src/core/tool-classify.ts` (новый модуль, ~60 строк)**
- Перенести из `src/web/tool-policy.ts:60-110` (`WRITE_MARKERS`, `READ_MARKERS`, `tokenize`, `isWriteOperation`) без изменения логики.
- Причина: классификатор нужен агенту (`src/agent/loop.ts`), а `src/web/tool-policy.ts` тянет `listTools()` из `src/mcp/tools.ts` — импорт веб-слоя из агентского цикла создал бы лишнюю зависимость (lesson-37: общий модуль вместо копии).
- `src/web/tool-policy.ts`: удалить локальные определения, добавить `export { isWriteOperation } from '../core/tool-classify.js';` — публичный API файла не меняется, `src/web/tool-policy.test.mjs` остаётся зелёным.

**2. `src/mcp/tools.ts` — ackOk для 8 инструментов (AC1)**
- `toolMilestoneAdd` (:2141): `return ackOk(\`Веха "${milestone.name}" создана.\`, { name: milestone.name, description: milestone.description, due_date: milestone.due_date });`
- `toolMilestoneRename` (:2152): `ackOk(\`Веха переименована: ${from} → ${to}. Задач обновлено: ${updatedCount}\`, { from, to, updated_tasks: updatedCount })` — прежняя формулировка сохраняется в `message` (substring-проверки тестов не ломаются).
- `toolMilestoneArchive` (:2197): `ackOk(\`Веха "${args.name}" архивирована.\`, { name: args.name, status: 'archived' })`.
- `toolDocumentUpdate` (:2245): `ackOk(\`Документ ${updated.document.id} обновлён: ${updated.document.title}\`, { id, title, type, tags })` — значения из `updated.document` (после записи).
- `toolReferenceUpdate` (:2359): `ackOk(\`Reference ${entry.reference.id} обновлён: ${Object.keys(updates).join(', ')}\`, { id, tags, url, urls })` — из `entry.reference`.
- `toolLessonUpdate` (:2447): `ackOk(\`Lesson ${entry.lesson.id} обновлён: ${Object.keys(updates).join(', ')} (updated_date: ${entry.lesson.updated_date})\`, applied)` — `applied` собирается по ключам `updates` из `entry.lesson` (для `content` — длина тела, чтобы не раздувать ответ).
- `toolLessonLink` (:2474): `ackOk(<прежний текст>, { lessonId, taskId, action })`.
- `toolLessonSupersede` (:2482): `ackOk(<прежний текст>, { oldId, newId, old_status: 'superseded', new_status: 'active' })`.
- `toolUpdateStatus` (:1230) — уже `ackOk`, правок нет (покрывается тестом AC1).

**3. `src/mcp/tools.ts` — noop-детекция для `lesson_update` (AC2)**
- Обобщить `sameValue` (:1386): добавить 4-й параметр `setFields: readonly string[] = SET_FIELDS` (дефолт — текущий список полей задачи), чтобы уроки передавали свой набор. Существующие вызовы не меняются.
- В `toolLessonUpdate` перед `updateLesson` (после сборки `updates`, до вызова ядра):
  ```
  const current = getLesson(cwd, args.id as string);
  if (current) {
    const LESSON_SET_FIELDS = ['tags', 'source_tasks', 'linked_tasks', 'applies_to'];
    const unchanged = Object.keys(updates).every(key =>
      key === 'content'
        ? updates.content === current.body
        : sameValue(key, (updates as Record<string, unknown>)[key], (current.lesson as unknown as Record<string, unknown>)[key], LESSON_SET_FIELDS));
    if (unchanged) return ackNoop(`Изменений нет: ${Object.keys(updates).join(', ')} уже имеют эти значения. Следующий шаг: backlog_finish_phase (или следующий шаг плана) — повтор этого вызова ничего не изменит.`, applied);
  }
  ```
  `applied` — фактические значения из `current.lesson` (без записи). Файл и `updated_date` не трогаются (симметрия с `toolUpdateTask`, VL-303).
- `kind: null` и `supersedes: ''` сравниваются как `===` (сброс поля — реальное изменение, noop не даёт).

**4. `src/agent/loop.ts` — страховка appliedSignatures (AC3)**
- Импорт: `import { isWriteOperation } from '../core/tool-classify.js';`
- Заменить блок :1150-1158 на:
  ```
  if (!toolError) {
    let applied = false;
    try {
      const parsed = JSON.parse(output) as { ok?: unknown; noop?: unknown } | null;
      if (parsed && typeof parsed === 'object' && (parsed.ok === true || parsed.noop === true)) applied = true;
    } catch { /* не JSON — решает страховка ниже */ }
    // VL-306: страховка для write-инструментов, чей ответ ещё не переведён на
    // JSON-ack (или пришёл текстом). Только ВСТРОЕННЫЕ инструменты (spec !==
    // undefined): внешние MCP (chrome-devtools и пр.) не классифицируются и
    // не должны завершать ран по повтору. Текст-ошибка («Ошибка …») не
    // считается применённой — иначе повтор упавшего вызова закрывал бы фазу.
    if (!applied && spec && isWriteOperation(call.name) && !/^\s*Ошибка/.test(output)) applied = true;
    if (applied) appliedSignatures.add(signature);
  }
  ```
  `spec` уже вычислен выше в цикле (ветка `else if (!spec)`), поэтому доступен.
- `loopDetectionRepeat` уже читается (:451) — правок в loop.ts по AC6 не требуется, только прокидывание.

**5. `src/agent/cli.ts` — флаг `--loop-detection-repeat` (AC6)**
- `AgentOptions` (рядом с `idleTimeoutSec`, :99-103): `loopDetectionRepeat?: number;` + JSDoc.
- `USAGE` (:148, после `--idle-timeout`): `--loop-detection-repeat <N> — сколько одинаковых подряд вызовов считать зацикливанием (дефолт 3)`.
- Парсер (после ветки `--idle-timeout`, :219-227): положительное целое, ошибка `--loop-detection-repeat: ожидается положительное целое, получено: <raw>`.
- `runLoop({ limits: { … } })` (:799-810): `...(opts.loopDetectionRepeat !== undefined ? { loopDetectionRepeat: opts.loopDetectionRepeat } : {})`.

**6. `src/bot/settings.ts` + `src/web/orchestrator.ts` — ключ `loop_detection_repeat` (AC6)**
- `BotSettings` (:33-40): `loop_detection_repeat?: number;` (положительное целое, дефолт агента 3).
- `loadBotSettings`: `const loopDetectionRepeat = readPositiveInt(raw.loop_detection_repeat);` + `...(loopDetectionRepeat !== undefined ? { loop_detection_repeat: loopDetectionRepeat } : {})`.
- `saveBotSettings` patch (:230-250): `loop_detection_repeat: settings.loop_detection_repeat`.
- Новый резолвер рядом с `resolveMaxRequests` (:295-300): `resolveLoopDetectionRepeat(cwd)`.
- `src/web/orchestrator.ts` `spawnLimitFlags` (:795-810): `if (s.loop_detection_repeat !== undefined) flags.push('--loop-detection-repeat', String(s.loop_detection_repeat));` (только для агента `vb` — как остальные флаги).
- `src/bot/handlers.ts` (:776-777, ветка `case 'max-requests': case 'idle-timeout':`): добавить `case 'loop-detection-repeat'` — запись значения, ответ `⚙️ Порог loop detection: N вызовов подряд`; `0` — сброс (как у `max-requests`).
- `src/web/api.ts` (секция валидации настроек, зеркало `max_requests`): ключ `loop_detection_repeat` в GET/PUT — **опционально**, если правка окажется больше 10 строк, вынести в отдельную задачу и зафиксировать в отчёте.

**7. Тесты**
- `src/mcp/write-ack-contract.test.mjs` (новый, AC1+AC5): таблица `{name, args}` для всех write-инструментов (`backlog_update_status`, `milestone_add/rename/archive`, `document_update`, `reference_update`, `lesson_update/link/supersede`), фикстуры в `mkdtempSync` (задача, веха, документ, reference, два lesson'а); для каждого — `JSON.parse(out)` и `assert.equal(typeof ack.ok, 'boolean')` + `assert.ok(ack.message)`. Плюс инвариант: `listTools().filter(t => isWriteOperation(t.name))` ⊆ имена таблицы — новый write-инструмент без ack валит тест (защита от пятого случая).
- `src/mcp/write-ack.test.mjs` (+2 кейса, AC2): повтор `lesson_update {id, verifiedBy}` → `{ok:false, noop:true, reason:'noop'}`, `updated_date` не изменился, файл не переписан (сверка mtime/содержимого); `lesson_update {id, tags: [...]}` с другим порядком тегов → noop (сравнение как множества).
- `src/agent/loop.test.mjs` (+2 кейса, AC3+AC4):
  - регресс сессии `agent-1793634687751`: 14 вызовов `lesson_update` (4 разных + 10 дословных повторов), заглушка возвращает **плоский текст** «Lesson lesson-174 обновлён: …» → `res.is_error === false`, `res.result` содержит «зациклилась на уже применённом вызове», исполнено 4 вызова, `blocked_signatures === undefined`;
  - страховка не срабатывает на текст-ошибку: заглушка возвращает `'Ошибка: Lesson не найден.'` → повтор даёт обычный loop detection (`is_error === true`).
- `src/agent/cli.test.mjs`: `--loop-detection-repeat 5` парсится в `opts.loopDetectionRepeat`; `--loop-detection-repeat 0` → ошибка.
- `src/bot/settings.test.mjs`: чтение/запись `loop_detection_repeat`, битое значение игнорируется.
- `src/web/orchestrator.test.mjs`: `spawnLimitFlags` передаёт `--loop-detection-repeat` при заданном ключе (и не передаёт без него).
- `src/web/tool-policy.test.mjs`: без правок — проверяет, что перенос классификатора не изменил поведение.

**8. Документация (AC7)**
- `README.md` — раздел «Контракт ответа write-инструментов»: перечень инструментов, отдающих JSON-ack (все write-инструменты MCP), `noop` для `lesson_update`, страховка `appliedSignatures` для не-JSON ответов, флаг `--loop-detection-repeat` / ключ `loop_detection_repeat`.
- `backlog/docs/doc-8` §«Контракт ответа write-инструментов (VL-262)» (строка ~108) — через `document_update` в фазе Close: список инструментов, `noop` для `lesson_update`, семантика сравнения полей урока.
- `backlog/docs/doc-10` §6 (строка ~379) — через `document_update` в Close: страховка «не-JSON ответ write-инструмента тоже пополняет `appliedSignatures`» + `loopDetectionRepeat` больше не мёртвое поле.
- `CHANGELOG.md` — запись VL-306 (в Close).

### Порядок действий
1. `src/core/tool-classify.ts` + реэкспорт в `src/web/tool-policy.ts`; `pnpm build && pnpm test:fast` (tool-policy зелёный).
2. `src/mcp/tools.ts`: ackOk для 8 инструментов (шаг 2 плана) → прогон `src/mcp/*.test.mjs`.
3. `src/mcp/tools.ts`: `sameValue` + noop в `toolLessonUpdate` → тесты AC2.
4. `src/agent/loop.ts`: страховка → регресс-тест AC4.
5. `src/agent/cli.ts` + `src/bot/settings.ts` + `src/web/orchestrator.ts` + `src/bot/handlers.ts`: `loopDetectionRepeat`.
6. Новый `src/mcp/write-ack-contract.test.mjs` (AC5).
7. README; `pnpm build && pnpm test` (полный прогон — DoD).

### Как проверить
```
pnpm build
pnpm test:fast -- src/mcp/write-ack.test.mjs src/mcp/write-ack-contract.test.mjs src/agent/loop.test.mjs
pnpm test            # полный прогон, обязателен для DoD
```
Ручная проверка контракта: `node -e "import('./dist/mcp/tools.js').then(async m => console.log(await m.handleToolCall('lesson_update', {id:'lesson-1', verifiedBy:'agent'}, process.cwd())))"` — ожидается JSON с `ok`.

### Риски
1. **Текст → JSON ломает substring-проверки тестов.** Митигация: `ackOk` первым аргументом получает ПРЕЖНЮЮ формулировку, `message` сохраняет «создана/обновлён/переименована» — проверки на подстроку проходят; проверки на точное равенство строки (`assert.equal(out, '…')`) в `src/mcp/*` отсутствуют (проверено grep'ом), но прогон подтвердит.
2. **Страховка appliedSignatures даёт ложные срабатывания** (read-инструмент или внешний MCP завершит ран по повтору). Митигация: только `spec !== undefined` (встроенные инструменты) + `isWriteOperation` + отсев текста, начинающегося с «Ошибка».
3. **Перенос `isWriteOperation` в core** может разъехаться с веб-слоем. Митигация: реэкспорт из `src/web/tool-policy.ts` (единая точка), существующий `tool-policy.test.mjs` — сторож.
4. **noop для `lesson_update` может «съесть» реальное изменение** (например, `kind: null` при уже `null`). Митигация: сравнение по фактическим значениям из `getLesson`, `content` — против `entry.body`; тест на сброс поля.
5. **Счётчики `tools.length`** (44 в `compat-full.test.mjs:184`, `documents.test.mjs:64`, `reference-tools.test.mjs:55`, `server.test.mjs:180`, `doctor.ts:248`) — новых инструментов НЕТ, значения не меняются (lesson-10: проверить прогоном).
6. **`loop_detection_repeat` в веб-API** может потребовать правки фронта (`web/src/components/settings/api.ts`) — если объём вырастет, вынести в отдельную задачу и зафиксировать в отчёте.

### Вне скоупа (зафиксировать в отчёте, не делать)
- VL-304 висит в Review с неотмеченными AC5/DoD — отдельная задача/ручное закрытие, не эта.
- lesson-174 создан с пустым телом и `supersedes: lesson-173` — наполнение урока относится к Close VL-304, не к VL-306.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 19:32
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic) — план записан в саму задачу VL-306.
**Диагноз подтверждён чтением кода** (все точки из описания на месте):
- `src/mcp/tools.ts`: `toolUpdateStatus` (:1230) уже отдаёт `ackOk`; плоский текст у `toolMilestoneAdd` (:2141), `toolMilestoneRename` (:2152), `toolMilestoneArchive` (:2197), `toolDocumentUpdate` (:2245), `toolReferenceUpdate` (:2359), `toolLessonUpdate` (:2447), `toolLessonLink` (:2474), `toolLessonSupersede` (:2482) — 8 инструментов.
- `src/agent/loop.ts:1150-1158`: `appliedSignatures` пополняется только при `JSON.parse` → `ok:true`/`noop:true`; текстовый ответ не парсится → защита `finishAppliedRepeat` не включается.
- `src/agent/loop.ts:83,281,451`: `loopDetectionRepeat` объявлен и читается из `options.limits`, но не передаётся ни из `src/agent/cli.ts:799-810`, ни из `src/web/orchestrator.ts:795-810` — поле мёртвое.
**План (9 файлов + 1 новый модуль + 1 новый тест-файл):**
1. `src/core/tool-classify.ts` (новый) — перенос `isWriteOperation`/`WRITE_MARKERS`/`READ_MARKERS`/`tokenize` из `src/web/tool-policy.ts:60-110`; в `tool-policy.ts` — реэкспорт (единая точка, lesson-37). Нужно, чтобы `src/agent/loop.ts` не импортировал веб-слой.
2. `src/mcp/tools.ts` — `ackOk` для 8 инструментов (прежние формулировки сохраняются в `message`, substring-проверки не ломаются).
3. `src/mcp/tools.ts` — noop-детекция `lesson_update`: обобщение `sameValue` 4-м параметром `setFields` + сверка `updates` с `getLesson` до записи; `content` сравнивается с `entry.body`; `ackNoop` с текстом «Изменений нет… Следующий шаг: backlog_finish_phase».
4. `src/agent/loop.ts` — страховка: не-JSON ответ встроенного write-инструмента (`spec !== undefined` + `isWriteOperation` + отсев текста «Ошибка…») тоже пополняет `appliedSignatures`.
5. `src/agent/cli.ts` — флаг `--loop-detection-repeat` (парсер + USAGE + прокидывание в `runLoop`).
6. `src/bot/settings.ts` + `src/web/orchestrator.ts` + `src/bot/handlers.ts` — ключ `loop_detection_repeat` (чтение/запись/резолвер/флаг `/set`); `src/web/api.ts` — опционально, при объёме >10 строк выносится отдельно.
7. Тесты: новый `src/mcp/write-ack-contract.test.mjs` (AC1+AC5, инвариант по `listTools()` — новый write-инструмент без ack валит тест), +2 кейса в `src/mcp/write-ack.test.mjs` (AC2), +2 в `src/agent/loop.test.mjs` (AC3+AC4, регресс сессии `agent-1793634687751`: 14× `lesson_update` с плоским текстом → `is_error:false`), кейсы в `cli.test.mjs`/`settings.test.mjs`/`orchestrator.test.mjs`.
8. Документация (AC7): README — контракт ответа write-инструментов; doc-8 §«Контракт ответа write-инструментов» и doc-10 §6 — через `document_update` в фазе Close; CHANGELOG — в Close.
**Проверка:** `pnpm build && pnpm test:fast -- <целевые файлы>`, затем полный `pnpm test` (обязателен для DoD).
**Риски (6, в плане):** текст→JSON ломает substring-проверки (митигация — прежние формулировки в `message`); ложные срабатывания страховки (только встроенные write-инструменты + отсев «Ошибка»); рассинхрон классификатора после переноса (реэкспорт + существующий `tool-policy.test.mjs`); noop «съедает» сброс поля (сравнение по фактическим значениям, тест на `kind: null`); счётчики `tools.length` (44 в 4 тестах + `doctor.ts` — новых инструментов нет, значения не меняются, lesson-10); объём правки веб-API.
**Вне скоупа:** VL-304 в Review с неотмеченными AC5/DoD и пустое тело lesson-174 — относятся к Close VL-304, не к этой задаче.
---
author: @agent
created: 2026-11-02 19:48
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/tool-classify.ts
- src/web/tool-policy.ts
- src/mcp/tools.ts
- tmp-patch-vl306.mjs
- tmp-patch2-vl306.mjs
- tmp-patch3-vl306.mjs
- tmp-patch4-vl306.mjs
- tmp-patch5-vl306.mjs
- src/mcp/write-ack-contract.test.mjs
- tmp-patch6-vl306.mjs
- All 6 pass. Now add noop tests for lesson_update and loop tests.
Now the loop tests (AC3+AC4).
Existing loop-detection tests broke: the stub tool `t` is classified as write (fail-safe fallback), so the safety net fired. I need to restrict the net to actual MCP write tools from the registry.
Now CLI/…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 899 с, payload 700027 байт_
Незакоммиченные изменения сохранены в ветку: коммит `9fffc4b`.
---
author: @agent
created: 2026-11-02 19:48
---
Фаза code не удалась (код выхода 1): ировок=5, payload последнего запроса=593992 байт (макс 700027), usage={"input_tokens":10446610,"output_tokens":29933,"cache_read_input_tokens":10292736,"total_tokens":10476543,"reasoning_tokens":3758} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-02 20:01
---
Фаза 3 (Code) выполнена. Коммит `e0d4793` — «fix: VL-306 — единый JSON-ack для всех write-инструментов + страховка appliedSignatures» (15 файлов, +603/−75).
**Что сделано**
1. **`src/core/tool-classify.ts` (новый)** — `isWriteOperation` + `WRITE_MARKERS`/`READ_MARKERS`/`tokenize` перенесены из `src/web/tool-policy.ts` (там остался реэкспорт, публичный API не изменился). Классификатор нужен и веб-слою, и агенту; импорт веб-слоя из `loop.ts` тянул бы `listTools()`.
2. **`src/mcp/tools.ts` — JSON-ack для 8 инструментов (AC1):** `milestone_add`, `milestone_rename`, `milestone_archive`, `document_update`, `reference_update`, `lesson_update`, `lesson_link`, `lesson_supersede` → `ackOk(message, applied)`. Прежние русские формулировки сохранены в `message` — substring-проверки существующих тестов не сломались (полный прогон подтвердил). `backlog_update_status` уже отдавал `ackOk` — покрыт тестом.
3. **noop-детекция `lesson_update` (AC2):** `sameValue` обобщён 4-м параметром `setFields` (набор полей задачи вынесен в константу `SET_FIELDS`); перед записью `updates` сверяются с фактическим уроком (`content` — против `entry.body`, `tags`/`source_tasks`/`linked_tasks`/`applies_to` — как множества). При полном совпадении файл и `updated_date` не трогаются, ответ `ackNoop` с текстом «Изменений нет… Следующий шаг: backlog_finish_phase».
4. **Страховка `appliedSignatures` (AC3):** в `src/agent/loop.ts` не-JSON ответ встроенного write-инструмента тоже пополняет набор. Ограничения (важно): только инструменты из реестра MCP (`isMcpWriteTool` — ленивый кэш `listTools().filter(isWriteOperation)`), только `spec !== undefined` (внешние MCP не участвуют), текст, начинающийся с «Ошибка», не считается применённым. Первая версия использовала «голый» `isWriteOperation` — это ломало 5 существующих тестов loop detection (fail-safe классификатор считает write'ом любую заглушку `t`); ограничение по реестру исправлено и подтверждено прогоном.
5. **`loopDetectionRepeat` оживлён (AC6):** флаг `--loop-detection-repeat <N>` в `src/agent/cli.ts` (парсер + USAGE + прокидывание в `runLoop`), ключ `loop_detection_repeat` в `src/bot/settings.ts` (`BotSettings`, `loadBotSettings`, `saveBotSettings`, `resolveLoopDetectionRepeat`), `/set loop-detection-repeat` в `src/bot/commands.ts` + `src/bot/handlers.ts`, флаг в `spawnLimitFlags` (`src/web/orchestrator.ts`).
**Тесты (AC4, AC5, AC6)**
- `src/mcp/write-ack-contract.test.mjs` (новый, 6 кейсов): AC1 по всем 9 инструментам + инвариант AC5 — `listTools().filter(isWriteOperation)` минус покрытый набор минус явные исключения (`backlog_trigger_phase`/`backlog_auto_queue`/`backlog_supervisor` — инструменты супервизора VL-268, вне скоупа) должен быть пуст: новый write-инструмент без ack валит тест.
- `src/mcp/write-ack.test.mjs` (+3 кейса): noop `lesson_update` (файл и `updated_date` не тронуты), теги в другом порядке → noop, реальное изменение → обычный успех.
- `src/agent/loop.test.mjs` (+3 кейса): регресс сессии `agent-1793634687751` (14× `lesson_update` с плоским текстом → `is_error:false`, исполнено 3 вызова, `blocked_signatures` не появились); текст-ошибка → обычный loop detection; read-инструмент с текстом → обычный loop detection.
- `src/agent/cli.test.mjs` (+3), `src/bot/settings.test.mjs` (+3), `src/web/orchestrator.test.mjs` (проверка `--loop-detection-repeat 7` в argv).
**Проверки:** `pnpm build` — чисто; полный `pnpm test` — **2733 passed, 4 skipped, 1 failed**. Единственное падение — `src/web/readme-standard.test.mjs > документ начинается с H1`: README начинается с `<p align="center">` (логотип), а не с `# `. Падение **предсуществующее на master** и к задаче не относится: README я не менял (`git status` по нему пуст), при откате всех моих правок (`git stash push -- src/`) тест падал так же. Поэтому DoD «Тесты проходят» НЕ отмечен — нужен отдельный фикс README (или теста) вне VL-306.
**Что осталось (для фазы Close):** AC7 в части документации — README (контракт ответа write-инструментов), `doc-8` §«Контракт ответа write-инструментов», `doc-10` §6 (страховка `appliedSignatures` + `loopDetectionRepeat`), CHANGELOG. По правилам фазы Code документация не пишется. Также вне скоупа: VL-304 в Review с неотмеченными AC5/DoD и пустое тело lesson-174.
---
author: @agent
created: 2026-11-02 20:01
---
Фаза 3 (Code) выполнена. Коммит `e0d4793` — «fix: VL-306 — единый JSON-ack для всех write-инструментов + страховка appliedSignatures» (15 файлов, +603/−75).
**Что сделано**
1. **`src/core/tool-classify.ts` (новый)** — `isWriteOperation` + `WRITE_MARKERS`/`READ_MARKERS`/`tokenize` перенесены из `src/web/tool-policy.ts` (там остался реэкспорт, публичный API не изменился). Классификатор нужен и веб-слою, и агенту; импорт веб-слоя из `loop.ts` тянул бы `listTools()`.
2. **`src/mcp/tools.ts` — JSON-ack для 8 инструментов (AC1):** `milestone_add`, `milestone_rename`, `milestone_archive`, `document_update`, `reference_update`, `lesson_update`, `lesson_link`, `lesson_supersede` → `ackOk(message, applied)`. Прежние русские формулировки сохранены в `message` — substring-проверки существующих тестов не сломались (полный прогон подтвердил). `backlog_update_status` уже отдавал `ackOk` — покрыт тестом.
3. **noop-детекция `lesson_update` (AC2):** `sameValue` обобщён 4-м параметром `setFields` (набор полей задачи вынесен в константу `SET_FIELDS`); перед записью `updates` сверяются с фактическим уроком (`content` — против `entry.body`, `tags`/`source_tasks`/`linked_tasks`/`applies_to` — как множества). При полном совпадении файл и `updated_date` не трогаются, ответ `ackNoop` с текстом «Изменений нет… Следующий шаг: backlog_finish_phase».
4. **Страховка `appliedSignatures` (AC3):** в `src/agent/loop.ts` не-JSON ответ встроенного write-инструмента тоже пополняет набор. Ограничения: только инструменты из реестра MCP (`isMcpWriteTool` — ленивый кэш `listTools().filter(isWriteOperation)`), только `spec !== undefined` (внешние MCP не участвуют), текст, начинающийся с «Ошибка», не считается применённым. Первая версия использовала «голый» `isWriteOperation` — это ломало 5 существующих тестов loop detection (fail-safe классификатор считает write'ом любую заглушку `t`); ограничение по реестру исправлено и подтверждено прогоном.
5. **`loopDetectionRepeat` оживлён (AC6):** флаг `--loop-detection-repeat <N>` в `src/agent/cli.ts` (парсер + USAGE + прокидывание в `runLoop`), ключ `loop_detection_repeat` в `src/bot/settings.ts` (`BotSettings`, `loadBotSettings`, `saveBotSettings`, `resolveLoopDetectionRepeat`), `/set loop-detection-repeat` в `src/bot/commands.ts` + `src/bot/handlers.ts`, флаг в `spawnLimitFlags` (`src/web/orchestrator.ts`).
**Тесты (AC4, AC5, AC6)**
- `src/mcp/write-ack-contract.test.mjs` (новый, 6 кейсов): AC1 по всем 9 инструментам + инвариант AC5 — `listTools().filter(isWriteOperation)` минус покрытый набор минус явные исключения (`backlog_trigger_phase`/`backlog_auto_queue`/`backlog_supervisor` — инструменты супервизора VL-268, вне скоупа) должен быть пуст: новый write-инструмент без ack валит тест.
- `src/mcp/write-ack.test.mjs` (+3 кейса): noop `lesson_update` (файл и `updated_date` не тронуты), теги в другом порядке → noop, реальное изменение → обычный успех.
- `src/agent/loop.test.mjs` (+3 кейса): регресс сессии `agent-1793634687751` (14× `lesson_update` с плоским текстом → `is_error:false`, исполнено 3 вызова, `blocked_signatures` не появились); текст-ошибка → обычный loop detection; read-инструмент с текстом → обычный loop detection.
- `src/agent/cli.test.mjs` (+3), `src/bot/settings.test.mjs` (+3), `src/web/orchestrator.test.mjs` (проверка `--loop-detection-repeat 7` в argv).
**Проверки:** `pnpm build` — чисто; полный `pnpm test` — **2733 passed, 4 skipped, 1 failed**. Единственное падение — `src/web/readme-standard.test.mjs > документ начинается с H1`: README начинается с `<p align="center">` (логотип), а не с `# `. Падение **предсуществующее на master** и к задаче не относится: README не менялся (`git status` по нему пуст), при откате всех правок (`git stash push -- src/`) тест падал так же. Поэтому DoD «Тесты проходят» НЕ отмечен — нужен отдельный фикс README (или теста) вне VL-306.
**Что осталось (для фазы Close):** AC7 в части документации — README (контракт ответа write-инструментов), `doc-8` §«Контракт ответа write-инструментов», `doc-10` §6 (страховка `appliedSignatures` + `loopDetectionRepeat`), CHANGELOG. По правилам фазы Code документация не пишется. Также вне скоупа: VL-304 в Review с неотмеченными AC5/DoD и пустое тело lesson-174.
---
author: @agent
created: 2026-11-02 20:10
---
Фаза close не удалась (код выхода 1): блокировок=0, payload последнего запроса=184682 байт (макс 184682), usage={"input_tokens":1068576,"output_tokens":4077,"cache_read_input_tokens":1041408,"total_tokens":1072653,"reasoning_tokens":1593} — статус возвращён к Review.
---
author: @agent
created: 2026-11-02 20:11
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 6 из 7
DoD отмечено: 1 из 3
AC не отмечены (1): 7. Тесты проходят (pnpm test), документация обновлена (README — контракт ответа write-инструментов; doc-10 §6)
DoD не отмечены (2): 1. Тесты проходят; 2. Документация обновлена
Файлы (15): src/core/tool-classify.ts, src/mcp/tools.ts, src/mcp/write-ack.test.mjs, src/mcp/write-ack-contract.test.mjs, src/agent/loop.ts, src/agent/loop.test.mjs, src/agent/cli.ts, src/agent/cli.test.mjs, src/bot/settings.ts, src/bot/settings.test.mjs, …
Фрагмент плана: ## План реализации VL-306 (единый JSON-ack для всех write-инструментов + страховка appliedSignatures) Тип: bug (обычная задача, не epic). План пишется в саму задачу. ### Диагноз (подтверждён чтением кода) | Место | Что сейчас | Что нужно | |---|---|---| | `src/mcp/tools.ts:1230-1234` `toolUpdateStat…
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
---
<!-- COMMENTS:END -->