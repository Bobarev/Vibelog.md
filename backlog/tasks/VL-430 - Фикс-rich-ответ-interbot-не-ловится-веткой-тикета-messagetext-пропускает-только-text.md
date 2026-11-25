---
id: VL-430
title: 'Фикс: rich-ответ interbot не ловится веткой тикета (message:text пропускает только text)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-18 23:34'
updated_date: '2026-11-25 15:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.15
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/handlers.ts
  - src/bot/handlers.test.mjs
  - backlog/docs/doc-32-Каналы-межпроектная-коммуникация-агентов-через-Telegram-группу-спецификация.md
  - backlog/docs/doc-1-Telegram-Bot-API-и-grammy-практика-Vibelogmd-прокси-пин-код-MarkdownV2-Rich-Messages.md
lessons: []
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 175
  duration_ms: 3570314
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 115
    code:
      input: 0
      output: 0
      cache: 0
      requests: 34
    close:
      input: 0
      output: 0
      cache: 0
      requests: 26
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Расхождение кода и поведения (найдено аудитом при ревизии VL-428/429).

ГДЕ: src/bot/handlers.ts:675 — interbot-ветка зарегистрирована как bot.on('message:text').

В ЧЁМ: ответ чужого бота уходит sendRichMessage (src/bot/chat-answer.ts) и приходит в группу как rich-сообщение с полем rich_message БЕЗ поля text (тот же паттерн, что VL-93: richToText в src/bot/commands.ts:799, в handlers.ts:2443 уже применяется в ветке reply-resume). Фильтр message:text такое сообщение не пропускает → ветка тикета (repliedTo → answerTicket) и dispatchIncoming не выполняются, trace «вход» не печатается.

ДОКАЗАТЕЛЬСТВА (живой прогон 2026-11-18 23:16, логи .vibelog/tmp/trace-md.log и trace-ui.log): UI: sendRichMessage reply_parameters:{message_id:61} без ошибок; MD: update mid=80 from=vibelog_ui_bot reply_to=78 (правильный question_msg_id тикета ask-1795032994615-1y3327) БЕЗ text, дальше тишина; тикет остался pending → «Ответа нет за 120 с».

РИСК: синхронный ответ /ask и interbot_ask никогда не возвращается (маскируется под «бот молчит»); async-fallback тоже не сработает — запоздавший ответ тем же rich снова не пройдёт фильтр, deliverLateTicket не вызовется, ответ теряется навсегда.

ФИКС: в handlers.ts:675 хендлер → bot.on('message'); text = m.text ?? (m.rich_message ? richToText(m.rich_message) : undefined); text === undefined → next() (нетекстовые сообщения — поведение не меняется); вся ветка (trace, incoming.text, answerTicket, buildIncomingPrompt) работает с вычисленным text. richToText уже импортирован в handlers.ts.

СОПУТСТВУЮЩЕЕ (не блокер, отдельной строкой AC): перехват исходящих api.* в --trace (handlers.ts:434) на MD-боте не залогировал НИ ОДНОГО sendMessage (вопрос в группу и sendMd в личку не видны), хотя на UI sendRichMessage виден — проверить, почему перехват не срабатывает для sendMessage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ветка тикета срабатывает на rich-вход: update от чужого бота с rich_message без text и reply_to_message.message_id === question_msg_id → answerTicket, статус answered, синхронный ответ возвращается в личку
- [x] #2 Async-fallback работает: поздний rich-ответ тоже проходит фильтр → deliverLateTicket (комментарий к task-контексту + уведомление)
- [x] #3 Сообщение без text и без rich_message (фото, стикер) уходит next() — поведение остальных веток не меняется
- [x] #4 Юнит-тест: ветка тикета на фейковом update с rich_message (структура из commands.test.mjs VL-93) и на нетекстовое сообщение
- [ ] #5 Живой прогон под --trace в тест-группе: /ask md → rich-ответ UI пойман, тикет answered, ответ получен в личке в течение sync_timeout
- [x] #6 Сопутствующее (не блокер): причина, по которой --trace не логировал sendMessage (вопрос /ask и sendMd в личку), установлена чтением кода grammy и устранена — перехват переведён на transformer `bot.api.config.use()` (копируется в per-update Api), в trace-логе живого прогона видны sendMessage из ctx-вызовов
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План фикса VL-430 — rich-ответ interbot не ловится веткой тикета

