---
id: VL-153
title: 'MCP: lessons learned — уроки из задач (Close пишет, Plan читает через подстановку)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 10:52'
updated_date: '2026-10-14 19:58'
due_date: ''
labels:
  - core
  - mcp
  - cli
  - lessons
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/lesson.ts
  - src/core/lesson.test.mjs
  - src/core/paths.ts
  - src/core/task.ts
  - src/core/search.ts
  - src/core/compat-full.test.mjs
  - src/mcp/tools.ts
  - src/mcp/lesson-tools.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/cli/commands/lesson.ts
  - src/cli/lesson-cli.test.mjs
  - src/cli/router.ts
  - src/cli/commands/doctor.ts
  - src/cli/diagnostics.test.mjs
  - src/web/phase-prompt.ts
  - src/web/phase-prompt.test.mjs
  - templates/qwen-commands/phase-2.md
  - templates/qwen-commands/phase-3.md
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-close-worktree.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Хранение уроков (lessons learned) для предотвращения повторения ошибок. Отдельная сущность (как docs/decisions/references), НЕ в задаче — задача Done заморожена, lesson эволюционирует.

## Дизайн (Вариант C — гибрид)

### Хранение

В задаче — ссылка: lessons: [lesson-1, lesson-3].
Отдельные файлы — backlog/lessons/lesson-N — <title>.md.

### Формат lesson-файла

Frontmatter:
- id (lesson-N)
- title
- status (active | outdated | superseded)
- tags (массив)
- source_tasks (откуда урок: [VL-101, VL-108])
- linked_tasks (где применялся: [VL-120])
- created_date, updated_date
- supersedes (id lesson, который заменён, или null)

Body: Проблема / Решение / Пример / Связь с задачами.

### Кто пишет — Close-фаза автоматически

В phase-close.md — новый шаг 6.5:
- Если задача была в Code (детектор wasInCode, есть в rejectTaskFile VL-144).
- Сформулируй 1-3 lesson (если есть чему учить).
- Проверь похожие: backlog_search_lessons с tags задачи и status=active.
- Если похожий есть — обнови его: lesson_update (linked_tasks += taskId, updated_date).
- Если нет — создай новый: lesson_create.
- Свяжи задачу: backlog_update_task с lessons.
- Если lessons нет — пропусти.

### Кто читает — Plan через подстановку в промпт (ключевое решение)

НЕ через MCP-вызов. Lessons подставляются в промпт Plan автоматически, как поля задачи (VL-137 — тот же механизм).

В phase-2.md — новый блок:
Lessons learned (подставлены автоматически):
{{taskLessons}}

В src/web/phase-prompt.ts — расширить taskExtraVars:
- Новая переменная {{taskLessons}}.
- Логика: loadLessonsForTask(cwd, taskId) — читает tags задачи, находит lessons с теми же tags, формирует компактный текст.
- Формат: '- [lesson-1] Медленные тесты с spawn — запускай батчами по 10.'
- Fallback: если lessons нет — блок пустой.

Преимущества: 0 дополнительных ходов модели, тот же механизм что для полей задачи.

### Кто читает — Code связывает применённые

В phase-3.md — новый шаг 6.5:
- Если в задаче есть lessons — оставь.
- Если использовал новый lesson — создай через lesson_create.
- Если применил существующий — обнови linked_tasks.
- Обнови задачу: backlog_update_task с lessons.

### Отличие от других сущностей

- References — внешние источники (URL, репозитории).
- Decisions — архитектурные решения (почему X, не Y).
- Docs — документация проекта.
- Lessons — workflow-уроки из опыта задач, эволюционируют.

Пример: Decision — 'Использовать Ink 6, не Ink 7.' Lesson — 'Ink 7 не работает на Node 20 — проверяй engines перед установкой.'

### Почему не в задаче

