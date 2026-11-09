---
id: VL-347
title: 'Веб: лента активности (#/activity) — единый лог работ с переходами на задачи, поле source в billing и причина падения фазы в вебе'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-05 19:14'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - web
  - activity
  - billing
  - observability
  - feature
dependencies: []
milestone: v1.13
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/activity.ts
  - src/core/activity.test.mjs
  - src/core/billing.ts
  - src/web/orchestrator.ts
  - src/web/api.ts
  - src/web/activity-api.test.mjs
  - src/web/supervisor.ts
  - src/agent/cli.ts
  - src/bot/handlers.ts
  - src/bot/auto-runner.ts
  - web/src/App.tsx
  - web/src/lib/use-hash-route.ts
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/activity/api.ts
  - web/src/components/activity/activity-page.tsx
  - web/src/components/activity/activity-item.tsx
  - web/dist/index.html
  - web/dist/assets/index-ByR3A-aC.js
  - web/dist/assets/index-CK8YopPe.css
lessons:
  - lesson-231
token_usage:
  input: 22486443
  output: 92088
  cache: 22047744
  total: 22578531
  requests: 224
  duration_ms: 1378946
  reasoning: 24899
  by_phase:
    code:
      input: 21333414
      output: 86294
      cache: 20930048
      requests: 199
    close:
      input: 1153029
      output: 5794
      cache: 1117696
      requests: 25
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Запрос пользователя: не хватает раздела «Активность» (как в Jira). Работа идёт и в боте, и в вебе — теряется, что и когда запускалось и чем закончилось. Нужен красивый лог всех работ с переходами на задачи и другие упомянутые сущности.

**В планах этого не было.** ROADMAP v1.13 содержит «Аналитику» (`#/analytics` — агрегаты: задачи по статусам, создано/закрыто, токены по фазам), doc-22 в «Пробелах в веб-UI» перечисляет Milestones/Decisions/Drafts/Experiments. Ленты событий нет нигде.

**Данные уже есть, их не собирают в одно место:**

| Источник | Что даёт | Модуль |
|---|---|---|
| `.vibelog/billing/<TASK>.json` | append-only журнал ранов: `sessionId`, `phase`, `startedAt`, `finishedAt`, `durationMs`, `usage`, `model`, `agent`, `fallback` | `src/core/billing.ts` |
| `.vibelog/agent-sessions/*.meta.json` | `runs[]` (VL-259), `run_progress` (VL-254), `last_run.is_error` (VL-253) | `src/agent/session.ts` |
| `.vibelog/auto-queue.json` | pending/running/done/failed + причины | `src/core/auto-queue.ts` |
| `.vibelog/supervisor/grants/*.json` | прогоны супервизора: задачи, срок, отзыв | `src/web/supervisor-grant.ts` |
| Комментарии задач | `author` + `created` | frontmatter задач |
| `getRun`/`listRuns` | `aborted`, `abortedReason`, `phaseResult` (VL-289) | `src/web/orchestrator.ts` |

**Пробел №1 — нет источника запуска.** В `BillingSession` нет поля «откуда запущено» (бот / веб / CLI / автоочередь / супервизор). Без него лента не ответит на главный вопрос пользователя «я работаю и в боте, и в вебе — что откуда запускалось». Нужно добавить `source` и проставлять при записи.

**Пробел №2 — причина падения не видна в вебе.** Бот присылает причину, веб — нет. Причина уже собирается: `run_progress.reason` + `run_progress.text` (VL-254/VL-274: `wall-time` / `max-requests` / `idle` / `other` + блок «что сделано / что осталось»), `abortedReason` в `PhaseRun` (VL-289). Но `run_progress` пишется в мету сессии и **комментарием в задачу** — а если комментарий не записался (обрыв до `addComment`, ошибка записи), в вебе причина не видна вообще. Лента должна читать мету напрямую, а не полагаться на комментарий.

