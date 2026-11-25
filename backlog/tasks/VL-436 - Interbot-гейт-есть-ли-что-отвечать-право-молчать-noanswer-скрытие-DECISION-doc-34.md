---
id: VL-436
title: 'Interbot-гейт «есть ли что отвечать» + право молчать <no_answer> + скрытие [DECISION] (doc-34)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 12:40'
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
  - src/bot/gate.ts
  - src/bot/gate.test.mjs
  - src/bot/interbot.ts
  - src/bot/interbot.test.mjs
  - src/bot/handlers.ts
  - src/bot/handlers.test.mjs
lessons:
  - lesson-302
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 102
  duration_ms: 3376641
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 21
    code:
      input: 0
      output: 0
      cache: 0
      requests: 46
    close:
      input: 0
      output: 0
      cache: 0
      requests: 35
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Спецификация: doc-34 «Interbot: осмысленный диалог» (все решения закрыты 2026-11-19). Объём — этапы §7, оставшиеся после VL-434 (та закрыла этапы 3 «служебное не в группу» — проверить и прикрыть точечно, и 5 «depth-замыкание»).

СМЫСЛ: бот должен слушать всё и отвечать только когда есть что ответить — умение молчать как штатное поведение (read), а не сбой. Шторм-инцидент (2026-11-19, логи .vibelog/tmp/trace-*.log) показал: каждое сообщение запускало ран, а «стоило ли отвечать» решала модель внутри рана, где её роль «отвечать» — отсюда мета-отчёты, выглядящие как содержательные реплики, и цикл.

ЭТАПЫ (из doc-34 §7):
1. Гейт react|read_only — дешёвая классификация в ветке dispatch ДО startPrompt: короткий промпт, дефолтная модель проекта (settings.models.default → env VIBELOG_LLM_MODEL, паттерн приоритета как у ранов, без session), таймаут 2–3 с. read_only → контекст ветки обновлён, ран не запускается, реакции нет (trace: решение гейта). React → прежний путь. Fail-open при сбое (решение §8.2). Отдельная настройка модели гейта — отложена на будущее (decision-модели), в v1 не нужна.
2. Контракт <no_answer> — в buildIncomingPrompt: «Если отвечать нечего — верни ровно <no_answer>»; в onExit: ровно <no_answer> → ничего не отправлять (не в группу, не карточку), только trace. Маркер только для нашего возврата, на приёме его не бывает.
3. Этап 3 (служебное): ошибки запуска («Запуск уже выполняется» и т.п.) не публикуются в группу — только trace/консоль. Если VL-434 уже это сделала — проверить и закрыть AC.
4. Этап 4 (срезка [DECISION]): classifyAnswer парсит как раньше, но перед публикацией в группу маркер вырезается из текста (человек видит чистую реплику); карточка согласования — с меткой «решение»; отправителю маркер не возвращается (док-34 §4).
5. Тесты (этап 6): юнит — гейт-ветка (react/read_only/fail-open), <no_answer>, срезка маркера; живой прогон под --trace: «Всем привет!» → ответы обоих один раз → тишина.

НЕ входит (закрыто ранее): depth-замыкание и точечный фикс служебных — VL-434 (Done); участие человека — VL-433 (Done); поздний ответ в веб-чат — VL-431 (отдельная).

