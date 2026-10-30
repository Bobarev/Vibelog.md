# Подключение Vibelog.md MCP к Qwen Code

## Что такое MCP

Model Context Protocol (MCP) — протокол для подключения AI-агентов к внешним инструментам.
Vibelog.md реализует MCP-сервер поверх stdio (JSON-RPC 2.0), совместимый с Backlog.md.

## Доступные инструменты

| Инструмент | Описание |
|---|---|
| `backlog_create_task` | Создать задачу (title, description, priority, labels, type, parentTaskId, milestone, ...) |
| `backlog_list_tasks` | Список задач с фильтрацией (status, labels, type, parentTaskId, milestone, ready, sort); `fields` — выбор полей карточки |
| `backlog_view_task` | Просмотр задачи по ID; `fields` — выбор полей (алиасы camelCase/snake_case + смысловые `notes`/`plan`/`ac`/`dod`/`summary`); неизвестный ключ не валит вызов — он игнорируется, а в ответ добавляется `_warning` с ближайшими именами |
| `backlog_update_status` | Обновить статус задачи |
| `backlog_update_task` | Универсальное обновление полей (type, plan, notes, ...) |
| `backlog_manage_ac` | Управление критериями приёмки (add/check/uncheck/remove/list) |
| `backlog_manage_dod` | Управление Definition of Done |
| `backlog_add_comment` | Добавить комментарий к задаче |
| `backlog_update_dependencies` | Зависимости задач (с детектом циклов) |
| `backlog_search` | Поиск задач: токены (И-логика) с ранжированием id > title > labels > description; ответ `{found, returned, tasks}`; `fields` — выбор полей карточки (те же правила `_warning`, что у `backlog_view_task`) |
| `backlog_ready` | Задачи, готовые к выполнению |
| `milestone_list` | Список вех (milestones) |
| `milestone_add` | Создать веху |
| `milestone_rename` | Переименовать веху (обновляет задачи) |
| `milestone_remove` | Удалить веху (clear / keep / reassign задач) |
| `milestone_archive` | Архивировать веху |
| `reference_list` | Список references (фильтры type/tags) |
| `reference_add` | Добавить reference; для repo клонирует в backlog/references/data/ |
| `reference_view` | Показать reference (метаданные, linked_tasks, тело) |
| `reference_search` | Поиск references по запросу |
| `reference_remove` | Удалить reference (клон в data/ сохраняется) |
| `reference_update` | Обновить теги/описание reference (полная замена) |
| `reference_link` | Двусторонняя связь reference ↔ задача (linked_tasks ↔ task.references) |
| `reference_sync` | Доклонировать отсутствующие репозитории (type=repo) |

Всего 29 инструментов. Полный список с параметрами — в [MCP-справочнике](backlog/docs/doc-8-MCP-справочник-Vibelogmd.md).
Поле `type` (bug, feature, ...) поддерживают create / list / update.

## Настройка в Qwen Code

### Автоматическая настройка (vibelog init)

`vibelog init` сам настраивает MCP: в `.qwen/settings.json` проекта
добавляется секция (ключи остальных настроек сохраняются):

```json
{
  "mcpServers": {
    "vibelog": {
      "command": "vibelog",
      "args": ["mcp", "start"],
      "trust": true
    }
  }
}
```

Перезапустите Qwen Code и проверьте статус через `/mcp`.
Отключение автонастройки: `vibelog init --no-mcp`.

Для варианта `"command": "vibelog"` команда должна быть в PATH
(например, `pnpm link --global`). Если её нет — см. «Ручная настройка».

### Альтернатива: qwen mcp add

```bash
# В корне проекта с Vibelog.md:
qwen mcp add vibelog -- node /путь/к/vibelog.md/bin/vibelog.mjs mcp start
```

### Ручная настройка

Добавьте в файл `.qwen/settings.json` в проекте (или `~/.qwen/settings.json`):

```json
{
  "mcpServers": {
    "vibelog": {
      "command": "vibelog",
      "args": ["mcp", "start"],
      "trust": true
    }
  }
}
```

Если команда `vibelog` не в PATH — укажите путь к скрипту напрямую:

```json
{
  "mcpServers": {
    "vibelog": {
      "command": "node",
      "args": ["/путь/к/vibelog.md/bin/vibelog.mjs", "mcp", "start"]
    }
  }
}
```

### Проверка подключения

После добавления сервера:

1. Перезапустите Qwen Code
2. Выполните `/mcp` для проверки статуса серверов
3. Попросите агента: "Покажи список задач из backlog"
4. Агент должен вызвать `backlog_list_tasks` и вернуть результат

## Использование

После подключения MCP AI-агент может:

- **Создавать задачи:** "Создай задачу 'Добавить авторизацию' с критериями..."
- **Просматривать:** "Покажи задачу LB-1"
- **Обновлять:** "Переключи задачу LB-1 в 'In Progress'"
- **Искать:** "Найди задачи по слову 'авторизация'"
- **Проверять готовность:** "Какие задачи готовы к выполнению?"

