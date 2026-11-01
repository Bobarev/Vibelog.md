---
id: VL-282
title: 'Веб-чат: список тредов на мобильном — Sheet/drawer вместо скрытого aside'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 20:02'
updated_date: '2026-11-01 20:49'
due_date: ''
labels:
  - web
  - chat
  - mobile
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/components/chat/thread-sidebar.tsx
  - web/src/components/chat/thread.tsx
  - README.md
lessons:
  - lesson-148
token_usage:
  input: 6535303
  output: 43021
  cache: 6391296
  total: 6578324
  requests: 106
  duration_ms: 971913
  reasoning: 17574
  by_phase:
    plan:
      input: 544309
      output: 9977
      cache: 509952
      requests: 13
    code:
      input: 5210863
      output: 29494
      cache: 5131776
      requests: 74
    close:
      input: 780131
      output: 3550
      cache: 749568
      requests: 19
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Пользователь: «Открываю вкладку чат на мобильном и не вижу сайдбара чата (правого)».

Причина в коде: `web/src/components/chat/thread-sidebar.tsx:80-85` — у `aside` класс `hidden h-full ... md:flex`, то есть ниже брейкпоинта `md` (768px) сайдбар тредов не рендерится вообще. Альтернативы (drawer/sheet) нет, поэтому на мобильном недоступен список тредов: нельзя ни выбрать существующий тред, ни создать новый через кнопку «Новый» (остаются только прямые hash-ссылки `#/chat/<id>`).

Смежное: свёрнутость сайдбара живёт в `preferences` (`chat_threads_collapsed`, VL-263) и на мобильном неприменима — в drawer свёрнутый вид (`w-12`) смысла не имеет.

## Цель

Дать доступ к списку тредов на мобильном: кнопка в шапке чата открывает треды в выезжающей панели (`Sheet`), на десктопе остаётся прежний `aside`.

## Входные данные

- `web/src/components/chat/thread-sidebar.tsx` — компонент `ThreadSidebar` (`aside` с `hidden ... md:flex`, шапка с кнопкой сворачивания, кнопка «Новый», `nav` со списком из `GET /api/chat/threads`).
- `web/src/components/chat/thread.tsx:733` — точка подключения `ThreadSidebar` в `ChatPage` (`<div className="flex h-full min-h-0">` → тред + сайдбар справа).
- `web/src/components/ui/sheet.tsx` — shadcn Sheet уже в проекте (готовый примитив для drawer).
- `web/src/components/ui/sidebar.tsx` — основной app-sidebar (shadcn), у него есть собственный мобильный вариант; проверить, можно ли переиспользовать его механизм вместо второго паттерна.
- `web/src/components/preferences.tsx` — `chat_threads_collapsed`.
- `web/src/components/chat/thread-sidebar.tsx` — кнопка «Новый» вызывает `onNewThread` → `window.location.hash = "#/chat/new"`; в drawer после выбора треда/нового треда панель должна закрываться.

## Открытые вопросы

- Переиспользовать `ui/sidebar` (есть мобильный Sheet-вариант) или отдельный `Sheet` только для чата — решить в плане.
- Где разместить кнопку открытия на мобильном: в шапке страницы чата (сейчас отдельной шапки у чата нет) или плавающей кнопкой у композера.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 На ширине < md список тредов доступен: кнопка открывает выезжающую панель (Sheet/drawer) со списком тредов и кнопкой «Новый»
- [x] #2 На ширине ≥ md поведение прежнее: сайдбар справа, без регрессий по свёрнутости (chat_threads_collapsed) и подсветке активного треда
- [x] #3 Выбор треда в drawer закрывает панель и переводит hash на #/chat/<id>; кнопка «Новый» закрывает панель и ведёт на #/chat/new
- [x] #4 В drawer нет свёрнутого вида (w-12) — панель всегда развёрнута, кнопка сворачивания на мобильном не показывается
- [x] #5 Панель обязана сохранять доступность (aria-label у кнопки открытия, закрытие по Esc и клику по оверлею — средствами Sheet)
- [x] #6 Сборка фронта проходит: cd web && npm run build и npm run lint — без ошибок; README (§Веб-чат) описывает мобильное поведение
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решения (из «Открытых вопросов»)

