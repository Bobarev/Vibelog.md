---
id: VL-75
title: 'Создать свой агент Vibelog: минимальный LLM-агент с TUI на Ink для замены Qwen…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 18:20'
updated_date: '2026-10-05 20:38'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: epic
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Создать свой агент Vibelog: минимальный LLM-агент с TUI на Ink для замены Qwen Code в фазах spec/plan/code/close/comment/prompt.

Контекст: Qwen Code тратит 96k токенов на Comment, 935k на Spec. Причина — тяжёлый system prompt, skills, инструменты, auto-memory, dreamer. Нужен лёгкий агент, который делает только то, что нужно фазе.

Текущая интеграция (исследовано 2026-10-04):
- Оркестратор src/web/orchestrator.ts спавнит бинарь из VIBELOG_QWEN_BIN || 'qwen' с промптом из templates/qwen-commands/phase-*.md, флаги --approval-mode yolo --output-format json; результат парсится parseQwenResult (src/web/qwen-result.ts) — JSON type=result {result, usage, session_id}.
- MCP-сервер: vibelog mcp start (JSON-RPC stdio), конфиг .qwen/settings.json (mcpServers.vibelog).
- Фазы: spec | plan | code | close | comment | prompt.
- Зависимости проекта сейчас: grammy, undici (dev: typescript, @types/node). Node 20+ (есть нативный fetch), strict TS, ESM, tsc → dist/. Каталога src/agent пока нет — создаётся с нуля.

Компоненты:
1. LLM-клиент Cloud.ru (OpenAI-совместимый API: chat/completions + tool calling, стриминг ответов).
2. Tool-calling loop: пока модель запрашивает инструменты — выполняем и возвращаем результат; финальный текст — результат фазы.
3. Инструменты агента: read_file, write_file, edit, run_shell_command, grep_search, glob (валидация параметров — без лишних зависимостей, plain TS).
4. MCP-клиент: stdio-подключение к vibelog mcp start, проксирование vibelog-инструментов в tool-calling loop агента.
5. TUI на Ink: стриминг токенов, карточки tool calls, счётчики (токены/время), ошибки.
6. CLI: node dist/agent/cli.mjs <phase> <taskId> — headless-режим печатает JSON в stdout, совместимый с parseQwenResult (TUI — только в интерактивном запуске).
7. Интеграция с оркестратором: замена бинаря qwen на vibelog-agent (VIBELOG_QWEN_BIN или новая настройка), шаблоны фаз переиспользуются.
8. Loop detection: обнаружение зацикливания (одинаковые tool calls подряд) → обрыв с понятной ошибкой.
9. Лимиты: --max-tool-calls N, --max-wall-time <сек>; превышение → фаза завершается ошибкой, без зависания.
10. Документация: docs/agent.md (настройка Cloud.ru API key, запуск фаз, сравнение расхода токенов с qwen).

Ограничения: Node 20+, macOS 10.15 Catalina, минимум зависимостей (Ink допустим по опыту Qwen Code; без нативных модулей). Тесты — *.test.mjs на dist/.

Следующий шаг: Фаза 2 (Plan) декомпозирует эпик на подзадачи (LLM-клиент, tools, MCP-клиент, TUI, CLI+оркестратор, loop detection+лимиты, доки).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 vibelog-agent <phase> <taskId> (headless) выполняет фазу через LLM + MCP и печатает JSON type=result, совместимый с parseQwenResult — оркестратор подхватывает результат без изменений
- [x] #2 Loop detection и лимиты (--max-tool-calls, --max-wall-time) предотвращают бесконечный цикл: при срабатывании агент завершает фазу с ошибкой в результатах, а не зависает
- [x] #3 TUI на Ink показывает стриминг ответа, выполняемые tool calls и счётчики (токены/время); pnpm build и pnpm test проходят, документация docs/agent.md обновлена
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации (Фаза 2, обновлён 2026-10-05 по итогам VL-77)

Эпик декомпозирован на 5 дочерних задач (порядок: VL-83 → VL-84 → VL-85 → VL-86 → VL-87). Обновление плана — по данным ресёрча VL-77: документ doc-4 «Ресёрч: LLM-агент Vibelog (VL-75)» (§1–§10) и решения decision-1..5 (backlog/decisions/, все proposed); новый референс — refs/qwen-code (doc-4 §10).

## Декомпозиция

