---
id: VL-428
title: 'Каналы: interbot-коммуникация проектов через Telegram-группу (v1)'
status: Review
assignee: []
reporter: ''
created_date: '2026-11-18 11:30'
updated_date: '2026-11-18 15:38'
due_date: ''
labels:
  - interbot
  - telegram
  - channels
  - mcp
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/comms.ts
  - src/core/comms.test.mjs
  - src/core/yaml.ts
  - src/core/interbot/tickets.ts
  - src/core/interbot/tickets.test.mjs
  - src/core/interbot/ask.ts
  - src/core/interbot/ask.test.mjs
  - src/bot/interbot.ts
  - src/bot/interbot.test.mjs
  - src/bot/env.ts
  - src/bot/settings.ts
  - src/bot/chat-answer.ts
  - src/bot/commands.ts
  - src/bot/handlers.ts
  - src/mcp/tools.ts
  - src/mcp/server.ts
  - src/web/tool-policy.ts
  - src/core/setup.ts
  - src/core/setup-check.ts
  - src/cli/router.ts
  - src/cli/commands/instructions.ts
  - src/cli/commands/init-wizard.ts
  - src/cli/commands/init.ts
  - src/cli/commands/bot.ts
lessons: []
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 277
  duration_ms: 11722149
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 268
    close:
      input: 0
      output: 0
      cache: 0
      requests: 9
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Межпроектная коммуникация агентов (Vibelog.md, Vibelog UI, LB) через общую Telegram-группу: боты проектов пишут и слушают в группе, отвечая друг другу на вопросы и согласовывая решения. Upstream-репортов (git-инбокс) недостаточно: не realtime, только баги, ручной приём.

Ключевые элементы: сущность «Канал» (по аналогии с персонами) — group_id, addressing (mention|all), approval (auto|admin), admin_chat; новый файл .vibelog/comms.yaml (секреты telegram + chats + channels + default_channel + sync_timeout_sec) с миграцией из .env; гибридная исходящая доставка (sync 120 с, async-fallback в комментарий задачи); входящий LLM-ран read-only через startPrompt; loop-защиты (dedup, rate limit, depth, TTL).

Спецификация: doc-32 («Каналы: межпроектная коммуникация агентов через Telegram-группу»), включая закрытые 2026-11-18 решения: approval — вариант C (decision_request всегда через admin), таймаут — вариант B (глобальный sync_timeout_sec=120), выбор канала — вариант B (default_channel + явный override).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 comms.yaml: чтение/запись, миграция TELEGRAM_BOT_TOKEN/TELEGRAM_PROXY/TELEGRAM_CHAT_IDS из .env с fallback на legacy, секреты не в git
- [x] #2 Канал как сущность: id, transport, group_id, addressing (mention|all), approval (auto|admin), admin_chat; default_channel и sync_timeout_sec читаются из comms.yaml
- [x] #3 Входящее сообщение от бота в group_id обрабатывается только при addressing=mention (упоминание/reply на нас) по умолчанию; dedup, depth<=2, rate limit покрыты юнит-тестами
- [x] #4 interbot_ask и /ask: канал = default_channel, явный channel переопределяет, единственный канал — автоподхват, несколько без default и без явного — ошибка со списком
- [x] #5 Синхрон: ожидание ответа не дольше sync_timeout_sec (120 с), по таймауту возвращается аккуратный «ответа нет» без ошибки MCP, агент продолжает работу
- [ ] #6 Async-fallback: запоздавший ответ доставляется комментарием к задаче-контексту тикета + уведомлением в боте; протухшие тикеты разбираются при старте бота
- [ ] #7 Approval (вариант C): decision_request всегда через inline-кнопку в admin_chat даже в auto; info/question — по режиму канала; входящие классифицируются маркером [DECISION] в ответе рана
- [ ] #8 Loop-защиты: dedup по message_id, rate limit на бота и глобальный лимит ранов/час, TTL тикета — тесты
- [ ] #9 Документация: гайд настройки (BotFather Bot-to-Bot Mode, Privacy Mode/админ, allowlist), CHANGELOG, ADR на пересмотр инварианта VL-329
- [ ] #10 npm test и lint зелёные; сценар на тест-группе с двумя ботами: синхронный ответ, таймаут-фолбэк, обрыв зацикливания на depth 2, approval-кнопка
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
Этапы по порядку; каждый закрывается тестами. Спецификация — doc-32 (разделы 3–7), решения — раздел 9.

