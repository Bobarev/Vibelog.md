---
id: VL-414
title: 'Бот /chat: ответы персоны отправлять через sendRichMessage (GFM), а не MarkdownV2'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 20:26'
updated_date: '2026-11-16 16:02'
due_date: ''
labels:
  - bot
  - web
dependencies: []
milestone: v1.14
references:
  - VL-408
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/chat-answer.ts
  - src/bot/chat-answer.test.mjs
  - src/bot/chat-pause.ts
  - src/bot/chat-pause.test.mjs
  - src/bot/chat-bridge.ts
  - src/bot/chat-bridge.test.mjs
  - src/bot/handlers.ts
lessons:
  - lesson-288
  - lesson-289
token_usage:
  input: 16338201
  output: 95182
  cache: 15921152
  total: 16433383
  requests: 158
  duration_ms: 2172999
  reasoning: 50438
  by_phase:
    plan:
      input: 4037520
      output: 32380
      cache: 3926016
      requests: 44
    code:
      input: 10757628
      output: 56210
      cache: 10494976
      requests: 86
    close:
      input: 1543053
      output: 6592
      cache: 1500160
      requests: 28
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В VL-408 реализован режим `/chat <chat-id>` в Telegram-боте: сообщения пользователя уходят в веб-чат, ответ персоны возвращается в бот. При эксплуатации выявились две проблемы.

### Проблема 1 — markdown не рендерится

Ответ персоны — это GFM-текст (модель отдаёт `**жирный**`, заголовки, списки, код-блоки). Он отправляется через `sendMd` (`src/bot/handlers.ts:104`), который делает `ctx.reply(text, { parse_mode: 'MarkdownV2' })` **без экранирования**. Telegram отвечает `400 can't parse entities`, `sendMd` молча ловит ошибку и повторяет отправку без `parse_mode` — сообщение доходит как plain text.

Карточки задач (`sendTaskView`, `sendTasksView`, `sendPhaseResult`, `sendDocsView`, `sendDiffView`, `sendCommitsView`) устроены иначе: `bot.api.sendRichMessage(chatId, { markdown: part })` — Rich Messages с GFM, текст передаётся как есть, фолбэк на `sendText` (MarkdownV2) только при отказе API.

### Проблема 2 — в боте нет UI подтверждения write-операций и ответа на вопрос

`forwardChatMessage` (`src/bot/chat-bridge.ts:151-160`) на события `approval`, `question` и `pricing(kind:'ask')` **отменяет прогон** (`cancelChatRun`) и присылает подсказку «продолжите в веб-интерфейсе» (`NEEDS_WEB_TEXT`, `chat-bridge.ts:81`). Причина — в боте нет ни inline-кнопок, ни состояния ожидания решения, а молча разрешать write-операции нельзя (правило доступа: запись только с подтверждением).

Практическое следствие: персона в боте не может создать задачу, записать файл или вызвать любой write-инструмент — ход обрывается, пользователь вынужден идти в веб. Незакрытый `assistant(tool_calls)` в jsonl закрывается синтетическим отказом при следующем сообщении (`closePendingToolCalls` в `chat.ts`).

## Цель

1. Перевести отправку ответов персоны в режиме `/chat` на тот же механизм, что у карточек задач: `sendRichMessage` с GFM и фолбэком на plain.
2. Реализовать в боте полноценный UI пауз хода веб-чата: Allow/Deny для `approval` и кнопки-варианты для `question`, чтобы режим `/chat` был самодостаточным.

## Часть 1 — rich-отправка ответа персоны

Места правки:

1. `src/bot/handlers.ts:1462-1465` — `bot.command('chat')`, вывод последнего сообщения персоны из истории треда (`lastAssistantText`).
2. `src/bot/handlers.ts:1849-1852` — перехватчик `message:text` (режим пересылки), вывод `result.text` из `forwardChatMessage`.

Оба места сейчас: `for (const part of chunkRich(result.text, TELEGRAM_TEXT_LIMIT)) await sendMd(ctx, part);`

Что сделать:

- Вынести общий помощник (по образцу `sendPhaseResult`, `handlers.ts:289-340`): `sendChatAnswer(bot, chatId, text)` — `chunkRich(text, RICH_LIMIT)` → `bot.api.sendRichMessage(chatId, { markdown: part })` по частям; при исключении — фолбэк на `sendText` (MarkdownV2) с `splitNumbered` (не `chunkRich` с лимитом 4096: `chunkRich` рассчитан на rich-лимит 32768, а `splitNumbered` режет по границам строк и не рвёт escape-последовательности — lesson из VL-148).
- Заменить оба вызова `sendMd` в ветках вывода ответа персоны на новый помощник.
- Служебные сообщения режима (`🔗 Режим пересылки включён…`, `Режим пересылки завершён.`, `⚠️ …`, `Персона не вернула текст…`) оставить на `sendMd` — они формируются ботом и уже экранированы через `escapeMarkdownV2`.
- Проверить, что `chunkRich` с `TELEGRAM_TEXT_LIMIT` больше не используется в этих ветках.

## Часть 2 — паузы хода в боте: approval и question