| ID | Задача | Приоритет | Зависимости |
|----|--------|-----------|-------------|
| VL-83 | Ядро агента: LLM-клиент Cloud.ru, tool-calling loop, инструменты (read_file/write_file/edit/run_shell_command/grep_search/glob), loop detection (3 одинаковых вызова подряд), лимиты --max-tool-calls/--max-wall-time | High | — |
| VL-84 | MCP-клиент Vibelog: stdio JSON-RPC к `vibelog mcp start`, проксирование backlog_*-инструментов в loop | High | VL-83 |
| VL-85 | CLI vibelog-agent (headless JSON, совместимый с parseQwenResult) + интеграция с оркестратором, шим bin/vibelog-agent.mjs, вынос buildPhasePrompt в src/web/phase-prompt.ts | High | VL-83, VL-84 |
| VL-86 | TUI на Ink: стриминг onToken, карточки tool calls, счётчики (токены/время); jsx в tsconfig, ink+react в зависимости | Medium | VL-83, VL-85 |
| VL-87 | Документация: docs/agent.md (настройка Cloud.ru, запуск, сравнение токенов с qwen), CHANGELOG, README | Medium | VL-85, VL-86 |

## Ключевые данные ресёрча, влияющие на план

1. **JSON-контракт подтверждён на исходниках qwen-code** (doc-4 §10.1): `refs/qwen-code/packages/cli/src/nonInteractive/types.ts:161-179` — `CLIResultMessageSuccess {type:'result', subtype:'success', uuid, session_id, is_error, duration_ms, duration_api_ms, num_turns, result, usage, modelUsage?, permission_denials}` — точь-в-точь QwenResult (src/web/qwen-result.ts:22-33); лишние поля toQwenResult игнорирует. Механизм вывода: `JsonOutputAdapter.ts:116-134` — JSON-режим пишет `JSON.stringify(this.messages)+'\n'` (строка-массив, result — последний элемент; парсер ищет с конца); `StreamJsonOutputAdapter.ts` — NDJSON. Headless vibelog-agent печатает одну строку-объект `{type:'result',...}` — parseQwenResult принимает и объект, и массив.
2. **Ошибки лимитов qwen-code** (types.ts:179): `subtype: 'error_max_turns' | 'error_during_execution'` — прецедент для --max-tool-calls (ADR-4); VL-85 может включать subtype в headless JSON при is_error (совместимость сохраняется — лишние поля игнорируются).
3. **Флаги оркестратора легальны** (doc-4 §10.2): `refs/qwen-code/packages/cli/src/config/top-level-options.ts:28-33` — APPROVAL_MODES включает 'yolo'; :250 approval-mode, :278 allowed-mcp-server-names, output-format — все argv оркестратора совпадают с реальными опциями qwen 0.24.7; агент принимает их как есть.
4. **Единственная правка оркестратора** (decision-5): `src/web/orchestrator.ts:187` — `bin = VIBELOG_AGENT_BIN || VIBELOG_QWEN_BIN || 'qwen'` (новая настройка VIBELOG_AGENT_BIN, фолбэк на существующий VIBELOG_QWEN_BIN сохраняется); шаблоны phase-*.md без изменений.
5. **LLM-клиент Cloud.ru** (decision-3, doc-4 §6): base URL `https://foundation-models.api.cloud.ru/v1`, Bearer-ключ сервисного аккаунта, chat/completions + Function Calling заявлен; **streaming SSE не подтверждён явно — probe фактическим запросом до интеграции TUI, фолбэк non-streaming**; rate limit 20 RPS; usage-поля могут отличаться (cache_read отсутствует → дефолт 0). Retry провайдера (429/5xx/сеть) — ≤3 попытки с экспоненциальной паузой и уважением Retry-After, **вне лимита --max-tool-calls** (decision-4).
6. **MCP-клиент** (decision-1, doc-4 §10.3): минимальный самописный (newline-delimited JSON-RPC, initialize/tools/list/tools/call); у qwen-code — StdioClientTransport из @modelcontextprotocol/client/stdio (`refs/qwen-code/packages/core/src/tools/mcp-client.ts:21`), формат идентичен vibelog mcp start; конфиг `.qwen/settings.json` подтверждён (storage.ts:210/649) — vibelog-agent свой MCP-конфиг не нужен, сервер спавнится напрямую.
7. **TUI — версия Ink** (doc-4 §10.4, decision-2 proposed): у qwen-code — **официальный ink 7.0.3 + react ^19.2.4** (refs/qwen-code/packages/cli/package.json:78/:91), у gemini-cli — форк @jrichman/ink@6.6.9; выбор — шаг 1 VL-86 (официальный ink проверить на нативные модули по его package.json и совместимость с React 19 + Node 20 + tsc NodeNext; конфликт → фолбэк форк/react 18). Паттерны рендера — gemini-cli (doc-4 §4.1: useGeminiStream, StatsDisplay, ToolConfirmationQueue, ContextUsageDisplay; §4.3 — универсальные: очередь стриминга, карточка tool call с статусом, нижняя статус-строка счётчиков, inline-ошибки без падения TUI).

