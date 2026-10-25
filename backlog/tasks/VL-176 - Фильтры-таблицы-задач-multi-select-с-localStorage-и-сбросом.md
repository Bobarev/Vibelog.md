---
id: VL-176
title: Фильтры таблицы задач (multi-select) с localStorage и сбросом
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
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: VL-173
ordinal: 0
documentation: []
modified_files:
  - web/src/components/tasks/use-task-filters.ts
  - web/src/components/tasks/tasks-filters.tsx
  - web/src/components/tasks/tasks-page.tsx
  - README.md
  - web/dist/index.html
  - web/dist/assets/index-BG1PjJq9.js
  - web/dist/assets/index-BtHiaotJ.css
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Эпик VL-173, AC2. Зависит от VL-175 (роут #/tasks и владельцы состояния). Шесть multi-select фильтров, localStorage, «Сбросить фильтры», корректный счётчик.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Фильтры status, priority, type, labels, milestone, assignee реализованы как multi-select (DropdownMenuCheckboxItem, паттерн ref-2 task-status-filter.tsx): активный фильтр — border-dashed→solid, значение снимается повторным кликом
- [x] #2 Опции status/priority/type приходят из GET /api/config; labels/milestone/assignee — union из загруженных задач
- [x] #3 Фильтры сохраняются в localStorage (ключ vibelog.tasks.filters) с try/catch при чтении/записи и восстанавливаются после перезагрузки страницы; кнопка «Сбросить фильтры» очищает всё
- [x] #4 Фильтрация применяется к таблице #/tasks до сортировки/пагинации: счётчик «Показано N из M» учитывает фильтры (N — после фильтров, M — всего), при смене фильтра пагинация сбрасывается на страницу 1
- [x] #5 pnpm web:build и pnpm test проходят; README описан фильтр и его сохранение
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

1. NEW `web/src/components/tasks/use-task-filters.ts` — хук фильтров:
   - тип `TaskFilters = { status: string[]; priority: string[]; type: string[]; labels: string[]; milestone: string[]; assignee: string[] }` (6 ключей);
   - localStorage-ключ `vibelog.tasks.filters`; чтение в `useState`-инициализаторе и запись в `useEffect` — обёрнуты в try/catch (паттерн preferences.tsx:61–77: приватный режим/quota не должен ронять UI); битый JSON → пустые фильтры;
   - возврат `{ filters, setFilter(key, value) — toggle значения, reset() — пустые фильтры, isEmpty }`;
   - экспорт чистой функции `filterTasks(tasks, filters)`: AND между группами, OR внутри; пустая группа — не фильтрует; `labels`/`assignee` — массивы, совпадение если пересечение непустое; `milestone`/`status`/`priority`/`type` — точное равенство одному из выбранных.
2. NEW `web/src/components/tasks/tasks-filters.tsx` — панель из 6 multi-select кнопок + «Сбросить фильтры»:
   - каждая кнопка — `DropdownMenu` + `DropdownMenuCheckboxItem` с `onSelect={e => e.preventDefault()}` — паттерн ref-2 `.../tasks/_components/task-status-filter.tsx:34–93` (в нашей версии `DropdownMenuCheckboxItem` уже есть в ui/dropdown-menu.tsx:81);
   - кнопка: `variant="outline"`, `border-dashed` без выбора → solid + `bg-muted` при выбранных, счётчик выбранных в скобках; крестик внутри меню снимает группу;
   - опции: status/priority/type — из `fetchConfig` (VL-175, api.ts) + фактические значения задач; labels/milestone/assignee — уникальные значения (union) из загруженного списка задач;
   - кнопка «Сбросить фильтры» (иконка X, variant=destructive/outline) справа — видна только когда `!isEmpty`, по клику `reset()` (паттерн «Reset» ref-2 tasks-toolbar.tsx:41–49).
3. `web/src/components/tasks/tasks-page.tsx` (VL-175):
   - подключить `useTaskFilters()`; цепочка: `filterTasks` → `sortTasks` → пагинация (слайс страницы);
   - счётчик «Показано {filtered.length} из {tasks.length}» (N — после фильтров, M — всего);
   - `useEffect` по `filters`/`sort` → `setPage(0)` (смена фильтра возвращает на страницу 1);
   - над TasksTable рендерить `TasksFilters` + «Сбросить фильтры» (место заложено в VL-175, пункт 9).
4. `README.md` — блок «Веб-интерфейс»: фильтры (6 полей, multi-select), сохранение в localStorage, сброс, счётчик.

## Порядок действий

1. Хук + чистая функция фильтрации (пункт 1).
2. Панель фильтров (пункт 2).
3. Интеграция в TasksPage: цепочка фильтр→сортировка→пагинация, счётчик, сброс страницы (пункт 3).
4. README (пункт 4).

## Как проверить

- `pnpm build && pnpm test`; `pnpm web:build`; `pnpm --dir web lint`;
- браузер (`vibelog browser` → `#/tasks`):
  - выбрать status=«In Progress» + label → счётчик «Показано N из M» уменьшился, страница сброшена на 1;
  - перезагрузить страницу — фильтры восстановились (проверить `localStorage['vibelog.tasks.filters']`);
  - «Сбросить фильтры» → «Показано 167 из 167», localStorage очищен/обнулён;
  - assignee-filtrovка: выбрать исполнителя — видны только его задачи;
  - `list_console_messages` — без ошибок (все fetch/localStorage в try/catch — lesson-16).

## Риски

- localStorage кидает исключения (приватный Safari/Catalina) — всё через try/catch, UI работает без сохранения.
- Значения фильтров, которых больше нет в задачах/конфиге, — оставить в состоянии (показать в меню как выбранное), чтобы сброс работал корректно.
- Двойное чтение localStorage при StrictMode-перерисовке — идемпотентно (тот же JSON).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 13:19
---
Фаза 3 (Code) выполнена. Изменено: web/src/components/tasks/use-task-filters.ts (NEW: хук 6 multi-select фильтров + localStorage vibelog.tasks.filters с try/catch + чистая filterTasks — AND между группами, OR внутри), web/src/components/tasks/tasks-filters.tsx (NEW: панель из 6 DropdownMenuCheckboxItem-кнопок border-dashed→solid со счётчиком, «Сбросить группу» в меню, «Сбросить фильтры» при !isEmpty), web/src/components/tasks/tasks-page.tsx (цепочка filterTasks→sortTasks→слайс страницы, сброс страницы в хендлерах фильтров/сортировки, счётчик «Показано N из M»), README.md (блок «Веб-интерфейс»: фильтры, localStorage, сброс), web/dist (пересборка). Коммит c6dc3a4 (без backlog/).
Проверки: pnpm build && pnpm test — OK (68 test files, 1169 тестов passed); pnpm web:build — OK; pnpm --dir web lint — файлы задачи чисты (eslint src/components/tasks = 0 проблем), но весь пакет падает с 6 pre-existing ошибками в чужих файлах (kanban-column.tsx, kanban.tsx, nav-main.tsx, reference-detail.tsx, references-page.tsx, use-mobile.ts — react-hooks/set-state-in-effect) — они существовали до VL-176 и не связаны с задачей (не регрессия).
Браузер (chrome-devtools, #/tasks): Planned+web → «Показано 3 из 170» (VL-173/176/177); перезагрузка — фильтры восстановлены (Статус (1)/Метки (1), 3 из 170); «Сбросить фильтры» → «170 из 170», localStorage обнулён, кнопка скрыта; In Progress → «0 из 170» (таких задач реально нет — корректно); assignee: во всех 170 задачах assignee пуст, поэтому фильтр проверен «осиротевшим» значением из localStorage — пункт виден в меню как выбранный, «Исполнитель (1)», «0 из 170», сброс корректен (риск из плана закрыт); смена фильтра со страницы 2 → страница 1 (Prev disabled); повторный клик снимает значение; list_console_messages — пусто (нет ошибок).
AC 1–5 отмечены, DoD 1–3 отмечены. Что осталось: визуальная проверка assignee-фильтра «только его задачи» на реальных данных невозможна (в backlog нет задач с исполнителями) — логика покрыта пересечением массивов в filterTasks и проверкой orphan-поведения; 6 ошибок lint вне VL-176 можно починить отдельной задачей.
---
author: @agent
created: 2026-10-25 17:26
---
Фаза Close выполнена. Статус: Done. Код закоммичен ранее (feat c6dc3a4), документация — в общем docs-коммите VL-173 (b19df96). Не закоммичено: нет.
---
<!-- COMMENTS:END -->