**Цель:** страница `#/activity` — обратная хронология событий с фильтрами и переходами, плюс два бэкенд-пробела (source, причина падения).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новый модуль `src/core/activity.ts` собирает единый список событий из существующих источников (billing, meta.runs, комментарии задач, автоочередь, grant супервизора) — read-only, без записи файлов
- [x] #2 Событие типизировано: `phase_started` | `phase_finished` | `phase_failed` | `task_created` | `task_status_changed` | `task_closed` | `comment` | `queue_started` | `queue_stopped` | `queue_failed` | `grant_started` | `grant_revoked`
- [x] #3 Каждое событие несёт: `at` (ISO), `type`, `taskId`, `phase?`, `source` (bot|web|cli|queue|supervisor|unknown), `summary` (одна строка), `details` (объект для раскрытия), `links` (taskId/refId/docId/lessonId, на которые можно перейти)
- [x] #4 `BillingSession` получает поле `source?: 'bot' | 'web' | 'cli' | 'queue' | 'supervisor'`; оркестратор/бот/CLI проставляют его при записи (старые записи без поля читаются как `unknown`, миграции нет)
- [x] #5 Причина падения фазы видна в вебе: `phase_failed` берёт `run_progress.reason` + `run_progress.text` из меты сессии (VL-254/VL-274) и `abortedReason` из `getRun` (VL-289); если комментарий в задачу не записан — причина всё равно показывается из меты
- [x] #6 `GET /api/activity?since=&until=&type=&taskId=&source=&limit=&offset=` отдаёт `{events, total, hasMore}`; параметры валидируются, неизвестный `type` → 400
- [x] #7 Страница `#/activity` в сайдбаре (пункт «Активность», иконка `Activity` из lucide): обратная хронология, группировка по дням («Сегодня», «Вчера», дата)
- [x] #8 Каждая запись кликабельна: переход на `#/tasks` с открытой модалкой задачи (или `#/reference/<id>`, `#/document/<id>`, `#/lesson/<id>` — по типу ссылки)
- [x] #9 Фильтры в UI: период (сегодня / 7 дней / 30 дней / всё), тип события (мультивыбор), источник (бот/веб/CLI/очередь/супервизор), поиск по ID задачи
- [x] #10 Пагинация или «показать ещё» — лента не грузит все события сразу (на корпусе 300+ задач и сотнях ранов это тысячи записей)
- [x] #11 Пустое состояние: «Событий за период нет» с подсказкой расширить период
- [x] #12 События `phase_failed` визуально выделены (destructive-акцент) и содержат причину текстом, а не только иконку
- [x] #13 Тесты: `src/core/activity.test.mjs` (сборка из фикстур billing/meta/комментариев, сортировка, фильтры, отсутствие источника → `unknown`, битый файл не роняет сборку), `src/web/activity-api.test.mjs` (валидация параметров, пагинация, 400)
- [x] #14 Ручная проверка через chrome-devtools: лента отражает реальные раны этого проекта, переход по записи открывает задачу, консоль без ошибок (lesson-16)
- [x] #15 `web/dist` пересобран и закоммичен
- [ ] #16 CHANGELOG.md обновлён, doc-6 (руководство пользователя) дополнен разделом «Активность», doc-7 — если появится CLI-поверхность
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

**Бэкенд:**
- `src/core/activity.ts` (новый) — сборка событий.
- `src/core/billing.ts` — поле `source` в `BillingSession`.
- `src/web/orchestrator.ts` — проставить `source` при записи billing.
- `src/bot/` — проставить `source: 'bot'` (точка запуска фаз из бота).
- `src/agent/cli.ts` — `source: 'cli'` для прямых запусков.
- `src/core/auto-queue.ts` — `source: 'queue'` для запусков из очереди.
- `src/web/api.ts` — `GET /api/activity`.

**Фронт:**
- `web/src/components/activity/activity-page.tsx`, `activity-item.tsx`, `api.ts` (новые).
- `web/src/App.tsx` — роут `activity`.
- `web/src/lib/use-hash-route.ts` — маршрут.
- `web/src/components/layout/app-sidebar.tsx` — пункт «Активность».
- `web/dist` — пересобрать.

**Документация:** `doc-6`, `CHANGELOG.md`.

## Шаг 1. Поле `source` в billing

`src/core/billing.ts`, `BillingSession`:

```ts
/** Откуда запущена фаза (VL-347): бот, веб, CLI, автоочередь, супервизор. */
source?: 'bot' | 'web' | 'cli' | 'queue' | 'supervisor';
```

