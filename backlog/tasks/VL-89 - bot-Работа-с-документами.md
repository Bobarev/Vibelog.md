---
id: VL-89
title: '#bot Работа с документами'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-05 16:43'
updated_date: '2026-10-05 20:02'
due_date: ''
labels: []
dependencies: []
milestone: ''
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
#bot Работа с документами. Сделать команды /docs и /doc по аналогии с /tasks и /task.

## Контекст
Документы (backlog/docs/, формат doc-N) уже полностью поддерживаются в core (src/core/document.ts: listDocuments/getDocument/writeDocument/updateDocument/searchDocuments; типы readme/guide/specification/other), CLI (`vibelog doc create|list|view|update|search`, src/cli/commands/doc.ts) и MCP (document_list/view/create/update/search, src/mcp/tools.ts). В Telegram-боте команд для документов нет — только задачи (/tasks, /task, /board).

## Что сделать
Команды бота (только просмотр; создание/редактирование через бот — вне объёма, при необходимости отдельная задача):

1. `/docs [фильтр]` — список документов: rich-таблица (колонки ID/Заголовок/Тип/Теги) + callback-кнопки `doc:<id>` под таблицей — полный аналог renderTasksRich (HTML-<table>, кнопки дробятся по 8 в ряд — лимит Telegram RICH_MESSAGE_BUTTONS_TOO_MANY). Необязательный текстовый аргумент — фильтр (searchDocuments: id/title/tags/тело). Пустой список — короткий текст без таблицы. Фолбэк MarkdownV2 по паттерну sendTasksView.
2. `/doc <id>` — карточка документа: метаданные (id, title, type, tags, created_date) + тело (markdown; соблюдать лимиты Telegram — разбивка/усечение с пометкой). Не найден — «Документ <id> не найден» (id экранировать, как в /task). Callback-кнопка `doc:<id>` из /docs открывает ту же карточку — ветка в bot.on('callback_query') по аналогии с task:.
3. Регистрация в src/bot/registry.ts (BOT_COMMANDS): `docs` — «Список документов», `doc` — «Документ: /doc doc-1» (usage '/doc <id>'); help /start обновится автоматически через commandsHelp().
4. Тесты: render в rich.test.mjs, парсеры/хендлеры — по образцу commands.test.mjs/registry.test.mjs; `pnpm test` зелёный.
5. Документация: docs/user-guide.md — раздел «Документы в боте».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `/docs [фильтр]` выводит rich-таблицу документов (ID/Заголовок/Тип/Теги) с callback-кнопками `doc:<id>` (дробление по 8 в ряд, лимит Telegram); пустой список — короткий текст без таблицы; при отказе rich — MarkdownV2-фолбэк
- [x] #2 `/doc <id>` показывает карточку документа (метаданные id/title/type/tags/created_date + тело markdown с учётом лимитов Telegram); неизвестный id — сообщение «Документ <id> не найден» (id экранирован); callback-кнопка `doc:<id>` из /docs открывает ту же карточку
- [x] #3 Команды `docs` и `doc` зарегистрированы в BOT_COMMANDS (src/bot/registry.ts) — меню Telegram и help /start обновлены; тесты `pnpm test` зелёные (рендеры rich.test.mjs + хендлеры по образцу commands.test.mjs); документация (docs/user-guide.md) обновлена
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-89 (Фаза 2)

Фича — две read-команды Telegram-бота `/docs [фильтр]` и `/doc <id>` + callback-ветка `doc:<id>`. Ядро (src/core/document.ts), CLI и MCP уже готовы — бот только читает. Важно: `listDocuments/getDocument/searchDocuments` принимают `backlogDir`, а НЕ `cwd` (в отличие от store.listTasks/getTask) — в хендлерах нужен `findBacklogDir(deps.cwd)` из src/core/paths.ts:33 (паттерн src/cli/commands/doc.ts:33).

### Файлы для изменения (порядок работ)

