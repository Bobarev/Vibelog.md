---
id: VL-270
title: 'Супервизор (2/2): тик-механизм, healing loop, планировщик параллельности, промпт роли'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 21:37'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - web
  - chat
  - supervisor
  - healing
  - scheduler
dependencies:
  - VL-268
  - VL-269
milestone: v1.11
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/supervisor-config.ts
  - src/core/supervisor-state.ts
  - src/web/supervisor-tick.ts
  - src/web/supervisor.ts
  - src/web/chat.ts
  - src/web/personas.ts
  - src/web/server.ts
  - templates/prompts/personas/supervisor.md
  - README.md
  - src/core/supervisor-config.test.mjs
  - src/core/supervisor-state.test.mjs
  - src/web/supervisor-tick.test.mjs
  - src/web/supervisor-healing.test.mjs
  - src/web/supervisor-parallel.test.mjs
  - src/web/supervisor-limits.test.mjs
  - src/web/supervisor.test.mjs
  - src/web/personas.test.mjs
lessons:
  - lesson-127
  - lesson-128
token_usage:
  input: 42856114
  output: 357705
  cache: 40933376
  total: 43213819
  requests: 312
  duration_ms: 2493740
  reasoning: 218252
  by_phase:
    plan:
      input: 23311735
      output: 134797
      cache: 22481152
      requests: 141
    code:
      input: 16987209
      output: 184820
      cache: 16059648
      requests: 130
    close:
      input: 2557170
      output: 38088
      cache: 2392576
      requests: 41
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Внимание: нумерация

В спецификации **doc-19** вторая задача реализации названа «VL-269». Фактически это **VL-270**: VL-269 заняла задача «Лимиты чата в конфиг». Ниже все ссылки — на doc-19, чтобы не было путаницы.

Реализация идёт строго по doc-19 «Роль «Супервизор»: автозапуск и лечение фаз из чата».

## Зависимости

- **VL-268** — MCP-инструменты (`backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`) и grant-механизм. Без них супервизор не может ничего запустить.
- **VL-269** — механизм лимитов чата в конфиге (`chat.max_iterations`, `chat.max_wall_time`). Отсюда берутся `supervisor.limits`.

## Что делать

### 1. Тик-механизм (doc-19 §5)

Тик крутится в процессе `vibelog browser`, период — `tick_seconds` (дефолт 60) из `.vibelog/settings.json`, секция `supervisor`.

Один тик:

```
1. собрать состояние   ← фазы, статусы, exitCode, fail_reason, repeat_stats
2. записать heartbeat.md + state.json
3. wake gate: изменилось ли что-то?  — нет → тик закончен без вызова модели
4. вызвать модель с промптом (heartbeat + правила + grant + прошлое решение)
5. применить решение: запустить фазы / полечить / создать баг / ждать
```

Ключевое: **никакого состояния в памяти**. Всё на диске, поэтому рестарт процесса не ломает прогон.

### 2. Состояние (doc-19 §10)

- `.vibelog/supervisor/state.json` — машинное, поля из `doc-19 §10`, запись атомарная (temp + rename);
- `.vibelog/supervisor/heartbeat.md` — человекочитаемый срез, он же инжектится в промпт тика;
- живость фазы — по `pid` + `phaseRunId` (`process.kill(pid, 0)`), потому что `activeRuns` в `src/web/orchestrator.ts` теряется при рестарте.

### 3. Healing, уровень 1 (doc-19 §12)

Декларативные `heal_rules` из `.vibelog/supervisor/settings.json`:

```json
{
  "heal_rules": [
    { "id": "repeat-loop", "when": { "repeat_share_min": 0.25, "repeat_calls_min": 8 },
      "action": "comment_and_retry",
      "comment_template": "Ты повторно обращался к тем же путям: {top_repeats}. Используй ранее полученный результат; следующий шаг — правка, а не чтение." },
    { "id": "payload-limit", "when": { "fail_reason_contains": ["payload"] }, "action": "retry" },
    { "id": "wall-timeout", "when": { "fail_reason_contains": ["max-wall-time", "таймаут"] }, "action": "retry" },
    { "id": "no-progress", "when": { "status_unchanged": true }, "action": "retry_once_then_bug" }
  ],
  "default_action": "bug"
}
```

Правила упорядочены, первое совпадение выигрывает, `id` попадает в `state.json` и в отчёт. `action` — закрытый набор: `retry`, `comment_and_retry`, `retry_once_then_bug`, `bug`, `stop`. Битое правило выпадает с предупреждением (паттерн `loadWorkflows` в `src/core/workflow.ts`).

Директива уходит фазе через `startTaskPhase(cwd, id, 'comment', { comment })`.

### 4. Healing, уровень 2 (doc-19 §12)

Содержательные ошибки (упавшие тесты, ошибочный план) разбирает модель внутри тика — у неё есть `logTail`, `repeat_stats`, `fail_reason`. Фаза `analyze` для лечения **не используется**: по шаблону `templates/phases/phase-analyze.md` она read-only.

### 5. Авто-баг (doc-19 §13)

При исчерпании `heal_attempts` (дефолт 2) или действии `bug` — задача в статусе **Spec**, создаётся автоматически. Описание детерминированное: `fail_reason` + фрагмент `logTail` + ID сессии + цепочка сработавших правил. Метки `auto-bug` и имя фазы.

### 6. Планировщик параллельности (doc-19 §14)

- группы до `max_parallel_phases` (дефолт 3);
- `dependencies`/`blocks` — **жёсткий запрет параллели** в любом режиме;
- `conservative` — модель обязана обосновать каждую группу по `labels`/описанию, обоснование пишется в `heartbeat.md`; не обосновала — последовательно;
- `aggressive` — без обоснования;
- **не по `modified_files`**: поле заполняется только фазой `code`, а worktree создаётся на `plan`/`do` (`src/web/orchestrator.ts:818`).

### 7. Самонастройка (doc-19 §16)

`allow_self_tuning` (дефолт `false`) разрешает править `.vibelog/supervisor/settings.json` — только `heal_rules` и `comment_template`. Изменения в `tuning.log` (время, было, стало, причина). Защищённые поля — `max_parallel_phases`, `heal_attempts`, `allow_self_tuning`, `parallel_mode` — в основном `.vibelog/settings.json`, модель их не трогает.

### 8. Лимиты роли (doc-19 §7)

При активной персоне `supervisor` ход чата использует `supervisor.limits.chat_max_iterations` (30) и `chat_max_wall_time` (600 с) через механизм из VL-269. Остальные роли не меняются.

### 9. Промпт роли

`templates/prompts/personas/supervisor.md` с переопределением `.vibelog/prompts/personas/supervisor.md` (схема `loadChatSystemTemplate` в `src/web/tool-policy.ts`). Содержание — по doc-19: планирование прогона, обоснование групп, порядок диагностики, авто-баг, запрет подделки прогресса. Промпт пишется после того, как инструменты и тик работают.

## Установлено по коду

- Запуск фаз и состояние: `src/web/orchestrator.ts` — `startPhase`, `startTaskPhase`, `getRun`, `activeRuns`, `lastRuns`, `PhaseRun`.
- Диагностика повторов: `analyzeToolRepeatsFromJsonlSync` (`src/agent/session.ts:564`), `RepeatStats`, `SessionMeta.repeat_stats`.
- Очередь: `src/core/auto-queue.ts`; зависимости: `isReady` (`src/core/deps.ts:49`).
- Workflow: `src/core/workflow.ts` — `getWorkflowForTask`, `getAvailablePhases`, `isPhaseAllowed`, `getStatusAfterPhase`.
- Образец цикла: `src/bot/auto-runner.ts` (успех = exitCode 0 **и** смена статуса, VL-191) — переиспользовать логику определения прогресса.
- Настройки: `src/core/settings.ts` (`loadSettings`, `saveSettingsPatch`).

## Вне скоупа

- MCP-инструменты и grant — VL-268 (зависимость).
- Механизм лимитов чата — VL-269 (зависимость).
- UI: пикер роли (VL-265), стиль карточек (VL-264).
- Уведомления в мессенджеры.
- Изменение механики close/worktree и `CHAT_DISALLOWED_TOOLS`.
- Миграция `.vibelog/auto-queue.json` под управление супервизором.

## Связи

