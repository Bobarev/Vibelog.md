---
id: VL-309
title: 'Close-фаза не доходит до конца: noop-повтор обрывает ран, авто-отчёт ставит терминальный статус при неотмеченных AC/DoD, документация VL-307 не написана'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 23:18'
updated_date: '2026-11-02 23:41'
due_date: ''
labels:
  - agent
  - close
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
modified_files:
  - src/agent/loop.ts
  - src/agent/auto-report.ts
  - src/agent/loop.test.mjs
  - src/agent/auto-report.test.mjs
lessons:
  - lesson-175
token_usage:
  input: 11974313
  output: 61107
  cache: 11484672
  total: 12035420
  requests: 145
  duration_ms: 866526
  reasoning: 30170
  by_phase:
    plan:
      input: 2510059
      output: 13802
      cache: 2373120
      requests: 33
    code:
      input: 6585914
      output: 29979
      cache: 6418944
      requests: 63
    close:
      input: 2878340
      output: 17326
      cache: 2692608
      requests: 49
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Симптом (сессия agent-1793647788155, Close VL-307): фаза завершилась кодом 0 с текстом «Изменения применены, модель зациклилась на уже применённом вызове lesson_update — ран завершён штатно, отчёт будет записан автоматически», но Close фактически не выполнен: документация не написана (в CHANGELOG.md записи VL-307 нет, doc-10 не содержит контракта {{comment}}), AC5 и DoD «Документация обновлена» остались неотмеченными, при этом задача получила статус Done.

Причины (по коду):
1. src/agent/loop.ts:663 (finishAppliedRepeat) + blockAndPush: повтор сигнатуры из appliedSignatures завершает ран штатно. В appliedSignatures попадают и noop-ответы (parsed.noop === true, VL-304), а noop означает «изменений нет», а не «работа сделана». Модель, повторяющая lesson_update с теми же аргументами, обрывает ран вместо продолжения шагов Close.
2. src/agent/auto-report.ts (writeAutoReportIfMissing): авто-отчёт двигает статус по getStatusAfterPhase без проверки неотмеченных AC/DoD. Правило «терминальный статус при невыполненном DoD требует dodOverride» реализовано только внутри backlog_finish_phase (templates/phases/phase-close.md, шаг 5), поэтому авто-отчёт его обходит и ставит Done незакрытой задаче.
3. Документация VL-307 (CHANGELOG + doc-10 §контракт {{comment}}) не написана — Code её по правилам не пишет, а Close до шага 4 не дошёл.

Цель: Close-фаза должна либо доходить до конца, либо честно завершаться аварийным итогом (aborted) — но не «успехом» с невыполненной работой.

Входные данные: VL-307 (Done, AC5/DoD2 не отмечены), VL-303/VL-304 (appliedSignatures, finishAppliedRepeat, авто-отчёт), VL-306 (noop-контракт), VL-308 (сброс лимитов при resume — смежная тема, не дублировать).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 noop-ответ (ok:false, noop:true) не считается «применённым» для finishAppliedRepeat: повтор noop-вызова не обрывает ран, а отдаёт директиву «изменений нет — переходи к следующему шагу» и цикл продолжается (регресс-тест на сессию agent-1793647788155: Close VL-307 доходит до docs-коммита)
- [x] #2 writeAutoReportIfMissing не ставит терминальный статус при неотмеченных AC/DoD: статус остаётся прежним (или ставится нетерминальный), а в отчёте перечислены неотмеченные пункты; поведение покрыто тестом
- [x] #3 Документация VL-307 написана: запись в CHANGELOG.md (Unreleased) и раздел doc-10 о контракте {{comment}} («без комментария» при отсутствии, литерала в промпте не бывает, фолбэк-строки удалены)
- [x] #4 AC5 и DoD «Документация обновлена» у VL-307 отмечены после фактической записи документации
- [x] #5 pnpm build и полный pnpm test зелёные; поведение зафиксировано в doc-10/CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации (VL-309)

Тип: bug. Задача обычная (не epic) — план в этой же задаче.

### Диагноз по коду (подтверждён чтением)

