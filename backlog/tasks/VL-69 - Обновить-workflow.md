---
id: VL-69
title: 'Workflow: поддержка Epic и parent_task_id в фазах'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 17:28'
updated_date: '2026-10-03 22:44'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Я предлагаю

**Spec** — это **фаза уточнения**, а не декомпозиции. Она:

- Запускается, **когда задача описана недостаточно подробно**.
- **Не создаёт новых задач** ни в каком случае.
- **Определяет масштаб** фичи и **переключает тип задачи**:
  - **Task** — если фича укладывается в одну задачу.
  - **Epic** — если фича **явно** не укладывается в одну задачу.
- В обоих случаях **редактирует саму задачу**: дополняет описание, AC, критерии готовности.

**Plan** — это **фаза планирования**, которая **решает про декомпозицию**:

- Получает **одну задачу** с уже известным типом.
- **Task** → пишет план **в эту же задачу**. Создание новых задач возможно **только как исключение** — если **большую часть** надо вынести отдельно. Тогда:
  - Создаётся **задача-блокер** с `parent_task_id`.
  - Оригинальная задача переходит в **Blocked**.
  - Code не запустится, пока блокер не Done.
- **Epic** → создаёт **несколько задач** с `parent_task_id`, планирует их, оставляет эпик как **зонтик** для батч-запуска Code и Close.

**Code и Close** — работают **с конкретной задачей**:

- Для Task — реализует и закрывает.
- Для Epic — **агрегирует**: Code запускается **на дочерних** задачах (по одной или батчем), Close закрывает эпик, когда **все дети Done**.

## Почему это правильно

1. **Spec не плодит сущности раньше времени.** Сейчас Spec создаёт VL-67 и VL-68, а потом **непонятно, что с ними делать** — они висят пустые. В твоей модели Spec **только помечает** VL-66 как Epic, а декомпозиция — **забота Plan**.

2. **Plan — единственная фаза, которая создаёт задачи.** Это **чёткая ответственность**: Plan = «разбить и запланировать». Spec = «уточнить».

3. **Blocked — явный сигнал для Code.** Если Plan решил вынести часть в отдельную задачу, **оригинал блокируется** — это **видно на доске**, это **видно Qwen**. Code **не начнётся**, пока блокер не закрыт.

4. **Epic — это агрегатор, а не задача.** Code на эпике **не реализует** — он **проверяет детей** и запускает Code **на них**. Это то, чего **не хватало** в текущем workflow.

5. **Совместимость с Backlog.md.** В Backlog.md уже есть `parent_task_id`, `type`, `dependencies`. Твоя модель **использует их по назначению** — не вводит новых сущностей.

## Что нужно доработать в Vibelog.md

> **Описание:** Текущий workflow spec→plan→code путает эпик и задачу. Spec создаёт детей, но не связывает их с родителем. Plan пишет план на родителя, оставляя детей пустыми. Нужно:
> 1. Добавить `parentTaskId` и `type` в MCP `backlog_create_task` и `backlog_update_task`.
> 2. Добавить `--parent` и `--type` в CLI `task create`/`task edit`.
> 3. Добавить `--parent` в CLI `task list` и MCP `backlog_list_tasks`.
> 4. Переписать промпты фаз Spec/Plan/Code/Close под новую модель:
>    - Spec: уточняет, меняет type, не создаёт задач.
>    - Plan: если task — план в задачу; если epic — создаёт детей с parent.
>    - Code: если task — реализует; если epic — оркестрирует детей.
>    - Close: если task — закрывает; если epic — закрывает, когда дети Done.
>
> **AC:**
> - #1 `backlog_create_task` принимает `parentTaskId` и `type`
> - #2 `task create` поддерживает `--parent` и `--type`
> - #3 `task list` поддерживает `--parent`
> - #4 Spec не создаёт новых задач, только меняет type
> - #5 Plan для epic создаёт детей с parent
> - #6 Code для epic не реализует, а оркестрирует
> - #7 Close для epic закрывает только когда дети Done
> - #8 Round-trip с Backlog.md сохраняется


### 6. Промпты фаз — переписать под новую модель

**`phase-1.md` (Spec)** — новая логика:

```markdown
## Шаги

1. Прочитай задачу: backlog_view_task {"id": "{{taskId}}"}

2. Изучи описание фичи и репозиторий.

3. Определи масштаб фичи:
   - Если фича укладывается в одну задачу → оставь type=task.
   - Если фича явно не укладывается в одну задачу → установи type=epic.

4. Уточни задачу через MCP backlog_update_task:
   - Дополни описание (детали, контекст).
   - Уточни критерии приёмки (2-3 конкретных).
   - Установи type (task или epic).
   - НЕ создавай новых задач.

5. Оставь отчёт комментарием.

6. Смени статус на Spec.

## Правила

- НЕ создавай новых задач через backlog_create_task.
- Если фича большая — просто пометь type=epic, декомпозиция будет в Plan.
```