### 2.1 `approval` — кнопки Allow / Deny

Событие (`src/web/chat.ts:192`): `{ type: 'approval'; toolCallId; name; args; grant? }`.

- В `forwardChatMessage` (`src/bot/chat-bridge.ts`) на `approval` **не отменять** прогон: вернуть наружу запрос на решение (расширить `ForwardResult` вариантом вида `{ approval: {...} }` либо колбэком), сохранив `cancelChatRun` только для случая, когда пользователь не ответил / режим завершён.
- В `handlers.ts` отправить сообщение с описанием действия (имя инструмента + ключевые аргументы, при наличии `grant` — его превью) и inline-кнопками **Allow / Deny**; `callback_data` с префиксом, не пересекающимся с существующими (`comment:`, `next:`, `resume:` и т.д.).
- По нажатию — `answerCallbackQuery` + возобновление хода запросом с `body.approval = { toolCallId, approved }` (см. `hasApprovalOf`/ветку `hasApprovalOf(body)` в `chat.ts:1683+`). Учесть VL-264 «Always allow» (`always: true` → `addThreadAllow`) — по возможности отдельной третьей кнопкой.
- `pricing(kind:'ask')` — по возможности те же кнопки; если сценарий редкий, допустимо оставить подсказку «продолжите в вебе» с явной пометкой в Implementation Notes.

### 2.2 `question` — кнопки по вариантам + свободный ввод

Событие (`src/web/chat.ts:198-205`, VL-330):

```ts
{ type: 'question'; toolCallId: string; question: string;
  options: { id: string; label: string; description?: string }[];
  allowCustom: boolean }
```

- Прислать текст вопроса и **по одной inline-кнопке на каждый `option`** (подпись — `label`, `callback_data` = `chatq:<toolCallId>:<optionId>`); `description` варианта выводить в тексте сообщения под вопросом (в подписи кнопки Telegram её не поместит).
- Если `allowCustom: true` — дополнительно включить состояние ожидания свободного текста (module-state по образцу `awaitingComment`/`awaitingPin`, `handlers.ts:341-345`): следующий текст пользователя уходит как `{ custom }`. Если `allowCustom: false` — ждём только нажатия кнопки, текст в этом состоянии не принимаем (валидация `validateAnswer` всё равно отклонит `custom`).
- Ответ отправляется как `body.answer = { toolCallId, optionId }` либо `{ toolCallId, custom }` (см. ветку `hasAnswerOf(body)` в `chat.ts:1625+`). Учесть TTL вопроса 24 ч (`isQuestionExpired`) — по истечении бот сообщает, что вопрос снят.
- Приоритет перехвата `message:text` для свободного ответа — выше обычной пересылки в веб-чат.

### 2.3 Общее

- Таймаут/выход из режима (`/cancel`, новый `/chat`) при висящей паузе — прогон гасится через `cancelChatRun`, чтобы не блокировать тред.
- Обновить `NEEDS_WEB_TEXT` и doc-6: подсказка «продолжите в веб-интерфейсе» остаётся только для сценариев, которые бот решить не может.

## Входные данные

- VL-408 (реализация режима `/chat`), `src/bot/chat-bridge.ts` (`forwardChatMessage` возвращает `{ text }` — сырой GFM).
- Образец rich-отправки: `sendPhaseResult` в `src/bot/handlers.ts`, `renderPhaseResultRich`/`chunkRich` в `src/bot/rich.ts`.
- Механика пауз в вебе: `src/web/chat-runs.ts` (события `approval`/`question`/`pricing`, `cancelChatRun`, `subscribeChatRun`), `src/web/chat.ts` (`pauseOnToolCall`, `hasApprovalOf`, `hasAnswerOf`, `validateAnswer`, `closePendingToolCalls`), VL-330 (`ask_user`), VL-264 («Always allow»).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ответ персоны в режиме /chat отправляется через bot.api.sendRichMessage с GFM-разметкой (как карточки задач), а не через sendMd/MarkdownV2
- [x] #2 Последнее сообщение персоны, присылаемое по команде /chat <id>, тоже рендерится с разметкой
- [x] #3 При отказе sendRichMessage срабатывает фолбэк: MarkdownV2 через splitNumbered, затем plain — сообщение не теряется
- [x] #4 Служебные сообщения режима (включение/завершение пересылки, ошибки) остаются на sendMd с escapeMarkdownV2
- [x] #5 Тесты: покрыт rich-путь и фолбэк для обеих точек вывода ответа персоны; существующие бот-тесты проходят
- [x] #6 В режиме /chat на событие approval бот присылает сообщение с inline-кнопками Allow/Deny, прогон НЕ отменяется и ждёт решения
- [x] #7 Нажатие Allow/Deny разрешает ожидающий approval в chat-runs и ход продолжается; answerCallbackQuery вызывается в любом исходе
- [x] #8 /cancel или новый /chat при висящем approval гасят прогон через cancelChatRun и не блокируют тред
- [ ] #9 Подсказка «продолжите в веб-интерфейсе» остаётся только для сценариев, которые бот решить не может; doc-6 обновлён
- [x] #10 На событие question бот присылает текст вопроса и по одной inline-кнопке на каждый option (label в подписи, description в тексте сообщения)
- [x] #11 Нажатие кнопки-варианта отправляет ответ { toolCallId, optionId } и ход продолжается
- [x] #12 При allowCustom: true следующий текст пользователя принимается как { custom }; при allowCustom: false текст не принимается и бот подсказывает выбрать вариант
- [x] #13 Истёкший вопрос (TTL 24 ч) не ломает режим: бот сообщает, что вопрос снят
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

