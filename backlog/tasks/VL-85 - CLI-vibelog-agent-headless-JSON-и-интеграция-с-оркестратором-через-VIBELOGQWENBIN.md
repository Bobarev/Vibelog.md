---
id: VL-85
title: CLI vibelog-agent (headless JSON) и интеграция с оркестратором через VIBELOG_QWEN_BIN
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 21:30'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies:
  - VL-83
  - VL-84
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
CLI агента и интеграция с оркестратором (компоненты 6, 7 эпика). Зависит от VL-83 (loop) и VL-84 (MCP-клиент).

Создаётся src/agent/cli.ts:
- Аргументы: <phase> <taskId> [--max-tool-calls N] [--max-wall-time <сек>] [--no-mcp] [--headless].
- Headless-режим (дефолт при не-TTY stdout): в stdout печатается ОДНА JSON-строка формата parseQwenResult — {type:'result', result, is_error, num_turns, duration_ms, duration_api_ms, session_id, usage:{input_tokens, output_tokens, cache_read_input_tokens, total_tokens}} (поля — src/web/qwen-result.ts:22-33). session_id — генерируется (agent-<timestamp>). usage — суммарные счётчики из loop (input/output/cache_read/total). Логи/ошибки — только stderr.
- Интерактивный режим (TTY): запускает TUI (VL-86); при её отсутствии — фолбэк на текстовый прогресс в stderr + JSON в stdout в конце.
- Промпт фазы: шаблоны templates/qwen-commands/phase-{1,2,3,close,comment}.md + подстановка {{taskId}}/{{comment}} — логика buildPhasePrompt (src/web/orchestrator.ts:81-106) переиспользуется (вынос в src/web/phase-prompt.ts с реэкспортом из оркестратора — чтобы не дублировать и не менять публичное поведение оркестратора).

Совместимость с оркестратором (VL-66/67 интеграция):
- VIBELOG_QWEN_BIN (src/web/orchestrator.ts:187) указывает на bin/vibelog-agent.mjs (новый шим в bin/, как bin/vibelog.mjs); агент принимает позиционный промпт + qwen-флаги --approval-mode yolo --output-format json [--allowed-mcp-server-names vibelog] — парсит их как совместимость (output=json — headless), промпт берёт из позиционного аргумента.
- Оркестратор при этом не меняется (только документируется в docs/agent.md).

bin/vibelog-agent.mjs — шим на dist/agent/cli.js (паттерн bin/vibelog.mjs); добавить в package.json bin.

Тесты:
- src/agent/cli.test.mjs: мок-LM — node:http сервер на эфемерном порту (env VIBELOG_LLM_BASE_URL), фаза comment в /tmp-проекте (изоляция — память cli-test-isolation); проверка: stdout — один валидный JSON, parseQwenResult возвращает result; stderr не пустой не ломает парсинг.
- src/web/orchestrator.test.mjs: кейс VIBELOG_QWEN_BIN=заглушка (печатает корректный JSON) — фаза завершается с результатом.

Проверка: pnpm build && pnpm test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/agent/cli.ts — node dist/agent/cli.mjs <phase> <taskId> [--max-tool-calls N] [--max-wall-time сек] [--no-mcp]: headless-режим (нет TTY или --headless) печатает в stdout ОДНУ JSON-строку {type:'result', result, is_error, num_turns, duration_ms, duration_api_ms, session_id, usage:{input_tokens, output_tokens, cache_read_input_tokens, total_tokens}} — parseQwenResult (src/web/qwen-result.ts:103) парсит её без изменений
- [x] #2 stdout — только JSON-результата (одна строка); всё остальное (логи, диагностика) — stderr (контракт оркестратора VL-63: parseQwenResult получает только stdout)
- [x] #3 Промпт фазы собирается из шаблонов templates/qwen-commands/phase-*.md с подстановкой {{taskId}}/{{comment}} — переиспользуется логика buildPhasePrompt из src/web/orchestrator.ts (выносится в общий модуль src/web/phase-prompt.ts или импортируется из оркестратора)
- [x] #4 Интеграция с оркестратором: bin агента подставляется через существующий VIBELOG_QWEN_BIN (src/web/orchestrator.ts:187) — агент принимает позиционный промпт + флаги --approval-mode yolo --output-format json (флаги принимаются и игнорируются/сохраняются для совместимости) — оркестратор запускает агента без изменений своего кода
- [x] #5 Посевной тест: тест оркестратора со спавном агента-заглушки (скрипт печатает заведомо корректный JSON type=result) — подтверждение, что контракт stdout/stderr выдержан; тест CLI с мок-LM (env VIBELOG_LLM_BASE_URL → локальный http-сервер на node:http) — end-to-end фаза comment в /tmp-проекте
- [x] #6 pnpm build и pnpm test проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
CLI vibelog-agent (headless JSON, совместимый с parseQwenResult) и интеграция с оркестратором через VIBELOG_QWEN_BIN. Зависит от VL-83, VL-84.

