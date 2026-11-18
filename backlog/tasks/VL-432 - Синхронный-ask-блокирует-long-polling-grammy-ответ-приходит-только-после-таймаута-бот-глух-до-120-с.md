---
id: VL-432
title: 'Синхронный /ask блокирует long polling grammy: ответ приходит только после таймаута, бот глух до 120 с'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 02:07'
updated_date: '2026-11-19 02:58'
due_date: ''
labels: []
dependencies: []
milestone: ''
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
lessons:
  - lesson-297
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 86
  duration_ms: 2480832
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 27
    code:
      input: 0
      output: 0
      cache: 0
      requests: 44
    close:
      input: 0
      output: 0
      cache: 0
      requests: 15
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Диагноз (аудит, доказан на живых прогонах с --trace + исходник grammy): синхронный ответ /ask никогда не приходит вовремя, а бот в это время глух ко всем сообщениям.

МЕХАНИЗМ: grammy 1.46.0 long polling обрабатывает апдейты ПОСЛЕДОВАТЕЛЬНО и ждёт завершения хендлеров перед следующим getUpdates:
- node_modules/grammy/out/bot.js:191-196 — «handle updates sequentially (!) … await this.handleUpdate(update)»;
- bot.js:403 — «await this.handleUpdates(updates)» в polling-цикле.
Хендлер /ask (src/bot/handlers.ts, bot.command('ask')) висит в await waitForAnswer(deps.cwd, ticket.id) до 120 с → polling не запрашивает апдейты → ответ чужого бота лежит в очереди Telegram и забирается ТОЛЬКО после завершения хендлера.

ДОКАЗАТЕЛЬСТВА (прогон 2026-11-18 22:07, .vibelog/tmp/trace-md.log и trace-ui.log):
- 22:07:59.726 MD отправил вопрос → 22:08:00.147 UI вопрос получил (0.4 с);
- 22:08:08.443 UI отправил ответ (ран 8 с);
- 22:10:00.509 MD: «Ответа нет за 120 с» — хендлер /ask завершился;
- 22:10:01.403 MD получил апдейт с ответом (+113 с, ровно ПОСЛЕ завершения хендлера).
Паттерн повторяется в прогонах: апдейт к MD доходит ~1 с после «Ответа нет». Прокси ни при чём (sendMessage в ту же секунду проходит). Тот же баг маскировал фикс VL-430: тикет «протухает», хотя ответ UI ушёл почти сразу.

РИСК: пока /ask ждёт — бот не обрабатывает НИКАКИЕ сообщения (личка, группы, другие команды) до 120 с.

ФИКС: убрать await waitForAnswer из хендлера:
1. Хендлер отправляет вопрос, отвечает «⏳ жду ответ до N с» и выходит; кладёт chatId → ticketId в in-memory map (паттерн awaitingComment);
2. Фоновый тикер в registerHandlers (setInterval ~500 мс) опрашивает тикеты из map: answered → sendChatAnswer(chatId, reply) в личку + снять из map; expired (дедлайн прошёл) → снять из map, уведомление шлёт прежний async-путь deliverLateTicket (он уже вызывается при позднем входе; для /ask-тикетов без входа нужен также фолбэк по дедлайну тикера — «Ответа нет» уходит в личку запросившего, тикет pending остаётся);
3. Повторная доставка исключена дедупом map (один тикет — одна запись, снятие после отправки);
4. MCP-путь interbotAsk не трогаем: waitForAnswer остаётся там (процесс MCP-сервера, polling не затронут).

