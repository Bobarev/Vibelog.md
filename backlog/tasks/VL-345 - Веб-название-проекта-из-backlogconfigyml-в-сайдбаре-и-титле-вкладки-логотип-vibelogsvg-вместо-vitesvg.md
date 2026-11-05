---
id: VL-345
title: 'Веб: название проекта из backlog/config.yml в сайдбаре и титле вкладки, логотип vibelog.svg вместо vite.svg'
status: In Progress
assignee: []
reporter: ''
created_date: '2026-11-05 16:30'
updated_date: '2026-11-05 19:05'
due_date: ''
labels:
  - web
  - ui
  - ux
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/index.html
  - web/public/vibelog.svg
  - web/public/vite.svg
  - web/src/App.tsx
  - web/src/components/config/config-page.tsx
  - web/src/components/kanban/api.ts
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/tasks/api.ts
  - web/src/lib/project-config.ts
  - web/src/lib/use-project-name.ts
  - web/dist/index.html
  - web/dist/vibelog.svg
  - web/dist/vite.svg
  - web/dist/assets/index-BjLiPeNz.css
  - web/dist/assets/index-CweTpgD9.js
lessons: []
token_usage:
  input: 6789915
  output: 69883
  cache: 6551040
  total: 6859798
  requests: 140
  duration_ms: 2156028
  reasoning: 45715
  by_phase:
    code:
      input: 4233445
      output: 57707
      cache: 4070912
      requests: 79
    close:
      input: 2556470
      output: 12176
      cache: 2480128
      requests: 61
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено пользователем: при нескольких открытых проектах веб-интерфейс не показывает, к какому проекту он относится — в сайдбаре всегда «Vibelog», во вкладке браузера «vite-app», favicon — логотип Vite.

**Что сейчас в коде:**

- `web/src/components/layout/app-sidebar.tsx` — жёстко зашито `<Command />` (иконка lucide ⌘, скопирована из референса next-shadcn-admin-dashboard) и `<span>Vibelog</span>`. Ни иконка, ни текст не связаны с проектом.
- `web/index.html` — `<title>vite-app</title>` и `<link rel="icon" href="/vite.svg">`; `web/public/vite.svg` — дефолтный логотип Vite из шаблона `npm create vite`, никогда не менялся.
- `GET /api/config` (`src/web/api.ts:279`) **уже отдаёт** `project_name` из `backlog/config.yml`, но фронт его не читает: `web/src/components/config/api.ts` и `web/src/components/kanban/api.ts` берут только `statuses`/`priorities`/`types`. Бэкенд готов, нужен только фронт.

**Что нужно:** вывести `project_name` в сайдбар и в `document.title`, заменить favicon и иконку сайдбара на логотип Vibelog (`web/public/vibelog.svg` — уже добавлен пользователем, чёрный глиф на прозрачном фоне, viewBox 228×290).

**Границы:** серверная подстановка `<title>` в `index.html` НЕ делается (решение пользователя) — только статичный титл в `index.html` + установка `document.title` на клиенте после загрузки конфига. Бэкенд не меняется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В сайдбаре вместо литерала `Vibelog` выводится `project_name` из `backlog/config.yml` (через `GET /api/config`)
- [x] #2 `document.title` устанавливается в `project_name` после загрузки конфига; при недоступности API остаётся статичный титл из `index.html`
- [x] #3 `web/index.html`: `<title>vite-app</title>` заменён на `<title>Vibelog</title>`, `<link rel="icon">` указывает на `/vibelog.svg`
- [x] #4 `web/public/vite.svg` удалён; `web/public/vibelog.svg` используется как favicon и как иконка в сайдбаре
- [x] #5 `vibelog.svg` использует `fill="currentColor"` (уже сделано) — иконка наследует цвет текста, отдельная версия для тёмной темы и `dark:invert` не нужны
- [x] #6 Иконка в сайдбаре: `<img src="/vibelog.svg">` вместо `<Command />` из lucide-react; размер `size-6` (24 px, как у lucide-иконок в `SidebarMenuButton`), при свёрнутом сайдбаре иконка остаётся видимой
- [x] #7 Иконка видна и читаема в светлой и тёмной теме (проверить обе через chrome-devtools)
- [x] #8 Длинное `project_name` не ломает вёрстку: обрезка через `truncate` + `title`-атрибут с полным именем
- [x] #9 Название проекта читается один раз при монтировании (не на каждый рендер) и не дублирует запросы: используется существующий `GET /api/config` либо общий хук/контекст конфига
- [x] #10 При пустом `project_name` в конфиге — fallback на `Vibelog` (не пустая строка в сайдбаре и титле)
- [x] #11 Тест: `web`-сборка проходит (`pnpm --dir web build`), титл и иконка присутствуют в собранном `index.html`
- [x] #12 Ручная проверка через chrome-devtools: титл вкладки = имя проекта, иконка в сайдбаре и favicon — лого Vibelog, консоль без ошибок
- [x] #13 `web/dist` пересобран и закоммичен (как в VL-163/VL-210)
- [ ] #14 CHANGELOG.md обновлён, doc-6 (руководство пользователя, раздел веб-интерфейса) дополнен
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

