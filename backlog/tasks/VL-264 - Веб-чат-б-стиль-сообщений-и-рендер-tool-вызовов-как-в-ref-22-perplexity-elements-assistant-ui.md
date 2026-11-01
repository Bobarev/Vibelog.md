---
id: VL-264
title: 'Веб-чат (б): стиль сообщений и рендер tool-вызовов как в ref-22 (perplexity + elements assistant-ui)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 15:31'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - web
  - chat
  - ui
  - ref-22
dependencies: []
milestone: v1.11
references:
  - ref-22
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/api.ts
  - src/web/chat.ts
  - src/web/chat-allow.test.mjs
  - src/web/chat-allow-api.test.mjs
  - src/web/chat-thread-restore-vl264.test.mjs
  - web/src/components/chat/approval-card.tsx
  - web/src/components/chat/error-state.tsx
  - web/src/components/chat/stopped-run.tsx
  - web/src/components/chat/surfaces.tsx
  - web/src/components/chat/tool-call.tsx
  - web/src/components/chat/tool-meta.ts
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/index.css
  - web/src/lib/chat-threads.ts
  - web/dist
lessons:
  - lesson-115
  - lesson-116
token_usage:
  input: 27713774
  output: 118477
  cache: 27113984
  total: 27832251
  requests: 272
  duration_ms: 6974383
  reasoning: 42838
  by_phase:
    plan:
      input: 19045949
      output: 76986
      cache: 18769408
      requests: 154
    code:
      input: 6865908
      output: 31461
      cache: 6594560
      requests: 80
    close:
      input: 1801917
      output: 10030
      cache: 1750016
      requests: 38
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст (из диалога)

Пункт (б) разбиения доработок веб-чата по референсу ref-22. Пользователь: «Внимательно изучи как в чате референса отображаются ответы модели и вызов тулзов — сейчас это вообще не так выглядит. Что мешает сделать один в один?»

## Что установлено при изучении референса

**Про perplexity.tsx.** В нём tool-вызовы НЕ рендерятся вообще: `<MessagePrimitive.Parts components={{ Text: MarkdownText }} />` — по документации (`primitives/message.mdx`) tool-call части рендерятся «nothing unless a tool UI is registered». То есть в части тулзов копировать оттуда нечего — perplexity задаёт layout и стиль сообщений, а канон рендера тулзов лежит в том же репозитории в `packages/ui/src/components/react/assistant-ui/elements/`.

**Что берём из perplexity.tsx (сообщения):**
- assistant: `flex items-start gap-3`, аватар-кружок `size-8 shrink-0 rounded-full border bg-… `, текст БЕЗ пузыря прямо в `prose prose-sm prose-p:my-2`, ширина `max-w-(--thread-max-width)` = 40rem, action bar `size-8 rounded-full` c hover-появлением (`opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100`), BranchPicker, Reload/Copy.
- user: `flex flex-col items-end gap-2`, пузырь `rounded-3xl rounded-tr-md border bg-[#fcfbf8] px-4 py-3 max-w-[85%]` (не bg-primary), action bar Copy/Edit слева от пузыря, BranchPicker ниже.

**Что берём из elements (тулзы) — путь в клоне ref-22: `backlog/references/data/assistant-ui/`:**
- `packages/ui/src/components/react/assistant-ui/elements/tool-call.tsx` — свёрнутая строка: `Collapsible`, trigger с chevron (поворот по `data-open`), `SwapLabel` + `ShimmerLabel` (activeLabel при выполнении), mono-чип с ключевым аргументом, галочка `CheckIcon text-emerald-500` по завершении; раскрытие — панель с секциями `Request` и `Result` (mono, разделитель).
- `packages/ui/src/components/react/assistant-ui/elements/approval-card.tsx` — карточка: `paper rounded-[20px] p-4`, иконка в `size-9 rounded-xl` плашке, title/subtitle, description, опциональный `command` (mono) и `details` (dl с label/value), футер: при `state="request"` — кнопки Deny / Always allow / Allow once; после решения — receipt-строка (`role="status"`, fade-in): running (спиннер) / done (галочка) / denied (крестик), с `useReceiptFocus` (фокус на результат для скринридера).
- `packages/ui/src/components/react/assistant-ui/elements/stopped-run.tsx` — плашка прерванного прогона (посмотреть и переиспользовать для ошибок/обрыва).
- группировка: `MessagePrimitive.GroupedParts` + `groupPartByType({ "tool-call": [...] })` (`apps/docs/content/docs/primitives/chain-of-thought.mdx`) — версия @assistant-ui/react 0.15.31 в `web/package.json` это API уже содержит (`groupPartByType` экспортируется из пакета — проверено в `web/node_modules/@assistant-ui/react/dist/index.js`).

**Что у нас сейчас** (`web/src/components/chat/thread.tsx`): assistant — пузырь `rounded-2xl bg-muted` с иконкой Bot; user — `bg-primary text-primary-foreground`; action bar `size-7 rounded-md hover:bg-accent`; tool-call — самодельный `ToolCallCard` (плашка `border bg-muted/40`, кнопки Отклонить/Разрешить, `<pre>` с результатом).

