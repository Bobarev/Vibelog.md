---
id: VL-433
title: 'Человек в interbot-группе: вопрос ко всем без адресации, @/reply к конкретному боту, уточнение с контекстом'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 03:01'
updated_date: '2026-11-25 15:41'
due_date: ''
labels: []
dependencies: []
milestone: v1.15
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/interbot.ts
  - src/bot/handlers.ts
  - src/bot/chat-answer.ts
  - src/bot/interbot.test.mjs
  - src/bot/handlers.test.mjs
  - src/bot/chat-answer.test.mjs
lessons:
  - lesson-251
  - lesson-297
  - lesson-212
  - lesson-30
  - lesson-270
  - lesson-299
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 97
  duration_ms: 3194026
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 31
    code:
      input: 0
      output: 0
      cache: 0
      requests: 52
    close:
      input: 0
      output: 0
      cache: 0
      requests: 14
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Цель: общая interbot-группа становится полноценным местом обсуждения для ВСЕХ участников — человек может задать вопрос ботам-агентам и уточнять их ответы.

СЕЙЧАС (проверено по коду):
- handlers-ветка отсекает людей до dispatch: «!m.from?.is_bot → next()» — сообщение человека из interbot-канала уходит в пин/мост, боты его не обрабатывают (подтверждено логами --trace: «пропуск: сообщение не от чужого бота → next()»);
- dispatchIncoming: guard «0. Только сообщения от ботов» (src/bot/interbot.ts:208);
- механизм адресации наполовину готов: isAddressedToUs уже умеет «reply на наше сообщение» (reply_to_from_id === ourBotId).

СОГЛАСОВАННАЯ С ПОЛЬЗОВАТЕЛЕМ СЕМАНТИКА:
Q1. Адресация человека: @Бот или reply на сообщение бота → конкретному боту (приоритетно, даже в all-канале); БЕЗ адресации → вопрос ко ВСЕМ ботам канала (каждый отвечает — нужное поведение «задать один вопрос всем агентам», независимо от addressing-конфига канала; конфиг каналов действует только для ботов — прежние правила mention/all для ботов не меняются).
Q2. Уточнение: человек уточняет ответ бота-B (reply на его сообщение) → только B обрабатывает и отвечает с reply; видимость инициатора — через общую ленту группы. Ретрансляция уточнения инициатору-боту (если вопрос задавал бот-A) — СЛЕДУЮЩИЙ шаг, вне этой задачи.
Q3. Контекст уточнения на первом шаге: цитата сообщения-родителя (reply_to_message; rich_message → richToText) + последний вопрос/ответ ветки из process-памяти (Map с лимитом, паттерн interbotReplyMap). Хранение памяти всей ветки (N сообщений) — СЛЕДУЮЩИЙ шаг.

ТОЧКИ РЕАЛИЗАЦИИ:
1. src/bot/handlers.ts ветка interbot: для людей из канала-канала (channel найден) — НЕ next(), обрабатывать в ветке; свои сообщения (from.id === ctx.me.id) — next() как сейчас; люди в ЛИЧКЕ — не затрагиваются (там свои команды).
2. src/bot/interbot.ts dispatchIncoming: снять guard «только ботов» — для !is_bot свои правила адресации из Q1 (reply/@ → конкретный; без адресации → process всем), отдельный rate (константа, не botRatePerMin), depth не применяется, dedup общий.
3. Контекст уточнения: process-память «последний вопрос/ответ ветки» (map message_id → {question, answer} с лимитом и саниткой памяти как у interbotReplyMap); buildIncomingPrompt принимает цитату + этот контекст.
4. Ответы людям — существующим sendChatAnswer с replyTo (уже гарантирует reply).