Проставлять в точках записи:
- `src/web/orchestrator.ts` — `startTaskPhase` получает параметр `source` (по умолчанию `'web'` для HTTP-роутов, `'bot'` из бота, `'queue'` из автоочереди, `'supervisor'` из тика);
- `src/agent/cli.ts` — `'cli'` при прямом запуске (нет `VIBELOG_RUN_SOURCE` в env);
- env-маркер `VIBELOG_RUN_SOURCE` — самый простой способ прокинуть через spawn, не меняя сигнатуры всех вызовов. Оркестратор кладёт его в `spawnEnv` рядом с `VIBELOG_RUN_PHASE`/`VIBELOG_RUN_STARTED_AT` (VL-259).

Старые записи без поля → `unknown` при чтении, миграции нет.

## Шаг 2. `src/core/activity.ts`

```ts
export type ActivityType =
  | 'phase_started' | 'phase_finished' | 'phase_failed'
  | 'task_created' | 'task_status_changed' | 'task_closed'
  | 'comment'
  | 'queue_started' | 'queue_stopped' | 'queue_failed'
  | 'grant_started' | 'grant_revoked';

export interface ActivityEvent {
  at: string;                 // ISO
  type: ActivityType;
  taskId?: string;
  phase?: string;
  source?: 'bot' | 'web' | 'cli' | 'queue' | 'supervisor' | 'unknown';
  summary: string;            // одна строка для ленты
  details?: Record<string, unknown>;  // раскрытие: usage, duration, reason, commit
  links?: { kind: 'task' | 'reference' | 'document' | 'lesson'; id: string }[];
}

export interface ActivityQuery {
  since?: string; until?: string;
  types?: ActivityType[];
  taskId?: string;
  source?: string;
  limit?: number; offset?: number;
}

export function collectActivity(cwd: string, query: ActivityQuery): { events: ActivityEvent[]; total: number };
```

Правила:
- **Источники читаются по одному разу**, каждый в `try/catch` — битый файл не роняет ленту (как в `collectStatus` VL-341);
- `phase_started`/`phase_finished` — из `billing` (запись = завершённый ран; `startedAt`/`finishedAt`); `phase_started` без парной `finished` (ран идёт) — из `getRun`/`listRuns`;
- `phase_failed` — `billing.fallback === true` ИЛИ `meta.last_run.is_error === true` ИЛИ `getRun().aborted === true`; **причина** — `meta.run_progress.reason` + `run_progress.text` (VL-254), `abortedReason` (VL-289); если `run_progress` нет — `summary` = «фаза упала (причина не записана)»;
- `task_created`/`task_status_changed`/`task_closed` — из `created_date`/`updated_date` задач; `status_changed` без истории статусов восстанавливается приблизительно (по `updated_date` + текущему статусу) — **честно помечать** `details.approximate: true`, не выдавать за точное;
- `comment` — из `task.comments` (`author`, `created`, превью 200 символов);
- `queue_*`/`grant_*` — из `auto-queue.json` и `grants/*.json`;
- сортировка по `at` убыв., `limit`/`offset` после сортировки, `total` — до среза.

## Шаг 3. `GET /api/activity`

`src/web/api.ts`, после `/api/config`:

```ts
if (method === 'GET' && url === '/api/activity') { ... }
```

Параметры из `queryString` (уже передаётся в `handleApi` с VL-185): `since`, `until`, `type` (повторяемый или через запятую), `taskId`, `source`, `limit` (дефолт 50, максимум 200), `offset`. Валидация: неизвестный `type` → 400 со списком допустимых; невалидная дата → 400. Ответ `{events, total, hasMore}`.

## Шаг 4. Страница `#/activity`

- `web/src/lib/use-hash-route.ts` — добавить `'activity'` в `Route`.
- `web/src/App.tsx` — `route === 'activity' ? <ActivityPage /> : ...`.
- `web/src/components/layout/app-sidebar.tsx` — пункт в группе «Основное», иконка `Activity` из lucide, `activeWhen: ['activity']`.

