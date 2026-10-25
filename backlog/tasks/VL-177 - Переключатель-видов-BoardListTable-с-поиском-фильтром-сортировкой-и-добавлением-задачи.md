---
id: VL-177
title: 'Переключатель видов Board/List/Table с поиском, фильтром, сортировкой и добавлением задачи'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 11:39'
updated_date: '2026-10-25 17:26'
due_date: ''
labels:
  - web
dependencies:
  - VL-175
  - VL-176
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: VL-173
ordinal: 0
documentation: []
modified_files:
  - README.md
  - web/src/App.tsx
  - web/src/components/kanban/kanban.tsx
  - web/src/components/kanban/kanban-column.tsx
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/layout/nav-main.tsx
  - web/src/components/references/reference-detail.tsx
  - web/src/components/references/references-page.tsx
  - web/src/components/tasks/tasks-page.tsx
  - web/src/components/tasks/tasks-list.tsx
  - web/src/components/tasks/tasks-toolbar.tsx
  - web/src/hooks/use-mobile.ts
  - web/src/components/ui/tabs.tsx
  - web/dist/index.html
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Эпик VL-173, AC3. Зависит от VL-175 (роут/таблица) и VL-176 (панель фильтров). Тулбар по паттерну ref-2 kanban.tsx:114–173, List-вид, переименование сайдбара.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Тулбар с табами Board/List/Table реализован по образцу ref-2 (kanban.tsx:114-173): Board и List переключают вид на #/ (состояние view в localStorage), Table ведёт на #/tasks; на #/tasks таб Table активен
- [x] #2 Поиск по задачам (id/title) в тулбаре фильтрует и доску, и список, и таблицу; кнопка «Фильтр» открывает панель фильтров из подзадачи фильтров (переиспользование), кнопка «Сортировка» (ArrowUpDown) меняет единый sort-state, синхронный с кликами по заголовкам таблицы
- [x] #3 Кнопка «Создать задачу» в тулбаре работает: на #/ — через QUICK_CREATE_EVENT (существующий флаг+событие, lesson-19), на #/tasks — через локальный TaskModal create; List-вид (tasks-list.tsx) рендерит строки задач с бейджами и открывает TaskModal по клику
- [x] #4 Пункт сайдбара переименован «Канбан» → «Задачи» (app-sidebar.tsx:28) и активен и на #/, и на #/tasks (nav-main isActive учитывает activeRoutes — lesson-11); Quick Create из сайдбара и drag-and-drop на доске не сломаны (PATCH /api/tasks/:id уходит, откат VL-27 работает)
- [x] #5 pnpm web:build, pnpm --dir web lint и pnpm test проходят; консоль браузера без ошибок (новые fetch в try/catch — lesson-16); README описан переключатель видов и переименование
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

1. NEW `web/src/components/ui/tabs.tsx` — копия `backlog/references/data/next-shadcn-admin-dashboard/src/components/ui/tabs.tsx` (Tabs, TabsList, TabsTrigger; radix-ui пакет уже в web/package.json, контекст-провайдеров родителя не требует — lesson-7 не применим).
2. NEW `web/src/components/tasks/tasks-toolbar.tsx` — по образцу ref-2 `.../dashboard/kanban/_components/kanban.tsx:114–173`:
   - `Tabs` (value=view, onValueChange): Board (иконка Kanban), List (иконка List), Table (иконка Table2) — все три иконки есть в lucide-react 1.49 (проверено — lesson-15);
   - поиск: `Input type="search"` placeholder «Поиск задач» (id/title, case-insensitive substring) — пропсы `search`/`onSearchChange`;
   - кнопка «Фильтр» (SlidersHorizontal) — раскрывает/скрывает `TasksFilters` (VL-176, переиспользование как есть);
   - кнопка «Сортировка» (ArrowUpDown) — `DropdownMenu`: поля (ID/Title/Status/Priority/Updated/…) + направление (asc/desc); меняет единый `sort`-state;
   - кнопка «Создать задачу» (Plus) — пропс `onAddTask`;
   - справа — кнопка «Обновить» (переносится из текущей шапки kanban.tsx:233–237);
   - layout: `flex shrink-0 flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center` (как ref-2:112).
3. NEW `web/src/components/tasks/tasks-list.tsx` — List-вид:
   - строки: ID (моно), Title, бейджи Status/Priority (Badge), Labels, Updated; клик → `onTaskClick(task)` (TaskModal view);
   - пусто → «Нет задач»; данные — плоский массив, общий с доской.
