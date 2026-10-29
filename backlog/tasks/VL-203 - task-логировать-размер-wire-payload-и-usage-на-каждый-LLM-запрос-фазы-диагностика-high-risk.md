---
id: VL-203
title: Логировать wire-payload и usage LLM-запросов фазы
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 23:59'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - core
  - agent
dependencies: []
milestone: v1.10
references: []
priority: low
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/llm.ts
  - src/agent/loop.ts
  - src/agent/cli.ts
  - src/agent/session.ts
  - src/agent/llm.test.mjs
  - src/agent/loop.test.mjs
  - src/agent/cli.test.mjs
lessons:
  - lesson-1
  - lesson-18
  - lesson-2
  - lesson-30
  - lesson-37
  - lesson-39
  - lesson-40
  - lesson-44
  - lesson-54
  - lesson-55
  - lesson-60
  - lesson-64
token_usage:
  input: 7866133
  output: 121072
  cache: 7605120
  total: 7987205
  requests: 94
  duration_ms: 1723040
  reasoning: 94772
  by_phase:
    spec:
      input: 129223
      output: 3531
      cache: 100224
      requests: 5
    Plan:
      input: 1374710
      output: 49812
      cache: 1281408
      requests: 25
    plan:
      input: 365174
      output: 626
      cache: 363136
      requests: 3
    code:
      input: 5997026
      output: 67103
      cache: 5860352
      requests: 61
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-197. Отказ «high risk» в VL-197 случился при payload ~140 КБ (все tool-выводы усечены до 8 КБ) — аномально мало для размерного отказа (VL-178 ловил 1.25 МБ). Чтобы отличать content-based отказ от размерного, фазовый лог/JSONL-мета должны содержать размер тела запроса, usage по ходам и уровень компакшна. Данные нужны для решения №1 (какую защиту усиливать).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В diagnostics-выводе фазы (logTail/лог оркестратора) есть байты payload и usage последнего запроса.
- [x] #2 Отказ провайдера сопровождается этими числами в логе (проверить на мок-fetch тесте).
- [x] #3 Фазовый лог / JSONL-мета фиксирует размер тела запроса, usage по ходам и уровень компакшна tool-выводов
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст (что уже есть)

- `src/agent/llm.ts:809-824` — VL-199 уже логирует в stderr (→ logTail оркестратора) диагностику ТОЛЬКО при отказе «high risk»: payload в байтах, shrink-уровень, usage (на HTTP-200-пути) / `usage=н/д` (на HTTP-отказе — usage в теле ошибки нет).
- Тесты VL-199 в `src/agent/llm.test.mjs:463-509` (fakeFetch) покрывают оба отказных пути.
- `usage` по ходам уже пишется в JSONL-транскрипт: assistant-сообщения несут поле `usage` (VL-198, `src/agent/loop.ts:372`).
- Мета сессии `<id>.meta.json` (`src/agent/session.ts`, `SessionMeta:129-160`) хранит кумулятивный usage, но НЕ хранит размер payload.
- Итоговый JSON stdout (`src/agent/cli.ts:705-715`) не содержит payload-байт.

## Проблема

Отказ «high risk» в VL-197 произошёл при ~140 КБ (против 1.25 МБ в VL-178) — нет данных, чтобы отличить content-based отказ от размерного: байты payload и usage последнего запроса видны только в момент отказа (и то usage — н/д), по ходам фазы не фиксируются, уровень компакшна tool-выводов не сохраняется нигде кроме stderr-строки отказа.

## Изменяемые файлы

### 1. `src/agent/llm.ts`
- **Строка 40** (тип `ChatMessage`, assistant-вариант): добавить опциональные поля `payload_bytes?: number` и `shrink_level?: number` — уходят в JSONL-транскрипт, провайдеру НЕ передаются (см. п.3).
- **Строки 64-68** (`LlmResponse`): добавить `payloadBytes?: number` (wire-размер последнего фактического запроса) и `shrinkLevel?: number` (0=full, 1=4096, 2=1024).
- **~Строка 716** (в `createLlmClient`, рядом с `url`): объявить closure-переменные:
  - `let lastRequestBytes = 0;` — байты последнего сериализованного wire-body;
  - `let lastUsage: LlmUsage | null = null;` — usage последнего УСПЕШНОГО ответа (для лога отказа).