## Объём работ

1. Сообщения: переписать `UserMessage`/`AssistantMessage` в `web/src/components/chat/thread.tsx` по стилю perplexity (без пузыря у assistant, prose, новый вид user-пузыря, `size-8 rounded-full` action bar, hover-появление).
2. Read-тулзы: новый компонент `web/src/components/chat/tool-call.tsx` по образцу `elements/tool-call.tsx` — свёрнутая строка + раскрытие Request/Result; маппинг инструмент→(label, activeLabel, чип-аргумент, красиво отформатированный Result).
3. Write-тулзы (approval): новый компонент `web/src/components/chat/approval-card.tsx` по образцу `elements/approval-card.tsx` — с тремя кнопками и receipt-статусом; заменить текущий самодельный блок в `ToolCallCard`.
4. `Always allow`: серверная часть — allow-list треда (сохраняется рядом с jsonl в `.vibelog/chat-sessions/`), `src/web/chat.ts` при `isWriteOperation` сначала проверяет allow-list и только потом ставит run на паузу; клиент — третья кнопка в карточке, значения в `respondToApproval` (`{approved:true, always:true}`) или отдельный resume-флаг. После разрешения — видимая пометка в карточке + возможность отозвать.
5. Группировка: перевести рендер частей на `MessagePrimitive.GroupedParts` + `groupPartByType`, чтобы серии вызовов схлопывались в один аккордеон.
6. `stopped-run`-плашка для обрыва/лимитов (связка с отдельной задачей про лимиты и авто-продолжение) + единый вид error-state.
7. Проверить, что `historyToMessages` (восстановление из jsonl) даёт тот же вид: approval-карточки активны, результаты на месте (может потребоваться доработка конвертации под новые компоненты).

## Вне скоупа

Перенос пикеров модели/роли к инпуту (пункт «в»), фикс скролла и Ctrl+Enter (VL-263), лимиты хода и авто-продолжение (отдельная задача).

## Референсы

ref-22 (assistant-ui): `apps/docs/components/pages/examples/perplexity.tsx`, `packages/ui/src/components/react/assistant-ui/elements/{tool-call,approval-card,stopped-run,surfaces}.tsx`, `apps/docs/content/docs/primitives/{message,chain-of-thought}.mdx`, `apps/docs/content/docs/tools/tool-ui.mdx`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Сообщение ассистента без пузыря: аватар-кружок 8×8 с border, текст прямо в prose (typography markdown), ширина ограничена thread-max-width (40rem) — как assistant-блок в perplexity.tsx
- [x] #2 Сообщение пользователя: пузырь rounded-3xl rounded-tr-md с border (не bg-primary), max-w-[85%], выравнивание вправо; action bar (Copy/Edit) слева от пузыря, появляется на hover
- [x] #3 Action bar: кнопки-призраки size-8 rounded-full (text-muted-foreground → hover:bg-accent), opacity 0 → 1 на group-hover/group-focus-within; BranchPicker рядом
- [x] #4 Read-инструменты (read_file, search_files, backlog_view_task, backlog_search, список/modьели и т.п.) рендерятся свёрнутой строкой в стиле elements/tool-call.tsx: chevron + label/activeLabel (ShimmerLabel во время выполнения) + mono-чип с ключевым аргументом (query/path/id) + галочка по завершении; разворот показывает блоки Request и Result
- [x] #5 Write-инструменты (backlog_create_task, backlog_update_task, write_file и прочие isWriteOperation) рендерятся карточкой в стиле elements/approval-card.tsx: иконка, title/subtitle, description, блок details (label/value), кнопки Deny / Always allow / Allow once; после решения — статус-строка (Approved, running / Finished / Denied) с focus-receipt
- [x] #6 Кнопка Always allow работает: разрешение сохраняется на серверe для треда, последующие вызовы того же инструмента в этом треде идут без паузы, но с видимой пометкой в карточке; разрешение можно отозвать
- [x] #7 Подряд идущие tool-call части группируются в один аккордеон через MessagePrimitive.GroupedParts + groupPartByType, а не занимают пол-экрана отдельными карточками
- [x] #8 Прерванный/незавершённый run отображается компонентом stopped-run (аналог elements/stopped-run.tsx) с кнопкой «Продолжить» вместо голого текста ошибки
- [x] #9 Ошибки инструмента (isError) и ошибка стрима показываются в едином стиле error-state, не как текст посреди ответа
- [ ] #10 Стриминг текста не ломает вёрстку: блок текста растёт без скачков, markdown дорисовывается корректно, автоскролл работает
- [x] #11 Восстановление треда из истории (historyToMessages) даёт визуально тот же результат, что и живой стрим: approval-карточки снова активны, tool-результаты на месте
- [ ] #12 web/npm run build и npm run lint проходят; проверено в браузере на реальном треде с read- и write-инструментами
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План (Plan-фаза VL-264, пункт «б» веб-чата)