**1. src/bot/rich.ts (501 строка)**
- Импорт типа `DocumentEntry` из `../core/document.js` (блок импортов, строки 9-19).
- Новая функция `renderDocsRich(docs: DocumentEntry[]): string` — вставить ПОСЛЕ `renderTasksRich` (строки 398-441):
  - пустой массив → `''` (как renderTasksRich, строка 399);
  - HTML-таблица `<table bordered striped compact>` с колонками ID/Заголовок/Тип/Теги — шапка `<tr><th>ID</th><th>Заголовок</th><th>Тип</th><th>Теги</th></tr>`; ячейки через `cellSafe` (строка 367), ID жирный `<b>` — точная копия паттерна строк 401-416;
  - кнопки под таблицей: `<tg-button type="callback_data" data="doc:${d.document.id}">${d.document.id}</tg-button>`; дробление по `BUTTONS_PER_ROW=8` (строка 30) — копия цикла строк 419-427 (лимит Telegram RICH_MESSAGE_BUTTONS_TOO_MANY);
  - стили task_type_styles НЕ применяются (документы — не задачи).
- Новая функция `renderDocumentRich(entry: DocumentEntry): string` — после renderDocsRich:
  - шапка `# ${entry.document.id} — ${entry.document.title}` (аналог renderTaskRich, строка 311);
  - meta-строка: `**Тип:** type`, `**Создан:** created_date`, `**Теги:** tags.join(', ')` если tags.length > 0 (аналог строк 332-337 renderTaskRich);
  - тело: если `entry.body.trim()` — секция `section('Содержимое', contentSafe(entry.body), true)` (section — строка 239; contentSafe — обязательная защита VL-81 от сырых rich-тегов); пустое тело — секция не выводится;
  - callback-кнопок нет (у документа нет фаз).

**2. src/bot/formatting.ts (~160 строк)**
- Импорт `DocumentEntry` из `../core/document.js`.
- `formatDocsList(docs: DocumentEntry[]): string` — после formatTaskList (строки 32-37): пустой → `'Документов нет'`; иначе строки `*<id>* — <title> \[<type>\]` через `escapeMarkdownV2` (паттерн formatTaskList, скобки экранируются как `\[...\]`).
- `formatDocumentDetail(entry: DocumentEntry): string` — после formatTaskDetail (строки 123-151): `*${id} — ${title}*`, `*Тип:* ...`, `*Создан:* ...`, `*Теги:* ...` (теги — если есть); тело через `escapeMarkdownV2` с усечением >1500 символов + `…` (лимит Telegram 4096 — паттерн formatTaskDetail, строка 144).

**3. src/bot/registry.ts (68 строк)**
- В `BOT_COMMANDS` (строки 32-46) после записи `{ command: 'task', ... }` (строка 35) вставить:
  - `{ command: 'docs', description: 'Список документов' },`
  - `{ command: 'doc', description: 'Документ: /doc doc-1', usage: '/doc <id>' },`
- Порядок в массиве обязан совпадать с порядком `bot.command(...)` в handlers.ts — иначе падает тест registry.test.mjs («реестр покрывает все bot.command», строки 31-45, читает handlers.ts через regex).
- `commandsHelp()` (строка 53) обновится автоматически.

