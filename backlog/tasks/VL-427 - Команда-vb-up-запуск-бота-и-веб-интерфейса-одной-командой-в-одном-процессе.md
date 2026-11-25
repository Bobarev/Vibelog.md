---
id: VL-427
title: 'Команда vb up: запуск бота и веб-интерфейса одной командой в одном процессе'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-18 09:38'
updated_date: '2026-11-25 15:42'
due_date: ''
labels:
  - cli
  - bot
  - web
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
  - src/cli/commands/up.ts
  - src/cli/router.ts
  - src/cli/command-registry.ts
  - src/cli/update-check.ts
  - src/cli/update-check.test.mjs
  - src/cli/up.test.mjs
  - src/bot/web.ts
  - src/bot/restart.ts
  - src/bot/restart.test.mjs
  - src/bot/handlers.ts
  - src/web/server.ts
lessons: []
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 86
  duration_ms: 4182149
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 53
    close:
      input: 0
      output: 0
      cache: 0
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: пользователь держит 3-4 проекта параллельно и вынужден открывать 2 вкладки терминала на проект (vb bot + vb browser) = 6-8 вкладок. Просьба: одна команда, запускающая и бота, и браузер.

Решение (принято в чате): новая команда `vb up`, НЕ флаги --bot/--web у существующих (старые команды не трогаем).

Техническая основа (проверено по коду):
- бот — long-polling grammy (bot.start() не блокирует event loop), веб — обычный HTTP-сервер; в одном процессе сосуществуют;
- оба уже делают loadProjectEnv(cwd) и recoverStalePhaseStatuses — дубли безвредны (идемпотентны);
- оба используют src/web/orchestrator.ts — В ОДНОМ ПРОЦЕССЕ общий activeRuns: фаза, запущенная из бота, видна вебу (сейчас два процесса делят состояние только по файлам). Это побочный плюс команды up.

Краевые места (взять в задачу):
1. /web start из чата (src/bot/web.ts spawnWebServer) спавнит дочерний `vibelog browser` — в режиме up это второй сервер на том же порту → нужна защита: up помечает процесс, /web start отвечает «веб уже запущен (порт)» без спавна.
2. /restart (src/bot/restart.ts spawnReplacementBot) спавнит замещающий процесс как `bot` — после рестарта в up-режиме веб умрёт. Нужен маркер режима (env или аргумент), который spawnReplacementBot учитывает.
3. Сбой одной части не должен ронять другую: нет токена → ошибка бота, веб живёт; занятый порт → ошибка веба, бот живёт.
4. STARTUP_NOTIFY_COMMANDS (src/cli/update-check.ts) — добавить 'up', иначе проверка обновления будет и до, и после route для долгоживущей команды.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда vb up запускает и веб-сервер, и Telegram-бота в ОДНОМ процессе: в одном терминале видны и URL/лог веба, и пин-код бота
- [x] #2 Флаги --port/--host/--no-open прокидываются в веб-часть; флагов бота нет (как и сейчас: токен из .env)
- [x] #3 Отсутствие токена бота не роняет веб: vb up печатает ошибку токена и продолжает держать веб-сервер (и наоборот — занятый порт не мешает боту работать, ошибка веба печатается, бот стартует)
- [x] #4 В одном процессе общее состояние фаз: startTaskPhase из бота виден вебу (общий activeRuns) — подтверждается хотя бы ручной проверкой или комментарием-инвариантом в коде
- [x] #5 /web start из чата в режиме up отвечает, что веб уже запущен в этом процессе (порт), и НЕ спавнит второй сервер
- [x] #6 /restart в режиме up перезапускает замещающий процесс с тем же режимом (up, а не bot) — иначе после рестарта веб умирает; env-маркер или аргумент, решение в коде
- [x] #7 vb up входит в STARTUP_NOTIFY_COMMANDS (update-check), реестр CLI-команд (capabilities) и справку router.ts; doc-7 дополнен
- [ ] #8 pnpm test зелёный: новый тест (vb up без токена → сервер поднялся, бот-ошибка в stderr; занятый порт → бот жив), регрессия cli.test.mjs
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

