# MCP-справочник Vibelog.md

21 инструмент MCP-сервера (stdio, JSON-RPC 2.0). Совместимо с Backlog.md.
Автоматическое подключение: `vibelog init` пишет `mcpServers` в `.qwen/settings.json`
(ручная настройка — в [MCP-SETUP.md](../MCP-SETUP.md)).

Формат вызова:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "backlog_create_task",
    "arguments": { "title": "Пример" }
  }
}
```

Смотрите также: [Руководство пользователя](user-guide.md) · [CLI-справочник](cli-reference.md)

---

## Задачи

### backlog_create_task — создать задачу

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок |
| `description` | string | | Описание |
| `priority` | string | | High / Medium / Low |
| `labels` | string[] | | Метки |
| `dependencies` | string[] | | ID зависимостей |
| `acceptanceCriteria` | string[] | | Тексты критериев |
| `status` | string | | Статус (по умолчанию из конфига) |
| `assignee` | string[] | | Исполнители |
| `milestone` | string | | Веха |
| `type` | string | | Тип (bug, feature, ...) — валидация по конфигу |
| `due_date` | string | | Срок (YYYY-MM-DD) |
| `ordinal` | number | | Порядковый номер |
| `project` | string | | Проект |
| `finalSummary` | string | | Итоговое резюме |

### backlog_list_tasks — список задач

| Параметр | Тип | Описание |
|---|---|---|
| `status` | string | Фильтр по статусу |
| `labels` | string[] | Фильтр по меткам |
| `milestone` | string | Фильтр по вехе |
| `type` | string | Фильтр по типу |
| `ready` | boolean | Только без невыполненных блокеров |
| `sort` | string | priority / created / updated |
| `limit` | number | Максимум задач |

### backlog_view_task — просмотр задачи

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |

### backlog_update_status — смена статуса

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `status` | string | ✓ | Статусы читаются из конфига |

### backlog_update_task — универсальное обновление

Обновляет только переданные поля.

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |
| `title`, `description`, `priority`, `assignee`, `labels`, `milestone`, `type`, `status` | — | |
| `plan` | string | Implementation Plan (полная замена) |
| `notes` | string | Implementation Notes (полная замена) |
| `append_notes` | string | Дописать в конец заметок |
| `final_summary` | string | Итоговое резюме |

### backlog_manage_ac / backlog_manage_dod — чеклисты

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `action` | string | ✓ | add / check / uncheck / remove / list |
| `text` | string | | Для action=add |
| `index` | number \| number[] | | Для check/uncheck/remove; массив — пачкой |

### backlog_add_comment — комментарий

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `comment` | string | ✓ | |
| `author` | string | | По умолчанию `@agent` |

### backlog_update_dependencies — зависимости

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `add` | string[] | | Добавить зависимости (детект циклов) |
| `remove` | string[] | | Удалить зависимости |

### backlog_search — поиск с фильтрами

| Параметр | Тип | Описание |
|---|---|---|
| `query` | string | Substring по id/title/description/меткам (необязателен) |
| `status`, `type`, `project`, `priority` | string | Фильтры полей (AND) |
| `modifiedFiles` | string[] | Подстрока в modified_files задачи |
| `limit` | number | 1–100 |

### backlog_ready — готовые к работе

Параметров нет. Возвращает задачи, у которых все зависимости выполнены.

---

## Вехи (milestones)

### milestone_list

| Параметр | Тип | Описание |
|---|---|---|
| `include_archived` | boolean | Включить архивные вехи |

### milestone_add

| Параметр | Тип | Required |
|---|---|---|
| `name` | string | ✓ |
| `description` | string | |
| `due_date` | string | |

### milestone_rename

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `from` | string | ✓ | |
| `to` | string | ✓ | |
| `update_tasks` | boolean | | Обновить задачи (по умолчанию true) |

### milestone_remove

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `name` | string | ✓ | |
| `task_handling` | string | | clear / keep / reassign (по умолчанию clear) |
| `reassign_to` | string | | Целевая веха для reassign |

### milestone_archive

| Параметр | Тип | Required |
|---|---|---|
| `name` | string | ✓ |

---

## Документы (documents)

### document_list

| Параметр | Тип | Описание |
|---|---|---|
| `query` | string | Фильтр по id/title/tags/телу |

### document_view

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |

### document_create

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | |
| `content` | string | ✓ | Markdown-содержимое |
| `type` | string | | readme / guide / specification / other |
| `tags` | string[] | | |

### document_update

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `title`, `content`, `type`, `tags` | | | Только переданные поля |

### document_search

| Параметр | Тип | Required |
|---|---|---|
| `query` | string | ✓ |

---

## Примеры вызовов

```json
// Создать задачу с типом и AC
{ "name": "backlog_create_task", "arguments": {
  "title": "Падение экспорта", "type": "bug", "priority": "High",
  "acceptanceCriteria": ["Экспорт CSV работает", "Тесты проходят"] } }

// Пачка отметок AC
{ "name": "backlog_manage_ac", "arguments": {
  "id": "api-1", "action": "check", "index": [1, 2, 3] } }

// Поиск: баги To Do с лимитом
{ "name": "backlog_search", "arguments": {
  "query": "экспорт", "status": "To Do", "type": "bug", "limit": 5 } }

// Задачи, готовые к работе
{ "name": "backlog_ready", "arguments": {} }
```
