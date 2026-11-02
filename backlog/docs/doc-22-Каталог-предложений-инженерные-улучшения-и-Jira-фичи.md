---
id: doc-22
title: 'Каталог предложений: инженерные улучшения и Jira-фичи'
type: specification
created_date: 2026-11-02
tags:
  - jira
  - roadmap
  - features
  - proposals
  - backlog
  - discussion
---
# Каталог предложений: улучшения и Jira-фичи

**Статус:** обсуждение, задачи не созданы
**Дата:** 2026-11-02
**Источники:** обсуждение roadmap (сессия 2026-11-02) + предложения второго агента
**Связанные документы:** ROADMAP.md, doc-11 (сравнение с Backlog.md/vibe-kanban), doc-21 (эксперименты)

## Как читать

Документ — каталог, а не план. Каждый пункт описан так, чтобы его можно было обсуждать и превращать в задачу без повторного исследования.

Структура:

- **Часть I** — инженерные улучшения (не фичи): найденные дефекты, дрейф документации, инфраструктура, производительность, пробелы API/CLI.
- **Часть II–IV** — Jira-фичи по трём уровням: дешёвые, средние, крупные/рискованные.
- **Часть V** — предложения второго агента (A/B/C + «не сейчас»).
- **Часть VI** — сводная таблица и волны.
- **Часть VII** — открытые решения, которые нужно принять до создания задач.

Пометки: **[факт]** — проверено по коду/репозиторию; **[идея]** — предложение без проверки.

---

# Часть I. Инженерные улучшения

## 1. Найденные дефекты

### 1.1. `.vibelog/` целиком в корневом `.gitignore` — B3 нарушена уже сейчас **[факт]**

В корневом `.gitignore` строка `.vibelog/`. Следствия:

- `settings.json` (провайдеры, модели, workflows, mcpServers) **не переносится** между машинами — ровно то, от чего предупреждает пункт B3 roadmap.
- `billing/` тоже не в git, хотя по дизайну VL-198 должен переноситься (метрики проекта).
- `agent-sessions/`, `chat-sessions/`, `.env`, `tmp/`, `worktrees/` — правильно игнорируются, но не точечно, а «всё разом».

**Что делать:** создать `.vibelog/.gitignore` с точечными правилами (`agent-sessions/`, `chat-sessions/`, `.env`, `tmp/`, `worktrees/`, `*.log`), убрать `.vibelog/` из корневого. `billing/` и `settings.json` — в git.

**Почему это не «запланировать», а «починить»:** проблема существует в этом же репозитории прямо сейчас.

### 1.2. `doctor` хардкодит число MCP-инструментов **[факт]**

`src/cli/commands/doctor.ts`: `const expected = 44;` и полный массив из 44 имён рядом, в рантайм-проверке.

Следствия:

- Каждый новый MCP-инструмент = правка `doctor.ts` + падающий тест. В CHANGELOG уже есть «счётчиков 38→42 в doctor» (VL-268).
- Проверка не ловит реальные проблемы (дубли имён, инструмент без обработчика), а только «список не тот, что вчера».

**Что делать:** проверять инварианты, а не число: нет дублей имён, все имена соответствуют префиксам (`backlog_`/`milestone_`/`reference_`/`document_`/`lesson_`/`project_map`), реестр непуст, у каждого инструмента есть `inputSchema`. Ожидаемый список имён — в тест, не в рантайм.

### 1.3. Мусор в `.vibelog/` и в корне **[факт]**

- `.vibelog/` — 32 записи, из них ~15 отладочных логов (`vl200-test.log`, `vl227-full3.log`, `browser-vl177.log`, `vl218-close-test2.log`…), плюс `doc8-new.md`, `fix-doc6.mjs`, `fix-doc7.mjs`.
- Корень репозитория — 10 файлов логов: `.vibelog-browser-vl177.log`, `.vibelog-browser.log`, `.vibrowser.log`, `.vl177-browser.log`, `vibelog-browser.log`, `vl176-browser.log`, `vl176-lint-base.log`, `vl176-lint.log`, `vl176-test.log`, `vl176-webbuild.log`.

