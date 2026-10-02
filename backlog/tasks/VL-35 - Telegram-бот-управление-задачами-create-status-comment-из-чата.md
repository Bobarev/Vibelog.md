---
id: VL-35
title: 'Telegram-бот: управление задачами — /create, /status, /comment из чата'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 18:31'
updated_date: '2026-10-02 22:12'
due_date: ''
labels: []
dependencies:
  - VL-34
milestone: ''
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
Управление задачами из Telegram-команд. Команды: /create <заголовок> [-d описание] [--priority High|Medium|Low] — создание через createTaskFile; /status <id> <статус> — смена статуса через updateTaskFile; /comment <id> <текст> — комментарий. Бот отвечает подтверждением (ID, статус). Все операции через core-функции — никаких прямых правок файлов. Парсинг аргументов команд — чистые функции (юнит-тесты).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команды: /create <заголовок> — создаёт задачу через createTaskFile; /status <id> <статус> — смена статуса; /comment <id> <текст> — комментарий через addComment; бот отвечает подтверждением с ID задачи
- [x] #2 Все операции идут через существующие core-функции (createTaskFile, updateTaskFile, addComment) — формат backlog/ не меняется, совместимость с Backlog.md сохранена
- [x] #3 Тесты: минимум 2 unit-теста (парсинг команд create/status/comment) + pnpm test без регрессий
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

- **addComment в core добавляется по решению Pavel (2026-10-02)**: строгая совместимость с Backlog.md соблюдается ТОЛЬКО в хранении данных (структура папок, формат md/yaml, frontmatter) — внутренние API свободно развиваются.
- Существующий паттерн (дублируется в CLI): getTask → TaskComment {author, created, text} → updateTaskFile({comments: [...старые, новый]}) (src/cli/commands/task.ts:465-473).
- core-функции: createTaskFile(cwd, input) — store.ts:85; updateTaskFile(cwd, id, updates) — store.ts:124; getTask(cwd, id) — store.ts:55; loadConfig(cwd) → statuses[] для валидации.
- Хендлеры в handlers.ts: start(59), tasks(73), task(79), board(108), catch-all(115). Новые команды — ДО catch-all.
- Дата комментария — «YYYY-MM-DD HH:MM» (как в CLI).

## Изменяемые/создаваемые файлы

### 1. src/core/store.ts — НОВАЯ функция addComment
- `addComment(cwd: string, id: string, text: string, author: string = '@agent'): Task`
- Реализация: getTask (не найдена → throw «Задача не найдена») → собрать TaskComment {author, created: now «YYYY-MM-DD HH:MM»} → updateTaskFile(cwd, id, { comments: [...task.comments, comment] }) → вернуть обновлённую задачу.
- JSDoc: комментарий добавляется через штатное сохранение — формат файла не меняется.

### 2. src/cli/commands/task.ts — рефакторинг на addComment (строки 465-473)
- Блок «Комментарий» заменяется вызовом addComment(cwd, id, text, author) — убирается дублирование; поведение CLI не меняется (author из --comment-author, дефолт @agent).

### 3. src/bot/commands.ts (новый, чистые функции)
- `parseCreateCommand(text)`: «Заголовок -d Описание --priority High» → {title, description?, priority?} | {error}; без заголовка → error; priority вне High/Medium/Low → error; кавычки вокруг описания снимаются.
- `parseStatusCommand(text)`: «VL-1 To Do» → {id, status} (статус — всё после id, пробелы сохраняются) | {error}.
- `parseCommentCommand(text)`: «VL-1 текст» → {id, text} | {error}.

### 4. src/bot/handlers.ts — три команды ПОСЛЕ board (стр.108-113), ДО catch-all (стр.115)
- `/create`: parseCreateCommand → createTaskFile(cwd, {title, description?, priority?}) → sendMd «✅ Задача **VL-N** создана».
- `/status`: parseStatusCommand → статус в loadConfig().statuses (иначе — список доступных) → getTask → updateTaskFile({status}) → «**VL-N**: X → Y».
- `/comment`: parseCommentCommand → getTask → **addComment(cwd, id, text, author)** — автор: ctx.from?.username ? '@'+username : ctx.from?.first_name || 'Telegram' → «💬 Комментарий добавлен к **VL-N**».
- requireBind для всех трёх.

### 5. Тесты
- `src/core/add-comment.test.mjs` (новый): /tmp-проект (mkdtemp): createTaskFile → addComment → getTask: comments[0].text/author; дефолтный author '@agent'; неизвестный id → throw.
- `src/bot/commands.test.mjs` (новый): parseCreate (заголовок, -d/--priority, без заголовка → error, невалидный priority → error, кавычки); parseStatus («VL-1 To Do», без статуса → error); parseComment (id+текст, только id → error).

### 6. CHANGELOG [Unreleased]
- «VL-35: core addComment + /create /status /comment — управление задачами из Telegram».

### 7. AGENTS.md — уточнение правила совместимости
- Строка «Совместимость с Backlog.md — максимальная» → «строгая только в хранении данных (структура папок, формат md/yaml, frontmatter); внутренние API и команды развиваются свободно».

## Порядок действий
1. store.ts addComment + add-comment.test.mjs → тесты core.
2. cli/task.ts рефакторинг → pnpm test (CLI-тесты не должны измениться).
3. bot/commands.ts + commands.test.mjs.
4. handlers.ts (3 команды до catch-all) → pnpm build.
5. pnpm test, CHANGELOG, AGENTS.md.
6. Перезапуск бота → ручная проверка.

## Верификация
- pnpm build, pnpm test — все зелёные (включая CLI-тесты после рефакторинга).
- Ручной: /create Тест VL-35 -d Описание --priority High → задача в backlog/tasks/; /status <id> In Progress → поле status; /comment <id> Проверка → секция COMMENTS; /status VL-999 → «не найдена»; /status <id> Fake → список доступных статусов.

## Риски
1. **Рефакторинг CLI** (строки 465-473): поведение сохраняется (тот же author/created); CLI-тесты покрывают --comment — падение сразу видно.
2. **Парсинг -d/--priority**: кавычки снимаются; текст без флагов — весь заголовок.
3. **Порядок middleware**: команды до catch-all (grep-проверка в верификации).
4. **addComment бросает при несуществующей задаче**: хендлер ловит → сообщение «не найдена».
<!-- SECTION:PLAN:END -->