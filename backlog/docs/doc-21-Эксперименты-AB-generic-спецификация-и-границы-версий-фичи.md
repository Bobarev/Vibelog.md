---
id: doc-21
title: 'Эксперименты (A/B, generic): спецификация и границы версий фичи'
type: specification
created_date: 2026-11-02
tags:
  - experiments
  - specification
  - a/b
  - mvp
  - vl-293
---
## 1. Назначение и рамка

Эксперименты — **generic** механизм A/B-сравнения в Vibelog, а не только тестирование промптов. Vibelog — инструмент для других проектов, поэтому эксперимент обязан работать там, где LLM нет вовсе (сайт, CLI, библиотека).

Две рамки одной фичи:

| Профиль | Что сравнивается | Как получаются результаты |
|---|---|---|
| **Generic (ядро)** | фичи, UX-тексты, алгоритмы, производительность, конфиги | manual runner: человек/внешний скрипт делает вариант и вызывает `experiment record` (в т.ч. `--from-json`) |
| **AI-профиль (опция)** | промпты фаз, модели, параметры генерации | ai-phase runner (v2) запускает headless-раны; LLM-judge (MVP шаг 5) ставит `score` |

Промпты, judge и pricing — не фундамент, а **надстройка** над одним и тем же хранилищем результатов. Не-AI проект использует 100% схемы, кроме секции `judge` и подстановки промптов: у него `score` приходит из его собственных метрик (`row.custom`, `--score`), а вход задачи — поле `input`/`payload` датасета.

Эксперименты — **артефакт проекта в git**, как `backlog/docs/`, `backlog/lessons/`, `backlog/references/`, `backlog/decisions/`, `backlog/milestones/`.

## 2. Границы версий фичи (важно)

> **MVP и v2 здесь — версии ФИЧИ «эксперименты», а не релиза Vibelog и не вехи `v1.x`.**
> В `ROADMAP.md` и в CHANGELOG живут версии продукта; здесь — только этапы поставки одной фичи.
> Нельзя читать «MVP» как «минимально жизнеспособный Vibelog» и «v2» как «следующий мажор продукта».
> Прямое следствие: задачи с label `v2` могут быть выполнены в любой момент, когда появится спрос, — они не ждут вехи.

**Граница проведена по одному критерию: пишет ли прогон в репозиторий пользователя.**
Всё, что не пишет (создание артефакта, датасет, ручной `record`, отчёт, judge), — MVP: безопасно, проверяемо, полезно на следующий день.
Всё, что пишет (ai-phase runner, external runner), — v2: там появляется риск загрязнения проекта, billing и таймаутов, и цена ошибки несравнима.

### MVP (фича)

1. `backlog/experiments/` как артефакт: `exp-<id>.md` + frontmatter, `datasets/`, `prompts/`, `exp-<id>/run-<N>/`.
2. Dataset JSONL: схема, валидация, резолв «частный → общий», команды `dataset create/list/view` (в т.ч. `--from-completed`).
3. Резолв промптов вариантов (включая `builtin:<phase>`) + **manual runner** и `record` (upsert, `--run`, `--from-json`).
4. `report`: mean/median/дельта/win-rate/custom/errors + `n`/`dropped`; `--compare run-N`; завершение прогона (`running → completed`).

**MVP закрывается после шага 4.** Шаг 5 — MVP-опция: basic-сценарий работает без judge (путь `score: null`).

5. `judge`: схема в frontmatter (фиксируется на шаге 1) + LLM-скоринг.

### v2 (фича)

6. `ai-phase` runner с изоляцией: отдельный git worktree на прогон, откат между задачами, `VIBELOG_EXPERIMENT`, timeout на задачу, cost по модели варианта, `--dry-run` с оценкой стоимости.
7. External runner (`--runner-cmd`), `--rerun N --yes`.
8. `experiment gc` (явная gitignore-политика) и связь lesson ↔ эксперимент через `reference type: experiment`.

## 3. Структура `backlog/experiments/`

```
backlog/experiments/
├── exp-1.md                        # карточка эксперимента (frontmatter + описание)
├── datasets/
│   └── prompts-baseline.jsonl      # ОБЩИЕ датасеты
├── prompts/
│   └── phase-architect.md          # ОБЩИЕ промпты (шаблоны вариантов)
└── exp-1/                          # каталог конкретного эксперимента
    ├── datasets/
    │   └── prompts-baseline.jsonl  # ЧАСТНЫЙ датасет — переопределяет общий
    ├── prompts/
    │   └── variant-b.md            # ЧАСТНЫЙ промпт — переопределяет общий
    └── run-1/
        ├── meta.json               # состояние прогона (единственный «живой» файл)
        ├── results.jsonl           # строки результатов (upsert по (task_id, variant))
        ├── report.md               # производный отчёт (перегенерируем)
        └── usage.json              # usage рана при VIBELOG_EXPERIMENT (v2)
```

