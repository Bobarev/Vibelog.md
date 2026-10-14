---
id: VL-138
title: 'MCP backlog_finish_phase: завершение фазы одним вызовом — статус + отчёт + checks + modifiedFiles'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 10:57'
updated_date: '2026-10-14 22:59'
due_date: ''
labels: []
dependencies: []
milestone: v1.8
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/cli/commands/doctor.ts
  - src/cli/diagnostics.test.mjs
  - src/core/compat-full.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/documents.test.mjs
  - src/agent/mcp-client.test.mjs
  - README.md
  - templates/qwen-commands/phase-1.md
  - templates/qwen-commands/phase-2.md
  - templates/qwen-commands/phase-3.md
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-close-worktree.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Профиль сессий code: завершение «бумажной» части фазы = backlog_add_comment (1.2) + backlog_update_status (1.0) + backlog_update_task modifiedFiles (4.3) + manage_ac/dod checks (5.6) — до ~10 ходов на операции с одной задачей. Один комбинированный инструмент схлопывает их в 1-2 вызова.

Решение: новый MCP-инструмент backlog_finish_phase {id, status?, comment?, modifiedFiles?, acChecks?, dodChecks?} — атомарно: валидация статуса по конфигу, добавление отчётного комментария, запись modifiedFiles, батч-отметка пунктов AC/DoD (индексы — массивы, как в manage_ac после VL-120). Результат — сводка всех действий (для отчёта агента). Частичные ошибки: невалидный статус или индекс — понятное сообщение, остальные поля применяются (или атомарно — решить при Фазе 2; безопаснее атомарно с явной ошибкой).

Внимание: чек-лист добавления MCP-инструмента (проектная память) — шесть мест: doctor.ts (константа и список имён), diagnostics.test, compat-full.test, server.test (длина tools/list), v11.test, README-пример (21 → 22).

Экономия по профилю: code −4..−6 ходов, spec/close −2..−3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/mcp/tools.ts: backlog_finish_phase {id, status?, comment?, modifiedFiles?, acChecks?: (number|string)[], dodChecks?: (number|string)[]} — все поля опциональны кроме id; статус валидируется по конфигу; checks батчом; результат — сводка «статус X, отчёт добавлен, отмечено AC: N, DoD: M, файлов: K»; частичные ошибки не роняют вызов (чёткие сообщения)
- [x] #2 чек-лист MCP-tool-count (память): doctor.ts (expected = 22 + имя в списке), diagnostics.test.mjs, compat-full.test.mjs, server.test.mjs (длина tools/list), v11.test.mjs, README-пример doctor
- [x] #3 server.test.mjs/mcp-client.test.mjs: кейсы — только status+comment; checks массивом; modifiedFiles; невалидный статус; вызов без обязательных полей кроме id
- [x] #4 шаблоны phase-1/2/3/close/close-worktree: цепочки «add_comment → update_status → update_task(modifiedFiles)» заменены на один finish_phase (списки check по-прежнему через manage_ac/dod до VL-135-all или включаются в acChecks)
- [ ] #5 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Фаза 2 (Plan): MCP backlog_finish_phase — завершение фазы одним вызовом

### Архитектурные решения (приняты здесь)

1. **Частичное применение с чёткими сообщениями** (не атомарно). Обоснование: AC 1 прямо требует «частичные ошибки не роняют вызов (чёткие сообщения)», а описание делегирует выбор Фазе 2. Семантика безопасна: невалидное значение НЕ записывается (ошибка + пропуск поля), валидные поля применяются. Все ошибки валидации собираются ДО единственной записи в файл — запись одна (см. п. 3), «половинчатого» состояния файла не бывает.
2. **Одна запись на вызов**: все валидные обновления (status, modified_files, AC/DoD checked, comments) собираются в объект и применяются ОДНИМ `updateTaskFile` — это даёт и атомарность записи, и экономию.
3. **Автор комментария фиксирован `@agent`** — поле `author` в схему не входит (по AC перечислены только id, status, comment, modifiedFiles, acChecks, dodChecks).
4. **Порядок полезной нагрузки**: getTask (фатально, если нет) → валидация всех полей → сборка updates → одна запись → сводка.
5. **Сводка** (строка, формат по AC): `Статус: X; отчёт добавлен; отмечено AC: N, DoD: M; файлов: K` — непереданные поля отражаются как пропуск («статус: не менялся», «отчёт: нет» и т.п.), ошибки — в конце: `Ошибки: <...>`. Полный формат уточнить в коде; главное — каждый элемент сводки соответствует реально применённому действию.

### Файлы и конкретные места