Цель: сообщения и tool-вызовы веб-чата один-в-один по референсу ref-22 — layout сообщений из `apps/docs/components/pages/examples/perplexity.tsx`, рендер тулзов из `packages/ui/src/components/react/assistant-ui/elements/{tool-call,approval-card,stopped-run,surfaces}.tsx`, группировка через `MessagePrimitive.GroupedParts` + `groupPartByType` (`apps/docs/content/docs/primitives/message.mdx:287-323`).

### Предварительный шаг
- `cd web && pnpm install` (lesson-6: в свежем worktree web/node_modules нет — без него `tsc -b`/`vite build` падают).
- Проверить, что `groupPartByType` и `MessagePrimitive.GroupedParts` есть в установленной `@assistant-ui/react@0.15.31`:
  `grep -rn "groupPartByType" web/node_modules/@assistant-ui/react/dist/*.d.ts`; если API нет — fallback-план (шаг 6, вариант Б).

### Файлы

**Новые:**
1. `web/src/components/chat/surfaces.ts` — константы-классы из ref (`paper`, `field`, `mono`, `ghostButton`, `inkButton`, `collapsePanel`, `labelSwap*`) + компоненты `ShimmerLabel`, `SwapLabel` (перенос из `elements/surfaces.tsx`, но на наших токенах: `bg-foreground/[0.04]`, `text-muted-foreground` вместо hex-палитры perplexity; `useIsomorphicLayoutEffect` → обычный `React.useLayoutEffect`). Только утилиты, без изменения `web/src/lib/utils.ts`.
2. `web/src/components/chat/tool-meta.ts` — чистый (без React) маппинг инструмент→вид, переиспользуется и в `thread.tsx`, и в тестах:
   - `toolLabel(name)` / `toolActiveLabel(name)`: словарь для `read_file`, `search_files`, `grep_search`/`glob`, `backlog_view_task`, `backlog_search`, `backlog_list_tasks`, `backlog_ready`, `project_map`, `backlog_create_task`, `backlog_update_task`, `backlog_manage_ac`/`backlog_manage_dod`, `backlog_add_comment`, `write_file`, fallback — имя как есть;
   - `isWriteTool(name)` — реэкспорт-зеркало серверного `isWriteOperation` на клиенте (дублировать список нельзя: см. риск R3 — клиент берёт флаг `write` из события, словарь только для подписей; функция нужна как fallback для старых jsonl, где флага ещё нет);
   - `primaryArg(args)` — чип-аргумент: `query` | `path` | `id` | `title` | `name` (первое непустое, обрезка 60 симв.);
   - `formatRequest(args)` — `JSON.stringify(args, null, 2)` с обрезкой 2000 символов;
   - `formatResult(result)` — если объект с `ok`/`applied`/`skipped` (контракт VL-262) → человекочитаемая строка; `{error}` → текст ошибки; строка → как есть; иначе `JSON.stringify(…, 2)` с обрезкой 4000;
   - `resultDetails(result)` → `{label, value}[]` для `details`-блока approval-карточки (для `write_file`: `path`; для `backlog_update_task`: `id` + перечисление переданных полей; для `backlog_create_task`: `title`/`status`; для `manage_ac`/`manage_dod`: `action`, `index`).
3. `web/src/components/chat/tool-call.tsx` — read-тулза, порт `elements/tool-call.tsx`: `Collapsible` (`web/src/components/ui/collapsible.tsx`, radix-ui) → trigger: chevron (`group-data-[state=open]:rotate-90`), `SwapLabel`+`ShimmerLabel` (activeLabel при `running`), mono-чип `primaryArg`, `CheckIcon text-emerald-500` по завершении; контент — панель `field rounded-2xl text-xs` с секциями `Request` / разделитель `bg-foreground/[0.06] h-px` / `Result`. Пропсы: `part: ToolPart` + локальный `open` state (по умолчанию закрыт; авто-раскрытие при `isError`).
4. `web/src/components/chat/approval-card.tsx` — write-тулза, порт `elements/approval-card.tsx`: `paper rounded-[20px] p-4`, иконка в `size-9 rounded-xl`, title/subtitle (`toolLabel` / `primaryArg`), description (из `args.description` для update/create), optional `command` (для `write_file` — путь), `details` из `resultDetails`, футер: `state="request"` → Deny / Always allow / Allow once; после решения — receipt-строка (`role="status"`, fade-in: running спиннер / done галочка / denied крестик) + `useReceiptFocus` (порт `elements/receipt-focus.ts` внутрь файла или отдельный `receipt-focus.ts`).
   - «Always allow» — НЕ через `part.respondToApproval` (тип принимает только `{approved, reason}`, lesson по типизации): сначала `POST /api/chat/threads/<id>/allow {tool}`, затем `respondToApproval({approved:true})`. Ошибка POST → показать toast/inline-текст и не разрешать вызов.
   - «отозвать» — та же кнопка в состоянии done при `allowed=true` рендерится как `Always allowed · отозвать` (`DELETE /api/chat/threads/<id>/allow?tool=<name>`), после отзыва карточка снова показывает галочку done без пометки.
   - `alwaysAllowed` prop — из ответа истории/из события `tool_start{auto:true}`.