Правила:
- `exp-<id>.md` — метаданные одного эксперимента (как `lesson-N` / `ref-N` / `doc-N`).
- `datasets/` и `prompts/` верхнего уровня — переиспользуемые общие файлы нескольких экспериментов.
- Каталог `exp-<id>/` содержит только частные переопределения и прогоны; отсутствие каталога — нормально.
- `run-<N>` — append-only: после создания не переписывается, кроме `report.md` (производный) и `meta.json` (статусные поля).

## 4. Frontmatter `exp-<id>.md`

```yaml
---
id: exp-1
title: "Варианты промпта фазы architect"
status: draft            # draft | running | completed | failed
schema_version: 1
dataset: prompts-baseline          # имя файла без .jsonl
runner: manual                     # manual | ai-phase | external (v2)
metrics:
  score_field: score               # имя поля оценки в results.jsonl
  higher_is_better: true           # направление улучшения для win-rate/дельты
  baseline: A                      # вариант-эталон (по умолчанию A)
  custom: [tokens, latency_ms]     # доп. метрики из row.custom
variants:                          # MAP, не массив (A/B/C/D)
  A:
    label: "текущий промпт"
    prompt: phase-architect        # имя файла в prompts/ ИЛИ builtin:<phase>
    model: provider/model-a        # опционально: id из models.available
    params: {temperature: 0.2}     # произвольные параметры раннера
  B:
    label: "новый промпт"
    prompt: builtin:spec           # встроенный промпт фазы — резолва файла не требует
judge:                             # ОПЦИОНАЛЬНО; схема фиксируется сразу
  enabled: true
  model: provider/judge-model      # по умолчанию models.default
  prompt: judge-v1                 # файл prompts/judge-v1.md
  scale: numeric                   # numeric | pass_fail
  score_min: 1
  score_max: 10
created_date: 2026-11-02
updated_date: 2026-11-02
notes: ""
---
```

Почему `variants` — map: сравнений «три и более» в реальности больше, чем кажется (A/B/C — шум-тест, контроль изоляции), а список потребовал бы индексов. Ограничение MVP — **CLI принимает только A и B**; схема готова к C/D без миграции.

**`variant.prompt` — строка в одном из двух форматов:**

| Значение | Что значит | Как резолвится |
|---|---|---|
| `<name>` | файл в `prompts/` | частный `exp-<id>/prompts/<name>.md` → общий `prompts/<name>.md` (§6, с warning при коллизии) |
| `builtin:<phase>` | встроенный промпт фазы | **файловая система не ищется**: текст берётся из `templates/phases/phase-<phase>.md` с приоритетом `.vibelog/prompts/phases/phase-<phase>.md`; неизвестная фаза → ошибка со списком доступных |

Почему `builtin:` обязателен: главный сценарий AI-профиля — «сравнить *текущий встроенный* промпт фазы с его вариантом». Без него пришлось бы копировать шаблон в `prompts/`, и эксперимент сравнивал бы две копии, а не встроенный оригинал (дрейф шаблона не отслеживался бы).

`status`:
- `draft` — создан, ничего не запускалось;
- `running` — есть незавершённый прогон (живёт в `meta.json` рана);
- `completed` — последний прогон завершён;
- `failed` — прогон оборван (SIGINT, таймаут, ошибка раннера).

Статус эксперимента — производный от последнего рана: пересчитывается при завершении рана, не выставляется вручную.

### Правило «stale running»

`status: running` в `meta.json` рана хранит `pid` и `started_at`. Если `pid` не жив (`process.kill(pid, 0)` бросает ESRCH) и `finished_at` пуст, прогон считается **зависшим**:
- любая команда, читающая раны, печатает предупреждение и подсказку `experiment run <exp-id> --recover`;
- `--recover` переводит ран в `failed`, сохраняет частичные `results.jsonl` (они валидны: upsert уже записал то, что успели), дописывает `finished_at` и `reason`.
Почему не автоматически: процесс мог быть остановлен вместе с машиной; молчаливая запись `failed` скрыла бы незавершённость.

## 5. Dataset JSONL

