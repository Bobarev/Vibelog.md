---
id: VL-391
title: 'Приём входящих отчётов через MCP: upstream_list_reports + upstream_ack_report (accept/reject с причиной), доступ у ролей Помощник и Архитектор'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 19:45'
updated_date: '2026-11-09 21:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.13
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/upstream-git.ts
  - src/core/upstream-git.test.mjs
  - src/mcp/tools.ts
  - src/mcp/upstream-tool.test.mjs
  - src/mcp/server.ts
  - src/web/tool-policy.ts
  - src/web/personas.ts
  - src/core/tool-kinds.ts
  - src/core/tool-classify.test.mjs
  - templates/prompts/assistant.md
  - templates/prompts/architect.md
  - CHANGELOG.md
  - backlog/docs/doc-28-GitVerse-Issues-канал-баг-репортов-между-проектами-VL-363.md
  - .vibelog/upstream-inbox/.gitverse/scripts/validate-paths.sh
  - src/web/tool-policy.test.mjs
  - src/web/personas.test.mjs
  - src/core/compat-full.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/core/fixtures/reports/vl/2026-11-08-VL-375-example.md
  - templates/prompts/personas/helper.md
  - templates/prompts/personas/architect.md
lessons:
  - lesson-271
token_usage:
  input: 19521920
  output: 92362
  cache: 17715200
  total: 19614282
  requests: 225
  duration_ms: 1474856
  reasoning: 28879
  by_phase:
    code:
      input: 17768232
      output: 83488
      cache: 16166912
      requests: 189
    close:
      input: 1753688
      output: 8874
      cache: 1548288
      requests: 36
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

VL-375 дал git-транспорт: `upstream report` (отправка), `upstream pull` (список), `upstream ack` (подтверждение). Живой прогон mesh `vl`↔`ui` прошёл, реальный дефект отправлен в `tpl`.

Но приём отчёта остался ручным: прочитать markdown, создать задачу, связать через `ack`. Пользователь сформулировал целевой сценарий:

1. Зайти в чат — у роли «Помощник» должна быть возможность посмотреть новые входящие отчёты через MCP (как и отправка: инструмент появляется только при настроенном `upstream`).
2. Обсудить с ассистентом, какие отчёты принять, а какие отклонить.
3. Ассистент создаёт задачи и связывает их с отчётами.

## Чего не хватает

**Нет чтения входящих через MCP.** `upstream_report_bug` умеет только отправлять. Список доступен лишь через CLI `upstream pull`, а агент в чате CLI не вызывает.

**Нет отклонения.** Статусы `open | accepted | done` — «отвергнуть» выразить нечем. Отчёт либо висит `open` вечно, либо помечается `accepted` без задачи.

**Нет связи отчёт → задача на стороне получателя.** `ack` пишет `accepted_as`, но задача об этом не знает — обратной ссылки нет.

## Решение

Два новых MCP-инструмента, симметричных `upstream_report_bug`:

- `upstream_list_reports` (read) — входящие для своего префикса, опционально полное тело одного;
- `upstream_ack_report` (write) — `accept` (с `task_id`) или `reject` (с `reason`).

Автосоздания задач **нет** — принципиально: решение принимает человек в диалоге, инструмент только фиксирует. Это же разделение, что у `backlog_create_task` (агент создаёт по просьбе) и `git_commit` (явные пути).

## Отклонение отчёта требует правки CI

CI-валидация в инбоксе разрешает менять в чужих отчётах только `status` и `accepted_as`:

```bash
grep -vE '^[+-][[:space:]]*(status|accepted_as):'
```

Причина отказа — самое ценное в отказе (иначе отправитель не поймёт, что делать), поэтому вводим `rejected_reason` и расширяем whitelist. Это **второй репозиторий** (`Vibelog-md/upstream-reports`), отдельный коммит — синхронная правка двух мест.

## Доступ ролей

