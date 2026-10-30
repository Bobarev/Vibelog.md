---
id: doc-8
title: MCP-справочник Vibelog.md
type: guide
created_date: 2026-10-06
tags:
  - mcp
  - reference
  - vl-21
---
# MCP-справочник Vibelog.md

37 инструментов MCP-сервера (stdio, JSON-RPC 2.0). Совместимо с Backlog.md.
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
| `status` | string | | Статус (в веб-чате по умолчанию **Spec** — ассистент выполняет фазу spec; вне чата — из конфига) |
| `assignee` | string[] | | Исполнители |
| `milestone` | string | | Веха |
| `type` | string | | Тип (bug, feature, ...) — валидация по конфигу |
| `parentTaskId` | string | | ID родительской задачи (валидируется существование) |
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
| `parentTaskId` | string | Фильтр по родительской задаче |
| `ready` | boolean | Только без невыполненных блокеров |
| `sort` | string | priority / created / updated |
| `limit` | number | Максимум задач |

### backlog_view_task — просмотр задачи

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `fields` | string[] | | Выбор возвращаемых полей Task — ключи интерфейса Task (напр. `["id","title","description"]` — контекст для фазы Spec); порядок ключей в ответе = порядок в `fields`; без параметра или при пустом массиве — полное представление (обратная совместимость); неизвестное имя — ошибка с перечнем допустимых имён (VL-162) |

### backlog_update_status — смена статуса

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `status` | string | ✓ | Статусы читаются из конфига |

### backlog_update_task — универсальное обновление

Обновляет только переданные поля.

Обязательность `id` валидируется на границе MCP-слоя (VL-183): вызов без `id` или с пустой строкой возвращает понятную ошибку «Не передан id задачи (параметр "id").» вместо TypeError из core (`getTask`/`findTaskFilePath`). Семантика `type`: `null` — поле не трогается (не стирается), `''` — явный сброс в `''`, значение не-string — ошибка «Недопустимый тип …».

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `title`, `description`, `priority`, `assignee`, `labels`, `milestone`, `type`, `status` | — | | |
| `parentTaskId` | string | | Родительская задача; пустая строка — сброс |
| `plan` | string | | Implementation Plan (полная замена) |
| `notes` | string | | Implementation Notes (полная замена) |
| `append_notes` | string | | Дописать в конец заметок |
| `final_summary` | string | | Итоговое резюме |
| `modifiedFiles` | string[] | | Изменённые файлы (полная замена `modified_files`; Фаза 3 пишет, Фаза Close читает) |
| `acceptanceCriteria` | string[] | | Критерии приёмки: полная замена чеклиста, все пункты создаются неотмеченными (симметрия с `backlog_create_task`; JSON-строка массива тоже принимается; VL-219) |
| `references` | string[] | | ID референсов задачи (полная замена поля `references`; VL-152, использует фаза Code) |
| `lessons` | string[] | | ID lessons задачи (полная замена поля `lessons`; VL-153, связывают фазы Close/Code) |

