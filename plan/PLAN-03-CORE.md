# PLAN-03: Ядро (Core)

## Задача

Реализовать ядро: управление задачами, конфигом, зависимостями, поиском.

## Перед началом

**Изучи оригинал:**
- Формат имени файла задачи: `task-<id> - <title>.md` — проверь точно.
- Формат AC: `- [ ] #1 text` — проверь точный синтаксис.
- Формат DoD: маркеры `<!-- DOD:BEGIN -->` / `<!-- DOD:END -->` — проверь.
- Структуру `backlog/`: есть ли `drafts/`, `archive/tasks/`, `milestones/`, `docs/`, `decisions/`.
- Поля конфига в `backlog.config.yml` — точный список.
- Поля frontmatter: `created_date`, `updated_date` или `created`, `updated`?

Если найдешь расхождения — правь план.

## Файлы

### `src/core/paths.mjs`

- `findBacklogDir(cwd)` → путь к `backlog/` или `.backlog/`, или из `backlog.config.yml`
- `tasksDir(backlogDir)` → `backlogDir/tasks`
- `archiveDir(backlogDir)` → `backlogDir/archive/tasks`
- `draftsDir(backlogDir)` → `backlogDir/drafts`
- `configPath(backlogDir)` → `backlogDir/config.yml` или корневой `backlog.config.yml`

### `src/core/config.mjs`

- `loadConfig(cwd)` → объект конфига (YAML)
- `saveConfig(cwd, config)` → запись YAML
- `defaultConfig(projectName, prefix)` → конфиг по умолчанию

Структура конфига — **точно как в оригинале** (изучить `ADVANCED-CONFIG.md` и реальный `backlog.config.yml`). Минимум:
```yaml
version: 1
project_name: "Vibelog.md"
task_prefix: "LB"
statuses: ["To Do", "In Progress", "Review", "Done", "Blocked"]
definition_of_done:
  - "Тесты проходят"
  - "Документация обновлена"
  - "Нет регрессий"
```

### `src/core/id.mjs`

- `nextTaskId(cwd, prefix)` → `<prefix>-<n>` (n = max + 1)
- Сканирует `tasks/` и `archive/tasks/`

### `src/core/task.mjs`

Модель Task:
- `createTask(input, config)` → объект
- `taskToMarkdown(task)` → строка
- `markdownToTask(content)` → объект

Поля: `id`, `title`, `status`, `priority`, `assignee`, `created_date`, `updated_date`, `labels`, `dependencies`, `milestone`, `references`, `documentation`, `description`, `acceptanceCriteria`, `definitionOfDone`, `implementationPlan`, `implementationNotes`, `finalSummary`.

Формат AC: `- [ ] #1 text` (нумерация — как в оригинале).
Формат DoD: `- [ ] text` с маркерами.

### `src/core/store.mjs`

CRUD:
- `listTasks(cwd)`
- `getTask(cwd, id)`
- `createTask(cwd, input)`
- `updateTask(cwd, id, updates)`
- `archiveTask(cwd, id)`
- `completeTask(cwd, id)`

### `src/core/deps.mjs`

- `blockedBy(cwd, task)`
- `blocks(cwd, task)`
- `isReady(cwd, task)`
- `validateDeps(cwd, task, allTasks)` — детект циклов

### `src/core/search.mjs`

- `searchTasks(cwd, query)` — substring по title, description, labels

### `src/core/markdown.mjs`

Мини-рендерер markdown → HTML:
- Заголовки
- Списки, чеклисты
- Код (inline и блоки)
- Ссылки
- Жирный, курсив

## Acceptance Criteria

- [ ] Все файлы ядра созданы
- [ ] `createTask` создаёт файл в формате `task-<id> - <title>.md`
- [ ] `listTasks` читает все задачи
- [ ] `loadConfig` читает YAML-конфиг
- [ ] `searchTasks` работает
- [ ] `deps.mjs` детектит циклы
- [ ] `markdown.mjs` рендерит markdown
- [ ] Комментарии на русском

## Definition of Done

- [ ] `node --test src/core/*.test.mjs` проходит
- [ ] Создание/чтение/обновление работают
- [ ] Если обнаружены расхождения — план обновлён