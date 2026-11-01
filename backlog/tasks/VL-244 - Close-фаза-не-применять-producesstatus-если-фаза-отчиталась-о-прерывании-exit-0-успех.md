---
id: VL-244
title: 'Close-фаза: флаг aborted отменяет produces_status'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - core
  - mcp
  - prompt
dependencies: []
milestone: v1.11
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/phase-transient.ts
  - src/core/phase-transient.test.mjs
  - src/mcp/tools.ts
  - src/mcp/server.test.mjs
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
lessons:
  - lesson-107
token_usage:
  input: 6012843
  output: 55327
  cache: 5831680
  total: 6068170
  requests: 114
  duration_ms: 1773886
  reasoning: 28383
  by_phase:
    spec:
      input: 67715
      output: 1610
      cache: 56320
      requests: 3
    plan:
      input: 1169525
      output: 18270
      cache: 1120768
      requests: 25
    code:
      input: 3323062
      output: 27982
      cache: 3247616
      requests: 54
    close:
      input: 1452541
      output: 7465
      cache: 1406976
      requests: 32
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. `finalizePhaseStatus` (`src/core/phase-transient.ts`) применяет `produces_status` при `exitCode === 0 && !is_error`. Аварийные ветки `templates/phases/phase-close*.md` заканчиваются обычным текстом агента → exit 0 → для перехода `Review → close → Done` ставится Done без фактического завершения (VL-219: Done зафиксирован в 00:01 при незавершённом merge/незаписанной документации). Ввести явный сигнал итога фазы: `backlog_finish_phase` принимает `aborted: true` (или `outcome: "aborted"`), tool пишет флаг в запись transient-кэша (через новый экспорт `markPhaseAborted` в `phase-transient.ts`); `finalizePhaseStatus` при наличии флага уходит в fail-ветку — откат к `prevStatus` + комментарий-причина. Дополнительно: fallback по `logTail`/финальному тексту («не завершена», «прервана») не использовать как единственный критерий — только как диагностику.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `backlog_finish_phase` с `aborted: true` в close-фазе не приводит к `Done`: `finalizePhaseStatus` уходит в fail-ветку — статус возвращается к `prevStatus` и в задачу пишется комментарий-причина
- [x] #2 Тест `src/core/phase-transient.test.mjs`: `finalizePhaseStatus` при `exitCode: 0` + флаге `aborted` откатывает статус к `prevStatus`; без флага сохраняется прежнее поведение (применение `produces_status`)
- [x] #3 Флаг `aborted` присутствует в `inputSchema` инструмента `backlog_finish_phase` и используется аварийными ветками шаблонов `templates/phases/phase-close*.md` вместо отчёта без status; fallback по `logTail`/финальному тексту остаётся только диагностикой
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

Ввести явный сигнал итога фазы: `aborted: true` в `backlog_finish_phase` → флаг пишется в transient-кэш → `finalizePhaseStatus` уходит в fail-ветку (откат к `prevStatus` + комментарий-причина), даже если процесс завершился с `exitCode 0`. Fallback по `logTail`/финальному тексту — только диагностика (в критерий НЕ входит).

## Ключевое ограничение (найдено при изучении кода)

`finalizePhaseStatus` вызывается в `flush()`/`finish()` оркестратора (`src/web/orchestrator.ts:1229`) и получает `record`, а не агентский вызов. Чтобы флаг из MCP-инструмента дошёл до этой точки, он должен пройти через процесс-разделитель: MCP-сервер и оркестратор — РАЗНЫЕ процессы. Единственный общий носитель — transient-кэш `.vibelog/phase-in-progress.json` (уже межпроцессный по дизайну VL-196, doc-6). Поэтому:

- `toolFinishPhase` знает `cwd` = главный репозиторий (через `VIBELOG_CWD` в `src/cli/commands/mcp.ts:34`) — тот же `cwd`, с которым работает `finalizePhaseStatus` (оркестратор передаёт `cwd` главного репо в `markPhaseStarted`, `orchestrator.ts:870`).
- Ключ задачи: `markPhaseStarted` — `taskIdPattern`-проверка, но MCP получает `id` в raw-регистре (например `VL-244`). Канонизируем `id.toUpperCase()` в момент вызова `markPhaseAborted`.

## Файлы и правки

### 1. `src/core/phase-transient.ts`

1. **Тип записи** (строки 34–47, интерфейс `PhaseTransientEntry`): добавить необязательное поле
   ```ts
   /** Фаза завершилась аварийно: агент прислал aborted:true (VL-244). */
   aborted?: boolean;
   /** Причина аварии для комментария-причины (текст отчёта агента). */
   abortedReason?: string;
   ```