- Задача Done — заморожена, менять нельзя (плохой тон).
- Lessons эволюционируют — первая формулировка может быть неточной.
- Дублирование — один lesson в 10 задачах → 10 копий.
- Поиск — парсинг всех задач вместо прямого поиска.
- Жизненный цикл — lessons устаревают, объединяются.

## Что реализовать

1. Core-модуль src/core/lesson.ts: CRUD + search + loadLessonsForTask.
2. Поле lessons в frontmatter задачи (массив строк, ссылки на lesson-N).
3. MCP-инструменты: lesson_create, lesson_list, lesson_view, lesson_update, lesson_search_lessons, lesson_link, lesson_supersede.
4. MCP backlog_update_task принимает lessons: string[].
5. MCP backlog_search — фильтр hasLessons: boolean.
6. CLI: vibelog lesson create/list/view/search/link/supersede.
7. Phase-close.md: шаг 6.5 — записать lessons (Close пишет автоматически).
8. Phase-2.md (Plan): новая переменная {{taskLessons}} — подстановка lessons по tags задачи.
9. Phase-3.md (Code): шаг 6.5 — связать применённые lessons.
10. src/web/phase-prompt.ts: loadLessonsForTask + подстановка в taskExtraVars.
11. Round-trip с Backlog.md сохраняется (поле lessons новое, оригинал игнорирует; папка backlog/lessons/ — расширение).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Core-модуль src/core/lesson.ts: createLesson, listLessons, getLesson, updateLesson, searchLessons, linkLesson, supersedeLesson, loadLessonsForTask
- [x] #2 Поле lessons в frontmatter задачи (массив строк: lesson-N)
- [x] #3 7 MCP-инструментов: lesson_create, lesson_list, lesson_view, lesson_update, lesson_search_lessons, lesson_link, lesson_supersede
- [x] #4 MCP backlog_update_task принимает lessons: string[]
- [x] #5 MCP backlog_search поддерживает фильтр hasLessons: boolean
- [x] #6 CLI-команды: vibelog lesson create/list/view/search/link/supersede
- [x] #7 Lessons хранятся в backlog/lessons/lesson-N — <title>.md с frontmatter: id, title, status (active/outdated/superseded), tags, source_tasks, linked_tasks, created_date, updated_date, supersedes
- [x] #8 Phase-close.md: шаг 6.5 — Close-фаза автоматически создаёт/обновляет lessons при закрытии задачи, которая была в Code
- [x] #9 Phase-2.md (Plan): новая переменная {{taskLessons}} — lessons подставляются в промпт автоматически по tags задачи (0 дополнительных ходов модели)
- [x] #10 src/web/phase-prompt.ts: loadLessonsForTask(cwd, taskId) — читает tags задачи, находит lessons с теми же tags, формирует компактный текст для {{taskLessons}}
- [x] #11 Phase-3.md (Code): шаг 6.5 — связывает применённые lessons (lesson_link, lesson_create, backlog_update_task с lessons)
- [x] #12 Формулировка lessons: императив, конкретика, краткость (1 предложение); примеры хороших/плохих в задаче
- [x] #13 Round-trip с Backlog.md сохраняется (поле lessons новое, оригинал игнорирует)
- [x] #14 Тесты: core (lesson CRUD, loadLessonsForTask), MCP (7 инструментов, backlog_update_task с lessons, hasLessons), CLI (lesson команды), phase-prompt ({{taskLessons}} подстановка)
- [x] #15 Документация: docs/user-guide.md, docs/cli-reference.md, docs/mcp-reference.md, docs/agent.md (lessons в workflow фаз)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: Lessons learned (VL-153)

Сущность-аналог references (VL-152, src/core/reference.ts): markdown-файлы с YAML-фронтматтером в отдельной папке backlog/lessons/, CRUD в core, MCP-инструменты, CLI, подстановка в промпты фаз.

## Файлы для изменения/создания