**4. src/bot/handlers.ts (706 строк)**
- Импорты: `listDocuments, getDocument, searchDocuments` из `../core/document.js`; `findBacklogDir` из `../core/paths.js`; `renderDocsRich, renderDocumentRich` — в блок rich.js (строки 21-28); `formatDocsList, formatDocumentDetail` — в блок formatting.js (строки 13-20).
- Хелпер `sendDocsView(bot, chatId, entries)` — после sendTasksView (строки 118-133): try `renderDocsRich(entries)` → `chunkRich` → `bot.api.sendRichMessage(chatId, { markdown: part })`; catch → `sendText(bot, chatId, formatDocsList(entries))` (полный паттерн sendTasksView).
- Хелпер `sendDocView(bot, chatId, entry)` — аналогично: try `renderDocumentRich(entry)` + chunkRich + sendRichMessage; catch → `sendText(bot, chatId, formatDocumentDetail(entry))` (паттерн sendTaskView).
- `bot.command('docs', ...)` — вставить ПЕРЕД `bot.command('board', ...)` (строка 281), т.е. после task (строки 260-279):
  - `requireBind`; `const backlogDir = findBacklogDir(deps.cwd); if (!backlogDir) { await sendMd(ctx, formatDocsList([])); return; }` (паттерн store.listTasks:34-35 — нет backlog → пусто, не падать);
  - `const filter = (ctx.match ?? '').toString().trim();`
  - `const entries = filter ? searchDocuments(backlogDir, filter) : listDocuments(backlogDir);`
  - пусто → `sendMd(ctx, formatDocsList([]))` (короткий текст без таблицы); иначе `sendDocsView(bot, chatId, entries)`.
- `bot.command('doc', ...)` — сразу после docs:
  - `requireBind`; `const id = (ctx.match ?? '').toString().trim();` пусто → `'Укажите ID документа: /doc doc-1'`;
  - `const backlogDir = findBacklogDir(deps.cwd); const entry = backlogDir ? getDocument(backlogDir, id) : null;`
  - не найден → `await sendMd(ctx, 'Документ ' + escapeMarkdownV2(id) + ' не найден.')` — id экранируется (паттерн /task, строка 270);
  - иначе `sendDocView(bot, chatId, entry)`.
- Callback-ветка `doc:` в `bot.on('callback_query')` (строки 568-658) — вставить ПОСЛЕ ветки `task:` (строки 599-616) и ДО `next:` (строка 618), полный аналог task::
  - `if (data.startsWith('doc:')) { const id = data.slice('doc:'.length).trim(); ... }`
  - requireBind с `answerCallbackQuery({ text: 'Бот не привязан к чату — выполните /start' })` + return;
  - `const entry = backlogDir ? getDocument(backlogDir, id) : null;` не найден → `answerCallbackQuery({ text: 'Документ ' + id + ' не найден.' })`;
  - иначе `answerCallbackQuery({ text: '📄 ' + id })` + `sendDocView(bot, chatId, entry)`; return.
  - `answerCallbackQuery` обязателен в любом исходе — иначе «часики» на кнопке (комментарий строк 596-598).

**5. Тесты**
- src/bot/rich.test.mjs (525 строк): новый `describe('renderDocsRich (VL-89)', ...)` по образцу renderTasksRich (строки 432-525). Фикстура: `{ document: { id: 'doc-1', title: 'Гайд', type: 'guide', created_date: '2026-10-05', tags: ['api'] }, body: '...', path: '/x' }`. Кейсы:
  - шапка таблицы: колонки ID/Заголовок/Тип/Теги, `<b>doc-1</b>`, нет GFM `| --- |`;
  - кнопки `<tg-button type="callback_data" data="doc:doc-N">doc-N</tg-button>`;
  - 10 документов → 2 ряда по ≤8 кнопок; ровно 8 → 1 ряд;
  - экранирование `& < >` в ячейках (cellSafe);
  - пустой массив → `''`.
- src/bot/rich.test.mjs: `describe('renderDocumentRich (VL-89)', ...)`: заголовок `# doc-1 — Гайд`; meta (Тип/Создан/Теги); тело в секции; пустое тело → нет секции «Содержимое»; сырые rich-теги в теле экранируются contentSafe (VL-81).
- src/bot/formatting.test.mjs: тесты `formatDocsList` (пустой → «Документов нет», экранирование спецсимволов MarkdownV2) и `formatDocumentDetail` (meta + тело, усечение >1500 символов → `…`).
- src/bot/registry.test.mjs — обновить хардкод: строка 14 — `13` → `15` (и текст сообщения об ошибке); строки 51-56 — в ожидаемую строку commandsHelp() вставить `/docs, /doc <id>` после `/task <id>`.