## Автоматическая инициализация

Если backlog не инициализирован, MCP-сервер вернёт ошибку.
Выполните инициализацию через CLI:

```bash
vibelog init "Имя проекта"
```

init также настраивает MCP-сервер в `.qwen/settings.json`
(см. «Автоматическая настройка» выше; отключение — `--no-mcp`).

## Совместимость с Backlog.md

MCP-инструменты Vibelog.md идентичны Backlog.md:
- Те же названия (`backlog_*`)
- Те же параметры
- Тот же формат ответов

Если вы перейдёте на оригинальный Backlog.md (после апгрейда macOS),
просто замените путь к серверу в конфиге — формат данных совместим.

## Сторонние MCP-серверы vibelog-агента

Vibelog-агент (`vibelog` в интерактивном режиме, `vibelog-agent` для фаз)
помимо собственных инструментов подключает любые сторонние stdio
MCP-серверы из конфига проекта — без правки кода. Первичный сценарий —
веб-тестирование через браузер (chrome-devtools MCP).

### Где конфиг

Секция `mcpServers` в `.vibelog/settings.json` — в формате Qwen Code
(тот же синтаксис, что в `.qwen/settings.json`). Файл лежит в gitignored
`.vibelog/` — конфигируется per-machine.

> **Branch-mode (worktree).** Фазы агента запускаются с cwd=worktree,
> а `.vibelog/` в `.gitignore` — в worktree этого файла нет. Поэтому
> агент читает `.vibelog/settings.json` **главного репо** (путь берётся
> из переменной окружения `VIBELOG_CWD`, которую задаёт оркестратор),
> а процессы серверов спавнит в worktree фазы. Практически это значит:
> per-machine конфиг настраивается один раз в главном репо — во все
> worktree/ветки он подтягивается автоматически (VL-167).

### Формат записи сервера

| Поле | Тип | Описание |
|---|---|---|
| `command` | строка | команда запуска (обязательно) |
| `args` | массив строк | аргументы команды |
| `env` | объект строк | доп. окружение сервера поверх окружения агента |
| `enabled` | boolean | `false` — сервер не подключается (запись остаётся в файле) |
| `timeoutMs` | число | таймаут одного JSON-RPC запроса, мс (дефолт 60000) |

### Порядок добавления нового сервера

1. Отредактируйте `.vibelog/settings.json` проекта — добавьте запись в
   `mcpServers` (создайте секцию, если её нет):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--executablePath=/Applications/Yandex.app/Contents/MacOS/Yandex",
        "--isolated",
        "--headless=false"
      ],
      "timeoutMs": 120000
    }
  }
}
```

2. Запустите агента (`vibelog` в интерактивном TTY или фазу
   `vibelog-agent <фаза> <ID>`). Серверы подключаются автоматически при
   старте; `--no-mcp` отключает и их тоже.

3. Инструменты сервера доступны модели с префиксом «имя-сервера__»
   (дефисы заменяются на подчёркивания): например,
   `chrome_devtools__navigate_page`, `chrome_devtools__evaluate_script`.
   Префикс защищает от коллизий между серверами и с инструментами
   Vibelog; сама модель вызывает их как обычные инструменты.

   **Экономия контекста (VL-178):** `take_screenshot` и полный
   `take_snapshot` без `filePath` агенту использовать не следует — они
   заливают контекст выводами в десятки/сотни КБ. Вместо них —
   `evaluate_script` (только нужный кусок DOM) либо `take_snapshot` с
   `filePath` (снапшот на диск, в контекст — подтверждение записи).

Первый запуск `npx`-сервера может быть медленным (загрузка пакета) —
увеличьте `timeoutMs`, если handshake не успевает.

### Пример: веб-тестирование через chrome-devtools

После конфигурации выше агенту можно прямо в чате:

```
Открой https://example.com, выполни evaluate_script для проверки заголовка
и покажи сообщения консоли
```

Агент вызовет `chrome_devtools__*`-инструменты подключённого сервера.

### Диагностика

- stderr агента: строки `[external-mcp] сервер «<имя>»: подключено
  инструментов — N` при успехе и `Предупреждение: внешний MCP-сервер
  «<имя>» недоступен — …` при отказе (нет бинарника, таймаут handshake).
- Отказ одного сервера не мешает остальным и не роняет фазу/чат.
- Битые записи конфига (нет `command`, `args` не массив и т.п.)
  пропускаются с предупреждением — остальные серверы подключаются.
- Секреты сервера (API-ключи) держите в окружении запуска агента или в
  `.env` проекта; `env`-запись сервера — только для несекретных
  настроек вроде пути к браузеру.
- Транскрипт сессии: `.vibelog/agent-sessions/<sessionId>.jsonl` —
  видны вызовы инструментов и результаты.
