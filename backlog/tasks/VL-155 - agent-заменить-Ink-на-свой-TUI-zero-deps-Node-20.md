---
id: VL-155
title: 'agent: заменить Ink на свой TUI (zero deps, Node 20)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 13:56'
updated_date: '2026-10-14 22:59'
due_date: ''
labels:
  - agent
  - core
dependencies: []
milestone: v1.8
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tui.ts
  - src/agent/tui.tsx
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - README.md
lessons:
  - lesson-1
  - lesson-2
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Ink 7 требует Node >=22 — warning EBADENGINE при установке на Node 20. Ink убрать полностью. TUI оставить, но переписать на чистом Node.js без React.

## Что переиспользуется без изменений

src/agent/tui-format.ts — весь файл (чистые функции, не зависят от Ink):
- formatToolArgs, formatToolCard, formatDuration, formatCounters, formatErrorBlock, formatUserMessage, assembleAssistantText.

Тесты tui-format.test.mjs — не трогаются, они уже проверяют всю логику.

## Что переписать

src/agent/tui.tsx → src/agent/tui.ts (чистый Node.js, без React):

Замена компонентов:
- <StreamText> → process.stderr.write(token) — дописывание без перерисовки
- <ToolCard> → stderr.write(formatToolCard(view) + '\n')
- <Counters> → stderr.write('\r\x1b[2K' + formatCounters(...))
- <ErrorBlock> → stderr.write(formatErrorBlock(lines).join('\n'))
- <ChatHistory> → stderr.write(entry.text + '\n')
- useInput → readline.createInterface или process.stdin.on('data')
- useSyncExternalStore → не нужен, состояние в переменных
- render(<AgentApp />) → не нужен, пишем в stderr напрямую
- store.update() → прямая запись в переменные + redraw()
- Тик раз в секунду → setInterval(() => redraw(), 1000)

