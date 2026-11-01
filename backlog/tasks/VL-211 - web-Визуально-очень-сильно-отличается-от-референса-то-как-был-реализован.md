---
id: VL-211
title: Синхронизировать вёрстку шапок и видов Board/List/Table с референсом
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 10:57'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - web
dependencies: []
milestone: v1.11
references:
  - ref-2
priority: ''
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/App.tsx
  - web/src/components/tasks/task-visuals.tsx
  - web/src/components/tasks/tasks-list.tsx
  - web/src/components/tasks/tasks-table.tsx
  - web/src/components/kanban/kanban.tsx
  - web/src/components/ui/tabs.tsx
  - web/dist/index.html
  - web/dist/assets/index-BJX4fwVl.js
  - web/dist/assets/index-D159aNsU.css
lessons:
  - lesson-6
  - lesson-14
  - lesson-15
  - lesson-16
  - lesson-25
  - lesson-27
  - lesson-71
  - lesson-72
  - lesson-73
token_usage:
  input: 15151622
  output: 203558
  cache: 14832640
  total: 15355180
  requests: 128
  duration_ms: 4840350
  reasoning: 179540
  by_phase:
    spec:
      input: 133248
      output: 1845
      cache: 121088
      requests: 5
    plan:
      input: 12653829
      output: 105459
      cache: 12485120
      requests: 90
    prompt:
      input: 2364545
      output: 96254
      cache: 2226432
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Визуально очень сильно отличается от референса ref-2 то, как были реализованы Table и List виды для задач в VL-173.

1. Общая шапка сейчас задаётся шириной контента страницы, поэтому в частности на канбан-доске кнопки справа уходят в невидимую область. Общая шапка должна быть всегда по ширине страницы и не проматываться по скроллу. Этот пункт глобально ко всем страницам относится.

2. Шапка на странице задачи тоже должна быть фиксированной по ширине и не зависеть от количества столбцов канбана, и тоже не должна скроллиться.

3. Переключение вида Board–List–Table выглядит иначе, чем в референсе, нужно посмотреть, правильно ли были реализованы стили.

4. Вкладка List была реализована почти как идентичная Table, хотя в референсе она даёт другое визуальное представление задач, разбитых по статусу. Необходимо детально ещё раз изучить реализацию вкладки List в референсе и максимально повторить её со всеми подходящими нам элементами (бэйджи, иконки и т.д.).

5. На вкладке Table так же нужно посмотреть, как сделаны компоненты (бэйджей, иконок, цветов и т.д.), и внедрить их.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Фаза Plan — VL-211 (синхронизация шапок и видов Board/List/Table с ref-2)

Референс: ref-2 = `backlog/references/data/next-shadcn-admin-dashboard/` (clone в worktree отсутствует, код читается из основного репо).

### Диагноз (изучено в фазе)

**П1 — общая шапка растягивается шириной контента.** Цепочка: kanban-грид `repeat(N, minmax(20rem,1fr))` → min-content N×20rem пробрасывается вверх → `SidebarInset` (`web/src/components/ui/sidebar.tsx:310–321`) как flex-item с `min-width:auto` и `overflow:visible` не сжимается ниже min-content → `AppHeader` (`web/src/components/header/app-header.tsx:22`, `w-full` внутри) растягивается → кнопки справа уходят за вьюпорт, документ скроллится по горизонтали. В ref-2 это решено в `src/app/(main)/dashboard/layout.tsx:47–56`: `SidebarInset` получает `min-w-0 overflow-x-clip`, контент-обёртка — `min-h-0 min-w-0 flex-1 overflow-x-hidden p-4…`.

**П2 — тулбар страницы задач (Board/List/Table).** Тот же корень: тулбар (`web/src/components/tasks/tasks-toolbar.tsx:135`, `shrink-0`) уже не скроллится вертикально, но его ширина наследует расширенный SidebarInset → зависит от числа колонок. Фикс П1 покрывает; отдельно проверить в браузере.

**П3 — переключатель видов.** Наш `web/src/components/ui/tabs.tsx` — старый shadcn (h-9, p-1, без `group-data-horizontal`, без правила размера svg в триггере) → иконки lucide рендерятся 24px вместо 16px, триггер выше. Ref-2: `src/components/ui/tabs.tsx` (h-8, p-[3px], `[&_svg:not([class*='size-'])]:size-4`, variant line/default).