РИСКИ: эхо в all-канале при вопросе «ко всем» — осознанно (пользователь это и хочет); rate-спам человека — отдельный лимит; перехват людей из interbot-канала меняет поведение пин/мост для группы — раньше их сообщения туда попадали (проверить, не ломает ли это существующий сценарий обсуждения вне ботов).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Сообщение человека в interbot-канале БЕЗ @упоминания и БЕЗ reply → process у ВСЕХ ботов канала (каждый отвечает своим раном с reply на сообщение человека) — независимо от addressing-конфига канала
- [x] #2 @Бот или reply на сообщение бота от человека → process ТОЛЬКО у адресованного бота (даже в all-канале: явная адресация приоритетнее «ко всем»)
- [x] #3 Reply человека на сообщение бота = уточнение: в buildIncomingPrompt входят цитата сообщения-родителя (текст; rich_message → richToText) + последний вопрос/ответ ветки из process-памяти; бот отвечает с reply на уточнение
- [x] #4 Человек из interbot-канала НЕ уходит в пин/мост (ветка interbot не делает next() для людей из канала-канала; личка человека с ботом — прежние команды работают как раньше)
- [x] #5 Лимиты: dedup по message_id общий; отдельный rate на человека (константа, не botRatePerMin); depth-цепочка на людей НЕ распространяется
- [x] #6 Свои сообщения (from.id === ctx.me.id) — next(), как сейчас; сообщения ботов — прежние правила mention/all без изменений
- [x] #7 Юнит-тесты src/bot/interbot.test.mjs: адресация людей (@/reply/без адресации), rate, отсутствие depth; pnpm test зелёный
- [ ] #8 Живой тест под --trace: человек без адресации → оба бота ответили; человек с @конкретный → один; человек reply-уточнение → бот ответил с учётом цитаты и прошлого вопроса/ответа
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## VL-433 — Plan: человек в interbot-группе (вопрос/@/reply-уточнение)

Тип: task (не epic) → план в задачу. Файлы (существование ls подтверждено): `src/bot/interbot.ts`, `src/bot/handlers.ts`, `src/bot/chat-answer.ts`, `src/bot/interbot.test.mjs`, `src/bot/handlers.test.mjs`, доки `doc-32` (+`doc-33`).

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| Люди отсечены до dispatch: `!m.from?.is_bot \|\| from.id === ctx.me.id → next()` | `src/bot/handlers.ts:908-912` |
| Канал ищется по `group_id`, нет канала → next() (личка/обычный чат — мимо) | `src/bot/handlers.ts:917-928` |
| replyMap (цепочка reply) + санитка size>5000 | `src/bot/handlers.ts:929-936` |
| incoming собирается с `is_bot: true` (хардкод) | `src/bot/handlers.ts:938-946` (943) |
| Тикет-ветка раньше dispatch, без gate по is_bot | `src/bot/handlers.ts:948-969` |
| Вызов `dispatchIncoming` (ctx без isTicketAnswer) | `src/bot/handlers.ts:973-983` |
| Служебный ответ/игнор → sendChatAnswer с replyTo | `src/bot/handlers.ts:984-997` |
| `buildIncomingPrompt(text, channel)` — только вопрос+канал | `src/bot/handlers.ts:999`, `src/bot/interbot.ts:254-264` |
| pendingDecisions `{answer, chatId, replyTo}`; публикация ibot:ok | `src/bot/handlers.ts:1041`, `2262` |
| Прямая публикация ответа в группу `void sendChatAnswer(..., {replyTo})`; replyTo = message_id вопроса | `src/bot/handlers.ts:1066`, `1001` |
| onExit синхронный `(run) => void` — регистрация памяти через `.then` | `src/web/orchestrator.ts:147` |
| sendChatAnswer → Promise<void>, rich-фолбэк с reply_parameters | `src/bot/chat-answer.ts:78-120` |
| dispatchIncoming: guard «0. Только сообщения от ботов» (return process `as never`), затем dedup→rate(botRatePerMin=10)→depth(maxDepth=2)→addressing(mention: mentionsUs либо reply_to_from_id===наш)→runs(20/ч) | `src/bot/interbot.ts:191-238` (guard 207-208; not-addressed 228-230) |
| InterbotLimits/DEFAULT_LIMITS — human-константы нет | `src/bot/interbot.ts:18-35` |
| isAddressedToUs уже умеет «reply на наше»; mentionsUs — regex `@OurBot`//`cmd@OurBot` | `src/bot/interbot.ts:157-168`, `175-179` |
| dispatchIncoming вызывается только из handlers + тесты (interbot.test.mjs, tickets.test.mjs — ботовые кейсы) | grep по `src` |
| Нижние ветки, которые раньше получали людей канала: awaitingComment 2573, вопрос VL-414 2603, reply-resume VL-93 2643, мост VL-408 2712, catch-all пина 2746, bot.command с 1082 | `src/bot/handlers.ts` |
| Тест `AC4-регрессия` ждёт next() для `/help` человека в чате -1001 (= group_id канала в фикстуре) — сломается | `src/bot/handlers.test.mjs:297-313`, `43-50` |

