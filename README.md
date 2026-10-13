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

После установки доступны два имени CLI: `vibelog` и алиас `vb` — один и тот же бинарь, поведение идентично (`vb --help` = `vibelog --help`). Запуск `vibelog` или `vb` **без аргументов** в интерактивном терминале открывает TUI-чат с LLM-агентом Vibelog (ключи `VIBELOG_LLM_*` читаются из `.env` проекта; см. [backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md)); в скриптах и CI (не-TTY) — обычная справка.

CLI автоматически проверяет npm registry на наличие новой версии (раз в сутки, молча). Если обновление доступно — в stderr выводится `⚠ Доступна новая версия для обновления: npm install -g vibelog.md (...)`, без автоустановки. Отключение: `VIBELOG_SKIP_UPDATE_CHECK=true`. Подробнее: [backlog/docs/doc-7-CLI-справочник-Vibelogmd.md](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md#автообновление).

### Из исходников (для контрибьюторов)

```bash
pnpm install
pnpm build
pnpm link --global
```

Исходники на TypeScript: `vibelog` запускает скомпилированный код из `dist/` — после изменений выполняйте `pnpm build`.

## Документация

| Документ | Для чего |
|---|---|
| [Руководство пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md) | Полный обзор: команды, флаги, форматы файлов, примеры |
| [Best practices и производительность](backlog/docs/doc-9-Best-practices-и-производительность-Vibelogmd.md) | Workflow с Qwen Code, dogfooding, сценарии «было/стало» |
| [CLI-справочник](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md) | Все команды, подкоманды и флаги |
| [MCP-справочник](backlog/docs/doc-8-MCP-справочник-Vibelogmd.md) | 22 MCP-инструмент: параметры и примеры вызовов |
| [MCP-подключение](MCP-SETUP.md) | Подключение Vibelog MCP к Qwen Code |
| [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md) | Собственный LLM-агент: headless-замена qwen в фазах, TUI, лимиты, замер токенов |

## Быстрый старт

```bash
# Алиас vb — то же самое, что vibelog; vb без аргументов в интерактивном
# терминале открывает TUI-чат с LLM-агентом (в скриптах/CI — справка)

# Инициализация backlog-а в текущем git-репозитории
vibelog init "Мой проект"

# Создание задачи
vibelog task create "Добавить авторизацию" -d "Реализовать JWT" --ac "Токен создаётся" --ac "Токен обновляется"

# Список задач
vibelog task list
vibelog task list --ready --sort priority

# Просмотр задачи
vibelog task view LB-1

# Доска задач (терминал)
vibelog board

# Веб-интерфейс (Kanban-доска, React UI из web/dist; сборка UI: pnpm web:build)
# Перенос карточки в Spec/In Progress/Review запускает фазу qwen
# (оркестратор VL-28; требуется qwen в PATH или VIBELOG_QWEN_BIN)
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

22 инструмента для подключения к AI-агентам (Qwen Code, Claude Code и др.).
Автоматическая настройка: `vibelog init` пишет `mcpServers` в `.qwen/settings.json`
(см. [MCP-SETUP.md](MCP-SETUP.md)).

| Инструмент | Описание |
|---|---|
| `backlog_create_task` | Создать задачу (title, priority, type, milestone, project, ordinal, finalSummary) |
| `backlog_list_tasks` | Список задач (фильтры: status, labels, type, milestone, ready, sort) |
| `backlog_view_task` | Просмотр задачи по ID |
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
| `/vibelog:spec <описание>` | 1 | Уточнить фичу и определить масштаб |
| `/vibelog:plan <ID>` | 2 | Составить план реализации |
| `/vibelog:code <ID>` | 3 | Реализовать план (статус Review) |

Workflow: spec → plan → code. Интерактивные команды ждут подтверждения пользователя; автоматические фазы (web-оркестратор, vibelog-agent) выполняются без подтверждения.

### Агент Vibelog (замена qwen)

Оркестратор фаз может использовать собственный LLM-агент Vibelog вместо Qwen Code — без правок кода оркестратора:

```bash
VIBELOG_QWEN_BIN=$(pwd)/bin/vibelog-agent.mjs vibelog browser
```

Агент: интерактивный TUI или `--headless` (JSON `type=result`, контракт `parseQwenResult`), loop detection, лимиты tool-calls/wall-time, локальные инструменты + Vibelog MCP. LLM — env `VIBELOG_LLM_BASE_URL` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_MODEL` (Cloud.ru). Детали: [backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md).

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

Команды: `/tasks`, `/task VL-1`, `/board`, `/diff`, `/commits`, фазы `/spec`, `/plan`, `/code`, `/close`, `/comment`, `/prompt`, настройки `/set`, самоперезапуск `/restart`. Полный список — в [руководстве пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md).

### Параллельная разработка в git-ветках (VL-107)

Режим для параллельной разработки нескольких задач: каждая задача получает git-ветку `vb/vl-N` и worktree `.vibelog/worktrees/vl-N`; фазы агента работают в worktree, backlog остаётся общим в главном репозитории.

Создание worktree (VL-134): каталог впервые создаётся только при запуске Фазы Plan — до этого (включая Spec) фазы работают в главном репозитории. Для задач типа epic worktree не создаётся ни на одной из фаз. Уже созданный worktree используется всеми последующими фазами задачи (comment/resume/code) и не пересоздаётся; фаза без worktree идёт в главном cwd.

```bash
# В привязанном Telegram-чате бота:
/set branch-mode on    # включить режим (ключ branch_mode в .vibelog/settings.json)
/set branch-mode off   # выключить; перезапуск бота не требуется

/restart VL-107        # собрать worktree ветки vb/vl-107 и перезапустить бота из неё
/restart               # перезапуск из корневого dist/ (прежнее поведение)
```

Как работает:

- При включённом режиме запуск Фазы Plan для задачи `VL-N` создаёт worktree (`git worktree add -b vb/vl-N .vibelog/worktrees/vl-N HEAD`) и запускает агента с cwd worktree; остальные фазы используют уже созданный worktree, а до Plan работают в главном репозитории. MCP-сервер настроен на главный репозиторий через `VIBELOG_CWD` — статусы и комментарии пишутся в общий `backlog/`, worktree-копия backlog не трогается.
- `/restart VL-N` собирает worktree главным `tsc` (без сети и без `pnpm install` в worktree — рантайм-зависимости резолвятся walk-up в главный node_modules) и перезапускает бота из `…/vl-N/bin/vibelog.mjs` с cwd главного репозитория (токен и backlog общие).
- Закрытие задач с worktree идёт по отдельному шаблону (`templates/qwen-commands/phase-close-worktree.md`): сама Фаза Close запускается в главном репозитории, проверяет чистоту worktree (незакоммиченное — коммитит в ветку `vb/vl-N`), сливает ветку через `git merge --no-ff`, при конфликте — не резолвит его и не меняет статус (задача остаётся в Review с отчётом о файлах конфликта), после успешного слияния удаляет worktree и ветку. Без worktree Close идёт по обычному шаблону `phase-close.md`.
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
