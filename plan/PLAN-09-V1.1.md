# PLAN-09: V1.1 — MCP и CLI для полного workflow

## Контекст

V1 реализован: 6 MCP-инструментов (create/list/view/update-status/search/ready), базовый CLI, board, browser. Round-trip с Backlog.md подтверждён на 94 задачах.

Однако для **полного workflow spec → plan → code** с Qwen Code через MCP не хватает инструментов записи. Сейчас Qwen может:
- Создать задачу (`backlog_create_task`).
- Прочитать задачу (`backlog_view_task`).
- Сменить статус (`backlog_update_status`).
- Найти задачи (`backlog_search`, `backlog_list_tasks`, `backlog_ready`).

Qwen **не может через MCP**:
- Записать план реализации в задачу (секция `## Implementation Plan`).
- Дописать заметки (секция `## Notes`, `## Final Summary`).
- Добавить комментарий.
- Отметить AC выполненным.
- Отметить DoD выполненным.
- Изменить title, description, priority, assignee, labels, milestone.

Это ломает checkpoint #2 (Review the plan) в workflow Backlog.md — агент не может записать план в задачу через MCP, только через CLI (`bash`).

**Цель v1.1** — закрыть эти пробелы, чтобы Qwen мог полностью пройти workflow через MCP без bash-костылей.

## Право на корректировку

Если при изучении оригинала Backlog.md (`/Users/bob/Dev/ton/ai/Backlog.md`) обнаружатся расхождения — **правь этот план** и коммить отдельно:

```
docs(plan): уточнить MCP-инструменты по результатам анализа Backlog.md
```

## Что нужно сделать

### Часть A: MCP — новые инструменты (высокий приоритет)

Добавить в `src/mcp/tools.mjs` следующие инструменты. **Названия и схемы параметров — точно как в оригинале** (см. `src/mcp/` Backlog.md).

#### A1. `backlog_update_task`

Универсальный инструмент обновления полей задачи.

**Параметры:**
- `id` (string, required) — ID задачи
- `title` (string, optional)
- `description` (string, optional)
- `priority` (string, optional)
- `assignee` (string, optional)
- `labels` (string[], optional)
- `milestone` (string, optional)
- `plan` (string, optional) — записывает в `## Implementation Plan`
- `append_notes` (string, optional) — дописывает в `## Notes`
- `notes` (string, optional) — заменяет `## Notes`
- `final_summary` (string, optional) — записывает в `## Final Summary`
- `status` (string, optional) — альтернатива `backlog_update_status`

**Поведение:** обновляет только переданные поля. `updated_date` обновляется всегда.

#### A2. `backlog_manage_ac`

Управление Acceptance Criteria.

**Параметры:**
- `id` (string, required)
- `action` (enum: `add` | `check` | `uncheck` | `remove` | `list`, required)
- `text` (string, optional) — для `add`
- `index` (number, optional) — для `check`/`uncheck`/`remove` (1-based, как в CLI `--check-ac 1`)

**Поведение:** работает с секцией `<!-- AC:BEGIN --> ... <!-- AC:END -->`.

#### A3. `backlog_manage_dod`

Управление Definition of Done.

**Параметры:**
- `id` (string, required)
- `action` (enum: `add` | `check` | `uncheck` | `remove` | `list`, required)
- `text` (string, optional)
- `index` (number, optional)

**Поведение:** работает с секцией `<!-- DOD:BEGIN --> ... <!-- DOD:END -->`.

#### A4. `backlog_add_comment`

**Параметры:**
- `id` (string, required)
- `comment` (string, required)
- `author` (string, optional, default `@agent`)

**Поведение:** добавляет комментарий в секцию `## Comments` с timestamp и автором.

#### A5. `backlog_update_dependencies`

**Параметры:**
- `id` (string, required)
- `add` (string[], optional)
- `remove` (string[], optional)

**Поведение:** обновляет `dependencies` во frontmatter. Проверяет циклы через `deps.validateDeps`.

### Часть B: MCP — обновление существующих (средний приоритет)