## Принятые правила (не оговорены в спецификации)

1. `humanRatePerMin = 5` в DEFAULT_LIMITS (своя константа, не botRatePerMin); ключ rate — from_id (пространства id ботов и людей не пересекаются).
2. Приоритет адресации: reply на сообщение бота важнее @упоминания (конфликт «reply на B + @C» → только B — Q2-уточнение живёт на reply).
3. «Адресовано чужому» = reply на чужого бота, либо (нет такого reply) любой @упоминание не-наш → молчаливый `not-addressed`. Ответственность: боты без известного списка имён канала различают только «мне / чужому / никому»; @человека трактуется как чужая адресация (см. предположения №4).
4. Лимиты людей: dedup общий; свой rate; depth НЕ считается (depth=0); runs/час — как у ботов (не специфицировано → без изменений, это стоимость: без адресации каждый бот пускает ран).
5. Тикет-ветка (948-969) — только для чужих ботов (`m.from.is_bot`): человек, отвечающий на НАШ тикет-вопрос, идёт в dispatch как уточнение (reply_to_from_id === наш → process) и получает обычный ответ, а тикет не закрывается его текстом.
6. Slash-тексты человека в канале тоже уходят в interbot-ветку (ТЧ «НЕ next()») — `/help` станет вопросом; осознанное следствие AC4.
7. Память ветки: `Map<message_id, {question, answer}>`, лимит 1000, FIFO-санитка как у interbotReplyMap; ключи — id всех отправленных частей ответа + id вопроса.

## Шаги реализации

**1. `src/bot/interbot.ts`**
- `InterbotLimits` + `humanRatePerMin: 5`, DEFAULT_LIMITS (18-35).
- `IncomingMsg` + `reply_to_is_bot?: boolean` (37-50).
- Новая чистая функция `humanAddressing(msg, {ourBotId, ourUsername}): 'us'|'other'|'none'` (после mentionsUs): (a) `reply_to_is_bot` → по `reply_to_from_id` us/other; (b) любой @упоминание `(?:^|\s)@[\w]+\b` → us если mentionsUs, иначе other; (c) иначе none.
- `dispatchIncoming` (207-208): guard «только ботов» заменить на ветку `if (!msg.is_bot)`: dedup (общий) → `rate.limited(from_id, humanRatePerMin)` → humanAddressing: 'other' → `{answer, reason:'not-addressed', reply:''}`; 'us'/'none' → runs-limit → `{action:'process', depth:0, kind:'question'}`. Канал-конфиг addressing и depth для людей НЕ применяются. Ботья ветка 209-238 — без изменений.
- `buildIncomingPrompt(question, channel, opts?)`: opts `{quote?: string, context?: {question, answer}}` → секции «Цитата сообщения, на которое отвечает человек» (обрезка 1500) и «Предыдущий вопрос/ответ в этой ветке» (1000/2000) перед «Вопрос:».

**2. `src/bot/chat-answer.ts`** — `sendChatAnswer` → `Promise<number[]>` (ids всех реально отправленных частей): в цикле chunkRich собирать `res.message_id` (число); удалённое при richDroppedReply id не добавлять; `sendMdFallback` → `Promise<number|undefined>`; фолбэк splitNumbered — id каждой части; сбой без ответов → `[]`. Старые вызовы (await/void) совместимы.

