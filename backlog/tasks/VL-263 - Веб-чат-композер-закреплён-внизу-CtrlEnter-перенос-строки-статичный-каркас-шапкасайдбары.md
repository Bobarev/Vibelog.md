---
id: VL-263
title: 'Веб-чат: композер закреплён внизу, Ctrl+Enter — перенос строки, статичный каркас (шапка/сайдбары)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 14:20'
updated_date: '2026-10-30 16:27'
due_date: ''
labels:
  - web
  - chat
  - layout
  - composer
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/components/chat/thread.tsx
  - web/src/components/chat/thread-sidebar.tsx
  - web/src/App.tsx
  - web/src/components/preferences.tsx
  - README.md
  - web/dist/index.html
  - web/dist/assets/index-C3SGoj6Q.css
  - web/dist/assets/index-DR87lj_3.js
lessons:
  - lesson-111
  - lesson-112
token_usage:
  input: 19457360
  output: 88787
  cache: 18914816
  total: 19546147
  requests: 279
  duration_ms: 6833706
  reasoning: 43507
  by_phase:
    plan:
      input: 10730087
      output: 42425
      cache: 10534912
      requests: 126
    code:
      input: 6550203
      output: 36817
      cache: 6449152
      requests: 93
    close:
      input: 2177070
      output: 9545
      cache: 1930752
      requests: 60
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст (из диалога)

Пункт (а) из разбиения доработок веб-чата по референсу ref-22 (`apps/docs/components/pages/examples/perplexity.tsx`). Три независимых дефекта/улучшения вёрстки и ввода.

### 1. Ctrl+Enter должен вставлять перенос строки (сейчас — отправка)

Пользователь хочет: **plain Enter — отправка сообщения**, **Ctrl+Enter — перенос строки** (`'\n'`, каретка на новую строку) в инпуте композера.

Факт: в `@assistant-ui/react` (у нас 0.15.31) у `ComposerPrimitive.Input` есть `submitMode`, но семантика обратная ТЗ:
- `"enter"` (дефолт) — plain Enter отправляет, Shift+Enter переносит;
- `"ctrlEnter"` — Ctrl/Cmd+Enter **отправляет**, plain Enter переносит;
- `"none"` — отправка только кнопкой.

Нужного режима (Enter=отправка, Ctrl+Enter=новая строка) в либе нет. Решение — свой `onKeyDown` на `ComposerPrimitive.Input`: внутренний обработчик либы подключается через `composeEventHandlers`, который уважает `defaultPrevented`, поэтому перехват Ctrl/Cmd+Enter в нашем обработчике (preventDefault + вставка `\n` в позицию каретки) отменяет встроенную отправку. Вставка — через `aui.composer.setText(...)` (значение приходит из `s.composer.text`, `useComposerInputValue`) либо через нативное `setRangeText('\n')` с последующим обновлением состояния композера; Enter по умолчанию оставляем отправкой, Shift+Enter — перенос (текущее поведение, сохранено).

Правки: `Composer` и `EditComposer` в `web/src/components/chat/thread.tsx`; подсказки в placeholder/EmptyState («Enter — отправить, Ctrl+Enter — перенос строки»).

### 2. Скролл: статичная шапка приложения, статичные сайдбары, статичный композер

Сейчас на странице чата композер скроллится вместе со страницей (уезжает вверх), а шапка приложения тоже уезжает. Пользователь также уточнил: на **всех** страницах хедер должен быть статичным (не только на чате), левый основной сайдбар не должен прокручиваться страницей, правый сайдбар тредов чата — статичный, с внутренним скроллом списка тредов при переполнении. На странице чата скроллиться должна **только** область сообщений.

Причина (установлено по коду): каркас не ограничен по высоте — `SidebarProvider` (`web/src/components/ui/sidebar.tsx`) это `flex min-h-svh w-full` (не `h-svh`), `SidebarInset` — `flex w-full flex-1 flex-col` без height, `main` в `web/src/App.tsx` на не-чат-страницах `flex-1 overflow-y-auto`, а `h-full` у `ChatPage` в родителе без заданной высоты схлопывается по контенту. В итоге скроллится body (весь документ), и «вместе с ним» уезжают хедер и композер; `ThreadPrimitive.Viewport` (`min-h-0 flex-1 overflow-y-auto`) при этом не получает ограниченной высоты и не скроллится.

