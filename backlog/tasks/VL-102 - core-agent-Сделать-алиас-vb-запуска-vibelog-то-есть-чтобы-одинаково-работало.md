---
id: VL-102
title: Алиас vb для vibelog + запуск TUI агента по умолчанию (без флагов)
status: Planned
assignee: []
reporter: ''
created_date: '2026-10-06 02:42'
updated_date: '2026-10-06 09:05'
due_date: ''
labels:
  - core
  - agent
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
#core #agent Сделать алиас vb запуска vibelog, то есть чтобы одинаково работало например так:
vibelog --help
vb --help

сделать запуск TUI агента сразу через vibelog (или vb), если отсутствуют какие-то флаги запуска
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Алиас vb зарегистрирован (package.json bin) и после установки vb --help выводит то же самое, что vibelog --help
- [ ] #2 Запуск vibelog или vb без аргументов и флагов напрямую открывает TUI агента (не показывает пустой вывод или ошибку)
- [ ] #3 Существующие команды и флаги (task list, --help и т.д.) продолжают работать без изменений; алиас vb документирован в README/CLI-инструкциях
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-102 — алиас vb + дефолтный TUI агента

## Контекст (что есть сейчас)
- `package.json` bin (строки 6–9): `vibelog`, `vibelog-agent` — алиаса `vb` нет.
- `bin/vibelog.mjs` → `dist/cli/router.js` `route()`; в `src/cli/router.ts:52-55` при пустом command всегда `showHelp()` — TUI агента не запускается.
- TUI агента (`src/agent/tui.tsx`, `renderTui`) — только дисплей стрима loop, **без ввода** (комментарий ~строка 224: «Ввод TUI не нужен»). Запускается из `src/agent/cli.ts` `main()` (VL-85/86); позиционные аргументы обязательны (`cli.ts` ~157: throw «Не заданы позиционные аргументы»).
- Готовые к переиспользованию куски: `runLoop` (loop.ts), `McpClient.create`, `buildSystemPrompt`, `session.ts` (VL-95), `listLocalTools`, `createLlmClient`.

## Архитектурные решения
1. **Алиас `vb` = тот же файл** `./bin/vibelog.mjs` (единая точка входа, поведение не зависит от имени argv[0]).
2. **Дефолтный TUI = новый entry** `runInteractiveAgent()` в новом `src/agent/interactive.ts`. `main()`/JSON-контракт VL-63 **не трогаем** — оркестратор и бот (VIBELOG_QWEN_BIN) не задеты.
3. **Интерактивный режим = multi-turn чат**: ввод в TUI (`useInput` из ink, экспортируется в ink 7) → `runLoop` с накопленной историей → ответ стримится → сессия сохраняется после каждого хода (VL-95, `saveSession`).
4. **Роутер вызывает TUI-режим только при полностью пустом argv И TTY** (stdout+stdin). В не-TTY (скрипты, CI, тесты) — справка как сейчас. `vibelog help` / `--help` не меняются (AC3).

## Файлы и правки
1. **`package.json`** (строки 6–9): в bin добавить `"vb": "./bin/vibelog.mjs"`.
2. **`src/agent/tui.tsx`**:
   - store: поля `input: string`, `busy: boolean` (обновление через существующий `store.update`);
   - в `AgentApp` — компонент строки ввода через `useInput` (импорт из `ink`): печатаемые символы → append (лимит ~500 символов), Backspace → удалить, Enter → `onSubmit(input)` + очистка, Ctrl+C/Ctrl+D → `onExit`; при `busy=true` ввод игнорируется (показ «⏳ выполняется… Ctrl+C — выход»);
   - строка ввода рендерится внизу TUI: `> {input}_`;
   - новый экспорт `renderInteractiveTui(options: { onSubmit, onExit, sessionId })` → `InteractiveTuiHandle extends TuiHandle` с методом `setBusy(busy: boolean)`; хедер TUI — «vibelog-agent · сессия <sessionId>»;
   - существующий `renderTui()` **не меняем** (нужен оркестратору).
3. **`src/agent/interactive.ts`** (новый) — `runInteractiveAgent(): Promise<void>`:
   - проверки env (`VIBELOG_LLM_API_KEY`, `VIBELOG_LLM_MODEL`) — как в `cli.ts` (~222-237): понятная ошибка в stderr + exit 1 (до рендера TUI);
   - `createLlmClient()`, `listLocalTools(cwd)`, `McpClient.create({ cwd })` (отказ MCP — предупреждение, чат без MCP; паттерн `cli.ts` ~266-280), `buildSystemPrompt(cwd)`, `createSessionId()`;
   - рендер `renderInteractiveTui`; SIGINT-хэндлер: `tui.unmount()`, закрыть MCP, exit 130 (паттерн `cli.ts` 284-301);
   - цикл: `setBusy(true)` → `messages = [system, ...history, {role:'user', text}]` → `runLoop({ llm, messages, tools, externalTools, onToken/onToolStart/onToolEnd/onUsage/onError → tuiHandle, signal })` → `history = result.messages без system` → `saveSession(sessionsDir, sessionId, result.messages)` (ошибка записи — предупреждение) → `setBusy(false)`;
   - `onExit`: `tui.unmount()`, закрыть MCP, exit 0.
4. **`src/cli/router.ts`**:
   - строки 52-55: разбить `if (!command || command === 'help')`:
     - `args.length === 0 && process.stdout.isTTY && process.stdin.isTTY` → `const { runInteractiveAgent } = await import('../agent/interactive.js'); return runInteractiveAgent();` (динамический импорт — ink/react не грузятся в headless-путях);
     - иначе (нет команды или `help`, или не-TTY) → `showHelp()`;
   - `showHelp()` (~104): добавить строку про алиас `vb` и «без аргументов — интерактивный TUI агента»;
   - обновить док-комментарий шапки файла (список команд).