1. **Отдельный `Sheet` для чата, а не `ui/sidebar`.** `SidebarProvider`/`Sidebar` управляют ЛЕВЫМ app-sidebar (один `openMobile`, cookie-состояние, `toggleSidebar`, хоткей Ctrl/Cmd+B). Второй экземпляр внутри `SidebarProvider` подменил бы глобальное состояние раскладки, а вынос провайдера в чат потребовал бы менять layout-слой (`App.tsx`, `ui/sidebar.tsx`) — прямой риск регрессии (lesson-72, lesson-73). `web/src/components/ui/sheet.tsx` уже в проекте (Radix Dialog: оверлей, Esc, focus-trap, `data-open/closed`-анимации, кнопка закрытия + `sr-only` подпись) — берём его и не трогаем `ui/sidebar.tsx`/соседние потребители (lesson-73).
2. **Кнопка открытия — в компактной шапке чата, а не плавающей у композера.** `md:hidden`-шапка высотой `h-12` над лентой: не перекрывает композер/`ScrollToBottom`, не ломает инвариант «композер закреплён внизу» (lesson-112), даёт место для подписи. Плавающая кнопка конфликтовала бы с кнопкой прокрутки вниз в `ViewportFooter`.
3. **Мобильный вид тредов = всегда развёрнутый.** В drawer `collapsed` принудительно `false`, кнопка `PanelLeft`-сворачивания не рендерится (`showCollapse={false}`), preference `chat_threads_collapsed` читается, но на мобильном не применяется (AC4). Десктопный `aside` продолжает читать `chat_threads_collapsed` (AC2).

## Файлы и правки

### `web/src/components/chat/thread-sidebar.tsx` (основная работа, ~190 строк)

Сейчас: данные (`threads`/`failed`/`refresh` + effect, стр. 61–82) и вся разметка (шапка стр. 96–137, `nav` стр. 138–190) живут внутри одного `aside`. Разделить на переиспользуемые части, не меняя поведение десктопа:

1. **Хук данных `useThreadList(activeThreadId)`** — стр. 61–82 (`useState`+`refresh`+`useEffect` c 600-мс повтором) вынести как есть. Возвращает `{ threads, failed }`. Причина — и `aside`, и drawer должны показывать одинаковый список (fetch на монтирование/смену треда, дебаунс-повтор под новый jsonl).
2. **`ThreadListBody({ threads, failed, activeThreadId, onNewThread, onSelect })`** — вынести разметку шапки и `nav` (стр. 96–190) минус всё, что зависит от `collapsed`; в nav-ссылку добавить `onClick={onSelect}` (в `aside` не передаётся).
3. **`ThreadListHeaderActions` / collapsed-ветки** — сохранить в десктопном `aside` как есть: `PanelLeft` через `setPreference("chat_threads_collapsed", …)`, `max-w-0 opacity-0` у «Чаты», «+»-строка под шапкой при `collapsed`, `inert`/`opacity-0` на `nav`.
4. **`ThreadSidebar` (десктоп, существующий экспорт)** — `aside` оставить в текущих классах стр. 88–93 (`hidden … md:flex`, `w-64 ↔ w-12` по `chat_threads_collapsed`), внутри — `useThreadList` + прежняя шапка + `nav`. **Никаких изменений класс��в `aside`** (AC2: регрессии по свёрнутости/подсветке быть не должно).
5. **Новый экспорт `ThreadSidebarSheet({ open, onOpenChange, activeThreadId, onNewThread })`** — тоньше:
   ```tsx
   <Sheet open={open} onOpenChange={onOpenChange}>
     <SheetContent side="right" className="w-72 max-w-[85vw] gap-0 p-0 md:hidden">
       <SheetTitle className="sr-only">Треды чата</SheetTitle>
       {/* шапка как в aside, но без PanelLeft-кнопки */}
       {/* nav из ThreadListBody, onSelect={() => onOpenChange(false)} */}
     </SheetContent>
   </Sheet>
   ```
   - `md:hidden` на `SheetContent` — страховка от открытия на десктопе.
   - `SheetTitle` обязателен (Radix требует title для a11y — иначе warning и пустой accessible name); он `sr-only`, видимый заголовок «Чаты» остаётся в шапке панели.
   - Esc / клик по оверлею / крестик — штатные средства `SheetContent` (AC5), своего кода не писать.
   - Закрытие после выбора: `onSelect` → `onOpenChange(false)`; кнопка «Новый» в drawer → `onNewThread()` (hash → `#/chat/new`) + `onOpenChange(false)` (AC3).
   - Список грузится через `useThreadList` при каждом открытии (Radix монтирует `SheetContent` только при `open`) — заодно подхватывает свежие треды.

