---
id: VL-267
title: 'Спецификация роли «Супервизор»: тик-модель, healing loop, планировщик параллельности, grant на прогон'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 18:00'
updated_date: '2026-10-30 21:51'
due_date: ''
labels:
  - web
  - chat
  - personas
  - orchestration
  - spec
dependencies: []
milestone: ''
references:
  - ref-10
  - ref-22
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Терминология (важно)

Роль называется **«Супервизор»** (supervisor) — везде в коде, конфигах и файлах: `supervisor`. Не «оркестратор»: это имя занято существующим модулем **`src/web/orchestrator.ts`** — спавнером одной фазы (`startPhase`/`startTaskPhase`), который НЕ переименовывается и остаётся как есть.

В UI (пикер ролей) — подпись «Супервизор». Идентификатор персоны в реестре `chat_personas` — `supervisor`.

## Зачем

Пользователь просил роль, которая сама определяет, какие задачи можно запустить сейчас, параллельно или последовательно, лечит зацикливания и падения фаз, и по сути заменяет человека на заранее заданном массиве задач:

> «Allow All подразумевается. Он очень похож на auto-runner, запускает точно так же фазы, но в отличии от него должен сделать анализ например при остановке на луп — написать комментарий фазе, чтобы она продолжила выполнение выйдя из лупа как это я сейчас делаю вручную. В общем замена человека на заранее определённом массиве задач.»

Согласованные решения:
- Порядок работ: **сначала спецификация и инструменты, промпт роли — потом**.
- Параллельность: оба режима (`conservative` / `aggressive`), `max_parallel_phases` = **3**.
- Доверие: **grant на прогон**, а не на тред (сценарий: обсудили задачи в чате → «стартуй» → выдал доверие на эту ночь).
- Авто-баг при исчерпании лечения: **автоматически в статусе Spec**.
- `heal_attempts` = **2** (первая попытка + 2 лечебных).
- `tick_seconds` = **60**, тик крутится в процессе **`vibelog browser`**.
- `allow_self_tuning` = **false** по умолчанию.
- Лимиты роли: **30 итераций / 600 с** (у остальных ролей 8 / 120 с) — всё настраиваемо.
- **Как исполняется эта задача (решение A):** документ пишет ассистент в диалоге, фазы `plan`/`code` не запускаются — deliverable здесь документ, диалоговый контекст в автономную фазу не передаётся. По готовности задача закрывается.

Эта задача — **только документ-спецификация**. Кода не пишем.

## Архитектура: тик-модель по ref-10 (hermes-agent)

Изучен клон `backlog/references/data/hermes-agent/` (ref-10). Оркестрация там — не долгоживущий процесс, а **cron job**, который периодически будит агента с промптом:

- `cron/jobs.py` (job store) + `cron/scheduler.py` (tick loop); расписания `30m`, `every 2h`, cron-выражения, ISO one-shot.
- **`script`** — pre-run сборщик данных, его **stdout инжектится в промпт**. Наш аналог — `heartbeat.md` с результатами фаз.
- **`context_from`** — вывод предыдущего job'а в промпт следующего.
- **`notepad`** — durable KV (SQLite) для курсоров между пробуждениями; лимиты `MAX_VALUE_BYTES = 16 КБ`, `MAX_JOB_TOTAL_BYTES = 64 КБ`.
- **`_parse_wake_gate`** — если последняя строка stdout скрипта `{"wakeAgent": false}`, модель **не вызывается**. Пустой тик бесплатен.
- **`workdir`** — загрузка `AGENTS.md` из директории.
- **Inactivity watchdog** — таймаут по **простою** (600 с без активности), а не по wall-clock: зависшая сессия прерывается, длинная-но-активная нет.

Вывод: супервизор = **тик каждые `tick_seconds`**. Тик статeless по памяти и stateful по файлам, поэтому переживает рестарт и не требует долгоживущего цикла. Каждый тик ограничен обычными лимитами агента.

## Исправление ранее допущенных ошибок

