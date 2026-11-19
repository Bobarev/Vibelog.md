---
id: VL-431
title: 'Поздний interbot-ответ в веб-чат: дописка tool-результата в тред + авто-ход startChatRun'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 02:01'
updated_date: '2026-11-19 04:13'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/chat.ts
  - src/core/interbot/ask.ts
  - src/core/interbot/tickets.ts
  - src/bot/handlers.ts
  - web/src/components/chat/thread.tsx
  - src/web/chat-late-interbot.test.mjs
  - src/core/interbot/ask.test.mjs
  - src/bot/handlers.test.mjs
lessons:
  - lesson-298
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 117
  duration_ms: 3051857
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 56
    code:
      input: 0
      output: 0
      cache: 0
      requests: 39
    close:
      input: 0
      output: 0
      cache: 0
      requests: 22
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: аудит механизма interbot (VL-428/429/430) выявил, что запоздавший ответ interbot-канала из ВЕБ-ЧАТА никуда не доставляется: в src/web нет ни одного упоминания interbot/deliverLate, каналы deliverLateTicket — только комментарий к задаче (context.task) и Telegram-уведомление (admin_chat). Дописка «на потом» в JSONL без вызова модели бессмысленна — модель должна ПОЛУЧИТЬ данные, пусть с задержкой.

Архитектурное решение (обсуждено с пользователем):
- Отдельная провайдерская роль «tool_async» НЕВОЗМОЖНА — контракт LLM API фиксирован (system/user/assistant/tool), role:'tool' допустим только как ответ на assistant с tool_calls. Внутренняя маркировка в нашем JSONL возможна.
- Структура поздней доставки, валидная у всех провайдеров: в конец истории треда дописывается виртуальная пара assistant(tool_calls: [{id: async-<ticketId>, function: {name: interbot_ask, arguments: {}}}]) → tool(tool_call_id, content: <поздний ответ>). Старый закрытый tool_call_id не переиспользуется.
- Триггер: startChatRun (src/web/chat.ts:1129) — уже умеет in-process запустить LLM-ход в треде из бот-процесса, с guard параллельного хода через sidecar turn.json (паттерн chat-bridge.ts, который уже делает ровно это для /chat). Дописка без авто-хода — fallback до следующего события.
- Живое окно: авто-ход ставит run.status=running → фронт thread.tsx УЖЕ поллит историю в running; дырка только для вкладки в простое — нужен редкий фоновый refetch.

Цепочка реализации (4 точки):
1. src/web/chat.ts executeTool (строка ~1652, единая точка исполнения, threadId в замыкании): для name==='interbot_ask' подставлять thread_id треда и пробрасывать tool_call_id текущего хода — серверно, модель не участвует, схема args не меняется.
2. src/core/interbot/ask.ts parseAskArgs/interbotAsk: принимать thread_id/tool_call_id, писать в context тикета; без них — прежнее поведение (Telegram-only).
3. src/bot/handlers.ts deliverLateTicket: если t.context.thread_id — (а) дописать в .vibelog/chat-sessions/<threadId>.jsonl пару из п.2, (б) startChatRun со стимулом «поздний interbot-ответ доставлен — доведи до пользователя» (guard по turn.json как в chat-bridge), (в) markDelivered ПОСЛЕ успешной дописки; иначе — существующий путь (комментарий задачи + Telegram).
4. web/src/components/chat/thread.tsx: фоновый refetch истории, пока тред открыт (интервал ≤5 с, очистка при unmount/уходе).