- **doc-19** — спецификация.
- **VL-267** — задача-спека.
- **VL-268**, **VL-269** — зависимости.
- **VL-265** — персона `supervisor` в реестре ролей.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Реализован тик-механизм в процессе vibelog browser: таймер с периодом tick_seconds (дефолт 60) из .vibelog/settings.json, переживающий отсутствие изменений; тик не хранит состояния в памяти, всё читается и пишется через файлы
- [x] #2 Реализован wake gate: если с прошлого тика состояние не изменилось (нет смены статусов, нет падений, нет новых метрик), модель НЕ вызывается — тик завершается без LLM-запроса и без затрат токенов; проверяется счётчиком вызовов модели в тесте
- [x] #3 Реализована сборка промпта тика: heartbeat.md (срез состояния) + конфиг правил лечения + активный grant + история прошлого решения (аналог context_from); промпт не превышает разумного размера и не содержит сырых логов целиком
- [x] #4 Реализованы state.json и heartbeat.md по doc-19 §10: fields runId, mode, tick, lastDecision (tick/action/ruleId/taskId/reason), tasks с phase/status/phaseRunId/pid/startedAt/attempt/healAttempts/groupId/lastError/lastRepeatStats; запись после каждого тика атомарна (temp + rename)
- [x] #5 Живость фазы определяется по pid + phaseRunId (process.kill(pid, 0)): после рестарта процесса зависшая фаза распознаётся как упавшая и попадает в лечение, а не считается вечно идущей
- [x] #6 Реализован healing уровня 1: чтение heal_rules из .vibelog/supervisor/settings.json, упорядоченное сопоставление по when (repeat_share_min, repeat_calls_min, fail_reason_contains, status_unchanged), первое совпадение выигрывает, id правила попадает в state.json и отчёт; actions retry / comment_and_retry / retry_once_then_bug / bug / stop
- [x] #7 comment_template поддерживает подстановки {top_repeats}, {fail_reason}, {task_id}, {attempt}; директива уходит через startTaskPhase(..., 'comment', { comment }) перед рестартом фазы
- [x] #8 Битое или невалидное правило heal_rules не роняет тик — правило выпадает с предупреждением в heartbeat/лог (паттерн loadWorkflows); невалидный action или неизвестный when-ключ тоже не ломают цикл
- [x] #9 Реализован default_action при отсутствии совпавших правил; heal_attempts (дефолт 2) ограничивает число лечебных попыток на фазу, при исчерпании — авто-баг и стоп по этой задаче
- [x] #10 Реализован healing уровня 2: модель внутри тика разбирает содержательные ошибки (упавшие тесты, ошибочный план) на основе logTail, repeat_stats, fail_reason; отдельная фаза analyze для лечения не вызывается
- [x] #11 Реализовано авто-создание баг-задачи в статусе Spec с детерминированным описанием: fail_reason + фрагмент logTail + ID сессии + цепочка сработавших правил; метки auto-bug и имя фазы; связь с исходной задачей
- [x] #12 Реализован планировщик параллельности: группы до max_parallel_phases; dependencies/blocks — жёсткий запрет параллели независимо от режима; режимы conservative (обязательное обоснование группы по labels/описанию, обоснование пишется в heartbeat.md, не смог обосновать — последовательно) и aggressive (без обоснования)
- [x] #13 Параллельность НЕ опирается на modified_files (поле заполняется только фазой code, а worktree создаётся на plan/do — src/web/orchestrator.ts:818); критерий — метаданные задачи (title, description, labels, type, dependencies)
- [x] #14 Реализована самонастройка: при allow_self_tuning=true модель может править .vibelog/supervisor/settings.json (heal_rules, comment_template); изменения пишутся в tuning.log (время, было, стало, причина); защищённые поля max_parallel_phases, heal_attempts, allow_self_tuning, parallel_mode моделью не правятся — проверяется тестом
- [x] #15 Лимиты роли supervisor применяются: при активной персоне supervisor ход чата использует supervisor.limits.chat_max_iterations и chat_max_wall_time (механизм из VL-269), для остальных ролей значения не меняются
- [x] #16 Написан промпт роли templates/prompts/personas/supervisor.md: планирование прогона, обоснование групп в conservative, порядок диагностики падений (сначала heal_rules, потом решение модели), правила авто-бага, запрет подделки прогресса, честное описание доступных инструментов; переопределение проекта — .vibelog/prompts/personas/supervisor.md
- [x] #17 Промпт не упоминает backlog_finish_phase как доступный и явно запрещает попытки менять статусы в обход фаз
- [ ] #18 Проверено end-to-end на наборе задач: прогон стартует по grant, фазы идут группами в пределах лимита, при искусственном зацикливании срабатывает правило repeat-loop, фаза получает комментарий и продолжает работу, при исчерпании лечения создаётся баг-задача в Spec
- [x] #19 Рестарт процесса vibelog browser посреди прогона не ломает его: после перезапуска следующий тик читает state.json, распознаёт зависшую фазу и продолжает лечение
- [x] #20 Тесты: supervisor-config (валидация heal_rules, дефолты, битые правила), supervisor-state (state/heartbeat/атомарность, живость по pid), healing (все actions, порядок правил, подстановки шаблона, исчерпание heal_attempts), планировщик (dependencies-запрет, лимит групп, conservative без обоснования → последовательно), авто-баг (формат описания), wake gate (модель не вызывается при отсутствии изменений), лимиты роли
- [x] #21 Документация: README (раздел супервизора — запуск, состояние, heartbeat, правила лечения, режимы параллельности), doc-19 актуализирован при расхождениях, шаблон промпта описан в разделе personas; npm run build и lint проходят
- [x] #22 Реализация соответствует doc-19 §5, §7–§10, §12–§14, §16–§17; расхождения с документом зафиксированы в Implementation Notes
- [x] #23 Супервизор не назначает фазы сам: следующая фаза задачи всегда определяется воркфлоу (getWorkflowForTask → getAvailablePhases → isPhaseAllowed, src/core/workflow.ts); переставить или пропустить шаг воркфлоу невозможно, ветвление (reject, фикс-цикл Review → code) соблюдается — reject берётся только вручную, как в auto-runner (pickAutoPhase)
- [x] #24 Задачи с разными воркфлоу корректно идут в одном прогоне: у каждой своя следующая фаза и своё число шагов до close; лимит max_parallel_phases считается по числу одновременно работающих фаз, а не по числу задач
- [x] #25 Создание worktree не является решением супервизора: изоляция появляется на первой «кодовой» фазе воркфлоу (plan в дефолтном, do в simple — src/web/orchestrator.ts:818); если в воркфлоу такой фазы нет (epic), задача идёт в главном дереве, и это не считается ошибкой
- [x] #26 Отсутствующий или невалидный воркфлоу задачи не роняет прогон — используется DEFAULT_WORKFLOW (fallback в loadWorkflows), поведение покрыто тестом
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст и опорные решения

Реализация по doc-19 (§5, §7–§10, §12–§14, §16–§17). VL-268 (инструменты + grant) и VL-269 (лимиты чата) уже в master — код проверен:

- `src/web/supervisor.ts` — план/старт/стоп/статус прогона (`buildSupervisorPlan`, `startSupervisorRun`, `supervisorRunStatus`, `loadSupervisorSettings`, `runs/<runId>.json`); в памяти ничего, состояние на диске.
- `src/web/supervisor-grant.ts` — `SUPERVISOR_DIR='.vibelog/supervisor'`, `GRANTABLE_TOOLS`, `findActiveGrant`, `isGrantActive`, `revokeGrant`, `makeRunId`.
- `src/web/orchestrator.ts` — `startTaskPhase(cwd, id, phase, {comment, sameSession, extraArgs, onExit})`, `getRun(id)` (`PhaseRun{running,phase,pid,exitCode,logTail,result,queued}`), `countActiveRuns()`; `activeRuns`/`lastRuns` — в памяти (рестарт теряет).
- `src/web/chat-limits.ts` — `resolveChatLimits` (секция `chat`), `createCallGuard` (per-call timeout с перевзводом на активность).
- `src/web/personas.ts` — реестр ролей, `BUILTIN_PERSONAS` (сейчас 3: helper/architect/orchestrator), `loadPersonaPrompt` (проект → пакет, fail-closed), `resolveDefaultStatus`.
- `src/core/workflow.ts` — `getWorkflowForTask`/`getAvailablePhases`/`getNextPhase`/`isPhaseAllowed`; `loadWorkflows` — эталон терпимой валидации с fallback на `DEFAULT_WORKFLOW`.
- `src/core/settings.ts` — `loadSettings`/`saveSettingsPatch` (read-modify-write).
- `src/mcp/supervisor.ts` — эталон сбора диагностики фазы (`toolPhaseStatus`: `getRun` + мета сессии + `analyzeToolRepeatsFromJsonlSync`), эталон `ackOk`-снимков.
- `src/agent/session.ts` — `agentSessionsDir`, `findLatestTaskSessionSync`, `loadSessionMetaSync`, `analyzeToolRepeatsFromJsonlSync`; `SessionMeta.repeat_stats`, `last_run.is_error`.
- `src/web/server.ts:146` — точка запуска таймеров (`startWebServer`, внутри `server.listen(...)`); `src/bot/auto-runner.ts` — эталон цикла с `setInterval(...).unref()` и guard-флагом.

