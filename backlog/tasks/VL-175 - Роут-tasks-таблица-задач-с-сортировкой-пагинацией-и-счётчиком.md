---
id: VL-175
title: 'Роут #/tasks: таблица задач с сортировкой, пагинацией и счётчиком'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 11:39'
updated_date: '2026-10-25 17:26'
due_date: ''
labels:
  - web
dependencies: []
milestone: ''
references:
  - ref-2
priority: high
type: task
project: ''
parent_task_id: VL-173
ordinal: 0
documentation: []
modified_files:
  - README.md
  - web/src/App.tsx
  - web/src/lib/use-hash-route.ts
  - web/src/types/kanban.ts
  - web/src/components/kanban/api.ts
  - web/src/components/tasks/api.ts
  - web/src/components/tasks/sort-tasks.ts
  - web/src/components/tasks/tasks-table.tsx
  - web/src/components/tasks/tasks-page.tsx
  - web/src/components/ui/table.tsx
  - web/dist/index.html
  - web/dist/assets/index-nT7DwM6m.js
  - web/dist/assets/index-CKJCItR3.css
lessons:
  - lesson-25
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Эпик VL-173, AC1 + часть AC2 (роут, колонки, сортировка, пагинация, счётчик). Фильтры multi-select — VL-176; переключатель видов — VL-177.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Существует роут #/tasks (use-hash-route Route='tasks', App рендерит TasksPage); таблица имеет колонки ID, Title, Status, Priority, Type, Labels, Milestone, Updated
- [x] #2 Клик по заголовку любой из 8 колонок сортирует её: asc → desc → сброс; status/priority сортируются по порядку из конфига, Updated — по дате, Labels — по содержимому, пустые значения в конце
- [x] #3 Пагинация (pageSize 25/50/100, Prev/Next + номера страниц) и счётчик «Показано N из M» работают на 150+ задачах (в проекте 167); клик по строке открывает TaskModal (просмотр)
- [x] #4 pnpm web:build и pnpm test проходят; консоль браузера без ошибок; README (блок «Веб-интерфейс») описывает роут #/tasks
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

