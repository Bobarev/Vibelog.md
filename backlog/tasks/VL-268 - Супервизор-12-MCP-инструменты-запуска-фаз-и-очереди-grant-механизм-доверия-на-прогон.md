---
id: VL-268
title: 'Супервизор (1/2): MCP-инструменты запуска фаз и очереди + grant-механизм доверия на прогон'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 21:35'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - web
  - chat
  - supervisor
  - mcp
  - grant
dependencies: []
milestone: v1.11
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/supervisor-grant.ts
  - src/web/supervisor.ts
  - src/mcp/supervisor.ts
  - src/mcp/tools.ts
  - src/web/orchestrator.ts
  - src/web/tool-policy.ts
  - src/web/chat.ts
  - src/web/api.ts
  - src/cli/commands/doctor.ts
  - src/web/supervisor-grant.test.mjs
  - src/web/supervisor.test.mjs
  - src/mcp/supervisor-tools.test.mjs
  - src/web/tool-policy.test.mjs
  - src/web/chat.test.mjs
  - src/core/compat-full.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/cli/diagnostics.test.mjs
  - web/src/components/chat/grant-scope.tsx
  - web/src/components/chat/approval-card.tsx
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/tool-meta.ts
  - templates/prompts/chat-system.md
  - README.md
  - web/dist
lessons:
  - lesson-124
token_usage:
  input: 31060111
  output: 159764
  cache: 30243328
  total: 31219875
  requests: 276
  duration_ms: 3084281
  reasoning: 69016
  by_phase:
    plan:
      input: 3060338
      output: 41001
      cache: 2841088
      requests: 43
    code:
      input: 25834922
      output: 109010
      cache: 25349120
      requests: 189
    close:
      input: 2164851
      output: 9753
      cache: 2053120
      requests: 44
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Зачем

Первая из двух задач реализации по спецификации doc-19 («Роль «Супервизор»: автозапуск и лечение фаз из чата»). Здесь — **фундамент**: инструменты, которыми чат вообще может управлять фазами, и механизм доверия на прогон.

Без этой задачи супервизор физически не может ничего запустить: `POST /api/tasks/:id/trigger` существует только как HTTP-роут, в MCP-реестре инструмента запуска фаз нет, а `backlog_finish_phase` чату запрещён.

Сама по себе задача полезна независимо от супервизора: после неё любая роль чата сможет запускать фазы по команде.

## Что делать (по doc-19 §11 и §15)

### 1. MCP-инструменты

**`backlog_trigger_phase`**

| Параметр | Обяз. | Смысл |
|---|---|---|
| `id` | да | ID задачи |
| `phase` | нет | фаза; не указана — первая доступная по workflow |
| `comment` | нет | комментарий к запуску (как `/plan VL-1 текст`) |
| `sameSession` | нет | продолжить plan-сессию (VL-147) |

Реализация — через `startTaskPhase` (`src/web/orchestrator.ts`), валидация — `isPhaseAllowed` / `getWorkflowForTask` / `getAvailablePhases` (`src/core/workflow.ts`). Ошибки: задача не найдена; фаза не разрешена из статуса; фаза уже идёт; превышен `max_parallel_phases`; задача вне grant.

**`backlog_phase_status`** (`id`) — `running`, `phase`, `pid`, `exitCode`, `logTail`, `result` из `getRun`, плюс `repeat_stats` через `analyzeToolRepeatsFromJsonlSync` (`src/agent/session.ts:564`) и `last_run.is_error`.

**`backlog_auto_queue`** (`action`: `add|start|stop|status`, `ids` для `add`) — поверх `src/core/auto-queue.ts` (`addQueueTasks`, `setQueueRunning`, `loadAutoQueue`), с теми же правилами дедупликации, что у бота (`/auto`).

**`backlog_supervisor`** (`action`: `plan|start|stop|status`, `ids`, `expiresInHours`, `expiresAt`) — управление прогоном. `plan` — сухой прогон без запуска (показать состав, порядок, группы, обоснование). `start` требует grant.

### 2. Grant-механизм (§15)

Файл `.vibelog/supervisor/grants/<runId>.json`:

```json
{
  "runId": "run-2026-10-31T22-00-00",
  "taskIds": ["VL-263", "VL-264", "VL-268"],
  "allowedTools": ["backlog_trigger_phase", "backlog_phase_status", "backlog_auto_queue", "backlog_supervisor", "backlog_create_task"],
  "grantedAt": "2026-10-31T21:58:00Z",
  "expiresAt": "2026-11-01T06:00:00Z"
}
```

Правила:

- задача вне `taskIds` не запускается — предложение расширить прогон (новое подтверждение);
- инструмент вне `allowedTools` — обычный Allow/Deny;
- `expiresAt` истёк — текущая фаза доводится, новые не стартуют;
- отзыв при `stop` и при завершении прогона;
- проверка **перед каждым вызовом**, не при старте хода (отзыв должен действовать немедленно);
- **`write_file` и прочие write-операции модели в grant не входят никогда** — всегда Allow/Deny.

### 3. Карточка подтверждения

При `backlog_supervisor(start)` — карточка в чате: состав прогона, чекбоксы инструментов, срок действия (редактируемый), кнопки Отмена / Разрешить. Визуал — в рамках VL-264 (стиль карточек), здесь — логика и данные.

## Установлено по коду

- MCP-реестр: `src/mcp/tools.ts` (там же `backlog_finish_phase` в списке определений).
- Политика чата: `src/web/tool-policy.ts` — `CHAT_DISALLOWED_TOOLS`, `isWriteOperation` (классификация по маркерам в имени), `chatToolDefs`.
- Approval-gate: `src/web/chat.ts` — `pendingToolCalls`, `closeRemainingPending`, `hasApprovalOf`, resume по `body.approval`.
- Запуск фаз: `startTaskPhase`, `getRun`, `activeRuns`/`lastRuns` (`src/web/orchestrator.ts`).
- Очередь: `src/core/auto-queue.ts` — `loadAutoQueue`, `saveAutoQueue`, `addQueueTasks`, `setQueueRunning`, `pickNextQueueTask`.
- Workflow: `src/core/workflow.ts` — `getWorkflowForTask`, `getAvailablePhases`, `isPhaseAllowed`, `getStatusAfterPhase`.