1. Ответ персоны в режиме `/chat` отправлять как Rich Message (GFM) с фолбэком MarkdownV2 → plain.
2. Дать боту полноценный UI пауз веб-чата: Allow/Deny (+Always allow) для `approval`, кнопки-варианты + свободный ввод для `question`.

## Файлы

| Файл | Что делаем |
|---|---|
| `src/bot/chat-answer.ts` (новый) | `sendChatAnswer(bot, chatId, text)` — rich-путь + фолбэк |
| `src/bot/chat-pause.ts` (новый) | чистые хелперы пауз: типы, клавиатуры, тексты, разбор `callback_data` |
| `src/bot/chat-bridge.ts` | `ForwardResult` += `approval`/`question`; `forwardChatMessage` не гасит прогон на паузах; новые `answerChatApproval`/`answerChatQuestion`; общий `runAndCollect` |
| `src/bot/handlers.ts` | `sendMd` += `replyMarkup`; `deliverChatResult`; вывод ответа персоны через `sendChatAnswer`; callback-ветки `chata:`/`chatq:`; перехват свободного текста вопроса; `/cancel` гасит прогон |
| `src/bot/chat-answer.test.mjs` (новый) | rich-путь, фолбэк MarkdownV2, фолбэк plain, разбивка |
| `src/bot/chat-pause.test.mjs` (новый) | клавиатуры, разбор callback, тексты, TTL-сообщение |
| `src/bot/chat-bridge.test.mjs` | обновить тест approval (теперь `{approval}`, прогон не отменяется), добавить question и resume-тесты |
| `backlog/docs/doc-6-…md` | переписать абзац «Ограничения» у `/chat` |
| `CHANGELOG.md` | запись в Unreleased |

## Часть 1 — rich-отправка ответа персоны

1. **`src/bot/chat-answer.ts`** (новый модуль, чтобы не тянуть `handlers.ts` в тест):
   ```ts
   export async function sendChatAnswer(bot: Bot, chatId: number, text: string): Promise<void> {
     try {
       for (const part of chunkRich(text)) await bot.api.sendRichMessage(chatId, { markdown: part });
     } catch (err) {
       console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
       const parts = splitNumbered(text, TELEGRAM_TEXT_LIMIT, (i, n) => `\n\n_часть ${i}\\/${n}_`);
       for (const part of parts) await sendMdFallback(bot, chatId, part);
     }
   }
   ```
   - `chunkRich(text)` без второго аргумента — дефолт `RICH_LIMIT` (`src/bot/rich.ts:691`, `:33`).
   - `sendMdFallback` — локальная копия `sendText` (`handlers.ts:124-145`): `sendMessage` с `parse_mode: 'MarkdownV2'`, при исключении — без `parse_mode`. Копия, а не импорт: `handlers.ts` будет импортировать `chat-answer.ts`, обратный импорт дал бы цикл (комментарий в модуле обязателен).
   - `splitNumbered` с лимитом `TELEGRAM_TEXT_LIMIT` (4096), а не `chunkRich` — резка по `\n`, не рвёт escape-последовательности (`src/bot/formatting.ts:298-340`, lesson VL-148).

2. **`handlers.ts:1469`** (`bot.command('chat')`, вывод `lastAssistantText`): `for (const part of chunkRich(last, TELEGRAM_TEXT_LIMIT)) await sendMd(ctx, part);` → `await sendChatAnswer(bot, chatId, last);`.

3. **`handlers.ts:1849`** (перехватчик `message:text`, вывод `result.text`): то же → `await sendChatAnswer(bot, chatId, result.text);` (внутри `deliverChatResult`, см. часть 2).

4. Служебные сообщения остаются на `sendMd`: `handlers.ts:1459-1463` (включение режима), `:1828` (`Режим пересылки завершён.`), `:1836` (`⚠️ error`), `:1846` (`Персона не вернула текст…`), `:1841` (`needsWeb`).

5. Проверить, что `chunkRich(..., TELEGRAM_TEXT_LIMIT)` в этих двух ветках больше не встречается (`grep -n "chunkRich(.*TELEGRAM_TEXT_LIMIT" src/bot/handlers.ts` → остаётся только `:461` в `/help`).

## Часть 2 — паузы хода в боте

### 2.1 `chat-bridge.ts` — не гасить прогон, вернуть запрос наружу

