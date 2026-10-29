---
id: VL-204
title: 'web: чат с LLM (assistant-ui) — обсуждение + создание задач через tool-calling'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-27 01:08'
updated_date: '2026-10-29 07:42'
due_date: ''
labels:
  - web
  - core
  - agent
dependencies: []
milestone: v1.10
references:
  - ref-22
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/chat.ts
  - src/web/chat.test.mjs
  - src/web/server.ts
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/App.tsx
  - web/src/lib/use-hash-route.ts
  - web/src/components/layout/app-sidebar.tsx
  - web/vite.config.ts
  - web/package.json
  - web/pnpm-lock.yaml
  - web/dist/index.html
  - web/dist/assets/index-B-o97BWJ.css
  - web/dist/assets/index-DQOgQ57v.js
  - README.md
lessons:
  - lesson-59
token_usage:
  input: 26959156
  output: 277244
  cache: 26470912
  total: 27236400
  requests: 177
  duration_ms: 5323223
  reasoning: 225352
  by_phase:
    plan:
      input: 26959156
      output: 277244
      cache: 26470912
      requests: 177
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
web: чат с LLM (assistant-ui) — обсуждение + создание задач через tool-calling

Нужен чат в веб-интерфейсе: обсудить проект, спросить по задачам, создать задачу через чат с подтверждением.

## Библиотека: assistant-ui

- MIT, React 19, shadcn/ui theme.
- useChatRuntime + кастомный адаптер к нашему SSE-бэкенду.
- Tools/Toolkit для рендера tool calls.
- Human-in-the-loop: approval gates для создания задач (Allow/Deny).

## Что нужно

1. Backend: POST /api/chat (SSE-стриминг).
   - Принимает { message, sessionId?, threadId? }.
   - Контекст: поиск по message (задачи, lessons, references, documents).
   - LLM с tools: backlog_create_task, backlog_search, backlog_view_task.
   - Tool calls стримятся в SSE (как assistant-ui ожидает).
   - История в .vibelog/chat-sessions/<threadId>.jsonl.

2. Frontend: страница #/chat.
   - assistant-ui (AssistantRuntimeProvider, useChatRuntime, Thread).
   - Кастомный runtime адаптер к нашему SSE.
   - Tools: рендер tool calls (создание задачи).
   - Human-in-the-loop: Allow/Deny для создания задачи.