1. **src/cli/commands/up.ts (новый)** — команда `vb up`
2. **src/cli/router.ts** — case 'up' + справка
3. **src/cli/command-registry.ts** — запись для capabilities
4. **src/cli/update-check.ts** — STARTUP_NOTIFY_COMMANDS += 'up'
5. **src/bot/web.ts** — защита `/web start` от двойного сервера
6. **src/bot/restart.ts + handlers.ts** — /restart сохраняет режим up
7. **doc-7** (CLI-справочник), CHANGELOG
8. **Тесты**: src/cli/up.test.mjs (новый), правки cli.test.mjs/restart-тестов

## Дизайн команды

`vb up [--port N] [--host H] [--no-open]` — веб-флаги как у browser; флагов бота нет.

Порядок в `runUp(positional, flags, cwd)`:

1. Веб первым: `await runBrowser(...)` возвращает `Server` — если listen упал (занят порт), ловим событие 'error' и печатаем понятную ошибку, НЕ выходя — бот всё равно стартует (AC3). Тонкость: `startWebServer` возвращает сервер до фактического listen — подождать первое событие 'listening'/'error' (промис), иначе «порт занят» увидим уже после старта бота, и наоборот бот-ошибка не должна выстрелить раньше. Пометить процесс: `process.env.VIBELOG_UP = '1'` (единый маркер режима для /web и /restart) — сделать ДО вызова бота.
2. Бот вторым: `await runBot(...)` — он сам печатает пин, грузит env (повторный loadProjectEnv идемпотентен), ловит свои ошибки внутри и возвращается. Нет токена → его сообщение об ошибке, процесс продолжает жить на сервере (держит event loop) — AC3.
3. После возврата runBot (только при его раннем выходе) — печать итога: «веб работает на <url>, бот не запущен: <причина>».

Чего НЕ делаем (и почему): не переписываем runBot/runRunBrowser под «возврат handle» (лишний рефакторинг — оба уже самодостаточны); не грациозный shutdown по SIGINT (текущее поведение обеих команд — дефолтный SIGINT, up наследует, отдельной задачи не создаём).

## Общий activeRuns (плюс режима)

В одном процессе `startTaskPhase` бота и веб-API пишут в один `activeRuns` (`src/web/orchestrator.ts`) — фаза из чата видна на канбане с первой секунды, не только через файлы. В коде — комментарий-инвариант (не тест: активировать ран из бота в юнит-тесте CLI непропорционально; AC5 закрывается ручной проверкой в инструкции к задаче).

## Краевое 1: /web start в режиме up

`src/bot/web.ts`: в хендлере `/web` (handlers.ts) — если `process.env.VIBELOG_UP === '1'`, не спавнить дочерний процесс: ответ «Веб уже запущен в этом процессе: http://127.0.0.1:<port>» (порт — из config.default_port/аргументов up; для простоты — считать, что up использует настроенный порт, в хендлере брать `loadConfig(cwd).default_port || 3030`; рассинхрон `--port` у up и хендлера — упомянуть в doc-7: `/web` в режиме up показывает порт из конфига). `/web stop` в режиме up — отвечает, что остановить можно только Ctrl+C (kill дочернего процесса неприменим).

## Краевое 2: /restart в режиме up

`spawnReplacementBot` (src/bot/restart.ts): если `process.env.VIBELOG_UP === '1'` (и не задан явный cliPath-аргумент из worktree-ветки — там поведение `/restart VL-N` не менять... нет, наоборот: worktree-режим должен сохранять up тоже, т.к. worktreeCliPath — просто путь к CLI, режим — отдельная ось): аргументы замещающего процесса `['up', ...]` вместо `['bot']`, + пробросить `--port` из фактического (если известен) либо полагаться на config. env замещающего процесса уже копируется от родителя → `VIBELOG_UP` переживёт рестарт автоматически (defaultReplacementEnv не стриппит не-файловые ключи) — значит, достаточно читать маркер в spawnReplacementBot, а не плодить аргумент. Но: чтобы у нового процесса маркер был ТОЛЬКО если исходный запуск был через up — а не «кто-то разово exported VIBELOG_UP» — надёжнее передавать аргументом: `['up']` при маркере, и одновременно НЕ класть маркер в env замещающего напрямую (он и так унаследуется...). Решение (фиксировать): **spawnReplacementBot читает `process.env.VIBELOG_UP === '1'` и подставляет аргумент `up` вместо `bot`; маркер при этом strip-ится из env замещающего (добавить в стрип, чтобы не было петли «маркер от маркера») — новый процесс выставит его сам.** Тест: рестарт из up-режима → замещающий вызван с 'up'.

