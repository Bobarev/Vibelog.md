---
id: VL-163
title: 'Модальное окно создания, просмотра и редактирования задачи'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 08:14'
updated_date: '2026-10-25 23:25'
due_date: ''
labels:
  - web
dependencies: []
milestone: v1.9
references:
  - ref-13
  - ref-14
  - ref-2
  - ref-3    
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/App.tsx
  - web/src/components/task-modal/task-modal.tsx
  - web/src/components/task-modal/task-form.tsx
  - web/src/components/ui/dialog.tsx
  - web/src/components/ui/textarea.tsx
  - web/src/lib/quick-create.ts
  - web/src/components/kanban/kanban.tsx
  - web/src/components/kanban/task-card.tsx
  - web/src/components/kanban/api.ts
  - web/src/components/kanban/kanban-column.tsx
  - web/src/components/kanban/sortable-task-card.tsx
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/layout/nav-main.tsx
  - web/dist
  - README.md
  - CHANGELOG.md
lessons:
  - lesson-19
  - lesson-20
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Модальное окно создания, просмотра и редактирования задачи в веб-интерфейсе Vibelog.

В референсах ref-13 и ref-14 примеры реализации подобных модальных окон в веб-приложениях; приоритетный визуальный/UX-референс — ref-13.

А так же можно посмотреть уже используемые компоненты из ref-2 и что-то можно найти в ref-3

Важно: list_console_messages в chrome-devtools-mcp не содержит ошибок
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: модальное окно создания/просмотра/редактирования задачи (VL-163)

## Архитектурные решения

- **Примитив dialog — свой shadcn-компонент** `web/src/components/ui/dialog.tsx` на базе `radix-ui` (тот же монолитный пакет, что уже используется в `web/src/components/ui/sheet.tsx`). Визуал и анимации — по ref-13 (`DialogContent.vue` из deska-dashboard-template, backlog/references/data/...): оверлей `bg-black/50`, fade/zoom-анимации (`animate-in/out`, `duration-200`), центрирование `fixed top-[50%] left-[50%] -translate-x/y-1/2`, `max-w-[calc(100%-2rem)] sm:max-w-lg`, `rounded-lg border p-6 shadow-lg`, X-кнопка `top-4 right-4` (иконка `X` из lucide-react — в lucide-react 1.x есть; lesson-15 проверить импорт).
- **Паттерн «один примитив + специализированные обёртки»** — как в ref-3 (vibe-kanban Dialog.tsx + ConfirmDialog/…): единый управляемый `TaskModal` (props `open`/`onOpenChange`/`mode: 'view'|'create'|'edit'`/`task`), внутри — общее содержимое формы по образцу `TaskFormContent.tsx` из ref-14 (autoFocus первого поля, обязательный title, сетка `grid-cols-1 md:grid-cols-2` для парных полей). Лёгкие обёртки `TaskCreateModal`/`TaskEditModal` не нужны — достаточно `mode`.
- **Бэкенд не меняется**: POST /api/tasks, GET /api/tasks/:id, PATCH /api/tasks/:id, DELETE /api/tasks/:id уже есть в `src/web/api.ts` (createTaskFile/updateTaskFile поверх store.ts). Всё — во фронтенд-слое.
- **Статусы для селекта** берутся из уже загруженного `columnOrder` доски (он же `statuses` из /api/config) — без лишних запросов.
- Управляемый диалог (open/onOpenChange извне), не uncontrolled `<DialogTrigger>` — как в ref-14 TaskCreateSheet/TaskEditSheet.

## Файлы

### 1. Создать: `web/src/components/ui/dialog.tsx`
shadcn-примитив (портировать структуру из нашей `sheet.tsx`: SheetPrimitive → DialogPrimitive из `radix-ui`):
- `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogOverlay` (оверлей `fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]` + fade-анимации), `DialogClose`, `DialogContent` (как описано выше + X-кнопка-`DialogClose` в `top-4 right-4`), `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`.
- Классы анимаций брать как в `sheet.tsx` (data-open/data-closed, tw-animate-css уже подключён в проекте).

### 2. Создать: `web/src/components/task-modal/task-form.tsx`
- `TaskFormData` — подмножество полей Task: `title`, `description`, `status`, `priority`, `due_date`, `labels: string[]`, `assignee: string[]`.
- `TaskForm` (props: `data`, `onChange`, `statuses: string[]`, `submitting`): поля
  - Title (`Input`, обязательный, autoFocus) + Priority (`Select`: High/Medium/Low);
  - Description (`Textarea` — компонента нет → использовать `textarea` с классами `border-input` как у Input, либо добавить минимальный `web/src/components/ui/textarea.tsx`; создать его — дешевле и чище);
  - Status (`Select` из `statuses`), Due date (`Input type="date"`);
  - Labels и Assignee — текстовые поля «через запятую» (`Input`, split/trim по `,`); хранить массивами в форме.
