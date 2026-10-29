---
id: VL-198
title: 'billing: учёт токенов по задачам и фазам (meta + frontmatter + billing)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 23:24'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - core
  - mcp
  - web
dependencies: []
milestone: v1.10
references:
  - ref-12
  - ref-18
  - ref-19
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/analytics.ts
  - src/core/billing.ts
  - src/core/analytics.test.mjs
  - src/core/billing.test.mjs
  - src/core/task.ts
  - src/core/store.ts
  - src/agent/cli.ts
  - src/agent/llm.ts
  - src/agent/loop.ts
  - src/agent/session.ts
  - src/agent/llm.test.mjs
  - src/agent/loop.test.mjs
  - src/agent/session.test.mjs
  - src/mcp/tools.ts
  - src/mcp/server.test.mjs
  - src/web/orchestrator.ts
  - src/web/qwen-result.ts
  - src/web/qwen-result.test.mjs
  - src/bot/rich.ts
  - src/bot/formatting.ts
  - src/cli/ui.ts
  - web/src/types/kanban.ts
  - web/src/components/task-modal/task-view.tsx
  - web/dist/index.html
  - web/dist/assets/index-CMOkMI33.css
  - web/dist/assets/index-DO6w0o0Q.js
  - README.md
lessons:
  - lesson-40
  - lesson-58
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
billing: учёт токенов по задачам и фазам (meta + frontmatter + billing)

Референсы: ref-12, ref-18, ref-19

Сейчас meta.json не содержит usage/time/model. JSONL содержит usageMetadata, но не агрегирует. Нужен учёт токенов: сколько потрачено на задачу, по фазам, с возможностью сверки с провайдером.

В целом мне кажется meta.json реализован не правильно - сейчас он создаётся для каждой сессии привязанной к задаче и хранит только по сути ссылку на задачу. Мне кажется нужно переделать на условный <VL-NN>.meta.json, который бы хранил все ссылки на сессии и другую мету, которые взаимодействовали с этой задачей.

И отдельно по поводу текущего jsonl - он тоже очень не полный. Для примера у qwen вот так выглядит:
{"uuid":"d953f1f3-84c1-49c4-a973-52678cea7eea","parentUuid":"b7525fe0-1358-4e62-b377-233d32515c5c","sessionId":"1fdd159c-0d8d-4a07-b3bf-87b37420e12d","timestamp":"2026-10-04T15:06:57.102Z","type":"assistant","provenance":"assistant_output","cwd":"/Users/bob/Dev/ton/ai/Vibelog.md","version":"0.24.7","gitBranch":"master","model":"xiaomi/mimo-v2.5","message":{"role":"model","parts":[{"text":"All steps done:\n1. Task read ✓\n2. Description updated with the rule ✓, AGENTS.md patched ✓, AC3 updated ✓\n3. Report comment added ✓\n4. Status: Spec already = Plan phase next, no change needed (comment didn't explicitly request status change; Spec → plan mapping means Plan phase is next)\n\nPer instructions: respond exactly one word — «Готово».","thought":true},{"text":"Готово"}]},"usageMetadata":{"promptTokenCount":47708,"candidatesTokenCount":89,"thoughtsTokenCount":84,"totalTokenCount":47797,"cachedContentTokenCount":46784},"contextWindowSize":1048576}
{"uuid":"da08bd35-b023-46b9-ac01-e1aed4053ff4","parentUuid":"d953f1f3-84c1-49c4-a973-52678cea7eea","sessionId":"1fdd159c-0d8d-4a07-b3bf-87b37420e12d","timestamp":"2026-10-04T15:07:33.391Z","type":"system","provenance":"system","cwd":"/Users/bob/Dev/ton/ai/Vibelog.md","version":"0.24.7","gitBranch":"master","subtype":"ui_telemetry","systemPayload":{"uiEvent":{"event.name":"qwen-code.api_response","event.timestamp":"2026-10-04T15:07:33.391Z","response_id":"rai-1791126417-XJTkz88uZUUf5zrOO1vx","model":"xiaomi/mimo-v2.5","status_code":200,"duration_ms":36195,"input_token_count":48029,"output_token_count":2191,"cached_content_token_count":6144,"thoughts_token_count":1942,"total_token_count":50220,"response_text":"Сканирую контекст: из Фазы Comment VL-73 есть два долгосрочных факта — (1) токен npm переделан без 2FA, publish/push для релизных задач разрешены без согласия (устаревает память npm-publish-2fa-otp), (2) VL-73 перешёл к фазе Plan. Читаю файлы для обновления.","prompt_id":"1fdd159c-0d8d-4a07-b3bf-87b37420e12d#managed-auto-memory-extractor-d711a6f8#0","auth_type":"openai","ttft_ms":4529,"subagent_name":"managed-auto-memory-extractor","subagent_id":"managed-auto-memory-extractor-d711a6f8","subagent_type":"managed-auto-memory-extractor"}}}