**П4 — List.** Наш `web/src/components/tasks/tasks-list.tsx` — фактически таблица (те же колонки, что Table). Ref-2: `.../kanban/_components/kanban-list.tsx` — группы по статусам: `Collapsible` (defaultOpen) с заголовком `bg-muted/50` (StatusIcon + title + count + Flame «N high priority» + кнопки Plus/MoreVertical), строки: priority-Badge (иконка+variant), title, labels-Badge с tone-цветом, счётчик комментариев (MessageSquare), due date, аватар assignee (getInitials).

**П5 — Table.** Ref-2: `kanban-table-columns.tsx` + `kanban-table.tsx` — иконки в заголовках (`headerIcons`), статус-ячейка = иконка + Select, priority = Badge с иконкой (`task-priority.ts`: High→Flame/destructive, Medium→ChevronUp/amber, Low→Minus/slate), team = Badge с `tagTones`, sticky-заголовок `bg-background sticky top-0 z-10`. Наш `tasks-table.tsx` — голый текст.

### Файлы для изменения

| # | Файл | Что делаем |
|---|------|-----------|
| 1 | `web/src/App.tsx` | строка ~65: `<SidebarInset>` → `<SidebarInset className="min-w-0 overflow-x-clip">` (ref-2 layout.tsx:50); строка ~71–73: `<main>` добавить `min-w-0 overflow-x-hidden` к `overflow-y-auto p-2` (ref-2 content-обёртка). |
| 2 | `web/src/components/tasks/task-visuals.tsx` | **новый** модуль общей визуал-конфигурации (паттерн ref-2 `task-status.ts`/`task-priority.ts`/`tagTones` из `data.ts:13–23`): `statusIcons` — карта иконок для наших статусов (Backlog/To Do/Spec/Planned/In Progress/Review/Done/Blocked; неизвестный статус → `Circle`), `priorityBadgeConfig` (High/Medium/Low → иконка+variant+className как в ref-2 task-priority.ts), `labelTone(label)` — детерминированный tone-класс (hash label → палитра blue/emerald/fuchsia/… как tagTones). |
| 3 | `web/src/components/ui/tabs.tsx` | Обновить до стиля ref-2 `src/components/ui/tabs.tsx`: TabsRoot `group/tabs flex gap-2 data-horizontal:flex-col`, TabsList (h-8, p-[3px], variant default/line), TabsTrigger (rounded-md, `data-active:bg-background`, `[&_svg:not([class*='size-'])]:size-4`). **Сохранить** наш `TabsContent` (`min-h-0 flex-1 overflow-y-auto`) — от него зависит скролл в `task-view.tsx:104–203`. |
| 4 | `web/src/components/tasks/tasks-list.tsx` | Переписать по ref-2 `kanban-list.tsx`: пропсы `{ board: BoardState, columnOrder: string[], onTaskClick }`; на каждую колонку — `Collapsible defaultOpen`, шапка группы (statusIcon, title, count, Flame «N high priority» при >0, кнопки Plus/MoreVertical — декоративные/aria-label), строки `<li>` с кликом → `onTaskClick`: priority-Badge size-5, title (truncate) + labels-Badge `labelTone`, MessageSquare `commentsCount` (если >0), `due_date`, аватар `getInitials(assignee[0])`; пустая группа → «Нет задач»; внешний скролл `min-h-0 flex-1 overflow-y-auto`. |
| 5 | `web/src/components/kanban/kanban.tsx` | ~393: `<TasksList tasks={visibleTasks} onTaskClick={openView}/>` → передавать `board={visibleBoard}` и `columnOrder={orderedColumns}` (фильтры/поиск/сортировка владельца сохраняются). |
| 6 | `web/src/components/tasks/tasks-table.tsx` | Точечные правки по ref-2 `kanban-table-columns.tsx`: (а) заголовки колонок — иконка перед label (`headerIcons`: id→Hash/ListTodo, title→ListTodo, status→CircleCheck, priority→Flame, type→Tag, labels→Tags, milestone→Flag, updated→CalendarDays; все — из lucide-react, проверить наличие перед импортом, lesson-15); (б) ячейка Status — иконка статуса из `statusIcons` + текст; (в) Priority — `<Badge>` из `priorityBadgeConfig` (иконка+цвет); (г) Labels — `<Badge variant="secondary" className={labelTone(label)}>` вместо outline; (д) `TableHeader` → `sticky top-0 z-10 bg-background` (ref-2 kanban-table.tsx:97); (е) tabular-nums для Updated. Сортировка/пагинация/клик не трогаются. |
| 7 | `web/src/components/tasks/tasks-toolbar.tsx` | Проверить визуал после обновления tabs.tsx: классы `TabsList w-full *:data-[slot=tabs-trigger]:flex-1 sm:w-fit` (строка 148) — совместимы с новым tabs; при необходимости подправить под ref-2 kanban.tsx:117–136. |

