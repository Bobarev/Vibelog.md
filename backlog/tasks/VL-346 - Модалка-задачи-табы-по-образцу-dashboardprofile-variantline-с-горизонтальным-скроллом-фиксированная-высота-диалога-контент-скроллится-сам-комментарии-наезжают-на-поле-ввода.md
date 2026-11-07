---
id: VL-346
title: 'Модалка задачи: табы по образцу dashboard/profile — variant=line с горизонтальным скроллом, фиксированная высота диалога, контент скроллится сам (комментарии наезжают на поле ввода)'
status: Review
assignee: []
reporter: ''
created_date: '2026-11-05 18:55'
updated_date: '2026-11-07 15:58'
due_date: ''
labels:
  - web
  - ui
  - ux
  - bug
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/components/ui/tabs.tsx
  - web/src/components/task-modal/task-view.tsx
  - web/src/components/task-modal/task-modal.tsx
  - web/dist/index.html
  - web/dist/assets/index-B-Zv2tWQ.css
  - web/dist/assets/index-DOpdBDuK.js
lessons: []
token_usage:
  input: 11142049
  output: 64289
  cache: 10682880
  total: 11206338
  requests: 226
  duration_ms: 1981196
  reasoning: 32646
  by_phase:
    code:
      input: 4356001
      output: 28510
      cache: 4134912
      requests: 73
    close:
      input: 6786048
      output: 35779
      cache: 6547968
      requests: 153
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено пользователем: в модалке просмотра задачи переключатель секций выглядит плохо, а при большом числе секций блок комментариев «съезжает» на контент ниже.

**Причина 1 — вёрстка табов.** `web/src/components/task-modal/task-view.tsx` навешивает на `TabsList` класс `h-auto flex-wrap justify-start` поверх пилюли `bg-muted h-8 p-[3px]` из `web/src/components/ui/tabs.tsx`. При 7–8 вкладках (Описание, Acceptance Criteria, Definition of Done, Implementation Plan, Implementation Notes, Final Summary, Токены, Комментарии) пилюля ломается на 2–3 строки, `TabsTrigger` с `h-[calc(100%-1px)]` даёт разную высоту строк, `rounded-lg` на многострочном блоке выглядит случайно.

**Причина 2 — наложение контента.** `DialogContent` (`web/src/components/ui/dialog.tsx`) — `grid` с `max-h-[calc(100%-2rem)] overflow-y-auto`, то есть скроллится весь диалог. `TabsContent` при этом имеет `min-h-0 flex-1 overflow-y-auto` (`tabs.tsx:110`), но `flex-1` внутри контейнера без заданной высоты не создаёт скролл-область: контент растягивает родителя. Поле комментария стоит после `<Tabs>`, поэтому при длинной секции оно уезжает и визуально перекрывается.

**Как в референсе.** `backlog/references/data/next-shadcn-admin-dashboard/src/app/(main)/dashboard/profile/page.tsx`:

```tsx
<Tabs className="min-h-0 flex-1 gap-0" defaultValue="overview">
  <div className="touch-pan-x scrollbar-none overflow-x-auto overscroll-x-contain border-y">
    <TabsList className="w-max min-w-full justify-start gap-4 px-4 *:data-[slot=tabs-trigger]:flex-none" variant="line">
```

Четыре приёма, которых у нас нет: `variant="line"` (подчёркивание вместо пилюли — уже реализовано в `tabs.tsx`, но не используется), горизонтальный скролл вместо переноса, `border-y` на всю ширину, `gap-0` + `min-h-0 flex-1` для реальной скролл-области. Плюс `ProfileHeader` — заголовок с бейджами вынесен отдельным блоком над табами.