### 1. src/core/paths.ts — новый путь
- После `referencesDataDir` (~строка 152): добавить `lessonsDir(backlogDir)` → `join(backlogDir, 'lessons')` (как `referencesDir`, комментарий: VL-153, расширение формата — Backlog.md игнорирует папку).

### 2. src/core/lesson.ts (НОВЫЙ, ~350 строк) — по образцу src/core/reference.ts
Экспорты (AC1): `createLesson`, `listLessons`, `getLesson`, `updateLesson`, `searchLessons`, `linkLesson`, `supersedeLesson`, `loadLessonsForTask`.
- `LESSON_STATUSES = ['active', 'outdated', 'superseded']`.
- `interface Lesson { id, title, status, tags: string[], source_tasks: string[], linked_tasks: string[], created_date, updated_date, supersedes: string }` (`supersedes: ''` = нет).
- `interface LessonEntry { lesson, body, path }`.
- `lessonFilename(id, title)` → `lesson-N-<slug>.md` (slug-логика как `referenceFilename` reference.ts:107).
- `nextLessonId(entries)` → max+1 по `/^lesson-(\d+)$/i`.
- `lessonToMarkdown` / `markdownToLesson` — serializeFrontmatter/parseFrontmatter (frontmatter.ts); порядок полей: id, title, status, tags, source_tasks, linked_tasks, created_date, updated_date, supersedes.
- `createLesson(input)` — валидация status по LESSON_STATUSES (ошибка на русском).
- `listLessons(cwd)` — чтение backlog/lessons/*.md (requireBacklogDir как в reference.ts:81; пропуск файлов без id).
- `getLesson(cwd, id)` — case-insensitive.
- `createLessonFile(cwd, input)` (запись: id генерируется, created_date/updated_date — сегодня; как `writeReference` reference.ts:256). AC требует createLesson — сделать createLesson объектным (как createReference), а запись — createLessonFile; MCP/CLI зовут createLessonFile.
- `updateLesson(cwd, id, updates)` — поля + тело; смена title → переименование файла (как updateReference).
- `searchLessons(cwd, query)` — substring по id/title/tags/телу (как searchReferences).
- `linkLesson(cwd, lessonId, taskId, action: 'add'|'remove')` — двусторонняя связь: lesson.linked_tasks ↔ task.lessons через `getTask`/`updateTaskFile` (store.ts); идемпотентно (по образцу `linkReferenceTask` reference.ts:435).
- `supersedeLesson(cwd, oldId, newId)` — новый lesson: supersedes=oldId, status=active; старый: status=superseded, updated_date=сегодня; ошибки при неизвестных id.
- `loadLessonsForTask(cwd, taskId)` — getTask → task.tags; listLessons → фильтр status==='active' && пересечение tags (case-insensitive); компактные строки `- [lesson-N] <title>`; если у задачи нет tags или совпадений нет — `[]`. Только активные (устаревшие не подставляются).

### 3. src/core/task.ts — поле lessons (AC2)
- `Task`: `lessons: string[]` (после `references`, ~строка 71).
- `TaskInput`: `lessons?: string[]` (~104).
- `createTask`: `lessons: input.lessons || []` (~143).
- `taskToMarkdown` frontmatter: `lessons: task.lessons || []` (после references, ~176).
- `markdownToTask`: парсинг по образцу references (~307): `Array.isArray(data.lessons) ? ... : (data.lessons ? [data.lessons] : [])`.
- Round-trip (AC13): оригинал Backlog.md игнорирует неизвестные поля — как references, доп. действий не требует; проверить compat-тесты (см. «Тесты»).

### 4. src/core/search.ts — фильтр hasLessons (AC5)
- `SearchFilters`: `hasLessons?: boolean` (~строка 15).
- В `searchTasks` после modifiedFiles-блока (~78): `if (f.hasLessons === true) tasks = tasks.filter(t => (t.lessons || []).length > 0); if (f.hasLessons === false) ... length === 0`.

### 5. src/mcp/tools.ts — 7 инструментов + 2 правки (AC3–5)
- Импорт из core/lesson.js.
- `getToolDefinitions`: после блока references (~строка 460) — 7 схем:
  - `lesson_list` {status?, tags?} (фильтры как reference_list);
  - `lesson_create` {title, tags?, sourceTasks?, content?} (required: title);
  - `lesson_view` {id} (required);
  - `lesson_update` {id, title?, status?, tags?, sourceTasks?, linkedTasks?, content?} (required: id);
  - `lesson_search_lessons` {query} (required);
  - `lesson_link` {lessonId, taskId, action? enum add/remove} (required: lessonId, taskId);
  - `lesson_supersede` {oldId, newId} (required: oldId, newId).
- `handleToolCall`: 7 case + handler-функции `toolLesson*` (по образцу toolReference*, ~строка 1255).
- `backlog_update_task`: схема — `lessons: {type:'array', items:{type:'string'}, description:'ID lessons задачи (полная замена lessons)'}` (после references, ~156); handler — `if (args.lessons !== undefined) updates.lessons = args.lessons as string[];` (после строки 690). (AC4)
- `backlog_search`: схема — `hasLessons: {type:'boolean', ...}` (~227); handler `toolSearch` — прокинуть `hasLessons: args.hasLessons as boolean | undefined` (~1041). (AC5)

### 6. src/cli/commands/lesson.ts (НОВЫЙ, ~200 строк) — по образцу src/cli/commands/reference.ts (AC6)
Подкоманды: `list` [--status S] [--tags a,b], `create <title>` [--tags ...] [-d content], `view <id>`, `search <query>`, `link <lessonId> <taskId> [--remove]`, `supersede <oldId> <newId>`. Вывод/ошибки — как reference.ts (printSuccess/printError, exitCode=1).

### 7. src/cli/router.ts — роутинг lesson
- Импорт runLesson; `case 'lesson':` в switch (~104, по образцу reference).
- Справка: строка команды (~139) + help-текст (по образцу `reference: ...` ~246).

### 8. src/web/phase-prompt.ts — {{taskLessons}} (AC9, AC10)
- Импорт `loadLessonsForTask` из '../core/lesson.js'.
- В `taskExtraVars` (строка 121): перед `taskTitle` (длинные тексты первыми — правило порядка ключей) добавить:
  `taskLessons: (() => { try { const l = loadLessonsForTask(cwd, taskId); return l.length ? l.join('\n') : '(нет)'; } catch { return '(нет)'; } })()` — аналог availableLabels: ошибка чтения не роняет фазу.

### 9. templates/qwen-commands/phase-2.md — блок Lessons (AC9)
После строки `References: {{taskReferences}}` (~15):
```
Lessons learned (подставлены автоматически по tags задачи):
{{taskLessons}}
```
В раздел шага 2 (после блока References, ~31): короткая инструкция — Lessons — workflow-уроки; при планировании учитывай применимые; не создавай/не обновляй в Plan (пишут Close/Code).

### 10. templates/qwen-commands/phase-3.md — шаг 6.5 (AC11)
Между шагом 6 и 7 (после ~40):
```
6.5. Lessons learned (если в задаче есть lessons или в процессе работы вспомнил урок):
- Использовал существующий lesson из блока/поля lessons задачи? Он уже связан — ничего не делай.
- Создал новый полезный урок? lesson_create {"title": "Императив, 1 предложение", "tags": [...], "sourceTasks": ["{{taskId}}"]} и свяжи: lesson_link {"lessonId": "lesson-N", "taskId": "{{taskId}}"}.
- Обнови задачу при добавлении: backlog_update_task {"id": "{{taskId}}", "lessons": ["lesson-N", ...]}.
- Если lessons не применялись и не создавались — пропусти.
```

### 11. templates/qwen-commands/phase-close.md — шаг 6.5 (AC8)
Между шагом 6 и «Экономия ходов» (~58):
```
6.5. Lessons learned — зафиксируй уроки закрытой задачи (если была в Code):
- Проверь, была ли задача в Code: modified_files непусты ИЛИ в комментариях есть отчёт Фазы 3. Если нет — пропусти шаг.
- Сформулируй 1–3 урока (если есть чему учить): императив, конкретика, 1 предложение. Хорошо: «Тесты со spawn медленные — запускай батчами по 10». Плохо: «Производительность тестов».
- Проверь похожие: lesson_search_lessons {"query": "<ключевые слова>"} и/или list с tags задачи, status=active.
- Похожий активный есть → обнови: lesson_update {"id": "lesson-N", "linkedTasks": [...], "content": ...} (linked_tasks += {{taskId}}, updated_date обновится сама).
- Нет → создай: lesson_create {"title": "...", "tags": [...], "sourceTasks": ["{{taskId}}"]} + lesson_link.
- Свяжи задачу: backlog_update_task {"id": "{{taskId}}", "lessons": ["lesson-N", ...]}.
```
Тот же шаг добавить в templates/qwen-commands/phase-close-worktree.md (после шага 7 DoD, ~53) — иначе worktree-close теряет уроки.

### 12. Документация (AC15) — правка файлов backlog/docs напрямую (Close-фазой или в этой задаче)
- doc-6 (Руководство пользователя, backlog/docs/doc-6-...): раздел «Lessons learned» — что это, где хранятся, примеры.
- doc-7 (CLI-справочник): подкоманды vibelog lesson.
- doc-8 (MCP-справочник): 7 инструментов + lessons/hasLessons в backlog_update_task/backlog_search.
- doc-10 (Агент): lessons в workflow фаз (Close пишет, Plan читает через {{taskLessons}}, Code связывает).

## Тесты (AC14)
- src/core/lesson.test.mjs (НОВЫЙ, по образцу reference.test.mjs): createLessonFile (id/даты/файл), list/get (case-insensitive), updateLesson (переименование), searchLessons, linkLesson (двусторонность ↔ task.lessons, идемпотентность), supersedeLesson (оба статуса), loadLessonsForTask (подбор по tags, только active, нет tags → [], включая возврат [] при отсутствии backlog).
- src/mcp/lesson-tools.test.mjs (НОВЫЙ, по образцу reference-tools.test.mjs): 7 инструментов + backlog_update_task с lessons + backlog_search hasLessons.
- src/cli/lesson-cli.test.mjs (НОВЫЙ, по образцу reference-cli.test.mjs): подкоманды.
- src/web/phase-prompt.test.mjs: {{taskLessons}} подставляется (задача с tags + активный lesson того же tags); нет совпадений → '(нет)'.
- Регрессия frontmatter: src/core/compat.test.mjs / compat-full.test.mjs / frontmatter.test.mjs — при падении добавить lessons в ожидаемые поля (пустой массив `[]`, как references).

## Порядок работ
1. paths.ts → 2. lesson.ts → 3. task.ts → 4. search.ts → 5. `pnpm build` → 6. core-тесты → 7. mcp/tools.ts → 8. CLI (lesson.ts + router.ts) → 9. MCP/CLI-тесты → 10. phase-prompt.ts + phase-2/3/close/close-worktree.md → 11. phase-тесты → 12. compat-тесты → 13. `pnpm build && pnpm test` → 14. документация backlog/docs.

## Проверка
```bash
pnpm build && pnpm test
node bin/vibelog.mjs lesson list   # в тестовом tmp-проекте
```

## Риски
- Порядок ключей в taskExtraVars: taskLessons — до taskTitle (replaceAll по порядку, литерал {{...}} в уроках гасится последующими ключами).
- loadLessonsForTask не должен падать при битом YAML lesson-файла — пропуск файла.
- supersedes: '' в frontmatter (пустая строка, не null) — парсинг как references; round-trip с оригиналом: поле lessons новое, Backlog.md игнорирует неизвестные frontmatter-поля (поле references уже прошло это).
- phase-close-worktree.md не забыть (иначе worktree-задачи не пишут уроки).
- CLI/промпты на русском; сообщения об ошибках — на русском (правила проекта).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 16:39
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 14 файлов (2 новых модуля src/core/lesson.ts и src/cli/commands/lesson.ts, правки paths/task/search/mcp-tools/phase-prompt/4 шаблона фаз, документация backlog/docs, 4 новых тест-файла). Референс-модель — src/core/reference.ts (VL-152): тот же паттерн markdown+frontmatter, двусторонняя связь с задачей, supersede по образцу updateReference. Риски: порядок ключей taskExtraVars (taskLessons до taskTitle), битые lesson-файлы пропускать, не забыть phase-close-worktree.md, round-trip: поле lessons новое — оригинал игнорирует.
---
author: @agent
created: 2026-10-14 18:54
---
Фаза 3 (Code) выполнена. Коммит 15a6560 (21 файл, +1523). Реализовано: core src/core/lesson.ts (createLesson/listLessons/getLesson/updateLesson/searchLessons/linkLesson/supersedeLesson/loadLessonsForTask, файлы backlog/lessons/lesson-N-<slug>.md); поле lessons в frontmatter задач (Task/TaskInput/сериализация/парсинг); 7 MCP-инструментов lesson_* + lessons в backlog_update_task + hasLessons в backlog_search; CLI vibelog lesson create/list/view/search/link/supersede + справка; doctor expected 36; {{taskLessons}} в phase-prompt.ts (loadLessonsForTask по labels задачи, фолбэк «(нет)», ошибки чтения не роняют фазу); шаги 6.5 в phase-close.md / phase-close-worktree.md (Close пишет уроки) и phase-3.md (Code связывает), блок Lessons в phase-2.md (Plan читает). Тесты: lesson.test.mjs (21), lesson-tools.test.mjs (13), lesson-cli.test.mjs (8), phase-prompt (+3 VL-153); обновлены счётчики инструментов 29→36 (documents/reference-tools/server/compat-full/diagnostics). pnpm test: 61 файл, 1083 passed, 0 failed. Осталось: AC15/DoD2 — документация (docs/user-guide, cli-reference, mcp-reference, agent в backlog/docs) делается Фазой Close по правилам VL-126; инцидент: первая попытка pnpm install прервалась по таймауту и расстроила симлинк node_modules — восстановлено установкой в реальную директорию worktree.
---
author: @agent
created: 2026-10-14 19:58
---
Фаза Close выполнена. Ветка vb/vl-153 слита в master (2 коммита: 15a6560 feat + db4a104 fix compat-тест, merge без конфликтов), worktree удалён, ветка удалена. После merge pnpm build и pnpm test прошли: 61 файл, 1076 passed, 0 failed (инцидент: node_modules главного репо был повреждён симлинками на worktree vl-155 — восстановлен pnpm install --offline; pnpm install зависал на интерактивном промпте очистки modules-dir). Документация обновлена (docs-коммит 8e22d04): doc-6 — раздел «14. Lessons learned» (формат файлов, CLI, интеграция с фазами, отличие от references/decisions/docs), doc-7 — секция `vibelog lesson` + счётчик 36, doc-8 — секция lessons (7 инструментов), lessons в backlog_update_task, hasLessons в backlog_search, примеры, счётчик 36, doc-10 — раздел «Lessons learned в фазах» (Plan читает {{taskLessons}}, Close пишет шаг 6.5, Code связывает), CHANGELOG.md — запись VL-153 в Unreleased. DoD честно: 1 (тесты проходят) ✓, 2 (документация обновлена) ✓, 3 (нет регрессий) ✓. Отмечено AC: 15.
---
<!-- COMMENTS:END -->