По одной JSON-строке на задачу:

```json
{"task_id": "t1", "expected_ac": "Функция возвращает [] для пустого входа", "custom": {"language": "ts"}}
{"task_id": "t2", "expected_ac": "Ошибка 400 при неверном токене", "input": "POST /login {'token':'bad'}"}
{"task_id": "t3", "payload": {"url": "/pricing"}, "custom": {"viewport": "mobile"}}
```

| Поле | Обяз. | Смысл |
|---|---|---|
| `task_id` | да | ключ строки, уникален в датасете; используется в upsert `(task_id, variant)` |
| `expected_ac` | нет | «ожидаемый результат» в широком смысле: критерий приёмки, текст ответа, эталонный вывод |
| `expected` | нет | **синоним** `expected_ac` только для чтения; при использовании — warning `expected устарел, канон — expected_ac` |
| `input` | нет | произвольный вход для manual runner (промпт, URL, входные данные) |
| `payload` | нет | то же, но структурировано (объект); при наличии обоих `input` и `payload` — warning, выигрывает `payload` |
| `custom` | нет | доп. метрики/поля задачи, попадают в отчёт как custom-метрики |
| `meta` | нет | произвольные метаданные (не участвуют в расчётах) |

Проблемы валидации (битый JSON, отсутствие `task_id`, дубликат `task_id`) не роняют команду: строки попадают в `errors`, печатаются в stderr и считаются как `dropped` в отчёте. Причина: датасет — пользовательские данные, частичный прогон полезнее падения.

### Создание датасета

```
vibelog experiment dataset create <name> [--from-completed] [--limit N]   # --force для перезаписи
vibelog experiment dataset list                                           # общие + частные, с пометкой
vibelog experiment dataset view <name> [--exp <exp-id>]                   # валидация, число строк, task_id
vibelog experiment dataset <exp-id> [--dataset-path <p>]                  # резолв для конкретного эксперимента
```

- `create` без флагов создаёт пустой общий файл и печатает шаблон строки (ручное заполнение).
- `create --from-completed` собирает строки из завершённых задач проекта (`backlog/tasks/**` со `status: Done`): `task_id` = ID задачи, `title`+`description` → `input`, `acceptanceCriteria[].text` → `expected_ac`, `type`/`priority` → `custom`; `--limit N` (по умолчанию 20) ограничивает число.
- Почему `--from-completed` в MVP: без готового входа manual-runner не с чего начать, а завершённые задачи — единственный датасет, который у проекта уже есть.

## 6. Резолв dataset и prompt: частный → общий (не молча)

Порядок поиска одного и того же имени `name`:

1. `backlog/experiments/<exp-id>/datasets/<name>.jsonl` (частный, для датасета);
2. `backlog/experiments/datasets/<name>.jsonl` (общий).

Аналогично для промптов: `backlog/experiments/<exp-id>/prompts/<name>.md` → `backlog/experiments/prompts/<name>.md`.

Правила:
- Если найдены **оба** файла — берётся частный, но печатается **warning в stderr** и в `meta.json` рана пишется `resolution`:
  ```json
  {"dataset": {"chosen": "private", "path": "exp-1/datasets/...", "shadowed": "datasets/..."},
   "prompts": {"B": {"chosen": "private", "shadowed": "prompts/variant-b.md"}}}
  ```
- Если не найден ни один — ошибка с перечнем проверенных путей (не «файл не найден»).
- Если найден только частный — без warning (это штатное переопределение).
- `builtin:<phase>` в резолве **не участвует** (см. §4): файловая система для него не опрашивается.
- Escape hatch (перебивает резолв полностью): `--dataset-path <path>`, `--variant-a-prompt-path <path>`, `--variant-b-prompt-path <path>`.

Почему warning обязателен: общий файл правят «для всех», частный случайно затеняет его, и разница в результатах прогонов объясняется не вариантом, а забытым переопределением. Молчаливый резолв — источник ложных выводов эксперимента.

## 7. Results JSONL

```json
{"task_id":"t1","variant":"A","score":7,"output":"...","tool_calls":23,"usage":{"input":12000,"output":800,"cache":0,"total":12800,"requests":4},"cost":0.0123,"duration_ms":41200}
{"task_id":"t1","variant":"B","score":null,"error":"timeout 120s","error_kind":"timeout","duration_ms":120000}
```