**Ключевые архитектурные решения (фиксирую здесь, т.к. в doc-19 не детализировано):**

1. **Модель в тике не вызывает инструменты сама.** Тик собирает состояние сам (код), а модель получает heartbeat-промпт и обязана вернуть **один JSON-объект решения** (`{"action": "...", "tasks": [...], "rationale": "...", "diagnosis": "...", "tuning": {...}}`). Применяет решение — код (`startTaskPhase`, `createTaskFile`, патч правил), а не LLM-tool-loop. Причины: (а) детерминизм и тестируемость без реальной модели; (б) AC23/AC25 — фазы выбирает workflow, а не модель, значит модель не должна иметь «ручку» фазы; (в) тик не тянет весь chat-tool-loop (лимиты VL-269 про ход чата, не про тик). Промпт роли описывает именно этот контракт ответа.
2. **Решение парсится терпимо**: ищем первый fenced ```json блок, иначе — balanced-объект; не распарсили/схема невалидна → детерминированный фолбэк «последовательный запуск готовых задач по приоритету», в heartbeat пишется причина (`decision: fallback`). Тик никогда не падает из-за ответа модели.
3. **Живость фазы**: в state пишется `pid` + собственный `phaseRunId` (оркестратор своего runId не отдаёт — генерируем в тике при запуске: `run-<taskId>-<phase>-<attempt>`); живость — `process.kill(pid, 0)` (ESRCH → мёртв, EPERM → жив). Если state говорит `running`, а pid мёртв: сверяем статус задачи — сменился на ожидаемый `getStatusAfterPhase(...)` → фаза успешна, иначе `failed` + `lastError='процесс фазы не найден (pid N)'` и в лечение.
4. **`loadSupervisorSettings` не дублируем** (lesson-37): чтение секции `supervisor` переезжает в новый `src/core/supervisor-config.ts`, а `src/web/supervisor.ts#loadSupervisorSettings` становится тонкой обёрткой над ним (публичный контракт `{maxParallelPhases, defaultTtlHours, errors}` сохраняется — его проверяет `src/web/supervisor.test.mjs:112-127` и `src/mcp/supervisor-tools.test.mjs:255`).
5. **Авто-баг без `dependencies`**: `createTaskFile` с `status: 'Spec'`, `type: 'bug'`, `labels: ['auto-bug', <фаза>]`, а связь с исходной задачей — явным упоминанием в описании (doc-19 §13 допускает оба варианта). Обоснование: зависимость от незавершённой задачи сделала бы баг-задачу заблокированной и `isReady` не пустил бы её в работу.
6. **Таймер тика включается только при активном grant** (иначе — no-op). Это и продовая логика (нет прогона — нечего наблюдать), и защита тестов: сервера в `*.test.mjs` поднимаются без grant → лишних LLM-вызовов не будет. Дополнительно env `VIBELOG_SUPERVISOR_TICK=off` глушит тик целиком (для тестов/отладки).

## Файлы

### Новые

1. **`src/core/supervisor-config.ts`** — конфиг супервизора (аналог связки `settings.ts` + `workflow.ts`).
   - Типы: `SupervisorRuntime` `{tickSeconds, maxParallelPhases, healAttempts, allowSelfTuning, parallelMode, limits:{chatMaxIterations, chatMaxWallTimeMs}, errors}`; `HealAction = 'retry'|'comment_and_retry'|'retry_once_then_bug'|'bug'|'stop'`; `HealWhen = {repeat_share_min?, repeat_calls_min?, fail_reason_contains?, status_unchanged?}`; `HealRule = {id, when, action, commentTemplate?}`; `HealConfig = {rules, defaultAction, errors}`.
   - `resolveSupervisorRuntime(cwd)`: секция `supervisor` `.vibelog/settings.json`; дефолты doc-19 §7: `tick_seconds=60` (5..3600), `max_parallel_phases=3` (1..8 — **внимание: сейчас DEFAULT_MAX_PARALLEL_PHASES=2 в supervisor.ts; привожу к doc-19 = 3 и обновляю тесты VL-268, где ждёт 2** — отмечено в «Изменениях тестов» ниже), `heal_attempts=2` (0..10), `allow_self_tuning=false`, `parallel_mode='conservative'|'aggressive'`, `limits.chat_max_iterations=30` (1..200), `limits.chat_max_wall_time=600` сек (1..86400). Терпимо (lesson-117): битое значение → дефолт + текст в `errors`, секция не роняет тик.
   - `loadHealRules(cwd)`: файл `.vibelog/supervisor/settings.json`, ключи `heal_rules` (массив) и `default_action`. По умолчанию (нет файла/битого/невалидного) — `DEFAULT_HEAL_RULES` из doc-19 §12 в коде (repeat-loop, payload-limit, wall-timeout, no-progress) + `DEFAULT_HEAL_ACTION='bug'`. Битое правило выпадает с текстом в `errors` (паттерн `loadWorkflows`), валидные остаются. Валидация: `id` непустая строка; `when` — объект, хотя бы один известный ключ, неизвестные ключи → ошибка правила (не выпадает только из-за них — но фиксируется); `repeat_share_min` 0..1, `repeat_calls_min` целое ≥1, `fail_reason_contains` непустой массив непустых строк, `status_unchanged` boolean; `action` ∈ закрытого набора; `comment_template` — строка (для `comment_and_retry` обязательна).
   - `PROTECTED_SUPERVISOR_KEYS = ['max_parallel_phases','heal_attempts','allow_self_tuning','parallel_mode']` — белый список для самонастройки (наружу — для теста AC14).
   - `saveHealRules(cwd, rules, defaultAction)` — атомарная запись `.vibelog/supervisor/settings.json` (temp+rename).
   - `applySelfTuning(cwd, current, patch, reason, now)` → `{applied: {heal_rules?, default_action?}, rejected: string[], tuningLogLine}`: принимает только `heal_rules`/`default_action`; любое упоминание защищённых ключей ИЛИ `comment_template` вне `heal_rules[i]` → `rejected` с причиной (comment_template правится только внутри правила); пишет `tuning.log` строкой `<ISO> было=<hash|json> стало=<...> причина=<...>` (append), возвращает `{rows}`-снимок для `state.json`.
   - `tuningLogPath(cwd)`.

2. **`src/core/supervisor-state.ts`** — состояние прогона (`.vibelog/supervisor/state.json`, `heartbeat.md`, `tuning.log`).
   - Типы по doc-19 §10: `SupervisorTickState` `{runId, mode, startedAt, updatedAt, tick, lastDecision:{tick,action,ruleId?,taskId?,reason}, tasks: Record<string, SupervisorTaskState>, tuning:{applied:number,last?}, snapshotHash?: string, wakeAt?: string}`; `SupervisorTaskState` `{phase, status:'running'|'failed'|'done'|'pending', phaseRunId?, pid?, startedAt?, attempt, healAttempts, groupId?, lastError?, lastRepeatStats?, ruleChain?: string[], statusAtStart?: string, frozen?: boolean}`.
   - `statePath/heartbeatPath/tuningLogPath`, `loadState` (нет/битый → null), `saveState` (**атомарно**: `state.json.tmp` в том же каталоге → `renameSync`), `updateState(cwd, mutator)` — read-modify-write с одним `saveState`.
   - `writeHeartbeat(cwd, state, extra)` → `heartbeat.md`: прогон (идёт/остановлен, tick, grant до), таблица задач (id/фаза/статус/попытки/healAttempts/группа), прошлое решение + причина, при `conservative` — обоснование групп, ошибки правил (`heal_rules errors`), последние ошибки с фрагментом `logTail` (≤8 строк на задачу), `tuning`-записи. Файл же инжектится в промпт (усечение — `buildTickPrompt`).
   - `isPidAlive(pid)` — `process.kill(pid, 0)` в try/catch: `true` для живого/EPERM, `false` для ESRCH/прочего; `pid` не число/≤0 → false.
   - `phaseAlive(state, taskId)` — статус `running` **и** `phaseRunId` совпадает **и** `isPidAlive(pid)`.
   - `collectTaskObservation(cwd, taskId)` — переиспользуемый сбор (getRun + мета сессии + repeat_stats, как в `src/mcp/supervisor.ts#toolPhaseStatus`, включая поиск сессии в каталоге главного репо и worktree): `{run, sessionId, sessionPhase, repeatStats, lastRunError, finishedAt}`. Используется и тиком, и (шаг рефактора 7 ниже) `toolPhaseStatus`.
   - `snapshotKey(cwd, state, observations)` — стабильный ключ «изменилось ли» (JSON со сортированными полями: статусы задач, running-флаги, exitCode, lastError, repeat-метрики, число задач с доступной фазой и без активного рана, grant expiresAt/revokedAt, tick). Хеширование — FNV-1a (как в `repeat-tracker.ts`, без crypto).

