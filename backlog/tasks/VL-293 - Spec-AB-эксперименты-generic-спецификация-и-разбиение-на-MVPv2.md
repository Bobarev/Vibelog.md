---
id: VL-293
title: 'Spec: A/B-эксперименты (generic) — спецификация и разбиение на MVP/v2'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 01:35'
updated_date: '2026-11-02 02:17'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - README.md
lessons:
  - lesson-164
token_usage:
  input: 7910475
  output: 70963
  cache: 7709696
  total: 7981438
  requests: 138
  duration_ms: 651091
  reasoning: 26485
  by_phase:
    plan:
      input: 2491943
      output: 25636
      cache: 2423296
      requests: 45
    code:
      input: 4097081
      output: 39692
      cache: 3997696
      requests: 61
    close:
      input: 1321451
      output: 5635
      cache: 1288704
      requests: 32
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Нужна фича A/B-тестирования промптов фаз и моделей. Ключевая рамка: Vibelog — инструмент для других проектов, поэтому эксперименты — **generic A/B-механизм**, не только тестирование промптов. Промпты + judge + pricing — один опциональный AI-профиль; не-AI проекты (сайт без LLM) используют те же эксперименты для фич/UX/производительности.

Эксперименты — артефакт проекта в git (backlog/experiments/), по аналогии с docs/lessons/references/decisions/milestones.

## Цель задачи

Это **задача на спецификацию**, не на реализацию. Результат — документ doc-20, в котором зафиксированы структура, форматы, CLI, ограничения и **разбиение на задачи реализации** с явными версиями **фичи** (MVP / v2).

Важное уточнение к терминологии: MVP/v2 здесь — версии именно этой фичи, а не релиза Vibelog и не вехи v1.x. В документе это должно быть сказано отдельной секцией.

## Входные данные (из диалога, согласовано)

Структура:
```
backlog/experiments/
├── exp-<id>.md
├── datasets/<name>.jsonl
├── prompts/<name>.md
└── exp-<id>/
    ├── datasets/<name>.jsonl      # частные — переопределяют общие
    ├── prompts/<name>.md
    └── run-<N>/
        ├── meta.json
        ├── results.jsonl
        └── report.md
```

Решения по 10 открытым вопросам (приняты в обсуждении):
1. `expected_ac` — имя оставить, трактовать как «ожидаемый результат» универсально; при финализации схемы рассмотреть синоним `expected`, канон — `expected_ac`. Добавить в dataset опциональный `input`/`payload` — произвольный вход для manual runner (у не-AI проектов иначе некуда положить вход).
2. Отчёт: mean/median/дельта/win-rate/custom/errors + обязательно `n` (валидных строк) и `dropped` (ошибки и null-score, исключённые из средних).
3. CLI: основной синтаксис — `experiment run <exp-id>` (новый прогон), `create` — флагами. Дополнительно `--variant-a '<json>'` как альтернатива набору флагов. `run` обязан иметь `--dry-run` (число задач × вариантов + оценка стоимости).
4. Статусы `draft|running|completed|failed` — да, плюс правило «stale running» (running в meta без живого pid → предложить `--recover` → failed + частичные results).
5. `judge:` в frontmatter — схема сразу, реализация — вторым шагом MVP (путь score=null нужен всё равно).
6. Run неизменяем (append-only, как billing): `run` создаёт run-(N+1), `--run N` у `run` не поддерживается; просмотр — `report <exp-id> --run N`; перезапуск — v2 (`--rerun N --yes`, `rerun_of: run-N`).
7. `record --run N` — нужен, дефолт последний + предупреждение при >1 run. Семантика **upsert по (task_id, variant)**, не append. Плюс `--from-json <file>`.
8. Резолв частный → общий, но не молча: warning в stderr и в meta. Escape hatch `--dataset-path` / `--variant-a-prompt-path`.
9. `results.jsonl` > 10 MB: warning + `results_ignored: true` в meta, report.md с цифрами остаётся; `.gitignore` автоматически НЕ править (побочный эффект в репо пользователя) — явная команда в v2.
10. Не-AI: manual + `record` + `--from-json`. External runner — v2.

