---
id: VL-141
title: 'Бот-команда /analyze: штатный разбор сессии агента по session-ref (vb:agent-XXX) — статистика, вердикт, рекомендации'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 13:51'
updated_date: '2026-10-14 22:59'
due_date: ''
labels: []
dependencies: []
milestone: v1.8
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/qwen-commands/phase-analyze.md
  - src/web/phase-prompt.ts
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/web/phase-prompt.test.mjs
  - src/bot/commands.ts
  - src/bot/commands.test.mjs
  - src/bot/handlers.ts
  - src/bot/registry.ts
  - src/bot/registry.test.mjs
  - src/cli/commands/agent.ts
  - src/cli/router.ts
  - src/cli/cli.test.mjs
  - src/agent/cli.ts
  - README.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Владелец регулярно просит разобрать сессию агента («проанализируй agent-XXX») — ручной цикл повторён уже 6+ раз за два дня (VL-98, VL-113, VL-117, VL-134, VL-122, VL-137): парсинг jsonl, подсчёт убийств wall-time/resume, профиль tool-вызовов, вердикт «объём задачи vs тупик», рекомендации. Нужна штатная команда.

Реализация: бот-команда /analyze vb:agent-XXX (session-ref в том же формате, что resume; поддержать и bare agent-XXX) → фаза analyze — headless-фаза без задачи (как prompt, runKey вида analyze-<sessionId>); taskId/фаза/cwd берутся из meta.json сессии (VL-114). Промпт-шаблон phase-analyze.md даёт агенту ДЕТЕРМИНИРОВАННЫЙ протокол: сначала node-скрипт статистики по jsonl (длительность, прогоны по «Продолжи», wall-убийства, «Пустой ответ модели», NaN-индексы, профиль вызовов по именам, топ tool-выводов, edit/read по файлам), затем вердикт и рекомендации (с проверкой, не заведена ли уже задача на найденную проблему — ссылки на существующие VL). То, что делал ассистент вручную, — в штатной команде.

CLI-паритет: vibelog agent analyze <ref> для запуска без бота. Реестр команд бота пополняется (учесть чек-лист BOT_COMMANDS + registry.test).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 templates/qwen-commands/phase-analyze.md: шаблон анализа — детерминированная статистика jsonl (node-скрипт: длительность, прогоны/resume, wall-убийства, пустые финалы, NaN-индексы, профиль tool-вызовов, топ больших tool-выводов, чтения/правки по файлам) + вердикт (объём задачи vs тупик/расточительство) + рекомендации со ссылками на уже открытые задачи; финал — одно слово «Готово»
- [x] #2 orchestrator: фаза analyze в PHASES/PHASE_FILES; запуск БЕЗ задачи (как prompt); taskId из meta.json сессии для контекста (фаза/задача); session-ref принимается вида vb:agent-XXX и agent-XXX
- [x] #3 src/bot: parseAnalyzeCommand (+тесты commands.test), bot.command('analyze'), запись в BOT_COMMANDS реестра (registry.test: длина + help-строка)
- [x] #4 CLI: vibelog agent analyze <session-ref> — тот же путь через startPhase('analyze'); тест в cli.test
- [x] #5 docs/README: упоминание команды; pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Фаза analyze: headless-разбор сессии агента без задачи

Исследовано: `src/web/phase-prompt.ts` (PHASES/PHASE_FILES/renderPrompt), `src/web/orchestrator.ts` (гард startPhase ~113, startPrompt ~160, startResume ~195, spawnQwenRun ~286, phaseFlags ~396), `src/agent/session.ts` (agentSessionsDir/loadSessionMetaSync/SessionMeta {taskId, phase, cwd}), `src/bot/commands.ts` (extractAgent ~377, parsePromptCommand ~415), `src/bot/handlers.ts` (prompt-обработчик ~853-905, resume ~1163), `src/bot/registry.ts` (BOT_COMMANDS — 18 команд), `src/cli/router.ts`, `src/agent/cli.ts` (isPhaseMode ~230), шаблоны `prompt.md`/`phase-comment.md`.