- `web/index.html` — титл и favicon.
- `web/public/vibelog.svg` — **уже подготовлен**: `fill="currentColor"`, без `width`/`height` в `pt`, без мусора Inkscape (1713 байт).
- `web/public/vite.svg` — удалить.
- `web/src/components/layout/app-sidebar.tsx` — иконка и название.
- `web/src/lib/` — хук конфига проекта (новый или расширение существующего).
- `web/dist/` — пересобрать.
- `doc-6`, `CHANGELOG.md`.

## Шаг 1. `web/index.html`

```html
<link rel="icon" type="image/svg+xml" href="/vibelog.svg" />
<title>Vibelog</title>
```

Статичный титл — fallback на случай, если API недоступен (решение: серверную подстановку не делаем).

## Шаг 2. Доступ к `project_name` на фронте

`GET /api/config` уже возвращает `project_name` (проверено: `src/web/api.ts:279`, `{ ...config, initialStatus }`). Варианты:

- **A (предпочтительно):** новый хук `web/src/lib/use-project-name.ts` — один `fetch('/api/config')` при монтировании, `useState<string | null>`, fallback `'Vibelog'`. Просто, без нового контекста.
- **B:** расширить существующий `web/src/components/config/api.ts` (`fetchConfig`) и поднять контекст в `App.tsx`. Тяжелее, но переиспользуемо для будущих полей.

Начать с A: задача узкая, контекст ради одного поля — лишняя связность. Если в `App.tsx` уже есть подходящий провайдер (`PreferencesProvider`) — проверить, не логичнее ли положить туда.

## Шаг 3. Титл

В `App.tsx` (или в хуке):

```tsx
useEffect(() => {
  if (projectName) document.title = projectName;
}, [projectName]);
```

Не перезаписывать титл, если `projectName` пустой — остаётся статичный `Vibelog` из `index.html`.

## Шаг 4. Сайдбар

`web/src/components/layout/app-sidebar.tsx`, `SidebarHeader`:

```tsx
<a href="#/">
  <img src="/vibelog.svg" alt="" className="size-6 shrink-0" />
  <span className="truncate font-semibold text-base" title={projectName}>{projectName}</span>
</a>
```

- `size-6` — совпадает с размером lucide-иконок в `SidebarMenuButton` (24 px), иначе строка «прыгнет» по высоте.
- `truncate` + `title` — длинное имя проекта не ломает вёрстку.
- При свёрнутом сайдбаре (`collapsible="icon"`) `SidebarMenuButton` скрывает `span` сам — иконка остаётся, проверить визуально.
- `alt=""` — декоративная иконка рядом с текстом (a11y: не дублировать имя проекта для скринридера).

**Цвет:** `vibelog.svg` уже переведён на `fill="currentColor"` — иконка наследует цвет текста, `dark:invert` и вторая версия файла не нужны. Проверить обе темы визуально.

**Нюанс:** третий путь (загнутый уголок) имеет `opacity:0.2` — в тёмной теме на тёмном фоне почти невидим. Если деталь важна — поднять до `0.35` или убрать.

## Шаг 5. Удалить `vite.svg`

`rm web/public/vite.svg` (write-операция с подтверждением). Проверить, что на него нет ссылок: `search_files` по `vite.svg` в `web/`.

## Шаг 6. Сборка и проверка

- `pnpm --dir web build` — `web/dist/index.html` содержит `<title>Vibelog</title>` и `/vibelog.svg`.
- `web/dist` закоммитить (как в VL-163/VL-210 — собранный фронт лежит в репозитории).
- Ручная проверка через chrome-devtools: титл вкладки = `Vibelog.md` (значение из `backlog/config.yml`), иконка в сайдбаре и favicon — лого Vibelog, `list_console_messages` без ошибок (lesson-16).
- Проверить светлую и тёмную тему: иконка видна в обеих.