Аспекты, которые нужно учесть в спецификации (выявлены в обсуждении):
- **Изоляция прогона** — главный риск: ai-phase запускает реальную фазу, вариант A/B напишет файлы в проект и создаст задачи. Решение в MVP: отдельный git worktree (src/core/worktree.ts уже есть) с откатом после каждой задачи, либо read-only набор инструментов.
- **Загрязнение billing** — headless-раны пишут `.vibelog/billing/<taskId>.json`; dataset-задачи не backlog-задачи. Нужен env-маркер `VIBELOG_EXPERIMENT=exp-1/run-1` и отдельное хранение usage рана.
- **Источник tool_calls** — определить по коду (agent-sessions jsonl vs run-progress), не предположение.
- **Cost по модели варианта** — `models.available[<variant.model>].pricing` → `calculateCost`; нет pricing → `cost: null` (не 0).
- **Прерывание/таймаут** — SIGINT → failed + частичные results валидны; timeout на задачу; `error_kind`.
- **Multi-variant в схеме** — `variants` как map (A/B/C), CLI в MVP только A и B.
- **Baseline / сравнение run'ов** — `report --compare run-1`, в MVP.
- **schema_version** в meta/frontmatter.
- **Идемпотентность прогона** — номер = max+1, атомарное создание каталога.
- **lesson.references** — поле отсутствует, не менять схему lesson; связь через reference type experiment + reference_link. Расширение — v2.

## Границы задачи

- НЕ писать код реализации — только документ doc-20 и создание задач реализации (или их список с рекомендацией создать).
- НЕ менять схему lessons/references.
- НЕ трогать README кроме строки в таблице «Документация».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Создан документ backlog/docs/doc-20 — «Эксперименты (A/B, generic)»: структура backlog/experiments/, форматы dataset/results JSONL, frontmatter exp-<id>.md, резолв dataset/prompt (частный → общий + warning при коллизии), CLI-поверхность, git-политика
- [x] #2 Документ содержит секцию «Границы версий фичи» с явным разделением MVP / v2 и оговоркой, что это версии ФИЧИ, а не релиза Vibelog (не путать с вехами v1.x)
- [x] #3 Определён список задач реализации (5–7 шт.) с зависимостями и порядком: артефакт+frontmatter → dataset → резолв prompt → record → report (+compare) → judge → ai-phase runner с изоляцией
- [x] #4 Каждая задача реализации получает label mvp или v2; задачи ai-phase runner и external runner явно v2-кандидаты, если не влезают в MVP
- [x] #5 Зафиксированы решения по 10 открытым вопросам с обоснованием (expected_ac, метрики отчёта, CLI-синтаксис, статусы + stale running, judge в MVP, run неизменяем, record upsert, warning при shadowing, results.jsonl >10MB, manual для не-AI)
- [x] #6 Зафиксирован риск изоляции прогона (ai-phase пишет в репозиторий) и решение по нему: git worktree либо read-only tool-набор; отдельно — загрязнение .vibelog/billing (env-маркер VIBELOG_EXPERIMENT)
- [x] #7 Зафиксирован источник метрики tool_calls (agent-sessions jsonl или run-progress) — проверено по коду, не предположение
- [x] #8 Зафиксирован расчёт cost по моделям ВАРИАНТОВ (models.available[<variant.model>].pricing → calculateCost), pricing отсутствует → cost: null, не 0
- [x] #9 Открытые вопросы, требующие решения пользователя, вынесены отдельным списком в конце документа (с рекомендацией по каждому)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План фазы Plan (VL-293, type=feature)