#### B1. `backlog_list_tasks`

Добавить параметры (если их нет):
- `sort` (string, optional) — `priority` | `created` | `updated`
- `ready` (boolean, optional) — только задачи без открытых блокеров
- `labels` (string[], optional) — фильтр по labels
- `milestone` (string, optional)

#### B2. `backlog_update_status`

Добавить в описание: возможные значения статусов читаются из конфига.

### Часть C: CLI — синхронизация с MCP

Добавить в `src/cli/commands/task.mjs` флаги, которых нет:

- `--dod "text"` — добавить DoD
- `--check-dod N` — отметить DoD N
- `--uncheck-dod N` — снять отметку
- `--remove-dod N` — удалить DoD N
- `--comment "text"` — добавить комментарий
- `--comment-author "@user"` — автор комментария
- `--assignee "user"` — назначить
- `--milestone "name"` — milestone
- `--remove-label "label"` — убрать label

Также `task list`:
- `--ready` — только задачи без открытых блокеров
- `--sort priority|created|updated`

### Часть D: Тесты

Добавить в `src/mcp/server.test.mjs` тесты для каждого нового инструмента:
- `backlog_update_task` обновляет поля
- `backlog_update_task` с `plan` пишет в правильную секцию
- `backlog_manage_ac` add/check/uncheck/remove
- `backlog_manage_dod` add/check/uncheck/remove
- `backlog_add_comment` добавляет с автором
- `backlog_update_dependencies` детектит цикл

Добавить в `src/cli/commands/task.test.mjs` тесты для новых флагов.

Добавить в `src/core/compat.test.mjs` — round-trip после обновлений через новые инструменты (файл должен остаться валидным для Backlog.md).

## Acceptance Criteria

### A: MCP-инструменты
- [ ] #1 `backlog_update_task` реализован, обновляет все перечисленные поля
- [ ] #2 `backlog_update_task` пишет `plan` в `## Implementation Plan` (не затирает описание)
- [ ] #3 `backlog_manage_ac` работает для add/check/uncheck/remove/list
- [ ] #4 `backlog_manage_dod` работает аналогично
- [ ] #5 `backlog_add_comment` добавляет комментарий с timestamp и автором
- [ ] #6 `backlog_update_dependencies` детектит циклы

### B: Обновление существующих
- [ ] #7 `backlog_list_tasks` поддерживает `sort`, `ready`, `labels`, `milestone`
- [ ] #8 Схемы инструментов совпадают с оригиналом Backlog.md

### C: CLI
- [ ] #9 `task edit` поддерживает `--dod`, `--check-dod`, `--uncheck-dod`, `--remove-dod`
- [ ] #10 `task edit` поддерживает `--comment`, `--comment-author`
- [ ] #11 `task edit` поддерживает `--assignee`, `--milestone`, `--remove-label`
- [ ] #12 `task list` поддерживает `--ready`, `--sort`

### D: Тесты
- [ ] #13 Все новые MCP-инструменты покрыты тестами
- [ ] #14 Все новые CLI-флаги покрыты тестами
- [ ] #15 Round-trip с Backlog.md сохраняется после обновлений

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] Тесты проходят: `pnpm test`
- [ ] Формат файлов задач остаётся совместимым с Backlog.md
- [ ] Схемы MCP-инструментов сверены с оригиналом
- [ ] Все комментарии и документация на русском
- [ ] README обновлён: раздел «MCP-инструменты»
- [ ] Если найдены расхождения — план обновлён
<!-- DOD:END -->

## После выполнения

V1.1 → версия 1.1.0 в `package.json`. Коммит:

```
feat(v1.1): полный набор MCP-инструментов и CLI-флагов для workflow
```

## Что НЕ входит в v1.1 (в v1.2+)

- Milestones: CLI `add/rename/remove` + 5 MCP-инструментов
- Documents, Decisions, Drafts
- `cleanup`, `overview`, `completion install`
- Batch-операции
- `task list --watch`, `--max-count`, `--skip`
- Веб-интерфейс: редактор плана и комментариев (только формы задач)
