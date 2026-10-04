---
id: doc-4
title: 'Ресёрч: LLM-агент Vibelog (VL-75)'
type: guide
created_date: 2026-10-04
tags:
  - vl-75
  - research
  - llm-agent
  - ink
  - mcp
  - cloud-ru
  - tool-calling-loop
  - headless
---
# Ресёрч: LLM-агент Vibelog (VL-75)

Исследование для Фазы 2 (Plan) эпика VL-75 «Создать свой агент Vibelog — минимальный LLM-агент с TUI на Ink вместо Qwen.md». Зависимость VL-76 (клонирование референсов) выполнена — все ссылки на `refs/` воспроизводимы через `scripts/clone-refs.mjs`. Источники читались статически (клоны локальные, в `.gitignore`). Все 12 референсов задокументированы в doc-3 «Референсные проекты (refs/)» (§12 — qwen-code, добавлен при доработке VL-76).

---

## 1. Локальный контракт интеграции (src/ — точные пути)

### 1.1 Контракт stdout: `src/web/qwen-result.ts`

- **`:21-35`** — интерфейс `QwenResult` (JSON `type=result`): `result`, `is_error`, `num_turns`, `duration_ms`, `duration_api_ms`, `session_id`, `usage{input_tokens, output_tokens, cache_read_input_tokens, total_tokens}`.
- **`:39-70`** — `toQwenResult`: отсутствующие поля → дефолты `0/''/false`, лишние игнорируются; при `is_error` текст ошибки берётся из `error.message` как фолбэк.
- **`:75-88`** — `findResult`: объект либо массив; массив обходится **с конца** (result — последнее сообщение сессии).
- **`:92-160`** — `parseQwenResult`: два реальных формата stdout —
  1. **NDJSON-поток** (stream-json): обход строк с конца;
  2. **строка-массив** `[{init},{assistant},…,{result}]` (json-адаптер qwen 0.24.x): парсинг строки целиком, поиск с конца;
  3. фолбэк: весь лог — один JSON-документ (pretty-printed). Битые строки пропускаются.
- **`:162+`** — `explainQwenParse`: диагностика (счётчики JSON-строк/массивов, найден ли result) — печатается оркестратором при нераспознанном результате (наследие VL-63).

**Вывод для агента:** headless-режим `vibelog-agent` обязан печатать финальный результат в формате `type=result` — тогда оркестратор/бот/web не меняются вообще.

### 1.2 Spawn оркестратора: `src/web/orchestrator.ts`

- **`:187`** — `bin = process.env.VIBELOG_QWEN_BIN || 'qwen'`.
- **`:193-210`** — `spawn(bin, [prompt, '--approval-mode', 'yolo', '--output-format', 'json', ...phaseFlags], { cwd, stdio: 'pipe' })`:
  - промпт — **позиционный** аргумент (`-p` у qwen deprecated);
  - `--allowed-mcp-server-names vibelog` — **только** для фаз spec/plan (флаг `phaseFlags`);
  - для prompt/comment флагов нет.
- **VL-63 (важно!):** stdout и stderr — **строго два независимых буфера**. Раньше stderr-строка (Warning, лог MCP), пришедшая внутрь незавершённой JSON-строки stdout, ломала result «в половине случаев». `--json-file/--json-fd` НЕ использовать — qwen 0.24.x в headless-режиме их игнорирует (проверено `scripts/qwen-json-probe.mjs`). Лог stdout обрезается до `LOG_TAIL_LINES` хвоста.
- Таймлайн VL-58: строки потоков печатаются с таймстемпом; probe тишины — `lastOutputAt`.

**Вывод для агента:** тот же argv-контракт (позиционный промпт + yolo + json) делает переключение оркестратора на агента тривиальным (`VIBELOG_AGENT_BIN`); разделение stdout/stderr обязательно и в агенте.

### 1.3 MCP-протокол vibelog: `src/mcp/server.ts`

