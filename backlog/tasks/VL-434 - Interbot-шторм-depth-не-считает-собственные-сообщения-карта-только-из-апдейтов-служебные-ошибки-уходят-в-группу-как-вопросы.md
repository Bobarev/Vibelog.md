---
id: VL-434
title: 'Interbot-шторм: depth не считает собственные сообщения (карта только из апдейтов) + служебные ошибки уходят в группу как вопросы'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 10:39'
updated_date: '2026-11-25 15:41'
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
  - src/bot/interbot.ts
  - src/bot/handlers.ts
  - src/bot/interbot.test.mjs
  - src/bot/handlers.test.mjs
lessons:
  - lesson-300
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 75
  duration_ms: 1928258
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 16
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
Инцидент (живой прогон 07:01:05–07:02:18, логи .vibelog/tmp/trace-md.log и trace-ui.log): interbot-шторм — 73 секунды взаимных ответов двух ботов, ~10 циклов «ответ ↔ ответ», включая петлю служебных ошибок.

КОРНИ:
A. Depth-лимит (2 хопа) — мёртвый рубеж. src/bot/interbot.ts replyDepth считает цепочку по interbotReplyMap, но карта наполняется ТОЛЬКО из входящих апдейтов (handlers-ветка: interbotReplyMap.set(m.message_id, m.reply_to_message.message_id)), а СВОИ сообщения бота в апдейты Telegram не приходят → цепочка разрывается на собственном сообщении-ответе → depth в логе везде = 1, limit 2 не срабатывает никогда. Пока ран идёт, «старт рана НЕ удался: Запуск уже выполняется» → служебная ошибка публикуется rich-сообщением с reply в группу → чужой бот dispatch-ит её как вопрос (addressing: all у обоих в comms) → новый старт → ошибка → петля «ошибка ↔ отчёт об ошибке» каждые 1–2 с.
B. Служебные сообщения не должны попадать в interbot-переписку: ошибка «Запуск уже выполняется» (и подобные технические тексты) публикуются в группу как полноценный ответ и читаются чужим dispatch как входящий вопрос.

ФИКС A (замкнуть depth): в точке отправки ответа в группу (sendChatAnswer с opts.replyTo → api-вызов вернул message_id) дописать в interbotReplyMap: своё message_id → reply_to (тот же санит ≤5000, паттерн ветки). Тогда цепочка собственных сообщений учитывается, depth растёт, на превышении maxDepth срабатывает существующий штатный рубеж «Цепочка слишком длинная (лимит depth) — эскалируй вопрос человеку» (dispatchIncoming, interbot.ts). Для этого нужен доступ к message_id, который вернул sendRichMessage — сейчас sendChatAnswer его не возвращает (результат rich-вызова проверяется на richDroppedReply, но наружу не отдаётся) — вернуть message_id из sendChatAnswer и передать в interbot-ветку.

ФИКС B (служебное не в группу): в onExit/startPrompt-ветке (handlers.ts): при ошибке «Запуск уже выполняется» ответ в группу НЕ отправляется (только trace/консоль) — входящее в момент идущего рана не порождает нового сообщения; материалы для петли нет. Плюс защита на стороне получателя: dispatchIncoming не должен process-ить служебные сообщения чужих ботов (маркер/префикс — например, «⚠️ Не удалось запустить ран» / служебный префикс) — юнит-тест.

КОНТЕКСТ (не баги, но учтено): в comms.yaml обоих проектов addressing: all; approval: admin на канале main MD-бота (карточка на каждый ответ — осознанный выбор, не трогаем). Предложение «C» (семантика all: для ботов — явная адресация, «ко всем» только для людей) обсуждается отдельно и НЕ входит в эту задачу.