Три уровня хранения
1. meta.json (расширить) — самодостаточно для сверки с провайдером:
{ taskId, phase, cwd, sessionId, startedAt, finishedAt, durationMs, usage: { input, output, cache, total, requests }, model, agent }.

2. Задача (frontmatter) — агрегат по всем сессиям:
token_usage:
input: N, output: N, cache: N, total: N, requests: N, duration_ms: N
by_phase:
spec: { input: N, output: N, cache: N, requests: N }
plan: { ... }
code: { ... }
close: { ... }

3. .vibelog/billing/<taskId>.json — append-only массив сессий (источник правды):
{ taskId, sessions: [{ sessionId, phase, startedAt, finishedAt, durationMs, usage, model, agent }] }.
Деньги — НЕ в задаче. Считать в аналитике: токены * тариф (из settings.json pricing).

Как считать
1. cli.ts после runLoop:
- sumUsageFromMessages(loopResult.messages) — сумма usageMetadata + requests count.
- saveSessionMeta — дописать finishedAt, durationMs, usage, model, agent в meta.json.
- appendBilling — записать сессию в .vibelog/billing/<taskId>.json.
2. backlog_finish_phase — дополнительное поле tokenUsage:
- MCP добавляет в frontmatter задачи: append в by_phase, сумма в total.
- Fallback: если meta старое без usage — читать JSONL сессии и суммировать.
3. Аналитика:
- calculateCost(usage, pricing) — токены * тариф.
- pricing в settings.json: { "model-name": { input_per_1m, output_per_1m, cache_per_1m } }.

Что показывать
1. Задача (web + бот + CLI): секция «Токены» с by_phase и total.


- В usage хранить reasoning отдельно (из completion_tokens_details.reasoning_tokens) — для аналитики, не для вычитания.
- session_id передавать через X-Session-Id (Chat Completions) — для группировки на дашборде RouterAI.

Что НЕ нужно 
- Деньги в задаче — тариф меняется, хранить плохо.
- Парсинг JSONL при каждом запросе — meta + billing быстрее.
- Автоматическая сверка с RouterAI API — ручной ввод provider_total.

AC
- meta.json содержит: sessionId, startedAt, finishedAt, durationMs, usage { input, output, cache, total, requests }, model, agent.
- Задача (frontmatter): token_usage { input, output, cache, total, requests, duration_ms, by_phase }.
- .vibelog/billing/<taskId>.json: append-only массив сессий.
- backlog_finish_phase: поле tokenUsage — MCP добавляет в frontmatter.
- Fallback: JSONL сессии, если meta без usage.
- Web: секция «Токены» в карточке задачи.
- Бот: секция «Токены» в карточке /task.
- settings.json: pricing { model: { input_per_1m, output_per_1m, cache_per_1m } }.
- calculateCost(usage, pricing) в src/core/analytics.ts.
- Тесты: sumUsageFromMessages, saveSessionMeta, appendBilling, backlog_finish_phase с tokenUsage, calculateCost.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-198 — Plan: учёт токенов по задачам и фазам (meta + frontmatter + billing)