Предлагаемое решение: фиксированный каркас — wrapper `flex h-svh w-full overflow-hidden`, `SidebarInset: flex h-full min-h-0 flex-col overflow-hidden`, `main: min-h-0 min-w-0 flex-1` (чат — `overflow-hidden`, остальные страницы — `overflow-y-auto`). Тогда `h-full` у `ChatPage` получает реальную высоту, `ThreadPrimitive.Viewport` скроллится внутри, `ViewportFooter` (sticky bottom-0) реально прилипает к низу, а `AppHeader h-12 shrink-0` остаётся на месте на всех страницах. Дополнительно: `aside` сайдбара тредов — `h-full min-h-0 overflow-hidden`, `nav` — `min-h-0 flex-1 overflow-y-auto` (скролл только у списка).

### 3. Кнопка сворачивания сайдбара тредов

В референсе (`clone-thread-shell.tsx`) сайдбар сворачивается в `w-12 ↔ w-65` кнопкой `PanelLeftIcon` в хедере, содержимое скрывается (`opacity/inert`), ширина анимируется. У нас кнопки нет. Добавить кнопку в хедер правого сайдбара чата (шапка «Чаты»), состояния свернуто/развёрнуто; сохранение выбора — по существующему паттерну layout-настроек (`web/src/components/preferences.tsx`, localStorage `vibelog-layout-prefs`), чтобы не сбрасывалось при переходах.

### Вне скоупа

Стиль сообщений и рендер tool-вызовов (пункт «б»), пикеры модели/роли у инпута (пункт «в»), перенос `ModelSwitcher` из сайдбара.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В композере чата plain Enter отправляет сообщение, Shift+Enter вставляет перенос строки, Ctrl/Cmd+Enter вставляет перенос строки (не отправляет) — проверено в dev-сборке на обоих композерах (основной и EditComposer)
- [x] #2 Вставка переноса по Ctrl/Cmd+Enter происходит в позицию каретки, состояние композера синхронизировано (после переноса текст сохраняется при отправке без потери символов), автоувеличение высоты textarea работает
- [x] #3 Подсказки в placeholder и в пустом состоянии отражают раскладку клавиш: Enter — отправить, Ctrl+Enter — перенос строки
- [x] #4 Хедер приложения не скроллится ни на одной странице (#/, #/tasks, #/settings, #/config, #/references, #/documents, #/lessons, #/chat): прокручивается только контентная область под шапкой
- [x] #5 На странице чата скроллится только область сообщений (ThreadPrimitive.Viewport); композер постоянно закреплён внизу и не уезжает при прокрутке треда
- [x] #6 Правый сайдбар тредов чата статичен: aside не растягивается по контенту, при большом числе тредов скроллится только список (nav), хедер сайдбара («Чаты», «Новый») остаётся на месте
- [x] #7 Левый основной сайдбар приложения не прокручивается вместе со страницей ни на одной странице
- [x] #8 В сайдбаре тредов есть кнопка сворачивания (аналог PanelLeftIcon из ref-22): сворачивает в узкую полосу w-12 и разворачивает обратно, ширина анимируется, содержимое в свёрнутом виде скрыто (opacity/inert)
- [x] #9 Состояние «свёрнут/развёрнут» сайдбара тредов переживает перезагрузку страницы и переходы между страницами (localStorage по паттерну preferences)
- [x] #10 Пустое состояние нового чата сохраняет текущий вид: композер по центру, ничего не сломано
- [x] #11 web/npm run build (tsc -b && vite build) и npm run lint проходят без ошибок; вручную проверено, что двойного скролла (body + viewport) нет ни на чате, ни на списковых страницах
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

Три независимых правки вёрстки/ввода веб-чата (ref-22 `apps/docs/components/pages/examples/perplexity.tsx`, `clone-thread-shell.tsx`):
1. Ctrl/Cmd+Enter — перенос строки (сейчас отправка), Enter — отправка, Shift+Enter — перенос (сохранить).
2. Фиксированный каркас: статичный хедер/левый сайдбар, статичный правый сайдбар тредов, скролл только в области сообщений, композер закреплён внизу.
3. Кнопка сворачивания сайдбара тредов с сохранением состояния в localStorage.

## Проверено по коду/либе (факты, на которые опирается план)