- Валидация на уровне формы: title непустой (иначе Save disabled).

### 3. Создать: `web/src/components/ui/textarea.tsx`
Минимальный shadcn-Textarea (семантика — по style Input: `border-input`, `bg-background`, focus-ring).

### 4. Создать: `web/src/components/task-modal/task-modal.tsx`
`TaskModal(props: { open, onOpenChange, mode, task, statuses, onSaved })`:
- **mode='view'**: заголовок = title задачи, мета-строка (id, статус-бейдж, приоритет, дата, labels), description (pre-wrap), футер: «Редактировать» → переключение в edit (внутренний state), «Закрыть».
- **mode='create'/'edit'**: форма из TaskForm, инициализация из `task` или пустая структура (status = первый статус, priority = 'Medium').
- Сохранение: `mode='create'` → `createTask(payload)` (POST /api/tasks, тело = TaskFormData + пустой description допустим); `mode='edit'` → `patchTask(task.id, payload)`. fetch — обёрнуты в try/catch, ошибка → текст в модалке (`text-destructive`), без console.error (lesson-6: консоль без ошибок).
- При успехе: `onSaved()` (доска перечитается) + `onOpenChange(false)`.
- Закрытие: по Escape/X/оверлею (Radix даст бесплатно), `onOpenChange(false)` — сверху; не закрывать во время submit.

### 5. Изменить: `web/src/components/kanban/api.ts`
Добавить (в стиле существующих функций файла, комментарии на русском):
- `fetchTask(id): Promise<ApiTask>` — GET /api/tasks/:id (ApiTask → toKanbanTask уже есть, переиспользовать);
- `createTask(input): Promise<...>` — POST /api/tasks;
- `patchTask(id, patch): Promise<...>` — PATCH /api/tasks/:id;
- `archiveTask(id)` — DELETE /api/tasks/:id (для кнопки «Архивировать» в edit-режиме с confirm-ом через `window.confirm`, как reject в assets.ts).

### 6. Изменить: `web/src/components/kanban/kanban.tsx`
- Новый state: `modal: { open: false; mode: 'view'|'create'|'edit'; task: KanbanTask | null }`.
- Хэндлеры: `openCreate()`, `openView(task)` (лениво дозагружать свежие детали через `fetchTask` не обязательно — карточка уже содержит нужные поля; view берёт данные из карточки), `handleSaved() => void load()`.
- Шапка (строка ~205): рядом с «Обновить» добавить Button «Создать задачу» (`variant="default"`, иконка `Plus` — проверить наличие в lucide-react 1.x перед импортом, lesson-15) → openCreate().
- Рендер `<TaskModal ... statuses={columnOrder} onSaved={handleSaved} />` в конце компонента (вне веток error/loading, чтобы модалка жила при ошибках доски не нужно — достаточно рендерить в нормальной ветке).
- Карточки в колонках: пробросить `onClick={() => openView(task)}`.

### 7. Изменить: `web/src/components/kanban/task-card.tsx`
- Проп `onClick?: () => void`; `<article>` получает `role="button"`, `tabIndex={0}`, `cursor-pointer`, `hover:shadow-md`/`hover:border-ring` (без конфликта с drag-поведением dnd-kit — onClick срабатывает и после клика без drag, это нормально; на drag карточка уезжает и click не срабатывает).
- Keyboard: Enter/Space → onClick (a11y).

## Порядок работ

1. `dialog.tsx` + `textarea.tsx` (примитивы) → `pnpm --dir web typecheck`.
2. `api.ts` — функции данных.
3. `task-form.tsx`.
4. `task-modal.tsx` (view/create/edit внутри одного компонента).
5. `kanban.tsx` + `task-card.tsx` — интеграция.
6. Проверка (см. ниже).

## Как проверить

В worktree (учесть lesson-6): `pnpm install` в корне, затем:
- `pnpm --dir web typecheck` и `pnpm --dir web lint` — 0 ошибок;
- `pnpm --dir web build` — сборка проходит;
- ручная проверка в браузере (chrome-devtools MCP): `node bin/vibelog.mjs browser` → new_page →
  - «Создать задачу» → модалка открывается, форма сабмитится → задача появилась в колонке, файл в backlog/tasks/ создан;
  - клик по карточке → view-режим, кнопка «Редактировать» → изменение title/приоритета → сохранение → карточка обновилась;
  - Escape/оверлей/X закрывают модалку;
  - `list_console_messages` — **без ошибок** (AC задачи);
  - drag-and-drop по-прежнему работает (регрессия нет).
- `pnpm test` (корневые vitest) — не задеть существующие тесты; новых vitest-тестов фронта в проекте нет (фронт пока покрывается ручной проверкой в браузере — соответствует существующей практике VL-27/28).

## Риски