## Файлы
- src/agent/cli.ts (новый)
- src/web/phase-prompt.ts (новый) — переезд buildPhasePrompt из оркестратора
- src/web/orchestrator.ts — правка: импорт из phase-prompt.js (удалить локальные строки 29-33 и 81-106)
- bin/vibelog-agent.mjs (новый шим)
- package.json — bin.vibelog-agent
- src/agent/cli.test.mjs, src/web/orchestrator.test.mjs (дополнение)

## Шаги

### 1. src/web/phase-prompt.ts
- Перенести БЕЗ изменений логики: PHASE_TEMPLATES (spec→phase-1.md, plan→phase-2.md, code→phase-3.md, close→phase-close.md, comment→phase-comment.md, prompt→prompt.md — строки 29-33 orchestrator.ts) и buildPhasePrompt (строки 81-106: readFileSync, replaceAll {{taskId}}, {{key}}).
- orchestrator.ts: удалить перенесённое, импортировать './phase-prompt.js'; поведение оркестратора не меняется — подтверждение существующими orchestrator.test.mjs.

### 2. src/agent/cli.ts
- Разбор argv: позиционные [phase, taskId] (или один позиционный аргумент = готовый промпт для qwen-совместимости); флаги: --headless, --no-mcp, --no-tui, --max-tool-calls N, --max-wall-time <сек>, --comment <текст>, --help.
- qwen-совместимость: --approval-mode yolo, --output-format json, --allowed-mcp-server-names vibelog — принимаются; --output-format json приравнен к --headless.
- Сборка промпта: templatesDir — fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url)) (та же относительность dist/agent/cli.js, что у orchestrator.ts:42); buildPhasePrompt с extraVars {comment, prompt}.
- Инициализация: LLM из env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL; без VIBELOG_LLM_API_KEY → stderr + exit 1 (русский текст). Локальные tools(cwd=process.cwd()); если phase!=='prompt' и не --no-mcp — McpClient (bin: VIBELOG_BIN ?? 'vibelog', cwd=process.cwd()) → externalTools; ошибка MCP на старте — предупреждение в stderr и продолжение без MCP.
- runLoop → в stdout ОДНА JSON-строка (JSON.stringify без pretty): {type:'result', result, is_error, num_turns, duration_ms, duration_api_ms:0, session_id:'agent-'+Date.now(), usage:{input_tokens,output_tokens,cache_read_input_tokens,total_tokens}} — поля = QwenResult (src/web/qwen-result.ts:22-33); duration_api_ms=duration_ms.
- В stdout до/после JSON ничего не печатать; все логи — только stderr (контракт VL-63: parseQwenResult парсит только stdout).
- Интерактив: isTTY && !headless && phase!=='prompt' → renderTui (заглушка до VL-86 — текстовый прогресс в stderr + тот же JSON в конце).
- SIGINT: закрыть MCP, exit 130.

### 3. bin/vibelog-agent.mjs
- По образцу bin/vibelog.mjs: импорт '../dist/agent/cli.js', main(process.argv.slice(2)), catch → «Ошибка: msg», exit 1.
- package.json: "bin": {"vibelog": "./bin/vibelog.mjs", "vibelog-agent": "./bin/vibelog-agent.mjs"}.