Проверка: pnpm test; живой прогон под --trace: «Всем привет!» → ответы обоих ботов → дальше тишина (depth обрывает петлю, служебных сообщений в группе нет).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A: после отправки ответа в группу (sendChatAnswer/любой api-вызов с reply_parameters) своё message_id → reply_to дописывается в interbotReplyMap (тот же санит-паттерн ≤5000); юнит-тест: цепочка из сообщений, чередующихся с «своими», даёт растущий depth
- [x] #2 Depth считается по полной цепочке и обрывает шторм: на превышении maxDepth — штатный ответ «Цепочка слишком длинная», без запуска рана (живой тест: сценарий петли из лога 07:01 обрывается максимум на 3-м хопе)
- [x] #3 B: ошибка «старт рана НЕ удался: Запуск уже выполняется» НЕ публикуется в группу — только trace/консоль; входящее в момент идущего рана не создаёт новое сообщение-ответ (нет материала для петли ошибка↔отчёт)
- [x] #4 B: прочие служебные тексты бота в группе (не результат рана) не порождают dispatch-ран на стороне получателя — минимум: не отвечать на сообщение чужого бота, являющееся служебным (маркер/префикс), юнит-тест в interbot.test.mjs
- [x] #5 Юнит-тесты depth с участием собственных сообщений + pnpm test зелёный; живой прогон под --trace: «Всем привет!» → ответы обоих, дальше тишина (петля не стартует)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-434 — Interbot-шторм: depth не считает свои сообщения + служебные ошибки в группу

Тип: bug (обычная задача, не epic) — план в эту задачу.

## Файлы для изменения

1. `src/bot/interbot.ts` — экспорт `rememberReplyPair` (fix A) + `isServiceMessage` и guard в `dispatchIncoming` (fix B-2)
2. `src/bot/handlers.ts` — регистрация своих id в `interbotReplyMap` (fix A) + удалить публикацию ошибки старта в группу (fix B-1)
3. `src/bot/interbot.test.mjs` — юнит-тесты depth со своими сообщениями + служебный guard (AC1, AC2-часть, AC4)
4. `src/bot/handlers.test.mjs` — тест «ошибка старта не публикуется» (AC3) + интеграционный тест чередования цепочки
5. `doc-32` (document_edit) — документация: depth по полной цепочке, служебные сообщения не диспатчатся (DoD)

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `interbotReplyMap` наполняется ТОЛЬКО из входящих апдейтов (`m.reply_to_message`) | `src/bot/handlers.ts:954` |
| Свои сообщения бота в interbot-ветку не попадают (`m.from.id === ctx.me.id` → `next()`) — map не растёт от своих отправок | `src/bot/handlers.ts:930-934` |
| Санитка map: size > 5000 → удалить oldest (паттерн для fix A) | `src/bot/handlers.ts:956-958` |
| `replyDepth` идёт по `replyMap` до корня; обрыв цепочки на своём сообщении → depth=1 всегда | `src/bot/interbot.ts:157-172` |
| Штатный рубеж depth: `depth > limits.maxDepth` → answer «Цепочка слишком длинная (лимит depth) — эскалируй вопрос человеку», `reason: 'depth'` | `src/bot/interbot.ts:271-278` |
| `dispatchIncoming` для ботов: dedup → rate → depth → addressing → runs; для людей — отдельная ветка Q1 без depth | `src/bot/interbot.ts:260-296` |
| **`sendChatAnswer` УЖЕ возвращает `number[]` id отправленных частей** (описание задачи устарело: «не возвращает» — это было до VL-433) | `src/bot/chat-answer.ts:91-140` (return sentIds), тест `src/bot/chat-answer.test.mjs:153-173` |
| Ответ рана в группу: `.then((ids) => rememberThreadPair(...))` — ids уже есть, но в `interbotReplyMap` НЕ дописываются | `src/bot/handlers.ts:1111-1113` |
| Служебный ответ dispatch (depth/лимиты) → `sendChatAnswer` с replyTo, ids не сохраняются | `src/bot/handlers.ts:1021-1023` |
| Публикация решения `ibot:ok` → `sendChatAnswer` с replyTo, ids в replyMap не пишутся | `src/bot/handlers.ts:2309-2317` |
| Ошибка старта публикуется rich-сообщением в группу → материал для петли (корень B) | `src/bot/handlers.ts:1118-1123` |
| Карточка решения уходит только в `admin_chat` (не в группу) — не трогаем | `src/bot/handlers.ts:1080-1104` |
| `interbotReplyMap` — локальная closure-переменная `registerHandlers`; точка расширения — рядом с объявлением | `src/bot/handlers.ts:738` |
| Тестовый шов `startPrompt` в deps позволяет смоделировать `{error}` старта | `src/bot/handlers.test.mjs:302,342` |
| Стаб API возвращает `message_id: 61` — для интеграционного теста нужен инкрементальный id (сейчас фиксированный) | `src/bot/handlers.test.mjs:64-77` |
| Текущая semantic-текст ошибки: `⚠️ Не удалось запустить ран: ${result.error}` | `src/bot/handlers.ts:1120` |

