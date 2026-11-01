---
id: VL-228
title: 'Автоочередь: автоочистка failed-задач после исчерпания ретраев + отчёт в stderr'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 20:54'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - core
  - cli
dependencies: []
milestone: v1.11
references: []
priority: low
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/auto-queue.ts
  - src/core/auto-queue.test.mjs
  - src/bot/auto-runner.ts
  - src/bot/auto-runner.test.mjs
  - README.md
lessons:
  - lesson-85
  - lesson-78
token_usage:
  input: 7338105
  output: 65478
  cache: 6777152
  total: 7403583
  requests: 140
  duration_ms: 1781005
  reasoning: 29721
  by_phase:
    spec:
      input: 45812
      output: 342
      cache: 22592
      requests: 2
    plan:
      input: 584981
      output: 6332
      cache: 394752
      requests: 13
    code:
      input: 3245740
      output: 27400
      cache: 3073792
      requests: 61
    prompt:
      input: 3461572
      output: 31404
      cache: 3286016
      requests: 64
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-224. В .vibelog/auto-queue.json VL-203 и VL-207 остаются failed (attempts: 2 при max_retries: 1) без ретраев и без сигналов — очередь «засоряется», состояние не отличимо от текущей работы. Перевести в failed_permanent (или чистить) с обязательным stderr/логом причины и ссылкой на сессию агента.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Задачи с исчерпанными ретраями получают отдельный статус/пометку и причину в stderr.
- [x] #2 Следующий цикл очереди не перетирает их и не считает pending.
- [x] #3 Есть тест на поведение после attempts > max_retries.
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
Задачи с исчерпанными ретраями (attempts > max_retries) не должны вечно висеть как `failed` без различий и без сигналов: перевести их в отдельный статус `failed_permanent` с причиной в stderr/логе и ссылкой на сессию агента; следующий цикл очереди не должен их перетирать или считать pending (AC1–AC3).

## Файлы для изменения (4)
1. `src/core/auto-queue.ts`
2. `src/core/auto-queue.test.mjs`
3. `src/bot/auto-runner.ts`
4. `src/bot/auto-runner.test.mjs`
5. `README.md` (раздел «/auto — автоочередь фаз» — документация, DoD-2)

Все пути проверены ls — существуют.

## Изменения по файлам

