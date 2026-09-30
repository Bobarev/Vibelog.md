# PLAN-00: Обзор проекта Vibelog.md

## Цель

Создать CLI-инструмент **Vibelog.md** — markdown-нативный таск-менеджер, максимально совместимый с Backlog.md, на чистом Node.js + pnpm. Без нативных зависимостей, работает на macOS 10.15 Catalina, Node.js 20+.

## Причина существования

- Backlog.md не запускается на macOS 10.15 Catalina (Bun-рантайм с нативными бинарниками).
- Claude Code, Opencode и другие агенты не работают на Catalina.
- Работает только **Qwen Code**.
- Нужен совместимый инструмент, чтобы при апгрейде macOS можно было безболезненно вернуться к оригиналу.

Совместимость критична **только с Qwen Code** и **форматом данных** Backlog.md.

## Принципы

1. **Zero runtime dependencies** — только встроенные модули Node.js (`fs`, `path`, `http`, `url`, `readline`, `crypto`, `child_process`).
2. **ES Modules** — `"type": "module"`, все файлы `.mjs`.
3. **Максимальная совместимость с Backlog.md:**
   - Формат задач: `backlog/tasks/task-<id> - <title>.md`
   - Frontmatter: YAML с полями `id`, `title`, `status`, `priority`, `assignee`, `created_date`, `updated_date`, `labels`, `dependencies`, `milestone`, `references`, `documentation`
   - Формат AC: `- [ ] #1 Criterion text`
   - Формат DoD: `- [ ] Criterion text` с маркерами `<!-- DOD:BEGIN --> ... <!-- DOD:END -->`
   - Конфиг: `backlog.config.yml` (YAML)
   - CLI-команды и флаги — идентичны
   - MCP-инструменты — идентичны
4. **Git-native** — задачи в репозитории.
5. **Локальный веб-интерфейс** — `127.0.0.1`, drag-and-drop канбан, без CDN.
6. **Всё на русском** — комментарии, документация, сообщения.

## Структура папок (целевая)

```
Vibelog.md/
├── package.json
├── pnpm-lock.yaml
├── README.md
├── AGENTS.md
├── plan/
│   ├── PLAN-00-OVERVIEW.md
│   ├── PLAN-01-SCAFFOLD.md
│   ├── PLAN-02-YAML-FRONTMATTER.md
│   ├── PLAN-03-CORE.md
│   ├── PLAN-04-CLI.md
│   ├── PLAN-05-MCP.md
│   ├── PLAN-06-WEB.md
│   ├── PLAN-07-TESTS.md
│   └── PLAN-08-COMPATIBILITY.md
├── bin/
│   └── vibelog.mjs
├── src/
│   ├── cli/
│   │   ├── router.mjs
│   │   ├── args.mjs
│   │   ├── ui.mjs
│   │   └── commands/
│   │       ├── init.mjs
│   │       ├── task.mjs
│   │       ├── board.mjs
│   │       ├── browser.mjs
│   │       ├── milestone.mjs
│   │       ├── search.mjs
│   │       ├── ready.mjs
│   │       ├── instructions.mjs
│   │       ├── mcp.mjs
│   │       └── config.mjs
│   ├── core/
│   │   ├── config.mjs
│   │   ├── task.mjs
│   │   ├── store.mjs
│   │   ├── frontmatter.mjs
│   │   ├── yaml.mjs
│   │   ├── markdown.mjs
│   │   ├── id.mjs
│   │   ├── deps.mjs
│   │   ├── search.mjs
│   │   └── paths.mjs
│   ├── mcp/
│   │   ├── server.mjs
│   │   └── tools.mjs
│   └── web/
│       ├── server.mjs
│       ├── api.mjs
│       └── assets.mjs
├── templates/
│   ├── task.md
│   └── AGENTS.md
└── example-backlog/
    ├── backlog.config.yml
    └── tasks/
        └── task-LB-1 - ... .md
```

## Технические ограничения

- Node.js 20+
- macOS 10.15 Catalina (без нативных модулей)
- pnpm 10.7.1
- Zero runtime dependencies

## Что НЕ входит в v1

- Автокоммиты в git (можно добавить позже).
- Multi-backlog / worktree-резолвинг.
- Docs и Decisions (только tasks).
- Автоконфигурация MCP (пользователь добавляет вручную в Qwen Code).
- Watch-режим.

Эти пункты можно добавить после v1 — если понадобится.

## Этапы

См. `PLAN-01` … `PLAN-08`.

## Право на корректировку

План — живой документ. При обнаружении неточностей в процессе изучения оригинала Backlog.md — правь файлы плана и коммить отдельно.