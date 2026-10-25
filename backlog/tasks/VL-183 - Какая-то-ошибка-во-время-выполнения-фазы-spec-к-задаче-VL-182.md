---
id: VL-183
title: Исправить ошибки backlog_update_task и manage_ac в MCP-слое
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 15:35'
updated_date: '2026-10-25 20:05'
due_date: ''
labels:
  - core
  - mcp
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/types.test.mjs
  - src/mcp/v11.test.mjs
lessons:
  - lesson-34
  - lesson-35
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Две ошибки в MCP-слое, проявившиеся при выполнении фазы spec к VL-182. Исправить обе.

1. backlog_update_task падал с «Cannot read properties of undefined (reading 'toLowerCase')», пока type задачи был не определён — обработка пустого/неопределённого type в валидации упала.

2. manage_ac (action=add) с переданным массивом text записывал JSON массива одним критерием вместо добавления каждого элемента отдельным критерием.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backlog_update_task с неопределённым (отсутствующим) type не падает с «Cannot read properties of undefined (reading 'toLowerCase')» — валидация/дефолт корректны; исправление покрыто тестом
- [x] #2 manage_ac с action=add и массивом text добавляет каждый элемент отдельным критерием (а не одной JSON-строкой массива); исправление покрыто тестом
- [x] #3 pnpm test проходит без регрессий: новые и существующие тесты MCP-слоя зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan (VL-183)

### Диагностика (проверено вживую через MCP, 2026-10-25)

**Баг №2 (manage_ac add + массив) — ВОСПРОИЗВЕДЁН.** Вызов `backlog_manage_ac {id: VL-183, action: "add", text: ["VL183-probe-A", "VL183-probe-B"]}` создал ОДИН критерий #4 с текстом-JSON `["VL183-probe-A", "VL183-probe-B"]` (пробный критерий сразу удалён — remove index [4], VL-183 не изменилась). Причина: в `manageChecklist` case `'add'` (src/mcp/tools.ts ~967–986) JSON-строка массива не парсится: ветка `Array.isArray(args.text)` не срабатывает, строка уходит в scalar-ветку `list.push({text: args.text})`. Это тот же паттерн «модель/shaper шлёт JSON-строку вместо массива», что уже решён для `index` в `parseChecklistIndexes` (VL-120/VL-135, src/mcp/tools.ts ~896–910), но для `text` — не закрыт. (Тест `src/agent/mcp-client.test.mjs:133` передаёт реальный массив через stdio — он работает; дыра именно в приёме JSON-строки.)

**Баг №1 (update_task + toLowerCase).** В текущем src единственный достижимый источник сообщения «Cannot read properties of undefined (reading 'toLowerCase')» в пути `backlog_update_task` — `getTask(cwd, id)` / `findTaskFilePath` (src/core/store.ts:60 и :266: `id.toLowerCase()`), вызов с отсутствующим `id` в args: сервер не валидирует обязательность id (схема — только метаданные). Сама type-валидация сейчас защищена: `normalizeTaskType` (src/core/config.ts:68) — `if (!type) return ''` + `String()`-коэрция; `markdownToTask` (src/core/task.ts:307) дефолтит `type` в `''`; `taskToMarkdown` — `task.type || ''`. Живые пробы (отсутствующий type, `type: ''`, невалидный `type: "null"`, обновление typeless-задачи VL-152, spec-style мега-вызов) — не упали. Однако: (а) сценарий AC1 не закрыт тестами; (б) `args.type === null` в `toolUpdateTask` (строка 830: `!== undefined`) тихо стирает type в `''`; (в) вызов без `id` падает с ТОЧНО тем самым сообщением. Фикс AC1 = защитная валидация на границе MCP-слоя + регресс-тесты сценария AC1.

### Файлы для изменения

1. **`src/mcp/tools.ts`**
   - `toolUpdateTask` (строки 819–869): в начале — валидация `args.id` (отсутствует / не непустая строка → `throw new Error('Не передан id задачи (параметр "id").')` — понятная ошибка вместо TypeError из `getTask`); семантика `type`: `null` → поле НЕ трогать (skip, как отсутствующее); `''` — явный сброс (существующую семантику оставить); прочие не-string значения уходят в существующую `normalizeTaskType` → «Недопустимый тип …».
   - `manageChecklist` case `'add'` (~967–986): перед scalar-веткой — если `typeof args.text === 'string'` и после trim начинается с `[` → try `JSON.parse`: успех + `Array.isArray` + все элементы — непустые строки → batch-push каждым отдельным критерием (текущая array-ветка); иначе (битый JSON / не-массив / не-строки) → fallback: push как scalar-текст (важно: критерии вида «[blocker] …» не должны ломаться). Обновить `description` поля `text` в обоих inputSchema (manage_ac:182, manage_dod:196): «JSON-строка массива тоже принимается».
