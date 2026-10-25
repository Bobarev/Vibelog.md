---
id: VL-162
title: Урезанный режим view task с выбором полей
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 07:33'
updated_date: '2026-10-25 23:25'
due_date: ''
labels:
  - core
  - mcp
dependencies: []
milestone: v1.9
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/view-task-fields.test.mjs
  - README.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Сделать урезанную версию backlog view task или добавить в него параметры, того что нужно прочесть из задачи. Например для понимания контекста достаточно описания (в фазе spec)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backlog_view_task принимает необязательный параметр fields (массив имён полей Task) и возвращает JSON только с указанными полями (например ["id","title","description"] — контекст для фазы Spec)
- [x] #2 Вызов без fields (или с пустым массивом) возвращает полное представление задачи, как раньше — обратная совместимость не нарушена
- [x] #3 Неизвестное имя поля в fields вызывает ошибку на русском языке с перечнем допустимых имён полей
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-162 — Implementation Plan: параметр fields у backlog_view_task

## Архитектурное решение

Добавить необязательный параметр `fields` (массив строк) в MCP-инструмент `backlog_view_task`. Имена полей — ключи интерфейса `Task` (src/core/task.ts:52–81): `id`, `title`, `description`, `status`, `acceptanceCriteria`, `implementationPlan`, `comments` и т.д. Выборка — на уровне MCP-слоя (src/mcp/tools.ts); core не меняется, реестр имён полей не нужен (`Object.keys(task)` всегда актуален).

Контракт:
- `fields` отсутствует или пустой массив → полное представление, как сейчас (обратная совместимость; web-оркестратор и фазовые промпты зовут без параметров — регрессия исключена);
- непустой массив → JSON только с перечисленными полями (порядок ключей = порядок в `fields`);
- неизвестное имя → ошибка на русском с перечнем допустимых имён.

Вне scope: CLI `vibelog task view` (остаётся полным — AC только про backlog_view_task); core/store — без изменений.

## Файлы для изменения

1. **src/mcp/tools.ts**
   - `inputSchema` `backlog_view_task` (строки ~118–124): в `properties` добавить
     `fields: { type: 'array', items: { type: 'string' }, description: 'Имена полей Task для возврата (напр. ["id","title","description"]); без параметра или при пустом массиве — полное представление' }`
   - `toolViewTask` (строки ~751–758): после `getTask` вставить выборку (Task уже импортирован — строка 47):
     ```ts
     const fields = args.fields as string[] | undefined;
     // Обратная совместимость (VL-162): без fields или с пустым массивом — полное представление
     if (fields === undefined || (Array.isArray(fields) && fields.length === 0)) {
       return JSON.stringify(task, null, 2);
     }
     if (!Array.isArray(fields)) {
       throw new Error('Параметр fields должен быть массивом имён полей.');
     }
     const valid = Object.keys(task);
     const unknown = fields.filter((f) => !valid.includes(f));
     if (unknown.length > 0) {
       throw new Error(`Неизвестные поля: ${unknown.join(', ')}. Допустимые: ${valid.join(', ')}.`);
     }
     const picked: Record<string, unknown> = {};
     for (const f of fields) picked[f] = task[f as keyof Task];
     return JSON.stringify(picked, null, 2);
     ```
2. **src/mcp/view-task-fields.test.mjs** (новый) — по образцу src/mcp/v11.test.mjs: setup временного каталога `.test-view-fields`, `config.yml` через `stringifyYaml`, `handleToolCall` из `dist/mcp/tools.js`, `createTaskFile` для фикстуры с AC и комментариями. Кейсы:
   - `fields: ['id','title','description']` → `Object.keys(JSON.parse(result))` равно ровно `['id','title','description']`;
   - выборка `acceptanceCriteria` — чеклисты возвращаются корректно;
   - вызов без `fields` → полный объект (ключей > 20, есть `comments`);
   - `fields: []` → полное представление (обратная совместимость);
   - `fields: ['id','nope']` → throw с текстом «Неизвестные поля: nope.» и перечнем допустимых.