### Порядок действий

1. `cd web && pnpm install` (worktree, lesson-6 — web/node_modules отсутствует) + `pnpm install` в корне, затем `pnpm build`.
2. Правки 1 (App.tsx — фикс шапок) → сборка.
3. Новый модуль 2 (task-visuals.tsx) → правки 6 (Table) → правки 4+5 (List) → сборка.
4. Правка 3 (tabs.tsx) → проверить `task-view.tsx` (модалка) → сборка.
5. `pnpm lint && pnpm typecheck` (в корне) и `pnpm --dir web typecheck` / `pnpm web:build`.
6. `pnpm test` (build + vitest).
7. Браузерная верификация (`vibelog browser` → chrome-devtools, дробно по lesson-27):
   - `evaluate_script`: `document.documentElement.scrollWidth === document.documentElement.clientWidth` на `#/` с ≥5 колонками; `header.getBoundingClientRect().right <= innerWidth`; ширина тулбара = ширина main (не зависит от числа колонок: сравнить при 3 и 8 статусах — можно через localStorage/конфиг не меняя, достаточно одного вида + контроль `getBoundingClientRect`).
   - Консоль чистая (lesson-16), сеть без ошибок.
   - Вкладки Board/List/Table: клик → отдельный вызов чтения DOM (lesson-25).
   - List: группы по статусам, бэйджи, счётчики; Table: иконки заголовков, бэйджи priority/status/labels, sticky-заголовок.
   - Модалка задачи (task-view) после смены tabs.tsx — табы и скролл работают.

### Как проверить (команды)

```bash
pnpm install && (cd web && pnpm install)   # worktree: lesson-6
pnpm build
pnpm --dir web typecheck && pnpm web:build
pnpm test
pnpm lint
```

### Риски