Изучено по коду (факты, на которых держится спецификация):
- `src/core/paths.ts` — паттерн `*Dir(backlogDir)`; добавляется `experimentsDir` / `experimentsDatasetsDir` / `experimentsPromptsDir` / `experimentRunsDir`.
- `src/core/models.ts` — `ModelsConfig.available: Record<id, ModelConfig>`, `ModelConfig.pricing?: ModelPricing`; `resolveModelById(cwd, id)` (строка 187) — резолв модели ВАРИАНТА (не активной).
- `src/core/analytics.ts` — `calculateCost(usage, pricing)` (строка 111) возвращает нули при `pricing === undefined`, `getActiveModelPricing` (строка ~152) — только активная модель. Для экспериментов нужен новый хелпер `getModelPricingById`.
- `src/core/billing.ts` — `billingPath(cwd, taskId)` = `.vibelog/billing/<TASKID>.json`, append-only; пишется headless-раном из `src/agent/cli.ts` (блок учёта токенов перед `recordRunProgress`).
- **Источник `tool_calls` (AC7), проверено по коду, НЕ предположение:** счётчик `toolCallsTotal` живёт только в памяти рана в `src/agent/loop.ts` (строка 516, инкремент — 977) и уходит в (а) единственную stdout-строку JSON `type=result` — `src/agent/cli.ts:1088`, парсится `parseQwenResult` (`src/web/qwen-result.ts`, поле `tool_calls_total?`), и (б) в `repeat_stats.tool_calls_total` (`src/agent/repeat-tracker.ts:~240`), который оркестратор кладёт в `qwen-result`/`run-progress`. В `src/agent/run-progress.ts` `buildRunProgress` tool_calls НЕ считает (ходит только по `edit`/`write_file`). → **канон для экспериментов: `tool_calls` берётся из stdout-результата рана (`type=result`.`tool_calls_total`), fallback — `countToolCallsInMessages` (`src/agent/session.ts:547`) по jsonl сессии рана.** `run-progress` как источник НЕ использовать (метрики не содержит).

### 1. Документ спецификации
Создать документ через MCP `document_create` (тип `specification`), title = «Эксперименты (A/B, generic): спецификация и границы версий фичи».
Нумерация: doc-20 уже занят (Lessons), поэтому фактический id будет **doc-21** — в задаче и в отчёте это отметить (в AC сказано «doc-20», имелся в виду следующий свободный).
Теги: `experiments`, `specification`, `a/b`, `mvp`, `vl-293`.

Секции документа (обязательные, по AC):
1. Назначение и рамка «generic, не только AI» (не-AI проект: manual runner + `record`).
2. **Границы версий фичи** — MVP / v2, с явной оговоркой: это версии ФИЧИ, не релиза Vibelog и не вехи v1.x.
3. Структура `backlog/experiments/` (общие `datasets/`, `prompts/`; частные в `exp-<id>/`; `run-<N>/{meta.json,results.jsonl,report.md}`).
4. Frontmatter `exp-<id>.md`: `id`, `title`, `status: draft|running|completed|failed`, `schema_version: 1`, `dataset`, `variants: {A:{prompt?,model?,params?,label?}, B:{…}}` (map, не массив), `metrics` (`score_field`, `higher_is_better`, `custom`), `judge?` (схема сразу), `created_date`, `updated_date`, `notes?`.
5. Dataset JSONL: поля `task_id` (обяз.), `expected_ac` (канон; синоним `expected` при чтении, предупреждение), `input`/`payload` (произвольный вход для manual runner), `custom` (map метрик), `meta?`.
6. Резолв dataset/prompt: **частный (`exp-<id>/…`) → общий (`backlog/experiments/…`)**, при коллизии — warning в stderr + `resolution` в meta рана; escape hatch `--dataset-path`, `--variant-a-prompt-path`, `--variant-b-prompt-path`.
7. Results JSONL: `task_id`, `variant`, `score` (number|null), `output?`, `error?`, `error_kind?` (`timeout|api|runner|judge|interrupted`), `tool_calls?`, `usage?`, `cost?` (number|null), `duration_ms?`.
8. meta.json рана: `schema_version`, `exp_id`, `run`, `status`, `started_at/finished_at`, `pid`, `resolution`, `results_ignored` (>10 MB), `n`, `dropped`, `cost_total`, `runner: manual|ai-phase|external`, `rerun_of?`.
9. Отчёт report.md: per-variant mean/median/дельта к baseline/win-rate/custom-метрики/errors + обязательно `n` (валидных) и `dropped` (ошибки и `score: null`).
10. CLI-поверхность (см. п.2 ниже).
11. Cost по варианту: `models.available[<variant.model>].pricing` → `calculateCost`; нет pricing → `cost: null` (не 0) и `pricing_missing: true` в meta.
12. Изоляция прогона (риск + решение) и загрязнение billing (`VIBELOG_EXPERIMENT=exp-<id>/run-<N>`, usage рана пишется в `run-<N>/usage.json`, а не в `.vibelog/billing/<datasetTaskId>.json`).
13. Прерывание/таймаут: SIGINT → `status: failed` + частичные results валидны; timeout на задачу; `error_kind`.
14. Git-политика: `backlog/experiments/**` в git; `run-*/results.jsonl` > 10 MB → warning + `results_ignored: true`, `.gitignore` автоматически НЕ править.
15. Решения по 10 открытым вопросам с обоснованием (таблица «вопрос → решение → почему»).
16. Список задач реализации (VL-294…VL-300) с зависимостями и label mvp/v2.
17. Открытые вопросы к пользователю с рекомендациями.