## Риски

- **Полупрозрачный уголок в тёмной теме** — см. шаг 4.
- **Лишний запрос `/api/config`** — если хук добавляет второй вызов рядом с существующими (`kanban/api.ts`, `tasks/api.ts` уже дергают `/api/config`). Приемлемо (один раз при монтировании), но если хочется чисто — поднять общий кэш/контекст.
- **`web/dist` в git** — не забыть пересобрать, иначе в браузере останется старый титл (частая причина «я поправил, а не работает»).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 16:55
---
Фаза 3 (Code) выполнена. Коммит 37cb01f.
**Изменено:**
- `web/index.html` — `<title>Vibelog</title>`, favicon `/vibelog.svg`.
- `web/public/vibelog.svg` — добавлен (viewBox 228×290, `fill="currentColor"`, уголок `opacity=0.35`); `web/public/vite.svg` удалён.
- `web/src/lib/project-config.ts` (новый) — общий кэш промиса `GET /api/config` + `resetProjectConfigCache()`.
- `web/src/lib/use-project-name.ts` (новый) — `useProjectName()` с fallback `Vibelog` (пустое/нестроковое `project_name` → fallback).
- `web/src/components/layout/app-sidebar.tsx` — иконка `Command` заменена логотипом, имя проекта с `truncate` + `title`.
- `web/src/App.tsx` — `document.title = projectName` в `useEffect` после загрузки конфига.
- `web/src/components/kanban/api.ts`, `web/src/components/tasks/api.ts` — конфиг через общий кэш (было 2 запроса `/api/config` на загрузку, стало 1).
- `web/src/components/config/config-page.tsx` — сброс кэша конфига после сохранения (имя проекта могло измениться).
- `web/dist/` пересобран и закоммичен.
**Отклонение от плана (важно):** в сайдбаре не `<img src="/vibelog.svg">`, а `<span>` с CSS-маской `[mask:url(/vibelog.svg)_center/contain_no-repeat]` + `bg-current`. Причина: во внешнем SVG (через `<img>`) `currentColor` НЕ наследует цвет текста — Chrome резолвит его в чёрный (проверено рендером в canvas: центр глифа `[0,0,0,255]`), и в тёмной теме иконка была бы чёрной на тёмном фоне. Маска даёт ровно тот же результат, что задумывался (`fill="currentColor"` → цвет текста), без второй версии файла и без `dark:invert`. Размер `size-6` (24 px), при `collapsible=icon` иконка остаётся видимой.
**Проверки:**
- `pnpm --dir web build` — успешно; `web/dist/index.html` содержит `<title>Vibelog</title>` и `/vibelog.svg`.
- Полный `pnpm test` — 180 файлов / 3413 тестов passed, 4 skipped (исключений и `--skip` не было).
- chrome-devtools на `vibelog browser` (порт 5399): `document.title` = `Vibelog.md` (значение из `backlog/config.yml`), favicon `/vibelog.svg`, иконка 24×24, `title`-атрибут = полное имя; светлая тема — `oklch(0.145 0 0)`, тёмная — `oklch(0.985 0 0)` (иконка читаема в обеих); свёрнутый сайдбар — иконка видна, `span` шириной 0; длинное имя обрезается (`text-overflow: ellipsis`), вёрстка не ломается; консоль без сообщений; сеть — один `GET /api/config` на загрузку.
- Fallback проверен подменой `fetch`: при отказе API титл и сайдбар = `Vibelog`; при `project_name: "   "` — тоже `Vibelog`.
**Что осталось:** AC 14 (CHANGELOG.md + doc-6) — по правилам фазы 3 документацию пишет Фаза Close. DoD «Документация обновлена» поэтому не отмечен.
---
author: @agent
created: 2026-11-05 17:51
---
Фаза close не удалась (код выхода 1): блокировок=0, payload последнего запроса=192154 байт (макс 192154), usage={"input_tokens":1247602,"output_tokens":5264,"cache_read_input_tokens":1217024,"total_tokens":1252866,"reasoning_tokens":2539} — статус возвращён к Review.
---
author: @agent
created: 2026-11-05 17:56
---
Фаза close не удалась (код выхода 1): 2, блокировок=0, payload последнего запроса=204947 байт (макс 204947), usage={"input_tokens":755377,"output_tokens":4624,"cache_read_input_tokens":727040,"total_tokens":760001,"reasoning_tokens":2077} — статус возвращён к Review.
---
<!-- COMMENTS:END -->