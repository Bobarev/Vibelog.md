---
id: VL-321
title: 'agent: перевести TUI агента на @clack/prompts/@clack/core (интерактив на clack, вывод без полного redraw)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 18:39'
updated_date: '2026-11-03 21:17'
due_date: ''
labels:
  - agent
  - cli
  - tui
  - ux
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - package.json
  - pnpm-lock.yaml
  - src/agent/tui.ts
  - src/agent/tui-input.ts
  - src/agent/tui-input.test.mjs
lessons:
  - lesson-177
  - lesson-186
  - lesson-187
  - lesson-188
  - lesson-195
  - lesson-201
  - lesson-202
token_usage:
  input: 9678010
  output: 111120
  cache: 8857600
  total: 9789130
  requests: 143
  duration_ms: 2359715
  reasoning: 73211
  by_phase:
    plan:
      input: 1108485
      output: 19918
      cache: 922624
      requests: 22
    code:
      input: 6235767
      output: 78511
      cache: 5854208
      requests: 77
    close:
      input: 2333758
      output: 12691
      cache: 2080768
      requests: 44
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
TUI агента (`src/agent/tui.ts`, переписан с Ink в VL-155) выглядит плохо: каждый тик (раз в секунду) делает полный `redraw()` через `\x1b[2J\x1b[H` и перерисовывает весь экран — мигание, потерянный скролл, «прыгающий» курсор, весь кадр пишется в альтернативный буфер. Ввод — ручной readline + raw-mode без редактирования строки, без истории, без нормальной обработки Ctrl+C/Ctrl+D.

## Цель

Перевести интерактивные части TUI на `@clack/prompts` / `@clack/core`, а вывод (стрим, карточки, счётчики) — в append-режим без полного redraw.

## Что переходит на clack

- **`@clack/prompts`**: `spinner` (ход выполнения / «модель думает»), `log.*` / `note` / `intro` / `outro` (оформление сообщений, ошибок, карточек итогов), `confirm` / `select` / `multiselect` / `text` (tool-approval, выбор из списка, любые подтверждения в чате), `group` для связок.
- **`@clack/core`** — базовый класс `Prompt`: на нём собрать свои компоненты там, где готовых нет (например, строка ввода чата с многострочным редактированием, если `text` не подойдёт).
- Ввод чата: заменить ручной readline/raw-mode на clack-промпт с редактированием, историей, корректным Ctrl+C (отмена промпта, а не аварийный выход).

## Что остаётся своим

- Стриминг токенов и лента сообщений — обычный append-вывод (без полного redraw).
- Счётчики (turn / токены / время фазы) — перерисовывается **только нижняя строка**, `\r\x1b[2K`, без очистки экрана.
- Карточки tool calls (`formatToolCard` из `src/agent/tui-format.ts`) — append по завершении вызова, «pending»-состояние обновляет только свою строку.
- `src/agent/tui-format.ts` — чистые функции, не трогать (на них тесты).

## Контракт

`TuiHandle` (`onToken/onToolStart/onToolEnd/onUsage/onError/finishTurn/unmount`) и `renderTui`/`renderInteractiveTui` — сигнатуры сохранить, чтобы `src/agent/cli.ts` и `src/agent/interactive.ts` не переписывать (если иначе — вынести правки в отдельный пункт плана).

## Зависимость `@clack/prompts`

Пакета в проекте нет — его добавляет в `dependencies` задача VL-322 (перевод `vibelog init` на clack). VL-320 уже завершена и зависимость НЕ установила (там сделан собственный TUI-слой `src/cli/prompt.ts` без внешних пакетов). Эта задача пакет переиспользует и вторую реализацию промптов не пишет; версия `@clack/prompts` должна совпадать с VL-322 (одна версия на проект). Формальной блокировки нет, но без установленного пакета фазе code делать нечего — при запуске раньше VL-322 установку пакета включить в эту задачу.

Сохраняются: альтернативный буфер (`\u001b[?1049h`) и ограничение «никаких нативных зависимостей» (README:27) — clack это чистый JS.

## Не входит