### 2. CLI-поверхность (фиксируется в документе, реализация — в дочерних задачах)
```
vibelog experiment create <slug> [--title] [--dataset] [--variant-a '<json>'|--variant-a-prompt/--variant-a-model/--variant-a-label] [--variant-b …]
vibelog experiment list
vibelog experiment run <exp-id> [--dry-run] [--variant A,B] [--timeout <sec>] [--max-tasks N]
vibelog experiment record <exp-id> --variant A --task <id> --score <n> [--run N] [--output/--error] [--from-json <file>]
vibelog experiment report <exp-id> [--run N] [--compare run-M] [--json]
vibelog experiment judge <exp-id> [--run N]   # MVP-шаг 2
```
Router: `src/cli/router.ts` (case 'experiment', ~строка 115, рядом с 'reference'/'lesson'), импорт `runExperiment` из `src/cli/commands/experiment.ts`; help-строка в `src/cli/router.ts` usage-блоке.

### 3. Файлы, которые будут изменены дочерними задачами
| Файл | Статус | Что |
|---|---|---|
| `src/core/experiment.ts` | новый | типы Experiment/Variant/DatasetRow/ResultRow/RunMeta, парс/запись frontmatter, `nextRunNumber`, `createRunDir` (max+1 + atomic mkdir) |
| `src/core/experiment.test.mjs` | новый | round-trip frontmatter, nextRunNumber, upsert |
| `src/core/dataset.ts` | новый | чтение/валидация JSONL, резолв частный→общий + warning |
| `src/core/dataset.test.mjs` | новый | резолв, warning при коллизии, битые строки → dropped |
| `src/core/report.ts` | новый | mean/median/win-rate/delta/custom, n/dropped, compare run'ов, markdown |
| `src/core/report.test.mjs` | новый | статистика на фикстурах, `score: null` исключается |
| `src/core/analytics.ts` | правка | + `getModelPricingById(cwd, modelId)` (модель ВАРИАНТА), JSDoc строки 11–12 |
| `src/core/billing.ts` | правка | + `billingSuppressed(env)`/маршрут в `run-<N>/usage.json` при `VIBELOG_EXPERIMENT` |
| `src/core/paths.ts` | правка | + `experimentsDir`/`experimentsDatasetsDir`/`experimentsPromptsDir`/`experimentRunsDir` |
| `src/cli/commands/experiment.ts` | новый | create/list/run/record/report/judge |
| `src/cli/router.ts` | правка | case 'experiment' + help |
| `src/cli/experiment-cli.test.mjs` | новый | CLI-контракты |
| `src/agent/cli.ts` | правка (v2) | `VIBELOG_EXPERIMENT` → usage в run-dir, не в billing |
| `src/core/worktree.ts` | правка (v2) | `ensureExperimentWorktree` — изоляция прогона |
| `README.md` | правка | одна строка в таблице «Документация» (строка ~60) |