- **`:116-125`** — методы: `initialize`, `notifications/initialized` (без ответа), `tools/list`, `tools/call`, `ping`; неизвестный метод с id → `-32601`; parse error → `-32700`; исключение → `-32603`.
- **`:161`** — `protocolVersion: '2024-11-05'`, `capabilities: { tools: {} }`, `serverInfo: { name: 'vibelog-md', version }`.
- **`:186-228`** — ответ `tools/call`: успех — `{content:[{type:'text', text}]}` (нестроковый результат сериализуется `JSON.stringify(result, null, 2)`); ошибка инструмента — `{content:[{type:'text', text:'Ошибка: …'}], isError: true}` (HTTP-ошибки MCP-уровня не отдельным кодом, а isError-флагом); `tools/call` без `name` → `-32602 'Missing tool name'`.
- **Формат фреймов:** newline-delimited JSON-RPC 2.0 поверх stdin/stdout, **без Content-Length** (строка → `JSON.parse`).
- Известная гонка (сохранена по оригиналу VL-4): на `rl.on('close')` ответ сбрасывается через `process.stdout.write('', callback)` перед `exit(0)`.
- **21 инструмент:** backlog_×11, milestone_×5, document_×5 (`src/mcp/tools.ts`).

### 1.4 Шаблоны фаз и конфиг