## Открытые вопросы (решаются при реализации, планирование не блокируют)

1. Streaming Cloud.ru — фактический probe (шаг VL-83); при отсутствии — non-streaming (фолбэк decision-3).
2. Модель по умолчанию VIBELOG_LLM_MODEL — кандидат GigaChat3.5-432B-A28B-Reasoning (262K, дешёвый вход); DeepSeek-V4-Pro (1M контекст) — по факту прогона и цен (каталог cloud.ru, doc-4 §6.1).
3. Версия Ink — официальный 7.0.3 vs @jrichman/ink@6.6.9 (VL-86, шаг 1).

## Дельты планов дочерних задач (учесть при Фазе 2/3 каждой задачи)

- **VL-83**: добавить retry провайдера ≤3 (429/5xx, Retry-After, вне лимита tool-calls) и прокидывание AbortSignal во все I/O (decision-4); дефолт base URL — Cloud.ru endpoint; стоп-контракт цикла error/aborted/limit/detector.
- **VL-84**: структурных изменений нет — план соответствует decision-1; дополнить ссылками на doc-4 §10.3 (StdioClientTransport у qwen-code, .qwen/settings.json подтверждён).
- **VL-85**: bin-резолв — `VIBELOG_AGENT_BIN || VIBELOG_QWEN_BIN || 'qwen'` (правка orchestrator.ts:187); subtype 'error_max_turns'/'error_during_execution' в JSON при is_error; флаги --approval-mode yolo/--output-format json/--allowed-mcp-server-names — подтверждены легальными (doc-4 §10.2).
- **VL-86**: шаг 1 — выбор ink (официальный 7.0.3 vs форк, см. выше); рендер-паттерны — doc-4 §4.1/§4.3.
- **VL-87**: раздел «Сравнение с qwen-code 0.24.7» (базовый агент, которого заменяем); ссылки на decision-1..5 и открытые вопросы.

## Проверка плана

