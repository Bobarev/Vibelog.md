# PLAN-05: MCP-сервер

## Задача

Реализовать MCP-сервер (stdio, JSON-RPC 2.0), совместимый с Backlog.md.

## Перед началом

**Изучи оригинал:**
- `src/mcp/` в Backlog.md — как реализован сервер.
- Список MCP-инструментов и их схемы параметров.
- Названия инструментов: `backlog_create_task`, `backlog_list_tasks` и т.д. — точно.
- Как сервер резолвит проект (`BACKLOG_CWD`, MCP roots).
- URI-схемы: `backlog://workflow/overview`, `backlog://init-required`.

**Целевой клиент — Qwen Code**, не Claude Code. Проверь в документации Qwen Code, как он подключает MCP-серверы.

Если найдешь расхождения — правь план.

## Файлы

### `src/mcp/server.mjs`

- Чтение stdin построчно
- JSON-RPC 2.0
- Ответы в stdout
- Методы: `initialize`, `tools/list`, `tools/call`

### `src/mcp/tools.mjs`

Инструменты (совместимые с Backlog.md):

1. `backlog_create_task`
2. `backlog_list_tasks`
3. `backlog_view_task`
4. `backlog_update_status`
5. `backlog_search`
6. `backlog_ready`

Каждый — обёртка над `store.mjs`. JSDoc на русском.

### `src/cli/commands/mcp.mjs`

- `mcp start`

## Запуск

```bash
vibelog mcp start
```

Подключение в Qwen Code — по документации Qwen Code (см. `plan/PLAN-08-COMPATIBILITY.md`).

## Acceptance Criteria

- [ ] MCP-сервер отвечает на `initialize`
- [ ] `tools/list` возвращает 6 инструментов
- [ ] `tools/call` работает для всех
- [ ] Названия инструментов совпадают с Backlog.md
- [ ] Комментарии на русском

## Definition of Done

- [ ] `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node bin/vibelog.mjs mcp start` работает
- [ ] Если расхождения — план обновлён