| Поле | Обяз. | Смысл |
|---|---|---|
| `task_id` | да | ссылка на строку датасета |
| `variant` | да | ключ из `variants` |
| `score` | да (может быть `null`) | основная метрика; `null` — оценка не получена (нет judge, нет данных) |
| `output` | нет | результат варианта (текст, ссылка, отчёт) |
| `error` | нет | текст ошибки |
| `error_kind` | нет | `timeout` \| `api` \| `runner` \| `judge` \| `interrupted` |
| `tool_calls` | нет | число tool-вызовов рана (см. §12) |
| `usage` | нет | usage прогона (как в billing: input/output/cache/total/requests) |
| `cost` | нет | стоимость ВАРИАНТА (см. §11); `null` — тарифа нет |
| `duration_ms` | нет | время выполнения задачи |
| `custom` | нет | доп. метрики строки |

**Семантика записи — upsert по `(task_id, variant)`, не append.** Повторный `record` по той же паре заменяет строку (человек исправил оценку, раннер перезапустил одну задачу). Append оставил бы два противоречащих числа, и отчёт зависел бы от порядка. Файл пишется атомарно (temp + `rename`), чтобы SIGINT не оставил половину строки.

## 8. `meta.json` рана

```json
{
  "schema_version": 1,
  "exp_id": "exp-1",
  "run": 1,
  "status": "running",
  "runner": "manual",
  "started_at": "2026-11-02T10:00:00.000Z",
  "finished_at": null,
  "pid": 48213,
  "resolution": {"dataset": {"chosen": "private", "shadowed": "datasets/prompts-baseline.jsonl"}},
  "results_ignored": false,
  "n": 0,
  "dropped": 0,
  "cost_total": null,
  "pricing_missing": true,
  "rerun_of": null,
  "reason": null
}
```

`n` и `dropped` дублируются в `meta.json` при завершении рана: отчёт можно посмотреть без парсинга `results.jsonl` (важно при `results_ignored: true`). Заполняются только командой `report` — источник этих чисел всегда `results.jsonl`, `meta` лишь кэш для чтения.

**Завершение прогона.** Прогон закрывает `report` (не `record`): если для **всех** строк датасета × всех вариантов есть строка с `score` или `error`, ран переводится в `completed` (`finished_at`, `n`, `dropped`, `cost_total`), статус эксперимента пересчитывается. Если данных не хватает — `report` печатает список недостающих пар `(task_id, variant)` и статус **не меняет**. Почему так: manual-ран не имеет процесса, который мог бы «сам завершиться», а `completed` на половине данных опаснее, чем явный `running`.

**Идемпотентность номера прогона:** номер = `max(существующих run-<N>) + 1`, каталог создаётся атомарно (`mkdir` без `recursive` на листовом уровне); при `EEXIST` номер увеличивается и попытка повторяется. `run` никогда не пишет в существующий каталог.

**Run неизменяем.** `experiment run` не принимает `--run N`; смотреть конкретный прогон — `experiment report <exp-id> --run N`; перезапуск — `v2` (`--rerun N --yes` → новый `run-<M>` с `rerun_of: run-N`). Причина та же, что в billing (`.vibelog/billing/<taskId>.json` append-only): иначе сравнивать прогоны нельзя — база сравнения меняется под ногами.

## 9. Отчёт `report.md`

Отчёт всегда даёт по каждому варианту:

| Метрика | Определение |
|---|---|
| `n` | число **валидных** строк: `score` — конечное число |
| `dropped` | строки, исключённые из средних: `error` есть или `score: null` (с разбивкой по `error_kind`) |
| `mean` | среднее по валидным |
| `median` | медиана по валидным (устойчива к выбросам: одна задача на 3 часа не сдвигает картину) |
| `delta` | разница среднего к baseline-варианту (в абсолютных и в процентах) |
| `win_rate` | доля задач, где вариант строго лучше baseline (с учётом `metrics.higher_is_better`) |
| `custom` | средние по метрикам `row.custom`, перечисленным в `metrics.custom` |
| `errors` | число строк с `error`, по `error_kind` |

Требования:
- `n` и `dropped` печатаются **всегда**, даже когда `n = 0` (тогда метрики — `—`, не `NaN`).
- `report.md` — производный файл: перегенерируется командой `report` (единственное исключение из «run неизменяем»).
- `--compare run-M` добавляет таблицу дельт между прогонами (например, до/после правки промпта).
- `--json` печатает ту же структуру в stdout для машинной обработки.

## 10. CLI-поверхность