**`phase-2.md` (Plan)** — новая логика:

```markdown
## Шаги

1. Прочитай задачу: backlog_view_task {"id": "{{taskId}}"}

2. Проверь тип задачи:

   **Если type=task:**
   - Изучи релевантные файлы.
   - Составь план и запиши через backlog_update_task.
   - Если какую-то БОЛЬШУЮ часть надо вынести в отдельную задачу:
     - Создай задачу-блокер через backlog_create_task с parentTaskId={{taskId}}.
     - Смени статус {{taskId}} на Blocked (через backlog_update_status).
     - Запиши в план: "Заблокирована до выполнения <ID блокера>".
   - Иначе — план в эту задачу, статус не меняется.

   **Если type=epic:**
   - Разбей эпик на 2-5 задач через backlog_create_task с parentTaskId={{taskId}}.
   - Для каждой — план и AC.
   - Смени статус {{taskId}} на Planned.
   - НЕ пиши план в эпик — только в детей.

3. Оставь отчёт комментарием.

## Правила

- Одна фаза Plan — одна задача.
- Если type=task — план в эту задачу.
- Если type=epic — план в детей.
```

**`phase-3.md` (Code)** — новая логика:

```markdown
## Шаги

1. Прочитай задачу: backlog_view_task {"id": "{{taskId}}"}

2. Проверь тип задачи:

   **Если type=task:**
   - Реализуй план.
   - Отметь AC.
   - Смени статус на Done.

   **Если type=epic:**
   - Получи список детей: backlog_list_tasks {"parentTaskId": "{{taskId}}"}
   - Проверь их статусы.
   - Если не все Done — НЕ реализуй сам.
   - Вместо этого — запусти Code на каждом ребёнке (через отдельные вызовы qwen).
   - Или: сообщи пользователю "Запусти Code на детях: VL-67, VL-68".
   - Когда все дети Done — смени статус эпика на Done.

## Правила

- Code на эпике НЕ реализует код — он оркестрирует детей.
- Code на задаче — реализует.
```

**`phase-close.md` (Close)** — новая логика:

```markdown
## Шаги

1. Прочитай задачу.

2. Если type=task:
   - Проверь AC.
   - Смени статус на Done.
   - Закоммить (если настроено).

3. Если type=epic:
   - Получи детей: backlog_list_tasks {"parentTaskId": "{{taskId}}"}
   - Если все Done — закрой эпик.
   - Иначе — сообщи "Не все дети закрыты: <список>".
```

## Что это даёт

**Workflow становится предсказуемым:**

| Фаза | Task | Epic |
|---|---|---|
| **Spec** | Уточняет, type=task | Уточняет, type=epic |
| **Plan** | План в эту задачу (или блокер) | Создаёт детей, план в них |
| **Code** | Реализует | Запускает Code на детях |
| **Close** | Закрывает | Закрывает, когда дети Done |

**Пользователь:**

1. Создаёт VL-66 «Хочу команду /prompt».
2. Запускает Spec → Qwen решает «это эпик, 2 подзадачи» → type=epic.
3. Переносит в Plan → Qwen создаёт VL-67, VL-68 с `parentTaskId=VL-66` и планами.
4. Запускает Code на VL-67 → реализует. Потом на VL-68 → реализует.
5. Запускает Code на VL-66 (эпик) → проверяет, что дети Done → закрывает эпик.

**Или батчем:** Code на эпике → Qwen сам запускает Code на VL-67 и VL-68 по очереди.


## Итог

**Твоя модель правильная.** Spec — уточнение, Plan — декомпозиция. Это **гораздо чище** того, что было.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## VL-69 — Workflow: поддержка Epic и parent_task_id в фазах

### Контекст (что уже есть, правок не требует)
- `src/core/task.ts`: `parent_task_id`/`type` уже в Task/TaskInput/createTask/taskToMarkdown/markdownToTask (строки 67, 69, 100, 102, 139, 141, 178, 180, 303, 305).
- CLI `task create` уже поддерживает `--parent` (task.ts:109-111, 150) и `--type` (task.ts:85-95).
- MCP `backlog_create_task`/`backlog_update_task`/`backlog_list_tasks` уже имеют `type`, но НЕ `parentTaskId`.
- `backlog/config.yml` проекта уже содержит статусы Spec/Planned/Blocked; `DEFAULT_TASK_TYPES` (config.ts:15) не содержит `epic`.
- Установленные копии `.qwen/commands/vibelog/spec.md` уже расходятся с templates (diff) — синхронизировать.