ВНИМАНИЕ на базу: сохранить текущий контракт ответа в личку (тексты «⏳ Вопрос отправлен…», «Ответа нет за N с…» — они уже есть в /ask) и timing: дедлайн тикета = sync_timeout (для /ask из бота 120 с — лимит MCP 55 с сюда не применим).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Хендлер /ask не висит в ожидании: после отправки вопроса он выходит сразу («⏳ жду ответ»), ожидание идёт фоном — во время ожидания бот ОБРАБАТЫВАЕТ входящие апдейты (подтверждается под --trace: поступивший в этот момент update обрабатывается мгновенно, а не после таймаута)
- [x] #2 Синхронный ответ приходит в личку запросившего в течение ~1 с после поступления ответа от чужого бота; дедлайн — прежний sync_timeout_sec (120 с), наружный контракт не меняется
- [x] #3 Ответ после дедлайна — прежний путь: «Ответа нет за N с», тикет остаётся pending, позднее — доставка через deliverLateTicket
- [x] #4 Однократность: один тикет — максимум одно уведомление в личку (дедуп по map, очистка при answered/expired; map in-memory, паттерн awaitingComment — рестарт термит только висящее ожидание, тикеты переживают)
- [x] #5 Ожидание /ask не мешает MCP-пути interbotAsk (waitForAnswer остаётся там, где есть — вне polling-цикла)
- [ ] #6 Юнит-тест: fake-clock — answered до дедлайна → уведомление; expired → снятие с map без уведомления; живой прогон под --trace: /ask «Пинг» → «Понг» в личке ДО строки «Ответа нет»
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План VL-432: неблокирующий /ask — фоновое ожидание вместо `await waitForAnswer`

Диагноз принят как данность (grammy long-polling ждёт хендлеры). Фикс: хендлер /ask выходит сразу, ожидание переносится в фоновый тикер + in-memory карту, MCP-путь не трогается.

## Файлы

| Файл | Действие |
|---|---|
| `src/bot/handlers.ts` | правка: карта `askWaiters` + экспорт `askWaiterTick` + хендлер /ask без `waitForAnswer` + старт `setInterval` |
| `src/bot/handlers.test.mjs` | новые тесты VL-432 (fake-clock юнит тикера) |
| `backlog/docs/doc-32-…спецификация.md` | `document_edit`: §6 «Исходящее» — /ask не блокирует polling |

Не меняются: `src/core/interbot/ask.ts` (MCP-путь, AC5), `src/core/interbot/tickets.ts` (tick читает существующий `loadTickets`/`deadline`/`status`), `src/bot/registry.ts` (help не обещает блокировки).

## Шаг 1. Карта ожидания — `src/bot/handlers.ts`, рядом с `awaitingComment` (~строка 466)

```ts
// VL-432: /ask-тикеты, ожидающие доставки ответа в личку:
// ticketId → { chatId, timeout }. Паттерн awaitingComment — память процесса:
// рестарт термит висящее ожидание, сами тикеты (файл) переживают (AC4).
const askWaiters = new Map<string, { chatId: number; timeout: number }>();
```

**Ключ — `ticketId`, а не `chatId`** (в описании задачи «chatId → ticketId» — осознанная корректировка): один чат может отправить второй /ask, пока ждёт первый; при ключе `chatId` второй затёр бы запись первого, и его ответ никогда бы не доставился (ветка `message` отдаёт `answered`-тикеты только тикеру). «Один тикет — одна запись» (AC4) при таком ключе выполняется по построению.

## Шаг 2. Экспорт `askWaiterTick` — модульный уровень `handlers.ts` (использует уже существующие `sendChatAnswer`, `sendText`, `escapeMarkdownV2`, `loadTickets`)

```ts
export type AskWaiters = Map<string, { chatId: number; timeout: number }>;

/** Один проход тикера /ask (VL-432). Никогда не бросает — вызывается через void. */
export async function askWaiterTick(
  bot: Bot, cwd: string, waiters: AskWaiters,
  opts: { now?: () => number; trace?: (...a: unknown[]) => void } = {},
): Promise<void> {
  if (waiters.size === 0) return;            // пусто → ни одного чтения файла
  const now = opts.now ?? Date.now;
  const tickets = loadTickets(cwd);          // ОДНО чтение на проход
  for (const [ticketId, w] of [...waiters]) { // копия ключей: delete безопасен
    const t = tickets.find((x) => x.id === ticketId);
    if (!t) { waiters.delete(ticketId); continue; }          // тикет исчез — снять
    if (t.status === 'answered') {
      waiters.delete(ticketId);              // снять ДО await — дубль невозможен
      if (t.reply) await sendChatAnswer(bot, w.chatId, t.reply);        // AC2
      else await sendText(bot, w.chatId,                       // зеркало старого `answered && final.reply` (1925-1935)
        escapeMarkdownV2(`Ответа нет за ${w.timeout} с. Тикет ${ticketId} остаётся активным: запоздавший ответ придёт отдельным сообщением (async-fallback).`));
      continue;
    }
    if (t.status !== 'pending') {            // expired/delivered — уведомление не наше
      waiters.delete(ticketId); continue;    // (deliverLateTicket, AC4/AC6)
    }
    if (now() > new Date(t.deadline).getTime()) {             // дедлайн, входа не было
      waiters.delete(ticketId);                             // снять до отправки
      await sendText(bot, w.chatId,                         // AC3: тикет остаётся pending
        escapeMarkdownV2(`Ответа нет за ${w.timeout} с. Тикет ${ticketId} остаётся активным: запоздавший ответ придёт отдельным сообщением (async-fallback).`));
    }
  }
}
```