3. **`src/web/supervisor-tick.ts`** — сам тик, healing, планировщик, авто-баг.
   - `startSupervisorTimer(cwd, opts?)` / `stopSupervisorTimer()`: `setInterval(tickSeconds*1000).unref()`, guard-флаг против наложения тиков (паттерн `autoActive` в auto-runner). Стартует только если `findActiveGrant(cwd)` не null и `process.env.VIBELOG_SUPERVISOR_TICK !== 'off'`; при отсутствии активного grant — таймер не заводится/останавливается. Дочерний `stopSupervisorTimer` вызывается из `server.on('close')` (см. изменения в `server.ts`).
   - `runSupervisorTick(cwd, deps)` — один тик, вся логика без таймера (тестируется прямо):
     1. `findActiveGrant` → нет grant → `{skipped:'no-grant'}` (модель не зовётся);
     2. `loadState` (или создать из `latestRunRecord`/grant: `runId`, `mode` из `resolveSupervisorRuntime`);
     3. для каждой задачи прогона — `collectTaskObservation` → `tasks[id]` из state обновляем (`phase`, `status`, `pid`, `lastError`, `lastRepeatStats`), живость по pid+phaseRunId, сверка «статус задачи сменился на `getStatusAfterPhase`» → `done` + сброс `healAttempts`; мёртвая фаза → `failed` + `lastError`;
     4. задачи grant'а, чья текущая фаза завершена и есть доступная фаза (`getWorkflowForTask` → `getNextPhase`), получают `status: 'pending'` (кандидаты на запуск);
     5. упавшие задачи проходят healing L1 (см. ниже) — получают `lastDecision` и либо директиву+рестарт, либо авто-баг/stop;
     6. `snapshotKey`; wake gate: `key === state.snapshotHash` **и** нет ни одной `pending` без активного рана **и** нет новых упавших → `saveState` + `writeHeartbeat` + `{skipped:'unchanged'}` — **LLM не вызывается** (AC2, тест считает вызовы `deps.llm.streamChat`);
     7. иначе — `buildTickPrompt` + `deps.llm.call` (инъекция; прод — `createLlmClient({cwd, apiMode: loadApiMode(cwd)})`), парсинг `parseTickDecision`, применение: запуск групп (`startTaskPhase`), лечение L2 (диагностика содержательных ошибок — только комментарий/рестарт/баг, никаких новых фаз типа `analyze`), авто-баг, `tuning`;
     8. `saveState` (атомарно) + `writeHeartbeat` + `{applied: [...]}`.
   - **Wake gate** детализация: сравнение по `snapshotHash` + явные «сигналы работы» (есть pending-кандидаты; появились новые failed; истёк/отозван grant; протух таймер задачи — фаза `running` дольше `max(wall-time, idle)` без смены статуса). Часовые тики (например, раз в 30 мин) — не модель, а `writeHeartbeat` «прогон жив» (heartbeat обновляется всегда, даже когда модель не звалась).
   - `buildTickPrompt(cwd, state, heal, grant, heartbeat, lastDecision)`: heartbeats-срез, **сжатый** (таблица задач + только фрагменты логов ≤40 строк суммарно, repeat-топ-3 вместо полной метрики), текущие `heal_rules`/`default_action` (JSON, но без `comment_template`-полноты — шаблоны не нужны модели для решения, они нужны коду), grant (taskIds, expiresAt), прошлое решение (`context_from`), контракт ответа (JSON-схема решения), правила (`parallel_mode`, запрет менять `max_parallel_phases`/`heal_attempts`/`parallel_mode`/`allow_self_tuning`, запрет подделки прогресса). Бюджет: обрезка по `MAX_TICK_PROMPT_CHARS` (~24 КБ) с приоритетом «heartbeat без сырых логов».
   - `parseTickDecision(text)` → `{decision|null, error?}`: fenced ```json → первый balanced объект → валидация схемы (`action ∈ {run, heal, bug, stop, wait}`, `tasks` — строки-ID из grant'а, `groups` — массивы, `rationale` — строка, `tuning` — объект). Невалидно → `null` + причина (фолбэк-последовательность).
   - `healLevel1(cwd, taskState, rules, obs, ctx)` → `{ruleId, action, comment?, reason, ruleChain}`: первое совпавшее правило по порядку; `when.repeat_share_min` и `repeat_calls_min` — оба заданные должны выполниться (AND); `fail_reason_contains` — любое из значений (OR) в нижнем регистре по `lastError`; `status_unchanged` — успешная фаза с неизменившимся статусом. Нет совпадения → `default_action`.
   - `applyHealAction`: `retry` → `startTaskPhase` c `extraArgs` от `retryResumeArgs`-аналога (переиспользовать `retryResumeArgs` из `src/bot/auto-runner.ts` — экспортирована); `comment_and_retry` → `startTaskPhase(cwd, id, 'comment', {comment})` (AC7: `startTaskPhase(..., 'comment', { comment })` — директива пишется в задачу, фаза `comment` даёт агенту разбор), затем рестарт фазы; `retry_once_then_bug` → retry, если `healAttempts < heal_attempts`, иначе bug; `bug` → авто-баг + стоп по задаче; `stop` → стоп по задаче (в state `frozen:true`, в heartbeat причина). Все действия инкрементируют `healAttempts`/`attempt` и пишут `ruleChain` (цепочка сработавших правил) в state — она нужна авто-багу (AC11).
   - `renderCommentTemplate(tpl, vars)` — подстановки `{top_repeats}`, `{fail_reason}`, `{task_id}`, `{attempt}` (`top_repeats` — строка вида `read_file src/web/chat.ts ×6, grep_search loop.ts ×4`), плюс безопасный фолбэк для неизвестного `{...}` (оставить как есть).
   - Healing L2 (AC10): при отсутствии совпавшего правила / содержательной ошибке (тесты упали, статус не сменился) — включаем диагностику в промпт тика (`logTail` фрагмент + `repeat_stats` + `fail_reason`) и **применяем решение модели** (`heal` c `comment` — комментарий-директива + рестарт; `bug` — авто-баг; `wait`). Фаза `analyze` не запускается — явно запрещаем в промпте и в `parseTickDecision` (если модель вернула `phase: 'analyze'` в решении — отбрасываем с записью в heartbeat).
   - `createAutoBug(cwd, ctx)` (AC11): `title = '[авто] <фаза> <taskId>: <краткая причина>'`; `description` детерминированный: `## Причина` (`fail_reason`), `## Последние строки лога` (фрагмент `logTail` ≤20 строк), `## Сессия` (sessionId, ссылка на `.vibelog/agent-sessions/<id>.jsonl`), `## Цепочка лечения` (правила из `ruleChain` с числами), `## Исходная задача` (`<taskId>: <title>`); `labels: ['auto-bug', phase]`, `type:'bug'`, `status:'Spec'`; дедуп: если у задачи уже есть открытый auto-bug по этому же `ruleChain`-hash — новый не создаётся (guard от лавины). Возврат — `{id, title}` для heartbeat/отчёта.
   - **Планировщик** `planParallel(cwd, candidates, mode, maxParallel, decision?)`: жёсткий запрет параллели для пар с зависимостью в любую сторону (`blockedBy`/`blocks`, оба направления — AC12); conservative: группа принимается только если модель дала `rationale` для неё **и** в группе нет задач с общими `labels` из пересечения компонентных меток (`bot/web/cli/mcp/core/agent`) или оба `type` без меток → группа разбивается на последовательные одиночки (обоснование пишется в heartbeat, AC12); aggressive: параллель до лимита без обоснования. Лимит — **по числу одновременно работающих фаз** (`countActiveRuns()` + живые фазы из state.json, которые оркестратор после рестарта не видит), а не по числу задач (AC24). `modified_files` не используется вообще (AC13) — критерий только метаданные (`title`, `description`, `labels`, `type`, `dependencies`).
   - Тестовые швы: `setTickLlmForTests(llm|null)`, `setTickClockForTests(fn|null)`, `setStartPhaseForTests`-аналог (или переиспользование существующего шва через импорт `startTaskPhase` в одном месте) — по паттерну VL-140 (`setSpawnEnvBaseForTests`) с обязательным сбросом в `finally` (isolate:false, lesson из VL-200).

