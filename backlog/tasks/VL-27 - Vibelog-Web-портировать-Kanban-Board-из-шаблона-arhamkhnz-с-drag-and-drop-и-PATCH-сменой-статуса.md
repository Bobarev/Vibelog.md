---
id: VL-27
title: 'Vibelog Web: портировать Kanban Board из шаблона arhamkhnz с drag-and-drop и PATCH-сменой статуса'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 11:36'
updated_date: '2026-10-01 13:39'
due_date: ''
labels: []
dependencies:
  - VL-26
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Портировать Kanban Board из шаблона ../some/next-shadcn-admin-dashboard в наше Vite-приложение (создаётся в VL-26). Взять страницу src/app/(main)/dashboard/kanban/ и компоненты _components/, заменить слой данных Next.js (Server Actions) на fetch('/api/tasks') и PATCH /api/tasks/:id. Использовать @dnd-kit для drag-and-drop. Колонки — статусы из конфига проекта. Дополнительно: провести ресёрч шаблона и описать в задаче, какие ещё блоки (dashboard, формы и т.д.) стоит вытащить для будущего развития веб-интерфейса.

## Ресёрч шаблона (VL-27, 2026-10-01)

Что портировано в VL-27: канбан (_components/kanban.tsx, kanban-column.tsx, task-card.tsx, sortable-task-card.tsx, utils.ts) + ui-компоненты avatar/badge/separator + getInitials. DnD — @dnd-kit/react ^0.5 (новое API хуков, не @dnd-kit/core). Упрощения: без тулбара Tabs/Search/Filter/Sort, без перетаскивания колонок, без progress/team/insights.

Пригодные для будущего портирования (по убыванию ценности):
1. `_components/` layout (sidebar + header) + `layout.tsx` — каркас приложения, навигация между разделами (самый ценный блок: превращает доску в полноценное приложение)
2. `dashboard/default` + `analytics` — дашборд-основа со виджетами (user story VL-25: «сам dashboard можно взять за основу»)
3. `tasks/` — полноценный CRUD задач (список, фильтры, виды) — расширит доску до менеджмента
4. `ui/` — остальные ~35 shadcn-компонентов (dialog, dropdown-menu, tabs, table, command) — по мере надобности
5. Тёмная тема — у нас уже есть ThemeProvider, next-themes не копировать
6. `profile`, `users`, `mail`, `chat`, `calendar`, `invoice`, `crm` и т.п. — вне скоупа Vibelog (нет таких сущностей)