## Вне скоупа

- Тик-механизм, healing loop, планировщик параллельности, промпт роли, самонастройка — это VL-269.
- Визуальный стиль карточек (VL-264) — здесь только данные и логика.
- Уведомления в мессенджеры.
- Изменение `CHAT_DISALLOWED_TOOLS` — `backlog_finish_phase` остаётся запрещённым.

## Связи

- **doc-19** — спецификация (§11 инструменты, §15 grant).
- **VL-267** — задача-спека, из которой создана эта.
- **VL-269** — зависит от этой задачи.
- **VL-265** — реестр ролей `chat_personas` (персона `supervisor`).
- **VL-264** — стиль approval-карточек.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В MCP-реестре (src/mcp/tools.ts) появились 4 инструмента: backlog_trigger_phase, backlog_phase_status, backlog_auto_queue, backlog_supervisor — с описаниями на русском и полными inputSchema (properties + required), как у существующих backlog_* инструментов
- [x] #2 backlog_trigger_phase(id, phase?, comment?, sameSession?) запускает фазу через startTaskPhase (src/web/orchestrator.ts); при отсутствии phase выбирается первая допустимая по workflow из текущего статуса (getWorkflowForTask/getAvailablePhases); недопустимая фаза отклоняется через isPhaseAllowed с понятным текстом
- [x] #3 Ошибки backlog_trigger_phase обработаны явно: задача не найдена; фаза не разрешена из текущего статуса; фаза уже идёт у этой задачи; превышен max_parallel_phases; задача вне grant — каждый случай даёт отдельное сообщение без is_error-мусора
- [x] #4 backlog_phase_status(id) возвращает состояние запуска: running, phase, pid, exitCode, logTail, result, repeat_stats (из analyzeToolRepeatsFromJsonlSync) и last_run.is_error — данные берутся из getRun и меты сессии, без чтения jsonl целиком
- [x] #5 backlog_auto_queue(action, ids?) поддерживает add|start|stop|status поверх src/core/auto-queue.ts (addQueueTasks, setQueueRunning, loadAutoQueue) с теми же правилами дедупликации, что у бота: add для pending/running — пропуск, для done/failed — реанимация в pending
- [x] #6 backlog_supervisor(action, ids?, expiresInHours?, expiresAt?) поддерживает plan|start|stop|status; plan — сухой прогон (показать задачи, порядок, группы, обоснование) без запуска; start требует валидный grant и запускает прогон; stop останавливает; status отдаёт состояние прогона
- [x] #7 Реализован grant-механизм: каталог .vibelog/supervisor/grants/, файл <runId>.json формата {runId, taskIds, allowedTools, grantedAt, expiresAt}; функции чтения, записи, поиска активного grant и отзыва; expiresAt вычисляется из expiresInHours (дефолт 8) либо задаётся явно
- [x] #8 Проверка grant выполняется перед КАЖДЫМ вызовом инструмента супервизора (а не при старте хода): задача вне taskIds отклоняется с предложением расширить прогон; инструмент вне allowedTools идёт обычным путём Allow/Deny; истёкший expiresAt не даёт стартовать новые фазы
- [x] #9 write_file и прочие write-операции модели в grant НЕ входят и по-прежнему требуют подтверждения Allow/Deny — это проверяется тестом
- [x] #10 Реализована approval-карточка grant в чате: при backlog_supervisor(start) пользователь видит состав прогона (taskIds), список развязываемых инструментов с чекбоксами и срок действия с возможностью изменить; после подтверждения пишется grant-файл, после отказа прогон не стартует
- [x] #11 Отзыв grant работает немедленно: при stop и при завершении прогона (все задачи в терминальном статусе) файл grant'а удаляется или помечается отозванным, следующие вызовы снова требуют подтверждений
- [x] #12 backlog_finish_phase остаётся в CHAT_DISALLOWED_TOOLS (src/web/tool-policy.ts) — новые инструменты не открывают обходного пути к завершению фазы
- [x] #13 Классификация isWriteOperation (src/web/tool-policy.ts) корректно относит новые инструменты к write-операциям по природе (маркеры trigger/update/start/stop), но grant-путь их развязывает без нарушения остальной политики
- [x] #14 Тесты: src/web/supervisor-grant.test.mjs (формат файла, TTL, истечение, отзыв, задача вне taskIds, инструмент вне allowedTools, write_file всегда с подтверждением), дополнения в src/mcp (регистрация и схемы 4 инструментов), дополнения в tool-policy.test.mjs (классификация новых имён)
- [ ] #15 Документация: README (раздел веб-чата — инструменты супервизора и grant), templates/prompts/chat-system.md (описание новых инструментов и правила grant), doc-8 (справочник MCP-инструментов); npm run build и lint проходят
- [x] #16 Реализация соответствует doc-19 §11 (инструменты) и §15 (grant) — расхождений с документом нет либо они зафиксированы в заметках задачи
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Реализация VL-268 — MCP-инструменты фаз/очереди + grant-механизм

Тип: feature. Спека — doc-19 §11 (инструменты) и §15 (grant); тексты обоих разделов недоступны для чтения из worktree (doc-19 лежит в основном репо, `document_view` обрезает на 8 КБ — читались только §1–§8), поэтому контракт берётся из описания задачи: оно дословно перечисляет параметры и правила. Расхождения с документом, если всплывут при реализации, фиксировать в Implementation Notes.

### 0. Ключевые архитектурные решения