1. **Все фазы ограничены одинаково:** `MAX_WALL_TIME_MS_DEFAULT = 900_000` (`src/agent/loop.ts:213`) + `--max-wall-time` / `--max-requests` из `settings.json` (у проекта 2400 / 80). Утверждение «close может длиться сколько угодно» — **неверно**.
2. Обоснование архитектуры — **несопоставимость масштабов**: чат жёстко ограничен `MAX_LLM_ITERATIONS = 8` и `MAX_WALL_TIME_MS = 120_000` (`src/web/chat.ts:66`), а одна фаза — до 40 минут.
3. У роли нужны **свои лимиты чата** в конфиге, а не константы в коде.
4. Из hermes берём **idle-watchdog вместо wall-clock** для фаз — ответ на сгорание фазы на лимите (VL-254).

## Что уже есть (переиспользуем)

| Нужно | Есть |
|---|---|
| Запуск фазы | `startPhase` / `startTaskPhase` (`src/web/orchestrator.ts`), `POST /api/tasks/:id/trigger` (`src/web/api.ts:455`) |
| Состояние запуска | `activeRuns` (один запуск на задачу), `lastRuns`, `getRun`, `PhaseRun {exitCode, logTail, result}` |
| Параллельность code | `ensureTaskWorktree` / `taskBranchName` (`src/core/worktree.ts`); worktree создаётся только на phase plan/do — `orchestrator.ts:818` |
| Сериализация merge | `closeQueue` + `closeActive` (VL-146) — git-конфликт слияния уже исключён |
| Очередь задач | `src/core/auto-queue.ts` (`.vibelog/auto-queue.json`), `pickNextQueueTask`, `isReady` (`src/core/deps.ts`) |
| Прогон фаз | `src/bot/auto-runner.ts`: успех = exitCode 0 **И** смена статуса (VL-191), retry по `max_retries`, `failed_permanent` + уведомление |
| Диагностика лупа | `analyzeToolRepeatsFromJsonlSync` (`src/agent/session.ts:564`) → `RepeatStats`, `SessionMeta.repeat_stats` (VL-229) |
| Машинная сводка | фаза `analyze` + `templates/phases/phase-analyze.md` (read-only, только рекомендации) |
| Комментарий фазе | `startTaskPhase(..., 'comment', { comment })` — фаза `comment` в `SERVICE_PHASES` |
| Причина падения | `PhaseRun.logTail`, `SessionMeta.last_run.is_error` (VL-253), `fail_reason` в `auto-queue.json` |

## Чего нет (разрыв)

1. Нет MCP-инструментов запуска фаз (`trigger` — только HTTP).
2. Нет управления auto-очередью из чата.
3. Нет лимита параллельных code-фаз.
4. Нет grant-механизма доверия на прогон.
5. Нет тик-механизма супервизора.
6. `activeRuns` не знает о зависимостях и пересечениях между задачами.
7. Нет собственных лимитов для чат-роли.

## Раскладка файлов

```
.vibelog/supervisor/
├── settings.json   ← правила лечения (модель может править при allow_self_tuning)
├── tuning.log      ← история самонастроек: когда, что, почему
├── state.json      ← машинное состояние прогона (после каждого тика)
├── heartbeat.md    ← человекочитаемый срез, инжектится в промпт тика
└── grants/<runId>.json
```

Незыблемое — в основном `.vibelog/settings.json`, секция `supervisor`: `max_parallel_phases`, `heal_attempts`, `allow_self_tuning`, `tick_seconds`, `parallel_mode`, лимиты роли.

## Код (план имён)

- `src/core/supervisor-config.ts` — конфиг, `heal_rules`, валидация
- `src/core/supervisor-state.ts` — состояние, heartbeat, grants
- `src/web/supervisor.ts` — тик, healing, планировщик параллельности
- `src/web/orchestrator.ts` — **не трогаем**

## Healing: два уровня

**Уровень 1 — детерминированный, без LLM.** Правила `heal_rules` из `.vibelog/supervisor/settings.json`:

| Поле | Смысл |
|---|---|
| `id` | имя правила, попадает в отчёт |
| `when.repeat_share_min` / `when.repeat_calls_min` | порог повторов (`repeat_stats`) |
| `when.fail_reason_contains` | подстроки в `fail_reason` (payload, timeout, max-wall-time) |
| `when.status_unchanged` | статус не сменился (VL-191) |
| `action` | `retry` \| `comment_and_retry` \| `retry_once_then_bug` \| `bug` \| `stop` |
| `comment_template` | текст директивы с подстановками `{top_repeats}`, `{fail_reason}`, `{task_id}`, `{attempt}` |