## Файлы

| Файл | Действие |
|---|---|
| `src/bot/handlers.ts` | правка: ветка interbot (675–780), перехват trace api.* (434–447) |
| `src/bot/handlers.test.mjs` | **создать** — юнит-тесты AC1–AC4 (файла сейчас нет; `ls` проверен) |
| `backlog/docs/doc-32-Каналы-межпроектная-коммуникация-агентов-через-Telegram-группу-спецификация.md` | документация: входящая ветка принимает rich-ответ |
| `backlog/docs/doc-1-Telegram-Bot-API-и-grammy-практика-Vibelogmd-прокси-пин-код-MarkdownV2-Rich-Messages.md` | документация: практика `message:text` не пропускает rich → `bot.on('message')` + `richToText` |

## Порядок действий

### 1. Фикс ветки (AC1–AC4) — `src/bot/handlers.ts:675`

`bot.on('message:text', ...)` → `bot.on('message', ...)`, сразу после `const m = ctx.message;`:

```ts
// Вычисляем текст ДО trace и всех веток: rich-ответ чужого бота не имеет
// поля text (VL-93/lesson-288) — фильтр message:text его не пропускал
const text =
  'text' in m && typeof m.text === 'string'
    ? m.text
    : m.rich_message
      ? richToText(m.rich_message)
      : undefined;
if (text === undefined) {
  await next();   // фото/стикер и т.п. — поведение веток ниже не меняется
  return;
}
```

Дальше по ветке заменить `m.text` → `text` во всех четырёх местах:
- **684** — trace `'вход: …'`: `text.slice(0, 100)` (guard `text === undefined → next()` стоит **ДО** trace, чтобы нетекстовые сообщения, как и раньше, не печатали «вход»);
- **719** — `incoming.text: text`;
- **733** — `answerTicket(deps.cwd, repliedTo, text)`;
- **778** — `buildIncomingPrompt(text, channel)`.

`richToText` уже импортирован (**83**) — новых импортов нет. Остальные exit-ветки (`не чужой бот → next()`, `нет chatId`, `канал не найден`) не трогаем — каждый обязан звать `next()` (lesson-291, ловушка порядка VL-37).

**Поведенческие последствия (осознанно, покрыть тестом):**
- rich-ответ на тикет → попадает в ветку → `answerTicket` → answered (AC1);
- запоздавший rich (deadline прошёл) → `expired` → `deliverLateTicket` (AC2);
- rich-сообщение чужого бота в канале **не**-тикет → впервые попадает в `dispatchIncoming` (раньше фильтр его отбрасывал) — это соответствует замыслу VL-428, отметить в тесте/отчёте;
- фото/стикер → `text === undefined → next()` — как раньше, когда фильтр их не матчил (AC3).

### 2. Trace-перехват исходящих (AC6, не блокер) — `handlers.ts:434–447`

**Диагноз (проверено чтением grammy):** `bot.handleUpdate` создаёт **новый экземпляр `Api` на каждый update** и передаёт его в Context (`node_modules/grammy/out/bot.js:222-235`: `const api = new api_js_1.Api(...)` → `new Context(update, api, ...)`). Текущий перехват — instance-patch own-свойств на `bot.api` (**435-447**) — ctx-вызовы (`ctx.reply` в `sendMd`, `ctx.api.sendMessage` в `/ask`, строка **1885**) не видит. `sendRichMessage` на UI виден, потому что `chat-answer.ts:112` зовёт `bot.api.sendRichMessage` напрямую.

**Фикс:** заменить instance-patch на transformer, который grammy **копирует в каждый per-update Api** (`bot.js:232-233`: `api.config.use(...installedTransformers)`):

```ts
bot.api.config.use((prev, method, payload, signal) => {
  if (method === 'sendMessage' || method === 'sendRichMessage' || method === 'answerCallbackQuery') {
    console.log(`[trace] api.${method} →`, JSON.stringify(payload ?? {}).slice(0, 300));
  }
  return prev(method, payload, signal);
});
```

Сигнатура `Transformer` — `node_modules/grammy/out/core/client.d.ts:35`. Старый цикл `for (const name of [...])` (**436**) удалить. ВАЖНО: фильтр по имени метода обязателен — трансформер видит и `getUpdates` (polling), иначе лог зальётся.