2. **Новый экспорт `markPhaseAborted(cwd, taskKey, reason?)`** — ставится после `removeEntry` (~стр. 190), перед `finalizePhaseStatus`. Семантика:
   - `taskKey` нормализуется `toUpperCase()` (канон ключей кэша — `markPhaseStarted` пишет `key` из оркестратора, где он уже UPPER, `orchestrator.ts:731`);
   - читает кэш; если записи НЕТ → no-op (fail-open: `aborted` в фазе без транзиента — не ошибка; например, служебная фаза);
   - иначе merge: `entry.aborted = true`, `entry.abortedReason = reason` (обрезка до 500 символов), `writeCache`;
   - **всё в try/catch, ошибки глотаются с логом** (паттерн fail-open модуля, стр. 129–133): сбой записи флага не должен ронять MCP-вызов.
3. **Fail-ветка `finalizePhaseStatus`** (строки 211–231): условие успеха становится
   ```ts
   const aborted = entry.aborted === true;
   if (!aborted && record.exitCode === 0 && record.result?.is_error !== true) { ...успех... }
   else { ...провал... }
   ```
   В fail-ветке текст комментария-причины расширяется: при `aborted` — `Фаза ${phaseName} прервана агентом (aborted)${reasonPart} — статус возвращён к ${entry.prevStatus}.` (где `reasonPart = entry.abortedReason ? ': ' + entry.abortedReason : ''`); иначе — прежний текст «Фаза ... не удалась (код выхода N): tail». Лог-строка тоже получает признак `aborted`.
4. **Обновить докблок** `finalizePhaseStatus` (строки 178–195): в перечне ветвей заменить «успех (exitCode 0 и не is_error)» на «успех (exitCode 0, не is_error и НЕ aborted — VL-244)».

Риск: `recoverStalePhaseStatuses` флаг игнорирует (её ветка и так откатывает) — изменений не требует.

### 2. `src/mcp/tools.ts`

1. **Импорт** (рядом с `import { findBacklogDir } ...`, стр. 49): `import { markPhaseAborted } from '../core/phase-transient.js';`.
2. **Схема инструмента** `backlog_finish_phase` (строки 400–428), в `properties` после `phase` (стр. 424):
   ```ts
   aborted: {
     type: 'boolean',
     description: 'Явный сигнал: фаза завершается АВАРИЙНО (не выполнена). При true статус-переход produces_status НЕ применяется — транзиент откатит задачу к статусу до фазы и запишет комментарий-причину. Используй в аварийных ветках шаблонов вместо отчёта без status.',
   },
   ```
   В `description` самого инструмента (стр. 403) добавить одно предложение про `aborted` (модель читает description, а не только свойства).
   `required` не меняем (`['id','comment']`). **Enum не закреплять** (lesson-32) — поле булево.
3. **`toolFinishPhase`** (стр. 1416–1671): в начале, ПОСЛЕ hardErrors-блока (стр. ~1454) и ДО формирования `updates`/записи файла — блок:
   ```ts
   // VL-244: явный сигнал «фаза прервана». Флаг живёт в transient-кэше
   // (межпроцессный носитель: MCP-сервер ≠ процесс оркестратора), поэтому
   // пишем его ДО updateTaskFile — даже если запись задачи ниже упадёт,
   // finalizePhaseStatus увидит aborted и не поставит produces_status.
   let abortedPart = '';
   if (args.aborted === true) {
     markPhaseAborted(cwd, id, typeof args.comment === 'string' ? args.comment : undefined);
     abortedPart = 'aborted: фаза помечена прерванной (статус не применён)';
   }
   ```
   Нюанс: если агент одновременно передал `status`, статус всё равно применится (явное действие агента приоритетно — поведение VL-196 сохраняем). В сводке `summary` (стр. 1665) добавить `abortedPart` между `commentPart` и AC-счётчиками. Возвращать снимок фактически записанного (lesson-105): строка `aborted: ...` попадает в сводку только когда флаг реально записан (для no-op без кэша можно писать `aborted: фаза вне транзиента (флаг не сохранён)` — уточнить по результату `markPhaseAborted`, поэтому сделать её возвращающей `boolean`).
4. Проверить счётчик инструментов (`tools.length`) — новые инструменты НЕ добавляются, только поле схемы; тесты на количество (`doctor.ts`, `server.test.mjs`) не затрагиваются (lesson-10).

### 3. `templates/phases/phase-close.md`