3. Vite workaround: define: { 'process.env': JSON.stringify({ NODE_ENV: 'production' }) } в vite.config.ts (issue #3223).

## Что НЕ нужно (MVP)

- Message branching, RAG-блоки, Confidence scores (assistant-ui фичи, не критичны).
- Голосовой ввод.
- Multi-user.

## AC

- POST /api/chat (SSE).
- Страница #/chat с assistant-ui.
- Кастомный runtime адаптер к SSE.
- Tools: backlog_create_task, backlog_search, backlog_view_task.
- Human-in-the-loop: Allow/Deny для создания задачи.
- Vite workaround для process.env.
- История в .vibelog/chat-sessions/.
- Тест: SSE-стриминг, tool-calling с Allow/Deny.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/chat — SSE-стриминг ответа; история в .vibelog/chat-sessions/<threadId>.jsonl
- [x] #2 Страница #/chat с assistant-ui: кастомный runtime-адаптер к SSE + Human-in-the-loop Allow/Deny для создания задачи
- [x] #3 Тесты SSE-стриминга и tool-calling с Allow/Deny проходят; Vite workaround (define process.env) в vite.config.ts
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-204 — web: чат с LLM (assistant-ui) через POST /api/chat (SSE)

## Архитектурные решения (по ref-22 / backlog/references/data/assistant-ui/)

- **Рантайм: `useLocalRuntime` + кастомный `ChatModelAdapter`** (ref-22: apps/docs/content/docs/runtimes/custom/local-runtime.mdx). НЕ `useChatRuntime` из `@assistant-ui/ai-sdk` — тот тянет Vercel AI SDK целиком; LocalRuntime требует один `run()` и даёт ветвление/редактирование бесплатно. Adapter парсит наш SSE.
- **Human-in-the-loop — approval gates LocalRuntime** (local-runtime.mdx:579-604): первый run возвращает tool-call part с `approval: { id: toolCallId }` + `status: { type: "requires-action", reason: "tool-calls" }` → run ставится на паузу; Allow/Deny через `part.respondToApproval({ approved, reason? })` (children-API `MessagePrimitive.Parts`, packages/core/src/react/primitives/message/MessageParts.tsx:714); после решения рантайм вызывает adapter повторно — во втором run читаем решение из `unstable_getMessage().content` и шлём approval на сервер.
- **Наш SSE-протокол** (data-строки JSON): `{type:"text",delta}`, `{type:"tool_start",id,name,args}`, `{type:"tool_end",id,result,isError}`, `{type:"approval",toolCallId,name,args}`, `{type:"done"}`, `{type:"error",message}`. Adapter мапит их в content-части ChatModelRunResult.
- **LLM-цикл серверный**, пауза на approval между двумя POST /api/chat (state в jsonl-истории).

## Файлы

### Backend

1. **`src/web/chat.ts` (новый, ~300 строк)**
   - `chatSessionsDir(cwd)` → `<cwd>/.vibelog/chat-sessions` (паттерн agentSessionsDir из src/agent/session.ts:19); `loadChatHistory(cwd, threadId)` — чтение ChatMessage[] из `<threadId>.jsonl`; `appendChatMessages(...)` — append построчно (паттерн VL-103).
   - `runChat(body, cwd, deps)` → `AsyncGenerator<ChatEvent>`; deps `{ llm }` (injectable для тестов, паттерн runLoopOptions.llm).
   - body: `{ message, threadId?, sessionId? }` — новый ход; `{ threadId, approval: { toolCallId, approved } }` — решение по approval.
   - System prompt: роль (асистент проекта Vibelog.md, русский), список из 3 tools, пометка «backlog_create_task требует подтверждения пользователя».
   - Контекст: `globalSearch(cwd, message)` (src/core/search.ts:175) → до 5 задач + по ≤3 lessons/references/documents, вывод усечён `truncateToolOutput` → в system-сообщение.
   - Цикл: `llm.streamChat` (src/agent/llm.ts:103) c ToolDef из `listTools()` (src/mcp/tools.ts:79), фильтр ровно 3 имени: `backlog_create_task`, `backlog_search`, `backlog_view_task`; лимиты: ≤8 итераций tool-вызова, ≤120 с wall-time.
   - Ход инструментов: `backlog_search`/`backlog_view_task` → `handleToolCall` (src/mcp/tools.ts:618) сразу, события tool_start/tool_end; `backlog_create_task` → **не выполнять**: append assistant(tool_calls)+уже выполненные tool-результаты в jsonl, yield `{type:"approval",...}`, return (пауза).
   - Resume с approval: append tool result (approve → `handleToolCall('backlog_create_task')` → JSON задачи; deny → `{"error":"Пользователь отклонил создание задачи"}`), продолжить цикл → текст → `{type:"done"}`.
   - **Guard сирот**: при новом `message`, если последний assistant в истории имеет tool_calls без парных tool-результатов (пользователь не ответил на approval, а прислал новое сообщение) — вставить синтетический tool-result `{"error":"Отменено пользователем"}` ДО user-сообщения (иначе провайдер отклонит payload).
   - Отсутствует `VIBELOG_LLM_API_KEY`/`VIBELOG_LLM_MODEL` → yield `{type:"error"}` с текстом ошибки (формулировки ensureLlmEnv, src/agent/llm-env.ts), не ронять сервер.
   - threadId: если не пришёл — сгенерировать (`createSessionId`-паттерн), вернуть в первом событии `{type:"thread",threadId}`; валидация `^[a-zA-Z0-9_-]{1,64}$` (защита path-traversal в имени файла).

2. **`src/web/server.ts` (правка, блок ~строк 51-73)**
   - После парсинга body и ДО `handleApi(...)`: `if (method === 'POST' && url === '/api/chat')` → `res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache'})`, цикл `for await (const ev of runChat(parsed, cwd, {...})) res.write('data: ' + JSON.stringify(ev) + '\n\n')`, в конце `res.end()`. try/catch → событие `{type:"error"}`. CORS-заголовки уже ставятся выше.
   - `handleApi` НЕ трогаем (он синхронный JSON — VL-38 lesson про query string не задеваем).

3. **`src/web/chat.test.mjs` (новый)** — паттерн llm.test.mjs (мок-fetch) + search-api.test.mjs (tmp-фикстура backlog с config.yml):
   - Текст: fake LLM → события `text`-дельты подряд + `done`; в jsonl user+assistant.
   - Tool loop: LLM вызывает backlog_search → `tool_start`/`tool_end` с результатом, затем финальный текст; задачи в tmp-backlog не меняются.
   - Approval: LLM вызывает backlog_create_task → событие `approval`, **файл задачи НЕ создан**; resume `approved:true` → файл создан (createTaskFile-паттерн), финальный текст; отдельный кейс `approved:false` → файла нет, в истории tool-result с error.
   - HTTP-интеграция: `startWebServer(cwd, 0, false)` (паттерн static.test.mjs:107) + fetch POST /api/chat → `content-type: text/event-stream`, поток читается построчно.
   - Guard сирот: история с assistant(tool_calls) без результата + новое message → не падает, синтетический result вставлен.

### Frontend

4. **`web/package.json`** — зависимость `@assistant-ui/react` (peer react ^18||^19 — наш 19.2.8 подходит; `radix-ui` уже есть, транзитивный ^1.8.1 разрешится pnpm). Установка: `pnpm --dir web add @assistant-ui/react` (lesson-6: в свежем worktree сначала `pnpm install` в web/).

5. **`web/vite.config.ts`** — в `defineConfig` добавить:
   ```ts
   define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
   ```
   (workaround issue #3223 — assistant-ui/zustand читают process.env в браузерном бандле).

6. **`web/src/lib/use-hash-route.ts`** — в union `Route` (строка 22) добавить `'chat'`; в `parseHash` (строка 35): `if (path === 'chat') return 'chat';` (поставить ДО детальных префиксов, рядом с tasks).

7. **`web/src/App.tsx`** — импорт `ChatPage`; ветка `route === "chat" ? <ChatPage /> :` в цепочке строк 65-87; для chat-роута `<main>` получает `overflow-hidden` вместо `overflow-y-auto` (иначе двойной скролл: viewport внутри Thread скроллится сам, lesson-14 — высота через h-full, не calc).

8. **`web/src/components/layout/app-sidebar.tsx`** — пункт в NAV_GROUPS (после lessons, ~строка 74): `{ id: "chat", title: "Чат", url: "chat", icon: MessageSquare, activeWhen: ["chat"] }` (MessageSquare уже импортируется в проекте из lucide-react — task-card.tsx:17).

9. **`web/src/components/chat/chat-runtime.tsx` (новый)** — `ChatRuntimeProvider`:
   - `useLocalRuntime(adapter)` + `AssistantRuntimeProvider` (ref-22 local-runtime.mdx quickstart).
   - Adapter (`ChatModelAdapter.run`): 
     - Обычный ход: `fetch('/api/chat', {method:'POST', body:{message: lastUserText, threadId}})`, читаем `response.body.getReader()` + TextDecoder, парсим `data:`-строки; yield'ы накапливают content: текстовый delta → text-part (пересобираем полный массив каждый yield); `tool_start/tool_end` → tool-call part (search/view — с result); `approval` → tool-call part c `approval:{id:toolCallId}` и **финальный yield** `status:{type:"requires-action",reason:"tool-calls"}` → пауза.
     - Резюме после Allow/Deny: `unstable_getMessage().content` → tool-call с `approval.approved` → POST {threadId, approval:{toolCallId, approved}} → поток продолжения → yield'ы докидываются в ту же assistant-нить (текст после решения).
     - threadId: `useRef`, заполняется из события `thread`; при пустом — crypto.randomUUID().
   - Ошибка LLM env / сети → text-part с русским текстом ошибки (статус complete), без throw.

10. **`web/src/components/chat/thread.tsx` (новый)** — минимальный Thread из примитивов (паттерн ref-22 apps/docs/content/docs/primitives/thread.mdx:18-70): `ThreadPrimitive.Root/Viewport/Messages/ViewportFooter` + `ComposerPrimitive.Root/Input/Send`; `MessagePrimitive.Parts` с children-рендером:
    - text → существующий `MarkdownView` (web/src/lib/markdown.tsx) вместо голого `<p>` (нужны списки/код в ответах LLM);
    - tool-call backlog_create_task: карточка «Создать задачу» (args.title/description/priority) + пока `approval.approved === undefined` — кнопки Allow/Deny → `part.respondToApproval({approved, reason?})`; после решения — статус «Создана» (result с id) / «Отклонена» (isError);
    - tool-call search/view: сворачиваемая строка «Поиск: query» → результат (по образцу ToolFallback из ref-22 packages/ui/.../tool-fallback.aui.tsx, но без импорта из референса — свой минимум на наших ui-компонентов button/collapsible);
    - стили под существующие shadcn-компоненты (button, avatar), шрифты/цвета — из index.css tokens.

11. **`README.md`** — короткий раздел «Веб-чат (#/chat)»: назначение, требуемые env (VIBELOG_LLM_*), как подтверждать создание задач, где лежит история (.vibelog/chat-sessions/).

## Порядок действий

1. `pnpm install` (корень) и `pnpm install` в web/ (lesson-6); `pnpm build` — базовая сборка до правок.
2. Backend: src/web/chat.ts → правка server.ts → `pnpm build` → src/web/chat.test.mjs → `pnpm test`.
3. Frontend: package.json + vite define → use-hash-route/App/sidebar → chat-runtime.tsx → thread.tsx → `pnpm web:build`.
4. README.
5. Браузерная верификация chrome-devtools (короткими шагами, lesson-27): `vibelog browser` → new_page `#/chat` → отправить «создай задачу "тест VL-204"» → проверить событие approval и Allow → файл задачи появился; консоль без ошибок; list_network_requests: PATCH не нужен, POST /api/chat = 200 text/event-stream.

## Как проверить

```bash
pnpm build && pnpm test        # все тесты, включая src/web/chat.test.mjs
pnpm web:build                 # tsc -b && vite build (typecheck фронта)
pnpm lint                      # node --check bin
```

## Риски

- **API assistant-ui — быстрая итерация** (0.15.x, deprecated-сигналы в каждом релизе): держаться только `useLocalRuntime`/`AssistantRuntimeProvider`/примитивов и approval-gate семантики из local-runtime.mdx; при расхождении типов — сверять с backlog/references/data/assistant-ui (клон ref-22), не гадать.
- **Пауза approval между POST** — состояние живёт в jsonl; если LLM-вызов упал между append assistant(tool_calls) и resume — guard сирот закрывает (синтетический result при следующем message). Тест обязательно покрывает.
- **Двойной скролл/высота чата** внутри `<main class="overflow-y-auto">` — решается overflow-hidden для chat-роута + h-full (lesson-14).
- **Vite dev-прокси `/api` → 3030** — SSE через http-proxy проходит стримом (без буферизации) в dev; в прод (server.ts отдаёт сам) вопроса нет. Если dev замедлит — note в README, не блокер.
- **Множественные create_task в одном ходе** — модель получит approval только на первый; остальные tool_calls останутся без результата → при resume вставляются ВСЕ оставшиеся (второй create тоже уходит в approval-очередь одним событием-массивом). MVP: разрешить один create на ход (prompt-инструкция), guard сирот страхует.
- Нативных зависимостей не появляется (только React-пакеты) — требование Catalina/Node 20 соблюдено.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 01:10
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: feature. Масштаб: task. Приоритет: Medium. Уточнено: тип и приоритет, AC (3 проверяемых критерия: SSE endpoint + история в .vibelog/chat-sessions, страница #/chat с assistant-ui/адаптером/HITL Allow-Deny, тесты + Vite workaround). Labels: web, core, agent. References: ref-22 (assistant-ui, зарегистрирован). Вопросов нет.
---
author: @agent
created: 2026-10-27 03:02
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в задачу: 11 файлов (backend: новый src/web/chat.ts с runChat/SSE + правка src/web/server.ts для POST /api/chat event-stream; тест src/web/chat.test.mjs; frontend: package.json (+@assistant-ui/react), vite.config.ts (define process.env workaround), use-hash-route.ts, App.tsx, app-sidebar.tsx, новые chat-runtime.tsx и thread.tsx; README). Ключевые решения: useLocalRuntime + ChatModelAdapter вместо useChatRuntime (без Vercel AI SDK, ref-22 local-runtime.mdx); approval-gate хуман-ин-зе-луп Allow/Deny между двумя POST /api/chat, состояние в .vibelog/chat-sessions/<threadId>.jsonl; инструменты backlog_create_task/search/view через handleToolCall; guard сирот tool-результатов. AC добавлены (3 критерия из Spec). Риски: нестабильный API assistant-ui 0.15.x (сверка с клоном ref-22), пауза approval между запросами, двойной скролл чата. Проверки: pnpm build && pnpm test; pnpm web:build.
---
author: @agent
created: 2026-10-27 03:53
---
Фаза 3 (Code) выполнена. Изменено: src/web/chat.ts (новый: runChat SSE-генератор, LLM-цикл, approval-пауза, guard сирот, история в .vibelog/chat-sessions/), src/web/server.ts (ветка POST /api/chat → text/event-stream до handleApi), src/web/chat.test.mjs (новый: 11 тестов — дельты/tool loop/approval Allow+Deny/сироты/env/HTTP), web/src/components/chat/chat-runtime.tsx (новый: useLocalRuntime + ChatModelAdapter к SSE, resume approval из unstable_getMessage), web/src/components/chat/thread.tsx (новый: Thread-UI из примитивов, MarkdownView, карточка create_task с Allow/Deny), web/src/App.tsx (+ветка chat, overflow-hidden), web/src/lib/use-hash-route.ts (+route chat), web/src/components/layout/app-sidebar.tsx (+пункт «Чат»), web/vite.config.ts (define process.env — issue #3223), web/package.json + pnpm-lock (+@assistant-ui/react 0.15.31), web/dist (пересборка), README.md (раздел «Веб-чат (#/chat)»). Коммит 7f45f50. Проверки: pnpm build; pnpm test — 78 файлов/1394 теста зелёные (включая chat.test.mjs); pnpm web:build (tsc -b + vite, без ошибок); pnpm lint. Браузерная верификация chrome-devtools на живом сервере: #/chat рендерится, POST /api/chat = 200 text/event-stream (проверено по network), реальная LLM: approval-событие → клик «Разрешить» → resume POST → «Задача создана: VL-202» (smoke-файл удалён после проверки), история в .vibelog/chat-sessions/*.jsonl. Отмечены AC 1-3 и DoD 1-3 (все выполнены). Из мелочей: поправлены визуальный статус карточки («выполняется…» показывался вместе с «подтверждено») и name у textarea (a11y-warning консоли). Новых references не добавлял — использован ref-22 (клон assistant-ui). Новый lesson-59 (approval-gate семантика assistant-ui) связан. Осталось (не блокер): chunk >500КБ (vite warning, не регрессия — предупреждение), message branching/ветвление — вне MVP.
---
author: @agent
created: 2026-10-27 03:58
---
Фаза Close выполнена. Ветка vb/vl-204 слита в master (1 коммит 7f45f50, merge без конфликтов), worktree удалена, ветка удалена. После merge в главном репо: pnpm build и pnpm test — зелёные. DoD: 1) Тесты проходят — pnpm test после merge зелёный (78 файлов/1394 теста, включая chat.test.mjs); 2) Документация обновлена — README (раздел «Веб-чат», из Code), CHANGELOG.md (запись Unreleased VL-204), doc-6 (пункт «Чат» в сайдбаре), docs-коммит 86ad3cf; refs/lessons закоммичены отдельным коммитом a06b99b (ref-22, lesson-59). 3) Нет регрессий — сборка+тесты после merge чистые. Отмечены AC 1-3 и DoD 1-3.
---
<!-- COMMENTS:END -->