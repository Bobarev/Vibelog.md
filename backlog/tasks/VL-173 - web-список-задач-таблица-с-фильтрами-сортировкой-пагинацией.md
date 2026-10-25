---
id: VL-173
title: 'Список задач — таблица с фильтрами, сортировкой, пагинацией'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 10:42'
updated_date: '2026-10-25 17:26'
due_date: ''
labels:
  - web
dependencies: []
milestone: ''
references:
  - ref-2
priority: ''
type: epic
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас задачи видны только на канбане (обзор по статусам). Нужен отдельный роут #/tasks — таблица задач для сравнения и фильтрации.

Что: таблица задач с колонками ID, Title, Status, Priority, Type, Labels, Milestone, Updated. Фильтры сверху: status, priority, type, labels, milestone, assignee (multi-select). Сортировка по клику на заголовок колонки. Пагинация или виртуальный скролл (150+ задач). Сохранение фильтров в localStorage. Кнопка «Сбросить фильтры». Счётчик «Показано N из M».

Нужно использовать ref-2 (вкладка на сайдбар Kanban) и реализовать полностью этот интерфейс переключения вида как там сделано: Board, List и Table, поиск по задачам, фильтр, сортировки, добавление задачи.

А так же переименовать на сайдбаре Канбан в Задачи
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Существует роут #/tasks с таблицей задач (колонки ID, Title, Status, Priority, Type, Labels, Milestone, Updated); сортировка по клику на заголовок колонки работает для всех колонок
- [x] #2 Фильтры status, priority, type, labels, milestone, assignee (multi-select) применяются к таблице, сохраняются в localStorage и сбрасываются кнопкой «Сбросить фильтры»; отображается счётчик «Показано N из M»; при 150+ задачах работает пагинация или виртуальный скролл
- [x] #3 Переключатель вида (Board, List, Table) на сайдбаре реализован по образцу ref-2, включая поиск, фильтр, сортировку и добавление задачи; пункт «Канбан» переименован в «Задачи»
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 10:48
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Список задач — таблица с фильтрами, сортировкой, пагинацией» (снят ведущий тег #web). Масштаб: epic (роут #/tasks с таблицей и фильтрами + переключатель видов Board/List/Table по образцу ref-2 с поиском/фильтром/сортировкой/добавлением + переименование сайдбара — несколько отдельных подзадач). Уточнено: добавлены 3 проверяемых AC (таблица с сортировкой; фильтры с localStorage/сбросом/счётчиком/пагинацией при 150+ задачах; переключатель видов и переименование «Канбан» → «Задачи»). Labels: web. References: ref-2 (next-shadcn-admin-dashboard) связан с задачей. Вопросов нет.
---
author: @agent
created: 2026-10-25 11:44
---
Фаза 2 (Plan) выполнена. Тип: epic. Изучены ref-2 (next-shadcn-admin-dashboard: kanban.tsx:114–173 — тулбар Board/List/Table, tasks/_components — таблица/фильтры/пагинация, task-status-filter.tsx — multi-select), текущий веб-слой (App.tsx, use-hash-route.ts, kanban.tsx, app-sidebar/nav-main) и API (GET /api/tasks отдаёт полный Task[] с type/milestone/updated_date). Созданы дочерние задачи: VL-175 — «Роут #/tasks: таблица задач с сортировкой, пагинацией и счётчиком» (план записан, ~9 файлов: use-hash-route, App, расширение KanbanTask/ApiTask, новый web/src/components/tasks/{api,sort-tasks,tasks-table,tasks-page}.ts(x), копия ui/table.tsx из ref-2, README; статус Planned); VL-176 — «Фильтры таблицы задач (multi-select) с localStorage и сбросом» (план записан: use-task-filters.ts с try/catch localStorage, tasks-filters.tsx по паттерну ref-2, интеграция в TasksPage, README; зависимость от VL-175; статус Planned); VL-177 — «Переключатель видов Board/List/Table с поиском, фильтром, сортировкой и добавлением задачи» (план записан: ui/tabs.tsx, tasks-toolbar.tsx по ref-2 kanban.tsx:114–173, tasks-list.tsx, правки kanban.tsx/tasks-page.tsx, переименование «Канбан»→«Задачи» в app-sidebar + activeRoutes в nav-main по lesson-11, README; зависимости VL-175+VL-176; статус Planned). Учтены lessons 6,7,11,14,15,16,19. Риски: регрессия dnd VL-27 (не трогать handleDrag*/boardRef), localStorage в приватном режиме (try/catch), Tailwind v4-вёрстка скопированных tabs/table.
---
author: @agent
created: 2026-10-25 17:21
---
Фаза 3 (Code) на эпике выполнена. Код эпиком не писался (правило: Code на эпике оркестрирует детей) — запускалась Фаза 3 на дочерних задачах последовательной цепочкой (startPhase + onExit, с пропуском уже завершённых). Итоги детей: VL-175 «Роут #/tasks: таблица с сортировкой, пагинацией и счётчиком» — Review (коммит 7bfdbd3); VL-176 «Фильтры multi-select с localStorage и сбросом» — Review (коммит c6dc3a4); VL-177 «Переключатель Board/List/Table + поиск/фильтр/сортировка + Канбан→Задачи» — Review (коммит 2827ee1, фазу закрыл оркестратор после9 обрывов сессии агента по лимитам max-requests/max-wall-time на браузерной верификации — работа была сделана, верификация проведена вручную). Верификация AC эпика в браузере (chrome-devtools, localhost:6420): AC1 — #/tasks, таблица 8 колонок (ID/Title/Status/Priority/Type/Labels/Milestone/Updated), клик по Priority сортирует (High первые); AC2 — фильтр Priority=High → «Показано 61 из 177», localStorage vibelog.tasks.filters записан, «Сбросить фильтры» → «177 из 177», пагинация 25/стр. (8 страниц при 177 задачах >150); AC3 — табы Board/List/Table переключают hash (Table активен на #/tasks), поиск «VL-175» фильтрует доску, панель фильтров и модалка создания работают, пункт сайдбара «Задачи». Проверки: pnpm build + pnpm test — 1162+7 passed / 0 failed; pnpm web:build и pnpm --dir web lint — чисто; консоль браузера без ошибок; README обновлён (блок «Веб-интерфейс»: роут #/tasks, табы, фильтры, «Задачи»). Что осталось: все дети в статусе Review — ждут ревью и Close; когда дети будут Done, эпик переведётся в Done (шаг 3 следующего запуска Фазы 3 на VL-173). References: ref-2 уже связан.
---
author: @agent
created: 2026-10-25 17:24
---
Фаза Close: эпик не закрыт — не все дети в Done: VL-175 (Review), VL-176 (Review), VL-177 (Review). Статус эпика не изменён, коммиты и документация не выполнялись. Следующий запуск Close переведёт эпик в Done, когда дети будут закрыты.
---
author: @agent
created: 2026-10-25 17:26
---
Фаза Close выполнена. Статус: Done. Дочерние задачи закрыты: VL-175 (Done, feat 7bfdbd3), VL-176 (Done, feat c6dc3a4), VL-177 (Done, feat 2827ee1); их файлы закоммичены (4edefe8, 346f0dd, 690fa0e). Коммиты: feat — не требовался (код детей закоммичен в Code-фазах), docs b19df96 (CHANGELOG: запись Unreleased по VL-173). Не закоммичено: нет.
---
<!-- COMMENTS:END -->