---
id: VL-262
title: 'Write-инструменты: атомарность обновления, снимок applied/skipped в ответе и idempotencyKey — убрать неопределённость после частичного отказа подтверждения'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 12:21'
updated_date: '2026-10-30 13:32'
due_date: ''
labels:
  - mcp
  - tools
  - agent
  - reliability
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tool-result.ts
  - src/mcp/idempotency.ts
  - src/mcp/tools.ts
  - src/web/chat.ts
  - web/src/lib/chat-threads.ts
  - templates/prompts/chat-system.md
  - templates/agent-prompt.md
  - src/mcp/tool-result.test.mjs
  - src/mcp/idempotency.test.mjs
  - src/mcp/write-ack.test.mjs
  - src/web/chat.test.mjs
  - src/web/chat-thread-restore.test.mjs
lessons:
  - lesson-105
token_usage:
  input: 11082142
  output: 93640
  cache: 10720768
  total: 11175782
  requests: 152
  duration_ms: 2443222
  reasoning: 47073
  by_phase:
    plan:
      input: 1496693
      output: 29113
      cache: 1439232
      requests: 29
    code:
      input: 8691726
      output: 57965
      cache: 8564736
      requests: 101
    close:
      input: 893723
      output: 6562
      cache: 716800
      requests: 22
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В этой сессии агент вызвал `backlog_update_task` для VL-254 с `labels` и `priority` — вызов вернул `Отменено: не было подтверждения пользователя` (см. VL-256), и задача осталась частично обновлённой: `title`/`type` изменены, `labels`/`priority` — нет. Пользователь подтвердил, что разрешения не запрашивал и не отказывал.

Независимо от того, кто виноват (платформа или агент), есть проблема надёжности для агента: **частично применённое обновление неотличимо от полного, а повтор вызова не идемпотентен по замыслу пользователя** — агент не знает, применилось ли его намерение целиком. А в веб-чате агент часто разбивает намерение на несколько write-вызовов (title, потом labels, потом priority), что увеличивает окно.

## Цель

Чтобы агент после (частичного) отказа мог безопасно восстановить состояние и точно знать, что применилось.

## Предлагаемое решение (уточнить в Plan)

1. В ответе write-инструмента возвращать **снимок реально применённых изменений** (`applied: {field: value}` и `skipped: [...]`) — чтобы агент видел, что именно записалось, не делая повторного чтения.
2. Поддержать **атомарность обновления**: `backlog_update_task` с несколькими полями применяется целиком или не применяется вовсе (сейчас — частями при сбое подтверждения).
3. Поддержать **идемпотентный ключ**: параметр вроде `idempotencyKey` в write-вызовах; повтор с тем же ключом после отказа возвращает результат первого успешного применения, не дублируя эффект (важно для `backlog_create_task` — сейчас повтор после «Отменено» создал бы дубль задачи; в этой сессии VL-255 создалась со второго раза, и это могло стать дублем, если бы первый вызов всё-таки прошёл).
4. В тексте отказа различать «пользователь отказал» и «подтверждение не получено» (пересекается с VL-256, но здесь — про контракт ответа инструмента, а не про UI диалога).
5. Тест: обновление 3 полей при отказе на подтверждении → состояние не изменилось (атомарность); повтор create с тем же `idempotencyKey` → одна задача, а не две.

## Связанное

VL-256 (потеря подтверждения при нескольких write в ходе — первопричина UI), VL-255 (дедуп/лимит вызовов), VL-219 (права/подтверждения веб-чата).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Write-инструменты (create/update_task/update_status/add_comment/update_dependencies) возвращают JSON-снимок applied и skipped; message сохраняет прежние формулировки «создана»/«обновлена»
- [x] #2 Переданное поле вне известного набора попадает в skipped с причиной (сейчас молча игнорируется)
- [x] #3 Атомарность: обновление с 3 полями при ошибке валидации/отсутствии подтверждения не меняет ни одного поля
- [x] #4 Параметр idempotencyKey в write-схемах: повтор с тем же ключом возвращает результат первого применения без второго эффекта (create не создаёт дубль)
- [x] #5 Текст отказа различает reason='denied' (пользователь отказал) и reason='not_confirmed' (подтверждение не получено), applied={} и skipped с перечнем неприменённых полей
- [x] #6 Тесты: атрибутика applied/skipped, атомарность при отказе, повтор create с idempotencyKey → одна задача; полный pnpm test зелёный
- [x] #7 Документация: doc-8 (контракт ответа + причины отказа), templates/prompts/chat-system.md и templates/agent-prompt.md (как читать applied/skipped и когда передавать idempotencyKey)
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