### 1. src/core/auto-queue.ts
- **~строка 30 (`AutoQueueStatus`)**: добавить `'failed_permanent'` в union: `'pending' | 'running' | 'done' | 'failed' | 'failed_permanent'`.
- **~строка 37 (`AutoQueueTask`)**: новое опциональное поле `fail_reason?: string` — причина провала (текст для stderr/лога/`/auto status`).
- **~строки 103–108 (`loadAutoQueue`, filter валидных элементов)**: в список допустимых status добавить `'failed_permanent'`; валидировать `fail_reason` как строку (не-строку — отбрасывать поле).
- **~строки 151–171 (`addQueueTasks`)**: элемент со status `failed_permanent` при повторном `/auto add` НЕ реанимировать автоматически — skip (защита AC2 от перетирания). Реанимация только по явному действию: если в `ids` передан id с префиксом явного сброса (реализация: отдельный новый экспорт `reactivateQueueTask(cwd, id)` — сбрасывает `failed_permanent` → `pending`, `attempts=0`, чистит `fail_reason`; вызывается из `addQueueTasks` только когда id встретился в массиве `ids` ВТОРОЙ раз? — нет, проще: `addQueueTasks` skip'ает `failed_permanent` как `pending/running`, а команда бота `/auto retry <id>` (см. п.3) вызывает `reactivateQueueTask`).
  - Итого в `addQueueTasks`: условие skip расширить на `pending || running || failed_permanent`.
- **~строки 226–244 (`sweepQueue`)**: текущий guard `if (item.status === 'done' || item.status === 'failed') continue;` → считать терминальными также `failed_permanent` (не перетирать sweep'ом). НО: sweep должен ЛОВИТЬ устаревший `failed` с исчерпанными ретраями из старых файлов (инцидент VL-203/VL-207: `failed` c attempts:2 при max_retries:1) — добавить ветку: элемент со status `failed` и `(attempts ?? 0) > (queue.max_retries ?? 1)` → статус `failed_permanent`, `fail_reason` (если пуст) = `'ретраи исчерпаны (attempts=N > max_retries=M)'`, `changed=true`. `done`/`failed_permanent` — не трогать.
- **~строки 262–267 (`pickNextQueueTask`)**: фильтр `item.status !== 'pending'` уже исключает `failed_permanent` — изменения не нужны (AC2 выполняется типом), но тест подтвердит.
- **~строки 336–350 (`formatAutoQueue`)**: для `failed_permanent` выводить причину: `VL-N — failed_permanent (причина: …)`.

### 2. src/bot/auto-runner.ts
- **~строки 175–191 (`notifyAutoFailure`)**: текст уведомления различать `failed` (есть ретраи/первая финализация) и `failed_permanent` — не путать «сейчас» с «навсегда».
- **~строки 193–220 (`handlePhaseFailure`)**: при `nextFailureAction(attempts, max) === 'failed'`:
  - если `attempts > max` (уже превышено, инцидентный кейс: элемент приходит с attempts=2, max=1, status ещё не failed/…): статус = `failed_permanent`;
  - иначе (первое превышение): статус = `failed` СРАЗУ с переводом в `failed_permanent` в том же шаге? — решение: при превышении ставить `failed_permanent` напрямую (AC1: «получают отдельный статус/пометку» — именно при исчерпании), поле `fail_reason` = причина фазы (reason, усечённый 300) + `attempts=N/max=M`;
  - **stderr**: `console.error(\`[auto VL-228] ${item.id} → failed_permanent: фаза ${phase}, попыток N из M, причина: …; сессия: ${sessionId}\`)` — sessionId брать через уже существующий в модуле механизм `findTaskPhaseSessionSync(agentSessionsDir(cwd), taskId, phase)` (используется в `retryResumeArgs`, ~строка 110); если сессия не найдена — писать `сессия: не найдена`. Ссылка на сессию обязательна по описанию задачи.
  - уведомление в чаты — текстом `failed_permanent`.
- **~строки 291–302 (ветки «нет фазы» в autoTick)**: `updateQueueTask(..., { status: 'failed' })` → ставить `failed_permanent` + `fail_reason` (`нет фазы из статуса …`) + stderr-строку с причиной (эти элементы не переупустимы никогда — фаза не определяется).
- **~строка 97 (`nextFailureAction`)**: расширить возврат третим значением? — НЕ надо (lesson: минимальные правки): `attempts <= max → 'retry'`, иначе `'failed'`; различие failed vs failed_permanent делает вызывающий `handlePhaseFailure` по `attempts > max`.
- **Экспорт `reactivateQueueTask`** через re-export из `./commands.ts` не требуется — команда `/auto retry` НЕ входит в scope (AC не требуют); ручная реанимация — правка файла/`/auto remove`+`add` (remove уже снимает элемент, add создаёт заново). Упомянуть в README.

### 3. Тесты

**src/core/auto-queue.test.mjs** (AC3):
- load: файл с элементом `status: 'failed_permanent', fail_reason: 'x'` → элемент сохранён (не отброшен), `fail_reason` прочитан; битый `fail_reason` (число) → поле отброшено, элемент жив.
- add: `failed_permanent` → skip (не в added, статус не тронут) — AC2.
- sweep: элемент `failed` c `attempts: 2`, queue `max_retries: 1` → `failed_permanent` + заполненный `fail_reason`, `changed=true`; повторный sweep — идемпотентен (false). Элемент `failed_permanent` sweep не трогает.
- pickNext: `failed_permanent` не выбирается (вместе с pending-кандидатом рядом).
- formatAutoQueue: строка содержит `failed_permanent` и причину.

**src/bot/auto-runner.test.mjs** (AC1, AC3):
- `handlePhaseFailure` — прямой вызов невозможен (не экспортирован): тестировать через наблюдаемый эффект — использовать новый экспорт `setStartPhaseForTests` шов: фаза завершается с exitCode≠0 → onExit → handlePhaseFailure. Сценарий: очередь `{max_retries: 1}`, элемент `attempts: 1` (последняя попытка) → после провала: `attempts=2 > max=1` → элемент `failed_permanent`, в файле `fail_reason` непуст; stderr-перехват (подмена `console.error` на сбор в массив в try/finally) содержит `failed_permanent` и `attempts=2` и упоминание сессии.
- Регрессия: `attempts=0, max=1` → первый провал → `attempts=1`, статус остаётся `failed`/pending-к прогона (retry ещё возможен) — НЕ failed_permanent.
- Существующие тесты `nextFailureAction` остаются без изменений.

### 4. README.md
- Раздел «/auto — автоочerедь фаз»: описать статус `failed_permanent` (исчерпаны ретраи; stderr-лог причины со ссылкой на сессию; `/auto add` не реанимирует автоматически — снять элемент `/auto remove <id>` и добавить заново).

## Порядок действий
1. `src/core/auto-queue.ts` — типы, load, add-skip, sweep-миграция failed→failed_permanent, format.
2. `src/core/auto-queue.test.mjs` — тесты AC2/AC3 core-слоя.
3. `src/bot/auto-runner.ts` — handlePhaseFailure → failed_permanent + stderr со сессией; notify-тексты; ветки «нет фазы».
4. `src/bot/auto-runner.test.mjs` — тест AC1 через шов startTaskPhase + перехват console.error.
5. README.md — документация (DoD-2).
6. `pnpm build && pnpm test` (DoD-1/3).

## Как проверить
```bash
pnpm build && pnpm test          # все тесты, включая auto-queue/auto-runner
pnpm test:fast                   # быстрая итерация после сборки
```

## Риски
- **Совместимость формата**: `failed_permanent` — новое значение status; старые файлы очереди с `failed`+перебоем attempts мигрируют в sweep — load старых файлов не ломается (filter принимает новое значение, старые — тоже).
- **Пере-пере-перетирание**: sweep-миграция трогает только `failed` с attempts>max; `done`/`failed_permanent` не трогаются — идемпотентность сохраняется (подтверждается тестом).
- **Ложный failed_permanent при ручном `/auto remove`+`add`**: add создаёт элемент заново с attempts=0 — ручной обход работает.
- **Шов теста**: `setStartPhaseForTests` — сбрасывать в finally (isolate:false, lesson про шов VL-140/VL-200).
- stderr в тестах перехватывать аккуратно (глобальный console.error — параллельные файлы тестов; vitest fileParallelism:true — перехват только внутри синхронного блока одного it, восстанавливать в finally немедленно).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 21:34
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Автоочередь: автоочистка failed-задач после исчерпания ретраев + отчёт в stderr». Тип: enhancement. Масштаб: task. Приоритет: Medium. Уточнено: AC переформулированы — статус failed_permanent с причиной в stderr и ссылкой на сессию; защита от перетирания следующим циклом; тест attempts > max_retries. Labels: core, cli. References: нет (внешние источники не упомянуты). Вопросов нет.
---
author: @agent
created: 2026-10-29 21:35
---
Фаза plan не удалась (код выхода 1): gent] фаза: запросов=6, payload последнего запроса=259041 байт (макс 259041), usage={"input_tokens":94338,"output_tokens":942,"cache_read_input_tokens":86208,"total_tokens":95280,"reasoning_tokens":0} — статус возвращён к Spec.
---
author: @agent
created: 2026-10-29 21:41
---
Фаза 2 (Plan) выполнена. Тип: enhancement. План записан в Implementation Plan: 5 файлов (src/core/auto-queue.ts + тесты, src/bot/auto-runner.ts + тесты, README.md). Ключевые решения: новый статус очереди failed_permanent с полем fail_reason; sweep мигрирует застрявший failed с attempts > max_retries; addQueueTasks skip'ает failed_permanent (защита от перетирания, AC2); handlePhaseFailure при превышении ретраев ставит failed_permanent + console.error с причиной и sessionId (findTaskPhaseSessionSync, AC1); тесты core- и runner-слоя на attempts > max_retries (AC3); документация в README (DoD-2). Риски: миграция старых файлов очереди (покрывается load-тестами), перехват console.error в параллельных тестах (finally-восстановление), шов setStartPhaseForTests (сброс в finally).
---
author: @agent
created: 2026-10-29 23:29
---
Фаза code не удалась (код выхода 1): апросов=60, payload последнего запроса=275388 байт (макс 275388), usage={"input_tokens":3171627,"output_tokens":27353,"cache_read_input_tokens":3001344,"total_tokens":3198980,"reasoning_tokens":13541} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 23:36
---
Фаза 3 (Code) выполнена. Коммит 5f598ac «feat: VL-228 — failed_permanent для исчерпанных ретраев + stderr-отчёт со ссылкой на сессию» (5 файлов, +339/−38).
Что сделано:
- `src/core/auto-queue.ts`: новый статус `failed_permanent` (+ поле `fail_reason?`), `VALID_QUEUE_STATUSES` — единый список для load-фильтра (битый `fail_reason` отбрасывается, элемент остаётся); `addQueueTasks` skip'ает `failed_permanent` (AC2 — /auto add не перетирает терминальный провал; у реанимации done/failed причина чистится); `sweepQueue` мигрирует застрявший `failed` с `attempts > max_retries` в `failed_permanent` с автозаполнением причины (инцидентный кейс VL-203/VL-207), `done`/`failed_permanent` не трогаются → идемпотентность; `formatAutoQueue` выводит причину для failed/failed_permanent.
- `src/bot/auto-runner.ts`: `handlePhaseFailure` при исчерпании ретраев ставит `failed_permanent` + `fail_reason` (`<причина>; attempts=N/max=M`) и пишет в stderr `[auto VL-228] <id> → failed_permanent: фаза …, попыток N из M, причина: …; сессия: <sessionId|не найдена>` (sessionId через `findTaskPhaseSessionSync`); guard от повторной обработки терминальных элементов расширен на `failed_permanent`; уведомление в чаты различает `failed` и `failed_permanent`; ветки «задача не найдена»/«нет фазы из статуса» в autoTick теперь ставят `failed_permanent` + причину + stderr (эти элементы не переупустимы).
- Тесты: `src/core/auto-queue.test.mjs` +5 (load failed_permanent/битый fail_reason, add-skip, sweep-миграция с идемпотентностью, pickNext не выбирает, format с причиной — AC2/AC3); `src/bot/auto-runner.test.mjs` +2 (AC1: провал при attempts=1/max=1 → failed_permanent, fail_reason заполнен, перехват console.error содержит failed_permanent, attempts и sessionId; регресс-кейс attempts=0 → retry, причина не пишется) и обновлены ожидания VL-200/VL-191 тестов на новый терминальный статус.
- `README.md`: новый раздел «/auto — автоочередь фаз» — статус `failed_permanent`, stderr-лог со ссылкой на сессию, отсутствие авто-реанимации и ручной обход, авто-миграция старых очередей (DoD-2).
Проверки: `pnpm build` — ok; `pnpm test` в части `src/core|src/bot|src/web` — 1381 passed, 4 skipped, 0 failed; целевые файлы `auto-queue.test.mjs` (16) и `auto-runner.test.mjs` (18) — все зелёные. Известное внешнее: `src/cli/*.test.mjs` (search/config/draft/create-flags) флейкуют под нагрузкой — они спавнят CLI с `timeout: 5000` мс и падают на таймаутах; проверено до/после моих правок (файл `config-cli.test.mjs` падает и на застейдженном состоянии, `search-cli` — то зелёный, то нет при неизменном коде), CLI-слой задач не касался → регрессии нет.
Что осталось (вне scope по плану): интерактивная команда `/auto retry <id>` (реанимация failed_permanent) не реализована — обход через `/auto remove`+`add` документирован в README; `CHANGELOG.md`/doc-6 — на фазе Close.
---
author: @agent
created: 2026-10-30 01:01
---
Фаза Close выполнена. Ветка vb/vl-228 слита в master (1 коммит 5f598ac, merge 52cd45e), worktree `.vibelog/worktrees/vl-228` удалена (--force: внутри были только untracked-симлинки node_modules и backlog/references/data), ветка vb/vl-228 удалена. Docs-коммит: cd3e740 (CHANGELOG Unreleased→Добавлено + doc-6), refs/lessons-коммит: 82723e4.
DoD: 1 «Тесты проходят» — целевые auto-queue (16) и auto-runner (18) зелёные, сборка ок. 2 «Документация обновлена» — README (раздел «/auto — автоочередь фаз» из фазы Code), CHANGELOG, doc-6 (список статусов, `/auto add` не реанимирует failed_permanent, stderr-строка со ссылкой на сессию, авто-миграция sweep). 3 «Нет регрессий» — `pnpm test` в главном репо дал 24 падения в `src/agent/llm.test.mjs` и 1 в `src/cli/*`; проверено, что это НЕ merge: `git diff master~2 master -- src/agent/` пуст, md5 тест-файла идентичен, тот же прогон в изолированном worktree без `.vibelog/settings.json` — 52 passed (причина — секция `models` в локальном settings.json: `resolveActiveModel` подменяет baseUrl/api_mode, lesson-78; cli-флейки — спавн CLI с timeout 5000 под нагрузкой, известны из фазы Code).
Lessons: lesson-85 (новый статус — в единый список валидации, легаси → миграция в sweep с тестом идемпотентности), lesson-78 (обновлён, +VL-228; lesson-86 помечен superseded как дубликат).
Вне scope по плану (не сделано, документировано): интерактивная команда `/auto retry <id>` — обход `/auto remove` + `/auto add`.
---
<!-- COMMENTS:END -->