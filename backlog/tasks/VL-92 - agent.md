---
id: VL-92
title: '#agent'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-05 20:47'
updated_date: '2026-10-05 23:07'
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
#agent 
1. VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL - заданы в .env
2. Команде бота prompt необходимо задать опциональный параметр вида "/prompt:<agent>", где по умолчанию будет qwen, а если вызываем "/prompt:vb промпт", то запускаем через нашего нового встроенного агента

## Уточнение Фазы 1 (Spec)

**Контекст (сверено с кодом 2026-10-05):**
- `/prompt` (VL-66): хендлер в `src/bot/handlers.ts` → `parsePromptCommand` (`src/bot/commands.ts`) → `startPrompt` (`src/web/orchestrator.ts`) → `spawnQwenRun` спавнит бинарь `qwen` (`VIBELOG_QWEN_BIN`, дефолт `qwen`) с шаблоном prompt.md; guard от двойного запуска — ключ `'prompt'` в activeRuns.
- Встроенный агент Vibelog (VL-84..87, `src/agent/`, бинарь `bin/vibelog-agent.mjs`) qwen-совместим по CLI: позиционный промпт, `--approval-mode`/`--output-format json` (=headless) принимаются и игнорируются/включают headless; stdout — одна JSON-строка `type=result`, парсится `parseQwenResult` (LoopResult совместим с QwenResult).
- `.env` проекта загружается ботом через `loadDotEnv` (VL-37, `src/bot/env.ts`) в process.env — VIBELOG_LLM_* наследуются дочерним процессом агента без дополнительной настройки.