Пользователь: инструменты должны быть у «Помощника» и у «Архитектора» (включая отправку). Механика: `chatToolDefs` отдаёт все MCP-инструменты минус `CHAT_DISALLOWED_TOOLS`; роль с `allow_tools` получает только перечисленное. Значит для ролей с явным списком имена надо добавить, для остальных доступ появится сам.

## Ссылки

- VL-375 (git-транспорт, источник `report`/`pull`/`ack`)
- VL-388 (валидация `--as` в CLI — тот же класс, здесь закрывается для MCP через `getTask`)
- VL-387 (порядок проверок в CI-скрипте)
- Живой прогон: отчёт `VL-390` → `tpl` (первый реальный кейс)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новый MCP-инструмент `upstream_list_reports` (read): возвращает входящие отчёты для своего префикса — `report_id`, `source_project`, `source_task`, `title`, `target`, `severity`, `area`, `created`, `status`; параметр `report_id` возвращает полное тело одного отчёта; параметр `include_resolved` (по умолчанию false) добавляет `accepted`/`rejected`
- [x] #2 Новый MCP-инструмент `upstream_ack_report` (write): `report_id` + `action: accept|reject`; для `accept` обязателен `task_id`, для `reject` — `reason`. Возвращает JSON-ack по контракту VL-357 (`outcome`, `applied`, `message`)
- [x] #3 `task_id` в `upstream_ack_report` валидируется локально через `getTask(cwd, task_id)`: несуществующая задача → `outcome: 'rejected'` с подсказкой, запись не выполняется. Это закрывает класс дефекта VL-388 (CLI писал `--as` вслепую) для MCP-пути
- [x] #4 При `accept` инструмент атомарно: (1) пишет `status: accepted` + `accepted_as: <task_id>` в отчёт, (2) добавляет комментарий в задачу `<task_id>` со ссылкой на отчёт (`report_id`, `source_project`, `source_task`), (3) commit + push в инбокс. При `reject` — `status: rejected` + `rejected_reason: <reason>`, комментарий в задачу не пишется
- [x] #5 Статусы отчёта расширены: `open | accepted | rejected | done` (`REPORT_STATUSES` в `src/core/upstream-git.ts`). Поле `rejected_reason` добавлено в `REPORT_FIELDS` (порядок полей — источник истины формата, тест-паритет с образцом обновлён)
- [x] #6 `replaceAckFields` умеет писать три поля (`status`, `accepted_as`, `rejected_reason`) и остаётся построчной правкой: остальное тело файла байт-в-байт. При `accept` `rejected_reason` очищается, при `reject` `accepted_as` очищается — отчёт не может быть одновременно принят и отклонён
- [ ] #7 CI-валидация в инбоксе (`.gitverse/scripts/validate-paths.sh`, репозиторий `Vibelog-md/upstream-reports`) разрешает менять в чужих отчётах `status`, `accepted_as` и `rejected_reason` — whitelist расширен, отдельный коммит в инбокс, CI на нём зелёный
- [x] #8 Оба новых инструмента видны только при настроенном `upstream` — тот же предикат `isUpstreamConfigured(cwd)`, что у `upstream_report_bug`, в трёх местах: `handleToolsList` (`src/mcp/server.ts`), `chatToolDefs` (`src/web/tool-policy.ts`), и прямой `tools/call` без секции даёт actionable `ackError` про `.vibelog/settings.json`
- [x] #9 Роли «Помощник» и «Архитектор» имеют доступ ко всем трём инструментам (`upstream_report_bug`, `upstream_list_reports`, `upstream_ack_report`): если у роли задан `allow_tools` — имена добавлены в список; если не задан — доступ есть автоматически. Проверено тестом на реестре персон
- [x] #10 `TOOL_KINDS` (`src/core/tool-kinds.ts`) дополнен: `upstream_list_reports` → `read`, `upstream_ack_report` → `write`. Тест паритета `tool-classify` проходит (таблица сверяется с `listTools()`)
- [x] #11 Тесты `src/core/upstream-git.test.mjs`: accept пишет два поля и чистит `rejected_reason`; reject пишет `rejected_reason` и чистит `accepted_as`; `listIncoming` не показывает `rejected` по умолчанию; `include_resolved` показывает
- [x] #12 Тесты `src/mcp/upstream-tool.test.mjs`: видимость трёх инструментов при трёх состояниях конфига; `ack_report` с несуществующим `task_id` → `rejected` без записи; `ack_report` accept → комментарий в задаче появился; `list_reports` с `report_id` отдаёт тело
- [ ] #13 `pnpm build && pnpm test` зелёный; doc-28 обновлён (раздел про приём отчётов: два инструмента, статусы, роль `rejected_reason`, сценарий «обсудили → создали задачу → связали»); CHANGELOG — запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План