```
vibelog experiment create <slug> [--title <t>] [--dataset <name>] [--runner <mode>]
       [--variant-a '<json>'] [--variant-a-prompt <name|builtin:phase>] [--variant-a-model <id>] [--variant-a-label <l>]
       [--variant-b '<json>'] [--variant-b-prompt <name|builtin:phase>] [--variant-b-model <id>] [--variant-b-label <l>]
vibelog experiment list [--status <s>]
vibelog experiment dataset create <name> [--from-completed] [--limit N] [--force]
vibelog experiment dataset list
vibelog experiment dataset view <name> [--exp <exp-id>]
vibelog experiment dataset <exp-id> [--dataset-path <p>]        # показать резолв и валидацию
vibelog experiment run <exp-id> [--dry-run] [--variant A,B] [--timeout <sec>] [--max-tasks N] [--recover] [--rerun N --yes]
vibelog experiment record <exp-id> --variant A --task <task_id>
       [--score <n>] [--output <text>] [--error <text>] [--error-kind <k>]
       [--tool-calls N] [--duration <ms>] [--cost <n>] [--custom '<json>']
       [--run N] [--from-json <file>]
vibelog experiment report <exp-id> [--run N] [--compare run-M] [--json]
vibelog experiment judge <exp-id> [--run N]
vibelog experiment gc <exp-id> [--apply]      # v2
```

Решения:
- **`run` — основной глагол** («прогнать эксперимент»), `create` — флаги. `--variant-a '<json>'` — альтернатива набору флагов (JSON-объект варианта целиком) для сложных конфигураций; оба способа в одном вызове — ошибка.
- **`run --dry-run` обязателен:** печатает матрицу «строк датасета × вариантов», список резолвнутых файлов (с пометкой общий / частный / builtin) и оценку стоимости (по среднему usage прошлых ранов; при отсутствии данных — «оценки нет»). Без него дорогой прогон запускается случайно.
- **`record` без `--run`** пишет в последний прогон и печатает предупреждение, если прогонов больше одного (легко записать не туда).
- **`--from-json <file>`** — массив results-строк, upsert пачкой (не-AI проекты и внешние раннеры).
- **`--recover`** — см. §4.
- **`report` закрывает прогон** — см. §8.

## 11. Стоимость по модели ВАРИАНТА

Стоимость считается **по модели самого варианта**, а не по активной модели проекта:

1. `variant.model` (id из `models.available`) → `models.available[<variant.model>].pricing` (`.vibelog/settings.json`);
2. `calculateCost(usage, pricing)` — `src/core/analytics.ts`;
3. **`pricing` отсутствует → `cost: null`** (и `pricing_missing: true` в `meta.json`), **не `0`**.

Почему `null`, а не ноль: `calculateCost` при отсутствии тарифа возвращает нули (это правильно для агрегатов, где «тарифа нет» = «денег не считаем»). В эксперименте ноль — это утверждение «вариант B бесплатен», и он бы выиграл сравнение по цене, не имея ни одного тарифа. `null` честно означает «неизвестно» и исключается из сумм.

Требуется новый хелпер `getModelPricingById(cwd, modelId)` в `src/core/analytics.ts`: существующий `getActiveModelPricing` резолвит только активную модель.

Стоимость судейских вызовов (`judge`) учитывается **отдельно**: `judge_usage` / `cost_judge` в `meta.json`, не примешивается к `cost` варианта (иначе вариант «дороже» из-за оценки, а не из-за работы).

## 12. Источник метрики `tool_calls` (проверено по коду)

Счётчик tool-вызовов существует только в памяти рана:

- `src/agent/loop.ts` — `toolCallsTotal` (объявление строка 516, инкремент строка 977), наружу уходит двумя путями:
  - единственная stdout-строка JSON `type=result`, поле `tool_calls_total` — `src/agent/cli.ts` (строка 1088), парсится `parseQwenResult` (`src/web/qwen-result.ts`, поле `tool_calls_total?: number`);
  - `repeat_stats.tool_calls_total` (`src/agent/repeat-tracker.ts`), который попадает в лог/оркестратор.
- `src/agent/run-progress.ts` — `buildRunProgress` tool-вызовы **не считает** (обходит только `edit`/`write_file` для блока «Сделано»).

**Канон для экспериментов:** `tool_calls` берётся из stdout-результата рана (`type=result`.`tool_calls_total`); fallback — `countToolCallsInMessages` (`src/agent/session.ts`, строка 547) по jsonl сессии рана; если и его нет — поле не пишется (`undefined`, не `0`: «ноль вызовов» — законное значение, «нет данных» — нет).