**Цель:** привести модалку задачи к этой композиции — табы-подчёркивания со скроллом, фиксированная высота диалога, скроллится только контент вкладки, поле комментария и кнопки всегда на месте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Табы модалки используют `variant="line"` (подчёркивание активной вкладки) вместо пилюли `bg-muted`
- [x] #2 Вкладки не переносятся на вторую строку: `TabsList` обёрнут в контейнер с `overflow-x-auto` + `w-max min-w-full` + `*:data-[slot=tabs-trigger]:flex-none`, при нехватке ширины — горизонтальный скролл
- [x] #3 Под вкладками линия на всю ширину (`border-y` на контейнере), а не пилюля по содержимому
- [x] #4 `Tabs` получает `gap-0` и `min-h-0 flex-1`; `TabsContent` — единственный скролл-контейнер, поле комментария и футер с кнопками всегда видны и не перекрываются контентом
- [x] #5 `DialogContent` модалки задачи имеет фиксированную высоту (`h-[calc(100%-2rem)]` или `max-h` + `flex flex-col`), а не `overflow-y-auto` на всём диалоге — скроллится только область контента вкладки
- [x] #6 При 8 вкладках (Описание, AC, DoD, Plan, Notes, Final Summary, Токены, Комментарии) и длинной секции комментариев вёрстка не ломается: поле «Комментарий» и кнопки фаз остаются на месте
- [x] #7 Заголовок задачи (title + ID + статус + приоритет + метки) оформлен отдельным блоком над табами по образцу `ProfileHeader` из референса: заголовок крупнее, бейджи в одну строку с переносом, без нагромождения в `DialogDescription`
- [x] #8 Проверено на узком экране (мобильная ширина): вкладки скроллятся горизонтально, контент читаем, кнопки футера переносятся корректно
- [x] #9 Светлая и тёмная тема: активная вкладка (подчёркивание) и границы видны в обеих
- [x] #10 `pnpm --dir web build` проходит, `web/dist` пересобран и закоммичен
- [x] #11 Ручная проверка через chrome-devtools: открыть задачу с большим числом секций (например VL-299 или VL-210), переключить все вкладки, консоль без ошибок (lesson-16)
- [ ] #12 CHANGELOG.md обновлён
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `web/src/components/task-modal/task-view.tsx` — композиция табов.
- `web/src/components/task-modal/task-modal.tsx` — `DialogContent` (высота, flex-структура), заголовок.
- `web/src/components/ui/tabs.tsx` — возможно, ничего (variant=line уже есть); проверить, что `TabsContent` не конфликтует.
- `web/dist` — пересобрать.
- `CHANGELOG.md`.

## Шаг 1. `DialogContent` — фиксированная высота и flex-структура

Сейчас: `className="max-h-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl"` — скроллится весь диалог.

Нужно:

```tsx
<DialogContent className="flex h-[calc(100%-2rem)] max-h-[calc(100%-2rem)] flex-col gap-4 overflow-hidden sm:max-w-2xl">
```

- `flex flex-col` + `overflow-hidden` — диалог не скроллится сам, скролл уходит внутрь.
- `h-[calc(100%-2rem)]` — фиксированная высота (не «по контенту»), иначе `flex-1` внутри не работает.
- Для режимов create/edit высота «по контенту» удобнее — проверить: если форма короткая, `h-` даст пустое место. Вариант: применять `h-` только в `internalMode === 'view'`, а в create/edit оставить `max-h-` + `overflow-y-auto`. Решение зафиксировать в отчёте.

## Шаг 2. Заголовок по образцу `ProfileHeader`

`ProfileHeader` (референс) — отдельный блок над табами: крупный заголовок, под ним строка метаданных, бейджи в `flex flex-wrap gap-2`.

Сейчас в `task-modal.tsx` заголовок задачи засунут в `DialogDescription asChild` с `flex flex-wrap items-center gap-2` — бейджи вперемешку с ID и сроком.

Переделать:

```tsx
<DialogHeader className="shrink-0">
  <DialogTitle className="truncate text-xl leading-6 font-semibold tracking-tight">{task.title}</DialogTitle>
  <DialogDescription asChild>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono text-xs">{task.id}</span>
      <Badge variant="secondary">{task.status}</Badge>
      <Badge variant={...}>{task.priority}</Badge>
      {task.due_date ? <span className="text-muted-foreground">срок: {task.due_date}</span> : null}
      {task.labels.map(...)}
    </div>
  </DialogDescription>
</DialogHeader>
```

`shrink-0` — заголовок не сжимается при длинном контенте.

## Шаг 3. Табы — композиция из референса

`task-view.tsx`, заменить блок `<Tabs>`:

```tsx
<Tabs defaultValue="description" className="flex min-h-0 flex-1 flex-col gap-0">
  <div className="shrink-0 touch-pan-x overflow-x-auto overscroll-x-contain border-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <TabsList
      variant="line"
      className="w-max min-w-full justify-start gap-4 px-1 *:data-[slot=tabs-trigger]:flex-none"
    >
      ...TabsTrigger...
    </TabsList>
  </div>
  <div className="min-h-0 flex-1 overflow-y-auto pt-3">
    ...TabsContent...
  </div>
</Tabs>
```

Ключевые отличия от текущего:

- `variant="line"` — подчёркивание (псевдоэлемент `after:` уже реализован в `tabs.tsx`, включая `group-data-[variant=line]/tabs-list:data-active:after:opacity-100`).
- `overflow-x-auto` + `w-max min-w-full` + `*:flex-none` — вкладки в одну строку, при нехватке ширины скролл.
- `border-y` на обёртке — линия на всю ширину.
- `gap-0` на `Tabs` + `min-h-0 flex-1` — контент получает реальную высоту.
- `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` — скрыть полосу прокрутки у самих табов (в референсе это `scrollbar-none`, у нас такого класса нет — проверить `web/src/index.css`, возможно, стоит добавить утилиту).

