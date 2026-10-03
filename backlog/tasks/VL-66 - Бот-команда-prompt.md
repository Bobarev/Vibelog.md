---
id: VL-66
title: 'Бот: команда prompt'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 15:18'
updated_date: '2026-10-03 15:52'
due_date: ''
labels: []
dependencies: []
milestone: ''
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
Бот: команда prompt. Нужно сделать команду которая будет обрабатывать запросы, слишком мелкие для задачи. Например: сделай коммиты для всех незакоммиченных сейчас файлов. Или там внеси что-то в настройки qwen на уровне проекта. Ну или что-то в подобном роде.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст

VL-66 разбит в Фазе 1 на две подзадачи (см. комментарий Spec):
- **VL-67** — оркестратор: `startPrompt(cwd, promptText, onExit)` + шаблон `templates/qwen-commands/prompt.md` (без зависимостей);
- **VL-68** — бот: команда `/prompt` (зависит от VL-67).
План покрывает реализацию обеих подзадач; порядок — VL-67 → VL-68.

## Файлы (10)

Новые (1):
1. `templates/qwen-commands/prompt.md`

Изменяемые (9):
2. `src/web/orchestrator.ts`
3. `src/bot/commands.ts`
4. `src/bot/handlers.ts`
5. `src/bot/registry.ts`
6. `src/web/orchestrator.test.mjs`
7. `src/bot/commands.test.mjs`
8. `src/bot/registry.test.mjs`
9. `docs/user-guide.md`
10. `CHANGELOG.md`

## VL-67 — Оркестратор

### 1. Шаблон `templates/qwen-commands/prompt.md` (новый)

Содержимое по образцу phase-comment.md, но БЕЗ MCP-шагов и задачи:
- Заголовок: «Ты — автоматический исполнитель Vibelog (команда prompt: произвольный запрос пользователя)».
- Шаг: выполни запрос пользователя: `{{prompt}}`.
- Правила: работай в текущей директории проекта; не трогай `backlog/` и статусы задач; git-операции РАЗРЕШЕНЫ (commit и т.п. — выполняй ровно то, что просит пользователь; НЕ делай push, если просьба явно не содержит push); только Node.js (без python/ruby/perl/внешних рантаймов); не выходи за пределы проекта.
- Финал: ответь кратким отчётом в 1-3 предложениях — что сделано или что пошло не так. ВАЖНО: финальный текст должен содержать отчёт (он попадает в JSON type=result → formatPhaseResult покажет его в чате), одиночное «Готово» здесь НЕ использовать.

### 2. `src/web/orchestrator.ts`

- Строка 24: `PHASES` += `'prompt'` (тип `Phase` расширяется).
- Строки 28-36: `PHASE_FILES` += `prompt: 'prompt.md',`.
- Строка 92 (renderPrompt): текст ошибки фазы → «ожидается spec|plan|code|close|comment|prompt».
- Строки 143-280: вынести тело startPhase ПОСЛЕ renderPrompt (`const bin = process.env.VIBELOG_QWEN_BIN` … `return { started: true; pid: child.pid ?? -1 }`) в приватную функцию `spawnQwenRun(cwd: string, runKey: string, phase: Phase, prompt: string, onExit?: PhaseExitCallback): StartResult`:
  - guard `activeRuns.has(...)` переезжает внутрь, сообщение генерализовать до «Запуск уже выполняется» (тест orchestrator.test.mjs:140 матчит /уже выполняется/ — регрессии нет);
  - в теле заменить `taskId` → `runKey` (activeRuns.set/delete, lastRuns.set/delete, логи `[phase ${runKey}]`);
  - `phaseFlags` (строки 145-148) остаётся как есть: для prompt попадает `[]` (как у comment — без --allowed-mcp-server-names).