**Решение:**
- `parsePromptCommand`: опциональный суффикс `:<agent>` в первом слове (`/prompt:vb ...`); без суффикса или `:qwen` — qwen; `vb` — встроенный агент; неизвестный агент — `{error}` с подсказкой supported-списком (qwen, vb), спавна нет.
- `startPrompt` получает параметр agent: для `vb` спавнится `bin/vibelog-agent.mjs` (разрешение пути от dist/ через import.meta.url, аналогично шиму; опционально env `VIBELOG_AGENT_BIN`) с теми же qwen-совместимыми флагами; guard `'prompt'` общий для обоих агентов.
- Регистрация в боте: grammy `bot.command` в этой версии НЕ поддерживает RegExp-триггеры (has.command сравнивает строковые Set'ы) → регистрировать массив `['prompt', 'prompt:vb']` либо отдельный хендлер для `prompt:vb`.
- `src/bot/registry.ts`: обновить usage/description команды prompt (`/prompt[:agent] <текст>`).
- LLM-переменные: из `.env` через уже существующий `loadDotEnv` — отдельной загрузки не требуется; при отсутствии VIBELOG_LLM_API_KEY агент печатает ошибку в stderr и is_error JSON — уходит в чат штатным `sendPhaseResult`.
- Документация: `docs/user-guide.md` (раздел /prompt), `docs/agent.md` (интеграция с ботом), CHANGELOG.

**Не входит:** декомпозиция на подзадачи (фича укладывается в одну), изменение TUI/CLI агента, изменение шаблона prompt.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда /prompt без суффикса и /prompt:qwen ведут себя как раньше (спавн qwen, шаблон prompt.md); /prompt:vb <запрос> запускает встроенного агента Vibelog (bin/vibelog-agent.mjs) с тем же guard от двойного запуска
- [x] #2 parsePromptCommand разбирает :<agent>: неизвестный агент → {error} с подсказкой (поддерживаются qwen, vb), без спавна; реестр команд бота (registry.ts) и user-guide отражают синтаксис /prompt[:agent] <текст>
- [x] #3 Тесты: парсер /prompt с суффиксом (qwen/в/неизвестный) и выбор бинаря в startPrompt — зелёные; VIBELOG_LLM_* берутся из .env через существующий loadDotEnv бота (без новой загрузки env)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## VL-92 — /prompt с выбором агента (qwen | встроенный vibelog-agent)

Фича укладывается в одну задачу — блокер не нужен. Все кирпичи уже готовы: встроенный агент VL-84..87 qwen-совместим по CLI, .env с VIBELOG_LLM_* грузится ботом через loadDotEnv (VL-37).

### Файлы для изменения

1. **src/bot/commands.ts** — парсер и тип.
   - Интерфейс `PromptCommand` (~строка 52): добавить поле `agent: 'qwen' | 'vb'`.
   - `parsePromptCommand` (~строка 232): теперь принимает второй параметр `agent` (строка вида `prompt:vb`, приходит из хендлера) и возвращает `{ text, agent }`. Правила разбора суффикса `:<agent>` в первом слове: без суффикса → qwen; `:qwen` → qwen; `:vb` → vb; неизвестный → `{ error }` с подсказкой `Синтаксис: /prompt[:agent] <запрос> (агенты: qwen, vb)`. Пустой текст → error (как сейчас).

2. **src/web/orchestrator.ts** — выбор бинаря для агента.
   - `startPrompt` (~строка 106): новый опциональный параметр `agent: 'qwen' | 'vb' = 'qwen'`; прокидывает его в `spawnQwenRun`. Guard-ключ остаётся `'prompt'` (общий для обоих агентов — один активный /prompt независимо от агента).
   - `spawnQwenRun` (~строка 128): выбор бинаря вместо жёсткого `process.env.VIBELOG_QWEN_BIN || 'qwen'` (~строка 140):
     - `agent === 'qwen'` → `process.env.VIBELOG_QWEN_BIN || 'qwen'` (как сейчас, без регрессий);
     - `agent === 'vb'` → `process.env.VIBELOG_AGENT_BIN` либо путь `bin/vibelog-agent.mjs`, вычисленный от `import.meta.url` (файл лежит в dist/web/, отсюда `../../bin/vibelog-agent.mjs`, аналогично шиму bin/vibelog.mjs).
   - Флаги спавна не меняются: `[prompt, '--approval-mode', 'yolo', '--output-format', 'json']` — агент их принимает (cli.ts:129-134 съедает/включает headless).
   - Для `vb` обязателен env-контракт LLM: `VIBELOG_LLM_BASE_URL`/`VIBELOG_LLM_API_KEY`/`VIBELOG_LLM_MODEL` — берутся из process.env, куда бот уже кладёт .env через loadDotEnv; агент при отсутствии ключа сам печатает ошибку в stderr и печатает JSON `type=result` с `is_error=true` (cli.ts:197-208) — уходит в чат штатным sendPhaseResult. Дополнительной загрузки .env НЕ требуется.

3. **src/bot/handlers.ts** — регистрация и вызов.
   - Регистрация (~строка 701): grammy `bot.command` в этой версии НЕ принимает RegExp (has.command сравнивает строковые Set'ы, context.js:22-48) → зарегистрировать массив `['prompt', 'prompt:qwen', 'prompt:vb']` одним хендлером.
   - Хендлер: передаёт в parsePromptCommand `ctx.match` + слово команды с суффиксом; вызывает `startPrompt(deps.cwd, parsed.text, onExit, parsed.agent)`; стартовое сообщение — агент в тексте («🚀 Запрос отправлен в qwen/vibelog-agent, PID …»).

4. **src/bot/registry.ts** — строка 42: usage → `/prompt[:agent] <текст>`, description → упомянуть обоих агентов (qwen или встроенный vibelog).

5. **docs/user-guide.md** — строка 298-300: синтаксис `/prompt[:agent] <текст>`, таблица агентов (qwen — дефолт, vb — встроенный), требование VIBELOG_LLM_* в .env для vb.

6. **docs/agent.md** — новый подраздел «Интеграция с Telegram-ботом (/prompt:vb)»: бот спавнит bin/vibelog-agent.mjs с qwen-совместимыми флагами, .env наследуется через loadDotEnv, guard общий.

7. **CHANGELOG.md** — пункт «VL-92: /prompt с выбором агента» в [Unreleased] → Добавлено.

### Порядок действий

1. commands.ts: тип PromptCommand + parsePromptCommand (суффикс агента).
2. orchestrator.ts: startPrompt/spawnQwenRun — параметр agent и выбор бинаря (vb → bin/vibelog-agent.mjs).
3. handlers.ts: регистрация массива + передача agent + текст сообщения.
4. registry.ts + registry.test.mjs (usage-строка, help-строка).
5. Тесты: commands.test.mjs (парсер с суффиксом), orchestrator.test.mjs (выбор бинаря для vb через заглушку VIBELOG_AGENT_BIN).
6. Документация: user-guide.md, agent.md, CHANGELOG.

### Тесты (расширить существующие)

- **src/bot/commands.test.mjs** (describe 'parsePromptCommand', ~строка 190): суффикс `prompt:vb` → agent vb; `prompt:qwen` → qwen; без суффикса → qwen; `prompt:foo` → error с подсказкой (поддерживаются qwen, vb); пустой текст → error.
- **src/web/orchestrator.test.mjs** (блок VL-66/67, ~строка 313): тест выбора бинаря — для agent='vb' спавн идёт через VIBELOG_AGENT_BIN (заглушка VL28_STUB пишет argv в маркер, проверяем что бинарь заглушки запущен и запрос подставлен); для 'qwen' поведение прежнее (VIBELOG_QWEN_BIN). Существующие тесты startPrompt (строки 323-367) не ломаются — 4-й параметр опционален с дефолтом qwen.
- **src/bot/registry.test.mjs**: usage `/prompt[:agent] <текст>` (строка 25-29), help-строка (строка 46).

### Проверка

```bash
pnpm build && node --test src/bot/commands.test.mjs src/web/orchestrator.test.mjs src/bot/registry.test.mjs
pnpm test   # полный прогон
```

### Риски

- **grammy не матчит `/prompt:vb` автоматически** — решено регистрацией массива ['prompt','prompt:qwen','prompt:vb']. Регрессия: /prompt без суффикса обязан работать как раньше.
- **Путь к bin/vibelog-agent.mjs от import.meta.url** зависит от структуры dist/ (dist/web/orchestrator.js → ../../bin/). При изменении структуры сборки путь сломается — покрыто тестом выбора бинаря.
- **Общий guard 'prompt'** — если запущен qwen-промпт, /prompt:vb получит «Запуск уже выполняется» (ожидаемо, так и задумано).
- **LLM-переменные**: при отсутствии VIBELOG_LLM_API_KEY агент падает с is_error JSON — это штатный путь ошибки, карточка/сообщение об ошибке уходит в чат; доп. ветка не нужна.
- **VL-90 меняет handlers.ts/registry.ts параллельно** (Фаза 3 /commits) — перед правкой перечитать эти файлы, не накладывать изменения /prompt на чужие /commits-хаки.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 20:53
---
Фаза 1 (Spec) выполнена. Тип: task. Краткое описание уточнения: фича укладывается в одну задачу — опциональный суффикс агента в команде бота /prompt. Исследование показало, что все кирпичи уже готовы: встроенный агент Vibelog (VL-84..87) имеет qwen-совместимый CLI (bin/vibelog-agent.mjs, позиционный промпт, --output-format json → headless, stdout — JSON type=result, парсится штатным parseQwenResult), а .env проекта с VIBELOG_LLM_* уже загружается ботом через loadDotEnv (VL-37) в process.env — дочерний процесс агента наследует их без доп. настройки. Решение: parsePromptCommand разбирает :<agent> (дефолт qwen, vb — встроенный агент, неизвестный → error с подсказкой), startPrompt получает параметр agent и для vb спавнит bin/vibelog-agent.mjs с теми же qwen-совместимыми флагами; guard от двойного запуска (ключ 'prompt') общий. Учтено ограничение grammy: bot.command не принимает RegExp — регистрация массивом ['prompt', 'prompt:vb']. Описаны также registry.ts (usage), user-guide.md, docs/agent.md, CHANGELOG. В описание добавлены контекст/решение/границы, к критериям приёмки добавлено 3 конкретных критерия.
---
author: @agent
created: 2026-10-05 21:22
---
Фаза 2 (Plan) выполнена. Тип: task — план записан в задачу (implementationPlan). Краткое описание плана: фича укладывается в одну задачу, блокер не создавался. Ключевые решения, сверенные с кодом: (1) parsePromptCommand получает второй параметр — слово команды с суффиксом (:qwen/:vb) и возвращает {text, agent}; неизвестный агент → error с подсказкой, спавна нет; (2) grammy в этой версии не матчит RegExp-команды (has.command сравнивает строковые Set'ы) — регистрация массивом ['prompt', 'prompt:qwen', 'prompt:vb'] одним хендлером; (3) startPrompt/spawnQwenRun получают параметр agent: для vb бинарь — process.env.VIBELOG_AGENT_BIN либо bin/vibelog-agent.mjs (путь от import.meta.url через ../../bin, аналогично шиму), флаги спавна не меняются (агент их принимает, cli.ts:129-134); guard-ключ 'prompt' общий для обоих агентов; (4) LLM-переменные VIBELOG_LLM_* берутся из process.env — бот уже грузит .env через loadDotEnv (VL-37), доп. загрузка не требуется; при отсутствии ключа агент печатает is_error JSON и уходит в чат штатным sendPhaseResult; (5) registry.ts (usage /prompt[:agent] <текст>), user-guide.md, docs/agent.md (новый подраздел интеграции с ботом), CHANGELOG. Тесты: парсер с суффиксом (commands.test.mjs), выбор бинаря для vb через заглушку VIBELOG_AGENT_BIN (orchestrator.test.mjs — существующие тесты startPrompt не ломаются, 4-й параметр опционален), usage/help-строки (registry.test.mjs). Проверка: pnpm build && pnpm test. Риск: handlers.ts/registry.ts параллельно меняет Фаза 3 VL-90 — перед правкой перечитать файлы.
---
author: @agent
created: 2026-10-05 22:09
---
Фаза 3 (Code) выполнена. Реализация по плану VL-92 (декомпозиция не понадобилась — фича уложилась в одну задачу).
**Изменено:**
- `src/bot/commands.ts` — `PromptCommand` получил поле `agent: 'qwen' | 'vb'`; `parsePromptCommand(text, commandWord?)` разбирает суффикс `:<agent>`: из слова команды (`prompt:vb` — grammy 1.46 не отдаёт ctx.command, хендлер берёт первое слово сообщения) и из начала ctx.match (Telegram-entity может оборваться на `prompt`); неизвестный агент → `{error}` с подсказкой `Синтаксис: /prompt[:agent] <запрос> (агенты: qwen, vb)` без спавна; ведущий `:qwen`/`:vb` в тексте срезается, неизвестный `:токен` — просто текст запроса.
- `src/web/orchestrator.ts` — `startPrompt`/`spawnQwenRun` получили параметр `agent` (дефолт `'qwen'` — существующие вызовы и тесты не меняются): для `vb` бинарь — `VIBELOG_AGENT_BIN` либо `bin/vibelog-agent.mjs` (путь от `import.meta.url`, `../../bin/`); флаги спавна не меняются (агент qwen-совместим по CLI, VL-85); guard-ключ `'prompt'` общий для обоих агентов.
- `src/bot/handlers.ts` — регистрация массивом `['prompt', 'prompt:qwen', 'prompt:vb']` (grammy 1.46 матчит только строковые Set'ы); хендлер передаёт agent в `startPrompt`, стартовое сообщение называет агента (через escapeMarkdownV2); hears-фолбэк `^/prompt:(\S+)` — подсказка для неизвестных суффиксов, если Telegram-entity обрывается на двоеточии и command-хендлер не сматчит.
- `src/bot/registry.ts` — usage `/prompt[:agent] <текст>`, описание упоминает обоих агентов (само имя `prompt` в реестре — без суффиксов: двоеточие запрещено в BotCommand.command, меню Telegram не меняется).
- Тесты: `commands.test.mjs` (парсер: qwen/vb/неизвестный/двойная доставка суффикса/пустой текст), `orchestrator.test.mjs` (выбор бинаря для vb через заглушку VIBELOG_AGENT_BIN при заведомо битом VIBELOG_QWEN_BIN; guard общий qwen↔vb; VIBELOG_AGENT_BIN добавлен в savedEnv), `registry.test.mjs` (usage/help-строки; coverage-тест понимает регистрацию массивом и проверяет привязку суффиксных вариантов к реестру).
- Документация: `docs/user-guide.md` (таблица агентов, требование VIBELOG_LLM_* в .env для vb), `docs/agent.md` (подраздел «Интеграция с Telegram-ботом (/prompt:vb)»), `CHANGELOG.md` (VL-92 в [Unreleased]).
**Проверки:** `pnpm build` OK; целевые тесты 69/69; полный `pnpm test` — 625/625 (в первом прогоне 3 флака-отмены под нагрузкой, повторный прогон чистый). VIBELOG_LLM_* — без новой загрузки env: бот кладёт .env в process.env через loadDotEnv (VL-37), дочерний процесс агента наследует.
**Отступления от плана:** (1) суффикс разбирается и из ctx.match, а не только из слова команды — покрывает оборванную Telegram-entity (двойная доставка); (2) добавлен hears-фолбэк подсказки для неизвестных суффиксов — в чистом варианте плана `/prompt:foo` при оборванной entity молчал бы; (3) в registry.test.mjs обновлён coverage-тест (regex не понимал массивы) — без этого тест падал бы.
**Что осталось:** ручная проверка в живом Telegram (спавн qwen/vb через бота) — автотестами не покрывается; git-стенд VL-90 параллельно менял handlers.ts/registry.ts, но к моменту правок его Фаза 3 была закоммичена (0a43d83) — конфликта не было. Коммит не выполнялся (по правилам Фазы 3).
---
author:  @agent
created: 2026-10-05 23:07
---
Фаза Close выполнена. Статус: Done. Коммит feat: не требовался — поле modified_files пусто, а незакоммиченный код VL-92 (src/bot/handlers.ts, commands.ts, registry.ts, src/web/orchestrator.ts, тесты, CHANGELOG.md, docs/user-guide.md, docs/agent.md) смешан в рабочем дереве с правками параллельно работающих фаз VL-93 (Comment: resume сессии по reply — свой код в handlers.ts/orchestrator.ts/commands.ts + formatting.ts/rich.ts) и VL-94 (Comment: /set и команда comment). Коммит сейчас зафиксировал бы недописанный чужой код и сломал атрибуцию — паттерн VL-91, подтверждённый 2026-10-05. Их закоммитят close VL-93/VL-94, когда рабочее дерево станет чистым. Коммит docs(task): файл задачи VL-92 (смена статуса + этот отчёт). Подзадач у VL-92 нет (type=task, фича уложилась в одну задачу).
---
<!-- COMMENTS:END -->