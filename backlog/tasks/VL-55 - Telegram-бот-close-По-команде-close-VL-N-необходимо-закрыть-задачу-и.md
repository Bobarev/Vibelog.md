---
id: VL-55
title: 'Telegram-бот: /close — По команде /close VL-N необходимо закрыть задачу и…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 01:12'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Telegram-бот: /close — По команде /close VL-N необходимо закрыть задачу и выполнить коммит всех связанных с ней файлов, но и создать команду для qwen (такую же как и например templates/qwen-commands/phase-1.md), чтобы qwen всё это выполнил, после этого так же оставил отчёт комментарием и по завершению должен быть ответ в чат такой же как у spec plan code
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan (VL-55: /close — Фаза Close)

Контекст: /close — четвёртая фаза qwen-оркестратора. Задача разбита на подзадачи (Фаза 1):
- **VL-56** — ядро: шаблон phase-close.md + оркестратор + тесты (без зависимостей)
- **VL-57** — оболочка бота: парсер + обработчик + реестр + CHANGELOG (зависит от VL-56)

Порядок работ: VL-56 → VL-57 → закрытие VL-55.

---

### 1. templates/qwen-commands/phase-close.md (НОВЫЙ файл, VL-56)

Шаблон Фазы Close по образцу phase-3.md (27 строк; {{taskId}} подставляет renderPrompt). Содержимое — промпт для headless qwen:

1. Прочитать задачу: backlog_view_task {"id": "{{taskId}}"}.
2. Закрыть задачу:
   - backlog_manage_dod list — сверить DoD; незакрытые пункты отметить только если реально выполнены;
   - backlog_update_status {"id": "{{taskId}}", "status": "Done"}.
3. Коммит связанных файлов:
   - git add <файл задачи backlog/tasks/…> <файлы из modified_files задачи>;
   - git commit -m "docs(task): {{taskId}} — закрытие задачи (AC, статус Done)";
   - НЕ push. Если git add/commit падает (нет изменений, конфликт) — честно зафиксировать в комментарии, статус всё равно Done.
4. Отчёт комментарием: backlog_add_comment {"id": "{{taskId}}", "comment": "Фаза Close (закрытие) выполнена. Статус Done. Коммит: <sha/message или причина пропуска>.", "author": "@agent"}.

Ответ в чат шаблон НЕ формирует — его шлёт бот через PhaseExitCallback (VL-48), как у spec/plan/code.

Правила: не выйти за пределы проекта; только Node.js; git commit разрешён ТОЛЬКО файлов задачи (явные пути, не git add -A).

### 2. src/web/orchestrator.ts (184 строки, VL-56)

- Строка 22: `const PHASES = ['spec', 'plan', 'code'] as const;` → добавить 'close':
  `const PHASES = ['spec', 'plan', 'code', 'close'] as const;`
- Строки 26–30 (PHASE_FILES): добавить `close: 'phase-close.md',`.
- Без правок (автоматически через типы): Phase (строка 23), renderPrompt (80), startPhase (101), api.ts (68) — phase приходит из запроса, валидация идёт через PHASES.

### 3. scripts/npm-smoke.mjs

- Строка 135: массив ['phase-1', 'phase-2', 'phase-3'] → добавить 'phase-close' (проверка попадания шаблона в npm-пакет).

### 4. src/bot/commands.ts (~200 строк, VL-57)

- После строки 44 (interface CodeCommand): `export interface CloseCommand { id: string; }`
- После строки 193 (конец parseCodeCommand): `export function parseCloseCommand(text: string): CloseCommand | { error: string }` — копия parseCodeCommand с hint 'Синтаксис: /close VL-<id>'.

### 5. src/bot/handlers.ts (409 строк, VL-57)