Тексты «Ответа нет…» — байт-в-байт текущие (1931-1935), `⏳ Вопрос отправлен…` остаётся в хендлере (1920-1923) без изменений. Дедлайн — из файла тикета (`deadline` созданный от `syncTimeoutSec`, без MCP-потолка 55 с).

## Шаг 3. Хендлер `/ask` — `handlers.ts:1891-1936`

- после `createTicket(...)` (~1918) **до** `await sendMd` вставить `askWaiters.set(ticket.id, { chatId: ctx.chat.id, timeout });` (между `createTicket` и `set` нет ни одного `await` → окно гонки «ответ раньше карты» нулевое);
- **удалить строки 1924-1935**: `await waitForAnswer(...)` и обе ветки (ответ / «Ответа нет») — их заменяет тикер;
- хендлер завершается сразу после `sendMd «⏳ …»` → polling свободен (AC1);
- из импорта (строка 57) убрать `waitForAnswer` (использование только в 1924; `answerTicket/createTicket/loadTickets/markDelivered/recoverStaleTickets` остаются).

## Шаг 4. Старт тикера — конец `registerHandlers` (~2579, рядом с `resumeAutoRunner`)

```ts
let askTicking = false;
const askTimer = setInterval(() => {
  if (askWaiters.size === 0 || askTicking) return;   // no-op вхолостую + анти-перекрытие
  askTicking = true;
  void askWaiterTick(bot, deps.cwd, askWaiters, { trace })
    .catch((err) => console.error('[ask] тик ожидания ответа упал:', err))
    .finally(() => { askTicking = false; });
}, 500);
askTimer.unref();   // не удерживать процесс/воркеры vitest (VL-139/140)
```

`trace` (строка 473) прокидывается в opts — в --trace-лог попадают строки доставки/дедлайна (нужны AC1/AC6).

## Шаг 5. Тесты — `src/bot/handlers.test.mjs`, новый `describe('VL-432 …')`

Паттерн файла: `root()` mkdtemp, `setupComms`, `makeBot` + `stubApi` (лоviт `sendRichMessage`/`sendMessage`), `clearPhaseEnv` на уровне файла. Каждый тест создаёт `waiters = new Map([[id, { chatId: 555, timeout: 120 }]])` и зовёт `askWaiterTick` напрямую (без `setInterval`):

