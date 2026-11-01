---
id: VL-270
title: 'Супервизор (2/2): тик-механизм, healing loop, планировщик параллельности, промпт роли'
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-30 21:37'
updated_date: '2026-10-30 22:38'
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
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
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
- [ ] #1 Реализован тик-механизм в процессе vibelog browser: таймер с периодом tick_seconds (дефолт 60) из .vibelog/settings.json, переживающий отсутствие изменений; тик не хранит состояния в памяти, всё читается и пишется через файлы
- [ ] #2 Реализован wake gate: если с прошлого тика состояние не изменилось (нет смены статусов, нет падений, нет новых метрик), модель НЕ вызывается — тик завершается без LLM-запроса и без затрат токенов; проверяется счётчиком вызовов модели в тесте
- [ ] #3 Реализована сборка промпта тика: heartbeat.md (срез состояния) + конфиг правил лечения + активный grant + история прошлого решения (аналог context_from); промпт не превышает разумного размера и не содержит сырых логов целиком
- [ ] #4 Реализованы state.json и heartbeat.md по doc-19 §10: fields runId, mode, tick, lastDecision (tick/action/ruleId/taskId/reason), tasks с phase/status/phaseRunId/pid/startedAt/attempt/healAttempts/groupId/lastError/lastRepeatStats; запись после каждого тика атомарна (temp + rename)
- [ ] #5 Живость фазы определяется по pid + phaseRunId (process.kill(pid, 0)): после рестарта процесса зависшая фаза распознаётся как упавшая и попадает в лечение, а не считается вечно идущей
- [ ] #6 Реализован healing уровня 1: чтение heal_rules из .vibelog/supervisor/settings.json, упорядоченное сопоставление по when (repeat_share_min, repeat_calls_min, fail_reason_contains, status_unchanged), первое совпадение выигрывает, id правила попадает в state.json и отчёт; actions retry / comment_and_retry / retry_once_then_bug / bug / stop
- [ ] #7 comment_template поддерживает подстановки {top_repeats}, {fail_reason}, {task_id}, {attempt}; директива уходит через startTaskPhase(..., 'comment', { comment }) перед рестартом фазы
- [ ] #8 Битое или невалидное правило heal_rules не роняет тик — правило выпадает с предупреждением в heartbeat/лог (паттерн loadWorkflows); невалидный action или неизвестный when-ключ тоже не ломают цикл
- [ ] #9 Реализован default_action при отсутствии совпавших правил; heal_attempts (дефолт 2) ограничивает число лечебных попыток на фазу, при исчерпании — авто-баг и стоп по этой задаче
- [ ] #10 Реализован healing уровня 2: модель внутри тика разбирает содержательные ошибки (упавшие тесты, ошибочный план) на основе logTail, repeat_stats, fail_reason; отдельная фаза analyze для лечения не вызывается
- [ ] #11 Реализовано авто-создание баг-задачи в статусе Spec с детерминированным описанием: fail_reason + фрагмент logTail + ID сессии + цепочка сработавших правил; метки auto-bug и имя фазы; связь с исходной задачей
- [ ] #12 Реализован планировщик параллельности: группы до max_parallel_phases; dependencies/blocks — жёсткий запрет параллели независимо от режима; режимы conservative (обязательное обоснование группы по labels/описанию, обоснование пишется в heartbeat.md, не смог обосновать — последовательно) и aggressive (без обоснования)
- [ ] #13 Параллельность НЕ опирается на modified_files (поле заполняется только фазой code, а worktree создаётся на plan/do — src/web/orchestrator.ts:818); критерий — метаданные задачи (title, description, labels, type, dependencies)
- [ ] #14 Реализована самонастройка: при allow_self_tuning=true модель может править .vibelog/supervisor/settings.json (heal_rules, comment_template); изменения пишутся в tuning.log (время, было, стало, причина); защищённые поля max_parallel_phases, heal_attempts, allow_self_tuning, parallel_mode моделью не правятся — проверяется тестом
- [ ] #15 Лимиты роли supervisor применяются: при активной персоне supervisor ход чата использует supervisor.limits.chat_max_iterations и chat_max_wall_time (механизм из VL-269), для остальных ролей значения не меняются
- [ ] #16 Написан промпт роли templates/prompts/personas/supervisor.md: планирование прогона, обоснование групп в conservative, порядок диагностики падений (сначала heal_rules, потом решение модели), правила авто-бага, запрет подделки прогресса, честное описание доступных инструментов; переопределение проекта — .vibelog/prompts/personas/supervisor.md
- [ ] #17 Промпт не упоминает backlog_finish_phase как доступный и явно запрещает попытки менять статусы в обход фаз
- [ ] #18 Проверено end-to-end на наборе задач: прогон стартует по grant, фазы идут группами в пределах лимита, при искусственном зацикливании срабатывает правило repeat-loop, фаза получает комментарий и продолжает работу, при исчерпании лечения создаётся баг-задача в Spec
- [ ] #19 Рестарт процесса vibelog browser посреди прогона не ломает его: после перезапуска следующий тик читает state.json, распознаёт зависшую фазу и продолжает лечение
- [ ] #20 Тесты: supervisor-config (валидация heal_rules, дефолты, битые правила), supervisor-state (state/heartbeat/атомарность, живость по pid), healing (все actions, порядок правил, подстановки шаблона, исчерпание heal_attempts), планировщик (dependencies-запрет, лимит групп, conservative без обоснования → последовательно), авто-баг (формат описания), wake gate (модель не вызывается при отсутствии изменений), лимиты роли
- [ ] #21 Документация: README (раздел супервизора — запуск, состояние, heartbeat, правила лечения, режимы параллельности), doc-19 актуализирован при расхождениях, шаблон промпта описан в разделе personas; npm run build и lint проходят
- [ ] #22 Реализация соответствует doc-19 §5, §7–§10, §12–§14, §16–§17; расхождения с документом зафиксированы в Implementation Notes
- [ ] #23 Супервизор не назначает фазы сам: следующая фаза задачи всегда определяется воркфлоу (getWorkflowForTask → getAvailablePhases → isPhaseAllowed, src/core/workflow.ts); переставить или пропустить шаг воркфлоу невозможно, ветвление (reject, фикс-цикл Review → code) соблюдается — reject берётся только вручную, как в auto-runner (pickAutoPhase)
- [ ] #24 Задачи с разными воркфлоу корректно идут в одном прогоне: у каждой своя следующая фаза и своё число шагов до close; лимит max_parallel_phases считается по числу одновременно работающих фаз, а не по числу задач
- [ ] #25 Создание worktree не является решением супервизора: изоляция появляется на первой «кодовой» фазе воркфлоу (plan в дефолтном, do в simple — src/web/orchestrator.ts:818); если в воркфлоу такой фазы нет (epic), задача идёт в главном дереве, и это не считается ошибкой
- [ ] #26 Отсутствующий или невалидный воркфлоу задачи не роняет прогон — используется DEFAULT_WORKFLOW (fallback в loadWorkflows), поведение покрыто тестом
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

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
<!-- SECTION:NOTES:END -->