РИСК: JSONL дописывается из бот-процесса при живом веб-сервере — append атомарен, sidecar turn.json уже общий (паттерн VL-408); конфликт двух процессов закрыт guard'ом параллельного хода.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 interbot_ask из веб-чата: executeTool подставляет thread_id треда и текущий tool_call_id (без участия модели, аргументы из схемы не меняются)
- [x] #2 parseAskArgs принимает thread_id/tool_call_id и кладёт их в context тикета; без них поведение прежнее (Telegram-only фолбэк)
- [x] #3 Поздний ответ (context.thread_id есть): deliverLateTicket дописывает в JSONL пару виртуальный assistant(tool_calls id=async-<ticketId> name=interbot_ask) → tool(tool_call_id, content) — провайдер-валидация структуры; затем startChatRun со стимулом (паттерн chat-bridge: turn.json, guard параллельного хода); markDelivered ПОСЛЕ дописки
- [x] #4 Авто-ход отвечает пользователю в треде; открытая вкладка обновляется существующим поллингом running; вкладка в простое — фоновый refetch (интервал ≤5 с, стоп при уходе со страницы)
- [x] #5 Если авто-ход невозможен (идёт ход/сбой) — дописка остаётся, ход догонит следующим событием; без thread_id — прежний путь (комментарий задачи + Telegram)
- [x] #6 Юнит-тесты: подстановка аргументов, структура дописки (role/tool_call_id/парность assistant→tool), deliverLateTicket с тредом (mock startChatRun); pnpm test зелёный
- [ ] #7 Живой сценарий: /ask из веб-чата → ответ позже синхронного окна → поздний ответ доставлен в тред авто-ходом
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-431 — поздний interbot-ответ в веб-чат

## Файлы для изменения

1. `src/web/chat.ts` — инъекция `thread_id`/`tool_call_id` в `executeTool` + новый экспорт-хелпер дописки пары.
2. `src/core/interbot/ask.ts` — `InterbotAskArgs`/`ParsedAsk`/`parseAskArgs`/`interbotAsk`: новые поля.
3. `src/core/interbot/tickets.ts` — тип `context` в `InterbotTicket` и параметре `createTicket`.
4. `src/bot/handlers.ts` — `deliverLateTicket`: ветка `thread_id` (дописка → авто-ход → `markDelivered`), тестовый шов `HandlerDeps.startChatRun`.
5. `web/src/components/chat/thread.tsx` — фоновый refetch истории при открытом треде (≤5 с).
6. Тесты: `src/core/interbot/ask.test.mjs`, `src/bot/handlers.test.mjs`, новый `src/web/chat-late-interbot.test.mjs`.
7. Документация: `doc-32` (раздел async-доставки; сверить актуальную структуру через `document_view` перед правкой).