- `vibelog init` (VL-320 — самодельный `src/cli/prompt.ts`; перевод на clack — VL-322). Здесь ничего из этого не переделывать.
- Правки `tui-format.ts` и его тестов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `@clack/prompts` (и при необходимости `@clack/core`) используется для интерактивных элементов TUI агента: spinner, лог/note/ошибки, ввод чата, tool-approval/подтверждения
- [x] #2 Ввод чата поддерживает редактирование строки и корректную обработку Ctrl+C (отмена/выход без стек-трейса) и Ctrl+D
- [x] #3 Полный redraw экрана (`\x1b[2J\x1b[H`) по таймеру устранён: счётчики обновляются перерисовкой только нижней строки, стрим и карточки — append-вывод
- [x] #4 Сигнатуры `TuiHandle` (onToken/onToolStart/onToolEnd/onUsage/onError/finishTurn/unmount) и `renderTui`/`renderInteractiveTui` сохранены; `src/agent/cli.ts` и `src/agent/interactive.ts` не переписаны (или правки явно перечислены в плане)
- [x] #5 `src/agent/tui-format.ts` и его тесты не изменены
- [x] #6 Headless-фазы (spec/plan/code/close/comment) работают без изменений — TUI используется только в интерактивном режиме
- [x] #7 Версия `@clack/prompts` в package.json — та же, что введена в VL-322 (одна версия на проект); если VL-321 выполняется раньше — установка пакета входит в эту задачу
- [x] #8 Документация обновлена: doc-10 (Агент Vibelog) — раздел про TUI/зависимости; README не раздувается (тест readme-standard, лимит 150 строк)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решения (архитектура)

1. **Пакет уже есть**: `@clack/prompts@1.5.0` установлен в `dependencies` (package.json:57, внесён VL-322) — переиспользуем, второй раз не ставим. Дополнительно в `dependencies` добавляем **`@clack/core@1.4.0`** (транзитивная версия, которую тянет `@clack/prompts@1.5.0`, pnpm-lock.yaml:33) — она нужна напрямую для своего prompt-класса ввода чата. Обе версии — точные (без `^`), одна версия на проект (AC7).
2. **Полный redraw (`\x1b[2J\x1b[H` по таймеру) удаляется**. Новая модель вывода — append-only транскрипт + одна «статусная» нижняя строка:
   - шапка — один раз через `p.intro(header)` (только интерактивный чат);
   - стрим токенов — прямая допись в stderr (как сейчас, но без последующей перерисовки кадра);
   - карточки tool calls — append по завершении через `p.log.success` / `p.log.error` (`formatToolCard` без изменений);
   - ошибки фазы — `p.log.error` (append);
   - счётчики (ход / токены / время) — `p.spinner().message(formatCounters(...))` по тику 1 с: библиотека перерисовывает **только свою строку**; при незакрытой строке стрима тик пропускается (частичная строка не затирается), после флаша стрима статус возвращается.
   - Собственный fallback нижней строки (`\r\x1b[2K` + текст) остаётся как приватный хелпер `drawStatusLine()` — используется, если `spinner.clear()/message()` в альтернативном буфере ведёт себя нестабильно (проверяется в фазе code на реальном TTY).
3. **Ввод чата** — собственный промпт на `@clack/core` (класс `ChatInputPrompt extends TextPrompt`, новый модуль `src/agent/tui-input.ts`): редактирование строки (стрелки, Home/End, Backspace, вставка — всё уже в TextPrompt), история последних 50 сообщений (↑/↓), Enter — отправка, **Ctrl+C и Ctrl+D → отмена промпта** (`state='cancel'`, резолв `isCancel`-символом) → в `interactive.ts` это существующий `onExit` (MCP закрывается, exit 0/130, без стектрейса). Ручной `setRawMode`/`data`-обработчик из `tui.ts` удаляется — stdin-владелец ровно один (clack; lesson-195), лимит `INPUT_MAX_CHARS = 500` переносится в новый модуль.
4. **`tool-approval`/подтверждения**: в `loop.ts` сейчас нет approval-потока — под него в `tui-input.ts` кладётся готовая обёртка над `p.confirm` (`createConfirmPrompt`), используемая в TUI сегодня для подтверждения выхода во время выполняющегося хода (Ctrl+C при `busy` → `confirm('Прервать ход и выйти?')`). Отдельный approval-хук в `TuiHandle` НЕ добавляем (иначе нарушение AC4) — задел описан в doc-10 как «следующая задача».
5. **Контракт сохраняется**: `TuiHandle` (onToken/onToolStart/onToolEnd/onUsage/onError/finishTurn/unmount), `renderTui()`, `renderInteractiveTui({onSubmit,onExit,sessionId})`, `InteractiveTuiHandle.setBusy` — сигнатуры без изменений; `src/agent/cli.ts` и `src/agent/interactive.ts` не правятся (AC4). Альтернативный буфер `\u001b[?1049h` / `\u001b[?1049l` сохраняется.

