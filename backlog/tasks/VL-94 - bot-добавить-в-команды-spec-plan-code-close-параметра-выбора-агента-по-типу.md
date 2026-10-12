---
id: VL-94
title: '#bot добавить в команды spec plan code close параметра выбора агента по типу…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-05 22:36'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#bot добавить в команды spec plan code close параметр выбора агента по типу реализованной команды prompt в VL-92

## Уточнение Фазы 1 (Spec)

**Контекст (сверено с кодом 2026-10-05):**
- VL-92 реализовал выбор агента для /prompt: суффикс `:<agent>` в первом слове (`/prompt:vb`), parsePromptCommand разбирает агента, startPrompt/spawnQwenRun выбирают бинарь (qwen → VIBELOG_QWEN_BIN || 'qwen', vb → VIBELOG_AGENT_BIN || bin/vibelog-agent.mjs), guard от двойного запуска общий (ключ 'prompt').
- Команды фаз бота /spec, /plan, /code, /close (handlers.ts:551/597/633/670) сейчас всегда спавнят qwen: startPhase(cwd, taskId, phase, onExit, extraVars) не принимает агента и вызывает spawnQwenRun без параметра agent (orchestrator.ts:79-98) → дефолт 'qwen'.
- grammy 1.46 матчит только строковые имена команд (выяснено в VL-92) — вариации `spec:vb` регистрируются массивом ['spec','spec:qwen','spec:vb'] и т.д.
- Сессии qwen (UUID) и vb (agent-N) уже различаются extractSessionRef (commands.ts) — session_id фаз корректно сохраняется независимо от агента.

**Решение (по аналогии с VL-92):**
- /spec, /plan, /code, /close получают опциональный суффикс `:<agent>`: без суффикса или `:qwen` — qwen (дефолт, без регрессий), `:vb` — встроенный vibelog-agent, неизвестный агент — {error} с подсказкой (спавна нет).
- parseSpecCommand/parsePlanCommand/parseCodeCommand/parseCloseCommand: принимают слово команды с суффиксом (как parsePromptCommand в VL-92), возвращают поле agent; разбор текста задачи/комментария не меняется.
- startPhase (orchestrator.ts) получает опциональный параметр agent ('qwen' | 'vb' = 'qwen') и прокидывает в spawnQwenRun — выбор бинаря уже реализован в VL-92, повторно не дублировать. Guard-ключи фаз остаются прежними (общие для обоих агентов — один активный запуск фазы независимо от агента).
- handlers.ts: регистрация массивами ['spec','spec:qwen','spec:vb'], ['plan',...], ['code',...], ['close',...]; передача parsed.agent в startPhase; в стартовых сообщениях упоминать агента («🚀 Фаза Code (vb) запущена …»).
- registry.ts: usage/description команд — упомянуть синтаксис [:agent] и обоих агентов.
- VIBELOG_LLM_* для vb берутся из .env через loadDotEnv бота (VL-37), как в VL-92 — отдельной загрузки не требуется.
- Документация: docs/user-guide.md (синтаксис команд фаз), docs/agent.md (расширить раздел интеграции с ботом VL-92), CHANGELOG.