- `@assistant-ui/react` 0.15.31, `packages/react/src/primitives/composer/ComposerInput.tsx`: в `handleKeyPress` Shift+Enter → `return` (браузер вставляет `\n` сам, onChange обновляет состояние), Ctrl/Cmd+Enter в режиме `"enter"` → `requestSubmit()`; обработчики собираются как `composeEventHandlers(onKeyDown, handleKeyPress)` (строка 441) — **наш** `onKeyDown`-проп выполняется первым, и `preventDefault()` в нём отменяет встроенную отправку (radix `composeEventHandlers` уважает `defaultPrevented`). Значит нужного режима (`Enter`=send, `Ctrl+Enter`=newline) не требует правки либы — достаточно своего `onKeyDown`.
- Текст композера в либе контролируемый: `value = useComposerInputValue()` (`s.composer.text`, строка 212), onChange → `aui.composer.setText(e.target.value, { origin: "user" })`. Прямой `textarea.setRangeText()` без `setText` разъедется с состоянием → вставляем через `aui.composer.setText`.
- `useAui` и `useAuiState` ре-экспортируются из `@assistant-ui/react` (`packages/react/src/index.ts:4-17`), `aui.composer.setText(value, options)` — есть в api-surface (строки 1148/1871/1899).
- Высота textarea: либа рендерит `TextareaAutosize` и пересчитывает высоту от `value` — после `setText` автоувеличение работает само.
- Каркас: `web/src/components/ui/sidebar.tsx:145` — `SidebarProvider`-wrapper `flex min-h-svh w-full` (не ограничивает высоту), `:315` — `SidebarInset` `flex w-full flex-1 flex-col` без height; левый сайдбар уже `fixed inset-y-0 h-svh` (строка 238) — его трогать не нужно. Скроллится body → уезжают хедер и композер.
- `SidebarProvider`/`SidebarInset` имеют проп `className`, склеиваемый через `cn` (tailwind-merge) → **правки `ui/sidebar.tsx` не нужны** (сохраняем локальные переопределения shadcn-компонента, lesson-73; ширину/layout фиксируем в layout-слое, lesson-72).
- Референс сворачивания: `ref-22 .../examples/clone-thread-shell.tsx:108-175` — `w-12 ↔ w-65`, `transition-[width]`, `PanelLeftIcon` в хедере, `inert={sidebarCollapsed}` + `opacity-0 pointer-events-none` на содержимом.
- `PanelLeftIcon` из `lucide-react` уже используется в `web/src/components/ui/sidebar.tsx:26` — в lucide-react 1.49 присутствует (lesson-15 не применим).

## Файлы к изменению (все существуют)