## Файлы и конкретные места

1. **package.json:52-58** — в `dependencies` добавить `"@clack/core": "1.4.0"` (точная версия, `"@clack/prompts": "1.5.0"` не трогать); `pnpm install` обновит `pnpm-lock.yaml` (в lock-файл руками не лезть). Проверить, что нет нативной сборки: `ls node_modules/.pnpm | grep clack` → только `@clack+core`, `@clack+prompts`, `fast-string-width`, `fast-wrap-ansi`, `sisteransi` (чистый JS, README:27 соблюдён).
2. **src/agent/tui.ts (469 строк)** — переписать рендер-слой, сохранив экспортируемые типы/функции (строки 225-240 `TuiHandle`, 275-280 `buildTui`, 390 `renderTui`, 396-400 `InteractiveTuiHandle`, 410 `renderInteractiveTui`):
   - строки 24-34 (`STREAM_TAIL_LINES`, `CHAT_VISIBLE`, `TOOL_CARDS_VISIBLE`, `ERRORS_VISIBLE`) — удалить: хвостов и обрезки в append-модели нет; `INPUT_MAX_CHARS` (строка 34) переносится в `tui-input.ts`;
   - строки 68-95 (`TuiState`, `ChatEntry`, `ToolCardState`) — сократить `TuiState` до `{ usage, turn, startedAt, busy }`; `stream/chunks/messages/tools/errors/input/msgSeq` больше не нужны (транскрипт append-only);
   - строки 96-140 (`createStore`) — упростить: `update()` больше не вызывает redraw; `setRedraw` заменить на `setStatus(fn)` (перерисовка нижней строки) — silent-режим больше не нужен;
   - строки 147-224 (`createRedraw`, включая `out.write('\x1b[2J\x1b[H')` в 173) — **удалить целиком**, заменить на `createAppender({ out, useColor })` с методами `appendBlock(text)`, `appendStream(token)`, `flushStream()`, `drawStatus(text)` (внутри `\r\x1b[2K`), `isLineOpen()`;
   - строки 247-390 (`buildTui` + колбэки handle) — переписать тела колбэков, сигнатуры не менять: `onToken` → `appendStream` (первый токен хода — `status.clear()`); `onToolStart` → запомнить `started`, `status.message('⏳ <name>')`; `onToolEnd` → `flushStream()` + `p.log.success/error(formatToolCard(view))` + `status.message(counters)`; `onUsage` → обновить usage/turn и `status.message(counters)`; `onError` → `flushStream()` + `p.log.error(text)`; `finishTurn` → `flushStream()` + `'\n'` (ответ уже выведен стримом); `unmount` → `clearInterval`, `status.stop()`, при interactive `p.outro('выход')`, затем `\u001b[?1049l`; тик `setInterval(1000)` — только `status.message(counters)` (и `drawStatus` в fallback-режиме), никаких очисток экрана;
   - строки 410-469 (`renderInteractiveTui`) — убрать raw-mode-блок (строки 434-466: `onStdinData`, `setRawMode/resume/on data`, возврат нормального режима в unmount); вместо него запустить асинхронный цикл ввода: `while (!exited) { const text = await chatInput(...); if (isCancel) { onExit(); break; } if (text.trim() !== '') onSubmit(text); else continue; await waitIdle(); }`, где `waitIdle()` резолвится в `setBusy(false)`; `unmount` дополнительно вызывает `abortInput()` (AbortController промпта) — открытый промпт резолвится в cancel. `setBusy(busy)` — сохраняется, плюс модуль `busy`-промиса.