Композиция (по образцу `dashboard/profile`, VL-346 — та же логика табов/скролла):
- шапка: заголовок «Активность» + фильтры в одну строку (период — `Select`, тип — `DropdownMenu` с чекбоксами, источник — `Select`, поиск по ID — `Input`);
- лента: группировка по дням (`Сегодня` / `Вчера` / `12 ноября`), внутри — записи;
- запись: иконка типа + время (`HH:MM`) + `summary` + бейдж источника + бейдж фазы; `phase_failed` — `text-destructive` + причина в раскрытии;
- клик → переход: `#/tasks` с открытием модалки задачи (механизм `QUICK_CREATE_EVENT`/`setQuickCreatePending` из `web/src/lib/quick-create.ts` — расширить на «открыть задачу по id»), либо `#/reference/<id>` и т.д.;
- «Показать ещё» — догрузка по `offset`.

## Шаг 5. Тесты

`src/core/activity.test.mjs` (mkdtemp-фикстура, lesson-104):
1. billing с 3 записями → 3 события `phase_finished`, сортировка по времени;
2. `fallback: true` → `phase_failed` с причиной из `run_progress`;
3. `run_progress` отсутствует → `phase_failed` с «причина не записана»;
4. запись без `source` → `unknown`;
5. фильтр по `type`/`taskId`/`source`/периоду;
6. битый `billing/*.json` → событие пропущено, остальные на месте;
7. `limit`/`offset`/`total`.

`src/web/activity-api.test.mjs`: валидация параметров, 400 на неизвестный тип, пагинация.

## Шаг 6. Проверка

- `pnpm build && pnpm test`, `pnpm --dir web build`, `web/dist` закоммитить.
- chrome-devtools: лента показывает реальные раны этого проекта, переход по записи открывает задачу, фильтры работают, консоль без ошибок (lesson-16).

## Риски