2. **`src/mcp/types.test.mjs`** — тесты AC1:
   - фикстура задачи БЕЗ type в frontmatter; `backlog_update_task {id, title}` без аргумента type → без исключения, type остаётся `''`;
   - `type: null` → поле не трогается (не стирается);
   - вызов без `id` → Error с «Не передан id…» и assert NOT match `/toLowerCase/` (точное сообщение AC1);
   - `type: ''` → сброс в `''` (регресс текущей семантики).
3. **`src/mcp/v11.test.mjs`** — тесты AC2 (блок manage_ac, ~строки 132+):
   - `text: '["A", "B"]'` (JSON-строка) → `list` содержит «1. ○ A» и «2. ○ B», нет критерия-JSON;
   - `text: ['A', 'B']` (реальный массив) → 2 отдельных критерия (регресс VL-135);
   - scalar `text: '[blocker] fix'` → один критерий-текст (fallback не ломает обычные тексты).
4. **`backlog/docs/doc-8-MCP-справочник-Vibelogmd.md`** — обновить через `document_update`: manage_ac `text` — поддержка JSON-строки массива (симметрия с index); backlog_update_task — валидация id и семантика type (null — не трогает, `''` — сброс).

### Порядок действий

1. `pnpm install && pnpm build` (в worktree нет `dist/`, тесты импортируют dist).
2. Написать тесты AC1 + AC2 → `pnpm test:fast` — новые тесты должны локализовать баги (AC2 красный гарантирован; AC1 — индикатор).
3. Фикс `manageChecklist` add (JSON-строка) → тесты AC2 зелёные.
4. Фикс `toolUpdateTask` (валидация id, семантика null-type) → тесты AC1 зелёные.
5. Полная проверка: `pnpm test` (= build + vitest run) — AC3.
6. `document_update` doc-8 (DoD «документация обновлена»).
7. `backlog_update_task {modifiedFiles: [...]}` по итогам Code.

### Как проверить

- `pnpm build && pnpm test` — зелёные новые и существующие тесты MCP-слоя (v11, types, server, batch-checklist, mcp-client).
- JSON-RPC-уровень закрыт `src/mcp/server.test.mjs`; ручной запуск `vibelog mcp start` не требуется.

### Риски