- **Строки 742-751** (`requestWithRetry`, `JSON.stringify(...)` в `fetch`): вынести сериализацию в `const wireBody = JSON.stringify(...)`, передавать `body: wireBody`, после чего `lastRequestBytes = Buffer.byteLength(wireBody, 'utf8')` (до fetch, чтобы байты были от фактического тела включая `stream`/`stream_options`).
- **Строки 805-814** (`streamChat`, после `attemptWithFallback`): перед `return res` проставить `res.payloadBytes = lastRequestBytes; res.shrinkLevel = shrinks; lastUsage = res.usage;`.
- **Строка 823** (лог HTTP-отказа): заменить `usage=н/д` на `usage=${lastUsage ? JSON.stringify(lastUsage) + ' (предыдущего успешного запроса)' : 'н/д'}` — AC2: отказ сопровождается и usage, когда он есть.
- **Строки 365-373 / 331 loop** затронут через `ChatMessage` (см. п.2).

### 2. `src/agent/loop.ts`
- **Строки 53-65** (`LoopResult`): добавить `last_payload_bytes?: number` и `max_payload_bytes?: number`.
- **~Строка 235** (рядом с `lastPromptTokens`): объявить `let lastPayload: number | undefined; let maxPayload: number | undefined;` — объявления ДО `fail()` (строка 247), чтобы fail-возвраты их включали.
- **После строки 298** (после `addUsage`, успешный response): `if (response.payloadBytes !== undefined) { lastPayload = response.payloadBytes; maxPayload = Math.max(maxPayload ?? 0, response.payloadBytes); }`.
- **Строка 331** (pushMessage финального assistant) и **строки 365-373** (pushMessage assistant с tool_calls): дописать в сообщение `...(response.payloadBytes !== undefined ? { payload_bytes: response.payloadBytes } : {}), ...(response.shrinkLevel !== undefined ? { shrink_level: response.shrinkLevel } : {})` — фиксация в JSONL по ходам (AC3: размер тела запроса + уровень компакшна tool-выводов; usage по ходам уже есть).
- **Все `return {...}` в `fail()` (252) и success (332)**: добавить `last_payload_bytes: lastPayload, max_payload_bytes: maxPayload`.

### 3. `src/agent/llm.ts` — защита wire-совместимости (уже работает, проверить!)
- `toWireMessages` (строки 284-310) и `messagesToInput` (345-382) собирают assistant-сообщения ЯВНО (role/content/tool_calls) — новые поля `payload_bytes`/`shrink_level`/`usage` провайдеру не уйдут. Тест-регрессия: в `llm.test.mjs` убедиться, что в wire-body нет `payload_bytes`.

### 4. `src/agent/session.ts`
- **`SessionMeta` (~строка 129-160)**: добавить `last_payload_bytes?: number` и `max_payload_bytes?: number` (JSONL-мета фиксирует размер тела запроса, AC3).

### 5. `src/agent/cli.ts`
- **Блок 3 post-run (строки 685-694, `updateSessionMeta`)**: в patch дописать `...(loopResult.last_payload_bytes !== undefined ? { last_payload_bytes: loopResult.last_payload_bytes } : {})` и аналогично `max_payload_bytes`.
- **~Строка 700-703** (перед блоком «Единственная строка stdout», ПОСЛЕ `tui.unmount()`): одна итоговая строка:
  `console.error(`[vibelog-agent] фаза: запросов=${loopResult.num_turns}, payload последнего запроса=${loopResult.last_payload_bytes ?? 'н/д'} байт (макс ${loopResult.max_payload_bytes ?? 'н/д'}), usage=${JSON.stringify(loopResult.usage)}`);`
  — AC1: байты payload и usage последнего запроса всегда в stderr → logTail оркестратора (хвост 50 строк, `src/web/orchestrator.ts:50`).