## Порядок

1. src/cli/commands/up.ts + case в router + STARTUP_NOTIFY_COMMANDS + реестр команд.
2. Хендл `/web` в режиме up (src/bot/web.ts + handlers.ts).
3. spawnReplacementBot: режим up.
4. Тесты:
   - `vb up` в tmp-проекте без токена: сервер отвечает (fetch localhost:port), в stderr ошибка токена, exit-code не 0 до остановки (процесс жив — проверить через spawn и kill);
   - занятый порт (--port занять сокетом): бот-часть стартует (печать пина или «токен не найден»), сервер-ошибка понятна;
   - `/web` при маркере VIBELOG_UP → ответ «уже запущен», spawn не вызван (мок);
   - spawnReplacementBot с маркером → аргументы ['up'], без маркера → ['bot'] (регрессия VL-70/VL-143);
   - capabilities-инвариант: 'up' в реестре и в router.
5. `pnpm test`, doc-7 (раздел `up` + примечание про /web-stop и порт), CHANGELOG.

## Ручная проверка (AC)

`vb up` в реальном проекте → в одном терминале URL + пин; Telegram /start работает; канбан открывается; фаза из Telegram-кнопки видна в вебе сразу (общий activeRuns); `/web start` → «уже запущен»; `/restart` → обе части живы; Ctrl+C гасит всё.

## Риски

