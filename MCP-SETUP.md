# Подключение Vibelog.md MCP к Qwen Code

## Что такое MCP

Model Context Protocol (MCP) — протокол для подключения AI-агентов к внешним инструментам.
Vibelog.md реализует MCP-сервер поверх stdio (JSON-RPC 2.0), совместимый с Backlog.md.

## Доступные инструменты

| Инструмент | Описание |
|---|---|
| `backlog_create_task` | Создать задачу (title, description, priority, labels, type, milestone, ...) |
| `backlog_list_tasks` | Список задач с фильтрацией (status, labels, type, milestone, ready, sort) |
| `backlog_view_task` | Просмотр задачи по ID |
| `backlog_update_status` | Обновить статус задачи |
| `backlog_update_task` | Универсальное обновление полей (type, plan, notes, ...) |
| `backlog_manage_ac` | Управление критериями приёмки (add/check/uncheck/remove/list) |
| `backlog_manage_dod` | Управление Definition of Done |
| `backlog_add_comment` | Добавить комментарий к задаче |
| `backlog_update_dependencies` | Зависимости задач (с детектом циклов) |
| `backlog_search` | Поиск по текстовому запросу |
| `backlog_ready` | Задачи, готовые к выполнению |
| `milestone_list` | Список вех (milestones) |
| `milestone_add` | Создать веху |
| `milestone_rename` | Переименовать веху (обновляет задачи) |
| `milestone_remove` | Удалить веху (clear / keep / reassign задач) |
| `milestone_archive` | Архивировать веху |

Всего 16 инструментов. Поле `type` (bug, feature, ...) поддерживают
create / list / update.

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