1. `web/src/lib/use-hash-route.ts`
   - строка 15: `export type Route = 'board' | 'tasks' | 'settings' | 'config'`;
   - parseHash (строки 18–23): добавить `if (path === 'tasks') return 'tasks';` ДО дефолта `return 'board'`;
   - обновить док-комментарий (строки 4–11): перечислить маршрут `tasks` (#/tasks — таблица).
2. `web/src/App.tsx`
   - импорт `TasksPage` (после строки 11);
   - ветка роутинга (строки 47–51): `route === "tasks" ? <TasksPage /> : route === "settings" ? ...` — main остаётся scroll-контейнером (lesson-14 не трогаем).
3. `web/src/types/kanban.ts` — расширить `KanbanTask` (строки 13–26) тремя полями: `type: string; milestone: string; updated_date: string;` (нужны таблице; TaskModal лишние поля игнорирует — не ломается).
4. `web/src/components/kanban/api.ts`
   - `ApiTask` (строки 11–20): добавить `type: string; milestone: string; updated_date: string;`;
   - `toKanbanTask` (строки 27–40): пробросить `type: raw.type || ''`, `milestone: raw.milestone || ''`, `updated_date: raw.updated_date || ''`.
   - GET /api/tasks (src/web/api.ts:49–52) отдаёт полный `Task[]` из src/core/task.ts (type/milestone/updated_date — строки 64–67), маппинг только их терял.
5. NEW `web/src/components/tasks/api.ts`
   - `fetchTasks()` — переэкспорт из `../kanban/api` (данные те же);
   - `fetchConfig(): Promise<{ statuses: string[]; priorities: string[]; types: string[] }>` — GET /api/config, значения по умолчанию (как FALLBACK_STATUSES в kanban/api.ts:22–24), try/catch с fallback.
6. NEW `web/src/components/ui/table.tsx` — копия `backlog/references/data/next-shadcn-admin-dashboard/src/components/ui/table.tsx` (Table, TableHeader, TableBody, TableHead, TableCell, TableRow). Только `cn`, контекст-провайдеров родителя не требует (lesson-7 не применим).
7. NEW `web/src/components/tasks/sort-tasks.ts` — чистая функция (используется также в VL-177):
   - `type SortKey = 'id' | 'title' | 'status' | 'priority' | 'type' | 'labels' | 'milestone' | 'updated_date'`;
   - `type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null`;
   - `sortTasks(tasks, sort, config)` — status/priority: индекс в массиве конфига (status → config.statuses, priority → config.priorities); updated_date: `Date.parse`; labels: `join(', ')`; id/title/type/milestone: `localeCompare`; пустые значения (`''`) всегда в конец независимо от dir.
8. NEW `web/src/components/tasks/tasks-table.tsx` — презентационная таблица, БЕЗ своего состояния сортировки/пагинации:
   - пропсы: `{ tasks, sort, onSortChange, page, pageSize, onPageChange, total, filteredCount }`;
   - 8 колонок: ID, Title, Status, Priority, Type, Labels (бейджи Badge), Milestone, Updated;
   - клик по TableHead: цикл asc → desc → сброс (null); индикатор ArrowUp/ArrowDown (иконки проверены в lucide-react 1.49 — lesson-15);
   - счётчик «Показано {filteredCount} из {total}» над таблицей;
   - пагинация: селект pageSize 25/50/100 (ui/select) + Prev/Next + номера страниц по мотивам `getPageNumbers` ref-2 `.../dashboard/tasks/_components/tasks.tsx:47–57`; при пустом результате — строка «Нет задач».
9. NEW `web/src/components/tasks/tasks-page.tsx` — владелец данных и состояния:
   - загрузка `Promise.all([fetchTasks(), fetchConfig()])` с loading/error (паттерн kanban.tsx:88–103);
   - state: `sort: SortState` (по умолчанию `{ key: 'updated_date', dir: 'desc' }`), `page` (сброс в 0 при смене sort/фильтров), `pageSize` (25), `modal` для TaskModal (view);
   - рендер: заголовок «Задачи — таблица» + кнопка «Обновить», `TasksTable`, клик по строке → TaskModal(mode='view', statuses из config.statuses);
   - фильтры подключаются в VL-176 (здесь же место: `filterTasks` до `sortTasks`, счётчик считает после фильтров).
10. `README.md` — блок «Веб-интерфейс» (строки ~81–95): добавить строку про роут #/tasks (таблица: сортировка по клику, пагинация, счётчик «Показано N из M»).

## Порядок действий

1. Правки роутинга (пункты 1–2) — route tasks.
2. Расширение KanbanTask/ApiTask/toKanbanTask (пункты 3–4).
3. api.ts + копия ui/table.tsx (пункты 5–6).
4. sort-tasks.ts → tasks-table.tsx → tasks-page.tsx (пункты 7–9).
5. README (пункт 10).

## Как проверить

- `pnpm build && pnpm test` (backend-регрессии);
- `pnpm web:build` (tsc -b + vite build) и `pnpm --dir web lint`;
- браузер: `vibelog browser` → открыть `#/tasks` (chrome-devtools: new_page, take_screenshot):
  - кликнуть заголовки всех 8 колонок — порядок меняется asc→desc→сброс;
  - пагинация на 167 задачах: 7 страниц при pageSize 25, Prev/Next/номера, «Показано 167 из 167»;
  - клик по строке → TaskModal открылся;
  - `list_console_messages` — без ошибок.

## Риски

- Опциональные поля в старых задачах — нормализация `|| ''` в toKanbanTask (иначе сортировка падает на undefined).
- Вложенная прокрутка: TasksPage использует `h-full min-h-0 flex flex-col` как Kanban (lesson-14), таблица скроллится внутри main.
- Строки 167 < 500 — виртуальный скролл не нужен, достаточно пагинации; при росте >500 увеличить pageSize.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 12:47
---
Фаза 3 (Code) выполнена. Реализовано по плану: роут #/tasks (use-hash-route Route='tasks', App рендерит TasksPage); расширены KanbanTask/ApiTask/toKanbanTask полями type/milestone/updated_date с нормализацией || ''; web/src/components/tasks/{api,sort-tasks,tasks-table,tasks-page}.ts(x) — переэкспорт fetchTasks + fetchConfig с fallback, чистая sortTasks (status/priority по индексу конфига, updated по Date.parse, labels по join, пустые всегда в конец), презентационная TasksTable (8 колонок, цикл asc→desc→сброс, ArrowUp/ArrowDown, счётчик «Показано N из M», пагинация 25/50/100 + Prev/Next/номера по getPageNumbers из ref-2), TasksPage (Promise.all загрузка, default sort updated desc, page-сброс, TaskModal по клику на строку, место под фильтры VL-176); web/src/components/ui/table.tsx (копия из ref-2); README — строка про #/tasks в блоке «Веб-интерфейс». Коммит 7bfdbd3. Проверки: pnpm build ✓; pnpm test — 67+1 файлов, 1169 passed ✓; pnpm web:build (tsc -b + vite) ✓; браузер (vibelog browser, #/tasks): все 8 колонок кликнуты — asc→desc→сброс работает, status/priority по порядку конфига (Backlog→To Do→Planned…, Done первые при desc), Updated по дате, пустые значения в конец (проверено на стр.7 — 20 пустых priority); пагинация: 170 задач = 7 страниц при pageSize 25, кнопки 1/…/7, Prev/Next, «Показано 170 из 170»; клик по строке → TaskModal (view, VL-10); консоль браузера без ошибок. Что осталось/замечания: pnpm --dir web lint даёт 6 ошибок react-hooks/set-state-in-effect в ПРЕДСУЩЕСТВУЮЩИХ файлах (kanban-column, kanban.tsx, nav-main, reference-detail, references-page, use-mobile) — ни одна не в файлах VL-175, они не изменялись этой задачей (регрессий нет); фильтры multi-select — VL-176, переключатель видов — VL-177. Связано: ref-2 (getPageNumbers/table), lesson-25.
---
author: @agent
created: 2026-10-25 17:26
---
Фаза Close выполнена. Статус: Done. Код закоммичен ранее (feat 7bfdbd3), документация — в общем docs-коммите VL-173 (b19df96). Не закоммичено: нет.
---
<!-- COMMENTS:END -->