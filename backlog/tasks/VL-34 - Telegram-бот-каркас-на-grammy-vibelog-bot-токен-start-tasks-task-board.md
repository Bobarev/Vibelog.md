---
id: VL-34
title: 'Telegram-бот: каркас на grammy — vibelog bot, токен, /start, /tasks, /task, /board'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 18:31'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Основа Telegram-бота Vibelog на grammy. Команда vibelog bot (по аналогии с vibelog browser) запускает long-polling процесс.

Уточнения Pavel (2026-10-02, Фаза 2):
1. **Zero-deps — удалить упоминания**: AGENTS.md:61 (правило), AGENTS.md:85 (причина), README.md:12 (фича), docs/user-guide.md:4. CHANGELOG не трогать (история релизов). grammy — обычная runtime-зависимость.
2. **Настройки бота — .vibelog/bot.yml (gitignored), НЕ config.yml**: проверено по оригиналу (file-system/operations.ts:2090) — неизвестные поля config.yml игнорируются при чтении, но saveConfig вычищает их при записи; плюс config.yml коммитится → токен утёк бы в git. Токен: TELEGRAM_BOT_TOKEN (env, приоритет) → .vibelog/bot.yml. Совместимость backlog/ с Backlog.md не затрагивается (.vibelog/ — посторонний каталог).
3. **Привязка чата через пин-код**: при старте vibelog bot генерируется 6-значный пин (node:crypto), печатается в консоль; /start → бот запрашивает пин → верный → привязка chat_id (сохраняется в .vibelog/bot.yml). Пин живёт до рестарта процесса.

Команды: /start (пин → привязка), /tasks (список активных задач), /task <id> (детали), /board (колонки + количество). Чтение через core-функции (listTasks, getTask, loadConfig).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда vibelog bot запускает бота через grammy (long polling); токен берётся из TELEGRAM_BOT_TOKEN или config.yml; без токена — понятная ошибка на русском
- [x] #2 Команды /start (привязка чата), /tasks (список задач), /task <id> (детали), /board (сводка по колонкам) работают через существующие core-функции
- [x] #3 AGENTS.md: правило zero-deps дополнено исключением для grammy; pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Факты

- zero-deps упоминания: AGENTS.md:61 (правило), AGENTS.md:85, README.md:12, docs/user-guide.md:4. CHANGELOG 9/23/78 — исторические, НЕ трогать.
- Оригинал Backlog.md: parseConfig (../Backlog.md/src/file-system/operations.ts:2090) — switch без default → лишние поля config.yml игнорируются при чтении; saveConfig (2052) вычищает их при записи.
- Наш loadConfig (src/core/config.ts:83) — parseYaml → Record<string, unknown> — лишние поля тоже читаются, но для бота config.yml не используется (решение).
- CLI-паттерн долгоживущего процесса: browser.ts → startWebServer (router.ts:73).
- Правило проекта (память): тесты с tmp — mkdtempSync в os.tmpdir(); CLI-ошибки — stderr.

## Изменяемые/создаваемые файлы

### 1. package.json + pnpm install
- dependencies += grammy (актуальная версия 1.x, чистый JS).

### 2. .gitignore (корень)
- += `.vibelog/` (токен и привязки чатов не коммитятся).

### 3. src/bot/settings.ts (новый)
- Путь: <cwd>/.vibelog/bot.yml. loadBotSettings/saveBotSettings через YAML-парсер проекта.
- Структура: { telegram_token?: string, chats: number[] }.
- resolveToken(): env TELEGRAM_BOT_TOKEN → settings.telegram_token → null.

### 4. src/bot/pin.ts (новый, чистая функция)
- generatePin(): 6 цифр через randomInt (node:crypto), строка.

### 5. src/bot/formatting.ts (новый, чистые функции — юнит-тесты)
- formatTaskList(tasks): строки «VL-N — заголовок [статус]».
- formatTaskDetail(task): заголовок, статус, приоритет, описание, меты.
- formatBoard(config, tasks): колонка — количество (по статусам из config.statuses).

### 6. src/bot/handlers.ts (новый)
- registerHandlers(bot, ctx-зависимости): /start (пин-флоу), /tasks, /task <id>, /board.
- Пин-флоу: состояние привязки в памяти процесса { awaitingPinChatId }; неверный пин → «Неверный код»; верный → chat_id в settings.chats, saveBotSettings, «Чат привязан».
- /task без аргумента → подсказка; неизвестный id → «Задача не найдена».
- Без привязки除/start): «Бот не привязан к чату — выполните /start».

### 7. src/cli/commands/bot.ts (новый)
- runBot(cwd): resolveToken → без токена: ошибка на русском (TELEGRAM_BOT_TOKEN или .vibelog/bot.yml).
- Генерация пина + console.log «Код привязки: NNNNNN» (видно только в терминале).
- new Bot(token); registerHandlers; bot.start() (long polling). Обработка ошибок polling — retry, процесс не падает от сетевых сбоев.

### 8. src/cli/router.ts
- case 'bot': runBot(cwd) + help-строка.

### 9. Документация
- AGENTS.md: удалить правило zero-deps (стр.61); на стр.85 убрать формулировку про zero-dependency (запрет python/ruby/perl остаётся). README.md:12 — фичу «Zero runtime dependencies» заменить на «Минимум зависимостей (grammy для Telegram-бота)». docs/user-guide.md:4 — убрать zero runtime dependencies. CHANGELOG [Unreleased]: «Добавлен: Telegram-бот vibelog bot (grammy) — просмотр и привязка через пин-код».

### 10. Тесты (корень, *.test.mjs → dist/)
- src/bot/pin.test.mjs: формат 6 цифр, уникальность (100 выборок).
- src/bot/formatting.test.mjs: 3 функции, пустые/наполненные входы.
- src/bot/settings.test.mjs: roundtrip save/load в mkdtemp /tmp; приоритет env над файлом.

## Порядок действий
1. grammy в package.json + pnpm install.
2. settings.ts, pin.ts, formatting.ts (+тесты).
3. handlers.ts, bot.ts, router.ts.
4. .gitignore, доки (AGENTS/README/user-guide/CHANGELOG).
5. pnpm build + pnpm test.
6. Ручной прогон — по «да» Pavel (нужен его токен): TELEGRAM_BOT_TOKEN=... node bin/vibelog.mjs bot → пин в консоли → /start в Telegram → привязка → /tasks /task /board.

## Верификация
- pnpm build (tsc), pnpm test — все + новые зелёные.
- grep: упоминаний zero-deps нет в AGENTS.md/README/docs (CHANGELOG — исторические записи сохраняются).
- Ручной: vibelog bot стартует, пин печатается; /start с пином привязывает чат; /tasks, /task VL-N, /board отвечают; без токена — понятная ошибка.

## Риски
1. **Первая runtime-зависимость**: пакет растёт; npm install ставит grammy автоматически (files-whitelist не включает node_modules — ок). Smoke VL-32 перед publish остаётся обязательным.
2. **Пин в консоли**: кто запустил vibelog bot — тот видит пин; пин однорожден на сессию (рестарт = новый). Локальный инструмент — приемлемо.
3. **.vibelog/bot.yml с токеном**: обязательно gitignored; ревью git status перед коммитом.
4. **Long polling на Catalina**: grammy чистый JS поверх fetch/https — нативных модулей нет.
5. **Без привязки除/start) бот отвечает подсказкой** — не молчит.
<!-- SECTION:PLAN:END -->