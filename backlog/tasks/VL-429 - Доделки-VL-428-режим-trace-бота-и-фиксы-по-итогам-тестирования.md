---
id: VL-429
title: 'Доделки VL-428: режим --trace бота и фиксы по итогам тестирования'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-18 20:53'
updated_date: '2026-11-18 21:36'
due_date: ''
labels:
  - interbot
  - telegram
  - trace
  - vl-428
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/chat-answer.test.mjs
  - src/bot/chat-answer.ts
  - src/bot/handlers.ts
  - src/bot/interbot.test.mjs
  - src/bot/interbot.ts
  - src/bot/restart.test.mjs
  - src/cli/commands/bot.ts
  - src/cli/up.test.mjs
  - src/core/env-file.test.mjs
  - src/core/interbot/ask.test.mjs
  - src/core/interbot/ask.ts
lessons:
  - lesson-296
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 113
  duration_ms: 2292213
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 54
    close:
      input: 0
      output: 0
      cache: 0
      requests: 59
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
По итогам ручного тестирования VL-428 (входящее/исходящее между ботами Vibelog.md и Vibelog UI). Выявлено: (1) диагностика невозможна без логов — приходится выяснять вручную, дошло ли сообщение, в какую ветку ушло и почему молча проигнорировано; (2) дырка 55–120 с: MCP-вызов возвращается на 55-й секунде, а answerTicket со статусом answered (до дедлайна 120 с) доставки не делает — запоздавший до дедлайна ответ теряется; (3) sendChatAnswer шлёт reply третьим аргументом кастомного sendRichMessage — если сервер его проигнорирует, ответ уходит БЕЗ reply, тикет его не ловит (маскируется под «интербот молчит»); (4) ошибка LLM-рана классифицируется как info/question и уходит админу на согласование как «ответ» — мусор вместо уведомления.

Этап 1 — режим vibelog bot --trace (вся диагностика в консоль), чтобы фиксы проверять под трассировкой.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 --trace: флаг bot.ts передаётся в HandlerDeps; без флага поведение и лог-вывод бота не меняются
- [x] #2 Trace логирует: входящее сообщение (chat, message_id, от кого, reply_to, усечённый текст), решение по каналу, ветку тикета (совпадение question_msg_id, статус answerTicket), решение dispatch с причиной, старт/результат рана, kind и куда ушёл ответ (группа/admin_chat), approval-callback и его исход
- [x] #3 dispatchIncoming: в IncomingDecision добавлен reason (dedup|rate|depth|not-addressed|run-limit|ignore) и он выводится в trace
- [x] #4 Секреты (токены, comms.yaml) не попадают в trace; длинный текст усекается
- [x] #5 Фикс 55–120 с: тикет, ставший answered после возврата MCP-вызова, доставляется клиенту через async-канал (уведомление/комментарий), а не теряется
- [x] #6 sendChatAnswer: при наличии replyTo ответ гарантированно доходит с reply (rich проигнорировал reply_parameters → фолбэк sendMessage с reply_parameters до потери reply); тикет ловит ответ
- [x] #7 Ошибка рана не отправляется как «ответ на согласование» — приходит отдельным уведомлением админу (ошибка ≠ кандидат на approve)
- [ ] #8 npm test и lint зелёные; сценар: бот с --trace на тест-группе, по логам подтверждена цепочка входящее → ветка/диспатч → ран → ответ/тикет
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
Этап 1 — режим --trace (diagnostics first):
1. src/cli/commands/bot.ts: парсинг флага --trace в runBot, передача в registerHandlers deps { cwd, getPin, trace }.
2. src/bot/handlers.ts: интерфейс HandlerDeps += trace: boolean; локальный helper trace(...args) → console.log('[trace]', ...) при trace=true, иначе noop. Точки логирования в interbot-ветке (bot.on('message:text'), строки ~616-735):
   - вход: message_id, chat_id, from(id/username/is_bot), reply_to, text.slice(0,100);
   - канал: найден/нет для chat_id;
   - ветка тикета: repliedTo и результат .some() (match/no-match), статус после answerTicket, ветка expired → deliverLateTicket;
   - решение dispatch: action + reason (см. п. 3), depth;
   - старт рана (prompt усечённо), onExit: exitCode, kind, needsAdmin, куда ушло (group chatId / admin_chat), отправка sendChatAnswer(replyTo);
   - approval-callback ibot:ok/no: id, результат отправки.
   Не логировать: токены, содержимое comms.yaml. Без --trace вывод не меняется (AC2).