- Импорт (строки 19–31): добавить parseCloseCommand (после parseCodeCommand, алфавитно).
- После строки 387 (конец bot.command('code', …)), ДО комментария «Ввод пина — ОБЯЗАТЕЛЬНО ПОСЛЕ ВСЕХ bot.command» (строка 388): новый блок bot.command('close', …) — копия /code (строки 348–387) с заменами:
  - parseCloseCommand((ctx.match ?? '').toString());
  - startPhase(deps.cwd, task.id, 'close', onExit);
  - Тексты onExit: «✅ *Фаза Close завершена* для …» / «⚠️ *Фаза Close завершена с ошибкой* для …»;
  - Ответ на запуск: «🚀 Фаза Close запущена для *<id>*, PID …».
- catch-all message:text (строка 390+) не трогать — close регистрируется до него.

### 6. src/bot/registry.ts (62 строки, VL-57)

- BOT_COMMANDS (строки 26–39), после записи code (строка 38):
  `{ command: 'close', description: 'Закрыть задачу (Фаза Close) через qwen' },`
- commandsHelp (44–47) — без правок: help-строка /start автоматически получит «, /close».

### 7. Тесты (*.test.mjs, импортируют dist/)

- src/web/orchestrator.test.mjs — новый it в describe после строки 99:
  renderPrompt('close', 'VL-55') возвращает промпт, содержащий VL-55 и текст шаблона (например «Фаза Close»); renderPrompt('deploy') по-прежнему бросает /Неизвестная фаза/.
- src/bot/commands.test.mjs — describe('parseCloseCommand (VL-57)') после блока parseCodeCommand (строки 117–135): 'VL-55' → {id:'VL-55'}; '  VL-55  '; 'VL-55 ещё текст' → {id:'VL-55'}; '' и '   ' → {error}. Импорт — в верхнюю группу (строка 12).
- src/bot/registry.test.mjs:
  - Строка 13: BOT_COMMANDS.length 10 → 11.
  - Строка 39: ожидаемая help-строка → '…, /spec, /plan, /code, /close'.

### 8. CHANGELOG.md (VL-57)

- В [Unreleased] → «Добавлено», после пункта VL-54 (строка ~11): `- **VL-55: /close — Фаза Close через headless qwen** — команда /close <id> закрывает задачу: статус Done + git commit связанных файлов + отчёт комментарием; шаблон templates/qwen-commands/phase-close.md, фаза 'close' в PHASES оркестратора, ответ в чат по паттерну VL-48.`

---

### Порядок действий

1. VL-56: phase-close.md → orchestrator.ts → npm-smoke.mjs → orchestrator.test.mjs → `pnpm build && pnpm test` → закрыть VL-56.
2. VL-57: commands.ts → handlers.ts → registry.ts → commands.test.mjs/registry.test.mjs → CHANGELOG.md → `pnpm build && pnpm test` → закрыть VL-57.
3. VL-55: сводный комментарий → закрытие задачи (пользователь или /close самой VL-55 как smoke-тест).

### Как проверить

- `pnpm build && pnpm test` — все тесты зелёные, включая 3 новых блока (close в PHASES, parseCloseCommand, длина реестра 11).
- Статическая проверка шаблона: `node --input-type=module -e "import('./dist/web/orchestrator.js').then(m => console.log(m.renderPrompt('close', 'VL-99').slice(0, 200)))"` — промпт из phase-close.md с подставленным VL-99.
- `node scripts/npm-smoke.mjs` — перед npm publish (проверка phase-close.md в tarball).
- Ручная верификация бота (chrome-devtools/логи не требуются): запустить `vibelog bot`, /close VL-99 в привязанном чате → «🚀 Фаза Close запущена…», по завершении — статус, лог, карточка задачи (как у /code).

### Риски