### 1. MCP: parentTaskId в create/update/list (AC #1, #3)
Файл `src/mcp/tools.ts`:
- Схема `backlog_create_task` (строка 62, properties ~66-80): добавить `parentTaskId: { type: 'string', description: 'ID родительской задачи' }` после `type`.
- Схема `backlog_list_tasks` (строка 86, properties ~88-99): добавить `parentTaskId: { type: 'string', description: 'Фильтр по родительской задаче' }` после `type`.
- Схема `backlog_update_task` (строка 125, properties ~128-145): добавить `parentTaskId: { type: 'string', description: 'Родительская задача; пустая строка — сброс' }` после `type`.
- `toolCreateTask` (~411-424): перед createTaskFile — если `args.parentTaskId` непустой, `getTask(cwd, parentTaskId)` обязан вернуть задачу, иначе `throw new Error('Родительская задача X не найдена.')`; в input передать `parent_task_id: (args.parentTaskId as string) || ''`.
- `toolListTasks` (~425-495): после фильтра по type (~449-452) — фильтр `if (args.parentTaskId) { const p = String(args.parentTaskId).toLowerCase(); tasks = tasks.filter(t => (t.parent_task_id || '').toLowerCase() === p); }`; в simplified-вывод (~482-490) добавить `parent_task_id: t.parent_task_id`.
- `toolUpdateTask` (~523-556): после строки с type (~537) — блок `if (args.parentTaskId !== undefined)`: пустая строка → сброс; непустая → валидация getTask (throw если нет), `updates.parent_task_id = value`.

### 2. CLI: --parent в edit и list (AC #2, #3)
Файл `src/cli/commands/task.ts`:
- `taskEdit` (~312-319, сразу после блока `--type`): `if (flags.parent !== undefined) { const parent = getFlag(flags, 'parent', ''); if (parent && !getTask(cwd, parent)) { printError('Родительская задача ' + parent + ' не найдена.'); return; } updates.parent_task_id = parent; }` — пустая строка сбрасывает родителя.
- `taskList` (~168-174, сразу после фильтра по type): фильтр `--parent` case-insensitive по `t.parent_task_id` (как у type).

### 3. Конфиг: тип epic и статусы workflow (предусловие AC #4-#7)
- `src/core/config.ts:15` — DEFAULT_TASK_TYPES += 'epic' → `['bug','feature','enhancement','task','chore','docs','spike','epic']`.
- `src/core/config.ts:28` — defaultConfig.statuses → `['To Do','Spec','Planned','In Progress','Review','Done','Blocked']` (шаблоны фаз требуют Spec/Planned/Blocked).
- `backlog/config.yml` — добавить явный блок `types:` (bug…spike + epic): проект становится переносимым на оригинал Backlog.md (custom types в config.yml оригинал поддерживает; в его дефолтах epic нет).

### 4. Промпты фаз (AC #4-#7)
Переписать `templates/qwen-commands/phase-1.md` (Spec): уточнение без создания задач — backlog_view_task, определить масштаб, `backlog_update_task` с type=task|epic, дополнить описание и 2-3 AC, отчёт комментарием, статус Spec. Явное правило: «НЕ создавай новых задач; большая фича = type=epic, декомпозиция в Plan».
Переписать `phase-2.md` (Plan): ветвление по type из backlog_view_task:
- task: план в эту задачу; исключение (большая часть): `backlog_create_task` с `parentTaskId={{taskId}}` (блокер), статус оригинала Blocked, в плане «Заблокирована до <ID блокера>».
- epic: 2-5 задач через `backlog_create_task` с `parentTaskId={{taskId}}`, план+AC в каждого ребёнка, статус эпика Planned, план в эпик НЕ писать.
Переписать `phase-3.md` (Code): task — реализация как сейчас; epic — `backlog_list_tasks {"parentTaskId": "{{taskId}}"}`: если не все дети Done — НЕ реализуй сам, запусти/инструктируй Code на детях; все дети Done → статус эпика Done.
Переписать `phase-close.md` (Close): task — как сейчас; epic — если все дети Done (list по parentTaskId) — закрыть, иначе отчёт «Не все дети закрыты: <список ID>».
Обновить интерактивные skills: `spec.md` (уточнение+type, без создания задач), `plan.md` (ветвление task/epic), `code.md` (task=реализация, epic=оркестрация). ОБЯЗАТЕЛЬНО сохранить required-строки skills.test.mjs: spec.md — 'Фаза 1' и {{args}}; plan.md — backlog_view_task, backlog_update_task; code.md — backlog_manage_ac, backlog_add_comment, backlog_update_status.
Синхронизировать копии `.qwen/commands/vibelog/{spec,plan,code}.md` из templates (ручной cp; `init --force` НЕ использовать — перезаписывает config.yml проекта).