- pnpm build && pnpm test — на каждом шаге (без регрессий).
- Smoke: VIBELOG_AGENT_BIN=$PWD/bin/vibelog-agent.mjs vibelog browser — фаза уходит агенту, оркестратор подхватывает JSON без изменений.
- Совместимость хранения данных (backlog/, шаблоны phase-*.md) не нарушается — правки только в src/agent и одной строке оркестратора.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-04 18:24
---
Фаза 1 (Spec) выполнена. Тип: epic.
Краткое описание уточнения: фича явно не укладывается в одну задачу — это новый компонент (LLM-агент с TUI на Ink, MCP-клиент, tool-calling loop, интеграция с оркестратором, loop detection, лимиты, доки). Установлен type=epic; декомпозиция — в Фазе 2 (Plan).
Исследование репозитория:
- Оркестратор src/web/orchestrator.ts спавнит бинарь `qwen` (VIBELOG_QWEN_BIN) с промптом из templates/qwen-commands/phase-*.md, флаги `--approval-mode yolo --output-format json`; результат парсится parseQwenResult (src/web/qwen-result.ts) — JSON type=result {result, usage, session_id}. Новый агент должен печатать совместимый JSON в headless-режиме.
- MCP vibelog: `vibelog mcp start` (JSON-RPC stdio), конфиг в .qwen/settings.json.
- Зависимости сейчас: только grammy + undici; каталога src/agent нет — создаётся с нуля. Ink и zod допустимы по опыту Qwen Code.
- Фазы: spec | plan | code | close | comment | prompt.
Изменено в VL-75: описание дополнено контекстом интеграции и 10 компонентами; type=epic; добавлены 3 конкретных AC:
1. headless vibelog-agent печатает JSON type=result, совместимый с parseQwenResult (оркестратор подхватывает без изменений);
2. loop detection + --max-tool-calls/--max-wall-time завершают фазу с ошибкой вместо зависания;
3. TUI (Ink): стриминг + tool calls + счётчики; pnpm build/test проходят, docs/agent.md обновлена.
Новых задач не создавал — декомпозиция в Фазе 2 (Plan).
---
author: @agent
created: 2026-10-04 21:34
---
Фаза 2 (Plan) выполнена. Тип: epic → разбит на 5 дочерних задач, каждая со статусом Planned и планом в ## Implementation Plan.
**Декомпозиция VL-75:**
| ID | Задача | Приоритет | Зависимости |
|----|--------|-----------|-------------|
| VL-83 | Ядро агента: LLM-клиент Cloud.ru, tool-calling loop, инструменты (read_file/write_file/edit/run_shell_command/grep_search/glob), loop detection (3 одинаковых вызова подряд), лимиты --max-tool-calls (100) / --max-wall-time (900с) | High | — |
| VL-84 | MCP-клиент Vibelog: stdio JSON-RPC к `vibelog mcp start`, проксирование backlog_*-инструментов в loop | High | VL-83 |
| VL-85 | CLI vibelog-agent (headless JSON, совместимый с parseQwenResult) + интеграция с оркестратором через VIBELOG_QWEN_BIN, шим bin/vibelog-agent.mjs, вынос buildPhasePrompt в src/web/phase-prompt.ts | High | VL-83, VL-84 |
| VL-86 | TUI на Ink: стриминг onToken, карточки tool calls, счётчики (токены/время); jsx в tsconfig, ink+react в зависимости | Medium | VL-83, VL-85 |
| VL-87 | Документация: docs/agent.md (настройка Cloud.ru, запуск, сравнение токенов с qwen), CHANGELOG, README | Medium | VL-85, VL-86 |
**Исследование перед планом:**
- Оркестратор спавнит бинарь из VIBELOG_QWEN_BIN (src/web/orchestrator.ts:187) с позиционным промптом и флагами --approval-mode yolo --output-format json; промпт собирается из templates/qwen-commands/phase-*.md (map — строки 29-33, buildPhasePrompt — строки 81-106).
- parseQwenResult (src/web/qwen-result.ts:103) парсит stdout-лог; контракт результата — QwenResult (строки 22-33): type=result, result, is_error, num_turns, duration_ms, duration_api_ms, session_id, usage{input_tokens, output_tokens, cache_read_input_tokens, total_tokens}. Headless CLI печатает ровно одну JSON-строку этого формата — оркестратор подхватит без изменений.
- MCP-сервер (src/mcp/server.ts): initialize/notifications/initialized/tools/list/tools/call/ping, NDJSON построчно, tools/call — content[0].text + isError; cwd проекта обязателен для поиска backlog/.
- tsconfig.json сейчас без JSX — VL-86 добавит jsx: react-jsx; зависимости ink/react допустимы (решение об Ink в описании эпика).
Каждый план содержит конкретные файлы, номера строк, шаги, команды проверки (pnpm build && pnpm test) и риски. Порядок: VL-83 → VL-84 → VL-85 → VL-86 → VL-87.
---
author: Pavel Bobarev
created: 2026-10-05 00:18
---
Обнови план с учётом новых данных полученных в VL-77. Был добавлен референс qwen-code
---
author: @agent
created: 2026-10-05 00:32
---
Фаза Comment выполнена: план VL-75 обновлён с учётом данных ресёрча VL-77 (включая референс qwen-code).
**Что сделано.** Поле Implementation Plan у VL-75 и всех 5 дочерних задач (VL-83..VL-87) дополнено разделом «Уточнение по VL-77 (2026-10-05)» — по данным doc-4 «Ресёрч: LLM-агент Vibelog (VL-75)» (§4-§10) и решений decision-1..5 (backlog/decisions/, статус proposed).
**Ключевые обновления по референсу qwen-code (doc-4 §10, добавлен в VL-77):**
1. **JSON-контракт подтверждён на исходниках** (types.ts:161-179): CLIResultMessageSuccess точь-в-точь совпадает с QwenResult (src/web/qwen-result.ts:22-33); JsonOutputAdapter пишет строку-массив с result последним — parseQwenResult принимает и объект, и массив. Headless vibelog-agent печатает одну строку-объект type=result.
2. **Флаги оркестратора легальны** (top-level-options.ts:28-33/250/278): --approval-mode yolo / --output-format json / --allowed-mcp-server-names — все реальные опции qwen 0.24.7.
3. **Subtype ошибок** (types.ts:179): 'error_max_turns' | 'error_during_execution' — прецедент для --max-tool-calls; VL-85 может включать subtype в JSON при is_error (лишние поля toQwenResult игнорирует).
4. **MCP-клиент** (§10.3): qwen-code использует StdioClientTransport; формат идентичен vibelog mcp start — decision-1 (минимальный самописный) подтверждён; свой конфиг агенту не нужен.
5. **TUI/Ink** (§10.4): у qwen-code — официальный ink 7.0.3 + react ^19.2.4 (package.json:78/:91), у gemini-cli — форк @jrichman/ink@6.6.9; выбор версии — шаг 1 VL-86 (decision-2 proposed, официальный ink 7 проверен в целевой среде Catalina + Node 20).
**Другие обновления планов:** VL-83 — retry провайдера ≤3 (429/5xx, Retry-After, вне лимита tool-calls) + AbortSignal + семантика лимитов с partial-результатом (decision-4); VL-85 — decision-5: VIBELOG_AGENT_BIN с фолбэком на VIBELOG_QWEN_BIN (правка orchestrator.ts:187 — одна строка) либо нулевой вариант без правки оркестратора; VL-87 — база сравнения токенов @qwen-code/qwen-code 0.24.7, ссылки на decision-1..5.
**Открытые вопросы (не блокируют планирование):** probe streaming Cloud.ru (VL-83), дефолтная модель VIBELOG_LLM_MODEL, версия Ink (VL-86).
**Статус не менялся** (смены в комментарии не указано — Planned). Git-операции не выполнялись.
---
author: @agent
created: 2026-10-05 20:05
---
Фаза 3 (Code) на эпике VL-75: код эпика не реализовался (правило: Code на эпике не пишет код, оркестрирует детей). Все 5 детей НЕ в статусе Done:
| ID | Статус | Фаза 3 |
|----|--------|--------|
| VL-83 | Review | выполнена ранее |
| VL-84 | Review | выполнена ранее |
| VL-85 | Review | выполнена ранее |
| VL-86 | Review | выполнена ранее |
| VL-87 | Planned | НЕ выполнялась (документация; зависит от VL-85/VL-86) |
Изменено: — (правок файлов нет).
Проверки текущего дерева (без изменений от этой фазы): pnpm build OK, pnpm test — 596/596.
Действие пользователя: **запусти Code на детях: VL-87**. VL-83..VL-86 уже в Review — ждут ревью; после ревью перевести в Done. Когда все дети Done — повторить Фазу 3 на VL-75, эпик будет переведён в Done.
Статус VL-75 не менялся (Planned — все дети не Done). Git-операции не выполнялись.
---
author: @agent
created: 2026-10-05 20:38
---
Фаза 3 (Code) на эпике VL-75 выполнена. Правило: Code на эпике не пишет код — оркестрирует детей.
**Все 5 детей Done** (VL-83, VL-84, VL-85, VL-86, VL-87) → эпик переводится в Done.
| ID | Задача | Статус |
|----|--------|--------|
| VL-83 | Ядро агента: LLM-клиент, loop, инструменты, loop detection, лимиты | Done |
| VL-84 | MCP-клиент Vibelog (stdio JSON-RPC) | Done |
| VL-85 | CLI vibelog-agent (headless JSON) + интеграция с оркестратором | Done |
| VL-86 | TUI на Ink (стриминг, карточки tool calls, счётчики) | Done |
| VL-87 | Документация: docs/agent.md, CHANGELOG, README | Done |
Изменено: — (правок файлов этой фазой нет; код реализован в дочерних задачах).
Проверки текущего дерева: pnpm build OK, pnpm test — 602/602 (0 fail). Компоненты на месте: src/agent/{cli,llm,loop,mcp-client,tools,tui-format}.ts + tui.tsx + тесты, bin/vibelog-agent.mjs, docs/agent.md.
Отмечено: AC 1-3 (headless JSON совместим с parseQwenResult; loop detection + лимиты; TUI + build/test + docs) — по факту реализации в детях; DoD 1-3 (тесты 602/602, документация обновлена, нет регрессий).
Что осталось: decisions 1-5 (backlog/decisions/) имеют статус proposed — при желании закрыть их после ревью; реальный прогон фаз через Cloud.ru API (VIBELOG_API_KEY) — smoke после публикации. Git-операции не выполнялись.
---
<!-- COMMENTS:END -->