- Стр. 43 (`3.5`, сборка/тесты падают) — заменить «оставь отчёт (шаг 5, только comment без status и dodChecks)» на «вызови `backlog_finish_phase` с `"aborted": true` и comment-причиной (без status/dodChecks)».
- Стр. 52–55 (шаг 5): добавить строку-подсказку «Если фаза прерывается аварийно — обязателен `"aborted": true`: без него завершение процесса с кодом 0 применит `produces_status` и поставит Done незавершённой задаче (VL-219/VL-244).»

### 4. `templates/phases/phase-close-worktree.md`

- Стр. 38 (конфликт merge) — «Отчёт (шаг 9) сделай сразу» → «Отчёт (шаг 9) сделай сразу с `"aborted": true` (без status/dodChecks)».
- Стр. 47 (сборка/тесты падают после merge) — то же: `"aborted": true`.
- В шаге 9 (отчёт) — подсказка про `aborted` (аналогично close.md).

### 5. Тесты

**`src/core/phase-transient.test.mjs`** (`describe('phase-transient (VL-196)')`, фикстуры VL-901…VL-906, `afterAll` чистит `mkdtemp`):
- новый тест «aborted: exitCode 0 + флаг → откат к prevStatus + комментарий-причина»: новая фикстура `VL-907` (в блоке setup, стр. 44–50, `status: 'Spec'`); `markPhaseStarted(root,'VL-907','plan',pid)` → `markPhaseAborted(root,'VL-907','merge не завершён')` → `finalizePhaseStatus(root,'VL-907','plan',{exitCode:0, result:{type:'result'}})`. Ожидания: `status === 'Spec'` (НЕ `Planned`), 1 комментарий `@agent`, текст матчит `/прервана агентом/` и `/merge не завершён/` и `/возвращён к Spec/`, записи кэша нет.
- тест «без флага — прежнее поведение» уже есть (стр. 76–82, VL-901) — оставить как контрольный; в его комментарии добавить пометку, что он же проверяет AC2-«без флага».
- (опционально) тест «markPhaseAborted без записи кэша — no-op, не бросает».

**`src/mcp/server.test.mjs`**:
- в `tools/list`-тесте (стр. 205–215) добавить assert `finishDef.inputSchema.properties.aborted.type === 'boolean'` (AC3, минимальная проверка схемы).
- сквозной тест через живой MCP-сервер здесь не нужен: `finalizePhaseStatus` живёт в оркестраторе (другой процесс), а флаг в кэше проверяется юнит-тестом core — экономия времени прогона.

### 6. Документация (делает Close)

- `README.md`, блок «Контракт `backlog_finish_phase`» (стр. 238): добавить абзац про `aborted` (семантика, что даёт, зачем нужен; ссылка на VL-244/VL-219).
- `CHANGELOG.md` (раздел Unreleased) — запись VL-244.
- doc-6 (Transient In Progress) — правку делает Close (большие документы в Code не трогаем, lesson-63); черновик: «Аварийное завершение фазы: `aborted: true` в `backlog_finish_phase` пишет флаг в transient-кэш (`markPhaseAborted`); `finalizePhaseStatus` при флаге игнорирует `exitCode 0` и уходит в fail-ветку — откат к `prevStatus` + комментарий-причина.»

## Порядок действий

1. `src/core/phase-transient.ts`: поля `aborted`/`abortedReason`, `markPhaseAborted`, fail-ветка `finalizePhaseStatus`, докблоки.
2. `src/mcp/tools.ts`: импорт, поле схемы + description, блок `abortedPart` в `toolFinishPhase`, сводка.
3. Тесты core (`phase-transient.test.mjs`) + assert схемы в `server.test.mjs`.
4. Шаблоны `phase-close.md` / `phase-close-worktree.md` (аварийные ветки → `aborted: true`).
5. `pnpm build && pnpm test:fast` на затронутых файлах (`vitest run src/core/phase-transient.test.mjs src/mcp/server.test.mjs`), затем полный `pnpm test` перед DoD.
6. Документация (README/CHANGELOG/doc-6) — фаза Close.

## Как проверить

```bash
pnpm build
npx vitest run src/core/phase-transient.test.mjs src/mcp/server.test.mjs
pnpm test            # полный прогон перед DoD
grep -n "aborted" src/mcp/tools.ts src/core/phase-transient.ts templates/phases/phase-close*.md
```

## Риски