### `web/src/components/chat/thread.tsx`

6. Импорт (стр. 68): `import { ThreadSidebar, ThreadSidebarSheet, type ThreadSummary } from "./thread-sidebar"`; добавить `PanelLeftIcon` в список lucide-импортов (стр. 46–57) и `useIsMobile` из `@/hooks/use-mobile`.
7. **`ChatPage` (стр. 710–745)**: сейчас `<div className="flex h-full min-h-0">` — обернуть:
   ```tsx
   <div className="flex h-full min-h-0 flex-col">
     {/* Мобильная шапка (VL-282): кнопка «Чаты» открывает Sheet */}
     <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:hidden">
       <Button size="icon" variant="ghost" aria-label="Открыть список чатов"
               onClick={() => setThreadsOpen(true)}>
         <PanelLeftIcon className="size-4" />
       </Button>
       <span className="text-sm font-medium">Чаты</span>
     </div>
     <div className="flex min-h-0 flex-1">
       … тред … <ThreadSidebar … />
     </div>
     <ThreadSidebarSheet open={threadsOpen} onOpenChange={setThreadsOpen}
                         activeThreadId={…} onNewThread={…} />
   </div>
   ```
   - `activeThreadId` и `onNewThread` — те же выражения, что сейчас передаются в `ThreadSidebar`: вынести в локальные `const`s, чтобы не дублировать условие `typeof hashThreadId === "string" && hashThreadId !== "new" ? … : load.runtimeThreadId ?? null`.
   - `const [threadsOpen, setThreadsOpen] = React.useState(false)` + эффект: `isMobile === false → setThreadsOpen(false)` (защита от «залипшей» панели при ресайзе/повороте экрана; `useIsMobile` — `web/src/hooks/use-mobile.ts`, брейкпоинт 768 совпадает с `md`).
   - `min-h-0` остаётся на каждом уровне flex-цепочки (lesson-112): на мобильном высота шапки `h-12 shrink-0` + `flex-1 min-h-0` у контента, скролл — по-прежнему только внутри `ThreadPrimitive.Viewport`.

### `README.md` (§ «Веб-чат», пункт «Треды и навигация», стр. 261–270)

8. Дописать абзац: на ширине < `md` (768px) список тредов скрыт, в шапке чата появляется кнопка «Открыть список чатов» (`aria-label`), которая открывает треды в выезжающей панели справа (`Sheet`, оверлей, Esc/крестик); выбор треда и кнопка «Новый» закрывают панель и меняют hash (`#/chat/<id>` / `#/chat/new`); свёрнутый вид `w-12` на мобильном не применяется — панель всегда развёрнута, `chat_threads_collapsed` действует только на десктопе.

## Порядок действий

1. `thread-sidebar.tsx`: вынести `useThreadList`, затем `ThreadListBody`, прогнать `tsc --noEmit` — десктопный `aside` обязан остаться байт-в-байт по разметке/классам.
2. Добавить `ThreadSidebarSheet`.
3. `thread.tsx`: мобильная шапка + state + вынос `activeThreadId`/`onNewThread` в консты, подключить `ThreadSidebarSheet`.
4. README.
5. Проверки (см. ниже), браузерная проверка мобильной ширины.