- **Обновление ui/tabs.tsx** затрагивает `task-view.tsx` (7 вкладок модалки) — сохранить наш TabsContent-класс; проверить модалку в браузере.
- **lucide-react 1.49** — иконки из ref-2 (CircleDashed, CircleEllipsis, Flame, ChevronUp, ListTodo, Tags, Flag…) могут отсутствовать — проверять наличие перед импортом (lesson-15), fallback-иконки.
- **Динамические статусы**: `statusIcons` должен покрывать дефолтный конфиг (Backlog…Blocked) и иметь fallback для пользовательских статусов.
- **Правка SidebarInset в App.tsx, а не в ui/sidebar.tsx** — чтобы shadcn-копия осталась близкой к канону (как в ref-2, где классы задаются в layout).
- Вертикальная фиксация шапки уже обеспечена (AppHeader вне scroll-контейнера main, lesson-14) — после фикса ширины отдельный sticky не нужен; при регрессии — рассмотреть `sticky top-0 z-50 bg-background` как в ref-2 (navbar-style=sticky).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 10:58
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Синхронизировать вёрстку шапок и видов Board/List/Table с референсом» (снят ведущий тег #web, прежний заголовок был обрезан и длиннее 80 символов). Тип: enhancement (улучшение существующей вёрстки веб-интерфейса). Масштаб: task. Приоритет: не определён (в исходной постановке приоритет неочевиден). Уточнено: из описания снят ведущий тег #web → label; добавлены 3 проверяемых AC (глобальная шапка на всю ширину и без скролла, включая шапку страницы задачи; переключатель Board/List/Table по образцу ref-2; вкладка List — представление по статусам из ref-2, компоненты бэйджей/иконок/цветов на Table по ref-2). Контекст: прочитана VL-173 (epic-источник реализации Table/List). Labels: web. References: ref-2 (next-shadcn-admin-dashboard) уже существовал — связан с задачей, дубликат не создавался. Вопросов нет.
---
author: @agent
created: 2026-10-29 13:11
---
Фаза plan не удалась (код выхода 1): апросов=29, payload последнего запроса=260812 байт (макс 260812), usage={"input_tokens":1766962,"output_tokens":78945,"cache_read_input_tokens":1646592,"total_tokens":1845907,"reasoning_tokens":76624} — статус возвращён к Spec.
---
author: @agent
created: 2026-10-29 13:26
---
Фаза 2 (Plan) выполнена. Тип: enhancement — план записан в VL-211. Изучено: ref-2 kanban.tsx / kanban-list.tsx / kanban-table.tsx / kanban-table-columns.tsx / task-status.ts / task-priority.ts / data.ts (tagTones) / dashboard/layout.tsx (min-w-0 overflow-x-clip у SidebarInset + overflow-x-hidden у контент-обёртки) / ui/tabs.tsx; наши App.tsx, ui/sidebar.tsx, app-header.tsx, tasks-toolbar.tsx, tasks-list.tsx, tasks-table.tsx, kanban.tsx, task-view.tsx. Диагноз: min-content kanban-грида (N×minmax(20rem,1fr)) пробрасывается до SidebarInset (flex-item с min-width:auto) → шапка/тулбар растягиваются шириной контента. План: 7 файлов (1 новый — task-visuals.tsx с statusIcons/priorityBadgeConfig/labelTone), порядок работ, команды проверки (pnpm install в web/ по lesson-6, build/typecheck/test, браузерная верификация дробно по lesson-27), 5 рисков (tabs.tsx влияет на task-view, наличие иконок lucide 1.x — lesson-15, фолбэк для динамических статусов, правка SidebarInset в App.tsx, не трогать вертикальную фиксацию lesson-14).
---
author: @agent
created: 2026-10-29 13:52
---
Фаза 3 (Code) выполнена. Изменено: web/src/App.tsx (SidebarInset min-w-0 overflow-x-clip + main min-w-0 overflow-x-hidden — шапка всегда по ширине вьюпорта, горизонтального скролла документа нет ни на одной странице), web/src/components/tasks/task-visuals.tsx (новый: statusIcons с фолбэком для динамических статусов, priorityBadgeConfig, labelTone, headerIcons, commentIcon), web/src/components/tasks/tasks-list.tsx (переписан по ref-2 kanban-list: группы по статусам Collapsible, шапка группы с иконкой/счётчиком/Flame high-priority, строки с priority-бэйджем, title, labels-бэйджами tone-цветов, счётчиком комментариев, датой, аватаром assignee), web/src/components/kanban/kanban.tsx (TasksList получает board+columnOrder), web/src/components/tasks/tasks-table.tsx (sticky-заголовок z-10 + иконки колонок, статус-ячейка с иконкой, priority-бэйдж с иконкой/цветом, labels secondary+labelTone, tabular-nums), web/src/components/ui/tabs.tsx (стиль ref-2: h-8/p-[3px], variant default/line, svg size-4 в триггере; TabsContent сохранён для task-view; h-8 и отказ от flex-1 — чтобы не сломать вкладки модалки), web/dist (пересборка). Коммит a8d801f. Проверки: pnpm build; pnpm --dir web typecheck; pnpm web:build; pnpm lint; pnpm --dir web lint; pnpm test (84 файла, 1503 passed + 7 passed); браузерная верификация (сервер :6431): док без горизонтального скролла при 8 колонках (scrollWidth==clientWidth==1280), header right<=innerWidth, тулбар 1006px при гриде min-content 2560px — ширина не зависит от столбцов; консоль чиста на всех шагах; таб List — 8 групп по статусам (Done: 199 задач/64 high priority), 201 строка, 348 бэйджей, 5 пустых групп; таб Table (#/tasks) — 8 заголовков с иконками, sticky top-0 z-10, статус-иконка, priority/labels-бэйджи (76); модалка task-view — табы рендерятся (h-8/p-3px), TabsContent overflow-y auto. Что осталось: DoD «Документация обновлена» — не закрыт (CHANGELOG/docs по регламенту пишет фаза Close); декоративные кнопки Plus/MoreVertical в шапке группы List — заглушки референса (aria-label, tabIndex=-1), действие не несут.
---
author: @agent
created: 2026-10-29 13:59
---
Фаза Close выполнена. Ветка vb/vl-211 слита в master (1 коммит a8d801f, merge без конфликтов), worktree удалена (untracked-симлинки node_modules/backlog/references/data — force), ветка удалена. Проверки после merge: pnpm build и pnpm test прошли. DoD: 1 — тесты проходят (pnpm test после слияния), 2 — документация обновлена (запись в CHANGELOG.md Unreleased, коммит 35a1982), 3 — нет регрессий (сборка + тесты + браузерная верификация в Code). Lessons: lesson-72 (min-w-0/overflow-x-clip на SidebarInset в layout), lesson-73 (сохранение локальных переопределений при обновлении shadcn-компонента), refs/lessons закоммичены (72e7524). Декоративные кнопки Plus/MoreVertical в шапке группы List — заглушки референса, оставлены осознанно.
---
<!-- COMMENTS:END -->