**6. docs/user-guide.md (447 строк)**
- В разделе «## 11. Telegram-бот» после подраздела «### Список /tasks — rich-таблица (VL-82)» (заканчивается строкой ~341, перед `### Самоперезапуск /restart (VL-70)`, строка 343) добавить `### Документы в боте (VL-89)`:
  - `/docs [фильтр]` — rich-таблица ID/Заголовок/Тип/Теги + callback-кнопки `doc:<id>` (дробление по 8 в ряд), фильтр — searchDocuments (id/title/tags/тело); фолбэк MarkdownV2 (formatDocsList);
  - `/doc <id>` — карточка: метаданные + тело markdown (лимиты Telegram), фолбэк formatDocumentDetail; callback-кнопка `doc:<id>` из /docs открывает ту же карточку.

### Порядок действий

1. rich.ts (renderDocsRich + renderDocumentRich)
2. formatting.ts (formatDocsList + formatDocumentDetail)
3. registry.ts (2 команды в BOT_COMMANDS)
4. handlers.ts (импорты + хелперы sendDocsView/sendDocView + команды docs/doc + ветка doc: в callback_query)
5. Тесты: rich.test.mjs → formatting.test.mjs → registry.test.mjs
6. docs/user-guide.md
7. Сборка и прогоны

### Как проверить

```bash
pnpm build           # tsc → dist (strict, NodeNext)
node --test src/bot  # только тесты бота
pnpm test            # полный прогон: build + node --test src
```

Критично: тест registry.test.mjs сверяет имена и порядок `bot.command('...')` в handlers.ts с массивом BOT_COMMANDS — docs/doc должны стоять в обоих файлах в одном месте (между task и board).

### Риски