### 5. Тесты
- `src/mcp/types.test.mjs:71-72` — обновить оба expected-массива на новые (с 'epic').
- Новый `src/mcp/parent.test.mjs` (setup по образцу types.test.mjs): create с parentTaskId → parent_task_id во frontmatter и round-trip; create с несуществующим parent → ошибка; update: смена и сброс (пустая строка) parentTaskId; list: фильтр parentTaskId + наличие parent_task_id в simplified-выводе.
- `src/cli/create-flags.test.mjs`: новый describe VL-69 — `task edit --parent` (установка, ошибка на несуществующем, сброс ''), `task list --parent` (фильтр).
- `src/cli/skills.test.mjs`: новый describe VL-69 — phase-1.md содержит запрет создания задач («НЕ создавай»); phase-2/phase-3/phase-close содержат 'parentTaskId'; phase-3 содержит 'backlog_list_tasks'.
- `src/core/compat-full.test.mjs` (~118-130, блок round-trip): +assert `parent_task_id` и `type` равны после round-trip (AC #8).

### 6. Документация
- `docs/mcp-reference.md`: таблицы create (~27-43), list (~46-56), update (~71-82) — строка parentTaskId; пример вызова (~206).
- `docs/cli-reference.md:65` — list syntax + флаг --parent в таблицу; `:83` — edit syntax + флаг --parent.
- `MCP-SETUP.md:12-13` — упомянуть parentTaskId в описаниях create/list.
- `CHANGELOG.md` (Unreleased → Добавлено): запись VL-69.

### Порядок выполнения
1. config.ts (types/statuses) + backlog/config.yml.
2. tools.ts (MCP) → тесты parent.test.mjs + правка types.test.mjs.
3. task.ts (CLI) → тесты create-flags.test.mjs.
4. Шаблоны фаз + skills → синхрон .qwen/commands → skills.test.mjs.
5. compat-full.test.mjs round-trip asserts.
6. Документация + CHANGELOG.
7. Сборка и полный прогон тестов.

### Проверка
```bash
pnpm build        # tsc strict → dist/
pnpm test         # build + node --test src
```
Ручной smoke во временной папке:
```bash
mkdir /tmp/vl69-smoke && cd /tmp/vl69-smoke
node <repo>/bin/vibelog.mjs init Smoke --prefix sm
node <repo>/bin/vibelog.mjs task create "Эпик" --type epic
node <repo>/bin/vibelog.mjs task create "Дитя" --parent sm-1 --type task
node <repo>/bin/vibelog.mjs task list --parent sm-1
node <repo>/bin/vibelog.mjs task edit sm-1 --parent sm-99   # → ошибка: родитель не найден
```
MCP — in-process через тесты (handleToolCall).

### Риски
- Смена DEFAULT_TASK_TYPES ломает assertions types.test.mjs (исправить в том же коммите) и меняет поведение проектов без ключа `types` (появится epic — намеренно, иначе workflow неработоспособен).
- defaultConfig.statuses влияет только на новые проекты; существующие backlog/config.yml не трогаются.
- Шаблоны фаз меняют поведение headless-агентов: сохранить required-строки skills.test.mjs; epic-ветка Code даёт fallback-инструкцию (headless-сессия может не суметь спавнить дочерние — тогда инструктирует пользователя).
- Очистка parent пустой строкой — новая семантика; закрепить тестом.
- Web UI (api.ts PATCH) parentTaskId не поддерживает — вне AC VL-69, не блокирует.

### Покрытие AC
#1 — tools.ts create/update parentTaskId (+type уже есть); #2 — task create уже есть, +task edit; #3 — list CLI+MCP; #4 — phase-1.md; #5 — phase-2.md; #6 — phase-3.md; #7 — phase-close.md; #8 — compat-full round-trip (формат файлов не меняется, parent_task_id/type уже сериализуются core).

Объём: ~23 файла (7 src, 1 backlog/config.yml, 10 templates/.qwen, 4 docs+CHANGELOG).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 17:53
---
Фаза 2 (Plan) выполнена. План записан в Implementation Plan: **23 файла**, ключевые изменения:
1. **MCP** (`src/mcp/tools.ts`): `parentTaskId` в схемах и хендлерах `backlog_create_task` (с валидацией родителя), `backlog_list_tasks` (фильтр + `parent_task_id` в simplified-выводе), `backlog_update_task` (смена/сброс пустой строкой).
2. **CLI** (`src/cli/commands/task.ts`): `--parent` в `task edit` и `task list` (create уже поддерживает).
3. **Конфиг**: `epic` в DEFAULT_TASK_TYPES, статусы Spec/Planned в defaultConfig, явный блок `types` в backlog/config.yml.
4. **Промпты фаз**: переписать phase-1 (Spec — без создания задач, смена type), phase-2 (Plan — ветвление task/epic, дети с parentTaskId, Blocked для блокеров), phase-3 (Code — оркестрация детей для epic), phase-close (закрытие epic только когда дети Done); обновить skills spec/plan/code; синхронизировать .qwen/commands.
5. **Тесты**: новый parent.test.mjs (MCP), VL-69-блоки в create-flags.test.mjs и skills.test.mjs, round-trip parent/type в compat-full.test.mjs, правка expected-массивов в types.test.mjs.
6. **Документация**: mcp-reference, cli-reference, MCP-SETUP, CHANGELOG.
**Риски**: смена DEFAULT_TASK_TYPES/statuses влияет на новые тесты и новые проекты (нужна правка types.test.mjs в том же коммите); epic-ветка Code зависит от способности headless-сессии оркестрировать детей (есть fallback-инструкция); Web UI parentTaskId не поддерживает (вне AC).
---
author: @agent
created: 2026-10-03 18:23
---
Фаза 3 (Code) выполнена.
**Изменено (20 файлов):**
- `src/core/config.ts` — `epic` в DEFAULT_TASK_TYPES; defaultConfig.statuses += Spec/Planned.
- `src/mcp/tools.ts` — `parentTaskId` в схемах и хендлерах `backlog_create_task` (валидация родителя), `backlog_list_tasks` (фильтр + `parent_task_id` в simplified-выводе), `backlog_update_task` (смена/сброс пустой строкой, валидация).
- `src/cli/commands/task.ts` — `--parent` в `task edit` (установка/ошибка/сброс) и `task list` (фильтр, case-insensitive); `src/cli/router.ts` — help list/edit.
- `backlog/config.yml` — явный блок `types` (bug…spike + epic).
- Шаблоны фаз: `templates/qwen-commands/phase-1.md` (Spec — уточнение, смена type, БЕЗ создания задач), `phase-2.md` (Plan — task: план в задачу/блокер+Blocked; epic: дети с parentTaskId, статус Planned), `phase-3.md` (Code — task: реализация; epic: оркестрация через backlog_list_tasks {parentTaskId}), `phase-close.md` (Close — epic закрывается только когда дети Done).
- Skills: `templates/qwen-commands/{spec,plan,code}.md` переписаны под ветвление task/epic; копии `.qwen/commands/vibelog/` синхронизированы (ручной cp).
- Тесты: новый `src/mcp/parent.test.mjs` (create/update/list parentTaskId + round-trip); VL-69-блоки в `src/cli/create-flags.test.mjs` (edit/list --parent) и `src/cli/skills.test.mjs` (промпты фаз); `src/core/compat-full.test.mjs` — round-trip parent_task_id/type; правки expected в `src/mcp/types.test.mjs` (epic) и `src/cli/config-cli.test.mjs` (новые статусы).
- Документация: `docs/mcp-reference.md`, `docs/cli-reference.md`, `MCP-SETUP.md`, `CHANGELOG.md` (VL-69 в Unreleased).
**Проверки:** pnpm build OK; pnpm test — 437/437; CLI smoke в /tmp/vl69-smoke: init → task create --type epic → create --parent sm-1 → list --parent sm-1 (только дитя) → edit --parent sm-99 («Родительская задача sm-99 не найдена.»), parent_task_id: sm-1 во frontmatter дитя.
**Что осталось:** AC-чеклист задачи пуст (AC #1-#8 описаны в теле — реализованы, отмечать нечего); Web UI PATCH parentTaskId не поддерживает (вне AC VL-69, зафиксировано в плане); epic-ветка Code в headless-промпте даёт fallback-инструкцию («Запусти Code на детях: …») — реальный батч-запуск Code на дочерних через бота/оркестратор в этой фазе не проверялся.
---
author:  @agent
created: 2026-10-03 22:44
---
Фаза Close выполнена. Статус: Done. Коммит feat: 7e7a440 — «feat: VL-69 — Workflow: поддержка Epic и parent_task_id в фазах» (25 файлов: MCP/CLI parentTaskId, конфиг, шаблоны фаз, тесты, документация).
---
<!-- COMMENTS:END -->