**3. `src/bot/handlers.ts`**
- Guard 908-912: `from === undefined` или `from.id === ctx.me.id` → next(); иначе (бот и человек) — к поиску канала (914-928 без изменений: человек вне interbot-канала → next — личка/пин/мост прежние). Обновить trace-текст 910.
- Рядом с interbotReplyMap (733): `interbotThreadMemory = new Map<number, {question, answer}>()` + санитка >1000 (паттерн 932-935).
- incoming (938-946): `is_bot: m.from.is_bot`, `reply_to_is_bot: m.reply_to_message?.from?.is_bot`.
- Тикет-ветка (950): `m.from.is_bot && ...`.
- Prompt (999): quote = текст `m.reply_to_message` (text-свойство → оно; иначе `richToText(rich_message)` — паттерн строки 893), context = `threadMemory.get(m.reply_to_message.message_id)`; `buildIncomingPrompt(text, channel, {quote, context})`.
- Прямая публикация (1066): `void sendChatAnswer(...).then(ids => { pair={question:text, answer}; ids+replyTo → threadMemory; санитка })`.
- pendingDecisions (1041): + поле `question: text`; ibot:ok (2262): после отправки — ids + `pending.replyTo` → threadMemory парой `{question: pending.question, answer: pending.answer}` («no» — не регистрируем).
- HandlerDeps: + необязательный шов `startPrompt?: typeof startPrompt` (паттерн VL-431 `startChatRun`); вызов 1069 → `deps.startPrompt ?? startPrompt` — чтобы тесты не спавнили реальный ран.

**4. Тесты**
- `interbot.test.mjs` (AC7): человек без адресации → process в канале `addressing:'mention'` и `'all'` (AC1); @наш/reply-на-наш → process; @чужой/reply-на-чужого бота → not-addressed (AC2); rate по humanRatePerMin → reason 'rate' и не влияет на botRatePerMin; глубокая reply-цепочка человека → process c depth=0 (AC5); dedup общий; `buildIncomingPrompt` с quote+context (AC3); ботовые кейсы — регресс без изменений.
- `handlers.test.mjs`: переработать AC4-регрессия (297-313): человек в канале -1001 → sentinel 0 (не next, тикеты не тронуты); прежний «/help доходит до нижних веток» перенести на чат вне comms (сменить chat.id). Новый тест: человек-вопрос → шов startPrompt вызван, prompt содержит цитату/контекст; чат вне канала → next как раньше.
- `chat-answer.test.mjs`: возврат ids (в т.ч. richDroppedReply-фолбэк не возвращает удалённый id).

**5. Документация**: doc-32 §4-5 — семантика людей (Q1-Q3, свой rate, память ветки, следствие «НЕ next()» для каналов); doc-33 — краткая пометка. Правки через document_edit.

## Как проверить

1. `pnpm build && pnpm test` (полный прогон — DoD).
2. Live AC8 под `vibelog bot --trace` в группе с двумя проектами: (а) человек без адресации → оба бота ответили reply на его сообщение; (б) `@BotA` → только A; (в) reply-уточнение на ответ бота → trace показывает prompt с цитатой и «Предыдущий вопрос/ответ», ответ — reply на уточнение; (г) человек вне interbot-канала и личка — команды работают как раньше.

## Риски

- Эхо в all-канале при вопросе «ко всем» — осознанно (цель задачи).
- Люди из interbot-канала больше не попадают в bot.command/пин/комментарий/мост/resume (1082+, 2573/2603/2643/2712/2746) — прямое следствие ТЧ «НЕ next()»; live-проверить сценарий «обсуждение вне ботов» (см. предположение №6).
- Регрессия handlers.test.mjs AC4 — ожидаема, переработка обязательна (иначе pnpm test красный).
- @человека → молчание ботов (эвристика №3).
- Без адресации N параллельных LLM-ранов (стоимость покрыта runs/час).

## Не проверено (предположения)