Сделать write-вызовы MCP предсказуемыми для агента: (1) ответ отдаёт снимок `applied`/`skipped` вместо «голого» текста, (2) один write-вызов = ровно одна запись (атомарность на границе MCP и на границе chat-approval), (3) `idempotencyKey` даёт безопасный повтор после отказа, (4) отказ различает «пользователь отказал» и «подтверждение не получено».

## Диагноз по коду (что реально порождает неопределённость)

1. `toolUpdateTask` (`src/mcp/tools.ts:944`) и `toolCreateTask` (`:743`) возвращают **строку-текст** (`Задача X обновлена: title, type`) — состав применённого вычисляется из `Object.keys(updates)`, т.е. из **переданных** полей, а не из фактически записанных. `skipped` не существует.
2. **Молчаливый skip** — главный источник «частичности»: `args` с ключом вне известного списка (опечатка поля, camelCase-вариант вроде `acceptance_criteria_2`, `definitionOfDone`) просто игнорируется: `toolUpdateTask` не смотрит на `Object.keys(args)`. Агент считает, что записал поле.
3. `toolCreateTask` с `args.type`, `args.priority` и прочими не валидируется по конфигу (только `type` через `normalizeTaskType`) — но и не сообщает, что значение уселось.
4. **Частичность в веб-чате** (`src/web/chat.ts`): если модель в одном ходе выдала несколько write-вызовов, первый уходит в approval и цикл делает `return` (`:521-524`); при resume одобряется только `target` (`:432-449`), а остальные write закрываются синтетическим `{"error":"Отменено: не было подтверждения пользователя"}` (`:570`). Итог для модели: часть намерения применена, часть — нет, и отличить это от «ничего не применено» она не может.
5. Тексты отказа **разные и не кодируют причину**: `:184` «Отменено пользователем», `:447` «Пользователь отклонил операцию», `:570` «Отменено: не было подтверждения пользователя» — все в теле `{error}`, машиночитаемого признака нет.
6. Атомарность на уровне ядра уже есть: `updateTaskFile` (`src/core/store.ts:127`) делает один `writeFileSync`, а `toolUpdateTask` собирает `updates` и валидирует (`parentTaskId`, `parseAcList`) **до** записи. То есть «полуприменённого файла» не бывает — ломается только контракт ответа и граница approval. Это надо зафиксировать тестами-инвариантами, а не переписывать ядро.

## Файлы и точки изменения

### 1. Новый `src/mcp/tool-result.ts` (~90 строк) — единый контракт ответа write-инструмента
- `export interface WriteAck { ok: true; message: string; applied: Record<string, unknown>; skipped: SkippedField[]; idempotentReplay?: true }`
- `export interface SkippedField { field: string; reason: string }`
- `export function ackOk(message: string, applied: Record<string, unknown>, skipped: SkippedField[] = []): string` — `JSON.stringify(ack, null, 2)`. **`message` сохраняет текущие русские формулировки** (`Задача X создана: …`, `Задача X обновлена: …`) — существующие substring-проверки (`chat.test.mjs:347`, `types.test.mjs:220/274`, `src/agent/mcp-client.test.mjs:106`) остаются зелёными.
- `export type DenyReason = 'denied' | 'not_confirmed'`
- `export function ackDenied(reason: DenyReason, extra?: { tool?: string; fields?: string[] }): string` — JSON
  `{ ok:false, denied:true, reason:'denied'|'not_confirmed', applied:{}, skipped:[…переданные поля…], message, hint }`:
  - `denied` → «Пользователь отклонил операцию — изменения НЕ применены. Повтор без нового решения пользователя бессмыслен: спроси, что изменить.»
  - `not_confirmed` → «Подтверждение не получено (вызов не дошёл до диалога) — изменения НЕ применены. Это не отказ пользователя: вызов можно безопасно повторить с тем же idempotencyKey.»
  - `skipped` заполняется всеми переданными полями с reason `not applied (no approval)` — так агент видит, что именно НЕ записалось.