**1. `src/mcp/tools.ts` (991 строка — основной файл)**
- ~стр. 55–350, `listTools()`: после определения `backlog_search` (перед закрытием массива) добавить определение `backlog_finish_phase`:
  - `inputSchema.properties`: `id` (string), `status` (string), `comment` (string), `modifiedFiles` (array of string), `acChecks`/`dodChecks` (`type: 'array', items: { anyOf: [{type:'number'},{type:'string'}] }`);
  - `required: ['id']`; description на русском с примером сводки.
- Стр. 381–382, `handleToolCall`: после `case 'backlog_add_comment'` добавить `case 'backlog_finish_phase': return toolFinishPhase(args, cwd);`.
- После `toolAddComment` (~стр. 765) — новая секция `/** Завершение фазы одним вызовом (VL-138). */ function toolFinishPhase(args, cwd)`:
  - `getTask(cwd, id)` — нет задачи → throw `Задача <id> не найдена.` (фатально);
  - **status**: если передан и `!loadConfig(cwd).statuses.includes(status)` → в массив ошибок: `Невалидный статус "X". Допустимые: <список из конфига>` — поле не применяется; иначе `updates.status`;
  - **modifiedFiles**: если передан и не массив → ошибка; иначе `updates.modified_files = args.modifiedFiles` (полная замена, как в toolUpdateTask стр. 565);
  - **acChecks / dodChecks**: каждый — `try { parseChecklistIndexes(raw, list.length) } catch (e) { ошибки.push(...) }` против `(task.acceptanceCriteria||[])` / `(task.definitionOfDone||[])`; успех → пометить `list[i-1].checked = true`, в `updates`; посчитать N/M по факту;
  - **comment**: если передан (непустая строка) → `updates.comments = [...(task.comments||[]), {author:'@agent', created: formatNow(), text: comment}]` (как toolAddComment стр. 751–757), иначе ошибка `comment — пустая строка`;
  - одна `updateTaskFile(cwd, id, updates)` (только если updates непуст или был comment — в любом случае вызов успешен);
  - вернуть сводку (см. решение 5) + `Ошибки: ...` при наличии.
- Комментарии на русском, объясняющие «почему» (частичное применение — по AC; одна запись — атомарность файла).

