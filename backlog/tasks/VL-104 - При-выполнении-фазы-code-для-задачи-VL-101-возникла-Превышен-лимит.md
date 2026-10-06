---
id: VL-104
title: 'Лимит max-wall-time фазы code: разбор сессии и настройка лимитов'
status: Review
assignee: []
reporter: ''
created_date: '2026-10-06 15:51'
updated_date: '2026-10-06 18:07'
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
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
При выполнении фазы code для задачи VL-101 возникла "Превышен лимит --max-wall-time (900 секунд) — фаза прервана."
1. Необходимо проанализировать сессию vb:agent-1791289270341 и если найдены какие-то ошибки, которые можно исправить путём исправления промпта фазы или кода - необходимо их применить.
2. Необходимо сделать настройку лимита времени через команду бота set max-wall-time X где X количество секунд, которые передаются при запуске по умолчанию, тоже самое заодно сделать и для количества запросов
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Сессия vb:agent-1791289270341 проанализирована; найденные ошибки исправлены в промпте фазы code и/или коде (или в задаче зафиксировано, что исправимых ошибок не найдено).
- [x] #2 Реализована команда бота `set max-wall-time X` (X — секунды), значение по умолчанию передаётся при запуске фазы.
- [x] #3 Реализована аналогичная команда `set max-requests X` для лимита количества запросов; обе настройки сохраняются и применяются при следующем запуске.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Часть 1 — разбор сессий (AC#1)

### Сессия vb:agent-1791289270341 (VL-101, Фаза 3 Code)
- 53 сообщения, 36 tool-calls; обрыв ровно по лимиту `--max-wall-time` (900с) на середине работы (последняя строка JSONL — tool-результат, финального JSON нет).
- **Ошибка, исправимая в коде:** 3 отклонения команд с `2>/dev/null` (сообщения 10, 11, 27) — ложное срабатывание `checkShellCommandInProject` (src/agent/tools.ts:247): `/dev/null` трактуется как абсолютный путь вне проекта. Каждый отказ = потерянный tool-call и минуты времени.
- Побочно: VL-101 осталась незавершённой (создан src/cli/update-check.ts, в CLI не подключён, build/test не гонялись) — зафиксировать в отчёте, исправление — вне рамок VL-104.

### Сессия vb:agent-1791291782972 (VL-104, Фаза 2 Plan)
- 69 сообщений; тоже обрыв по 900с.
- **Та же ошибка `/dev/null`:** 3 отказа (сообщения 8, 9, 56).
- **Новая ошибка, исправимая в коде:** сообщение 50 — команда `grep -rn "/set\|max-wall-time" docs README.md` отклонена: grep-паттерн `/set\|max-wall-time` (начинается с `/`, содержит regex-метасимволы) разобран как абсолютный путь.
- **Ошибка, исправимая в промпте:** сообщение 12 — `grep -rln "..." .` по всему проекту (node_modules, refs, .git) — таймаут 120с, SIGKILL. Потерян ~2 минуты и tool-call.

### Исправления (AC#1)
1. **src/agent/tools.ts**, `checkShellCommandInProject` (~стр. 239-264): перед проверкой `isAbsolute` (стр. 247) — allow-list спецфайлов `/dev/null`, `/dev/stdout`, `/dev/stderr`, `/dev/stdin`: эти токены пропускаются (не пути к данным пользователя).
2. **Там же:** токен, содержащий regex-метасимволы (`\|`, `\(`, `\[`, `^$*?+{}|` с обратным слэшем или без) — не путь, а паттерн grep/sed → пропуск проверки резолва. Это закрывает кейс `/set\|max-wall-time`. Логика остаётся лексической (остаточный риск — как и сейчас, задокументирован в JSDoc).
3. **src/agent/system-prompt.ts**, BASE_PROMPT (стр. 30-40): новое правило — «не запускай `grep -r`/`find` по всему проекту без `--exclude-dir=node_modules --exclude-dir=refs --exclude-dir=.git --exclude-dir=dist`; для поиска используй grep_search/glob с фильтрами».
4. **src/agent/tools.test.mjs**, describe `checkShellCommandInProject` (стр. 231+): кейсы — `cmd 2>/dev/null` → null; `ls /dev/stderr` → null; `grep -rn "/set\|max" docs` → null; регрессия: `ls /Users/bob/Desktop` → отказ (уже есть, стр. 251).

## Часть 2 — команды бота /set (AC#2, AC#3)

Решение: `max-requests` = лимит **LLM-запросов** (ходов цикла, numTurns), новый флаг агента `--max-requests`; `--max-tool-calls` (tool-calls) остаётся отдельным флагом. Дефолт при незаданной настройке — без лимита (поведение не меняется).