- `ForwardResult` (`:74-77`) расширить:
  ```ts
  type ApprovalEvent = Extract<ChatEvent, { type: 'approval' }>;   // chat.ts:192
  type QuestionEvent = Extract<ChatEvent, { type: 'question' }>;   // chat.ts:198-205
  export type ForwardResult =
    | { text: string } | { error: string } | { needsWeb: string }
    | { approval: ApprovalEvent & { threadId: string } }
    | { question: QuestionEvent & { threadId: string } };
  ```
  `ChatEvent` уже экспортируется из `../web/chat.js` — новых зависимостей нет.
- Вынести тело `forwardChatMessage` (`:101-175`) в `runAndCollect(cwd, threadId, body: ChatRequestBody, deps)`; `forwardChatMessage` = `runAndCollect(..., { threadId, message: text })`.
- В колбэке подписки: `case 'approval'` → `finish({ approval: { ...ev, threadId } })` **без** `cancelChatRun`; `case 'question'` → `finish({ question: { ...ev, threadId } })` без отмены. `case 'pricing'` с `kind === 'ask'` — оставить `cancelChatRun` + `needsWeb` (редкий сценарий, AC9 это допускает; зафиксировать в Implementation Notes).
- Новые экспорты:
  ```ts
  export async function answerChatApproval(cwd, threadId, toolCallId, approved, always = false, deps = {})
    → runAndCollect(cwd, threadId, { threadId, approval: { toolCallId, approved, always } }, deps)
  export async function answerChatQuestion(cwd, threadId, toolCallId, answer: { optionId?: string; custom?: string }, deps = {})
    → runAndCollect(cwd, threadId, { threadId, answer: { toolCallId, ...answer } }, deps)
  ```
  Формы тела — `ChatRequestBody.approval` (`chat.ts:293-297`) и `.answer` (`:298-303`); resume-ветки — `hasAnswerOf` (`chat.ts:1625-1677`) и `hasApprovalOf` (`:1679-1730`).
- `NEEDS_WEB_TEXT` (`:80-83`) переписать: остаётся только для `pricing(kind:'ask')` и прочих сценариев, которые бот решить не может.
- Важно: после паузы `produce` возвращает управление, `driveChat` закрывает прогон статусом `done` (`chat.ts:1150-1175`) — прогон в реестре не висит, resume идёт новым `startChatRun` (как в вебе). Поэтому `cancelChatRun` на паузе не нужен, а `/cancel` вызывает его «на всякий случай» (no-op, если прогон уже завершён, `chat-runs.ts:228-240`).

### 2.2 `chat-pause.ts` — чистые хелперы (тестируемые без grammy)

```ts
export type ChatPause =
  | { kind: 'approval'; threadId: string; toolCallId: string; name: string }
  | { kind: 'question'; threadId: string; toolCallId: string; allowCustom: boolean; options: { id: string; label: string }[] };

export type ChatCallback =
  | { kind: 'approval'; decision: 'allow' | 'deny' | 'always' }
  | { kind: 'question'; index: number };

export function parseChatCallback(data: string): ChatCallback | null;   // 'chata:allow' | 'chata:deny' | 'chata:always' | 'chatq:<i>'
export function approvalKeyboard(): { inline_keyboard: { text: string; callback_data: string }[][] };
export function questionKeyboard(options: { id: string; label: string }[]): { inline_keyboard: ... };
export function approvalText(req: { name: string; args: Record<string, unknown>; grant?: SupervisorGrantPreview }): string; // MarkdownV2, экранирован
export function questionText(req: { question: string; options: { id: string; label: string; description?: string }[]; allowCustom: boolean }): string;
export function expiredQuestionText(): string;
```

Почему `callback_data` без `toolCallId`: лимит Telegram — 64 байта на `callback_data`; `toolCallId` + `optionId` могут его превысить. Состояние паузы живёт в module-state по `chatId`, в кнопке — только решение/индекс варианта. `toolCallId` берётся из состояния.

`approvalText`: имя инструмента + превью аргументов (ключи и короткие значения, обрезка ~300 символов) + при `grant` — `runId`, `taskIds`, `expiresAt` (`SupervisorGrantPreview`, `src/web/supervisor.ts:737-750`). Всё через `escapeMarkdownV2` (`src/bot/formatting.ts:25`).

`questionText`: текст вопроса + строки `• <label> — <description>` для вариантов (в подписи кнопки Telegram description не поместит) + подсказка «или напишите свой ответ» при `allowCustom`.

### 2.3 `handlers.ts` — проводка

1. **`sendMd` (`:104-113`)** — добавить необязательный `replyMarkup` (как у `sendText`, `:124-145`): прокидывать в обе ветки (`parse_mode` + `reply_markup`, затем без `parse_mode`). Существующие вызовы не меняются.

2. **Module-state рядом с `awaitingComment` (`:355`)**:
   ```ts
   const chatPauses = new Map<number, ChatPause>();   // chatId → висящая пауза
   ```