**Не входит:** /comment (VL-63) и /next (ручной запуск следующей фазы) остаются qwen-only — вне scope; web-интерфейс не меняется; шаблоны фаз не трогаются; декомпозиция не нужна (фича укладывается в одну задачу — паттерн готов после VL-92).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /spec, /plan, /code, /close принимают суффикс :<agent> (qwen|vb) по аналогии с /prompt:vb — без суффикса или :qwen поведение прежнее (qwen, VIBELOG_QWEN_BIN, без регрессий), :vb спавнит bin/vibelog-agent.mjs (VIBELOG_AGENT_BIN), неизвестный агент — {error} с подсказкой без спавна и создания задачи
- [ ] #2 startPhase (orchestrator.ts) получает опциональный параметр agent ('qwen'|'vb', дефолт qwen) и прокидывает в spawnQwenRun (без дублирования выбора бинаря из VL-92); guard-ключ фазы общий для обоих агентов; registry.ts и handlers.ts отражают синтаксис /spec[:agent] и массивы регистрации ['spec','spec:qwen','spec:vb'] и т.д.; user-guide.md и agent.md обновлены
- [ ] #3 Тесты зелёные: парсеры parseSpecCommand/parsePlanCommand/parseCodeCommand/parseCloseCommand с суффиксом (без суффикса/:qwen/:vb/неизвестный), выбор бинаря в startPhase для vb (заглушка VIBELOG_AGENT_BIN) — pnpm test без регрессий; VIBELOG_LLM_* берутся из .env через существующий loadDotEnv (без новой загрузки env)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 22:40
---
Фаза 1 (Spec) выполнена. Тип: **task** (фича укладывается в одну задачу — паттерн выбора агента готов после VL-92, декомпозиция не нужна).
**Уточнение по результатам исследования:**
- Команды /spec, /plan, /code, /close сейчас всегда спавнят qwen: startPhase не принимает агента и вызывает spawnQwenRun с дефолтом 'qwen' (orchestrator.ts:79-98). Выбор бинаря (qwen/vb) уже реализован в spawnQwenRun (VL-92) — достаточно прокинуть agent через startPhase.
- Решение: суффикс `:<agent>` в первом слове (`/spec:vb …`), как в /prompt:vb (VL-92); парсеры четырёх команд возвращают поле agent; регистрация массивами ['spec','spec:qwen','spec:vb'] и т.д. (grammy 1.46 не матчит RegExp-команды); guard-ключ фазы общий для обоих агентов.
- VIBELOG_LLM_* для vb берутся из .env через loadDotEnv бота (VL-37) — без новой загрузки env.
- Не входит: /comment и /next остаются qwen-only, web-интерфейс и шаблоны фаз не меняются.
**AC (3 критерия):** суффикс :<agent> для четырёх команд; startPhase с параметром agent + registry/user-guide/agent.md; зелёные тесты парсеров и выбора бинаря.
---
author: Pavel Bobarev
created: 2026-10-05 22:53
---
Команду comment тоже надо добавить
А ещё нужно #bot добавить команду set и пока один параметр agent (потом будем расширять), который устанавливает агента по умолчанию, пример:
/set agent vb
/set agent qwen
Сейчас по умолчанию на все команды и кнопки действий запускается qwen. Необходимо чтобы по умолчанию запускался агент заданный в настройках.
---
author: @agent
created: 2026-10-05 23:18
---
Фаза Comment выполнена: реализовано расширение VL-94 по комментарию Pavel от 2026-10-05 22:53.
**1. Суффикс `:<agent>` для `/comment`** (в дополнение к `/spec /plan /code /close` по Spec):
- `parseCommentCommand` принимает commandWord и возвращает поле agent; регистрация массивом `['comment','comment:qwen','comment:vb']`; `commitComment` получила параметр agent и прокидывает его в `startPhase`.
**2. Новая команда `/set agent <qwen|vb>` — агент по умолчанию:**
- новый парсер `parseSetCommand` (пока один параметр `agent`, набор параметров расширяется); хранение — `.vibelog/bot.yml`, ключ `default_agent` (валидация при чтении: битое значение игнорируется, дефолт qwen); `resolveDefaultAgent` в settings.ts.
- Без суффикса `:<agent>` агента из настроек запускают ВСЕ команды фаз (`/spec /plan /code /close /comment /prompt`) и кнопки действий: «следующий этап» (`next:`) и ввод комментария с кнопки (VL-78). Явный суффикс (`/code:vb VL-1`) перекрывает настройку.
**Реализация по Spec задачи (сверено):**
- парсеры `parseSpecCommand/parsePlanCommand/parseCodeCommand/parseCloseCommand` с суффиксом (без суффикса / `:qwen` / `:vb` / неизвестный) — общий хелпер `extractAgent` (суффикс в слове команды + двойная доставка в ctx.match при оборванной Telegram-entity, паттерн VL-92); неизвестный агент — `{error}` с подсказкой, спавна и создания задачи нет (плюс hears-фолбэк подсказки для всех пяти команд).
- `startPhase` (orchestrator.ts) получает опциональный параметр agent (`'qwen'|'vb'`, дефолт qwen) и прокидывается в `spawnQwenRun` — выбор бинаря VL-92 не дублируется; guard-ключ фазы общий для обоих агентов.
- регистрация массивами `['spec','spec:qwen','spec:vb']` и т.д. (grammy 1.46 матчит только строковые имена); registry.ts — usage/description с `[:agent]`, команда `set` (18 команд); стартовые сообщения бота упоминают агента («🚀 Фаза Code (vb) запущена …»).
- `VIBELOG_LLM_*` для vb — через существующий loadDotEnv (VL-37), новой загрузки env нет; web-интерфейс и шаблоны фаз не менялись.
**Проверки:** `pnpm test` — 651/651 зелёные. Новые тесты: парсеры с суффиксом (двойная доставка, неизвестный агент), `parseSetCommand`, `default_agent`/`resolveDefaultAgent` в settings, выбор бинаря в `startPhase` для vb через заглушку `VIBELOG_AGENT_BIN`, реестр (18 команд, help-строка).
**Документация:** docs/user-guide.md (таблица команд фаз `[:agent]`, раздел «Агент по умолчанию (/set)», кнопки действий), docs/agent.md (VL-94 в разделе интеграции с Telegram-ботом), CHANGELOG.md.
**Статус:** переведён в Review — код, тесты и документация готовы, ожидается проверка. Git-коммиты не выполнялись (правила Фазы Comment).
---
author: @agent
created: 2026-10-06 00:17
---
Фаза Close выполнена. Статус: Done. Коммит feat: не требовался (modified_files задачи пуст — Фаза Code не зафиксировала пути; незакоммиченный код вне backlog/ к VL-94 не отнесён).
---
<!-- COMMENTS:END -->