Архитектура:
- redraw() — очищает экран (\x1b[2J\x1b[H) и пишет всё заново из состояния.
- Альтернативный буфер: \u001b[?1049h в начале, \u001b[?1049l при unmount.
- Стриминг: токены дописываются напрямую (без полной перерисовки), карточки/счётчики/ошибки — полная перерисовка.
- Ввод (renderInteractiveTui): readline.createInterface, эхо отключено, redraw контролирует вывод. Ctrl+C/Ctrl+D — onExit.

## Что удалить

- Из dependencies: ink, react.
- Из devDependencies: @types/react.
- Из tsconfig: jsx: react-jsx, jsxImportSource: react (если больше не нужны).

## Что проверить

- headless-фазы (spec/plan/code/close/comment) — не используют TUI, работают без изменений.
- TUI работает: стриминг, карточки tool calls, счётчики, ввод (интерактивный чат).
- pnpm test без регрессий (tui-format тесты не меняются).

## AC

- dependencies не содержит ink/react
- src/agent/tui.ts — чистый Node.js, без React
- src/agent/tui-format.ts — без изменений
- headless-фазы работают
- TUI работает (стриминг, карточки, счётчики, ввод)
- pnpm test без регрессий
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Из dependencies убраны ink и react; из devDependencies убран @types/react
- [x] #2 src/agent/tui.tsx переписан на src/agent/tui.ts (чистый Node.js, ANSI, без React)
- [x] #3 src/agent/tui-format.ts не изменён (чистые функции переиспользуются)
- [x] #4 StreamText, ToolCard, Counters, ErrorBlock, ChatHistory, InputLine заменены на нативные аналоги
- [x] #5 redraw() очищает экран и пишет состояние; альтернативный буфер работает
- [x] #6 Headless-фазы (spec/plan/code/close/comment) работают без изменений
- [x] #7 pnpm test без регрессий (tui-format.test.mjs не меняется)
- [x] #8 Документация обновлена (docs/agent.md, README — упоминание zero deps)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: заменить Ink на собственный TUI (zero deps, Node 20)

## Контекст

- `src/agent/tui.tsx` (486 строк) — единственный `.tsx` в проекте, единственный потребитель react/ink. Импорты снаружи: `cli.ts:35` (`TuiHandle`), `cli.ts:436-437` (динамический `renderTui`), `interactive.ts:30-31,180` (`renderInteractiveTui`) — все через `'./tui.js'`, после переименования в `.ts` импорты МЕНЯТЬ НЕ НАДО (NodeNext сам маппит на `.js`).
- `src/agent/tui-format.ts` (107 строк) — чистые функции, переиспользуются как есть: formatToolArgs, formatToolCard, formatDuration, formatCounters, formatErrorBlock, formatUserMessage, assembleAssistantText. Тесты `tui-format.test.mjs` не трогаем.
- `docs/agent.md` не существует — документация агента живёт в `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` (упоминается в README:26,51,214) и в `README.md`. AC8 закрываем ими.

## Файлы для изменения

1. **`src/agent/tui.tsx` → удалить; создать `src/agent/tui.ts`** (переписать, ~350-400 строк, чистый Node.js).
2. **`package.json`** — строка 37 `@types/react` (devDeps), строки 43-44 `ink`, `react` (deps) — удалить.
3. **`tsconfig.json`** — удалить `"jsx": "react-jsx"` и `"jsxImportSource": "react"` (tui.tsx — единственный jsx-файл).
4. **`README.md`** — абзац про агента (~строка 214): добавить «TUI на чистом Node.js, zero deps (без Ink/React), работает на Node 20».
5. **`backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`** — через `document_update` MCP: секция про TUI/зависимости (zero deps, свой ANSI-рендер).

## Архитектура src/agent/tui.ts

Контракт публичного API НЕ меняется: `TuiHandle`, `InteractiveTuiHandle`, `renderTui()`, `renderInteractiveTui(options)` — те же сигнатуры, те же колбэки loop.

### Переиспользуем из tui.tsx почти как есть (строки 33-118)
- Константы: CHAT_VISIBLE=30, TOOL_CARDS_VISIBLE=8, ERRORS_VISIBLE=5, INPUT_MAX_CHARS=500. STREAM_TAIL_LINES=10 — оставить для отрисовки хвоста стрима при redraw.
- Интерфейсы ToolCardState, ChatEntry, TuiState — без изменений.
- `createStore()` — упростить: убрать listeners/subscribe, `update(patch)` пишет в переменную и вызывает внешний колбэк `onUpdate` (задаётся при сборке TUI): «прямая запись в переменные + redraw()» из описания задачи.

### Цвета — ANSI-константы (заменяют `<Text color=...>`)
```
const CYAN='\x1b[36m', GREEN='\x1b[32m', YELLOW='\x1b[33m', RED='\x1b[31m', MAGENTA='\x1b[35m', BLUE_BOLD='\x1b[1;34m', RESET='\x1b[0m';
```
Применять только при `process.stderr.isTTY` (вне TTY — голый текст).

### Компоненты → функции-строки (по описанию задачи)
- `StreamText` (121-140) → не нужен как redraw-блок: токены дописываются напрямую: `onToken` → `store.update({stream}, {redraw:false})` + `out.write(token)` (cyan). State.stream обновляется, чтобы redraw перерисовал стрим из состояния.
- `ChatHistory` (141-161) → `renderChatHistory(state): string[]` — formatUserMessage(text) cyan / text белый, лимит CHAT_VISIBLE, пустые пропуск.
- `ToolCard` (162-177) → входит в `redraw()`: `formatToolCard(view)` с цветом статуса (pending=yellow «текущая» длительность `now-startedAt`, ok=green, error=red) — логика 168-171 строка в строку.
- `Counters` (178-202) → `formatCounters(...)` magenta, аргументы те же (turn/usage/elapsedMs).
- `ErrorBlock` (203-216) → `formatErrorBlock(errors.slice(-ERRORS_VISIBLE))` red.
- `InputLine` (225-282) → `renderInputLine(state): string` — busy: «⏳ выполняется… Ctrl+C — выход» yellow; иначе `> ${input}_` green. Отрисовывается только нижняя строка: `out.write('\r\x1b[2K' + line)`.

### redraw() — ядро (заменяет AgentApp 284-326 и render)
```
function redraw(): void {
  out.write('\x1b[2J\x1b[H');           // очистить экран + курсор в начало
  const lines: string[] = [];
  if (header) lines.push(BLUE_BOLD + header + RESET);
  lines.push(...renderChatHistory(state));
  lines.push(MAGENTA + formatCounters({...}) + RESET);
  lines.push(...streamTail(state));      // cyan, хвост STREAM_TAIL_LINES строк
  lines.push(...toolCards(state, now));  // последние TOOL_CARDS_VISIBLE
  lines.push(...formatErrorBlock(...));  // red
  if (interactive) lines.push(renderInputLine(state));
  out.write(lines.join('\n') + '\n');
}
```
Тик: `setInterval(() => redraw(), 1000)` — обновляет время фазы и pending-длительности (замена setTick 297-303). Интервал — в переменной, clearInterval в unmount.

### buildHandle (347-431) — та же логика, другой эффект
- onToken: state + прямая запись (без redraw) — стриминг без перерисовки.
- onToolStart/onToolEnd/onUsage/onError/finishTurn: логика 356-425 строка в строку (chunks/tools/started Map/cardSeq/messages), но `store.update(patch)` → redraw().
- unmount: clearInterval; если интерактив — stdin.setRawMode(false) + rl.close(); если altBuffer — `out.write('\u001b[?1049l')`.

### renderTui (433-442)
Альтернативный буфер при isTTY: `out.write('\u001b[?1049h\u001b[2J\u001b[H')`, собрать store+redraw, начальный redraw(), вернуть buildHandle. Без stdin-обработчиков (как и сейчас: Ctrl+C обрабатывает cli).

### renderInteractiveTui (459-486)
Как renderTui + ввод. Используем **process.stdin raw mode** (разрешено описанием: «readline.createInterface ИЛИ process.stdin.on('data')» — raw mode надёжнее для посимвольного ввода):
- `process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData)` — без stdin.resume() data-события не приходят.
- onData(buf): посимвольный разбор как в старом useInput (236-266):
  - `\u0003` (Ctrl+C) / `\u0004` (Ctrl+D) → onExit() — всегда, не зависит от busy;
  - `\r`/`\n` → Enter: busy-проверка, trim, непустой → messages+msgSeq (логика 245-255), onSubmit(text); пустой → очистка input; redrawInputLine();
  - `\u007f`/`\u0008` → Backspace: `Array.from(input).slice(0,-1).join('')` (суррогатные пары!);
  - печатаемые: strip `[\u0000-\u001f\u007f]`, склейка, cap INPUT_MAX_CHARS;
  - после изменения input — перерисовать только нижнюю строку.
- setBusy(busy) — store.update + redrawInputLine() (без полного redraw, чтобы не дёргать экран на каждый вызов loop).
- shorthandle: `{...buildHandle(...), setBusy}` — как сейчас.

Полный redraw при вводе тоже допустим (redraw() перерисует и input) — но prefer redrawInputLine для отзывчивости.

## Порядок действий

1. Создать `src/agent/tui.ts` по архитектуре выше.
2. Удалить `src/agent/tui.tsx`.
3. `package.json`: убрать ink, react, @types/react.
4. `tsconfig.json`: убрать две jsx-строки.
5. `pnpm install` (проверить: нет EBADENGINE на ink), `pnpm build`.
6. Обновить README.md и doc-10 (MCP document_update).
7. `pnpm test`.

## Проверка

```bash
pnpm install        # нет warning EBADENGINE про ink
pnpm build          # tsc собирает tui.ts без jsx
pnpm test           # vitest: tui-format.test.mjs не менялся, остальные без регрессий
node -e "import('./dist/agent/tui.js').then(m => console.log(Object.keys(m)))"  # renderTui, renderInteractiveTui
```
Ручная (после code-фазы): `vibelog task plan <id>` — headless-фаза работает (TUI не грузится, динамический импорт cli.ts:436 не срабатывает); `vibelog` в терминале — интерактивный TUI: стриминг, карточки, счётчики, ввод, Ctrl+C.

## Риски

1. **Ввод в raw mode** — stdin может быть не TTY (вызов renderInteractiveTui вне терминала): guard `process.stdin.isTTY`, иначе onExit сразу.
2. **Полный redraw очищает уже напечатанный стрим** — состояние stream/chunks в store полное, поэтому перерисовка идентична; проверить на длинном стриме, что нет «мигания»/потери текста.
3. **console.* перехват** — Ink имел patchConsole:false; наш TUI пишет в stderr напрямую, но console.log из библиотек может ломать кадр. В headless это не важно; в интерактиве — известное ограничение, документируем.
4. **setBusy + redrawInputLine** — если loop шлёт setBusy до первого redraw, нижняя строка может быть пустой: вызывать полный redraw() в setBusy, если экран ещё не рисовался (флаг initialized).
5. **Побочные эффекты переименования** — импорты уже через `./tui.js`, правки в cli.ts/interactive.ts не нужны; grep `\.tsx` после удаления должен вернуть пусто.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 16:36
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в VL-155: переписать src/agent/tui.tsx (486 строк, единственный .tsx и единственный потребитель react/ink) → src/agent/tui.ts на чистом Node.js (redraw() + альтернативный буфер + прямой стриминг токенов в stderr + raw-mode stdin для ввода), публичный API (TuiHandle/renderTui/renderInteractiveTui) без изменений — импорты в cli.ts/interactive.ts не трогаем. Файлов: 5 (tui.tsx удалить, tui.ts создать, package.json — убрать ink/react/@types/react, tsconfig.json — убрать jsx-строки, README + doc-10 через document_update). tui-format.ts и его тесты не меняются. Риски: raw-mode ввод вне TTY (guard по isTTY), мигание при redraw длинного стрима (state полный — проверить), console.* может ломать кадр (как и было с patchConsole:false). Проверка: pnpm install (нет EBADENGINE), pnpm build, pnpm test, ручной прогон TUI и headless-фаз.
---
author: @agent
created: 2026-10-14 17:40
---
Фаза 3 (Code) выполнена. Изменено: src/agent/tui.ts (новый, 471 строк — чистый Node.js: store на переменных, redraw() с \x1b[2J\x1b[H, альтернативный буфер \u001b[?1049h/l, стриминг токенов прямой записью в stderr без перерисовки, raw-mode stdin для ввода с guard по isTTY, тик setInterval 1с), src/agent/tui.tsx удалён; package.json (-ink, -react, -@types/react); pnpm-lock.yaml; tsconfig.json (-jsx, -jsxImportSource); README.md (+упоминание zero deps/Node 20). Коммит 0afc205. Проверки: pnpm install без EBADENGINE (offline, реестр недоступен — использован pnpm store); pnpm build (tsc без jsx) OK; pnpm test:fast — 1038 passed / 4 skipped / 0 failed (tui-format.test.mjs — 18 passed, не менялся); smoke headless: `vibelog task list --ready` работает; dist/agent/tui.js экспортирует renderTui/renderInteractiveTui. Публичный API TUI не менялся — cli.ts/interactive.ts не трогались. AC8 (документация): README обновлён; doc-10 в backlog/docs НЕ обновлялся по правилу VL-126 (backlog/docs пишет Фаза Close) — оставляю незакрытым. Ограничение: интерактивный TUI вживую не прогонялся (нет интерактивного терминала в сессии) — стриминг/карточки/ввод проверены статически и тестами tui-format; рекомендуется ручной smoke при Review: `vibelog` в терминале.
---
author: @agent
created: 2026-10-14 20:24
---
Фаза Close выполнена. Ветка vb/vl-155 слита в master (1 коммит 0afc205, merge 6b869a2), worktree удалена (force — только untracked-симлинки node_modules/refs), ветка удалена. Проверки после merge: pnpm install без EBADENGINE (ink/react/@types/react удалены), pnpm build OK, pnpm test — 0 failed. DoD: 1 (тесты проходят) и 3 (нет регрессий) подтверждены после merge; DoD 2 (документация) отмечен — doc-10 обновлён (TUI zero deps, снят вопрос версии Ink), README обновлён в Фазе 3, запись добавлена в CHANGELOG.md (Unreleased), docs-коммит 40878d9. Уроки: lesson-1 (вынос чистых функций форматирования при замене UI-библиотеки) и lesson-2 (ручной smoke интерактивного TUI) созданы и связаны с задачей. Ограничение: интерактивный TUI вживую не прогонялся (нет интерактивного терминала в сессии) — рекомендуется ручной smoke: vibelog в терминале (стриминг, карточки, счётчики, ввод, Ctrl+C).
---
<!-- COMMENTS:END -->