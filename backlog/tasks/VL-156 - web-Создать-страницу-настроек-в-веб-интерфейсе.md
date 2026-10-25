---
id: VL-156
title: '#web Создать страницу настроек в веб интерфейсе'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 15:04'
updated_date: '2026-10-25 23:25'
due_date: ''
labels:
  - web
dependencies: []
milestone: v1.9
references:
  - ref-2
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/api.ts
  - src/web/settings-api.test.mjs
  - web/src/App.tsx
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/settings/settings.tsx
  - web/src/components/settings/api.ts
  - web/src/lib/use-hash-route.ts
  - web/src/hooks/use-mobile.ts
  - web/src/components/ui/sidebar.tsx
  - web/src/components/ui/sheet.tsx
  - web/src/components/ui/skeleton.tsx
  - web/src/components/ui/tooltip.tsx
  - web/src/components/ui/input.tsx
  - web/src/components/ui/label.tsx
  - web/src/components/ui/switch.tsx
  - web/src/components/ui/card.tsx
  - web/dist/index.html
  - web/dist/assets/index-CGICMGT_.js
  - web/dist/assets/index-BNIyi2_t.css
  - README.md
lessons:
  - lesson-6
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#web Создать страницу настроек в веб интерфейсе. На основе нового settings.json и команды set в боте, необходимо создать страницу для редактирования этих настроек. Для того чтобы переключаться между канбан доской и новыми настройками нужно добавить сайдбар. Как обычно для веб разработки используем референс next-shadcn-admin-dashboard

Уточнения:
- Источник данных настроек — settings.json (тот же файл, который читает команда set в боте): веб-страница редактирует именно его, без отдельного хранилища.
- Сайдбар — постоянный элемент веб-интерфейса с переходом между существующей канбан-доской и новой страницей настроек.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## VL-156 — Страница настроек + сайдбар в веб-интерфейсе

Контекст изучен: веб-UI — Vite+React SPA в `web/` (shadcn/ui, Tailwind 4, radix-ui unified), собирается в закоммиченный `web/dist` (VL-26), раздаётся `src/web/server.ts` через `src/web/static.ts` (index.html только на `/` → хеш-роутинг не требует серверных правок). Настройки — единый `.vibelog/settings.json` (VL-143): чтение `loadSettings`/`loadBotSettings`, запись `saveSettingsPatch`/`saveBotSettings` (read-modify-write, env-секция с секретами сохраняется). Команда `/set` бота (src/bot/handlers.ts:574–660) редактирует: default_agent (qwen|vb), max_wall_time, max_requests (positive int, 0=сброс), branch_mode, compact, code_same_session (boolean). Референс ref-2: `backlog/references/data/next-shadcn-admin-dashboard/src/app/(main)/dashboard/_components/sidebar/app-sidebar.tsx` (SidebarHeader/Content/Footer, NavMain) и `src/components/ui/sidebar.tsx` (shadcn Sidebar).

### 1. REST API настроек — `src/web/api.ts`
- Импорт: добавить `loadBotSettings, saveBotSettings` из `../bot/settings.js` (строка ~19, рядом с `loadConfig`).
- В doc-comment эндпоинтов (строки 3–14) добавить: `GET /api/settings`, `PUT /api/settings`.
- Новые роуты ВСТАВИТЬ после блока GET /api/config (после строки 53) и до getMatch (строка ~99), чтобы не ловить `/api/settings` как id задачи (паттерн `^/api/tasks/(.+)$` не совпадает, но порядок держим как у trigger/reject):
  - `GET /api/settings` → `{ settings: loadBotSettings(cwd) }` — ТОЛЬКО валидированные поля (chats, task_type_styles, default_agent, max_wall_time, max_requests, branch_mode, compact, code_same_session). Env-секция (TELEGRAM_BOT_TOKEN и др.) НЕ отдаётся — секреты не должны попадать в браузер.
  - `PUT /api/settings` → валидация тела — зеркало `/set`:
    - default_agent: 'qwen'|'vb', иначе 400 `{error}`;
    - max_wall_time/max_requests: положительное целое, либо 0/null → undefined (сброс, ключ удалится);
    - branch_mode/compact/code_same_session: строго boolean, иначе 400;
    - неизвестные ключи → 400 (защита от мусора в settings.json);
    - Применение: `const s = loadBotSettings(cwd); Object.assign(s, validated); saveBotSettings(cwd, s)` — сохраняет env/chats (VL-143). compact: UI шлёт явный boolean; undefined не передаётся.
  - Ответ PUT — тот же sanitized объект, что GET.

