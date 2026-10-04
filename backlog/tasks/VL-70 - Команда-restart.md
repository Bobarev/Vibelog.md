---
id: VL-70
title: Команда restart
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 18:52'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Команда /restart — самоперезапуск Telegram-бота из чата (VL-70).

Контекст: после pnpm build запущенный бот исполняет старый dist/ — подхватить новый можно было только Ctrl+C в терминале. CLI-вариант vibelog restart с pid-файлом отклонён Pavel'ем («заменяет только ctrl+c»): бот должен рестартовать САМ СЕБЯ по команде /restart в чате.

Механизм: обработчик /restart (привязанный чат) → ответ «🔄 Перезапуск бота…» → bot.stop() (гасит long polling ДО спавна: два параллельных getUpdates с одним токеном = 409 Conflict) → spawn замещающего node bin/vibelog.mjs bot (тот же CLI, cwd проекта; stdio: 'inherit' — пин нового запуска печатается в том же терминале; detached: true + unref() — новый процесс переживает старый) → ожидание события 'spawn' → exit 0. Новый процесс исполняет свежий dist/; чат остаётся привязанным (.vibelog/bot.yml не меняется). Сбой спавна → сообщение в чат «запустите вручную: vibelog bot» + exit 1.

Файлы: src/bot/restart.ts (vibelogCliPath + spawnReplacementBot), обработчик /restart в src/bot/handlers.ts (после /prompt, ДО catch-all пина), реестр src/bot/registry.ts (13-я команда — меню + help), тесты src/bot/restart.test.mjs, docs/user-guide.md, CHANGELOG.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /restart в привязанном чате: ответ «🔄 Перезапуск бота…»; bot.stop() гасит polling до спавна (без 409); spawn замещающего vibelog bot (тот же CLI, cwd проекта, stdio inherit — пин в том же терминале, detached+unref); exit 0 — новый процесс исполняет свежий dist/
- [x] #2 Непривязанный чат → подсказка /start, перезапуск не выполняется; сбой спавна → сообщение в чат «запустите вручную: vibelog bot» + exit 1
- [x] #3 /restart в реестре BOT_COMMANDS (меню + help-строка); restart.test.mjs и registry.test.mjs зелёные (TELEGRAM_BOT_TOKEN изолирован в тестах spawn); pnpm test без регрессий; user-guide.md и CHANGELOG описывают самоперезапуск
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации: /restart — самоперезапуск бота (дизайн утверждён комментарием Pavel 2026-10-03)

### Файлы
1. src/bot/restart.ts (новый): vibelogCliPath() — абсолютный путь bin/vibelog.mjs из dist/bot/restart.js; spawnReplacementBot(cwd, stdio='inherit') — spawn(process.execPath, [cliPath, 'bot'], {cwd, stdio, detached: true}) + child.unref(). stdio inherit — пин в терминале старого запуска; detached+unref — новый процесс переживает exit(0) родителя.
2. src/bot/handlers.ts: bot.command('restart') ПОСЛЕ /prompt и ДО catch-all пина: requireBind → sendMd «🔄 Перезапуск бота…» → bot.stop() в try/catch → spawnReplacementBot(deps.cwd) → await 'spawn' / 'error' (ошибка → sendText «запустите вручную: vibelog bot» + console.error + exit 1) → process.exit(0). Порядок stop→spawn обязателен (409 Conflict двух getUpdates).
3. src/bot/registry.ts: BOT_COMMANDS += restart; registry.test.mjs: length 12→13, help-строка += ', /restart'.
4. docs/user-guide.md: раздел «Самоперезапуск /restart (VL-70)».
5. CHANGELOG.md: запись VL-70 в [Unreleased]→«Добавлено».
6. src/bot/restart.test.mjs (новый): vibelogCliPath существует; spawnReplacementBot — событие spawn + fast-fail без токена; реестр содержит restart.

### Порядок
restart.ts → handlers.ts → registry (+тесты) → restart.test.mjs → user-guide + CHANGELOG → pnpm build && pnpm test.

### Проверки
pnpm build; node --test src/bot/restart.test.mjs src/bot/registry.test.mjs (10/10); полный pnpm test; ручной: /restart в привязанном чате → «🔄 Перезапуск бота…», в терминале новый пин, чат привязан.

### Риски
- 409 Conflict двух polling — снят порядком stop→spawn.
- Тесты spawn изолированы от TELEGRAM_BOT_TOKEN (before/after в describe): на машине разработчика токен в env глобально — без изоляции дочерний процесс теста уходил в реальный polling (тест висел, плодил ботов — поймано и вылечено).
- stdio inherit: если бот запущен не из терминала — пин невидим, но перезапуск работает; чаты привязаны.
- PID-reuse не применим (без pid-файла).
<!-- SECTION:PLAN:END -->