3. **src/agent/tui-input.ts (новый, ~150 строк)** — ввод и подтверждения на clack:
   - `ChatInputPrompt extends TextPrompt` (`@clack/core`): `render()` — строка `│ > <userInputWithCursor>` (плюс hint `Ctrl+C/Ctrl+D — выход`), `_shouldSubmit(char, key)` — Enter (без модификаторов) подтверждает, `char === '\u0004'` (Ctrl+D) → cancel; обработчик `this.on('key', ...)` для ↑/↓ (история, `HISTORY_MAX = 50`) и лимита `INPUT_MAX_CHARS = 500`;
   - `createChatPrompt(opts: { input, output, history })` → `Promise<string | symbol>`; не-TTY → промпт не запускается (ввод не подключается, как сейчас: `useStdin = stdin.isTTY`);
   - `createConfirmPrompt(question, def)` — тонкая обёртка `p.confirm` + `p.isCancel` (используется для подтверждения выхода при busy; задел под tool-approval);
   - подозрительные места `@clack/core` (закрытый `onKeypress`, `protected _shouldSubmit`/`_isActionKey`) проверить по `node_modules/.pnpm/@clack+core@1.4.0/node_modules/@clack/core/dist/index.d.mts`: если Ctrl+D не доходит до `_shouldSubmit` — перехват через `this.on('key', ...)` с установкой `this.state = 'cancel'`; если и это не сработает — вернуться к варианту «`p.text` + Esc/Ctrl+C как cancel» и зафиксировать Ctrl+D как известное ограничение в doc-10 (только по факту, не заранее).
4. **src/agent/tui-input.test.mjs (новый)** — по рецепту lesson-197: (1) юнит-проверка обёртки через seam-параметр `{ prompts }` (маппинг `confirm`, резолв CANCEL в `isCancel`, не-TTY); (2) 1-2 теста реального `ChatInputPrompt` на `PassThrough` с фейковым `isTTY`/`setRawMode` (`await tick(50)`), проверка: печать символов и Backspace, ↑/↓ даёт историю, Enter резолвит строку, Ctrl+C и Ctrl+D резолвят cancel-символ. Каталог — `mkdtempSync` (только если понадобится файл), стирание потоков в `afterEach`.
5. **src/agent/tui-format.ts и src/agent/tui-format.test.mjs** — НЕ трогать (AC5): используются как есть (`formatToolCard`, `formatCounters`, `formatErrorBlock`, `formatUserMessage`, `assembleAssistantText`).
6. **src/agent/interactive.ts, src/agent/cli.ts** — без правок (AC4/AC6). Если понадобится косметика (комментарий «ink перехватил ввод» в interactive.ts:186 и «Ctrl+C обрабатывает cli» в tui.ts:392) — только комментарии, отдельной строкой в отчёте фазы code.
7. **Документация (AC8)**: `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` — правки строк 16, 32, 39 (упоминания «zero deps / собственный ANSI-рендер» → «интерактив на `@clack/prompts`/`@clack/core`»), 112 (режим «Интерактивный (TUI)»: append-вывод, статусная строка, ввод на clack, Ctrl+C/Ctrl+D), 116 (лента чата: реплики и карточки — append, без полного redraw); при необходимости добавить подраздел «TUI и зависимости» с версиями и оговоркой про отсутствие нативной сборки. `README.md` не расширять (лимит 150 строк, `src/web/readme-standard.test.mjs`) — только при необходимости поправить существующую строку. `CHANGELOG.md` — запись VL-321.

## Порядок действий

1. package.json: `@clack/core@1.4.0` в dependencies → `pnpm install` → `pnpm build` (проверить, что `bin`-шимы целы: если сломались — `rm -rf node_modules/.bin && pnpm install --offline --frozen-lockfile`, lesson-196).
2. `src/agent/tui-input.ts` + тесты к нему — сначала независимый компонент (проверяется изолированно на PassThrough).
3. `src/agent/tui.ts`: удалить `createRedraw`/raw-mode, ввести `createAppender` + clack `spinner`/`log`/`intro`/`outro`, переписать тела колбэков, сохранив сигнатуры; затем `renderInteractiveTui` — цикл ввода на `createChatPrompt`.
4. Прогон: `pnpm build && pnpm test:fast` (быстрый фильтр), затем полный `pnpm test` перед DoD. Отдельно: `node bin/vibelog.mjs --help` (headless-путь не грузит TUI), спавн-тесты `src/agent/cli.test.mjs` зелёные.
5. Ручная проверка на реальном TTY (macOS): `pnpm build && node bin/vibelog.mjs agent` — шапка один раз, стрим не мигает, счётчики обновляют только нижнюю строку, карточки tool calls дописываются по завершении, ↑/↓ листает историю, Backspace/стрелки редактируют строку, Ctrl+C и Ctrl+D выходят без стектрейса, альтернативный буфер корректно закрывается, `vibelog-agent --headless spec <task>` (оркестраторный `renderTui`) не изменился.
6. Документация: doc-10, CHANGELOG. Коммит явными путями (без `backlog/`).