1. `src/agent/loop.ts:1177-1179` — `parsed.ok === true || parsed.noop === true` → сигнатура попадает в `appliedSignatures`. Noop означает «изменений нет», а не «работа сделана», но трактуется как применённый вызов. Плюс страховка VL-306 (`:1194`) помечает применённой ЛЮБУЮ запись встроенного write-инструмента с не-JSON ответом — и тоже без разбора noop.
2. `src/agent/loop.ts:992-1024,1039-1041,1056-1057` — четыре ветки `appliedSignatures.has(signature)` вызывают `finishAppliedRepeat()` (`:660`), т.е. ран завершается `is_error:false` на первом же повторе noop-вызова. Именно это случилось в Close VL-307 (сессия `agent-1793647788155`: повтор `lesson_update` → штатное завершение без документации).
3. `src/agent/auto-report.ts:100-113` — `getStatusAfterPhase` применяется без проверки неотмеченных AC/DoD; правило VL-248 (`isTerminalStatus` + `dodOverride`) живёт только в `src/mcp/tools.ts:1808-1856` внутри `backlog_finish_phase`. Поэтому авто-отчёт поставил Done задаче VL-307 с неотмеченными AC5/DoD2.

### Файлы и точечные правки

**1. `src/agent/loop.ts`**

- `:490-492` — рядом с `const appliedSignatures` добавить `const noopSignatures = new Set<string>()` с комментарием: noop — «изменений нет», повтор такого вызова не завершает ран, а лишь напоминает перейти к следующему шагу.
- `:312-320` (блок комментариев про удалённый кап) — добавить `const MAX_NOOP_REPEATS_PER_RUN = 2` с пояснением: страховка от вечного круга «noop-директива → повтор»; при превышении — честный `fail()` (is_error:true → оркестратор откатит статус), а не «успех».
- `:364-380` — новая экспортируемая `noopRepeatDirective(name: string): string`: текст «Изменений нет: вызов `<name>` с теми же аргументами ничего не изменит. Следующий шаг: переходи к следующему пункту фазы (правки/документация), не повторяя этот вызов.» Маркер «Изменений нет» — для тестов и разбора сессий; `appliedNoopDirective` остаётся для ветки реально применённого (ok:true) вызова.
- `:987-1000` (`blockAndPush`) — первая проверка становится: если `noopSignatures.has(signature)` → `pushMessage({role:'tool', tool_call_id, content: noopRepeatDirective(call.name)})`, `noopRepeatCount++`, НЕ трогать `blockedStreak/blockCounts/blockedTotal`, вернуть флаг «noop-повтор»; затем существующая ветка `appliedSignatures`. Сигнатуру `blockAndPush` расширить возвратом `{ noop: boolean }` (или отдельный предикат `isNoopRepeat(signature)`).
- `:1021-1041,1054-1058` — в трёх местах, где сейчас `await blockAndPush(); ... return finishAppliedRepeat(...)`: после `blockAndPush` проверять `if (noopSignatures.has(signature)) { if (noopRepeatCount > MAX_NOOP_REPEATS_PER_RUN) return fail(...honest abort...); continue; }` — ран ПРОДОЛЖАЕТСЯ. Ветки `appliedSignatures` → `finishAppliedRepeat` оставить как есть (VL-304 не откатываем).
- `:1166-1201` — разбор ответа: `parsed.noop === true` → `noopSignatures.add(signature)` и `applied = false`; `parsed.ok === true` → `appliedSignatures`. Страховку VL-306 (`if (!applied && spec && isMcpWriteTool(...) && !/^\s*Ошибка/)`) обернуть условием «не noop»: noop-JSON уже классифицирован выше и в `appliedSignatures` не попадает ни при каком ответе.

**2. `src/agent/auto-report.ts`**

- добавить импорт `isTerminalStatus` из `../core/workflow.js`;
- `:100-113` — перед `updateTaskFile` проверить: `nextStatus && isTerminalStatus(workflow, nextStatus) && (неотмеченных DoD > 0)` → статус НЕ менять (остаётся `prevStatus`), в текст отчёта добавить строку «Статус не изменён: терминальный `<nextStatus>` при неотмеченных пунктах DoD (№…) возможен только через `backlog_finish_phase` с `dodOverride`/`aborted` (VL-248/VL-309).»;
- неотмеченные AC — не блокируют переход в нетерминальный статус, но перечисляются (уже делается через `uncheckedItems`); в отчёт также добавить пометку, если AC не отмечены при терминальном статусе.