- **Объём данных.** На 300+ задачах и сотнях ранов `collectActivity` читает все billing-файлы и все меты — это сотни файлов на запрос. Для v1 приемлемо (лента не в горячем пути), но притормозить: `limit` по умолчанию 50, чтение только файлов с mtime в периоде (если `since` задан). Кэш — отдельная задача (см. doc-22 §4.1).
- **`task_status_changed` приблизителен.** Истории статусов в задаче нет — только `updated_date`. Не выдавать за точное, помечать `approximate: true`.
- **`source` для старых записей.** `unknown` — норма, не ошибка; в UI показывать нейтрально.
- **Дублирование с `#/analytics`** (ROADMAP v1.13). Активность — лента событий, аналитика — агрегаты. Не сливать; при реализации аналитики переиспользовать `collectActivity` как источник.
- **`web/dist` в git** — не забыть пересобрать.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 21:06
---
Фаза code не удалась (код выхода 1): локировок=1, payload последнего запроса=542832 байт (макс 542832), usage={"input_tokens":7283749,"output_tokens":36562,"cache_read_input_tokens":7160832,"total_tokens":7320311,"reasoning_tokens":9343} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 10:07
---
Фаза 3 (Code) выполнена. Коммит 27fb7bc.
**Бэкенд**
- `src/core/activity.ts` (новый): `collectActivity(cwd, query)` — read-only сборка событий из billing, мет сессий, задач, автоочереди и grant-ов супервизора. Каждый источник в собственном try/catch (битый файл пропускается), предфильтр по mtime при заданном `since`, сортировка по `at` убыв., `limit`/`offset` после сортировки, `total` до среза. 12 типов событий (`ACTIVITY_TYPES`), `ActivityEvent` с `at/type/taskId/phase/source/summary/details/links`.
- `src/core/billing.ts`: `BillingSession.source?: BillingSource`, `RUN_SOURCE_ENV = 'VIBELOG_RUN_SOURCE'`, `BILLING_SOURCES`, `parseRunSource()` (кривое значение → undefined, учёт не теряется).
- `src/web/orchestrator.ts`: `startTaskPhase`/`startPhase`/`spawnQwenRun` получили параметр `source` (дефолт `'web'`), значение уходит в `spawnEnv` рядом с `VIBELOG_RUN_PHASE`/`VIBELOG_RUN_STARTED_AT` и пишется в обе записи billing (qwen и vb-fallback); авто-resume после high-risk наследует источник исходного рана.
- `src/agent/cli.ts`: `source` из env, фолбэк `'cli'` (прямой запуск).
- `src/bot/handlers.ts` (6 точек), `src/bot/auto-runner.ts`, `src/web/supervisor.ts`: `source: 'bot' | 'queue' | 'supervisor'`.
- `src/web/api.ts`: `GET /api/activity?since=&until=&type=&taskId=&source=&limit=&offset=` → `{events, total, hasMore}`; неизвестный `type` → 400 со списком допустимых, невалидная дата/limit/offset → 400, limit обрезается до 200.
**Причина падения (AC5)** берётся из меты сессии (`run_progress.reason` + `run_progress.text`), а не из комментария задачи: если комментарий не записался, причина всё равно видна. Нет `run_progress` → «причина не записана». `last_run.is_error` и `fallback: true` тоже дают `phase_failed`.
**Фронт**
- `web/src/components/activity/{api.ts,activity-page.tsx,activity-item.tsx}` (новые): обратная хронология с группировкой по дням («Сегодня»/«Вчера»/дата), фильтры (период 4 варианта, тип — мультивыбор DropdownMenu, источник — Select, поиск по ID задачи), «Показать ещё» по offset, пустое состояние с подсказкой расширить период, `phase_failed` — destructive-акцент + причина текстом, клик по записи → модалка задачи (`requestOpenTask`) либо `#/reference|document|lesson/<id>`.
- `web/src/lib/use-hash-route.ts` (Route `'activity'`), `web/src/App.tsx` (роут), `web/src/components/layout/app-sidebar.tsx` (пункт «Активность», иконка `Activity` из lucide).
- `web/dist` пересобран и закоммичен.
**Проверки**
- `pnpm build` — чисто (strict tsc).
- `pnpm test` — полный прогон: 184 файла, 3455 passed, 4 skipped, 0 failed. Исключённых/пропущенных файлов нет.
- `pnpm --dir web build` — собрано (потребовался `pnpm install` в web/ — node_modules отсутствовали в worktree).
- chrome-devtools (lesson-16): страница `#/activity` открывается, лента показывает реальные события проекта (1593 события за 7 дней, 50 на странице), фильтр по типу «Фаза упала» работает (10 записей, destructive-акцент, причина текстом), клик по записи открывает модалку задачи (VL-345), «Показать ещё» догружает (50 → 100), пустое состояние при несуществующем ID, консоль без ошибок и предупреждений.
**Что осталось (не входит в Code)**
- AC16: `CHANGELOG.md` и doc-6 (раздел «Активность») — по правилам фазы документация пишется в Close.
- `task_status_changed` приблизителен (`details.approximate: true`) — истории статусов в задаче нет, это осознанное ограничение из плана.
- `queue_started`/`queue_stopped` восстанавливаются по `started_at`/`running` элементов очереди (в файле нет истории запусков) — тоже помечено `approximate: true`.
---
author: @agent
created: 2026-11-07 11:55
---
Фаза Close выполнена. Ветка vb/vl-347 слита в master (1 коммит, merge 9e5a460), worktree удалена (force — только untracked симлинк backlog/references/data), ветка vb/vl-347 удалена.
**Проверки после merge**
- `pnpm build` — чисто (strict tsc).
- Ранний точечный фильтр: `src/core/activity.test.mjs` (14) + `src/web/activity-api.test.mjs` (9) — 23 passed.
- Полный прогон `vitest run`: 185 файлов, 3463 passed, 4 skipped, 0 failed. Исключённых файлов нет, повторных прогонов не было.
**Документация (DoD 2, AC16)**
- `CHANGELOG.md` — запись в Unreleased/Добавлено (VL-347): ядро `collectActivity`, поле `source` в billing + `VIBELOG_RUN_SOURCE`, причина падения из меты сессии, `GET /api/activity`, страница `#/activity`, тесты.
- `backlog/docs/doc-6` §10 — новый подраздел «Активность — единый лог работ (VL-347)»: источники, типы событий, `source`, причина падения, фильтры, переходы, честные ограничения (`approximate`).
- doc-7 не менялся: CLI-поверхности задача не добавляет (только HTTP API и веб).
- Коммит документации: 3cb1f07.
**Lessons**
- Создан lesson-231 (сборка фронта в worktree требует `pnpm install` внутри `web/`), связан с VL-347; коммит 34607c2.
**DoD**: 1 «Тесты проходят» — выполнен (полный прогон зелёный); 2 «Документация обновлена» — выполнен (CHANGELOG + doc-6); 3 «Нет регрессий» — выполнен (полный прогон без падений, merge без конфликтов).
---
<!-- COMMENTS:END -->