### 1. templates/qwen-commands/phase-analyze.md (НОВЫЙ)

Заголовок: «Ты — автоматический исполнитель Vibelog (Фаза Analyze: разбор сессии агента)». Подстановки: {{sessionId}}, {{taskId}} (пусто, если меты нет), {{sessionPhase}}, {{sessionCwd}}, {{sessionPath}} = `.vibelog/agent-sessions/{{sessionId}}.jsonl`.

Детерминированный протокол (повтор ручного цикла VL-98/113/117/134/122/137):
1. **Шаг 1 — статистика**: один node-скрипт (`node -e` / `node --input-type=module -e`; ЗАПРЕТ python/perl/awk/jq) по {{sessionPath}}: длительность (старт — ms-epoch из ID сессии `agent-(\d+)`, конец — mtime jsonl), прогоны по «Продолжи» (user-сообщения), wall-убийства («Превышен лимит --max-wall-time» в content), «Пустой ответ модели», NaN-индексы («Неверный индекс: NaN»), профиль tool-вызовов по именам (assistant.tool_calls[].name), топ-10 tool-выводов по длине (role='tool', имя через tool_call_id), чтения/правки по файлам (path из аргументов read_file/edit/write_file/grep/glob).
2. **Шаг 2 — вердикт**: объём задачи (мета {{taskId}}/{{sessionPhase}}; при пустой мете — backlog_view_task не нужен, читать через MCP только если taskId есть) vs тупик/расточительство; количественные выводы из статистики.
3. **Шаг 3 — рекомендации**: сначала backlog_search — не заведена ли уже задача на найденную проблему; ссылки на существующие VL; новых задач НЕ создавать.
4. Экономия ходов; Финал — одно слово «Готово».

### 2. src/web/phase-prompt.ts

- Строка 19: `PHASES` += `'analyze'`.
- Строки 23-30: `PHASE_FILES` += `analyze: 'phase-analyze.md'`.
- Строка 64 (текст ошибки «ожидается …») += `analyze`; JSDoc renderPrompt — упомянуть analyze.

### 3. src/web/orchestrator.ts

- Гард startPhase (строки 113-115): ОТДЕЛЬНЫМ if — `if (phase === 'analyze') return { error: 'Фаза analyze запускается через startAnalyze' };` (текст prompt-гарда не менять — orchestrator.test матчит /startPrompt/). Закрывает HTTP API (api.ts передаёт произвольный phase).
- После startPrompt (~175) — новый экспорт `startAnalyze(cwd, sessionRef, onExit?, agent = 'qwen'): StartResult`:
  - нормализация `sessionRef.replace(/^vb:/, '')`, валидация `/^agent-\d+$/` → иначе `{ error: 'Некорректный session-ref: … (ожидается vb:agent-XXX или agent-XXX; анализ только для сессий vibelog-agent)' }` (qwen-UUID не пускаем — jsonl-транскрипта нет);
  - `existsSync(join(agentSessionsDir(cwd), bare + '.jsonl'))` → нет → `{ error: 'Сессия не найдена: …' }`;
  - `meta = loadSessionMetaSync(agentSessionsDir(cwd), bare)` (null допустим);
  - `prompt = renderPrompt('analyze', meta?.taskId ?? '', { sessionId: bare, sessionPhase: meta?.phase ?? '(неизвестна)', sessionCwd: meta?.cwd ?? '(неизвестен)', sessionPath: '.vibelog/agent-sessions/' + bare + '.jsonl' })`; если `meta?.taskId` — дописать `'\n\n' + taskBlockText(cwd, meta.taskId)` (компакт-блок задачи для вердикта);
  - `return spawnQwenRun(cwd, 'analyze-' + bare, 'analyze', prompt, onExit, agent);` — runKey из ТЗ; не матчит taskIdPattern → worktree не трогаем, запуск из главного cwd (jsonl в главном репо, VL-107-fix) — зафиксировать комментарием.