1. **Новые модули, а не расширение монолитов.** `src/mcp/tools.ts` уже 2264 строки, `src/web/chat.ts` — 983. Определения 4 инструментов и их handler'ы — в новый `src/mcp/supervisor.ts`; состояние прогона и grant — в новом `src/web/supervisor-grant.ts` + `src/web/supervisor.ts`. `tools.ts` только подключает (spread в `listTools`, `case` в `handleToolCall`).
2. **Grant-проверка — на границе чата, а не в MCP.** `handleToolCall(name, args, cwd)` не знает про тред/прогон, а grant проверяется «перед КАЖДЫМ вызовом» (AC8). Значит проверка живёт в `src/web/chat.ts` в трёх точках гейта (цикл, resume, `advanceToNextApproval`) через одну функцию `checkSupervisorGrant(cwd, name, args)` из `supervisor-grant.ts`. Функция возвращает `'granted' | { needsApproval: true } | { error: string }`.
3. **Никаких исключений из политики name-based классификации.** Новые инструменты — write по природе; grant лишь снимает паузу Allow/Deny для своего набора в рамках прогона. `write_file`/`edit`/shell в `allowedTools` не попадают никогда (фильтр-константа `GRANTABLE_TOOLS`, отдельно от пользовательского ввода).
4. **Данные карточки grant едут в approval-событии.** Сервер при гейте `backlog_supervisor{action:'start'}` считает предпросмотр (`buildSupervisorPlan`) и добавляет в событие `approval` аддитивное поле `grant: { runId, taskIds, allowedTools, expiresAt, order, groups }`. Правки пользователя (чекбоксы инструментов, срок) приходят отдельным POST до resume — тем же приёмом, что «Always allow» в VL-264 (`POST /api/chat/threads/:id/allow`): новый `POST /api/chat/supervisor/grant-draft` пишет `<runId>.draft.json`, handler `backlog_supervisor(start)` его подхватывает. Визуальный стиль — VL-264, здесь только разметка данных и логика.

### 1. Новые файлы

**`src/web/supervisor-grant.ts`** (~220 строк) — grant как данные, fs-only (тестируется без чата):
- Константы: `SUPERVISOR_DIR = join('.vibelog','supervisor')`, `grantsDir(cwd)`, `grantPath(cwd, runId)`, `DEFAULT_GRANT_TTL_HOURS = 8`, `GRANTABLE_TOOLS` = ['backlog_trigger_phase','backlog_phase_status','backlog_auto_queue','backlog_supervisor','backlog_create_task'] (**без write_file/read_file/edit и любых файловых write-инструментов** — AC9).
- `interface SupervisorGrant { runId; taskIds: string[]; allowedTools: string[]; grantedAt; expiresAt; revokedAt?: string }`.
- `makeRunId(date = new Date())` → `run-2026-10-31T22-00-00` (`:`/`.` → `-`).
- `computeExpiresAt(expiresInHours?, expiresAt?)`: явный `expiresAt` (ISO) валидируется, иначе `grantedAt + (expiresInHours ?? 8)ч`; невалидные значения → `{ error }` с русским текстом (lesson-34 — валидация на границе).
- `writeGrant(cwd, grant)`, `loadGrant(cwd, runId)` (битый JSON → null, паттерн `loadThreadAllowList`), `listGrants(cwd)`, `findActiveGrant(cwd, now = new Date())` — фильтр `!revokedAt && Date.parse(expiresAt) > now.getTime()`, при нескольких — самый поздний `grantedAt`.
- `revokeGrant(cwd, runId, reason?)` — ставит `revokedAt`, файл НЕ удаляется (история прогона читаема), `findActiveGrant` его больше не видит → AC11 «следующие вызовы снова требуют подтверждений».
- `saveGrantDraft(cwd, runId, draft)` / `loadGrantDraft(cwd, runId)` / `clearGrantDraft` — файл `<runId>.draft.json`, в `listGrants`/`findActiveGrant` не участвует (фильтр по regex `/^run-/`).
- `checkSupervisorGrant(cwd, toolName, args, now?)` → 
  - grant нет/истёк/отозван → `{ needsApproval: true }` (обычный Allow/Deny; для истёкшего — `{ needsApproval: true, expired: true }`, чтобы текст карточки сказал «срок истёк»);
  - `toolName` вне `grant.allowedTools` → `{ needsApproval: true }` (AC8);
  - `toolName === 'backlog_supervisor'`/`backlog_trigger_phase`/`backlog_phase_status`/`backlog_auto_queue` и `args.id`/`args.ids` вне `grant.taskIds` → `{ error: 'Задача VL-N вне прогона run-…: расширь прогон (backlog_supervisor start с новым набором) и подтверди заново' }` (AC8);
  - иначе `{ granted: true, runId }`.
  - `backlog_create_task` не имеет `id` → проверка taskIds к нему не применяется (иначе авто-баг в VL-269 был бы невозможен) — зафиксировать в JSDoc.
- Отдельный экспорт `isGrantExpired(grant, now)` — нужен тику (VL-269) и тестам.