- **Radix в монолитном пакете `radix-ui`**: импорт `Dialog as DialogPrimitive` из `radix-ui` — как в sheet.tsx; если Dialog отсутствует в версии 1.6.7, fallback — импорт из подпакета `radix-ui/<name>` (проверить при реализации).
- **Иконки lucide-react 1.x** (lesson-15): проверять наличие `X`, `Plus`, `Pencil`, `Trash2` перед импортом.
- **Клик vs drag**: onClick на карточке может срабатывать после драга в редких кейсах — минимизировать: открывать только по клику без сдвига (`event.detail`/флаг в dragStart не критично, проверить вручную; при проблеме — открывать по клику на пустую область карточки, не на кнопки).
- **PATCH затирает поля**: updateTaskFile делает merge, но при передаче массивов (labels/assignee) они заменяются целиком — это ожидаемо; не передавать незаполненные поля, если они не менялись (в форме всегда передаём всё — допустимо, форма инициализируется из текущих значений).
- Не сломать существующий роутинг/драг-н-дроп (VL-27/28) — правки в kanban.tsx минимальны (state + пропсы).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 08:20
---
Фаза 1 (Spec) выполнена. Заголовок: очищен от ведущего тега #web, суть оставлена. Масштаб: task (одно модальное окно create/view/edit — укладывается в одну задачу). Уточнено: цель (модальное окно создания, просмотра и редактирования задач в веб-интерфейсе Vibelog), добавлено 3 конкретных AC (создание с появлением файла в backlog/tasks/, просмотр/редактирование с сохранением изменений в файл, актуальность UI + чистая консоль). Labels: web (тег #web из заголовка перенесён в labels). References: ref-13 (deska-dashboard-template) и ref-14 (atomic-crm) связаны с задачей через reference_link. Примечание: tags и body референсов пусты — заполнение меты (теги, описание) откладываю на Фазу 2 (Plan), т.к. Spec не изучает содержимое референсов, а инструмента reference_update нет (нужен remove+add, что сменит ID). Вопросов нет.
---
author: Pavel Bobarev
created: 2026-10-15 09:06
---
В VL-164 добавлен MCP инструмент reference_update  
По результатам исследования новых референсов ref-13 и ref-14 необходимо заполнить мета референсов через mcp
Так же если появится новая информация в других референсах - можно их тоже обновить
---
author: @agent
created: 2026-10-15 09:12
---
Фаза Comment выполнена: через MCP `reference_update` заполнена мета референсов по результатам исследования клонов в `backlog/references/data/`.
**ref-13 (deska-dashboard-template)** — tags: `ui, vue, nuxt, shadcn, modal, dashboard-template`; в описание добавлено: стек Nuxt + Tailwind + shadcn-vue (reka-ui), полный набор `dialog/` (Dialog/DialogContent/DialogScrollContent/CommandDialog…), UX-детали DialogContent.vue (оверлей bg-black/50, fade/zoom-анимации, центрирование, X-кнопка), пример использования в `app/pages/(settings)/settings/index.vue`.
**ref-14 (atomic-crm)** — tags: `ui, react, shadcn, crm, modal, tasks`; в описание добавлено: паттерн модалок задач через боковые Sheet-панели с управляемыми `open`/`onOpenChange` (`TaskCreateSheet.tsx`/`TaskEditSheet.tsx` + переиспользуемый `TaskFormContent.tsx`), универсальные обёртки форм `misc/CreateSheet.tsx`/`EditSheet.tsx` (шапка, футер Save/Close/Delete, автозакрытие при сабмите), примитивы dialog (Radix)/drawer (vaul)/sheet, наличие stories и тестов.
**Дополнительно обновлены** (новая информация из исследования под задачу):
- **ref-2 (next-shadcn-admin-dashboard)** — перечень shadcn-модалок в `src/components/ui/`: dialog, alert-dialog, drawer, sheet, command, hover-card, popover, context-menu.
- **ref-3 (vibe-kanban)** — `packages/ui/src/components/`: собственный Dialog.tsx + готовые диалоги (ConfirmDialog, CreateRepoDialog, RenameWorkspaceDialog, DeleteWorkspaceDialog, KeyboardDialog, ErrorDialog, GuideDialogShell) — паттерн «один примитив + специализированные обёртки».
---
author: @agent
created: 2026-10-15 13:56
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в VL-163: собственный shadcn-примитив dialog.tsx (radix-ui, визуал по ref-13: оверлей bg-black/50, fade/zoom, X-кнопка) + управляемый TaskModal (view/create/edit в одном компоненте, паттерн «один примитив + обёртки» из ref-3, общий TaskForm по образцу TaskFormContent из ref-14) + textarea.tsx, расширение kanban/api.ts (fetchTask/createTask/patchTask/archiveTask — POST/GET/PATCH/DELETE /api/tasks уже есть в src/web/api.ts, бэкенд не меняется), интеграция в kanban.tsx (кнопка «Создать задачу», клик по карточке → view) и task-card.tsx (role=button, hover). Файлов: 4 новых + 3 правки. Риски: наличие Dialog в radix-ui 1.6.7 (fallback — подпакет), иконки lucide-react 1.x (проверять перед импортом, lesson-15), клик-vs-drag на карточке. Проверка: pnpm --dir web typecheck/lint/build + ручная в браузере через chrome-devtools с AC «list_console_messages без ошибок» (lesson-6: pnpm install в worktree). Учтены lesson-6/7/14/15/16.
---
author: Pavel Bobarev
created: 2026-10-15 14:09
---
В рамках реализации МД-165 была упомянута, но не реализована кнопка Quick Create из сайдбара референса, вот она отлично подойдёт для кнопки создания задачи, а не так как предложено: рядом с «Обновить»
---
author: @agent
created: 2026-10-15 16:38
---
Фаза 3 (Code) для VL-163 завершена (доделка после прерывания по wall-time + ревью Pavel: Quick Create из сайдбара вместо кнопки рядом с «Обновить»).
**Реализовано:**
- **TaskForm** (`web/src/components/task-modal/task-form.tsx`): шаблон из 9 полей (заголовок*, описание, статус, приоритет, срок, метки, исполнители); статус/приоритет — Select из `GET /api/config`; метки/исполнители — parse comma-list → массив; при пустом списке статусов фолбэк на дефолты.
- **TaskModal** (`web/src/components/task-modal/task-modal.tsx`): контролируемая модалка с 3 режимами — create (POST /api/tasks + location.reload), view (мета ID/статус/приоритет, описание или «Описание отсутствует.», кнопки «Редактировать»/«Закрыть»), edit (заголовок «Редактировать VL-N», PATCH + reload, «Архивировать» → confirm → DELETE + переход на доску).
- **shadcn Dialog** (`web/src/components/ui/dialog.tsx`, перенесён из ref-2): radix-ui dialog + cva — новые npm-зависимости не нужны; lesson-7 не понадобился — Dialog не требует context-only провайдеров.
- **Textarea** (`web/src/components/ui/textarea.tsx`): нативный `<textarea>` + cva.
- **Quick Create** (`web/src/lib/quick-create.ts` + кнопка в шапке сайдбара, `web/src/App.tsx`): событие-мост CustomEvent c монотонным счётчиком команд (защита от «одинаковые события подряд»); у `Kanban.tsx` подписка на событие вместо boolean-флага (pattern «subscribes to external store» — без setState-in-effect, реактивный линтер чист).
- Доска: `task-card.tsx` прокидывает cardClick на карточку; клик по карточке → view-режим.
**Проверки:**
- `pnpm build` + `pnpm test:fast`: 1135 тестов зелёные, typecheck чист, lint — только 4 pre-existing ошибки `no-explicit-any` на HEAD (не мои).
- **chrome-devtools**: кнопка «Создать задачу» в сайдбаре → модалка create → сохранение (задача появилась на доске), клик по карточке → view (мета+описание), «Редактировать» → edit-форма с предзаполненным заголовком; **консоль браузера без ошибок** (lesson-16: fallback без console.error).
- Тест-задача VL-169 удалена после проверки.
**Коммиты в ветке vb/vl-163:** `7847378` feat (18 файлов), `93ac7e5` docs (README + CHANGELOG).
**Отклонение от изначального места Quick Create:** кнопка размещена в шапке сайдбара (по ревью Pavel 2026-10-15 и референсу ref-13), а не рядом с «Обновить».
---
author: @agent
created: 2026-10-15 16:44
---
Фаза Close прервана: конфликт слияния vb/vl-163 → master (файлы: M CHANGELOG.md). Разреши конфликт вручную и повтори Фазу Close.
---
author: @agent
created: 2026-10-25 07:40
---
Фаза Close выполнена. Конфликт merge CHANGELOG.md разрешён вручную (обе записи «Добавлено» сохранены), ветка vb/vl-163 слита в master (merge 81d504d, 2 коммитов: feat 7847378 + docs 93ac7e5), worktree удалена, ветка удалена. Проверки: pnpm build — ок; полный vitest — 1136 passed, 1 флаки-таймаут в src/core/reference.test.mjs (сетевой clone), повторный отдельный прогон — 22/22 passed, регрессий нет. DoD: 1 (тесты), 2 (документация — запись в CHANGELOG Unreleased, README из docs-коммита ветки), 3 (нет регрессий) — выполнены. Refs/lessons закоммичены (d84dbc8): созданы lesson-19 (CustomEvent-мост вместо boolean-флага) и lesson-20 (повтор сетевого теста перед вердиктом).
---
<!-- COMMENTS:END -->