`run-progress` как источник **не использовать** — он не содержит этой метрики. Утверждение зафиксировано по коду, а не по предположению.

## 13. Изоляция прогона (главный риск) и загрязнение billing

### Риск

`ai-phase` runner запускает **реальную** фазу агента. Вариант A/B:

- пишет файлы в проект (`edit`/`write_file`);
- создаёт задачи через MCP (`backlog_create_task`);
- коммитит (`git commit` — шаг 6 шаблона Code);
- создаёт worktree и ветки.

Без изоляции эксперимент «сравнить два промпта» через 40 задач оставит в репозитории пользователя мусор: ветки, задачи, коммиты, изменённые файлы — и второй вариант будет стартовать не с чистого состояния, а с результата первого. Это делает сравнение недействительным, а не просто грязным.

### Решение (v2, в MVP риска нет — manual runner в проект не пишет)

- **Отдельный git worktree на прогон:** `ensureExperimentWorktree(cwd, expId, runN)` по образцу `ensureTaskWorktree` (`src/core/worktree.ts`), путь `.vibelog/worktrees/exp-<id>-run-<N>`, ветка `exp/<id>-run-<N>`. Работа варианта идёт только внутри него; основной репозиторий не трогается.
- **Откат после каждой задачи** (`git reset --hard && git clean -fd` внутри worktree, в `try/finally` — в том числе при падении рана), чтобы вариант B получал то же начальное состояние, что и A.
- Параллельный запуск вариантов в одном worktree запрещён (последовательные волны: задача × вариант).
- Коммиты фаз внутри worktree изолированы (это отдельная ветка); в конце прогона worktree удаляется.
- Альтернатива, рассмотренная и отклонённая: read-only набор инструментов. Отклонено — он ломает саму суть эксперимента с фазами (фаза Code по определению пишет файлы), поэтому годится только для промптов «на входе-выходе» без правок, а это уже manual runner.

### Загрязнение billing

Headless-ран пишет usage в `.vibelog/billing/<taskId>.json` (`billingPath`, `src/core/billing.ts`), а dataset-задачи (`t1`, `t2`, …) **не являются backlog-задачами**: файлы `T1.json`, `T2.json` засоряют учёт, а реальные задачи получают чужие цифры при совпадении id.

Решение: env-маркер **`VIBELOG_EXPERIMENT=exp-<id>/run-<N>`**. При его наличии:
- usage рана пишется в `<run-dir>/usage.json` (append-массив записей прогона);
- `.vibelog/billing/*` **не пишется**;
- в `meta.json` фиксируется `experiment_usage: true`.

Маркер ставит раннер, а не пользователь; проверка — в `src/core/billing.ts` (`billingSuppressed(env)`) на стороне писателя, чтобы забытый путь записи не просочился.

### External runner (v2, VL-300)

`runner: external` — вариант для проектов, где вариант делает **внешняя команда** пользователя (не LLM-агент): `vibelog experiment run <exp-id> --runner-cmd '<shell>'`.

- **Контракт обмена.** На каждую пару «строка датасета × вариант» команда вызывается один раз. На stdin — одна JSON-строка: `task_id`, `variant`, `variant_label`, `model`, `params`, `expected_ac`/`input`/`payload` (берётся то, что есть в датасете). Из stdout берётся **первая непустая строка, парсящаяся как JSON-объект** — логи команды перед результатом прогон не ломают (важно: `console.log` отладочной информации не превращает весь прогон в `runner`-ошибки).
- **Спавн и таймаут.** `/bin/sh -c '<cmd>'` с проброшенными stdin/stdout; таймаут — SIGTERM, затем SIGKILL через 5 с (как в `ai-phase`). Таймаут → `error_kind: 'timeout'`.
- **Ошибки построчно, прогон продолжается.** Код выхода ≠ 0 → `error_kind: 'runner'` с первой строкой stderr; stdout без JSON-объекта → `error_kind: 'runner'`; строка считается `dropped`, следующие пары прогоняются.
- **`cost` всегда `null`**: внешняя команда может не ходить в LLM, а выдуманная цена испортила бы сравнение по стоимости (та же логика, что `pricing_missing`, §19 п.2).
- **Worktree не создаётся.** Изоляция из §13 защищает проект от *агента*; здесь запускается код самого пользователя, и он сам решает, что и где менять — оборачивать его в worktree значило бы сломать сценарии, которым нужен основной репозиторий (сборка, деплой, внешние сервисы).
- **Health-check — только синтаксис.** Пустая команда и незакрытая кавычка отвергаются до создания рана проверкой `/bin/sh -n -c`. Пробный запуск сознательно НЕ выполняется: `--runner-cmd` — произвольный код пользователя, скрытый тестовый прогон тратил бы деньги и писал файлы помимо воли человека. Это и есть «явное подтверждение» из риска плана: команду вводит человек руками в командной строке.
- **Метаданные.** `meta.runner = 'external'`, в `resolution` пишется `runner_cmd` — отчёт сравнивает прогоны по фактически запущенной команде.
- **Перезапуск** — `run --rerun N --yes` (§10): новый каталог `run-(max+1)` с `rerun_of: N`, старый ран не переизменяется (§17 п.6). `--rerun` без `--yes` отказывает — прогон тратит ресурсы повторно.