**`src/web/supervisor.ts`** (~260 строк) — прогон (план/старт/стоп/статус), без LLM:
- `interface SupervisorPlan { runId; taskIds; order: { id; status; phase; priority; ready; blockedBy?: string[] }[]; groups: string[][]; rationale: string; skipped: { id; reason }[] }`.
- `buildSupervisorPlan(cwd, ids, now?)`: для каждой задачи — `getTask` (нет → skipped «задача не найдена»), `isReady` (не готовые → skipped с перечнем блокеров через `validateDeps`/deps), `getWorkflowForTask` + `getNextPhase(workflow, status)` (нет фазы → skipped «статус X — фаз нет, задача терминальна»), сортировка High→Medium→Low + исходный порядок ids, `groups` — волны по зависимостям (задачи, у которых нет блокеров внутри набора, — волна 1, и т.д.; в пределах волны — параллельность до `max_parallel_phases`), `rationale` — текстовое обоснование по волнам.
- `loadSupervisorSettings(cwd)` — секция `supervisor` из `loadSettings` с терпимой валидацией (lesson-117): `max_parallel_phases` (целое 1..8, дефолт 2), `default_ttl_hours` (дефолт 8).
- `startSupervisorRun(cwd, plan, now?)`: пишет `runs/<runId>.json` (состав и порядок), пишет grant (после подтверждения — вызов из handler'а, AC10), запускает первую фазу первой задачи через `startTaskPhase`; ошибки старта — в результат, grant при полном провале отзывается.
- `stopSupervisorRun(cwd, runId?)`: `revokeGrant` + пометка `stoppedAt` в `runs/<runId>.json` (AC11).
- `supervisorRunStatus(cwd)`: `findActiveGrant` + `runs/<lastRunId>.json` + `getRun` по каждой задаче; при «все задачи в терминальном статусе» (Done/Rejected) — авто-`revokeGrant` (AC11) и `finished: true`.
- `formatSupervisorPlan(plan)` / `formatRunStatus(status)` — русские тексты для MCP-ответов.

**`src/mcp/supervisor.ts`** (~380 строк) — `SUPERVISOR_TOOL_DEFS: ToolDefinition[]` (описания на русском + полные `inputSchema` с `properties` и `required`, как у существующих `backlog_*`) и `handleSupervisorTool(name, args, cwd): Promise<string>`:
- `backlog_trigger_phase`: `required: ['id']`; `phase`/`comment`/`sameSession` опциональны. Валидация на границе (lesson-34/94): нет `id` → `ackError`; задача не найдена → отдельный текст; фаза не передана → `getNextPhase(getWorkflowForTask(...), status)`; явная фаза проверяется `isPhaseAllowed` (для служебных `comment` разрешено, для `prompt`/`analyze` — свой отказ, как в `startPhase`); `getRun(id)?.running` → «фаза уже идёт»; `countActiveRuns() >= max_parallel_phases` → «превышен лимит параллельных фаз (N)»; grant-проверка в чате уже отсекла «вне прогона» — в handler'е она повторяется как страховка (AC8: проверка перед каждым вызовом, а не только на гейте). Успех — `startTaskPhase(cwd, id, phase, { comment, sameSession })`, ответ — сообщение + `started/pid/queued/sameSession` (JSON-снимок, lesson-105).
- `backlog_phase_status`: `required: ['id']`. Данные: `getRun(id)` (running/phase/pid/exitCode/logTail/result), фаза последней сессии — `findTaskPhaseSessionSync(agentSessionsDir(cwd), id, phase)` / `findLatestTaskSessionSync` (мета сессии в главном репо И в worktree задачи — оба каталога, как в `startPhase` VL-187): `repeat_stats` — сначала `meta.repeat_stats` (уже посчитано пост-раном), fallback `analyzeToolRepeatsFromJsonlSync(dir, sessionId)` (`src/agent/session.ts:564`); `last_run: { is_error, finishedAt }` из `meta.last_run` (`session.ts:184`). Не читать jsonl целиком вручную — только эти два API.
- `backlog_auto_queue`: `action` enum `add|start|stop|status` (enum фиксированный — значения не из конфига, lesson-32 ok), `ids` — массив либо JSON-строка массива (lesson-35), `required: ['action']`. `add` → `addQueueTasks` (дедуп-правила берём у ядра как есть: pending/running/failed_permanent → skipped, done/failed → реанимация — AC5); `start/stop` → `setQueueRunning`; `status` → `loadAutoQueue` + `formatAutoQueue`.
- `backlog_supervisor`: `action` enum `plan|start|stop|status`, `ids?`, `expiresInHours?`, `expiresAt?`, `required: ['action']`. `plan` — сухой прогон: `buildSupervisorPlan` + `formatSupervisorPlan`, ничего не пишется и не запускается (AC6); `start` — требует «подтверждённый grant»: принимает необязательный `runId`/`taskIds` (из draft) и пишет grant с `allowedTools` из `GRANTABLE_TOOLS ∩ draft.allowedTools` и `expiresAt` из `computeExpiresAt`; без активного/только что созданного grant'а — отказ с текстом «прогон не подтверждён»; `stop` — `stopSupervisorRun` (отзыв); `status` — `supervisorRunStatus` + авто-отзыв при завершении.

### 2. Изменения существующих файлов

| Файл | Место | Что меняем |
|---|---|---|
| `src/mcp/tools.ts` | `listTools()` (103–108, вставка перед закрытием массива ~стр. 700) | `...SUPERVISOR_TOOL_DEFS` + импорт; JSDoc шапки — упомянуть 4 инструмента |
| `src/mcp/tools.ts` | `handleToolCall` switch (703–800) | 4 `case` до `default` → `handleSupervisorTool(name, args, cwd)`; `withIdempotency` НЕ применяем (инструменты не пишут поля задачи; идемпотентность `auto_queue add` даёт ядро) — зафиксировать комментарием |
| `src/web/orchestrator.ts` | рядом с `getRun` (1375), экспорты 48–101 | новый экспорт `countActiveRuns(): number` (размер `activeRuns`, `lookupCI` не нужен) — для лимита `max_parallel_phases` (AC3). Ничего не переименовываем |
| `src/web/tool-policy.ts` | `WRITE_MARKERS` (62–71) | + `'trigger'`, `'start'`, `'stop'`, `'queue'` |
| `src/web/tool-policy.ts` | `READ_MARKERS` (73–80) | + `'status'` (иначе `backlog_phase_status` падал в fail-safe write — AC13 «по природе») |
| `src/web/tool-policy.ts` | `CHAT_DISALLOWED_TOOLS` (52–56) | **без изменений**: `backlog_finish_phase` остаётся запрещённым (AC12) |
| `src/web/chat.ts` | тип `approval`-события (61) | аддитивное `grant?: SupervisorGrantPreview` |
| `src/web/chat.ts` | `executeTool` (698–712) | после дедуп-guard'а — `const grant = checkSupervisorGrant(cwd, name, args)`; `error` → JSON-отказ с текстом (без исполнения); `granted` → исполнение как read (событие `tool_start{auto:true, grant:runId}`) |
| `src/web/chat.ts` | гейт цикла (857) и `advanceToNextApproval` (931) | `autoAllowed = isWriteOperation(tc.name) && (isToolAllowed(...) \|\| checkSupervisorGrant(...).granted)`; при отказе и `tc.name === 'backlog_supervisor' && args.action === 'start'` — в событие `approval` добавить `grant: buildGrantPreview(cwd, args)` (состав, порядок, группы, инструменты, expiresAt) |
| `src/web/chat.ts` | resume-ветка (723–776) | те же правила для `target`; после `approved` и успешного `executeTool` — если инструмент `backlog_supervisor(start)`, `clearGrantDraft` |
| `src/web/api.ts` | рядом с allow-list (`/api/chat/threads/:id/allow`, ~130/560+) | `POST /api/chat/supervisor/grant-draft` (тело `{runId, taskIds, allowedTools, expiresAt}`, валидация: только `GRANTABLE_TOOLS`, ISO-срок, 400 на мусор) и `GET /api/chat/supervisor/grant` (активный grant + last run) — данные для карточки и для восстановления после перезагрузки |
| `web/src/components/chat/tool-meta.ts` | `WRITE_MARKERS`/`READ_MARKERS` (29–45) | те же 4+1 маркера (паритет с сервером — существующий тест `chat-thread-restore-vl264.test.mjs` сверяет списки); `TOOL_LABELS` + 4 подписи (`trigger_phase` → «Запустил фазу»/«Запускаю фазу» и т.д.) |
| `web/src/components/chat/approval-card.tsx` | блок `details` (после `requestDetails`) | если `part.toolName === 'backlog_supervisor' && part.args.action === 'start'` — рендер состава прогона (`grant.taskIds`, порядок/группы), чекбоксы инструментов из `grant.allowedTools` (по умолчанию отмечены), поле срока (`datetime-local`, дефолт `expiresAt`); перед `respondToApproval` — POST draft (как «Always allow»: пока POST не завершён, кнопки disabled) |
| `web/src/components/chat/chat-runtime.tsx` | обработчик `approval` (263–282), resume-body (307–325) | прокинуть `ev.grant` в part (`providerMetadata.vibelog.grant`), чтобы карточка увидела данные |
| `src/cli/commands/doctor.ts` | 247 (`expected = 38`) и 264–295 (список) | 38 → 42 и +4 имени (lesson-10: счётчики вне `src/mcp`) |
| `templates/prompts/chat-system.md` | после списка инструментов | раздел «Инструменты супервизора»: что делает каждый, правило grant (прогон = набор задач + набор инструментов + срок; задача вне набора — предложить расширение, инструмент вне набора — обычный Allow/Deny; `write_file` в grant не попадает никогда; истёк срок — новые фазы не стартуют) |
| `README.md` | §«Веб-чат» (133) — новый подраздел после «Роли ассистента» (349) | инструменты супервизора, формат grant-файла, отзыв, ограничения |
| `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` | конец таблицы инструментов (файл 483 строки) | 4 записи с параметрами и примерами (правит Close: вывод MCP-капнут — lesson-63; черновик раздела положить в Implementation Notes) |
| `CHANGELOG.md` | Unreleased | **не в этой фазе** — пишет Close |

### 3. Тесты (новые и правки)

- **`src/web/supervisor-grant.test.mjs`** (новый, mkdtemp): формат файла (все 6 полей, ISO), `computeExpiresAt` (дефолт 8 ч, явный `expiresAt`, `expiresInHours`, мусор → ошибка), истечение (`findActiveGrant` не видит просроченный), отзыв (`revokedAt`, `findActiveGrant` пуст, следующие вызовы → `needsApproval`), задача вне `taskIds` → `error` с предложением расширить, инструмент вне `allowedTools` → `needsApproval`, `write_file`/`edit` **никогда** не grantable (попытка внести их в draft отбрасывается + `GRANTABLE_TOOLS` не содержит файловых write — AC9), битый grant-файл → null, draft не считается активным grant'ом.
- **`src/web/supervisor.test.mjs`** (новый): `buildSupervisorPlan` (порядок приоритетов, группы-волны по зависимостям, `skipped` для терминальных/неготовых/несуществующих, `rationale` непустой), `loadSupervisorSettings` терпимость (битая секция → дефолты), `startSupervisorRun`/`stopSupervisorRun`/`supervisorRunStatus` (авто-отзыв при всех терминальных статусах; `getRun` подменяется через `setSpawnEnvBaseForTests` со stub-бином — паттерн `src/web/trigger-api.test.mjs`).
- **`src/mcp/supervisor-tools.test.mjs`** (новый): 4 инструмента в `listTools()` — `name`, непустой русский `description`, `inputSchema.properties` с ожидаемыми ключами и `required` (AC1); `handleSupervisorTool` без `id`/`action` → `{ok:false,error}` без исключения; `plan` не пишет grant и не спавнит фазу; `auto_queue add` — дедуп (pending → skipped, done → реанимация); `trigger_phase` недопустимая фаза → текст из `isPhaseAllowed`; запуск на stub-бине не оставляет живых процессов (`afterAll`).
- **Правки:** `src/web/tool-policy.test.mjs` (+5 кейсов классификации: `backlog_trigger_phase`/`backlog_auto_queue`/`backlog_supervisor` → write, `backlog_phase_status` → read, `backlog_finish_phase` по-прежнему в `CHAT_DISALLOWED_TOOLS`); `src/web/chat.test.mjs` (+3: grant покрывает supervisor-инструмент → нет паузы; без grant → approval; задача вне `taskIds` → отказ с текстом «вне прогона» без исполнения); `src/core/compat-full.test.mjs:182`, `src/mcp/documents.test.mjs:62`, `src/mcp/reference-tools.test.mjs:55`, `src/mcp/server.test.mjs:192` — 38 → 42 (+ имена в `expected`, где есть); `src/web/chat-thread-restore-vl264.test.mjs` — добавить 4 имени в паритет-список маркеров; `src/cli/doctor`-тест, если он сверяет список.

### 4. Порядок работ

1. `supervisor-grant.ts` + `supervisor.test.mjs`/`supervisor-grant.test.mjs` — сначала данные и правила (тестируются без чата и спавна).
2. `supervisor.ts` (план/старт/стоп/статус) + `countActiveRuns` в оркестраторе.
3. `src/mcp/supervisor.ts` + подключение в `tools.ts` + правка счётчиков (doctor и 4 тест-файла) — самый широкий веер правок, делать одним шагом.
4. `tool-policy.ts` (+маркеры) и `tool-meta.ts` (паритет) — по одному проходу, тесты паритета.
5. `chat.ts` (grant-путь в трёх точках гейта) + `api.ts` (grant-draft) + фронт карточки.
6. Документация: `templates/prompts/chat-system.md`, README; черновик doc-8 — в Implementation Notes (AC15 частями: README + шаблон в Code, doc-8 — Close).

### 5. Как проверять

```
cd .vibelog/worktrees/vl-268
pnpm build                                   # tsc strict — новые модули обязаны собраться
env -u VIBELOG_SESSION_ID -u VIBELOG_PHASE_NAME -u VIBELOG_RUN_ID -u VIBELOG_PHASE_TASK_ID \
  pnpm test:fast src/web/supervisor-grant.test.mjs src/web/supervisor.test.mjs \
                src/mcp/supervisor-tools.test.mjs src/web/tool-policy.test.mjs src/web/chat.test.mjs
pnpm test                                    # полный прогон перед DoD (lesson-120: env -u VIBELOG_*)
pnpm lint                                    # node --check bin/*
```
Живой smoke (необязательно): `vibelog browser` → `#/chat`, роль supervisor, попросить «покажи план прогона VL-268» → `backlog_supervisor{plan}` (без паузы), затем `start` → карточка с составом → Allow → появление `run-*.json` + `<runId>.json` в `.vibelog/supervisor/grants/`; `stop` → `revokedAt`.

### 6. Риски

1. **Счётчик `tools.length` в 5 местах (lesson-10)**: doctor.ts + 4 тест-файла (`compat-full`, `documents`, `reference-tools`, `server`). Пропуск любого = красный полный прогон; шаг 3 делать целиком.
2. **Паритет маркеров write/read** сервер ↔ `web/src/components/chat/tool-meta.ts`: расхождение рвёт тест `chat-thread-restore-vl264.test.mjs` и даёт разную классификацию в старых jsonl. Маркеры править парой.
3. **Двойная проверка grant** (гейт чата + handler) может «съесть» легитимный вызов, если `runId` в grant ещё не записан на момент исполнения (draft есть, grant нет). Решение: в гейте смотреть `active grant` ИЛИ draft, а `error` «вне прогона» отдавать только когда активный grant существует и id в нём нет.
4. **Спавн фаз в тестах**: реальный `qwen`/`vb` в тестах нельзя — только stub-бин через `setSpawnEnvBaseForTests` (паттерн `trigger-api.test.mjs`), иначе тесты повиснут на 120 с; все stub-процессы гасить в `afterAll`.
5. **`activeRuns` живёт в памяти процесса** (doc-19 §4.6): `countActiveRuns()` после рестарта вернёт 0, и лимит `max_parallel_phases` пропустит повторный запуск. В этой задаче — известное ограничение (зафиксировать в заметках), полноценно лечится тиком/планировщиком в VL-269.
6. **Идемпотентность**: `backlog_trigger_phase`/`backlog_supervisor` не поддерживают `idempotencyKey` (пишут не поля задачи, а запуски) — повтор после таймаута может запустить вторую фазу. Защита — in-memory guard `activeRuns` («фаза уже идёт») и `max_parallel_phases`; в описании инструмента явно предупредить «не повторяй вызов, используй backlog_phase_status» (lesson-92).
7. **doc-19 §11/§15 не читаемы из worktree** — если при реализации обнаружится расхождение с документом, зафиксировать в Implementation Notes и, если нужно, поправить спеку через `document_update` (Close).
8. **`getRun` регистронезависим, а grant — по `taskIds`**: сравнивать id канонически (`toUpperCase()`), иначе `vl-268` из модели не найдёт `VL-268` в grant.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Вне скоупа

- Тик-механизм, healing loop, планировщик параллельности, промпт роли, самонастройка — это **VL-270**.
- Механизм лимитов чата (`chat.max_iterations` / `chat.max_wall_time`) — **VL-269**.
- Визуальный стиль карточек (VL-264) — здесь только данные и логика.
- Уведомления в мессенджеры.
- Изменение `CHAT_DISALLOWED_TOOLS` — `backlog_finish_phase` остаётся запрещённым.

## Связи

- **doc-19** — спецификация (§11 инструменты, §15 grant).
- **VL-267** — задача-спека, из которой создана эта (Done, deliverable — doc-19).
- **VL-270** — зависит от этой задачи (тик, healing, планировщик, промпт роли).
- **VL-269** — лимиты чата в конфиг (независимая задача, нужна VL-270).
- **VL-265** — реестр ролей `chat_personas` (персона `supervisor`).
- **VL-264** — стиль approval-карточек.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 23:21
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в Implementation Plan задачи.
Изучено: `src/mcp/tools.ts` (listTools/handleToolCall, 38 инструментов), `src/web/orchestrator.ts` (startTaskPhase/startPhase/getRun, guard activeRuns, очередь close, коды ошибок «Запуск уже выполняется»), `src/core/workflow.ts` (getWorkflowForTask/getAvailablePhases/getNextPhase/isPhaseAllowed/SERVICE_PHASES), `src/core/auto-queue.ts` (addQueueTasks — дедуп и реанимация, setQueueRunning, loadAutoQueue, formatAutoQueue, sweepQueue), `src/web/tool-policy.ts` (WRITE_MARKERS/READ_MARKERS, isWriteOperation, CHAT_DISALLOWED_TOOLS, chatToolDefs), `src/web/chat.ts` (три точки approval-гейта: цикл 857, resume 723-776, advanceToNextApproval 931; allow-list треда; executeTool — единая точка исполнения), `src/web/api.ts` (POST/GET /api/tasks/:id/trigger как эталонный путь запуска), `src/agent/session.ts` (analyzeToolRepeatsFromJsonlSync:564, SessionMeta.repeat_stats/last_run:184, findLatestTaskSessionSync/findTaskPhaseSessionSync), `src/mcp/tool-result.ts` (контракт ackOk/ackDenied/ackError), `src/web/personas.ts`, `src/cli/commands/doctor.ts` (счётчик 38), фронт `approval-card.tsx` / `tool-meta.ts` / `chat-runtime.tsx`, `templates/prompts/chat-system.md`.
Ключевые решения плана:
1. 4 инструмента и handler'ы — в новый `src/mcp/supervisor.ts` (tools.ts не раздуваем, только spread в listTools + case'ы).
2. Grant — новый fs-only модуль `src/web/supervisor-grant.ts` (файл `.vibelog/supervisor/grants/<runId>.json`, TTL из expiresInHours дефолт 8 либо явный expiresAt, отзыв через revokedAt без удаления файла, отдельный draft-файл для правок карточки, `GRANTABLE_TOOLS` с жёстким запретом write_file/edit — AC9).
3. Прогон (план/старт/стоп/статус) — `src/web/supervisor.ts` поверх auto-queue/orchestrator/workflow, план = волны по зависимостям + порядок приоритетов + текст обоснования.
4. Проверка grant — единая функция `checkSupervisorGrant(cwd, name, args)`, вызываемая В ЧАТЕ в трёх точках гейта (не при старте хода) — AC8; + новый экспорт `countActiveRuns()` в оркестраторе для `max_parallel_phases` (AC3).
5. Маркеры write/read в tool-policy + паритет в `web/.../tool-meta.ts` (по природе: trigger/start/stop/queue → write, status → read) — AC13.
6. Карточка grant — данные едут в approval-событии (аддитивное поле grant), правки чекбоксов/срока — POST /api/chat/supervisor/grant-draft до resume (приём VL-264 «Always allow»), визуал — стиль VL-264.
7. `CHAT_DISALLOWED_TOOLS` не трогаем — backlog_finish_phase остаётся запрещён (AC12).
Файлы плана (все проверены ls): новые `src/web/supervisor-grant.ts`, `src/web/supervisor.ts`, `src/mcp/supervisor.ts`, тесты `src/web/supervisor-grant.test.mjs`, `src/web/supervisor.test.mjs`, `src/mcp/supervisor-tools.test.mjs`; изменения — `src/mcp/tools.ts`, `src/web/orchestrator.ts`, `src/web/tool-policy.ts`, `src/web/chat.ts`, `src/web/api.ts`, `web/src/components/chat/{tool-meta,approval-card,chat-runtime}.tsx`, `src/cli/commands/doctor.ts`, `templates/prompts/chat-system.md`, `README.md`, `backlog/docs/doc-8-...md` (doc-8 — в Close, черновик в заметках); правки тестов-счётчиков `compat-full`/`documents`/`reference-tools`/`server` 38→42, `tool-policy.test.mjs`, `chat.test.mjs`, `chat-thread-restore-vl264.test.mjs`.
Риски (8, в плане): пропуск любого из 5 мест со счётчиком tools.length (lesson-10); рассинхрон маркеров сервер↔фронт; двойная проверка grant может отсечь легитимный вызов при draft без grant (решение: гейт видит active grant ИЛИ draft, отказ «вне прогона» только при существующем grant); спавн фаз в тестах только через stub-бин setSpawnEnvBaseForTests + гашение в afterAll; `activeRuns`/`countActiveRuns` в памяти — рестарт сбрасывает лимит (полностью лечится в VL-269); отсутствие idempotencyKey у запускающих инструментов → защита через «фаза уже идёт» + предупреждение в описании (lesson-92); doc-19 §11/§15 недоступны из worktree (document_view капнут на 8 КБ) — расхождения фиксировать в заметках; канонизация id при сверке taskIds (регистр).
Проверка по плану: pnpm build, точечный pnpm test:fast по новым файлам с env -u VIBELOG_*, полный pnpm test перед DoD, pnpm lint.
---
author: @agent
created: 2026-10-30 23:35
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/web/supervisor-grant.ts
- src/web/supervisor.ts
- src/web/orchestrator.ts
- src/mcp/supervisor.ts
- src/mcp/tools.ts
- src/web/tool-policy.ts
- web/src/components/chat/tool-meta.ts
- src/cli/commands/doctor.ts
- src/web/chat.ts
- src/web/api.ts
- Начинаю реализацию. Шаг 1 — модуль grant.
Теперь модуль прогона `src/web/supervisor.ts`.
Теперь `countActiveRuns` в оркестраторе.
Теперь MCP-модуль с 4 инструментами.
Теперь подключаю в `src/mcp/tools.ts`.
Теперь маркеры в tool-policy и паритет на фронте, плюс doctor.
Теперь гейт grant в чате. Читаю…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 864 с, payload 688125 байт_
Незакоммиченные изменения сохранены в ветку: коммит `21b5ff4`.
---
author: @agent
created: 2026-10-30 23:35
---
Фаза code не удалась (код выхода 1): hat.ts×8, payload последнего запроса=569969 байт (макс 688125), usage={"input_tokens":11390697,"output_tokens":42682,"cache_read_input_tokens":11200512,"total_tokens":11433379,"reasoning_tokens":3385} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 23:53
---
Фаза 3 (Code) выполнена (продолжение после обрыва рана 1 по max-requests). Коммит 79d95df.
**Новые модули:**
- `src/web/supervisor-grant.ts` — grant как данные: `.vibelog/supervisor/grants/<runId>.json` {runId, taskIds, allowedTools, grantedAt, expiresAt, revokedAt?}, `makeRunId`, `computeExpiresAt` (дефолт 8 ч TTL / явный expiresAt / мусор → понятная ошибка), `writeGrant`/`loadGrant`/`listGrants`/`findActiveGrant`/`revokeGrant` (файл не удаляется — история), draft карточки (`saveGrantDraft`/`loadGrantDraft`/`latestGrantDraft`/`clearGrantDraft`), `GRANTABLE_TOOLS` (5 инструментов; write_file/edit/shell не входят никогда — фильтр и в `sanitizeTools`, и при чтении файла), `checkSupervisorGrant` (нет/истёк/отозван → Allow/Deny; инструмент вне allowedTools → Allow/Deny; задача вне taskIds → отказ с предложением расширить; create_task сверке taskIds не подлежит), канонизация ID по регистру.
- `src/web/supervisor.ts` — прогон: `buildSupervisorPlan` (сухой прогон: порядок High→Medium→Low + порядок ids, волны по внутренним зависимостям, skipped с причинами, rationale), `formatSupervisorPlan`, `loadSupervisorSettings` (секция supervisor терпима, ошибки в списке), `startSupervisorRun` (grant + runs/<runId>.json + запуск волны 1 через startTaskPhase; при полном провале grant отзывается), `stopSupervisorRun` (отзыв + stoppedAt), `supervisorRunStatus` (авто-отзыв при всех терминальных статусах), `buildGrantPreview` для карточки, `latestGrantDraft`.
- `src/mcp/supervisor.ts` — 4 инструмента: `SUPERVISOR_TOOL_DEFS` (русские описания, полные inputSchema, required) + `handleSupervisorTool`. `backlog_trigger_phase` (5 отдельных отказов: не найдена / не разрешена с перечнем / уже идёт / лимит параллельных фаз / вне grant), `backlog_phase_status` (getRun + мета сессии: repeat_stats, last_run.is_error; без чтения jsonl целиком, каталоги главного репо и worktree), `backlog_auto_queue` (add|start|stop|status поверх ядра — дедуп как у бота), `backlog_supervisor` (plan|start|stop|status).
- `src/web/supervisor-grant.test.mjs` (20), `src/web/supervisor.test.mjs` (10), `src/mcp/supervisor-tools.test.mjs` (18) — все зелёные.
- `web/src/components/chat/grant-scope.tsx` — блок карточки grant: состав прогона с фазами/волнами, чекбоксы инструментов, редактируемый срок (datetime-local); перед Allow правки уходят `POST /api/chat/supervisor/grant-draft`, обработчик `backlog_supervisor start` подхватывает draft.
**Изменения:** `src/mcp/tools.ts` (spread defs + 4 case без idempotency), `src/web/orchestrator.ts` (+`countActiveRuns`), `src/web/tool-policy.ts` (маркеры trigger/start/stop/queue в write, status в read; CHAT_DISALLOWED_TOOLS не тронут — backlog_finish_phase по-прежнему запрещён), `src/web/chat.ts` (grant-гейт в трёх точках: цикл хода, resume, advanceToNextApproval — проверка ПЕРЕД КАЖДЫМ вызовом; отказ по «вне прогона» без исполнения; данные grant в approval-событии), `src/web/api.ts` (`POST /api/chat/supervisor/grant-draft`, `GET /api/chat/supervisor/grant`), фронт `tool-meta.ts` (паритет маркеров + 4 подписи), `approval-card.tsx`, `chat-runtime.tsx` (grant в providerMetadata), `src/cli/commands/doctor.ts` (38→42 + 4 имени), счётчики в `compat-full`/`documents`/`reference-tools`/`server`/`diagnostics` тестах (38→42), `templates/prompts/chat-system.md` (раздел «Инструменты запуска фаз и прогона» + правило grant), `README.md` (раздел «Супервизор: запуск фаз из чата и grant на прогон»), пересобран `web/dist`.
**Проверки:** `pnpm build` — ок; `pnpm --dir web build` (tsc -b + vite) — ок; `pnpm lint` — ок; **полный `pnpm test`** (env -u VIBELOG_*) — 2 прогона, 110 файлов / 2016+8 тестов, все зелёные (static.test.mjs идёт отдельным прогоном по конфигу package.json, не исключался).
**Что осталось (вне фазы Code по правилам):** AC15 — doc-8 (справочник MCP-инструментов) пишет Close, в Code документы backlog/docs не правятся; README и шаблон промпта обновлены. AC16: расхождения с doc-19 §11/§15 не обнаружены в объёме, доступном из worktree (полный текст doc-19 не читается — кап 8 КБ), контракт брался из описания задачи; ограничение «activeRuns в памяти процесса» (лимит после рестарта обнуляется) зафиксировано в README и решается в VL-269.
---
author: @agent
created: 2026-10-31 00:03
---
Фаза Close выполнена. Ветка vb/vl-268 слита в master (3 коммита: wip 21b5ff4, feat 79d95df, fix 514bcdb — убран случайно закоммиченный симлинк node_modules), merge-конфликтов не было, worktree удалена (--force: только untracked-симлинки node_modules и backlog/references/data на главный репо), ветка vb/vl-268 удалена.
Проверки после merge в главном репо: `pnpm build` — ок; ранний точечный фильтр по файлам diff'а (`pnpm test:fast supervisor-grant + supervisor + supervisor-tools + tool-policy + chat`) — 5 файлов / 109 тестов зелёные; полный `pnpm test` (env -u VIBELOG_*) — 110 файлов, 2019 passed, 4 skipped, плюс отдельный прогон `static.test.mjs` (8 passed) по конфигу package.json. Повторных полных прогонов не было.
Документация: doc-8 (справочник MCP-инструментов) дополнен разделом «Фазы и супервизор» (4 инструмента с таблицами параметров, формат grant-файла, правила проверки, примеры вызовов, HTTP-эндпоинты карточки); CHANGELOG.md — запись VL-268 в Unreleased (коммит 1532168). Причина закрытия AC15 в Close: doc-8 — файл backlog/docs, в фазе Code он не правится по правилам фаз.
Lessons: lesson-124 «Не коммить симлинк node_modules в ветку worktree — gitignore-паттерн node_modules/ его не ловит и merge в master падает на «untracked files»» (реальный инцидент этой фазы: merge abort'ился, понадобился `git rm --cached node_modules` в ветке), связан с задачей.
Известное ограничение (зафиксировано в README и в записи CHANGELOG): activeRuns живёт в памяти процесса, поэтому после рестарта лимит max_parallel_phases обнуляется — решается тиком/планировщиком в VL-269.
DoD: 1. Тесты проходят — да (полный прогон); 2. Документация обновлена — да (README и шаблон промпта в Code, doc-8 и CHANGELOG в Close); 3. Нет регрессий — да (полный прогон зелёный).
---
<!-- COMMENTS:END -->