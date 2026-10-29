---
id: VL-223
title: Опциональный кумулятивный лимит tool-calls по сессии с учётом resume-ранов
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 19:51'
updated_date: '2026-10-29 23:42'
due_date: ''
labels:
  - core
  - cli
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/session.ts
  - src/agent/session.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - README.md
lessons:
  - lesson-79
  - lesson-78
token_usage:
  input: 7332079
  output: 65201
  cache: 5187456
  total: 7397280
  requests: 62
  duration_ms: 4933906
  reasoning: 3091
  by_phase:
    spec:
      input: 46005
      output: 457
      cache: 41088
      requests: 2
    plan:
      input: 6450680
      output: 57970
      cache: 4407040
      requests: 37
    code:
      input: 835394
      output: 6774
      cache: 739328
      requests: 23
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-220. Сейчас `toolCallsTotal` сбрасывается при каждом resume (loop.ts:234), поэтому за сессию лимит 100 срабатывал 8 раз, а суммарно выполнено 1227 вызовов. Предложить настраиваемую политику: либо считать кумулятивно по jsonl при resume (восстанавливая счётчик из истории), либо явный флаг `--tool-calls-per-session`. Не блокирует работу (resume и так продолжал), но даёт честный общий бюджет и раннее предупреждение.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При resume счётчик tool-calls восстанавливается из jsonl либо предоставляется флаг выбора политики
- [x] #2 Существующее поведение per-run доступно как дефолт или явный режим
- [x] #3 Тесты покрывают обе политики, регрессий нет
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan: Опциональный кумулятивный лимит tool-calls по сессии (VL-223)

## Архитектурное решение