Все перечисленные файлы существуют (проверено `ls`).

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `executeTool` — единая точка исполнения, `threadId` в замыкании `produce` | `src/web/chat.ts:1652`, вызов `handleToolCall` в `:1667` |
| 3 call-site'а `executeTool`: approval-resume (`target.id` есть), основной LLM-цикл (`tc.id` есть), хвост `advanceToNextApproval` | `src/web/chat.ts:1795`, `:2033`, сигнатура `execute` `:2636`, вызов `:2688` |
| `startChatRun` валидирует `threadId` по `THREAD_ID_RE`, джойнит живой прогон, не трогает историю без сообщения/approval/continue/retry/answer | `src/web/chat.ts:1129-1165` |
| Guard параллельного хода через sidecar: `readTurnState` + `STALE_RUN_IDLE_MS` (120 000 мс), паттерн chat-bridge | `src/bot/chat-bridge.ts:188-204`, `src/web/chat-runs.ts:99`, `:161` |
| `createChatRun` пишет `turn.json` (`status: running`) — общий признак для другого процесса | `src/web/chat-runs.ts:117-136` |
| Append в jsonl — `appendChatMessages` (private), файл `<cwd>/.vibelog/chat-sessions/<threadId>.jsonl` | `src/web/chat.ts:362-395` |
| `getChatThread` валидирует `THREAD_ID_RE` и наличие файла (path-traversal-защита) | `src/web/chat.ts:765-769` |
| Хвостовые неотвеченные `tool_calls` закрываются синтетикой только для последнего assistant | `src/web/chat.ts:786-814` (`closePendingToolCalls`), `:816` (`pendingToolCalls`) |
| `interbot_ask` — локального handler нет, идёт через MCP `handleToolCall` → `case 'interbot_ask' → interbotAsk` | `src/web/chat.ts:1667`, `src/mcp/tools.ts:1335-1336` |
| Схема args `interbot_ask` (question/channel/to/task/kind), менять её не нужно | `src/mcp/tools.ts:963-988` |
| `parseAskArgs`/`ParsedAsk`/`InterbotAskArgs`/`interbotAsk` — позиции расширения; контекст в `createTicket` сейчас `{task, kind}` | `src/core/interbot/ask.ts:38`, `:47`, `:60`, `:137`, блок context `:156-166` |
| `InterbotTicket.context: {task?, session?, kind?}`; `loadTickets` фильтрует только `id`/`status` — новые поля совместимы | `src/core/interbot/tickets.ts:29`, `:83`, `:89-95` |
| `markDelivered` переводит только `expired → delivered` | `src/core/interbot/tickets.ts:144-151` |
| `deliverLateTicket` (комментарий + Telegram + `markDelivered`) и 2 точки вызова: recovery на старте, ветка `expired` | `src/bot/handlers.ts:739-757`, `:766`, `:859-860` |
| `handlers.ts` уже импортирует `getChatThread` из `../web/chat.js` — мост в web-слой есть | `src/bot/handlers.ts:123` |
| `HandlerDeps` = `{cwd, getPin, trace?}` — тестовый шов под `startChatRun` добавляется сюда | `src/bot/handlers.ts:128-140` |
| `ChatDeps.llm` — подменный LLM для авто-хода в тестах | `src/web/chat.ts:349-351` |
| Форма пары: `ChatMessage` assistant `tool_calls: ToolCall{id,name,arguments}` / tool `tool_call_id, content`; wire-сборка через `toWireMessages` + санация `sanitizeWireMessages` (учитит валидную пару) | `src/agent/llm.ts:34-38`, `:66-80`, `:373-408`, `:413-416` |
| Фронт: `ThreadHistoryResponse.run` из `turn.json`; существующий поллинг «пока running» каждые 2 с с перезагрузкой истории | `web/src/components/chat/thread.tsx:80-104`, эффект `:1075-1099` |
| `interbot_ask` — write-инструмент (первый вызов в треде может уйти на approval — существующее поведение) | `src/core/tool-kinds.ts:100` |
| Статические тесты на содержимое `thread.tsx` — существующий паттерн | `src/web/chat-commands.test.mjs:627` |
| Тесты `deliverLateTicket` уже поллят статус тикета до `delivered` (void-async) — тот же приём для новой ветки | `src/bot/handlers.test.mjs:175-196` |
| Тест `interbot_ask` мокает `globalThis.fetch`, каталоги — mkdtemp — паттерн для новых тестов | `src/core/interbot/ask.test.mjs:4`, `:77-89` |

## Не проверено (предположения)

1. **Арбитр arity в тестах `advanceToNextApproval`**: подпись `execute` расширяется необязательным 3-м параметром `toolCallId`; JS-тесты, передающие свои заглушки `execute(name, args)`, совместимы по arity, но мок-тесты, ожидающие точный вызов `execute(tc.name, tc.arguments)` (spy), упадут на лишнем аргументе. Проверить: полный `pnpm test` после шага 1; при расхождении — обновить ожидания тестов, а не отказываться от параметра.
2. **Точка инъекции относительно guard'ов**: `thread_id`/`tool_call_id` подставляются строго ПОСЛЕ `toolGuard.check`, `checkGrant`, `personaDeniedAck` (иначе изменятся ключи дедупликации и grant-проверок). Проверить прогоном `src/web/*.test.mjs` (guard/dedup-тесты); при конфликте — инъектировать только в объект, уходящий в `handleToolCall`, не трогая `args` guard'ов.
3. **Хвост jsonl с pending `assistant(tool_calls)`** (approval-пауза другого хода) перед допиской виртуальной пары: без закрытия синтетикой провайдер отклонит payload (assistant→assistant без tool-результата). Проверить: перед допиской вызывать `closePendingToolCalls` (private, но хелпер дописки живёт в том же файле `chat.ts`); иначе фиксировать в отчёте как найденный кейс.
4. **Межпроцессная интерливинг-интерференция**: дописка из бот-процесса МОЖЕТ встать между `assistant` и `tool`-строками живого хода веб-сервера (окно = время исполнения инструментов). Проверить: перед допиской `readTurnState(cwd, threadId)`; при `running` — отложить дописку с poll'ом до завершения (потолок `STALE_RUN_IDLE_MS`), после — дописать и стартовать авто-ход; при истечении потолка — дописать всё равно (AC5: «дописка остаётся») и ограничиться guard'ом авто-хода. При расхождении с реальным поведением — решать в Code, зафиксировав в отчёте.
5. **Судьба Telegram/комментария при `thread_id`**: по ТЗ ветки взаимоисключающие; если append упадёт (IO-ошибка) — фолбэк на прежний путь (комментарий + Telegram) + `markDelivered`, чтобы ответ не потерялся. Проверить: тест с каталогом только на чтение / битым `chat-sessions`.
6. **Форма фонового refetch в `thread.tsx`**: точная механика (сравнение `messages.length`/`run.status` против полной перезагрузки; игнорирование при активном локальном стриме этой вкладки) — гипотеза. Проверить чтением состояний `load`/`runtimeRunning` в Code; при несовместимости с `setRetry`-паттерном (`:1088-1089`) — адаптировать, сохранив AC (≤5 с, стоп при unmount/уходе).
7. **Структура doc-32/doc-33 сейчас** — не читалась в Plan (экономия ходов): перед правкой вызвать `document_view doc-32`, править точечно `document_edit`.