Первое совпадение выигрывает. При отсутствии совпадений — `default_action`. Невалидное правило выпадает с предупреждением (паттерн `loadWorkflows`).

**Уровень 2 — модель в тике.** Содержательные ошибки (упавшие тесты, ложный план) разбирает сам тик: у него уже есть `logTail`, `repeat_stats`, `fail_reason`. Отдельная фаза `analyze` для лечения не используется — она read-only.

## Параллельность

`modified_files` появляется только после code, а worktree — на plan/do, поэтому критерий строится **по метаданным задачи** (`title`, `description`, `labels`, `type`):

- **conservative** — модель обязана обосновать каждую параллельную группу («бот и веб», «веб и кли» — разные компоненты, общих модулей в описаниях нет). Не может обосновать → последовательно. Обоснование пишется в `heartbeat.md`.
- **aggressive** — параллель до `max_parallel_phases` без обоснования.
- **`dependencies`/`blocks` — жёсткий запрет параллели** в любом режиме.
- `parallel_mode` — в основном settings, меняет только пользователь (модель может предложить смену в heartbeat).
- git-конфликт слияния уже снят `closeQueue` (VL-146): супервизор решает смысловое пересечение работ, а не merge.

## Доверие: grant на прогон

Сценарий: обсудили задачи в чате → «стартуй» → супервизор показывает approval-карточку:

```
⏱ Ночной прогон
Задачи: VL-263, VL-264, VL-268
Развязываю без спроса:
 ☑ Запуск фаз          backlog_trigger_phase
 ☑ Статус фаз          backlog_phase_status
 ☑ Очередь             backlog_auto_queue
 ☑ Управление прогоном backlog_orchestrate
 ☑ Создание баг-задач  backlog_create_task
 ☐ Правка правил лечения (allow_self_tuning)
Действует до: утро, 08:00   [Отмена] [Разрешить]
```

После подтверждения — `.vibelog/supervisor/grants/<runId>.json` `{runId, taskIds, allowedTools, expiresAt, grantedAt}`.

Правила: задача вне `taskIds` не запускается (нужно расширение grant); инструмент вне `allowedTools` — обычный Allow/Deny; истёк `expiresAt` — текущая фаза доходит, новые не стартуют, запись в heartbeat. `expiresAt` — TTL (дефолт 8 часов) либо явное время, редактируется в карточке.

`write_file` и прочие write-операции модели **вне grant** — всегда с подтверждением.

## Самонастройка

`allow_self_tuning` (дефолт **false**) разрешает модели править `.vibelog/supervisor/settings.json`. Изменения — в `tuning.log`. Защищённые поля (`max_parallel_phases`, `heal_attempts`, `allow_self_tuning`) живут в основном settings и модели недоступны. Лимит самонастроек за прогон.

## Взаимодействие с чатом

Показ плана прогона → approval-карточка grant → статус шагов (что запущено, что ждёт, что лечится) → `stop` → итоговый отчёт. Падения при закрытом чате фиксируются в `state.json` / `heartbeat.md` и читаются при следующем открытии.

## Связи

- **ref-10 (hermes-agent)** — архитектурный референс тик-модели.
- **VL-265** — реестр ролей `chat_personas`; персона `supervisor`, текст промпта — в VL-269.
- **VL-264** — стиль сообщений и tool-карточки (в т.ч. approval-карточка grant).
- **VL-268** (будет создана) — инструменты `trigger`/`status`/`auto_queue` + grant.
- **VL-269** (будет создана) — тик, healing, планировщик, промпт роли, лимиты; зависит от VL-268.
- **VL-254** — сгорание фазы на max-wall-time (связано с idle-watchdog).

## Вне скоупа