3. **README.md**, строка ~117 (таблица MCP-инструментов): описание `backlog_view_task` → «Просмотр задачи по ID; опционально fields — выбор возвращаемых полей (ключи Task)».

## Порядок действий

1. Правка inputSchema в src/mcp/tools.ts.
2. Правка `toolViewTask` в src/mcp/tools.ts.
3. Новый тест src/mcp/view-task-fields.test.mjs.
4. README.md — строка таблицы.
5. Сборка и прогон тестов.

## Как проверить

```bash
pnpm build
pnpm test:fast   # vitest run без пересборки; полный цикл — pnpm test
```
Все существующие тесты (v11.test.mjs, server.test.mjs, types.test.mjs) должны пройти без правок — вызовы без fields не меняют поведение.

## Риски

- **Новое поле в Task** автоматически станет допустимым в fields (`Object.keys`) — дрейфа реестра не будет.
- **Порядок ключей в ответе** зависит от порядка в `fields`, а не от Task — описано в описании параметра.
- **Дубли в fields** (`['id','id']`) — безвредны (перезапись ключа), отдельная валидация не нужна.
- **Некорректный тип** `fields` (не массив) → явная ошибка, а не тихий полный ответ.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 07:36
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Урезанный режим view task с выбором полей» (исходный был обрезан). Масштаб: task. Уточнено: цель — получить урезанный ответ view task (для фазы Spec достаточно description) либо параметры выбора возвращаемых полей; добавлено требование обратной совместимости — вызов без параметров возвращает полное представление; сформулировано 2 проверяемых AC. Labels: core, mcp. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-15 07:45
---
Фаза 2 (Plan) выполнена. Тип: task. Архитектурное решение: необязательный параметр fields (массив ключей интерфейса Task) в MCP-инструменте backlog_view_task; выборка на уровне MCP-слойа (src/mcp/tools.ts), core не меняется; без параметра/с пустым массивом — полное представление (обратная совместимость для web-оркестратора и фазовых промптов); неизвестное имя — ошибка с перечнем допустимых. План записан: 3 файла (src/mcp/tools.ts — inputSchema ~118-124 и toolViewTask ~751-758; новый тест src/mcp/view-task-fields.test.mjs; README.md ~117). Проверка: pnpm build && pnpm test:fast. Риски: порядок ключей в ответе = порядок в fields; некорректный тип fields — явная ошибка. Сформулировано 3 AC. Блокеров нет.
---
author: @agent
created: 2026-10-15 07:52
---
Фаза 3 (Code) выполнена. Реализовано по плану: параметр fields (массив ключей Task) у backlog_view_task — src/mcp/tools.ts (inputSchema + toolViewTask: без параметра/с пустым массивом — полное представление, неизвестное имя — ошибка с перечнем допустимых); новый тест src/mcp/view-task-fields.test.mjs (6 кейсов); README.md — описание инструмента в таблице MCP. Проверки: pnpm build + pnpm test:fast — 65 файлов/1113 тестов прошли, существующие тесты без правок (регрессий нет). Коммит 4a1e260 в ветке vb/vl-162. Отмечены AC 1-3 и DoD 1-3. References/lessons не применялись. Что осталось: нет (закрытие — Фаза Close).
---
author: @agent
created: 2026-10-15 08:36
---
Фаза Close выполнена. Ветка vb/vl-162 слита в master (1 коммит 4a1e260, merge без конфликтов), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. Проверки после merge: pnpm build + pnpm test:fast — прошли. DoD: 1-3 выполнены (тесты — 1113 прошли, документация — README + CHANGELOG + MCP-справочник doc-8, регрессий нет — существующие тесты без правок). Документация закоммичена: 3983569 (docs: VL-162 — документация и CHANGELOG). Lessons: урок не зафиксирован — задача прошла без инцидентов, нечего фиксировать.
---
<!-- COMMENTS:END -->