## Архитектурные решения (зафиксированы на этапе Plan)

1. **Отдельный `<VL-NN>.meta.json` НЕ делаем.** Идею «файл задачи со ссылками на все сессии» выполняет **`.vibelog/billing/<taskId>.json`** (уровень 3 из описания): append-only массив всех сессий, взаимодействовавших с задачей. Существующая `<sessionId>.meta.json` расширяется полями (уровень 1) — это консистентно с AC и не ломает findTaskPhaseSessionSync/listTaskSessionMetas (VL-147/VL-187).
2. **Источник usage во время сессии** — наш JSONL: сейчас assistant-сообщения пишутся БЕЗ usage (опровергает исходное «JSONL содержит usageMetadata» — это формат qwen). Поэтому loop дописывает `usage` в каждое assistant-сообщение → инкрементальный JSONL (VL-103) уже содержит полные данные к моменту вызова finish_phase.
3. **Идемпотентность frontmatter**: в meta хранится `usage_recorded` (сколько уже перенесено в frontmatter). И finish_phase, и post-run дописывают только **дельту** — иначе двойной учёт (finish_phase вызывается до конца рана, а cli/orchestrator пишут после).
4. **qwen-раны**: MCP qwen не имеет VIBELOG_SESSION_ID → finish_phase тихо пропускает token_usage с ошибкой в сводку; полную запись делает оркестратор в finish-блоке (у него есть result.usage из parseQwenResult) через ту же core-функцию.
5. **Деньги** — только calculateCost(usage, pricing) в аналитике; в задачу/фронтматтер не пишем. `pricing` — секция settings.json.
6. **reasoning** — отдельное поле `reasoning_tokens` в LlmUsage/meta/billing (из completion_tokens_details.reasoning_tokens, ref-19); в frontmatter token_usage НЕ входит (AC фиксирует состав).
7. **X-Session-Id** (ref-18): заголовок в запросах llm-клиента для группировки на дашборде RouterAI.

## Файлы для изменения

### Новые
| Файл | Содержимое |
|---|---|
| `src/core/analytics.ts` | `TokenUsage` {input, output, cache, total, requests, reasoning?}; `calculateCost(usage, pricing)`; `getPricing(cwd)` (секция `pricing` settings.json: `{model: {input_per_1m, output_per_1m, cache_per_1m}}`); `emptyUsage/addUsage/usageDelta` |
| `src/core/billing.ts` | `BillingRecord` {taskId, sessions: [{sessionId, phase, startedAt, finishedAt, durationMs, usage, model, agent}]}; `appendBilling(cwd, entry)`, `readBilling(cwd, taskId)`; путь `.vibelog/billing/<taskId>.json`, JSON + `\n`, мерж по sessionId? НЕТ — append-only (каждый ран — запись) |
| `src/core/analytics.test.mjs` | calculateCost: тарифы × токены /1m, кэш отдельно, пустой pricing → 0 |
| `src/core/billing.test.mjs` | appendBilling: создание файла, дозапись, битый JSON → ошибка/пересоздание |

### Правки по файлам (с места → что меняем)
1. **`src/agent/loop.ts`**
   - ~188 `pushMessage`: не трогать.
   - Места `pushMessage({role:'assistant'…})`: **251** (fail — usage отсутствует, не дописываем), **321** (финал) и **~345** (assistant+tool_calls) — добавить `usage: {…response.usage, reasoning_tokens}` (копию последнего ответа).
   - `LoopResult.usage` — уже есть (219), не трогаем.
2. **`src/agent/llm.ts`**
   - **51-56** `LlmUsage` += `reasoning_tokens: number`; **105** `zeroUsage` += 0; **117-153** `mapUsage` читает `completion_tokens_details.reasoning_tokens` (+variants `reasoning_tokens`/`thoughtsTokenCount`); **156** `addUsage` +=.
   - **66-95** `LlmClientOptions` += `sessionId?: string`; **466-475** fetch-заголовки += `...(sessionId ? {'X-Session-Id': sessionId} : {})`.
   - **244-266** `toWireMessages`: assistant-ветка возвращать `{role, content}` (+tool_calls по-старому) — **usage НЕ уходить провайдеру** (иначе 400 от строгих API).
