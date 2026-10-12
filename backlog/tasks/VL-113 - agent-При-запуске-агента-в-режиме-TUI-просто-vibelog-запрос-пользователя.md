---
id: VL-113
title: Исправить отображение чата в TUI-режиме агента
status: Review
assignee: []
reporter: ''
created_date: '2026-10-12 13:31'
updated_date: '2026-10-12 16:15'
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
modified_files:
  - src/agent/tui.tsx
  - src/agent/interactive.ts
  - src/agent/tui-format.ts
  - src/agent/tui-format.test.mjs
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#agent При запуске агента в режиме TUI (просто vibelog) запрос пользователя стирается, а ответы агента склеиваются в одну строку. Надо сделать больше похожим на нормальный AI чат. посмотрив референсах как это устроено в qwen code, opencode и других.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В TUI-режиме (запуск `vibelog` без подкоманд) ввод пользователя не стирается: реплика пользователя остаётся видимой в истории чата
- [x] #2 Ответы агента отображаются с сохранением переносов строк — многострочный ответ не склеивается в одну строку
- [x] #3 Диалог визуально оформлен как типичный AI-чат (реплики пользователя и агента визуально разделены), по образцу референсов (qwen code, opencode)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: нормальный AI-чат в TUI-режиме агента

## Диагноз (коренные причины)

1. **Реплика пользователя стирается**: в `InputLine` (src/agent/tui.tsx:191-196) при Enter `input` очищается, текст уходит только в `onSubmit` — в сторе TUI **нет истории сообщений чата**, реплика нигде не рендерится и исчезает с экрана.
2. **Ответы склеиваются в одну строку**: `onToken` (tui.tsx:283-285) дописывает токены в `stream`, который **не сбрасывается между ходами чата** — ответ второго хода приклеивается вконец ответа первого без разделителя. Плюс `chunks` и `tools` копятся между ходами.

## Архитектурное решение (по образцу qwen code / opencode)

Ввести в стор **ленту чата** `messages: ChatEntry[]` (role `user`/`assistant` + text). Реплика пользователя при Enter навсегда остаётся в ленте с префиксом `>` (как UserMessage в qwen code: prefix `>` + wrap-текст акцентным цветом). Завершённый ответ ассистента переносится из стрима в ленту методом `finishTurn()` и сбрасывает `stream`/`chunks` — переносы строк сохраняются (Ink `<Text>` рендерит `\n`), склейка между ходами невозможна. Во время хода текущий стрим показывается под лентой как «в процессе» (существующий StreamText). Оркестраторный режим (`renderTui`) не меняется: `finishTurn` вызывается только интерактивным чатом.

## Файлы для изменения

### 1. `src/agent/tui.tsx` (основной)

- **~стр. 27-36 (интерфейсы)**: добавить `interface ChatEntry { id: number; role: 'user' | 'assistant'; text: string }`.
- **TuiState (~стр. 40-60)**: поле `messages: ChatEntry[]` (лента завершённых реплик).
- **createStore (~стр. 66-92)**: инициализация `messages: []`.
- **Новый компонент `ChatHistory`** (после StreamText, ~стр. 108): рендерит последние `CHAT_VISIBLE = 30` записей ленты. User: `<Box><Text color="cyan">{'> '}</Text><Text wrap="wrap">{text}</Text></Box>` (модель qwen code PrefixedTextMessage). Assistant: `<Text wrap="wrap">{text}</Text>` (белый/дефолт). Пустые тексты пропускаются.
- **InputLine (~стр. 191-196)**: в ветке `key.return` при непустом text добавлять реплику в ленту: `store.update({ input: '', messages: [...state.messages, { id: nextId, role: 'user', text }] })` — нужен счётчик id (замыкание/поле стора, см. cardSeq-паттерн в buildHandle; вынести `nextChatId` в createStore-замыкание или хранить `msgSeq` в TuiState).
- **AgentApp (~стр. 242-260)**: рендерить `<ChatHistory messages={state.messages} />` **выше** `<StreamText>` (стрим — «в процессе» под лентой). Порядок блоков: header → ChatHistory → Counters → StreamText → tools → errors → InputLine.
- **buildHandle (~стр. 273-345) + InteractiveTuiHandle (~стр. 357-370) + renderInteractiveTui (~стр. 372-399)**: добавить метод `finishTurn(): void` — берёт `[...chunks, stream]` (непустые, join `\n`, trim), при непустом тексте добавляет `{ role: 'assistant' }` в `messages`, сбрасывает `chunks: []`, `stream: ''`. В интерактивном handle пробросить на базовый. Карточки tools между ходами тоже сбрасывать в `finishTurn` (`tools: []`) — лимит 8 не спасает от мусора прошлых ходов. `finishTurn` — no-op при пустом стриме (повторный вызов безопасен).