Они в `.gitignore` (`*.log`), но засоряют рабочую директорию и попадают в листинги агента (расход контекста).

**Что делать:** чистка + `vibelog doctor --fix` или `vibelog clean`, который убирает `*.log` и `tmp/`.

### 1.4. Пустой документ `doc-15` **[факт]**

`backlog/docs/doc-15.md`: `title: ""`, `content: ""`, создан 2026-10-29. Мусорная запись в корпусе документов.

**Что делать:** удалить.

## 2. Дрейф документации

### 2.1. `MCP-SETUP.md` врёт про число инструментов **[факт]**

Строка 37: «Всего 29 инструментов». `doctor.ts` ожидает **44**.

В таблице `MCP-SETUP.md` отсутствуют:

- все `lesson_*` (8 инструментов: list/create/view/update/search/link/supersede/audit, плюс `lesson_classify`);
- `project_map`;
- `backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`;
- `backlog_finish_phase`.

Документ отстал примерно на 15 инструментов — а это первое, что читает новый пользователь.

**Что делать:** актуализировать таблицу; в идеале — генерировать её из `listTools()`, чтобы дрейф не повторялся.

### 2.2. `doc-8` (MCP-справочник) — проверить на тот же дрейф **[идея]**

Если `MCP-SETUP.md` отстал на 15 инструментов, `doc-8` почти наверняка тоже. Нужна сверка.

## 3. Инфраструктура, которой нет

### 3.1. Нет линтера для `src/` **[факт]**

`package.json`: `"lint": "node --check bin/vibelog.mjs && node --check bin/vibelog-agent.mjs"` — линт проверяет **два .mjs-файла** и всё.

При этом:

- `src/` — 123 TS-модуля, не линтуются вообще;
- `web/` — полноценный `eslint.config.js` с `typescript-eslint`, `react-hooks`, `react-refresh`.

Асимметрия: фронт линтуется, бэкенд — нет.

**Что делать:** `eslint.config.js` для `src/` (typescript-eslint recommended + правила проекта: запрет `any`, `consistent-type-imports`, `no-unused-vars`). Начать с `recommended` без строгих правил, чтобы не утонуть в существующих нарушениях.

### 3.2. Нет CI **[факт]**

`.github/` отсутствует. `pnpm test` (130 файлов, 2436 тестов) гоняется только вручную и только внутри фаз агента. Нет ни одного автоматического прогона на push.

**Почему это главный риск:** агент коммитит в ветки и мержит. Сломанный master обнаруживается на следующей задаче, а не сразу.

**Что делать:** минимальный CI — `pnpm build && pnpm test` на push/PR. Плюс `web: typecheck && lint && build`.

### 3.3. Нет `.editorconfig` / prettier для `src/` **[факт]**

`web/` имеет prettier + `prettier-plugin-tailwindcss`. `src/` — нет. Форматирование держится на дисциплине.

## 4. Производительность

### 4.1. `listTasks` парсит все файлы на каждый вызов **[факт]**

`src/core/store.ts`: `readdirSync` + `readFileSync` + `markdownToTask` для каждого `.md` в `backlog/tasks/`.

Вызывается из: `backlog_search`, `backlog_list_tasks`, `backlog_ready`, `globalSearch`, веб-API (`/api/tasks`), `doctor`, `board`.

При 291 задаче (текущее состояние) каждый поиск — это 291 чтение файла и полный YAML-парс. В веб-чате `globalSearch` вызывается на каждый ход.

**Что делать:** кэш по `(путь, mtime, size)` в памяти процесса, инвалидация по mtime. Или индекс-файл. Замер до/после обязателен.

### 4.2. `backlog/tasks/` — 291 файл в одной папке **[факт]**

`readdirSync` + сортировка на каждый вызов. Не критично сейчас, станет заметно при 1000+.

## 5. Пробелы в API/CLI

### 5.1. `--json` есть не везде **[факт]**