**2. Чек-лист счётчика инструментов (21 → 22) — семь мест (память + проверено grep'ом):**
- `src/cli/commands/doctor.ts` стр. 247: `const expected = 21` → `22`; стр. 264–286: добавить `'backlog_finish_phase'` в массив `expected` (список сортируется, порядок не важен).
- `src/cli/diagnostics.test.mjs` стр. 137/142: «21 штука» / `assert.equal(mcpCheck.value, 21)` → 22.
- `src/core/compat-full.test.mjs` стр. 180–182: «имеет 21 инструмент» / `equal(tools.length, 21)` → 22 + имя в массив `expected` (~стр. 183+).
- `src/mcp/server.test.mjs` стр. 98/105: «возвращает 21 инструмент» / `equal(..., 21)` → 22 + `assert.ok(names.includes('backlog_finish_phase'))`.
- `src/mcp/documents.test.mjs` стр. 59/61: «Все 21 инструмент» / `equal(tools.length, 21)` → 22 (**7-е место, в памяти отсутствовало — обязательно**, иначе pnpm test красный); комментарий стр. 8 «listTools() = 21» → 22.
- `src/mcp/v11.test.mjs` — по памяти; фактически счётчика там нет (проверено grep: только комментарии-заголовки). Действие: после правок прогнать финальный `grep -rn "21" src README.md --include=*.mjs --include=*.ts --include=*.md` и обновить остатки.
- `README.md` стр. 47 («21 MCP-инструмент»), стр. 98 («21 инструмент»), стр. 165 («✓ mcp_tools_count: 21») → 22.

**3. Тесты (AC 3) — в `src/mcp/server.test.mjs`** (там есть `callMcp` JSON-RPC-хелпер; конфиг теста: `statuses: ['To Do','In Progress','Done']` — статусы брать ТОЛЬКО оттуда):
- новый `describe/tools/call — backlog_finish_phase`:
  1. только `status: 'Done'` + `comment` → в ответе сводка со статусом и «отчёт добавлен», файл задачи содержит комментарий и статус;
  2. `acChecks: [1, '2']` после добавления AC → оба пункта checked, в сводке `AC: 2`;
  3. `modifiedFiles: ['src/a.ts']` → `modified_files` в файле задачи;
  4. невалидный статус `'Bogus'` → вызов НЕ падает (не isError), в сводке `Ошибки: ...Невалидный статус...`, статус в файле не изменился, но comment (если был) применён;
  5. вызов только с `{id}` → успешен, сводка «ничего не менялось»;
  6. невалидный индекс `acChecks: ['NaN']` → ошибка в сводке, остальные поля применены;
  7. `id` несуществующей задачи → ошибка «Задача ... не найдена».
- `src/agent/mcp-client.test.mjs` (по AC упомянут): 1 кейс — `listTools` содержит `backlog_finish_phase` с `inputSchema.required == ['id']`.

**4. Шаблоны `templates/qwen-commands/` (AC 4):**
- `phase-1.md` стр. 54–67: варианты «комментарий (полное/неполное описание)» + шаг 7 `update_status Spec` → один `backlog_finish_phase {id, comment, status?}`; статус передаётся только если описание полное (status опционален — ключевое преимущество); сохранить все «ВАЖНО»-инструкции (один вызов, без повторных view_task).
- `phase-2.md` стр. 61–65: шаги 5+6 (отчёт-комментарий + `update_status Planned`) → `backlog_finish_phase {id, comment, status:"Planned"}`; шаг «Blocked» (стр. 47) и ветка эпика (стр. 55–59) не трогаем — там нет цепочки.
- `phase-3.md` стр. 42–50: шаги 6+7+8 (`update_task modifiedFiles` → `add_comment` → `update_status Review`) → один `backlog_finish_phase {id, comment, modifiedFiles, status:"Review"}`; шаг 4 (списки `manage_ac`/`manage_dod` action list + проверка) оставить как есть, но ОТМЕТКУ (action check) включить в `acChecks`/`dodChecks` того же вызова — с оговоркой из AC: «списки по-прежнему через manage_ac/dod, отметки — в acChecks»; шаг 3 (epic → Done) не трогаем.
- `phase-close.md` стр. 25–26 (шаг 3 `update_status Done`) + стр. 46–47 (шаг 6 комментарий) → один `backlog_finish_phase {id, comment, status:"Done"}` на позиции шага 6 (комментарий ДО docs(task)-коммита — сохранить!); шаг 2 (guard про детей эпика) остаётся раньше.
- `phase-close-worktree.md` стр. 53–58 (шаги 7–8: DoD checks + `update_status Done`) + стр. 66–67 (шаг 10 комментарий) → `backlog_finish_phase {id, comment, status:"Done", dodChecks:[...]}`; списки — `manage_dod` action list (оставить); позиция — прежний шаг 10 (до git add задачи).
- `phase-comment.md` — вне AC, не трогаем.
- После правок: `pnpm test -- skills` (skills.test.mjs проверяет состав шаблонов) + ручная сверка, что ни один шаблон не потерял guard-инструкции.

**5. `CHANGELOG.md`** — запись в Unreleased: «Новый MCP-инструмент `backlog_finish_phase` — статус + отчёт + modifiedFiles + батч-отметки AC/DoD одним вызовом (VL-138); шаблоны фаз используют его вместо цепочки add_comment → update_status → update_task; 21 → 22 инструментов».

### Порядок действий

1. `src/mcp/tools.ts`: определение в listTools → case в handleToolCall → `toolFinishPhase`.
2. Счётчики имен (п. 2 чек-листа, все семь мест).
3. Тесты: server.test.mjs (кейсы 1–7), mcp-client.test.mjs (1 кейс).
4. `pnpm build && pnpm test` — добить красное.
5. Шаблоны фаз (п. 4) → `pnpm test` (skills.test).
6. README (3 места), CHANGELOG.
7. Финальный `grep -rn "21" src README.md` (с фильтрами исключений) — остатков счётчика нет.

### Как проверить

```bash
pnpm build && pnpm test          # build + vitest run (включая skills/doctor/compat/server)
grep -rn "length, 21\|value, 21\|=== 21\|21 инструмент\|21 MCP-инструмент\|21 штук" src README.md
```
Красный grep после правок = забытое место счётчика.

### Риски

1. **8-е место счётчика**: grep по README+src покрывает проверенные места; если появится ещё одно (docs/mcp-reference.md лежит в backlog/ и правится только через MCP document_update — при необходимости упомянуть в close) — доберём по факту прогоном.
2. **Статусы в тестах**: тестовый конфиг server.test.mjs даёт `['To Do','In Progress','Done']` — если в кейсах взять «Spec»/«Review», валидация их отвергнет; брать только из списка теста.
3. **Потеря guard-инструкций в шаблонах**: при замене цепочки легко выронить «РОВНО ОДИН РАЗ»/«не вызывай view_task»/«комментарий до коммита» — при правке сверять построчно со старой версией (git diff шаблонов).
4. **Расхождение с описанием по атомарности**: решение «частичное применение» принято по AC 1; если при ревью выберут атомарность — меняется только toolFinishPhase (throw вместо сбора ошибок), счётчики/шаблоны не задеты.
5. **worktree**: код коммитить в ветку vb/vl-138, файлы backlog/ не коммитить.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 18:21
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 10+ файлов (src/mcp/tools.ts — определение + case + toolFinishPhase; 7 мест счётчика 21→22, включая documents.test.mjs, которого не было в чек-листе памяти; тесты server.test/mcp-client.test; 5 шаблонов фаз; README; CHANGELOG). Ключевые решения: частичное применение с чёткими сообщениями (по AC 1) при ОДНОЙ записи updateTaskFile (атомарность файла); фиксированный author @agent; статус валидируется по loadConfig(cwd).statuses. Риски: статусы тест-конфига только ['To Do','In Progress','Done'], потеря guard-инструкций в шаблонах при замене цепочек, возможное 8-е место счётчика (проверка финальным grep).
---
author: @agent
created: 2026-10-13 19:07
---
Фаза 3 (Code) выполнена.
**Изменено (коммит `ae8a619`, ветка vb/vl-138, 13 файлов; backlog/ не коммитился):**
- `src/mcp/tools.ts` — новый MCP-инструмент `backlog_finish_phase`: определение в `listTools()` (id обязателен, status/comment/modifiedFiles/acChecks/dodChecks опциональны), `case` в `handleToolCall`, `toolFinishPhase()` — валидация статуса по `loadConfig().statuses`, батч-отметки AC/DoD через `parseChecklistIndexes`, отчёт-комментарий author=@agent; ошибки собираются ДО единственной записи `updateTaskFile` (частичное применение, файл атомарен), сводка вида `Статус: X; отчёт добавлен; отмечено AC: N, DoD: M; файлов: K; Ошибки: ...`.
- Счётчик инструментов 21 → 22 (7 мест): `src/cli/commands/doctor.ts` (expected=22 + имя в списке), `src/cli/diagnostics.test.mjs`, `src/core/compat-full.test.mjs`, `src/mcp/server.test.mjs`, `src/mcp/documents.test.mjs`, README.md (3 места); в `v11.test.mjs` счётчика нет (проверено grep).
- Тесты: `src/mcp/server.test.mjs` — 7 кейсов finish_phase (status+comment; acChecks [1,'2']; modifiedFiles; невалидный статус не роняет вызов, comment применяется; только {id}; невалидный индекс 'NaN'; несуществующая задача → isError), длина tools/list=22 + имя; `src/agent/mcp-client.test.mjs` — required==['id'].
- Шаблоны: `phase-1/2/3/close/close-worktree.md` — цепочки «add_comment → update_status → update_task(modifiedFiles)» заменены на один `backlog_finish_phase`; списки AC/DoD остались через manage_ac/dod (action list), отметки — в acChecks/dodChecks; guard-инструкции («РОВНО ОДИН РАЗ», «без повторных view_task», «комментарий до docs(task)-коммита») сверены по git diff — сохранены; перенумерация шагов в close-шаблонах, ссылки на шаги обновлены.
**Проверки:** `pnpm build` ✓; `pnpm test` — 52 файла / 893 теста зелёные (единственные 2 падения — флаки `create-flags.test.mjs` под параллельной нагрузкой, при изоляции и повторном полном прогоне зелёные); финальный grep счётчика «21» по src/README/templates — пусто; структурные тесты шаблонов (skills/phase-prompt, инварианты VL-142) зелёные.
**Что осталось:** запись в `CHANGELOG.md` и обновление backlog/docs (`doc-8 MCP-справочник`: «21 → 22 инструмента») — по правилам Фазы 3 не выполняю (пишет Фаза Close, VL-126). Поэтому AC 5 («CHANGELOG: запись») и DoD «Документация обновлена» оставлены незакрытыми — закрыть после добавления записи в Close.
---
author: @agent
created: 2026-10-13 19:34
---
Фаза Close выполнена. Ветка vb/vl-138 слита в master (1 коммит `ae8a619` + merge-коммит), worktree удалена, ветка удалена. Проверки после merge: `pnpm build` ✓, `pnpm test` — 52 файла / все тесты зелёные (exit 0). Документация: запись в CHANGELOG.md (Unreleased → Добавлено, VL-138) + backlog/docs: doc-8 (MCP-справочник: «21 → 22 инструмента», раздел backlog_finish_phase, пример вызова), doc-10 (агент: «22 инструмента», список + finish phase) — docs-коммит `d72c516`. DoD: все 3 пункта отмечены (Тесты проходят; Документация обновлена; Нет регрессий).
---
<!-- COMMENTS:END -->