- `templates/qwen-commands/` — `phase-1.md` (Spec), `phase-2.md` (Plan), `phase-3.md` (Code), `phase-close.md`, `phase-comment.md`, `prompt.md`, `spec.md`, `plan.md`, `code.md`. Плейсхолдеры: `{{taskId}}`, `{{comment}}`, `{{prompt}}` (проверено grep'ом). **Новый агент переиспользует их без изменений** — шаблоны говорят «исполнитель Vibelog», не «qwen».
- `.qwen/settings.json:6-7` — `mcpServers.vibelog: { command: 'vibelog', args: [mcp, start] }` — MCP-интеграция живёт на уровне конфига агента, кодом не зашита.

---

## 2. Опыт vibe-kanban — ближайший аналог оркестратора (refs/vibe-kanban, Rust)

### 2.1 Спавн агентов: `crates/executors/src/executors/`

- Модульная структура: `qwen.rs`, `gemini.rs`, `opencode.rs`, `claude.rs`, `codex.rs`, `cursor.rs`, `droid.rs`, `copilot.rs`, `amp.rs`, `acp/`, `opencode/`, `mod.rs`, `utils.rs` — по одному файлу на агента поверх общего `StandardCodingAgentExecutor` (spawn, spawn_follow_up, apply_overrides).
- **qwen.rs:44-58** — `CommandBuilder::new('npx -y @qwen-code/qwen-code@0.9.1')` + `--model` (опц.), `--yolo` (опц.), `--acp`; переопределения профиля через `CmdOverrides`.
- **gemini.rs:84-135** — `spawn()` и `spawn_follow_up()` раздельно: follow-up идёт через **ACP-харнесс** (`AcpAgentHarness`) с `session_id` — держать сессию живой между ходами. Prompt склеивается через `AppendPrompt.combine_prompt(prompt)`.
- `utils.rs` — TTL-кэш executor-options (`executor_options_cache`, `preload_global_executor_options_cache`) — опции агента узнаются один раз и кэшируются.

**Переиспользовать:** единый интерфейс executor'а (spawn/follow-up/overrides) и паттерн «опции агента — кэш, не пересчёт на каждый запуск».

### 2.2 MCP-конфиг для агентов: `crates/executors/src/mcp_config.rs` + `mod.rs:127-150`

- `McpConfig { servers_path, template, preconfigured, is_toml_config }` — **каждый агент имеет свой формат конфига**: Codex — TOML `mcp_servers`, Amp — JSON `amp.mcpServers`, Opencode — JSON `mcp` + `$schema`, Gemini/Qwen — `~/.gemini/settings.json` и т.д. (`get_mcp_config()` в mod.rs).
- `read_agent_config`/`write_agent_config` — чтение/запись JSON/JSONC/TOML с сохранением комментарией (jsonc-parser CST, deep-merge) — **не перезаписывать пользовательский конфиг агента целиком**.
- `PRECONFIGURED_MCP_SERVERS` — из `default_mcp.json` (include_str!) — бандл предконфигурированных MCP-серверов.

**Переиспользовать:** для Vibelog-agent MCP-конфиг — статический JSON `{mcpServers:{vibelog:{command:'vibelog',args:['mcp','start']}}}` (как у opencode/gemini), писать аккуратно (merge, не overwrite). **Ключевой вывод: у Vibelog-agent свой конфиг не нужен — `.qwen/settings.json` уже содержит vibelog; агент может поднимать MCP-сервер напрямую из своего конфига.**

---

## 3. MCP stdio-клиент: refs/typescript-sdk (modelcontextprotocol/typescript-sdk)

Структура репо: `packages/{client, core, core-internal, server, middleware, codemod, server-legacy}` + `common/`, `examples/`, `docs/`.

### 3.1 Транспорт stdio: `packages/client/src/client/stdio.ts`

- **`:10-40`** — `StdioServerParameters`: `command`, `args`, `env` (дефолт — `getDefaultEnvironment()`, whitelist наследуемых переменных), `stderr` (дефолт `'inherit'`), `cwd`, `maxBufferSize` (**10 MB**, дефолт).
- **`:107+`** — `StdioClientTransport implements Transport`: `start()` — `spawn(command, args, { env: {...getDefaultEnvironment(), ...env}, stdio: ['pipe','pipe', stderr ?? 'inherit'], shell: false })`; события `onclose/onerror/onmessage`; stdout → `ReadBuffer.append(chunk)`; **`stderr === 'pipe'` → `PassThrough` доступен ДО start()** (чтобы не потерять ранний stderr).

### 3.2 Фрейминг: `packages/core-internal/src/shared/stdio.ts`

- **`:60`** — `serializeMessage = JSON.stringify(message) + '\n'` — **newline-delimited, без Content-Length**.
- `ReadBuffer.readMessage()`: буфер → по `\n` → `deserializeMessage(line)`; **не-JSON-строки пропускаются** (SyntaxError → continue; schema-ошибки → throw); лимит буфера 10 MB, превышение → error + clear.

**Совместимость с vibelog mcp start подтверждена:** формат фреймов идентичен (newline-delimited JSON-RPC).

### 3.3 Цикл запросов: `packages/client/src/client/client.ts` + `packages/core-internal/src/shared/protocol.ts`

- `Client.connect()` → `initialize` handshake (`protocolVersion`, capability-negotiation, fallback на legacy `initialize`); `assertCapability(capability, method)` перед вызовами (`:947`); `setNotificationHandler`; кэш `tools/list` (`listTools` cacheMode refresh, `:764`); `_resetConnectionState` при реконнекте.

**Решение (ADR-1):** минимальный самописный клиент — сервер Vibelog отвечает статически (21 инструмент, tools-only), SDK-возможности (auth, resources, http-транспорты, кэш) избыточны.

---

## 4. TUI на Ink: gemini-cli и opencode

### 4.1 refs/gemini-cli — прямой референс Ink

- **`package.json:82,155`** — `"ink": "npm:@jrichman/ink@6.6.9"` (форк, без нативных модулей) + `react 19.2.x`, `@types/react 19.2.0`.
- Вход: `packages/cli/src/gemini.tsx`, `interactiveCli.tsx`, `nonInteractiveCli.ts` (+`nonInteractiveCliAgentSession.ts` — headless-сессии с agent'ом).
- TUI-слой `packages/cli/src/ui/`: `App.tsx`/`AppContainer.tsx`, `components/` (~60 компонентов), `hooks/`, `contexts/`, `commands/`.
- **Стриминг:** `hooks/useGeminiStream.ts` + `useAgentStream.ts` — событийная обработка: `processGeminiStreamEvents` (`:1533`), `handleInvalidStreamEvent` (`:1251`); partial-ответы модели поддерживаются (`:914` — «sending partial results back to the model»).
- **Счётчики:** `StatsDisplay.tsx:106-131` — `tokens.cached/prompt/candidates` (по сессии и по роли), `:231,243` — duration; `ContextUsageDisplay.tsx` — заполнение контекста; `ToolStatsDisplay.tsx` — статистика инструментов; `ModelStatsDisplay.tsx`, `QuotaStatsInfo.tsx` — квоты.
- **Tool calls:** отдельные компоненты очереди/подтверждений: `ToolConfirmationQueue.tsx`, `BackgroundTaskDisplay.tsx`; статусная строка: `StatusDisplay/StatusRow/HookStatusDisplay/MemoryUsageDisplay`.

### 4.2 refs/opencode — НЕ Ink

- `packages/tui` использует **@opentui/solid** (`app.tsx:1` — `@opentui/solid`, `@opentui/core`, `@opentui/keymap`); React-стека нет. `packages/session-ui`, `packages/console` — веб/консольные оболочки.

**Вывод (ADR-2):** для Vibelog брать gemini-cli как рендер-референс (Ink@jrichman + React); opencode TUI релевантен только по UX-паттернам, не по технологиям.

### 4.3 Универсальные TUI-паттерны (вывод из обоих)

1. Стриминг токенов → очередь частичных сообщений, ререндер по событию (Ink `useState` + reducer-события).
2. Tool call → карточка: имя, аргументы (сворачиваемые), статус (pending/running/done/error), длительность.
3. Счётчики → нижняя статус-строка: токены in/out/cached, время сессии, заполнение контекста, стоимость.
4. Ошибки → inline-блок с текстом и возможностью retry; TUI не падает на ошибке API.

---

## 5. Tool-calling loop: loop detection и лимиты

### 5.1 refs/opencode — шаги агента и отключение инструментов

- `packages/core/src/v1/config/agent.ts:37,55,79` — `maxSteps` (deprecated) → `steps` (PositiveInt) — лимит шагов агента в конфиге.
- `packages/core/src/session/runner/llm.ts`: `:38` — `MAX_STEPS_PROMPT` (промпт-напоминание о пределе); `:54` — «Honor optional agent step limits»; `:90` — «Configured agent step limits bound the loop»; `:202` — `isLastStep = agent.info.steps !== undefined && currentStep >= agent.info.steps`; `:254` — при пределе: **«Tools are disabled after the maximum agent steps»** (failUnsettledTools) — не убийство процесса, а мягкое отключение инструментов с сообщением модели.
- Компакция: `ContinueAfterCompaction`/`ContinueAfterOverflowCompaction` (`:154-166`) — цикл продолжается после компакции контекста, счётчик step сохраняется.

### 5.2 refs/cline — recovery-nudge и retry-политика

- `sdk/packages/agents/src/agent-runtime.ts:61-75` — `MAX_TOKENS_RECOVERY_LIMIT = 3`: обрыв по output-токенам → нудж «будь краток, делай по одному шагу» (MAX_TOKENS_RECOVERY_NUDGE); счётчик consecutive cut-off resets; **один обрыв восстанавливается, серия — нет**.
- `:79-87` — `PROVIDER_ERROR_MAX_RETRIES = 3` — retry на ошибки провайдера (rate limits, 5xx, network) на уровне runtime.
- Семантика: «loop judges» — runtime наблюдает, loop принимает решения (recovery передаётся loop'у «unjudged»).

### 5.3 refs/pi — двухконтурный цикл с AbortSignal

- `packages/agent/src/agent-loop.ts:161-260` — `runLoop`: **внешний цикл** (follow-up/steering-сообщения после остановки агента) + **внутренний цикл** (tool calls + steering); `prepareNextTurn`/`prepareRequest`/`finishTurn` — хуки между ходами (компакция, смена модели/thinking-level); стоп по `stopReason: 'error' | 'aborted'` → `agent_end`; **`AbortSignal` прокидывается через все операции** (stream, prepare).
- `agent.ts:183+` — `Agent` — stateful-обёртка над loop; события `agent_end` = «no further loop events».

### 5.4 refs/hermes-agent (Python) — retry во внешнем loop

- `agent/anthropic_adapter.py:360,508` — `max_retries=0` в SDK: **retry/rate-limit делегируются внешнему conversation loop** (honors Retry-After); SDK-backoff выключен намеренно.
- `agent/agent_runtime_helpers.py:2103` — та же модель: внешний loop ведёт retry-политику (5xx/429).

### 5.5 refs/mastra, refs/openclaw — честные заглушки

- **mastra** — TypeScript-фреймворк AI-агентов (packages: core, evals, …); maxSteps используется в AI-SDK-стиле (`model.test.ts:90` — `maxSteps: 5`); собственного loop-detection сверх AI-SDK не найдено (grep по packages/core). Релевантен как библиотека, не как референс loop'а.
- **openclaw** — «Multi-channel AI gateway with extensible messaging integrations» (package.json) — шлюз для мессенджеров, не coding-agent; loop-логики в пределах `src/` не выделена (grep — совпадения только в test-utils/pairing). Для VL-75 нерелевантен.

### 5.6 Сводная модель loop detection/лимитов (→ ADR-4)

| Механизм | Референс | Семантика для Vibelog |
|---|---|---|
| Лимит шагов/инструментов | opencode `steps` | `--max-tool-calls`, по достижении — мягкая остановка с partial-результатом |
| Wall-clock лимит | pi (AbortSignal) | `--max-wall-time` + таймер → AbortSignal |
| Детектор зацикливания | cline consecutive-cut-off | N≥3 идентичных tool-call подряд → стоп с диагностикой |
| Nudge вместо смерти | cline MAX_TOKENS_RECOVERY_NUDGE, opencode MAX_STEPS_PROMPT | одна «неудача» → нудж модели; серия → стоп |
| Retry провайдера | cline PROVIDER_ERROR_MAX_RETRIES=3, hermes (Retry-After) | 429/5xx/сеть → ≤3 retry с backoff, вне лимита tool-calls |
| Стоп-сигналы | pi stopReason | error/aborted/limit/detector — единый стоп-контракт |

---

## 6. Cloud.ru API (Evolution Foundation Models)

Документация `docs.cloud.ru` **не резолвится** (ENOTFOUND — проверено web_fetch); данные собраны с `cloud.ru` (страницы продуктов и docs.cloud.ru-ссылок через основной домен).

### 6.1 Факты (подтверждено документацией cloud.ru)

- **Продукт:** Evolution Foundation Models — «Публичный OpenAI-совместимый API»; страница: cloud.ru/products/evolution-foundation-models.
- **Base URL: `https://foundation-models.api.cloud.ru/v1`** (дословно из quickstart: `url = "https://foundation-models.api.cloud.ru/v1"`, клиент `OpenAI(api_key=api_key, base_url=url)`, endpoint `chat.completions`).
- **Аутентификация:** API-ключ сервисного аккаунта (Консоль → Пользователи → Сервисные аккаунты → Учетные данные доступа → Создать API-ключ, сервис Foundation Models, срок 1 день–1 год, **Key Secret сохраняется один раз**); библиотека openai шлёт его как `Authorization: Bearer` (стандарт OpenAI). Переменная окружения `API_KEY`.
- **Модели** (namespace/model, каталог cloud.ru/products/evolution-ai-factory/catalog-foundation-models): `ai-sage/GigaChat3.5-432B-A28B-Reasoning` (262K), `moonshotai/Kimi-K2.6` (262K), `zai-org/GLM-5.1` (202K), `deepseek-ai/DeepSeek-V4-Pro` (1M); семейства gpt-oss, DeepSeek, Qwen; «более 20 обновляемых моделей»; цены — поимённо (₽/1M токенов in/out).
- **Function Calling — поддерживается явно**; Structured Output — заявлен; Reasoning — заявлен.
- **Streaming (SSE)** — на продуктовой странице **не подтверждён явно** (OpenAI-совместимость предполагает `stream=true`) → **проверить фактическим запросом до интеграции в TUI**; fallback — non-streaming.
- **Rate limit: 20 RPS на API-ключ**; больше — приватный экземпляр Evolution ML Inference (GPU V100/A100/H100).
- **Free Tier:** cloud.ru/offers/free-tier. Регион — российские серверы (требования к данным).

### 6.2 Замечания для реализации LLM-клиента

- Формат запроса/ответа — стандартный OpenAI chat/completions (`choices[0].message.content`); tools/tool_choice — в теле запроса (Function Calling заявлен).
- usage-поля Cloud.ru могут отличаться от qwen (cache_read может отсутствовать → дефолт 0 в toQwenResult — парсер не ломается).
- Источники: cloud.ru/products/evolution-foundation-models; /docs/foundation-models/ug/topics/{api-ref, api-ref__authentication, quickstart}.

---

## 7. Решения (ADR)

MCP-инструмента decisions в vibelog нет (tools.ts — backlog_×11/milestone_×5/document_×5) — решения созданы через CLI `vibelog decision create` (ADR-формат Context/Decision/Consequences/Alternatives), все в статусе **proposed** (подтверждение — Фаза 2 VL-75):

1. **decision-1** — «MCP-клиент агента Vibelog — минимальный самописный (без typescript-sdk)» — newline-delimited JSON-RPC, initialize/tools/list/tools/call; SDK избыточен (tools-only capabilities, 21 инструмент).
2. **decision-2** — «TUI агента Vibelog — Ink (форк @jrichman/ink), без нативных модулей» — как в gemini-cli; React-стек; opencode (@opentui/solid) — не берём.
3. **decision-3** — «LLM-клиент Cloud.ru — OpenAI-совместимый через undici fetch (без openai-SDK)» — base URL `https://foundation-models.api.cloud.ru/v1`, Bearer-ключ, ноль новых зависимостей; риск — неподтверждённый streaming (fallback non-streaming).
4. **decision-4** — «Loop detection и лимиты — двойной предел + дедупликация вызовов» — `--max-tool-calls`/`--max-wall-time` + детектор N≥3 идентичных вызовов + retry ≤3 (429/5xx, Retry-After) — по §5.6.
5. **decision-5** — «Headless-режим — stdout в формате parseQwenResult (JSON type=result), qwen — фолбэк» — оркестратор/бот/web не меняются; переключение — `VIBELOG_AGENT_BIN`; шаблоны phase-*.md без изменений.

Файлы: `backlog/decisions/decision-{1..5}-*.md`. Статус proposed — при реализации VL-75 Фаза 2 уточняет значения по умолчанию (лимиты, модели).

---

## 8. Roadmap-разделы (по запросу Pavel, Фаза Comment VL-77)

Полные разделы «План на текущую версию (v1.7)» и «План на следующую версию (v1.8)» добавлены в `docs/research/FEATURES-COMPARISON.md` (конец файла, 422 → 522 строки) — 6 пунктов v1.7 (P0: ресёрч VL-77 + ядро агента VL-75 + headless-интеграция; P1: VL-78, VL-36) и 5 пунктов v1.8 (P1: TUI на Ink AC#3, полный переход фаз + метрики токенов; P2: хвосты таблицы 3.1, Web UI фильтры, task attempt) с блоком критериев завершения версии. Краткая сводка для Фазы 2 VL-75:

- **v1.7 (текущая линия):** ядро агента (LLM-клиент Cloud.ru + tool-calling loop + инструменты + MCP-клиент), headless-режим + интеграция с оркестратором (decision-5), loop detection/лимиты (decision-4) — всё P0, связь с VL-75 AC#1/AC#2.
- **v1.8 (следующая):** TUI на Ink (AC#3 VL-75 — после стабильного ядра), полный переход фаз на vibelog-agent + сравнение расхода токенов с qwen, хвосты CLI-таблицы, Web UI фильтры.

---

## 9. Открытые вопросы для Фазы 2 VL-75

1. **Streaming Cloud.ru** — подтвердить фактическим запросом (`stream=true`); если нет — non-streaming fallback в decision-3.
2. **Значения по умолчанию** лимитов (max-tool-calls, max-wall-time, N детектора дублей) — решить в Фазе 2.
3. **Выбор модели по умолчанию** — зависит от cost/quality (каталог 20+ моделей, цены в decision-3-контексте); кандидаты: GigaChat3.5 (самая дешёвая входная), DeepSeek-V4-Pro (1M контекст).
4. **pi/hermes-agent/openclaw** — описаны по факту (§5.3-5.5); openclaw нерелевантен (не coding-agent), mastra — библиотека без своего loop.
5. **Ink-версия** — использовать форк `@jrichman/ink@6.6.9` (как gemini-cli) либо официальный ink 7.0.3 (у qwen-code, §10.4) — проверить совместимость с React 19 и Node 20 при реализации TUI.

---

## 10. refs/qwen-code (QwenLM) — текущий целевой агент (добавлен по запросу Pavel, Фаза Comment VL-77, 2026-10-04)

**Локально:** `refs/qwen-code` (добавлен в `scripts/clone-refs.mjs` — 12-й референс). Официальный Qwen Code — форк gemini-cli (google-gemini), монорепо `@qwen-code/qwen-code` **v0.24.7**, pnpm-workspaces, ~26 пакетов (`packages/cli`, `packages/core`, `packages/sdk-typescript`, `packages/acp-bridge`, `packages/channels/*`, `desktop`, `mobile-shell` и др.).

Это референс особого рода: **qwen-code — агент, которого сегодня спавнит оркестратор Vibelog** (§1.2); vibelog-agent — его headless-замена (decision-5). Разбор исходников подтверждает и уточняет контракты §1:

### 10.1 Источник JSON-контракта (подтверждение §1.1 на исходниках)

- **`packages/cli/src/nonInteractive/types.ts:161-179`** — `CLIResultMessageSuccess { type:'result', subtype:'success', uuid, session_id, is_error:false, duration_ms, duration_api_ms, num_turns, result, usage:ExtendedUsage, modelUsage?, permission_denials }` — точь-в-точь контракт `src/web/qwen-result.ts` (QwenResult); `[key:string]:unknown` — лишние поля (uuid, modelUsage, permission_denials) ожидаемы, `toQwenResult` их игнорирует (§1.1).
- **`types.ts:179`** — `CLIResultMessageError { subtype: 'error_max_turns' | 'error_during_execution' }` — у qwen-code есть лимит ходов (error_max_turns); прямой аналог планируемых `--max-tool-calls` (ADR-4).
- **Механизм вывода:** `packages/cli/src/nonInteractive/io/JsonOutputAdapter.ts:116-134` — `emitResult()`: text-режим → `result` в stdout; JSON-режим → `process.stdout.write(JSON.stringify(this.messages) + '\n')` — **одна строка-массив всех сообщений сессии** — это и есть «строка-массив `[{…}]` (json-адаптер qwen 0.24.x)» из §1.1; `result` — последний элемент, парсер ищет с конца — подтверждено.
- **Стриминговый вариант:** `StreamJsonOutputAdapter.ts` (там же) — NDJSON-поток по мере событий — второй формат, который принимает `parseQwenResult` (§1.1).

### 10.2 CLI-флаги (подтверждение §1.2)

- **`packages/cli/src/config/top-level-options.ts:28-33`** — `APPROVAL_MODES = ['plan','default','auto-edit','auto','yolo']` — `--approval-mode yolo` оркестратора легален.
- `top-level-options.ts:250` — `approval-mode`; `:278` — `allowed-mcp-server-names`; `'output-format'` — в том же файле. Все argv оркестратора (§1.2) совпадают с реальными опциями 0.24.7.

### 10.3 MCP-клиент и конфиг (дополнение к §2.2/§3)

- **`packages/core/src/tools/mcp-client.ts`** — `import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'` (`:21`); `discoverMcpServers(mcpServers: Record<string, MCPServerConfig>)` (`:1370-1393`); legacy-stdio handshake с reserve-окном (`:97-104`, `:418-419`), пул с spawn/restart bounds (`:843`).
- **Конфиг:** `packages/core/src/config/storage.ts:210` — глобальный `~/.qwen/settings.json`; `:649` — проектный `.qwen/settings.json` — `mcpServers` в `.qwen/settings.json` подтверждён на исходниках (§2.2: vibelog-agent свой конфиг не нужен).

### 10.4 Стек TUI — уточнение к ADR-2

- **`packages/cli/package.json:78`** — `"ink": "7.0.3"` — **официальный ink 7.x**, react `^19.2.4` (gemini-cli — форк `@jrichman/ink@6.6.9`, §4.1). Факт: официальный ink 7 уже в проде у самого qwen-code; выбор между официальным ink 7 и форком @jrichman — открытым вопросом к Фазе 2 VL-75 (ADR-2 proposed, данных для смены решения нет — официальный ink не содержит нативных модулей, проверяется по его package.json при реализации).
- **`packages/core/src/`** — ядро без TUI: `agents/`, `tools/`, `hooks/`, `config/`, `goals/`, `ipc/` — разделение «ядро (cli/core) ↔ оболочка» подтверждает roadmap v1.7→v1.8 (сначала headless-ядро, TUI потом).
- `packages/sdk-typescript/src/types/protocol.ts` — типы протокола `duration_api_ms` и пр. — тот же wire-контракт, что в §10.1 (SDK переиспользует его).

### 10.5 Итог для Фазы 2 VL-75

Контракт parseQwenResult воспроизводится дословно: NDJSON-поток ИЛИ строка-массив `[{…}]` с `type:'result'` последним элементом; источник — `JsonOutputAdapter`/`StreamJsonOutputAdapter` (§10.1). Лимит `error_max_turns` у qwen-code — прецедент для `--max-tool-calls` (ADR-4). Ink: официальный 7.0.3 уже у qwen-code — кандидат вместо форка @jrichman (ADR-2, уточнить при реализации TUI в v1.8).