3. **`src/agent/session.ts`**
   - **125-133** `SessionMeta` += `sessionId?`, `startedAt?`, `finishedAt?`, `durationMs?`, `usage?: TokenUsage`, `usage_recorded?: TokenUsage`, `model?`, `agent?`.
   - `saveSessionMeta` — оставить как есть (полная запись при создании), но **139-142** дополнить: при создании проставлять `sessionId` и `startedAt: ISO-now`.
   - Новая `updateSessionMeta(dir, sessionId, patch)` — синхронный merge с существующей метой (lesson-40: фаза/taskId не затираются, при отсутствии меты — создаёт из patch). Используется post-run и оркестратором.
   - Новая `sumUsageFromMessages(messages: ChatMessage[]): LlmUsage & {requests: number}` — суммирует `usage` у assistant-сообщений, requests = число assistant-сообщений с usage (пустой массив → нули; старые jsonl без usage → нули, не ошибка).
4. **`src/agent/cli.ts`**
   - **266** `createLlmClient()` перенести ниже резолва sessionId (~352) и вызвать `createLlmClient({ sessionId })` — для X-Session-Id (llm нигде не используется до runLoop).
   - **364/370** `saveSessionMeta` — уже допишет sessionId/startedAt (п.3).
   - **395** `McpClient.create({ cwd })` → `{ cwd, env: {...process.env, VIBELOG_SESSION_ID: sessionId, ...(isPhaseMode ? {VIBELOG_PHASE_NAME: phase} : {})} }` — MCP резолвит сессию/фазу в finish_phase.
   - После **568** (`saveSession`) — новый блок «post-run учёт» (всё в try/catch с предупреждением в stderr, фазу не роняет):
     1. `sum = sumUsageFromMessages(loopResult.messages)` → `toTokenUsage(sum)` (+requests); `usage = add(recorded из meta, sum)`? НЕТ — messages при resume включают старые сообщения → usage сессии = сумма по всем messages (корректно для кумулятива), duration/finishedAt — через `updateSessionMeta` (merge: finishedAt=now, durationMs=loopResult.duration_ms, usage сессии, model=llm.model, agent='vb', usage_recorded не трогаем).
     2. Frontmatter-дельта: `delta = usage − usage_recorded` (поэлементный max(0,…)); если delta>0 и есть taskId из meta → `addTaskTokenUsage(cwd(VIBELOG_CWD??cwd), taskId, phase, delta, durationMs)`; затем `updateSessionMeta(…, {usage_recorded: usage})`.
     3. `appendBilling(VIBELOG_CWD ?? cwd, taskId, {sessionId, phase, startedAt(из meta), finishedAt, durationMs, usage, model, agent:'vb'})` — только если taskId есть (prompt-режим — пропуск).
5. **`src/mcp/tools.ts`**
   - Схема **381-393** `backlog_finish_phase` += `tokenUsage: {type:'object', properties:{input,output,cache,total,requests — number}, additionalProperties:false}` и `phase: {type:'string'}` (редкий override; обычно из env/meta).
   - `toolFinishPhase` (**1098+**), после dodChecks-блока — новый блок «token_usage» (паттерн частичного применения, lesson-34/35):
     - Валидация: `tokenUsage` объект, все поля — finite числа ≥0; иначе `errors.push('tokenUsage: …')`, блок пропускается.
     - Резолв (если tokenUsage не передан): `env VIBELOG_SESSION_ID` → `loadSessionMetaSync(agentSessionsDir(VIBELOG_CWD ?? cwd))` → если `meta.usage` есть — берём его; иначе (meta старое/нет usage) → `loadSession(<sessionId>.jsonl)` → `sumUsageFromMessages`. Ни того ни другого → `errors.push('token_usage: сессия/usage недоступны (нет VIBELOG_SESSION_ID или jsonl)')`.
     - Фаза: `args.phase ?? env VIBELOG_PHASE_NAME ?? meta.phase`; нет фазы → ошибка в сводку.
     - Дельта `usage − (meta.usage_recorded ?? 0)` >0 → `addTaskTokenUsage(...)` (см. п.6); иначе пропуск без ошибки (уже записано).
     - `updateSessionMeta(…, {usage_recorded: usage})`; summary-строка `tokenUsage: input=… (фаза X)`.