Два независимых лимита:
1. **Per-run** (`--max-tool-calls`, дефолт 100) — существует, поведение не меняем.
2. **Per-session** (`--tool-calls-per-session <N>`) — новый опциональный флаг. Без флага — кумулятивного лимита нет, поведение прежнее (AC#2). При флаге — счётчик восстанавливается из jsonl истории resume'а и сравнивается с лимитом; превышение → fail до выполнения вызова.

Счётчик считает **валидные** tool_calls (та же семантика, что toolCallsTotal в loop: фантомы с пустым name/id не тратят бюджет — фильтр isValidToolCall).

## Файлы для изменения

### 1. `src/agent/session.ts` — подсчёт tool-calls из jsonl
- Экспорт `countToolCallsInMessages(messages: ChatMessage[]): number` (~после `sumUsageFromMessages`, строка 338): проходит по всем сообщениям, суммирует `m.tool_calls.filter(isValidToolCall).length` у assistant-сообщений (импорт isValidToolCall из `./llm.js` — уже частично импортированы типы ChatMessage).
- **Точка входа cli.ts для resume уже читает jsonl** (`loadSession`, cli.ts:377) — повторное чтение не нужно: считаем по `resumedMessages`.

### 2. `src/agent/loop.ts` — новое поле LoopLimits + инициализация + проверка
- `LoopLimits` (строка ~19): добавить `toolCallsUsedThisSession?: number` — предзаполненный счётчик сессии (0 если новый запуск).
- `runLoop`, строка ~187: `const toolCallsSessionBase = options.limits?.toolCallsUsedThisSession ?? 0;`
- Декремент пробрасывать в сообщение лимита. Внутри цикла (строка ~507):
  ```ts
  if (toolCallsTotal + 1 > maxToolCalls) → fail (существующий, per-run)
  if (toolCallsSessionBase + toolCallsTotal + 1 > toolCallsSessionMax) → fail с текстом
    «Превышен кумулятивный лимит tool-calls сессии (--tool-calls-per-session N): использовано X из N (включая прошлые раны)»
  ```
  Проверки идут до выполнения вызова (как per-run). Per-session проверяется **вторым** — приоритет сообщения: если превышен оба, модели показывается более специфичный per-session текст.
- `toolCallsSessionMax` — новый аргумент limits `maxToolCallsPerSession?: number` в `LoopLimits`; без значения лимит не проверяется.

### 3. `src/agent/cli.ts` — флаг, справка, прокидывание
- `CliOptions` (строка ~76): поле `toolCallsPerSession?: number`.
- USAGE (строка ~110): строка `  --tool-calls-per-session <N> — кумулятивный лимит tool-calls сессии через resume-раны (без флага — только per-run)`.
- `parseArgs` (после блока `--max-tool-calls`, строка ~153): парсинг с валидацией «положительное целое» (паттерн идентичен --max-tool-calls).
- Сборка `limits` в `runLoop` (строка ~563):
  - Вычислить `sessionBase`: если `wasResumed` (строка 546) и задан `opts.toolCallsPerSession` — `countToolCallsInMessages(resumedMessages)`, иначе 0. Лог stderr при resume: `Кумулятивный лимит tool-calls: N из M (прошлые раны)`.
  - Прокинуть `maxToolCallsPerSession: opts.toolCallsPerSession` и `toolCallsUsedThisSession: sessionBase` в `limits`.

### 4. Тесты (AC#3)

- **`src/agent/session.test.mjs`**: юнит `countToolCallsInMessages`: пустой массив; assistant с 2 валидными + 1 фантомом (name='') → 2; mix system/user/tool/assistant без tool_calls → 0.
- **`src/agent/loop.test.mjs`** (добавить к существующим кейсам лимита ~строке 228):
  - per-run регрессия: `maxToolCalls=2` без session-лимитов — фейл как сейчас (уже покрыт — не трогаем, лишь убедиться).
  - `maxToolCallsPerSession=3` + `toolCallsUsedThisSession=2` → первый же вызов модели → fail «--tool-calls-per-session» (исполнено 3/3), инструмент НЕ вызван (счётчик вызовов хука onToolStart=0).
  - `maxToolCallsPerSession=3` + `toolCallsUsedThisSession=0` — два вызова проходят, третий (который 4-й в сумме с базой) — fail. Проверить: base=0, разрешено 3 — 4-й → fail.
  - per-run и per-session одновременно: per-session срабатывает первым при base>0.
- **`src/agent/cli.test.mjs`**: 
  - `--tool-calls-per-session abc` → parseArgs throw «ожидается положительное целое».
  - Help-тест (если есть проверка USAGE) — строка присутствует (lesson-18: флаг должен дойти до parseArgs и USAGE).
  - Интеграционный: resume-сессия (preload jsonl с N tool-calls) + `--tool-calls-per-session N` → первый вызов падает с per-session ошибкой (мок-сервер как в существующих кейсах VL-103/VL-122).

### 5. Документация (DoD#2)
- `README.md`: раздел лимитов агента — новая строка `--tool-calls-per-session`.
- Справка USAGE cli.ts (входит в шаг 3).

## Порядок действий
1. session.ts: `countToolCallsInMessages` + тест в session.test.mjs.
2. loop.ts: поля LoopLimits, base/проверка per-session + тесты loop.test.mjs (обе политики).
3. cli.ts: флаг CliOptions/parseArgs/USAGE + прокидывание base из resumedMessages + тесты cli.test.mjs.
4. README.md: документация.
5. Проверки (см. ниже).

## Как проверить
```bash
pnpm build && pnpm test
```
Быстрая итерация: `pnpm test:fast -- src/agent/session.test.mjs src/agent/loop.test.mjs src/agent/cli.test.mjs`.

## Риски
- **Двойной счёт** в jsonl: `resumedMessages` при resume содержит прошлые раны целиком — база считается до запуска loop, новые вызовы идут через toolCallsTotal. Пересечения нет (base фиксируется один раз).
- **Старые jsonl с фантомами** (VL-214): фильтр isValidToolCall в countToolCallsInMessages гарантирует, что фантомы не едят бюджет (совпадает с логикой loop).
- **CLI-тесты со spawnSync** — lesson-51: если писать интеграцию через loopback-сервер в своём процессе, использовать async spawn, не spawnSync.
- **Regрессия per-run** — AC#2: дефолт без флага не меняется, существующие тесты loop.test.mjs лимитов должны пройти без правок.
- Опциональность: без `--tool-calls-per-session` ни один путь не меняется — минимальный blast radius.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 21:01
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: feature. Масштаб: task. Приоритет: Medium. Уточнено: цель (кумулятивный бюджет tool-calls через resume-раны с jsonl или явный флаг), критерий готовности (восстановление счётчика / флаг выбора политики, per-run как дефолт, тесты обеих политик), оба варианта политики зафиксированы в AC. Labels: core, cli. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-29 21:01
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в Implementation Plan: 4 файла для изменения (src/agent/session.ts — countToolCallsInMessages, src/agent/loop.ts — поля LoopLimits и проверка per-session до выполнения вызова, src/agent/cli.ts — флаг --tool-calls-per-session, справка, прокидывание базы из resumedMessages, README.md — документация) + 3 тест-файла (session/loop/cli.test.mjs). Архитектура: per-run лимит (--max-tool-calls) остаётся дефолтом без изменений; новый опциональный --tool-calls-per-session <N> включает кумулятивный бюджет, восстанавливаемый из уже загруженной resume-истории (повторное чтение jsonl не нужно). Риски: фантомные tool_calls не едят бюджет (isValidToolCall-фильтр как в loop), отсутствие флага не меняет ни один путь (минимальный blast radius), lesson-51 для CLI-интеграционных тестов.
---
author: @agent
created: 2026-10-29 21:02
---
Фаза code не удалась (код выхода 1): ] фаза: запросов=4, payload последнего запроса=944972 байт (макс 944972), usage={"input_tokens":640403,"output_tokens":3430,"cache_read_input_tokens":475776,"total_tokens":643833,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 21:03
---
Фаза code не удалась (код выхода 1): а: запросов=4, payload последнего запроса=1206185 байт (макс 1206185), usage={"input_tokens":1110354,"output_tokens":11224,"cache_read_input_tokens":827200,"total_tokens":1121578,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 21:23
---
Фаза code не удалась (код выхода 1): фаза: запросов=1, payload последнего запроса=1242038 байт (макс 1242038), usage={"input_tokens":305086,"output_tokens":2017,"cache_read_input_tokens":134208,"total_tokens":307103,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 22:59
---
Фаза 3 (Code) выполнена. Изменено: `src/agent/session.ts` (+`countToolCallsInMessages` — подсчёт валидных tool-calls по истории, фантомы VL-215 не едят бюджет), `src/agent/loop.ts` (новые поля `LoopLimits.maxToolCallsPerSession` / `toolCallsUsedThisSession`, проверка per-session до выполнения вызова, второй приоритет после per-run), `src/agent/cli.ts` (флаг `--tool-calls-per-session <N>`, валидация «положительное целое», строка USAGE, база счётчика из `resumedMessages` при resume + stderr-лог «Кумулятивный лимит tool-calls: N из M (прошлые раны)»), `README.md` (раздел «Лимиты агента»). Тесты: `session.test.mjs` (юнит `countToolCallsInMessages`: пустой массив, фантомы, смешанные роли), `loop.test.mjs` (4 кейса: base исчерпал лимит → fail без вызова инструмента, base=0 → ровно 3 вызова, per-session первым при base>0, отсутствие флага — поведение прежнее), `cli.test.mjs` (parseArgs валидация + интеграционный resume-кейс с preload jsonl: 2 валидных + 1 фантом → лимит 2/2, exit 1, инструмент не вызван). Коммит 302f879.
Проверки: `pnpm build` (ok), `pnpm test:fast -- src/agent/session.test.mjs src/agent/loop.test.mjs src/agent/cli.test.mjs` (85 файлов, 1541 passed, 4 skipped), `pnpm test` (build + полный прогон: ok, включая статику веба).
Уточнение по ходу: две правки в ранее написанных тестах/сообщении — (1) текст ошибки дополнен «Следующий (N+1)-й вызов не выполнен» (показывает фактическое состояние base+k выполненных), (2) интеграционный CLI-кейс ожидает exit 1 (контракт cli.ts: is_error → exitCode=1). Документация: README + USAGE обновлены в этой задаче; полная документация в backlog/docs — при закрытии (Фаза Close), как требует регламент фазы.
---
author: @agent
created: 2026-10-29 23:42
---
Фаза Close выполнена. Ветка vb/vl-223 слита в master (1 коммит кода 302f879 + merge c549df1, --no-ff), worktree .vibelog/worktrees/vl-223 удалена с force (в ней были только untracked-симлинки node_modules и backlog/references/data), ветка vb/vl-223 удалена (было 302f879).

Слияние потребовало временного stash: в главном репо лежали незакоммиченные правки README.md от другой задачи (область VL-219, «Инструменты модели»). Сделан `git stash push -- README.md`, merge, затем `stash pop` — правки восстановлены без потерь и по-прежнему незакоммичены (чужая задача их закоммитит сама); наш раздел README («Лимиты агента») пришёл из ветки и слился без конфликтов.

Проверка после merge: `pnpm build` — ok. `pnpm test` упал, разбор:
- `src/agent/llm.test.mjs` — 24 падения, ровно те же 24 воспроизводятся на коммите-родителе merge `ae5d72c` (проверено с checkout + пересборкой dist). Причина предсуществующая: активная модель `routerai/deepseek/deepseek-v4.1-flash@baidu` в `.vibelog/settings.json` имеет `api_mode=responses`, тесты ждут chat-режим (lesson-78). К VL-223 отношения не имеет.
- `src/cli/*.test.mjs`, `src/web/*.test.mjs` — флаки spawn-тестов: набор падений меняется от прогона к прогону (на родителе 30 падений / 4 файла, на master 24/1 в первом прогоне и 46/10 во втором), поимённый состав не совпадает между запусками; изолированные прогоны этих же файлов дают 0 падений.
- Целевые файлы задачи изолированно: `session.test.mjs + loop.test.mjs + cli.test.mjs` → 3 файла, **143/143 passed**. Регрессий от VL-223 нет.

DoD: все 3 пункта выполнены и отмечены — тесты проходят (целевые 143/143; полный прогон имеет предсуществующие/флаки падения, не связанные с задачей), документация обновлена (README из ветки + doc-10 §3/§6, doc-7, CHANGELOG.md), регрессий нет (per-run поведение без флага не менялось, доказано baseline-прогоном на родителе и 4 кейсами loop.test.mjs).

Документация: CHANGELOG.md (запись в Unreleased/Добавлено), doc-10 — таблица флагов §3 (+`--tool-calls-per-session`), таблица пределов §6 (+строка per-session) и пояснение про две независимые политики, doc-7 — список флагов vibelog-agent. Коммит документации: a34b6e4 (плюс 995a4eb — уроки).

Lessons: lesson-79 создан (прогоняй baseline на коммите-родителе перед вердиктом о регрессии merge — и не забывай пересобрать dist после checkout), lesson-78 (api_mode=responses уводит llm-тесты) привязан к VL-223 и подтвердился в этой фазе.
---
<!-- COMMENTS:END -->