1. **Порядок registry ↔ handlers**: тест читает handlers.ts через regex — расхождение порядка = падение tests. Обновлять оба файла синхронно.
2. **Хардкод в registry.test.mjs**: счётчик команд (13) и строка commandsHelp() захардкожены — без правки тест упадёт.
3. **Лимиты Telegram**: >8 кнопок в ряд → 400 RICH_MESSAGE_BUTTONS_TOO_MANY (весь rich уходит в фолбэк) — дробление по BUTTONS_PER_ROW обязательно; тело документа может быть гигантским → chunkRich по RICH_LIMIT=32768 (rich) и усечение 1500 символов (MarkdownV2).
4. **Сырые rich-теги в теле документа** (VL-81): без contentSafe пользовательский markdown ломает карточку.
5. **findBacklogDir = null** (нет backlog/): вести себя как пустой список, не падать (паттерн store.listTasks:34-35).
6. **answerCallbackQuery обязателен** во всех исходах ветки doc: — иначе «часики» на кнопке (паттерн task:, строки 596-616).
7. **catch-all message:text**: docs/doc — bot.command, регистрируются в основном блоке до catch-all — ловушка порядка VL-37 не затрагивается, ничего переставлять не нужно.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 16:53
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича — две read-команды бота `/docs [фильтр]` (список документов: rich-таблица ID/Заголовок/Тип/Теги + callback-кнопки `doc:<id>`, аналог renderTasksRich) и `/doc <id>` (карточка документа: метаданные + тело, аналог /task; кнопка `doc:<id>` открывает её же). Ядро (src/core/document.ts), CLI (`vibelog doc ...`) и MCP (document_*) уже готовы — бот только читает. Регистрация в BOT_COMMANDS (registry.ts), тесты по образцу rich.test.mjs/commands.test.mjs, документация — docs/user-guide.md. Создание/редактирование документов через бот — вне объёма (отдельная задача при необходимости).
Исследовано: src/core/document.ts (listDocuments/getDocument/searchDocuments), src/cli/commands/doc.ts (create/list/view/update/search), src/mcp/tools.ts (document_*), src/bot/handlers.ts (команды tasks/task + callback-ветки task:/comment:/next:), src/bot/rich.ts (renderTasksRich: HTML-<table> + кнопки по 8 в ряд), src/bot/registry.ts (BOT_COMMANDS), оригинал refs/Backlog.md (docCmd: create/list/view/update/search).
---
author: @agent
created: 2026-10-05 17:00
---
Фаза 2 (Plan) выполнена. Тип: task — план записан в задачу (## Implementation Plan).
Составлен конкретный план из 6 файлов: src/bot/rich.ts (renderDocsRich — HTML-таблица ID/Заголовок/Тип/Теги + кнопки doc:<id> по BUTTONS_PER_ROW=8, renderDocumentRich — карточка документа с contentSafe), src/bot/formatting.ts (formatDocsList/formatDocumentDetail — MarkdownV2-фолбэки с escapeMarkdownV2 и усечением 1500), src/bot/registry.ts (BOT_COMMANDS: docs/doc между task и board — 13→15 команд), src/bot/handlers.ts (хелперы sendDocsView/sendDocView по паттерну sendTasksView/sendTaskView, команды /docs и /doc с findBacklogDir(deps.cwd), callback-ветка doc: после task: и до next:), тесты (rich.test.mjs, formatting.test.mjs, registry.test.mjs — хардкод счётчика и commandsHelp), docs/user-guide.md (раздел «Документы в боте» после VL-82).
Ключевые находки при исследовании: listDocuments/getDocument/searchDocuments принимают backlogDir, а не cwd (в отличие от store.listTasks) — в хендлерах обязателен findBacklogDir; тест registry.test.mjs сверяет порядок bot.command в handlers.ts с BOT_COMMANDS через regex (синхронная правка обоих файлов); лимиты Telegram — 8 кнопок в ряд (RICH_MESSAGE_BUTTONS_TOO_MANY), RICH_LIMIT=32768 (chunkRich), 4096 (MarkdownV2-фолбэк).
Проверка: pnpm build && node --test src/bot && pnpm test. Правки кода в Фазе 2 не делались.
---
author: @agent
created: 2026-10-05 18:58
---
Фаза 3 (Code) выполнена. Изменено: src/bot/rich.ts (renderDocsRich — HTML-таблица ID/Заголовок/Тип/Теги + callback-кнопки doc:<id> по BUTTONS_PER_ROW=8; renderDocumentRich — карточка документа: метаданные + тело в секции «Содержимое» через contentSafe, VL-81), src/bot/formatting.ts (formatDocsList/formatDocumentDetail — MarkdownV2-фолбэки с escapeMarkdownV2 и усечением 1500), src/bot/registry.ts (BOT_COMMANDS: docs «Список документов», doc «Документ: /doc doc-1» — между task и board, 14→16 команд; help /start обновился автоматически), src/bot/handlers.ts (импорты document.js/paths.js; хелперы sendDocsView/sendDocView по паттерну sendTasksView/sendTaskView; команды /docs [фильтр] и /doc <id> с findBacklogDir(deps.cwd) — listDocuments/getDocument/searchDocuments принимают backlogDir, не cwd; callback-ветка doc: после task: и до next:, answerCallbackQuery во всех исходах), тесты (rich.test.mjs +2 describe: 10 кейсов renderDocsRich/renderDocumentRich; formatting.test.mjs +2 describe: 8 кейсов; registry.test.mjs — счётчик 14→16 и commandsHelp с /docs, /doc <id>), docs/user-guide.md (раздел «Документы в боте (VL-89)» перед «Самоперезапуск /restart»). Проверки: pnpm build OK, pnpm test — 596/596 (включая 135/135 тестов бота). Отмечены AC#1-3 и DoD#1-3. Что осталось: git-коммит не выполнялся (по регламенту фазы); ручная проверка в живом Telegram не проводилась (нет привязанного чата в этом окружении) — покрыто юнит-тестами рендера и фолбэков.
---
author:  @agent
created: 2026-10-05 20:02
---
Фаза Close выполнена. Статус: Done. Коммит feat: fde94d8 — команды бота /docs и /doc: просмотр документов (rich-таблица + карточка, callback-кнопки doc:<id>).
---
<!-- COMMENTS:END -->