### 1. Статусы и поля отчёта — `src/core/upstream-git.ts`

```ts
export const REPORT_STATUSES = ['open', 'accepted', 'rejected', 'done'] as const;

export const REPORT_FIELDS = [
  'report_id', 'source_project', 'source_prefix', 'source_task', 'title',
  'target', 'severity', 'area', 'created', 'status', 'accepted_as',
  'rejected_reason',          // ← новое, последним: старые отчёты парсятся как ''
] as const;
```

`parseReport` — добавить `rejected_reason: str('rejected_reason')`.
`serializeReport` — поле попадает автоматически (идёт по `REPORT_FIELDS`).

**Совместимость:** старые отчёты без поля парсятся с `rejected_reason: ''`; при следующей записи поле появится. Тест-паритет с образцом `src/core/fixtures/reports/vl/…-example.md` обновить (добавить строку).

### 2. `replaceAckFields` → обобщить на три поля

Сейчас функция пишет ровно `status` + `accepted_as` и падает, если поля нет. Меняем сигнатуру:

```ts
export interface AckFields {
  status: 'accepted' | 'rejected';
  acceptedAs?: string;      // для accept
  rejectedReason?: string;  // для reject
}

export function replaceAckFields(text: string, fields: AckFields): string
```

Правила:
- `status` — всегда;
- `acceptedAs` — при `accept`, иначе строка очищается (`accepted_as: ""`);
- `rejectedReason` — при `reject`, иначе очищается;
- **взаимоисключение:** отчёт не может быть одновременно принят и отклонён — при `accept` чистим `rejected_reason`, при `reject` чистим `accepted_as`;
- если поля `rejected_reason` в файле нет (старый отчёт) — **дописать** его в конец фронтматтера, а не падать. Это единственное исключение из правила «только построчная правка»: без него reject на старых отчётах невозможен. CI-whitelist расширяется тем же коммитом (п. 6), поэтому дописывание не нарушит валидацию.

### 3. `ackReport` — расширить

```ts
export function ackReport(
  cwd: string,
  id: string,
  decision: { action: 'accept'; taskId: string } | { action: 'reject'; reason: string },
): { path: string; report: UpstreamReport }
```

- `accept`: `taskId` обязателен, формат `<PREFIX>-<число>` (переиспользовать `normalizeAcceptedAs` из VL-388, если она уже есть; иначе завести);
- `reject`: `reason` обязателен, непустой после `trim()`;
- поиск по `report_id` — через `findReportById` (после VL-388 принимает префикс);
- commit message: `ack(<prefix>): <id> → <taskId>` либо `reject(<prefix>): <id> — <краткая причина>`.

### 4. MCP-инструменты — `src/mcp/tools.ts`

**`upstream_list_reports`** (read):

