---
id: VL-87
title: 'Документация агента: docs/agent.md, CHANGELOG, README'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 21:30'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies:
  - VL-85
  - VL-86
milestone: v1.7
references: []
priority: medium
type: ''
project: ''
parent_task_id: VL-75
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Документация агента Vibelog (компонент 10 эпика). Зависит от VL-85 (CLI) и VL-86 (TUI) — пишется по фактически реализованному поведению.

Создаётся docs/agent.md (на русском):
1. Назначение: замена qwen в фазах spec/plan/code/close/comment/prompt; мотивация — расход токенов (96k Comment, 935k Spec).
2. Установка и настройка: pnpm install && pnpm build; env Cloud.ru: VIBELOG_LLM_BASE_URL, VIBELOG_LLM_API_KEY, VIBELOG_LLM_MODEL; Node 20+.
3. Запуск: интерактивно (TUI), --headless (JSON type=result для оркестратора), флаги --max-tool-calls/--max-wall-time/--no-mcp; промпт фазы — из шаблонов templates/qwen-commands/ ({{taskId}}/{{comment}}).
4. Интеграция с оркестратором: VIBELOG_QWEN_BIN=$(pwd)/bin/vibelog-agent.mjs — без правок кода оркестратора; формат stdout совместим с parseQwenResult (src/web/qwen-result.ts).
5. Инструменты: 6 локальных (read_file, write_file, edit, run_shell_command, grep_search, glob) + vibelog MCP (backlog_*); ограничения путей и shell.
6. Loop detection и лимиты: 3 одинаковых вызова подряд → ошибка; --max-tool-calls (100), --max-wall-time (900).
7. Сравнение расхода токенов с qwen: замер через JSON usage (счётчики TUI + usage в JSON-результате), таблица-шаблон.

CHANGELOG.md: запись в Unreleased/следующей версии (русский стиль файла — проверить формат по git log/файлу). README.md: краткий блок со ссылкой на docs/agent.md (в разделе об оркестрации/фазах).

Проверка: pnpm build && pnpm test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/agent.md создана (на русском): назначение агента и сравнение с qwen (зачем: 96k/935k токенов на фазах), установка зависимостей (pnpm install), настройка Cloud.ru (VIBELOG_LLM_BASE_URL / VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL — пример .env и shell-переменных)
- [x] #2 Документированы все режимы запуска: vibelog-agent <phase> <taskId> (интерактивно с TUI), --headless (JSON для оркестратора), флаги --max-tool-calls/--max-wall-time/--no-mcp; пример интеграции с оркестратором: VIBELOG_QWEN_BIN=$(pwd)/bin/vibelog-agent.mjs vibelog browser
- [x] #3 Документированы инструменты агента (6 локальных + vibelog MCP), loop detection и лимиты (поведение при срабатывании), формат stdout (type=result, совместимость с parseQwenResult)
- [x] #4 Раздел «Сравнение расхода токенов»: как замерить (vibelog qwen-debug / JSON-usage агента), таблица-шаблон для заполнения после первых замеров
- [x] #5 CHANGELOG.md: запись об агенте (Unreleased/следующая версия); README.md: краткий раздел со ссылкой на docs/agent.md; package.json bin добавлен vibelog-agent (уже в VL-85 — проверить)
- [x] #6 pnpm build и pnpm test проходят (документация не ломает сборку)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
Документация агента Vibelog (компонент 10 эпика). Зависит от VL-85, VL-86 — пишется по фактическому поведению кода.

## Файлы
- docs/agent.md (новый)
- CHANGELOG.md (запись)
- README.md (раздел/ссылка)

## Шаги