Есть у: `doctor`, `map`, `search`, `task`, `version`.
Нет у: `board`, `milestone`, `doc`, `reference`, `lesson`, `experiment`, `config`, `model`.

Половина CLI не пригодна для скриптов и для агента.

### 5.2. Нет `vibelog status` **[идея]**

Сводка «где я» размазана: `backlog_phase_status`, `backlog_auto_queue status`, `backlog_supervisor status`, `git status`, `vibelog version`. Одна команда, собирающая всё, — дешёвая и полезная.

### 5.3. Нет проверки целостности ссылок **[идея]**

Не проверяется:

- `task.references` → существующие `ref-N`;
- `task.lessons` → существующие `lesson-N`;
- `dependencies` → существующие задачи;
- `parent_task_id` → существующая задача.

`lesson_audit` делает это для lessons, для задач — никто. Битые ссылки в frontmatter сейчас невидимы.

## 6. Пробелы в веб-UI

Покрыто: задачи (board/list/table), references, documents, lessons, чат, settings, config.

Не покрыто:

| Сущность | CLI | MCP | Web |
|---|---|---|---|
| Milestones | да | 5 инструментов | **нет** |
| Decisions (ADR) | да | нет | нет |
| Drafts | да | нет | нет |
| Experiments | 7 подкоманд | нет | нет |

**Замечание:** `milestone` — это колонка в таблице задач (`#/tasks`), то есть пользователь видит веху, но не может её создать или открыть. Самый заметный пробел.

**Experiments** — свежий эпик (VL-293…VL-298) с CLI, у которого нет ни веб-страницы, ни MCP-инструментов: агенту они недоступны.

---

# Часть II. Jira-фичи, уровень 1 — дёшево, markdown-нативно

## J1. История изменений задачи (changelog)

**Проблема.** Jira показывает «кто, когда, что изменил». У нас только комментарии, и по ним не восстановить, почему задача в этом статусе. Для агента это критично: он не знает, что задачу уже пытались делать и откатили.

**Дизайн.** Новая секция `<!-- HISTORY:BEGIN -->` с append-only строками:

```
- 2026-11-02 12:00 @agent: status To Do → Spec
- 2026-11-02 12:40 @agent: phase spec завершена
```

Пишется в `finish_phase` и `update_task`. Обратная совместимость полная — новая секция, Backlog.md её проигнорирует.

**Открывает:** time-in-status (J14), cycle time (C5 второго агента), activity feed (B5 второго агента).

## J2. Типизированные связи задач (issue links)

**Проблема.** Сейчас `dependencies` — это только «blocks». Jira различает: blocks / is blocked by / relates to / duplicates / clones / caused by. Без этого граф задач плоский.

**Дизайн.** Additive-поле `links: [{type: relates, id: VL-5}]` рядом с `dependencies` (которое остаётся для совместимости). В карточке — блок «Связанные».

**Открывает:** граф связей (B4 второго агента), resolution `duplicate` (A1 второго агента).

## J3. Сохранённые фильтры (saved filters)

**Проблема.** Фильтры живут в localStorage веба и в флагах CLI. Jira даёт именованный фильтр, доступный всем и переиспользуемый.

**Дизайн.** `backlog/filters/<name>.yml` — `{query, status, labels, priority, sort}`.

- `vibelog filter run my-filter`
- `#/tasks?filter=my-filter`
- MCP `backlog_search{filter: "..."}`

Даёт «Мои задачи», «Просроченные», «Без оценки» без повторного набора флагов.

**Открывает:** quick filters на доске (B3 второго агента), digest в Telegram (C1 второго агента).

## J4. WIP-лимиты на колонках

**Проблема.** Jira Kanban: `In Progress: max 3`. У нас колонки без ограничений.

**Дизайн.** `wip_limits: {In Progress: 3}` в `config.yml`. В вебе — счётчик `2/3` и красная подсветка при превышении; в `backlog_update_status` — предупреждение (не блокировка).

## J5. Bulk-операции