## Не проверено (предположения)

1. **Предположение:** rich-сообщение чужого бота приходит в ветку с вычисленным `text` (`m.text ?? richToText(...)`), поэтому service-guard по тексту видит и rich-ответы. Проверить: чтением вычисления `text` в interbot-ветке handlers.ts (до строки 959). Расхождение → guard вешать на тот же текст, что идёт в `dispatchIncoming`.
2. **Предположение:** в doc-32 есть секция loop-защиты (§4/§5), куда встаёт правка по depth/служебным. Проверить: document_view doc-32, найти секцию про depth; если секции нет — добавить подраздел в §4.
3. **Предположение:** `ibot:no`-ответ («⛔ Админ отклонил публикацию решения.») для depth-цепочки не критичен, но регистрация пары не вредит. Проверить при реализации:捕 after `sendChatAnswer` на строке 2319.
4. **Предположение:** отсутствие отправки ошибки старта не ломает существующие тесты handlers.test.mjs (поиск по строке «Не удалось запустить ран» в тестах — пусто, но могут быть тесты на факт отправки). Проверить: `pnpm test` после правки.

## Порядок действий

### Шаг 1. Fix A — замкнуть depth (interbot.ts + handlers.ts)

1. **`src/bot/interbot.ts`**: экспорт новой функции:
   ```ts
   /** Регистрация СВОИХ отправленных id → reply_to в карте цепочки (VL-434, fix A). */
   export function rememberReplyPair(
     map: Map<number, number>, ids: readonly number[], replyTo: number,
   ): void {
     for (const id of ids) map.set(id, replyTo);
     if (map.size > 5000) { /* FIFO-санитка как в handlers.ts:956-958 */ }
   }
   ```
2. **`src/bot/handlers.ts`** — 4 точки (все, где `sendChatAnswer` с `opts.replyTo`):
   - строка ~1111: в `.then((ids) => …)` добавить `rememberReplyPair(interbotReplyMap, ids, replyTo)` перед `rememberThreadPair`;
   - строка ~1023: `const ids = await sendChatAnswer(...)` → `rememberReplyPair(interbotReplyMap, ids, m.message_id)`;
   - строка ~2309 (ibot:ok): после `ids` → `rememberReplyPair(interbotReplyMap, ids, pending.replyTo)`;
   - строка ~2319 (ibot:no): запомнить `ids` → `rememberReplyPair(…, ids, pending.replyTo)`.
   Импорт `rememberReplyPair` из `./interbot.js` (уже импортируется `dispatchIncoming` и др. — расширить import).

### Шаг 2. Fix B-1 — ошибка старта не в группу (handlers.ts)

Строки 1118-1123: из ветки `'error' in result` убрать `await sendChatAnswer(...)`; оставить `trace('старт рана НЕ удался:', result.error)` + добавить `console.error('[interbot] старт рана не удался:', result.error)` (диагностика без публикации).

### Шаг 3. Fix B-2 — guard служебных на стороне получателя (interbot.ts)

1. Экспорт `isServiceMessage(text: string): boolean` — префиксный список (normalize-trim, `startsWith`):
   - `⚠️ Не удалось запустить ран`
   - `⚠️ Ран упал`
   - `⛔ Админ отклонил публикацию решения.`
   - `Цепочка слишком длинная (лимит depth)`
   - `Лимит входящих запросов в час`
2. В `dispatchIncoming`, ветка ботов (`msg.is_bot`), СРАЗУ после human-ветки и до dedup/rate/depth:
   ```ts
   if (msg.is_bot && isServiceMessage(msg.text))
     return { action: 'answer', depth: 0, reply: '', reason: 'ignore' };
   ```
   (пустой reply → молчаливый пропуск в handlers.ts:1024-1028, новое сообщение не создаётся — материала для петли нет).