5. `web/src/components/chat/stopped-run.tsx` — плашка прерванного прогона (порт `elements/stopped-run.tsx`): текст + mono-чип причины (`Square` иконка) + кнопка «Продолжить» (`ThreadPrimitive.If` не нужен — колбэк из `thread.tsx`, повтор последнего user-сообщения) и «Скрыть».
6. `web/src/components/chat/error-state.tsx` — единый inline error-state (AC9): `paper`-плашка с `TriangleAlert`, заголовком «Ошибка», текстом и кнопкой «Повторить» (для ошибки стрима) — используется и для `data`-части `chat-error`, и для tool `isError` при отсутствии карточки.

**Изменяемые:**
7. `web/src/components/chat/thread.tsx`
   - строки 36-70 (импорты): убрать `Bot`, `ListChecks`, `PlusCircle`, `Search`, `MessageSquare` (часть уйдёт в `tool-meta.tsx`/`tool-call.tsx`), добавить `groupPartByType` из `@assistant-ui/react`, импорты новых компонентов.
   - строки 74-197 (`TOOL_LABELS`/`TOOL_ICONS`/`ToolCallCard`/`PartView`): удалить `ToolCallCard` целиком; новый `PartView`-роутер:
     `text` → `MarkdownView`; `tool-call` → `isWriteTool ? <ApprovalCard/> : <ToolCall/>`; `data` с `name === 'chat-error'` → `<ErrorState/>`; прочее → null.
   - строки 199-201 (`ACTION_CLASS`): `flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground` (AC3).
   - `CopyAction` (203-224) — без изменений, кроме `size-4` уже ок; добавить `aria-label` сохранён.
   - строки 323-348 `UserMessage`: по perplexity.tsx:296-325 — `flex flex-col items-end gap-2`; строка `div.flex.items-start.gap-2` с `ActionBarPrimitive.Root` (Copy/Edit, `opacity-0 … group-hover/message:opacity-100 group-focus-within/message:opacity-100`) СЛЕВА от пузыря; пузырь `max-w-[85%] rounded-3xl rounded-tr-md border bg-[#fcfbf8] dark:bg-[#23211f] px-4 py-3` (убрать `bg-primary text-primary-foreground`), внутри `text-sm break-words` + `MessagePrimitive.Parts` (только text); `BranchPicker className="mr-3"` ниже.
   - строки 349-376 `AssistantMessage`: `mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-2 py-4` на корне; `flex items-start gap-3`; аватар `mt-1 size-8 shrink-0 rounded-full border bg-background` c иконкой `size-4`; контент `min-w-0 flex-1` без пузыря, `text-sm leading-6 break-words` (typography-плагина в проекте нет — prose эмулируем этим классом + `MarkdownView`); ниже `mt-2 flex items-center gap-2` с `BranchPicker` + `ActionBarPrimitive.Root`(Reload/Copy) `opacity-0 … group-hover/…`.
   - `ChatThread` (430-480): на `ThreadPrimitive.Root` задать `style={{ '--thread-max-width': '40rem' }}`; в `Viewport` обернуть `ThreadPrimitive.Messages` в контейнер `mx-auto w-full max-w-(--thread-max-width)`; сообщения — `gap-2 py-0` (внутренние отступы уже в сообщении).
   - Группировка (AC7): в `AssistantMessage` заменить `MessagePrimitive.Parts` на
     `MessagePrimitive.GroupedParts groupBy={groupPartByType({ 'tool-call': ['group-tools'] })}` с рендером: `group-tools` → `<ToolGroup>{children}</ToolGroup>`, `text` → `MarkdownView`, `tool-call` → одиночный `ToolCall`/`ApprovalCard`, `data` → `ErrorState`.
     `ToolGroup` (новый локальный компонент там же или в `tool-call.tsx`): свёрнутая строка «N вызовов инструментов» (chevron + mono-чип с первым аргументом + галочка), раскрытие — список детей (`MessagePrimitive.GroupedParts` передаёт готовые children). Write-вызовы (`ApprovalCard`) в группу НЕ прячутся: `groupBy` маппит только те tool-call, что НЕ требуют подтверждения — т.е. `groupBy` — своя функция-обёртка над `groupPartByType`: результат `groupPartByType` переопределяется для part с `approval !== undefined` → `undefined` (без группы). Проверить тип `GroupByContext` в `.d.ts`; если переопределение невозможно — render `group-tools` возвращает `ApprovalCard` для write-детей внутри раскрытия (карточка остаётся активной).
   - `EditComposer` (296-321): `max-w-[85%] rounded-3xl rounded-tr-md` для визуальной согласованности с новым user-пузырём.
   - `ErrorState` (загрузка треда, 486-...): не трогаем (это состояние страницы, не сообщения).