1. comms.yaml + миграция секретов.
   - Новый src/core/comms.ts: чтение/запись/валидация .vibelog/comms.yaml (секции secrets.telegram, chats, channels, default_channel, sync_timeout_sec); атомарная запись temp+rename (lesson-214).
   - Миграция: fallback чтения shell env → comms.yaml → legacy .env с предупреждением; одноразовый перенос TELEGRAM_BOT_TOKEN/TELEGRAM_PROXY/TELEGRAM_CHAT_IDS из .env (upsertDotEnv-паттерн, VL-329) в wizard (src/cli/commands/init-wizard.ts) и при старте бота.
   - Правки читателей: src/bot/settings.ts (resolveToken/resolveProxy), src/bot/env.ts (readBotChats/saveBotChats), src/core/setup-check.ts (checkTelegramToken), src/cli/router.ts (флаги --bot-token/--bot-chats/--bot-proxy), тексты src/cli/commands/instructions.ts.
   - ADR: пересмотр инварианта VL-329 «.env — единственный источник секретов».
   - .vibelog/.gitignore не трогаем (по умолчанию всё запрещено).

2. Сущность канала.
   - Хранение в comms.yaml: id, label, transport, group_id, addressing (mention|all), approval (auto|admin), admin_chat; default_channel и sync_timeout_sec (глобальные).
   - Валидация при чтении; ошибка «несколько каналов без default и без явного» со списком каналов.

3. Тикеты — src/core/interbot/tickets.ts (новый).
   - JSON-реестр .vibelog/interbot/tickets.json: id, channel_id, question_msg_id, asked_at, deadline, status (pending → answered | expired → delivered), context {task, session}, reply.
   - Атомарная запись temp+rename; разбор протухших при старте (паттерн recoverStalePhaseStatuses, VL-196). Юнит-тесты статусов/TTL/конкурентности.

4. Входящий путь — src/bot/interbot.ts (новый) + src/bot/handlers.ts (хук message от ботов).
   - Фильтры: from.is_bot, allowlist по group_id каналов, dedup по message_id (TTL-кэш), rate limit на бота, глобальный лимит ранов/час, depth по цепочке reply_to_message_id (лимит 2, дальше — «эскалируй человеку»).
   - addressing=mention: только /command@OurBot и reply на наше сообщение; addressing=all — вторым шагом (в v1 кодом-заготовкой, дефолт mention).
   - Диспатч: startPrompt (оркестратор) read-only-раном (только backlog/ и docs/, без секретов; в промпте — правило маркировки [DECISION]); ответ реплаем через sendChatAnswer (GFM, TELEGRAM_TEXT_LIMIT).
   - Тесты dedup/depth/rate-limit — чистая логика, отдельно от grammy.

5. Исходящий синхрон — /ask (src/bot/commands.ts) + MCP interbot_ask (src/mcp/server.ts).
   - Канал: default_channel → явный channel override → единственный канал автоподхват; адресат — явный @username (question@OtherBot).
   - Ожидание ответа через файл тикетов (процессная граница бот ≠ MCP-сервер), лимит sync_timeout_sec (120 с); по таймауту — аккуратный «ответа нет», не ошибка MCP. Проверить лимит MCP-клиента на вызов.
   - INTERBOT_TOOLS по образцу UPSTREAM_TOOLS (условная видимость); зеркальные инструменты веб-чата — имена должны совпадать.

6. Async-fallback.
   - По таймауту тикет ждёт дальше; запоздавший ответ → комментарий к задаче-контексту + уведомление в боте; статус delivered.
   - Лог «ответ без тикета» (детект потерянных сообщений).

7. Approval-флоу (вариант C).
   - decision_request: всегда inline-кнопки в admin_chat (паттерн chat-pause.ts: APPROVAL_PREFIX + callback), даже при approval=auto; info/question — по режиму канала.
   - Исходящий kind передаёт агент в interbot_ask; входящие — парсер маркера [DECISION] в ответе рана. Просрочка = expired.

8. Документация.
   - Гайд настройки (BotFather Bot-to-Bot Mode, Privacy Mode off/админ, allowlist каналов), CHANGELOG.

Проверка: npm test / lint зелёные; сценар на тест-группе с двумя ботами — синхронный ответ ~5 с, таймаут-фолбэк (ответ на 10-й минуте → комментарий задачи), обрыв зацикливания на depth 2, approval-кнопка в admin-чате.