1. **registry.test.mjs хардкодит length и help-строку** — синхронизировать оба (строки 13 и 39), иначе pnpm test красный.
2. **Конфликт правил git**: phase-3.md запрещает git commit, а close-шаблон его требует — в шаблоне явно прописать разрешение только для файлов задачи с явными путями (не git add -A), чтобы не закоммитить чужой worktree.
3. **Колбэк чата работает только при живом боте**: фаза, запущенная через POST /api/tasks/:id/trigger (web), не шлёт сообщение в чат — только комментарий к задаче. Это текущее поведение всех фаз (VL-48), не регрессия.
4. **Статус Done может быть переименован** в пользовательском конфиге (src/core/config.ts:28 — дефолт 'Done'): шаблон должен велеть брать актуальный статус завершения из конфига проекта, а не хардкодить.
5. **UI-доска не получает кнопку Close** — вне объёма VL-56/57; фаза запускается из бота или по POST trigger.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 01:16
---
Фаза 1 (Spec) выполнена. Созданы задачи: VL-56 — Фаза Close: шаблон phase-close.md + расширение оркестратора (PHASES, PHASE_FILES, тесты); VL-57 — Telegram-бот: команда /close VL-N (парсер + обработчик + реестр + CHANGELOG, зависит от VL-56). Краткое описание разбиения: фича /close — это четвёртая фаза qwen-оркестратора. VL-56 — ядро: шаблон templates/qwen-commands/phase-close.md (по образцу phase-3.md, но git-операции обязательны: git add/commit файлов задачи и modified_files) + добавление 'close' в PHASES/PHASE_FILES src/web/orchestrator.ts + тесты renderPrompt. VL-57 — оболочка бота по паттерну VL-53: parseCloseCommand (копия parseCodeCommand), bot.command('close') с startPhase и PhaseExitCallback VL-48 (ответ в чат как у spec/plan/code), запись в BOT_COMMANDS (VL-54 — меню и help генерируются из реестра), CHANGELOG. Зависимость: VL-57 → VL-56 (без фазы в PHASES startPhase вернёт ошибку renderPrompt).
---
author: @agent
created: 2026-10-03 01:23
---
Фаза 2 (Plan) выполнена. План записан: 8 файлов, ключевые изменения: (1) templates/qwen-commands/phase-close.md — новый шаблон Фазы Close (статус Done + git commit файлов задачи + отчёт комментарием); (2) src/web/orchestrator.ts — 'close' в PHASES (стр. 22) и PHASE_FILES (стр. 26-30); (3) scripts/npm-smoke.mjs — 'phase-close' в проверке пакета (стр. 135); (4) src/bot/commands.ts — CloseCommand + parseCloseCommand (копия parseCodeCommand); (5) src/bot/handlers.ts — bot.command('close') после /code (стр. 387), startPhase('close', onExit) — ответ в чат как у spec/plan/code (VL-48); (6) src/bot/registry.ts — запись 'close' в BOT_COMMANDS (стр. 38), меню/help из реестра (VL-54); (7) тесты: orchestrator.test.mjs (renderPrompt close), commands.test.mjs (parseCloseCommand), registry.test.mjs (length 10→11, help-строка); (8) CHANGELOG.md — пункт VL-55. Порядок: VL-56 (ядро) → VL-57 (бот) → VL-55. Проверка: pnpm build && pnpm test + node -e renderPrompt('close'). Риски: синхронизация хардкода в registry.test.mjs; явные пути git add (не git add -A); статус Done может быть переименован в конфиге проекта; ответ в чат только при живом боте. Статус не меняю — план ждёт одобрения.
---
author: @agent
created: 2026-10-03 01:38
---
Фаза 3 (Code) выполнена. Реализовано по плану целиком: подзадачи VL-56 (ядро) и VL-57 (бот) были в статусе To Do на момент старта и выполнены в этом же прогоне — комментарии и отметки AC/DoD есть в обеих. Изменено (10 файлов): templates/qwen-commands/phase-close.md (новый), src/web/orchestrator.ts, scripts/npm-smoke.mjs, src/bot/commands.ts, src/bot/handlers.ts, src/bot/registry.ts, src/web/orchestrator.test.mjs, src/bot/commands.test.mjs, src/bot/registry.test.mjs, CHANGELOG.md. Проверки: pnpm build OK, pnpm test — 384/384 (новые тесты: renderPrompt фазы close, parseCloseCommand ×4, реестр 11 команд + help-строка, порядок bot.command ↔ BOT_COMMANDS), статическая проверка renderPrompt('close', 'VL-99'). Ответ в чат — паттерн VL-48 (PhaseExitCallback), как у spec/plan/code. Что осталось: git commit изменений (Фазы 1–3 commit'ы запрещают — выполнит Фаза Close или вручную), ручная smoke-проверка бота, ревью и закрытие.
---
author: @agent
created: 2026-10-03 01:50
---
Ревью-фикс (по замечанию Pavel): шаг 4 phase-close.md переписан — раньше шаблон велел git add файлов задачи И файлов кода из modified_files одним docs(task)-коммитом: qwen закоммитил бы код с неверным префиксом или всё в один коммит. Теперь явная двухкоммитная схема: (a) код/документация из modified_files (не backlog/) — отдельный коммит feat: {{taskId}} — <описание из задачи> (fix: для багов, НИКОГДА docs(task) для кода); (b) файл задачи — docs(task) всегда; если кода нет — только (b). Шаг 5 (отчёт) — «Коммиты: <оба хэша/темы>». Ограничения сохранены: явные пути, никогда git add -A, без push. Проверка: renderPrompt('close','VL-99') содержит 'feat: VL-99'. Правка входит в общий незакоммиченный VL-55-батч.
---
author: @agent
created: 2026-10-03 01:56
---
Фаза Close (закрытие) выполнена. Статус: Done. Отмеченные DoD: все уже были отмечены (Тесты проходят, Документация обновлена, Нет регрессий — 3/3). Проверка перед коммитом: pnpm test — 384/384 зелёные. Коммиты: b90bfb4 feat: VL-55 — /close: Фаза Close через headless qwen в Telegram-боте (9 файлов: phase-close.md, orchestrator.ts/.test.mjs, commands.ts/.test.mjs, handlers.ts, registry.ts/.test.mjs, CHANGELOG.md — батч VL-55/56/57; registry.ts и часть handlers.ts/CHANGELOG захватили иVL-54-правки, т.к. они в тех же файлах); deb9269 docs(task): VL-55 — закрытие задачи (AC, статус Done). Не закоммичено (чужая работа, вне modified_files VL-55): src/cli/commands/bot.ts (VL-54 syncCommands), templates/qwen-commands/phase-1.md и spec.md, файлы задач VL-36/44/45/46/47/49/54/56/57. modified_files у задачи был пуст — файлы определены по комментарию Фазы 3 и диффу worktree.
---
author: @agent
created: 2026-10-03 02:06
---
Ревью-фикс 2 (по замечанию Pavel — «очень долго выполняется» + баг порядка). Найдено и исправлено: (1) ДУБЛИКАТЫ Фазы Code: шаг «сверь AC/DoD, не отмечай задним числом» слово в слово из интерактивного /vibelog:code — для закрываемых задач это повторная работа (2 list-вызова + рассуждения по пунктам — самая долгая часть); правила дословно повторяли шаг 4 (не git add -A / не push); паранойя про переименованные статусы заставляла читать конфиг каждый раз. (2) БАГ ПОРЯДКА: docs(task)-коммит (шаг 4b) шёл ДО отчётного комментария (шаг 5) — отчёт оставался незакоммиченным. (3) Шаг 5 требовал «хэши обоих коммитов», а docs(task)-хэш заведомо ещё не существовал. Новая схема (33 строки вместо 39, промпт 2066 символов вместо 2943): чтение задачи → AC/DoD одной строкой УСЛОВНО («если не отмечены — отметь; иначе шаг 3») → статус Done → feat-коммит кода из modified_files (с проверкой git status --porcelain, пропуск если чисто) → отчёт-комментарий ДО docs(task)-коммита (с хэшем feat) → docs(task)-коммит файла задачи (в него попадают статус и комментарий). Вступление: «не повторяй работу Фаз Code». Ограничения git сохранены (явные пути, без add -A/push). Проверка: renderPrompt('close','VL-99') содержит feat/docs(task)-инструкции и «ДО коммита файла задачи». Оговорка: AC/DoD оставлены в close условно, т.к. headless phase-3.md НЕ отмечает AC/DoD (только интерактивный skill) — альтернатива: перенести отметку в phase-3.md и убрать из close совсем.
---
<!-- COMMENTS:END -->