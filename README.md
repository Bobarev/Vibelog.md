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
vibelog task create "Добавить авторизацию" -d "Реализовать JWT-авторизацию" --ac "Токен создаётся" --ac "Токен обновляется"

# Доска задач (веб)
vibelog board

# Браузер (kanban в браузере)
vibelog browser
```

## Совместимость с Backlog.md

- Формат задач: `backlog/tasks/task-<id> - <title>.md`
- Frontmatter: YAML с полями `id`, `title`, `status`, `priority`, `assignee`, `created_date`, `updated_date`, `labels`, `dependencies`, `milestone`, `references`, `documentation`
- AC: `- [ ] #1 Текст критерия`
- DoD: `- [ ] Критерий` в блоках `<!-- DOD:BEGIN -->...<!-- DOD:END -->`
- Конфиг: `backlog.config.yml`
- CLI-команды и MCP-инструменты — идентичны

## Лицензия

MIT