- Любой код: спека — документ.
- Изменение `CHAT_DISALLOWED_TOOLS`.
- Изменение механики close/worktree.
- UI супервизора кроме пикера роли и approval-карточки grant.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Создан документ type=specification (document_create) «Роль Супервизор: автозапуск и лечение фаз из чата», доступный через document_view
- [x] #2 Документ содержит раздел о терминологии: в UI роль называется «Супервизор», в коде и файлах — supervisor; существующий src/web/orchestrator.ts (спавнер одной фазы) НЕ переименовывается и не путается с супервизором
- [x] #3 Документ содержит раздел «Что уже есть» с таблицей переиспользуемых механизмов и точными путями/сигнатурами: startPhase/startTaskPhase (src/web/orchestrator.ts), activeRuns/lastRuns/getRun, closeQueue+closeActive (сериализация close, VL-146), ensureTaskWorktree/taskBranchName (src/core/worktree.ts), auto-queue.ts (формат файла, pickNextQueueTask), bot/auto-runner.ts (успех = exitCode 0 И смена статуса, retry по max_retries), isReady (src/core/deps.ts), analyzeToolRepeatsFromJsonlSync + SessionMeta.repeat_stats (src/agent/session.ts:564), фаза analyze с шаблоном phase-analyze.md, PhaseRun {exitCode, logTail, result}, SessionMeta.last_run.is_error, fail_reason в auto-queue.json
- [x] #4 Документ содержит раздел «Чего нет»: нет MCP-инструментов запуска фаз (POST /api/tasks/:id/trigger — только HTTP-роут, src/web/api.ts:455), нет управления auto-очередью из чата, нет лимита параллельных code-фаз, нет grant-механизма доверия на прогон, нет тик-механизма супервизора, нет собственных лимитов для чат-роли
- [x] #5 Документ описывает архитектуру на основе ref-10 (hermes-agent cron): супервизор — тик-модель, а не долгоживущий цикл. Тик каждые tick_seconds (дефолт 60) собирает состояние (статусы фаз, exitCode, fail_reason, repeat_stats, сессии) → инжектит в промпт → модель решает (запустить, полечить, создать баг, ничего не делать). Тик крутится в процессе vibelog browser. Состояние между тиками — файлы, поэтому тик статeless по памяти и stateful по диску
- [x] #6 Документ описывает заимствования из hermes cron с точными ссылками на модули ref-10: script (pre-run сборщик данных, stdout инжектится в промпт — аналог heartbeat.md), context_from, notepad (durable KV, лимиты 16 КБ значение / 64 КБ job), _parse_wake_gate ({wakeAgent:false} — тик без вызова модели), workdir, inactivity watchdog
- [x] #7 Документ фиксирует исправление факта: все фазы агента ограничены одинаково — MAX_WALL_TIME_MS_DEFAULT = 900_000 (src/agent/loop.ts:213) + --max-wall-time/--max-requests из settings.json; фаза close НЕ может длиться неограниченно; вывод об архитектуре строится на несопоставимости масштабов (чат: 8 итераций / 120 с)
- [x] #8 Документ содержит раздел «Лимиты роли Супервизор»: chat_max_iterations (30 для supervisor против 8 у остальных) и chat_max_wall_time (600 с против 120 с), max_parallel_phases (3), heal_attempts (2), tick_seconds (60) — все в конфиге, ничего не захардкожено (сейчас константы в src/web/chat.ts:66)
- [x] #9 Документ содержит раздел про idle-watchdog вместо wall-clock для фаз (заимствование из hermes): таймаут по простою прерывает зависшую сессию, а долгая-но-активная не обрывается; связь с VL-254
- [x] #10 Документ описывает раскладку файлов в каталоге .vibelog/supervisor/: settings.json (правила лечения и то, что модель может править), tuning.log (история самонастроек), state.json (машинное состояние прогона), heartbeat.md (человекочитаемый срез, инжектится в промпт), grants/ (grant-файлы прогонов); неизменяемые лимиты — в основном .vibelog/settings.json (секция supervisor)
- [x] #11 Документ описывает модель состояния: формат state.json (runId, mode, tasks с id/phase/status/phaseRunId/pid/startedAt/healAttempts/lastError/lastRepeatStats/groupId, updatedAt), переживание рестарта процесса, определение живости фазы по pid + phaseRunId (activeRuns теряется при рестарте), отношение к существующему .vibelog/auto-queue.json (не смешивать)
- [x] #12 Документ описывает декларативные heal_rules в .vibelog/supervisor/settings.json: упорядоченный список правил с id, when (repeat_share_min, repeat_calls_min, fail_reason_contains, status_unchanged), action из закрытого набора (retry, comment_and_retry, retry_once_then_bug, bug, stop), comment_template с подстановками ({top_repeats}, {fail_reason}, {task_id}, {attempt}); первое совпадение выигрывает, id сработавшего правила попадает в отчёт; default_action при отсутствии совпадений; невалидное правило не роняет тик, а выпадает с предупреждением (паттерн loadWorkflows)
- [x] #13 Документ описывает двухуровневое лечение: уровень 1 — детерминированные правила без вызова LLM (по heal_rules); уровень 2 — решение модели внутри тика для содержательных ошибок (упавшие тесты, ложный план); отдельная фаза analyze для лечения НЕ используется (она read-only по шаблону templates/phases/phase-analyze.md)
- [x] #14 Документ описывает самонастройку: allow_self_tuning (по умолчанию false) разрешает модели править .vibelog/supervisor/settings.json; изменения пишутся в tuning.log (когда, что, почему); защищённые поля max_parallel_phases, heal_attempts, allow_self_tuning живут в основном settings.json и модели недоступны; лимит самонастроек за прогон
- [x] #15 Документ описывает grant-механизм доверия на прогон: пользователь говорит «стартуй», супервизор показывает approval-карточку с taskIds, списком allowedTools и сроком действия; после подтверждения пишется .vibelog/supervisor/grants/<runId>.json {runId, taskIds, allowedTools, expiresAt, grantedAt}; grant истекает по TTL (дефолт 8 часов) или по указанному времени, отзывается при завершении прогона; задача вне taskIds не запускается, инструмент вне allowedTools требует обычного Allow/Deny; истёкший grant — текущая фаза доходит, новые не стартуют, в heartbeat запись
- [x] #16 Документ явно фиксирует, что в grant попадают только операции супервизора (backlog_trigger_phase, backlog_phase_status, backlog_auto_queue, backlog_orchestrate, backlog_create_task для багов), а write_file и прочие write-операции модели всегда требуют подтверждения
- [x] #17 Документ описывает healing loop как дерево решений: (1) сработало правило heal_rules → соответствующее действие; (2) транзиентные ошибки (payload, wall-time, таймаут провайдера) → рестарт; (3) содержательные (тесты, нет прогресса по статусу) → повтор, затем авто-баг; (4) healAttempts превышен → стоп и отчёт
- [x] #18 Документ описывает авто-создание баг-задачи: статус Spec, авто-description из fail_reason + logTail + id сессии + звена цепочки попыток, связь с исходной задачей
- [x] #19 Документ описывает параллельность по метаданным задачи (не по modified_files, который появляется только после code; worktree создаётся на plan/do — src/web/orchestrator.ts:818): conservative требует от модели обосновать каждую параллельную группу по labels/описанию/модулям и пишет обоснование в heartbeat.md, иначе запускает последовательно; aggressive параллелит до max_parallel_phases без обоснования; dependencies/blocks — жёсткий запрет параллели независимо от режима; parallel_mode хранится в основном settings.json и меняется только пользователем (модель может предложить смену в heartbeat)
- [x] #20 Документ явно фиксирует, что git-конфликт слияния уже исключён сериализацией close (closeQueue, VL-146), поэтому супервизор решает смысловое пересечение работ, а не merge
- [x] #21 Документ описывает взаимодействие с чатом: показ плана прогона, approval-карточка grant, статус шагов, команда stop, итоговый отчёт о прогоне
- [x] #22 Документ содержит раздел «Открытые вопросы» с рекомендациями: нужен ли backlog_orchestrate отдельным инструментом или достаточно auto_queue + логики супервизора; как супервизор узнаёт о падениях при закрытом чате; уведомления в Telegram по завершении прогона; поведение при пустом состоянии (wake gate)
- [x] #23 Документ содержит раздел «Разбиение на задачи»: VL-268 — инструменты trigger/status/auto_queue + grant-механизм; VL-269 — тик-механизм супервизора, healing loop, планировщик параллельности, промпт роли, лимиты роли; VL-269 зависит от VL-268
- [x] #24 Документ содержит разделы «Вне скоупа» и «Критерии готовности реализации» — проверяемые утверждения для AC задач VL-268 и VL-269
- [x] #25 Документ ссылается на ref-10 (hermes-agent) с указанием конкретных путей в клоне (cron/AGENTS.md, cron/scheduler_prompt.py, cron/notepad.py, cron/jobs.py) и на факты этого проекта (src/agent/loop.ts:213, src/web/chat.ts:66, src/web/orchestrator.ts:818, src/core/worktree.ts, src/bot/auto-runner.ts)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Спецификация

