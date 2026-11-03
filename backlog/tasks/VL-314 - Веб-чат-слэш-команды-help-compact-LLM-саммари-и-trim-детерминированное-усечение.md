---
id: VL-314
title: 'Веб-чат: слэш-команды /help, /compact (LLM-саммари) и /trim (детерминированное усечение)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 02:30'
updated_date: '2026-11-03 08:59'
due_date: ''
labels:
  - chat
  - web
  - slash-commands
  - context
  - llm
dependencies: []
milestone: ''
references:
  - ref-24
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/compact.ts
  - src/agent/loop.ts
  - src/web/api.ts
  - src/web/chat-commands.ts
  - src/web/chat-commands.test.mjs
  - src/web/chat-compaction.ts
  - src/web/chat-usage.ts
  - src/web/chat.ts
  - src/web/chat-persona-ui.test.mjs
  - templates/prompts/chat-summary.md
  - web/src/components/chat/thread.tsx
lessons:
  - lesson-189
token_usage:
  input: 21480199
  output: 156876
  cache: 21101056
  total: 21637075
  requests: 234
  duration_ms: 2535964
  reasoning: 87518
  by_phase:
    code:
      input: 19567446
      output: 146328
      cache: 19280896
      requests: 191
    close:
      input: 1912753
      output: 10548
      cache: 1820160
      requests: 43
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Фича 2 из трёх (обсуждение с Pavel). Фича 1 — VL-313 (панель токенов/₽/контекста), фича 3 — сверка тарифов с API.

Сейчас в веб-чате слэш-команд нет вообще: текст `/compact` уйдёт в LLM как обычное сообщение. Точка перехвата одна — `produce()` в `src/web/chat.ts`, до `history.push({role:'user'})` и до LLM-цикла. Ответ команды отдаётся обычными SSE-событиями `text` + `done`, клиент рендерит его как сообщение ассистента — правок в `chat-runtime.tsx` не требуется.

Компакшн для агента фаз уже есть и переиспользуется: `compactWireMessages(messages, from)` в `src/agent/loop.ts:483` («system + первый user со служебной заметкой + хвост», с орфан-гардом: хвост не может начинаться с `tool` без парного `assistant(tool_calls)`), константы `COMPACT_TAIL_DEFAULT = 50`, `COMPACT_AT_TOKENS_DEFAULT = 850_000`.

## Решения (согласованы)

- **`/compact` = LLM-саммари** (как в Qwen Code). **`/trim` = дешёвое детерминированное усечение** (0 ₽, мгновенно, из VL-122).
- **UI-история не сжимается никогда.** Как в VL-122 у агента: jsonl и лента остаются полными, сжимается ТОЛЬКО payload, уходящий в модель. Точка сжатия — sidecar `<threadId>.compaction.json` (`fromIndex`, способ, дата, оценка токенов). В треде — плашка «контекст сжат: в модель уходит с N-го сообщения». Сброс — удаление sidecar.
- **Цель сжатия — процент окна**: `target_percent` (дефолт 5) от `context_window`; окно неизвестно → fallback `target_tokens` (дефолт 50 000).
- **Шаблон саммари — файлом**, зеркало `loadChatSystemTemplate` (VL-188): `<cwd>/.vibelog/prompts/chat-summary.md` → встроенный `templates/prompts/chat-summary.md`, fail-closed при отсутствии обоих. В settings — только числа, не текст промпта.
- **Инкрементально**: в промпт уходит `prior-summary` + новые сообщения, саммари переписывается, а не накапливается (паттерн OpenCode, doc-13).
- **Стоимость саммари — обычный расход**: входит в ₽ панели (VL-313), но НЕ увеличивает `requests` хода.
- Команды недоступны во время стриминга и в approval-паузе.
- Подсказки-меню (ComposerMenu) отложены осознанно — см. ref-24; команды вводятся вручную.

## План