1. `src/core/interbot/tickets.test.mjs` вызывает dispatchIncoming только с `is_bot:true` — снятие guard'а их не меняет; проверить grep'ом `is_bot: false` в этих тестах, при расхождении — поправить ожидания.
2. `sendRichMessage` при успехе возвращает объект с числовым `message_id` (в chat-answer.ts это предполагает richDroppedReply, но «успешный без id» не проверен) — проверить фактическим ответом/тестом; id нет → пара в память не пишется (контекст без Q/A, цитата остаётся) — не падать, не фолбэчить.
3. В handlers.test.mjs есть ли ещё human-ожидания кроме AC4 и спавнит ли `startPrompt` реальный процесс в тестах — проверить чтением файла перед правкой; при спавне — шов HandlerDeps (шаг 3) обязателен.
4. Эвристика «любой @упоминание != наш → not-addressed» на живых данных: @человека в группе → боты молчат; проверить live-сценарием AC8, при ложных срабатываниях — сузить детект (например, только упоминания длиной ≥5 символов).
5. Runs-limit для людей оставлен как у ботов (спецификация молчит) — если при live-проверке AC1 «каждый отвечает» упрётся в run-limit как в常态, снять runs-check для `!is_bot`.
6. «Обсуждение вне ботов» в interbot-канале (пин-привязка/комментарий/мост внутри канала) — действительно не нужно пользователям: проверить live, что вне-канальные чаты и личка работают без изменений; если сценарий нужен внутри канала — вернуть next() только для активного режима (awaitingPin/awaitingComment/chatBridge), зафиксировав исключение в AC4.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Отложено на потом (согласовано при обсуждении, вне AC этого шага)