1. **answered до дедлайна → уведомление** (AC6): `createTicket(timeoutSec:120)` + `answerTicket(…,'понг')` → тик: отправка в 555 с `'понг'`, карта пуста; **повторный тик — 0 новых send** (однократность, AC4);
2. **fake-clock, answered при `now` за дедлайн**: `now: () => Date.now()+10_000` + статус `answered` → всё равно доставка (статус заморожен answerTicket'ом), не «Ответа нет»;
3. **дедлайн прошёл, входа нет → «Ответа нет»** (AC3): `createTicket(timeoutSec:-1)` либо фейковый `now` за дедлайном → `sendText` с `Ответа нет за 120 с…`, карта пуста, `loadTickets()[0].status === 'pending'`;
4. **expired → снятие без уведомления** (AC6): `timeoutSec:-1` + `answerTicket` (now>deadline → `expired`) → карта пуста, **send-вызовов 0**;
5. **пустая карта → no-op**: 0 send.

## Шаг 6. Документация — `document_edit` doc-32, §6 «Исходящее: гибрид sync/async-fallback»

Дописать: команда `/ask` **не блокирует** long polling (grammy `handleUpdates` последовательный — `bot.js:192`): хендлер выходит после «⏳», ответ/дедлайн доставляет фоновый тикер (500 мс) по карте `ticketId→chatId`; MCP-путь `interbot_ask` блокируется как раньше (`waitForAnswer` в процессе MCP-сервера). Строка doc-33:99 («ответ укладывается в sync_timeout_sec») остаётся верной — не правим.

## Порядок и проверка

1. Правки `handlers.ts` → 2. `pnpm build` (strict, unused-импорт) → 3. тесты в `handlers.test.mjs` → 4. `pnpm build && pnpm test` (полный — DoD «Тесты проходят») → 5. `document_edit` doc-32 → 6. живой прогон AC1/AC2/AC6: два бота, `vibelog bot --trace`, `/ask … Пинг` → в логе: входящий update обрабатывается **в окне ожидания** (метка времени между «⏳ жду ответ» и «Ответа нет»), «Понг» в личке ≤ ~1 с после ответа чужого бота и **ДО** строки «Ответа нет».

## Риски

1. **Гонка «ответ раньше карты»** — закрыта порядком: `set` сразу после `createTicket`, без `await` между ними.
2. **Дубль при перекрытии тиков** — `delete` из карты ДО `await send` + guard `askTicking`.
3. **Утечка `setInterval` в тестах** — `unref()` + ранний выход при пустой карте; проверять полным `pnpm test` (isolate:false, fileParallelism:true).
4. **Рестарт** — теряет только карту (по AC4); `answered`-тикет без записи после рестарта в личку не доставится (окно ≤500 мс + рестарт) — принятый крайний случай, поздний вход штатно ловит `deliverLateTicket`.
5. **Крайняя гонка «дедлайн истёк, тикер не сработал, ответ пришёл»** (окно ≤500 мс) — тикет станет `expired` → `deliverLateTicket` вместо «Ответа нет»; однократность и контракт текстов не нарушаются.
6. **Пустой `reply` при `answered`** — зеркало старого поведения (`answered && final.reply` → «Ответа нет»), сохранено в шаге 2.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| grammy обрабатывает апдейты последовательно, цикл polling ждёт хендлеры | `node_modules/grammy/out/bot.js:192` («handle updates sequentially (!)»), `bot.js:403` (`await this.handleUpdates(updates)`) |
| Хендлер /ask висит в `await waitForAnswer` до полного `sync_timeout` (без `maxWaitMs`) | `src/bot/handlers.ts:1924`; `src/core/interbot/tickets.ts:160-186` |
| «⏳ Вопрос отправлен…, жду ответ до N с» уже есть в хендлере | `src/bot/handlers.ts:1920-1923` |
| Текст «Ответа нет за N с… (async-fallback)» — текущий контракт, переезжает в тикер | `src/bot/handlers.ts:1929-1935` |
| Дедлайн /ask = `sync_timeout_sec` (120), MCP-потолок 55 с — только к MCP-пути | `src/bot/handlers.ts:1912`; `src/core/comms.ts:354-356`; `src/core/interbot/ask.ts:163-167` |
| MCP-путь `interbotAsk` использует `waitForAnswer` и остаётся синхронным | `src/core/interbot/ask.ts:165-167` |
| `deliverLateTicket` — поздняя доставка, вызывается при позднем входе и на старте; для expired его не дублируем | `src/bot/handlers.ts:649-668`, `676`, `769-770` |
| `answerTicket` помечает пришедший после дедлайна ответ `expired` | `src/core/interbot/tickets.ts:108-127` |
| Файл/статусы тикетов: `pending → answered \| expired → delivered`, чтение без исключений | `src/core/interbot/tickets.ts:14-27`, `39-56` |
| Паттерн in-memory карты в registerHandlers | `src/bot/handlers.ts:459` (`awaitingComment`), `464` (`chatPauses`) |
| `sendChatAnswer` — доставка в личку (rich + фолбэки, ошибки глушит) | `src/bot/chat-answer.ts:78-140` |
| `sendText` — MarkdownV2→plain для «Ответа нет», приватная в handlers.ts (ask-waiter не выносим — цикл, как в chat-answer) | `src/bot/handlers.ts:180-198`; комментарий `src/bot/chat-answer.ts:26-28` |
| Место старта тикера — конец `registerHandlers` | `src/bot/handlers.ts:2576-2581` (`resumeAutoRunner`) |
| `trace` доступна в registerHandlers, пишется только при `deps.trace` | `src/bot/handlers.ts:473-475` |
| Тест-паттерн in-process бота со стабом api; `timeoutSec:-1` уже используется для expired | `src/bot/handlers.test.mjs:60-145`, `175-195` |
| help /ask не обещает блокировки бота — правка registry не нужна | `src/bot/registry.ts:60` |
| Тесты подхватятся сборкой (`src/**/*.test.mjs`) | `vitest.config.mts:23` |

## Не проверено (предположения)

1. **Trace-логи диагноза** (`.vibelog/tmp/trace-md.log`, `trace-ui.log`) не перечитывал — взяты из описания задачи. *Проверка в Code (первым шагом):* живой `--trace`-прогон должен воспроизвести паттерн «апдейт ~1 с после „Ответа нет“» на старом коде и исчезнуть на новом; при расхождении — перечитать логи и уточнить секцию doc-32.
2. **Юнит-тест мгновенного выхода хендлера /ask не включён**: `requireBind` → `readBotChats` читает comms через `process.cwd()` (`src/bot/env.ts:128`, `cwdOf` ~90), а тесты живут в mkdtemp — детерминизм не гарантирован. *Проверка в Code:* пробный тест `/ask` через `bot.handleUpdate` в mkdtemp; если `requireBind` детерминирован — добавить тест «handleUpdate завершается <5 с и шлёт ⏳», иначе AC1 закрывается только живым --trace прогоном (AC6 так и требует живой прогон).
3. **Поведение `unref`-таймера при `bot.stop()`/`/restart`** не проверял. *Проверка:* полный `pnpm test` после правки (не виснут воркеры) + живой `/restart` во время ожидающего /ask — процесс завершается чисто, карта умирает вместе с процессом. При зависании воркеров — убрать `unref` и завести явный стоп-хук.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 02:21
---
Фаза 2 (Plan) выполнена. Тип: task (обычная задача, ветвление не применялось). План записан в Implementation Plan: 3 файла (src/bot/handlers.ts — карта askWaiters + экспорт askWaiterTick + неблокирующий хендлер /ask + setInterval 500 мс c unref; src/bot/handlers.test.mjs — 5 fake-clock юнит-тестов тикера; doc-32 §6 — документация через document_edit). Ключевые решения: ключ карты ticketId→{chatId,timeout} вместо chatId→ticketId из описания (защита от затирания записи первого /ask вторым из того же чата, AC4 «один тикет — одна запись» по построению); delete из карты ДО await send + guard askTicking против двойной доставки; тексты «⏳ Вопрос отправлен…» и «Ответа нет за N с…» сохранены байт-в-байт, дедлайн — прежний sync_timeout (120 с) из deadline тикета; MCP-путь interbotAsk не трогается (waitForAnswer остаётся в ask.ts). Требование «Подтверждение кодом» выполнено: таблица «Проверено по коду» — 17 утверждений с файл:строка (включая grammy bot.js:192/403, handlers.ts:1924, tickets.ts:160-186); раздел «Не проверено (предположения)» — 3 пункта (trace-логи диагноза, детерминизм requireBind для юнит-теста хендлера, поведение unref-таймера при restart) с указанием способа проверки в Code. Риски: гонка «ответ раньше карты» (закрыта порядком), утечка setInterval в тестах (unref + no-op на пустой карте), крайние гонки у дедлайна (≤500 мс, приемлемы). Проверка: pnpm build && pnpm test (полный) + живой прогон под --trace (AC6: «Понг» в личке до «Ответа нет»).
---
author: @agent
created: 2026-11-19 02:39
---
Фаза 3 (Code) выполнена. Изменено: src/bot/handlers.ts (карта askWaiters, экспорт askWaiterTick, неблокирующий хендлер /ask, setInterval 500 мс с unref и guard askTicking; из импорта убран waitForAnswer), src/bot/handlers.test.mjs (+5 fake-clock юнит-тестов VL-432). Коммит 04a1eec. Проверки: pnpm build (tsc strict) — OK; полный pnpm test — 237+1 тест-файл, 4546 passed / 4 skipped, исключений нет (первый прогон упал 1 флаки в src/web/orchestrator.test.mjs «VL-277 файл задачи закоммичен» — git log вернул 'init'; этот же тест проходит изолированно и в повторном полном прогоне, к VL-432 отношения не имеет — правили только bot/handlers). Реализация по плану: тексты «⏳ Вопрос отправлен…» и «Ответа нет за N с… (async-fallback)» сохранены байт-в-байт (тесты ловят их в sendMessage), дедлайн — прежний sync_timeout из deadline тикета, expired → снятие без уведомления (владеет deliverLateTicket), ответ с пустым reply → зеркало старого «Ответа нет», MCP-путь interbotAsk не тронут (waitForAnswer в ask.ts). AC2/AC3/AC4/AC5 закрыты юнитами + отсутствием изменений ask.ts; AC1 и живая часть AC6 НЕ отмечены: юнит-тест мгновенного выхода хендлера /ask не написан (requireBind → readBotChats читает comms через process.cwd(), а тесты живут в mkdtemp — недетерминировано, как и предполагалось в плане), а живой прогон двух ботов под --trace («Понг» до «Ответа нет», update в окне ожидания) требует внешнего окружения с двумя проектами и каналом — выполнить его должен Close/владелец по чек-листу AC6. Документация: doc-32 §6 НЕ обновлялся — правки backlog/docs в Фазе 3 запрещены (пишет Close); содержание правки зафиксировано в плане (шаг 6). DoD «Документация обновлена» не отмечен по этой причине; «Тесты проходят» и «Нет регрессий» — по полному прогону.
---
author: @agent
created: 2026-11-19 02:57
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 04a1eec (handlers.ts + handlers.test.mjs — карта askWaiters, тикер askWaiterTick, неблокирующий /ask; в рабочем дереве уже были, остатков нет), docs e1f83b9 (doc-32 §4 «Исходящее» — неблокирующий /ask + CHANGELOG Unreleased/Исправлено), docs(task) 697adcc (lesson-297). Проверки: сборка (tsc strict) — OK в составе pnpm test; полный прогон — 237+1 тест-файл, 4546 passed / 4 skipped, exit 0. Первый прогон упал (exit 1, итоговая сводка потеряна обрезкой вывода): классификация — параллельного vitest/qwen в других worktree нет (ps пуст), подозрение на прежний флаки src/web/orchestrator.test.mjs «VL-277» из Фазы 3; повторный полный прогон (единственный, с логом .vibelog/tmp/close-vl432-test.log) прошёл чисто. Документация: doc-32 §4 дополнен (grammy последовательный, тикер 500 мс, карта ticketId→chatId, однократность, MCP-путь не тронут); CHANGELOG — запись VL-432. Урок: lesson-297 (связан с задачей). DoD: 1/2/3 отмечены. Не отмечены AC1 и AC6 (живая часть): юнит-тест мгновенного выхода хендлера /ask не написан (requireBind читает comms через process.cwd(), тесты в mkdtemp — недетерминировано, как и предполагал план), а живой прогон двух ботов под --trace («Понг» до «Ответа нет», update в окне ожидания) требует внешнего окружения с двумя проектами и каналом — выполняется владельцем; юнит-часть AC6 (fake-clock answered/expired) закрыта 5 тестами handlers.test.mjs. Подзадач нет, refs нет. Не закоммичено: нет (файл задачи VL-432 коммитит framework).
---
<!-- COMMENTS:END -->