Технические находки: все .tsx шаблона содержат 'use client' и/или next/* — при копировании удалять; данные в шаблоне статичны (data.ts с колонками ideas/planned/building/qa/shipped), наши колонки динамические из GET /api/config → statuses.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В web/src/components/kanban/ созданы компоненты Kanban; grep по web/src не находит 'use client', next/navigation, next/link или других next/* импортов
- [x] #2 Доска загружает задачи через fetch('/api/tasks'), колонки строятся по статусам из backlog.config.yml (GET /api/config), задачи сгруппированы по статусам
- [x] #3 Перетаскивание карточки в другую колонку вызывает PATCH /api/tasks/:id со сменой status; pnpm build в web/ проходит успешно
- [x] #4 В description задачи зафиксирован ресёрч: какие ещё блоки/компоненты из ../some/next-shadcn-admin-dashboard пригодны для портирования (dashboard как основа и т.д.)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Факты из исследования

**Шаблон** (`../some/next-shadcn-admin-dashboard/src/app/(main)/dashboard/kanban/`):
- page.tsx (18) → `<Kanban initialBoard={initialBoard} />`
- _components/kanban.tsx (199): DragDropProvider (@dnd-kit/react ^0.5), move() из @dnd-kit/helpers; board = Record<ColumnId, Task[]>; handleDragOver — оптимистичный move, handleDragEnd — откат при canceled (boardBeforeDrag); тулбар: Tabs(board/list/table) + Search + Filter/Sort + Add task (строки 114-165)
- kanban-column.tsx (84): useSortable (колонка) + useDroppable (контейнер задач, CollisionPriority.Low)
- task-card.tsx (175): title/description/priority-badge/owner-avatar/dueDate/progress/insights; Progress и Separator — только для колонки «building»
- sortable-task-card.tsx (24), utils.ts (19): findColumnId/findTask по columnIds
- types.ts (45): Task = {id,title,description,priority,dueDate,progress,owner,team,insights}
- data.ts (307): статичные колонки ideas/planned/building/qa/shipped + моки — НЕ копируем (наши колонки из конфига)
- 'use client' и next/* — есть в каждом .tsx, удалить
- dnd-kit-зависимости шаблона: @dnd-kit/abstract ^0.5.0, @dnd-kit/helpers ^0.5.0, @dnd-kit/react ^0.5.0
- ui/-компоненты шаблона: avatar (radix-ui), badge (cva+radix Slot), progress, separator, tabs, dropdown-menu, input-group, button-group — в web/ есть только button.tsx

**Наша сторона:**
- web/src/App.tsx — заглушка с кнопкой; web/src/main.tsx — точка входа с ThemeProvider
- web/package.json: radix-ui ^1.6.7, cva, cn, lucide-react уже есть; @dnd-kit НЕТ
- Наш Task (src/core/task.ts:53): id, title, status, priority, assignee[], due_date, labels[], type, project, description, comments[] и др.
- API: GET /api/tasks → Task[]; GET /api/config → объект со statuses[]; PATCH /api/tasks/:id → частичное обновление (в т.ч. status)

## Изменяемые/создаваемые файлы

### 1. web/package.json — зависимости
Добавить в dependencies: `"@dnd-kit/abstract": "^0.5.0"`, `"@dnd-kit/helpers": "^0.5.0"`, `"@dnd-kit/react": "^0.5.0"` (те же версии, что в шаблоне). Затем `pnpm --dir web install`.

### 2. web/src/components/ui/ — скопировать из шаблона (4 файла)
- avatar.tsx, badge.tsx, separator.tsx — копия без 'use client' (в Vite не нужен)
- progress.tsx — НЕ копируем (наших данных прогресса нет)
- tabs/dropdown-menu/input-group/button-group — НЕ копируем (тулбар упрощаем)

### 3. web/src/lib/utils.ts — добавить getInitials
Скопировать из шаблонного src/lib/utils.ts (нужен avatar-fallback).

### 4. web/src/types/kanban.ts (новый)
- `KanbanTask` — подмножество нашего Task для карточки: id, title, status, priority, due_date, labels[], assignee[], description, commentsCount (comments.length)
- `BoardState = Record<string, KanbanTask[]>` — колонки динамические (статусы из конфига)

### 5. web/src/components/kanban/api.ts (новый)
- `fetchTasks(): Promise<KanbanTask[]>` — GET /api/tasks, маппинг Task → KanbanTask (commentsCount = comments?.length ?? 0)
- `fetchStatuses(): Promise<string[]>` — GET /api/config → config.statuses (fallback ['To Do','In Progress','Review','Done'] если пусто)
- `patchTaskStatus(id, status)` — PATCH /api/tasks/:id {status}, throw при !res.ok

### 6. web/src/components/kanban/utils.ts (новый, по мотивам шаблонного utils.ts)
- `buildBoard(tasks, statuses): BoardState` — группировка по status; колонки = statuses из конфига + статусы встреченные в задачах, но отсутствующие в конфиге (в конец)
- `findColumnId(board, id)`, `findTask(board, id)` — как в шаблоне, но columnIds динамические

### 7. web/src/components/kanban/task-card.tsx (по мотивам шаблонного)
- Шаблонная разметка (карточка: title + priority badge + line-clamp description + footer), поля: id, labels[] (badge secondary), due_date, assignee[0] (Avatar + getInitials), commentsCount (иконка MessageSquare)
- Выкинуть: progress, team, insights (кроме commentsCount), owner.tone
- priority-badge-config: High/Medium/Low → variant/иконка (lucide)

### 8. web/src/components/kanban/sortable-task-card.tsx
- Копия шаблонной без 'use client': useSortable({id: task.id, index, type:'task', accept:'task', group: columnId, data:{type:'task',task,columnId}})

### 9. web/src/components/kanban/kanban-column.tsx
- Шаблонная, но БЕЗ column-sortable (порядок колонок = порядок статусов в конфиге, перетаскивание колонок вне скоупа): только useDroppable (контейнер задач) + заголовок (title, счётчик, Plus-кнопка без действия — заглушка)

### 10. web/src/components/kanban/kanban.tsx (по мотивам шаблонного)
- БЕЗ 'use client'; БЕЗ тулбара Tabs/Search/Filter/Sort/Add task (заголовок «Задачи» + кнопка обновления)
- Стейт: board (BoardState), columnOrder (string[] = statuses), loading/error
- useEffect при маунте: Promise.all([fetchTasks(), fetchStatuses()]) → buildBoard
- DragDropProvider: onDragStart (снапшот board), onDragOver (move из @dnd-kit/helpers), onDragEnd:
  - canceled → откат к снапшоту
  - иначе: новый статус колонки-приёмника → оптимистичный PATCH через patchTaskStatus; при ошибке → откат + console.error (сообщение по-русски)
- DragOverlay с TaskCard (как в шаблоне, строки 178-191)
- Индикация загрузки/ошибки (простой текст, без новых ui-компонентов)

### 11. web/src/App.tsx — заменить заглушку
`<Kanban />` + обёртка с padding; удалить кнопку-заглушку.

### 12. README.md + CHANGELOG.md
- README: web-раздел — Kanban в вебе, статусы из конфига, DnD (@dnd-kit/react)
- CHANGELOG [Unreleased]: запись VL-27

### 13. Сборка web/dist (коммитится)
`pnpm web:build` — обновить закоммиченный dist.

## Ресёрч (AC #4) — зафиксировать в description задачи через backlog_update_task
Блоки шаблона, пригодные для портирования (по убыванию ценности):
1. `_components/` layout (sidebar + header) + `layout.tsx` — каркас приложения (навигация между разделами)
2. `dashboard/default` + `analytics` — дашборд-основа со виджетами (user story: «сам dashboard можно взять за основу»)
3. `tasks/` — полноценный CRUD задач (список, фильтры, виды) — расширит доску
4. `ui/` — остальные ~35 shadcn-компонентов (dialog, dropdown-menu, tabs, table, command) — по мере надобности
5. Тёмная тема через next-themes — у нас уже есть ThemeProvider, не копировать
6. `profile`, `users`, `mail`, `chat`, `calendar` — вне скоупа Vibelog (нет таких сущностей)

## Порядок действий
1. web/package.json + pnpm --dir web install
2. ui/ (avatar, badge, separator) + getInitials
3. types/kanban.ts + kanban/api.ts + kanban/utils.ts
4. task-card → sortable-task-card → kanban-column → kanban.tsx
5. App.tsx
6. pnpm --dir web build (tsc -b + vite) — ошибки типов исправить
7. pnpm test (регрессия корня — не задета, но проверяем)
8. Ресёрч-блок в description VL-27 + README/CHANGELOG
9. pnpm web:build → обновить web/dist
10. Ручная проверка (см. ниже)

## Верификация
- `pnpm --dir web build` — tsc -b + vite без ошибок
- `grep -rn "use client\|next/" web/src/components/kanban/ web/src/App.tsx` — пусто
- `pnpm test` — корень без регрессий (312+)
- Ручная: `node bin/vibelog.mjs browser --no-open --port 3032` → в браузере: колонки = статусы конфига, задачи распределены, перетаскивание меняет поле status в backlog/tasks/*.md (проверить grep-ом файл задачи до/после)

## Риски
1. **@dnd-kit/react ^0.5 — новое API** (не @dnd-kit/core): API хуков может отличаться от документации, на которую привык искать. Mitigation: копируем паттерны прямо из шаблона (он работает с React 19).
2. **Колонки-сироты**: статус задачи не из конфига — добавляем колонкой в конец (buildBoard), не теряем карточки.
3. **Оптимистичный PATCH без отката сервера**: если файл заблокирован/битый — карточка вернётся, но консоль покажет ошибку; полноценный retry — вне скоупа.
4. **web/dist в git**: после каждой правки web/ обязателен `pnpm web:build`, иначе веб отдаёт устаревшую сборку (включить в привычку перед коммитом).
5. **Тестов для web-слоя нет** (в web/ нет test-раннера): верификация = tsc -b + vite build + ручной DnD-сценарий. Vitest — кандидат отдельной задачи, не VL-27.
<!-- SECTION:PLAN:END -->