Предположений нет в части: формат пары, позиции всех call-site'ов, контракт `startChatRun`/`turn.json`/`markDelivered` — подтверждены чтением (таблица выше).

## Порядок действий

### Шаг 1 — `src/web/chat.ts`: инъекция аргументов (AC1)

- Расширить сигнатуру `executeTool` (`:1652`) до `(name, args, toolCallId?: string)`.
- Перед `local/handleToolCall` (`:1667`) добавить: при `name === 'interbot_ask'` → `args = { ...args, thread_id: threadId, tool_call_id: toolCallId }` (серверно; модель и схема не участвуют). Инъекция — после всех guard'ов (предположение 2).
- Прокинуть `toolCallId` во все 3 call-site: `:1795` (`target.id`), `:2033` (`tc.id`), `advanceToNextApproval` — сигнатура `execute` `:2636` + вызов `:2688` (`tc.id`).
- Вынести чистую функцию `interbotThreadArgs(name, args, threadId, toolCallId)` (export) — юнит-тестируемая подстановка без запуска хода.

### Шаг 2 — `src/core/interbot/ask.ts` + `tickets.ts` (AC2)

- `InterbotAskArgs` (`:38`): `thread_id?: unknown; tool_call_id?: unknown`.
- `parseAskArgs` (`:60`): разобрать как `str()` (та же семантика «нет/пусто → undefined»).
- `ParsedAsk` (`:47`): оба поля опциональны.
- `interbotAsk` (`:137`): в блок `context` createTicket (`:156-166`) добавить `thread_id`/`tool_call_id`, если есть; без них — прежнее поведение (Telegram-only фолбэк, текст таймаута не менять без нужды).
- `tickets.ts`: `context: {task?, session?, kind?, thread_id?, tool_call_id?}` в `InterbotTicket` (`:29`) и параметре `createTicket` (`:83`).

### Шаг 3 — дописка + авто-ход (AC3, AC5)

- `src/web/chat.ts`, новый экспорт рядом с `appendChatMessages` (`:389`):
  `appendLateInterbotPair(cwd, threadId, ticketId, text): boolean`:
  1. валидация: `getChatThread(cwd, threadId) !== null` (иначе false), `ticketId` непустой (lesson-74 — валидация id/name до записи);
  2. закрыть pending-хвост: `closePendingToolCalls(history)` + дописать синтетику в файл (предположение 3);
  3. одна записью `appendChatMessages` — пара `[{role:'assistant', content:null, tool_calls:[{id:'async-<ticketId>', name:'interbot_ask', arguments:{}}]}, {role:'tool', tool_call_id:'async-<ticketId>', content:text}]` (парность assistant→tool одной пачкой, провайдер-валидна);
  4. возврат true/false.