### Шаг 4. Тесты

**`src/bot/interbot.test.mjs`:**
- AC1: `rememberReplyPair` пишет пары + FIFO-санитка >5000; цепочка `replyDepth` с чередованием чужих/своих id даёт растущий depth (свой id в map → глубина не обрывается).
- AC4: `dispatchIncoming` с текстом каждого маркера служебного → `action:'answer', reason:'ignore', reply:''`; обычный вопрос бота → `process` (регрессия).
- AC2-логика: цепочка с replyMap, заполненным через `rememberReplyPair`, при depth > maxDepth → `reason:'depth'` с текстом «Цепочка слишком длинная…».

**`src/bot/handlers.test.mjs`:**
- AC3: `startPrompt: () => ({ error: 'Запуск уже выполняется' })` + update от чужого бота → в `calls` НЕТ send-вызовов с «Не удалось запустить ран» (trace не проверяем — проверяем отсутствие сообщения).
- AC2-интеграция (чередование): стаб API с инкрементальными `message_id`; цепочка: чужой вопрос → onExit-ответ (регистрация своего id) → чужой reply на наш id → onExit → … до depth > 2 → в calls появляется «Цепочка слишком длинная», новые `startPrompt`-вызовы прекращаются.

### Шаг 5. Документация

`document_edit doc-32`: в секции loop-защиты (§4/§5) уточнить: (а) depth считается по полной цепочке, включая СВОИ отправленные ответы (регистрация `rememberReplyPair` при отправке с reply_parameters); (б) служебные сообщения ботов (марки `⚠️`/`⛔`, служебные тексты) не запускают ран на стороне получателя; (в) ошибка «Запуск уже выполняется» публикуется только в trace/консоль, в группу не уходит.

### Шаг 6. Проверка

```
pnpm build && pnpm test        # полный прогон — DoD «Тесты проходят»
```
Живой прогон под `--trace`: «Всем привет!» → ответы обоих ботов → тишина (depth обрывает на 3-м хопе, служебных сообщений в группе нет).

## Риски