- `export function ackError(message: string): string` — `{ok:false, error: message}` для переиспользования в chat.

### 2. Новый `src/mcp/idempotency.ts` (~110 строк) — хранилище ключей
- Путь: `join(cwd, '.vibelog', 'idempotency.json')` (`settingsPath` из `src/core/settings.ts` — образец; `.vibelog/` в `.gitignore`, в backlog не попадает).
- Формат: `{ version: 1, entries: { "<tool>:<key>": { at: ISO, result: string } } }`, TTL 24 ч (просроченные вычищаются при каждой записи), кап 200 записей (FIFO по `at`), атомарная запись `writeFileSync(tmp)` + `renameSync`.
- `export function withIdempotency(cwd: string, tool: string, key: string | undefined, run: () => string): string`:
  - без `key` (undefined/пустая строка) → `run()` как раньше;
  - `key` есть и запись найдена → вернуть `хранимый result` (JSON уже содержит `message`), не вызывая `run()`;
  - иначе `run()`, сохранить результат и вернуть.
  - Битый JSON / ошибки ФС → ключ игнорируется (fail-open: не блокируем write из-за кэша), диагностика через `console.error` (lesson-77).
- Валидация ключа на границе: `typeof key === 'string'`, длина ≤ 200, иначе `throw new Error('idempotencyKey: ожидается строка до 200 символов')` (lesson-34/lesson-94 — параметр объявить в `inputSchema`, не только в описании).

### 3. `src/mcp/tools.ts` — схемы + снимок applied/skipped
- Схемы `listTools()`: добавить `idempotencyKey: { type: 'string', description: 'Ключ идемпотентности: повтор с тем же ключом НЕ применяет изменения второй раз, а возвращает результат первого применения. Используй при повторе после отказа/таймаута.' }` в `backlog_create_task` (`:85`), `backlog_update_task` (`:154`), `backlog_update_status` (`:142`), `backlog_add_comment` (`:214`), `backlog_update_dependencies`. Счётчик инструментов НЕ меняется (новых инструментов нет) — правки в `doc-8`/`doctor` по счётчику не нужны.
- `case 'backlog_create_task' | 'backlog_update_task' | 'backlog_update_status' | 'backlog_add_comment' | 'backlog_update_dependencies'` в `handleToolCall` (`:655+`): обернуть в
  `withIdempotency(cwd, name, args.idempotencyKey as string, () => toolX(args, cwd))`.
- `toolCreateTask` (`:743`): собрать `applied` из **фактической** задачи (`id, title, status, priority, labels, assignee, type, parent_task_id, milestone, due_date, project, ordinal, description?, acceptanceCriteria(length)`) и `skipped` для переданных ключей вне известного набора (`title, description, priority, labels, dependencies, acceptanceCriteria, status, type, parentTaskId, due_date, ordinal, project, finalSummary, assignee, milestone, idempotencyKey`) с reason `неизвестное поле инструмента`. Возврат — `ackOk(\`Задача ${task.id} создана: ${task.title}\`, applied, skipped)`.
- `toolUpdateTask` (`:944`): после сбора `updates` посчитать `skipped` (ключи `args` вне известного набора + переданные `null` — сейчас `type: null` молча игнорируется) и `applied` — `Object.keys(updates)` → значения из **вернувшейся** `task` (после `updateTaskFile`), а не из `updates`. Возврат — `ackOk(\`Задача ${task.id} обновлена: ${Object.keys(updates).join(', ')}\`, applied, skipped)`. Порядок валидации сохранить: все throw (`parentTaskId`, `parseAcList`, «Не указаны поля») — ДО единственного `updateTaskFile` (атомарность).
- `toolUpdateStatus` (`:929`), `toolAddComment` (`:1209`), `toolUpdateDependencies`: ответ через `ackOk` с `applied: { status }` / `applied: { comment: {author, created} }` / `applied: { dependencies }`.