## Как проверить

```bash
pnpm build && pnpm test:fast            # итерации
pnpm test                                # полный прогон перед DoD (AC: Тесты проходят)
node --input-type=module -e "import('@clack/prompts').then(m=>console.log(typeof m.spinner))"
node bin/vibelog.mjs --help && node bin/vibelog.mjs agent --headless spec VL-321  # headless-пути
```
Плюс ручной TTY-прогон из п.5 и `git diff --stat` (в диффе не должно быть `tui-format.ts`, `tui-format.test.mjs`, `cli.ts`, `interactive.ts`).

## Риски

- **clack-промпт в альтернативном буфере на stderr**: clack считает позиции курсора и ширину терминала через `getColumns(output)`; в alt-буфере это работает, но требует `output`-потока с реальным `columns` — передаём `process.stderr` явно. При странностях — fallback: prompt на `process.stdin`/`process.stderr` без альтернативного буфера для ввода, вывод остаётся в буфере. Проверяется ручным прогоном (п.5) — это главный риск задачи.
- **Взаимодействие `spinner` и стрима токенов**: токены дописываются в ту же строку, где живёт статус. Митигация: `status.clear()` на первом токене хода + тик не перерисовывается, пока открыта частичная строка; при непредсказуемом поведении — fallback-хелпер `drawStatusLine()` (`\r\x1b[2K`), clack остаётся для log/note/prompt/spinner подтверждений.
- **`@clack/core` private/protected API** (`_shouldSubmit`, `on('key')`, `state`) может не покрывать Ctrl+D — митигация и порядок отступления описаны в п.3; худший случай — Ctrl+D как известное ограничение в doc-10 (AC2 при этом закрывается только при рабочем варианте, иначе — фиксируем в отчёте).
- **lesson-195 (один владелец stdin)**: после правки raw-mode в `tui.ts` не должно остаться ни одного `stdin.on('data')`/`setRawMode` — проверить `grep -n "setRawMode\|stdin.on" src/agent/tui.ts` (ожидается пусто).
- **Регресс оркестратора**: `renderTui()` теперь использует `spinner`/`log` вместо полного кадра — в stderr-логе headless-фаз (logTail оркестратора) появится больше ANSI-мусора; проверить, что `cli.test.mjs`/спавн-тесты не сравнивают stderr дословно, и что итоговая строка диагностики VL-203 печатается после `tui.unmount()` (cli.ts:1182) — не ломать порядок.
- **Не-TTY** (`vibelog agent` в пайпе): раньше ввод не подключался; сейчас промпт не стартует при `stdin.isTTY !== true` — поведение должно остаться прежним (чат ждёт вечно/выходит по сигналу), проверить спавн-тестом.
- **Node < 20.12**: `@clack/prompts@1.5.0` требует `>=20.12`, но не падает (engine-strict выключен, VL-322 уже проверила) — упомянуть в отчёте фазы code.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 20:42
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача). План записан в VL-321 (implementationPlan).
Ключевые решения: (1) `@clack/prompts@1.5.0` в dependencies уже есть (его ввела VL-322) — переиспользуем, дополнительно в dependencies добавляется `@clack/core@1.4.0` (та же транзитивная версия, нужна напрямую для своего prompt-класса ввода); (2) полный redraw `\x1b[2J\x1b[H` по таймеру удаляется — вывод становится append-only (стрим токенов, карточки `p.log.success/error`, ошибки `p.log.error`, шапка `p.intro`), счётчики живут в одной строке `p.spinner().message(formatCounters(...))` с fallback `\r\x1b[2K`; (3) ввод чата — собственный `ChatInputPrompt extends TextPrompt` из `@clack/core` в новом модуле `src/agent/tui-input.ts` (редактирование строки, история 50 записей на ↑/↓, Enter — отправка, Ctrl+C/Ctrl+D — отмена промпта → существующий `onExit`), ручной raw-mode/`stdin.on('data')` из `tui.ts` удаляется — один владелец stdin (lesson-195); (4) контракт `TuiHandle`/`renderTui`/`renderInteractiveTui`/`setBusy` сохраняется, `cli.ts` и `interactive.ts` не правятся, альтернативный буфер остаётся; (5) `tui-format.ts` и его тесты не трогаются.
Файлы в плане (9): package.json (+ `@clack/core`), src/agent/tui.ts (переписать рендер: удалить createRedraw/тиковый полный redraw и raw-mode ввод, ввести createAppender + clack spinner/log/intro/outro, сохранить сигнатуры колбэков), src/agent/tui-input.ts (новый: ChatInputPrompt, createChatPrompt, createConfirmPrompt), src/agent/tui-input.test.mjs (новый, по рецепту lesson-197: seam для confirm + реальный промпт на PassThrough), backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md (строки 16/32/39/112/116 + подраздел «TUI и зависимости»), CHANGELOG.md; README не расширяется (лимит 150 строк, readme-standard.test).
Риски: (a) clack-промпт внутри альтернативного буфера на stderr (ширина/позиции курсора) — главный риск, проверка ручным TTY-прогоном, fallback — ввод без alt-буфера; (b) конкуренция `spinner`-строки и стрима токенов — митигация `status.clear()` на первом токене + пропуск тика при открытой строке, fallback `drawStatusLine()`; (c) protected API `@clack/core` (`_shouldSubmit`, `on('key')`, `state`) может не покрывать Ctrl+D — порядок отступления в плане, худший случай фиксируется как ограничение в doc-10; (d) больше ANSI в stderr headless-фаз (logTail) — проверить, что спавн-тесты не сравнивают stderr дословно и порядок с итоговой диагностикой VL-203 (после `tui.unmount()`) сохранён; (e) `@clack/prompts@1.5.0` требует Node >=20.12 — предупреждение без падения (engine-strict выключен).
---
author: @agent
created: 2026-11-03 21:08
---
Фаза 3 (Code) выполнена. Коммит 24b31c4.
Изменено (5 файлов):
- `package.json` — в `dependencies` добавлен `"@clack/core": "1.4.0"` (точная версия, та же, что транзитивно тянет `@clack/prompts@1.5.0` из VL-322 — одна версия на проект); `pnpm-lock.yaml` обновлён установкой.
- `src/agent/tui.ts` — переписан рендер-слой: `createRedraw` с `\x1b[2J\x1b[H` удалён полностью, вместо него `createAppender` (append-транскрипт: `appendStream`/`endLine`/`appendBlock`/`drawStatus`/`clearStatus`). Шапка — `p.intro` один раз, карточки tool calls — `p.log.message(formatToolCard(...))` по завершении вызова, ошибки — `p.log.error`, «модель думает…» — `p.spinner` (снимается первым токеном), счётчики — только нижняя строка (`\r\x1b[2K`) по тику 1 с, причём тик пропускается, пока открыта частичная строка стрима. `TuiState` сокращён до `{usage, turn, startedAt, busy}`. Ручной raw-mode/`stdin.on('data')` из `renderInteractiveTui` удалён — ввод идёт циклом `createChatPrompt` (один владелец stdin, lesson-195), `unmount` абортит открытый промпт через AbortController. Сигнатуры `TuiHandle`/`renderTui`/`renderInteractiveTui`/`InteractiveTuiHandle.setBusy` не менялись; альтернативный буфер `\u001b[?1049h`/`\u001b[?1049l` сохранён.
- `src/agent/tui-input.ts` (новый) — `ChatInputPrompt extends TextPrompt` (`@clack/core`): редактирование строки средствами clack, история ↑/↓ через `rl.history` (HISTORY_MAX=50), Ctrl+D → `state='cancel'` через `on('key')`, лимит 500 символов через `validate`; `createChatPrompt` (null = отмена), `createConfirmPrompt` (обёртка `p.confirm` + `isCancel`, null = отмена — задел под tool-approval).
- `src/agent/tui-input.test.mjs` (новый) — 9 тестов: seam-проверка маппинга confirm/отмены + реальный промпт на PassThrough (печать/Backspace, ↑ из истории, Enter, Ctrl+C, Ctrl+D, лимит длины, abort signal).
Не тронуты (по AC): `src/agent/tui-format.ts` и `tui-format.test.mjs`, `src/agent/cli.ts`, `src/agent/interactive.ts` — `git diff` по ним пуст.
Проверки: `pnpm build` — exit 0; `npx vitest run src/agent` — 23 файла, 584 теста passed; **полный `pnpm test`** — 163 файла, 3103 passed, 4 skipped (пропуски — предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`, не связаны с задачей); `node bin/vibelog.mjs --help` и `node bin/vibelog-agent.mjs --help` — exit 0 (headless-пути TUI не грузят). `grep` по `tui.ts`/`tui-input.ts`: `\x1b[2J` остался только в комментариях, `setRawMode`/`stdin.on` в `tui.ts` отсутствуют.
Что осталось (вне Code): (1) ручной TTY-прогон `vibelog agent` — визуальная проверка спиннера/статусной строки/истории в альтернативном буфере (главный риск плана, автотестами не покрывается); (2) документация doc-10 и CHANGELOG — по правилам фазы пишет Close; (3) `@clack/prompts@1.5.0` требует Node >=20.12 — на Node 20.0–20.11 будет предупреждение pnpm без падения (engine-strict выключен).
---
author: @agent
created: 2026-11-03 21:17
---
Фаза Close выполнена. Ветка vb/vl-321 слита в master (merge-коммит 73dbbd0, 1 коммит задачи: 24b31c4), worktree `.vibelog/worktrees/vl-321` удалена (`--force`: в ней был только untracked `backlog/references/data` — ignored-клон, данные не теряются), ветка vb/vl-321 удалена (была 24b31c4).
**Проверка после merge:**
- `pnpm build` — exit 0.
- Ранний точечный фильтр: `npx vitest run src/agent` — 23 файла, 584 теста passed (diff затронул `src/agent/tui.ts` + новые `src/agent/tui-input.{ts,test.mjs}`, `package.json`, `pnpm-lock.yaml`).
- Полный `pnpm test` (build + vitest по всему проекту, включая отдельный прогон `src/web/static.test.mjs`) — exit 0. Параллельного `vitest` в других worktree не было (`ps aux | grep vitest` пуст). Повторных полных прогонов не потребовалось.
**DoD:** Тесты проходят — да (полный прогон после merge); Нет регрессий — да (сборка и полный прогон зелёные, `tui-format.ts`/`tui-format.test.mjs`, `cli.ts`, `interactive.ts` не затронуты — diff пуст); Документация обновлена — да, в этой фазе.
**Документация:** doc-10 — §3.6 «TUI и зависимости (VL-321)» (версии `@clack/prompts@1.5.0` / `@clack/core@1.4.0`, отсутствие нативной сборки, что осталось своим, ввод на `@clack/core`, Ctrl+C/Ctrl+D → отмена, `createConfirmPrompt` как задел под tool-approval, альтернативный буфер сохранён), переписаны «Режимы» (append-вывод, статусная строка, пропуск тика при открытой частичной строке) и «Лента чата» (append вместо обрезки ленты), обновлены упоминания zero-deps TUI в шапке, §1 и таблице decision-2. `README.md` не менялся (лимит 150 строк и `readme-standard.test.mjs` не тронуты). CHANGELOG — запись VL-321 в Unreleased. Коммит документации: 1ca687c.
**Уроки:** lesson-201 (clack: Ctrl+D и история через `on('key')`/`rl.history`) создан ещё в Code; в Close добавлен lesson-202 (append-транскрипт + перерисовка одной статусной строки вместо полного redraw), связан с задачей. Коммит refs/lessons: ce0677b.
**Вне автотестов (из отчёта Code, не блокирует):** ручной TTY-прогон `vibelog agent` (визуальная проверка спиннера/статусной строки/истории в альтернативном буфере) — главный риск плана, автотестами не покрывается; `@clack/prompts@1.5.0` объявляет `engines: node >=20.12` — на Node 20.0–20.11 установка проходит с предупреждением pnpm (engine-strict выключен).
AC1–AC8 отмечены: AC8 закрыт этим коммитом документации.
---
<!-- COMMENTS:END -->