3. src/bot/interbot.ts: IncomingDecision action='answer' += reason: 'dedup'|'rate'|'depth'|'not-addressed'|'run-limit'|'ignore'; dispatchIncoming заполняет его во всех ветках. Тесты interbot.test.mjs дополнить проверками reason.

Этап 2 — фиксы (проверять под trace на тест-группе):
4. Дырка 55–120 с: в handlers-ветке answerTicket — если статус answered, а MCP-клиент уже вернулся (проверка по времени: now > asked_at + MCP_CALL_CAP_SEC либо флаг «ожидающий ждущий вызов»), доставлять через deliverLateTicket-канал (комментарий к task-контексту + уведомление в боте). Сложность: MCP-процесс не знает о своём возврате — поэтому доставка на стороне бота: ждущий файл опрос не отслеживает... Вариант: в tickets.json поле delivered_to_caller: нет; проще — answerTicket всегда помечает answered, а если после answered тикет не забрал никто (нет способа...) → реализация: уменьшить дедлайн тикета при interbot_ask до MCP_CALL_CAP_SEC (ask.ts передаёт timeoutSec = min(sync_timeout_sec, MCP_CALL_CAP_SEC)) — тогда ответ после 55 с = expired → deliverLateTicket сработает штатно. Это минимальный и честный фикс.
5. sendChatAnswer (src/bot/chat-answer.ts): после sendRichMessage с reply_parameters — проверить, что ответ действительно с reply... API возвращает сообщение — если расширение не возвращает message_id/reply, детект невозможен надёжно. Минимально: если opts.replyTo задан и rich-расширение не поддерживает третий аргумент (проверка по ответу/ошибке) → фолбэк sendMessage с reply_parameters (текущий фолбэк только при исключении). Тест: ручной сценар в trace — reply линия присутствует.
6. Ошибка рана: в onExit — если run.result.is_error / exitCode != 0 / текст содержит '[API Error:' — НЕ уводить в pendingDecisions; слать отдельным сообщением в admin_chat («⚠️ Ран упал, ответа нет») без кнопок approve; в группу ничего.

Проверка: npm test / lint; сценарий на тест-группе с двумя ботами под vibelog bot --trace: входящий вопрос → видны шаги (канал/диспатч/ран/onExit), ответ с reply ловится тикетом (answered), ответ раньше 55 с — синхронно в interbot_ask, позже — expired → уведомление; ошибка рана приходит уведомлением, а не карточкой согласования.