6. **`src/core/task.ts`** — поле `token_usage?: TokenUsage` (в `Task` ~53-84 и `TaskInput` ~85-115; в `createTask` ~131 — `input.token_usage`); `taskToMarkdown` frontmatter (**165-194**) += `token_usage` ТОЛЬКО если задан (совместимость: пустые задачи не меняются, compat-тесты зелёные); `markdownToTask` (**288-325**) += чтение `data.token_usage` (объект → типизированный, иначе undefined). **Обязательно обе стороны** — иначе поле теряется при любой записи (taskToMarkdown строит frontmatter из известных полей).
   - Новая `addTaskTokenUsage(cwd, taskId, phase, usageDelta, durationMsDelta)` (или рядом, в analytics.ts со ссылкой на store): getTask → мерж token_usage (total +=, duration_ms +=, by_phase[phase] += {input, output, cache, requests}) → запись файла. Импорт из tools.ts и cli/orchestrator.
7. **`src/web/orchestrator.ts`** — finish-блок **916-955** (после saveSessionMeta): `updateSessionMeta` вместо прямой записи там, где уже есть existing-проверка (lesson-40 сохранить!); дополнить мету: finishedAt, durationMs=result.duration_ms, usage=toTokenUsage(result.usage)+requests=num_turns, agent, model (если будет в QwenResult); frontmatter-дельта через `addTaskTokenUsage` (для qwen — основной путь; для vb — дельта≈0, идемпотентно); `appendBilling(...)`. Все вызовы — fail-safe (catch → console.log, как существующий saveSessionMeta).
8. **`src/web/qwen-result.ts`** — опционально: парсить `model` из JSON result (поле есть у vb-контракта AgentJsonResult? нет — добавить в оба не требуется AC; сделать только если поле есть в JSON, иначе undefined).
9. **Отображение:**
   - `web/src/types/kanban.ts` `TaskDetail`/`KanbanTask` (**50-70**) += `token_usage?: TokenUsage` (свой тип-дубликат или импорт-тип из core — web уже импортирует типы Task, повторить паттерн).
   - `web/src/components/task-modal/task-view.tsx` — новый таб «Токены» (паттерн `filled(...)` **81-95**): totals (input/output/cache/total/requests/duration) + таблица by_phase; рендер при `task.token_usage` непустой. API GET /api/tasks/:id (**src/web/api.ts 446-451**) возвращает task как есть — поле пройдёт без правок.
   - `src/bot/rich.ts` `renderTaskRich` (**298+**, после meta-блока ~360) — секция `**Токены:** …` с by_phase (только если token_usage задан).
   - `src/bot/formatting.ts` `formatTaskDetail` (**311+**) — та же секция для MarkdownV2-fallback (lesson-37: вынести общий билдер строк токенов в хелпер — напр. `formatTokenUsageLines(usage): string[]` в `src/core/analytics.ts` или bot/formatting — бот-части идентичны).
   - `src/cli/commands/task.ts` `case 'view'` (**50+**) — секция «Токены: input=… output=… cache=… total=… requests=… duration=…», по фазам одной строкой.