**Проблема.** Jira bulk edit. У нас `task edit` по одной — при реорганизации 50 задач это 50 вызовов.

**Дизайн.** `vibelog task bulk --filter "status=Backlog" --set priority=Low --add-label cleanup`. Плюс MCP-инструмент.

## J6. Smart commits

**Проблема.** Jira: `PROJ-123 #comment текст #time 2h #close`. У нас есть `task-commit.ts`, но без директив.

**Дизайн.** Парсить в commit message: `VL-123 #comment ... #status Done #time 2h`.

## J7. Sprints (итерации)

**Проблема.** Самая «джировская» дыра. У нас `milestone` — это релиз, а не итерация. Нет планирования «что берём в этот двухнедельный спринт», нет burndown, нет velocity.

**Дизайн.** `backlog/sprints/sprint-1.md` (даты, цель, список задач) + поле `sprint` в задаче. Веб: `#/sprints` — активный спринт, burndown, velocity по закрытым.

**Зависит от:** оценок (J8).

## J8. Оценки (story points / estimate)

**Проблема.** Без оценок burndown и velocity бессмысленны. Jira: original estimate, remaining, time spent.

**Дизайн.** `estimate: 3` (число) + `time_spent: 0` в frontmatter.

**Открытый вопрос:** в чём мерить — story points (абстрактно) или часы (сравнимо с `token_usage`)?

## J9. Worklog (учёт времени человека)

**Проблема.** Jira worklog: кто, когда, сколько, комментарий. У нас billing считает **токены**, но не человеко-часы — а вопрос «сколько реально заняло» задаётся чаще.

**Дизайн.** Секция `<!-- WORKLOG:BEGIN -->` с записями `- 2026-11-02 @bob 2h: разбирался с миграцией`. Даёт «оценка vs факт» и «куда ушло время».

## J10. Swimlanes на канбане

**Проблема.** Jira: группировка доски по assignee / priority / epic / milestone.

**Дизайн.** Чисто веб, дёшево, сразу делает доску читаемой при 50+ задачах.

## J11. JQL-lite

**Проблема.** Полный JQL — крупно, но подмножество очень мощно: `status = "In Progress" AND priority in (High, Medium) AND labels has web AND updated < -7d`. Сейчас `backlog_search` умеет только точные совпадения полей.

**Дизайн.** Парсер подмножества: `=`, `!=`, `in`, `has`, `AND`/`OR`, относительные даты (`-7d`).

**Почему важно для агента:** разница между «найди похожее» и «дай точный список».

## J12. Definition of Ready

**Проблема.** У нас есть DoD, но нет DoR — «задача готова к работе, если есть AC, оценка, assignee».

**Дизайн.** Копия DoD-механики (секция `<!-- DOR:BEGIN -->`), проверка при переходе в Spec.

## J13. Flagged / Blocked с причиной

**Проблема.** У нас есть статус `Blocked`, но нет «флаг + причина + кто и когда снял». Jira: флаг ставится отдельно от статуса.

**Дизайн.** `flagged: {reason, by, at}` в frontmatter. В вебе — иконка на карточке.

## J14. Time in status

**Проблема.** Сколько задача провела в каждом статусе. У нас есть длительности фаз в billing, но не «задача висела в Review 3 недели».

**Дизайн.** Считается из истории (J1) — почти бесплатно, если история есть.

## J15. Epic panel / прогресс эпика

**Проблема.** У нас `type: epic` + `parent_task_id`, но в вебе нет «эпик → его задачи → прогресс».

**Дизайн.** Панель эпика в вебе. Дёшево-средне.

---

# Часть III. Jira-фичи, уровень 2 — средние, дают новое качество

## J16. Custom fields

**Проблема.** Произвольные поля по типам.

**Риск.** Ломает совместимость с Backlog.md (чужие ключи в frontmatter).

**Рекомендация:** не брать.

## J17. Attachments

**Риск.** Ломает markdown-нативность.

**Рекомендация:** не брать.

## J18. Permissions / роли

**Статус.** Это multi-tenant, уже отложено в roadmap (F2).