### 4. `src/web/chat.ts` — кодировать причину отказа
- `:184` (`closePendingToolCalls`) → `ackDenied('denied')` с сохранением подстроки «Отменено пользователем» в `message` (тест `chat-thread-restore.test.mjs:97-101` проверяет `{error:'Пользователь отклонил'}` — тест обновить под новый контракт: `part.result.denied === true`).
- `:447` (resume, `approved: false`) → `ackDenied('denied', { tool: target.name, fields: Object.keys(target.arguments ?? {}) })`.
- `:570` (`closeRemainingPending`) → `ackDenied('not_confirmed', { tool: tc.name, fields: Object.keys(tc.arguments ?? {}) })`.
- При `approved: true` — ответ уже приходит из `handleToolCall` в новом формате, правок нет.
- Комментарий в шапке `executeTool` дополнить: единый контракт ack.

### 5. Документация (короткие вставки, без переписывания)
- `templates/prompts/chat-system.md`: абзац «После отказа/ошибки write-вызова смотри `applied`/`skipped` в ответе: `applied` — что уже записано, `skipped` — что не записано и почему. Для write-вызовов передавай `idempotencyKey`; повторяй вызов только с тем же ключом.»
- `templates/agent-prompt.md`: та же мысль одним пунктом (без ID задач — lesson-29).
- `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` §`backlog_update_task` (`:84`): подраздел «Контракт ответа» — JSON `{ok, message, applied, skipped, idempotentReplay}` + причина отказа `denied` vs `not_confirmed` (5–10 строк). Правка — в фазе Code (в Plan документы не пишем, lesson-63); README — не трогаем.

## Тесты

### Новые
- `src/mcp/tool-result.test.mjs` (5): `ackOk` — валидный JSON, `applied`/`skipped` сохраняются, `message` содержит «обновлена»; `ackDenied('denied')` → `denied:true, reason:'denied', applied:{}`, текст про отклонение пользователем; `ackDenied('not_confirmed')` → текст «не отказ пользователя», `skipped` из `fields`.
- `src/mcp/idempotency.test.mjs` (5, `mkdtempSync` — VL-241): без ключа `run` зовётся дважды; с ключом — второй вызов НЕ зовёт `run` и отдаёт тот же result; разные ключи — разные записи; TTL-очистка (записать `at` в прошлом через прямой файл); битый `idempotency.json` → fail-open (`run` вызывается, файл перезаписывается).
- `src/mcp/write-ack.test.mjs` (6, `mkdtempSync` + `init`-подобная подготовка как в `types.test.mjs`):
  1. `backlog_update_task` с 3 полями → в ответе `applied` содержит ровно эти 3 поля со значениями из файла задачи;
  2. `backlog_update_task` с неизвестным ключом (`definitionOfDone`) → поле не записано, в `skipped` есть `{field:'definitionOfDone', reason: …}`;
  3. **атомарность на ошибке валидации**: `{title, labels, parentTaskId:'нет-такой'}` → throw, и `title`/`labels` в файле НЕ изменились;
  4. `backlog_create_task` с `idempotencyKey` дважды → ровно одна задача, второй ответ `idempotentReplay` (в `listTasks` — 1 запись);
  5. `backlog_update_task` с `idempotencyKey` дважды → второе применение не перезаписало `updated_date` (файл не тронут);
  6. `null` в `type` → `skipped` (поле не стёрто).
- `src/web/chat.test.mjs` +3:
  - Deny на `backlog_update_task` с 3 полями → **все три** поля равны исходным, tool-result `denied:true, reason:'denied'`, `skipped` = 3 поля;
  - второй write-вызов того же хода без подтверждения → tool-result `reason:'not_confirmed'`, а не `denied` (различие контракта); ни одно поле не изменено;
  - Allow после `not_confirmed`-повтора c тем же `idempotencyKey` → одно применение (нет дубля задачи для create).