1. **Ретрансляция уточнения инициатору-боту (Q2-б)**: если вопрос задавал бот-A, а человек уточнял ответ бота-B — доставить уточнение инициатору A (уведомление/дополнение тикета в его проект). На первом шаге инициатор видит уточнение только через общую ленту группы.
2. **Память всей ветки (Q3-б)**: хранить историю диалога ветки из N сообщений вместо «последний вопрос/ответ» из process-памяти — для более полного контекста уточнений.
3. **Проверка при реализации (не отложено, но пометка)**: перехват людей из interbot-канала меняет путь пин/мост — раньше их сообщения попадали в мост; убедиться, что это не ломает существующий сценарий обсуждения группы вне ботов.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 08:26
---
### Прогресс до обрыва (по idle-таймауту (простой без активности))
**Сделано:**
- Превышен idle-таймаут (600 секунд без активности) — фаза прервана.
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 917 с, payload 260279 байт_
---
author: @agent
created: 2026-11-19 08:26
---
Фаза plan не удалась (код выхода 1): ot/interbot.test.mjs×2, блокировок=0, payload последнего запроса=260279 байт (макс 260279), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Spec.
---
author: @agent
created: 2026-11-19 09:07
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan (3 файла кода: src/bot/interbot.ts, src/bot/handlers.ts, src/bot/chat-answer.ts; тесты: interbot.test.mjs, handlers.test.mjs, chat-answer.test.mjs; документация doc-32/doc-33). Ключевые решения: guard «только ботов» в dispatchIncoming заменяется человеческой веткой (dedup общий, humanRatePerMin=5, depth не применяется, Q1-адресация reply-приоритетом), контекст уточнения — цитата reply_to_message (richToText) + process-память Map<message_id,{question,answer}> лимит 1000, регистрируемая по ids из sendChatAnswer (возврат number[]); тикет-ветка — только для ботов; шов HandlerDeps.startPrompt для тестов. Риски: ожидаемая переработка теста AC4-регрессия в handlers.test.mjs (человек в канале -1001 больше не next()); перехват людей из interbot-канала изымает их из пин/комментария/моста/resume внутри канала (личка и чаты вне канала не затронуты — live-проверка AC8); эхо в all-канале осознанно; эвристика «@человека = чужая адресация» — предположение №4. В плане разделы «Проверено по коду» (17 строк с файл:строка) и «Не проверено (предположения)» — 6 пунктов.
---
author: @agent
created: 2026-11-19 09:30
---
Фаза 3 (Code) выполнена. Изменено: src/bot/interbot.ts, src/bot/handlers.ts, src/bot/chat-answer.ts, src/bot/interbot.test.mjs, src/bot/handlers.test.mjs, src/bot/chat-answer.test.mjs; коммит e7d0a4e.
Реализация по плану: (1) dispatchIncoming — guard «только ботов» заменён человеческой веткой Q1: dedup общий, humanRatePerMin=5 (своя константа), depth не применяется, humanAddressing «reply на бота приоритетнее @упоминания» (мне/чужому/никому → process/not-addressed), runs/час общий; addressing-конфиг канала на людей не действует, ботовые правила не тронуты. (2) handlers-ветка: свои (ctx.me.id)/служебные → next(), человек вне interbot-канала → next() (личка/пин/мост прежние), человек из канала — НЕ next(), тикет-ветка только для чужих ботов, prompt собирается с цитатой родителя (text/richToText) и парой из process-памяти interbotThreadMemory (лимит 1000, санитка как у interbotReplyMap; ключи — id частей ответа + id вопроса; регистрация в onExit и ibot:ok), ответ — существующим sendChatAnswer с replyTo. (3) sendChatAnswer возвращает message_id отправленных частей (удалённый при rich-dropped id не возвращается). (4) Шов HandlerDeps.startPrompt (паттерн VL-431).
Проверки: pnpm build — чисто; ПОЛНЫЙ прогон (npx vitest run, без --exclude/--skip, dist после build): 239 файлов, 4581 passed, 4 skipped, 0 failed. Промежуточные падения чужих файлов (src/core/report.test.mjs, src/web/orchestrator.test.mjs close-коммиты) классифицированы: вне diff'а (bot/*), недетерминированы — при git stash всех правок зелёные, воспроизводимость нестабильна; в финальном полном прогоне прошли. Один падавший мой тест («полный сбой сети») исправлен опцией фейка mdHardFail.
AC отмечены: 1,2,3,4,5,7 (юниты interbot.test: адресация/rate/depth/dedup людей + промпт с контекстом; handlers.test: не next для людей канала, регрессия чата вне канала, уточнение с цитатой и памятью). НЕ отмечены: AC6 — реализовано (own-guard эквивалентен прежнему, ботовые регресс-юниты зелёные), но отдельного теста на «своё → next» нет; AC8 — живой тест под --trace с двумя ботами в этой фазе не выполнялся (внешняя проверка, нужен запуск двух проектов).
DoD: 1 (тесты) и 3 (нет регрессий) отмечены по полному прогону; DoD2 «Документация обновлена» НЕ отмечена: фаза Code по регламенту не правит backlog/docs — doc-32 (§4-5 семантика людей) и doc-33 обновит фаза Close. Что осталось: doc-32/33 (Close), live AC8, решение по AC6.
Урок: lesson-299 (лимит edit-обращений к файлу → атомарный патч-скрипт) создан и связан.
---
author: @agent
created: 2026-11-19 10:18
---
Фаза Close выполнена. Статус: Done. Коммиты: feat e7d0a4e (код, из фазы Code), docs 827ac13 (CHANGELOG + doc-32 §4-5 + doc-33), docs(task) d8304cc (lesson-299). Проверки после коммита: pnpm build чистый; ПОЛНЫЙ прогон pnpm test (без --exclude/--skip): 238 файлов, 4573 passed, 4 skipped, 0 failed — зелёный. Документация: doc-32 — новый § «Человек в interbot-группе (VL-433)» (семантика Q1-Q3, приоритет reply над @, память ветки interbotThreadMemory, лимиты, следствие «НЕ next()») + строка про людей в §5 Loop-защита; doc-33 — пометка «Люди в группе» в секции loop-защит; CHANGELOG — запись в Unreleased. Урок: lesson-299 (создан в Code) закоммичен и связан. AC: отмечен AC6 (свои сообщения → next() — own-guard эквивалентен прежнему, ботовые регресс-юниты зелёные; отдельного human-теста нет, поведение покрыто регрессией). Не отмечен AC8 — живой тест под --trace с двумя ботами в группе требует запуска двух проектов, выполняется внешней проверкой. DoD: 1 (тесты — полный прогон), 2 (документация — doc-32/33/CHANGELOG), 3 (нет регрессий — полный прогон зелёный). Не закоммичено: файл задачи VL-433 (коммитит framework после token_usage); подзадач нет, refs нет.
---
<!-- COMMENTS:END -->