- phaseFlags (~396): `phase === 'spec' || phase === 'plan'` → `… || phase === 'analyze'` — qwen получает `--allowed-mcp-server-names vibelog` (нужен backlog-MCP для рекомендаций; у vb флаг игнорируется — безвреден).

### 4. src/bot/commands.ts

После parsePromptCommand (~425):
- `export interface AnalyzeCommand { sessionId: string; agent?: AgentName }` (sessionId — голый `agent-XXX`).
- `export function parseAnalyzeCommand(text, commandWord = ''): AnalyzeCommand | { error: string }`: `extractAgent('analyze', commandWord, text, hint)` (суффикс [:agent] как у prompt) → regex `/^(?:vb:)?agent-\d+$/` на остаток → `{ sessionId }` (vb: снять); hint `Синтаксис: /analyze[:agent] vb:agent-<id> (префикс vb: необязателен)`; UUID → тот же error.

### 5. src/bot/handlers.ts

- Импорты: + `parseAnalyzeCommand` (блок ~56), + `startAnalyze` (строка 46).
- После prompt-блока и его hears-фолбэка (~905), ДО /restart: `bot.command(['analyze', 'analyze:qwen', 'analyze:vb'], …)`: requireBind → parse (error → sendMd) → onExit = sendPhaseResult(bot, chatId, run) (без карточки, как prompt) → `agent = parsed.agent ?? resolveDefaultAgent(deps.cwd)` → `startAnalyze(deps.cwd, parsed.sessionId, onExit, agent)` → error → `⚠️ escapeMarkdownV2(…)`; успех → `🔬 Анализ сессии запущен (PID N)`.
- Расширить hears-фолбэк `^\/(spec|plan|code|close|comment):(\S+)` (~900) — `+|analyze`. Регистрация всех bot.command — до catch-all `message:text` (~1180).

### 6. src/bot/registry.ts

В BOT_COMMANDS после `prompt` (строка 43):
`{ command: 'analyze', description: 'Анализ сессии агента — статистика, вердикт, рекомендации: /analyze vb:agent-XXX', usage: '/analyze[:agent] <session-ref>' }`.
commandsHelp() и /start пересоберутся автоматически.

### 7. CLI-паритет: vibelog agent analyze <session-ref>

- **НОВЫЙ src/cli/commands/agent.ts**: `export async function runAgent(subcommand, positional, flags, cwd)`:
  - subcommand !== 'analyze' → printError «Неизвестная подкоманда agent: … (доступна: analyze)», exitCode=1;
  - нет positional[0] → printError «Синтаксис: vibelog agent analyze <session-ref>», exitCode=1;
  - агент — `resolveDefaultAgent(cwd)` (src/bot/settings.ts, без grammy);
  - `await new Promise(resolve => { const res = startAnalyze(cwd, ref, run => { печать статуса + (run.result?.result ?? logTail); resolve(); }, agent); if ('error' in res) { printError(res.error); exitCode = 1; resolve(); } else console.log('🚀 Фаза analyze запущена, PID ' + res.pid); })` — ждём onExit, иначе процесс CLI завершится раньше агента.
- **src/cli/router.ts**: `case 'agent': return runAgent(subcommand, positional, flags, cwd);` (~104); строка в showHelp (~126): `agent analyze <ref>       Анализ сессии агента (статистика/вердикт)`; запись `agent:` в helpTexts showCommandHelp.
- **src/agent/cli.ts** (~234, после проверки resume+isPhaseMode): `if (isPhaseMode && positionals[0] === 'analyze')` → error «analyze запускается через vibelog agent analyze <session-ref>» — иначе `vibelog-agent analyze <taskId>` отрендерит шаблон без {{sessionId}}.

### 8. Тесты