```ts
{
  name: 'upstream_list_reports',
  description:
    'Входящие отчёты об ошибках от других проектов Vibelog (git-инбокс). ' +
    'Без report_id — список открытых отчётов для своего префикса; с report_id — ' +
    'полное тело одного отчёта. Виден только при настроенном upstream.',
  inputSchema: {
    type: 'object',
    properties: {
      report_id: { type: 'string', description: 'ID отчёта (полный или первые 8 символов) — вернуть тело' },
      include_resolved: { type: 'boolean', description: 'Показать и accepted/rejected (по умолчанию только open)' },
    },
  },
}
```

Обработчик `toolUpstreamListReports(args, cwd)`:
- `resolveUpstreamConfig(cwd)` → при `mode: 'api'` вернуть `ackError` «список входящих доступен только в mode: git» (API-режим — отправка в чужой трекер, входящих там нет);
- `ensureInboxClone` (обновить клон) → `listIncoming(cwd, cfg.prefix)`;
- с `report_id` — найти и вернуть `serializeReport`-тело;
- ответ — `ackRead` с массивом (id, source_project, source_task, title, severity, area, created, status).

**`upstream_ack_report`** (write):

```ts
{
  name: 'upstream_ack_report',
  description:
    'Принять или отклонить входящий отчёт. accept требует task_id (задача в ЭТОМ проекте, ' +
    'проверяется на существование) и связывает отчёт с задачей: пишет accepted_as и добавляет ' +
    'комментарий в задачу. reject требует reason — причина попадает в отчёт, чтобы отправитель ' +
    'понял отказ. Виден только при настроенном upstream.',
  inputSchema: {
    type: 'object',
    properties: {
      report_id: { type: 'string', description: 'ID отчёта (полный или первые 8 символов)' },
      action: { type: 'string', enum: ['accept', 'reject'], description: 'accept — принять, reject — отклонить' },
      task_id: { type: 'string', description: 'ID задачи-получателя (обязателен для accept), например VL-391' },
      reason: { type: 'string', description: 'Причина отказа (обязательна для reject)' },
    },
    required: ['report_id', 'action'],
  },
}
```

Обработчик `toolUpstreamAckReport(args, cwd)`:
1. `resolveUpstreamConfig` → `mode: 'api'` → `ackError` (входящих в API-режиме нет);
2. `action === 'accept'`:
   - `task_id` обязателен → **`getTask(cwd, task_id)`** — несуществующая задача → `ackError` с подсказкой «создай задачу через backlog_create_task и передай её ID»; **запись не выполняется** (закрывает класс VL-388 для MCP);
   - `ackReport(cwd, id, {action:'accept', taskId})`;
   - `addComment(cwd, task_id, ...)` — комментарий со ссылкой: `Принят отчёт <report_id> из проекта <source_project> (задача <source_task>). Файл: <path>`;
3. `action === 'reject'`: `reason` обязателен → `ackReport(cwd, id, {action:'reject', reason})`;
4. ответ — `ackOk`/`ackError` по контракту VL-357.

**Порядок в `handleToolCall`:** оба — до `default`. `upstream_ack_report` — write, но идемпотентность by-key не применяется (как у `upstream_report_bug`): повторный accept того же отчёта даст `noop` от `replaceAckFields` (значения уже такие) — это корректно.

### 5. Видимость и роли

**`src/mcp/server.ts`** — расширить фильтр:

```ts
const UPSTREAM_TOOLS = ['upstream_report_bug', 'upstream_list_reports', 'upstream_ack_report'];
tools: listTools().filter(t => !UPSTREAM_TOOLS.includes(t.name) || isUpstreamConfigured(cwd))
```

**`src/web/tool-policy.ts`** — тот же список в `chatToolDefs` (сейчас там одиночная проверка на `upstream_report_bug`).

**`src/mcp/tools.ts`** — прямой `tools/call` скрытого инструмента: сейчас проверка есть только у `upstream_report_bug` (строка ~3381). Вынести в общий хелпер `assertUpstreamConfigured(cwd)` и применить ко всем трём.

