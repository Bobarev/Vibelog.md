---
id: VL-178
title: 'Защита от отказа провайдера «high risk»: усечение выводов chrome-devtools, запрет скриншотов в промптах, автоповтор LLM-клиента'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 13:21'
updated_date: '2026-10-25 18:47'
due_date: ''
labels:
  - agent
  - prompt
  - mcp
  - chrome
  - llm-client
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/loop.ts
  - src/agent/llm.ts
  - src/web/orchestrator.ts
  - src/agent/loop.test.mjs
  - src/agent/llm.test.mjs
  - src/web/orchestrator.test.mjs
  - AGENTS.md
  - templates/agent-prompt.md
  - MCP-SETUP.md
lessons:
  - lesson-1
  - lesson-2
  - lesson-10
  - lesson-18
  - lesson-29
  - lesson-20
  - lesson-30
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Проблема

В сессии agent-1792913208465 (VL-172) выпала ошибка провайдера LLM: **«The request was rejected because it was considered high risk»** (1 раз, запись #171). Непосредственно перед отказом в запрос ушли **два вывода `chrome_devtools__take_snapshot` по ~624 КБ каждый** (~1.25 МБ полезной нагрузки). Работа продолжилась только вручную через «Продолжить» (50% user-сообщений сессии — resume-прогоны).

Скриншоты (`take_screenshot`) как решение НЕ использовать — они тоже едят очень много токенов.

## Корневая причина (диагноз фазы Plan)

- **VL-110-трейт-кат не покрывает MCP**: `truncateToolOutput` (8KB) вызывается только внутри handler'ов встроенных инструментов `src/agent/tools.ts`. Внешние MCP-инструменты идут через `toolsAsSpecs` (`src/agent/mcp-client.ts:281-293`) — handler возвращает `client.callTool()` **без обрезки**, и `loop.ts:392-402` пишет вывод в историю целиком. Отсюда два снапшота по 624 КБ.
- **Компакшн (VL-122)**: выкидывает только сообщения вне хвоста (50 шт.); большие tool-выводы В хвосте переживают его, а в jsonl сессии они хранятся целиком и при каждом resume уходят в первый запрос.
- **LLM-клиент (VL-83)**: тело не-ok ответа не читается (`apiError` — только статус), маркер «high risk» не детектится, повторов с усечённым payload нет — только ручной «Продолжить».
- **Промпты**: `AGENTS.md:76` прямо рекомендует `take_screenshot`/полный `take_snapshot`.

## Что сделать (все пункты разбора)

1. **Проверить обрезку выводов chrome-devtools MCP (связь: VL-110).** Убедиться, что трейт-кат/лимит длины tool-выводов реально применяется к `chrome_devtools__take_snapshot`. Если лимит не покрывает MCP-инструменты — расширить (глобальный cap в loop/LLM-клиенте).
2. **Проверить компакшн на таких выводах (связь: VL-122).** Подтвердить тестами, что гигантские снапшоты не выживают в wire-payload между ходами после компакшн-логики (и усечены на уровне истории).
3. **Обновить промпты фаз / AGENTS.md: вместо скриншотов и полных снапшотов — точечные инструменты.** Запретить `take_screenshot` в практике агента (дорого по токенам); рекомендовать `evaluate_script` (нужный кусок DOM), `take_snapshot` с `filePath` (снапшот на диск, в контекст — только подтверждение).
4. **Автоповтор при отказе «high risk» в LLM-клиенте (связь: VL-83).** При ошибке «The request was rejected because it was considered high risk» (и аналогичных отказах провайдера) — автоматический повтор запроса с усечённой полезной нагрузкой вместо ручного «Продолжить»; фолбэк-страховка в resume-логике оркестратора.

## Контекст разбора

- Статистика: 109 мин, 235 записей, 0 wall-убийств, 0 пустых ответов, 0 NaN — тупика нет, только расточительство контекста (2 × 624 КБ снапшота).
- Вердикт /analyze: «задача в пределах объёма», проблема — рискованный объём tool-выводов в одном запросе.

Implementation Plan — см. поле плана.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Выводы chrome_devtools__take_snapshot в истории LLM усечены до разумного лимита (проверка + правка конфига/трейт-ката)
- [x] #2 Компакшн (VL-122) подтверждён на таких снапшотах — большие выводы не переживают между ходами
- [x] #3 В промптах фаз и AGENTS.md вместо take_screenshot/полного take_snapshot рекомендованы evaluate_script и take_snapshot c filePath (без скриншотов)
- [x] #4 LLM-клиент (VL-83) при отказе «high risk» автоматически повторяет запрос с усечённой полезной нагрузкой (fallback вместо ручного «Продолжить»)
- [x] #5 Регрессии: pnpm build и pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan — VL-178 (Фаза 2, тип: task)

## Диагноз (проверено по коду)

1. **Трейт-кат VL-110 не покрывает MCP**: `truncateToolOutput` (8KB, `src/agent/tools.ts:70`) вызывается только внутри handler'ов встроенных инструментов (`tools.ts:174,425,558,581`). Внешние MCP-инструменты идут через `toolsAsSpecs` (`src/agent/mcp-client.ts:281-293`) → `client.callTool()` → **без обрезки**; `loop.ts:392-402` пишет вывод в историю целиком. Отсюда 2 × 624 КБ в транскрипте.
2. **Resume старых сессий**: jsonl уже содержит гигантские tool-выводы; `toWireMessages` (`llm.ts:237`) отправляет их как есть — cap нужен и на wire-уровне.
3. **Компакшн VL-122** (`loop.ts:148-166, 281-290`) выкидывает только сообщения вне хвоста (50 шт.) — большие выводы В хвосте переживают; с ingestion-cap 8KB хвост ограничен ≈400 КБ (комментарий `loop.ts:122-123` уже это декларирует, но для MCP не работал).
4. **LLM-клиент VL-83**: тело не-ok ответа не читается — `apiError` (`llm.ts:379`) даёт только статус; маркер «high risk» не детектится, повторов с усечённым payload нет.
5. **Промпты**: `AGENTS.md:76` рекомендует `take_screenshot`/полный `take_snapshot`; `MCP-SETUP.md:202,214` — пример со скриншотом; `templates/agent-prompt.md` не знает про экономию браузерных выводов.

## Файлы для изменения и конкретные места

### 1. Ingestion-cap всех tool-выводов (AC1)

**`src/agent/loop.ts`**
- Импорт: добавить `truncateToolOutput` к существующему import из `./tools.js` (строка 16, сейчас `import type` — нужен value-import, отдельная строка).
- Строка ~398 (после `output = await spec.handler(...)` / catch-блока, ДО `onToolEnd` на строке 401): `output = truncateToolOutput(output);` — единая точка cap'а для ВСЕХ инструментов, включая MCP (`chrome_devtools__take_snapshot` 624 КБ → 8 КБ + маркер «вывод обрезан»).

**`src/agent/llm.ts`**
- `toWireMessages` (строки 237-251): для `role === 'tool'` обрезать `content` через `truncateToolOutput` (импорт из `./tools.js`; циклического импорта нет — tools.ts не импортирует llm.ts). Это cap на отправку: защита при **resume старых jsonl-сессий**, где гигантские выводы уже лежат.

### 2. Автоповтор при «high risk» в LLM-клиенте (AC4)

**`src/agent/llm.ts`**
- Новые хелперы (экспорт для тестов):
  - `isHighRiskBody(text: string): boolean` — regex `/(high\s*risk|rejected\s+because\s+it\s+was\s+considered)/i` (учёстекст провайдера «The request was rejected because it was considered high risk»; плюс аналогичные отказы модерации).
  - `shrinkMessages(messages: ChatMessage[], maxToolChars: number): ChatMessage[]` — обрезает `content` tool-сообщений до `maxToolChars` с маркером; assistant/system/user не трогает (целостность tool_call_id сохраняется — сообщения не выбрасываются, а усекаются, чтобы не сломать парность tool_calls/tool).
- `apiError` (строка 379): принимает опциональный фрагмент тела ответа и включает его в сообщение («… HTTP 400 Bad Request: <первые 300 символов тела>») — маркер отказа провайдера виден в логе/транскрипте.
- Фолбэк-путь non-stream (строки 499-512): перед `throw apiError(...)` читать `await fallbackRes.text()` (guard: `typeof fallbackRes.text === 'function'`, иначе прежний путь — тестовые моки в `llm.test.mjs` дают только `json()`):
  1. если `isHighRiskBody(body)` → **повтор с усечённым payload**: `let shrunk = shrinkMessages(messages, SHRINK_LEVEL_1=4096)`; повтор через весь стриминг-путь (та же `baseBody`, пересобрать `messages: toWireMessages(shrunk)`);
  2. если и повтор отвергнут → `shrinkMessages(messages, SHRINK_LEVEL_2=1024)` → ещё одна попытка;
  3. максимум 2 shrink-попытки (константа `HIGH_RISK_MAX_SHRINKS = 2`), пауза — `retryDelayMsFor(attempt, null, baseRetryDelay)`;
  4. исчерпано → throw с текстом провайдера (через расширенный `apiError`).
- Порядок вставки: вокруг фазы 2 (`Фолбэк non-stream`, строки 499+); stream-путь при не-ok статусе уже уходит в этот фолбэк (комментарий строки 482-484) — детект покрывает оба пути без дублирования.

### 3. Авто-resume в оркестраторе (п.4 ТЗ «обработать resume-хендлеры», страховка)

**`src/web/orchestrator.ts`**, `finish()` (строки 749-841), после `lastRuns.set(key, record)` (835), ДО `onExit?.(record)` (839):
- Условие: `record.result?.is_error === true` && `/high\s*risk|rejected because it was considered/i.test(record.result текст)` && `record.result.session_id` есть && module-level счётчик `highRiskAutoRetries.get(key) < 1` (Map на уровне модуля, рядом с `activeRuns`).
- Действие: `highRiskAutoRetries.set(key, n+1)`; `spawnQwenRun(cwd, key, phase, 'Продолжи с текущего места — автоматический повтор после отказа провайдера (VL-178).', onExit, agent, extraArgs.includes('--resume') ? extraArgs : [...extraArgs, '--resume', sessionId], worktreeTaskId)`; лог `[phase key] авто-resume после high-risk (VL-178)`.
- Счётчик 1 на runKey → цикл исключён; `onExit` уходит только финальному (штатному) запуску — авто-запуск промежуточного `onExit` пропустить (флаг в вызове: для авто-повтора `onExit = undefined`, финальный результат всё равно придёт через новый `finish` того же ключа).
- Проверка `extraArgs.includes('--resume')` — по примеру lesson-18: флаг не должен продублироваться.

### 4. Промпты: запрет скриншотов, точечные инструменты (AC3)

**`AGENTS.md`**, секция «Проверка в браузере (chrome-devtools MCP)» (строки 71-78) — переписать буллеты:
- `chrome_devtools__take_screenshot` — **не использовать** (один кадр — десятки КБ в каждом ходе; инцидент VL-178: два вывода по 624 КБ → отказ провайдера «high risk»).
- Вместо скриншотов/полных снапшотов: `evaluate_script` — в контекст только нужный кусок данных из DOM; `take_snapshot` — только с параметром `filePath` (снапшот на диск, в контекст — подтверждение записи); `list_console_messages` / `list_network_requests` — как раньше.

**`templates/agent-prompt.md`** — добавить правило (после строки про grep/find):
- «Не используй `take_screenshot` (скриншоты) и полные `take_snapshot` без filePath — они заливают контекст; для проверки веб-страницы бери `evaluate_script` (нужный кусок DOM) или `take_snapshot` с filePath (на диск), лимит tool-вывода 8KB.»

**`MCP-SETUP.md`**:
- строка 202: убрать `chrome_devtools__take_screenshot` из перечня примеров → заменить на `chrome_devtools__evaluate_script`;
- строки 211-215 (пример «сними скриншот»): переформулировать на «открой https://example.com, выполни evaluate_script для … и покажи сообщения консоли».

### 5. Тесты (AC1, AC2, AC4)

**`src/agent/loop.test.mjs`**:
- MCP-подобный spec (handler возвращает `'х'.repeat(624*1024)`) → в `messages` tool-сообщение ≤ `TOOL_OUTPUT_MAX_CHARS` + маркер обрезки.
- Компакшн (VL-122): giant tool-вывод в истории ВНЕ хвоста → не попадает в wire-payload (`state.wires`/проверка по captures последнего `streamChat`); внутри хвоста — обрезан на ingestion → wire ограничен.

**`src/agent/llm.test.mjs`** (моки расширить: `jsonResponse`/новый helper получает `text: async () => body`):
- Стрим 400 с телом «The request was rejected because it was considered high risk» + фолбэк 400 с тем же телом → первый повтор: во 2-м fetch-вызове `body` содержит tool-сообщения ≤4096; успех → ответ возвращается.
- 400 high-risk выдерживает оба shrink-уровня → throw с текстом провайдера в сообщении; счётчик вызовов fetch ограничен (full + 2 shrink, ×2 на stream/fallback — проверить фактическое число по потоку кода).
- Обычный 400 без high-risk → без shrink-повторов (регрессия на существующем тесте `llm.test.mjs:203`).
- `toWireMessages`-cap: tool-сообщение >8KB усечено в теле запроса (проверка через перехват `fetchImpl` body).

**`src/web/orchestrator.test.mjs`**:
- Стаб печатает JSON `type=result` c `is_error: true`, текстом «…high risk…» и `session_id` → finish() спавнит второй запуск с `['--resume', sid]`; третий high-risk результат НЕ спавнит (счётчик = 1); штатный `onExit` вызван по финальному record.

### 6. Куда НЕ ходим
- `backlog/` — только через MCP (lesson из AGENTS.md).
- CHANGELOG/документы backlog/docs — не трогаем (пишет Close).

## Порядок действий (Code)

1. `src/agent/loop.ts` — ingestion cap (+ импорт).
2. `src/agent/llm.ts` — `toWireMessages` cap; `isHighRiskBody` / `shrinkMessages` / расширенный `apiError`; shrink-retry в фолбэк-пути streamChat.
3. Тесты `loop.test.mjs`, `llm.test.mjs` → `pnpm build && pnpm test:fast` (итерации), затем полный `pnpm test`.
4. `src/web/orchestrator.ts` — авто-resume страховка + тест в `orchestrator.test.mjs`.
5. Промпты: `AGENTS.md`, `templates/agent-prompt.md`, `MCP-SETUP.md`.
6. Финал: `pnpm build && pnpm test`; commit по шагу 5 фазы Code (явные пути).

## Как проверить

```bash
pnpm build && pnpm test        # AC5: сборка + все тесты зелёные
pnpm test:fast                 # быстрые итерации между шагами (dist собран)
```

Ручная верификация (по желанию): сессия с `take_snapshot` → grep jsonl: вывод ≤ ~8.4KB.

## Риски

1. **Чтение `text()` у не-ok Response** — тестовые моки (`jsonResponse` в llm.test.mjs) не имеют `text()`; guard через `typeof ... === 'function'` + обновление моков. `json()` и `text()` взаимоисключимы — читать ровно один раз, до `json()` не доходить (после `throw` — не доходим).
2. **Shrink ломает парность tool_calls/tool** — НЕ выбрасывать сообщения, только усекать `content` tool-сообщений; id/структура не меняются.
3. **Авто-resume оркестратора — цикл** — счётчик 1 на runKey + проверка `extraArgs` на дубль `--resume` (lesson-18: флаг через все слои).
4. **toWireMessages-cap обрезает старые сессии** — маркер обрезки объясняет модели причину; фактически полезный хвост и так недостижим для модели при 624 КБ.
5. **onToolEnd/TUI получит обрезанный вывод** — приемлемо: VL-110 уже так делает для shell-выводов (карточка TUI не страдает, полный вывод — в jsonl? Нет: в jsonl пойдёт обрезанный — это и есть цель AC1: не раздувать историю).
6. Объём: 4 файла кода + 3 файлa промптов + 3 тестовых файла — в пределах одной задачи, блокер/подзадачи не нужны.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 17:57
---
Фаза 2 (Plan) выполнена. Тип: task. План записан (Implementation Plan): 9 файлов (3 кода — src/agent/loop.ts ingestion-cap 8KB для всех tool-выводов включая MCP, src/agent/llm.ts — toWireMessages-cap + isHighRiskBody/shrinkMessages + автоповтор с 2 уровнями усечения при отказе «high risk», src/web/orchestrator.ts — авто-resume-страховка в finish() со счётчиком 1 на runKey; 3 промпта — AGENTS.md, templates/agent-prompt.md, MCP-SETUP.md: запрет take_screenshot, рекомендация evaluate_script/take_snapshot с filePath; 3 тестовых — loop/llm/orchestrator.test.mjs). Корневая причина подтверждена кодом: truncateToolOutput (VL-110) не покрывает внешние MCP-инструменты (toolsAsSpecs в mcp-client.ts:281 возвращает вывод без обрезки), тело не-ok ответа в llm.ts не читается. Риски: чтение text() у не-ok Response (guard typeof), парность tool_calls при усечении (только trim content, не выбрасывать), цикл авто-resума (счётчик + проверка дубля --resume). Подзадачи/блокеры не понадобились — объём в одной задаче.
---
author: @agent
created: 2026-10-25 18:38
---
Фаза 3 (Code) выполнена. Изменено: src/agent/loop.ts, src/agent/llm.ts, src/web/orchestrator.ts, src/agent/loop.test.mjs, src/agent/llm.test.mjs, src/web/orchestrator.test.mjs, AGENTS.md, templates/agent-prompt.md, MCP-SETUP.md; коммит a4daeb6 (ветка vb/vl-178). Что сделано: (1) ingestion-cap в loop.ts — truncateToolOutput (8KB) применяется ко ВСЕМ tool-выводам включая внешние MCP (chrome_devtools__take_snapshot 624КБ → 8KB); (2) wire-cap в toWireMessages (llm.ts) — защита при resume старых jsonl-сессий с гигантскими выводами; (3) автоповтор LLM-клиента: isHighRiskBody детектит маркер по телу не-ok ответа (apiError теперь включает фрагмент тела), shrinkMessages усекает tool-выводы до 4096/1024 с сохранением парности tool_calls↔tool, max 2 повтора; (4) авто-resume-страховка в finish() оркестратора: is_error + маркер high risk + session_id → один перезапуск с --resume (счётчик 1 на runKey, onExit по финальному record); (5) промпты: AGENTS.md — take_screenshot запрещён, рекомендованы evaluate_script/take_snapshot с filePath; agent-prompt.md — то же правило без ID задач (тесты VL-117/VL-157); MCP-SETUP.md — пример без скриншота. Проверки: pnpm build && pnpm test — зелёные (67 файлов, 1181 тест, 4 skipped); новые тесты: loop (MCP-cap 624КБ, компакшн на giant-выводах), llm (shrink-повтор 3 вызова, исчерпание = 6 вызовов, регрессия обычного 400, wire-cap), orchestrator (2 спавна, --resume, без цикла, onExit 1 раз). Замечание: src/core/reference.test.mjs один раз упал по флаку таймаута клона (120с) — изолированно и в полном прогоне проходит, с правками не связан. Урок lesson-29 создан и связан. Что осталось: мелочь — вторая попытка полного прогона показала, что локальный флак воспроизводим не всегда (см. выше).
---
author: @agent
created: 2026-10-25 18:47
---
Фаза Close выполнена. Ветка vb/vl-178 слита в master (1 коммит a4daeb6, merge без конфликтов), worktree удалена (untracked-симлинки node_modules/refs — force), ветка удалена. pnpm build && pnpm test после merge — зелёные (67 файлов, 1181 тест). DoD (все 3 из 3): Тесты проходят ✓, Документация обновлена ✓, Нет регрессий ✓. Уроки: lesson-29 (связана в Code), lesson-20 (связан с VL-178 — флак reference.test.mjs из отчёта Code), lesson-30 создан (cap tool-выводов в единой точке loop — handler-капы не покрывают MCP) — все три закоммичены (e3c37f0). Документация: запись в CHANGELOG.md Unreleased (Исправлено) + doc-10 §6.2 «Cap tool-выводов и автоповтор при отказе провайдера (VL-178)» — коммит bc04af8. Файлы задачи коммитятся следующим шагом.
---
<!-- COMMENTS:END -->