Правка существующего: `src/web/chat-thread-restore.test.mjs:97-101` — ожидание нового формата отказа.

## Порядок действий

1. `src/mcp/tool-result.ts` + `src/mcp/tool-result.test.mjs`.
2. `src/mcp/idempotency.ts` + `src/mcp/idempotency.test.mjs`.
3. `src/mcp/tools.ts`: схемы → обёртки `withIdempotency` → `ackOk` в 5 write-инструментах.
4. `src/web/chat.ts`: три точки отказа → `ackDenied`; обновить `chat-thread-restore.test.mjs`.
5. `src/mcp/write-ack.test.mjs`, правки `src/web/chat.test.mjs`.
6. Шаблоны промптов (`chat-system.md`, `agent-prompt.md`) + doc-8.
7. Прогон: `pnpm build && pnpm test` (полный, без `--exclude`); точечно в процессе — `pnpm test:fast -- src/mcp/write-ack.test.mjs src/mcp/idempotency.test.mjs src/web/chat.test.mjs`.

## Риски и как снимаем

- **R1. Ответ MCP стал JSON — ломает парсеры.** Все найденные substring-проверки (`создана`, `обновлена`) сохранены в поле `message`; полный `JSON.parse` применяется только к read-инструментам (`list/view/search/milestones`), которые не менялись. Перед фиксацией — `grep -n "JSON.parse" src/**/*.test.mjs | grep -v "list\|view\|search\|milestones"` и прогнать полный `pnpm test`.
- **R2. `.vibelog/idempotency.json` в branch-mode.** MCP получает `VIBELOG_CWD` главного репо (lesson-13) — ключи и результаты будут в главном репо, что и нужно (файл gitignored, доставка не нужна).
- **R3. Рост файла ключей.** TTL 24 ч + кап 200 записей, вычистка при записи.
- **R4. Модель не передаёт `idempotencyKey`.** Тогда поведение = сегодняшнее (обёртка прозрачна); ценность даёт `applied`/`skipped` и тексты отказа. Стимул — инструкция в `chat-system.md` и `description` схемы (не `required` — иначе сломаются все существующие вызовы, lesson-94 здесь осознанно не применяется).
- **R5. `applied` раздувает ответ.** Только скалярные значения переданных полей + длина `acceptanceCriteria`; общий кап `truncateToolOutput` (8 КБ) действует как раньше (lesson-30).
- **R6. Регресс approval-семантики.** Ничего в порядке approval не меняем: только текст/форма результата отказа; Allow-путь не тронут — проверяется существующими 10 тестами `chat.test.mjs`.

## Вне scope (в этой задаче НЕ делаем)