### backlog_manage_ac / backlog_manage_dod — чеклисты

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `action` | string | ✓ | add / check / uncheck / remove / list |
| `text` | string \\\\| string[] | | Для action=add: строка — один пункт; массив непустых строк — несколько за один вызов (batch-add, ответ «Добавлено критериев: N (…)»); JSON-строка массива (`'["A", "B"]'`) тоже принимается — разбирается, каждый элемент становится отдельным критерием (симметрия с `index`; битый JSON или не-массив уходит в scalar-текст как есть; VL-183) |
| `index` | number \\\\| string \\\\| (number\\\\|string)[] | | Для check/uncheck/remove: целое с 1; строка-число (`"3"`); массив `[1,2,3]` — несколько за один вызов; строка-массив `"[1, 2]"` тоже принимается; `"all"` — все пункты списка. Валидация каждого элемента: целое ≥1 и ≤ длины, иначе ошибка со списком пунктов (дробь/NaN/пусто — с подсказкой формата). Батч-ответ: «Отмечено пунктов: N (1, 2, 3)» / «Снято пунктов» / «Удалено пунктов»; scalar-ответ — прежний («Отмечены критерии #2»). Внимание: `action:'remove', index:'all'` чистит весь чеклист |

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
| `hasLessons` | boolean | Задачи с (true) / без (false) связанных lessons (VL-153) |
| `limit` | number | 1–100 |

### backlog_finish_phase — завершение фазы одним вызовом (VL-138)

Атомарно по файлу: статус + отчётный комментарий + modifiedFiles + батч-отметки AC/DoD за один вызов (замена цепочки `add_comment` → `update_status` → `update_task(modifiedFiles)` → `manage_ac/dod check`).

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `status` | string | | Новый статус (валидируется по конфигу; невалидный — пропускается с ошибкой в сводке) |
| `comment` | string | ✓ | Отчётный комментарий (author фиксирован `@agent`). Отсутствующий/пустой — **жёсткая ошибка** `Неполный вызов: … comment (report) не передан` (VL-251); файл задачи и usage при этом не трогаются |
| `modifiedFiles` | string[] | | Изменённые файлы (полная замена `modified_files`) |
| `acChecks` | (number\\\\|string)[] | | Индексы AC для батч-отметки (с 1, как в `manage_ac`) |
| `dodChecks` | (number\\\\|string)[] | | Индексы DoD для батч-отметки (с 1, как в `manage_dod`) |
| `tokenUsage` | object | | Учёт токенов (VL-198): `{input, output, cache, total, requests}` — finite числа ≥0. Дописывается дельтой в `token_usage` frontmatter задачи (по фазам, без двойного учёта — см. lesson-58). Если не передан **или все значения нулевые** (VL-251) — fallback: env `VIBELOG_SESSION_ID` → мета сессии → JSONL (`sumUsageFromMessages`); без сессии — ошибка в сводку, остальное применяется |
| `phase` | string | | Редкий override фазы для `by_phase` (обычно из env `VIBELOG_PHASE_NAME` или мете сессии) |

Частичное применение: невалидное поле (статус вне конфига, битый индекс) пропускается с понятным сообщением, вызов не падает; все валидные обновления применяются одной записью (файл атомарен). Результат — сводка вида «Статус: Review; отчёт добавлен; отмечено AC: 2, DoD: 1; файлов: 3» (+ `Ошибки: …` при наличии). Несуществующая задача — фатальная ошибка.

**Жёсткая валидация (VL-251)** выполняется до любых записей и бросает ошибку (MCP `isError: true`): отсутствующий `comment` и `status`, **равный текущему** статусу задачи (`Фаза уже завершена: статус «X» совпадает с текущим` + дата/автор/начало существующего отчёта + следующий шаг). Причина: нейтральный успех на no-op выглядел для модели как «принято, но чего-то не хватает» и провоцировал байт-в-байт повторы (инцидент VL-234). Сценарий «повторный finish безопасен» сознательно убран.

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
| `title` | string | ✓ | Заголовок |
| `content` | string | ✓ | Markdown-содержимое |
| `type` | string | | readme / guide / specification / other |
| `tags` | string[] | | Теги |

### document_update

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `title`, `content`, `type`, `tags` | | | Только переданные поля |

### document_search

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `query` | string | ✓ | Поисковый запрос |

---

## Референсы (references, VL-152)

Внешние источники знаний: репозитории, URL, файлы, документация, спецификации. Метаданные — `backlog/references/<id>-<title>.md` (в git), клоны репозиториев — `backlog/references/data/` (в .gitignore). Типы: `repo`, `url`, `file`, `doc`, `spec`. Двусторонняя связь с задачами: `reference.linked_tasks` ↔ `task.references` (Plan-фаза читает источники задачи, Code-фаза добавляет новые).

### reference_list — список референсов

| Параметр | Тип | Описание |
|---|---|---|
| `type` | string | Фильтр по типу (repo / url / file / doc / spec) |
| `tags` | string[] | Фильтр по меткам |

### reference_add — создать референс

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок |
| `type` | string | ✓ | repo / url / file / doc / spec |
| `url` | string | | URL источника |
| `path` | string | | Локальный путь (относительно backlog/) |
| `tags` | string[] | | Метки |
| `description` | string | | Описание (тело документа) |
| `clone` | boolean | | Для type=repo: клонировать репозиторий в `data/<dir>` (по умолчанию true; идемпотентно — существующий клон пропускается) |

### reference_view — метаданные + описание

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |

Возвращает метаданные, linked_tasks и тело документа.

### reference_search — поиск

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `query` | string | ✓ | Substring по id / title / url / tags / body |

### reference_remove — удалить метаданные

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | Клон в `data/` сохраняется |

### reference_update — обновить метаданные (VL-164)

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | ID reference (ref-N) |
| `tags` | string[] | | Метки (полная замена, не merge) |
| `description` | string | | Описание (markdown, полная замена тела) |

Обновляет только переданные поля. Несуществующий id — ошибка «Reference … не найден.»; вызов без `tags`/`description` — ошибка «Не указаны поля для обновления (tags, description).»

### reference_link — двусторонняя связь с задачей

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `referenceId` | string | ✓ | |
| `taskId` | string | ✓ | |
| `action` | string | ✓ | add / remove — правит `linked_tasks` референса И `references` задачи |

### reference_sync — доклонировать отсутствующие репозитории

Параметров нет. Обходит все references type=repo, клонирует отсутствующие (для разработчиков, склонировавших проект без `data/`). Возвращает {cloned, skipped, failed}.

---

## Lessons learned (lessons, VL-153)

Workflow-уроки из опыта задач — предотвращают повторение ошибок. Файлы — `backlog/lessons/lesson-N-<slug>.md` (YAML-фронтматтер: id, title, status, tags, source_tasks, linked_tasks, created_date, updated_date, supersedes; тело — «Проблема / Решение / Пример»). Статусы: `active` (по умолчанию) / `outdated` / `superseded`.

Отличие от других сущностей: references — внешние источники; decisions — архитектурные решения («почему X, не Y»); docs — документация проекта; **lessons — workflow-уроки**, которые эволюционируют независимо от замороженных задач. Двусторонняя связь с задачами: `lesson.linked_tasks` ↔ `task.lessons`. Plan-фаза получает активные lessons по tags/labels задачи в промпт через `{{taskLessons}}` (0 дополнительных ходов модели); Close-фаза пишет уроки автоматически (шаг 6.5), Code связывает применённые.

### lesson_list — список lessons

| Параметр | Тип | Описание |
|---|---|---|
| `status` | string | Фильтр: active / outdated / superseded |
| `tags` | string[] | Фильтр по меткам (все указанные должны совпасть) |

### lesson_create — создать lesson

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок (императив, 1 предложение) |
| `tags` | string[] | | Метки |
| `sourceTasks` | string[] | | Откуда урок (ID задач) |
| `content` | string | | Тело (Проблема / Решение / Пример) |

id генерируется (`lesson-N`), даты — сегодня.

### lesson_view — метаданные + тело

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |

### lesson_update — обновить lesson

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `title`, `status`, `tags`, `sourceTasks`, `linkedTasks`, `content` | | | Только переданные поля; смена title переименовывает файл |

### lesson_search_lessons — поиск

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `query` | string | ✓ | Substring по id / title / tags / телу |

### lesson_link — двусторонняя связь с задачей

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `lessonId` | string | ✓ | |
| `taskId` | string | ✓ | |
| `action` | string | | add (по умолчанию) / remove — правит `linked_tasks` lesson И `lessons` задачи |

### lesson_supersede — заменить lesson

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `oldId` | string | ✓ | Заменяемый lesson → статус `superseded` |
| `newId` | string | ✓ | Новый lesson → `supersedes: oldId`, статус `active` |

---

## Примеры вызовов

```json
// Создать задачу с типом и AC
{ "name": "backlog_create_task", "arguments": {
  "title": "Падение экспорта", "type": "bug", "priority": "High",
  "acceptanceCriteria": ["Экспорт CSV работает", "Тесты проходят"] } }

// Создать дочернюю задачу эпика (VL-69)
{ "name": "backlog_create_task", "arguments": {
  "title": "Подзадача эпика", "parentTaskId": "api-1", "type": "task" } }

// Просмотр задачи: только нужные поля — экономия контекста (VL-162)
{ "name": "backlog_view_task", "arguments": {
  "id": "api-1", "fields": ["id", "title", "description"] } }

// Пачка отметок AC
{ "name": "backlog_manage_ac", "arguments": {
  "id": "api-1", "action": "check", "index": [1, 2, 3] } }

// Отметить все пункты разом (VL-135)
{ "name": "backlog_manage_dod", "arguments": {
  "id": "api-1", "action": "check", "index": "all" } }

// Завершение фазы одним вызовом (VL-138)
{ "name": "backlog_finish_phase", "arguments": {
  "id": "api-1", "status": "Review", "comment": "Фаза 3 (Code) выполнена.",
  "modifiedFiles": ["src/api.ts"], "acChecks": [1, 2], "dodChecks": ["1"] } }

// Поиск: баги To Do с лимитом
{ "name": "backlog_search", "arguments": {
  "query": "экспорт", "status": "To Do", "type": "bug", "limit": 5 } }

// Задачи, готовые к работе
{ "name": "backlog_ready", "arguments": {} }

// Референсы (VL-152): добавить репозиторий с клонированием
{ "name": "reference_add", "arguments": {
  "title": "vibe-kanban", "type": "repo",
  "url": "https://github.com/BloopAI/vibe-kanban.git", "tags": ["orchestration"] } }

// Обновить метаданные референса (VL-164)
{ "name": "reference_update", "arguments": {
  "id": "ref-3", "tags": ["orchestration", "kanban"],
  "description": "Описание с канбаном и оркестрацией" } }

// Связать референс с задачей
{ "name": "reference_link", "arguments": {
  "referenceId": "ref-3", "taskId": "VL-100", "action": "add" } }

// Записать использованные источники в задачу (фаза Code)
{ "name": "backlog_update_task", "arguments": {
  "id": "VL-100", "references": ["ref-3", "ref-4"] } }

// Lessons (VL-153): создать урок и связать с задачей
{ "name": "lesson_create", "arguments": {
  "title": "Тесты со spawn медленные — запускай батчами по 10",
  "tags": ["core", "tests"], "sourceTasks": ["VL-153"] } }

// Записать связанные lessons в задачу (фазы Close/Code)
{ "name": "backlog_update_task", "arguments": {
  "id": "VL-153", "lessons": ["lesson-1"] } }
```