1. `src/web/chat-commands.ts` (new) — реестр `{name, description, usage, run}` по образцу `src/bot/registry.ts` (там реестр уже кормит `/help`); парсер `/name args`; `helpText()` из реестра.
2. `src/web/chat.ts` — перехват в `produce()` до `history.push`: команда исполняется вместо отправки в LLM; отказ во время стриминга/approval-паузы; неизвестная команда → ошибка со списком.
3. `src/web/api.ts` — `GET /api/chat/commands` (реестр без исполнения; понадобится и для ComposerMenu позже).
4. `src/web/chat-compaction.ts` (new) — sidecar-точка: чтение/запись/удаление `<threadId>.compaction.json`; сборка payload с учётом точки; переиспользование `compactWireMessages` (вынести из `loop.ts` в общий модуль, чтобы не дублировать орфан-гард).
5. `/trim` — детерминированное усечение: считаем точку отсечения по `target_percent`/`target_tokens`, пишем sidecar, отдаём текст-отчёт (сколько сообщений/токенов ушло).
6. `/compact` — LLM-саммари: резолв шаблона (`chat-summary.md`), инкрементальный вызов модели с `prior-summary` + новые сообщения, запись нового саммари в sidecar, учёт usage в панели (VL-313) без инкремента `requests`.
7. `src/web/chat-limits.ts` (или отдельный резолвер) — параметры `enabled`, `target_percent`, `target_tokens`, `keep_tail` в секции `chat` settings.json, терпимый парсинг (паттерн `resolveChatLimits`).
8. `templates/prompts/chat-summary.md` (new) — встроенный шаблон (структура по doc-13: Objective / Important Details / Work State / Next Move).
9. Клиент: плашка «контекст сжат» в `web/src/components/chat/thread.tsx` (по данным из `GET /api/chat/threads/:id`).
10. Документация: `docs/user-guide.md` (раздел веб-чата), doc-13 (дополнить разделом про чат), README при необходимости.

## Открытые вопросы