## Как проверить

```bash
cd web && npm install        # свежий worktree — dev-зависимости Vite не установлены (lesson-6)
cd web && npm run build && npm run lint
pnpm test                    # полный прогон из корня, закрывает DoD «Тесты проходят»
```

Браузер (`vibelog browser` + chrome-devtools, `evaluate_script`, без скриншотов):
- ширина 390px: `#/chat` — кнопка с `aria-label="Открыть список чатов"` видима, десктопный `aside` не рендерится (`getComputedStyle(aside).display === "none"`); клик по кнопке (полная pointer-последовательность — lesson-71) → `[data-slot="sheet-content"]` присутствует, в нём есть пункты тредов и кнопка «Новый»; `Esc` закрывает, клик по оверлею закрывает; клик по треду → `location.hash === "#/chat/<id>"` и sheet закрыт; «Новый» → `#/chat/new` и sheet закрыт.
- ширина 1280px: кнопки в шапке чата нет, `aside` на месте, свёрнутость `w-12`/`w-64` и подсветка активного треда (`aria-current`) — как до правки; `documentElement.scrollHeight === clientHeight` (инвариант lesson-112).

## Риски

- **Двойной fetch списка**: на мобильном `SheetContent` монтируется при открытии → второй `GET /api/chat/threads` рядом с десктопным `aside` (который на мобильном `hidden`, но смонтирован и тоже фетчит). Приемлемо (лёгкий эндпоинт, только на мобильном и только при открытой панели); если станет заметно — рендерить `aside`/Sheet по `useIsMobile`, но это лишний риск регрессии desktop — не в этой задаче.
- **Radix Dialog требует `SheetTitle`** — пропуск даёт warning в консоли и пустой accessible name; поэтому `sr-only` title обязателен (AC5).
- **Фокус-ловушка Sheet**: после закрытия фокус возвращается на кнопку открытия; в drawer нет `nav`-`inert` — не переносить collapsed-ветки в мобильную панель, иначе получим недоступный список.
- **`hidden … md:flex` на `aside` + `md:hidden` на шапке** должны опираться на один брейкпоинт (`md` = 768px = `MOBILE_BREAKPOINT` в `use-mobile.ts`) — при рассинхроне возможен кадр без доступа к тредам; держать оба на `md`.
- **Регрессия каркаса** (lesson-112): добавление шапки меняет flex-цепочку `ChatPage` — обязательна проверка `min-h-0` на новом промежуточном `div` и неизменного положения композера.
- **`web/dist` в репозитории**: правки только исходников, `dist` пересобирается `pnpm web:build` при merge (lesson-28).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 20:32
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача, не эпик) — план записан в VL-282.
**Решения по открытым вопросам:**
1. Берём отдельный `web/src/components/ui/sheet.tsx`, а НЕ `ui/sidebar` — SidebarProvider/useSidebar делят одно глобальное состояние левого app-sidebar (openMobile, cookie, Ctrl/Cmd+B), второй экземпляр его подменил бы (риск регрессии layout, lesson-72/73). Sheet = Radix Dialog: оверлей, Esc, focus-trap, анимации, sr-only подпись — AC5 закрывается штатно.
2. Кнопка открытия — в компактной `md:hidden`-шапке `h-12` над лентой чата (не плавающая у композера: не конфликтует с `ScrollToBottom`, не ломает инвариант «композер внизу» из lesson-112).
3. В drawer всегда развёрнутый вид: `collapsed=false`, кнопка `PanelLeft` не рендерится, `chat_threads_collapsed` действует только на десктопе (AC4).
**Объём плана (3 файла):**
- `web/src/components/chat/thread-sidebar.tsx` — вынести `useThreadList(activeThreadId)` (fetch + 600мс повтор) и `ThreadListBody` (шапка+`nav`), сохранить десктопный `aside` с текущими классами (стр. 88–93) без изменений, добавить новый экспорт `ThreadSidebarSheet` (`SheetContent side="right" w-72 max-w-[85vw] gap-0 p-0 md:hidden` + `sr-only SheetTitle`); `onSelect` у ссылки треда закрывает панель, «Новый» → hash `#/chat/new` + закрытие (AC1/AC3/AC4/AC5).
- `web/src/components/chat/thread.tsx` — мобильная шапка (`aria-label="Открыть список чатов"`, `PanelLeftIcon`), `useState(threadsOpen)` + `useIsMobile`-эффект на закрытие при ресайзе, вынос `activeThreadId`/`onNewThread` в консты, подключение `ThreadSidebarSheet`; `min-h-0` сохранён на каждом уровне flex-цепочки.
- `README.md` (§Веб-чат, «Треды и навигация») — абзац про мобильное поведение.
**Проверки в плане:** `cd web && npm install` (lesson-6) → `npm run build` → `npm run lint`; полный `pnpm test` из корня; браузерная проверка на 390px (Sheet открывается/закрывается по Esc и оверлею, выбор треда и «Новый» меняют hash и закрывают панель) и 1280px (регрессии нет: `aside`, `w-12/w-64`, `aria-current`, `scrollHeight === clientHeight`).
**Риски:** двойной fetch списка на мобильном (aside смонтирован, но hidden) — принято, эндпоинт лёгкий; обязателен `sr-only SheetTitle` (иначе Radix-warning и пустой accessible name); не переносить collapsed-ветки/`inert` в мобильную панель; оба брейкпоинта держать на `md`=768, чтобы не было кадра без доступа к тредам; `web/dist` — пересборка при merge (lesson-28).
---
author: @agent
created: 2026-11-01 20:45
---
Фаза 3 (Code) выполнена. Коммит `cc23131` — «feat: VL-282 — список тредов чата на мобильном в выезжающей панели Sheet».
**Изменено:**
- `web/src/components/chat/thread-sidebar.tsx` — разложен на слои: `useThreadList(activeThreadId)` (fetch + 600-мс дебаунс-повтор, как было), `ThreadListNav({threads, failed, activeThreadId, collapsed, onSelect})` (общий `nav` с `inert`/`opacity` при свёрнутости), `NewThreadButton`; десктопный `ThreadSidebar` сохранил классы `aside` (`hidden … md:flex`, `w-64 ↔ w-12`, `data-state`) и всё поведение VL-263 без изменений. Новый экспорт `ThreadSidebarSheet({open, onOpenChange, activeThreadId, onNewThread})` — `Sheet`/`SheetContent side="right"` с `w-72 max-w-[85vw] gap-0 p-0 md:hidden`, `sr-only` `SheetTitle`+`SheetDescription`, внутри `ThreadSheetBody`: шапка «Чаты» + «Новый» (без кнопки сворачивания) и тот же `ThreadListNav` с `onSelect` → закрытие панели.
- `web/src/components/chat/thread.tsx` — `ChatPage`: мобильная шапка `h-12 shrink-0 md:hidden` с кнопкой `PanelLeftIcon` (`aria-label="Открыть список чатов"`, `aria-expanded`), `useState(threadsOpen)` + `useIsMobile`-эффект (закрытие панели при выходе за мобильную ширину), `activeThreadId`/`onNewThread` вынесены в консты (условие hash-выражения не дублируется), `ThreadSidebarSheet` подключён рядом с `aside`; `min-h-0` сохранён по всей flex-цепочке.
- `README.md` (§Веб-чат) — новый пункт «Треды на мобильном (VL-282)»: кнопка в шапке, Sheet с оверлеем/Esc, закрытие после выбора треда/«Нового», отсутствие свёрнутого вида, почему не переиспользуется `ui/sidebar`.
- `web/dist` пересобран (`npm run build`) и закоммичен.
**Проверки:**
- `cd web && npm run build` — OK (tsc -b + vite build).
- `cd web && npm run lint` — 0 errors, 1 warning в существующем `web/src/components/chat/grant-scope.tsx:110` (exhaustive-deps, к задаче не относится, не трогал).
- Полный `pnpm test` из корня без exclude/skip: **124 файла, 2348 passed, 4 skipped** (skipped — штатные скипы `src/core/frontmatter.test.mjs`) + отдельный прогон `src/web/static.test.mjs` 8 passed.
- Браузерная проверка (`vibelog browser` на worktree, chrome-devtools `emulate` + `evaluate_script`, без скриншотов):
  - 390px: кнопка «Открыть список чатов» видима, десктопный `aside` имеет `display: none`, `documentElement.scrollHeight === clientHeight`; клик открывает `[data-slot="sheet-content"]` (`side=right`, ширина 292.5px при 390px), в панели «Чаты», кнопка «Новый тред», список тредов, крестик; кнопки сворачивания нет; `aria-expanded` переключается.
  - Esc закрывает панель; клик по оверлею закрывает панель.
  - Клик по треду в панели → `location.hash = "#/chat/test-mobile-thread"` и панель закрыта (подсветка `aria-current="true"` в панели до клика присутствует).
  - Кнопка «Новый» в панели → `#/chat/new` и панель закрыта.
  - 1280px: мобильной кнопки нет, `aside` `display: flex`, ширина 256px, активный тред помечен `aria-current`, кнопка «Свернуть список чатов» присутствует; сворачивание → 48px + `nav[inert]` + `chat_threads_collapsed:true` в localStorage, разворачивание → 256px; `scrollHeight === clientHeight` (инвариант lesson-112 соблюдён).