### 2. shadcn-компоненты в `web/src/components/ui/` — копия из ref-2 (MIT, shadcn)
`sidebar.tsx` (ref-2: src/components/ui/sidebar.tsx) зависит от: Button, Input, Separator (есть), Sheet, Skeleton, Tooltip и `@/hooks/use-mobile`. Скопировать из `backlog/references/data/next-shadcn-admin-dashboard/src/components/ui/`:
- `sidebar.tsx`, `sheet.tsx`, `skeleton.tsx`, `tooltip.tsx`, `input.tsx`, `label.tsx`, `switch.tsx`, `card.tsx` (все импорты: cn, cva, radix-ui unified — уже в package.json, новых зависимостей НЕТ);
- создать `web/src/hooks/use-mobile.ts` (копия ref-2 src/hooks/use-mobile.ts).
Проверить после копирования: `pnpm --dir web typecheck`.

### 3. Хеш-роутинг — без react-router (новых зависимостей не заводим)
- Новый файл `web/src/lib/use-hash-route.ts`: хук `useHashRoute(): 'board'|'settings'` — слушает `hashchange`, `#/settings` → settings, иначе board; начальный редирект пустого hash на `#/` не обязателен (дефолт board).
- `web/src/App.tsx` (переписать целиком, 11 строк): flex-row layout — `<AppSidebar />` + `<main>` c рендером `<Kanban />` или `<SettingsPage />` по хешу. Классы обёртки канбана (`min-h-svh p-2`) перенести на main (см. web/src/App.tsx:4-8). Старый inline-fallback в server.ts не трогаем.

### 4. Сайдбар — новый `web/src/components/layout/app-sidebar.tsx`
По мотивам ref-2 app-sidebar.tsx (тот же паттерн SidebarHeader/SidebarContent/SidebarMenuButton, иконки lucide-react):
- SidebarHeader: иконка Command + «Vibelog» (как APP_CONFIG.name в ref-2);
- SidebarContent: NavMain с двумя пунктами: «Канбан» (иконка Kanban, url `#/`), «Настройки» (иконка Settings, url `#/settings`); активный пункт — `data-active` по текущему хешу (тот же useHashRoute).
- Footer/пользователь не нужны (вне скоупа).

### 5. Страница настроек — новый `web/src/components/settings/settings.tsx` + `web/src/components/settings/api.ts`
`api.ts` (по образцу web/src/components/kanban/api.ts):
- `fetchSettings()` → GET /api/settings;
- `putSettings(patch)` → PUT /api/settings, бросает при !ok с текстом error из тела.

`settings.tsx` — форма на Card + Label + Input + Switch:
- default_agent — сегмент-кнопки qwen/vb на существующем Button (variant outline/default);
- max_wall_time, max_requests — Input type=number; пусто/0 → undefined (подсказка «0 или пусто — сброс, дефолт агента»);
- branch_mode, code_same_session — Switch (default off); compact — Switch, при этом в состоянии по умолчанию ВКЛ (undefined = вкл, VL-122) — при сабмите слать явный boolean;
- Кнопка «Сохранить» → putSettings со всеми валидными полями; успех — зелёная строка «Сохранено», ошибка — красный текст; после успеха перечитать GET.
- Пустой initial state показывает Skeleton (ui/skeleton).