- UI-диалога подтверждения и потеря подтверждения при нескольких write в ходе — VL-256 (первопричина), здесь только контракт ответа инструмента.
- Дедуп/лимит вызовов модели — VL-255.
- Изменение порядка approval для нескольких write-вызовов одного хода — обсуждается в VL-256; контракт `not_confirmed` даёт агенту достаточно информации уже сейчас.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 12:42
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, не epic) — план записан в эту же задачу, дочерних задач не создавал.
Что изучено: `src/mcp/tools.ts` (схемы write-инструментов :85/:142/:154/:214; `toolCreateTask` :743, `toolUpdateStatus` :929, `toolUpdateTask` :944, `toolAddComment` :1209), `src/core/store.ts` (`createTaskFile` :88, `updateTaskFile` :127 — единственный writeFileSync, т.е. атомарность ядра уже есть), `src/web/chat.ts` (approval-loop :520-524, resume :432-449, `closeRemainingPending` :555-588, `closePendingToolCalls` :168), `src/web/tool-policy.ts` (`isWriteOperation`), `src/mcp/server.ts` (формат tools/call), `src/core/settings.ts` (образец `.vibelog/`-пути).
Диагноз: неопределённость порождают (1) текстовый ответ без снимка применённого (`Object.keys(updates)` — переданное, а не записанное), (2) молчаливый игнор ключей вне известного набора в `toolUpdateTask`, (3) три разных текста отказа без машиночитаемой причины («Отменено пользователем» :184, «Пользователь отклонил операцию» :447, «Отменено: не было подтверждения пользователя» :570), (4) при нескольких write в ходе подтверждается только первый, остальные получают синтетический отказ — неотличимый от «ничего не применено».
Решения: новый `src/mcp/tool-result.ts` (единый контракт `{ok, message, applied, skipped, idempotentReplay}`; `message` сохраняет подстроки «создана»/«обновлена» — существующие тесты зелёные) и `src/mcp/idempotency.ts` (`.vibelog/idempotency.json`, TTL 24 ч, кап 200, fail-open, `withIdempotency`). `idempotencyKey` — опциональный параметр в 5 write-схемах (не `required`, иначе сломаются все существующие вызовы). Отказ кодируется `ackDenied('denied' | 'not_confirmed')` в трёх точках `src/web/chat.ts`. Ядро не переписываем — атомарность фиксируем тестами-инвариантами.
Объём: 2 новых модуля + 2 новых тест-файла + 1 новый MCP-тест, правки `src/mcp/tools.ts`, `src/web/chat.ts`, `src/web/chat-thread-restore.test.mjs`, `src/web/chat.test.mjs`, `templates/prompts/chat-system.md`, `templates/agent-prompt.md`, doc-8. Все пути проверены `ls`.
Риски: R1 ответ MCP стал JSON (снят сохранением `message`, полный grep по `JSON.parse` перед фиксацией + полный `pnpm test`); R2 ключи в branch-mode пишутся в главный репо через `VIBELOG_CWD` (lesson-13, файл gitignored — так и нужно); R3 рост файла ключей (TTL+кап); R4 модель не передаёт ключ (поведение = сегодняшнее); R5 объём ответа (только скаляры + кап 8 КБ); R6 approval-семантика не меняется.
AC: добавлено 7 критериев приёмки (снимок applied/skipped; skipped для неизвестных полей; атомарность при отказе; idempotencyKey без второго эффекта; distinction denied/not_confirmed; тесты; документация). Вне scope: UI-причина потери подтверждения (VL-256) и дедуп вызовов (VL-255).
---
author: @agent
created: 2026-10-30 13:15
---
Фаза 3 (Code) выполнена. Коммит 96f24f7.
Новые файлы:
- `src/mcp/tool-result.ts` — единый контракт ответа write-инструмента: `ackOk(message, applied, skipped, idempotentReplay)` → JSON `{ok, message, applied, skipped, idempotentReplay?}`, `ackDenied('denied'|'not_confirmed')` → `{ok:false, denied:true, reason, applied:{}, skipped, message, hint}` (кастомный текст причины сохраняется в message), `ackError`, `unknownFields`.
- `src/mcp/idempotency.ts` — `.vibelog/idempotency.json` (gitignored), ключ `<tool>:<key>`, TTL 24 ч, кап 200 записей (FIFO), атомарная запись tmp+rename, fail-open при битом JSON/ошибке ФС (console.error), `normalizeIdempotencyKey` (валидация на границе), `withIdempotency` (повтор → сохранённый результат + `idempotentReplay: true`).
- Тесты: `src/mcp/tool-result.test.mjs` (9), `src/mcp/idempotency.test.mjs` (9), `src/mcp/write-ack.test.mjs` (11 — applied из файла, skipped для неизвестного поля и `type:null`, атомарность на ошибке `parentTaskId`, ошибка с перечнем допустимых при одних неизвестных полях, идемпотентность create/update/add_comment, applied у update_status/update_dependencies).
Правки:
- `src/mcp/tools.ts`: `idempotencyKey` в схемы 5 write-инструментов (create/update_task/update_status/add_comment/update_dependencies; счётчик инструментов не менялся); `handleToolCall` оборачивает эти 5 вызовов в `withIdempotency`; `toolCreateTask` отдаёт applied из задачи после записи (id/title/status/priority/labels/assignee/type/parent/milestone/due_date/project/ordinal/AC-длина/description) + skipped по `unknownFields`; `toolUpdateTask` — applied из вернувшейся задачи (AC сворачивается до длины), skipped = неизвестные ключи + переданный `null`, порядок валидаций сохранён (все throw до единственного `updateTaskFile`); при пустом наборе полей ошибка теперь перечисляет и неизвестные поля, и допустимые; `toolUpdateStatus`/`toolAddComment`/`toolUpdateDependencies` → `ackOk`.
- `src/web/chat.ts`: три точки отказа переведены на `ackDenied` — `closePendingToolCalls` (denied, message «Пользователь отклонил операцию…», текст причины из UI сохраняется), resume с `approved:false` (denied + tool + skipped), `closeRemainingPending` (not_confirmed + tool + skipped).
- `web/src/lib/chat-threads.ts`: `{ok:false}` теперь помечается `isError` (карточка не врёт), старый `{error}` формат по-прежнему распознаётся.
- Тесты: `src/web/chat.test.mjs` +3 (Deny на 3 поля → ни одно не изменено, applied пуст, skipped = 4 переданных поля; второй write хода → reason `not_confirmed` с hint про idempotencyKey, первый применён/второй нет; повтор create с тем же ключом → одна задача + `idempotentReplay`), `src/web/chat-thread-restore.test.mjs` (тест отказа переведён на новый контракт + добавлен тест обратной совместимости `{error}`).
- `templates/prompts/chat-system.md` и `templates/agent-prompt.md`: абзац про чтение applied/skipped, idempotencyKey и различение denied/not_confirmed.
Проверки: `pnpm build` — чисто; `pnpm web:build` — чисто (потребовался `pnpm --dir web install`, каталог `web/node_modules` в worktree отсутствовал; `web/dist` пересобран и закоммичен, старый бандл удалён); полный **`pnpm test`** — 95 файлов / 1751 passed, 4 skipped (предсуществующие skip в `src/core/frontmatter.test.mjs`), падений нет. Полный прогон, без `--exclude`/`--skip` сверх имеющихся в самом наборе.
Что осталось: AC7 закрыт частично — шаблоны промптов обновлены, но `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` в фазе Code не правился (правило фазы: документы backlog/docs пишет Close). По этому пункту AC7 не отмечен; раздел «Контракт ответа» (JSON applied/skipped, denied vs not_confirmed) нужно дописать в doc-8 в фазе Close. CHANGELOG также оставлен на Close.
Lessons: создан lesson-105 (снимок applied/skipped вместо перечисления аргументов) и связан с задачей.
---
author: @agent
created: 2026-10-30 13:32
---
Фаза Close выполнена. Ветка vb/vl-262 (1 коммит, 96f24f7) слита в master merge-коммитом без конфликтов; worktree .vibelog/worktrees/vl-262 удалён (в нём были только untracked-симлинки node_modules/references — снят с force), ветка vb/vl-262 удалена.
Проверки на master после merge: `pnpm build` — чисто; ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD` (`src/mcp/{tool-result,idempotency,write-ack}.test.mjs`, `src/web/{chat,chat-thread-restore}.test.mjs`) — зелено; полный `pnpm test` — 98 файлов / 1808 passed, 4 skipped (предсуществующие skip в `src/core/frontmatter.test.mjs`), падений нет, повторных полных прогонов не было.
Документация закрыта в фазе Close: doc-8 — новый раздел «Контракт ответа write-инструментов» (JSON {ok, message, applied, skipped, idempotentReplay}, различие denied / not_confirmed, строка `idempotencyKey` в таблице параметров), CHANGELOG Unreleased — запись VL-262. Шаблоны промптов (`chat-system.md`, `agent-prompt.md`) были обновлены в фазе Code.
Коммиты: d5fa25e `docs(task): VL-262 — refs и lessons` (lesson-105), 075f098 `docs: VL-262 — документация и CHANGELOG`.
DoD: все три пункта выполнены — «Тесты проходят» (полный прогон зелёный), «Документация обновлена» (doc-8 + CHANGELOG + шаблоны промптов), «Нет регрессий» (полный набор без падений). AC7 отмечен — документация закрыта. Lessons: lesson-105 (снимок applied/skipped вместо перечисления аргументов) создан и связан с задачей.
---
<!-- COMMENTS:END -->