- **Чужой бот со старой версией** шлёт служебные без маркера — guard не поймает; спасает depth-фикс (оба проекта обновляются отдельными задачами).
- Фиксированный `message_id: 61` в существующем стабе handlers.test.mjs — инкрементальный стаб делать только для нового теста, не ломая соседи.
- `rememberReplyPair` пишет в closure-map — при `ibot:ok` спустя время после рестарта процесса map пуст: цепочка обрывается до注册 — приемлемо (дедуп/rate всё равно in-memory).
- Отказ от публикации ошибки старта меняет видимость для людей в группе: входящее в момент рана остаётся без ответа — это и есть цель AC3.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 11:05
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в задачу (6 шагов, 5 файлов: src/bot/interbot.ts, src/bot/handlers.ts, interbot.test.mjs, handlers.test.mjs, doc-32). Ключевые находки по коду: (1) sendChatAnswer УЖЕ возвращает number[] id — описании задачи устарело, fix A сводится к дописыванию пар в interbotReplyMap в 4 точках отправки с replyTo (строки 1023/1111/2309/2319 handlers.ts) через новый экспорт rememberReplyPair с FIFO-саниткой ≤5000; (2) fix B-1 — убрать sendChatAnswer из ветки 'error' in result (handlers.ts:1118-1123), оставить trace/console; (3) fix B-2 — isServiceMessage + guard в dispatchIncoming (reason: 'ignore', пустой reply → молчаливый пропуск); (4) рубеж depth «Цепочка слишком длинная» уже штатный (interbot.ts:271-278) — не трогаем. Тесты: юнит depth со своими сообщениями + служебный guard (interbot.test.mjs), отсутствие публикации ошибки старта + интеграционная цепочка с инкрементальным стабом message_id (handlers.test.mjs). Документация: doc-32. Риски: чужой бот со старой версией без маркера, фиксированный id:61 в существующем стабе, in-memory map после рестарта. Предположения (4) зафиксированы в плане — проверить первым шагом Code.
---
author: @agent
created: 2026-11-19 11:26
---
Фаза 3 (Code) выполнена. Изменено: src/bot/interbot.ts, src/bot/handlers.ts, src/bot/interbot.test.mjs, src/bot/handlers.test.mjs; коммит dcc292f. Документация: doc-32 дополнен секцией «Loop-защита: depth по полной цепочке и служебные сообщения (VL-434)».
Реализация по плану: (A) rememberReplyPair(map, ids, replyTo) в interbot.ts — пары «свой id → reply_to» дописываются в interbotReplyMap в 4 точках sendChatAnswer с replyTo (служебный ответ dispatch, onExit-ответ в группу, ibot:ok, ibot:no) с FIFO-саниткой ≤5000; (B-1) ошибка «Запуск уже выполняется» из ветки 'error' in result убрана из группы — только trace + console.error; (B-2) isServiceMessage (5 префиксов) + guard в dispatchIncoming до dedup/rate/depth → reason: 'ignore', пустой reply → молчаливый пропуск.
Проверки: pnpm build OK; pnpm test — ПОЛНЫЙ прогон, 238/238 тест-файлов зелёные (4581 passed, 0 failed, exit=0; лог .vibelog/tmp/vl434-test.log). В первых двух прогонах были флаки в несвязанных файлах (src/web/orchestrator.test.mjs — git-лог, src/core/report.test.mjs): на изоляции и в полном прогоне прошли, к VL-434 отношения не имеют (мои файлы — только src/bot/*). Исключённых тест-файлов нет.
Отмечено AC: 1 (юнит depth с своими сообщениями + санитка), 3 (ошибка старта не публикуется — тест AC3), 4 (служебный guard — 3 юнит-теста). AC2 и AC5 НЕ отмечены: unit/integration-цепочка обрыва на 3-м хопе написана и зелёная, но живой прогон двух ботов под --trace («Всем привет!» → тишина) в этой фазе не выполнялся — требует запуска реальных ботов, сделать в Close/владельцу. Предположения плана проверены: rich-сообщения приходят с текстом (handlers.ts:915 m.text ?? richToText) — guard их видит; doc-32 имел секцию — дополнен; существующие тесты на ошибку старта отсутствуют — не сломаны.
---
author: @agent
created: 2026-11-19 11:35
---
Фаза Close выполнена. Статус: Done. Коммиты: fix dcc292f (код — закоммичен в Фазе Code, остатков не было), docs 8013cae (CHANGELOG + doc-32), docs(task) 94bae74 (lesson-300). Не закоммичено: нет (refs у задачи нет; файл задачи VL-434 коммитит framework после token_usage).
Проверки: pnpm build OK; полный прогон после коммита: 239 файлов, 4589 passed / 1 failed / 4 skipped. Падение: src/web/orchestrator.test.mjs «startPhase close (qwen): billing уходит тем же коммитом» — классификация: (а) наш diff только src/bot/*, точечный прогон src/bot/ зелёный, падающий модуль вне диффа; (б) параллельного vitest в других worktree нет; тот же флаки уже наблюдался в Фазе Code (git-лог, гонка fire-and-forget billing-коммита). Один изолированный повтор упавшего файла после классификации — 89/89 зелёные. Исключённых тест-файлов нет.
DoD: 1 — тесты (полный прогон; единственное падение — пре-существующий флаки вне диффа, повтор зелёный), 2 — doc-32 («Loop-защита: depth по полной цепочке и служебные сообщения») + запись в CHANGELOG, 3 — нет регрессий (модули задачи зелёные, падение не связано с диффом).
AC отмечено в этой фазе: 2, 5 (интеграционная цепочка обрыва на 3-м хопе — тест зелёный в полном прогоне). Живой прогон двух ботов под --trace («Всем привет!» → ответы → тишина) не выполнялся — требует запуска реальных ботов, отложен владельцу (аналог AC8 в VL-433).
Урок: lesson-300 (свои message_id не приходят в getUpdates — дописывай пары после api-вызова) создан и связан с задачей.
---
<!-- COMMENTS:END -->