4. **`templates/prompts/personas/supervisor.md`** — промпт роли (AC16, AC17): планирование прогона по задачам (не по фазам), обоснование групп в conservative, порядок диагностики (сначала `heal_rules` уровня 1 — их применяет код, модели остаются содержательные разборы), контракт JSON-ответа тика, порядок авто-бага, запрет подделки прогресса, честный список доступных инструментов (`backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`, `backlog_create_task`), явный запрет менять статусы в обход фаз и явное «`backlog_finish_phase` недоступен», запрет трогать `max_parallel_phases`/`heal_attempts`/`allow_self_tuning`/`parallel_mode`, правило «workflow решает фазы, ты — только когда».

### Изменяемые

5. **`src/web/supervisor.ts`**
   - строки 41–46: `DEFAULT_MAX_PARALLEL_PHASES` → импорт из `core/supervisor-config.ts` (`DEFAULT_MAX_PARALLEL_PHASES = 3`, doc-19 §7). Это видимое поведенческое изменение: тесты VL-268, ожидающие 2, обновляются (см. ниже).
   - `loadSupervisorSettings` (62–92) → тонкая обёртка над `resolveSupervisorRuntime` (сохранить поля `maxParallelPhases`/`defaultTtlHours`/`errors`).
   - `buildSupervisorPlan` (151–260) — добавить в `SupervisorPlan` поле `groupsRationale: string[]` (по группе) и `parallelMode`; `buildRationale` дополнить строками обоснований; волны уже дают «жёсткий» запрет параллели по зависимостям внутри набора — добавить проверку «внешняя зависимость между задачами набора, попавшими в одну волну» (expand: пара A→B, где B вне набора, но в наборе есть C, зависящий от A — уже покрыто topological depth; здесь нужно только запретить попадание в одну группу пары с зависимостью — тест).
   - `startSupervisorRun` (330–430): при старте фазы писать в `state.json` `pid`/`phaseRunId`/`statusAtStart` (иначе живость по pid не работает сразу после старта); после старта не забывать `writeHeartbeat`.
   - `supervisorRunStatus` (551–620): в `tasks[]` добавить `phaseRunId`/`lastError` из state (если есть) — чтобы статус не терял знание о живых фазах процесса.

6. **`src/web/chat.ts`** (район 632–646) — после `resolveChatLimits`: если `activePersona.id === 'supervisor'`, применить override из `resolveSupervisorRuntime(cwd).limits` (`chat_max_iterations` → `maxIterations`, `chat_max_wall_time` → `maxWallTimeMs`) и `limitsView` для события `truncated`; ошибки конфига — в лог (паттерн `formatChatLimitsErrors`). Для остальных ролей поведение не меняется (AC15). Механизм per-call timeout и авто-продолжение — из VL-269, не трогаем.

7. **`src/web/personas.ts`** (84–106) — добавить встроенную роль `supervisor`: `{id:'supervisor', label:'Супервизор', description:'Ведёт ночной прогон: запускает фазы, лечит зацикливания, заводит баги', prompt:'supervisor', defaultStatus:'Spec'}`. Плюс (опционально, минимальный рефактор) заменить дублирующий сбор диагностики в `src/mcp/supervisor.ts#toolPhaseStatus` (346–420) на `collectTaskObservation` из `supervisor-state.ts` — при этом `src/mcp/supervisor-tools.test.mjs` обязан остаться зелёным.

8. **`src/web/server.ts`** (146–170) — после `server.listen(...)`: `startSupervisorTimer(cwd)` (no-op без grant); в конце `startWebServer` — `server.on('close', () => stopSupervisorTimer())`; в `server.on('error')` — тоже `stopSupervisorTimer()`. Опционально `src/cli/commands/browser.ts` — без правок (точка входа одна).

9. **`README.md`** (раздел супервизора ~449–512, AC21) — добавить: тик (`tick_seconds`), файлы `.vibelog/supervisor/{state.json,heartbeat.md,settings.json,tuning.log}`, правила лечения (пример `heal_rules`), режимы параллельности (`conservative` — обоснование в heartbeat; `aggressive`), авто-баг, самонастройка (`allow_self_tuning`, `tuning.log`), лимиты роли `supervisor` (`limits.chat_max_iterations`/`chat_max_wall_time`), персона `supervisor` в списке ролей; обновить фразу «реальная оркестрация появится вместе с ролью» (сейчас устарела). Заодно поправить `README`-упоминание дефолта `max_parallel_phases` (2 → 3).

10. **`doc-19`** — актуализация расхождений (AC22): дефолт `max_parallel_phases` (в §7 doc-19 указано 3 — совпадает), уточнить контракт JSON-решения модели в тике (в §5 этого нет), формализовать `state.json`-поля `snapshotHash`/`tuning`/`ruleChain`, зафиксировать решение «модель не вызывает инструменты в тике». Правки — через `document_update` в фазе Code.

11. **`CHANGELOG.md`** — запись о VL-270.

### Изменяемые тесты (обязательно, иначе регрессии)

12. **`src/web/personas.test.mjs`** — `BUILTIN_PERSONAS.length` 3 → 4, список id `['helper','architect','orchestrator','supervisor']` (строки 85, 78–83, 251, 259 — все места с жёстким 3/списком).
13. **`src/web/supervisor.test.mjs:112-127`**, **`src/mcp/supervisor-tools.test.mjs:255-259`**, **`src/web/supervisor.test.mjs:204`** — дефолт `maxParallelPhases` 2 → 3 (AC20: дефолты сверяются с doc-19 §7).

### Новые тесты (AC20)

14. `src/core/supervisor-config.test.mjs` — дефолты всех ключей; битые значения → дефолт + `errors`; валидация `heal_rules` (невалидный `action`, неизвестный `when`-ключ, битые диапазоны, отсутствующий `comment_template` для `comment_and_retry`, не-массив `heal_rules`); файл отсутствует → `DEFAULT_HEAL_RULES`; `applySelfTuning` — применяет `heal_rules`/`default_action`, отклоняет защищённые ключи и `max_parallel_phases` в патче, пишет строку в `tuning.log` с временем/было/стало/причиной.
15. `src/core/supervisor-state.test.mjs` — `saveState` атомарность (нет `.tmp` после записи; `state.json` всегда валидный JSON — проверка на подменённом `renameSync`-пути: temp-файл записан, итог появляется целиком), `loadState` на битом JSON → null, `writeHeartbeat` содержит таблицу задач/прошлое решение/обоснование групп, `isPidAlive(process.pid) === true`, `isPidAlive(999999) === false` (заведомо свободный pid), `phaseAlive` false при несовпадении `phaseRunId`, `snapshotKey` стабилен при равном состоянии и меняется при смене статуса/ошибки/repeat-метрик.
16. `src/web/supervisor-healing.test.mjs` — порядок правил (первое совпадение выигрывает), все 5 actions, `when`-семантика (`repeat_share_min`+`repeat_calls_min` AND, `fail_reason_contains` OR, `status_unchanged`), подстановки `{top_repeats}/{fail_reason}/{task_id}/{attempt}`, `heal_attempts` исчерпание → авто-баг и стоп по задаче (задача больше не запускается), битое правило не роняет тик (предупреждение в heartbeat).
17. `src/web/supervisor-parallel.test.mjs` — `dependencies`/`blocks` запрет параллели в обоих режимах, лимит `max_parallel_phases` считается по числу фаз, `conservative` без `rationale` → последовательно, с `rationale` → группа + запись обоснования в heartbeat, `aggressive` без обоснования, отсутствие опоры на `modified_files` (задача с заполненным `modified_files`, но разными labels — параллелится).
18. `src/web/supervisor-autobug.test.mjs` — формат `title`/`description` (есть `fail_reason`, фрагмент `logTail`, sessionId, цепочка правил, упоминание исходной задачи), `status === 'Spec'`, `labels` содержат `auto-bug` и фазу, отсутствие `dependencies` (AC11 + решение 5), дедуп повторного бага.
19. `src/web/supervisor-tick.test.mjs` — **wake gate**: стаб-LLM считает вызовы — при неизменном состоянии и отсутствии pending `streamChat` не вызван ни разу (AC2), при смене статуса/появлении failed — вызван; парсинг решения (fenced json, мусор → фолбэк-последовательность, `phase:'analyze'` в решении отбрасывается); рестарт: `state.json` с `running`+мёртвый pid → тик помечает failed и лечит, `running`+живой pid (`process.pid`) → не трогает (AC5, AC19); «статус сменился после смерти процесса» → `done` без лечения; `buildTickPrompt` — бюджет и отсутствие полного `logTail`; остановка/старт таймера (grant нет → тик не заводится, `VIBELOG_SUPERVISOR_TICK=off` → глушит).
20. `src/web/supervisor-limits.test.mjs` (или дополнение `src/web/chat-limits.test.mjs`) — при персоне `supervisor` лимиты хода берутся из `supervisor.limits` (через `resolveSupervisorRuntime` + точку применения в `chat.ts`), для helper/architect — прежние 8/120 с.
21. `src/core/workflow-fallback.test.mjs`-кейс (или дополнение `supervisor-tick.test.mjs`) — задача с невалидным/отсутствующим воркфлоу: тик берёт `DEFAULT_WORKFLOW`, прогон не падает (AC26).