### 4. Порядок работ (задачи созданы в этой фазе)
1. **VL-294 [mvp]** — артефакт `backlog/experiments/`, frontmatter `exp-<id>.md`, `experiment create/list`, paths, reference `type: experiment`.
2. **VL-295 [mvp]** — dataset JSONL, валидация, резолв частный→общий + warning. (зависит от VL-294)
3. **VL-296 [mvp]** — резолв prompts вариантов + manual runner и `record` (upsert по `(task_id, variant)`, `--run N` c предупреждением при >1 run, `--from-json`). (зависит от VL-294, VL-295)
4. **VL-297 [mvp]** — `report` (mean/median/дельта/win-rate/custom/errors + `n`/`dropped`) и `--compare run-1`. (зависит от VL-296)
5. **VL-298 [mvp]** — `judge`: схема `judge:` в frontmatter + LLM-скоринг, путь `score: null` реализован уже в VL-296/297. (зависит от VL-296)
6. **VL-299 [v2]** — `ai-phase` runner с изоляцией (worktree, `VIBELOG_EXPERIMENT`, timeout, cost по модели варианта, stale-running recover, `--dry-run` с оценкой стоимости).
7. **VL-300 [v2]** — external runner, `--rerun N --yes` + `rerun_of`, явная команда gitignore-политики, `lesson.references`. (зависит от VL-299)

Порядок и зависимости выставлены в MCP (`dependencies` + `parent_task_id: VL-293`).

### 5. Роль VL-293 после планирования
Реализацию НЕ делаем здесь: задача закрывается после создания документа. Документ пишется в фазе Code этой задачи (фаза Plan создаёт только план и задачи), проверки — `pnpm build && pnpm test` (документ кода не меняет, но DoD требует прогона; при правке README — только строка таблицы).

### 6. Как проверить
- `ls backlog/docs/` — появился `doc-21-…`; title совпадает с «Эксперименты (A/B, generic)».
- `vibelog doc list` (MCP `document_list`) показывает новый документ с тегами.
- Грепом по телу документа: секции «Границы версий фичи», «Открытые вопросы», «Источник tool_calls», «Изоляция прогона», «cost: null».
- `pnpm build && pnpm test` — регрессий нет.