1. **src/bot/commands.ts** — `SetCommand` (стр. 64-71) → `key: 'agent' | 'max-wall-time' | 'max-requests'`, `value: AgentName | number`. `parseSetCommand` (стр. 282-300): ветвление по ключу; для чисел — валидация `Number.isInteger && > 0`; hint обновить: `/set agent <qwen|vb> | max-wall-time <сек> | max-requests <N>`.
2. **src/bot/settings.ts** — `BotSettings` (стр. 16-24) += `max_wall_time?: number`, `max_requests?: number`; `loadBotSettings` (66-86) — валидация положительных целых при чтении; `saveBotSettings` (91-107) — запись; резолверы `resolveMaxWallTime(cwd)`, `resolveMaxRequests(cwd)` по образцу `resolveDefaultAgent` (133-138), возврат `undefined` при отсутствии.
3. **src/bot/handlers.ts** — handler `/set` (стр. 547-563): switch по `parsed.key`; для `agent` — как сейчас; для `max-wall-time`/`max-requests` — `settings.max_wall_time/max_requests = parsed.value; saveBotSettings(...)`; ответ с подтверждением и синтаксисом сброса. Сброс: `/set max-wall-time 0` — удалить настройку (undefined).
4. **src/bot/registry.ts** — строка 37: description/usage `/set` обновить.
5. **src/agent/loop.ts** — `LoopLimits` (18-29) += `maxRequests?: number`; в `runLoop` (после стр. 93) — `const maxRequests = options.limits?.maxRequests`; проверка перед `streamChat` (стр. ~148): `if (numTurns + 1 > maxRequests) return fail('Превышен лимит --max-requests (N запросов) — фаза прервана.')` — по образцу проверки tool-calls (201-206).
6. **src/agent/cli.ts** — `CliOptions` (52-72) += `maxRequests?: number`; справка (80-97) += `--max-requests <N>`; `parseArgs` — ветка флага с валидацией (как --max-tool-calls, стр. 124-129); передача в `runLoop` limits (343-346).
7. **src/web/orchestrator.ts** — `spawnQwenRun` (167-231): при `agent === 'vb'` — импорт `loadBotSettings` из `../bot/settings.js`, чтение `max_wall_time`/`max_requests`; в массив аргументов spawn (стр. 228-230) добавить `--max-wall-time <сек>` / `--max-requests <N>`, если заданы. Для `qwen` флаги НЕ добавлять (не поддерживает). Отсутствие bot.yml — норма (loadBotSettings отдаёт defaults).
8. **Тесты:**
   - src/bot/commands.test.mjs (describe 325+): `max-wall-time 1800` → {key, value:1800}; `max-requests 50` → OK; `max-wall-time abc`, `0`, `-5` → error; `agent vb` — регрессия.
   - src/bot/settings.test.mjs: round-trip новых полей; битые значения в bot.yml игнорируются.
   - src/agent/loop.test.mjs (по образцу теста maxWallTimeMs=1, стр. 177): `maxRequests: 1` + llm с tool_calls → is_error «--max-requests».
   - src/agent/cli.test.mjs: parseArgs `--max-requests 42`; ошибка на `--max-requests 0`.
   - src/web/orchestrator.test.mjs (по образцу стр. 399): stub-агент пишет argv в маркер-файл — с bot.yml `{max_wall_time: 1800, max_requests: 50}` argv содержит оба флага; без настроек — не содержит.
9. **Документация (DoD):**
   - docs/agent.md: таблица флагов (стр. ~103) += `--max-requests`; раздел про /set (стр. ~152) — новые параметры.
   - docs/user-guide.md: раздел /set (стр. ~311) — синтаксис и семантика трёх параметров.
   - CHANGELOG.md: запись VL-104.

## Порядок действий
1. Часть 1: tools.ts (allow-list + regex-токены) → tools.test.mjs → system-prompt.ts.
2. Часть 2: loop.ts → cli.ts (+тесты) → commands.ts → settings.ts → handlers.ts → registry.ts (+тесты) → orchestrator.ts (+тест).
3. Документация, CHANGELOG.

## Проверки
```
pnpm build
pnpm test
```
Ключевые: `node --test src/agent/loop.test.mjs src/agent/cli.test.mjs src/agent/tools.test.mjs src/bot/commands.test.mjs src/bot/settings.test.mjs src/web/orchestrator.test.mjs`.