### 1. Сверка фактов (по коду, не по памяти)
- grep по src/agent/*.ts: точные имена env (VIBELOG_LLM_BASE_URL / VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL), флаги CLI (--headless, --no-mcp, --no-tui, --max-tool-calls, --max-wall-time), дефолты лимитов (100 / 900 сек), поведение loop detection (3 подряд).
- grep по bin/vibelog-agent.mjs и package.json (bin vibelog-agent).
- Список инструментов: src/agent/tools.ts (6 имён) + vibelog MCP (src/mcp/tools.ts listTools).

### 2. docs/agent.md (на русском, ~150-250 строк)
Разделы:
1. Назначение и мотивация: замена qwen в фазах spec/plan/code/close/comment/prompt; расход токенов (96k Comment, 935k Spec).
2. Установка и настройка: pnpm install && pnpm build; env Cloud.ru с примером export в shell; Node 20+.
3. Запуск: интерактивно (TUI), --headless (JSON type=result для оркестратора), флаги --max-tool-calls/--max-wall-time/--no-mcp/--no-tui; промпт фазы — из шаблонов templates/qwen-commands/ ({{taskId}}/{{comment}}).
4. Интеграция с оркестратором: VIBELOG_QWEN_BIN=$PWD/bin/vibelog-agent.mjs — без правок кода оркестратора; stdout совместим с parseQwenResult (src/web/qwen-result.ts).
5. Инструменты: 6 локальных (read_file, write_file, edit, run_shell_command, grep_search, glob) + vibelog MCP; ограничения путей и shell.
6. Loop detection и лимиты: 3 одинаковых вызова подряд → ошибка; --max-tool-calls (100), --max-wall-time (900).
7. Сравнение расхода токенов с qwen: замер через JSON usage и счётчики TUI; таблица-шаблон qwen vs vibelog-agent.

### 3. CHANGELOG.md
sed -n '1,30p' CHANGELOG.md — повторить существующий стиль (разделы/даты/русские формулировки); запись в Unreleased или следующей версии — «Агент Vibelog: ...».

### 4. README.md
grep по README: раздел про фазы/оркестратор; абзац со ссылкой на docs/agent.md.

### 5. Проверка
- pnpm build && pnpm test (документация ничего не ломает).
- Перечитать docs/agent.md и сверить каждый флаг/env с grep по коду — расхождение = баг.

## Риски
- Документация уйдёт в отрыв от кода, если писать до VL-85/86 — задача стоит последней в цепочке; при раннем старте сверять по фактическому коду.
- Сравнение токенов без живого Cloud.ru-ключа не заполнится — таблица-шаблон, замеры после первого запуска Pavel.

## Уточнение по VL-77 (2026-10-05)

1. **Раздел сравнения с qwen:** базовый агент — @qwen-code/qwen-code 0.24.7 (refs/qwen-code, doc-3 §12); в docs/agent.md указать версию базы и формат замера (JSON usage поля input_tokens/output_tokens/cache_read_input_tokens/total_tokens, счётчики TUI).
2. **Ссылки на решения:** decision-1..5 (backlog/decisions/, статус proposed на 2026-10-05) — упомянуть в docs/agent.md: MCP-клиент минимальный самописный, TUI Ink (официальный 7.0.3 — кандидат, см. VL-86), LLM-клиент Cloud.ru через fetch, loop detection + лимиты, headless-контракт parseQwenResult.
3. **Открытые вопросы для документации (doc-4 §9):** streaming Cloud.ru (probe), дефолтная модель VIBELOG_LLM_MODEL, версия Ink — зафиксировать в docs/agent.md как «решается при реализации».
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 20:18
---
Фаза 3 (Code) выполнена.
**Изменено:**
- `docs/agent.md` (новый, ~180 строк, на русском): назначение и мотивация (замена qwen, 96k/935k токенов на Comment/Spec), установка (`pnpm install && pnpm build`, Node 20+), настройка Cloud.ru (`VIBELOG_LLM_BASE_URL` дефолт `https://foundation-models.api.cloud.ru/v1` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_MODEL`, примеры shell и `.env`), режимы запуска (TUI на stderr, `--headless`, `--output-format json` = headless, флаги `--comment`/`--no-mcp`/`--no-tui`/`--max-tool-calls`/`--max-wall-time`, qwen-совместимые `--approval-mode`/`--allowed-mcp-server-names` игнорируются), интеграция с оркестратором (`VIBELOG_QWEN_BIN=$(pwd)/bin/vibelog-agent.mjs vibelog browser`, stdout — JSON `type=result` для `parseQwenResult`), инструменты (6 локальных + 21 vibelog MCP, ограничения путей/shell, отказ MCP не фатален), loop detection (сигнатура = имя+JSON аргументов, 3 подряд) и лимиты (100 tool-calls / 900 сек, поведение при срабатывании: partial + ошибка в result, exit 1), замер токенов (`vibelog qwen-debug` + JSON usage, таблица-шаблон), решения decision-1..5 и открытые вопросы VL-77/doc-4 §9. Все факты сверены grep'ом по `src/agent/*` (не по памяти).
- `CHANGELOG.md`: запись VL-87 в Unreleased (после VL-85, стиль Keep a Changelog на русском).
- `README.md`: строка в таблице «Документация» + подраздел «Агент Vibelog (замена qwen)» в «Работа с Qwen Code» со ссылкой на docs/agent.md.
**Проверки:** `pnpm build` OK. `pnpm test` — 600/601: единственный фейл `src/web/static.test.mjs` — флаки параллельного test-runner («Unable to deserialize cloned data», баг сериализации между процессами); отдельно `node --test src/web/static.test.mjs` — 6/6 pass. Правки только .md-файлы, на тесты не влияют.
**Отмечено:** AC #1-#6, DoD #2-#3. DoD #1 «Тесты проходят» оставлен незакрытым из-за флаки в полном прогоне (см. выше; не связано с этой задачей).
**Что осталось:** заполнить таблицу-шаблон сравнения токенов в docs/agent.md §7 после первых живых замеров на Cloud.ru-ключе; `pnpm test` без флаки-фейла — после стабилизации test-runner (отдельная задача, вне VL-87).
---
author: @agent
created: 2026-10-05 20:34
---
Фаза Close выполнена. Статус: Done.
Коммит feat: 8c378a3 — документация агента: docs/agent.md, CHANGELOG, README (docs/agent.md + запись CHANGELOG VL-87 + раздел README со ссылкой на docs/agent.md).
Подзадач не упоминалось — файлы подзадач не коммитились.
DoD #1 «Тесты проходят» оставлен незакрытым (флаки static.test.mjs в полном прогоне — см. отчёт Фазы 3).
---
<!-- COMMENTS:END -->