**Важно:** `TabsContent` в `tabs.tsx` уже имеет `min-h-0 flex-1 overflow-y-auto`. Если обернуть контент в свой `div` со скроллом, получится двойной скролл. Выбрать одно: либо скролл на `TabsContent` (тогда обёртка не нужна, но `Tabs` должен быть `flex flex-col` с высотой), либо на обёртке (тогда `TabsContent` оставить без `flex-1`). Предпочтительно первое — меньше правок в `tabs.tsx`.

## Шаг 4. Поле комментария и футер

`TaskView` возвращает `div.flex.min-h-0.flex-col.gap-3` с `<Tabs>` и полем комментария. При новой структуре:

- `div` → `flex min-h-0 flex-1 flex-col gap-3` (занимает всё доступное место).
- `<Tabs>` → `min-h-0 flex-1` (растягивается).
- Поле комментария → `shrink-0` (не сжимается, всегда внизу).

`DialogFooter` в `task-modal.tsx` — добавить `shrink-0`, чтобы кнопки не уезжали.

## Шаг 5. Проверка

- `pnpm --dir web build`, `web/dist` закоммитить.
- chrome-devtools: открыть задачу с максимумом секций (VL-299 — есть AC, DoD, Plan, Notes, токены; VL-210 — большой Plan), переключить все вкладки.
- Проверить: поле «Комментарий» и кнопки фаз видны всегда, контент скроллится внутри, вкладки в одну строку.
- Узкий экран (375 px): вкладки скроллятся, ничего не ломается.
- Светлая/тёмная тема: подчёркивание активной вкладки видно.
- `list_console_messages` без ошибок (lesson-16).

## Риски