## Порядок действий

1. `src/core/supervisor-config.ts` + `supervisor-config.test.mjs` (фундамент: конфиг/heal_rules/самонастройка) — `pnpm build && pnpm test:fast` по файлу.
2. `src/core/supervisor-state.ts` + `supervisor-state.test.mjs` (state/heartbeat/атомарность/pid/snapshot).
3. Обёртка `loadSupervisorSettings` в `src/web/supervisor.ts`, обновление дефолта и тестов VL-268 — прогнать `src/web/supervisor.test.mjs` и `src/mcp/supervisor-tools.test.mjs`.
4. `src/web/supervisor-tick.ts`: сбор состояния + wake gate + `buildTickPrompt` + `parseTickDecision` + фолбэк (+ `supervisor-tick.test.mjs`).
5. Healing L1 + actions + шаблоны + авто-баг (+ `supervisor-healing.test.mjs`, `supervisor-autobug.test.mjs`).
6. Планировщик `planParallel` + интеграция в тик (+ `supervisor-parallel.test.mjs`), лимит по числу фаз.
7. Личность: промпт `templates/prompts/personas/supervisor.md`, роль в `personas.ts`, лимиты в `chat.ts` (+ `personas.test.mjs`, `supervisor-limits.test.mjs`).
8. Таймер в `src/web/server.ts` (+ `server.close`), smoke: `vibelog browser` без grant — таймер молчит; с grant — первый тик пишет `state.json`/`heartbeat.md`.
9. Рефактор `toolPhaseStatus` на `collectTaskObservation` (если прошёл без боли) — прогнать `src/mcp/supervisor-tools.test.mjs`.
10. Документация: README, doc-19 (`document_update`), CHANGELOG.
11. End-to-end (AC18) — ручной прогон на временном проекте/задачах: grant, две задачи в группе, искусственное зацикливание (stub-агент, повторяющий `read_file`), `repeat-loop` → `comment` + рестарт, исчерпание `heal_attempts` → баг в Spec; рестарт `vibelog browser` посреди прогона → следующий тик продолжает (AC19).
12. Финальный полный `pnpm test` + `pnpm lint` + `pnpm build`.

## Как проверять

```bash
pnpm build                       # tsc обязателен: bin/ читает dist/
pnpm test:fast -- src/core/supervisor-config.test.mjs src/core/supervisor-state.test.mjs   # быстрые итерации
pnpm test:fast -- src/web/supervisor-tick.test.mjs src/web/supervisor-healing.test.mjs \
                  src/web/supervisor-parallel.test.mjs src/web/supervisor-autobug.test.mjs
pnpm test:fast -- src/web/supervisor.test.mjs src/mcp/supervisor-tools.test.mjs src/web/personas.test.mjs  # регрессии VL-265/268
pnpm lint && pnpm test           # полный прогон перед DoD
# smoke таймера (в проекте без активного grant — тишина):
node bin/vibelog.mjs browser --no-open   # затем проверить, что .vibelog/supervisor/state.json не появился
```

Правила тестов: каталоги только `mkdtempSync` в `beforeAll`/модуле + `rmSync` в `afterAll` (AGENTS.md, VL-241); LLM всегда стаб и всегда явный `apiMode`, если создаётся реальный клиент (VL-240); `setSpawnEnvBaseForTests`/`setTickLlmForTests` сбрасываются в `finally` (isolate:false, VL-200).

## Риски

1. **Дефолт `max_parallel_phases` 2 → 3** (doc-19 vs реализация VL-268) ломает тесты VL-268 — правка тестов внесена в план, но требует подтверждения, что дефолт 3 действительно желаем; альтернатива — оставить 2 и править doc-19.
2. **Оживление персоны `supervisor`** меняет `BUILTIN_PERSONAS` (3 → 4) и ломает `personas.test.mjs` — правка теста запланирована; риск задеть UI-пикер: новых зависимостей нет (список приходит из API).
3. **Таймер в `startWebServer`** трогает все тесты веб-API, поднимающие сервер: снимается условием «таймер только при активном grant» + `unref()` + явный `stopSupervisorTimer` на `close`; при FAIL-тесте проверить, что нет «open handle»-предупреждений Vitest.
4. **Парсинг JSON-решения модели** — хрупкая точка (модель может ответить текстом): митигация — строгий фолбэк-детерминизм + запись `decision: fallback` в heartbeat; тест на мусор обязателен.
5. **Живость по pid** — pid может быть переиспользован ОС (редко) и «фаза-зомби» считается живой; митигация: сверка `phaseRunId` + возраст (`startedAt` старше wall-time лимита → принудительно failed c пометкой в heartbeat).
6. **`planParallel` в conservative** может выродиться в последовательный прогон при отсутствии компонентных label'ов — это ожидаемое поведение (doc-19 §14), но в E2E нужно заранее проставить метки задачам, иначе AC18 «фазы идут группами» не воспроизведётся.
7. **Рефактор `toolPhaseStatus`** (шаг 9) может задеть тесты VL-268 — выполняется последним и опционально; при падении откатывается, дублирование остаётся с TODO-ссылкой.
8. **Размер промпта тика** — при большом наборе задач heartbeat/правила могут раздуться; митигация — бюджет `MAX_TICK_PROMPT_CHARS` и «фрагменты логов, не логи целиком» (AC3), тест на бюджет.
9. Параллельные worktree: правки `README.md`/`CHANGELOG.md` могут конфликтовать с соседними задачами — конфликты в этих файлах разрешать пересборкой разделов, а не выбором версии (lesson-28).

## Вне скоупа (не делаем)

MCP-инструменты и grant (VL-268), механизм лимитов чата (VL-269), UI пикера роли и стиль карточек (VL-264/265), уведомления в мессенджеры, `CHAT_DISALLOWED_TOOLS` (в частности `backlog_finish_phase` остаётся запрещённым), механика close/worktree, миграция `.vibelog/auto-queue.json`.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Актуализация нумерации

Ранее в doc-19 вторая задача реализации была названа «VL-269». Нумерация исправлена: doc-19 §1 и §19 ссылаются на **VL-270** (эта задача), а **VL-269** — задача «Лимиты чата в конфиг». Все ссылки в doc-19, VL-267, VL-268 и VL-269 приведены в соответствие.

## Зависимости

- **VL-268** — MCP-инструменты (`backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`) и grant-механизм.
- **VL-269** — механизм лимитов чата в конфиге (`chat.max_iterations`, `chat.max_wall_time`), отсюда `supervisor.limits`.

## Спецификация

Реализация — строго по **doc-19**: §5 (тик-модель), §7 (лимиты роли), §8 (idle-watchdog), §9–§10 (файлы и состояние), §12 (healing), §13 (авто-баг), §14 (параллельность), §16 (самонастройка), §17 (взаимодействие с чатом).

## Промпт роли

`templates/prompts/personas/supervisor.md`, переопределение — `.vibelog/prompts/personas/supervisor.md` (схема `loadChatSystemTemplate`, `src/web/tool-policy.ts`). Пишется последним — после того, как инструменты и тик работают, иначе описывал бы несуществующие возможности.
## Расхождения с doc-19 и принятые решения (фаза Code, AC22)

1. **Дефолт `max_parallel_phases` 2 → 3.** Реализация VL-268 использовала 2, doc-19 §7 требует 3. Приведено к документу; константа вынесена в `src/core/supervisor-config.ts` и реэкспортирована из `src/web/supervisor.ts` (единый источник — lesson-37). Тесты VL-268 обновлены (2 → 3).

2. **Модель в тике не вызывает инструменты** (в doc-19 §5 этого нет). Тик собирает состояние кодом, а модель возвращает ОДИН JSON-объект решения (`action`, `groups`, `rationale`, `heal`, `bug`, `stop`, `tuning`); применяет решение код. Обоснование: (а) детерминизм и тестируемость без реального LLM; (б) AC23/AC25 — фазы определяет workflow, значит у модели не должно быть «ручки» фазы вообще; (в) тик не тянет второй chat-tool-loop с его лимитами.