- **src/bot/commands.test.mjs**: parseAnalyzeCommand — `vb:agent-123` → `agent-123`; `agent-123` без префикса; суффикс `:vb`/`:qwen` → agent; пусто / `VL-1` / qwen-UUID → error с hint.
- **src/bot/registry.test.mjs**: длина 18 → **19** (строка 13); точная help-строка commandsHelp (~89) — вставить `/analyze[:agent] <session-ref>` между `/prompt…` и `/restart`; новый it: usage/описание analyze.
- **src/web/orchestrator.test.mjs**: startAnalyze — (а) спавн заглушки (setSpawnEnvBaseForTests, VL28_STUB_MARKER): argv промпта содержит sessionId, нет неподставленных {{…}}; (б) guard: повторный startAnalyze той же сессии → «Запуск уже выполняется», разные сессии параллельны; (в) нет jsonl → «Сессия не найдена»; (г) битый ref → error; (д) startPhase(phase='analyze') → error «…startAnalyze» (по образцу теста prompt ~722).
- **src/cli/cli.test.mjs**: импорт runAgent + setSpawnEnvBaseForTests: `testDir/.vibelog/agent-sessions/agent-123.jsonl` (+ meta.json) → runAgent('analyze', ['vb:agent-123'], {}, testDir) со стаб-бином → capture содержит PID/хвост лога; негативы: нет аргумента, несуществующая сессия → ошибка. finally → setSpawnEnvBaseForTests(null).
- Опционально src/web/phase-prompt.test.mjs: renderPrompt('analyze', …) — нет {{sessionId}}, есть протокол.

### 9. Документация

- **README.md** (строка 224): в список команд бота добавить `/analyze`; пример `vibelog agent analyze vb:agent-XXX`.
- **CHANGELOG.md** [Unreleased]: запись VL-141.

### Порядок действий

phase-analyze.md → phase-prompt.ts → orchestrator.ts (гард + startAnalyze + phaseFlags) → commands.ts → handlers.ts → registry.ts → cli/commands/agent.ts + router.ts + agent/cli.ts-гард → тесты → README/CHANGELOG → `pnpm build && pnpm test`.

### Как проверить

- `pnpm build` (tsc strict, чисто)
- `pnpm test` — зелёные, включая обновлённые registry.test (19 команд) и cli.test
- `pnpm lint` (node --check bin)

### Риски