### 6. Тесты
- **`src/agent/llm.test.mjs`**:
  - Новый тест: успешный ответ → `res.payloadBytes > 0`, `res.shrinkLevel === 0`; повтор после high-risk → `shrinkLevel === 1` (или расширить существующий shrink-тест).
  - Новый тест (AC2, мок-fetch): 1-й вызов `streamChat` — успех с usage, 2-й вызов — high-risk 400 → в stderr-логе `usage=` содержит JSON предыдущего успешного ответа (не `н/д`); payload=`\d+ байт`.
  - Существующие тесты VL-199 (463-509) оставить зелёными: при отказе с первого запроса `usage=н/д` сохраняется.
  - Регрессия wire: в теле запроса (state.bodies) нет `payload_bytes`/`shrink_level`.
- **`src/agent/loop.test.mjs`**: fake llm возвращает `payloadBytes`/`shrinkLevel` → assistant-сообщения в `res.messages` содержат `payload_bytes`/`shrink_level` (и существующее `usage`); `res.last_payload_bytes`/`max_payload_bytes` заполняются; при ответах без этих полей — undefined, без NaN (паттерн частичного usage из fakeLlm).
- **`src/agent/cli.test.mjs`**: headless-ран (mock HTTP LLM-сервер, хелпер `runCli`) → stderr содержит строку `/payload последнего запроса=\d+ байт/` и `usage=`; `<id>.meta.json` содержит `last_payload_bytes`.

### 7. Документация
- **`backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`, §6.2** — обновить пункт про диагностику: итоговая stderr-строка фазы, поля JSONL `payload_bytes`/`shrink_level`, поля меты `last_payload_bytes`/`max_payload_bytes`, usage предыдущего запроса в логе HTTP-отказа. Править ТОЛЬКО через MCP `document_update` (файл в backlog/).
- **`CHANGELOG.md`** — запись VL-203 (в корне, правится файлом).

## Порядок действий

1. `llm.ts`: типы → closure-переменные → wireBody/байты → attach в response → лог отказа с usage.
2. `loop.ts`: тип LoopResult → переменные до fail → учёт после response → поля в pushMessage + все return.
3. `session.ts`: поля SessionMeta.
4. `cli.ts`: meta-patch + итоговая stderr-строка.
5. Тесты: llm → loop → cli.
6. Документация (doc-10 через MCP, CHANGELOG).
7. Проверка: `pnpm build && pnpm test` (полный: build + vitest).

## Как проверить

```bash
pnpm build && pnpm test
```
Отдельно: `pnpm test:fast` для итераций (dist собран). Ручная проверка AC1 — после прогона фазы в stderr найти строку «payload последнего запроса=… байт».

## Риски