- `startPhase` (строка 120) после рефактора: в начале — guard `if (phase === 'prompt') return { error: 'Фаза prompt запускается через startPrompt' }` (защита HTTP-границы: api.ts:67-68 пропускает произвольный phase из POST-body; без guard'а qwen получил бы шаблон с неподставленным {{prompt}}); затем renderPrompt + `spawnQwenRun(cwd, taskId, phase, prompt, onExit)`.
- Новая экспортная функция `startPrompt(cwd: string, promptText: string, onExit?: PhaseExitCallback): StartResult` (после startPhase, ~строка 285):
  - `try { prompt = renderPrompt('prompt', '', { prompt: promptText }); } catch (err) { return { error: (err as Error).message }; }` — отсутствие шаблона → «Шаблон промпта не найден: …» (AC VL-67);
  - `return spawnQwenRun(cwd, 'prompt', 'prompt', prompt, onExit);`
  - Ключ запуска — строка `'prompt'` в общих activeRuns/lastRuns: guard от двойного запуска и `getRun('prompt')` достаются без новых map.
- `PhaseRun.phase === 'prompt'` → formatPhaseResult покажет «Фаза prompt: завершена (код 0)» — ок.

### 3. Тесты `src/web/orchestrator.test.mjs` (паттерн строки 127: стаб VIBELOG_QWEN_BIN + VL28_STUB_RESULT)

- `renderPrompt('prompt', '', { prompt: 'сделай коммиты' })` — `{{prompt}}` подставлен, `{{taskId}}` в шаблоне отсутствует.
- `startPrompt` со стабом: started=true; после close — `getRun('prompt').exitCode === 0`, `result.result` равен тексту из VL28_STUB_RESULT (парсер VL-63/64).
- Двойной `startPrompt` при живом процессе (стаб со сном) — `{ error: /уже выполняется/ }`.
- `startPhase(cwd, id, 'prompt')` — `{ error }` (guard).

## VL-68 — Бот /prompt

### 4. `src/bot/commands.ts`

- После интерфейса `CloseCommand` (строки 46-48): `export interface PromptCommand { text: string }`.
- В конец файла (после parseCloseCommand, строка 208):
  - `parsePromptCommand(text): PromptCommand | { error: string }`;
  - hint = 'Синтаксис: /prompt <запрос>';
  - пустой/пробельный trimmed → `{ error: hint }`, иначе `{ text: trimmed }`.
  - Без unquote — запрос естественный, кавычки значимы.

### 5. `src/bot/handlers.ts`

- Строка 24: импорт orchestrator → `{ getRun, startPhase, startPrompt }`.
- Импорт commands (строки 26-34): `+ parsePromptCommand`.
- Новый обработчик `bot.command('prompt')` — ВСТАВИТЬ между ~строкой 412 (конец /close `});`) и строкой 414 (комментарий «Ввод пина») / 418 (`bot.on('message:text')`) — catch-all обязан остаться последним:
  - `requireBind` → `parsePromptCommand(ctx.match)` → `{ error }` → `sendMd(parsed.error)`, return;
  - `const notifyChat = ctx.chat?.id;`
  - `onExit: PhaseExitCallback = (run) => { if (notifyChat === undefined) return; void sendText(bot, notifyChat, formatPhaseResult(run)); }` — задачи нет: карточка НЕ шлётся, только информационное сообщение (VL-63/65); notifyPhaseDone не используется (требует Task);
  - `const result = startPrompt(deps.cwd, parsed.text, onExit);`
  - `'error' in result` → `sendMd('⚠️ ' + escapeMarkdownV2(result.error))`, return;
  - иначе `sendMd(\`🚀 Запрос отправлен в qwen, PID ${result.pid}\`)`.

### 6. `src/bot/registry.ts`

- Строка 37 (после `{ command: 'close', ... }`): вставить `{ command: 'prompt', description: 'Выполнить запрос через qwen без задачи', usage: '/prompt <текст>' },` — меню Telegram (setMyCommands) и help /start обновятся автоматически через commandsHelp.

### 7. Тесты бота

- `src/bot/commands.test.mjs` (паттерн строк 61-72, parseCommentCommand): parsePromptCommand — текст с пробелами → `{ text }`; `''` и `'   '` → `{ error }`.
- `src/bot/registry.test.mjs`: в BOT_COMMANDS есть `{ command: 'prompt', usage: '/prompt <текст>' }` (по аналогии с проверками остальных команд).

## Документация

### 8. `docs/user-guide.md`

- Таблица «Фазы через qwen» (строки 291-297, раздел 11 «Telegram-бот», строка 285): добавить строку `| /prompt <текст> | Prompt | произвольный запрос через qwen без задачи (git разрешён) |`.
- После таблицы: абзац — /prompt не создаёт задачу; по завершении в чат приходит только информационное сообщение VL-63 (без карточки); одновременно активен только один /prompt (guard).

### 9. `CHANGELOG.md`

- [Unreleased] → «Добавлено» (после строки 15): запись **VL-66/67/68: /prompt — произвольный запрос через qwen без задачи** — startPrompt в оркестраторе (шаблон prompt.md, git разрешён, guard от двойного запуска), команда /prompt бота (парсер, реестр, ответ без карточки задачи).

## Порядок действий

1. VL-67: шаблон prompt.md → orchestrator.ts (PHASES/PHASE_FILES/renderPrompt/guard/рефактор spawnQwenRun/startPrompt) → тесты orchestrator.test.mjs → `pnpm test`.
2. VL-68: commands.ts (парсер + тесты) → handlers.ts → registry.ts (+тест) → `pnpm test`.
3. Документация (user-guide.md, CHANGELOG.md) → `pnpm test`.

## Как проверить

- `pnpm typecheck` — strict TS без ошибок.
- `pnpm test` — build + `node --test src` (все существующие + новые тесты).
- Smoke подстановки без запуска qwen:
  `node --input-type=module -e "import('./dist/web/orchestrator.js').then(m=>console.log(m.renderPrompt('prompt','',{prompt:'сделай коммиты'})))"`
  — в выводе виден текст запроса вместо {{prompt}}.
- Ручной smoke бота (опционально, нужен TELEGRAM_BOT_TOKEN): `vibelog bot` → `/prompt echo test` → сообщение «🚀 Запрос отправлен…», затем информационное сообщение с результатом.

## Риски

1. **Рефактор spawnQwenRun** затрагивает тело всех фаз (spec/plan/code/close/comment) — чистый code-move, покрыт orchestrator.test.mjs; при сомнениях — smoke-комментарий к любой задаче после изменений.
2. **Guard-сообщение** генерализуется («Запуск уже выполняется») — существующий тест матчит по подстроке /уже выполняется/, регрессии нет; альтернатива — оставить исходний текст для фаз задач и своё для prompt.
3. **MCP в headless-сессии**: шаблон prompt не требует Vibelog MCP, флаг --allowed-mcp-server-names не передаётся (как у comment); но .qwen/settings.json проекта подключает chrome-devtools — qwen может его инициализировать (задержка старта). Фолбэк: передать флаг отдельной правкой, если задержка заметна.
4. **git push**: шаблон явно запрещает push без просьбы пользователя (минимальный blast radius); commit разрешён — это суть команды.
5. **Один активный /prompt** — второй параллельный запрос получает ошибку guard'а; ограничение документируется; остановка активного запуска из бота вне scope VL-66.
6. **POST /api/tasks/:id/trigger с phase='prompt'** — отклоняется guard'ом startPhase; web-кнопки фаз не трогаются.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 15:21
---
Фаза 1 (Spec) выполнена. Созданы задачи: VL-67 — Оркестратор: startPrompt — запуск произвольного промпта через qwen без задачи; VL-68 — Бот: команда /prompt — произвольный запрос через qwen без задачи (зависит от VL-67). Краткое описание разбиения: фича разбита на 2 задачи по слоям — (1) оркестратор: новая функция startPrompt в src/web/orchestrator.ts + шаблон templates/qwen-commands/prompt.md с подстановкой {{prompt}}, парсинг JSON-результата qwen (паттерн VL-63/64), guard от двойного запуска, git-операции разрешены (в отличие от Фазы Comment); (2) бот: парсер parsePromptCommand + обработчик /prompt в handlers.ts + запись в реестр registry.ts, ответ в чат — только информационное сообщение formatPhaseResult без карточки задачи (задачи нет), плюс документация (user-guide, CHANGELOG).
---
author: @agent
created: 2026-10-03 15:30
---
Фаза 2 (Plan) выполнена. План записан в VL-66: 10 файлов (1 новый: templates/qwen-commands/prompt.md; 9 изменяемых: orchestrator.ts, commands.ts, handlers.ts, registry.ts, 3 теста, user-guide.md, CHANGELOG.md). Ключевые изменения: VL-67 — startPrompt в оркестраторе (шаблон prompt.md с {{prompt}}, git разрешён, guard по ключу 'prompt', рефактор spawnQwenRun выносит тело startPhase в общий приватный хелпер, guard в startPhase против phase='prompt' из HTTP API); VL-68 — парсер parsePromptCommand + обработчик /prompt (без карточки задачи, только formatPhaseResult) + запись в BOT_COMMANDS + документация. Проверка: pnpm typecheck + pnpm test + smoke renderPrompt. Риски: рефактор затрагивает тело всех фаз (code-move, покрыт тестами), MCP chrome-devtools может замедлять старт сессии, push в git запрещён шаблоном без явной пробы.
---
author: @agent
created: 2026-10-03 15:45
---
Фаза 3 (Code) выполнена. Изменено: 10 файлов по плану (VL-67 + VL-68).
**VL-67 — оркестратор:**
- `templates/qwen-commands/prompt.md` (новый): шаблон запроса без задачи — git разрешён (commit), push запрещён без явной просьбы, backlog/ не трогается, финал — отчёт 1-3 предложения (не «Готово», чтобы попал в type=result → чат).
- `src/web/orchestrator.ts`: PHASES/PHASE_FILES += prompt; renderPrompt — ошибка «ожидается …|prompt»; тело startPhase вынесено в приватный `spawnQwenRun(cwd, runKey, phase, prompt, onExit)` (code-move: taskId → runKey, guard генерализован до «Запуск уже выполняется» — существующий тест матчит /уже выполняется/, регрессии нет); guard в startPhase против phase='prompt' из HTTP API (защита неподставленного {{prompt}}); новая экспортная `startPrompt(cwd, promptText, onExit)` — ключ запуска 'prompt' в общих activeRuns/lastRuns.
- Тесты `src/web/orchestrator.test.mjs` (+4): renderPrompt подстановка {{prompt}} без {{taskId}}; startPrompt со стабом (exitCode 0, run.result из JSON type=result, без --allowed-mcp-server-names); double-trigger guard /уже выполняется/; startPhase(phase='prompt') → error.
**VL-68 — бот:**
- `src/bot/commands.ts`: PromptCommand + parsePromptCommand (без unquote — кавычки значимы).
- `src/bot/handlers.ts`: обработчик /prompt между /close и catch-all: requireBind → парсер → startPrompt → «🚀 Запрос отправлен в qwen, PID …»; onExit шлёт только formatPhaseResult (задачи нет — без карточки).
- `src/bot/registry.ts`: запись prompt в BOT_COMMANDS (usage '/prompt <текст>') — меню и help /start обновляются автоматически.
- Тесты: commands.test.mjs (+3: текст с пробелами, кавычки значимы, пустой ввод → error), registry.test.mjs (12 команд, prompt в реестре, help-строка с /prompt <текст>).
**Документация:** docs/user-guide.md — строка /prompt в таблице фаз + абзац о поведении; CHANGELOG.md — запись VL-66/67/68 в [Unreleased].
**Проверки:** pnpm typecheck OK; pnpm test — 425/425 (все существующие + 11 новых); smoke renderPrompt('prompt', '', {prompt:'сделай коммиты'}) — запрос подставлен.
Что осталось: ручной smoke бота с реальным TELEGRAM_BOT_TOKEN (опционально, требует сети); остановка активного /prompt из бота — вне scope (задокументировано в user-guide).
---
author:  @agent
created: 2026-10-03 15:52
---
Фаза Close выполнена. Статус: Done. Коммит feat: 9064964 — команда /prompt: произвольный запрос через qwen без задачи (VL-67, VL-68).
---
<!-- COMMENTS:END -->