### 6. Тесты — новый `src/web/settings-api.test.mjs`
По образцу src/web/orchestrator.test.mjs (handleApi из `../../dist/web/api.js`, tmpdir-проект):
- GET /api/settings: без файла → дефолты (chats [], task_type_styles с дефолтами);
- GET не содержит env-секции: записать settings.json с TELEGRAM_BOT_TOKEN → в ответе нет 'TELEGRAM';
- PUT валидный: branch_mode=true, max_requests=300 → файл .vibelog/settings.json обновлён (читаем JSON напрямую), env сохранён;
- PUT 0/null → ключ удалён из файла;
- PUT невалидный (default_agent='gpt', max_wall_time=-5, неизвестный ключ 'foo') → 400, файл не изменён.

### 7. Сборка и проверки (порядок)
1. `pnpm build` (dist/ TypeScript);
2. `pnpm --dir web typecheck && pnpm web:build` — web/dist пересобрать И ЗАКОММИТЬ (входит в npm files, свежий clone должен отдать новый UI);
3. `pnpm test` — vitest, включая новый settings-api.test.mjs;
4. Ручная верификация (AGENTS.md): `vibelog browser` + chrome-devtools MCP: сайдбар виден, переход Канбан↔Настройки, PUT /api/settings уходит и settings.json обновился, drag-and-drop канбана не сломан (регрессия раскладки).

### 8. Документация
- README.md (раздел around строки 81 «Веб-интерфейс»): добавить упоминание сайдбара и страницы настроек (поля эквивалентны /set).

### Файлы
Изменяются: `src/web/api.ts`, `web/src/App.tsx`, `README.md`, `web/dist/**` (пересборка).
Создаются: `web/src/components/layout/app-sidebar.tsx`, `web/src/components/settings/{settings.tsx,api.ts}`, `web/src/lib/use-hash-route.ts`, `web/src/hooks/use-mobile.ts`, `web/src/components/ui/{sidebar,sheet,skeleton,tooltip,input,label,switch,card}.tsx` (копии ref-2), `src/web/settings-api.test.mjs`.