- `src/bot/handlers.ts` `deliverLateTicket` (`:739`):
  - если `t.context.thread_id`:
    - guard живого хода: `readTurnState` → `running` → отложить дописку poll'ом до finish (потолок `STALE_RUN_IDLE_MS`, предположение 4);
    - `appendLateInterbotPair(...)` → при false/исключении — прежний путь (комментарий задачи + Telegram) + `markDelivered`;
    - при успехе: `startChatRun({ threadId, message: 'Поздний interbot-ответ из interbot-канала «<channel>» (тикет <id>) доставлен — доведи его до пользователя' }, cwd)`; авто-ход форкнуть `void` + `try/catch` с логом — при сбое/идущем ходе дописка уже в jsonl, ход догонит следующее событие (AC5);
    - **`markDelivered` строго после успешной дописки**;
    - Telegram/комментарий в этой ветке НЕ шлём (ветки взаимоисключающие, ТЗ п.3);
  - иначе — существующий путь без изменений.
  - `HandlerDeps` (`:128`): опциональный шов `startChatRun?: typeof startChatRun` (по умолчанию реальный импорт) — для тестов; сюда же при необходимости пробросить `ChatDeps` (тесты подменяют `llm`).
  - импорт `startChatRun`, `readTurnState`, `STALE_RUN_IDLE_MS`, `appendLateInterbotPair` — из `../web/chat.js` / `../web/chat-runs.js` (паттерн `chat-bridge.ts:9-31`).

### Шаг 4 — `web/src/components/chat/thread.tsx`: фоновый refetch (AC4)

- Новый `React.useEffect` рядом с существующим поллингом (`:1075`): пока `load.status === "ready"` и тред открыт — `setInterval` **5000 мс**: `fetch('/api/chat/threads/<id>')`; если `messages.length` вырос / `run.status` сменился → `loadedRef.current = undefined; setRetry(r => r + 1)` (переиспользовать паттерн `:1088-1089`); при активном локальном стриме — не дёргать (сверить с `runtimeRunning`).
- Очистка в return эффекта: `clearInterval` + флаг `cancelled` (стоп при unmount/уходе со страницы).
- Существующий 2 с-поллинг `running` не трогать.

### Шаг 5 — тесты (AC1-AC6)

- `src/web/chat-late-interbot.test.mjs` (новый):
  - `interbotThreadArgs`: подстановка только для `interbot_ask`; для прочих имён args не меняется; отсутствие `toolCallId` → только `thread_id`;
  - структура дописки: роли/парность (assistant с непустым `tool_calls[0].id='async-…'` → tool с тем же `tool_call_id`), `appendLateInterbotPair` на mkdtemp-треде; `closePendingToolCalls`-ветка (pending в хвосте закрыт синтетикой до пары); `sanitizeWireMessages` из `dist/agent/llm.js` пропускает историю без потерь;
  - `getChatThread === null` (несуществующий/невалидный threadId) → false, файл не создан.
- `src/core/interbot/ask.test.mjs`: `parseAskArgs` с `thread_id`/`tool_call_id` (и без них); тикет получает контекст (мок fetch по существующему паттерну `:77-89`).
- `src/bot/handlers.test.mjs`: тикет с `context.thread_id` + созданный тред → jsonl дописана пара, шов `startChatRun` вызван с `{threadId, message}` (mock), статус `delivered`; тикет БЕЗ `thread_id` → прежний путь (регресс AC2). Поллинг статуса — по паттерну `:181-186`.
- `thread.tsx`: статический тест по паттерну `src/web/chat-commands.test.mjs:627` (наличие эффекта refetch, интервал ≤5000, `clearInterval` в cleanup).
- Запуск: `pnpm build && pnpm test` — **полный** прогон (DoD).

### Шаг 6 — документация (AC7/DoD)

- `document_view doc-32` → точечный `document_edit`: в раздел async-доставки дописать ветку `thread_id` (дописка в веб-тред + авто-ход, markDelivered после дописки; без `thread_id` — прежний путь).
- Живой сценарий AC7 (`/ask` из веб-чата → поздний ответ → доставка авто-ходом) — ручная/e2e-проверка в Code/Close: требует настроенного `comms.yaml` и доступного канала; в отчёте фиксировать способ проверки.