1. `web/src/components/chat/thread.tsx`
2. `web/src/components/chat/thread-sidebar.tsx`
3. `web/src/App.tsx`
4. `web/src/components/preferences.tsx`
5. `README.md` (раздел «Веб-чат (#/chat)» — раскладка клавиш и поведение каркаса)

`web/src/components/ui/sidebar.tsx` — **не меняем**.

## Порядок действий

### Шаг 1. Ctrl/Cmd+Enter = перенос строки (`thread.tsx`)

1. Импорты: добавить `useAui` в импорт из `"@assistant-ui/react"` (блок строк 30-38).
2. Новый хук рядом с `EditComposer` (перед строкой 242):

```tsx
/**
 * Ctrl/Cmd+Enter вставляет перенос строки вместо отправки (VL-263).
 * В либе нет режима «Enter=send, Ctrl+Enter=newline» (submitMode: enter|ctrlEnter|none),
 * поэтому перехватываем сочетание до встроенного обработчика: свой onKeyDown
 * выполняется первым (composeEventHandlers), preventDefault гасит requestSubmit.
 */
function useCtrlEnterNewline() {
  const aui = useAui()
  const caretRef = React.useRef<number | null>(null)
  // позиция каретки после программной вставки (layout effect — до отрисовки)
  // ... apply on value change: textarea.setSelectionRange(caret, caret); caretRef.current = null
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { ... }
  return { onKeyDown }
}
```

логика `onKeyDown`:
- `if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.shiftKey) return` (Shift+Ctrl+Enter — «steer» либы, не перехватываем);
- `e.preventDefault()`, `e.stopPropagation()` не нужен;
- `const el = e.currentTarget; const start = el.selectionStart ?? el.value.length; const end = el.selectionEnd ?? start;`
- `const next = el.value.slice(0, start) + "\n" + el.value.slice(end);`
- `caretRef.current = start + 1`; `aui.composer.setText(next, { origin: "user" })`;
- `React.useLayoutEffect` на изменение `aui state`/`value`: если `caretRef.current !== null` и есть `textareaRef` — `setSelectionRange` и сброс. Практичнее: держать `ref` на textarea (проп `ref` пробрасывается в `ComposerPrimitive.Input`) и применять каретку в `useLayoutEffect` с зависимостью `[text]`, где `text = useAuiState(s => s.composer.text)`.

3. Применить хук в `Composer` (строки 321-341: `const { onKeyDown } = useCtrlEnterNewline()` + `onKeyDown={onKeyDown}` в `ComposerPrimitive.Input`) и в `EditComposer` (строки 242-256 — то же).
4. `submitMode` не передаём — дефолт `"enter"` (plain Enter отправляет, Shift+Enter переносит) остаётся.
5. Подсказки: в `EmptyState` (строка 363) и в `ChatThread` (строка 403) placeholder → `"Спросите по проекту… (Enter — отправить, Ctrl+Enter — перенос строки)"`; ту же фразу добавить в текст EmptyState не нужно (достаточно placeholder, AC3).

### Шаг 2. Фиксированный каркас (`App.tsx`)

- Строка 60: `<SidebarProvider className="h-svh min-h-0 overflow-hidden">` (tailwind-merge перекроет `min-h-svh` на `min-h-0`, добавит `h-svh`).
- Строка 61: `<SidebarInset className="h-full min-h-0 min-w-0 overflow-x-clip overflow-hidden">`.
  - Для `variant=inset`/`floating` у `SidebarInset` есть `md:peer-data-[variant=inset]:m-2` — при `h-full` снизу обрежется 2px: добавить компенсатор `md:peer-data-[variant=inset]:h-[calc(100%-1rem)]` в тот же className.
- Строки 71-75 (`<main>`): оставить `min-h-0 min-w-0 flex-1 overflow-x-hidden`, ветку чата — `overflow-hidden`, остальные — `overflow-y-auto p-2` (текущее поведение сохраняется, только теперь область реально ограничена высотой).
- `html/body` не трогаем: wrapper `h-svh overflow-hidden` сам убирает скролл документа.

### Шаг 3. Сайдбар тредов: статичность + сворачивание (`thread-sidebar.tsx`)

- Строка 141 (`aside`): `hidden w-64 shrink-0 flex-col border-l bg-muted/30 md:flex` → `h-full min-h-0 shrink-0 overflow-hidden border-l bg-muted/30 transition-[width] duration-200 md:flex`; ширина из состояния: `collapsed ? "w-12" : "w-64"`.
- Строка 145 (шапка «Чаты», h-12): `h-12 shrink-0` уже есть; добавить кнопку-переключатель слева: `Button size="icon" variant="ghost" className="size-7"` с `<PanelLeftIcon className="size-4" />`, `aria-label="Свернуть список чатов"/"Развернуть…"`, `tooltip` через существующий `Tooltip*` (TooltipProvider уже смонтирован в SidebarProvider, VL-160). Текст «Чаты» и кнопку «Новый» скрывать при `collapsed` (`max-w-0 opacity-0 overflow-hidden` по паттерну ref-22), «Новый» в свёрнутом виде — только иконка `Plus`.
- `ModelSwitcher` (строки ~68-97): при `collapsed` не рендерить (или обернуть в `inert` + `opacity-0 pointer-events-none`).
- Строка 159 (`nav`): `flex-1 overflow-y-auto p-2` → `min-h-0 flex-1 overflow-y-auto p-2`, при `collapsed` — `aria-hidden`, `inert`, `opacity-0 pointer-events-none`.
- Состояние через `usePreferences()`: `values.chat_threads_collapsed` (см. шаг 4), переключение `setPreference("chat_threads_collapsed", !ed)`.

### Шаг 4. Preferences (`preferences.tsx`)

- `LayoutPreferences` + `chat_threads_collapsed: boolean`; дефолт `false`; в `loadPreferences` валидация `typeof record.chat_threads_collapsed === "boolean"` с fallback на дефолт (битый JSON не должен ронять UI). Ключ localStorage остаётся `vibelog-layout-prefs` (AC9), шапка файла — дополнить комментарием о новом поле.

### Шаг 5. Документация (`README.md`)

В разделе «Веб-чат (#/chat)» добавить абзац: раскладка клавиш (Enter — отправить, Shift+Enter — перенос, Ctrl/Cmd+Enter — перенос), каркас (хедер и сайдбары статичны, скролл — только лента сообщений + список тредов) и кнопка сворачивания сайдбара тредов с сохранением в `vibelog-layout-prefs`.

## Проверка

```bash
# свежий worktree: зависимости web не установлены (lesson-6)
pnpm --dir web install        # если web/node_modules отсутствует
pnpm --dir web build          # tsc -b && vite build (AC11)
pnpm --dir web lint           # eslint (AC11)
pnpm test:fast                # регрессии src/ (web-кода не касается, но DoD «Тесты проходят»)
```

Браузерная проверка (dev: `npx vite` в `web/` или `vibelog browser`), **короткими шагами** (lesson-27), через `evaluate_script` (lesson-25: клик и чтение DOM — разными вызовами; Radix-кнопки — полной pointer-последовательностью, lesson-71):
1. `#/chat/<id>`: ввести текст, нажать Ctrl+Enter → в textarea `\n` на позиции каретки, `Загрузка/отправка` не началась; Enter → сообщение отправлено; Shift+Enter → перенос.
2. Проверить `document.documentElement.scrollHeight === document.documentElement.clientHeight` (нет скролла body) на `#/`, `#/tasks`, `#/settings`, `#/chat`; у `main`/viewport вычислить `scrollHeight > clientHeight` на чате.
3. Прокрутить ленту большого треда → `composer` (ViewportFooter) остаётся видим (`getBoundingClientRect().bottom ≈ window.innerHeight`), `header` на `top: 0`.
4. Кнопка сворачивания: `aside` width 192 ↔ 48 px, содержимое `opacity 0`, после перезагрузки и перехода на другую страницу состояние сохраняется (`localStorage["vibelog-layout-prefs"]`).
5. Пустой новый тред (`#/chat/new`): композер по центру (AC10).

## Риски и митигации

1. **`SidebarInset` вариант `inset`/`floating`**: `md:...:m-2` + `h-full` → обрезка/переполнение по вертикали. Митигация: `md:peer-data-[variant=inset]:h-[calc(100%-1rem)]`; проверить все три `sidebar_variant` через `LayoutControls`.
2. **Каретка при Ctrl+Enter**: `setText` вызывает перерендер контролируемого textarea → без восстановления каретка уедет в конец. Митигация: `caretRef` + `useLayoutEffect` по `composer.text`; если в браузере остаётся рассинхрон — fallback на `el.setRangeText("\n")` + `aui.composer.setText(el.value)` (чтение после нативной вставки); проверить вставку в середину строки и на выделенном диапазоне (заменяется).
3. **Конфликт с «steer» (Ctrl/Shift+Enter) и IME**: хук игнорирует `shiftKey` и `e.nativeEvent.isComposing`; в либе IME отсекается отдельно.
4. **`overflow-hidden` на каркасе может скрыть фокус-рамки/попапы (Select, Tooltip)**: Radix рендерит порталы в body — не задевается; если поповер обрежется, поднять z-index/портал (проверить `ModelSwitcher` и `LayoutControls`).
5. **`vibelog-layout-prefs` в старой схеме** (без нового поля) — валидатор дополнить, дефолт `false`; иначе у пользователя сбросится «свёрнутость».
6. **Список тредов при `collapsed`**: `inert` в React 19 — валидный атрибут (`inert={collapsed}`); если TS-типы ругаются, использовать `{...(collapsed ? { inert: "" } : {})}`.
7. **Регрессия остальных страниц**: `main` перестал быть скролл-контейнером документа только на уровне `SidebarInset`; списковым страницам нужен `min-h-0 flex-1 overflow-y-auto` (уже есть) — проверить длинные списки (`#/tasks`, `#/documents`, `#/lessons`), lesson-14.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 14:32
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в задачу.
Изучено: `web/src/components/chat/thread.tsx` (композеры 242-256 / 321-341, EmptyState 354-368, ChatThread 370-408), `web/src/components/chat/thread-sidebar.tsx`, `web/src/App.tsx` (каркас 60-75), `web/src/components/preferences.tsx`, `web/src/components/ui/sidebar.tsx` (SidebarProvider 145, SidebarInset 315, Sidebar слот 238) + исходники ref-22 в `backlog/references/data/assistant-ui/` (ComposerInput.tsx, api-surface, clone-thread-shell.tsx).
Ключевые решения:
1. Ctrl/Cmd+Enter = перенос: своего режима в либе нет (`submitMode: enter|ctrlEnter|none`), но `composeEventHandlers(onKeyDown, handleKeyPress)` выполняет наш проп первым и уважает `defaultPrevented` — хук `useCtrlEnterNewline` с `preventDefault` + вставка `\n` через `aui.composer.setText` (контролируемое значение `s.composer.text`) и восстановлением каретки в `useLayoutEffect`. Применяется и в `Composer`, и в `EditComposer`; Enter/Shift+Enter остаются дефолтными.
2. Каркас: правки только в layout-слое (`App.tsx`: `SidebarProvider h-svh min-h-0 overflow-hidden`, `SidebarInset h-full min-h-0 overflow-hidden` + компенсатор для `variant=inset/floating`), `ui/sidebar.tsx` НЕ трогаем (lesson-72/73); левый сайдбар уже `fixed h-svh`. Сайдбар тредов: `aside h-full min-h-0 overflow-hidden`, `nav min-h-0 flex-1 overflow-y-auto`.
3. Сворачивание: `w-12 ↔ w-64` + `transition-[width]`, `PanelLeftIcon` в шапке «Чаты», `inert`/`opacity-0` на содержимом (паттерн clone-thread-shell.tsx:108-175), состояние — новое поле `chat_threads_collapsed` в `vibelog-layout-prefs` (`preferences.tsx`).
Файлов к изменению: 5 (`thread.tsx`, `thread-sidebar.tsx`, `App.tsx`, `preferences.tsx`, `README.md`).
Риски (в плане): 1) обрезка `SidebarInset` при `variant=inset` из-за `md:...:m-2` — компенсатор `calc(100%-1rem)`, проверить все три варианта; 2) каретка после `setText` (контролируемая textarea) — `caretRef` + `useLayoutEffect`, fallback `setRangeText`; 3) игнор `shiftKey`/IME, чтобы не сломать «steer» и ввод иероглифов; 4) старые данные в localStorage без нового поля — дефолт `false`; 5) регрессия списковых страниц после смены скролл-контейнера (lesson-14).
Проверка: `pnpm --dir web build`, `pnpm --dir web lint`, `pnpm test:fast`; браузерная верификация короткими шагами через `evaluate_script` (скролл body = 0, положение композера/хедера, ширина aside, сохранение состояния).
---
author: @agent
created: 2026-10-30 15:14
---
Фаза code не удалась (код выхода 1): ences.tsx×2, payload последнего запроса=392281 байт (макс 392281), usage={"input_tokens":4432218,"output_tokens":13362,"cache_read_input_tokens":4392448,"total_tokens":4445580,"reasoning_tokens":5174} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 16:12
---
Фаза 3 (Code) выполнена. Коммит 837508f.
Изменено:
- `web/src/components/chat/thread.tsx` — хук `useCtrlEnterNewline` (свой `onKeyDown` + `aui.composer.setText` с вставкой `\n` в позицию каретки, восстановление каретки в `useLayoutEffect`, игнор Shift/Alt/IME), подключён в `Composer` и `EditComposer`; placeholder «Enter — отправить, Ctrl+Enter — перенос строки» в обоих композерах/пустом состоянии.
- `web/src/App.tsx` — каркас: `SidebarProvider h-svh min-h-0 overflow-hidden`, `SidebarInset h-full min-h-0 overflow-hidden` + `md:peer-data-[variant=inset]:h-[calc(100%-1rem)]`.
- `web/src/components/chat/thread-sidebar.tsx` — `aside h-full min-h-0 overflow-hidden transition-[width]`, `w-64 ↔ w-12`, кнопка `PanelLeftIcon` с tooltip (Radix TooltipProvider уже в SidebarProvider), «Чаты»/«Новый» скрываются (`max-w-0 opacity-0`), отдельная иконка «+» в свёрнутом виде, `nav min-h-0 flex-1 overflow-y-auto`, содержимое при свёрнутости `inert`/`opacity-0`.
- `web/src/components/preferences.tsx` — поле `chat_threads_collapsed` (дефолт `false`, валидация старой схемы localStorage).
- `README.md` — раздел «Веб-чат (#/chat)»: раскладка клавиш, каркас/скроллы, кнопка сворачивания.
- `web/dist/*` — пересобрано (`npm run build`).
Проверки:
- `web: npm run build` (tsc -b && vite build) — OK; `npm run lint` (eslint) — OK.
- Полный `pnpm test`: 97 файлов, 1803 passed, 4 skipped + `src/web/static.test.mjs` 7 passed — без исключений.
- Браузер (chrome-devtools, `vibelog browser` :3030, короткими шагами):
  1) главный композер: Ctrl+Enter → `"hello\n"` (каретка 6), вставка в середину → `"he\nllo\nworld"` (каретка 3), Shift+Enter → `\n`, высота textarea 36→72px (автоувеличение), Enter → сообщение отправлено; EditComposer: Ctrl+Enter → `"Тесто\nвый вопрос про проект"` (каретка 6) — встроенная отправка не срабатывает;
  2) `#/`, `#/settings`, `#/config`, `#/references`, `#/documents`, `#/lessons`, `#/tasks`, `#/chat`: `documentElement.scrollHeight - clientHeight = 0`, `header.top = 0`;
  3) тред из 51 сообщения: `scrollHeight 5882 / clientHeight 644`, при `scrollTop` 5238→0 композер остаётся на месте (top 631, bottom 676 при окне 692), хедер на 0;
  4) 31 тред в списке: `nav` скроллится (`1814/596`), хедер сайдбара «Чаты» неподвижен (top 48), `aside` высотой 644 (не растягивается контентом);
  5) кнопка сворачивания: 256px → 48px, `data-state=collapsed`, `nav opacity 0` + `inert`, localStorage `{"chat_threads_collapsed":true}`; после перезагрузки и перехода `#/chat → #/tasks → #/chat` состояние сохраняется, разворот — обратно в 256px;
  6) вариант `sidebar_variant`: `sidebar` (inset 692h), `inset` (676h, top 8), `floating` (692h) — обрезки нет;
  7) `#/chat/new`: композер по центру (центр 393 при окне 692), пустое состояние не сломано.
