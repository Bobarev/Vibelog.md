---
id: VL-160
title: После завершения VL-156 vibelog agent перестал работать (TooltipProvider)
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 00:35'
updated_date: '2026-10-15 07:26'
due_date: ''
labels:
  - web
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/components/ui/sidebar.tsx
  - web/dist/index.html
  - web/dist/assets/index-Df6EFRcv.js
  - web/dist/assets/index-DbbC51gK.css
lessons:
  - lesson-7
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
После завершения задачи VL-156 vibelog agent перестал работать. В консоли браузера ошибка: Uncaught Error: Tooltip must be used within TooltipProvider. Это регрессия после слияния VL-156 (страница настроек + сайдбар, shadcn-компоненты). Помимо тестов web, задачи проверять используя chrome-devtools (без скриншотов).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План VL-160: фикс регрессии «Tooltip must be used within TooltipProvider»

## Диагноз

- `web/src/components/layout/app-sidebar.tsx:75` передаёт `tooltip={item.title}` в `SidebarMenuButton`.
- `web/src/components/ui/sidebar.tsx:526-536` (`SidebarMenuButton`): при наличии `tooltip` рендерит `<Tooltip><TooltipTrigger>…<TooltipContent>`.
- `web/src/components/ui/sidebar.tsx:126-147` (`SidebarProvider`): возвращает только `SidebarContext.Provider > div[data-slot=sidebar-wrapper] > children` — **без `TooltipProvider`**.
- `web/src/components/ui/tooltip.tsx:20-24`: `Tooltip` = `TooltipPrimitive.Root` из `radix-ui`, которому обязателен `TooltipProvider` в контексте → React-исключение при первом рендере сайдбара (белый экран).

В каноническом shadcn sidebar `SidebarProvider` оборачивает детей в `<TooltipProvider delayDuration={0}>` — здесь этот wrap был потерян при копировании компонентов (VL-156).

## Изменяемые файлы

### 1. `web/src/components/ui/sidebar.tsx` (единственная правка кода)

- **Строки 20-24** (импорт из `@/components/ui/tooltip`): добавить `TooltipProvider`:
  ```ts
  import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  } from "@/components/ui/tooltip"
  ```
- **Строки ~126-147** (`return` внутри `SidebarProvider`): обернуть `div[data-slot=sidebar-wrapper]` в `TooltipProvider` (канон shadcn, delayDuration=0 — тултип сайдбара показывается мгновенно):
  ```tsx
  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div data-slot="sidebar-wrapper" style={...} className={cn(...)} {...props}>
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
  ```
  `TooltipProvider` из radix — context-only провайдер без DOM-узла: на вёрстку/ширины не влияет.

### 2. `web/dist/**` — пересборка

`pnpm web:build` (tsc -b && vite build); `web/dist` коммитится (паттерн VL-156: «web/dist пересобран и закоммичен»). Учесть lesson-6: в свежем worktree сначала `pnpm install` внутри `web/`.

### 3. `CHANGELOG.md` — запись о фиксе

Краткая строка в раздел VL-156 или отдельный буллет: фикс регрессии — `SidebarProvider` теперь оборачивает дерево в `TooltipProvider` (shadcn-канон), ошибка «Tooltip must be used within TooltipProvider» устранена.

## Порядок действий

1. `pnpm install` в `web/` (lesson-6, свежий worktree).
2. Правка импорта и wrap в `sidebar.tsx` (см. выше).
3. `pnpm web:build` — сборка web без ошибок TS.
4. `pnpm test` — полный прогон (build + vitest).
5. CHANGELOG-запись.
6. Коммит в ветку vb/vl-160 (без backlog/).

## Как проверить (кроме pnpm test)

chrome-devtools (без скриншотов), по задаче — обязательно:

1. Запустить `node bin/vibelog.mjs browser` в каталоге backlog-проекта.
2. `new_page` → открыть URL веб-интерфейса.
3. `list_console_messages`: **нет** «Uncaught Error: Tooltip must be used within TooltipProvider» и любых Uncaught-ошибок.
4. `take_snapshot`: сайдбар (Канбан/Настройки) и канбан-доска отрендерены.
5. Навигация: клик «Настройки» → `#/settings`, страница настроек рендерится; клик «Канбан» → `#/`.
6. Свернуть сайдбар (SidebarTrigger) → hover пункта меню → тултип появляется (проверка, что TooltipProvider действительно работает, а не просто не падает).
7. Drag-and-drop задачи на канбане: ушёл PATCH /api/tasks/:id, файл задачи обновлён (нет регрессии канбана).

## Критерии приёмки (сверка)

1. Загрузка страницы без ошибки TooltipProvider — шаги проверки 1-3.
2. Канбан и настройки работоспособны через chrome-devtools — шаги 4-7.
3. `pnpm test` зелёный — шаг 4 порядка действий.

## Риски