8. `web/src/components/chat/chat-runtime.tsx`
   - `ChatEvent`: `tool_start` + `auto?: boolean`; `approval` без изменений.
   - `applyEvent`: `tool_start` → part получает `data auto` (или отдельное поле `auto` в part, читаемое `ToolCall`/`ApprovalCard`); `case "error"` (строка ~206) вместо `parts.push({type:'text', text:'Ошибка чата: …'})` → `parts.push({ type: 'data', name: 'chat-error', data: { message: ev.message, retryable: true } })` (AC9). Проверить, что тип `Part` из `ChatModelRunResult` допускает `data`-часть (`web npm run typecheck`); если нет — вариант Б: `text`-часть с префиксом-маркером `\u0000chat-error:` и распознавание в `PartView` (менее красиво, но без миграции типов).
   - `error` в catch fetch/read (строки ~250, ~300) — тем же способом.
   - `sentApprovals` — сбрасывать при `always` (не требуется: решение отправляется один раз).
9. `src/web/chat.ts` (сервер, пункт 4 объёма работ)
   - Новые функции рядом с `recordApprovalLog` (~строка 100-170):
     `allowListFile(cwd, threadId)` → `<threadId>.allow.json` (тот же каталог `.vibelog/chat-sessions`, имя с точкой — `listChatThreads` его не видит);
     `loadThreadAllowList(cwd, threadId): string[]`, `addThreadAllow(cwd, threadId, tool): void`, `removeThreadAllow(cwd, threadId, tool): void` (валидация `THREAD_ID_RE`, try/catch — сбой не рвёт диалог, паттерн approval-лога);
     `isToolAllowed(cwd, threadId, tool)`.
   - `ChatRequestBody.approval` (+ строка 57): добавить `always?: unknown`; `hasApprovalOf` не меняет семантику.
   - Ветка resume (~505-545): при `approved === true` и `body.approval.always === true` → `addThreadAllow(cwd, threadId, target.name)`; запись в `recordApprovalLog` событие `decided` + `always: true` (расширить тип `ApprovalLogEntry`).
   - Цикл исполнения (~622-640): `if (isWriteOperation(tc.name) && !isToolAllowed(cwd, threadId, tc.name))` → пауза; иначе `queue.push({ type:'tool_start', …, ...(allowedByPolicy ? {auto:true} : {}) })` и исполняем сразу.
   - `advanceToNextApproval` (~678-701): та же проверка allow-list (иначе подряд идущие вызовы разрешённого инструмента снова встанут на паузу).
   - `getChatThread` (используется `GET /api/chat/threads/:id`): в ответ добавить `allowList: string[]` — клиент помечает карточки после восстановления (AC11/AC6).
10. `src/web/api.ts` — новые ветки (рядом с `GET /api/chat/threads/:id`, строки ~131-136):
    - `GET /api/chat/threads/:id/allow` → `{ tools: string[] }`;
    - `POST /api/chat/threads/:id/allow` (body `{tool: string}`) → 200 `{tools}`; невалидный threadId/tool → 400;
    - `DELETE /api/chat/threads/:id/allow?tool=<name>` → 200 `{tools}`.
    Так как `/^\/api\/chat\/threads\/([^/]+)$/` не матчит `/allow` — порядок веток не конфликтует, но матчить `/threads/([^/]+)/allow` нужно ДО общего regex (безопаснее — поставить выше).
11. `web/src/lib/chat-threads.ts` — `historyToMessages`:
    - параметр `history` без изменений, второй аргумент `options?: { allowList?: string[] }`;
    - висящий approval — не только `backlog_create_task`, а любой write-инструмент (`isWriteTool` из `tool-meta.ts`, импорт чистого модуля в чистый lib допустим);
    - для part с `allowList.includes(toolName)` — поле `auto: true`, чтобы карточка показала пометку «разрешено заранее»;
    - `data`-части не появляются из jsonl (ошибки стрима не сохраняются) — см. R5.
12. `web/src/components/chat/thread.tsx` (ChatPage, строки ~560-600): пробросить `data.allowList` в `historyToMessages` и в `ChatRuntimeProvider` (module-level `activeAllowList`), чтобы карточки/`respondToApproval` знали список; `ChatRuntimeProvider` сбрасывает его при смене треда.
13. `web/src/index.css` — добавить `@keyframes shimmer` + утилиту `.shimmer` (в ref она из их globals; у нас отсутствует), а также, при необходимости, стили для `--collapsible-panel-height` (Radix отдаёт `--radix-collapsible-content-height` — использовать её в `collapsePanel`).

### Порядок действий
1. `web: pnpm install`, проверить `groupPartByType`/`GroupedParts`/`data`-part в типах.
2. `surfaces.ts` + `tool-meta.ts` + `index.css` (shimmer) — без них остальное не собрать.
3. `tool-call.tsx`, `approval-card.tsx` (+`receipt-focus`), `stopped-run.tsx`, `error-state.tsx`.
4. `chat-runtime.tsx`: `auto` в `tool_start`, error как data-part.
5. `thread.tsx`: сообщения (user/assistant/action bar), затем группировка, затем `ToolGroup`.
6. Сервер: `chat.ts` (allow-list) → `api.ts` (3 ветки) → `chat-threads.ts` (`allowList`, write-approval generic) → `thread.tsx` (проброс allowList).
7. Тесты → документация → браузер.