## Риски
- Зависимость web/orchestrator → bot/settings: цикла нет (bot/commands импортируется type-only, bot/handlers → orchestrator однонаправленно), но проверить сборку.
- Семантика `max-requests` = LLM-ходы, а не tool-calls — задокументировать, чтобы не путать с `--max-tool-calls`.
- Regex-эвристика в tools.ts может пропустить путь с метасимволами — остаточный риск, сопоставим с текущим (лексическая проверка по design, VL-99).
- qwen не получает новые флаги — ограничение `agent === 'vb'`, зафиксировать в docs/agent.md.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 15:53
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Лимит max-wall-time фазы code: разбор сессии и настройка лимитов» (прежний был обрезан). Масштаб: task. Уточнено: заголовок и критерии приёмки (разбор сессии vb:agent-1791289270341 с исправлением промпта/кода; команды бота set max-wall-time X и set max-requests X). Вопросов нет.
---
author: @agent
created: 2026-10-06 16:31
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу (2 части, ~15 файлов).
**Разбор сессий (AC#1):**
- `vb:agent-1791289270341` (VL-101, code): 53 сообщения, обрыв по лимиту 900с; 3 ложных отказа команд с `2>/dev/null` — баг `checkShellCommandInProject` (src/agent/tools.ts:247): `/dev/null` трактуется как путь вне проекта. Побочно: VL-101 осталась незавершённой (update-check.ts создан, в CLI не подключён) — вне рамок VL-104.
- `vb:agent-1791291782972` (VL-104, plan, моя сессия): 69 сообщений, тоже обрыв по 900с; те же 3 отказа `/dev/null`; новый класс ошибки — grep-паттерн `/set\|max-wall-time` (начинается с `/`, regex-метасимволы) отклонён как абсолютный путь; `grep -r` по всему проекту без исключений (node_modules/refs/.git) — таймаут 120с + SIGKILL.
**Исправления по результатам разбора (в плане):** allow-list `/dev/null` и пропуск regex-паттернов в `checkShellCommandInProject` + тесты; правило против `grep -r` по всему проекту в BASE_PROMPT агента.
**Настройка лимитов (AC#2/AC#3):** расширение `/set` на `max-wall-time <сек>` и `max-requests <N>` (лимит LLM-ходов, новый флаг `--max-requests`; решение: ≠ `--max-tool-calls`), хранение в `.vibelog/bot.yml`, прокидывание флагов оркестратором при spawn `vibelog-agent` (только для agent=vb; дефолт при незаданной настройке — без лимита). Затронуто: commands.ts, settings.ts, handlers.ts, registry.ts, loop.ts, cli.ts, orchestrator.ts + тесты + docs/agent.md, docs/user-guide.md, CHANGELOG.md.
Риски: цикл импортов web→bot отсутствует (проверить сборкой); семантика max-requests задокументирована; regex-эвристика — остаточный риск, сопоставим с текущей лексической проверкой (VL-99).
---
author: Pavel Bobarev
created: 2026-10-06 18:07
---
Фаза 3 (Code) выполнена вручную: сессия агента vb:agent-1791294001801 упала на середине (обрыв по контексту), патч-скрипт агента исказил src/agent/tools.ts (оборванная строка + продублированный хвост) и src/bot/handlers.ts (неэкранированные обратные кавычки) — оба файла восстановлены из HEAD с чистым повторным применением VL-104-правок.
**AC#1 (разбор сессий):** checkShellCommandInProject — allow-list /dev/null|stdout|stderr|stdin + пропуск regex/глоб-паттернов (isRegexPatternToken); правило против grep -r по всему проекту в BASE_PROMPT. Тесты: tools.test.mjs (3 новых it).
**AC#2/AC#3 (/set лимитов):** parseSetCommand расширен на max-wall-time/max-requests (0 — сброс), хранение в bot.yml (max_wall_time/max_requests + resolveMaxWallTime/resolveMaxRequests), новый флаг --max-requests в CLI агента + maxRequests в runLoop (проверка до streamChat), оркестратор прокидывает оба флага только для agent=vb. Тесты: commands, settings, loop, cli, orchestrator.
**Побочно:** сборка падала из-за незавершённого VL-101 (src/cli/update-check.ts импортирует неэкспортированный readPackageInfo) — добавлен экспорт в src/cli/commands/version.ts (поведение не менялось); сам update-check.ts в VL-101 не подключался — вне рамок VL-104. Временные скрипты агента scripts/tmp-vl104-*.mjs не коммитились.
**Проверки:** pnpm build — OK; pnpm test — 713/713 pass, fail 0 (единичные флаки прогонов Catalina/dyld не связаны с изменениями). Документация: docs/agent.md (флаги, лимиты, shell-валидация, интеграция с ботом), docs/user-guide.md (таблица параметров /set), CHANGELOG.md.
---
<!-- COMMENTS:END -->