4. `web/src/components/tasks/sort-tasks.ts` (VL-175) — расширить `SortKey`: уже включает все нужные поля; toolbar использует его же.
5. `web/src/components/kanban/kanban.tsx`:
   - state `view: 'board' | 'list'` — инициализация из localStorage `vibelog.tasks.view` (try/catch), запись при переключении; tab «table» → `window.location.hash = '#/tasks'` (переход, view не пишем);
   - шапка (строки 229–237) заменяется на `TasksToolbar` + состояние `search`, `sort` (TasksPage/Kanban — владелец);
   - фильтры — `useTaskFilters()` (VL-176, тот же localStorage-ключ → синхрон с #/tasks);
   - цепочка перед рендером: `filterTasks` → `search`-фильтр → `sortTasks` → разбивка в колонки (сортировка внутри колонок безопасна: порядок карточек не персистится, PATCH пишет только status — VL-27);
   - view=list → `<TasksList>` вместо DragDropProvider; view=board → существующая доска БЕЗ изменений handleDrag*/boardRef (не трогать — риск регрессии VL-27);
   - TaskModal (view/create) и Quick Create (QUICK_CREATE_EVENT, строки 119–133) остаются как есть — App.handleQuickCreate (App.tsx:24–31) продолжает работать.
6. `web/src/components/tasks/tasks-page.tsx` (VL-175/176):
   - над фильтрами/таблицей тот же `TasksToolbar` (view='table'; клик Board/List → `window.location.hash = '#/'` + записать `vibelog.tasks.view`, чтобы Kanban открыл нужный вид);
   - поиск/сортировка — локальные state TasksPage; sort передаётся в TasksTable (заголовки колонок и «Сортировка» в тулбаре меняют ОДИН state — синхронизация через props, parent-child, lesson-19 не нужен);
   - «Создать задачу» → локальный `TaskModal(mode='create', statuses=config.statuses)`; обработчик Quick Create на #/tasks: дополнительный слушатель QUICK_CREATE_EVENT (по образцу kanban.tsx:119–133), чтобы сайдбар-кнопка работала и на таблице.
7. `web/src/components/layout/app-sidebar.tsx:28` — `{ id: "board", title: "Задачи", url: "board", icon: Kanban, activeRoutes: ["tasks"] }` (переименование «Канбан» → «Задачи»).
8. `web/src/components/layout/nav-main.tsx`:
   - в тип NavItem (строки 40–64) добавить необязательное `activeRoutes?: Route[]`;
   - в NavMain (строка ~96): `isActive={(item.activeRoutes ?? [item.url]).includes(route)}` — пункт подсвечен и на #/, и на #/tasks (урок lesson-11: активность — по хеш-роуту);
   - NavParentItem/SubItem — не трогают (без подпунктов у «Задачи»).
9. `README.md` — блок «Веб-интерфейс»: переключатель Board/List/Table (поиск, фильтр, сортировка, создание), пункт сайдбара «Задачи» (был «Канбан»).

## Порядок действий

1. ui/tabs.tsx (копия) → tasks-toolbar.tsx.
2. tasks-list.tsx.
3. Правки kanban.tsx: view-state, замена шапки на тулбар, фильтры/поиск/сортировка, list-режим.
4. Правки tasks-page.tsx: тулбар, локальный create, Quick Create-слушатель.
5. Сайдбар: app-sidebar + nav-main (rename + activeRoutes).
6. README.

## Как проверить

- `pnpm build && pnpm test`; `pnpm web:build`; `pnpm --dir web lint`;
- браузер (`vibelog browser`, chrome-devtools):
  - таб Board → доска; List → список (клик → TaskModal); Table → `#/tasks`, на нём таб Table активен; обратно Board → `#/` с сохранённым view после перезагрузки;
  - поиск «VL-17» фильтрует доску/список/таблицу; «Фильтр» открывает панель VL-176; «Сортировка» в тулбаре и клик по заголовку таблицы меняют один порядок;
  - «Создать задачу» в тулбаре на #/ и на #/tasks открывает модалку; Quick Create сайдбара работает на обоих роутах;
  - сайдбар: пункт «Задачи», подсвечен и на #/, и на #/tasks (переключение настроек не сломано);
  - drag-and-drop карточки → PATCH /api/tasks/:id ушёл, файл задачи обновился (network + файл);
  - `list_console_messages` — без ошибок (fetch в try/catch — lesson-16).

## Риски

- Регрессия dnd/VL-27 — не изменять handleDragStart/Over/End, boardRef, откат; тулбар только над контентом, `shrink-0`, высоты `h-full min-h-0` сохранить (lesson-14).
- Tabs из ref-2 — проверить вёрстку в Tailwind v4 (наши утилиты совпадают, но data-slot-классы перепроверить визуально).
- Два владельца view (localStorage + hash) — источник истины: hash для table, localStorage только board/list; при любом конфликте hash главнее.
- Quick Create: если слушатель добавить и в Kanban, и в TasksPage — оба не смонтированы одновременно (разные роуты), взаимного срабатывания нет; флаг consume — как в kanban.tsx:122.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 17:20
---
Фаза 3 (Code) выполнена (закрыта оркестратором эпика VL-173: сессии агента VL-1779 раз завершались по лимитам max-requests/max-wall-time на браузерной верификации, работа при этом была сделана и проверена). Реализовано: тулбар tasks-toolbar.tsx (табы Board/List/Table по образцу ref-2 kanban.tsx:114-173, поиск, «Фильтр» → панель VL-176, «Сортировка» с единым sort-state, «Создать задачу»), tasks-list.tsx (List-вид), правки kanban.tsx (view-state board/list в localStorage, table → hash #/tasks, замена шапки на тулбар), tasks-page.tsx (тулбар + Quick Create-слушатель), ui/tabs.tsx, app-sidebar.tsx («Канбан» → «Задачи»), nav-main.tsx (activeRoutes — активен и на #/, и на #/tasks). Верификация оркестратором в браузере: табы переключают hash (Table активен на #/tasks, Board/List на #/), поиск «VL-175» фильтрует доску, панель фильтров открывается, модалка «Создать задачу» работает, пункт сайдбара «Задачи», консоль без ошибок. Проверки: pnpm build + pnpm test (1162 + 7 passed, 0 failed), pnpm web:build, pnpm --dir web lint (чисто), README описан. Коммит 2827ee1. Изменено: README.md, web/src/{App.tsx, components/kanban/{kanban,kanban-column}.tsx, components/layout/{app-sidebar,nav-main}.tsx, components/references/{reference-detail,references-page}.tsx, components/tasks/{tasks-page,tasks-list,tasks-toolbar}.tsx, hooks/use-mobile.ts}, web/dist.
---
author: @agent
created: 2026-10-25 17:26
---
Фаза Close выполнена. Статус: Done. Код закоммичен ранее (feat 2827ee1), документация — в общем docs-коммите VL-173 (b19df96). Не закоммичено: нет.
---
<!-- COMMENTS:END -->