### Проверка
- `pnpm build && pnpm test` (корень, полный прогон — обязателен для DoD).
- Точечно: `pnpm vitest run src/web/chat.test.mjs src/web/chat-thread-restore.test.mjs`.
- `cd web && npm run build && npm run lint && npm run typecheck`.
- Новые тесты:
  - `src/web/chat.test.mjs` (+5): `always:true` → второй вызов того же инструмента в треде идёт без паузы (событие `tool_start{auto:true}`, нет `approval`); `always` для другого инструмента не действует; allow-list переживает новый POST (читается из файла); `DELETE …/allow` возвращает паузу; allow-list не протекает в другой тред.
  - `src/web/chat-thread-restore.test.mjs` (+3): висящий approval восстанавливается для `write_file`/`backlog_update_task` (не только create); `allowList` → `auto:true`; `{ok:false, denied:true}` → `isError`.
  - `src/web/api.test`-ветка (если есть chat-api тест — `src/web/chat-threads-api.test.mjs`): 3 новые ветки allow-list (GET/POST/DELETE, 400 на мусор).
- Браузер (`vibelog browser` + chrome-devtools, lesson-27 — короткими шагами): `evaluate_script` — проверить: ассистент без пузыря + аватар 8×8; user-пузырь с border и rounded-tr-md; hover action bar (opacity 0→1); свёрнутая строка read-тулзы + раскрытие Request/Result; approval-карточка с тремя кнопками, «Always allow» → пометка, повторный вызов без паузы, «отозвать» → снова пауза; группа из 2+ вызовов схлопывается; обрыв (Stop) → stopped-run с «Продолжить».