- **Порт при --port ≠ config**: `/web`-хендлер покажет порт из конфига — рассинхрон; документируем (или up всегда пишет фактический порт в env — решение в коде: предпочесть env-файл маркер `VIBELOG_UP_PORT`, мелочь, реализуемо без открытых вопросов).
- Состояние `process.env` как канала режима — хрупко (тесты параллельны fileParallelism): тесты передают маркер явным аргументом/env-объектом, не полагаясь на глобальный delete (паттерн VL-140 из restart.ts).
- `bot.start()` не завершается → route('up') не возвращается — так же, как у 'bot'/'browser'; update-check обрабатывается добавлением в STARTUP_NOTIFY_COMMANDS (AC7).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-18 10:19
---
Фаза 3 (Code) выполнена. Коммит 1599c43.
Изменено: src/cli/commands/up.ts (новый), src/cli/router.ts (case 'up' + общая справка + up --help), src/cli/command-registry.ts (запись capabilities), src/cli/update-check.ts (STARTUP_NOTIFY_COMMANDS += 'up'), src/bot/web.ts (upWebReply), src/bot/handlers.ts (хендлер /web ранний выход в режиме up), src/bot/restart.ts (spawnReplacementBot: argv 'up' по маркеру + --port, стрип маркеров из env замещающего), src/web/server.ts (в режиме up сбой listen без process.exit). Тесты: src/cli/up.test.mjs (новый, 9 тестов), src/bot/restart.test.mjs (+3), src/cli/update-check.test.mjs (+up).
Проверки: pnpm build зелёный. Полный pnpm test: 4472 passed / 4 skipped / 1 FAILED — src/web/orchestrator.test.mjs «billing уходит тем же коммитом» (VL-352): в HEAD extra .vibelog/settings.json и backlog/config.yml. Падение воспроизводится и изолированно (без параллелизма). Ни один модуль, изменённый в VL-427, не участвует в коммит-пути этого теста (startPhase/finish) — изменённые файлы: cli/up, cli/router, command-registry, update-check, bot/web, bot/restart, bot/handlers, web/server. Тесты самой задачи зелёные: up.test.mjs 9/9, restart.test.mjs, update-check.test.mjs, web.test.mjs, cli.test.mjs, capabilities-cli.test.mjs — все зелёные.
AC1–AC6 отмечены. AC7 не отмечен: STARTUP_NOTIFY_COMMANDS/реестр/справка router сделаны, но doc-7 не обновлён — по регламенту фазы документы backlog/docs пишет Фаза Close. AC8 не отмечен: полный прогон не целиком зелёный (1 падение выше). DoD1/DoD2 не отмечены по той же причине (прогон с 1 падением; doc-7 в Close).
Что осталось (для Close/классификации падения): 1) классифицировать падение orchestrator.test.mjs VL-352 (сравнить с HEAD^1 — не появилось ли оно до VL-427; если да — завести отдельный баг); 2) doc-7: раздел `up` + примечание про /web stop и порт из VIBELOG_UP_PORT (рассинхрон --port и config); 3) CHANGELOG; 4) ручные AC по инструкции задачи: запуск в реальном проекте (пин+URL), /web start → «уже запущен», /restart → обе части живы, фаза из Telegram видна в канбане (общий activeRuns), Ctrl+C гасит всё.
---
author: @agent
created: 2026-11-18 10:57
---
Фаза Close выполнена. Ветка vb/vl-427 слита в master (1 коммит 1599c43, merge 27fbd37, без конфликтов; git diff vb/vl-427 HEAD пуст — merge-дерево ≡ ветка), worktree удалена (--force: там был только untracked-симлинк backlog/references/data, кладёт оркестратор), ветка vb/vl-427 удалена (1599c43).
Проверки после merge: pnpm build зелёный; ранний точечный фильтр по затронутым модулям (up/cli/update-check/capabilities/restart/web/commands — 216 тестов) зелёный; полный прогон (pnpm test:fast, dist собран) — 2 попытки: 4479 passed / 4 skipped / 2 FAILED каждый раз, но РАЗНЫЕ тесты: run1 — src/core/report.test.mjs (process.exitCode) и src/web/orchestrator.test.mjs VL-277; run2 — orchestrator.test.mjs ×2 (VL-277/VL-352, timing-тесты fire-and-forget коммита).
Классификация падений (не регрессия VL-427): (1) merge не меняет содержимое относительно ветки — merge-интерференция исключена по построению; (2) оба упавших тест-файла не изменены диффом и не имеют импортного пути к изменённым модулям (cli/commands/up, router, command-registry, update-check, bot/web, restart, handlers, web/server); маркер-ветка server.ts (process.exit при listen-ошибке) инертна без VIBELOG_UP, который ни один in-process тест не ставит; (3) наборы падений различаются между ранами при одинаковом коммите + изолированный прогон обоих файлов зелёный (116/116) — сигнатура флака из-за fileParallelism/isolate:false; (4) параллельного vitest в других worktree нет (ps aux); (5) красный orchestrator.test.mjs был уже в полном прогоне Фазы 3 на том же содержимом (VL-352 задокументирован). Повтор полного прогона — ровно один, с причиной флака в этом отчёте.
Документация (коммит e5d975a): doc-7 — раздел up (флаги, маркеры VIBELOG_UP/VIBELOG_UP_PORT, поведение /web и /restart, Ctrl+C); CHANGELOG — запись в Unreleased. DoD: 2 и 3 отмечены; 1 «Тесты проходят» не отмечен — полный прогон формально красный на пре-существующих флаках неизменённых тестов, их исправление вне Close (запрет правки кода), см. dodOverride. AC7 отмечен (STARTUP_NOTIFY_COMMANDS/реестр/router/doc-7 сделаны), AC8 не отмечен по той же причине формального красного; тесты самой задачи зелёные (up.test.mjs 9/9, restart, update-check, cli, capabilities, web). Урок не зафиксирован: знания вне диффа/отчёта нет — методика классификации флаков зафиксирована в этом комментарии; refs отсутствуют, подзадач нет.
DoD override: DoD1 «Тесты проходят»: полный прогон (2 попытки, pnpm test:fast после pnpm build) красный ТОЛЬКО флаками в неизменённых тестах — src/core/report.test.mjs (1 ран) и src/web/orchestrator.test.mjs (VL-277/VL-352 timing). Классифицированы как пре-существующие/флаки: merge-дерево ≡ ветка (diff пуст), нет импортного пути от этих тестов к изменённым модулям, маркер-ветка сервера инертна без VIBELOG_UP, наборы падений различаются между ранами, изолированный прогон зелёный, параллельного vitest нет, красный orchestrator был и в прогоне Фазы 3. Тесты задачи зелёные. Исправление флаков требует правки src/ — запрещено в Close (аварийный инцидент VL: close лечил src в цикле).
---
<!-- COMMENTS:END -->