## Как проверить

```bash
pnpm build && pnpm test        # полный прогон — единственный основной DoD-фильтр
```

Точечно до полного: `pnpm test:fast -- src/web/chat-late-interbot.test.mjs src/core/interbot/ask.test.mjs src/bot/handlers.test.mjs` — только как быстрый фильтр перед полным, НЕ как замена.

## Риски

1. **Межпроцессный append при живом ходе** (осн. риск ТЗ): закрыт guard'ом `turn.json` + отложкой дописки (предположение 4); остаточный узкий оконный интерливинг — принят, как и в VL-408.
2. **Авто-ход в бот-процессе без гарантии LLM**: сбой не критичен — дописка уже в jsonl, догонит следующее событие (AC5); `markDelivered` от успеха дописки, не от успеха хода.
3. **Approval-гейт первого `interbot_ask`** в треде — существующее поведение write-инструмента, вне скоупа.
4. **Стат-тесты на `thread.tsx`/`execute`-аргументы** могут упасть на новых сигнатурах — правка ожиданий тестов, не функционала.
5. Поздний ответ может прийти через часы (после рестарта бота) — recovery на старте (`handlers.ts:766`) уже проходит по `deliverLateTicket`, новая ветка отработает и там автоматически.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 03:21
---
Фаза plan прервана остановкой процесса — статус возвращён к Spec.
---
author: @agent
created: 2026-11-19 03:22
---
Фаза 2 (Plan) выполнена. Тип: обычная задача (не epic) — план записан в Implementation Plan. Охвачено 7 файлов (chat.ts, ask.ts, tickets.ts, handlers.ts, thread.tsx, 2 тестовых + doc-32): инъекция thread_id/tool_call_id в executeTool (3 call-site подтверждены чтением), расширение parseAskArgs/контекста тикета, ветка deliverLateTicket «дописка пары async-<ticketId> → guard turn.json → авто-ход startChatRun → markDelivered после дописки», фоновый refetch ≤5 с в thread.tsx. Разделы «Проверено по коду» (19 строк с file:line) и «Не проверено (предположения)» (7 пунктов) заполнены. Риски: межпроцессный append при живом ходе (закрывается guard'ом turn.json + отложкой дописки, потолок STALE_RUN_IDLE_MS), сбой авто-хода не критичен (дописка остаётся, ход догонит следующее событие), возможные падения стат-тестов на новых сигнатурах. AC отмечены как покрытыте планом (реализация — в Code).
---
author: @agent
created: 2026-11-19 03:53
---
Фаза 3 (Code) выполнена. Изменено: src/web/chat.ts, src/core/interbot/ask.ts, src/core/interbot/tickets.ts, src/bot/handlers.ts, web/src/components/chat/thread.tsx, src/web/chat-late-interbot.test.mjs (новый), src/core/interbot/ask.test.mjs, src/bot/handlers.test.mjs; коммит 7661c6e.
Реализация по плану (4 точки):
1) executeTool(name, args, toolCallId) — чистая interbotThreadArgs подставляет thread_id/tc.id в interbot_ask ПОСЛЕ guard'ов (дедуп/grant/роль считают args модели как есть); 3 call-site прокинуты (approval-resume, LLM-цикл, advanceToNextApproval).
2) parseAskArgs/ParsedAsk/InterbotAskArgs — thread_id/tool_call_id через str(); interbotAsk пишет их в context createTicket; tickets.ts — тип context расширен; без полей — прежнее поведение.
3) appendLateInterbotPair в chat.ts: валидация треда (getChatThread) + пустого ticketId (lesson-74), закрытие pending-хвоста closePendingToolCalls до дописки, пара assistant(async-<id>, interbot_ask, arguments:{}) → tool пишется ОДНОЙ append-записью. deliverLateToThread: guard живого turn.json с poll-отложкой до STALE_RUN_IDLE_MS → append → markDelivered ПОСЛЕ успешной дописки → guard авто-хода → startChatRun со стимулом (шов HandlerDeps.startChatRun для тестов); при сбое дописки/нет треда — прежний путь (комментарий + Telegram) целиком.
4) thread.tsx: фоновый refetch 5000 мс (рост messages.length → setRetry-паттерн), пропуск при активном локальном стриме, clearInterval при unmount.
Проверки: pnpm build зелёный; 3 полных прогона pnpm test; точечно зелёны chat-late-interbot (7), ask.test (16), handlers.test (14). Флаки: полный прогон падал 3 раза РАЗНЫМИ файлами — src/core/report.test.mjs (×2, assert process.exitCode) и src/web/orchestrator.test.mjs (×1, строка 1435) — оба зелёны изолированными прогонами (27 и 116 тестов), к диффу VL-431 отношения не имеют (параллельный vitest, fileParallelism). Исключённых тест-файлов нет — прогоны полные, без --exclude/--skip.
Документация: doc-32 (раздел «Исходящее: sync/async-fallback») — ветка web-чата VL-431 описана точечным document_edit.
Не отмечено: AC6 (pnpm test не стопроцентно зелёный из-за флаков выше — юнит-тесты задачи зелёны), AC7 (живой сценарий /ask вживую не прогонялся — требует настроенного comms.yaml и внешнего канала; способ проверки: из веб-чата вызвать interbot_ask, ответить после 55 с, увидеть пару и авто-ход в треде), DoD1 (по той же причине флаков). DoD2 (doc-32) и DoD3 (нет регрессий: падения только в нетронутых файлах, изолированно зелёные) отмечены.
---
author: @agent
created: 2026-11-19 04:12
---
Фаза Close выполнена. Статус: Done.
Коммиты: feat 7661c6e (код задачи — из Фазы Code), docs 6c02299 (CHANGELOG.md — запись VL-431 в Unreleased; doc-32 — ветка веб-чата в разделе async-fallback; в файле также ушли ранее внесённые соседней фазей строки VL-433 — гонки не было: ps пуст, mtime файла предшествует рану), docs(task) 173d631 (lesson-298).
Проверки: отдельной сборки Close не делал — первая и единственная за фазу внутри pnpm test, зелёная (diff этой фазы — только CHANGELOG.md и backlog/docs, но diff задачи затрагивал src/). Ранний фильтр `pnpm test:fast -- <3 файла>` по факту прогнал весь набор (аргументы выборку не сузили): 239 файлов / 4565 passed / 4 skipped — зелёный. Полный `pnpm test`: 1-й прогон — флак (2 файла, в т.ч. src/mcp/decision-tools.test.mjs; EnvironmentTeardownError «Closing rpc while onUserConsoleLog was pending»). Классификация: дифф между зелёным прогоном и падением — только CHANGELOG.md/backlog/docs (src с зелёного прогона не менялся), падающие файлы вне диффа VL-431, параллельных vitest/qwen-ранов в системе нет (ps пуст), тот же паттерн «разные файлы на разных прогонах» был в Code (report/orchestrator, изолированно зелёные). Повтор с причиной — зелёный (build && vitest run --exclude src/web/static.test.mjs && vitest run src/web/static.test.mjs, exit 0). Исключённых тест-файлов нет: static.test.mjs — штатный второй этап скрипта pnpm test, прогнан отдельно и зелёный.
DoD отмечены: 1 — тесты проходят (полный pnpm test зелёный после классификации флака), 2 — документация (doc-32 точечно в Code, CHANGELOG в Close), 3 — нет регрессий (падения только нетронутых файлов, изолированные/повторные зелёные). AC6 отмечен по зелёному полному прогону. AC7 (живой сценарий) не выполнен и остаётся открытым: требует настроенного comms.yaml и доступного внешнего interbot-канала; способ проверки зафиксирован — из веб-чата вызвать interbot_ask, ответить позже 55 с, увидеть дописанную пару и авто-ход в треде.
Урок: lesson-298 (создан, связан с задачей). Не закоммичено: нет — подзадач и refs у задачи нет, файл задачи VL-431 коммитит framework после записи token_usage.
---
<!-- COMMENTS:END -->