**3. Тесты**

- `src/agent/loop.test.mjs:443-479` — переписать регресс VL-304 на новый контракт для noop: 3 разных вызова + 2 повтора `{id,type}` (noop-ответ) → ран НЕ завершается на повторе, директива содержит «Изменений нет», затем модель отдаёт финальный текст → `is_error:false`, повторы не исполнены (`state.calls` = число уникальных вызовов). Добавить отдельный кейс «вечный повтор noop → честный fail» (`MAX_NOOP_REPEATS_PER_RUN`).
- `src/agent/loop.test.mjs` — кейс на ok:true (применённый вызов) сохранить: повтор → `finishAppliedRepeat` (VL-304 не регрессирует). Если такого кейса нет — добавить.
- `src/agent/auto-report.test.mjs` — новый кейс: задача в `Review`, фаза `close`, DoD-пункт не отмечен → `writeAutoReportIfMissing` пишет отчёт, но статус остаётся `Review` (не Done), текст содержит «Статус не изменён» и номер неотмеченного пункта; второй кейс: все DoD отмечены → статус Done ставится (нет ложного отказа).

**4. Документация VL-307 (AC3 этой задачи)**

- `CHANGELOG.md` (раздел Unreleased) — запись VL-307: «`{{comment}}` подставляется всегда («без комментария» при отсутствии), литерала в промпте не бывает, фолбэк-строки удалены из 6 шаблонов, comment/reject сравнивают с «без комментария»» (файлы: `src/web/orchestrator.ts`, `src/agent/cli.ts`, 8 шаблонов, тесты).
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`, §4 «Интеграция с оркестратором», после абзаца «Переносимость промптов фаз» — новый подраздел «### Контракт `{{comment}}` (VL-307)»: подставляется всегда, при отсутствии — строка «без комментария»; литерал `{{comment}}` в промпте не встречается никогда; фолбэк-строка удалена; `phase-comment.md`/`phase-reject.md` сравнивают содержимое со строкой «без комментария» и берут запрос из «Последнего комментария»/не выдумывают причину; тот же контракт в CLI (`src/agent/cli.ts`) и веб-оркестраторе.
- `backlog/docs/doc-10` §6 — дописать абзац VL-309 (noop не применён; авто-отчёт не ставит терминальный статус при неотмеченных DoD).
- `CHANGELOG.md` — запись VL-309 (после правок кода).

**5. Отметки VL-307 (AC4 этой задачи)** — через MCP уже после фактической записи документации: `backlog_manage_ac {id:"VL-307", action:"check", index:5}`, `backlog_manage_dod {id:"VL-307", action:"check", index:2}` (+ комментарий в VL-307 о фактической записи).

### Порядок действий

1. `src/agent/loop.ts` — `noopSignatures`, `MAX_NOOP_REPEATS_PER_RUN`, `noopRepeatDirective`, правки `blockAndPush` и трёх веток, разбор ответа.
2. `src/agent/auto-report.ts` — гейт терминального статуса + строка в отчёте.
3. Тесты `loop.test.mjs` / `auto-report.test.mjs`.
4. Документация VL-307 (CHANGELOG + doc-10 §контракт `{{comment}}`) → `pnpm build` → отметить AC5/DoD2 у VL-307.
5. Документация VL-309 (CHANGELOG + doc-10 §6) и полный `pnpm test`.

### Проверка

- `pnpm build && pnpm test:fast` — точечные прогоны: `src/agent/loop.test.mjs`, `src/agent/auto-report.test.mjs`;
- финал: полный `pnpm test` (DoD «Тесты проходят» закрывается только полным прогоном, без `--exclude`).

### Риски

- **Регресс VL-304/303** (повтор применённого ok-вызова завершает ран) — сохраняется: меняется только ветка noop; покрыто существующим кейсом ok-пути.
- **Вечный круг noop-директив** — снимается капом `MAX_NOOP_REPEATS_PER_RUN` и честным `fail()` (is_error:true → статус откатывается, авто-resume).
- **Путаница noop и «Ошибка»** — noop-JSON распознаётся до страховки VL-306; текстовые ошибки по-прежнему не считаются применёнными.
- **Двойной проход по статусу** — авто-отчёт и `finalizePhaseStatus` оба двигают статус; гейт терминальности в авто-отчёте оставляет `task.status === prevStatus`, и `finalizePhaseStatus` продолжает работать по своему правилу (его поведение не меняем в этой задаче).
- **`lesson_update` в VL-307** — фикс закрывает именно этот сценарий (noop-JSON), регресс-тест воспроизводит последовательность «noop-повтор → продолжение ранa → финальный текст».
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 23:27
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic) — план записан в Implementation Plan.
Диагноз подтверждён по коду:
1. `src/agent/loop.ts:1177-1179` — `parsed.ok===true || parsed.noop===true` → сигнатура попадает в `appliedSignatures`; noop трактуется как «работа сделана».
2. Четыре ветки `appliedSignatures.has(signature)` (`:1021-1024,1039-1041,1054-1057`) вызывают `finishAppliedRepeat()` (`:660`) → ран завершается `is_error:false` на первом повторе noop-вызова (сессия Close VL-307, повтор `lesson_update`).
3. `src/agent/auto-report.ts:100-113` двигает статус по `getStatusAfterPhase` без проверки неотмеченных AC/DoD — правило VL-248 живёт только в `src/mcp/tools.ts:1808-1856`; отсюда Done у VL-307 с неотмеченными AC5/DoD2.
План: 5 файлов (`src/agent/loop.ts`, `src/agent/auto-report.ts`, `src/agent/loop.test.mjs`, `src/agent/auto-report.test.mjs` + документация CHANGELOG.md / backlog/docs/doc-10), порядок шагов 1-5, проверка `pnpm build && pnpm test:fast` (точечно) → полный `pnpm test`. Ключевые решения: отдельный `noopSignatures` (noop → директива «Изменений нет — переходи к следующему шагу», ран продолжается) с капом `MAX_NOOP_REPEATS_PER_RUN` и честным `fail()` при вечном повторе; ветка ok:true (`finishAppliedRepeat`, VL-304) не меняется; в авто-отчёте — гейт `isTerminalStatus` + неотмеченные DoD → статус не меняется, причина в тексте отчёта. Отметки AC5/DoD2 у VL-307 — шагом 4 после фактической записи документации.
Риски: регресс VL-304/303 (снят — меняется только noop-ветка), вечный круг noop-директив (кап + fail), двойной проход статуса (авто-отчёт + finalizePhaseStatus).
---
author: @agent
created: 2026-11-02 23:34
---
Фаза 3 (Code) выполнена. Коммит `c6d34dc`.
Изменено (4 файла):
- `src/agent/loop.ts` — введён отдельный набор `noopSignatures` (noop больше не попадает в `appliedSignatures`): классификация ответа write-вызова различает `ok:true` (применён → повтор завершает ран штатно, VL-304 сохранён) и `noop:true` (изменений нет → повтор НЕ исполняется, модели уходит новая директива `noopRepeatDirective` «Изменений нет … Следующий шаг: переходи к следующему пункту фазы», цикл ПРОДОЛЖАЕТСЯ). Страховка VL-306 для не-JSON ответов больше не перекрывает noop-JSON. Добавлен кап `MAX_NOOP_REPEATS_PER_RUN = 3`: при вечном повторе — честный `fail()` (is_error:true → оркестратор откатит статус и запустит авто-resume), а не ложный «успех».
- `src/agent/auto-report.ts` — `writeAutoReportIfMissing` не ставит терминальный статус при неотмеченных AC/DoD (`isTerminalStatus` + списки неотмеченных): статус остаётся прежним, а в отчёт добавляется строка «Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2; AC: #5) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309)».
- `src/agent/loop.test.mjs` — регресс VL-304 переписан на новый контракт: сессия-аналог Close VL-307 (3 вызова, ответ noop) → повтор noop не обрывает ран, директива «Изменений нет», модель доходит до финального текста; новый кейс «вечный повтор noop → честный fail»; сохранён кейс ok:true (повтор применённого вызова по-прежнему завершает ран штатно).
- `src/agent/auto-report.test.mjs` — два кейса: Close при неотмеченном DoD → статус остаётся Review + «Статус не изменён»/«DoD: #2» в отчёте; все пункты отмечены → Done ставится (нет ложного отказа).
Проверки: `pnpm build` — зелёный; целевые прогоны `src/agent/loop.test.mjs` + `src/agent/auto-report.test.mjs` (111 тестов) — зелёные; **полный `pnpm test`** — 148 файлов, 2749 passed, 4 skipped, 0 failed. (В первом полном прогоне был один плавающий провал `orchestrator.test.mjs > VL-277 AC1` — изолированный прогон этого теста и повторный полный прогон зелёные; к diff VL-309 отношения не имеет.)
Что осталось (по правилам фазы Code документацию не пишу — её пишет Close):
- AC3: запись в CHANGELOG.md (Unreleased) и раздел doc-10 о контракте `{{comment}}` для VL-307 — не написаны;
- AC4: AC5 и DoD «Документация обновлена» у VL-307 не отмечены (отмечать до фактической записи документации — ложное заявление, lesson-140/VL-248);
- AC5 частично: сборка и полный прогон зелёные, но «поведение зафиксировано в doc-10/CHANGELOG» — задача Close.
Требуемые для Close правки: CHANGELOG — записи VL-307 и VL-309; doc-10 §4 — новый подраздел «Контракт {{comment}} (VL-307)»; doc-10 §6 — абзац VL-309 (noop ≠ применён; авто-отчёт не ставит терминальный статус при неотмеченных DoD); после записи — отметить VL-307 AC5 + DoD «Документация обновлена».
DoD: «Тесты проходят» (полный прогон) и «Нет регрессий» — выполнены; «Документация обновлена» — за фазой Close.
---
author: @agent
created: 2026-11-02 23:41
---
Фаза Close выполнена. Ветка vb/vl-309 слита в master (merge-коммит; состав ветки — 1 коммит `c6d34dc`: `src/agent/loop.ts`, `src/agent/auto-report.ts`, `src/agent/loop.test.mjs`, `src/agent/auto-report.test.mjs`), worktree `.vibelog/worktrees/vl-309` удалена (в ней были только untracked-симлинки node_modules/backlog/references/data), ветка удалена (`git branch -d`).
Проверки после merge (в главном репо): `pnpm build` — зелёный; ранний точечный фильтр `src/agent/loop.test.mjs` + `src/agent/auto-report.test.mjs` — 111 passed; полный `pnpm test` — зелёный (2741 passed, 4 skipped, 0 failed; один прогон, без --exclude).
Документация (коммиты `4f603ee` docs и `54cbd1b` refs/lessons):
- `CHANGELOG.md` (Unreleased) — записи VL-309 и VL-307;
- `backlog/docs/doc-10` §3 — контракт подстановки `{{comment}}`; §4 — новый подраздел «Контракт `{{comment}}` (VL-307)» (подставляется всегда, «без комментария» при отсутствии, литерала в промпте не бывает, фолбэк-строки удалены из 6 шаблонов, comment/reject сравнивают со строкой); §6 — абзац VL-309 (noop ≠ «работа сделана» — `noopSignatures` + `noopRepeatDirective` + кап `MAX_NOOP_REPEATS_PER_RUN`, повтор noop не завершает ран; авто-отчёт не ставит терминальный статус при неотмеченных AC/DoD — гейт `isTerminalStatus`, строка «Статус не изменён…»).
- AC4: после фактической записи документации отмечены AC5 и DoD «Документация обновлена» у VL-307 + комментарий в VL-307 (коммит `4f603ee`).
- Урок: создан lesson-175, связан с задачей (`lesson_link`), файл закоммичен.
DoD: «Тесты проходят» — полный прогон зелёный; «Документация обновлена» — CHANGELOG + doc-10 обновлены; «Нет регрессий» — кейс ok:true (VL-304) сохранён и зелёный.
Замечание вне scope: в главном репо остались незакоммиченными файлы чужих задач/документов (VL-124, VL-302, VL-305, doc-2) — по правилам фазы не коммитил (не файлы этой задачи и не подзадачи).
---
<!-- COMMENTS:END -->