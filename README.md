# Vibelog.md

Markdown-нативный таск-менеджер для git-репозиториев, совместимый с [Backlog.md](https://github.com/MrLesk/Backlog.md).

Репозиторий: [https://gitverse.ru/bobarev/Vibelog.md](https://gitverse.ru/bobarev/Vibelog.md).

## Зачем

Оригинальный Backlog.md написан на Bun и не работает на macOS 10.15 Catalina. Vibelog.md — это совместимая замена на чистом Node.js:

- **Node.js 20+**, никаких нативных зависимостей
- **Формат данных идентичен** Backlog.md — при апгрейде macOS можно переключиться на оригинал
- **Работает с Qwen Code** через CLI и MCP
- **Минимум зависимостей** — runtime-зависимость только grammy (Telegram-бот)

## Установка

Требуется [Node.js](https://nodejs.org) 20+.

```bash
npm install -g vibelog.md
```

В пакете уже собраны CLI (`dist/`) и веб-интерфейс (`web/dist`) — ничего компилировать не нужно. Одноразовый запуск без установки: `npx vibelog.md`.

После установки доступны два имени CLI: `vibelog` и алиас `vb` — один и тот же бинарь, поведение идентично (`vb --help` = `vibelog --help`). Запуск `vibelog` или `vb` **без аргументов** показывает справку (эквивалент `vibelog help`). TUI-чат с LLM-агентом Vibelog запускается командой `vibelog agent` (или `vibelog agent <task-id>` — карточка задачи в контексте чата; ключи `VIBELOG_LLM_*` читаются из `.env` проекта; см. [backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md)).

CLI автоматически проверяет npm registry на наличие новой версии (раз в сутки, молча). Если обновление доступно — в stderr выводится `⚠ Доступна новая версия для обновления: npm install -g vibelog.md (...)`, без автоустановки. Отключение: `VIBELOG_SKIP_UPDATE_CHECK=true`. Подробнее: [backlog/docs/doc-7-CLI-справочник-Vibelogmd.md](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md#автообновление).

### Из исходников (для контрибьюторов)

```bash
pnpm install
pnpm build
pnpm link --global
```

Исходники на TypeScript: `vibelog` запускает скомпилированный код из `dist/` — после изменений выполняйте `pnpm build`.

Тесты: `pnpm test` (сборка + Vitest) или `pnpm test:fast` (только Vitest, без сборки — для быстрых итераций, когда `dist/` уже собран).

## Документация

| Документ | Для чего |
|---|---|
| [Руководство пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md) | Полный обзор: команды, флаги, форматы файлов, примеры |
| [Best practices и производительность](backlog/docs/doc-9-Best-practices-и-производительность-Vibelogmd.md) | Workflow с Qwen Code, dogfooding, сценарии «было/стало» |
| [CLI-справочник](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md) | Все команды, подкоманды и флаги |
| [MCP-справочник](backlog/docs/doc-8-MCP-справочник-Vibelogmd.md) | 29 MCP-инструмент: параметры и примеры вызовов |
| [MCP-подключение](MCP-SETUP.md) | Подключение Vibelog MCP к Qwen Code |
| [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md) | Собственный LLM-агент: headless-замена qwen в фазах, TUI, лимиты, замер токенов |

## Быстрый старт

```bash
# Алиас vb — то же самое, что vibelog; без аргументов — справка, а чат
# с LLM-агентом (TUI) открывает vibelog agent [task-id]

# Инициализация backlog-а в текущем git-репозитории
vibelog init "Мой проект"

# Создание задачи
vibelog task create "Добавить авторизацию" -d "Реализовать JWT" --ac "Токен создаётся" --ac "Токен обновляется"

# Список задач
vibelog task list
vibelog task list --ready --sort priority

# Просмотр задачи
vibelog task view LB-1

# Отклонение задачи (Rejected + перенос файла в backlog/completed/;
# опциональный комментарий добавляется в задачу). Если задача хотя бы
# раз была в статусе Code — предварительный откат начатых изменений
# через LLM-фазу reject, иначе чисто механически, без LLM
vibelog task reject LB-1 "задача больше не актуальна"

# Доска задач (терминал)
vibelog board

# Веб-интерфейс (React UI из web/dist; сборка UI: pnpm web:build)
# Шапка (VL-166): сворачивание сайдбара (Ctrl/Cmd+B), глобальный поиск
# (input с debounce 300ms, GET /api/search по задачам/lessons/references/
# documents, VL-185),
# параметры вида (тема/стиль/свертка сайдбара), переключатель темы,
# ссылка на репозиторий, юзер-меню (git_user_name из настроек)
# Сайдбар: «Задачи» (#/ — доска или список по последнему выбранному
# виду; активен и на #/tasks), References (#/references — список внешних
# источников с type/url/tags/linked_tasks и кнопкой Sync — POST
# /api/references/sync клонирует отсутствующие репо; #/reference/<id> —
# просмотр title/type/url/path/tags/body/linked_tasks и редактирование
# title/tags/url/body через PATCH /api/references/:id, VL-174),
# Documents (#/documents — список документов (type/tags/created_date,
# фильтры по type и тегам, кнопка "+ Документ" → POST /api/documents);
# #/document/<id> — просмотр (title/type/tags/body/created_date, markdown)
# и редактирование через PATCH /api/documents/:id, VL-181), Lessons
# (#/lessons — список lessons (id/title/status/tags, клиентские фильтры
# по status и тегам); #/lesson/<id> — просмотр title/status/tags/body
# (markdown-рендер) и source_tasks/linked_tasks ссылками на задачи
# (клик открывает модалку задачи на доске), редактирование title/tags/
# body/status через PATCH /api/lessons/:id, VL-182) и вложенное
# меню «Настройки»:
# «Бот» (#/settings — те же опции, что /set в боте, .vibelog/settings.json,
# без секретов env) и «Конфиг проекта» (#/config — backlog/config.yml)
# Запуск фаз из веб-интерфейса (POST /api/tasks/:id/trigger, кнопки карточки)
# использует агента default_agent из .vibelog/settings.json — как бот,
# без захардкоженного значения (VL-180)
# Перенос карточки в Spec/In Progress/Review запускает фазу
# (оркестратор VL-28; агент — default_agent из .vibelog/settings.json,
# по умолчанию qwen — требуется qwen в PATH или VIBELOG_QWEN_BIN)
# Карточка в To Do содержит кнопку «✖ Reject» — отклонение задачи
# (VL-163) Quick Create «Создать задачу» в сайдбаре — модальное окно создания;
# клик по карточке — просмотр задачи (кнопка «Редактировать» — форма
# с метаданными, «Архивировать» — в edit-режиме; поля: заголовок/описание/
# статус/приоритет/срок/метки/исполнители — TaskForm)
# (VL-172) Просмотр задачи: табы-секции по образцу карточки бота (Описание,
# Acceptance Criteria, Definition of Done, Implementation Plan, Implementation
# Notes, Final Summary, Комментарии) с markdown-рендером; поле комментария
# доступно на всех табах; кнопки действий по текущему статусу как в боте
# (To Do → ▶ Spec + ✖ Reject, Spec → 📋 Plan, Planned/In Progress → 💻 Code,
# Review → ✅ Close, всегда 💬 Комментарий) — введённый комментарий записывается
# в задачу и уходит в {{comment}} промпта запускаемой фазы; «Отмена» в
# edit-режиме возвращает в просмотр без сохранения
# (VL-175) Роут #/tasks — таблица задач: колонки ID/Title/Status/Priority/
# Type/Labels/Milestone/Updated; сортировка по клику на заголовок
# (asc → desc → сброс; status/priority — по порядку из конфига, Updated — по
# дате, пустые значения в конце); пагинация (25/50/100 + Prev/Next/номера
# страниц) и счётчик «Показано N из M»; клик по строке — просмотр задачи
# (VL-176) Фильтры таблицы #/tasks: 6 multi-select-групп (Status/Priority/
# Type — опции из GET /api/config плюс фактические значения задач;
# Labels/Milestone/Assignee — уникальные значения из загруженных задач);
# выбранное значение снимается повторным кликом, активная группа —
# border-dashed → solid со счётчиком, крестик в меню снимает группу;
# выбор сохраняется в localStorage (ключ vibelog.tasks.filters, чтение/
# запись в try/catch) и восстанавливается после перезагрузки; кнопка
# «Сбросить фильтры» очищает всё; фильтры применяются до сортировки и
# пагинации, счётчик «Показано N из M» учитывает фильтры, смена фильтра
# возвращает на страницу 1
# (VL-177) Переключатель видов в тулбаре (по образцу ref-2): табы
# Board/List/Table — Board и List работают на #/ (вид board/list
# сохраняется в localStorage vibelog.tasks.view и восстанавливается после
# перезагрузки), Table ведёт на #/tasks (и там таб активен; hash главнее
# localStorage); поиск по id/title (substring, без учёта регистра)
# фильтрует доску, список и таблицу; кнопка «Фильтр» раскрывает/скрывает
# панель multi-select-фильтров (общая с #/tasks, синхрон через
# localStorage); «Сортировка» — меню «поле + направление», меняет тот же
# sort-state, что и клики по заголовкам таблицы; «Создать задачу» —
# модалка Quick Create (на #/ — событие, на #/tasks — локальная модалка
# страницы); List-вид — строки (ID/Title/бейджи Status и Priority/Labels/
# Updated), клик — просмотр задачи; пункт сайдбара «Канбан» переименован
# в «Задачи» и подсвечивается на #/ и #/tasks
vibelog browser

# Поиск (флаги: --status/--type/--priority/--limit)
vibelog search "авторизация"

# Вехи (milestones)
vibelog milestone add v1.4

# Документы, черновики, решения (ADR)
vibelog doc create "Гайд API" --type guide
vibelog draft create "Идея виджета"
vibelog decision create "Перейти на pnpm" -s accepted

# Конфиг проекта
vibelog config list

# Инструкции для AI-агентов
vibelog instructions overview
```

## MCP-инструменты

29 инструментов для подключения к AI-агентам (Qwen Code, Claude Code и др.).
Автоматическая настройка: `vibelog init` пишет `mcpServers` в `.qwen/settings.json`
(см. [MCP-SETUP.md](MCP-SETUP.md)).

| Инструмент | Описание |
|---|---|
| `backlog_create_task` | Создать задачу (title, priority, type, milestone, project, ordinal, finalSummary) |
| `backlog_list_tasks` | Список задач (фильтры: status, labels, type, milestone, ready, sort) |
| `backlog_view_task` | Просмотр задачи по ID; опционально fields — выбор возвращаемых полей (ключи Task, напр. `["id","title","description"]`) |
| `backlog_update_status` | Обновить статус |
| `backlog_update_task` | Универсальное обновление полей (title, priority, type, plan, notes, final_summary) |
| `backlog_manage_ac` | Управление AC (add/check/uncheck/remove/list; index — номер, массив или "all"; text — строка или массив) |
| `backlog_manage_dod` | Управление DoD (add/check/uncheck/remove/list; index — номер, массив или "all"; text — строка или массив) |
| `backlog_add_comment` | Добавить комментарий |
| `backlog_update_dependencies` | Управление зависимостями (add/remove, детект циклов) |
| `backlog_search` | Поиск с фильтрами (query, status, type, project, priority, modifiedFiles, limit) |
| `backlog_ready` | Задачи, готовые к выполнению |
| `milestone_list` | Список вех |
| `milestone_add` | Создать веху |
| `milestone_rename` | Переименовать веху (обновляет задачи) |
| `milestone_remove` | Удалить веху (clear/keep/reassign задач) |
| `milestone_archive` | Архивировать веху |
| `document_list` | Список документов |
| `document_view` | Показать документ |
| `document_create` | Создать документ |
| `document_update` | Обновить документ |
| `document_search` | Поиск по документам |

Подключение к Qwen Code: см. [MCP-SETUP.md](MCP-SETUP.md).

## Диагностика

### Версия и пути

```bash
$ vibelog --version
vibelog.md 1.1.1
  bin:  /Users/bob/Library/pnpm/vibelog
  src:  /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog.mjs
  node: v22.8.0

$ vibelog -v
1.1.1

$ vibelog --version --json
{
  "name": "vibelog.md",
  "version": "1.1.1",
  "bin": "/Users/bob/Library/pnpm/vibelog",
  "src": ".../bin/vibelog.mjs",
  "node": "v22.8.0",
  "engines": { "node": ">=20" }
}
```

### Проверка окружения

```bash
$ vibelog doctor

Vibelog.md doctor
────────────────

✓ node: v22.8.0
✓ path: /Users/bob/Library/pnpm/vibelog
✓ symlink: /Users/bob/Library/pnpm/vibelog (pnpm shim → .../bin/vibelog.mjs)
✓ sources_match: ok
✓ mcp_tools_count: 22
✓ mcp_tools_list: ["backlog_add_comment", ...]
✓ backlog_dir: ./backlog
✓ config: {"project_name":"My Project","task_prefix":"LB"}
✓ tasks_count: 6
✓ roundtrip: 5

⚠ Qwen Code: MCP-сервер мог быть закэширован. Перезапусти Qwen.
```

`vibelog doctor` проверяет: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, MCP-инструменты, `backlog/`, конфиг, round-trip с Backlog.md.

Если Qwen Code не видит новые MCP-инструменты — MCP-сервер закэширован. Перезапустите Qwen.

## Работа с Qwen Code

### Команды `/vibelog:*`

```bash
vibelog init "Мой проект" --skills
```

Создаёт в `.qwen/commands/vibelog/` три команды Qwen Code:

| Команда | Фаза | Описание |
|---|---|---|
| `/vibelog:spec <описание>` | 1 | Уточнить фичу, определить тип (из config types) и приоритет |
| `/vibelog:plan <ID>` | 2 | Составить план реализации |
| `/vibelog:code <ID>` | 3 | Реализовать план (статус Review) |

Workflow: spec → plan → code. Интерактивные команды ждут подтверждения пользователя; автоматические фазы (web-оркестратор, vibelog-agent) выполняются без подтверждения.

### Агент Vibelog (замена qwen)

Оркестратор фаз может использовать собственный LLM-агент Vibelog вместо Qwen Code — без правок кода оркестратора:

```bash
VIBELOG_QWEN_BIN=$(pwd)/bin/vibelog-agent.mjs vibelog browser
```

Агент: интерактивный TUI или `--headless` (JSON `type=result`, контракт `parseQwenResult`), loop detection, лимиты tool-calls/wall-time, локальные инструменты + Vibelog MCP. TUI написан на чистом Node.js (zero deps — без Ink/React, работает на Node 20+). LLM — env `VIBELOG_LLM_BASE_URL` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_MODEL` (Cloud.ru). Детали: [backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md).

Выбор агента для запусков фаз: команда бота с суффиксом (`/plan:vb …`) либо настройка проекта `default_agent` в `.vibelog/settings.json` (ключ задаётся через `/set agent vb` или веб-раздел «Настройки → Бот»). Один и тот же `default_agent` используют и бот, и запуск фаз из веб-интерфейса (`POST /api/tasks/:id/trigger`, кнопки карточки, перетаскивание на доске) — общий код (`startTaskPhase`), без хардкода агента в вебе (VL-180).

### Флаги init

```bash
vibelog init "Name" --skills          # создать команды (qwen по умолчанию)
vibelog init "Name" --skills=qwen     # явно указать агента
vibelog init "Name" --skills --force  # перезаписать существующие
vibelog init "Name" --no-skills       # не создавать команды
```

## Telegram-бот

```bash
vibelog bot   # long-polling: /start + пин-код для привязки чата
```

Команды: `/tasks`, `/task VL-1`, справка `/help`, `/board`, `/diff`, `/commits`, фазы `/spec`, `/plan`, `/code`, `/close`, `/comment`, `/prompt`, разбор сессии `/analyze vb:agent-XXX [комментарий]`, возобновление сессии `/resume vb:agent-XXX [комментарий]`, настройки `/set`, самоперезапуск `/restart`, веб-интерфейс `/web`. В карточке `/task` для задач в To Do есть кнопка «✖ Reject» (отклонение: статус Rejected + перенос в `backlog/completed/`; см. VL-144). Полный список — в [руководстве пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md).

Разбор сессии агента (VL-141) доступен и без бота — CLI-паритет `/analyze`; необязательный комментарий (VL-169) уточняет разбор:

```bash
vibelog agent analyze vb:agent-XXX [комментарий]   # статистика jsonl, вердикт, рекомендации
```

TUI-чат агента продолжает сохранённую сессию флагом `--resume` (VL-171):

```bash
vibelog agent --resume vb:agent-XXX   # чат стартует с историей сессии, ходы пишутся в тот же jsonl
```

Если итог `/analyze` не помещается в одно сообщение Telegram (лимит 4096 символов), бот разбивает его на несколько последовательных сообщений с нумерацией «часть i/N»; короткий итог приходит одним сообщением без изменений (VL-148).


### Фаза Code в сессии Plan (VL-147)

Экономия входных токенов: фаза code продолжает сессию агента фазы plan через `--resume` — большой контекст планирования уже в истории и попадает в кэш LLM, модель не инициализирует его заново.

```bash
# В привязанном Telegram-чате бота:
/set code-same-session on    # включить (ключ code_same_session в .vibelog/settings.json)
/set code-same-session off   # выключить (по умолчанию — выключен, текущее поведение)

/code VL-107 --same-session          # разово включить для одного запуска
/code VL-107 --no-same-session       # разово обойти включённую настройку
```

- Настройка выключена по умолчанию — без `/set code-same-session on` поведение прежнее (каждый `/code` — новая сессия).
- Источник plan-сессии — меты `.vibelog/agent-sessions/*.meta.json` (пишет CLI при старте задачной сессии; для qwen дополнительно дописывает оркестратор). Если план-сессия не найдена — поиск идёт также в каталоге сессий worktree задачи; мета не найдена нигде — code запускается в новой сессии, регрессий нет (VL-187).
- Наблюдаемость (VL-187): ответ `POST /api/tasks/:id/trigger` (202) и сообщения бота содержат статус продолжения: `sameSession: "applied"` (сессия plan продолжена) / `"no-plan-session"` (включено, но мета не найдена — новая сессия) / `"off"` / `"override-off"`. При fallback причина печатается в лог оркестратора (каталоги поиска + меты задачи).
- Reply-продолжение прерванной фазы из бота («Продолжи») больше НЕ затирает фазу в мете сессии: resume-ран не перезаписывает существующую мету — план-сессия остаётся `phase: plan` и остаётся доступной для `--resume` фазы code (VL-187, инцидент VL-185).
- API: `sameSession` (boolean) в `POST /api/tasks/:id/trigger` переопределяет настройку; UI-кнопки нет (вне масштаба).
- Возобновление дописывает историю план-сессии (без `--fork-session`): повторный `/code` продолжит ту же сессию «план+код» — это цель фичи, но сессия смешивает обе фазы. Если qwen-сессия потеряна в локальном хранилище qwen (~/.qwen), `--resume` падает с exit 1 — ошибка видна в боте/на доске, повторный обычный `/code` работает.

### Параллельная разработка в git-ветках (VL-107)

Режим для параллельной разработки нескольких задач: каждая задача получает git-ветку `vb/vl-N` и worktree `.vibelog/worktrees/vl-N`; фазы агента работают в worktree, backlog остаётся общим в главном репозитории.

Создание worktree (VL-134): каталог впервые создаётся только при запуске Фазы Plan — до этого (включая Spec) фазы работают в главном репозитории. Для задач типа epic worktree не создаётся ни на одной из фаз. Уже созданный worktree используется всеми последующими фазами задачи (comment/resume/code) и не пересоздаётся; фаза без worktree идёт в главном cwd.

```bash
# В привязанном Telegram-чате бота:
/set branch-mode on    # включить режим (ключ branch_mode в .vibelog/settings.json)
/set branch-mode off   # выключить; перезапуск бота не требуется

/restart VL-107        # собрать worktree ветки vb/vl-107 и перезапустить бота из неё
/restart               # перезапуск из корневого dist/ (прежнее поведение; в том числе после /restart VL-N — возврат из worktree в main)
```

Как работает:

- При включённом режиме запуск Фазы Plan для задачи `VL-N` создаёт worktree (`git worktree add -b vb/vl-N .vibelog/worktrees/vl-N HEAD`) и запускает агента с cwd worktree; остальные фазы используют уже созданный worktree, а до Plan работают в главном репозитории. MCP-сервер настроен на главный репозиторий через `VIBELOG_CWD` — статусы и комментарии пишутся в общий `backlog/`, worktree-копия backlog не трогается.
- `/restart VL-N` собирает worktree главным `tsc` (без сети и без `pnpm install` в worktree — рантайм-зависимости резолвятся walk-up в главный node_modules) и перезапускает бота из `…/vl-N/bin/vibelog.mjs` с cwd главного репозитория (токен и backlog общие). Пустой `/restart` вычисляет путь CLI от cwd процесса (`rootCliPath`), а не от location текущего dist — после `/restart VL-N` бот гарантированно возвращается в корневой dist, а не «застревает» в worktree (VL-151).
- Веб-интерфейс из чата (VL-161): `/web start [VL-N]` запускает `vibelog browser` дочерним процессом бота, `/web stop` его останавливает. Без аргумента CLI берётся от location текущего dist бота — после `/restart VL-N` веб стартует из того же worktree (проверка веб-версии ветки без второго перезапуска); с аргументом `VL-N` worktree собирается и веб запускается из него, пока бот продолжает работать из текущего dist. URL присылается в чат; повторный `/web start` перезапускает сервер, порт — `default_port` из config (3030 по умолчанию).
- Закрытие задач с worktree идёт по отдельному шаблону (`templates/qwen-commands/phase-close-worktree.md`): сама Фаза Close запускается в главном репозитории, проверяет чистоту worktree (незакоммиченное — коммитит в ветку `vb/vl-N`), сливает ветку через `git merge --no-ff`, при конфликте — не резолвит его и не меняет статус (задача остаётся в Review с отчётом о файлах конфликта), после успешного слияния удаляет worktree и ветку. Без worktree Close идёт по обычному шаблону `phase-close.md`.
- Сериализация Close (VL-146): в режиме веток одновременно выполняется только одна Фаза Close — merge в главном репозитории требует эксклюзивного доступа к git. Второй запуск `/close` (для другой задачи) не стартует, а ставится в очередь оркестратора и начинается автоматически после завершения текущего close; бот отвечает сообщением «поставлена в очередь». Очередь живёт в памяти процесса бота/browser: после рестарта отложенный close запускается командой `/close` заново.
- Worktree создаётся от закоммиченного HEAD — незакоммиченные изменения главного дерева в ветку не переносятся.
- Если ветка меняет зависимости — выполните `pnpm install` в worktree вручную.

Публикация npm не затрагивается: `.vibelog/worktrees` не входит в `package.json.files` и лежит в `.gitignore`; `pnpm build` главного репо worktree не стирает (dist ветки живёт внутри worktree).

## Совместимость с Backlog.md

- Формат задач: `backlog/tasks/<prefix>-<id> - <title>.md`
- Frontmatter: YAML с полями `id`, `title`, `status`, `priority`, `assignee`, `created_date`, `updated_date`, `labels`, `dependencies`, `milestone`
- AC: `- [ ] #1 Текст критерия` в блоках `<!-- AC:BEGIN -->...<!-- AC:END -->`
- DoD: `- [ ] #1 Текст` в блоках `<!-- DOD:BEGIN -->...<!-- DOD:END -->`
- Комментарии: `<!-- COMMENTS:BEGIN -->...<!-- COMMENTS:END -->` с автором и timestamp
- Конфиг: `backlog/config.yml` или `backlog.config.yml`
- Round-trip подтверждён на 94 реальных задачах Backlog.md

## Лицензия

[Unlicense](http://unlicense.org) (public domain)