- Точный набор секций встроенного шаблона саммари (doc-13 предлагает OpenCode-структуру; можно сократить под Vibelog: задачи / файлы / решения / что осталось).
- Нужен ли `/compact` автотриггер по порогу (как `auto` у Qwen Code) — сейчас только ручной вызов.
- Показывать ли в плашке оценку «было N токенов → стало M».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Реестр команд src/web/chat-commands.ts: {name, description, usage, run}; GET /api/chat/commands отдаёт его без исполнения
- [x] #2 /help возвращает справку по всем командам из реестра (имя, описание, пример) — текст собирается из реестра, а не хардкодится
- [x] #3 Неизвестная команда (/foo) → понятная ошибка со списком доступных, в LLM не уходит
- [x] #4 Команды не исполняются во время стриминга и в approval-паузе — возвращается отказ с причиной
- [x] #5 /trim: детерминированное усечение payload по точке из sidecar <threadId>.compaction.json; jsonl и UI-история НЕ меняются
- [x] #6 /compact: LLM-саммари инкрементально (prior-summary + новые сообщения), результат — новое саммари, а не накопление старых
- [x] #7 Шаблон саммари резолвится как chat-system.md: .vibelog/prompts/chat-summary.md → templates/prompts/chat-summary.md, fail-closed при отсутствии обоих
- [x] #8 Цель сжатия — target_percent (дефолт 5) от context_window; при неизвестном окне fallback на target_tokens (дефолт 50000)
- [x] #9 Параметры (enabled, target_percent, target_tokens, keep_tail) читаются из секции chat settings.json терпимо, битые значения → дефолт + сообщение, без падения
- [x] #10 В треде показывается плашка «контекст сжат: в модель уходит с N-го сообщения»; полная история в UI остаётся
- [x] #11 Сброс сжатия (/trim off или /compact reset) удаляет sidecar, payload снова полный
- [x] #12 Токены саммари-вызова учитываются в панели ₽ (VL-313) как обычный расход, но не увеличивают requests хода
- [x] #13 Точка отсечения не разрывает пару tool_calls ↔ tool (орфан-гард), payload валиден для провайдера
- [x] #14 Тесты: реестр и /help, парсинг команд, /trim (границы, орфан-гард, sidecar), /compact (инкрементальность, резолв шаблона, учёт usage), отказ во время стриминга
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 08:37
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/agent/compact.ts
- src/agent/loop.ts
- src/web/chat-compaction.ts
- src/web/chat-commands.ts
- templates/prompts/chat-summary.md
- src/web/chat-usage.ts
- src/web/chat.ts
- src/web/api.ts
- web/src/components/chat/thread.tsx
- src/web/chat-commands.test.mjs
- I'll start by orienting in the project and reading the key files mentioned in the plan.
Now I have the full picture. Let me start implementing. First, extract `compactWireMessages` into a shared module.
Now update `loop.ts` to re-export from the shared module.
Now replace the function body in loop.t…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 1310 с, payload 571711 байт_
Незакоммиченные изменения сохранены в ветку: коммит `f65322a`.
---
author: @agent
created: 2026-11-03 08:37
---
Фаза code не удалась (код выхода 1): окировок=0, payload последнего запроса=571711 байт (макс 571711), usage={"input_tokens":7528877,"output_tokens":68397,"cache_read_input_tokens":7399424,"total_tokens":7597274,"reasoning_tokens":40038} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 08:50
---
Фаза 3 (Code) выполнена. Коммит df0559e.
**Что сделано (по плану):**
1. `src/web/chat-commands.ts` (new) — реестр `{name, description, usage, examples, run}` по образцу `src/bot/registry.ts`, парсер `parseCommand` (`/name args`, регистр не важен, `/` без имени и текст с `/` внутри — не команда), `helpText()` и `unknownCommandText()` собираются ИЗ реестра, `commandsView()` — метаданные без обработчиков.
2. `src/web/chat.ts` — перехват в `produce()` ДО `history.push({role:'user'})` и до LLM-цикла: команда исполняется вместо отправки в модель, ответ уходит обычными SSE `text` + `done` (правок в `chat-runtime.tsx` не потребовалось). `commandRefusal()` — отказ в approval-паузе (висящий `assistant(tool_calls)` без парных `tool`) и при активном ходе (свежий jsonl + последнее сообщение user). Создание LLM-клиента вынесено в `ensureLlm()` — его использует и цикл, и `/compact`.
3. `src/web/api.ts` — `GET /api/chat/commands` (реестр без исполнения) + поле `compaction` в `GET /api/chat/threads/:id`.
4. `src/web/chat-compaction.ts` (new) — sidecar `<threadId>.compaction.json` (чтение/запись/удаление, битый JSON → null), `buildWireMessages` (trim → общий `compactWireMessages`; summary → первый user заменяется саммари), `pickTrimIndex`, `estimateTokens`, `resolveTargetTokens`, `resolveChatCompaction` (терпимый парсинг секции `chat`), `loadChatSummaryTemplate` (проект → встроенный, fail-closed).
5. `src/agent/compact.ts` (new) — `compactWireMessages` вынесена из `loop.ts` в общий модуль (орфан-гард в одном месте, не дублируется); `loop.ts` реэкспортирует её — публичный API не изменился.
6. `/trim` — детерминированное усечение: цель по `target_percent`/`target_tokens` с учётом `keep_tail`, sidecar, отчёт «~N → ~M токенов»; `/trim off` — сброс.
7. `/compact` — LLM-саммари: шаблон файлом, инкрементально (`prior-summary` + только выпавшие из хвоста сообщения), саммари переписывается; usage учитывается в панели, но `requests` не инкрементится (новое поле `countRequest` в `UsageEntry`); `/compact reset` — сброс.
8. `templates/prompts/chat-summary.md` (new) — встроенный шаблон (Задача / Важные детали / Текущее состояние / Следующий шаг).
9. `web/src/components/chat/thread.tsx` — `CompactionBanner` над лентой: «Контекст сжат: в модель уходит с N-го сообщения (~N → ~M токенов)»; полная история в ленте остаётся.
**Проверки:**
- `pnpm build` — без ошибок.
- Полный `pnpm test` — **157 файлов, 2927 passed, 4 skipped**, падений нет (исключений/`--skip` не было).
- Новый `src/web/chat-commands.test.mjs` — 40 кейсов (реестр, `/help`, парсер, `/trim` границы/орфан-гард/sidecar/сброс, `/compact` инкрементальность/резолв шаблона/usage/ошибки, отказ в approval-паузе, терпимый парсинг настроек, плашка в клиенте).
- `web`: `npx tsc --noEmit` — exit 0. `eslint`/`vite build` в этом worktree не запускаются: `web/node_modules` не установлен (окружение, не код).
**Что осталось (вне AC этой задачи):** автотриггер `/compact` по порогу и ComposerMenu (подсказки-меню) — отложены осознанно по решению в описании задачи; документация (docs/user-guide.md, doc-13) — по правилам фазы пишется в Close.
---
author: @agent
created: 2026-11-03 08:59
---
Фаза Close выполнена. Ветка vb/vl-314 слита в master (2 коммита: df0559e + f65322a, merge --no-ff), worktree .vibelog/worktrees/vl-314 удалена (force — в ней был только untracked-клон backlog/references/data), ветка vb/vl-314 удалена.
**Проверки после merge:** `pnpm build` — без ошибок. Ранний точечный фильтр (src/web/chat-commands.test.mjs, src/web/chat-persona-ui.test.mjs, src/agent/) — 24 файла, 610 passed. Полный `pnpm test` — 157 файлов, **2927 passed, 4 skipped**, падений нет (исключений/`--skip` не было), повторных прогонов не потребовалось.
**Уборка/refs:** ref-24 (ComposerMenu) связан с задачей; создан lesson-189 «Сжимай только payload для модели через sidecar-файл» и связан с VL-314 — коммит 327f2b0.
**Документация:** CHANGELOG.md (запись в Unreleased), doc-6 (раздел веб-чата — слэш-команды, sidecar, настройки `chat.*`), doc-13 §4.4 (как этапы 4.1/4.2 доведены до веб-чата ручными командами) — коммит de57f8e.
**DoD:** Тесты проходят ✓, Документация обновлена ✓, Нет регрессий ✓ — все три пункта выполнены и отмечены. Отложенное осознанно и вне AC: автотриггер `/compact` по порогу и ComposerMenu-подсказки.
---
<!-- COMMENTS:END -->