**Урок:** lesson-148 (общий хук данных + презентационный список для aside и Sheet вместо копии) создан и связан с задачей.
**Не входило в объём:** двойной `GET /api/chat/threads` на мобильном (aside смонтирован, хоть и `hidden`) — принято в плане как приемлемое, эндпоинт лёгкий.
Что осталось: фаза Close (merge, полный прогон на master, CHANGELOG/doc-6).
---
author: @agent
created: 2026-11-01 20:48
---
Фаза Close выполнена. Ветка `vb/vl-282` слита в master (`git merge --no-ff`, 1 коммит `cc23131`), worktree `.vibelog/worktrees/vl-282` удалена (`--force`: там были только оркестраторские untracked-симлинки `node_modules` и `backlog/references/data`), ветка удалена (`git branch -d`, was cc23131).
**Проверки после merge в master:**
- `pnpm build` (tsc) — OK.
- diff merge-коммита затрагивает `web/src/components/chat/thread-sidebar.tsx`, `thread.tsx`, `README.md`, `web/dist/*` — сборка фронта проверена в Code (`npm run build` + `npm run lint`); в корне полный прогон обязателен, т.к. `src/web/static.test.mjs` читает `web/dist`.
- Полный `pnpm test` (один раз, без exclude/skip): **124 файла, 2348 passed, 4 skipped** (штатные скипы `src/core/frontmatter.test.mjs`) + отдельный `src/web/static.test.mjs` 8 passed. Повторных прогонов не было.
**DoD:** все три пункта выполнены — тесты проходят (полный прогон выше), документация обновлена (README §«Веб-чат» → «Треды на мобильном» из ветки + запись в CHANGELOG Unreleased/Добавлено), регрессий нет (десктопный `aside` с `chat_threads_collapsed` проверен в браузере на 1280px, инвариант `scrollHeight === clientHeight` соблюдён).
**Lessons:** lesson-148 (общий хук данных + презентационный список для aside и Sheet вместо дублирования fetch) — создан в Code, связан с задачей.
**Документация:** CHANGELOG.md — коммит `aca93c6` («docs: VL-282 — документация и CHANGELOG»); lesson-148 — коммит `4208c4e`.
**Известное ограничение (вне объёма):** на мобильном `aside` остаётся смонтированным (`hidden`) и делает второй `GET /api/chat/threads` при открытии панели — принято в плане как приемлемое (лёгкий эндпоинт).
---
<!-- COMMENTS:END -->