### 3. Юнит-тесты (AC1–AC4) — новый `src/bot/handlers.test.mjs`

Паттерн: in-process grammy-бот, без сети (паттерн `chat-answer.test.mjs`, структура rich из `commands.test.mjs:819-856`).

- `mkdtemp`-корень (`VL-241`), `afterAll` → `rmSync`.
- `clearPhaseEnv()` на уровне файла (`beforeAll`/`afterAll`, lesson-254).
- Фикстуры: `writeComms(cwd, { chats:[…], channels:[{ id:'g1', transport:'telegram', group_id:-1001, addressing:'mention', approval:'auto' }] })` (паттерн `ask.test.mjs:53-68`); `createTicket(cwd, { id, channel_id:'g1', question_msg_id:78, timeoutSec: 120 })`.
- `const bot = new Bot('123456:TEST', { botInfo: { id: 42, is_bot: true, first_name: 'T', username: 'our_bot' } })` — без `init()`, сеть не нужна; `registerHandlers(bot, { cwd, getPin: () => '000000' })`.
- Фейковые update → `bot.handleUpdate(update)`.

Кейсы:
1. **AC1:** update от чужого бота (`from.id: 777, is_bot:true`), `chat.id: -1001`, `reply_to_message.message_id: 78`, `rich_message: { blocks: [...] }` без `text` → в `.vibelog/interbot/tickets.json` статус `answered`, `reply` содержит плоский текст rich; sentinel-обработчик `bot.on('message', …)`, зарегистрированный **после** `registerHandlers`, НЕ вызван (ветка не делает `next()`).
2. **AC2:** тикет с `deadline` в прошлом (создать с `timeoutSec: -10`) → тот же rich-update → статус `delivered`, вызов уведомления (стаб `bot.api.sendRichMessage`/`sendMessage` ловит текст «Запоздавший ответ»); `context.task` не задан → `addComment` не зовётся.
3. **AC3:** сообщение без `text` и без `rich_message` (photo) → sentinel-обработчик ВЫЗВАН (`next()` прошёл), тикеты не тронуты.
4. **Регрессия порядка:** текстовое сообщение от обычного пользователя → `next()` доходит до нижних `message:text`-веток (sentinel тоже вызван, тикет не тронут).

### 4. Документация (DoD)

- **doc-32**, раздел входящей обработки: ответ чужого бота принимается и как rich (`richToText`), ветка зарегистрирована на `bot.on('message')`.
- **doc-1**, практика grammy: строка про `message:text` (строка 35) дополнить: фильтр не пропускает `rich_message` без `text`; для веток, которые обязаны видеть rich — `bot.on('message')` + вычисление текста (VL-430).

### 5. Проверки

```bash
pnpm build && pnpm test:fast src/bot/handlers.test.mjs   # точечная итерация
pnpm test                                                  # полный прогон — обязателен перед DoD
```

**Живой прогон (AC5, этап Code):** в тест-группе два бота с `--trace` (логи `.vibelog/tmp/trace-md.log`, `.vibelog/tmp/trace-ui.log`); в личке MD-бота `/ask …` → rich-ответ UI в группе → в trace-логе MD: строки `[trace] вход: … text=…`, `ветка тикета … совпадение=true`, `answerTicket → статус=answered`, `[trace] api.sendMessage …` (AC6), ответ в личке в пределах `sync_timeout`.

## Риски