### 4. Тесты
- src/agent/cli.test.mjs: node:http мок-LM (эфемерный порт, env VIBELOG_LLM_BASE_URL=http://127.0.0.1:PORT/v1, VIBELOG_LLM_API_KEY=test): POST /chat/completions → {choices:[{message:{role:'assistant',content:'Готово'}}], usage:{...}}; /tmp-проект (mkdtemp) с backlog/; запуск node dist/agent/cli.js comment VL-1 --no-mcp → stdout: одна строка; JSON.parse → type=result, result='Готово', is_error=false, usage корректен; parseQwenResult(stdout)!==null (импорт dist/web/qwen-result.js).
- qwen-совместимость: позиционный промпт + --approval-mode yolo --output-format json → headless JSON.
- src/web/orchestrator.test.mjs: VIBELOG_QWEN_BIN=заглушка (.mjs, печатает готовый JSON type=result) → startPhase получает результат.

### 5. Сборка/тесты
pnpm build && node --test src/agent src/web && pnpm test.

## Проверка
pnpm build; pnpm test; smoke: VIBELOG_QWEN_BIN=$PWD/bin/vibelog-agent.mjs vibelog browser (фаза уходит агенту).

## Риски
- Хрупкость JSON-контракта (мусор в stdout ломает parseQwenResult) — ловится cli.test.mjs; TUI (VL-86) обязана рендериться вне stdout.
- Длина позиционного промпта — ARG_MAX macOS ~1MB, шаблоны фаз в пределах.
- MCP ищет backlog через cwd проекта — спавнить с cwd=process.cwd(), документировать запуск из корня проекта.
- Порядок: phase-prompt.ts выносится до правок cli.ts — оркестратор зелёный на каждом шаге.

## Уточнение по VL-77 (2026-10-05)

1. **Флаги оркестратора подтверждены на исходниках qwen-code** (doc-4 §10.2): --approval-mode yolo (APPROVAL_MODES), --allowed-mcp-server-names, --output-format — все легальны для qwen 0.24.7; агент принимает их без изменений (как и планировалось).
2. **JSON-контракт подтверждён** (doc-4 §10.1): CLIResultMessageSuccess (refs/qwen-code packages/cli/src/nonInteractive/types.ts:161-179) точь-в-точь совпадает с QwenResult (src/web/qwen-result.ts:22-33); JsonOutputAdapter пишет строку-массив с result последним элементом — парсер ищет с конца. Headless vibelog-agent печатает одну строку-объект {type:'result',...} — parseQwenResult принимает и объект, и массив.
3. **Subtype ошибок (прецедент qwen-code, doc-4 §10.1):** CLIResultMessageError имеет subtype 'error_max_turns' | 'error_during_execution' (types.ts:179); при is_error=true агент может включать subtype в JSON ('error_max_turns' при лимите --max-tool-calls, 'error_during_execution' при прочих ошибках цикла) — toQwenResult игнорирует лишние поля, совместимость сохраняется.
4. **Переключение оркестратора (decision-5, proposed):** предлагается VIBELOG_AGENT_BIN с фолбэком на VIBELOG_QWEN_BIN (правка orchestrator.ts:187 — одна строка: VIBELOG_AGENT_BIN || VIBELOG_QWEN_BIN || 'qwen'); текущий вариант плана (нулевая правка оркестратора, VIBELOG_QWEN_BIN → агент) остаётся рабочим. Выбор — при подтверждении decision-5 (статус proposed на 2026-10-05). Если decision-5 подтверждается — добавить тест: VIBELOG_AGENT_BIN имеет приоритет над VIBELOG_QWEN_BIN.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 15:47
---
Фаза 3 (Code) выполнена.
**Изменено:**
- `src/agent/cli.ts` (новый) — CLI vibelog-agent: разбор argv (позиционные `<phase> <taskId>` либо готовый промпт; флаги `--headless/--no-mcp/--comment/--max-tool-calls/--max-wall-time/--help`; qwen-совместимые `--approval-mode/--output-format json/--allowed-mcp-server-names` принимаются и игнорируются, output=json приравнен к --headless); сборка промпта через `renderPrompt`; LLM из env VIBELOG_LLM_* (без API_KEY/MODEL → stderr + exit 1); локальные tools + MCP Vibelog (отказ — предупреждение в stderr, фаза продолжается); runLoop → в stdout ровно одна JSON-строка `{type:'result', result, is_error, num_turns, duration_ms, duration_api_ms, session_id:'agent-<ts>', usage:{...}}` — parseQwenResult парсит без изменений; SIGINT → закрыть MCP, exit 130; интерактив (TTY) — текстовый прогресс в stderr до VL-86.
- `src/web/phase-prompt.ts` (новый) — renderPrompt/PHASES/Phase вынесены из оркестратора без изменений логики.
- `src/web/orchestrator.ts` — импорт + реэкспорт renderPrompt/Phase из phase-prompt.js (публичное поведение не меняется, подтверждено существующими тестами).
- `bin/vibelog-agent.mjs` (новый, +x) — шим на dist/agent/cli.js; `package.json` — bin.vibelog-agent, lint проверяет оба шима.
- `src/agent/cli.test.mjs` (новый) — мок-LM node:http на эфемерном порту, e2e фазы comment в /tmp-проекте (stdout — одна строка JSON, parseQwenResult парсит, stderr не ломает парсинг), qwen-совместимость, ошибки валидации.
- `src/web/orchestrator.test.mjs` — посевной тест: VIBELOG_QWEN_BIN=настоящий bin/vibelog-agent.mjs + мок-LM → startPhase получает JSON type=result (контракт stdout/stderr выдержан, MCP-деградация без падения).
- `CHANGELOG.md`, `docs/cli-reference.md` — документация CLI.
**Проверки:** pnpm build OK, pnpm test — 547/547.
**Что осталось:** decision-5 (переключение `VIBELOG_AGENT_BIN` с фолбэком на VIBELOG_QWEN_BIN) в статусе proposed — правка orchestrator.ts:187 не делалась, интеграция идёт через существующий VIBELOG_QWEN_BIN без изменений кода оркестратора (AC#4). Полная документация агента (docs/agent.md, README) — скоуп VL-87. TUI (VL-86) — текстовый прогресс в stderr как заглушка.
---
author: @agent
created: 2026-10-05 20:25
---
Фаза Close выполнена. Статус: Done. Коммит feat: 9c38631 — CLI vibelog-agent (headless JSON) и интеграция с оркестратором через VIBELOG_QWEN_BIN. Не входит в feat-коммит (смешаны с правками других задач эпика, ждут своих Фаз Close): package.json (bin.vibelog-agent + lint), docs/cli-reference.md (раздел vibelog-agent + TUI-абзац VL-86), CHANGELOG.md (записи VL-85/86/87/91), pnpm-lock.yaml и tsconfig.json (Ink-зависимости VL-86). Проверки: pnpm build OK; node --test src/agent src/web — 119/119. decision-5 (VIBELOG_AGENT_BIN) остаётся proposed — интеграция идёт через существующий VIBELOG_QWEN_BIN без правок оркестратора.
---
<!-- COMMENTS:END -->