**Роли.** Проверить `templates/prompts/assistant.md` и `architect.md` + `chat_personas` в `.vibelog/settings.json`:
- если у роли задан `allow_tools` — добавить три имени;
- если не задан — доступ есть автоматически, править нечего;
- в промпт роли добавить абзац: «Входящие отчёты от других проектов — `upstream_list_reports`; принятие/отклонение — `upstream_ack_report` (accept требует существующую задачу, reject — причину). Отчёт не превращается в задачу автоматически: сначала обсуди с пользователем, потом создай задачу и свяжи».

**`src/core/tool-kinds.ts`** — `upstream_list_reports: 'read'`, `upstream_ack_report: 'write'`. Тест паритета `tool-classify` сверяет таблицу с `listTools()` — пройдёт после добавления.

### 6. CI-валидация в инбоксе (второй репозиторий)

`.vibelog/upstream-inbox/.gitverse/scripts/validate-paths.sh`, блок ack (после VL-387 он идёт первым):

```bash
grep -vE '^[+-][[:space:]]*(status|accepted_as|rejected_reason):'
```

Два места (ветки `COMPARED_FROM` и `git show`). Плюс шапка-комментарий: перечислить три разрешённых поля и объяснить, почему `rejected_reason` в whitelist (причина отказа — часть протокола, без неё отправитель не поймёт решение).

Отдельный коммит в инбокс, CI на нём зелёный.

### 7. Тесты

`src/core/upstream-git.test.mjs` (+6):
- accept: `status: accepted`, `accepted_as: X`, `rejected_reason: ""`;
- reject: `status: rejected`, `rejected_reason: "…"`, `accepted_as: ""`;
- accept после reject — `rejected_reason` очищается;
- reject на старом отчёте без поля `rejected_reason` — поле дописывается, файл валиден;
- `listIncoming` по умолчанию не показывает `rejected`;
- `include_resolved` показывает.

`src/mcp/upstream-tool.test.mjs` (+6):
- видимость трёх инструментов при трёх состояниях конфига (нет секции / валидная / невалидная);
- `ack_report` accept с несуществующим `task_id` → `rejected`, файл не изменён;
- `ack_report` accept с существующей задачей → отчёт обновлён + комментарий в задаче;
- `ack_report` reject без `reason` → `rejected`;
- `list_reports` с `report_id` отдаёт тело;
- `mode: api` → оба инструмента возвращают понятную ошибку.

`src/core/tool-classify.test.mjs` — паритет (существующий тест, должен пройти без правок).

### 8. Документация

doc-28: раздел «Приём отчётов» — два инструмента, четыре статуса, `rejected_reason`, сценарий «обсудили → создали задачу → связали», почему автосоздания нет. CHANGELOG — запись.

### Проверка

```bash
pnpm build && pnpm test
```

Живая (в проекте `templates`, где уже лежит отчёт `VL-390`):
1. `upstream_list_reports` → виден отчёт;
2. создать задачу `TPL-N`;
3. `upstream_ack_report {report_id, action: accept, task_id: TPL-N}` → отчёт `accepted`, в задаче комментарий;
4. CI инбокса зелёный.

### Риски