### 2. `src/agent/interactive.ts`

- **submitTurn, finally-блок (~стр. 155-160)**: перед `setBusy(false)` вызвать `tui?.finishTurn()` — финализация ответа и в успешном, и в ошибочном пути (частичный текст не теряется, но и не приклеивается к следующему ходу).

### 3. `src/agent/tui-format.ts`

Чистые функции (тестируемо без React/Ink):
- `formatUserMessage(text: string): string` → `` `> ${text}` `` — единая точка префикса user-реплики.
- `assembleAssistantText(chunks: string[], stream: string): string` — склейка непустых кусков через `\n` + trim; используется в finishTurn.

### 4. `src/agent/tui-format.test.mjs`

Тесты: prefix `>` у formatUserMessage; assembleAssistantText — пустые массивы → `''`, обрезка пустых строк, join через `\n` (переносы сохраняются).

### 5. `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` (DoD: документация)

- ~стр. 107 и 109: дополнить описание TUI-чата — лента сообщений (реплики пользователя с `>` остаются в истории, ответы ассистента с сохранением переносов строк, рендер по образцу qwen code), сброс стрима между ходами.

## Порядок действий

1. tui-format.ts (+тесты) — чистые функции.
2. tui.tsx — ChatEntry/messages/ChatHistory/InputLine/finishTurn/AgentApp.
3. interactive.ts — вызов finishTurn в finally.
4. `pnpm build && pnpm test`.
5. Документация (doc-10).
6. Ручная проверка в терминале: `node bin/vibelog.mjs` (нужны VIBELOG_LLM_* в .env) — две реплики подряд: реплика пользователя остаётся, ответы разделены, переносы строк на месте.

## Проверка

- `pnpm build` — компиляция strict TS.
- `pnpm test` — все тесты, включая новые в tui-format.test.mjs.
- Ручной smoke: `node bin/vibelog.mjs`, ввести «привет, напиши три строки», затем второй запрос — в ленте обе реплики пользователя с `>`, оба ответа многострочно и разделены.
- Оркестраторный режим не задет: `node bin/vibelog-agent.mjs "тест" --headless ...` или существующие cli/loop тесты — контракт JSON и вид оркестраторного TUI без изменений.

## Риски