## 14. Прерывание, таймаут, ошибки

- **SIGINT / SIGTERM** → ран переводится в `failed`; уже записанные строки `results.jsonl` **валидны** (upsert атомарен построчно); текущая задача получает `error_kind: "interrupted"` (если успели записать).
- **Timeout на задачу** — обязательный параметр `--timeout <sec>` (дефолт в настройках); по истечении — строка с `error_kind: "timeout"`, прогон продолжается со следующей задачи (одна зависшая задача не убивает весь эксперимент).
- **Ошибка API/раннера** — `error_kind: "api" | "runner"`, строка пишется, задача считается `dropped`.
- **`status: failed` ≠ «данные плохие»** — это маркер неполного прогона. Отчёт по `failed`-рану печатается и помечается «частичный прогон: n из N».

## 15. Git-политика

- `backlog/experiments/**` коммитится: это артефакт проекта (как lessons/references/decisions).
- `run-<N>/results.jsonl` **> 10 MB**: печатается warning, в `meta.json` ставится `results_ignored: true`. Это сигнал «файл слишком велик для git»; `report.md` с посчитанными цифрами остаётся и коммитится, поэтому история результатов не теряется.
- `.gitignore` **автоматически не правится** никогда. Причина: это побочный эффект в чужом репозитории — эксперимент не имеет права менять правила версионирования проекта без явной команды человека. Явная команда — `experiment gc <exp-id> [--apply]` в v2.
- `usage.json`, `meta.json` — небольшие, коммитятся (это история прогонов).

## 16. Совместимость с Backlog.md

`backlog/experiments/` — расширение Vibelog.md, как `lessons/`, `references/`, `decisions/`. Оригинал Backlog.md не знает этот каталог и игнорирует незнакомые поддиректории — round-trip данных задач/документов не ломается. Формат `exp-<id>.md` — markdown с YAML-фронтматтером, читаемый любым markdown-инструментом.

`lesson.references` **не меняется**: связь «урок ↔ эксперимент» делается через `reference type: experiment` (в `REFERENCE_TYPES`) + `reference_link`. Расширение схемы lesson (поле `references`) — только v2 и только по отдельному решению пользователя.

## 17. Решения по 10 открытым вопросам

| № | Вопрос | Решение | Почему |
|---|---|---|---|
| 1 | `expected_ac` — имя | канон `expected_ac`, синоним `expected` только на чтение с warning; в датасет добавлены `input`/`payload` | `expected_ac` уже в головах (критерии приёмки задач); «expected» шире, но переименование ломает совместимость. `input`/`payload` — потому что не-AI проекту некуда положить вход задачи |
| 2 | Метрики отчёта | mean/median/дельта/win-rate/custom/errors + **обязательно `n` и `dropped`** | без `n`/`dropped` среднее по 2 строкам из 40 выглядит как результат; `dropped` отделяет «оценка не получена» от «оценка плохая» |
| 3 | CLI-синтаксис | `run <exp-id>` — новый прогон, `create` флагами; `--variant-a '<json>'` как альтернатива; `run --dry-run` обязателен | `run` — глагол действия; JSON-вариант нужен для сложных конфигураций; dry-run защищает от дорогого случайного прогона |
| 4 | Статусы | `draft\|running\|completed\|failed` + правило stale running (`--recover`) | без stale-правила `running` навсегда блокирует эксперимент после падения машины |
| 5 | judge в MVP | схема в frontmatter сразу, реализация — шаг 5 MVP (после закрытия MVP); путь `score: null` обязателен | `score: null` нужен и без judge (ошибки, ручные прогоны) — он проектируется первым |
| 6 | Изменяемость run | run неизменяем (append-only), `--run N` у `run` не поддерживается; `report --run N` для просмотра; `--rerun` в v2 | как billing: изменяемая база сравнения делает сравнение бессмысленным |
| 7 | `record` | `--run N` нужен, дефолт — последний + предупреждение при >1 run; **upsert по `(task_id, variant)`**, не append; `--from-json` | append оставил бы противоречащие оценки одной задачи; предупреждение спасает от записи не в тот прогон |
| 8 | Резолв частный → общий | резолв есть, но **не молча**: warning в stderr + `resolution` в `meta.json`; escape hatch `--dataset-path` / `--variant-*-prompt-path` | забытое частное переопределение объясняет разницу прогонов лучше, чем сам вариант — молчание даёт ложные выводы |
| 9 | `results.jsonl` > 10 MB | warning + `results_ignored: true`; `report.md` остаётся; `.gitignore` автоматически не правится (явная `gc` в v2) | отчёт сохраняет историю; правка `.gitignore` — побочный эффект в чужом репозитории |
| 10 | Не-AI проекты | manual runner + `record` + `--from-json` + `dataset create --from-completed`; external runner — v2 | manual покрывает 100% generic-сценариев без риска записи в репозиторий |

