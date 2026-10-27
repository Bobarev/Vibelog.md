---
id: VL-36
title: 'Telegram-бот: уведомления — fs.watch на backlog/, события задач и комментариев'
status: Rejected
assignee: []
reporter: ''
created_date: '2026-10-02 18:32'
updated_date: '2026-10-26 00:08'
due_date: ''
labels: []
dependencies:
  - VL-34
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Событийные уведомления: бот следит за backlog/ (fs.watch на tasks/) и шлёт в привязанный чат: новая задача (создана), смена статуса (To Do → In Progress), новый комментарий. Дедупликация: не слать повторно при нескольких изменениях одного файла подряд. Отправка через Telegram Bot API (sendMessage). Только в чаты с /start. Ошибки сети — retry с backoff, процесс не падает.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Бот отслеживает изменения backlog/ (fs.watch или polling) и отправляет уведомления в привязанный чат: новая задача, смена статуса, новый комментарий
- [ ] #2 Уведомления содержат ID и заголовок задачи; отправка только в чаты, привязанные через /start; ошибки отправки не роняют процесс
- [ ] #3 Тесты: парсинг событий из изменений файлов (unit) + pnpm test без регрессий
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

- Бот: long polling (bot.start()), registerHandlers(bot, {cwd, getPin}) — bot.ts:57; обработчики в handlers.ts (команды строки 60-178, catch-all 184).
- Пути: findBacklogDir(cwd) — paths.ts:33, tasksDir(backlogDir) — paths.ts:79. listTasks(cwd) читает tasks/*.md, битые файлы пропускает (markdownToTask → null → filter).
- События по изменению файла: listTasks до/после → diff: новая задача (id появился), смена статуса (поле status), новый комментарий (длина comments выросла). fs.watch на macOS (FSEvents) шлёт несколько событий на одну запись — нужна дедупликация (debounce + снапшот-дифф).
- Отправка: bot.api.sendMessage(chatId, text, {parse_mode:'MarkdownV2'}) — Api-инстанс использует наш прокси-fetch. Чаты: loadBotSettings(cwd).chats.
- Ошибки отправки: try/catch на чат, retry с backoff; процесс не падает.

## Изменяемые/создаваемые файлы

### 1. src/bot/notify.ts (новый)
- `snapshotTasks(cwd): Map<string, {status, title, commentsCount}>` — обход listTasks → снапшот (для диффа; сам по себе не шлёт).
- `diffSnapshots(prev, next): TaskEvent[]` — чистая функция: {type: 'created'|'status_changed'|'comment_added', id, title, detail?}. Дедупликация: снапшот сравнивается с предыдущим — несколько записей одного файла → одно событие.
- `formatEvent(ev): string` — MarkdownV2: «🆕 Задача **VL-N**: заголовок», «🔄 **VL-N**: To Do → In Progress», «💬 **VL-N**: новый комментарий»; заголовок экранируется (escapeMarkdownV2).
- `startWatcher(bot, cwd): () => void` — fs.watch на tasksDir:
  - При событии: debounce 700ms (хвостовой — схлопывает серию записей) → snapshotTasks → diffSnapshots с предыдущим снапшотом → для каждого события и каждого chat_id из loadBotSettings: sendMessage с retry (2 попытки, backoff 1с/3с); ошибки логируются, процесс жив.
  - Снапшот при старте — БЕЗ уведомлений (baseline).
  - Возвращает stop() — watcher.close() (для тестов и graceful shutdown).
- Импорты: fs.watch, listTasks (core/store), escapeMarkdownV2 (./formatting), loadBotSettings (./settings).

### 2. src/cli/commands/bot.ts
- После registerHandlers (строка 57): `const stopWatcher = startWatcher(bot, cwd);`
- SIGINT/SIGTERM: stopWatcher(); иначе процесс виснет на watch-handle.

### 3. src/bot/notify.test.mjs (новый)
- diffSnapshots: новая задача, смена статуса, комментарий, без изменений, несколько событий сразу, дубликат-запись одного файла (снапшот одинаков → 0 событий).
- formatEvent: MarkdownV2-вывод, экранирование спецсимволов в заголовке.

### 4. CHANGELOG [Unreleased]
- «VL-36: уведомления — fs.watch на backlog/tasks/, события create/status/comment в привязанные чаты».

## Порядок действий
1. notify.ts + notify.test.mjs → node --test src/bot/notify.test.mjs.
2. bot.ts (watcher + signal handlers) → pnpm build.
3. pnpm test, CHANGELOG.
4. Перезапуск бота → ручная проверка.

## Верификация
- pnpm build, pnpm test — все зелёные.
- Ручной: бот запущен → в другом терминале `vibelog task create "Тест уведомлений"` → в Telegram приходит «🆕 Задача...»; `vibelog task edit VL-N -s "In Progress"` → «🔄 VL-N: ... → In Progress»; `vibelog task edit VL-N --comment тест` → «💬 VL-N: новый комментарий»; Ctrl+C бота — процесс завершается чисто.

## Риски
1. **fs.watch на macOS**: FSEvents шлёт серию событий на одну запись → debounce 700ms + снапшот-дифф (дедупликация встроена); если событие потерялось — следующее догонит.
2. **Самоуведомления**: команда /create ботом тоже меняет файл → бот пришлёт «🆕» в тот же чат. Mitigation: фильтр «событие от самого бота» — пропускать, если изменение произошло <2с назад и мы сами писали (сложно достоверно) — НЕ делаем в VL-36 (избыточно); оговариваем как known limitation.
3. **Битый файл в момент записи**: listTasks пропускает непарсящиеся файлы → событие может не всплыть; следующая запись исправит.
4. **Большие backlog**: snapshotTasks читает все файлы на каждое событие — локально (<100 задач) это миллисекунды; при тысячах — заменить на точечный перечитывание изменённого файла (вне скоупа).
5. **watcher.close()** нужно вызывать при остановке — иначе процесс не завершится по Ctrl+C; bot.ts добавляет SIGINT/SIGTERM-обработчики.
<!-- SECTION:PLAN:END -->