- **Высота кадра**: растущая лента может не влезать в терминал — режем сверху по CHAT_VISIBLE (30 записей); Ink дополнительно обрезает по высоте окна.
- **Регрессия оркестраторного TUI**: сводится к нулю — finishTurn не вызывается в renderTui-пути, StreamText/счётчики/карточки не трогаются.
- **Пустой/частичный ход (ошибка)**: finishTurn в finally переносит частичный текст в ленту — аккуратно, не теряем и не дублируем (no-op при пустом стриме).
- **Буферизация stderr**: TUI живёт на stderr с alt-буфером — ничего нового, поведение сохраняется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 13:35
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Исправить отображение чата в TUI-режиме агента». Масштаб: task. Уточнено: критерии приёмки — ввод пользователя не стирается и остаётся в истории чата; ответы агента сохраняют переносы строк; диалог визуально оформлен как типичный AI-чат по образцу референсов (qwen code, opencode). Вопросов нет.
---
author: @agent
created: 2026-10-12 13:52
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу.
**Диагноз:** (1) реплика пользователя стирается — в сторе TUI нет истории чата, текст из InputLine уходит только в onSubmit и исчезает; (2) ответы склеиваются — `stream` не сбрасывается между ходами чата, ответ хода N+1 приклеивается к ходу N.
**Решение (по образцу qwen code/opencode):** лента чата `messages: ChatEntry[]` в TuiState; user-реплики остаются с префиксом `>` (модель PrefixedTextMessage из qwen code), ответы ассистента — wrap-текст с сохранением переносов; новый метод `finishTurn()` финализирует стрим в ленту и сбрасывает stream/chunks/tools, вызывается из finally submitTurn в interactive.ts. Оркестраторный режим (renderTui) не меняется.
**Файлы (5):** src/agent/tui.tsx (ChatEntry/ChatHistory/InputLine/finishTurn), src/agent/interactive.ts (finishTurn в finally), src/agent/tui-format.ts (+2 чистые функции), src/agent/tui-format.test.mjs (тесты), backlog/docs/doc-10 (описание TUI-чата).
**Риски:** высота кадра (обрезка ленты CHAT_VISIBLE=30), частичный ход при ошибке (переносится в ленту, no-op при пустом стриме), регрессия оркестраторного TUI (минимальна — finishTurn не вызывается в renderTui-пути).
---
author: @agent
created: 2026-10-12 14:21
---
Фаза 3 (Code) выполнена. Реализовано по Implementation Plan.
**Изменено:**
- `src/agent/tui.tsx` — интерфейс `ChatEntry` + поле `messages`/`msgSeq` в TuiState/сторе; новый компонент `ChatHistory` (лента завершённых реплик: user — cyan с префиксом `> `, assistant — белый, `wrap="wrap"` сохраняет переносы строк; последние 30 записей, пустые пропускаются); `InputLine` при Enter добавляет реплику пользователя в ленту (не стирается); метод `finishTurn()` в TuiHandle/buildHandle — переносит стрим в ленту ассистента через `assembleAssistantText` и сбрасывает `stream`/`chunks`/`tools` (ответы ходов не склеиваются; no-op при пустом стриме); `AgentApp` рендерит `ChatHistory` выше `StreamText` (порядок: header → ChatHistory → Counters → StreamText → tools → errors → InputLine).
- `src/agent/interactive.ts` — `tui?.finishTurn()` в finally submitTurn: финализация хода и в успешном, и в ошибочном пути.
- `src/agent/tui-format.ts` — чистые функции `formatUserMessage` (единая точка префикса `> `) и `assembleAssistantText` (склейка непустых кусков через `\n` + trim — переносы сохраняются).
- `src/agent/tui-format.test.mjs` — 6 новых тестов (prefix, склейка, пустые/trim).
- `backlog/docs/doc-10-…Агент-Vibelog.md` — раздел «Режимы» дополнен описанием ленты чата VL-113 (в backlog/, в modifiedFiles не включён).
**Проверки:** `pnpm build` (tsc strict) OK; `env -u VIBELOG_CWD pnpm test` — 829 tests / 826 pass / 0 fail (3 skipped — штатно). Оркестраторный TUI не задет: `finishTurn` вызывается только интерактивным чатом, `renderTui`/контракт JSON без изменений. Остальные AC/DoD отмечены.
**Замечание по тест-прогону:** `pnpm test` с утечкой `VIBELOG_CWD` (env фазы оркестратора) даёт 12 ложных падений в `cli.test.mjs`/`mcp/server.test.mjs` — это воспроизводится и на чистом master без моих правок (проверено stash-прогоном); с `env -u VIBELOG_CWD` всё зелёное. Не регрессия этой задачи.
**Что осталось:** ручной smoke в реальном терминале (`node bin/vibelog.mjs`, две реплики подряд) — требует интерактивного TTY и живого ключа, недоступно в автоматической фазе; визуально верифицировать можно при Фазе Close/ревью.
---
<!-- COMMENTS:END -->