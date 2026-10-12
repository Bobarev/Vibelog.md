---
id: VL-83
title: 'Ядро агента: LLM-клиент Cloud.ru, tool-calling loop, инструменты, loop detection и лимиты'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 21:29'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: high
type: ''
project: ''
parent_task_id: VL-75
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Ядро агента Vibelog (компоненты 1, 2, 3, 8, 9 эпика): LLM-клиент Cloud.ru, tool-calling loop, локальные инструменты, loop detection и лимиты.

Создаются с нуля (каталога src/agent нет):
- src/agent/llm.ts — клиент Cloud.ru (OpenAI-совместимый chat/completions + tool calling + стриминг SSE). Node 20 fetch; базовый URL и ключ — env VIBELOG_LLM_BASE_URL / VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL (дефолты — endpoint Cloud.ru). Fetch внедряется параметром (дефолт — глобальный fetch) — без этого loop-тесты потребуют сети.
- src/agent/tools.ts — 6 инструментов (read_file, write_file, edit, run_shell_command, grep_search, glob) с JSON-схемами параметров для tool calling. Без внешних зависимостей: валидация — plain TS. shell — только execFile, аргументы массивом (без shell:true). Все пути резолвятся относительно cwd и отклоняются, если вышли за пределы проекта.
- src/agent/loop.ts — цикл: messages → chat/completions → если tool_calls есть, выполняем инструменты, дописываем tool-результаты в messages → повтор; иначе финальный текст = результат фазы.

Loop detection (в loop.ts): сигнатура вызова = name+JSON.stringify(args). Три одинаковые подряд сигнатуры → выход из цикла с ошибкой (is_error=true, result — текст на русском со списком повторов).

Лимиты: счётчики tool-calls и wall-time проверяются на каждой итерации; превышение --max-tool-calls (дефолт 100) или --max-wall-time (дефолт 900 сек) → is_error=true, текст ошибки на русском.

Выходные данные loop: {result, is_error, num_turns, duration_ms, usage} — по образцу QwenResult (src/web/qwen-result.ts:22), чтобы CLI (задача VL-77) мог привести к формату parseQwenResult.

Зависимости package.json: ink/react НЕ нужны (это задача VL-79); новых runtime-зависимостей не добавляем — fetch нативный, инструменты на node:fs/node:child_process.

Проверка: pnpm build && node --test src/agent (в составе pnpm test).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/agent/llm.ts — OpenAI-совместимый клиент Cloud.ru: chat/completions с tool calling и SSE-стримингом; настройки через env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL; fetch внедряется параметром для тестируемости
- [x] #2 src/agent/tools.ts — инструменты read_file, write_file, edit, run_shell_command, grep_search, glob на чистом TS: валидация JSON-схем параметров, запуск shell только через execFile без shell:true, пути ограничиваются пределами проекта (cwd)
- [x] #3 src/agent/loop.ts — tool-calling loop: пока в ответе модели есть tool_calls — выполняем и возвращаем результат; финальный текст = результат фазы
- [x] #4 Loop detection: 3 одинаковых подряд tool call (одинаковые name+args) → прерывание фазы с is_error=true и понятным текстом ошибки на русском
- [x] #5 Лимиты: --max-tool-calls N (по умолчанию 100) и --max-wall-time <сек> (по умолчанию 900); превышение → is_error=true, без зависания
- [x] #6 Тесты src/agent/*.test.mjs на dist/: мок-модель и мок-fetch; кейсы: happy path, loop detection, оба лимита, ошибка API; pnpm build и pnpm test проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
Ядро агента: LLM-клиент Cloud.ru, tool-calling loop, 6 локальных инструментов, loop detection и лимиты. Никаких новых runtime-зависимостей.

## Файлы
- src/agent/llm.ts (новый)
- src/agent/tools.ts (новый)
- src/agent/loop.ts (новый)
- src/agent/llm.test.mjs, src/agent/tools.test.mjs, src/agent/loop.test.mjs (новые)
- package.json — БЕЗ изменений

## Шаги

### 1. src/agent/llm.ts
- Типы: ChatMessage (system/user/assistant/tool), ToolCall {id, name, arguments: Record<string,unknown>}, ToolDef {name, description, inputSchema: object}, LlmUsage {input_tokens, output_tokens, cache_read_input_tokens, total_tokens}.
- createLlmClient({baseUrl, apiKey, model, fetchImpl?}) — fetchImpl внедряется для тестов (дефолт — глобальный fetch Node 20).
- streamChat(messages, tools, onToken?): POST {baseUrl}/chat/completions, Authorization: Bearer {apiKey}, body {model, messages, tools, stream:true, stream_options:{include_usage:true}}. SSE: body.getReader(), буферизация, разбивка по \n\n, строки `data: {...}` / `data: [DONE]`; delta.content → onToken; delta.tool_calls[] — склейка фрагментов по index (arguments строка фрагментами); usage из последнего чанка.
- Фолбэк: если stream даёт 4xx/5xx — один повтор non-stream, текст нарезается onToken по словам.
- Ошибки API (non-200, битый JSON) — Error с русским текстом и статусом.