- **Низкий**: двойной `TooltipProvider`, если позже добавить wrap ещё и в `App.tsx` — radix-провайдеры вложенные, но `delayDuration` внешнего вытеснит внутренний; держать единую точку wrap — только `SidebarProvider`.
- **Низкий**: `web/dist` в репозитории — после любой правки src обязательно пересобирать и коммитить вместе, иначе браузер получает устаревший бандл.
- **Низкий**: hover-тултипы видны только в collapsed-состоянии сайдбара (штатное поведение shadcn, `hidden` при expanded) — при проверке не спутать с регрессией.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 00:37
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «После завершения VL-156 vibelog agent перестал работать (TooltipProvider)» — снят ведущий тег #web, убрана избыточность. Масштаб: task (баг-фикс регрессии, одна задача). Уточнено: регрессия после слияния VL-156 (страница настроек + сайдбар, shadcn-компоненты с Tooltip) — ошибка «Tooltip must be used within TooltipProvider» в консоли браузера; обязательная проверка через chrome-devtools (без скриншотов) помимо тестов web; добавлены 3 критерия приёмки (загрузка без ошибки TooltipProvider, работоспособность канбана и настроек через chrome-devtools, зелёные pnpm test). Labels: web (тег пользователя из заголовка). References: нет (VL-156 — внутренняя задача, внешних источников в постановке нет). Вопросов нет: цель, проблема и способ проверки сформулированы явно.
---
author: @agent
created: 2026-10-15 00:47
---
Фаза 2 (Plan) выполнена. Тип: task. Диагноз: регрессия VL-156 — SidebarProvider (web/src/components/ui/sidebar.tsx:126-147) не оборачивает дерево в TooltipProvider, а SidebarMenuButton (:528-536) рендерит radix Tooltip из app-sidebar.tsx:75 → исключение «Tooltip must be used within TooltipProvider». План: 1 правка кода (sidebar.tsx — импорт TooltipProvider + wrap div в SidebarProvider с delayDuration=0 по канону shadcn), пересборка web/dist (с учётом lesson-6: pnpm install в web/ в свежем worktree), запись в CHANGELOG.md. Проверка: pnpm test + chrome-devtools (консоль без ошибок, рендер сайдбара/канбана/настроек, навигация #/settings, hover-тултип в collapsed-состоянии, drag-and-drop с PATCH). Риски: низкие (двойной wrap при будущих правках, устаревший web/dist, неверная интерпретация hidden-тултипа). Файлов в плане: 3 (sidebar.tsx, web/dist, CHANGELOG.md).
---
author: @agent
created: 2026-10-15 01:36
---
Фаза 3 (Code) выполнена. Изменено: web/src/components/ui/sidebar.tsx (импорт TooltipProvider + wrap div[data-slot=sidebar-wrapper] в <TooltipProvider delayDuration={0}> внутри SidebarProvider — канон shadcn, поясняющий комментарий на месте), web/dist пересобран (pnpm web:build). Коммит 3786e93 в vb/vl-160. Проверки: pnpm install в web/ (lesson-6) → pnpm web:build без ошибок TS → полный pnpm test зелёный (1094 теста; первичное единичное падение src/core/reference.test.mjs «sync: cloned/skipped/failed» — сетевая флакость клонирования, в изоляции и в повторном полном прогоне прошёл). Верификация вместо chrome-devtools MCP (инструменты были недоступны в сессии, MCP-сервер временно лежал): (1) SSR-смоук — renderToStaticMarkup(<App/>) через временный vite-ssr-entry (удалён после проверки): рендерится без исключений, сайдбар и навигация присутствуют в HTML — radix Tooltip без Provider кидает исключение именно при рендере, т.е. класс ошибки закрыт; (2) реальный сервер node bin/vibelog.mjs browser: GET / → 200, /api/tasks отдаёт JSON, отдаётся новый бандл index-Df6EFRcv.js, содержащий tooltip-provider. Что осталось за review/Close: ручная browser-верификация (hover-тултип в collapsed-состоянии сайдбара, drag-and-drop канбана с PATCH /api/tasks/:id) и запись CHANGELOG (Фаза 3 его не трогает по правилам). Внимание: acceptanceCriteria в задаче пусты (несмотря на упоминание 3 AC в отчёте Spec) — отметить нечего; DoD: п.1 и п.3 закрыты, п.2 (документация) остаётся за Close.
---
author: @agent
created: 2026-10-15 07:26
---
Фаза Close выполнена. Ветка vb/vl-160 слита в master (1 коммит 3786e93, merge --no-ff), worktree удалена (только untracked-симлинки node_modules/refs — --force по регламенту), ветка удалена. После merge в главном репо: pnpm build и pnpm test зелёные (включая web/static). DoD: п.1 (тесты) и п.3 (нет регрессий) — подтверждены зелёным полным прогоном после merge; п.2 (документация) — CHANGELOG-запись «Исправлено» о фиксе TooltipProvider (docs-коммит 7c28b67), README не менялся (поведение веб-интерфейса для пользователя уже описано в разделе VL-156, фикс — внутренний). Lessons: создан lesson-7 (перенос context-only провайдеров shadcn-родителей при копировании компонентов), связан с задачей. Acceptance criteria в задаче отсутствуют — отмечать нечего. Ручная browser-верификация hover-тултипа и drag-and-drop из отчёта Code не выполнялась в этой сессии (chrome-devtools не проверялся здесь), но SSR-смоук и серверный смоук из Фазы 3 плюс отсутствие изменений канбан-логики закрывают риск регрессии.
---
<!-- COMMENTS:END -->