ГРАНИЦЫ: маркеры [ANSWER]/[NOTE] НЕ заводим — природа сообщения определяется на приёме по семантике (тикет-ветка / гейт), в ленту протокольный текст не выносится (док-34 §4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Гейт react|read_only: перед запуском рана (после dedup/rate/addressing/тикет-ветки) — дешёвая классификация коротким промптом; модель — дефолтная проекта (settings.models.default → env VIBELOG_LLM_MODEL, без session), таймаут 2–3 с; read_only → контекст обновляется, ран НЕ запускается, ничего не отправляется (только trace-лог решения и факта сбоя)
- [x] #2 Fail-open: сбой/таймаут гейта → react + запись сбоя в trace; юнит-тест (модель бросила/таймаут → путь в ран не закрыт)
- [x] #3 Контракт <no_answer>: buildIncomingPrompt обязывает при пустом ответе вернуть ровно <no_answer>; onExit: ровно <no_answer> → ничего не отправляем в группу/админку, только trace; юнит-тест промпта и ветки onExit
- [x] #4 Служебное не в группу (этап 3): ошибка «Запуск уже выполняется» и прочие ошибки запуска не публикуются как сообщение — только trace/консоль
- [x] #5 Срезка [DECISION] (этап 4): approval-ветка парсит маркер как раньше (decision_request → карточка в admin_chat), но ПЕРЕД публикацией в группу маркер вырезается из текста; в карточке согласования текст остаётся с меткой «решение»; отправителю маркер не возвращается; юнит-тест (в группу — без маркера, classifyAnswer работает)
- [ ] #6 Юнит-тесты всех веток + pnpm test зелёный; живой прогон под --trace: «Всем привет!» → ответы обоих ботов один раз, дальше тишина (гейт помечает ответы чужих ботов read_only, петля не стартует)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План VL-436 — Interbot-гейт react|read_only + <no_answer> + срезка [DECISION] (doc-34 §7, этапы 1/2/4/6)

## Файлы для изменения

| Файл | Что делаем |
|---|---|
| `src/bot/gate.ts` | **Новый** модуль гейта: промпт классификации, парсер вердикта, `runGate` (LLM-вызов с таймаутом, fail-open) |
| `src/bot/gate.test.mjs` | **Новый** юнит-файл: парсер, react/read_only/fail-open/таймаут на мок-клиенте |
| `src/bot/interbot.ts` | Контракт `<no_answer>` в `buildIncomingPrompt`; новый экспорт `stripDecisionMarker`; пропуск пустого `answer` в секции context |
| `src/bot/handlers.ts` | Шов `HandlerDeps.gate`; ветка гейта после dispatch до `startPrompt`; `<no_answer>`-ветка в `onExit`; срезка маркера в 2 точках публикации в группу |
| `src/bot/interbot.test.mjs` | Юнит: контракт `<no_answer>` в промпте, `stripDecisionMarker` |
| `src/bot/handlers.test.mjs` | Дефолтный стаб гейта в тест-хелперах + `describe('VL-436 …')` |
| `doc-34` (MCP document_edit) | Отметить этапы §7, закрытые VL-436 (1, 2, 4, 6) |
| `doc-33` (MCP document_edit) | Раздел «Гейт и право молчать»: бот может молчать, маркер `<no_answer>` внутренний, `[DECISION]` не виден в ленте, диагностика `--trace` |

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| Точка вставки гейта: `dispatchIncoming` → решение `process` → сразу `buildIncomingPrompt`/`startPrompt`, других проверок между ними нет | `src/bot/handlers.ts:1005-1047` (dispatch: 1005; trace решения: 1015; блок `!== 'process'`: 1017-1030; комментарий «Входящий вопрос → read-only ран»: 1032; prompt: 1047) |
| dedup/rate/depth/addressing/runs выполняются ВНУТРИ `dispatchIncoming` — гейт после них = AC1 «после dedup/rate/addressing/тикет-ветки» | `src/bot/interbot.ts:262-341` |
| Тикет-ветка (ответ чужого бота на наш вопрос) возвращается раньше dispatch → гейт её не трогает («минуя гейт» по спеке) | `src/bot/handlers.ts:985-1003` |
| Этап 3 (служебное не в группу) уже сделан VL-434: ошибка старта → только trace/консоль, публикации нет; юнит-тест AC3 существует | `src/bot/handlers.ts:1123-1130`; тест `src/bot/handlers.test.mjs:461-474` |
| `classifyAnswer` парсит `[DECISION]` где угодно (case-insensitive) → `decision_request` | `src/bot/interbot.ts:346-350` |
| Карточка согласования уже с меткой «решение» («⚖️ Требуется решение») и уходит в `admin_chat`; в неё маркер попадает как раньше | `src/bot/handlers.ts:1087-1111` |
| Публикация в группу из `onExit` (ветка `else`) — точка срезки №1 | `src/bot/handlers.ts:1113-1121` |
| Публикация по кнопке `ibot:ok` (после approve) — точка срезки №2 | `src/bot/handlers.ts:2315-2326` |
| `[DECISION]` в других send-путях не встречается (grep по src: только промпт/классификатор/тесты) — echo-возвратов маркера нет | `search_files "[DECISION]"` по src |
| Контракт `<no_answer>` добавляется в базовые `parts` промпта; существующие тесты формы промпта — substring-ассерты (`.includes`), новая строка их не ломает | `src/bot/interbot.ts:360-371`; `src/bot/interbot.test.mjs:220-226`; `src/core/interbot/tickets.test.mjs:258-268` |
| Паттерн юнит onExit: тест стабит `startPrompt`, ловит `onExit` и вызывает с фейковым `run {result, exitCode}` | `src/bot/handlers.test.mjs:481-505` |
| Дефолтная модель «как у ранов, без session»: `createLlmClient({cwd})` → `resolveActiveModel(cwd)` (`models.default`) → env `VIBELOG_LLM_MODEL`; мета сессии не читается | `src/agent/llm.ts:850, 861` |
| Паттерн API-режима у разовых вызовов (ран/веб): `apiMode: loadApiMode(cwd)` | `src/agent/llm-env.ts:317`; `src/web/supervisor-tick.ts:205` |
| Одноразовый LLM-вызов без дубля HTTP-слоя: `client.streamChat(messages, undefined, {})` → `{text}`; мок-`client` инжектится в тестах (паттерн judge) | `src/core/judge.ts:392-403, 418` |
| Таймаут возможен через `StreamChatOptions.signal` (AbortSignal → fetch) + `maxTokens` для дешевизны | `src/agent/llm.ts:120-137, 182-185` |
| Свои сообщения не приходят в апдейты (`m.from.id === ctx.me.id` → next) — гейт видит только чужие/человеческие | `src/bot/handlers.ts:933-938` |
| Тест-хелперы с `registerHandlers`, куда нужен дефолтный стаб гейта (иначе реальный LLM-вызов в тестах): 2 хелпера; третий вызов — `/help` вне interbot-канала, гейт не зовётся | `src/bot/handlers.test.mjs:146, 435, 559` |
| Память ветки: `interbotThreadMemory` + `rememberThreadPair` (FIFO ≤1000) — сюда пишется контекст при `read_only` | `src/bot/handlers.ts:741-757` |
| Чужое служебное уже отсекается до гейта (`isServiceMessage` → `ignore`) — гейт его не видит | `src/bot/interbot.ts:246-256`, ветка в `dispatchIncoming` |

## Не проверено (предположения) — Code обязан проверить ПЕРВЫМ шагом

1. **Параллельность апдейтов в grammy**: не читал, обрабатывает ли поллинг updates последовательно (await полного хендлера) или параллельно — от этого зависит, видит ли пользователь паузу до ~2.5 с на входящее. Проверка: `node_modules/grammy/out/bot.js` (цикл `getUpdates` → `handleUpdate`). Расхождение/последовательность → не править код (спека разрешает 2–3 с), но зафиксировать в отчёте Code как задержку входа.
2. **Обрыв зависшего чтения по `signal`**: `requestWithRetry` кидает ошибку до fetch, но чтение SSE-стрима после успешного fetch может не завершиться по signal. Проверка: юнит `runGate` с никогда-не-резолвящимся мок-`streamChat` + `timeoutMs=20` обязан вернуть `{verdict:'react', error}` — для этого `runGate` строит `Promise.race([streamChat, таймер])` И прокидывает `signal` (двойная страховка); если race в тесте не срабатывает — читать `src/agent/llm.ts` streamChat и усилить обёртку.
3. **Форма ответа гейта**: модель может вернуть `READ_ONLY\n`, `read_only.` и т.п. Парсер: `includes('read_only')` (регистронезависимо) → read_only; иначе `includes('react')` → react; иначе `null` → fail-open react + trace «сбой парсинга». Проверка: живой прогон AC6 (trace должен показывать валидный вердикт на ответе чужого бота); при иной форме — расширить парсер, не менять ветку в handlers.
4. **`read_only`-контекст**: интерпретация AC1 «контекст обновляется» = запись `{question: text, answer: ''}` под `m.message_id` в `interbotThreadMemory`, плюс пропуск строки «Ответ:» при пустом `answer` в `buildIncomingPrompt` (иначе в контексте появится голая «Ответ: »). Проверка: существующий тест контекста `src/bot/interbot.test.mjs:343-360` (substring с непустыми значениями) должен пройти; если нет — хранить `'(без ответа)'` вместо `''` и не трогать промпт.
5. **Живой прогон AC6**: нужны два запущенных бота с токенами (`.env` обеих проектов, как в инциденте trace-md/trace-ui). Проверка перед прогоном: наличие `TELEGRAM_BOT_TOKEN`/`VIBELOG_LLM_*` в обоих проектах; если второго проекта/токенов нет — выполнить максимум локального (запуск одного бота под `--trace` + мок-ответы) и явно указать непройденную часть AC6 в отчёте Code.

## Шаги реализации (порядок)

1. **`src/bot/gate.ts` (новый)**:
   - `type GateVerdict = 'react' | 'read_only'`; `interface GateResult { verdict: GateVerdict; error?: string }`;
   - `buildGatePrompt(msg: {text, from_username?, is_bot}): string` — промпт doc-34 §3.2: «Есть ли в сообщении что-то, требующее НАШЕЙ реакции — вопрос к нам, реплика в нашу ветку, обращение к человеку в нашем присутствии? Уже на него ответили?» + классификация из §3.2 (приветствие человеку → react; отчёт чужого бота о том же → read_only; служебная ошибка → read_only; содержательный вопрос → react) + «Верни ТОЛЬКО одно слово: react или read_only»;
   - `parseGateVerdict(raw: string): GateVerdict | null` (см. предположение 3);
   - `async runGate(cwd, msg, opts?: { client?: LlmClient; timeoutMs?: number }): Promise<GateResult>` — **не бросает**: клиент `opts.client ?? createLlmClient({ cwd, apiMode: loadApiMode(cwd), maxRetries: 0 })` (приоритет модели — llm.ts:861, без session); вызов `client.streamChat([{role:'user', content: buildGatePrompt(msg)}], undefined, { signal, maxTokens: 16 })`; таймаут по умолчанию **2500 мс** (AbortSignal.timeout + Promise.race); любой сбой/таймаут/`null`-парсинг → `{verdict:'react', error: message}` (fail-open, §8.2).
2. **`src/bot/interbot.ts`**:
   - `buildIncomingPrompt` (360-385): в базовые `parts` строку `'Если отвечать нечего — верни ровно <no_answer>. В группу при этом ничего не отправляется.'`;
   - секция `opts.context`: строку `Ответ:` добавлять только при непустом `answer` (предположение 4);
   - новый экспорт `stripDecisionMarker(text: string): string` — удаляет все вхождения `[DECISION]` (case-insensitive), схлопывает осиротевшую пустую первую строку, trim хвоста.
3. **`src/bot/handlers.ts`**:
   - `HandlerDeps` (129-151): `gate?: (cwd, msg, opts?) => Promise<GateResult>` — шов по паттерну `startPrompt` (146-149);
   - вставка после блока `if (decision.action !== 'process')` (заканчивается ~1030), перед комментарием 1032:
     ```
     const gateRes = await (deps.gate ?? runGate)(deps.cwd, incoming, {...}) в try/catch (catch → {verdict:'react', error});
     trace('гейт:', gateRes.verdict, gateRes.error ? 'сбой:' + gateRes.error : '');
     if (gateRes.verdict === 'read_only') {
       rememberThreadPair([m.message_id], { question: text, answer: '' });
       trace('гейт: read_only — ран не запущен, message_id=', m.message_id);
       return;
     }
     ```
     (read_only → ничего не отправляем, только trace; контекст обновлён — AC1);
   - `onExit` (1049): после runFailed-блока и перед `if (!answer) return;` (1081): `if (answer.trim() === '<no_answer>') { trace('onExit: <no_answer> — тишина, ничего не отправляем'); return; }`;
   - публикация в группа (1114): `stripDecisionMarker(answer)` в `sendChatAnswer` И в `rememberThreadPair` (контекст — уже чистый);
   - карточка (1087-1111): без изменений — маркер остаётся, заголовок «⚖️ Требуется решение» = метка «решение» (AC5);
   - `ibot:ok` (2316): `stripDecisionMarker(pending.answer)` в отправку и в `rememberThreadPair`.
4. **`src/bot/gate.test.mjs` (новый)**: `parseGateVerdict` (варианты регистра/формы, мусор → null); `runGate` с мок-клиентом: `read_only` → read_only; `react` → react; клиент бросил → `{react, error}`; никогда не резолвится + `timeoutMs: 20` → `{react, error}` (AC2); `buildGatePrompt` содержит текст сообщения и оба вердикта. Каталоги — только mkdtemp, если потребуется fs (VL-241).
5. **`src/bot/interbot.test.mjs`**: промпт содержит `<no_answer>`-контракт (AC3); `stripDecisionMarker`: ведущий маркер, `[decision]`, маркер в середине, текст без маркера → noop; регресс `classifyAnswer` на исходном тексте (AC5).
6. **`src/bot/handlers.test.mjs`**:
   - хелперы 146 и 435: дефолт `gate: async () => ({ verdict: 'react' })` ДО `...extraDeps` (переопределяется в тестах VL-436) — иначе в тестах пойдёт реальный LLM-вызов (паттерн VL-240/lesson-78);
   - `describe('VL-436 …')`:
     a. гейт → `read_only` (с seam): `startPrompt` НЕ зван, ни одного send, trace-строка есть; затем reply-уточнение человека на это сообщение → prompt содержит context (AC1);
     b. гейт → `react`: `startPrompt` зван (AC1);
     c. seam бросил/таймаут → `startPrompt` всё равно зван (fail-open, AC2);
     d. `onExit({result:{result:'<no_answer>'}, exitCode:0})` → ни одного send (AC3);
     e. `onExit` с `[DECISION]`-ответом + `admin_chat` → карточка с маркером; `ibot:ok` → в группу БЕЗ маркера (AC5);
     f. `onExit` с `[DECISION]` без `admin_chat` → группа без маркера (тот же strip, AC5);
     g. AC4 — существующий тест 461 прогнать как есть (этап 3 закрыт VL-434, проверка).
7. **Сборка и тесты**: `pnpm build && pnpm test` (полный — DoD); точечный `pnpm test:fast -- src/bot/handlers.test.mjs` только для итераций.
8. **Документация**: `document_edit` doc-34 (§7 — галочки/отметки этапов 1,2,4,6 «VL-436») и doc-33 (раздел «Гейт и право молчать»). README НЕ трогать.
9. **Живой прогон (AC6)**: два бота под `node bin/vibelog.mjs bot --trace`; в группу «Всем привет!» → оба отвечают ровно один раз (гейт: react на приветствие человека), ответы чужих ботов получают `гейт: read_only`, новых «старт рана» нет, ≥60 с тишины; логи в `.vibelog/tmp/trace-*.log`.

## Как проверить

- `pnpm build && pnpm test` — полный зелёный прогон (DoD «Тесты проходят», «Нет регрессий»).
- Следить, чтобы юнит гейта не ходил в сеть (мок-клиент/`timeoutMs` малые).
- Живой прогон `--trace` по шагу 9.

## Риски

- **Задержка входа ~2.5 с** на каждое прошедшее правила сообщение (спека §8.1 разрешает 2–3 с; при последовательном поллинге grammy — очередь апдейтов, предположение 1).
- **Реальный LLM-вызов в старых тестах** при забытом стабе гейта — закрыто дефолтным стабом в обоих хелперах; при новых тестах со `handleUpdate` — всегда передавать `gate`.
- **Стоимость**: +1 дешёвый вызов на входящее (максимум `globalRunsPerHour`-лимитных) — `maxRetries: 0`, `maxTokens: 16`.
- **Срезка маркера в двух точках**: новая точка публикации в группу в будущем обязана звать `stripDecisionMarker` — отметить комментарием у `sendChatAnswer`-вызовов ветки.
- Ответ парсера гейта вне ожиданий → fail-open react: худший случай — прежнее поведение (ответ на пустое), но depth/лимиты (VL-434) остаются страховкой.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 12:52
---
Фаза 2 (Plan) выполнена. Тип: task (обычная задача, ветвление по epic не применялось). План записан в Implementation Plan: 8 файлов (2 новых — src/bot/gate.ts и gate.test.mjs; правки interbot.ts/handlers.ts + тесты; документы doc-34/doc-33 через document_edit). Точка вставки гейта — handlers.ts:1005-1032 после dispatchIncoming и до startPrompt (AC1 «после dedup/rate/addressing/тикет-ветки» подтверждена чтением); этап 3 «служебное не в группу» уже закрыт VL-434 (handlers.ts:1123-1130 + тест handlers.test.mjs:461) — в плане только проверка AC4; срезка [DECISION] — 2 точки публикации в группу (onExit handlers.ts:1114 и ibot:ok :2316), карточка остаётся с меткой «решение». Модель гейта — createLlmClient({cwd, apiMode: loadApiMode(cwd), maxRetries:0}) с приоритетом models.default → env VIBELOG_LLM_MODEL без session, таймаут 2500 мс, fail-open react. Обязательные разделы «Проверено по коду» (18 строк с файл:строка) и «Не проверено (предположения)» (5 пунктов: параллельность апдейтов grammy, обрыв чтения по signal, форма ответа гейта, семантика read_only-контекста, доступность живого прогона AC6) — есть. Риски: задержка входа до 2.5 с, реальный LLM-вызов в старых тестах (закрыто дефолтным стабом гейта в хелперах), стоимость +1 дешёвый вызов на вход.
---
author: @agent
created: 2026-11-19 13:23
---
Фаза 3 (Code) выполнена. Изменено: src/bot/gate.ts (новый — гейт buildGatePrompt/parseGateVerdict/runGate: модель createLlmClient({cwd, apiMode: loadApiMode(cwd), maxRetries:0}) приоритет models.default → env VIBELOG_LLM_MODEL без session, таймаут 2500 мс = AbortSignal + Promise.race, fail-open react с error), src/bot/interbot.ts (контракт <no_answer> в buildIncomingPrompt; строка «Ответ:» не рисуется при пустом answer (read_only-контекст); stripDecisionMarker), src/bot/handlers.ts (шов HandlerDeps.gate; ветка гейта после dispatch до startPrompt с trace решения/сбоя и записью read_only-контекста в interbotThreadMemory; onExit: ровно <no_answer> → тишина до classifyAnswer; stripDecisionMarker в 2 точках публикации в группу — onExit и ibot:ok), тесты: gate.test.mjs (новый: парсер, fail-open, таймаут), interbot.test.mjs (+3 теста: контракт, пустой context-ответ, срезка+регресс classifyAnswer), handlers.test.mjs (дефолтный стаб гейта в обоих хелперах против реального LLM-вызова в тестах; describe VL-436: read_only без рана/отправок + trace, read_only-контекст в следующем prompt, react → старт, fail-open при исключении шова + trace сбоя, <no_answer> без группы/карточки, карточка с маркером и «Требуется решение» + ibot:ok публикует без маркера (requireBind через chdir на tmp с restore), решение без admin_chat → группа без маркера, ошибка старта без отправок). Коммит b3e39aa. Проверки: pnpm build зелёный; ПОЛНЫЙ pnpm test — 239 файлов, 4606 passed / 4 skipped, без исключений и пропусков (DoD «Тесты проходят» и «Нет регрессий»). Проверены предположения плана: (1) grammy обрабатывает апдейты последовательно (bot.js:196 await handleUpdate в цикле) — гейт даёт паузу до ~2.5 с на вход, разрешено спекой §8.1, зафиксировано как свойство; (2) таймаут закрыт двойной страховкой (signal + race) — юнит с зависающим клиентом проходит за ~20 мс; (3) парсер терпим к форме ответа (read_only/react в любом регистре/с пунктуацией), мусор → fail-open; (4) read_only-контекст {question, answer:''} + пропуск «Ответ:» — существующий тест контекста (interbot.test.mjs:343) прошёл. Этап 3 (AC4) подтверждён прогоном существующего теста VL-434 (handlers.test.mjs:461). Что НЕ сделано и почему: (а) AC6 — живой прогон двумя ботами под --trace не выполнялся: в окружении этой сессии нет TELEGRAM_BOT_TOKEN/VIBELOG_LLM_API_KEY в .env и второго interbot-проекта (только этот cwd) — юнит-часть AC6 выполнена, живую часть нужно провести владельцу на паре проектов md+ui: «Всем привет!» → ответы обоих один раз, в trace чужые ответы помечены «гейт: read_only», новых «старт рана» нет; (б) документация doc-33/doc-34 НЕ обновлялась — по правилу фазы (CHANGELOG и backlog/docs пишет Close после слияния), поэтому DoD «Документация обновлена» не отмечен: Close должен дописать doc-34 §7 (этапы 1,2,4,6 → VL-436) и раздел в doc-33 «Гейт и право молчать». Отдельная настройка модели гейта — отложена (decision-модели), по спеке v1 не нужна.
---
author: @agent
created: 2026-11-19 14:07
---
Фаза Close выполнена. Статус: Done. Коммиты: feat b3e39aa (код — уже в master от Фазы Code), docs a85f059 (CHANGELOG + doc-33 + doc-34), docs(task) 35a1795 (lesson-302). Проверки: pnpm build зелёный; полный прогон — первая попытка упала 6 тестами в src/web/orchestrator.test.mjs (чужой модуль, вне diff: параллельного vitest в других worktree нет, флаки спавн-тестов под нагрузкой), повтор полного прогона после классификации — 239 файлов зелёные, без исключений (DoD «Тесты проходят» и «Нет регрессий» закрыты с оговоркой: одна классификация + один повтор, причина зафиксирована). Документация: CHANGELOG (запись Unreleased), doc-34 §7 — этапы 1/2/4/6 отмечены закрытыми VL-436 (этап 6: юнит закрыт, живой прогон отложен), doc-33 — раздел «Гейт и право молчать» (DoD «Документация обновлена»). Урок: lesson-302 (дефолтный стаб нового LLM-шова в registerHandlers-хелперах), связан с задачей. Незакоммичено: файл задачи VL-436 (коммитит framework), refs — нет. AC6 (живой прогон двумя ботами под --trace: «Всем привет!» → ответы один раз → тишина) НЕ выполнен — в окружении нет токенов второго interbot-проекта (TELEGRAM_BOT_TOKEN/VIBELOG_LLM_*); юнит-часть AC6 закрыта, живую часть провести владельцу на паре проектов md+ui — это внешняя проверка, как AC8 у VL-433.
---
<!-- COMMENTS:END -->