- **Новые поля в assistant-сообщениях JSONL**: старые сессии без них — undefined (ок); resume → `toWireMessages`/`messagesToInput` собирают assistant явно — поля НЕ уйдут провайдеру (риск №3 плана VL-198, уже решён тем же паттерном для `usage`). Покрыть wire-тестом.
- **TUI**: итоговая строка печатается после `tui.unmount()` — альтернативный буфер закрыт, рендер не ломается.
- **Шум в stderr**: НЕ логируем payload на каждый успешный запрос (шум + ломает TUI-стриминг) — только итоговая строка фазы + строки отказов (существующие).
- **fake llm в loop.test** не возвращает новые поля — они optional, тесты не падают.
- Объявление переменных payload-учёта должно стоять ДО `fail()` (lesson: fail определяется раньше цикла) — иначе TypeScript «used before assigned»/не попадут в возврат.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 06:52
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Логировать wire-payload и usage LLM-запросов фазы» (был длиннее 80 символов с префиксом типа). Тип: enhancement (улучшение существующей диагностики фазового лога). Масштаб: task. Приоритет: Low (по предложению №5 из VL-197 — nice-to-have диагностика; критичности нет). Уточнено: цель — фиксировать в фазовом логе/JSONL-мете байты wire-payload тела запроса, usage по ходам и уровень компакшна tool-выводов, чтобы отличать content-based отказ провайдера от размерного (контекст: отказ «high risk» при ~140 КБ в VL-197 против 1.25 МБ в VL-178); AC дополнены пунктом про фиксацию уровня компакшна в JSONL-мете. Labels: core, agent. References: нет (VL-197 — внутренняя задача, не внешний источник). Вопросов нет.
---
author: @agent
created: 2026-10-27 07:10
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 6 файлов (src/agent/{llm,loop,cli,session}.ts + тесты llm/loop/cli.test.mjs) + документация (doc-10 §6.2 через MCP, CHANGELOG). Суть: (1) closure-переменные в createLlmClient — байты фактического wire-body и usage последнего успешного ответа; лог HTTP-отказа теперь содержит usage предыдущего запроса вместо «н/д» (AC2); (2) LlmResponse получает payloadBytes/shrinkLevel → loop пишет payload_bytes/shrink_level в assistant-сообщения JSONL и в LoopResult.last/max_payload_bytes (AC3); (3) итоговая stderr-строка фазы в cli.ts с байтами payload и usage → logTail оркестратора (AC1); (4) SessionMeta += last_payload_bytes/max_payload_bytes. Wire-совместимость: toWireMessages/messagesToInput собирают assistant явно — новые поля провайдеру не уходят (паттерн VL-198), покрыть регрессионным тестом. Тесты: мок-fetch на отказ с usage предыдущего запроса, payload_bytes в JSONL, stderr-строка в cli-тесте. Риски: порядок объявления переменных до fail(), не добавлять per-request логи (шум/TUI), старые сессии без полей — undefined. Проверка: pnpm build && pnpm test. Изменений кода нет — только план.
---
author: @agent
created: 2026-10-27 07:19
---
Фаза 3 (Code) выполнена. Изменено: src/agent/{llm,loop,cli,session}.ts + llm/loop/cli.test.mjs, коммит f764dac. Реализация по плану: (1) llm.ts — closure lastRequestBytes/lastUsage в createLlmClient, сериализация wire-body вынесена до fetch (байты от фактического тела включая stream-флаги), LlmResponse += payloadBytes/shrinkLevel, лог high-risk-отказа HTTP теперь содержит usage предыдущего успешного запроса вместо «н/д»; (2) loop.ts — LoopResult += last_payload_bytes/max_payload_bytes (объявлены ДО fail()), учёт после каждого response, payload_bytes/shrink_level дописываются в assistant-сообщения JSONL (usage по ходам уже был, VL-198); (3) session.ts — SessionMeta += last_payload_bytes/max_payload_bytes; (4) cli.ts — meta-patch пост-рана + итоговая stderr-строка «фаза: запросов=N, payload последнего запроса=X байт (макс Y), usage={...}» после tui.unmount() → logTail оркестратора. Проверки: pnpm build + pnpm test — 79 файлов / 1430 тестов зелёные (+7 в статике), новых тестов: llm 4 (payloadBytes/shrinkLevel, shrinkLevel=1 после повтора, AC2-мок: usage предыдущего запроса в логе отказа, wire-регрессия payload_bytes/shrink_level не уходят провайдеру), loop 3 (JSONL-поля + LoopResult, мок без полей → undefined, fail-путь), cli 1 (AC1: stderr-строка + мета + JSONL). AC: все 3 подтверждены тестами. DoD: тесты — да, регрессий нет (полный прогон зелёный) — да; ДОКУМЕНТАЦИЯ НЕ ОБНОВЛЕНА — по правилам фазы Code CHANGELOG.md и backlog/docs (doc-10 §6.2) правит фаза Close после слияния, упомяни её в close-чек-листе. Lessons: создан lesson-64 (одна точка сериализации wire-body), связан с задачей. References не использовались.
---
author: @agent
created: 2026-10-27 11:35
---
Фаза Close выполнена. Статус: Done. Коммиты: feat f764dac (код + тесты: src/agent/{llm,loop,cli,session}.ts + llm/loop/cli.test.mjs), docs bb8e35b (CHANGELOG.md + doc-10 §6.2 — диагностика payload/usage), refs/lessons a679c84 (lesson-64). Не закоммичено: файлы чужих задач/фаз (VL-197, VL-202, VL-36, VL-124, ref-5, ref-16, doc-14 — не относятся к VL-203). DoD-2 (документация) закрыт: doc-10 §6.2 обновлён, запись в CHANGELOG.md Unreleased.
---
<!-- COMMENTS:END -->