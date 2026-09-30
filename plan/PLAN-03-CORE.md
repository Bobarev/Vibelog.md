# PLAN-03: Ядро (Core)

## Задача

Реализовать ядро: управление задачами, конфигом, зависимостями, поиском.

## Перед началом

**Анализ оригинала завершён.** Результаты:

- Формат имени файла задачи: `<prefix>-<id> - <title>.md` (где `<prefix>` = `task_prefix` из конфига, например `back-662`)
- Формат AC: `- [ ] #1 text` (нумерованные чеклисты, нумерация начинается с 1)
- Формат DoD: `- [ ] #1 text` (нумерованные чеклисты) в блоках `<!-- DOD:BEGIN -->...<!-- DOD:END -->`
- Структура `backlog/`: `tasks/`, `completed/`, `drafts/`, `docs/`, `decisions/`, `milestones/`, `config.yml`
- Поля конфига: `project_name`, `task_prefix`, `default_status`, `statuses[]`, `labels[]`, `priorities[]`, `definition_of_done[]`, `date_format`, `default_editor`, `default_port`, `auto_open_browser`, `remote_operations`, `auto_commit`, `bypass_git_hooks`, `check_active_branches`, `active_branch_days`, `max_column_width`, `zero_padded_ids`, `on_status_change`
- Поля frontmatter: `id`, `title`, `status`, `priority`, `assignee[]`, `reporter`, `created_date`, `updated_date`, `due_date`, `labels[]`, `dependencies[]`, `milestone`, `type`, `project`, `parent_task_id`, `ordinal`, `references[]`, `documentation[]`, `modified_files[]`
- Тело задачи: секции через `<!-- SECTION:DESCRIPTION:BEGIN -->`, `<!-- AC:BEGIN -->`, `<!-- DOD:BEGIN -->`, `<!-- SECTION:PLAN:BEGIN -->`, `<!-- SECTION:NOTES:BEGIN -->`, `<!-- SECTION:FINAL_SUMMARY:BEGIN -->`

## Файлы

### `src/core/paths.mjs`

- `findBacklogDir(cwd)` → путь к `backlog/` или `.backlog/`, или из `backlog.config.yml` / `backlog/config.yml`
- `tasksDir(backlogDir)` → `backlogDir/tasks`
- `completedDir(backlogDir)` → `backlogDir/completed`
- `draftsDir(backlogDir)` → `backlogDir/drafts`
- `docsDir(backlogDir)` → `backlogDir/docs`
- `decisionsDir(backlogDir)` → `backlogDir/decisions`
- `milestonesDir(backlogDir)` → `backlogDir/milestones`
- `configPath(backlogDir)` → `backlogDir/config.yml` или корневой `backlog.config.yml`

### `src/core/config.mjs`

- `loadConfig(cwd)` → объект конфига (YAML)
- `saveConfig(cwd, config)` → запись YAML
- `defaultConfig(projectName, prefix)` → конфиг по умолчанию

Структура конфига — **точно как в оригинале**. Полный список полей:
```yaml
project_name: "Vibelog.md"
task_prefix: "LB"
default_status: "To Do"
statuses: ["To Do", "In Progress", "Review", "Done", "Blocked"]
labels: []
priorities: ["High", "Medium", "Low"]
definition_of_done:
  - "Тесты проходят"
  - "Документация обновлена"
  - "Нет регрессий"
date_format: "yyyy-mm-dd hh:mm"
default_editor: ""
auto_open_browser: true
default_port: 6420
remote_operations: true
auto_commit: false
bypass_git_hooks: false
check_active_branches: true
active_branch_days: 30
max_column_width: 20
```

### `src/core/id.mjs`

- `nextTaskId(cwd, prefix)` → `<prefix>-<n>` (n = max + 1)
- Сканирует `tasks/` и `archive/tasks/`

### `src/core/task.mjs`

Модель Task:
- `createTask(input, config)` → объект
- `taskToMarkdown(task)` → строка
- `markdownToTask(content)` → объект

Поля: `id`, `title`, `status`, `priority`, `assignee[]`, `reporter`, `created_date`, `updated_date`, `due_date`, `labels[]`, `dependencies[]`, `milestone`, `type`, `project`, `parent_task_id`, `ordinal`, `references[]`, `documentation[]`, `modified_files[]`, `description`, `acceptanceCriteria[]`, `definitionOfDone[]`, `implementationPlan`, `implementationNotes`, `finalSummary`.

Формат AC: `- [ ] #1 text` (нумерованные чеклисты — как в оригинале).
Формат DoD: `- [ ] #1 text` (нумерованные чеклисты) с маркерами `<!-- DOD:BEGIN/END -->`.

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
- [ ] `createTask` создаёт файл в формате `<prefix>-<id> - <title>.md`
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