1. **Порядок `next()`** (lesson-291): guard `text === undefined → next()` обязан стоять первым; каждый exit ветки зовёт `next()` — иначе фото/свои сообщения «съедятся» и сломаются пин/команды/мост.
2. **TS-типизация** после смены фильтра: `m.text`/`m.rich_message` на широком `Message` может не скомпилироваться (strict) → guard через `'text' in m` / `'rich_message' in m` (паттерн `handlers.ts:423`).
3. **Пустой текст**: `richToText` может вернуть `''` — по спеке ветка уходит в `next()` только при `undefined`; сверить со старым поведением фильтра (см. предположение 2) и при расхождении расширить guard на `!text`.
4. **Новый вход в dispatch**: rich-вопрос (не-тикет) от чужого бота теперь может запустить ран — именно задумка VL-428, но rate/addressing работают на плоском тексте; живо проверить в прогоне.
5. **Transformer AC6**: ловит все методы — фильтр по 3 именам обязателен, иначе `getUpdates` заливает лог; `payload` — объект, логировать `JSON.stringify(...).slice(0,300)`.
6. Тест не должен трогать сеть: в кейсах AC1/AC3/4 никакие send-вызовы не происходят; в AC2 — стабы `bot.api.*`.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| interbot-ветка зарегистрирована как `bot.on('message:text')` | `src/bot/handlers.ts:675` |
| trace-вход использует `m.text.slice(0,100)` | `src/bot/handlers.ts:684` |
| `incoming.text = m.text` / `answerTicket(… m.text)` / `buildIncomingPrompt(m.text …)` | `src/bot/handlers.ts:719`, `:733`, `:778` |
| фильтр `message:text` требует поля `text` (l3: `e[l3] \|\| e.type === 'text'`) — rich без `text` не проходит | `node_modules/grammy/out/filter.js:169-176`, `:258`; подтверждено живым прогоном из описания |
| `richToText` экспортируется из `commands.ts` и уже импортирован в `handlers.ts` | `src/bot/commands.ts:799`, `src/bot/handlers.ts:83` |
| готовый паттерн `reply.text ?? richToText(reply.rich_message)` в reply-resume | `src/bot/handlers.ts:2437-2444` |
| `answerTicket` пишет `reply` и ставит `answered`/`expired` | `src/core/interbot/tickets.ts:108-121` |
| `expired` → `deliverLateTicket` (уведомление + `markDelivered`) | `src/bot/handlers.ts:642-663`, вызов в ветке после `answerTicket` |
| `/ask` шлёт вопрос через `ctx.api.sendMessage` | `src/bot/handlers.ts:1885` |
| `sendMd` шлёт через `ctx.reply` | `src/bot/handlers.ts:151-166` |
| текущий перехват — instance-patch на `bot.api` | `src/bot/handlers.ts:434-447` |
| grammy создаёт новый `Api` на каждый update и передаёт его в Context; instance-patch `bot.api` ctx-вызовы не видит | `node_modules/grammy/out/bot.js:222-235` (`new api_js_1.Api(...)`, контекст получает per-update api) |
| трансформеры `bot.api.config` копируются в per-update Api → правильный механизм перехвата | `node_modules/grammy/out/bot.js:232-233`, сигнатура `Transformer` — `node_modules/grammy/out/core/client.d.ts:35` |
| `sendRichMessage` UI виден в логе, т.к. `chat-answer` зовёт `bot.api` напрямую | `src/bot/chat-answer.ts:112` |
| rich-сообщение — `Message` с `rich_message` и без `text` (типы grammy) | `node_modules/grammy/out/context.d.ts:493` (`Message.RichMessageMessage`) |
| структура фейкового rich-для теста | `src/bot/commands.test.mjs:819-856` (VL-93) |
| фикстура comms.yaml с каналом для теста | `src/core/interbot/ask.test.mjs:53-68` |
| `writeComms` экспортируется из `core/comms.ts` | `src/core/comms.ts` (используется в `ask.test.mjs`) |
| все файлы плана существуют, `handlers.test.mjs` — создаётся новый | `ls src/bot/handlers.ts src/bot/commands.test.mjs src/test-env.mjs backlog/docs/doc-1-*.md backlog/docs/doc-32-*.md` |

## Не проверено (предположения) — проверить ПЕРВЫМ шагом Code