- **Живой MCP-сервер работает из `dist/` главного репо** (`which vibelog` → bin главного репо): фиксы в worktree не видны работающему серверу — после мержа в main нужен `pnpm build` на main, иначе баги останутся вживую.
- Семантика `type: null` меняется (было: тихое стирание в `''` → станет: пропуск) — проверить, что types.test.mjs/v11.test.mjs не ожидают старого поведения.
- Fallback на scalar при битом JSON «прячет» опечатки — приемлемо: парсинг срабатывает только при валидном JSON-массиве непустых строк, иначе текст сохраняется как есть (не теряем ввод).
- Core (`store.ts getTask`) НЕ менять — валидация только на границе MCP, чтобы не менять семантику CLI/web.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 15:36
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (информативный, <80 символов). Масштаб: не определён (описание неполное). Labels: пропущено (описание неполное). References: нет (VL-182 — внутренняя задача-контекст, прочитана для понимания: в её комментарии spec-фазы упомянуты две ошибки: «Cannot read properties of undefined (reading 'toLowerCase')» при backlog_update_task с неопределённым type и запись массива manage_ac add одним JSON-критерием). Жду ответов на вопросы:
### 1. Что именно за ошибка во время фазы spec к VL-182?
- [ ] «Cannot read properties of undefined (reading 'toLowerCase')» при вызове backlog_update_task, пока type задачи не определён
- [ ] Передача массива в manage_ac (action=add) записывает JSON одним критерием вместо нескольких
- [ ] Другая ошибка → 
### 2. Что требуется сделать в этой задаче?
- [ ] Исправить ошибку в коде (баг-фикс в core/агенте)
- [ ] Только описать и задокументировать проблему без исправления
- [ ] Другое → 
### 3. Есть ли дополнительные детали (шаги воспроизведения, полный текст/стек ошибки)?
→ 
### Дополнительные комментарии
→ 
---
author: @agent
created: 2026-10-25 15:49
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Исправить ошибки backlog_update_task и manage_ac в MCP-слое». Масштаб: task (две локальные ошибки в MCP-слое, укладываются в одну задачу). Уточнено по ответам пользователя: (1) воспроизведены ОБЕ ошибки из комментария VL-182 — падение backlog_update_task с «Cannot read properties of undefined (reading 'toLowerCase')» при неопределённом type и запись manage_ac action=add массива как одного JSON-критерия (обе фактически воспроизведены ещё при заполнении этой же задачи — баг подтверждён вживую); (2) цель — исправить обе ошибки в коде; добавлены 3 проверяемых AC. Labels: core, mcp. References: нет. Примечание: баг проявился и на этой фазе — первые вызовы backlog_update_task падали той же ошибкой «toLowerCase», пока type не был записан отдельным вызовом; AC добавлены отдельными вызовами manage_ac (массив в add записывается одним критерием). Вопросов нет.
---
author: @agent
created: 2026-10-25 19:23
---
Фаза 2 (Plan) выполнена. Тип: task. План записан: 4 файла (src/mcp/tools.ts — toolUpdateTask 819–869 и manageChecklist add ~967–986; src/mcp/types.test.mjs — тесты AC1; src/mcp/v11.test.mjs — тесты AC2; backlog/docs/doc-8 — документация через document_update). Диагностика: баг №2 ВОСПРОИЗВЕДЁН вживую (manage_ac add с массивом text записал один JSON-критерий; пробный критерий удалён, VL-183 не изменилась) — причина: JSON-строка массива не парсится в add, симметрия с index (VL-120/VL-135) не закрыта. Баг №1 локализован: единственный достижимый источник сообщения «Cannot read properties of undefined (reading 'toLowerCase')» — getTask/findTaskFilePath (store.ts:60/266) при отсутствии id в args (валидация id на границе MCP отсутствует); type-пути в текущем src защищены, но сценария AC1 нет в тестах, а null-type тихо стирает поле. Фикс: валидация id + семантика null-type в toolUpdateTask + регресс-тесты AC1; try-parse JSON-строки в manageChecklist add + тесты AC2. Риски: живой MCP работает из dist главного репо (после мержа нужен pnpm build), смена семантики type:null, core не менять. References: нет, подзадач нет (task).
---
author: @agent
created: 2026-10-25 19:35
---
Фаза 3 (Code) выполнена. Изменено: src/mcp/tools.ts, src/mcp/types.test.mjs, src/mcp/v11.test.mjs; коммит 11637a5 (ветка vb/vl-183). Фиксы по плану: (1) toolUpdateTask — валидация id на границе MCP («Не передан id задачи (параметр "id").» вместо TypeError «Cannot read properties of undefined (reading 'toLowerCase')» из getTask/findTaskFilePath) + семантика type: null = поле не трогается (раньше тихо стирало в ''), '' = явный сброс; (2) manageChecklist add — разбор JSON-строки массива «["A","B"]» с fallback на scalar-текст для битого JSON и критериев вида «[blocker] …» (симметрия с index из VL-120/VL-135), description поля text обновлён в обеих схемах. Тесты: +6 в types.test.mjs (пустой type, ключ type удалён из frontmatter, type null, без id/пустой id без toLowerCase, сброс '') и +3 в v11.test.mjs (JSON-строка → 2 критерия, реальный массив → 2 критерия, scalar-фолбэк). Проверки: pnpm build ✓, pnpm test — 68 файлов / 1194 теста зелёные, регрессий нет (AC3, DoD1, DoD3). Что осталось: DoD «Документация обновлена» — doc-8 (backlog/docs) по правилам фазы Code не обновлялся, запишет Фаза Close; после слияния в main нужен pnpm build на главном репо, иначе живой MCP-сервер (dist) продолжит работать со старым кодом.
---
author: @agent
created: 2026-10-25 20:05
---
Фаза Close выполнена. Ветка vb/vl-183 слита в master (1 коммит 11637a5, merge --no-ff без конфликтов), worktree удалена (там были только untracked-симлинки node_modules/refs оркестратора — удалена с --force), ветка удалена. Проверки после мержа в главном репо: pnpm build ✓, pnpm test ✓ (68 файлов / 1194 теста, регрессий нет). DoD честно: 1) Тесты проходят — ✓; 2) Документация обновлена — ✓: doc-8 (MCP-справочник: валидация id и семантика type в backlog_update_task, поддержка JSON-строки массива в text manage_ac/dod) + запись в CHANGELOG.md (Unreleased → Исправлено), коммит docs: cce52b2; 3) Нет регрессий — ✓ (полный прогон зелёный). Lessons: созданы lesson-34 (валидация обязательных аргументов на границе MCP) и lesson-35 (парсинг JSON-строки массива для array-полей), связаны с VL-183, закоммичены (19b5f3d). После этого merge в основную ветку нужен pnpm build на главном репо — уже выполнен (живой MCP-сервер работает из актуального dist).
---
<!-- COMMENTS:END -->