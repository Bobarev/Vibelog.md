---
id: VL-166
title: Скопировать шапку из next-shadcn-admin-dashboard
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 09:37'
updated_date: '2026-10-25 23:26'
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
  - web/src/main.tsx
  - web/src/App.tsx
  - web/src/components/preferences.tsx
  - web/src/components/header/app-header.tsx
  - web/src/components/header/search.tsx
  - web/src/components/header/layout-controls.tsx
  - web/src/components/header/theme-switcher.tsx
  - web/src/components/header/repo-menu.tsx
  - web/src/components/header/account-switcher.tsx
  - web/src/components/ui/popover.tsx
  - web/src/components/ui/select.tsx
  - web/src/components/ui/toggle.tsx
  - web/src/components/ui/toggle-group.tsx
  - web/src/components/kanban/kanban.tsx
  - README.md
lessons:
  - lesson-6
  - lesson-14
  - lesson-15
  - lesson-16
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Скопировать шапку (header) из проекта next-shadcn-admin-dashboard полностью, со всеми инструментами в шапке (перечисление слева-направо):

1. Свернуть/развернуть сайдбар — должен работать.
2. Поиск — отображается, но пока неактивен (реализация — отдельная задача).
3. Настройки вида/стиля — должны работать.
4. Переключатель светлая/тёмная тема — должен работать.
5. Ссылка на репо — должна работать (https://gitverse.ru/bobarev/Vibelog.md).
6. Юзер-меню — должно работать: данные берём из наших настроек юзера, переключение между юзерами не нужно, остальное меню заполнить чем-нибудь.

Важно: list_console_messages в chrome-devtools-mcp по итогу не должна содержать ошибок.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Фаза 2 (Plan): Шапка из next-shadcn-admin-dashboard (ref-2)

## Источник
Шапка собирается в backlog/references/data/next-shadcn-admin-dashboard/src/app/(main)/dashboard/layout.tsx:47-70 из 5 компонентов в _components/header/: account-switcher.tsx, github-repositories-menu.tsx, layout-controls.tsx, search-dialog.tsx, theme-switcher.tsx. UI-компоненты (popover/select/toggle/toggle-group) лежат в ref-2 src/components/ui/ и используют единый пакет radix-ui + cn + cva — те же зависимости уже есть в web/package.json (radix-ui ^1.6.7, cn, class-variance-authority), копия совместима без новых зависимостей.

## Состав шапки (слева-направо)
- Левая группа: SidebarTrigger + Separator (вертикальный) + неактивная кнопка Поиск.
- Правая группа: LayoutControls (настройки вида) - ThemeSwitcher (цикл тем) - ссылка на репо (gitverse) - юзер-меню.

## Файлы

### Новые (все в web/)
1. web/src/components/ui/popover.tsx — дословная копия из ref-2 ui/popover.tsx.
2. web/src/components/ui/select.tsx — копия из ref-2 ui/select.tsx.
3. web/src/components/ui/toggle.tsx — копия из ref-2 ui/toggle.tsx (нужен для toggle-group).
4. web/src/components/ui/toggle-group.tsx — копия из ref-2 ui/toggle-group.tsx (импортирует toggleVariants из @/components/ui/toggle — путь совпадает с нашим).
5. web/src/components/preferences.tsx — PreferencesProvider + usePreferences(): React-контекст + localStorage (ключ vibelog-layout-prefs), поля sidebar_variant (inset|sidebar|floating, default sidebar), sidebar_collapsible (offcanvas|icon|none, default icon — сохраняем текущее поведение AppSidebar). Без zustand. Тема НЕ дублируется здесь — она в существующем theme-provider.tsx (useTheme).
6. web/src/components/header/app-header.tsx — сама шапка: header (flex h-12 shrink-0 items-center gap-2 border-b) + две группы по layout.tsx референса. Левая: SidebarTrigger с className -ml-1, Separator orientation=vertical, SearchButton. Правая: LayoutControls, ThemeSwitcher, RepoMenu, AccountSwitcher.
7. web/src/components/header/search.tsx — неактивный поиск: Button variant=link с иконкой Search (lucide), текст Поиск, элемент kbd (как в ref-2 search-dialog.tsx:126-143, но БЕЗ CommandDialog и обработчика — реализация отдельной задачей; aria-disabled, title Скоро, клик — no-op).
8. web/src/components/header/layout-controls.tsx — по мотивам ref-2 layout-controls.tsx, упрощённо (без zustand): Popover с кнопкой Settings (lucide) - 3 секции с ToggleGroup type=single:
   - Theme Mode: light/dark/system -> useTheme().setTheme;
   - Sidebar Style: inset/sidebar/floating -> usePreferences().setSidebarVariant;
   - Sidebar Collapse Mode: offcanvas/icon/none -> usePreferences().setSidebarCollapsible.
   Выбранный пункт визуально отмечен (aria-pressed). Тексты на русском (Параметры вида).
9. web/src/components/header/theme-switcher.tsx — по мотивам ref-2 theme-switcher.tsx: кнопка-иконка, клик циклит light-dark-system (константа THEME_CYCLE); иконки Monitor/Sun/Moon (lucide) рендерятся по значению useTheme().theme в JSX (не CSS-хаком с html[data-theme-mode], т.к. наш theme-provider пишет классы light/dark на documentElement); aria-label с текущей темой.
10. web/src/components/header/repo-menu.tsx — по мотивам ref-2 github-repositories-menu.tsx: DropdownMenu + Button size=icon с иконкой GitBranch (lucide; иконки Github в lucide-react 1.x может не быть — фолбэк GitBranch/Repo), пункт Репозиторий Vibelog.md -> a href=https://gitverse.ru/bobarev/Vibelog.md target=_blank rel=noreferrer.
11. web/src/components/header/account-switcher.tsx — по мотивам ref-2 account-switcher.tsx, БЕЗ переключения юзеров: один юзер из GET /api/settings -> новое поле git_user_name. Avatar size-8 с AvatarFallback = getInitials(name) (уже есть в web/src/lib/utils.ts) как триггер DropdownMenu; в меню: заголовок (имя + автор), пункты Настройки бота (href #/settings), Конфиг проекта (href #/config), Репозиторий (внешняя ссылка), Выйти (no-op, disabled). Пока API не ответил — AvatarFallback ?. Ошибка API не роняет шапку (fallback @agent), без необработанных ошибок в консоли.

### Изменяемые
12. src/web/api.ts:83-85 (GET /api/settings) — в тело ответа добавить git_user_name: resolveGitUserName(cwd) (импорт из ../core/project-settings.js; кэш .vibelog/settings.json -> fallback git config -> @agent). Секреты не затрагиваются.
13. src/web/settings-api.test.mjs — в describe GET /api/settings добавить тесты: (а) settings.json с git_user_name=Pavel -> GET вернёт git_user_name=Pavel; (б) без ключа -> fallback (в tmp-каталоге git-кэша нет -> @agent, проверить фактический результат при коде).
14. web/src/main.tsx — обернуть App в PreferencesProvider (порядок: ThemeProvider -> PreferencesProvider -> App).
15. web/src/App.tsx:20-37 — читать usePreferences(): AppSidebar с переданными variant и collapsible (app-sidebar.tsx:44 Sidebar collapsible=icon {...props} — spread после, переданный prop переопределяет, сам файл менять НЕ нужно); внутри SidebarInset добавить AppHeader перед контентом; main className min-h-svh p-2 заменить на min-h-0 flex-1 overflow-y-auto p-2 (скролл внутри — header всегда виден).
16. web/src/components/kanban/kanban.tsx:197 — h-[calc(100dvh-2rem)] заменить на h-full (с появившимся хедером h-12 старый calc вылезал за экран; main теперь scroll-контейнер с flex-1, h-full = его высота).
17. README.md:81-88 (блок Веб-интерфейс) — добавить строку про шапку: сворачивание сайдбара (Ctrl/Cmd+B), настройки вида, тема, ссылка на репо, юзер-меню (данные — git_user_name).
18. CHANGELOG.md — запись Шапка интерфейса (VL-166) в ближайшей незакрытой версии (проверить структуру при коде).

## Порядок действий (Фаза 3)
1. cd web && pnpm install — worktree свежий, без install web:build упадёт (lesson-6).
2. Сервер: правка src/web/api.ts + тест settings-api.test.mjs; pnpm build && pnpm test:fast.
3. UI-компоненты: скопировать popover/select/toggle/toggle-group из ref-2.
4. PreferencesProvider (preferences.tsx) -> main.tsx.
5. Header-компоненты (search, theme-switcher, repo-menu, account-switcher, layout-controls, app-header).
6. App.tsx + kanban.tsx.
7. pnpm web:build (tsc -b + vite) — типы и сборка.
8. Браузерная верификация (chrome-devtools-mcp): vibelog browser -> new_page -> list_console_messages (ДОЛЖЕН быть без ошибок) -> take_screenshot; клики: SidebarTrigger сворачивает/разворачивает; LayoutControls: смена Sidebar Style меняет data-variant сайдбара, Collapse Mode меняет поведение; ThemeSwitcher: класс темы на documentElement меняется по циклу; юзер-меню открывается и показывает git_user_name; ссылка репо — href верный.

## Как проверить
- pnpm build && pnpm test:fast — корневые тесты (включая новый GET-тест).
- pnpm web:build — сборка UI.
- vibelog browser + chrome-devtools: list_console_messages без ошибок; ручные клики по всем 6 элементам шапки.

## Риски
- Высота канбана: старый h-[calc(100dvh-2rem)] ломается с хедером — решается правкой kanban.tsx:197 (в плане).
- lucide-react 1.49: иконка Github может отсутствовать (бренд-иконки удалены) — использовать GitBranch/Repo; Monitor/Moon/Sun/Search/Settings — стандартные, будут.
- radix-ui единый пакет: копии ui-компонентов ref-2 импортируют from radix-ui — совпадает с нашими существующими ui/*.tsx, новых зависимостей нет.
- Консоль браузера: AccountSwitcher обязан деградировать без ошибок в консоли при недоступном API (try/catch, fallback @agent).
- Регрессия страниц настроек/конфига: main становится scroll-контейнером — проверить скролл длинных форм (#/settings, #/config).
- cookie sidebar_state: shadcn пишет состояние сайдбара в cookie — не конфликтует с localStorage preferences (cookie = expanded/collapsed, preferences = режим виджета).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 09:39
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Скопировать шапку из next-shadcn-admin-dashboard» (снят ведущий тег #web). Масштаб: task (одна фича — шапка с 6 элементами). Уточнено: состав шапки слева-направо (сворачивание сайдбара, поиск — неактивен, настройки вида/стиля, переключатель темы, ссылка на репо, юзер-меню из настроек пользователя без переключения), ссылка на репо https://gitverse.ru/bobarev/Vibelog.md, требование отсутствия ошибок в list_console_messages. Labels: web (тег пользователя #web снят с заголовка и добавлен в labels). References: ref-15 (next-shadcn-admin-dashboard, repo без URL — уточнить при необходимости в Фазе 2). Добавлены 8 критериев приёмки. Вопросов нет.
---
author: @agent
created: 2026-10-15 11:22
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan (18 файлов: 11 новых в web/ + 7 изменяемых). Изучен ref-2: шапка собирается в dashboard/layout.tsx:47-70 из 5 компонентов _components/header/; UI-компоненты popover/select/toggle/toggle-group копируются из ref-2 src/components/ui/ (единый пакет radix-ui + cn + cva — совпадает с нашим web/package.json, новых зависимостей нет). Ключевые решения: (1) настройки вида — свой PreferencesProvider на React-контексте + localStorage вместо zustand-стора референса (variant/collapsible сайдбара); тема переиспользует существующий theme-provider.tsx (useTheme); (2) ThemeSwitcher — цикл light/dark/system с рендером иконок по значению темы в JSX; (3) поиск — отображается (aria-disabled, kbd), но неактивен (CommandDialog не тащим — отдельная задача); (4) юзер-меню — одно юзеро без переключения: добавляется поле git_user_name в GET /api/settings (resolveGitUserName: кэш settings.json → git config → @agent) + новый тест в settings-api.test.mjs; (5) ссылка на репо https://gitverse.ru/bobarev/Vibelog.md в DropdownMenu (иконка GitBranch — бренда Github может не быть в lucide-react 1.x); (6) App.tsx получает AppHeader + scroll-контейнер main, kanban.tsx:197 h-[calc(100dvh-2rem)] → h-full (регрессия высоты с хедером). Файлов: 11 новых (ui: popover/select/toggle/toggle-group; header: app-header/search/layout-controls/theme-switcher/repo-menu/account-switcher; preferences.tsx), 7 изменяемых (src/web/api.ts, settings-api.test.mjs, web/main.tsx, App.tsx, kanban.tsx, README.md, CHANGELOG.md). Риски: высота канбана, наличие иконок lucide, деградация AccountSwitcher без ошибок в консоли, скролл длинных форм настроек. Учтены lessons: lesson-6 (pnpm install в web/ в свежем worktree), lesson-7 (TooltipProvider уже внутри SidebarProvider — VL-160), lesson-11 (не применим — сайдбар уже контролируемый).
---
author: @agent
created: 2026-10-15 12:15
---
Фаза 3 (Code) выполнена. Реализована шапка по плану из ref-2 (dashboard/layout.tsx:47-70). Коммит 005a089 (ветка vb/vl-166, 22 файла, +1079/−126).
Новые файлы (11): ui/popover.tsx, ui/select.tsx, ui/toggle.tsx, ui/toggle-group.tsx (дословные копии ref-2, новых зависимостей нет); components/preferences.tsx (PreferencesProvider: React-контекст + localStorage vibelog-layout-prefs, variant sidebar_variant/sidebar_collapsible, дефолты sidebar+icon — как текущий AppSidebar); header/app-header.tsx, header/search.tsx (aria-disabled, title «Скоро», kbd ⌘J, клик no-op), header/layout-controls.tsx (Popover: тема/стиль/свертка — 3 ToggleGroup, тексты на русском), header/theme-switcher.tsx (цикл light→dark→system, иконки по useTheme().theme в JSX), header/repo-menu.tsx (GitBranch → https://gitverse.ru/bobarev/Vibelog.md), header/account-switcher.tsx (одно юзеро из GET /api/settings.git_user_name, AvatarFallback ? до ответа, тихий fallback @agent без console.error).
Изменённые (7): src/web/api.ts (GET /api/settings +git_user_name: resolveGitUserName); settings-api.test.mjs (+2 теста: кэш Pavel → Pavel; без ключа → непустая строка-fallback); web/main.tsx (ThemeProvider→PreferencesProvider→App); web/App.tsx (AppSidebar variant/collapsible из preferences, AppHeader перед main, main min-h-0 flex-1 overflow-y-auto — шапка всегда видна); kanban.tsx (h-[calc(100dvh-2rem)]→h-full — регрессия высоты с хедером); README.md (блок веб-интерфейса: шапка, Ctrl/Cmd+B, юзер-меню git_user_name); CHANGELOG.md НЕ тронут по правилам фазы (пишет Close).
Проверки: pnpm build + test:fast — 1133 passed; pnpm test (со static.test.mjs) — passed; pnpm web:build (tsc -b + vite) — ok. Браузерная верификация (vibelog browser + chrome-devtools): list_console_messages ПУСТО (без ошибок); SidebarTrigger сворачивает/разворачивает (data-state collapsed↔expanded); LayoutControls: inset меняет data-variant сайдбара и сохраняется в localStorage, collapse mode none применяется и откатывается; ThemeSwitcher циклит system→light→dark (класс на documentElement меняется, вернул системную); юзер-меню показывает «Pavel Bobarev» (git_user_name), пункты Настройки бота #/settings, Конфиг #/config, Репозиторий, Выйти disabled; RepoMenu href https://gitverse.ru/bobarev/Vibelog.md target=_blank; скролл #/settings корректен (header 48px, main-контейнер, контент влезает).
Осталось: CHANGELOG.md — обновит Фаза Close; реализация активного поиска — отдельная задача (по плану). Учтён lesson-6 (pnpm install в web/ первым шагом). ref-2 связан; новых references не добавлял.
---
author: @agent
created: 2026-10-15 12:47
---
Фаза Close выполнена. Ветка vb/vl-166 слита в master (1 коммит 005a089, merge --no-ff a5b9307), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. Сборка и тесты после merge: pnpm build ok, pnpm test — 1132 passed (reference.test.mjs один раз упёрся в сетевой таймаут клонирования — флайк, при повторных прогонах стабильно зелёный), pnpm test:fast — 1135 passed. DoD: 1 (тесты проходят), 2 (документация обновлена — README в Фазе 3, CHANGELOG + doc-6 в docs-коммите 48a2ab0), 3 (нет регрессий — браузерная верификация в Фазе 3, консоль без ошибок). Lessons: lesson-14 (calc-высоты → h-full при добавлении хедера), lesson-15 (бренд-иконки lucide 1.x), lesson-16 (try/catch fetch для чистой консоли).
---
<!-- COMMENTS:END -->