## Final Summary
<!-- SECTION:FINAL_SUMMARY:BEGIN -->
/restart реализован и проверен: самоперезапуск бота из чата (bot.stop() → spawn замещающего vibelog bot stdio inherit/detached+unref → exit 0); реестр 13 команд; тесты restart+registry 10/10, pnpm test зелёный; user-guide + CHANGELOG. Работа упавшего процесса доделана: изоляция TELEGRAM_BOT_TOKEN в тестах spawn (иначе тест висел и плодил живых ботов) и фикс regex /Перезапус/. CLI pid-вариант не реализован (отклонён).
<!-- SECTION:FINAL_SUMMARY:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 18:55
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича укладывается в одну задачу. Уточнён механизм: `vibelog bot` пишет PID в `.vibelog/bot.pid` (gitignored каталог .vibelog/), при остановке удаляет файл; новая CLI-команда `vibelog restart` читает pid-файл, при живом процессе шлёт SIGTERM (fallback SIGKILL после ~5 с), дожидается завершения и запускает новый `vibelog bot` в текущем терминале (stdio: 'inherit') — пин печатается в консоли, новый процесс исполняет свежий dist/. При незапущенном боте/stale pid — ошибка на русском, выход ≠ 0. Границы: без watch-режима; пересборку (pnpm build) делает пользователь; pm2/systemd вне scope. Добавлены 3 конкретных критерия приёмки (pid-файл lifecycle; SIGTERM→перезапуск в текущем терминале; обработка отсутствия бота + help/docs/тесты).
---
author: @agent
created: 2026-10-03 19:28
---
Фаза 2 (Plan) выполнена.
Тип: task → план записан в задачу (implementationPlan).
Краткое содержание плана:
- Новый модуль `src/bot/pid.ts`: write/remove/read pid-файла `.vibelog/bot.pid` + `isProcessAlive` (kill(pid,0)) + `terminateProcess` (SIGTERM → опрос → SIGKILL fallback, таймаут 5 с).
- `src/cli/commands/bot.ts`: запись pid при старте, обработчики SIGINT/SIGTERM (bot.stop() + удаление файла + exit 0), удаление файла при ошибке запуска.
- Новая команда `src/cli/commands/restart.ts`: чтение pid-файла (нет/stale → «Бот не запущен», exit 1), SIGTERM→SIGKILL старому процессу, spawn нового `vibelog bot` с stdio: 'inherit' (пин в текущем терминале, свежий dist/).
- Регистрация в `src/cli/router.ts`: case 'restart', общая справка, helpTexts['restart'] для `vibelog help restart`.
- Docs: разделы `## bot` и `## restart` в `docs/cli-reference.md` (раздела bot там сейчас нет вообще), запись в CHANGELOG.md.
- Тесты: `src/bot/pid.test.mjs` (unit: lifecycle pid-файла, alive/stale, terminateProcess на реальном дочернем процессе, SIGKILL-fallback) + `src/cli/restart-cli.test.mjs` (интеграционные: exit 1 + «Бот не запущен» без pid/stale pid, help-тексты).
- Проверка: pnpm build + node --test src; ручной прогон restart в /tmp и (при наличии токена) полный цикл bot → restart.
Риски зафиксированы: гонка pid-файла снята порядком (смерть старого до spawn нового), pid-reuse, bot.stop() до старта polling (try/catch), полный telegram-цикл вне автотестов.
Блокеров нет. Статус не менялся — план ждёт одобрения.
---
author: Pavel Bobarev
created: 2026-10-03 19:46
---
Это всё не правильно. Бот должен рестартовать сам себя по команде в чате бота /restart
А то что сейчас описано и запланировано заменяет только ctrl + c
---
author: @agent
created: 2026-10-03 23:14
---
Фаза 3 доведена после падения процесса-исполнителя. Найдено: упавший процесс реализовал ИМЕННО утверждённый дизайн — src/bot/restart.ts (vibelogCliPath, spawnReplacementBot: detached+unref, stdio inherit), обработчик /restart в handlers.ts (requireBind → «🔄 Перезапуск бота…» → bot.stop() → spawn → await 'spawn' → exit 0; сбой → сообщение в чат + exit 1), реестр (13 команд, help), тесты, user-guide.md. Доделано: (1) тесты зависали на машине Pavel — TELEGRAM_BOT_TOKEN задан глобально в env, дочерний процесс теста находил токен и уходил в РЕАЛЬНЫЙ long-polling (тест висел до таймаута; осиротевший бот PID 32074 убит) — фикс: before/after-хуки снимают токен из env на время describe spawnReplacementBot; (2) regex /Перезапуск/ не матчил «Перезапустить» из реестра → /Перезапус/; (3) запись в CHANGELOG. Проверки: pnpm build чистый; restart+registry тесты 10/10; полный pnpm test зелёный (первый прогон — известный флаки IPC-раннера static.test.mjs «deserialize cloned data», чистый прогон — 0 fail). Ручной smoke /restart в чате — за Pavel'ем.
---
<!-- COMMENTS:END -->