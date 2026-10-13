---
id: VL-122
title: 'vb-агент: ограничение истории сообщений для LLM в длинных сессиях (компакшн)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-13 12:49'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/bot/commands.ts
  - src/bot/commands.test.mjs
  - src/bot/settings.ts
  - src/bot/settings.test.mjs
  - src/bot/handlers.ts
  - src/bot/registry.ts
  - src/bot/registry.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
llm.ts каждую итерацию шлёт LLM всю историю сообщений без ограничений. Рост контекста — причина замедления ходов до 5–15 минут и деградации ответов (пустой финал VL-98; сам случай закрыт guard'ом VL-110, но причина остаётся). Обрезка tool-выводов до 8KB (VL-110) снизила приток, однако длинные сессии (десятки ходов с правками и тестами) продолжают раздувать запрос.

Решение: ограничение истории для запроса — сохранять system + первое user-сообщение (постановку задачи) + последние N сообщений (константа/настройка); усечение отмечать служебной строкой в последнем user-сообщении запроса («история усечена, полный транскрипт — в сессии»). Важно: jsonl-транскрипт на диске НЕ усекать — по нему работают resume и мета-логика (VL-103/VL-110); обрезается только payload LLM-запроса. Дополнительная выгода: меньше промпт = быстрее ходы = реже wall-time убийства (см. также задачу по wall-time-бюджету).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 llm/loop: история для LLM-запроса ограничивается — system + первый user + последние N сообщений (N конфигурируемо, дефолт обоснован); транскрипт сессии (jsonl) остаётся ПОЛНЫМ — обрезается только то, что уходит в запрос
- [x] #2 loop.test.mjs/cli.test.mjs: длинная история усекается; финальный ответ и контракт resume (VL-103: транскрипт заканчивается assistant) не ломаются; служебная заметка об усечении присутствует в запросе
- [ ] #3 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## VL-122 — Усечение истории для LLM-запроса (wire-компакшн, этап 1 по doc-13)

### Архитектурное решение (по doc-13, §4.1)

Детерминический wire-компакшн **внутри `runLoop` (src/agent/loop.ts), перед `streamChat`**. Ключевые свойства:

- **`messages` (в памяти) и jsonl-транскрипт НЕ мутируются** — усекается только payload, который уходит в провайдер. `onMessage` (VL-103), `LoopResult.messages` (VL-95/VL-103 resume-контракт), loop-guard VL-119 и пустой-финал-guard VL-110 работают с полной историей — без изменений.
- **Триггер — по usage-токенам** последнего ответа (`input_tokens + cache_read_input_tokens`, поля уже нормализованы `mapUsage` в llm.ts:116–140): порог **850 000** (85% окна MiMo-V2.5 = 1M, auto-порог doc-13 §4.0). Редкое срабатывание → почти не бьёт по prefix-caching (дешёвый cache read MiMo).
- **Липкий якорь**: после первого срабатывания запоминаем индекс отсечения `compactFrom`; следующие запросы = `system + первый user + messages.slice(compactFrom)` — **append-only префикс, кэш стабилен** между запросами. При повторном превышении порога (сессия снова раздулась) якорь сдвигается вперёд.
- **Сохраняем дословно**: system-сообщения + первое user-сообщение (постановка) + хвост. **Хвост по умолчанию — 50 сообщений**: tool-вывод ≤8KB (лимит VL-110, tools.ts:41,406) → ≤400KB ≈ ≤130K токенов ≈ 13% окна — попадает в рекомендованный doc-13 хвост «10–15% окна».
- **Служебная заметка** — по тексту задачи: при срабатывании в wire-КОПИИ первого user-сообщения дописывается строка «[История усечена: опущено K сообщений. Полный транскрипт — в сессии.]». Маркер появляется один раз в момент компакшна (не на каждом запросе) — префикс ломается только в момент усечения.
- **Орфан-гард**: хвост не должен начинаться с `role: 'tool'` без парного assistant(tool_calls) — провайдер отклонит payload. Якорь сдвигается вперёд, пока `messages[compactFrom].role === 'tool'`.
- **`llm.ts` не меняется** — компакшн живёт выше `streamChat`; `toWireMessages` (llm.ts:237) работает как раньше.
- **interactive.ts не меняется** — компакшн в runLoop покрывает и интерактивный чат, и headless/cli автоматически.
- Вне объёма этапа 1 (отдельная задача при реальной потребности): LLM-саммари (doc-13 §4.2), microcompact tool-выводов, fallback на HTTP 413/400 (`payload_overflow`).

### Файлы для изменения

1. **src/agent/loop.ts**
   - `LoopLimits` (стр. ~17–36): добавить поля `compactTailMessages?: number` (хвост, N) и `compactAtTokens?: number` (порог триггера) с JSDoc.
   - Блок констант (стр. ~97–108, после `INTENT_LOOP_REPEAT_DEFAULT`): `COMPACT_TAIL_DEFAULT = 50` и `COMPACT_AT_TOKENS_DEFAULT = 850_000` с комментарием-обоснованием (см. выше).
   - Экспортируемая чистая функция `compactWireMessages(messages, tailCount, note)` (после `runLoop` или перед ней): возвращает `ChatMessage[]`-копию `[...system, первый user, ...хвост]`; первый user в копии получает дописанную служебную заметку; орфан-гард сдвигает начало хвоста past `tool`-сообщений; если отсекать нечего (якорь ≤ индекс первого user) — возвращает исходный массив (без маркера).
   - В `runLoop`: стейт `let compactFrom: number | null = null` и `let lastPromptTokens = 0`; после `addUsage(usage, response.usage)` (стр. ~213) обновлять `lastPromptTokens = response.usage.input_tokens + response.usage.cache_read_input_tokens`; перед `options.llm.streamChat(messages, ...)` (стр. ~207): если `lastPromptTokens >= compactAtTokens` и `compactFrom === null` — вычислить `compactFrom = messages.length - tailN` (+ орфан-гард); если `compactFrom !== null` — передавать в streamChat `compactWireMessages(...)`, иначе `messages` как есть. Re-anchor: при `lastPromptTokens >= порога` после уже существующего `compactFrom` — сдвинуть якорь снова.
2. **src/agent/cli.ts**
   - `CliOptions` (после `maxRequests`, стр. ~70): `compactTail?: number`, `compactAtTokens?: number`.
   - `USAGE` (стр. ~89–91): две строки справки по флагам.
   - `parseArgs` (после ветки `--max-requests`, стр. ~143–149): парсинг `--compact-tail <N>` и `--compact-at-tokens <N>` (положительное целое, throw с русским текстом — по образцу `--max-tool-calls`).
   - `limits` объект в `runLoop`-вызове (стр. 434–438): прокинуть оба поля.
3. **src/agent/loop.test.mjs** — новый `describe('компакшн истории (VL-122)')`:
   - история длиннее хвоста + первый ответ с `usage: {input_tokens: 900_000}` → 2-й запрос мока получает усечённый payload: system + первый user со служебной заметкой + последние N; середина отсутствует;
   - `LoopResult.messages` и все вызовы `onMessage` — ПОЛНАЯ история (jsonl не тронут), финальный ответ корректен (контракт resume: последнее сообщение assistant);
   - порог не превышен → payload идентичен `messages` (без заметки);
   - хвост, начинающийся с `tool`-сообщений, пропускается (нет осиротевшего tool);
   - липкий якорь: 3-й запрос append-only расширяется от того же якоря (префикс стабилен);
   - `fakeLlm` (стр. 19–41) уже клонирует messages и принимает usage из сценария — достаточно новых сценариев, хелперы существуют.
4. **src/agent/cli.test.mjs**
   - `parseArgs`: `--compact-tail 5`, `--compact-at-tokens 1000` → opts; невалидное значение → throw;
   - интеграционный: `--resume` длинной сессии + мок-LM через `llmHandler` (стр. 35–38): 1-й запрос → usage 900_000 + tool_calls, 2-й запрос — в `llmRequests[1].messages` проверить усечение и наличие служебной заметки; финальный JSON парсится `parseQwenResult`, jsonl-файл сессии содержит ПОЛНУЮ историю и оканчивается assistant (VL-103/VL-110 инварианты не сломаны).
5. **CHANGELOG.md** — в `## [Unreleased]` → `### Изменено` запись «**VL-122: усечение истории LLM-запроса в длинных сессиях**» с описанием триггера/дефолтов/флагов и ссылкой на doc-13.

### Порядок действий

1. loop.ts: константы → `compactWireMessages` → стейт/интеграция в `runLoop`.
2. `pnpm build` — компиляция strict TS.
3. loop.test.mjs: тесты компакшна → `pnpm build && npx vitest run src/agent/loop.test.mjs`.
4. cli.ts: флаги + прокидывание; cli.test.mjs: parseArgs + интеграционный → `npx vitest run src/agent/cli.test.mjs`.
5. CHANGELOG.md.
6. Полная проверка: `pnpm test` (build + vitest, 52 файла / ~840+ тестов) — зелёный, без регрессий VL-103/VL-110/VL-119.

### Как проверить

```bash
pnpm build
npx vitest run src/agent/loop.test.mjs src/agent/cli.test.mjs
pnpm test   # обязательный финал
```

### Риски

- **400 от провайдера на осиротевшем tool-сообщении** — закрыт орфан-гардом + тестом; если хвост целиком состоит из tool-сообщений — компакшн пропускается (fallback: исходный payload).
- **Первый запрос после resume остаётся гигантским** — триггер по usage срабатывает только после первого ответа; приемлемо (один ход), в.ylabel-бюджете укладывается.
- **Маркер в первом user-сообщении меняет префикс** — один раз в момент компакшна (by design, doc-13 §4.0); далее append-only.
- **Тесты мока usage** — fakeLlm подмешивает `usage` из сценария (zeroUsage + spread), большие значения не ломают суммирование `addUsage`.
- **HTTP 413/400 до срабатывания триггера** — не покрывается этапом 1; при реальных кейсах заводить follow-up (doc-13 `payload_overflow`).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 09:52
---
VL-136 завершён: создан сравнительный документ «Компакшн контекста: Qwen Code vs OpenCode — сравнение и рекомендация для VL-122» (doc-13, backlog/docs/, теги: контекст, llm, vl-122, vl-136). Содержание: как Qwen Code решает рост контекста (двухслойно: microcompact-плейсхолдер + chatCompression с трёхуровневыми порогами, ссылки на файлы/строки refs-снапшота 2026-10-13); как OpenCode (однослойно: LLM-саммари с фиксированным шаблоном Objective/Work State/Next Move, keep=8000/buffer=20000, tool-выводы ≤2000 символов); сравнение по критериям (простота, детерминизм, Node.js 20+, сохранение jsonl-транскрипта VL-103, совместимость с loop-guard VL-119); рекомендация для VL-122 с учётом комментария Pavel о MiMo-V2.5 (1M контекст, дешёвый cache read): этап 1 — редкое детерминистическое wire-усечение «system + первый user + хвост 10–15% окна» с одним синтетическим маркером и порогами пропорционально окну (warn≈70%, auto≈85%) по usage-токенам; этап 2 (опционально) — LLM-саммари по шаблону OpenCode, автоматически только на force-пороге. Документ — proposal, окончательное решение за VL-122.
---
author: @agent
created: 2026-10-13 10:31
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу.
**Решение** (по doc-13, §4.1 — рекомендация VL-136 с учётом MiMo-V2.5 1M/дешёвый cache read): детерминический wire-компакшн **внутри `runLoop` (src/agent/loop.ts) перед `streamChat`**. `messages` и jsonl-транскрипт НЕ мутируются — усекается только payload запроса; onMessage (VL-103), resume-контракт, loop-guard VL-119 и guard VL-110 работают с полной историей.
- Триггер — по usage-токенам последнего ответа (`input_tokens + cache_read_input_tokens`) ≥ 850K (85% окна MiMo) → редкое срабатывание, стабильный prefix-caching.
- Липкий якорь отсечения: после срабатывания запросы = system + первый user + `slice(compactFrom)` (append-only префикс); повторное раздувание → якорь сдвигается.
- Сохраняем: system + первый user (постановка) + хвост 50 сообщений (≤130K токенов ≈ 13% окна — в рекомендованный диапазон 10–15%); служебная заметка об усечении дописывается в wire-копию первого user-сообщения один раз в момент компакшна.
- Орфан-гард: хвост не начинается с tool-сообщения без парного assistant(tool_calls).
- `llm.ts` и `interactive.ts` не меняются.
Файлов: 5 — src/agent/loop.ts (константы, `compactWireMessages`, стейт в runLoop), src/agent/cli.ts (флаги `--compact-tail`, `--compact-at-tokens`), loop.test.mjs (6 тестов компакшна), cli.test.mjs (parseArgs + интеграционный resume-тест), CHANGELOG.md.
Риски: первый запрос после resume остаётся полным (триггер сработает со 2-го хода — приемлемо); HTTP 413 до триггера — вне объёма этапа 1 (follow-up при реальной потребности).
---
author: Pavel Bobarev
created: 2026-10-13 10:51
---
Ещё по хорошему надо добавить настройку (по типу команды set в боте), которая бы выключала этот компакшн - по умолчанию включён
---
author: @agent
created: 2026-10-13 12:32
---
Фаза 3 (Code) выполнена. Коммит `2862f48` — feat: VL-122 — компакшн истории LLM-запроса в длинных сессиях.
**Реализация** (по плану, + настройка из комментария Pavel):
- **src/agent/loop.ts**: экспортируемая чистая `compactWireMessages(messages, from)` — wire-копия `[system + первый user со служебной заметкой + хвост с липкого якоря]`; орфан-гард сдвигает якорь past tool-сообщений; если отсекать нечего — исходный payload без маркера. В `runLoop`: стейт `compactFrom`/`lastPromptTokens`; триггер по usage последнего ответа (`input_tokens + cache_read_input_tokens`) ≥ 850K (дефолт) → якорь `messages.length - 50` (дефолт), re-anchor при повторном раздувании; якорь вычисляется перед streamChat, когда assistant/tool предыдущего хода уже в messages. `messages` и jsonl НЕ мутируются — усекается только payload (onMessage, LoopResult.messages, resume-контракт VL-103, guard'ы VL-110/VL-119 работают с полной историей). Служебная заметка «[История усечена: опущено K сообщений. Полный транскрипт — в сессии.]» детерминирована от якоря — префикс стабилен между запросами (prefix-caching).
- **Настройка выключения** (комментарий Pavel): флаги CLI `--no-compact` (дефолт — компакшн включён), `--compact-tail <N>`, `--compact-at-tokens <N>`; команда бота `/set compact on|off` → `.vibelog/bot.yml` (`compact: false`) → оркестратор передаёт `--no-compact` при следующем запуске фазы (только агент vb), перезапуск бота не нужен.
**Изменено**: src/agent/{loop,cli}.ts + тесты, src/bot/{commands,settings,handlers,registry}.ts + тесты, src/web/{orchestrator}.ts + тест.
**Проверки**: `pnpm build` (strict TS) зелёный; `pnpm test` — 52 файла / 863 теста, все зелёные (в т.ч. новые: 6 тестов компакшна + 3 unit compactWireMessages в loop.test.mjs, parseArgs + интеграционный resume-тест в cli.test.mjs — усечение запроса при этом jsonl полон и оканчивается assistant; compact on|off в commands/settings/registry; --no-compact в оркестраторе).
**Отклонения от плана**: (1) CHANGELOG.md и docs НЕ обновлял — по регламенту Фазы 3 документацию пишет Фаза Close (VL-126), поэтому AC#3 и DoD#2 «Документация обновлена» оставлены незакрытыми; (2) `compactWireMessages` принимает якорь `from`, а не `tailCount` с note — заметка генерируется внутри детерминированно (точное K, стабильный префикс), это уточнение плана; (3) триггер вычисляет якорь перед streamChat (после дописывания tool-результатов), а не сразу после addUsage — иначе хвост «съедал» бы текущий ход.
---
author: @agent
created: 2026-10-13 12:49
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 2862f48 (компакшн истории LLM-запроса — код и тесты, Фаза 3), docs 3927c2b (CHANGELOG запись Unreleased, doc-10 §6.1 «Компакшн истории LLM-запроса» + таблица флагов, doc-6 строка `/set compact`). Не закоммичено: templates/qwen-commands/phase-1.md (modified) и backlog/tasks/VL-129*.md (untracked) — не относятся к VL-122, принадлежат параллельным фазам (guard от гонки). Подзадач нет.
---
<!-- COMMENTS:END -->