## 18. Задачи реализации

| ID | Label | Задача | Зависит от |
|---|---|---|---|
| VL-294 | mvp | артефакт `backlog/experiments/`, frontmatter `exp-<id>.md` (включая парсинг `metrics`/`judge`), paths, `reference type: experiment`, CLI `create`/`list` | — |
| VL-295 | mvp | dataset JSONL: схема, валидация, резолв частный → общий + warning, `dataset create/list/view`, `--from-completed` | VL-294 |
| VL-296 | mvp | резолв промптов (включая `builtin:<phase>`) + manual runner и `record` (upsert, `--run`, `--from-json`, stale running) | VL-294, VL-295 |
| VL-297 | mvp | `report` (mean/median/дельта/win-rate/custom/errors, `n`/`dropped`) и `--compare` + **завершение прогона** | VL-296 |
| VL-298 | mvp (опция) | `judge`: схема + LLM-скоринг, путь `score: null` | VL-296 |
| VL-299 | v2 | `ai-phase` runner с изоляцией (worktree, `VIBELOG_EXPERIMENT`, timeout, cost варианта) | VL-296, VL-297, VL-298 |
| VL-300 | v2 | external runner (`--runner-cmd`), `run --rerun N --yes` | VL-299 |
| VL-301 | v2 | `experiment gc` (явная gitignore-политика), связь lesson ↔ эксперимент через reference | VL-299 |

Порядок: артефакт+frontmatter → dataset → резолв prompt → record → report (+compare, завершение) → judge → ai-phase runner с изоляцией → external/rerun → gc/lesson.

**MVP закрывается после VL-297.** VL-298 — опция внутри MVP: без judge `score` приходит из `--score` / `--from-json`, отчёт и сравнение работают полностью.

## 19. Открытые вопросы к пользователю

| № | Вопрос | Статус | Решение / рекомендация |
|---|---|---|---|
| 1 | Дефолт `--timeout` на задачу | **решено в VL-299** | **600 с** (`DEFAULT_TASK_TIMEOUT_SEC`); переопределяется `timeout_sec` в frontmatter карточки и флагом `--timeout <сек>` (флаг приоритетнее) |
| 2 | Блокировка параллельных прогонов одного эксперимента | **решено в VL-299** | `meta.json` последнего рана + `pid` как lock (`assertNoActiveRun`): второй `run` того же эксперимента при живом pid — **отказ**, не очередь (два прогона делили бы `results.jsonl` и worktree-каталоги) |
| 3 | Единицы `score` при `judge.scale: pass_fail` | **решено в VL-299** | **`1`/`0`**, а не `true`/`false` — иначе `median` и `win_rate` требуют отдельной ветки |
| 4 | Нужен ли MCP-инструмент `experiment_*`? | открыт, не блокирует | Рекомендация: v2, после стабилизации CLI — иначе два контракта поддерживать одновременно |
| 5 | Судьба `lesson.references` | решено для v2 | Схему lesson не расширять; связь через `reference type: experiment` (VL-301). Расширение схемы — отдельная задача по решению пользователя |
| 6 | Нужен ли `experiment export <exp-id> --csv`? | открыт, не блокирует | Рекомендация: v2, по спросу; `report --json` закрывает машинную обработку |
| 7 | Политика хранения старых ранов | решено | Ничего не удалять автоматически; `gc` (VL-301) только предлагает кандидатов на `.gitignore` |