Риски: --trace не должен лить чувствительные данные (усечение текста, запрет на comms-секции); лог-спам при потоке сообщений — префикс + возможность включать только в dev-запуске.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-18 21:23
---
Фаза 3 (Code) выполнена. Коммит 77af7a7 (11 файлов).
Этап 1 — режим --trace: src/cli/commands/bot.ts парсит --trace и передаёт trace в registerHandlers(HandlerDeps.trace?: boolean); в handlers.ts локальный helper trace(...) → console.log('[trace]', ...) при флаге, иначе noop — без флага вывод не меняется (AC1). Точки логирования: вход (message_id/chat_id/from/reply_to/текст.slice(0,100)), канал найден/нет, ветка тикета (reply_to, совпадение, статус answerTicket, expired→deliverLateTicket), dispatch action+reason+depth, старт рана (prompt 100 символов), onExit (exitCode/kind/needsAdmin/куда ушёл ответ), approval-callback ibot:ok/no (id, исход отправки). Токены и comms.yaml не логируются, текст усечён (AC2/AC4). dispatchIncoming: reason ∈ dedup|rate|depth|not-addressed|run-limit|ignore заполняется во всех ветках answer и выводится в trace (AC3, interbot.test.mjs дополнен проверками reason).
Этап 2 — фиксы: (55–120 с) ask.ts: дедлайн тикета = askTicketDeadlineSec(sync_timeout)=min(sync,55) — ответ позле 55 с = expired → штатный deliverLateTicket (AC5, ask.test.mjs: контракт дедлайна). sendChatAnswer: при replyTo проверяется ответ rich (message_id без reply_to_message = reply проигнорирован) → delete + фолбэк sendMessage с reply_parameters до потери reply (AC6, 4 новых теста). Ошибка рана (is_error / exitCode≠0 / '[API Error:') в onExit — не в pendingDecisions: отдельное «⚠️ Ран упал, ответа нет» в admin_chat без кнопок, в группу ничего (AC7).
Проверки: pnpm test — ПОЛНЫЙ прогон зелёный (236+1 файлов, 4542 теста, включая src/web/static.test.mjs; исключений нет), pnpm lint — OK, pnpm build — OK. Попутно устранены 3 предсуществующих падения тестов из-за окружения хоста (не связаны с кодом VL-429): spawnEnv в restart.test.mjs стрипит ambient VIBELOG_UP/VIBELOG_UP_PORT (в окружении рана висит VIBELOG_UP=1), env-file.test изолирует process.cwd от локального comms.yaml (чаты из ручного теста VL-428), в up.test закрыта гонка child.once('exit') после фактического завершения (120s-таймаут).
Не выполнено: AC8 вторая часть — живой сценарий с двумя ботами на тест-группе Telegram НЕ проводился (нет доступа к реальной группе из среды исполнителя) — проверить под vibelog bot --trace при ручном тесте; DoD «Документация обновлена» — в Фазе 3 CHANGELOG/docs не обновляются (пишет Close). References/lessons отсутствуют — шаги пропущены.
---
author: @agent
created: 2026-11-18 21:35
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 77af7a7 (11 файлов src/, сделан в Code), docs bdb3d80 (CHANGELOG + doc-6/doc-32/doc-33), docs(task) a22ebce (lesson-296).
Проверки: pnpm lint — OK; pnpm test — ПОЛНЫЙ прогон зелёный (build + vitest, включая src/web/static.test.mjs; исключений нет, повторных прогонов не требовалось). Рабочее дереве чисто от кода: все modified_files уже в 77af7a7, параллельных фаз нет.
Документация (DoD 2): CHANGELOG — две записи в Unreleased (VL-429 «Добавлено»: режим vb bot --trace + reason dispatch; «Исправлено»: три фикса); doc-33 — ужатие дедлайна в §Синхронный ответ, упавший ран в §Approval-флоу, новый раздел «Диагностика: режим --trace»; doc-32 — deadline тикета в §4, закрыт вопрос §9.2 (лимит MCP-клиента проверен в VL-429); doc-6 §11 — упоминание --trace.
Lessons: новых нет (причины дефектов зафиксированы в комментариях кода и doc-32/33 — пересказ диффа уроком не является); lesson-296 дополнена linked_tasks += VL-429 и фактом частичного снятия обхода (restart.test стрипит VIBELOG_UP в spawnEnv, strip в test-env.mjs ещё не сделан). Refs отсутствуют.
Не закоммичено: файл задачи VL-429 и .vibelog/billing/VL-429.json (коммитит framework после token_usage); backlog/config.yml и .vibelog/settings.json — локальные изменения окружения, не относятся к задаче.
Честная оговорка: AC8 вторая часть (живой сценарий с двумя ботами на тест-группе под --trace) НЕ выполнена — из среды исполнителя нет доступа к реальной Telegram-группе; проверить при ручном тесте по шагам из описания (входящее → шаги trace → ответ с reply ловится тикетом; ответ позже 55 с → expired → уведомление; ошибка рана → уведомление админу, не карточка).
---
<!-- COMMENTS:END -->