## J19. Полноценные отчёты

Cumulative flow, control chart, sprint report.

**Зависит от:** J7 (sprints) и J8 (оценки).

## J20. Watchers / подписки на задачу

**Проблема.** У бота есть уведомления о фазах, но не «подпишись на VL-5».

**Оценка.** Средне, полезно только при нескольких людях.

---

# Часть V. Предложения второго агента

Только то, чего не было в списке выше.

## Уровень A — дёшево, канонично для Jira, разблокирует другое

### A1. Resolution — «почему закрыто», отдельно от статуса

**Проблема.** Jira: Resolution (Done / Won't Do / Duplicate / Cannot Reproduce) — ортогонален статусу, спрашивается на transition-экране при закрытии. У нас есть только статусы `Done`/`Rejected`, и «почему» теряется в комментариях.

**Дизайн.** Additive-поле `resolution` в frontmatter, пишется при close/reject. Значения в `config.yml` (`resolutions`), дефолт — `done`. Обязателен при переходе в терминальный статус (см. A2). Пара с typed links: `duplicate` резолв → ссылка `duplicates` на оригинал.

Backlog.md проигнорирует ключ, как уже игнорирует `references`/`lessons`.

### A2. Transition validators — декларативные правила перехода

**Проблема.** Jira: у перехода есть conditions/validators (нельзя в Done с открытыми sub-tasks, нельзя в Code без плана). У нас `canMoveTo`/`isPhaseAllowed` (VL-188) проверяют только «есть ли такой переход», а содержательные запреты живут в промптах и частично в VL-248 (`finish_phase` + DoD).

**Дизайн.** `transition_rules` в `settings.json`:

```yaml
transition_rules:
  - from: Review
    to: Done
    require: [dod_checked, no_open_subtasks, resolution_set]
```

Единая точка — та же, где `canMoveTo` (MCP `backlog_update_status`/`finish_phase`, веб PATCH, CLI).

**Почему важно.** Это обобщение VL-248 и лучший способ не «забывать» инварианты, которые сейчас держатся только текстом шаблона.

### A3. Issue templates + required fields per type

**Проблема.** Jira: field configuration schemes — у bug обязательны severity/steps, у story — acceptance criteria. У нас DoR (J12) — это чек-лист, а не схема.

**Дизайн.**

- `templates/tasks/bug.md` (скелет description + дефолтные AC/labels) + `vibelog task create --template bug`;
- `required_fields: {bug: [severity]}` в `config.yml`, проверка на переходе в Spec и в `backlog_create_task` — чтобы агент получал ошибку сразу, а не в фазе.

### A4. Development panel — коммиты/ветки/PR по задаче

**Проблема.** Jira: панель Development в карточке (branches, commits, PRs). У нас `task-commit.ts` уже коммитит `docs(task): VL-N …`, smart commits обсуждаются (J6), но в карточке этого не видно, а агенту приходится искать `git log` вручную.

**Дизайн.** `git log --grep` + парсинг trailers.

- `vibelog task commits VL-N`
- MCP `backlog_commits{id}`
- вкладка «Коммиты» в веб-карточке (хэш, дата, тема)

После smart commits — ещё и директивы (`#status`, `#comment`).

### A5. Clone issue

**Проблема.** Jira: Clone с опцией копировать sub-tasks и links. У нас `task create` с нуля.

**Дизайн.** `vibelog task clone VL-5 [--with-subtasks] [--with-ac]`, MCP `backlog_clone_task`; в typed links — тип `clones`.

## Уровень B — views и планирование

### B1. Releases lifecycle поверх milestone

**Проблема.** В прошлом списке milestone = Fix Version. Чего нет — жизненного цикла релиза, как в Jira Releases: `status: unreleased|released|archived`, `release_date`, прогресс (done/total), release notes из Done-задач, действие «release» с переносом незакрытых в следующий milestone.

**Дизайн.** Additive-поля в `backlog/milestones/*.md`; `vibelog milestone release <name> --move-unresolved-to <next>`; страница `#/releases`. Совместимость полная (новые ключи фронтматтера).

### B2. Calendar и Timeline

**Проблема.** Два экрана Jira, которых у нас нет.

- **Calendar** — задачи по `due_date` (месяц/неделя).
- **Timeline** — эпики/вехи на оси времени с линиями зависимостей (данные уже есть: `dependencies`, `due_date`, `created_date`).

Чисто веб, высокая видимость. Timeline закрывает «epic panel» (J15) с другой стороны.

### B3. Quick filters на доске + суммы по колонкам

**Проблема.** Jira: чипы «Only my issues», «Recently updated» над доской; в заголовке колонки — count и сумма estimate. У нас фильтры живут на отдельной странице `#/tasks`.

**Дизайн.** Чипы из saved filters (J3) + встроенные «Мои», «Просроченные», «Без оценки»; суммы — после estimates (J8).

### B4. Граф связей задач

**Проблема.** Jira показывает связанные issues списком; граф — уже наша добавка.

**Дизайн.** Когда появятся typed links (J2) — `#/graph` или вкладка «Связи» в карточке: узлы-задачи, рёбра по типу связи/зависимости.

### B5. «Your work» / activity feed

**Проблема.** Jira: домашняя страница «Your work» (assigned to me, recently viewed, activity stream). У нас `#/` — сразу канбан.

**Дизайн.** После history (J1) почти бесплатно: `#/` с блоками «Мои задачи», «Недавние», «Активность» (из HISTORY-секции).

## Уровень C — производное или среднее

- **C1. Digest сохранённого фильтра в Telegram.** Jira: filter subscription (email). У нас бот: ежедневный дайджест «просроченные», «мои High» по saved filter. Зависит от J3.
- **C2. CSV export задач.** `vibelog task export --csv --filter …` для отчётов/аналитики; импорт — не брать (рискованно).
- **C3. Keyboard shortcuts в вебе.** Jira: `c` — создать, `j/k` — навигация, `/` — поиск. Дёшево, power-user.
- **C4. Sprint capacity.** Когда будут спринты — `capacity` в файле спринта и «влезаем/не влезаем» по estimates. Add-on к J7.
- **C5. Cycle time / lead time.** Прямо следует из history/time-in-status: контрольная карта «сколько задача идёт от Spec до Done». Отчёт после J1.

## Не сейчас (с критерием возврата)

- **Automation rules шире heal_rules** («при переходе в X — поставить поле Y»). Supervisor закрывает главный сценарий (сбои фаз); критерий — когда появятся повторяющиеся ручные правила, которые жалко держать в голове.
- **Webhooks** на события задач. Критерий — внешняя интеграция (Slack/CI), которой у нас пока нет.
- **Components с owner'ом.** Labels уже покрывают измерение; критерий — когда понадобится «у компонента есть ответственный», а не просто метка.
- **Approvals как отдельное поле.** Покрывается transition validator'ом (`require: [approved]`), отдельная сущность не нужна.
- **Affects version у багов.** Вернуться вместе с Releases (B1), если появятся баг-репорты «в какой версии сломано».
- **Workflow visual editor в `#/config`.** После A2: сначала правила, потом их редактирование мышью.
- **Импорт из Jira.** Ниша; наша аудитория — наоборот, уходит с Jira.

---

# Часть VI. Сводная таблица и волны

## Сводная таблица

| # | Пункт | Часть | Цена | Ценность | Зависит от |
|---|---|---|---|---|---|
| 1.1 | `.vibelog/.gitignore` + убрать из корневого | I | S | Высокая | — |
| 1.2 | `doctor`: убрать хардкод 44 | I | S | Средняя | — |
| 1.3 | Чистка логов | I | XS | Низкая | — |
| 1.4 | Удалить `doc-15` | I | XS | Низкая | — |
| 2.1 | `MCP-SETUP.md` актуализировать | I | S | Высокая | — |
| 3.1 | eslint для `src/` | I | M | Высокая | — |
| 3.2 | CI (`pnpm test` на push) | I | M | Высокая | — |
| 4.1 | Кэш `listTasks` по mtime | I | M | Средняя | — |
| 5.1 | `--json` для остальных команд | I | S | Средняя | — |
| 5.2 | `vibelog status` | I | S | Средняя | — |
| 5.3 | Проверка целостности ссылок | I | S | Средняя | — |
| 6 | `#/milestones` в вебе | I | M | Высокая | — |
| 6 | MCP для experiments | I | S | Средняя | — |
| J1 | История изменений | II | M | **Высокая** | — |
| J2 | Типизированные связи | II | S | **Высокая** | — |
| J3 | Сохранённые фильтры | II | S | **Высокая** | — |
| J4 | WIP-лимиты | II | XS | Средняя | — |
| J5 | Bulk-операции | II | S | Высокая | — |
| J6 | Smart commits | II | S | Средняя | — |
| J7 | Sprints | II | L | Высокая | J8 |
| J8 | Оценки | II | S | Высокая | — |
| J9 | Worklog | II | S | Средняя | — |
| J10 | Swimlanes | II | S | Средняя | — |
| J11 | JQL-lite | II | M | **Высокая** | — |
| J12 | Definition of Ready | II | S | Средняя | — |
| J13 | Flagged с причиной | II | XS | Средняя | — |
| J14 | Time in status | II | S | Средняя | J1 |
| J15 | Epic panel | II | S | Средняя | — |
| A1 | Resolution | V | S | **Высокая** | A2 |
| A2 | Transition validators | V | M | **Высокая** | — |
| A3 | Issue templates + required fields | V | S | Высокая | — |
| A4 | Development panel | V | S | Средняя | J6 |
| A5 | Clone issue | V | S | Средняя | J2 |
| B1 | Releases lifecycle | V | M | Средняя | — |
| B2 | Calendar / Timeline | V | M | Средняя | — |
| B3 | Quick filters + суммы | V | S | Средняя | J3, J8 |
| B4 | Граф связей | V | M | Низкая | J2 |
| B5 | Your work / activity | V | S | Средняя | J1 |
| C1 | Digest фильтра в Telegram | V | M | Средняя | J3 |
| C2 | CSV export | V | S | Низкая | — |
| C3 | Keyboard shortcuts | V | S | Низкая | — |
| C4 | Sprint capacity | V | S | Низкая | J7 |
| C5 | Cycle time | V | S | Средняя | J1 |

Цена: XS — часы, S — день, M — несколько дней, L — неделя+.

## Волны

**Волна 0 — гигиена (сразу, без обсуждения).**
1.1, 1.2, 1.3, 1.4, 2.1. Это не фичи, а починка того, что сломано.

**Волна 1 — фундамент данных.**
J1 (история), J2 (typed links), J3 (saved filters), A1 (resolution), A2 (transition validators), A3 (templates).

Почему вместе: они дополняют друг друга и разблокируют половину остального. A1 требует A2 (обязательность resolution на переходе), A5 требует J2, J14/B5/C5 требуют J1, B3/C1 требуют J3.

**Волна 1.5 — инфраструктура доверия.**
3.1 (eslint), 3.2 (CI). Пока агент не имеет страховки, автономные прогоны — риск.

**Волна 2 — планирование.**
J8 (оценки), J7 (sprints), J12 (DoR), J4 (WIP), J5 (bulk), J6 (smart commits), A4 (dev panel), A5 (clone).

**Волна 3 — видимость.**
6 (`#/milestones`), J10 (swimlanes), J15 (epic panel), B1 (releases), B2 (calendar/timeline), B3 (quick filters), B5 (your work), J14 (time in status), C5 (cycle time).

**Волна 4 — мощность.**
J11 (JQL-lite), J9 (worklog), B4 (граф), C1 (digest), C2 (CSV), C3 (shortcuts), C4 (capacity).

**Не делать:** J16 (custom fields), J17 (attachments), J18 (permissions — это F2), импорт из Jira.

## Как это ложится в существующий roadmap

В ROADMAP.md сейчас: Experiments v2 (VL-299/300/301) → Init wizard (VL-210) → Переносимый `.vibelog/` → Аналитика → VPS.

Предложение второго агента: вставить «Волну 1.5» (A1–A4) сразу после B1/B3, потому что они дешёвые, не конфликтуют с wizard (только дополняют `config.yml`/`settings.json`) и улучшают ровно те фазы (Spec/Close), где агент сейчас держит инварианты «на честном слове».

**Моя оценка:** это верно, но с оговоркой — A2 (transition validators) меняет поведение всех четырёх поверхностей (MCP/веб/CLI/бот). Это не «дополнение», а изменение контракта. Его надо делать отдельной задачей с явным планом миграции, а не «заодно с wizard».

---

# Часть VII. Открытые решения

Принять до создания задач.

## По инженерной части

1. **CI-платформа.** GitHub Actions недоступен (репозиторий на gitverse.ru). Варианты: gitverse CI (если есть), self-hosted runner, или git-hook `pre-push` с `pnpm test`. Что выбираем?
2. **eslint для `src/`.** Начинать с `recommended` (много существующих нарушений) или сразу со строгих правил и чинить по ходу?
3. **Кэш `listTasks`.** В памяти процесса (просто, но сбрасывается при рестарте) или индекс-файл в `.vibelog/` (переживает рестарт, но требует инвалидации)?

## По Jira-части

4. **Набор `resolutions`** — фиксированный (`done/wontfix/duplicate/cannot_reproduce`) или конфигурируемый? Предложение второго агента: дефолт фиксированный + override в `config.yml`.
5. **Где enforced transition validators** — одна функция рядом с `canMoveTo`, которую зовут все четыре поверхности (MCP/веб/CLI/бот)? Иначе разъедется, как разъезжался `phaseTaskId` до VL-243.
6. **Шаблоны задач** — `templates/tasks/<type>.md` (в пакете) с проектным override `.vibelog/templates/tasks/<type>.md`, по образцу phase-шаблонов? Предложение: да.
7. **Dev panel scope** — только коммиты (дёшево) или сразу ветка/PR (нужен парсинг remote)? Предложение: MVP — коммиты, PR — после smart commits.
8. **Оценки: story points или часы?** Story points абстрактны и не сравнимы с `token_usage`; часы сравнимы, но требуют дисциплины ввода. Или оба поля?
9. **Sprints: где живёт активный спринт?** Отдельный файл `backlog/sprints/active.yml` или поле `sprint` в задачах + вычисление «активный = тот, у которого даты покрывают сегодня»?
10. **JQL-lite: свой парсер или подмножество через существующие фильтры?** Свой парсер — гибче, но это новый язык в проекте. Подмножество — дешевле, но упрётся в потолок.

## По приоритету

11. **Что важнее: Jira-фичи или Experiments v2 / Init wizard?** Сейчас в roadmap Experiments v2 и wizard. Jira-фичи — новая ветка. Нужно решить, вытесняют они или идут параллельно.
12. **Волна 0 (гигиена) — делаем сразу или ждём?** Пункты 1.1–2.1 — это часы работы и они чинят реальные проблемы. Я бы сделал сразу, не дожидаясь решений по остальному.

---

# Приложение: что уже есть из Jira (не предлагать повторно)

| Jira | У нас |
|---|---|
| Issue + workflow + transitions | статусы + workflow-фазы |
| Epic / Subtask | `type: epic` + `parent_task_id` |
| Labels, Priority, Type, Assignee, Reporter, Due date | всё в frontmatter |
| Fix Version | `milestone` |
| Comments | `comments` |
| Issue links «blocks» | `dependencies` |
| Board, backlog ranking | канбан + `ordinal` |
| Filters, search | `backlog_search` с ранжированием |
| Bulk-переходы | auto-queue / supervisor |
| Automation | supervisor + heal-rules |
| Time tracking | `token_usage` (токены, не часы) |
| Reports (частично) | billing, планируется аналитика |