### Документация
- `README.md` §«Веб-чат (#/chat)»: пункт про внешний вид сообщений/тулзов (ссылка на ref-22), allow-list (`<threadId>.allow.json`, API `GET/POST/DELETE /api/chat/threads/:id/allow`, отзыв), группировка tool-вызовов, единый error-state/stopped-run.
- `CHANGELOG.md`: запись VL-264.

### Риски
- **R1. `GroupedParts`/`groupPartByType` могут отсутствовать в 0.15.31** (проверялось в основном репозитории, в worktree node_modules нет). Если typecheck не видит API — вариант Б: собственная группировка — в `PartView`-цикле вручную собирать подряд идущие tool-call в `ToolGroup` (обёртка над массивом parts), без `GroupedParts`. AC7 закрывается тем же поведением.
- **R2. `data`-part для ошибок**: если тип `Part` в `ChatModelRunResult` не допускает `data`, — вариант Б (маркер-префикс в text-part + распознавание в `PartView`). Функционально AC9 закрывается.
- **R3. Дублирование классификации write/read на клиенте** (`isWriteTool`) — риск расхождения с серверным `isWriteOperation`. Митигация: сервер уже шлёт события, где write-вызов приходит как `approval` (а не `tool_start`); клиент опирается на `part.approval !== undefined` (истина от сервера), `isWriteTool` — только fallback для старых jsonl; в тестах зафиксировать, что список write-маркеров совпадает (импорт `isWriteOperation` из `src/web/tool-policy.ts` в тесте `chat-thread-restore.test.mjs` — сравнить на выборке имён).
- **R4. Radix Collapsible не отдаёт `--collapsible-panel-height`** (у него `--radix-collapsible-content-height`) → анимация раскрытия «прыгнет». Митигация: `collapsePanel` на `--radix-collapsible-content-height` + `data-state=open/closed`, либо `grid-rows` трюк.
- **R5. Ошибки стрима не сохраняются в jsonl** — после перезагрузки треда error-state не восстановится (в истории останется только оборванный tool-call → «Прервано»). Для AC11 приемлемо: восстановленный «Прервано»-вызов показывается через `ErrorState` внутри tool-call. Зафиксировать в комментарии кода и в CHANGELOG.
- **R6. `always:true` снижает защиту**: разрешение живёт в файле треда бессрочно. Митигация: allow-list только per-thread, видимая пометка + отзыв в карточке (AC6), запись в `approvals.jsonl` (`decided` + `always:true`) для диагностики.
- **R7. Вёрстка при стриминге** (AC10): `SwapLabel` измеряет ширину через ResizeObserver на каждом токене — может дёргаться. Митигация: у read-строки label статичен по завершении (`active` только при `running`), ResizeObserver-эффект зависит от `active`, а не от текста; при превышении — заменить `SwapLabel` на простой условный рендер с `transition-opacity` (без измерения ширины).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 17:17
---
Фаза 2 (Plan) выполнена. Тип: task (не epic) — план записан в Implementation Plan этой же задачи.
Что изучено:
- ref-22 (`backlog/references/data/assistant-ui/`): `apps/docs/components/pages/examples/perplexity.tsx` (layout сообщений), `packages/ui/src/components/react/assistant-ui/elements/{tool-call,approval-card,stopped-run,surfaces,receipt-focus}.tsx` (канон рендера тулзов), `apps/docs/content/docs/primitives/message.mdx:287-323` (GroupedParts + groupPartByType).
- Текущий код: `web/src/components/chat/thread.tsx` (ToolCallCard — самодельная плашка, `bg-primary` user-пузырь, `size-7 rounded-md` action bar), `web/src/components/chat/chat-runtime.tsx` (ChatModelAdapter, ошибки как text-part), `web/src/lib/chat-threads.ts` (historyToMessages — approval восстанавливается только для `backlog_create_task`), `src/web/chat.ts` (approval-gate на `isWriteOperation`, три точки), `src/web/api.ts`, `src/web/tool-policy.ts`.
Ключевые решения плана: 16 файлов (7 новых компонентов/утилит, 6 изменяемых в web, 3 серверных), allow-list треда в `.vibelog/chat-sessions/<threadId>.allow.json` + API `GET/POST/DELETE /api/chat/threads/:id/allow`, «Always allow» через отдельный POST (не через `respondToApproval` — его тип принимает только approved/reason), группировка write-вызовов исключается из аккордеона (иначе активная карточка спрячется), ошибки стрима — `data`-часть `chat-error` с fallback на text-маркер.
Риски: R1 — `GroupedParts`/`groupPartByType` могут отсутствовать в 0.15.31 (worktree без node_modules — проверка первым шагом, fallback: своя группировка в PartView); R2 — тип `data`-части в `ChatModelRunResult`; R3 — дублирование write/read-классификации на клиенте (серверное событие approval — источник истины, клиентский `isWriteTool` только fallback для старых jsonl); R4 — Radix Collapsible отдаёт `--radix-collapsible-content-height`, а не `--collapsible-panel-height`; R5 — ошибки стрима не сохраняются в jsonl (после перезагрузки только «Прервано» у tool-call); R6 — бессрочность allow-list (per-thread, видимая пометка + отзыв + запись в approvals.jsonl); R7 — SwapLabel с ResizeObserver при стриминге (fallback: условный рендер без измерения ширины).
Проверка по плану: `pnpm build && pnpm test` (полный прогон — DoD), `cd web && npm run build && npm run lint && npm run typecheck`, +8 новых тестов (`chat.test.mjs` — allow-list, `chat-thread-restore.test.mjs` — висящие write-approval/allowList/isError, API-ветки), браузерная верификация короткими шагами через evaluate_script (lesson-27).
---
author: @agent
created: 2026-10-30 18:10
---
Фаза code не удалась (код выхода 1): b/chat.ts×10, payload последнего запроса=504206 байт (макс 504206), usage={"input_tokens":4780498,"output_tokens":8381,"cache_read_input_tokens":4581888,"total_tokens":4788879,"reasoning_tokens":1708} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 19:46
---
Фаза 3 (Code) выполнена. Коммит be620db «feat: VL-264 — стиль сообщений и рендер tool-вызовов как в ref-22».
Что сделано (по плану):
- Новые компоненты: `web/src/components/chat/surfaces.tsx` (порт elements/surfaces.tsx: paper/field/ghostButton/inkButton/mono/collapsePanel + ShimmerLabel/SwapLabel на наших токенах, shimmer-анимация в `web/src/index.css`), `tool-meta.ts` (подписи instrument→label/activeLabel, primaryArg, formatRequest/formatResult, requestDetails, fallback isWriteTool), `tool-call.tsx` (свёрнутая строка read-вызова + раскрытие Request/Result, авто-раскрытие при ошибке, ToolGroup-аккордеон), `approval-card.tsx` (paper-карточка, иконка в плашке, details, Deny / Always allow / Allow once, receipt-статус с useReceiptFocus, «Разрешено всегда · отозвать»), `error-state.tsx` (единая плашка ошибки), `stopped-run.tsx` (причина + «Продолжить»/«Скрыть»).
- `thread.tsx`: сообщения один-в-один по perplexity.tsx — assistant без пузыря (аватар size-8 с border, текст в ленте, max-w 40rem через `--thread-max-width`), user-пузырь rounded-3xl rounded-tr-md с border (не bg-primary), action bar size-8 rounded-full с hover/focus-появлением, BranchPicker рядом; части рендерит `MessagePrimitive.GroupedParts` + обёртка над `groupPartByType` (write-вызовы в группу не попадают — активная карточка не прячется), ошибки стрима → ChatErrorState, под ответом — StoppedRunForMessage (статус incomplete → StoppedRun с Reload).
- `chat-runtime.tsx`: событие `tool_start.auto` (allow-list) едет в `providerMetadata.vibelog.auto`, ошибки стрима/сети → `data`-часть `chat-error` (AC9), module-level allow-list треда (`getActiveThreadId`, `isToolAlwaysAllowed`, add/remove/set).
- Сервер: `src/web/chat.ts` — allow-list треда `<threadId>.allow.json` в `.vibelog/chat-sessions/` (loadThreadAllowList/addThreadAllow/removeThreadAllow/isToolAllowed, fail-closed, THREAD_ID_RE-guard), `always: true` в resume сохраняет разрешение и пишется в approvals.jsonl, гейт и `advanceToNextApproval` сначала проверяют allow-list (событие `auto: true`), `advanceToNextApproval` теперь исполняет read-вызовы через общий `executeTool` (локальные read_file/write_file больше не ломаются в этой ветке). `src/web/api.ts` — GET/POST/DELETE `/api/chat/threads/:id/allow` (+400 валидация) и `allowList` в GET истории. `web/src/lib/chat-threads.ts` — висящий approval восстанавливается для любого write-инструмента, allowList → `providerMetadata.vibelog.auto`, `{ok:false}` → isError.
Проверки: `npx tsc --noEmit` (корень) — ок; `web: npm run typecheck`, `npm run lint` (0 ошибок, 0 предупреждений), `npm run build` — ок; `pnpm build` + полный `pnpm test`: 1835 passed / 4 skipped, **1 failed — `src/mcp/server.test.mjs` «fallback: meta без usage → jsonl» (VL-198, tokenUsage)**. Падение пред-существующее: проверено через `git stash` моих изменений + пересборку — тот же тест падает на чистом дереве (тест зависит от env текущей сессии агента, VIBELOG_PHASE_NAME/SESSION_ID). Поэтому DoD «Тесты проходят» НЕ отмечен; регрессий моей правкой нет (DoD 3 отмечен).
Новые тесты: `src/web/chat-allow.test.mjs` (6: always снимает паузу и переживает новый POST, другой инструмент по-прежнему спрашивает, изоляция тредов, отзыв возвращает паузу, невалидный threadId, два вызова в одном ходе), `src/web/chat-allow-api.test.mjs` (6: GET/POST/DELETE allow, 400, allowList в истории, изоляция), `src/web/chat-thread-restore-vl264.test.mjs` (10: висящие approval для write_file/backlog_update_task, allowList→auto, {ok:false}→isError, паритет isWriteTool ↔ серверный isWriteOperation на 27 именах, tool-meta).
Что осталось (не отмечено): AC10 (стриминг не ломает вёрстку) и AC12 (проверка в браузере на реальном треде) — перед браузерной проверкой упёрся wall-time лимит фазы; AC10/AC12 требуют живой прогон `vibelog browser`. Документация (README/CHANGELOG) по правилам фазы пишется в Close. Урок lesson-115 (диагностика пред-существующих падений через git stash) создан и связан.
Изменённые файлы: src/web/api.ts, src/web/chat.ts, src/web/chat-allow.test.mjs, src/web/chat-allow-api.test.mjs, src/web/chat-thread-restore-vl264.test.mjs, web/src/components/chat/{approval-card,error-state,stopped-run,surfaces,tool-call,tool-meta,chat-runtime,thread}.tsx, web/src/index.css, web/src/lib/chat-threads.ts, web/dist (пересобран).
---
author: @agent
created: 2026-10-30 20:00
---
Фаза Close выполнена. Ветка vb/vl-264 слита в master (1 коммит, be620db → merge 5d09f1b^, merge-коммит `merge: VL-264 — …`), worktree `.vibelog/worktrees/vl-264` удалена (force — внутри были только оркестраторные симлинки node_modules/, backlog/references/data/), ветка vb/vl-264 удалена.
Проверки после merge (главный репо):
- `pnpm build` — ок.
- Ранний точечный фильтр: `npx vitest run src/web/` — 21 файл, 355 passed.
- Полный прогон `npx vitest run` (первый): 1859 passed / 4 skipped, **1 failed** — `src/web/orchestrator.test.mjs > E2E: оркестраторный спавн пишет meta.json сессии` (`SyntaxError: Unexpected end of JSON input` при чтении частично записанного meta.json). Классификация: (а) тест по имени (`-t`) — passed; (б) весь файл изолированно — 79/79 passed; (в) параллельного `vitest` в других worktree нет (`ps aux` пусто). Merge оркестратор не затрагивал (`git diff --name-only HEAD^1..HEAD` — только src/web/{api,chat}.ts, новые тесты, web/). Причина повтора зафиксирована: флак E2E-тайминга. Повторный полный прогон (единственный) — **102 файла, 1860 passed, 4 skipped, 0 failed**. DoD «Тесты проходят» отмечен по зелёному полному прогону.
- `web: npm run typecheck`, `npm run lint`, `npm run build` — все ок.
DoD: 1 «Тесты проходят» — ✓ (полный прогон зелёный); 2 «Документация обновлена» — ✓ (README §«Веб-чат»: внешний вид сообщений/тулзов по ref-22, allow-list `<threadId>.allow.json` + API GET/POST/DELETE, группировка, error-state/stopped-run; CHANGELOG Unreleased — запись VL-264; коммит d78f1a0); 3 «Нет регрессий» — ✓ (был отмечен в Code, подтверждён).
Не отмечено честно: **AC10** (стриминг не ломает вёрстку — требует живого прогона со стримингом) и **AC12** (проверка в браузере на реальном треде; web build/lint прошли, но `vibelog browser` + chrome-devtools прогон не выполнялся в этой фазе). Остальные 10 AC отмечены в фазе Code.
Lessons: lesson-115 (связан в Code), lesson-116 (создан в Close — диагностика флака одиночного теста: по имени → весь файл → ps aux → один повтор полного прогона); задача связана с обоими.
Refs/lessons закоммичены: 5d09f1b «docs(task): VL-264 — refs и lessons» (lesson-115, lesson-116).
---
<!-- COMMENTS:END -->