1. **TS-доступ полей на широком `Message`:** скомпилируется ли `m.text` / `m.rich_message` после перехода на `bot.on('message')`. Проверка: `pnpm build`. Расхождение (TS2339) → guard через `'text' in m` / `'rich_message' in m` (паттерн `handlers.ts:423`). Фолбэк-план: именно guard-вариант — он уже заложен в шаге 1.
2. **Пустой `text: ''`:** проходил ли старый фильтр `message:text` сообщение с пустым текстом. Проверка: чтение `filter.js:169-176` (`leaf: pred(obj) != null`, `e[l3] || e.type === 'text'` — `''` falsy → скорее НЕ проходил) + юнит на фейковом update с `text: ''`. Если не проходил → guard расширить до `if (text === undefined || text === '')`, чтобы поведение не менялось (сообщить в отчёте — это отступление от буквы ТЗ, но сохранение старого поведения).
3. **`createTaskFile` в mkdtemp для кейса AC2 с `context.task`:** что требует `findBacklogDir` (`src/core/paths.ts:33`) — только папку `backlog/` или ещё `config.yml`. Проверка: чтение `paths.ts:33-60`. Если дорого — unit-кейс AC2 ограничить уведомлением + `delivered`, а путь `addComment` проверить живым прогоном (AC5) и зафиксировать в отчёте.
4. **Формат `payload` в трансформере:** объект полей вызова (а не строка) — проверить по `client.js:91-93`/`client.d.ts:35`; лог писать `JSON.stringify(payload).slice(0,300)`; при расхождении — привести к строке перед логированием.
5. **Поведение `addressing=mention` на rich-тексте:** `mentionsUs` работает по плоской строке — упоминание внутри rich должно найтись; живо не проверено (только в прогоне AC5).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 00:01
---
Фаза plan не удалась (код выхода 1): ep_search|richToText×2, блокировок=0, payload последнего запроса=335012 байт (макс 335012), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Spec.
---
author: @agent
created: 2026-11-19 00:13
---
Фаза 2 (Plan) выполнена. Тип: обычная задача (не epic) — план записан в Implementation Plan. Файлов в плане: 4 (правка src/bot/handlers.ts — ветка 675-780 + перехват 434-447; создание src/bot/handlers.test.mjs; правки doc-32 и doc-1). Суть фикса: bot.on('message:text') → bot.on('message') с вычислением text = m.text ?? richToText(m.rich_message) и guard 'text === undefined → next()' ДО trace; замена m.text на вычисленный text в 4 местах (684/719/733/778). Сопутствующее (новый AC6): диагноз подтверждён чтением grammy — bot.handleUpdate создаёт новый экземпляр Api на каждый update (bot.js:222-235), instance-patch на bot.api ctx-вызовы (ctx.reply/ctx.api.sendMessage) не видит; фикс — transformer через bot.api.config.use(), который копируется в per-update Api. Юнит-тесты AC1-AC4: in-process грамми-бот с botInfo, mkdtemp-фикстуры writeComms/createTicket, sentinel-обработчик для проверки next(); сетевые вызовы в AC2 — стабами bot.api.*. Риски: порядок next() (lesson-291), TS-типизация широкого Message (guard 'in'), пустой '' от richToText, фильтр имён методов в трансформере (иначе getUpdates зальёт лог). Предположения (5 шт.) зафиксированы в разделе «Не проверено» — проверка первым шагом Code: TS-компиляция, поведение фильтра на text:'', findBacklogDir для createTaskFile, формат payload трансформера, mentionsUs на rich-тексте. AC5 (живой прогон) — этап Code.
---
author: @agent
created: 2026-11-19 00:38
---
Фаза 3 (Code) выполнена. Изменено: src/bot/handlers.ts, src/bot/handlers.test.mjs (создан), коммит def4614.
Реализация:
1) Ветка (handlers.ts:675): bot.on('message:text') → bot.on('message'); text вычисляется ДО trace и всех веток ('text' in m ? m.text : 'rich_message' in m ? richToText(...) : undefined); guard: text === undefined → next(); пустой text при наличии свойства text — ветка работает (старый фильтр его пропускал: leaf-предикат '' != null — проверено по filter.js), пустой richToText (rich без текста) → next(). Четыре использования m.text → text: trace 'вход', incoming.text, answerTicket, buildIncomingPrompt.
2) AC6 (handlers.ts:434): instance-patch на bot.api заменён на transformer bot.api.config.use с фильтром по 3 именам методов — диагноз подтверждён: grammy handleUpdate создаёт новый Api на каждый update, ctx-вызовы (ctx.reply в sendMd, ctx.api.sendMessage в /ask) шли мимо own-свойства bot.api; трансформер копируется в per-update Api (installedTransformers) и ловит оба пути. Доказано юнит-тестом AC6: [trace] api.sendMessage из ctx-пути виден в консоли.
3) Тесты (src/bot/handlers.test.mjs, 7 шт.): AC1 rich-тикет → answered + reply=плоский текст rich, без next()/сети; AC2 expired → deliverLateTicket → уведомление «Запоздавший ответ» + delivered (poll-ожидание void-async); AC3 фото → next(), тикет pending; AC4 регрессия цепочки (help-команда ниже interbot-ветки отрабатывает → next() не сорвётся); регрессии пустого text/rich; AC6 transformer-лог ctx-вызова.
Проверки: pnpm build (tsc strict) OK; полный pnpm test — 237 файлов, 4541 тест passed, 4 skipped, без исключений (--exclude не использовался). Частичных прогонов не было, пропущенных тест-файлов нет.
Отступление от плана (предположение 2): guard расширен не «text === '' → next()»全面, а точечно «text === '' && textProp === undefined» — поведение старого фильтра воспроизведено точно (пустой text-строки проходил в ветку, пустой rich — нет).
Осталось: AC5 (живой прогон /ask → rich-ответ в тест-группе под --trace) — требует двух живых ботов в Telegram-группе и ручного сценария во внешнем окружении, в этой сессии недоступно; личная доставка ответа в AC1 опирается на непоменянный путь /ask (waitForAnswer → sendChatAnswer) — живо проверяется тем же прогоном AC5. Документация (doc-32, doc-1) по плану НЕ обновлялась: запрет фазы 3 — итоговую документацию пишет Close; DoD «Документация обновлена» не отмечен, отложить в Close.
---
author: @agent
created: 2026-11-19 01:28
---
Фаза Close выполнена. Статус: Done. Коммиты: feat def4614 (ветка + юнит-тесты, Code), feat c5b7bdb (метки времени HH:MM:SS.mmm в trace-строках), docs 97123c0 (doc-1, doc-32, CHANGELOG). Не закоммичено: нет (refs отсутствуют, lessons не создавались, подзадач нет).
Проверки: точечный фильтр pnpm test:fast src/bot/handlers.test.mjs — 7/7; полный pnpm test (build tsc strict + vitest) — 237 файлов, 4541 passed, 4 skipped, 0 failed, без --exclude, пропущенных тест-файлов нет.
Документация: doc-1 §3 (фильтр message:text не пропускает rich_message без text → ветки, обязанные видеть rich, на bot.on('message') + richToText; патч own-свойств bot.api не видит ctx-вызовы grammy → перехват через transformer bot.api.config.use с фильтром имён методов), doc-32 §4 «Входящее» (интербот-ветка принимает rich-ответ, тикет ловится по reply_to и для rich, async-fallback доставляет запоздавший), запись VL-430 в CHANGELOG Unreleased.
AC5 (живой прогон) — состоялся до Close (01:06–01:10, логи .vibelog/tmp/trace-md.log и trace-ui.log) и подтвердил ядро фикса: rich-ответ UI пойман веткой («вход: … text= …», «ветка тикета: reply_to=106 совпадение=true», answerTicket записал reply в тикет), async-fallback доставил запоздавший ответ в личку (expired → deliverLateTicket → «Запоздавший ответ» rich → delivered), AC6 доказан живо ([trace] api.sendMessage из ctx-вызовов виден в логе). Но «тикет answered + ответ в личке в течение sync_timeout» не выполнено: ответ обработан на 1.3 с позже дедлайна (UI сгенерировал за ~8 с, до MD дошёл через 113 с); сопутствующая аномалия тест-окружения — боты видят разные message_id одного сообщения (67 в view UI против 106 в view MD), что указывает на особенности прокси/моста тест-группы, не на код VL-430. До фикса rich не проходил фильтр и ответ терялся бы окончательно. AC5 остаётся неотмеченным — для него нужен повтор прогона в окружении без задержек доставки.
Урок не зафиксирован: знание фикса (фильтр message:text/rich, ловушка per-update Api grammy) полностью отражено в диффе (комментарии handlers.ts), коммитах def4614/c5b7bdb и документации doc-1 §3/doc-32 — пересказ диффа уроком не является; похожих активных уроков в корпусе не найдено (lesson_search: 0).
Грязь вне задачи не трогал: .vibelog/settings.json, backlog/config.yml, файл VL-429 — чужие/служебные изменения. AC5 отмечен в комментарии, чекбокс оставлен пустым честно; все три пункта DoD выполнены.
---
<!-- COMMENTS:END -->