- registry.test — точное сравнение help-строки и длины: править синхронно с реестром.
- Гард startPhase: не сломать тест «phase=prompt → …startPrompt» — analyze-гард отдельным if.
- runKey `analyze-<id>` не матчит taskIdPattern → в branch-mode анализ идёт из главного cwd — это корректно (jsonl в главном репо), отметить комментарием.
- CLI await onExit: при ENOENT бинаря child 'error' → finish(null) → onExit вызовется — зависания нет.
- grammy: регистрация массивом ['analyze','analyze:qwen','analyze:vb'] по паттерну prompt; неизвестный суффикс — hears-фолбэк.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 21:20
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: ~12 файлов. Состав: (1) новый шаблон templates/qwen-commands/phase-analyze.md — детерминированный протокол: node-скрипт статистики jsonl (длительность из ms-epoch ID сессии + mtime, прогоны «Продолжи», wall-убийства, «Пустой ответ модели», NaN-индексы, профиль tool-вызовов, топ tool-выводов, чтения/правки по файлам) → вердикт → рекомендации с проверкой backlog_search и ссылками на существующие VL, финал «Готово»; (2) phase-prompt.ts: PHASES/PHASE_FILES += analyze; (3) orchestrator.ts: отдельный гард startPhase('analyze') + новый startAnalyze(sessionRef → нормализация vb:, валидация agent-N, existsSync jsonl, loadSessionMetaSync → подстановки sessionId/фаза/cwd, taskBlockText, spawnQwenRun с runKey analyze-<sessionId>) + analyze в phaseFlags (--allowed-mcp-server-names vibelog); (4) commands.ts: parseAnalyzeCommand на extractAgent + regex (vb:)?agent-\d+; (5) handlers.ts: bot.command(['analyze','analyze:qwen','analyze:vb']) по паттерну prompt + hears-фолбэк; (6) registry.ts: запись в BOT_COMMANDS (18→19); (7) CLI: новый src/cli/commands/agent.ts (await onExit, печать результата) + case 'agent' в router + help + гард в agent/cli.ts; (8) тесты: commands.test, registry.test (длина+help-строка), orchestrator.test (спавн/guard/ошибки/гард startPhase), cli.test (позитив+негативы); (9) README + CHANGELOG. Риски: точная help-строка registry.test правится синхронно; analyze-гард отдельным if (не ломать тест prompt); runKey не матчит taskIdPattern → запуск из главного jsonl-репо (корректно, отмечено).
---
author: @agent
created: 2026-10-13 22:25
---
Фаза 3 (Code) выполнена. Изменено: templates/qwen-commands/phase-analyze.md (новый), src/web/phase-prompt.ts, src/web/orchestrator.ts, src/bot/commands.ts, src/bot/handlers.ts, src/bot/registry.ts, src/cli/commands/agent.ts (новый), src/cli/router.ts, src/agent/cli.ts, тесты (commands.test, registry.test, orchestrator.test, cli.test, phase-prompt.test), README.md. Коммит 6a1a962 (ветка vb/vl-141).
Реализация по плану: (1) шаблон phase-analyze.md — детерминированный протокол: node-скрипт статистики jsonl (длительность из ms-epoch ID сессии + mtime, прогоны «Продолжи», wall-убийства, «Пустой ответ модели», NaN-индексы, профиль tool-вызовов, топ-10 tool-выводов, чтения/правки по файлам) → вердикт → рекомендации с backlog_search и ссылками на существующие VL, без создания новых задач, финал «Готово»; (2) analyze в PHASES/PHASE_FILES; (3) startAnalyze: нормализация vb:, валидация agent-\d+ (qwen-UUID отклоняется), existsSync jsonl, мета сессии (taskId/фаза/cwd) → подстановки, taskBlockText при taskId, runKey analyze-<sessionId> (не матчит taskIdPattern → запуск из главного cwd, jsonl там же — отмечено комментарием); отдельный гард startPhase('analyze') (prompt-гард не тронут); analyze в phaseFlags (--allowed-mcp-server-names vibelog); (4) parseAnalyzeCommand на extractAgent + regex; (5) bot.command(['analyze','analyze:qwen','analyze:vb']) по паттерну prompt, до hears-фолбэка (расширен на analyze); (6) запись в BOT_COMMANDS (18→19); (7) CLI vibelog agent analyze: runAgent (await onExit, печать результата), case в router + обе help, гард в agent/cli.ts («analyze запускается через vibelog agent analyze»).
Проверки: pnpm build (tsc strict) чисто; pnpm test — 925 passed / 53 файла (новые тесты: parseAnalyzeCommand — 7, registry — длина 19 + help-строка + запись analyze, startAnalyze — спавн/guard/нет сессии/битый ref/гард startPhase, runAgent — позитив со стаб-бином + негативы, шаблон analyze); pnpm lint чисто.
Что осталось: AC-5 не отмечен целиком — README и зелёные тесты сделаны, но запись CHANGELOG.md в Фазе 3 НЕ делал по правилам Фазы 3 (VL-126: итоговую документацию пишет Фаза Close после слияния) — Close добавит запись [Unreleased]. DoD-2 («Документация обновлена») оставлен открытым по той же причине (README/CLI-help обновлены, CHANGELOG нет).
---
author: @agent
created: 2026-10-13 22:34
---
Фаза Close выполнена. Ветка vb/vl-141 слита в master (1 коммит 6a1a962, merge --no-ff), после слияния pnpm build и pnpm test зелёные; worktree .vibelog/worktrees/vl-141 удалена (force — только untracked-симлинки node_modules/refs), ветка vb/vl-141 удалена. Документация: добавлена запись [Unreleased] в CHANGELOG.md (коммит a15da7a «docs: VL-141 — документация и CHANGELOG»; README обновлён в ветке и слит). DoD: 1 (тесты проходят — 925 passed / 53 файла после merge), 2 (документация обновлена — README + CHANGELOG), 3 (нет регрессий) — выполнены. AC-5 отмечен: README/CLI-help упоминают команду, pnpm test зелёный, запись CHANGELOG добавлена.
---
<!-- COMMENTS:END -->