5. **Тесты**:
   - `src/cli/cli.test.mjs`: (а) чтением `package.json` — `bin.vb === './bin/vibelog.mjs'`; (б) subprocess `node bin/vibelog.mjs` без аргументов (stdio pipe = не-TTY) → вывод содержит «Vibelog.md»/справку, exit 0, не зависает (timeout 5s в `run()`);
   - `src/agent/interactive.test.mjs` (новый): юнит чистого помощника — выделить в `interactive.ts` экспорт `composeTurnMessages(system, history, userText): ChatMessage[]` и проверить порядок/отсутствие system-дублей;
   - `scripts/npm-smoke.mjs`: после строки 95 — `check('бин vb создан', existsSync(join(installDir, 'node_modules', '.bin', 'vb')))`; после строки 100 — `vb --help` == `vibelog --help` (сравнение выводов).
6. **Документация**:
   - `README.md` (Установка / Быстрый старт ~16-90): алиас `vb`, «`vb` без аргументов — интерактивный чат с агентом»;
   - `docs/cli-reference.md` (раздел `## vibelog-agent` ~242 и «Глобальные флаги» ~255): дефолтный запуск TUI через `vibelog`/`vb` без аргументов (TTY), алиас vb;
   - `docs/agent.md` (§3 «Запуск» ~74): синтаксис `vibelog`/`vb` (без аргументов) — multi-turn TUI-чат, сессии сохраняются после каждого хода; в не-TTY — справка;
   - `CHANGELOG.md`: запись (алиас vb + дефолтный TUI-чат).

## Порядок действий
1. package.json (bin.vb).
2. tui.tsx: input/busy в store + строка ввода + `renderInteractiveTui`.
3. interactive.ts: env-проверки, MCP, цикл чата, `composeTurnMessages`.
4. router.ts: ветка пустого argv + showHelp + комментарий.
5. Тесты (cli.test.mjs, interactive.test.mjs, npm-smoke.mjs).
6. Документация (README, cli-reference, agent.md, CHANGELOG).
7. Проверки (см. ниже).

## Проверки
- `pnpm build` (tsc strict, .tsx компилируется — jsx настроен в tsconfig).
- `pnpm test` (= build + `node --test src`).
- `node bin/vibelog.mjs --help` и `node bin/vibelog.mjs help` → справка (регресс AC3).
- `node bin/vibelog.mjs < /dev/null` (не-TTY) → справка, exit 0, без зависания.
- `node scripts/npm-smoke.mjs` — бин `vb` создан, `vb --help` идентичен `vibelog --help`.
- Ручной TTY-прогон: `node bin/vibelog.mjs` в терминале → TUI, ввод сообщения, ответ стримится, Ctrl+C выходит; сессия появляется в `.vibelog/agent-sessions/*.jsonl`; MCP-инструменты доступны (шапка/лог подключения).

## Риски
1. **Ввод в TUI поверх alt-буфера stderr**: `useInput` читает stdin независимо от stdout рендера — ожидаемо работает, но проверить вручную в терминале (автотест TTY невозможен).
2. **Смена дефолта «пустой запуск = help»** на TUI в TTY-окружении: скрипты, привыкшие к help при пустом argv, получат TUI. Компенсация: не-TTY → help как раньше, `vibelog help` работает; зафиксировать в CHANGELOG.
3. **Отказы в интерактивном режиме**: нет env-ключей → ясная ошибка до рендера (exit 1); отказ MCP → предупреждение и чат без MCP (паттерн main); SIGINT во время хода может потерять транскрипт хода — компенсируется сохранением сессии после каждого хода.
4. **Регрессия контракта оркестратора VL-63**: нестрашна по построению — `main()` и `renderTui()` не меняются, interactive-режим изолирован в новом модуле.
5. **История чата растёт в памяти** — v1 безлимитно, лимит не входит в AC (можно позже добавить --max-turns).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 02:43
---
Фаза 1 (Spec) выполнена. Масштаб: task. Уточнено: заголовок приведён к читаемому виду (алиас vb + запуск TUI агента по умолчанию), метки вынесены в labels [core, agent], добавлены 3 проверяемых критерия приёмки (идентичность vb/--help, TUI-запуск без флагов, отсутствие регрессий + документация алиаса). Постановка полная: цель (алиас vb и дефолтный запуск TUI агента при отсутствии флагов), контекст (удобство CLI) и критерии готовности определены. Вопросов нет.
---
author: @agent
created: 2026-10-06 09:05
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в VL-102 (implementationPlan): 6 файлов — package.json (bin.vb), src/agent/tui.tsx (строка ввода + renderInteractiveTui), новый src/agent/interactive.ts (runInteractiveAgent: multi-turn TUI-чат, env-проверки, MCP, сессии VL-95), src/cli/router.ts (ветка пустого argv при TTY → динамический импорт interactive), тесты (cli.test.mjs, interactive.test.mjs, npm-smoke.mjs — бин vb + vb --help), документация (README, docs/cli-reference.md, docs/agent.md, CHANGELOG). Ключевое решение: алиас vb = тот же bin/vibelog.mjs; main()/JSON-контракт VL-63 и renderTui не меняются — оркестратор и бот не затрагиваются; в не-TTY пустой запуск остаётся справкой (AC3). Риски: ввод в TUI поверх alt-буфера stderr (ручная проверка в терминале), смена дефолта «пустой запуск = help» в TTY-скриптах, SIGINT во время хода теряет транскрипт (компенсируется saveSession после каждого хода).
---
<!-- COMMENTS:END -->