Что не сделано/особенности: реальный ответ LLM в чате не получен — в окружении нет `VIBELOG_LLM_API_KEY` (ошибка приходит из бэкенда, к вёрстке не относится); функциональность отправки/истории проверена на локально созданном jsonl-треде (`vl263test`, удалён после проверки).
---
author: @agent
created: 2026-10-30 16:19
---
Фаза close не удалась (код выхода 1): оп-повторов=нет, payload последнего запроса=146889 байт (макс 146889), usage={"input_tokens":710365,"output_tokens":2750,"cache_read_input_tokens":616448,"total_tokens":713115,"reasoning_tokens":1192} — статус возвращён к Review.
---
author: @agent
created: 2026-10-30 16:27
---
Фаза Close выполнена. Ветка vb/vl-263 (коммит 837508f) слита в master через `merge --no-ff` — 1 коммит, 9 файлов; конфликтов без (README.md авто-слит). Worktree `.vibelog/worktrees/vl-263` удалена с `--force` (в ней были только untracked-симлинки `node_modules` и `backlog/references/data` — данные не теряются), ветка `vb/vl-263` удалена `-d`.
Проверки после merge: `pnpm build` — OK; полный `pnpm test` — 97 файлов, 1814 passed, 4 skipped + `src/web/static.test.mjs` 7 passed, падений нет (ранний точечный фильтр не требовался: diff затронул только `web/` и README, ядро `src/` не менялось, но полный прогон выполнен как обязательный).
DoD: все 3 пункта выполнены (тесты проходят, документация обновлена, регрессий нет). CHANGELOG.md — запись в Unreleased (dcb909e), README-раздел «Веб-чат» обновлён в самой ветке. Lessons: lesson-111 (перехват нестандартных клавиш композера assistant-ui через свой onKeyDown + preventDefault), lesson-112 (ограничение каркаса по высоте: h-svh/overflow-hidden/min-h-0 в цепочке flex), закоммичены в 8ef7997. Изменённые файлы: web/src/components/chat/thread.tsx, web/src/components/chat/thread-sidebar.tsx, web/src/App.tsx, web/src/components/preferences.tsx, README.md, web/dist/*.
---
<!-- COMMENTS:END -->