### 2. src/agent/tools.ts
- ToolSpec {name, description, inputSchema, handler(args): Promise<string>}.
- validateArgs(schema, args): обязательные поля и типы (string/number/boolean/array/object); нарушение — строка «Невалидные аргументы инструмента X: ...» модели (не исключение).
- Инструменты (пути резолвятся от cwd, не внутри cwd → отказ; ошибки текстом модели):
  - read_file {path, offset?, limit?}
  - write_file {path, content}
  - edit {path, old_string, new_string, replace_all?} — строгая замена, без replace_all old_string обязан найтись 1 раз
  - run_shell_command {command, cwd?} — execFile('/bin/bash', ['-lc', command]) (без shell:true на уровне node), таймаут 120с с kill; вывод: exit code, stdout, stderr, обрезка 64КБ
  - grep_search {pattern, path?, glob?} — чистый TS: рекурсивный fs.readdirSync, мини-glob (*.** → regex), regex-проверка pattern, limit 200, формат file:line: text
  - glob {pattern} — тот же обход, только имена, limit 500
- export listLocalTools(cwd): ToolSpec[].

### 3. src/agent/loop.ts
- runLoop({llm, messages, tools, limits?, onToken?, onToolStart?, onToolEnd?}) → {result, is_error, num_turns, duration_ms, usage}.
- Цикл: streamChat → если tool_calls: выполнить каждый (role=tool, tool_call_id), num_turns++; иначе выход, result=текст.
- Loop detection: сигнатура name+'|'+JSON.stringify(args); 3 одинаковые подряд → is_error=true, result «Loop detection: инструмент X вызван 3 раза подряд с одинаковыми аргументами — фаза прервана...».
- Лимиты: tool-calls > maxToolCalls (дефолт 100) → is_error «Превышен лимит --max-tool-calls (N)...»; wall-time > maxWallTimeMs (дефолт 900000) → is_error «Превышен лимит --max-wall-time...».
- Суммирование usage по всем ответам. Ошибки llm/handler-лимитов — is_error=true, result-текст (наружу не кидаем — CLI оборачивает в JSON). Ошибки handler не фатальны: текст уходит модели как tool-результат, loop продолжает.

### 4. Тесты (моки, без сети)
- ll.test: фейковый fetchImpl (ReadableStream из SSE) — сборка текста по onToken; сборка tool_calls по индексам; usage; non-200 → ошибка; фолбэк non-stream.
- tools.test: validateArgs; read/write/edit во временной /tmp-директории; отклонение ../-путей; run_shell_command (echo; sleep 2 при лимите 1с → kill); grep_search/glob по фейковому дереву.
- loop.test: фейковый llm (последовательность ответов): happy path; loop detection; лимит tool-calls (maxToolCalls=2); лимит wall-time (maxWallTimeMs=1); ошибка handler → loop продолжает.

### 5. Сборка/тесты
pnpm build && node --test src/agent && pnpm test.

## Проверка
- pnpm build (tsc strict)
- node --test src/agent — зелёные
- pnpm test — без регрессий

## Риски
- SSE-формат Cloud.ru может отличаться от OpenAI — фолбэк non-stream (шаг 1).
- usage может отсутствовать в stream — дефолты 0 (совместимо с toQwenResult, src/web/qwen-result.ts:38-70).
- bash -lc как единственный интерпретатор run_shell_command — кавычки обрабатывает bash, node не интерполирует второй раз.
- Большие выдачи grep/glob — лимиты 200/500, обрезка 64КБ.

## Уточнение по VL-77 (2026-10-05)

Данные ресёрча VL-77 (doc-4 §5.6, §6, §10; решения decision-3, decision-4 — статус proposed). Дополнения к плану выше:

1. **Retry провайдера (decision-4, п.3):** в llm.ts streamChat — при 429/5xx/сетевой ошибке повтор запроса ≤3 раз с экспоненциальной паузой (заголовок Retry-After имеет приоритет); после 3 неудач — ошибка с русским текстом. Retry НЕ вкладывается в лимит --max-tool-calls. Тест (llm.test): fetch падает дважды → успех на 3-й попытке; падает 4+ раза → ошибка.
2. **AbortSignal (decision-4, п.4):** прокидывать signal во все I/O (fetch, таймеры, kill execFile); runLoop принимает signal; --max-wall-time реализуется через AbortController + setTimeout.
3. **Семантика лимитов (decision-4, п.1, по образцу opencode):** при превышении --max-tool-calls/--max-wall-time — is_error=true, result = partial-результат (накопленный текст фазы, если был) + текст ошибки на русском — соответствует AC#2 VL-75 («завершает фазу с ошибкой в результатах, а не зависает»).
4. **Cloud.ru (decision-3, doc-4 §6):** дефолтный VIBELOG_LLM_BASE_URL — `https://foundation-models.api.cloud.ru/v1`; rate limit 20 RPS; usage-поля могут отличаться от OpenAI (cache_read отсутствует → 0, toQwenResult не ломается). Открытый вопрос: streaming SSE подтвердить probe-запросом до интеграции TUI (VL-86); фолбэк — non-streaming.
5. **Дефолты лимитов** остаются: max-tool-calls=100, max-wall-time=900с (решение Фазы 2 VL-75; decision-4 приводит «например 50» как иллюстрацию, не норматив).
6. **Loop detection** — без изменений: N≥3 идентичных (name+JSON.stringify(args)) подряд → прерывание с диагностикой (согласовано с decision-4, п.2).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 13:42
---
Фаза 3 (Code) выполнена. Реализовано по плану из задачи (включая уточнение по VL-77 от 2026-10-05).
**Изменено (создано):**
- `src/agent/llm.ts` — клиент Cloud.ru: chat/completions с tool calling + SSE-стримингом; env VIBELOG_LLM_BASE_URL (дефолт `https://foundation-models.api.cloud.ru/v1`)/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL; fetch внедряется параметром; ретраи ≤3 на 429/5xx/сетевые ошибки (Retry-After приоритетнее экспоненты); фолбэк non-stream при 4xx/5xx стрим-ответа; AbortSignal во всех I/O; маппинг usage OpenAI/Cloud.ru-полей (cache_read отсутствует → 0).
- `src/agent/tools.ts` — 6 инструментов (read_file, write_file, edit, run_shell_command, grep_search, glob) на чистом TS: валидация JSON-схем (текстом модели), execFile('/bin/bash', ['-lc', …]) без shell:true, таймаут 120с + abort-kill, обрезка вывода 64КБ; пути резолвятся от cwd и отклоняются за его пределами; grep/glob — рекурсивный обход без node_modules/.git, лимиты 200/500, мини-glob (**/, *, ?).
- `src/agent/loop.ts` — tool-calling loop: {result, is_error, num_turns, duration_ms, usage} по образцу QwenResult; loop detection — 3 одинаковые подряд сигнатуры (name+JSON args) → is_error, 3-й вызов не выполняется; лимиты --max-tool-calls (100) и --max-wall-time (900с) проверяются на каждой итерации; при превышении — partial-результат + текст ошибки на русском; ошибки handler не фатальны (текст → модели), ошибки llm → is_error без исключения наружу.
- Тесты: `src/agent/llm.test.mjs`, `src/agent/tools.test.mjs`, `src/agent/loop.test.mjs` — мок-fetch (SSE) и мок-llm, без сети: happy path, loop detection, оба лимита, ошибка API/сети, фолбэк non-stream, ретраи, abort, /tmp-изоляция для tools.
**Проверки:** pnpm build OK (tsc strict); node --test src/agent — 50/50; pnpm test — 529/529 (регрессий нет).
**Заметки:**
- DoD «Документация обновлена» не отмечен — документация агента вынесена в VL-87.
- У модели нет дефолта: VIBELOG_LLM_MODEL обязателен (base URL — дефолт Cloud.ru). Probe SSE Cloud.ru — до интеграции TUI (VL-86), фолбэк non-stream уже в коде.
- Сетевые ошибки стрим-фазы не уходят в non-stream фолбэк (он для 4xx/5xx-ответов) — ретраи ≤3 и ошибка по decision-4, п.3.
- package.json без изменений (по плану): новых runtime-зависимостей нет.
---
author: @agent
created: 2026-10-05 20:13
---
Фаза Close выполнена. Статус: Done. Коммит feat: 5491a1a — ядро агента: LLM-клиент Cloud.ru, tool-calling loop, инструменты, loop detection и лимиты (src/agent/llm.ts, tools.ts, loop.ts + тесты). Файлы других задач в src/agent/ (cli, mcp-client, tui) не коммитились — их закрытие идёт отдельно.
---
<!-- COMMENTS:END -->