### Риски
1. **Секреты**: env-секция settings.json — только через saveBotSettings (сохраняет env); GET её не отдаёт. Проверка — тест на отсутствие 'TELEGRAM' в ответе.
2. **compact по умолчанию вкл** (undefined=вкл): баг в UI-маппинге выключит компакшн молча — покрыто тестом PUT 0/null и ручной проверкой.
3. **web/dist в git**: забытая `pnpm web:build` → npm-пакет отдаст старый UI. Вплетено в шаг 7.
4. **Копирование shadcn-sidebar**: sidebar.tsx тянет sheet/skeleton/tooltip/use-mobile — скопировать полный набор за один проход, затем typecheck; новых npm-зависимостей не требуется (radix-ui unified уже установлен).
5. **Регрессия канбана**: App.tsx меняет корневую раскладку — dnd-kit проверить в браузере (AGENTS.md, chrome-devtools).
6. **Компактность ответа API**: chats (chat_id) отдаётся — это не секреты (в отличие от токена), и бот их показывает в /status; допустимо.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 15:06
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен без изменений. Масштаб: task. Уточнено: источник настроек — settings.json (общий с командой set в боте), сайдбар — постоянный элемент интерфейса с переходом между канбан-доской и настройками; добавлены критерии приёмки (сайдбар с навигацией, страница редактирования настроек, сохранение в settings.json, стиль по референсу next-shadcn-admin-dashboard). Вопросов нет.
---
author: @agent
created: 2026-10-14 23:47
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 6 шагов, ~19 файлов (изменяются src/web/api.ts — GET/PUT /api/settings с валидацией зеркалом /set и без отдачи env-секции, web/src/App.tsx — flex-layout с сайдбаром, README.md, web/dist; создаются app-sidebar.tsx по мотивам ref-2, страница settings.tsx, хеш-роутинг use-hash-route.ts, 8 shadcn-компонентов копией из ref-2 без новых npm-зависимостей, тест src/web/settings-api.test.mjs). Референс ref-2 изучен: app-sidebar.tsx (SidebarHeader/Content/Footer + NavMain) и ui/sidebar.tsx (тянет sheet/skeleton/tooltip/use-mobile — копировать полным набором). Риски: секреты env-секции (тест на отсутствие TELEGRAM в GET), compact по умолчанию вкл (undefined=вкл), обязательная пересборка и коммит web/dist, регрессия канбана при смене корневой раскладки (проверка drag-and-drop в chrome-devtools).
---
author: @agent
created: 2026-10-15 00:09
---
Фаза 3 (Code) выполнена. Коммит 6b45196 (ветка vb/vl-156, 22 файла, +1922/−83).
Реализация по плану:
1. Backend: GET/PUT /api/settings в src/web/api.ts — GET отдаёт валидированные поля loadBotSettings без env-секции (секреты не утекают в браузер); PUT валидирует зеркалом /set (default_agent qwen|vb, лимиты — положительное целое или 0/null→сброс, boolean-флаги строго boolean, неизвестные ключи → 400, файл не меняется), запись через saveBotSettings — env/chats сохраняются (VL-143).
2. Web UI: сайдбар app-sidebar.tsx по паттерну ref-2 (SidebarHeader «Vibelog» + Канбан/Настройки, активный пункт по хешу, collapsible=icon); хеш-роутинг use-hash-route.ts без react-router (index.html только на «/» — сервер не трогали); страница settings.tsx (Card+Switch+Input): агент сегмент-кнопками, лимиты с подсказкой «0/пусто — сброс», compact default-on (undefined=вкл, VL-122), «Сохранено»/ошибка, Skeleton при загрузке. 8 shadcn-компонентов + use-mobile скопированы из ref-2, новых npm-зависимостей нет.
3. Тесты: src/web/settings-api.test.mjs — 7 тестов (дефолты, отсутствие TELEGRAM/env в ответе, 400-валидация с неизменным файлом, сохранение env/chats, сброс 0/null, compact, пустое тело). Полный прогон pnpm test: 62 файла, 1097 тестов — зелёные.
4. Smoke живого сервера (vibelog browser, curl): GET/PUT /api/settings работают, settings.json обновился, «foo» → 400.
5. README.md — раздел веб-интерфейса дополнен сайдбаром и страницей настроек.
6. web/dist пересобран (pnpm web:build) и закоммичен.
Отмечено DoD: 1 (тесты), 2 (документация), 3 (нет регрессий — полный прогон + smoke; dnd-kit код не менялся, только корневая раскладка).
Осталось (не критично): визуальная проверка drag-and-drop и сайдбара в chrome-devtools MCP — в этой сессии MCP браузера недоступен, рекомендуется при ревью: vibelog browser → клик «Настройки» → поменять значение → убедиться, что .vibelog/settings.json обновился и канбан перетаскивается как раньше. Урок lesson-6 (pnpm install в web/ перед сборкой в worktree) связан.
---
author: @agent
created: 2026-10-15 00:19
---
Фаза Close выполнена. Ветка vb/vl-156 слита в master (1 коммит 6b45196, merge-коммит без конфликтов, +1922/−83 по 22 файлам), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. Проверки в master после merge: pnpm build — OK; pnpm test — 62 файла, 1090 passed / 4 skipped, без падений. DoD 3/3: тесты проходят (включая 7 новых settings-api.test.mjs), документация обновлена (README в ветке + CHANGELOG.md Unreleased и doc-6 раздел «Доска и веб-интерфейс» в docs-коммите 45c3ef3), нет регрессий (полный прогон + smoke живого сервера в Фазе 3; dnd-kit не менялся — только корневая раскладка). Lessons: lesson-6 (pnpm install в web/ перед web:build в worktree) уже связан с задачей. Рекомендация на ревью: vibelog browser → клик «Настройки» → убедиться, что settings.json обновился и канбан перетаскивается как раньше (chrome-devtools MCP в Фазе 3 был недоступен).
---
<!-- COMMENTS:END -->