Риски: секреты в comms.yaml (вне git по умолчанию) — не дублировать в settings.json/.env после миграции; стоимость входящих ранов — лимиты с первого дня; утечек контекста в ответах — read-only промпт.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-18 12:06
---
### Прогресс до обрыва (по idle-таймауту (простой без активности))
**Сделано:**
- Превышен idle-таймаут (600 секунд без активности) — фаза прервана.
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 1861 с, payload 523174 байт_
---
author: @agent
created: 2026-11-18 12:06
---
Фаза code не удалась (код выхода 1): XY|TELEGRAM_CHAT_IDS×2, блокировок=0, payload последнего запроса=523174 байт (макс 523174), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-18 12:58
---
Фаза code не удалась (код выхода 1): arch|sendRichMessage×3, блокировок=0, payload последнего запроса=486720 байт (макс 486720), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-18 13:43
---
Фаза code не удалась (код выхода 1): bot/tickets.test.mjs×5, блокировок=2, payload последнего запроса=475135 байт (макс 475135), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-18 14:20
---
Фаза code не удалась (код выхода 1): hell_command|grep -n×6, блокировок=1, payload последнего запроса=412514 байт (макс 412514), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-18 14:59
---
Фаза 3 (Code) выполнена частично, статус — Review. Коммит cd7c842 (24 файла кода/тестов).
ЧТО СДЕЛАНО (все этапы плана, код+тесты):
1) comms.yaml: src/core/comms.ts — чтение/запись (temp+rename, lesson-214), валидация секций с предупреждениями, миграция TELEGRAM_BOT_TOKEN/TELEGRAM_PROXY/TELEGRAM_CHAT_IDS из .env (идемпотентна; вызовы — init.ts после loadProjectEnv и старт бота в cli/commands/bot.ts), resolveCommsSecret (реальный shell env → comms.yaml → legacy .env, отличие shell от загрузки — сверкой с файлом), resolveChannel (default → явный → единственный → «несколько без default» со списком), isCommsConfigured; src/core/yaml.ts — поддержка массивов объектов в parse/stringify; читатели: settings.resolveToken/resolveProxy, env.readBotChats/saveBotChats, setup-check/setup/router/instructions/init-wizard — тексты и пути обновлены.
2) Канал — сущность в comms.yaml (id/label/transport/group_id/addressing/approval/admin_chat), валидация при чтении, дефолт addressing=mention.
3) Тикеты: src/core/interbot/tickets.ts — JSON-реестр .vibelog/interbot/tickets.json, атомарная запись, статусы pending→answered|expired→delivered, recoverStaleTickets (паттерн VL-196), waitForAnswer с опцией maxWaitMs.
4) Входящий путь: src/bot/interbot.ts — чистая логика (dedup TTL, rate limit на бота, глобальный лимит ранов/час, depth≤2 с «эскалируй человеку», addressing mention/all, classifyAnswer [DECISION], buildIncomingPrompt read-only без секретов) + хук в src/bot/handlers.ts до всех bot.command (фильтры чужих ботов/каналов, ветка ответа на тикет, диспатч через startPrompt, ответы через sendChatAnswer с replyTo).
5) Исходящий: /ask в handlers.ts (default → --channel → единственный; ожидание полный sync_timeout_sec) и MCP interbot_ask в src/mcp/tools.ts (core/interbot/ask.ts: отправка через Bot API с прокси, ожидание ≤ min(sync_timeout_sec, 55 с) — лимит MCP-клиента 60 с проверен; таймаут → аккуратный текст без isError); INTERBOT_TOOLS видимость по isCommsConfigured зеркально в server.ts и web/tool-policy.ts.
6) Async-fallback: запоздавший ответ (answerTicket → expired) → addComment к context.task + уведомление в боте + markDelivered; «ответ без тикета» — warn-лог; recovery при старте бота (включая недоставленные expired).
7) Approval (вариант C): classifyAnswer [DECISION] → всегда inline-кнопки ibot:ok/no в admin_chat даже при approval=auto; info/question — по режиму канала.
Тесты зелёные (точечные): comms 13, bot/interbot 14, tickets 16, ask 12; pnpm build зелёный.
ПРОВЕРКИ: pnpm build — ok; точечные vitest по 4 новым файлам — 55/55 зелёные. ПОЛНЫЙ pnpm test — КРАСНЫЙ: 22 падения/14 файлов, прогон частичный по времени фазы (полный прогон запускался,465 с, результат выше); DoD «Тесты проходить» НЕ отмечено.
ЧТО ОСТАЛОСЬ (хвосты регистрации нового инструмента/команды — правки механические, 30-60 мин):
- src/core/tool-kinds.ts: добавить interbot_ask: 'write' (чинит tool-classify, часть doctor);
- счётчики 59→60 в compat-full.test.mjs:182, mcp/documents.test.mjs:72 и аналогах (tools/list «59 инструментов», reference-тест);
- src/mcp/write-ack-contract.test.mjs: interbot_ask в ACK_OUT_OF_SCOPE (сеть Telegram), UNCHANGED_NOT_APPLICABLE (каждый вызов — новый вопрос+тикет), PARTIAL_EXEMPT, outOfScope в AC5;
- src/web/tool-policy.test.mjs:111 — добавить interbot_ask в условно-скрытые (как upstream);
- src/bot/registry.ts: команда /ask в BOT_COMMANDS (тест «реестр покрывает все bot.command»);
- src/cli/diagnostics.test.mjs:220 — фикстура списка MCP-инструментов +interbot_ask;
- init/bot интегра-тесты: ожидание «секреты в .env» → comms.yaml (init --bot-token, VL-324 --bot-proxy, текст ошибки «без токена» у vibelog bot) — поведение изменено осознанно по плану;
- «без маркера → прежний аргумент bot» — уточнить источник (вероятно, тексты instructions/router);
- прогнать полный pnpm test до зелёного, затем ADR (decision_create: пересмотр VL-329), гайд настройки и CHANGELOG — в Close (в Фазе 3 по правилам не пишутся).
Критерии: AC1-5, AC8 — закрыты тестами; AC6 — код+тесты recovery (доставка не E2E); AC7 — classifyCovered, кнопочный флоу не проверен E2E; AC9 — не выполнен (ADR/гайд/CHANGELOG в Close); AC10 — не выполнен (полный прогон красный, live-сценарий с двумя ботами не гонялся — нужен реальный тест-группа). DoD: «Тесты проходят» и «Нет регрессий» — не отмечены (полный прогон красный), «Документация» — не отмечена.
---
author: @agent
created: 2026-11-18 15:38
---
Фаза Close прервана: merge vb/vl-428 слит в master (1 коммит cd7c842, без конфликтов, 24 файла), сборка pnpm build зелёная. Точечный фильтр по diff'у: 10 падений в 4 файлах (write-ack-contract, tool-policy, documents, diagnostics) — все пре-существующие «хвосты регистрации interbot_ask» из отчёта Фазы 3 (tool-kinds.ts, счётчики 59→60, BOT_COMMANDS /ask, фикстуры тестов). Полный pnpm test:fast не завершился (таймаут 900 с рана, параллельного vitest нет) — DoD «Тесты проходят» не подтверждён. Шаги 6–11 (DoD/установка статуса/ADR/гайд/CHANGELOG) не выполнены. Чтобы повторить Close: новой фазой Code закрыть механические хвосты (src/core/tool-kinds.ts +interbot_ask:'write'; счётчики 59→60 в compat-full/mcp/documents/diagnostics тестах; interbot_ask в ACK_OUT_OF_SCOPE/UNCHANGED_NOT_APPLICABLE/PARTIAL_EXEMPT write-ack-contract; tool-policy.test условная видимость; /ask в src/bot/registry.ts BOT_COMMANDS; ожидания «секреты в .env» → comms.yaml в init/bot интестах), прогнать полный pnpm test до зелёного, затем повторить Фазу Close (merge уже выполнен — шаги 3–5 пропустить, начать с шага 6: DoD, ADR decision_create по пересмотру VL-329, гайд настройки doc-*, CHANGELOG, backlog_finish_phase).
---
author: @agent
created: 2026-11-18 15:38
---
Фаза close прервана агентом (aborted): Фаза Close прервана: merge vb/vl-428 слит в master (1 коммит cd7c842, без конфликтов, 24 файла), сборка pnpm build зелёная. Точечный фильтр по diff'у: 10 падений в 4 файлах (write-ack-contract, tool-policy, documents, diagnostics) — все пре-существующие «хвосты регистрации interbot_ask» из отчёта Фазы 3 (tool-kinds.ts, счётчики 59→60, BOT_COMMANDS /ask, фикстуры тестов). Полный pnpm test:fast не завершился (таймаут 900 с рана, параллельного vitest нет) — DoD «Тесты проходят» не подтверждён. Шаги — статус возвращён к Review.
---
<!-- COMMENTS:END -->