### Тесты (AC)
- `src/agent/session.test.mjs` — `sumUsageFromMessages` (суммы, requests, старые сообщения без usage → нули); `updateSessionMeta` (merge не затирает taskId/phase, дописывает usage/finishedAt; нет файла → создаёт).
- `src/agent/loop.test.mjs` — assistant-сообщения содержат usage (последнего ответа); **проверить неизменность wire**: тест llm на `toWireMessages` не отдаёт usage провайдеру (`src/agent/llm.test.mjs` — сообщение без поля usage).
- `src/mcp/server.test.mjs` (describe VL-138, **326+**) — finish_phase с `tokenUsage` → frontmatter token_usage обновлён (by_phase+total); fallback через JSONL (env VIBELOG_SESSION_ID + фикстура jsonl); невалидный tokenUsage → ошибка в сводки, остальное применилось; дельта-повтор → без двойного учёта.
- `src/core/analytics.test.mjs`, `src/core/billing.test.mjs` — см. новые файлы.
- `src/core/compat.test.mjs`/`compat-full.test.mjs` — прогнать: задача без token_usage сериализуется байт-в-байт как раньше; с token_usage — roundtrip вложенного YAML (stringifyYaml поддерживает вложенные объекты, yaml.ts:263).

## Порядок действий
1. `src/core/analytics.ts` + тесты (типы, calculateCost, getPricing, addUsage/дلتы, formatTokenUsageLines).
2. `src/core/task.ts`: поле token_usage обе стороны + `addTaskTokenUsage`; compat-прогон.
3. `src/core/billing.ts` + тесты.
4. `src/agent/llm.ts`: LlmUsage.reasoning_tokens, toWireMessages-чистка, X-Session-Id, sessionId в options.
5. `src/agent/session.ts`: SessionMeta-поля, updateSessionMeta, sumUsageFromMessages + тесты.
6. `src/agent/loop.ts`: usage в assistant-сообщениях + тест.
7. `src/agent/cli.ts`: перенос createLlmClient, env для MCP, post-run блок (meta/billing/frontmatter-дельта).
8. `src/mcp/tools.ts`: схема tokenUsage/phase + резолв в toolFinishPhase + тесты в server.test.mjs.
9. `src/web/orchestrator.ts`: finish-блок (meta/billing/frontmatter для qwen-ранов).
10. Отображение: kanban.ts типы → task-view.tsx таб → bot rich/formatting → CLI view.
11. Документация: README (секция «Учёт токенов/billing»: три уровня, pricing в settings.json, X-Session-Id), примечание в описании settings.

## Как проверять
```bash
pnpm build && pnpm test        # полный прогон (build + vitest)
pnpm test:fast                 # итерации, dist собран
pnpm web:build                 # после правок web/src (в worktree: cd web && pnpm install — lesson-6)
```
Ручная верификация web — chrome-devtools: `new_page` → evaluate_script (секция «Токены» в карточке), console/network чистые. Без take_screenshot (VL-178).

## Риски
1. **Двойной учёт frontmatter** (finish_phase + post-run + оркестратор) → дельта-механика через `usage_recorded` в meta; тест на повторный вызов.
2. **Перезапись meta** (lesson-40, VL-185): только `updateSessionMeta`-merge; полная перезапись `saveSessionMeta` — только при создании сессии. Регрессия findTaskPhaseSessionSync — существующие тесты session.test.mjs.
3. **usage уходит провайдеру** в assistant-сообщении при resume → строгий API отвечает 400; toWireMessages обязан вычищать (тест llm.test.mjs).
4. **Старые jsonl/меты** без usage — sumUsageFromMessages → нули, frontmatter не двигается (дельта 0), фоза не падает.
5. **YAML-вложенность token_usage.by_phase** — stringify/parse поддерживают, но прогонить compat-тесты (возможен байтовый diff старых файлов, если поле когда-то будет записываться пустым — не писать пустое).
6. **MCP env в тестах** (VL-116): server.test.mjs чистит VIBELOG_CWD/VIBELOG_PHASE_* — добавить туда же VIBELOG_SESSION_ID, иначе фикстуры «протекут» в реальный репозиторий.
7. **interactive.ts / analyze-раны** — вне задачного контекста: пост-run блок пишет только при наличии taskId в meta; иначе пропуск (нет регрессии чата).
8. Параллельный worktree: правки только в рабочем каталоге ветки vb/vl-198; backlog/ — через MCP (не коммитить).

