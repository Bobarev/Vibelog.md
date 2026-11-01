---
id: doc-6
title: Руководство пользователя Vibelog.md
type: readme
created_date: 2026-10-06
tags:
  - user-guide
  - руководство
  - vl-19
---
# Руководство пользователя Vibelog.md

Markdown-нативный таск-менеджер для git-репозиториев, совместимый с Backlog.md.
Node.js 20+, macOS 10.15 Catalina + Qwen Code. Runtime-зависимость — grammy (Telegram-бот).

## Содержание

1. [Установка и инициализация](#1-установка-и-инициализация)
2. [Задачи](#2-задачи)
3. [Вехи (milestones)](#3-ветки-milestones)
4. [Типы задач](#4-типы-задач)
5. [Документы](#5-документы)
6. [Черновики](#6-черновики)
7. [Решения (ADR)](#7-решения-adr)
8. [Конфигурация](#8-конфигурация)
9. [Поиск](#9-поиск)
10. [Доска и веб-интерфейс](#10-доска-и-веб-интерфейс)
11. [Telegram-бот](#11-telegram-бот)
12. [Форматы файлов](#12-форматы-файлов)
13. [Референсы](#13-референсы-vl-152)
14. [Lessons learned](#14-lessons-learned-vl-153)
15. [Диагностика](#15-диагностика)

Справочники: [CLI](cli-reference.md) · [MCP](mcp-reference.md) · [Best practices](best-practices.md) · [MCP-подключение](../MCP-SETUP.md)

---

## 1. Установка и инициализация

```bash
pnpm install
pnpm link --global   # команда vibelog в PATH
```

Инициализация backlog-а в корне git-репозитория:

```bash
vibelog init "Мой проект"            # префикс задач по умолчанию LB
vibelog init "API" --prefix api      # свой префикс: api-1, api-2, ...
vibelog init "X" --no-mcp            # без автонастройки MCP-сервера
```

Что создаёт `init`:

- `backlog/` с подпапками `tasks/`, `completed/`, `drafts/`, `docs/`, `decisions/`, `milestones/`
- `backlog/config.yml` — конфигурация проекта
- `.qwen/settings.json` — секция `mcpServers.vibelog` (автонастройка MCP для Qwen Code; отключение `--no-mcp`)
- `.vibelog/settings.json` — единый файл настроек (VL-143): кэш `git_user_name` (VL-44), настройки бота и секция `env` с секретами. Имя автора комментариев берётся из кэша, без спавна `git config` на каждый комментарий. При `--force` кэш перечитывается из git config. Файл в `.gitignore` — машинная настройка (секция `env` содержит секреты), не коммитится. Если кэша нет или он пуст — используется текущий каскад `git config user.name` → `@agent`

Повторный `init` на инициализированном проекте отклоняется; перезапись — `--force`.

CLI при запуске проверяет npm registry на новую версию (не чаще раза в сутки) и при наличии обновления печатает в stderr уведомление `npm install -g vibelog.md` — без автоустановки. Отключение: `VIBELOG_SKIP_UPDATE_CHECK=true`. Для `vb bot` и `vb browser` проверка выполняется при запуске (до старта сервиса), уведомление печатается в stderr сразу после старта. Подробнее: [CLI — Автообновление](cli-reference.md#автообновление).

---

## 2. Задачи

### 2.1 Создание

```bash
vibelog task create "Добавить авторизацию" -d "Реализовать JWT-токены"
```

Все флаги `create`:

| Флаг | Что делает |
|---|---|
| `-d, --description` | Описание задачи |
| `--ac "текст"` | Критерий приёмки (флаг повторяется) |
| `--dod "текст"` | Критерий Definition of Done (повторяется). Без флагов подставляются дефолты из конфига (`definition_of_done`) |
| `--no-dod-defaults` | Не подставлять дефолты DoD |
| `--priority High\|Medium\|Low` | Приоритет |
| `--labels a,b` | Метки (через запятую) |
| `--deps api-1,api-2` | Зависимости (ID задач) |
| `--milestone v1.4` | Привязка к вехе |
| `--type bug` | Тип задачи (см. [Типы](#4-типы-задач)) |
| `--project web` | Проект |
| `--parent api-1` | Родительская задача (валидируется существование) |
| `--ordinal N` | Порядковый номер для кастомной сортировки |
| `--plan "текст"` | Сразу заполнить Implementation Plan |
| `--notes "текст"` | Сразу заполнить Implementation Notes |
| `--final-summary "текст"` | Итоговое резюме (для завершённых задач) |
| `--draft` | Создать черновик вместо задачи (см. [Черновики](#6-черновики)) |

Пример:

```bash
vibelog task create "Рефакторинг поиска" \
  --type refactor --priority High --labels backend,v1.5 \
  --ac "Тесты проходят" --ac "Нет регрессий" \
  --plan "1. Выделить ядро поиска" --notes "Смотреть search.mjs"
```

### 2.2 Список

```bash
vibelog task list                          # все задачи
vibelog task list -s "To Do"               # по статусу
vibelog task list --type bug               # по типу
vibelog task list -l backend               # по метке
vibelog task list --ready                  # без невыполненных блокеров
vibelog task list --sort priority          # сортировка: priority|created|updated
vibelog task list --limit 10 --skip 5      # обрезка после фильтрации
vibelog task list --json                   # JSON для скриптов
```

Флаги комбинируются (AND): `vibelog task list --type bug --ready --sort priority`.

### 2.3 Просмотр

```bash
vibelog task view api-1        # карточка задачи
vibelog task view api-1 --json # то же в JSON
```

### 2.4 Редактирование

```bash
vibelog task edit api-1 --status "In Progress"
vibelog task edit api-1 --priority High --title "Новый заголовок"
vibelog task edit api-1 --ac "Новый критерий"        # добавить AC
vibelog task edit api-1 --check-ac 1,3                # отметить критерии №1 и №3 за один вызов
vibelog task edit api-1 --check-dod 1,2               # то же для DoD
vibelog task edit api-1 --uncheck-ac 2                # снять отметку
vibelog task edit api-1 --comment "Прогресс: 50%"     # добавить комментарий
vibelog task edit api-1 --remove-label urgent         # убрать метку
vibelog task edit api-1 --plan "1. Шаг" --notes "Заметка"
vibelog task edit api-1 --append-notes "Ещё строка"   # дописать в заметки
vibelog task edit api-1 --final-summary "Готово"      # заменить резюме
vibelog task edit api-1 --append-final-summary "и выкачено"
vibelog task edit api-1 --clear-final-summary         # очистить резюме
vibelog task edit api-1 --ordinal 5                   # порядок сортировки
vibelog task edit api-1 --deps api-2                  # заменить зависимости
vibelog task edit api-1 --assignee pavel              # исполнитель
```

`--check-ac`/`--check-dod` принимают несколько индексов через запятую — один вызов вместо трёх.

### 2.5 Завершение и архивация

```bash
vibelog task complete api-1   # статус → Done
vibelog task archive api-1    # перенос в backlog/completed/
```

---

## 3. Вехи (milestones)

Веха — релиз или этап, к которому привязаны задачи (`--milestone`).

```bash
vibelog milestone add v1.5 -d "Релиз поиска" --due-date 2026-12-01
vibelog milestone list                  # активные вехи
vibelog milestone list --show-completed # + архивные
vibelog milestone rename v1.5 v1.6      # обновляет milestone в задачах
vibelog milestone rename v1.5 v1.6 --no-update-tasks  # без обновления задач
vibelog milestone remove v1.6                                  # + clear задач (по умолчанию)
vibelog milestone remove v1.6 --task-handling keep             # задачи сохраняют веху
vibelog milestone remove v1.6 --task-handling reassign --reassign-to v1.7
vibelog milestone archive v1.6         # перенос в backlog/completed/
```

Файлы: `backlog/milestones/<slug>.md`. Задачи вехи: `vibelog task list` + фильтр в JSON или `backlog_search` с `milestone`.

---

## 4. Типы задач

Типы описываются в конфиге (по умолчанию: `bug`, `feature`, `enhancement`, `task`, `chore`, `docs`, `spike`):

```bash
vibelog config get types
vibelog config set types "bug,feature,docs"   # свой список
```

Использование:

```bash
vibelog task create "Падение логина" --type bug
vibelog task list --type bug
vibelog task edit api-1 --type enhancement
```

Валидация case-insensitive: `--type Bug` сохранится как `bug`; неизвестный тип — ошибка со списком допустимых.

---

## 5. Документы

Документы — спецификации, гайды, README в `backlog/docs/`.

```bash
vibelog doc create "Гайд API" --type guide --tags api,internal
vibelog doc list                # все документы
vibelog doc list --type guide   # фильтр по типу
vibelog doc view doc-1
vibelog doc update doc-1 --title "Гайд API v2" --tags api
vibelog doc search "миграция"
```

Типы: `readme`, `guide`, `specification`, `other` (по умолчанию `other`). ID: `doc-1`, `doc-2`, ...

---

## 6. Черновики

Черновики — быстрый захват идей до формализации. Хранятся в `backlog/drafts/`, статус `Draft`.

```bash
vibelog draft create "Идея виджета" -d "Быстрый захват" -l idea
vibelog draft list
vibelog draft view draft-1
vibelog draft edit draft-1 --title "Идея (уточнена)" -d "Новое описание"
vibelog draft promote draft-1   # черновик → задача (id из конфига, статус To Do)
vibelog draft archive draft-1   # перенос в backlog/completed/
```

Альтернатива — `vibelog task create "Идея" --draft`: черновик создаётся из команды задач.

Взаимодействие с AI-агентом: попросите агента оформить идею как черновик, а вечером — `promote` зрелых черновиков.


---

## 7. Решения (ADR)

Архитектурные решения фиксируются в `backlog/decisions/` (формат ADR).

```bash
vibelog decision create "Перейти на pnpm" -s accepted \
  --context "npm тянет лишние зависимости" \
  --decision "Использовать pnpm 10" \
  --consequences "Лок-файл pnpm-lock.yaml"
vibelog decision list                 # все решения
vibelog decision list --status accepted
vibelog decision view decision-1      # карточка + ADR-тело
```

Статусы: `proposed` (по умолчанию), `accepted`, `rejected`, `superseded` — свободная форма, как в оригинале Backlog.md.

---

## 8. Конфигурация

`backlog/config.yml` управляется командой (без ручного редактирования YAML):

```bash
vibelog config list                              # все ключи
vibelog config get project_name                  # значение
vibelog config get statuses                      # массив → JSON
vibelog config set default_port 8080             # число
vibelog config set auto_commit true              # boolean
vibelog config set priorities "High,Low"         # массив через запятую
vibelog config set types '["bug","feature"]'     # массив через JSON
vibelog config set default_editor nvim           # строка
```

Типизация `set` определяется ключом: массивы (`statuses`, `labels`, `priorities`, `types`, `definition_of_done`), boolean, числа (`default_port`, `active_branch_days`, `max_column_width`), строки. Неизвестный ключ — ошибка со списком допустимых.

### Модели и провайдеры LLM (VL-209)

`.vibelog/settings.json` содержит единый реестр LLM-провайдеров и моделей (секции `providers` + `models`), из которого резолвятся клиент фаз, TUI-чат и веб-чат:

```json
{
  "providers": {
    "routerai": { "base_url": "https://routerai.ru/api/v1", "api_key_env": "ROUTERAI_API_KEY" }
  },
  "models": {
    "default": "routerai/xiaomi/mimo-v2.6-pro",
    "available": {
      "routerai/xiaomi/mimo-v2.6-pro": {
        "label": "MiMo v2.6 Pro", "provider": "routerai",
        "model": "xiaomi/mimo-v2.6-pro", "api_mode": "chat",
        "pricing": { "input_per_1m": 1.2, "output_per_1m": 6, "cache_per_1m": 0.3 }
      }
    }
  }
}
```

- `provider` модели — ссылка на `providers[<id>]`; ключ читается из env по `api_key_env` (приоритет VL-143: env → `.env` → `env`-секция settings.json), fallback — прямой `provider.api_key` (не для секретов). `base_url` у провайдера обязателен.
- `api_mode` — `chat` | `responses` (VL-205); `pricing` — тарифы для billing (VL-198, см. «Учёт токенов и pricing» ниже).
- Без секции `models` — полный fallback на старое поведение (env `VIBELOG_LLM_MODEL` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_BASE_URL`), ничего не ломается. Неизвестный `provider` у модели, отсутствующий `base_url` или незаданная переменная `api_key_env` — понятная ошибка валидации при старте фазы.
- Переключение: CLI `vibelog model list|use <id>|current` и `vibelog provider list` (без значений ключей — только статус «задан/не задан»); бот `/model` (список) и `/set model <id>` (регистр id сохраняется); веб — селект модели на `#/settings` (`GET/PUT /api/models`) и переключатель в шапке сайдбара тредов чата. На старте фазы в stderr печатается `Модель: <label> (<id>), api_mode: …` (для logTail оркестратора).

### Workflow с переходами статус (VL-188)

Статус первичен: задача начинается со статуса, фаза переводит её в новый статус. Цепочки переходов описываются в `.vibelog/settings.json` — ключи `workflows` (сами workflow) и `task_workflows` (какой workflow по умолчанию для типа задачи). Единый источник — `src/core/workflow.ts` (общий для бота, веба и CLI).

Формат transition: `{ "status", "phase", "produces_status" }` — из статуса `status` запускается фаза `phase`, после которой задача получает `produces_status`. `"phase": null` — финальный статус (Done, Rejected): фаз из него нет.

```json
{
  "workflows": {
    "default": {
      "initial_status": "To Do",
      "transitions": [
        { "status": "Backlog", "phase": null, "produces_status": null },
        { "status": "To Do", "phase": "spec", "produces_status": "Spec" },
        { "status": "To Do", "phase": "reject", "produces_status": "Rejected" },
        { "status": "Spec", "phase": "plan", "produces_status": "Planned" },
        { "status": "Planned", "phase": "code", "produces_status": "Review" },
        { "status": "In Progress", "phase": "code", "produces_status": "Review" },
        { "status": "Review", "phase": "code", "produces_status": "Review" },
        { "status": "Review", "phase": "close", "produces_status": "Done" },
        { "status": "Done", "phase": null, "produces_status": null },
        { "status": "Rejected", "phase": null, "produces_status": null }
      ]
    },
    "bugfix": {
      "initial_status": "To Do",
      "transitions": [
        { "status": "To Do", "phase": "do", "produces_status": "In Progress" },
        { "status": "In Progress", "phase": "close", "produces_status": "Done" }
      ]
    },
    "simple": {
      "initial_status": "To Do",
      "transitions": [
        { "status": "To Do", "phase": "do", "produces_status": "Review" },
        { "status": "Review", "phase": "close", "produces_status": "Done" }
      ]
    },
    "investigation": {
      "initial_status": "To Do",
      "transitions": [
        { "status": "To Do", "phase": "investigate", "produces_status": "Review" },
        { "status": "Review", "phase": "materialize", "produces_status": "Done" },
        { "status": "Review", "phase": "reject", "produces_status": "Done" },
        { "status": "Done", "phase": null, "produces_status": null }
      ]
    }
  },
  "task_workflows": { "bug": "bugfix", "chore": "simple", "docs": "simple", "spike": "simple", "investigation": "investigation" },
  "phase_labels": { "investigate": "Расследование", "materialize": "Создать задачи" },
  "phase_emojis": { "investigate": "🔍", "materialize": "📦" }
}
```

- **Назначение workflow типу**: `task_workflows[тип задачи]` → имя из `workflows`; тип не указан или имя неизвестно — `default`.
- **Тип `investigation` (VL-195)** — расследование инцидента: фаза `investigate` собирает и анализирует данные (сессии, логи, git, код), создаёт документ с выводами и предложениями задач, но сами задачи НЕ создаёт → Review; фаза `materialize` создаёт согласованные предложения через `backlog_create_task` → Done; ветка `reject` → Done (фактически reject ставит Rejected и архивирует). Каждая фаза запускается ровно один раз; на время выполнения workflow-фазы статус задачи транзиентно становится In Progress (см. подраздел «Transient In Progress» ниже), а итоговый статус применяется при завершении фазы.
- **Подписи и эмодзи кнопок фаз**: ключи `phase_labels` и `phase_emojis` в `.vibelog/settings.json` (по имени фазы) приоритетнее встроенных подписей: приоритет settings → встроенный хардкод default-фаз → имя фазы. Фазы investigation/materialize в хардкод не входят — без settings кнопки подпишутся именем фазы.
- **Учёт токенов и pricing (VL-198/209)**: usage каждой фазы пишется в три уровня — мета сессии `.vibelog/agent-sessions/<sessionId>.meta.json`, frontmatter задачи `token_usage` (суммы + разбивка `by_phase`, видна в `task view`, карточке бота и веб-вкладке «Токены») и append-only `.vibelog/billing/<taskId>.json` (все сессии задачи). Деньги в задачу не пишутся: тарифы активной модели — `pricing` в `models.available[<id>]` секции `models` (VL-209: `{ "input_per_1m": …, "output_per_1m": …, "cache_per_1m": … }` — доллары за миллион токенов, источник — `getActiveModelPricing`), legacy-секция `pricing` в `.vibelog/settings.json` (карта `<model>` → тариф) поддерживается для старых конфигов; стоимость считается на лету через `calculateCost`. Запись дельтами (lesson-58) — повторные вызовы `backlog_finish_phase` не задваивают счёт.
- ⚠️ **`.vibelog/settings.json` входит в `.gitignore`** — workflow, `task_workflows`, `phase_labels` и `phase_emojis` в новый клон не переносятся сами: после клонирования перенеси их вручную (или скопируй файл целиком), иначе investigation-задачи пойдут по default-workflow.
- **Fallback**: ключей `workflows` нет (или файл битый) — встроенный `DEFAULT_WORKFLOW` (spec → plan → code → close + reject), поведение до VL-188.
- **Ветвление**: из одного статуса несколько фаз (в default: `To Do → spec` ИЛИ `reject`) — бот и веб показывают выбор кнопок; `getNextPhase` для «следующего этапа» выбирает первую не-reject фазу.
- **Ручной переход `Backlog → initial_status`** — не фаза: кнопка «▶ Взять в работу» в вебе и карточке бота либо команда `/move VL-1 "To Do"`. Финальные статусы (phase null) исходящих переходов не имеют.
- **Серверная валидация переносов**: `PATCH /api/tasks/:id` проверяет переход `canMoveTo` — перенос без транзита (например Spec → Done колонкой) → 400 «Переход … недоступен по workflow задачи» и откат доски. Кнопка фазы вне workflow → 409 «Фаза X недопустима из статуса Y». Исключение — CLI/MCP-правка `--status` и бот-команда `/status` (ручной escape-hatch без валидации).
- **Переопределение промптов фаз**: файл проекта `.vibelog/prompts/phases/phase-<имя>.md` приоритетнее встроенного `templates/phases/phase-<имя>.md` (worktree-вариант — `phase-<имя>-worktree.md` ищется в обоих каталогах); системный промпт vibelog-agent — `.vibelog/prompts/agent-prompt.md`. Если шаблон не найден ни там, ни в `templates/` — ошибка запуска.
- **Шаблоны фаз** лежат в `templates/phases/` (`phase-spec.md`, `phase-plan.md`, `phase-code.md`, `phase-do.md`, `phase-close.md`, `phase-reject.md`, `phase-investigate.md`, `phase-materialize.md` и служебные); статус после фазы подставляется в промпт как `{{producesStatus}}` — в шаблонах нет захардкоженных статусов.
- **Шаблон spec требует ОДНОГО write-вызова (VL-292)**: все определённые поля задачи (`title`, `type`, `priority`, `labels`, `description`, `references`, `acceptanceCriteria`) передаются в одном объекте аргументов одного вызова `backlog_update_task`, а ответ инструмента нужно читать: поле, уже присутствующее в `applied`, повторно не передаётся, `skipped` не «дожимается» повтором, `ok: true` → сразу отчёт `backlog_finish_phase`. Повторный вызов с уже применёнными полями (в т.ч. с идентичными аргументами) запрещён — иначе loop detection прерывает фазу. Проектным переопределениям `.vibelog/prompts/phases/phase-spec.md` нужна та же правка: копия шаблона приоритетнее встроенной.

### Transient In Progress — статус задачи на время фазы (VL-196)

Запуск любой workflow-фазы (`spec`/`plan`/`code`/`do`/`close`/`reject` и фазы других workflow) временно переводит задачу в **In Progress** — на канбане и в карточке видно, что задача «в работе». Это транзиентный статус на время выполнения фазы, а не результат перехода workflow:

- фаза завершилась успешно → статус меняется на `produces_status` текущего перехода (Spec + plan → Planned, Planned + code → Review, Review + close → Done);
- фаза провалилась → статус возвращается к тому, с которого фаза стартовала; причина (код выхода, хвост лога) добавляется комментарием от @agent;
- **аварийное завершение фазы (VL-244)** — агент передал `aborted: true` в `backlog_finish_phase`: флаг пишется в transient-кэш (`.vibelog/phase-in-progress.json`, `markPhaseAborted`), и `finalizePhaseStatus` игнорирует код выхода 0 — срабатывает та же fail-ветка: статус возвращается к дофазовому, комментарий-причина начинается с «Фаза X прервана агентом (aborted)». Без флага завершение процесса с кодом 0 применяет `produces_status` (именно так close-фаза с незавершённым merge выставляла Done); поиск слов «не завершена»/«прервана» в финальном тексте критерием не является — только диагностика;
- **аварийные ветки close-шаблонов (VL-247)** — `templates/phases/phase-close.md` и `phase-close-worktree.md` оформляют провал только по единой формуле: вызов `backlog_finish_phase {id, comment, aborted: true}` без `status` и `dodChecks` (обычный текст отчёта фреймворк считает успехом — exit 0 — и применил бы `produces_status`). Формула вынесена отдельным буллетом «Аварийный итог фазы» в раздел «Правила» шаблонов, аварийные ветки шагов («Правила»/шаг конфликта merge, шаг падения сборки/тестов и шаг итогового отчёта) ссылаются на неё — так текст одинаков в обоих шаблонах. Там же зафиксирован запрет продолжать прерванную фазу по пользовательскому сообщению в той же сессии (случай уже прерванной close и сообщения «Заверши фазу.»; внутренние ID задач в шаблоны не попадают — VL-157): прерванная фаза возобновляется **только новым раном**, в ответ на сообщение агент сообщает, что фаза прервана и требует нового запуска, и статус не меняет;
- агент сам зафиксировал статус через `backlog_finish_phase` во время фазы — его запись приоритетна, оркестратор не перетирает её;
- служебные фазы (comment/prompt/analyze/resume) статус не меняют;
- рестарт веба/бота: «зависшие» In Progress откатываются автоматически по кэшу `.vibelog/phase-in-progress.json` (исходный статус, фаза, pid процесса; запись с живым pid не трогается — фаза ещё идёт), поэтому задача не может навсегда остаться в In Progress без доступной фазы.

In Progress никогда не «производится» ни одной фазой — статус только занимается на время выполнения фазы и применяется по правилам workflow. Ручной перенос канбана из In Progress ограничен переходами workflow (только code/reject), как и раньше.

---

## 9. Поиск

```bash
vibelog search "авторизация"                  # токены (И-логика) по id/title/description/меткам, по релевантности
vibelog search --status "To Do"               # только фильтр, без запроса
vibelog search --type bug --priority High     # комбинация фильтров (AND)
vibelog search --limit 5 --json               # обрезка + JSON
```

Запрос необязателен, если указан хотя бы один фильтр. `--json` удобно пайпить в `node -e`-скрипты.

---

## 10. Доска и веб-интерфейс

```bash
vibelog board              # канбан в терминале
vibelog board --export     # markdown-экспорт
vibelog browser            # веб-интерфейс (kanban, drag-and-drop)
vibelog browser --port 8080 --no-open
vibelog browser --host 0.0.0.0        # доступ из локальной сети (VL-266)
```

Веб-сервер по умолчанию слушает только `127.0.0.1`. Чтобы открыть интерфейс с других устройств в локальной сети, запустите `vibelog browser --host 0.0.0.0` (или задайте `web_host: "0.0.0.0"` в `.vibelog/settings.json`; флаг приоритетнее настройки). При старте в консоль выводятся локальный URL и по строке `Доступ из локальной сети: http://<ip>:<port>` на каждый адрес машины — откройте нужный в браузере другого устройства. Авто-открытие браузера всегда использует локальный адрес. **У веб-сервера нет аутентификации**: `0.0.0.0` даёт полный доступ к API (задачи, чат, запуск фаз) любому в сети — не выставляйте сервер в интернет и используйте только в доверенной локальной сети.

В веб-интерфейсе есть шапка (VL-166): слева — сворачивание сайдбара (кнопка или Ctrl/Cmd+B) и глобальный поиск (VL-185: input с debounce 300 мс, `GET /api/search` — по задачам/lessons/references/documents), справа — параметры вида (тема, стиль и режим свёртки сайдбара), переключатель светлой/тёмной темы, ссылка на репозиторий и юзер-меню (данные — `git_user_name` из настроек/git config).

Под шапкой — сайдбар: «Задачи» (`#/` — доска или список по последнему выбранному виду; активен и на `#/tasks`; пункт «Канбан» переименован в «Задачи»), References (`#/references` — список внешних источников с type/url/tags/linked_tasks и кнопкой Sync — `POST /api/references/sync` клонирует отсутствующие репо; `#/reference/<id>` — просмотр title/type/url/path/tags/body/linked_tasks и редактирование title/tags/url/body через `PATCH /api/references/:id`, VL-174), Documents (`#/documents` — список документов (type/tags/created_date, фильтры по type и тегам, кнопка «+ Документ» → `POST /api/documents`); `#/document/<id>` — просмотр title/type/tags/body/created_date (markdown) и редактирование через `PATCH /api/documents/:id`, VL-181), Lessons (`#/lessons` — список lessons (id/title/status/tags, клиентские фильтры по status и тегам); `#/lesson/<id>` — просмотр title/status/tags/body (markdown-рендер) и source_tasks/linked_tasks ссылками на задачи (клик открывает модалку задачи на доске), редактирование title/tags/body/status через `PATCH /api/lessons/:id`, VL-182), Чат (`#/chat` и `#/chat/<threadId>` — веб-чат с LLM на assistant-ui, VL-204/VL-207: обсуждение проекта и создание задач через tool-calling с подтверждением Allow/Deny; активный тред закреплён в hash-роуте и восстанавливается при возврате, список тредов — в панели справа, над ним — переключатель модели (VL-209: `model` в теле `POST /api/chat` переопределяет `models.default`); модель и провайдер берутся из секций `models`/`providers` `.vibelog/settings.json`, без них — env `VIBELOG_LLM_API_KEY`/`VIBELOG_LLM_MODEL` (fallback), история хранится в `.vibelog/chat-sessions/<threadId>.jsonl`) и вложенное меню «Настройки»: «Бот» (`#/settings`, VL-156) и «Конфиг проекта» (`#/config` — `backlog/config.yml`).

Страница настроек редактирует тот же `.vibelog/settings.json`, что и команда `/set` в боте: агент по умолчанию (qwen/vb), лимиты `max_wall_time`/`max_requests` (0 или пусто — сброс к дефолту агента), флаги `branch_mode`/`compact`/`code_same_session`, Card «Модель LLM» — селект активной модели (VL-209: `GET /api/models` → `PUT /api/models { default }`, в `models.default` записывается выбранный id; провайдер виден в подписи выбранной модели). Секреты (env-секция, например TELEGRAM_BOT_TOKEN) в браузер не отдаются и через страницу не редактируются — только напрямую правкой файла; API моделей отдаёт только факт наличия ключа провайдера («задан/не задан»), значения `api_key` и env в ответ не попадают.

Роут `#/tasks` — таблица задач (VL-175): колонки ID/Title/Status/Priority/Type/Labels/Milestone/Updated, сортировка по клику на заголовок (asc → desc → сброс; status/priority — по порядку из конфига, Updated — по дате, пустые значения в конце), пагинация (25/50/100 + Prev/Next/номера страниц) и счётчик «Показано N из M»; клик по строке — просмотр задачи. Фильтры таблицы (VL-176): 6 multi-select-групп (Status/Priority/Type — опции из `GET /api/config` плюс фактические значения задач; Labels/Milestone/Assignee — уникальные значения из загруженных задач); выбранное значение снимается повторным кликом, активная группа — border-dashed → solid со счётчиком, крестик в меню снимает группу; выбор сохраняется в localStorage (ключ `vibelog.tasks.filters`, чтение/запись в try/catch) и восстанавливается после перезагрузки; кнопка «Сбросить фильтры» очищает всё; фильтры применяются до сортировки и пагинации, счётчик «Показано N из M» учитывает фильтры, смена фильтра возвращает на страницу 1. Переключатель видов в тулбаре (VL-177): табы Board/List/Table — Board и List работают на `#/` (вид board/list сохраняется в localStorage `vibelog.tasks.view` и восстанавливается после перезагрузки), Table ведёт на `#/tasks` (и там таб активен; hash главнее localStorage); поиск по id/title (substring, без учёта регистра) фильтрует доску, список и таблицу; кнопка «Фильтр» раскрывает/скрывает панель multi-select-фильтров (общую с `#/tasks`, синхрон через localStorage); «Сортировка» — меню «поле + направление», меняет тот же sort-state, что и клики по заголовкам таблицы; «Создать задачу» — модалка Quick Create (на `#/` — событие, на `#/tasks` — локальная модалка страницы); List-вид — строки (ID/Title/бейджи Status и Priority/Labels/Updated), клик — просмотр задачи.

Модальное окно задачи (VL-163, полноценный просмотр — VL-172): клик по карточке открывает режим просмотра с табами по образцу секций карточки в боте — Описание, Definition of Done, Implementation Plan, Implementation Notes, Final Summary, Комментарии (N) и Acceptance Criteria; пустые необязательные секции скрыты. Все секции рендерятся как markdown (react-markdown + GFM: заголовки, списки, чеклисты, таблицы, код — сырого `##` и raw HTML не видно). Поле «Комментарий» расположено вне табов — доступно на любой вкладке. Кнопки действий формируются по workflow задачи (VL-188): сервер отдаёт в ответах API `availablePhases` — по одной кнопке на каждую фазу, доступную из текущего статуса (при ветвлении, например To Do → spec/reject, показывается выбор), плюс для статуса Backlog — кнопка «▶ Взять в работу» (переход `Backlog → initial_status` без фазы); везде «💬 Комментарий» (кнопка-заглушка: фаза comment из веба не запускается, но введённый текст комментария записывается в задачу при нажатии любой кнопки фазы) плюс постоянные «Редактировать» и «Закрыть»; Done/Blocked (финальные статусы без переходов) — только «Редактировать»/«Закрыть». Непустой комментарий перед запуском фазы сохраняется через `addComment` и передаётся в `{{comment}}` промпта (`POST /api/tasks/:id/trigger {phase, comment?}`) — при ошибке запуска (409 в т.ч. «Фаза недопустима из статуса») комментарий не откатывается, в окне показывается «Комментарий добавлен, но запуск не удался: …». Кнопка «Отмена» в режиме редактирования возвращает в просмотр без сохранения, закрытие окна (Escape/оверлей/«Закрыть») сбрасывает режим — повторное открытие карточки всегда в режиме просмотра; «Редактировать» на карточке канбана (и Quick Create → «Создать задачу») открывает своё начальное состояние.

Запуск фаз из веб-интерфейса (POST /api/tasks/:id/trigger, кнопки карточки) использует агента `default_agent` из `.vibelog/settings.json` — как бот, без захардкоженного значения (VL-180). В карточке To Do есть кнопка «✖ Reject» — отклонение задачи (VL-163).

Перетаскивание карточки по колонкам (drag-and-drop) отправляет `PATCH /api/tasks/:id { status }` — сервер валидирует переход по workflow (`canMoveTo`): без транзита — 400 и откат доски с сообщением «переход недоступен». Успешный ответ содержит `triggerPhase` — фаза, производящая целевой статус, её веб и запускает (для `reject` — `POST /reject`); ручной вход в `initial_status` (Backlog → To Do) фазу не запускает.

---

## 11. Telegram-бот

Команды `vibelog bot` (long-polling, grammy): привязка чата через /start + пин-код, затем задачи и фазы.

Справка `/help` (VL-150) выводит все команды реестра с описанием и примерами — включая полный синтаксис `/set` (`/set agent vb`, `/set max-wall-time 1800`, `/set branch-mode on`, `/set compact off`, `/set model <id>` — VL-209) и `/model` (список LLM-моделей). Команда доступна до привязки чата (как `/start`); справка собирается из единого реестра `BOT_COMMANDS`, поэтому новая команда появляется в ней автоматически, а меню Telegram и help-строка `/start` обновляются из того же реестра. Длинный текст разбивается на части по лимиту Telegram.

### Фазы через qwen

| Команда | Фаза | Что делает |
|---------|------|------------|
| `/spec[:agent] <описание>` | Spec | создаёт задачу и разбивает фичу на подзадачи |
| `/plan[:agent] <id> [комментарий]` | Plan | план реализации для существующей задачи; комментарий добавляется в задачу и учитывается фазой |
| `/code[:agent] <id> [комментарий] [--same-session\|--no-same-session]` | Code | реализация задачи; комментарий добавляется в задачу и учитывается фазой; флаги `--same-session`/`--no-same-session` (VL-147) разово переопределяют настройку `code_same_session` — см. «Фаза Code в сессии Plan» |
| `/close[:agent] <id>` | Close | закрытие: статус из конфига + git commit |
| `/comment[:agent] <id> <текст>` | Comment | комментарий + запрос агенту (статус не меняется) |
| `/prompt[:agent] <текст>` | Prompt | произвольный запрос через LLM без задачи (git разрешён) |
| `/move <id> "<статус>"` | — | ручной переход статуса по workflow (VL-188): валидация `canMoveTo`, например `/move VL-1 "To Do"`; недоступный переход — сообщение с доступными |
| `/auto add <id> [id…]` | — | автоочередь фаз (VL-191): добавить задачи в `.vibelog/auto-queue.json` (дедуп: pending/running — пропуск, done/failed — сброс в pending, `failed_permanent` — пропуск без реанимации, VL-228) |
| `/auto start\|stop\|status` | — | запустить автопрогон (running: true), остановить после текущей фазы, показать очередь (pending/running/done/failed/failed_permanent) |

**Автоочередь фаз** (`/auto`, VL-191): при `running: true` раннер последовательно проходит фазы задач (spec → plan → code → close, после code — close сразу без ревью); выбор следующей задачи — только `pending`, все зависимости Done, сортировка High→Medium→Low (внутри приоритета FIFO по `added_at`). Ветвление статуса: auto выбирает первую фазу кроме reject (reject — только вручную). Ошибка фазы → retry (по умолчанию 1, поле очереди `max_retries`), затем `failed` + уведомление во все привязанные чаты; исчерпание ретраев (`attempts > max_retries`) переводит запись в терминальный `failed_permanent` с причиной в поле `fail_reason` и строкой в stderr `[auto VL-228] <id> → failed_permanent: фаза …, попыток N из M, причина: …; сессия: <id|не найдена>` (VL-228); пустая очередь ставит `running: false`. Кнопка «🤖 Auto» в карточке задачи добавляет её в очередь. Ограничение: при рестарте бота посреди фазы возможен короткий дубль-прогон orphan-фазы (resume сбрасывает running→pending и перезапускает фазу).

`failed_permanent` не перетирается следующим циклом очереди: выбор берёт только `pending`, а `/auto add` такой записью не реанимирует задачу (защита от случайного перезапуска «навсегда проваленной»). Ручной обход — `/auto remove <id>` и затем `/auto add <id>` (элемент создаётся заново с `attempts: 0`); старые очереди с застрявшим `failed` и `attempts > max_retries` авто-мигрируются в `failed_permanent` при ближайшем sweep с автозаполнением причины.

Успех фазы в автопрогоне = exitCode 0 **и** смена статуса задачи — фаза без прогресса тоже идёт в retry (защита от цикла); задача доводится до терминала (`done`/`failed`), прежде чем взята следующая. Dep-блокированные задачи ждут до 60 с (пол-timer) до созревания зависимостей.

`/prompt` — для запросов, слишком мелких для задачи («сделай коммиты незакоммиченных файлов», «внеси правку в настройки»): команда не создаёт задачу, `backlog/` не трогается, git-операции разрешены (кроме push без явной просьбы). По завершении в чат приходит только информационное сообщение (VL-63, без карточки задачи); одновременно активен только один `/prompt` — повторный запрос получает ошибку guard'а (общего для обоих агентов).

**Агент-исполнитель** (суффикс `:<agent>`, VL-92/94 — доступен у всех команд фаз: `/spec`, `/plan`, `/code`, `/close`, `/comment`, `/prompt`):

| Суффикс | Агент | Бинарь |
|---------|-------|--------|
| без суффикса, `:qwen` | qwen (дефолт) | `VIBELOG_QWEN_BIN` или `qwen` в PATH |
| `:vb` | встроенный Vibelog | `VIBELOG_AGENT_BIN` или `bin/vibelog-agent.mjs` |

`/prompt:vb <запрос>` запускает встроенный агент Vibelog (VL-85, `docs/agent.md`): те же qwen-совместимые флаги, тот же JSON-контракт результата. Переменные `VIBELOG_LLM_BASE_URL` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_MODEL` берутся из `.env` или секции `env` в `.vibelog/settings.json` — `vibelog bot`, `vibelog browser` и `vibelog agent` применяют их в process.env через общий `loadProjectEnv` = `loadDotEnv` → `applySettingsEnv` (VL-37/143/189, приоритет: реальное окружение → `.env` → `env`-секция), отдельная настройка не нужна. При наличии секции `models` в settings.json приоритет у неё — модель, провайдер, `api_mode` и ключ резолвятся из `models.default` → `providers`, env остаётся fallback-путём (VL-209). Неизвестный суффикс (`/prompt:foo`) — подсказка синтаксиса, без запуска.

**Настройки бота** (`/set`, VL-94/104/107/122/147/209): команда принимает семь параметров.

| Параметр | Пример | Сброс | Назначение |
|----------|--------|-------|------------|
| `agent` | `/set agent vb` | `/set agent qwen` | Агент по умолчанию для команд фаз и кнопок действий (ключ `default_agent`) |
| `max-wall-time` | `/set max-wall-time 1800` | `/set max-wall-time 0` | Лимит времени фазы в секундах для агента vb (ключ `max_wall_time`; передаётся флагом `--max-wall-time`) |
| `max-requests` | `/set max-requests 50` | `/set max-requests 0` | Лимит LLM-запросов фазы (ходов модели) для агента vb (ключ `max_requests`, флаг `--max-requests`; ≠ лимит tool-calls) |
| `branch-mode` | `/set branch-mode on` | `/set branch-mode off` | Режим параллельной разработки в git-ветках vb/vl-N (VL-107, ключ `branch_mode`; раздел «Параллельная разработка в ветках») |
| `compact` | `/set compact off` | `/set compact on` | Компакшн истории LLM-запроса в длинных сессиях (VL-122, ключ `compact`; при `off` оркестратор передаёт агенту vb флаг `--no-compact`; дефолт — включён) |
| `code-same-session` | `/set code-same-session on` | `/set code-same-session off` | Запуск Фазы Code в той же сессии агента, что и Plan (VL-147, ключ `code_same_session`; раздел «Фаза Code в сессии Plan»; дефолт — выключен) |
| `model` | `/set model routerai/xiaomi/mimo-v2.6-pro` | — | Активная LLM-модель (VL-209: валидация id в `models.available` → запись `models.default` в `.vibelog/settings.json`; регистр id сохраняется — значение не приводится к нижнему регистру; список — `/model` и `vibelog model list`) |

**Модели LLM** (`/model`, VL-209): `/model` без аргументов — текстовый список моделей из `models.available` (id — label, провайдер, api_mode, пометка активной); переключение — `/set model <id>` (та же строка таблицы выше). Неизвестный id — сообщение с доступными моделями; секция `models` не настроена — подсказка про env `VIBELOG_LLM_MODEL` (fallback). Значения ключей провайдеров бот не показывает.

Все настройки хранятся в едином `.vibelog/settings.json` (VL-143 — замена `bot.yml`/`settings.yml`, прежние snake_case-ключи); битые значения в файле игнорируются. Изменения подхватываются при рестарте бота (`/restart` или перезапуск, VL-143). Лимиты применяются **при следующем запуске** фазы и только для встроенного агента (vb) — qwen эти флаги не поддерживает; без настроек флаги не передаются (поведение прежнее). Значение `0` удаляет настройку (используется дефолт агента). Неизвестный параметр — подсказка синтаксиса. Без суффикса `:<agent>` запускают агента по умолчанию все команды фаз и кнопок действий («следующий этап», ввод комментария с кнопки); явный суффикс (`/code:qwen VL-1`) перекрывает настройку. Неизвестный суффикс любой фазовой команды (`/spec:foo`) — подсказка синтаксиса, без запуска и создания задачи.

### Фаза Code в сессии Plan (VL-147)

Экономия входных токенов: при включённом режиме Фаза Code продолжает сессию агента Фазы Plan через `--resume` — большой контекст планирования уже в истории сессии и попадает в кэш LLM, модель не инициализирует его заново.

- **Включение**: `/set code-same-session on` (ключ `code_same_session` в `.vibelog/settings.json`); по умолчанию выключен — без включения поведение прежнее (каждый `/code` — новая сессия).
- **Явное переопределение** (перекрывает настройку в обе стороны): флаги `/code VL-N --same-session` / `/code VL-N --no-same-session` и поле `sameSession` (boolean) в `POST /api/tasks/:id/trigger`.
- **Источник plan-сессии** — меты `.vibelog/agent-sessions/*.meta.json` (пишет CLI при старте задачной сессии; для qwen дополнительно дописывает оркестратор по result.session_id). Поиск идёт по каталогу главного репозитория; если мета там не найдена — фолбэк-проход по worktree-каталогу задачи `agentSessionsDir(taskWorktreeDir)` (VL-187: мета могла попасть в worktree при запуске плана без `VIBELOG_CWD`/со старым dist). Если план-сессия не найдена нигде (задача планировалась до VL-147, меты нет / сессия удалена) — Code запускается в новой сессии, регрессий нет; каталоги обоих проходов и перечень мет задачи (sessionId/phase) пишутся в лог оркестратора, причина промаха читается из него.
- **Статус запуска (VL-187)**: запуск code возвращает поле `sameSession` в StartResult — `applied` (resume применён), `no-plan-session` (мета не найдена — новая сессия), `off` (настройка выключена), `override-off` (переопределено в выкл.); поле отдаётся целиком в 202-ответе `POST /api/tasks/:id/trigger`. Бот показывает суффикс в сообщении запуска `/code` и при кнопке «следующий этап»: «(сессия plan продолжена)» при `applied`, «⚠️ план-сессия не найдена — новая сессия» при `no-plan-session`.
- **Мета сессии не затирается resume-раном (VL-187)**: reply-продолжение прерванной фазы («Продолжи», `/resume`) спавнит агента с `--resume` — такой ран не перезаписывает существующую `<sessionId>.meta.json`, исходная фаза (plan) сохраняется. Фикс инцидента VL-185: resume-ран с `phase='prompt'` затирал `phase:'plan'` → `findTaskPhaseSessionSync` не находил план-сессию → code при включённом `code_same_session` стартовал в новой сессии.
- Возобновление дописывает историю план-сессии (без `--fork-session`): повторный `/code` продолжит ту же сессию «план+код» — это цель фичи, но сессия смешивает обе фазы. Если сессия потеряна в локальном хранилище qwen (`~/.qwen`), `--resume` падает с exit 1 — ошибка видна в боте/на доске, повторный обычный `/code` работает.

### Команда бота /resume (VL-171)

`/resume[:agent] <session-ref> [комментарий]` — возобновление сохранённой агент-сессии из Telegram **без reply** на сообщение: первый токен — session-ref в формате `<agent>:<session_id>` (`vb:agent-N` и голый `agent-N` → встроенный vb; `qwen:UUID` и голый UUID → qwen), остаток — необязательный комментарий агенту (по умолчанию «Продолжи»). Требует привязанного чата; хендлер зарегистрирован после `/analyze` и до catch-all пина (порядок grammy). Ответ — «Сессия возобновлена, PID…», результат приходит информационным сообщением (VL-63) в ту же сессию. Суффикс `:<agent>` работает как у `/prompt` (`/resume:vb`, `/resume:qwen`); пустой ввод и битый ref — подсказка синтаксиса без запуска. Guard VL-145: повторный `/resume` той же живой сессии отклоняется «Запуск уже выполняется». Reply-resume (VL-93) не затронут — работает параллельно.

Пример: `/resume vb:agent-1792057147372 продолжи доработку VL-171`.

Та же семантика в CLI: `vibelog agent --resume <session-ref>` открывает TUI-чат с загруженной историей сессии (флаг без значения — ошибка до старта TUI; несуществующая сессия — «Сессия не найдена»).

### Resume сессии по reply (VL-93)

Информационное сообщение о завершении фазы (VL-63) содержит идентификатор сессии агента в одинарных backticks последней строкой — **единый формат `<agent>:<session_id>` для всех агентов** (VL-93): у qwen — `qwen:<session_id>` (UUID), у встроенного vibelog-agent (VL-92) — `vb:<session_id>`.

**Reply на это сообщение** с уточнением продолжает ту же сессию **обоих агентов** (VL-93/95): бот извлекает session_id из сообщения-ответа (текст либо блоки rich-сообщения — информационное сообщение шлётся `sendRichMessage` и не имеет поля `text`; backtick-обёртка, `qwen:<uuid>` и `vb:<session_id>` распознаются, голый UUID/токен — фолбэк, если Telegram отдал reply без backticks — entities хранятся отдельно) и запускает агент-сессию с `--resume <session_id>` и текстом пользователя промптом — без `--fork-session`, та же сессия. У qwen это `qwen --resume <uuid>` (сессии хранит сам qwen, `~/.qwen/projects/`); у vibelog-agent (VL-95) — `--resume` с JSONL-транскриптом из `.vibelog/agent-sessions/` (`docs/agent.md`, раздел «Сессии»), префикс `vb:` снимается CLI агента. Результат приходит в чат информационным сообщением (VL-63, без карточки задачи).

**Параллельность resume (VL-145)**: одновременно могут выполняться resume **разных задач и разных сессий** — в том числе параллельно с фазами других задач (web-оркестратор и бот). Блокировка действует только на повторный запуск **той же самой задачи** (resume при живой фазе этой задачи и наоборот) либо **дубль той же сессии** — такой запуск получает ошибку guard'а «Запуск уже выполняется (VL-N)» с ID занятой задачи. Resume, чья сессия привязана к задаче (мета `*.meta.json`), использует задачный ключ и участвует в guard'е наравне с фазами; resume без меты (старые сессии, `/prompt`-подобные) блокируется только дублем своего session_id. Если resume падает (сессия не найдена) — в чат уходит сообщение об ошибке.

**Кнопка «Продолжить» при ошибке лимитов (VL-212)**: если фаза или resume завершились ошибкой превышения лимита агента — текст результата содержит «Превышен лимит» (например `Превышен лимит --max-wall-time` или `Превышен лимит --max-requests`) при `is_error: true` — к информационному сообщению прикрепляется кнопка **«▶ Продолжить»** (в rich-рендере — `<tg-button>` последней строкой, в MarkdownV2-фолбэке — inline-клавиатура; callback-данные `resume:<agent>:<session_id>`). Нажатие возобновляет ту же сессию тем же механизмом, что /resume без комментария (промпт «Продолжи»): сообщение об ошибке уже дописано в историю сессии, лимиты у нового запуска считаются заново, поэтому повторное продолжение даёт полный бюджет. Успешные фазы и не-limit ошибки кнопки не получают. Требуется привязанный чат; повторное нажатие при живой сессии отдаёт guard «Запуск уже выполняется».
Reply на сообщение бота без session_id и обычные текстовые сообщения не меняются: режим комментария (VL-78) и пин работают как раньше. Возобновление работает только в привязанных чатах.

### Кнопки карточки задачи (VL-72, VL-78, VL-188)

В rich-рендере карточки задачи (команда /task и карточка после завершения фазы) сразу после заголовка выводится **центрированный ряд callback-кнопок** (`<tg-button-row align="center">`), формируемый по **workflow задачи** (VL-188, `getAvailablePhases`):

- **«▶ Spec / 📋 Plan / 💻 Code / ⚡ Do / ✅ Close»** (`style="primary"`) — по одной кнопке на каждую фазу, доступную из текущего статуса;
- при **ветвлении** (несколько фаз из одного статуса, например To Do → spec/reject) каждая фаза — отдельная кнопка с callback `phase:<id>:<phase>`; для единственной фазы используется прежний формат `next:<id>` (старые карточки в переписке продолжают работать), а по `next:` при ветвлении бот присылает сообщение с выбором;
- **«✖ Reject»** (`style="danger"`) — если `reject` есть среди доступных фаз (в default — из To Do);
- **«▶ Взять в работу»** — для задач в Backlog: ручной переход `Backlog → initial_status` (callback `start:<id>`), фаза не запускается;
- **«💬 Комментарий»** (`style="success"`, data `comment:<id>`) — показывается всегда, включая Done/Blocked.

| Статус (default workflow) | Кнопки |
|--------|------------------|
| Backlog | ▶ Взять в работу (+ 💬 Комментарий) |
| To Do | ▶ Spec + ✖ Reject (ветвление) |
| Spec | 📋 Plan |
| Planned, In Progress | 💻 Code |
| Review | ✅ Close (+ 💻 Code — fix-цикл) |
| Done, Blocked | — (только «💬 Комментарий») |

Для других workflow (bugfix/simple, `task_workflows`) состав кнопок определяется их transitions — например, в simple из To Do доступна только «⚡ Do». Финальные статусы (`phase: null`) кнопок фаз не имеют.

**Кнопка «следующий этап»** (VL-72): нажатие отправляет callback-запрос `next:<id>`: бот отвечает на него (иначе Telegram показывает «часики») и запускает первую не-reject фазу (`getNextPhase`); если доступных фаз несколько — просит выбрать кнопкой `phase:<id>:<phase>`. Фаза запускается по тому же механизму, что и команды /plan, /code, /close — с уведомлением о завершении фазы, агентом по умолчанию из настроек (VL-94, `/set agent`). Для финальных статусов и неизвестных статусов бот отвечает «нет следующего этапа» без запуска.

**Кнопка «Комментарий»** (VL-78): нажатие отправляет callback `comment:<id>` — бот просит ввести текст комментария следующим сообщением. Введённый текст сохраняется через `addComment` и запускает Фазу Comment — та же логика, что у команды `/comment[:agent] <id> <текст>` (VL-60); агент — по умолчанию из настроек (VL-94). Пустой ввод → повторный промпт; `/cancel` — выход из режима ожидания. Режим ожидания живёт в памяти процесса (как пин-код) — после рестарта бота нужно нажать кнопку заново.

**Expand-блоки карточки** (VL-78): секции Описание / Acceptance Criteria / Definition of Done / Implementation Plan / Implementation Notes / Final Summary / Комментарии свёрнуты в `<details><summary>` (поддерживается rich-сообщениями Telegram); **Описание открыта по умолчанию**, шапка с метой (статус, приоритет, исполнители, метки, срок) видна всегда. Кнопки и details доступны только в rich-рендере; фолбэк MarkdownV2 (старые клиенты) их не содержит.

**Сырые rich-теги в контенте** (VL-81): если текст задачи (описание, AC/DoD, plan, notes, комментарии) сам содержит `<tg-button>`, `<tg-button-row>`, `<details>`, `<summary>` — при вставке в rich-разметку такие теги оборачиваются в code-разметку (строки целиком из тегов — в fenced-блок, теги вперемешку с текстом — в inline-бэкитики), чтобы парсер Telegram не интерпретировал их как настоящие элементы и не ломал кнопки/expand-блоки карточки. Теги, уже находящиеся внутри ``-кода, не изменяются; блоки ``` ``` ``` контента (после экранирования в `` ` ``) превращаются в настоящий fenced-блок — маркеры `` ` `` fenced-блоком не являются. Служебные теги рендера (шапка, ряд кнопок, обёртки секций) не затрагиваются; фолбэк MarkdownV2 не изменён.

### Список /tasks — rich-таблица (VL-82)

Команда `/tasks` отправляет RichMessage: таблица `<table bordered striped compact>` с колонками ID / Заголовок / Статус / Тип / Приоритет (невыполненные задачи, по возрастанию ID — фильтр и порядок не менялись) и под таблицей callback-кнопки `<tg-button-row>` — по одной на задачу (текст = только номер задачи без префикса «VL-», например «128»; data `task:<id>` полная, `task:VL-N`). Кнопки дробятся на ряды по 5 (VL-128: при 8 в ряду подписи-ID не помещались и текст не был виден); жёсткий лимит Telegram — 8 кнопок в ряду (при большем числе rich-сообщение отклоняется с ошибкой RICH_MESSAGE_BUTTONS_TOO_MANY) — остаётся верхней границей, и в `/docs` кнопки документов по-прежнему дробятся по 8. Нажатие кнопки открывает карточку задачи — полный аналог команды `/task VL-N`.

**Формат ячеек — HTML.** Таблица строится как Rich HTML (`<tr>/<th>/<td>`, жирный ID — `<b>`): по спецификации Telegram блок `<table>` в rich-сообщении парсится именно как HTML-таблица, и GFM-строки `| ... |` внутри него отображаются сырым текстом — поэтому «Markdown-таблица» в обёртке `<table>` не рендерилась (исправлено в VL-82 после проверки в Telegram).

**Цвет кнопки по типу задачи**: маппинг хранится в `.vibelog/settings.json` (ключ `task_type_styles`); дефолты — `bug→danger`, `feature→success`, `enhancement→primary`, `epic→primary`. Допустимые стили Telegram: `danger` (красный), `success` (зелёный), `primary` (синий), `link` (без рамок); для остальных типов кнопка получает дефолтный стиль Telegram. Пользовательские переопределения перекрывают дефолты (сами дефолты в файл не записываются):

```json
{
  "task_type_styles": {
    "bug": "success",
    "docs": "link"
  }
}
```

При ошибке rich API (старые клиенты) бот откатывается на MarkdownV2-список (`formatTaskList`) — поведение прежнее.

**Пометка активной фазы агента (VL-91)**: строки задач, у которых в оркестраторе прямо сейчас выполняется фаза, помечаются значком 🔄 с указанием фазы (spec/plan/code/close/comment) — и в rich-таблице, и в MarkdownV2-фолбэке. Активность определяется по in-memory состоянию оркестратора (`getRun(taskId).running === true`) того же процесса, что и бот, поэтому фазы, запущенные из web UI (`vibelog browser`, отдельный процесс), в `/tasks` не видны — то же ограничение, что у `/task` (VL-43). Завершённые и ошибочные запуски не помечаются.

### Git-статус /diff (VL-88)

Команда `/diff` в привязанном чате показывает текущие незакоммиченные файлы git-репозитория проекта — read-only, ничего не коммитит и не меняет в рабочем дереве.

RichMessage-таблица `<table bordered striped compact>` с колонками «Файл | Статус | Строки (+/−)» из `git status --porcelain` + `git diff --numstat` (staged и unstaged раздельно):

- **Статус** — человекочитаемый: Modified / Added / Deleted / Untracked / Renamed; staged-файлы отмечаются меткой «(staged)» и не сливаются с unstaged (файл в обеих колонках — две строки таблицы).
- **Строки (+/−)** — счётчики строк из numstat; для renamed — по новому пути, для untracked — 0/0.
- Заголовок содержит имя ветки (`git branch --show-current`); пути и подписи экранируются, длинная таблица дробится по лимиту 32768 (chunkRich).

Если незакоммиченных изменений нет — короткое сообщение «Незакоммиченных изменений нет» (таблица не строится). При недоступности rich API (старые клиенты) — фолбэк на MarkdownV2-список (`formatDiffList`), как у /task и /tasks. Git-сбой или не-git-репозиторий — сообщение об ошибке в чат, бот не падает.

Сбор данных — core-функция `getGitStatus(cwd)` (`src/core/git.ts`); git вызывается с `-c core.quotepath=false`, чтобы не-ASCII пути не octal-экранировались и совпадали с numstat.

### Команды git — /commits (VL-90)

Команда `/commits [X]` (по умолчанию X=10) в привязанном чате показывает таблицу последних X коммитов git-репозитория проекта — read-only, ничего не коммитится.

RichMessage-таблица `<table bordered striped compact>` с колонками «Тема | Дата | Автор | Хеш» (хеш — в `<code>`; все поля через cellSafe):

- Дефолт — 10 коммитов; `/commits 5` — ровно 5; некорректный аргумент (0, отрицательный, дробный, буквы) — сообщение «Синтаксис: /commits [N]».
- Пустой лог (репозиторий без коммитов) — короткое сообщение «Коммитов нет», таблица не строится.
- Git-сбой или не-git-репозиторий — сообщение об ошибке в чат, бот не падает (паттерн /diff). При недоступности rich API — фолбэк на MarkdownV2 (`formatCommitsList`).

Сбор данных — `getGitLog(cwd, count)` в `src/core/git.ts` — единый git-модуль Vibelog (VL-90 объединил `git.ts` + `git-user.ts` + `git-status.ts` в один файл по аналогии с `src/git/operations.ts` оригинала Backlog.md): `git rev-parse --is-inside-work-tree` (проверка), `git rev-parse --verify HEAD` (пустой репозиторий → `[]`), `git log -n <count>` с форматом `%h%x1f%an%x1f%ad%x1f%s` и чистым парсером `parseGitLog`.

### Документы в боте (VL-89)

Команды `/docs` и `/doc` — просмотр документов проекта (`backlog/docs/`, формат doc-N) в Telegram. Создание и редактирование через бот не реализованы — используйте CLI `vibelog doc ...` или MCP-инструменты `document_*`.

**`/docs [фильтр]`** — список документов: RichMessage-таблица `<table bordered striped compact>` с колонками ID / Заголовок / Тип / Теги и под таблицей callback-кнопки `doc:<id>` (дробление по 8 в ряд — лимит Telegram, паттерн `/tasks`). Необязательный текстовый аргумент — фильтр поиска (`searchDocuments`: id, заголовок, теги, тело документа). Пустой список — короткое сообщение «Документов нет» без таблицы. При отказе rich API — фолбэк MarkdownV2 (`formatDocsList`).

**`/doc <id>`** — карточка документа: метаданные (id, title, тип, теги, дата создания) + тело markdown с учётом лимитов Telegram (разбивка `chunkRich`; MarkdownV2-фолбэк `formatDocumentDetail` усечён до 1500 символов). Неизвестный id — сообщение «Документ &lt;id&gt; не найден» (id экранируется, как в `/task`). Callback-кнопка `doc:<id>` из `/docs` открывает ту же карточку.

### Самоперезапуск /restart (VL-70/107)

После `pnpm build` запущенный бот продолжает исполнять старый `dist/`. Команда `/restart` в привязанном чате рестартует бота **самого себя**: он отвечает «🔄 Перезапуск бота…», останавливает long polling и поднимает новый `vibelog bot` **в том же терминале** (stdio наследуется — новый пин-код печатается там же, где был запущен старый процесс; detached-режим — новый процесс переживает старый). Новый процесс исполняет свежий `dist/` — Ctrl+C не требуется, и перечитывает `.env` и `.vibelog/settings.json` — изменённые настройки применяются сразу (VL-143). Чат остаётся привязанным (`.vibelog/settings.json` не меняется); команда доступна только привязанным чатам. При сбое запуска нового процесса бот сообщает об ошибке в чат и в консоль.

**`/restart VL-N` (VL-107)** — перезапуск из worktree ветки `vb/vl-N` (режим параллельной разработки): бот отвечает «🔧 Сборка ветки vb/vl-N…», создаёт worktree (если его нет) и собирает его главным `tsc` (dist worktree пересобирается с нуля; typescript берётся из главного node_modules — `pnpm install` в worktree не нужен, если ветка не меняла зависимости). Успешная сборка — сообщение «✅ Ветка собрана», затем обычный перезапуск: новый процесс исполняет `…/vl-N/bin/vibelog.mjs` (dist ветки), но **cwd остаётся главным репозиторием** — токен, backlog/ и `.vibelog/` общие. Ошибка сборки (не git-репо, конфликт ветки, сломанный tsconfig) — сообщение об ошибке в чат, **текущий процесс не трогается** — бот продолжает работать, можно исправить и повторить. Некорректный аргумент — «Синтаксис: /restart [VL-N]». Рекомендуется сначала `/set branch-mode on`, чтобы фазы новых задач сразу шли в ветки. Повторный `/restart` без аргументов после `/restart VL-N` возвращает бота в корневой dist (главная ветка), не оставляя в worktree; пустой `/restart` вычисляет путь CLI от cwd процесса (`rootCliPath`), а не от location текущего dist — после `/restart VL-N` бот гарантированно возвращается в корневой dist, а не «застревает» в worktree (VL-151).

### Параллельная разработка в ветках (VL-107)

Несколько задач в статусе Review не должны блокировать друг друга: режим `/set branch-mode on` (ключ `branch_mode` в `.vibelog/settings.json`) направляет фазы задач в git-ветки.

**Схема «worktree для кода + общий backlog»**: worktree `.vibelog/worktrees/vl-N` на ветке `vb/vl-N` (`git worktree add -b vb/vl-N … HEAD` — от закоммиченного HEAD главного репо; незакоммиченные изменения в ветку не переносятся) создаётся **впервые при запуске Фазы Plan** (VL-134: к этому моменту ветка ещё актуальна; фазы до Plan — Spec и прочие — работают в главном репозитории); для задач типа **epic worktree не создаётся ни на одной фазе**. Уже созданный worktree используется остальными фазами (code/comment/resume) — спавн идёт с cwd worktree, код изолирован в ветке; если worktree нет — фаза идёт в главном cwd. MCP-сервер агента при этом получает `VIBELOG_CWD` = главный репозиторий: статусы и комментарии задач пишутся в **общий** `backlog/`, worktree-копия backlog не трогается — merge ветки не конфликтует с задачами. Агенту в промпте дописывается примечание: коммитить код в текущую ветку, файлы `backlog/` не коммить. `/prompt` и `/prompt`-кнопки (не привязанные к задаче) всегда работают в главном репозитории — без изменений; resume-сессии возобновляются в worktree своей задачи, если мета сессии её знает (VL-110).

Worktree выбран вместо `dist/VL-N`: `package.json.files` включает `dist` (сборки веток попали бы в npm-пакет), `pnpm build` главного репо стирает `dist/` целиком, а `.vibelog/` уже в `.gitignore`. Ветка, меняющая зависимости, требует ручного `pnpm install` в worktree — иначе рантайм упадёт на импорте новой паки. `/tasks` показывает активную фазу 🔄 по in-memory состоянию процесса бота — фазы в worktree видны так же (guard от двойного запуска общий).

**Веб-интерфейс из чата (VL-161)**: `/web start [VL-N]` запускает `vibelog browser` дочерним процессом бота, `/web stop` его останавливает. Без аргумента CLI берётся от location текущего dist бота — после `/restart VL-N` веб стартует из того же worktree (проверка веб-версии ветки без второго перезапуска); с аргументом `VL-N` worktree собирается и веб запускается из него, пока бот продолжает работать из текущего dist. URL присылается в чат; повторный `/web start` перезапускает сервер, порт — `default_port` из config (3030 по умолчанию).

**Закрытие задач с worktree**: Close запускается в главном репозитории по отдельному шаблону `templates/qwen-commands/phase-close-worktree.md` — проверяет чистоту worktree (незакоммиченное коммитит в ветку `vb/vl-N`), сливает ветку через `git merge --no-ff`, при конфликте — не резолвит его и не меняет статус (задача остаётся в Review с отчётом о файлах конфликта), после успешного слияния удаляет worktree и ветку. Без worktree Close идёт по обычному шаблону `phase-close.md`.

**Сериализация Close (VL-146)**: в режиме веток одновременно выполняется только одна Фаза Close — merge в главном репозитории требует эксклюзивного доступа к git. Второй запуск `/close` (для другой задачи) не стартует, а ставится в очередь оркестратора и начинается автоматически после завершения текущего close; бот отвечает сообщением «поставлена в очередь». Очередь живёт в памяти процесса бота/browser: после рестарта отложенный close запускается командой `/close` заново.

**VL-246: guard незавершённого merge и владелец очереди.** Перед стартом close в режиме веток оркестратор проверяет git-состояние главного репозитория (`getMergeState`: `MERGE_HEAD` + `git diff --diff-filter=U`). Если слияние уже идёт (например, от параллельной Close, lesson-82), фаза **не стартует**: возвращается ошибка с коротким sha и списком конфликтных файлов («Close не может начать слияние: в главном репозитории идёт незавершённый merge (MERGE_HEAD abc1234), конфликты: …»), процесс агента не спавнится и **статус задачи не меняется** — вместо падения на `git merge --no-ff` с «you have unmerged files» пользователь сразу видит причину. Проверка выполняется при каждом старте, включая dequeue из очереди; в не-git проекте она fail-open (не блокирует). Сообщение о постановке в очередь теперь говорит, какой close её удерживает: «поставлена в очередь — стартует после завершения текущего close (VL-M)» (поле `queuedBehind` в ответе оркестратора).

Публикация npm не затрагивается: `.vibelog/worktrees` не входит в `package.json.files` и лежит в `.gitignore`; `pnpm build` главного репо worktree не стирает (dist ветки живёт внутри worktree).

### Ответ по завершении фазы — 2 сообщения (VL-63)

1. **Карточка задачи** — как в /task (rich-рендер, без строки фазы).
2. **Информационное сообщение** — из последней JSON-строки `type=result` вывода qwen; отправляется RichMessage (GFM) через sendRichMessage — MarkdownV2 остаётся фолбэком для старых клиентов (VL-71):

```
# Фаза comment: завершена (код 0) — VL-98

> понг (каждая строка ответа модели — в цитате)

**Токены:** входные: 10956 · сгенерированные: 19 · кэш: 10944 · всего: 10975
**Входные минус кэш:** 12

**Общее время:** 42с (api: 42с)
**Количество запросов:** 1

`qwen:a470c7dd-2ca8-4510-9d81-b184f932af76`
```

Заголовок завершается идентификатором задачи ` — VL-N` (VL-98): он есть у всех реальных завершений фаз задач (comment/spec/plan/code/close); `/prompt` и resume-сессии не привязаны к задаче — их отчёт остаётся без суффикса. Ответ модели выводится цитатой (каждая строка с `> `). Токены — одной строкой плюс строка «Входные минус кэш» (входные минус кэш-токены — объём «свежего» входа без учёта кэша). Время — в минутах и секундах («1м 23с»; до секунды — миллисекунды).

Идентификатор сессии выводится с префиксом агента — единый формат `<agent>:<session_id>` (VL-93): `qwen:<session_id>` у qwen, `vb:<session_id>` у встроенного vibelog-agent (VL-92); по reply на информационное сообщение возобновляется сессия любого агента (VL-95, раздел «Resume сессии по reply»).

Сырой JSON-лог в чат больше не шлётся. Если результат недоступен (ошибка запуска qwen, обрыв), информационное сообщение содержит статус, строку «Данные результата недоступны» и хвост лога (до 800 символов) в тройных backticks — без экранирования MarkdownV2. Парсер понимает оба формата вывода qwen: NDJSON-поток и строку-массив `[{…}]` (json-адаптер qwen 0.24.x). Если result не распознан, в консоль сервера печатается расширенная диагностика: сводка `parseQwenResult` по stdout, размеры потоков stdout/stderr, хвосты обоих (в таймлайне консоли строки stderr помечены `err|`), а полный stdout дампится в `.vibelog/qwen-debug/<id>-<время>.log` (gitignored) — по дампу видно точный формат вывода qwen без перезапуска фазы. stdout и stderr копятся в раздельных буферах: предупреждения qwen и логи MCP-серверов не могут клиниваться в JSON-строку результата. Флаги `--json-file`/`--json-fd` в headless-режиме qwen 24.x не работают (проверено: файл остаётся пустым) — JSON по-прежнему идёт в stdout через `--output-format json`.

### Разбивка длинных сообщений фаз (VL-148)

Итоговое сообщение фазы (результат `/analyze`, `/prompt`, уведомление о завершении фазы) **не обрезается**: если оно не помещается в лимит длины сообщения Telegram (4096 символов для MarkdownV2-фолбэка, 32768 для rich-сообщений), бот отправляет несколько последовательных сообщений с нумерацией суффиксов «часть 1/N» … «часть N/N». Короткий результат (в пределах лимита) приходит одним сообщением без изменений.

- Разрез идёт **только по границам строк** — чтобы не разорвать escape-последовательность MarkdownV2 (`\x`), иначе Telegram отклоняет сообщение («can't parse entities»). Аномально длинная строка без переводов строк режется жёстко.
- Общий помощник разбивки — `splitNumbered` (`src/bot/formatting.ts`); к другим командам бота (`/task`, `/diff`, `/commits`) подключается позже отдельной задачей.

---
## 12. Форматы файлов

Все сущности — markdown с YAML-фронтматтером. Совместимо с Backlog.md.

### Задача — `backlog/tasks/<id> - <slug>.md`

```yaml
---
id: api-1
title: Добавить авторизацию
status: To Do
priority: high
labels: [backend]
milestone: v1.5
type: bug
---
```

Тело: секции `## Description`, `## Acceptance Criteria` (блоки `<!-- AC:BEGIN -->`), `## Definition of Done`, `## Implementation Plan/Notes`, `## Comments`.

### Веха — `backlog/milestones/<slug>.md`

```yaml
---
name: v1.5
description: Релиз поиска
due_date: 2026-12-01
status: active
---
```

### Документ — `backlog/docs/<id>-<slug>.md`

```yaml
---
id: doc-1
title: Гайд API
type: guide
created_date: 2026-10-01
tags: [api]
---
```

Тело — произвольный markdown (rawContent).

### Решение — `backlog/decisions/<id>-<slug>.md`

```yaml
---
id: decision-1
title: Перейти на pnpm
date: 2026-10-01
status: accepted
---
```

Тело: секции `## Context`, `## Decision`, `## Consequences`, `## Alternatives`.

### Черновик — `backlog/drafts/<id> - <slug>.md`

Та же форма, что у задачи: `id: draft-1`, `status: Draft`.

---

## 13. Референсы (VL-152)

Референсы — внешние источники знаний: репозитории, URL, файлы, документация, спецификации. Метаданные — `backlog/references/<id>-<title>.md` (в git), клоны репозиториев — `backlog/references/data/` (в .gitignore).

```bash
vibelog reference list                        # все референсы
vibelog reference list --type repo --tags mcp # фильтры
vibelog reference add "vibe-kanban" --type repo --url https://github.com/BloopAI/vibe-kanban.git
vibelog reference view ref-1                  # метаданные + linked_tasks + описание
vibelog reference search "drag"               # поиск по id/title/url/tags/телу
vibelog reference link ref-1 VL-152           # двусторонняя связь с задачей
vibelog reference remove ref-1                # удалить метаданные (клон в data/ остаётся)
vibelog reference sync                        # доклонировать отсутствующие
```

Типы: `repo`, `url`, `file`, `doc`, `spec`. `add --type repo` **сам клонирует** репозиторий в `data/<dir>` (идемпотентно: существующий клон пропускается; `--no-clone` — только метаданные). `sync` доклонирует отсутствующие — для разработчиков, склонировавших проект без `data/` (папка в .gitignore).

Связь с задачей двусторонняя: `linked_tasks` референса ↔ `references` задачи (`vibelog reference link` или MCP `reference_link`).

**Интеграция с фазами**: Plan-фаза читает `references` задачи через `reference_view` и использует источники в плане; Code-фаза добавляет новые (`reference_add`) и связывает использованные (`reference_link`), записывая их в задачу. База знаний растёт с каждой задачей — следующая похожая задача находит проверенные источники сразу. Подробнее: [Референсные проекты](doc-3-Референсные-проекты-backlogreferences.md) (doc-3).

---

## 14. Lessons learned (VL-153)

Lessons learned — workflow-уроки из опыта задач: сформулированные проблемы и их решения, которые предотвращают повторение ошибок в будущих задачах. Хранятся отдельно от задач: задача в статусе Done заморожена, а урок эволюционирует (уточняется, объединяется, устаревает).

Файлы — `backlog/lessons/lesson-N-<slug>.md`: YAML-фронтматтер (id, title, status, tags, source_tasks, linked_tasks, created_date, updated_date, supersedes) + markdown-тело «Проблема / Решение / Пример». Статусы: `active` (по умолчанию), `outdated`, `superseded` (заменён другим уроком — через `lesson_supersede`).

```bash
vibelog lesson list                              # все lessons
vibelog lesson list --status active --tags mcp   # фильтры
vibelog lesson create "Тесты со spawn медленные — запускай батчами по 10" \
  --tags core,tests --source-tasks VL-153 -d "Проблема: ..."
vibelog lesson view lesson-1                     # метаданные + linked_tasks + тело
vibelog lesson search "spawn"                    # поиск по id/title/tags/телу
vibelog lesson link lesson-1 VL-160              # двусторонняя связь с задачей
vibelog lesson supersede lesson-1 lesson-5       # lesson-1 → superseded, lesson-5 ссылается на него
```

Формулировка урока — императив, конкретика, 1 предложение. Хорошо: «Тесты со spawn медленные — запускай батчами по 10». Плохо: «Производительность тестов».

Связь с задачей двусторонняя: `linked_tasks` урока ↔ `lessons` задачи (`vibelog lesson link` или MCP `lesson_link`).

**Интеграция с фазами**:
- **Close пишет автоматически** (шаг 6.5): при закрытии задачи, которая была в Code, формулирует 1–3 урока (если есть чему учить), проверяет похожие активные lessons и обновляет их или создаёт новые, связывает задачу.
- **Plan читает автоматически**: активные lessons с теми же tags/labels, что у задачи, подставляются в промпт Plan через переменную `{{taskLessons}}` (0 дополнительных ходов модели).
- **Code связывает применённые** (шаг 6.5): использовал существующий lesson — оставляет связь, создал новый — создаёт и связывает.

Чем больше задач выполнено, тем больше накапливается уроков — следующая похожая задача планируется с учётом уже сделанных ошибок. Отличие от других сущностей: references — внешние источники; decisions — архитектурные решения («почему X, не Y»); docs — документация проекта; lessons — workflow-уроки, эволюционирующие независимо от задач.

---

## 15. Диагностика

```bash
vibelog doctor          # проверка окружения
vibelog doctor --json   # структурированный результат
```

Проверяет: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, число MCP-инструментов (36), `backlog/`, конфиг, round-trip с Backlog.md.

Если Qwen Code не видит новые MCP-инструменты — MCP-сервер закэширован: перезапустите Qwen Code.

---