### 7. Риски
- **Изоляция ai-phase** — реализуется в v2; в MVP риска нет (manual runner ничего не пишет в проект). Документ обязан зафиксировать: именно изоляция — причина выноса ai-phase в v2.
- **Загрязнение billing** — без env-маркера lab-раны попали бы в `.vibelog/billing/`; маркер `VIBELOG_EXPERIMENT` + `usage.json` в run-dir.
- **Совместимость с Backlog.md** — `backlog/experiments/` — расширение Vibelog; оригинал игнорирует незнакомые каталоги (как `lessons/`), round-trip не ломается.
- **doc-20 занят** — id будет doc-21; это не отклонение по сути AC (AC требует документ спецификации).
- **`results.jsonl` в git** — большие файлы; политика «не правим .gitignore».
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 02:07
---
Фаза 2 (Plan) выполнена. Тип: feature (не epic — план записан в VL-293, плюс создано 7 задач реализации эпика).
**План** записан в Implementation Plan VL-293: 17 обязательных секций документа-спецификации doc-21 (doc-20 занят Lessons — фактический id будет doc-21, это не отклонение по сути AC), CLI-поверхность, таблица 15 файлов правки/создания, порядок работ, проверки, риски.
**Изучено по коду (факты для AC7/AC8):**
- `tool_calls` — счётчик `toolCallsTotal` живёт только в памяти рана (`src/agent/loop.ts:516/977`), уходит в stdout JSON `type=result.tool_calls_total` (`src/agent/cli.ts:1088`, парсится `src/web/qwen-result.ts`) и в `repeat_stats` (`src/agent/repeat-tracker.ts`). `buildRunProgress` (`src/agent/run-progress.ts`) tool_calls НЕ считает (только edit/write_file) → **run-progress как источник не годится**; канон: stdout `type=result` + fallback `countToolCallsInMessages` (`src/agent/session.ts:547`).
- cost по варианту: `models.available[id].pricing` (`src/core/models.ts:40/59`) + `resolveModelById` (строка 187) → `calculateCost` (`src/core/analytics.ts:111`); нет pricing → нули, поэтому нужен новый `getModelPricingById` и явный `cost: null`.
- billing: `.vibelog/billing/<TASKID>.json` (`src/core/billing.ts:72`), пишется из `src/agent/cli.ts` → для экспериментов маркер `VIBELOG_EXPERIMENT` + `usage.json` в run-каталоге.
- изоляция: `src/core/worktree.ts` (`ensureTaskWorktree`/`taskWorktreeDir`) — переиспользуется под `exp-<id>-run-<N>`.
**Созданы задачи реализации (все с parentTaskId VL-293, зависимостями и labels):**
- VL-294 [mvp] — артефакт backlog/experiments/, frontmatter exp-<id>.md, paths, reference type experiment, CLI create/list
- VL-295 [mvp] — dataset JSONL: схема, валидация, резолв частный→общий + warning (dep VL-294)
- VL-296 [mvp] — резолв prompts + manual runner и record (upsert, --run, --from-json, stale running) (deps VL-294,295)
- VL-297 [mvp] — report (mean/median/дельта/win-rate/custom/errors + n/dropped) и --compare (dep VL-296)
- VL-298 [mvp] — judge-скоринг, путь score=null (dep VL-296)
- VL-299 [v2] — ai-phase runner с изоляцией (worktree, VIBELOG_EXPERIMENT, timeout, cost варианта, tool_calls) (deps VL-296,297,298)
- VL-300 [v2] — external runner, --rerun, .gitignore-политика, lesson.references (dep VL-299)
Все 7 задач переведены в Planned, у каждой свой implementationPlan и AC (5–8 пунктов).
**Риски:** изоляция ai-phase (потому и вынесена в v2; в MVP manual runner в проект не пишет), загрязнение billing без env-маркера, атомарность upsert results (temp+rename), деление на ноль при n=0, тесты LLM-клиента без явного apiMode (VL-240).
Документ спецификации создаётся в фазе Code этой задачи (Plan не пишет артефакты).
---
author: @agent
created: 2026-11-02 02:15
---
Фаза 3 (Code) выполнена. Создана спецификация **doc-21** «Эксперименты (A/B, generic): спецификация и границы версий фичи» (id doc-21, а не doc-20: doc-20 занят документом про lessons; по сути AC требование выполнено — документ-спецификация создан, номер следующий свободный).
Документ (19 секций) закрывает все 9 AC:
1. Структура `backlog/experiments/`, форматы dataset/results JSONL, frontmatter `exp-<id>.md`, резолв частный→общий с warning + escape hatch, CLI-поверхность, git-политика.
2. Секция «Границы версий фичи» с явной оговоркой: MVP/v2 — версии ФИЧИ, не релиза Vibelog и не вехи v1.x; граница проведена по критерию «пишет ли прогон в репозиторий пользователя».
3. Список задач реализации VL-294…VL-300 с зависимостями и порядком (артефакт+frontmatter → dataset → резолв prompt → record → report (+compare) → judge → ai-phase runner с изоляцией).
4. Labels: VL-294…VL-298 — mvp, VL-299…VL-300 — v2 (ai-phase и external runner явно v2).
5. Таблица решений по 10 открытым вопросам с обоснованием каждого.
6. Риск изоляции прогона (ai-phase пишет в репозиторий: файлы, задачи, коммиты, ветки) + решение: отдельный git worktree на прогон с откатом в try/finally; рассмотренная и отклонённая альтернатива read-only tool-набор. Отдельный подраздел про загрязнение billing и env-маркер `VIBELOG_EXPERIMENT=exp-<id>/run-<N>` → usage в `run-<N>/usage.json`, `.vibelog/billing/*` не пишется.
7. Источник `tool_calls` проверен по коду: счётчик `toolCallsTotal` в `src/agent/loop.ts` (516/977) уходит в stdout `type=result.tool_calls_total` (`src/agent/cli.ts:1088`) и в `repeat_stats`; `buildRunProgress` (`src/agent/run-progress.ts`) tool_calls НЕ считает → run-progress как источник отклонён, канон = stdout + fallback `countToolCallsInMessages` (`src/agent/session.ts:547`).
8. Cost по модели ВАРИАНТА: `models.available[<variant.model>].pricing` → `calculateCost`, требуется новый `getModelPricingById`; нет pricing → `cost: null` + `pricing_missing: true` (обосновано: 0 означал бы «вариант бесплатен» и выигрывал бы сравнение по цене без тарифа).
9. Секция 19 — 7 открытых вопросов к пользователю, каждый с рекомендацией (дефолт timeout, MCP-инструменты, единицы pass_fail, блокировка параллельных прогонов, lesson.references, export CSV, политика хранения ранов).
Изменённые файлы (вне backlog/): `README.md` — одна строка в таблице «Документация» (ссылка на doc-21), коммит `c8f3ca0`.
Проверки: `pnpm build` — чисто (strict tsc); полный `npx vitest run` — **130/130 файлов, 2456 тестов зелёные, 4 штатных skipped**. Первый полный прогон дал 1 падение в `src/web/chat-limits.test.mjs` (тайминг-флак: `guard.signal.aborted` в idle-guard); изолированный прогон этого файла — 18/18 зелёные, повторный полный прогон — всё зелёное. Причина классифицирована как флак по таймингу, не регрессия (диффа в src/ нет).
Код реализации не писал по границам задачи: спецификация + задачи реализации, схема lessons/references не менялась (связь через `reference type: experiment` — в VL-294). Что осталось: реализация в дочерних задачах VL-294…VL-300 (все Planned).
---
author: @agent
created: 2026-11-02 02:17
---
Фаза Close выполнена. Ветка vb/vl-293 слита в master (1 коммит: c8f3ca0 — ссылка на doc-21 в README), worktree и ветка удалены.
Проверки: merge-диффа `git diff --name-only HEAD^1..HEAD` = только `README.md` (одна строка таблицы «Документация»), `src/`/`templates/`/`package.json`/`tsconfig.json`/`vitest.config.mts` не затронуты — по исключению из правил Close полный прогон пропущен, причина зафиксирована здесь. Точечный фильтр `npx vitest run src/web/readme-standard.test.mjs` — 3/3 зелёные (лимит 150 строк и белый список H2 README не нарушены). Сборку не запускал: диффа в `src/` нет.
DoD: все 3 пункта выполнены и отмечены батчем. «Тесты проходят» — по полному прогону фазы Code (130/130 файлов, 2456 тестов зелёные, 4 штатных skipped; единственное падение chat-limits.test.mjs классифицировано как тайминг-флак, изолированный прогон 18/18); в Close дифф не затрагивает код, полный прогон не повторялся. «Документация обновлена» — doc-21 в git, README-строка, CHANGELOG. «Нет регрессий» — подтверждено фильтром.
Документация: CHANGELOG.md — запись в Unreleased/Добавлено (VL-293, спецификация + список задач VL-294…VL-300). Коммиты: 33dfa23 (refs и lessons, lesson-164), 970abf8 (docs: VL-293 — документация и CHANGELOG, включает doc-21). Файл задачи не коммитил — его коммитит framework после записи token_usage.
Lesson: lesson-164 «Проверяй фактический номер документа через document_list, если AC называет конкретный doc-N» (doc-20 был занят → фактический id doc-21, расхождение зафиксировано в отчёте Code). Задача связана с уроком.
Осталось: реализация в дочерних задачах VL-294…VL-300 (mvp/v2, все Planned), файлы подзадач в главном репо закоммичены последним шагом.
---
<!-- COMMENTS:END -->