1. **Ключ кэша и регистр**: `markPhaseAborted` обязан нормализовать `id` в UPPER, иначе флаг не найдёт запись (`VL-244` vs `vl-244`) — покрыть юнит-тестом с нижним регистром.
2. **Разные `cwd`**: MCP пишет кэш в `VIBELOG_CWD` (главный репо), оркестратор читает его же — совпадает. Но если MCP запущен без `VIBELOG_CWD` в branch-mode, флаг уйдёт в worktree-кэш и не сработает (известная асимметрия, lesson-13/107): в плане фиксируем как известное ограничение, не регрессия.
3. **Двойной отчёт**: агент при `aborted: true` пишет comment-причину, затем `finalizePhaseStatus` дописывает свой комментарий — в задаче будет 2 комментария. Это осознанно (причина агента + машинный итог), не считать дефектом; тест ждёт ровно 1 машинный комментарий после `markPhaseAborted`.
4. **Совместимость поведения**: задачи без `aborted` идут прежним путём — существующие тесты `phase-transient.test.mjs`, `orchestrator.test.mjs`, `auto-runner.test.mjs` должны остаться зелёными.
5. **`markPhaseAborted` при отсутствии записи** (служебная фаза/нет транзиента): no-op + строка в сводке, без `isError` — иначе агент зациклится на повторных вызовах (lesson-92/94).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 02:20
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Close-фаза: флаг aborted отменяет produces_status» (было длинное, >80 символов). Тип: bug (в списке доступных). Масштаб: task (обычная задача-исполнитель, эпик не нужен). Приоритет: Medium. Уточнено: AC переписан в 3 проверяемых пункта — (1) поведение `backlog_finish_phase` с `aborted: true` в close-фазе (откат к `prevStatus` + комментарий-причина), (2) тест в `src/core/phase-transient.test.mjs` на обе ветки (с флагом и без), (3) наличие флага в `inputSchema` инструмента и в аварийных ветках `templates/phases/phase-close*.md`, с оговоркой, что fallback по `logTail`/тексту — только диагностика. Labels: core, mcp, prompt. References: нет (внешних источников в описании не упоминалось). Вопросов нет.
---
author: @agent
created: 2026-10-30 13:20
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в Implementation Plan: 6 файлов — src/core/phase-transient.ts (поля aborted/abortedReason в PhaseTransientEntry, новый экспорт markPhaseAborted с нормализацией ключа в UPPER и fail-open, fail-ветка finalizePhaseStatus при entry.aborted, докблок), src/mcp/tools.ts (импорт markPhaseAborted, поле aborted в inputSchema backlog_finish_phase + упоминание в description, блок abortedPart в toolFinishPhase ДО updateTaskFile, строка в сводке), src/core/phase-transient.test.mjs (новая фикстура VL-907: exitCode 0 + aborted → откат к prevStatus + комментарий-причина; контрольный тест без флага уже есть), src/mcp/server.test.mjs (assert типа boolean в схеме), templates/phases/phase-close.md (аварийная ветка 3.5 и шаг 5 → aborted:true), templates/phases/phase-close-worktree.md (конфликт merge стр.38 и падение тестов стр.47 → aborted:true). Ключевое архитектурное решение: MCP-сервер и оркестратор — разные процессы, поэтому флаг передаётся через межпроцессный transient-кэш .vibelog/phase-in-progress.json (тот же носитель, что у VL-196), а не через record. Проверка: pnpm build && vitest run src/core/phase-transient.test.mjs src/mcp/server.test.mjs, затем полный pnpm test. Риски: (1) регистр ключа кэша — markPhaseAborted обязан нормализовать id в UPPER, покрыть тестом; (2) при запуске MCP без VIBELOG_CWD в branch-mode флаг уйдёт в worktree-кэш (известная асимметрия, не регрессия); (3) два комментария в задаче (причина агента + машинный итог) — осознанно; (4) no-op при отсутствии записи кэша — без isError, чтобы не зациклить агента; (5) документацию (README-контракт, CHANGELOG, doc-6) делает Close по lesson-63 — черновик раздела уже в плане.
---
author: @agent
created: 2026-10-30 13:33
---
Фаза 3 (Code) выполнена. Изменено (6 файлов, коммит 0e5314f):
1. `src/core/phase-transient.ts` — в `PhaseTransientEntry` поля `aborted?`/`abortedReason?`; новый экспорт `markPhaseAborted(cwd, taskKey, reason?)` (ключ нормализуется в UPPER, no-op без записи кэша, причина обрезается до 500, fail-open с логом, возвращает boolean «флаг реально записан»); fail-ветка `finalizePhaseStatus` теперь `if (!aborted && exitCode === 0 && !is_error)`, при флаге комментарий-причина «Фаза X прервана агентом (aborted): <причина> — статус возвращён к prevStatus»; fallback по `logTail` остаётся только в не-aborted ветке как диагностика; докблоки обновлены.
2. `src/mcp/tools.ts` — импорт `markPhaseAborted`; поле `aborted: {type:'boolean'}` в `inputSchema` `backlog_finish_phase` (+ упоминание в description инструмента, enum не закреплялся); в `toolFinishPhase` блок пишет флаг ДО `updateTaskFile` и добавляет в сводку строку «aborted: фаза помечена прерванной» либо «aborted: фаза вне транзиента (флаг не сохранён)» — снимок фактически записанного (lesson-105).
3. `src/core/phase-transient.test.mjs` — +2 теста: (а) `markPhaseStarted` → `markPhaseAborted('vl-907', ...)` (нижний регистр — проверка канонизации) → `finalizePhaseStatus {exitCode:0}` даёт статус Spec (не Planned), один комментарий @agent с /прервана агентом/, причиной и /возвращён к Spec/, кэш очищен; (б) `markPhaseAborted` без записи кэша — false, кэш не создаётся, статус не тронут. Контрольный тест «без флага → produces_status» (VL-901) сохранён — покрывает вторую половину AC2.
4. `src/mcp/server.test.mjs` — assert `properties.aborted.type === 'boolean'` в tools/list (AC3).
5. `templates/phases/phase-close.md` — аварийная ветка 3.5 и подсказка в шаге 5: `"aborted": true` вместо отчёта без status.
6. `templates/phases/phase-close-worktree.md` — конфликт merge (шаг 4), падение сборки/тестов после merge (шаг 5) и примечание в шаге 9: `"aborted": true`.
Проверки: `pnpm build` — ок; точечно `vitest run src/core/phase-transient.test.mjs src/mcp/server.test.mjs` — 37 тестов зелёные; **полный `pnpm test`** — 92 файла / 1737 тестов + static 7, все зелёные (DoD1). Первый полный прогон дал 1 падение: `src/web/phase-prompt.test.mjs` (инвариант VL-157 — в шаблонах промптов запрещены внутренние ID задач `VL-N`); правка была в шаблонах, ID из текста убраны, повторный (единственный, причина зафиксирована) полный прогон зелёный. Исключённых/пропущенных тест-файлов нет (4 skipped — штатные skip внутри файлов, не связанные с задачей).
Что осталось: DoD2 «Документация обновлена» — README (контракт `backlog_finish_phase`, абзац про `aborted`), CHANGELOG (Unreleased) и doc-6 (Transient In Progress) правит Фаза Close (по lesson-63 документы в Code не обновляются); черновик формулировки — в Implementation Plan задачи. DoD3 «Нет регрессий» — полный прогон зелёный.
Lessons: создан lesson-107 (не упоминать ID задач в templates/phases/*.md из-за инварианта VL-157) и связан с задачей.
---
author: @agent
created: 2026-10-30 13:44
---
Фаза Close выполнена. Ветка vb/vl-244 слита в master (1 коммит 0e5314f → merge 726a7f8), worktree .vibelog/worktrees/vl-244 удалён (чист: только untracked-симлинки node_modules и backlog/references/data), ветка vb/vl-244 удалена.
Проверки после merge: `pnpm build` — ок; ранний точечный фильтр по diff'у (`vitest run src/core/phase-transient.test.mjs src/mcp/server.test.mjs`, 37 тестов) — зелёный; полный `pnpm test` — 97 файлов / 1803 passed, 4 skipped + static 7 passed, регрессий нет. Повторных полных прогонов не было.
Документация (DoD2): `README.md` — абзац «Аварийное завершение фазы: `aborted: true`» в блоке контракта `backlog_finish_phase`; `CHANGELOG.md` (Unreleased → Исправлено) — запись VL-244; doc-6 — пункт про аварийное завершение в разделе «Transient In Progress»; doc-8 — параметр `aborted` в таблице `backlog_finish_phase` + абзац семантики. Коммит документации: 4a851ea («docs: VL-244 — документация и CHANGELOG»).
Lessons: lesson-107 (не упоминать внутренние ID задач в `templates/phases/*.md` — инвариант VL-157) создан в фазе Code и связан с задачей; закоммичен e6fbd4c («docs(task): VL-244 — refs и lessons»). References у задачи отсутствуют.
DoD: 1 «Тесты проходят» ✓ (полный прогон), 2 «Документация обновлена» ✓ (README/CHANGELOG/doc-6/doc-8, коммит 4a851ea), 3 «Нет регрессий» ✓.
---
<!-- COMMENTS:END -->