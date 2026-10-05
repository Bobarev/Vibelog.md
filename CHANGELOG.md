# Changelog

Все заметные изменения Vibelog.md. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Добавлено

- **VL-90: /commits — последние коммиты git в Telegram-боте** — команда `/commits [X]` (по умолчанию 10) в привязанном чате: RichMessage-таблица «Тема | Дата | Автор | Хеш» последних X коммитов git-репозитория проекта (read-only). Новая core-функция `getGitLog(cwd, count)` + чистый парсер `parseGitLog` (формат `%h%x1f%an%x1f%ad%x1f%s`; пустой репозиторий различается через `rev-parse --verify HEAD`, не-git — через `rev-parse --is-inside-work-tree`). Рендер `renderCommitsRich` + MarkdownV2-фолбэк `formatCommitsList`; команда в реестре BOT_COMMANDS (меню Telegram + help /start). **Слияние git-модулей core**: `git.ts` + `git-user.ts` + `git-status.ts` объединены в единый `src/core/git.ts` (решение Pavel 2026-10-05, комментарий к Фазе 2 VL-90; по аналогии с `src/git/operations.ts` оригинала Backlog.md) — `git-status.ts` и `git-user.ts` удалены, все импорты обновлены. Тесты парсеров (parseGitLog/parseCommitsCommand), rich-рендера, форматтера и интеграции с реальным git; docs/user-guide.md.
- **VL-91: /tasks — пометка 🔄 задач с активной фазой агента** — строки задач с выполняющейся фазой (spec/plan/code/close/comment) в выводе `/tasks` помечаются значком 🔄 + фаза — и в rich-таблице `renderTasksRich` (новый 3-й параметр `active`, пометка в ячейке ID через cellSafe), и в MarkdownV2-фолбэке `formatTaskList` (новый 2-й параметр `active`, префикс 🔄 + фаза в экранированных скобках). Хендлер `/tasks` собирает карту активности через `getRun` (in-memory оркестратора, тот же процесс, что и бот); завершённые/ошибочные запуски (lastRuns) не помечаются. Ограничение: фазы, запущенные из web UI (отдельный процесс), бот не видит — как в `/task` (VL-43). Тесты rich/formatting, docs/user-guide.md.
- **VL-88: /diff — git-статус незакоммиченных файлов в Telegram-боте** — команда `/diff` в привязанном чате: RichMessage-таблица «Файл | Статус | Строки (+/−)» из `git status --porcelain` + `git diff --numstat` (staged и unstaged раздельно, staged — метка `(staged)`; renamed — «new ← old»; untracked — 0/0) с заголовком-веткой. Новая core-функция `getGitStatus(cwd)` (`src/core/git-status.ts`, spawnSync + чистые парсеры `parsePorcelain`/`parseNumstat`, `-c core.quotepath=false` — кириллические пути). Рендер `renderDiffRich` (HTML-таблица bordered striped compact, cellSafe, chunkRich) + MarkdownV2-фолбэк `formatDiffList`; команда в реестре BOT_COMMANDS (меню Telegram + help /start). Пустой статус → «Незакоммиченных изменений нет»; git-сбой → ошибка в чат без падения бота; read-only. Docs: docs/user-guide.md (раздел «Telegram-бот»).
- **VL-86: TUI агента на Ink — стриминг, карточки tool calls, счётчики** — интерактивный TUI для `vibelog-agent` (`src/agent/tui.tsx`, компоненты `<StreamText>`, `<ToolCard>`, `<Counters>`, `<ErrorBlock>`): посимвольный стриминг onToken из LLM-клиента (VL-83), карточки tool calls (имя, аргументы с обрезкой ~120 символов, статус ⏳/✅/❌, длительность мс), счётчики (ход, токены in/out/cache, время фазы), блок ошибок на русском. Обновление — событиями loop через расширенные опциональные колбэки `onUsage`/`onError` и `isError` в `onToolEnd` (headless-поведение не меняется). TUI рендерится только в интерактивном режиме (stdout TTY, без `--headless`/`--output-format json`) на stderr в альтернативном буфере — stdout остаётся под единственную JSON-строку (контракт VL-63); новый флаг `--no-tui` отключает TUI. Зависимости: ink 7.0.3 + react 19 (@types/react в dev; yoga-layout — WASM, без нативных модулей, Catalina ок); tsconfig: `jsx: react-jsx`, `jsxImportSource: react`. Чистые функции форматирования — `src/agent/tui-format.ts` с юнит-тестами.
- **VL-85: CLI vibelog-agent — headless-замена qwen для фаз** — новый бинарь `vibelog-agent` (`bin/vibelog-agent.mjs` → `src/agent/cli.ts`): аргументы `<phase> <taskId>` собирают промпт из `templates/qwen-commands/phase-*.md` (логика `renderPrompt` вынесена из оркестратора в общий `src/web/phase-prompt.ts`, реэкспорт из `orchestrator.js` сохранён), либо один позиционный аргумент — готовый промпт (qwen-совместимость: `--approval-mode`, `--output-format json` = `--headless`, `--allowed-mcp-server-names` принимаются и игнорируются); tool-calling loop (VL-83) с локальными инструментами + MCP Vibelog (VL-84, отказ — предупреждение в stderr и фаза продолжается без MCP); флаги `--comment`, `--max-tool-calls`, `--max-wall-time`, `--no-mcp`, `--help`; env LLM: `VIBELOG_LLM_BASE_URL`/`VIBELOG_LLM_API_KEY`/`VIBELOG_LLM_MODEL`. Контракт оркестратора VL-63: stdout — ровно одна JSON-строка `type=result` (парсится `parseQwenResult` без изменений), логи — stderr; интеграция — `VIBELOG_QWEN_BIN=bin/vibelog-agent.mjs` без правок кода оркестратора (decision-5 proposed — `VIBELOG_AGENT_BIN` не реализован до подтверждения). TUI — текстовый прогресс в stderr до VL-86.
- **VL-87: docs/agent.md — документация агента Vibelog** — новый документ `docs/agent.md` (на русском): назначение и мотивация (замена qwen в фазах, расход 96k/935k токенов на Comment/Spec), установка (`pnpm install && pnpm build`, Node 20+), настройка Cloud.ru (`VIBELOG_LLM_BASE_URL` с дефолтом `https://foundation-models.api.cloud.ru/v1` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_MODEL`, примеры shell и `.env`), все режимы запуска (интерактивный TUI на stderr, `--headless`, qwen-совместимые `--output-format json`/`--approval-mode`/`--allowed-mcp-server-names`, флаги `--comment`/`--no-mcp`/`--no-tui`/`--max-tool-calls`/`--max-wall-time`), интеграция с оркестратором `VIBELOG_QWEN_BIN=$(pwd)/bin/vibelog-agent.mjs vibelog browser` и контракт stdout (JSON `type=result`, `parseQwenResult`), инструменты (6 локальных + 21 vibelog MCP, ограничения путей/shell), loop detection и лимиты (3 подряд / 100 / 900 сек, поведение при срабатывании), замер расхода токенов (`vibelog qwen-debug` + JSON usage, таблица-шаблон), решения decision-1..5 и открытые вопросы VL-77/doc-4 §9. README.md: раздел «Документация» + подраздел «Агент Vibelog» в «Работа с Qwen Code» со ссылкой. Все факты сверены с кодом `src/agent/*` (без живых замеров токенов — таблица-шаблон).
- **VL-78: карточка задачи в Telegram-боте — кнопки + expand-блоки** — кнопка следующего этапа увеличена: `style="primary"` + эмодзи фазы (▶ Spec / 📋 Plan / 💻 Code / ✅ Close); обе кнопки в центрированном `<tg-button-row align="center">`. Новая кнопка «💬 Комментарий» (`style="success"`, callback `comment:<id>`, показывается всегда): бот просит ввести текст (режим ожидания по chatId, паттерн awaitingPin, `/cancel` — отмена), введённое сохраняется через `addComment` и запускает Фазу Comment — общая логика `commitComment` с командой /comment (VL-60). Секции карточки (AC/DoD/Plan/Notes/Final Summary/Комментарии) свёрнуты в `<details><summary>`, Описание открыта по умолчанию, шапка с метой видна всегда. Фолбэк MarkdownV2 не меняется (details в нём нет).
- **VL-82: /tasks — rich-таблица + callback-кнопки задач** — список невыполненных задач в Telegram-боте вместо MarkdownV2-списка отправляется RichMessage: таблица `<table bordered striped compact>` (колонки ID/Заголовок/Статус/Тип/Приоритет) и под ней ряд callback-кнопок `task:<id>` — нажатие открывает карточку задачи (аналог /task VL-N). Цвет кнопки по типу задачи: новый ключ `task_type_styles` в `.vibelog/bot.yml` (дефолты bug→danger, feature→success, enhancement→primary, epic→primary; валидные стили danger/success/primary/link; дефолты в файл не пишутся). Фолбэк на formatTaskList сохранён; фильтр Done и порядок строк не менялись. Кнопки дробятся на ряды по 8 (лимит Telegram tg-button-row — иначе 400 RICH_MESSAGE_BUTTONS_TOO_MANY при >8 задачах). Ячейки таблицы — HTML `<tr>/<td>` (жирный ID — `<b>`): GFM pipe-строки `| ... |` внутри `<table>` Telegram показывает сырым текстом — формат ячеек приведён к Rich HTML по спецификации (фикс после проверки в Telegram).

## [1.6.0] — 2026-10-04

### Добавлено

- **VL-35: управление задачами из Telegram** — команды /create, /status, /comment (парсинг с подсказками, валидация статусов по конфигу). Новая core-функция `addComment(cwd, id, text, author?)` — автор по умолчанию из `git config user.name` проекта (единый автор для CLI и бота); CLI `task edit --comment` переведён на неё. Правило совместимости уточнено в AGENTS.md: строгая совместимость с Backlog.md — только для хранения данных.
- **VL-39: /task — Rich Messages (Telegram sendRichMessage, GFM)** — полное отображение файла задачи: заголовок, меты, Описание, AC/DoD-чек-листы с отметками, Implementation Plan/Notes/Final Summary, комментарии. Лимит 32768 символов. Фолбэк на MarkdownV2-summary для старых клиентов.
- **VL-34: Telegram-бот `vibelog bot` (grammy)** — long-polling бот: /start с пин-кодом (код печатается в консоль запущенного бота), /tasks, /task <id>, /board. Токен: TELEGRAM_BOT_TOKEN или .vibelog/bot.yml (gitignored). Упоминания zero-deps удалены (AGENTS/README/user-guide) — runtime-зависимость теперь grammy.
- **VL-51: /plan — запуск Фазы 2 (Plan) через headless qwen** — команда /plan <id> для существующей задачи (обычно после /spec, статус Planned). По завершении фазы бот шлёт в чат статус, лог qwen (pre-блок, ≤3000 символов) и карточку задачи. Парсер parsePlanCommand (VL-50), обработчик по аналогии с /spec (VL-42/48).
- **VL-53: /code — запуск Фазы 3 (Code) через headless qwen** — команда /code <id> для существующей задачи; по завершении фазы бот шлёт статус, лог qwen и карточку задачи. По аналогии с /spec (VL-42/48) и /plan (VL-51).
- **VL-54: синхронизация команд бота с Telegram** — при старте `vibelog bot` вызывается `setMyCommands` (меню команд в клиенте Telegram постоянно актуально). Единый источник правды — реестр `src/bot/registry.ts` (BOT_COMMANDS + commandsHelp): help-тексты /start в handlers.ts генерируются из него, хардкод удалён. Ошибки API логируются, бот продолжает polling.
- **VL-63: Формат ответа фаз — 2 сообщения** — информационное сообщение по шаблону (статус + результат qwen + токены + время + session_id) из последней JSON-строки `type=result` (`src/web/qwen-result.ts`, `PhaseRun.result`); сырой JSON-лог в чат больше не шлётся. Подзадачи: VL-64 (парсер), VL-65 (бот).
- **VL-60: /comment — Фаза Comment через headless qwen** — команда /comment <id> «текст»: бот добавляет комментарий и запускает Фазу Comment — headless qwen выполняет запрос из комментария, оставляет отчёт комментарием; статус задачи НЕ меняется (фаза вне жизненного цикла spec/plan/code/close). Текст запроса подставляется в промпт как {{comment}} (фолбэк — последний комментарий задачи). Ответ в чат по паттерну VL-48 (✅/⚠️ + лог + карточка). Подзадачи: VL-61 (оркестратор), VL-62 (бот).
- **VL-55: /close — Фаза Close через headless qwen** — команда /close <id> закрывает задачу: статус завершения из конфига + git commit связанных файлов (файл задачи + modified_files, явные пути, без push) + отчёт комментарием; шаблон templates/qwen-commands/phase-close.md, фаза 'close' в PHASES оркестратора, ответ в чат по паттерну VL-48.
- **VL-66/67/68: /prompt — произвольный запрос через qwen без задачи** — для мелких просьб, не требующих задачи (коммиты, правки настроек): `startPrompt` в оркестраторе (шаблон templates/qwen-commands/prompt.md, git разрешён кроме push без просьбы, guard от двойного запуска по ключу 'prompt', тело startPhase вынесено в общий `spawnQwenRun`; phase='prompt' через HTTP API отклоняется guard'ом). Команда /prompt бота: парсер parsePromptCommand (без unquote — кавычки значимы), обработчик без карточки задачи (по завершении только информационное сообщение VL-63), запись в реестр BOT_COMMANDS.

- **VL-69: поддержка Epic и parent_task_id в фазах workflow** — MCP `backlog_create_task`/`backlog_update_task`/`backlog_list_tasks` принимают `parentTaskId` (валидация существования родителя, сброс пустой строкой, фильтр в list + `parent_task_id` в simplified-выводе); CLI `task edit --parent` и `task list --parent` (`task create --parent` был ранее). `epic` добавлен в DEFAULT_TASK_TYPES, статусы Spec/Planned — в defaultConfig, в backlog/config.yml проекта добавлен явный блок `types`. Промпты фаз переписаны под новую модель: Spec = уточнение и смена type без создания задач; Plan = единственная фаза, создающая задачи (дети с parentTaskId для epic, Blocked + задача-блокер для task); Code = реализация для task и оркестрация детей для epic; Close = закрытие epic только когда все дети Done. Skills /vibelog:{spec,plan,code} обновлены, копии .qwen/commands синхронизированы.
- **VL-70: /restart — самоперезапуск бота из чата** — команда /restart в привязанном чате рестартует бота САМОГО СЕБЯ: ответ «🔄 Перезапуск бота…», bot.stop() (гасит long polling до спавна — без 409-конфликта двух getUpdates), spawn замещающего `vibelog bot` (тот же CLI, cwd проекта; stdio: 'inherit' — пин нового запуска печатается в том же терминале; detached+unref — новый процесс переживает старый) и exit 0. Новый процесс исполняет свежий dist/ после pnpm build — Ctrl+C не требуется; чат остаётся привязанным (.vibelog/bot.yml не меняется). CLI-вариант `vibelog restart` с pid-файлом отклонён (заменял только Ctrl+C). Команда в реестре BOT_COMMANDS (меню + help), docs/user-guide.md.
- **VL-72: кнопка «следующий этап» в rich-выводе /task** — в карточке задачи (renderTaskRich) сразу после заголовка появляется callback-кнопка (`<tg-button type="callback_data" data="next:<id>">`), запускающая следующую фазу workflow по статусу: To Do→Spec, Spec→Plan, Planned/In Progress→Code, Review→Close; для Done/Blocked кнопка не показывается. Новый обработчик `bot.on('callback_query')` в handlers.ts: requireBind → answerCallbackQuery → startPhase с notifyPhaseDone (паттерн /plan,/code,/close). Фолбэк MarkdownV2 кнопку не содержит.

### Изменено

- **VL-71: информационный отчёт фазы — RichMessage (GFM)** — информационное сообщение о завершении фазы (notifyPhaseDone + onExit у /prompt) отправляется через sendRichMessage (renderPhaseResultRich, GFM без MarkdownV2-экранирования); фолбэк на sendText/MarkdownV2 (formatPhaseResult) сохраняется. Шаблон VL-63/65 не меняется.

### Исправлено

- **VL-81: сырые rich-теги в контенте задачи больше не ломают карточку /task** — тело задачи с `<tg-button>`, `<tg-button-row>`, `<details>`, `<summary>` в description/AC/DoD/plan/notes/комментариях парсером Telegram интерпретировалось как настоящие элементы rich-разметки (дубли кнопок, сломанные вложенные `<details>`). Новая функция `richTagsSafe` в renderTaskRich оборачивает такие теги в code-разметку: строки целиком из тегов складываются в fenced-блок, теги вперемешку с текстом — в inline-бэкитики; теги, уже находящиеся в inline-коде, не изменяются (повторная обёртка ломает пары бэктиков и выталкивает сырой тег наружу), а блоки ``` контента превращаются в настоящий fenced-блок — экранированные fenceSafe маркеры ` ` ` fenced-блоком в Telegram не являются и сами по себе контент не защищают (фикс сломанного форматирования карточки VL-81). Композит `contentSafe` применяется только к контенту задачи — служебные теги рендера не затронуты, фолбэк MarkdownV2 (formatTaskDetail) не изменён.
- **VL-63 (reopen): result терялся «в половине случаев» — разделение stdout/stderr** — оркестратор копил stdout и stderr в один буфер: строка stderr (Warning о yolo, логи MCP-серверов), приходившая между частями гигантской JSON-строки stdout (json-адаптер qwen пишет сессию одной строкой-массивом), вклинивалась в её середину и `JSON.parse` падал → фолбэк «Данные результата недоступны». Теперь два независимых буфера: `parseQwenResult` получает только stdout, stderr идёт в logTail отдельно (в таймлайне консоли помечен `err|`). Предложение писать JSON в файл через `--json-file`/`--json-fd` проверено экспериментально (`scripts/qwen-json-probe.mjs`): в headless-режиме qwen 0.24.x эти флаги игнорирует — файл остаётся пустым, JSON по-прежнему идёт в stdout через `--output-format`. Дебаг усилен: при нераспознанном result в консоль печатаются размеры обоих потоков, хвост stdout (400 символов) и stderr (300), а полный stdout дампится в `.vibelog/qwen-debug/<runKey>-<ts>.log` (gitignored).
- **VL-63: парсер JSON-массива qwen и разметка фолбэка** — json-адаптер qwen 0.24.x пишет в stdout одну строку-массив `[{init},{assistant},…,{result}]`, а не NDJSON-поток: `parseQwenResult` теперь разбирает оба формата (плюс фолбэк на `error.message` при is_error). Фолбэк-хвост лога в `formatPhaseResult` экранируется для MarkdownV2 — Telegram больше не отклоняет разметку. Дебаг: при нераспознанном result оркестратор печатает в консоль сводку `explainQwenParse` (счётчики JSON-строк/массивов, хвост последней JSON-строки).

## [1.5.0] — 2026-10-01

Первая публикация в npm: пакет `vibelog.md` (Unlicense, zero runtime dependencies).

Миграция проекта на TypeScript. Поведение и форматы данных не изменились.

### Добавлено

- **VL-32: smoke-тест npm-пакета** — `scripts/npm-smoke.mjs`: pack → установка в чистый /tmp-каталог → реальный прогон CLI (--help, init, task create/list, browser + React UI) + проверка содержимого пакета (шаблоны оркестратора, web/dist, отсутствие backlog/.qwen). Гонять перед npm publish.
- **VL-28: Оркестратор фаз Qwen Code** — перенос карточки в Spec/In Progress/Review на Kanban-доске запускает фазу (spec/plan/code) через `POST /api/tasks/:id/trigger`: сервер спавнит `qwen <промпт> --approval-mode yolo` с headless-промптом из `templates/qwen-commands/phase-*.md`. Guard от двойного запуска (409), поллинг завершения → авто-refresh доски, отчёт фазы виден как последний комментарий карточки. Статусы проекта расширены: Backlog, Spec, Planned.
- **VL-27: Kanban-доска в веб-интерфейсе** (портирована из шаблона arhamkhnz на @dnd-kit/react ^0.5). Колонки — статусы из `backlog.config.yml`; карточка показывает id, title, priority, description, labels, assignee, due_date, число комментариев. Drag-and-drop карточек между колонками выполняет `PATCH /api/tasks/:id` со сменой `status`; при ошибке доска откатывается. Компоненты без следов Next.js ('use client', next/*).
- **VL-26: `vibelog browser` отдаёт React UI из `web/dist`** (Vite + React + Tailwind). Каталог `web/dist` коммитится в репозиторий — свежий clone сразу получает React UI; если сборки нет, сервер отдаёт прежний inline HTML из `assets.ts` (фолбэк). Dev-прокси `/api` → `127.0.0.1:3030` в `web/vite.config.ts`. Скрипт `pnpm web:build` — сборка UI из корня.

### Изменено

- **Весь исходный код на TypeScript** (`src/**/*.ts`, strict-режим): ядро (15 модулей `src/core`), CLI (роутер + 14 команд), MCP-сервер (21 инструмент), веб-интерфейс. Сборка: `pnpm build` (`tsc`) → `dist/` (ESM); `bin/vibelog.mjs` — шим на `dist/cli/router.js`.
- **TypeScript и `@types/node` — только devDependencies**; runtime остаётся zero-dependency (чистый ESM без нативных модулей, совместимость с macOS Catalina сохранена).
- Скрипты: `build` (tsc), `typecheck` (tsc --noEmit), `test` (build + `node --test src`). Тесты (`*.test.mjs`) импортируют скомпилированный код из `dist/`.
- Публичные контракты ядра типизированы: `Task`, `TaskInput`, `ChecklistItem`, `TaskComment`, `Milestone`, `Document`, `Decision`, `SearchFilters`.
- README: установка включает `pnpm build`; AGENTS.md: правило «только .mjs» заменено на схему «.ts → tsc → dist».

### Примечания

- Форматы данных Backlog.md не менялись — round-trip совместимость покрыта compat-тестами (306/306).

## [1.4.0] — 2026-10-01

Первый релиз после v1.2.0: два плановых релиза фич (v1.3 + v1.4) в одном.

### Добавлено — v1.4

- **Documents**: `vibelog doc create/list/view/update/search` + 5 MCP-инструментов `document_*`. Файлы `backlog/docs/<id>-<slug>.md`, типы `readme/guide/specification/other`.
- **Config**: `vibelog config get/set/list` — управление `backlog/config.yml` с типизацией (массивы/boolean/числа), whitelist ключей.
- **Drafts**: `vibelog draft create/list/view/edit/promote/archive` — черновики задач (`draft-N`, статус Draft) в `backlog/drafts/`; `promote` создаёт задачу с префиксом конфига.
- **Decisions (ADR)**: `vibelog decision create/list/view` — `backlog/decisions/`, статусы `proposed/accepted/rejected/superseded`, тело Context/Decision/Consequences/Alternatives.
- `task edit`: batch AC/DoD — `--check-ac 1,3`, `--uncheck-dod 1,2`; MCP `manage_ac`/`manage_dod` принимают массив индексов (как `acceptanceCriteriaCheck` оригинала), `remove` — по убыванию без сдвига.
- `task list`: `--limit N`, `--skip N` — после фильтрации и сортировки.

### Добавлено — v1.3

- **Milestones**: `vibelog milestone add/list/rename/remove/archive` + 5 MCP-инструментов `milestone_*`. Файлы `backlog/milestones/`, `rename` обновляет задачи, `remove --task-handling clear|keep|reassign`.
- **Types**: типы задач (`bug/feature/enhancement/task/chore/docs/spike`) — ключ `types` в конфиге, `--type` в create/list/edit, фильтр `type` в MCP; валидация case-insensitive с каноническим написанием.
- `task create --plan/--notes` — план и заметки при создании.
- `task create`: DoD-дефолты из `config.definition_of_done` (unchecked) + `--no-dod-defaults` — **исправлена несовместимость**: раньше дефолты не добавлялись вовсе.
- `task create`: `--project`, `--parent` (валидация существования), `--ordinal`, `--final-summary`, `--draft` (черновик вместо задачи).
- `task edit`: `--final-summary`, `--append-final-summary`, `--clear-final-summary`, `--ordinal`.
- MCP `backlog_create_task`: параметры `type`, `ordinal`, `finalSummary`, `project` — паритет с `task_create` оригинала.
- `vibelog init` автоматически настраивает MCP-сервер в `.qwen/settings.json` (массив `mcpServers.vibelog` c `trust: true`); отключение — `--no-mcp`.

### Изменено

- Всего **21** MCP-инструмент (было 11 в v1.2.0).
- `backlog_search`: фильтры `status/type/project/priority/modifiedFiles/limit`, `query` необязателен — как `task_search` оригинала; вывод расширен (type, project, labels, milestone).
- `vibelog search`: флаги `--status/--type/--priority/--limit`, запрос необязателен при наличии фильтра.
- doctor: проверка числа MCP-инструментов (21) и их имён.

### Исправлено

- MCP-сервер: терялся последний JSON-RPC ответ при закрытии stdin (гонка `process.exit(0)` с буферизацией stdout-pipe).
- `vibelog search`: значения флагов попадали в поисковый запрос (`search --status Done` искал «Done»); первое слово запроса терялось в `subcommand`.

## [1.2.0] — 2026-09-30

- Планы PLAN-01..10: scaffold, YAML/frontmatter-парсеры, core, CLI, MCP-сервер, web-интерфейс (kanban), compat с Backlog.md (94 задачи), v1.1-workflow (5 MCP-инструментов), diagnostics (`vibelog doctor`), команды `/vibelog:*` для Qwen Code (spec → plan → code).

## [1.1.0] — 2026-09-30

- MCP-инструменты полного workflow: `backlog_update_task`, `backlog_manage_ac`, `backlog_manage_dod`, `backlog_add_comment`, `backlog_update_dependencies` (итого 11).

## [1.0.0] — 2026-09-30

- Первый релиз: markdown-нативный таск-менеджер для git-репозиториев, совместимый с Backlog.md. Чистый Node.js, zero runtime dependencies, macOS 10.15 Catalina + Qwen Code.