## Покрытие AC
- meta.json поля (sessionId/startedAt/finishedAt/durationMs/usage/model/agent) — п.4.3 + п.5.
- frontmatter token_usage c by_phase — п.6 + п.8.
- billing append-only — п.4.3 + п.7.
- finish_phase tokenUsage — п.8; fallback JSONL — п.8 (резолв meta → jsonl).
- Web-секция «Токены» — п.9; бот — п.9; CLI view — п.9.
- settings pricing + calculateCost — п.1.
- Тесты sumUsageFromMessages/saveSessionMeta(→updateSessionMeta)/appendBilling/finish_phase+tokenUsage/calculateCost — «Тесты (AC)».
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 23:58
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (информационный, в пределах 80 символов). Тип: feature. Масштаб: task. Приоритет: Medium. Уточнено: тип/приоритет/labels; AC вынесены в поле приёмки (3 группирующих критерия — хранение на трёх уровнях, интеграция через backlog_finish_phase с fallback на JSONL, отображение и аналитика + тесты); зафиксированы исключения из описания (деньги в задачу не кладём, JSONL на каждый запрос не парсим, сверка с RouterAI — ручной ввод provider_total). Labels: core, mcp, web. References: ref-12, ref-18, ref-19 (уже связаны; новых внешних источников в описании не упомянуто). Вопросов нет.
---
author: @agent
created: 2026-10-27 00:56
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в Implementation Plan: 14 файлов правки + 4 новых (src/core/analytics.ts, src/core/billing.ts и 2 тест-файла). Ключевые архитектурные решения: (1) отдельный `<VL-NN>.meta.json` НЕ создаётся — его роль выполняет `.vibelog/billing/<taskId>.json` (append-only, все сессии задачи), существующая `<sessionId>.meta.json` расширяется полями usage/startedAt/finishedAt/durationMs/model/agent/sessionId — так читаются AC и не ломаются findTaskPhaseSessionSync/listTaskSessionMetas; (2) уточнено по факту кода: наш JSONL НЕ содержит usageMetadata (это формат qwen) — loop будет дописывать usage в assistant-сообщения, тогда инкрементальный JSONL даёт данные для fallback-резолва finish_phase; (3) идемпотентность frontmatter через `usage_recorded` в meta — все три писателя (finish_phase, cli post-run, оркестратор) дописывают только дельту, без двойного учёта; (4) qwen-раны (без VIBELOG_SESSION_ID в MCP) покрываются через finish-блок оркестратора с result.usage; (5) деньги — только calculateCost в новом src/core/analytics.ts + секция pricing settings.json; reasoning_tokens — отдельным полем в LlmUsage/meta/billing (ref-19), во frontmatter не входит; X-Session-Id — заголовок llm-запросов (ref-18). Референсы ref-12/18/19 учтены. Тесты: sumUsageFromMessages, updateSessionMeta (merge), appendBilling, finish_phase с tokenUsage (+fallback JSONL +дельта), calculateCost, compat-прогон. Риски: двойной учёт (дельта-механика), перезапись meta (lesson-40 — только merge), утечка usage в wire-сообщениях (toWireMessages вычищает + тест), VIBELOG_SESSION_ID чистить в server.test.mjs (VL-116). DoD отмечены: тесты будут прогонены в Code, документация (README — секция учёта токенов), регрессий — compat/сессионные тесты.
---
author: @agent
created: 2026-10-27 02:10
---
Фаза 3 (Code) выполнена. Изменено: 29 файлов (1690+/183-), коммит a6e8544 в ветке vb/vl-198.
Реализация по плану, все три уровня хранения:
1) Мета сессии: SessionMeta расширен (sessionId/startedAt/finishedAt/durationMs/usage/usage_recorded/model/agent), новая updateSessionMeta — только merge (lesson-40: taskId/phase не затираются); saveSessionMeta при создании проставляет sessionId/startedAt.
2) Frontmatter token_usage: поле в Task (taskToMarkdown пишет только при наличии — compat-байты не меняются, markdownToTask с валидацией isTokenUsage), addTaskTokenUsage в store.ts (дельта-аппенд total/duration_ms/by_phase).
3) Billing: новый src/core/billing.ts — appendBilling/readBilling, .vibelog/billing/<taskId>.json, каждая запись = usage за ран (resume не даёт двойного счёта при суммировании).
Запись (дельта-идемпотентность через usage_recorded, риск №1 закрыт):
- cli post-run: sumUsageFromMessages → мета (кумулятив) + frontmatter-дельта + billing (за ран), всё в try/catch, exit-код не меняется; env-taskId фильтруется taskIdPattern (VL-118 закрыт — тест проходит).
- backlog_finish_phase: поле tokenUsage (валидация на границе, lesson-34/35) + fallback env VIBELOG_SESSION_ID → мета → jsonl (sumUsageFromJsonlSync); фаза args.phase → env → meta.phase; сводка с источником/дельтой; повтор → «уже записан».
- Оркестратор finish: для qwen-ранов основной путь (result.usage + num_turns, кумулятив с прошлыми ранами), после промиса saveSessionMeta (гонка закрыта); vb — идемпотентная подстраховка.
Сопутствующее по описанию: loop дописывает usage в assistant-сообщения JSONL (источник fallback), toWireMessages вычищает usage из wire (тест llm), X-Session-Id заголовок (ref-18), reasoning_tokens в LlmUsage/mapUsage/QwenResult (ref-19, отдельным полем).
Отображение: web-таб «Токены» (totals + таблица by_phase), бот rich-секция + MarkdownV2-fallback formatTaskDetail, CLI task view (printTaskDetail). Аналитика: src/core/analytics.ts — calculateCost/getPricing/usageDelta/formatTokenUsageLines, pricing-секция settings.json. Документация: README-секция «Учёт токенов (billing)».
Проверки: pnpm build чистый (strict tsc); pnpm test — 77/77 файлов, 1373 теста зелёные (4 штатных skipped); pnpm web:build собран (pnpm install в web/ по lesson-6). Тесты AC: sumUsageFromMessages, updateSessionMeta, appendBilling, finish_phase с tokenUsage (явный + JSONL-fallback + идемпотентность), calculateCost — все новые падают/проходят. Обновлены ожидания существующих deepEqual под новые поля (reasoning_tokens, sessionId/startedAt в meta). Регрессий нет: compat/сессионные/loop/llm/cli-тесты зелёные.
Замечания: (1) AC-чеклист в задаче пуст — покрытие AC задокументировано в Implementation Plan (раздел «Покрытие AC»), DoD 3/3 отмечены; (2) флак CLI-тестов config/create/search при параллельном запуске воспроизводится И на чистой ветке (контроль через git stash) — предсуществующая гонка фикстур /tmp, не регрессия VL-198; (3) args-only путь finish_phase без VIBELOG_SESSION_ID пишет всю сумму каждый вызов (usage_recorded негде хранить) — задокументировано в тесте, боевой vb-ран всегда имеет env сессии; (4) lessons: использовал lesson-6/13/34/35/37/40 из блока — уже связаны, новых не создавал.
---
author: @agent
created: 2026-10-27 02:18
---
Фаза Close выполнена. Ветка vb/vl-198 слита в master (1 коммит a6e8544, merge d93be01), worktree удалена (только untracked-симлинки node_modules/refs → force), ветка удалена. Сборка и тесты после merge: pnpm build чистый, pnpm test зелёные. DoD: 3/3 отмечены (тесты проходят — 77 файлов/1373 теста, документация обновлена — README из ветки + CHANGELOG/doc-6/doc-7/doc-8 в docs-коммите c3f037f, нет регрессий — compat/сессионные тесты зелёные). Lessons: lesson-58 создана (дельта-идемпотентность через usage_recorded), lesson-40 связана с VL-198; refs и lessons закоммичены (0c3884f).
---
<!-- COMMENTS:END -->