3. **Локальная функция `deliverChatResult(ctx, chatId, result: ForwardResult)`** внутри `registerHandlers` (паттерн `commitComment`):
   - `error` → `sendMd('⚠️ ' + escapeMarkdownV2(...))`;
   - `needsWeb` → `sendMd(escapeMarkdownV2(...))`;
   - `approval` → `chatPauses.set(chatId, {kind:'approval', threadId, toolCallId, name})` + `sendMd(approvalText(...), approvalKeyboard())`;
   - `question` → `chatPauses.set(chatId, {kind:'question', threadId, toolCallId, allowCustom, options})` + `sendMd(questionText(...), questionKeyboard(options))`;
   - пустой `text` → `sendMd('Персона не вернула текст — подробности в веб-интерфейсе.')`;
   - иначе → `await sendChatAnswer(bot, chatId, result.text)`.
   Используется и в перехватчике `message:text` (`:1812-1852`), и в новых callback-ветках.

4. **Callback-ветки** — вставить в `bot.on('callback_query')` (`:1477`) **до** фильтра `:1585** (`if (!data.startsWith('next:') …) return;`), рядом с `comment:`/`resume:`:
   - `data.startsWith('chata:')`: `requireBind` (с `answerCallbackQuery`-фолбэком, как в `:1482-1490`) → `parseChatCallback` → состояние `chatPauses.get(chatId)`; нет состояния или `kind !== 'approval'` → `answerCallbackQuery('Решение уже принято или устарело')`; иначе `chatPauses.delete(chatId)` → `answerCallbackQuery('✅ Разрешено' / '⛔ Отклонено' / '✅ Разрешено всегда')` → `answerChatApproval(deps.cwd, threadId, toolCallId, decision !== 'deny', decision === 'always')` → `deliverChatResult`.
   - `data.startsWith('chatq:')`: то же + проверка TTL: `isQuestionExpired(questionAskedAt(deps.cwd, threadId, toolCallId))` (`src/web/chat-question.ts:251`, `:266`) → `answerCallbackQuery(expiredQuestionText())` + `chatPauses.delete` + `sendMd(expiredQuestionText())`, прогон не трогаем; иначе `optionId = options[index].id` → `answerChatQuestion(..., { optionId })` → `deliverChatResult`.
   - `answerCallbackQuery` вызывается в любом исходе (AC7) — как в существующих ветках.

5. **Перехват свободного текста вопроса** — новый `bot.on('message:text', …)` **между** обработчиком `awaitingComment` (заканчивается `:1810`) и перехватчиком `/chat` (`:1812`), т.е. приоритет выше обычной пересылки:
   - `chatPauses.get(chatId)` нет или `kind !== 'question'` → `next()`;
   - `text === '/cancel'` → `chatPauses.delete` + `cancelChatRun(threadId, 'Вопрос снят пользователем')` + `sendMd('Отменено.')`;
   - `allowCustom === false` → `sendMd('Выберите вариант кнопкой или /cancel.')`, состояние сохраняется (AC12);
   - иначе `chatPauses.delete` → `answerChatQuestion(deps.cwd, threadId, toolCallId, { custom: text })` → `deliverChatResult`.

6. **`/cancel` и новый `/chat` при висящей паузе** (AC8): в ветке `/cancel` (`:1826-1830`) и в начале `bot.command('chat')` (`:1440`) — `const pause = chatPauses.get(chatId); if (pause) { chatPauses.delete(chatId); cancelChatRun(pause.threadId, 'Ход остановлен из бота'); }`. `cancelChatRun` импортировать из `../web/chat-runs.js` (`:228`). Незакрытый `assistant(tool_calls)` в jsonl закроется синтетическим отказом при следующем сообщении (`closePendingToolCalls`, `chat.ts:716-745`) — это существующее поведение, документируется.

7. **Импорты** в `handlers.ts`: `sendChatAnswer` из `./chat-answer.js`; `answerChatApproval`, `answerChatQuestion` из `./chat-bridge.js` (в существующий блок `:82-88`); `parseChatCallback`, `approvalKeyboard`, `questionKeyboard`, `approvalText`, `questionText`, `expiredQuestionText`, `type ChatPause` из `./chat-pause.js`; `cancelChatRun` из `../web/chat-runs.js`; `isQuestionExpired`, `questionAskedAt` из `../web/chat-question.js`.

## Порядок действий

1. `src/bot/chat-answer.ts` + `src/bot/chat-answer.test.mjs`.
2. `src/bot/chat-pause.ts` + `src/bot/chat-pause.test.mjs`.
3. `src/bot/chat-bridge.ts` (рефакторинг `runAndCollect`, новые экспорты) + обновление `chat-bridge.test.mjs`.
4. `src/bot/handlers.ts` (sendMd, deliverChatResult, две точки вывода ответа, callback-ветки, перехват текста, /cancel).
5. `backlog/docs/doc-6-…md` (абзац `/chat`: убрать «approval и ask_user решить нельзя», описать кнопки, свободный ввод, TTL 24 ч, что осталось в вебе — `pricing(kind:'ask')`), `CHANGELOG.md`.
6. `pnpm build && pnpm test` (полный прогон — DoD).

## Как проверить

```bash
pnpm build
pnpm test:fast -- src/bot/chat-answer.test.mjs src/bot/chat-pause.test.mjs src/bot/chat-bridge.test.mjs
pnpm test          # полный прогон перед DoD
```

Ручная проверка (если есть токен): `/chat <id>` → ответ с `**жирным**` рендерится; попросить персону создать задачу → приходит карточка Allow/Deny/Always; нажать Allow → ход продолжается, задача создана; `ask_user` → кнопки-варианты, свободный текст уходит как `custom`.

## Риски

- **R1. `callback_data` ≤ 64 байт** — снят схемой «состояние в module-state, в кнопке только решение/индекс».
- **R2. Порядок обработчиков grammy** (ловушка VL-37): новый перехват текста вопроса обязан стоять до перехватчика `/chat` и звать `next()` во всех «не наш случай» ветках; callback-ветки — до фильтра `:1585`.
- **R3. Рестарт бота** теряет `chatPauses` (как `awaitingPin`/`awaitingComment`): висящий approval останется в jsonl и закроется синтетическим отказом при следующем сообщении. Документируется, не чинится.
- **R4. MarkdownV2-фолбэк для GFM-текста** почти всегда упадёт на парсере → уйдёт plain. Это ожидаемо (AC3 требует «не потерять сообщение», не «сохранить разметку»).
- **R5. Дубли при частичной отправке rich**: если `sendRichMessage` упал на k-й части, фолбэк отправит весь текст заново — существующее поведение `sendPhaseResult` (`handlers.ts:296-340`), не ухудшается.
- **R6. `pricing(kind:'ask')`** остаётся на «продолжите в вебе» — зафиксировать в Implementation Notes как осознанное отклонение (AC9 допускает).

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `sendMd` = `ctx.reply` с `parse_mode: 'MarkdownV2'` и фолбэком на plain, без экранирования | `src/bot/handlers.ts:104-113` |
| `sendText` принимает `replyMarkup` и прокидывает его в обе ветки | `src/bot/handlers.ts:124-145` |
| `sendPhaseResult` — образец: `chunkRich(rich)` → `sendRichMessage`, catch → `splitNumbered` + `sendText` | `src/bot/handlers.ts:296-340` |
| `chunkRich` дефолт `RICH_LIMIT` = 32768, режет по `\n\n`/`\n` | `src/bot/rich.ts:691-707`, `:33` |
| `splitNumbered(text, limit, fmtSuffix)` режет по `\n`, резерв суффикса 32 | `src/bot/formatting.ts:298-340`, `:267` |
| `/chat` выводит `lastAssistantText` через `chunkRich(last, TELEGRAM_TEXT_LIMIT)` + `sendMd` | `src/bot/handlers.ts:1466-1471` |
| Перехватчик `/chat` выводит `result.text` через `chunkRich(result.text, TELEGRAM_TEXT_LIMIT)` + `sendMd` | `src/bot/handlers.ts:1849-1851` |
| Служебные сообщения режима идут через `sendMd` | `src/bot/handlers.ts:1459-1463`, `:1828`, `:1836`, `:1841`, `:1846` |
| `ForwardResult` = `{text} | {error} | {needsWeb}` | `src/bot/chat-bridge.ts:74-77` |
| На `approval`/`question` прогон гасится `cancelChatRun` + `needsWeb` | `src/bot/chat-bridge.ts:151-157` |
| `pricing(kind:'ask')` — тоже `cancelChatRun` + `needsWeb` | `src/bot/chat-bridge.ts:158-163` |
| Событие `approval`: `{toolCallId, name, args, grant?}` | `src/web/chat.ts:192` |
| Событие `question`: `{toolCallId, question, options[{id,label,description?}], allowCustom}` | `src/web/chat.ts:198-205` |
| `ChatRequestBody.approval` = `{toolCallId, approved, reason?, always?}`, `.answer` = `{toolCallId, optionId?, custom?}` | `src/web/chat.ts:293-303` |
| Resume по `answer` валидирует toolCallId/optionId/custom/TTL и пишет tool-результат | `src/web/chat.ts:1625-1677` |
| Resume по `approval` исполняет инструмент, `always` → `addThreadAllow` | `src/web/chat.ts:1679-1730` |
| `startChatRun(body, cwd, deps)` — единственная точка старта хода, джойн к идущему | `src/web/chat.ts:1059-1095` |
| `cancelChatRun` возвращает false, если прогон уже завершён | `src/web/chat-runs.ts:228-240` |
| `subscribeChatRun` дренирует буфер синхронно, `run.done` проверяется после подписки | `src/web/chat-runs.ts:245-266`, `src/bot/chat-bridge.ts:170-173` |
| `questionAskedAt` / `isQuestionExpired` (TTL 24 ч) | `src/web/chat-question.ts:251-270` |
| `validateAnswer` отклоняет `custom` при `allowCustom === false` | `src/web/chat-question.ts` (функция `validateAnswer`, файл прочитан целиком) |
| `closePendingToolCalls` закрывает висящий хвост синтетическим `denied`/`cancelled` | `src/web/chat.ts:716-745` |
| `isInteractiveTool` — отдельная категория (вопрос не идёт через Allow/Deny) | `src/core/tool-classify.ts:144-146` |
| `SupervisorGrantPreview` = `{runId, taskIds, tools, expiresAt, grantedAt, order, groups, rationale, skipped, maxParallelPhases}` | `src/web/supervisor.ts:737-750` |
| `sendRichMessage(chat_id, rich_message, other?)` — нативный метод grammy | `node_modules/grammy/out/core/api.d.ts:167` |
| `awaitingComment` — module-state `Map<number, string>` внутри `registerHandlers` | `src/bot/handlers.ts:355` |
| Callback-фильтр «чужие callback не трогаем» стоит на `:1585` — новые ветки обязаны быть выше | `src/bot/handlers.ts:1585` |
| Перехватчик `/chat` стоит между `awaitingComment` (`:1779`) и reply-resume (`:1857`) | `src/bot/handlers.ts:1812` |
| `escapeMarkdownV2` — экспорт из `formatting.ts` | `src/bot/formatting.ts:25` |

## Не проверено (предположения)

1. **`sendRichMessage` принимает `reply_markup`** — предполагается, что да (`other?: Other<…>`), но план на это НЕ опирается: карточки пауз шлются через `sendMd` (базовый `sendMessage` + `reply_markup`). Проверять не нужно; если Code решит слать паузу rich-сообщением — сначала проверить `node_modules/grammy/out/core/api.d.ts:167` и типы `Other`.
2. **`produce` после `pauseOnToolCall` завершает прогон статусом `done`, а не оставляет `running`** — вывод из `chat.ts:1150-1175` (`hadContent` включает `approval`/`question`) и `chat-runs.ts:198-222`. Проверить: тест `chat-bridge.test.mjs` — после `forwardChatMessage` с паузой `readTurnState(cwd, threadId).status !== 'running'`. При расхождении (прогон остаётся `running`) — `answerChatApproval` упрётся в guard «уже идёт ход» (`chat-bridge.ts:118-127`), тогда перед resume вызывать `cancelChatRun`/`finishChatRun`.
3. **`readTurnState` после паузы не блокирует resume** — то же основание. Проверить тем же тестом; при расхождении — снимать guard для resume-тел (`approval`/`answer` в body).
4. **`toolCallId` из модели не содержит `:`** — не важно по конструкции (в `callback_data` его нет), но `chat-pause.ts` не должен парсить `toolCallId` из callback. Проверить: `parseChatCallback` тестами на `chata:allow`, `chatq:2`, мусор.
5. **Импорт `handlers.ts` в тесте не имеет побочных эффектов** — план этого избегает: `sendChatAnswer` и хелперы пауз живут в отдельных модулях, тесты импортируют только их. Если Code решит тестировать `handlers.ts` напрямую — сначала проверить, что модуль не выполняет код на верхнем уровне (сейчас только импорты и объявления).
6. **`options` в состоянии паузы достаточно для resume** — `answerChatQuestion` отправляет `optionId`, а сервер валидирует его против аргументов `ask_user` из jsonl (`chat.ts:1640-1660`). Проверить тестом `chat-bridge.test.mjs`: `ask_user` с вариантами `yes/no` → `answerChatQuestion(..., {optionId:'yes'})` → ход продолжается, в jsonl tool-результат `{"answer":{"id":"yes","label":…}}`.
7. **`/cancel` при уже завершённом прогоне безопасен** — `cancelChatRun` возвращает `false` без исключения (`chat-runs.ts:228-240`). Проверить тестом не нужно, но в коде не полагаться на возвращаемое значение.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 21:41
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic). План записан в задачу.
Состав плана: 2 части — (1) rich-отправка ответа персоны через `sendRichMessage` с фолбэком MarkdownV2 (`splitNumbered`) → plain; (2) UI пауз хода в боте: Allow/Deny/Always для `approval`, кнопки-варианты + свободный ввод для `question`, TTL 24 ч, `/cancel` гасит прогон.
Файлы (9): новые `src/bot/chat-answer.ts` (`sendChatAnswer`), `src/bot/chat-pause.ts` (чистые хелперы пауз: типы, клавиатуры, тексты, разбор `callback_data`), тесты к ним; правки `src/bot/chat-bridge.ts` (`ForwardResult` += `approval`/`question`, общий `runAndCollect`, `answerChatApproval`/`answerChatQuestion`, отказ от `cancelChatRun` на паузах), `src/bot/handlers.ts` (`sendMd` += `replyMarkup`, `deliverChatResult`, две точки вывода ответа персоны, callback-ветки `chata:`/`chatq:` до фильтра `:1585`, перехват свободного текста между `awaitingComment` и `/chat`, `/cancel`), `src/bot/chat-bridge.test.mjs`, doc-6, CHANGELOG.
Ключевые решения: `callback_data` без `toolCallId` (лимит 64 байта) — состояние паузы в module-state по `chatId`; `pricing(kind:'ask')` остаётся на «продолжите в вебе» (осознанное отклонение, AC9 допускает); `sendChatAnswer`/хелперы пауз вынесены в отдельные модули, чтобы тесты не тянули `handlers.ts`.
Риски: R1 лимит `callback_data` (снят схемой), R2 порядок обработчиков grammy (ловушка VL-37), R3 рестарт бота теряет состояние пауз (документируется), R4 MarkdownV2-фолбэк для GFM почти всегда уходит plain (AC3 требует «не потерять», не «сохранить разметку»), R5 дубли при частичной rich-отправке (существующее поведение), R6 `pricing` в вебе.
Разделы «Проверено по коду» (24 утверждения с `файл:строка`) и «Не проверено (предположения)» (7 пунктов с планом проверки) в плане присутствуют.
---
author: @agent
created: 2026-11-10 21:55
---
Фаза 3 (Code) выполнена. Коммит 28a756c.
Изменено (7 файлов):
- `src/bot/chat-answer.ts` (новый) — `sendChatAnswer(bot, chatId, text)`: `chunkRich` по rich-лимиту 32768 → `bot.api.sendRichMessage(chatId, { markdown })`; при исключении фолбэк `splitNumbered` (лимит 4096, резка по строкам) + MarkdownV2, затем plain (локальная копия `sendText`, чтобы не было цикла с handlers.ts).
- `src/bot/chat-pause.ts` (новый) — чистые хелперы пауз: `ChatPause`/`ChatCallback`, `parseChatCallback` (`chata:allow|deny|always`, `chatq:<i>`), `approvalKeyboard` (3 кнопки), `questionKeyboard` (по кнопке на вариант, 2 в ряду), `approvalText` (имя инструмента + превью аргументов + grant), `questionText` (вопрос + description вариантов в тексте), `expiredQuestionText`. `callback_data` без `toolCallId` — лимит Telegram 64 байта.
- `src/bot/chat-bridge.ts` — `ForwardResult` += `{approval}`/`{question}` (с `threadId`); тело вынесено в `runAndCollect`; на approval/question прогон НЕ гасится; новые `answerChatApproval`/`answerChatQuestion`; `NEEDS_WEB_TEXT` сужен до `pricing(kind:'ask')`.
- `src/bot/handlers.ts` — `sendMd` += `replyMarkup`; module-state `chatPauses` + `deliverChatResult` + `dropChatPause`; обе точки вывода ответа персоны переведены на `sendChatAnswer`; callback-ветки `chata:`/`chatq:` (с TTL-проверкой `isQuestionExpired`/`questionAskedAt`) до фильтра «чужие callback»; новый перехватчик `message:text` для свободного ответа (между `awaitingComment` и `/chat`); `/cancel` и новый `/chat` гасят висящую паузу через `cancelChatRun`.
- `src/bot/chat-answer.test.mjs`, `src/bot/chat-pause.test.mjs` (новые), `src/bot/chat-bridge.test.mjs` (обновлён: approval больше не needsWeb + тесты Allow/Deny/question/custom).
Проверки: `pnpm build` — успешно; `pnpm test` — полный прогон, 225 файлов / 4315 тестов passed, 4 skipped (пропуски — существующие `it.skip` проекта, не связаны с задачей).
Отклонения от плана: (1) `pricing(kind:'ask')` оставлен на «продолжите в вебе» — осознанно, AC9 это допускает; (2) `sendMdFallback` в `chat-answer.ts` — копия `sendText` (импорт дал бы цикл); (3) в тесте `chat-answer` фейковый bot не пишет вызов в журнал, если метод бросает — так проверяется, что MarkdownV2-попытка реально падала.
AC9 (doc-6) не отмечен: документацию по правилу фазы пишет Close. AC5 отмечен — rich-путь и фолбэк покрыты для обеих точек вывода (общий `sendChatAnswer` + тесты).
---
author: @agent
created: 2026-11-10 22:11
---
Фаза Close выполнена. Ветка vb/vl-414 слита в master (1 коммит, merge 2caa6d3), worktree удалена (force — только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-414 удалена.
Проверки после merge: `pnpm build` — успешно; точечный фильтр по diff (chat-answer/chat-pause/chat-bridge) — passed; полный прогон `pnpm test:fast` — 226 файлов / 4323 теста passed, 4 skipped (существующие `it.skip` проекта, не связаны с задачей). Повторных прогонов не было.
Документация (DoD-2, AC9): doc-6 — абзац «Команда бота /chat» переписан: rich-рендер ответа персоны (GFM + фолбэк MarkdownV2 → plain), кнопки Allow/Deny/Always allow для approval, кнопки-варианты + свободный ввод для ask_user, TTL вопроса 24 ч, что осталось в вебе (`pricing(kind:'ask')`), потеря пауз при рестарте бота. CHANGELOG.md — запись в Unreleased (раздел «Исправлено»). Коммит 46d8f06.
Lessons: lesson-288 (LLM-текст в Telegram — через sendRichMessage/GFM, а не MarkdownV2 без экранирования), lesson-289 (не класть идентификаторы в callback_data — лимит 64 байта, контекст в module-state). Коммит 8a8f3d7.
DoD: 1 (тесты) — выполнен полным прогоном; 2 (документация) — doc-6 + CHANGELOG; 3 (нет регрессий) — полный прогон зелёный, падений не классифицировалось.
---
<!-- COMMENTS:END -->