- **Двойной скролл** — см. шаг 3, выбрать одну точку скролла.
- **`h-[calc(100%-2rem)]` в create/edit** — короткая форма получит пустое место; применить высоту только для view-режима.
- **`scrollbar-none`** — утилиты может не быть в нашем CSS; проверить `web/src/index.css`, при отсутствии использовать `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`.
- **`variant="line"` и `border-y`** — двойная линия (граница контейнера + подчёркивание активной вкладки). В референсе так и есть, но проверить визуально: возможно, `border-b` достаточно.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 12:26
---
Фаза 3 (Code) выполнена. Коммит 5781d99.
**Изменено (4 файла кода + web/dist):**
- `web/src/components/ui/tabs.tsx` — добавлен индикатор variant="line", которого не было: строка классов `after:absolute after:bg-foreground after:opacity-0 group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 … group-data-[variant=line]/tabs-list:data-active:after:opacity-100` (перенос из ref-2). Без неё `variant="line"` был объявлен, но визуально ничем не отличался. Локальное переопределение `TabsContent` (`min-h-0 flex-1 overflow-y-auto`) сохранено — это единственная точка скролла (lesson-73).
- `web/src/components/task-modal/task-view.tsx` — корень `flex min-h-0 flex-1 flex-col gap-3`; `<Tabs className="min-h-0 flex-1 gap-0">`; `TabsList` в обёртке `shrink-0 touch-pan-x overflow-x-auto overscroll-x-contain border-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`; `TabsList variant="line" className="w-max min-w-full justify-start gap-4 px-1 *:data-[slot=tabs-trigger]:flex-none"`; всем `TabsContent` добавлен `pt-3`; поле комментария и индикатор загрузки — `shrink-0`.
- `web/src/components/task-modal/task-modal.tsx` — `DialogContent` в view-режиме `flex h-[calc(100%-2rem)] max-h-[calc(100%-2rem)] flex-col gap-4 overflow-hidden sm:max-w-2xl` (create/edit оставлены как были: `max-h-… overflow-y-auto`, чтобы короткая форма не получала пустое место); `DialogHeader` — `shrink-0`, `DialogTitle` — `truncate text-xl leading-6 font-semibold tracking-tight`, метаданные отдельной строкой с переносом (ID, статус, приоритет, срок, метки) по образцу ProfileHeader; `DialogFooter` и блок ошибки — `shrink-0`.
- `web/dist` пересобран (`pnpm --dir web build`), старые ассеты удалены, новые закоммичены.
**Решение по рискам плана:** (1) одна точка скролла — `TabsContent` (обёртка контента не создавалась, двойного скролла нет); (2) фиксированная высота только в view; (3) утилиты `scrollbar-none` в CSS нет — использованы `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`, index.css не трогал; (4) `border-y` оставлен (как в референсе) — двойной линии визуально не видно, проверено.
**Проверки:**
- `pnpm --dir web build` (tsc -b + vite) — успешно; `npx eslint` по затронутым файлам — чисто.
- Полный `pnpm test` — **182 test-файла passed, 3432 теста passed, 4 skipped** (skip — существующие в проекте, прогон без --exclude/--skip-фильтров).
- chrome-devtools на реальном сервере (browser --port 3131): задача VL-196 (11.5 КБ Plan, AC/DoD/Plan/Notes/Токены/Комментарии) и VL-195. Замеры в браузере: `DialogContent` display=flex, overflowY=hidden, высота 660px; `TabsList` variant=line, высота 32px — **все 7 вкладок в одну строку**; `::after` активной вкладки opacity=1 (2px, bg=foreground), у неактивной opacity=0; обёртка overflow-x=auto, border-y=1px, scrollbar-width=none; `TabsContent` — единственный скролл-контейнер (clientH 337 vs scrollHeight 1796, у VL-196 1002); поле комментария (top 523) и футер (bottom 651) не перекрываются контентом (content bottom 478) и остаются на месте при переключении всех вкладок.
- Узкий экран 375×700 (mobile emulation, VL-195, 7 вкладок): обёртка clientW 293 / scrollW 958 → горизонтальный скролл вкладок работает, список в одну строку, контент скроллится внутри, поле и футер (112px, кнопки переносятся в 2 ряда) видны и внутри границ диалога, горизонтального переполнения диалога нет.
- Тёмная тема: подчёркивание активной вкладки видно (`oklch(0.985 0 0)`), неактивные — opacity 0; границы `oklch(1 0 0 / 0.1)` видны.
- `list_console_messages` (error/warn) — сообщений нет (lesson-16).
**Что осталось / не отмечено:**
- AC12 (CHANGELOG.md) — по правилам Фазы 3 CHANGELOG и docs не обновляются, это работа Фазы Close.
- DoD2 «Документация обновлена» — по той же причине не отмечен; DoD1 (тесты, полный прогон) и DoD3 (нет регрессий) отмечены.
---
author: @agent
created: 2026-11-07 12:26
---
Фаза Close прервана: конфликт слияния vb/vl-346 → master.
Конфликтные файлы (git status --porcelain):
- UU web/dist/index.html
- AU web/dist/assets/index-ByR3A-aC.js
- UA web/dist/assets/index-DOpdBDuK.js
- DD web/dist/assets/index-CweTpgD9.js
Причина: обе ветки (master и vb/vl-346) пересобирали `web/dist` — rename/rename одного и того же старого ассета `index-CweTpgD9.js` в разные новые имена плюс конфликт в `index.html`. Исходники (`web/src/**`) не конфликтуют — расхождение только в сгенерированных артефактах сборки.
Что нужно сделать, чтобы повторить Close (вручную, в главном репозитории):
1. Разрешить конфликт в пользу пересборки: `git checkout --ours web/dist` (или `git rm -r --cached web/dist` + удалить каталог), затем `pnpm --dir web build` и `git add web/dist`.
2. Убедиться, что `git status` не содержит UU/AU/UA/DD, и завершить merge (`git commit`).
3. Повторить Фазу Close для VL-346.
Статус задачи не менялся, DoD не отмечались, worktree `.vibelog/worktrees/vl-346` и ветка `vb/vl-346` сохранены.
---
author: @agent
created: 2026-11-07 12:27
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-346 → master.
Конфликтные файлы (git status --porcelain):
- UU web/dist/index.html
- AU web/dist/assets/index-ByR3A-aC.js
- UA web/dist/assets/index-DOpdBDuK.js
- DD web/dist/assets/index-CweTpgD9.js
Причина: обе ветки (master и vb/vl-346) пересобирали `web/dist` — rename/rename одного и того же старого ассета `index-CweTpgD9.js` в разные новые имена плюс конфликт в `index.html`. Исходники (`web/src/**`) не конфликтуют — расхождение только в сгенерир — статус возвращён к Review.
---
author: @agent
created: 2026-11-07 13:00
---
Фаза close не удалась (код выхода 1): блокировок=0, payload последнего запроса=214540 байт (макс 214540), usage={"input_tokens":1150360,"output_tokens":4972,"cache_read_input_tokens":1121280,"total_tokens":1155332,"reasoning_tokens":1830} — статус возвращён к Review.
---
author: @agent
created: 2026-11-07 15:08
---
Фаза close не удалась (код выхода 1): 2, блокировок=0, payload последнего запроса=195400 байт (макс 195400), usage={"input_tokens":818569,"output_tokens":6261,"cache_read_input_tokens":791552,"total_tokens":824830,"reasoning_tokens":4658} — статус возвращён к Review.
---
author: @agent
created: 2026-11-07 15:58
---
Фаза close не удалась (код выхода 1): блокировок=0, payload последнего запроса=186376 байт (макс 186376), usage={"input_tokens":1180655,"output_tokens":7347,"cache_read_input_tokens":1081344,"total_tokens":1188002,"reasoning_tokens":4545} — статус возвращён к Review.
---
<!-- COMMENTS:END -->