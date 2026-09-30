# PLAN-04: CLI

## Задача

Реализовать CLI, совместимый с Backlog.md по командам и флагам.

## Перед началом

**Изучи оригинал:**
- `CLI-INSTRUCTIONS.md` в корне Backlog.md — полный список команд и флагов.
- `src/cli/` — как устроен роутер, как парсятся флаги.
- Формат вывода `backlog task list`, `backlog task view`, `backlog board` — сравнить визуально (можно по коду).

Если найдешь расхождения — правь план.

## Файлы

### `src/cli/router.mjs`

Диспетчер команд.

### `src/cli/args.mjs`

Парсер флагов:
- `--flag value`
- `--flag`
- `-f value`
- Повторяющиеся: `--ac "a" --ac "b"` → массив

### `src/cli/ui.mjs`

ANSI-цвета, таблицы, промпты `readline`.

### Команды (`src/cli/commands/`)

#### `init.mjs`
```bash
vibelog init "Project Name" [--no-git] [--prefix LB]
```
Создаёт `backlog/`, `backlog.config.yml`, `AGENTS.md`, `tasks/`, `archive/tasks/`.

#### `task.mjs`
- `task create "Title" [-d desc] [--ac ...] [--priority ...] [--deps ...] [--milestone ...] [--labels ...]`
- `task list [-s status] [-p priority] [-a assignee] [--json]`
- `task view <id> [--json]`
- `task edit <id> [--title ...] [--status ...] [--ac ...] [--check-ac N] [--uncheck-ac N] [--remove-ac N] [--plan ...] [--notes ...] [--append-notes ...] [--comment ...]`
- `task complete <id>`
- `task archive <id>`

#### `board.mjs`
- `board` — ANSI-канбан
- `board export` — markdown-экспорт

#### `browser.mjs`
- `browser [--port 3030] [--no-open]`

#### `milestone.mjs`
- `milestone add/rename/remove <name>`

#### `search.mjs`
- `search "query" [--json]`

#### `ready.mjs`
- `ready [--json]`

#### `instructions.mjs`
- `instructions` — список
- `instructions overview` — workflow для Qwen Code
- `instructions task-creation`
- `instructions task-execution`
- `instructions task-finalization`

#### `mcp.mjs`
- `mcp start`

#### `config.mjs`
- `config` — интерактивный визард

## Совместимость CLI

| Backlog.md | Vibelog.md |
|---|---|
| `backlog init` | `vibelog init` |
| `backlog task create` | `vibelog task create` |
| `backlog task list` | `vibelog task list` |
| `backlog task edit` | `vibelog task edit` |
| `backlog task complete` | `vibelog task complete` |
| `backlog task archive` | `vibelog task archive` |
| `backlog board` | `vibelog board` |
| `backlog browser` | `vibelog browser` |
| `backlog milestone ...` | `vibelog milestone ...` |
| `backlog search` | `vibelog search` |
| `backlog instructions` | `vibelog instructions` |
| `backlog mcp start` | `vibelog mcp start` |
| `backlog config` | `vibelog config` |

**Флаги — идентичны.** `--check-ac`, `--uncheck-ac`, `--remove-ac`, `--dod`, `--check-dod`, `--uncheck-dod`, `--plan`, `--notes`, `--append-notes`, `--comment`, `--final-summary`.

## Acceptance Criteria

- [ ] Все команды реализованы
- [ ] Флаги совместимы
- [ ] `task create` создаёт задачу в правильном формате
- [ ] `task list` фильтрует
- [ ] `board` рендерит ANSI-канбан
- [ ] `instructions overview` выводит workflow для Qwen Code (на русском)
- [ ] Комментарии на русском

## Definition of Done

- [ ] `node bin/vibelog.mjs init "Test"` работает
- [ ] `node bin/vibelog.mjs task create "Test"` работает
- [ ] `node bin/vibelog.mjs board` работает
- [ ] Если расхождения — план обновлён