Документ: **doc-19** «Роль «Супервизор»: автозапуск и лечение фаз из чата (спецификация)» — читать через `document_view doc-19`.

21 раздел: терминология (supervisor vs `src/web/orchestrator.ts`), отличие от auto-runner, что уже есть / чего нет, архитектура тик-модели по ref-10 (hermes-agent: script/heartbeat, context_from, notepad, wake gate, idle-watchdog), исправление фактов о лимитах фаз, лимиты роли, модель состояния (`state.json` + `heartbeat.md`), 4 MCP-инструмента, healing loop (декларативные `heal_rules` + решение модели в тике), авто-баг, параллельность по метаданным задачи, grant на прогон, самонастройка, взаимодействие с чатом, открытые вопросы, разбиение на задачи, вне скоупа, критерии готовности.

Приёмка этой задачи — наличие документа с перечисленными разделами; код по документу пишется в **VL-268** (инструменты + grant) и **VL-270** (тик, healing, планировщик, промпт роли). Механизм лимитов чата, от которого зависит VL-270, — **VL-269**.
<!-- SECTION:NOTES:END -->

## Final Summary
<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deliverable получен: документ **doc-19** «Роль «Супервизор»: автозапуск и лечение фаз из чата (спецификация)», 21 раздел.

Что зафиксировано в спецификации:
- терминология: роль = `supervisor`, существующий `src/web/orchestrator.ts` не переименовывается;
- архитектура — тик-модель по ref-10 (hermes-agent cron): script/heartbeat, context_from, notepad, wake gate, idle-watchdog; тик крутится в процессе `vibelog browser`, `tick_seconds` = 60;
- исправлены ранее допущенные ошибки: все фазы ограничены `MAX_WALL_TIME_MS_DEFAULT = 900_000` плюс настройки проекта, «бесконечного close» не существует; обоснование архитектуры — несопоставимость масштабов (чат 8 итераций / 120 с против фазы до 40 минут);
- лимиты роли вынесены в конфиг (`supervisor.limits`: 30 итераций / 600 с против 8 / 120 у остальных);
- раскладка `.vibelog/supervisor/` (settings.json, tuning.log, state.json, heartbeat.md, grants/), имена модулей `src/core/supervisor-{config,state}.ts` и `src/web/supervisor.ts`;
- 4 MCP-инструмента: `backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`; `backlog_finish_phase` остаётся запрещённым;
- healing двухуровневый: декларативные `heal_rules` без LLM + решение модели в тике (фаза `analyze` для лечения не годится — она read-only);
- параллельность по метаданным задачи, не по `modified_files` (поле появляется только после code, worktree создаётся на plan/do — `orchestrator.ts:818`); `dependencies`/`blocks` — жёсткий запрет;
- grant на прогон (а не на тред): taskIds + allowedTools + expiresAt, отзыв при stop/завершении, `write_file` вне grant всегда с подтверждением;
- самонастройка: `allow_self_tuning` = false по умолчанию, модель правит только `heal_rules`/`comment_template`, защищённые поля — в основном settings.json.

Фазы plan/code не запускались (решение A): deliverable — документ, диалоговый контекст (уточнения, разбор кода и референса) в автономную фазу не передаётся.

Реализация вынесена в задачи: **VL-268** (инструменты + grant) и **VL-270** (тик, healing, планировщик, промпт роли). Механизм лимитов, от которого зависит VL-270, — **VL-269**.
<!-- SECTION:FINAL_SUMMARY:END -->