3. **Парсинг решения терпимый**: fenced ```json → первый сбалансированный объект → валидация схемы. Невалидный ответ/отсутствие LLM → детерминированный фолбэк «последовательный запуск готовых задач» (`decision: fallback`), причина — в heartbeat. Тик не падает из-за ответа модели.

4. **`phaseRunId` — собственный идентификатор тика** (`run-<TASK>-<phase>-<attempt>`): оркестратор своего runId не отдаёт, а без него нечем отсечь переиспользованный ОС pid (AC5). Совпадение phaseRunId + жив pid = «фаза идёт».

5. **Сервисные фазы (`comment`/`prompt`) статуса не меняют ПО ЗАМЫСЛУ.** Их завершение трактуется как «директива доставлена», а не как «нет прогресса»: задача возвращается в `pending` и получает рабочую фазу по workflow. Без этого различия лечение уровня 1 (`comment_and_retry`) съедало бы лечебную попытку на собственную же директиву.

6. **Авто-баг без `dependencies`.** Связь с исходной задачей — упоминанием в описании (doc-19 §13 допускает оба варианта). Зависимость от незавершённой задачи сделала бы баг-задачу заблокированной — `isReady` не пустил бы её в работу. Дополнительно: дедуп по хешу цепочки правил (маркер в описании), иначе зацикливание порождало бы лавину багов.

7. **`state.json` расширен против §10** (все поля — additive, документ не противоречат): `snapshotHash` (ключ wake gate), `wakeAt`, `tuning.applied/last`, а в задачах — `ruleChain` (нужна авто-багу), `nextPhase`, `statusAtStart` (определение прогресса), `frozen` (стоп по задаче), `lastRepeatStats`.

8. **Защищённые поля самонастройки**: `PROTECTED_SUPERVISOR_KEYS = [max_parallel_phases, heal_attempts, allow_self_tuning, parallel_mode]`. doc-19 §16 перечисляет три, AC14 добавляет `parallel_mode` — набор взят по AC.

9. **Таймер тика заводится только при активном grant** и глушится `VIBELOG_SUPERVISOR_TICK=off`; снимается на `server.on('close')`/`error`. Это и продовая логика (нет прогона — нечего наблюдать), и защита тестов веб-API от open handles.

10. **`loadSupervisorSettings` делегирует** чтение `max_parallel_phases` в `resolveSupervisorRuntime`; за ним остаётся только `default_ttl_hours` (специфичен для grant'а, у тика такого нет). Публичный контракт `{maxParallelPhases, defaultTtlHours, errors}` сохранён — тесты VL-268 зелёные.

11. **Метрика повторов не теряется**: если текущий ран не оставил `repeat_stats` (упал до post-run), берётся `lastRepeatStats` из состояния — иначе правило `repeat-loop` отключалось бы именно тогда, когда оно нужнее всего.

12. **`default_action` применяется и при `wait` от модели**: если содержательного разбора по конкретной задаче не дано, единственное решение — правило по умолчанию; иначе при пассивном/недоступном LLM детерминированное лечение не срабатывало бы и упавшая фаза висела вечно (AC9).

13. **Тестовые швы** (`setTickLlmForTests`, `setTickClockForTests`, `setTickStartPhaseForTests`, `setTickActiveCountForTests`) — по паттерну VL-140; сбрасываются в `afterEach` (isolate:false).

Реализовано по doc-19 §5, §7–§10, §12–§14, §16–§17. Разделы `templates/prompts/personas/supervisor.md` описывают контракт JSON-ответа, запрет `backlog_finish_phase` и обход статусов (AC16/AC17).

## Проверки (фаза Code)

- `pnpm build` — успешно (tsc strict).
- `pnpm test` — **полный прогон, 1 + 118 = 119 тест-файлов, все passed, 0 failed** (без `--exclude`/`--skip`).
- `pnpm lint` — успешно (`node --check` обоих bin-скриптов).
- Новые тест-файлы: `src/core/supervisor-config.test.mjs` (17), `src/core/supervisor-state.test.mjs` (17), `src/web/supervisor-tick.test.mjs` (16), `src/web/supervisor-healing.test.mjs` (19), `src/web/supervisor-parallel.test.mjs` (16), `src/web/supervisor-limits.test.mjs` (6).

## Осталось на фазу Close

- Обновить doc-19 (расхождения из этого раздела) и CHANGELOG — по правилам фазы Code документы backlog/docs не правятся здесь.
- AC18 (end-to-end прогон на реальном наборе задач с grant'ом) в фазе Code не воспроизводился: механизм покрыт тестами (healing, авто-баг, wake gate, рестарт), но живой прогон с настоящим qwen требует ручной проверки.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 13:13
---
## Фаза 2 (Plan) выполнена
Тип задачи: **feature** (обычная задача, не эпик) — план записан в эту задачу, блокеров не создано: зависимости VL-268 и VL-269 уже в master.
### Что изучено
doc-19 (§5, §7–§17, §19–§21), `src/web/supervisor.ts` (план/старт/статус прогона, `loadSupervisorSettings`), `src/web/supervisor-grant.ts` (`SUPERVISOR_DIR`, `GRANTABLE_TOOLS`, `findActiveGrant`), `src/web/orchestrator.ts` (`startTaskPhase`, `getRun`, `countActiveRuns`, точка worktree 818), `src/web/chat-limits.ts` + `src/web/chat.ts:632-646` (лимиты роли), `src/web/personas.ts` (реестр ролей, сейчас 3 встроенных), `src/core/workflow.ts` (`loadWorkflows` — эталон терпимой валидации), `src/core/settings.ts`, `src/core/deps.ts`, `src/mcp/supervisor.ts#toolPhaseStatus` (эталон сбора диагностики), `src/agent/session.ts`/`repeat-tracker.ts`, `src/bot/auto-runner.ts` (цикл с `setInterval().unref()`), `src/web/server.ts` (точка запуска таймеров).
### Принятые архитектурные решения
1. **Модель в тике не вызывает инструменты**: тик собирает состояние кодом, модель возвращает один JSON-объект решения, применяет код. Это то, чего doc-19 не детализировал, и одновременно условие AC23/AC25 (фазы выбирает workflow, а не модель) и AC2/AC20 (wake gate и тесты без реального LLM).
2. Парсинг решения терпимый, невалидный ответ → детерминированный фолбэк «последовательный запуск по приоритету» + запись в heartbeat; тик не падает.
3. Живость — `pid` + собственный `phaseRunId` + `process.kill(pid,0)`, со сверкой сменившегося статуса задачи (компенсация потери `activeRuns` при рестарте).
4. Чтение секции `supervisor` переезжает в `src/core/supervisor-config.ts`, `loadSupervisorSettings` становится обёрткой (без дубля, lesson-37).
5. Авто-баг — без `dependencies` (иначе баг-задача оказалась бы заблокированной и не прошла бы `isReady`); связь с исходной задачей — в описании.
6. Таймер тика стартует только при активном grant (+ env `VIBELOG_SUPERVISOR_TICK=off`), глушится на `server.close` — продовая логика и защита тестов веб-API.
### Состав плана
- **Новые модули**: `src/core/supervisor-config.ts` (конфиг + `heal_rules` + самонастройка + `tuning.log`), `src/core/supervisor-state.ts` (`state.json` атомарно, `heartbeat.md`, живость по pid, `snapshotKey`, `collectTaskObservation`), `src/web/supervisor-tick.ts` (тик, wake gate, промпт, парсер решения, healing L1/L2, авто-баг, `planParallel`), `templates/prompts/personas/supervisor.md`.
- **Правки**: `src/web/supervisor.ts` (дефолт `max_parallel_phases` 2→3 по doc-19, обоснования групп, state-синхронизация), `src/web/chat.ts` (лимиты персоны supervisor), `src/web/personas.ts` (встроенная роль `supervisor`), `src/web/server.ts` (таймер + stop на close), `README.md`, `doc-19` (актуализация расхождений), `CHANGELOG.md`.
- **Тесты**: 6 новых файлов (config, state, healing, parallel, autobug, tick/лимиты/workflow-fallback) + обязательная правка существующих: `personas.test.mjs` (3→4 роли), `supervisor.test.mjs`, `mcp/supervisor-tools.test.mjs` (дефолт 2→3).
- **Порядок**: конфиг → state → обёртка/дефолты → тик+wake gate → healing+авто-баг → планировщик → персона/промпт/лимиты → таймер → (опц.) рефактор `toolPhaseStatus` → документация → E2E §21 doc-19.
- **Проверка**: `pnpm build` + `pnpm test:fast` по файлам, затем `pnpm lint && pnpm test` (полный прогон перед DoD); smoke `vibelog browser` без grant — `state.json` не появляется.
### Риски (в плане, раздел «Риски»)
Дефолт `max_parallel_phases` 2→3 против реализации VL-268 (нужно решение — править код или doc-19; в плане выбран doc-19=3); оживление 4-й встроенной роли ломает `personas.test.mjs`; таймер в `startWebServer` может дать open handles в чужих веб-тестах (снято условием «только при grant» + `unref`); хрупкость парсинга JSON-решения (митигируется фолбэком); переиспользование pid ОС (сверка `phaseRunId` + возраст); conservative вырождается в последовательный прогон без компонентных меток (ожидаемо, но требует меток в E2E).
---
author: @agent
created: 2026-11-01 13:47
---
Фаза code не удалась (код выхода 1): p -n×7, payload последнего запроса=759920 байт (макс 759920), usage={"input_tokens":12347491,"output_tokens":117059,"cache_read_input_tokens":11735808,"total_tokens":12464550,"reasoning_tokens":73969} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-01 13:57
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/supervisor-config.ts
- src/core/supervisor-state.ts
- src/web/supervisor.ts
- src/web/supervisor-tick.ts
- src/web/personas.ts
- src/web/chat.ts
- templates/prompts/personas/supervisor.md
- src/web/server.ts
- src/web/personas.test.mjs
- src/web/supervisor.test.mjs
- Продолжаю с тестами. Пишу тесты конфига и состояния:
Нашёл настоящую проблему: `validateHealRule` читает только snake_case `comment_template`, а правило в памяти — camelCase `commentTemplate`, из-за чего шаблон теряется при round-trip. Чиню:
Конфиг зелёный. Теперь тесты состояния:
Оба фундаменталь…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 605 с, payload 951396 байт_
---
author: @agent
created: 2026-11-01 14:01
---
## Фаза 3 (Code) выполнена
Реализован супервизор по doc-19 §5, §7–§10, §12–§14, §16–§17.
### Новые модули
- **`src/core/supervisor-config.ts`** — секция `supervisor` (дефолты doc-19 §7: `tick_seconds` 60, `max_parallel_phases` 3, `heal_attempts` 2, `allow_self_tuning` false, `parallel_mode` conservative, лимиты 30/600 с), `heal_rules` + `default_action` с терпимой валидацией (паттерн `loadWorkflows`), самонастройка `applySelfTuning` с `tuning.log` и защищёнными полями.
- **`src/core/supervisor-state.ts`** — `state.json` (атомарная запись temp + rename), `heartbeat.md`, живость по `pid` + `phaseRunId` (`process.kill(pid, 0)`), `snapshotKey` для wake gate, `collectTaskObservation`.
- **`src/web/supervisor-tick.ts`** — тик (сбор состояния → heartbeat/state → wake gate → модель → применение), healing L1/L2, `planParallel`, `createAutoBug`, `parseTickDecision`, `buildTickPrompt`, таймер с `unref` и снятием на `server.close`.
- **`templates/prompts/personas/supervisor.md`** — промпт роли: планирование прогона, обоснование групп, порядок диагностики, авто-баг, запрет подделки прогресса, явный запрет `backlog_finish_phase` и смены статусов в обход фаз.
### Изменения
`src/web/supervisor.ts` (дефолт 2→3 из единого источника, `groupsRationale`/`parallelMode` в плане, синхронизация state при старте прогона), `src/web/chat.ts` (лимиты персоны supervisor), `src/web/personas.ts` (4-я встроенная роль), `src/web/server.ts` (таймер тика), `README.md` (раздел супервизора).
### Проверки
- `pnpm build` — успешно (tsc strict).
- **`pnpm test` — ПОЛНЫЙ прогон: 118 + 1 = 119 тест-файлов, все passed, 0 failed** (без `--exclude`/`--skip`).
- `pnpm lint` — успешно.
- Новые тест-файлы (91 тест): `supervisor-config` 17, `supervisor-state` 17, `supervisor-tick` 16, `supervisor-healing` 19, `supervisor-parallel` 16, `supervisor-limits` 6.
### Найденные и исправленные баги в ходе тестов
1. `validateHealRule` не читал camelCase `commentTemplate` — шаблон терялся при round-trip самонастройки.
2. Тик читал `state.tasks` по неканоническому ключу (нижний регистр против `VL-N`) — состояние задачи «терялось» каждый тик.
3. `default_action` не применялся, когда модель ответила `wait` — детерминированное лечение умирало при пассивном LLM.
4. Причина падения перезаписывалась текстом «процесс не найден», из-за чего правила `fail_reason_contains` (payload-limit/wall-timeout) не срабатывали — теперь сохраняется прежний `lastError`.
5. Завершение сервисной фазы `comment` считалось «нет прогресса» и съедало лечебную попытку — теперь задача возвращается в `pending`.
6. Бюджет промпта не включал пометку об усечении — «усечённый» промпт был длиннее лимита.
### Коммит
`de8ed99` — feat: VL-270 — тик супервизора, healing loop, планировщик параллельности, промпт роли.
### Что осталось (не отмечено)
- **AC18** — end-to-end прогон на живом наборе задач с реальным qwen в фазе Code не воспроизводился (механизм покрыт тестами: healing, авто-баг, wake gate, рестарт), нужна ручная проверка.
- **AC21** — `doc-19` не актуализирован: по правилам фазы Code документы `backlog/docs` и CHANGELOG здесь не правятся, актуализация вынесена в Close. `README` обновлён, `build`/`lint` проходят.
- Все расхождения с doc-19 и принятые решения (модель не вызывает инструменты, контракт JSON-решения, авто-баг без `dependencies`, расширение `state.json`, дефолт 3 против 2) — в Implementation Notes задачи.
---
author: @agent
created: 2026-11-01 14:18
---
## Фаза Close выполнена
**Ветка:** `vb/vl-270` (1 коммит, `de8ed99`) слита в master через `git merge --no-ff` → merge-коммит; конфликтов не было. Worktree `.vibelog/worktrees/vl-270` удалена (`git worktree remove` отказался из-за двух untracked симлинков `node_modules`/`backlog/references/data`, ссылающихся на главный репозиторий — удалено `--force`, данные не потеряны), ветка `vb/vl-270` удалена (`git branch -d`).
**Проверки после merge (порядок обязательный):**
- `pnpm build` — успешно (tsc strict, dist пересобран).
- Ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD`: 119 тест-файлов, 2153 passed, 4 skipped — зелёный.
- **Полный `pnpm test`** (build + два прогона vitest, включая изолированный `src/web/static.test.mjs`) — зелёный, 0 failed. Повторных полных прогонов не было.
- `pnpm lint` — успешно.
**Документация:**
- README: добавлен раздел «Супервизор: тик, лечение и планировщик (VL-270)» (тик/wake gate/файлы состояния/heal_rules/режимы параллельности/самонастройка/`modified_files` не используется), в разделе персон появилась 4-я встроенная роль `supervisor` с описанием промпта и лимитов.
- `doc-19` актуализирован (AC21/AC22): добавлен §22 «Расхождения реализации с документом» (10 пунктов), в §5 — контракт JSON-решения модели и терпимый парсинг с фолбэком, в §9 — раскладка модулей (`supervisor-config`/`supervisor-state`/`supervisor-tick`/`supervisor.ts`/`supervisor-grant`), в §10 — расширенные поля `state.json` (`snapshotHash`, `tuning`, `statusAtStart`, `ruleChain`, `frozen`, `wakeAt`), в §7 — диапазоны валидации, в §12 — AND/OR-семантика `when` и `comment_template`, в §13 — авто-баг без `dependencies`, в §16 — отклонение патчей защищённых полей, в §17 — лимиты персоны; глосса «код не написан» заменён на статус реализации.
- CHANGELOG: запись о VL-270 в Unreleased.
- Docs-коммит: `4025736`.
**DoD:**
1. ✅ Тесты проходят — полный `pnpm test` зелёный (119 файлов, 2153 passed, 4 skipped; merge-интерференция проверена).
2. ✅ Документация обновлена — README, doc-19 (через `document_update`), CHANGELOG; docs-коммит `4025736`.
3. ✅ Нет регрессий — тесты VL-265/268 (`personas`, `supervisor`, `supervisor-tools`), реестр персон и лимиты зелёные; полный прогон после merge чистый.
**Уроки:** lesson-127 (состояние долгоживущего цикла — только на диске, атомарная запись temp+rename), lesson-128 (живость фоновой фазы по собственному `phaseRunId` + `process.kill(pid, 0)`); связаны с задачей.
**Не отмечено в AC (вне фазы Close, зафиксировано честно):**
- **AC18** — end-to-end прогон на живом наборе задач с реальной моделью не воспроизводился (механизм покрыт стаб-тестами: healing, авто-баг, wake gate, рестарт); ручная проверка остаётся за пользователем.
- Коммит lessons: `5c55b48`; merge-коммит — `vb/vl-270 → master`.
---
<!-- COMMENTS:END -->