- **Дописывание `rejected_reason` в старые отчёты** — единственное отклонение от «только построчная правка». Без синхронного расширения CI-whitelist (п. 6) это сломает валидацию: правки в двух репозиториях должны попасть вместе.
- **`getTask` в MCP-пути** — проверка существования задачи работает только потому, что задача в проекте-получателе. Для CLI (`--as`) это по-прежнему невозможно: там остаётся валидация формата (VL-388).
- **`mode: api`** — входящих отчётов в API-режиме нет (это отправка в чужой трекер). Оба новых инструмента должны явно об этом сказать, а не падать с невнятной ошибкой.
- **Идемпотентность accept** — повторный accept того же отчёта с тем же `task_id` даст `noop` (значения уже такие). С другим `task_id` — перезапишет связь; это осознанно (перепривязка к другой задаче легитимна).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-09 20:04
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/upstream-git.ts
- src/mcp/tools.ts
- src/mcp/server.ts
- src/web/tool-policy.ts
- src/core/tool-kinds.ts
- templates/prompts/personas/helper.md
- templates/prompts/personas/architect.md
- .vibelog/tmp/patch-vl391-tests.mjs
- .vibelog/tmp/vl391-append-tests.mjs.txt
- .vibelog/tmp/patch-vl391-yamlend.mjs
- I'll start by orienting in the project and reading the relevant files.
Now I'll implement the core changes.
Now the ackReport and replaceAckFields rewrite.
Now the MCP tools. Let me add the two tool definitions and handlers.
Now handlers in tools.ts:
Now add the helper + handlers after toolUpstreamR…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 723 с, payload 482440 байт_
Незакоммиченные изменения сохранены в ветку: коммит `07a0ac1`.
---
author: @agent
created: 2026-11-09 20:04
---
Фаза code не удалась (код выхода 1): окировок=2, payload последнего запроса=482440 байт (макс 482440), usage={"input_tokens":6946027,"output_tokens":36069,"cache_read_input_tokens":6235648,"total_tokens":6982096,"reasoning_tokens":10935} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-09 20:17
---
Фаза 3 (Code) выполнена. Реализовано по плану.
**Ядро** `src/core/upstream-git.ts`:
- `REPORT_STATUSES` → `open | accepted | rejected | done`; `rejected_reason` добавлен в `REPORT_FIELDS` (последним — старые отчёты парсятся как `''`); `parseReport`/`writeReport` дополнены полем.
- `replaceAckFields(text, AckFields)` пишет три поля построчно, `status`/`accepted_as` обязаны существовать, отсутствующий `rejected_reason` дописывается перед закрывающим `---` (единственное исключение из «только построчная правка»). Взаимоисключение: accept чистит `rejected_reason`, reject — `accepted_as`.
- `ackReport(cwd, id, decision)` принимает `{action:'accept',taskId}` / `{action:'reject',reason}` (строковый аргумент сохранён как сокращение — CLI `upstream ack --as` не сломан). Коммит: `ack(<prefix>): <id> → <task>` / `reject(<prefix>): <id> — <причина>`.
- `listIncoming(cwd, prefix, {includeResolved})` — по умолчанию только `open`, с флагом добавляет `accepted`/`rejected`.
**MCP** `src/mcp/tools.ts`: `upstream_list_reports` (read, `report_id` → тело, `include_resolved`) и `upstream_ack_report` (write, accept/reject). `task_id` валидируется через `getTask` ДО записи, accept добавляет комментарий в задачу со ссылкой на отчёт и источник, reject пишет `rejected_reason` без комментария. Общий `assertUpstreamGit` даёт actionable-ошибку для `mode: api` и для ненастроенного upstream.
**Видимость**: константа `UPSTREAM_TOOLS` в `src/mcp/server.ts` применяется в `handleToolsList` и `chatToolDefs` (`src/web/tool-policy.ts`). `TOOL_KINDS`: list → read, ack → write.
**Роли**: промпты `helper.md`/`architect.md` получили раздел про приём отчётов и запрет автосоздания задачи; тест на реестре персон подтверждает, что без `allow_tools` доступ есть, а при заданном списке все три имени валидны.
Файлы: src/core/upstream-git.ts, src/core/upstream-git.test.mjs, src/mcp/tools.ts, src/mcp/server.ts, src/mcp/upstream-tool.test.mjs, src/web/tool-policy.ts, src/web/tool-policy.test.mjs, src/web/personas.test.mjs, src/core/tool-kinds.ts, src/core/compat-full.test.mjs, src/mcp/documents.test.mjs, src/mcp/reference-tools.test.mjs, src/mcp/server.test.mjs, src/mcp/write-ack-contract.test.mjs, src/core/fixtures/reports/vl/2026-11-08-VL-375-example.md, templates/prompts/personas/helper.md, templates/prompts/personas/architect.md.
Коммиты: 66f235b (паритет реестра/ролей), плюс wip-коммит 07a0ac1 от прерванного рана.
**Проверки**: `pnpm build` — успешно; `pnpm test` — полный прогон зелёный: 203 файла, 3952 passed, 4 skipped, исключений/--skip не было.
**Что осталось (вне границ фазы Code):**
- AC7 — CI-валидация в инбоксе (`Vibelog-md/upstream-reports`, `.gitverse/scripts/validate-paths.sh`): whitelist нужно расширить до `status|accepted_as|rejected_reason`. В этом worktree клона `.vibelog/upstream-inbox/` нет (секция `upstream` в `.vibelog/settings.json` имеет `mode: api`), правка второго репозитория отсюда невозможна — нужен отдельный коммит в инбокс из проекта с git-клоном. До этой правки reject на старых отчётах (дописывание поля) CI не пройдёт.
- AC13 (часть про документацию) — doc-28 и CHANGELOG пишет фаза Close по правилам AGENTS.md; сам тезис «build && test зелёный» выполнен.
Риск зафиксирован в плане и остаётся: дописывание `rejected_reason` и расширение CI-whitelist должны попасть вместе.
---
author: @agent
created: 2026-11-09 20:40
---
Фаза Close выполнена. Ветка vb/vl-391 слита в master (2 коммита: 66f235b, 07a0ac1), merge-коммит чистый (без конфликтов), worktree `.vibelog/worktrees/vl-391` удалена (с `--force`: единственный мусор — untracked-симлинк `backlog/references/data`, его кладёт оркестратор), ветка vb/vl-391 удалена.
**Проверки после merge:** `pnpm build` — успешно (одна сборка за фазу). Ранний точечный фильтр по diff'у: `src/core/upstream-git.test.mjs`, `src/mcp/upstream-tool.test.mjs`, `src/core/tool-classify.test.mjs`, `src/web/tool-policy.test.mjs`, `src/web/personas.test.mjs`, `src/mcp/server.test.mjs` — 153 passed. Полный прогон `pnpm test:fast` — 204 файла, все passed, исключений/--skip не было; параллельного vitest в других worktree не было (проверено `ps aux`).
**Документация:** doc-28 получил §9.10 «Приём отчётов через MCP» (два инструмента, четыре статуса, `rejected_reason`, сценарий «обсудили → создали задачу → связали», почему автосоздания нет, `mode: api`, идемпотентность); в §9.2 схема фронтматтера дополнена полем `rejected_reason`. CHANGELOG — запись в Unreleased/Добавлено. Коммит 97a2fe4.
**Урок:** lesson-271 (проверять наличие git-клона инбокса до планирования правки CI-whitelist — при `mode: api` клона нет). Связь с задачей установлена, коммит 7c7c7e3.
**DoD: честный итог.** Пункт 1 «Тесты проходят» — выполнен. Пункт 2 «Документация обновлена» — выполнен (doc-28 + CHANGELOG). Пункт 3 «Нет регрессий» — выполнен (полный прогон зелёный).
**Незакрытое AC:** AC7 (CI-валидация в инбоксе `Vibelog-md/upstream-reports`, `validate-paths.sh`: whitelist `status|accepted_as|rejected_reason`) — **не выполнено**: в worktree нет клона `.vibelog/upstream-inbox/` (секция `upstream` в `.vibelog/settings.json` имеет `mode: api`), правка второго репозитория из этого проекта невозможна. Требуется отдельная задача в проекте с git-клоном инбокса и отдельный коммит; до неё reject на старых отчётах (дописывание поля `rejected_reason`) не пройдёт CI инбокса. Остальные критерии (AC1–AC6, AC8–AC12, AC13 в части build&&test) выполнены в фазе Code.
---
<!-- COMMENTS:END -->