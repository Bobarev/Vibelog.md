# Vibelog.md

Markdown-нативный таск-менеджер для git-репозиториев, совместимый с [Backlog.md](https://github.com/MrLesk/Backlog.md).

## Зачем

Оригинальный Backlog.md написан на Bun и не работает на macOS 10.15 Catalina. Vibelog.md — это совместимая замена на чистом Node.js:

- **Node.js 20+**, никаких нативных зависимостей
- **Формат данных идентичен** Backlog.md — при апгрейде macOS можно переключиться на оригинал
- **Работает с Qwen Code** через CLI и MCP
- **Zero runtime dependencies** — только встроенные модули Node.js

## Установка

```bash
pnpm install
pnpm link --global
```

## Быстрый старт

```bash
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

# Веб-интерфейс (kanban с drag-and-drop)
vibelog browser

# Поиск
vibelog search "авторизация"

# Инструкции для AI-агентов
vibelog instructions overview
```

## MCP-инструменты

11 инструментов для подключения к AI-агентам (Qwen Code, Claude Code и др.):

| Инструмент | Описание |
|---|---|
| `backlog_create_task` | Создать задачу |
| `backlog_list_tasks` | Список задач (фильтры: status, labels, milestone, ready, sort) |
| `backlog_view_task` | Просмотр задачи по ID |
| `backlog_update_status` | Обновить статус |
| `backlog_update_task` | Универсальное обновление полей (title, priority, plan, notes, final_summary) |
| `backlog_manage_ac` | Управление AC (add/check/uncheck/remove/list) |
| `backlog_manage_dod` | Управление DoD (add/check/uncheck/remove/list) |
| `backlog_add_comment` | Добавить комментарий |
| `backlog_update_dependencies` | Управление зависимостями (add/remove, детект циклов) |
| `backlog_search` | Поиск по текстовому запросу |
| `backlog_ready` | Задачи, готовые к выполнению |

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
✓ mcp_tools_count: 11
✓ mcp_tools_list: ["backlog_add_comment", ...]
✓ backlog_dir: ./backlog
✓ config: {"project_name":"My Project","task_prefix":"LB"}
✓ tasks_count: 6
✓ roundtrip: 5

⚠ Qwen Code: MCP-сервер мог быть закэширован. Перезапусти Qwen.
```

`vibelog doctor` проверяет: Node.js >= 20, `vibelog` в PATH, симлинк/pnpm shim, MCP-инструменты, `backlog/`, конфиг, round-trip с Backlog.md.

Если Qwen Code не видит новые MCP-инструменты — MCP-сервер закэширован. Перезапустите Qwen.

## Совместимость с Backlog.md

- Формат задач: `backlog/tasks/<prefix>-<id> - <title>.md`
- Frontmatter: YAML с полями `id`, `title`, `status`, `priority`, `assignee`, `created_date`, `updated_date`, `labels`, `dependencies`, `milestone`
- AC: `- [ ] #1 Текст критерия` в блоках `<!-- AC:BEGIN -->...<!-- AC:END -->`
- DoD: `- [ ] #1 Текст` в блоках `<!-- DOD:BEGIN -->...<!-- DOD:END -->`
- Комментарии: `<!-- COMMENTS:BEGIN -->...<!-- COMMENTS:END -->` с автором и timestamp
- Конфиг: `backlog/config.yml` или `backlog.config.yml`
- Round-trip подтверждён на 94 реальных задачах Backlog.md

## Лицензия

MIT
