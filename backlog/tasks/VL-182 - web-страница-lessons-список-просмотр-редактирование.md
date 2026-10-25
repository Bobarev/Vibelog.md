---
id: VL-182
title: 'Веб-страницы lessons: список, просмотр, редактирование'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 15:18'
updated_date: '2026-10-25 23:26'
due_date: ''
labels:
  - web
  - core
dependencies: []
milestone: v1.9
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/api.ts
  - src/web/lessons-api.test.mjs
  - web/src/lib/use-hash-route.ts
  - web/src/App.tsx
  - web/src/components/layout/app-sidebar.tsx
  - web/src/lib/open-task.ts
  - web/src/components/kanban/kanban.tsx
  - web/src/components/lessons/api.ts
  - web/src/components/lessons/lessons-page.tsx
  - web/src/components/lessons/lesson-detail.tsx
  - README.md
  - web/dist/index.html
  - web/dist/assets/index-DI6cVtCW.js
  - web/dist/assets/index-BgP3O9Pf.css
lessons:
  - lesson-20
  - lesson-36
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Страницы lessons в вебе: список, просмотр, редактирование.

Lessons реализованы (VL-153): файлы backlog/lessons/lesson-N.md с frontmatter (id, title, status active/outdated/superseded, tags, source_tasks, linked_tasks). Но в вебе не видны. Нужны страницы.

Что: роут #/lessons — список lessons (фильтр по status, tags). Роут #/lesson/<id> — просмотр: title, tags, body (markdown), source_tasks (ссылки на задачи), linked_tasks (ссылки на задачи), status. Редактирование: title, tags, body, status. Связь с задачами — переход по ссылке.

Backend: GET /api/lessons, GET /api/lessons/:id, PATCH /api/lessons/:id — новые эндпоинты.

Добавить на сайдбар соответствующий раздел.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Роут #/lessons показывает список lessons с фильтрами по status и tags (id, title, status, tags)
- [x] #2 Роут #/lesson/<id> показывает просмотр (title, status, tags, body markdown, source_tasks и linked_tasks ссылками на задачи) и позволяет редактировать title, tags, body, status с сохранением через PATCH /api/lessons/:id
- [x] #3 Backend-эндпоинты GET /api/lessons, GET /api/lessons/:id, PATCH /api/lessons/:id реализованы и покрыты тестами; раздел Lessons добавлен на сайдбар
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План: веб-страницы lessons (VL-182)

Образец — VL-174 (references) и VL-181 (documents): тот же паттерн «список + детальная + PATCH», хеш-роуты, слой данных отдельным api.ts, сайдбар через activeWhen.

### Файлы (12; проверены ls — все существуют, кроме новых, создаются)

| # | Файл | Действие |
|---|------|----------|
| 1 | `src/web/api.ts` | правка: 3 эндпоинта lessons |
| 2 | `src/web/lessons-api.test.mjs` | новый: тесты |
| 3 | `web/src/lib/use-hash-route.ts` | правка: роуты + useLessonId |
| 4 | `web/src/App.tsx` | правка: ветка роутинга |
| 5 | `web/src/components/layout/app-sidebar.tsx` | правка: пункт «Lessons» |
| 6 | `web/src/lib/open-task.ts` | новый: переход на задачу |
| 7 | `web/src/components/kanban/kanban.tsx` | правка: открытие модалки по событию |
| 8 | `web/src/components/lessons/api.ts` | новый: слой данных |
| 9 | `web/src/components/lessons/lessons-page.tsx` | новый: список #/lessons |
| 10 | `web/src/components/lessons/lesson-detail.tsx` | новый: #/lesson/<id> |
| 11 | `README.md` | правка: раздел «Веб-интерфейс» |
| 12 | `CHANGELOG.md` | правка: запись VL-182 |

### 1. Backend — `src/web/api.ts`

- **Импорт** (блок core-imports, строки 29–56): `listLessons, getLesson, updateLesson, LESSON_STATUSES` из `../core/lesson.js`; тип `UpdateLessonInput`.
- **Шапка-докстринг** (строки 18–25): +3 строки эндпоинтов.
- **GET /api/lessons** — вставить после блока PATCH `/api/documents` (после строки 277, до `// POST /api/tasks` на строке 280). Паттерн references (VL-174):
  - Предпроверка `findBacklogDir(cwd)` → 400 «Backlog не найден…» (паттерн documents — core-функции lessons бросают без backlog);
  - `listLessons(cwd)` → 200, тела НЕ отдаём: `entries.map(e => ({ lesson: e.lesson, path: e.path }))`.
- **GET/PATCH /api/lessons/:id** — regex `^\/api\/lessons\/([^/]+)$/` сразу после (как refMatch на строке 155):
  - GET: `getLesson(cwd, id)` → null → 404 `{error:'Lesson не найден'}`, иначе 200 entry `{lesson, body, path}`;
  - PATCH: предвалидация до `updateLesson` (паттерн строк 161–190):
    - `status !== undefined` → `String(status).toLowerCase()` ∈ `LESSON_STATUSES`, иначе 400 «Недопустимый статус lesson …» (иначе `normalizeLessonStatus` бросит → 500);
    - `tags` → массив строк, иначе 400;
    - `title` → `String(body.title)`, `content` → `String(body.content)` (wire-поле тела);
    - Принимаем ТОЛЬКО эти 4 поля (AC-2: редактируются title/tags/body/status; source_tasks/linked_tasks — read-only из frontmatter);
    - `updateLesson(cwd, id, updates)` → null → 404, иначе 200.

### 2. Тесты — `src/web/lessons-api.test.mjs` (новый)

По образцу `src/web/references-api.test.mjs` (импорт `handleApi` из `../../dist/web/api.js`, `createLessonFile, markdownToLesson` из `../../dist/core/lesson.js`):
- beforeAll: mkdtemp + `mkdirSync(join(cwd,'backlog','tasks'))` (isBacklogDir требует tasks/) + `createLessonFile(cwd, {title, status:'active', tags:['web','ui'], source_tasks:['VL-153'], linked_tasks:['VL-174'], content:'# Тело'})`;
- **GET /api/lessons**: 200, массив, нет поля `body` (экономия трафика), `lesson.id/title/status/tags`, `path` заканчивается .md;
- **GET /api/lessons/:id**: 200 с `body` (содержит «Тело»); неизвестный id → 404;
- **PATCH /api/lessons/:id**:
  - валидный {title, tags, status:'outdated', content} → 200, файл на диске переименован (старый удалён — смена title меняет имя файла в `lessonFilename`), content обновлён, `updated_date` = сегодня;
  - невалидный `status:'evil'` → 400, файл нетронут (snapshot readFileSync до/после);
  - `tags:'nope'` → 400, файл нетронут;
  - неизвестный id → 404;
  - без backlog (cwd=tmp без backlog/) → 400 на всех трёх хендлерах.

### 3. Роутинг — `web/src/lib/use-hash-route.ts`

- `Route` (строки 20–28): `| 'lessons' | 'lesson'`;
- `parseHash` (строки 31–46): `if (path === 'lessons') return 'lessons';` — точным совпадением ДО префикса; `if (path.startsWith('lesson/')) return 'lesson';` — после `documents/document` (паттерн строк 39–43; «lessons» не пересекается с префиксом «lesson/» — 7-й символ 's' vs '/', но порядок фиксируем явно);
- + `parseLessonId` и экспорт `useLessonId()` (после `useDocumentId`, строка 101) — зеркало `useDocumentId` строк 85–101.

### 4. Роутинг — `web/src/App.tsx`

- Импорты (строки 12–25): `LessonsPage`, `LessonDetail`, `useLessonId`;
- `const lessonId = useLessonId()` (после строки 30);
- Цепочка тернарников (строки 62–79): `route === "lessons" ? <LessonsPage/> : route === "lesson" ? <LessonDetail id={lessonId ?? ""}/>` — перед fallback `<Kanban/>`;
- Обновить докстринг (строки 3–10).

### 5. Сайдбар — `web/src/components/layout/app-sidebar.tsx`

- После пункта Documents (строка 58): `{ id:"lessons", title:"Lessons", url:"lessons", icon:<I>, activeWhen:["lessons","lesson"] }` (паттерн lesson-11 — активность по хеш-роуту);
- Иконка: **lesson-15** — после `pnpm install` в web/ проверить наличие: `ls web/node_modules/lucide-react/dist/esm/icons | grep -iE "lightbulb|book-open"`. Кандидат `Lightbulb` (если есть), иначе `BookOpen`/`NotebookText` — проверить ДО импорта, несуществующая иконка ломает сборку lucide-react 1.x;
- Обновить докстринг (строки 8–16).

### 6. Переход на задачу — `web/src/lib/open-task.ts` (новый) + kanban.tsx

AC-2: source_tasks/linked_tasks — **ссылками на задачи** (переход по ссылке). Deep-link задачи в вебе не реализован → паттерн `quick-create.ts` (lesson-19: CustomEvent с монотонным счётчиком, не boolean):
- `OPEN_TASK_EVENT = 'vibelog:open-task'`; модульный `pendingTaskId: string | null` (переживает unmount); монотонный `seq` в detail события;
- `requestOpenTask(id)`: записать pendingTaskId + dispatch `CustomEvent(OPEN_TASK_EVENT, {detail:{id, seq}})` + `window.location.hash = '#/'`; если hash уже '#/' — только событие (повторный клик по той же задаче отработает через seq);
- `consumePendingTaskId(): string | null` — возвращает и гасит.
- **`web/src/components/kanban/kanban.tsx`**: рядом с эффектом Quick Create (строки 146–156) — подписка на `OPEN_TASK_EVENT` + `consumePendingTaskId()` при монтировании (queueMicrotask, как строка 152): `fetchTask(id)` (уже импортирован, строка 48) → `setModal({open:true, mode:'view', task})`; пустой id / fetch-ошибка → тихий fallback без console (lesson-16) — модалка просто не открывается; `TaskDetail extends KanbanTask` — подходит модалке.

### 7. Слой данных — `web/src/components/lessons/api.ts` (новый)

Зеркало `web/src/components/references/api.ts`:
- Типы: `LessonMeta {id,title,status,tags,source_tasks,linked_tasks,created_date,updated_date,supersedes}`, `LessonListItem {lesson, path}`, `LessonDetailData {lesson, body, path}`, `LessonPatch {title?, tags?, status?, content?}`; константа `LESSON_STATUSES = ['active','outdated','superseded']` (frontend-дубль, как `DOCUMENT_TYPES` в documents/api.ts);
- `errorMessage` helper + `fetchLessons()` (GET /api/lessons), `fetchLesson(id)`, `patchLesson(id, patch)` — все бросают Error с текстом сервера.

### 8. Список — `web/src/components/lessons/lessons-page.tsx` (новый) — роут `#/lessons`

По образцу `documents-page.tsx` (фильтры) + `references-page.tsx` (карточки):
- Состояние: `entries | null`, `error`, `statusFilter` (Select: «Все статусы» + 3 из LESSON_STATUSES), `tagFilter` (Input «Теги через запятую» — substring, все перечисленные входят в tags, логика строк 95–103 documents-page);
- Карточка (Card): title-ссылка `#/lesson/<id>` + **id** (AC-1: id, title, status, tags), Badge `status` (secondary), дата `updated_date`, tags Badges (outline), путь файла (muted, title-атрибут);
- Все fetch — в try/catch → state (lesson-16), загрузка в effect с eslint-disable паттерном (references-page строки 47–51);
- Пустое состояние: «Lessons пока нет…».

### 9. Детальная — `web/src/components/lessons/lesson-detail.tsx` (новый) — роут `#/lesson/<id>`

По образцу `document-detail.tsx` (MarkdownView) + `reference-detail.tsx` (edit-режим):
- Effect загрузки по `[id]` с **guard пустого id** (`if (!id) return` — lesson-22), `cancelled`-флаг, сброс состояний (паттерн reference-detail строки 51–78);
- **Просмотр**: ссылка «← К списку lessons» (`#/lessons`), title (h1) + Badge status, карточка-`dl`: теги (Badges), source_tasks и linked_tasks — **ссылками**: `<a href="#/" onClick={e => { e.preventDefault(); requestOpenTask(taskId) }}>{taskId}</a>` (+ Badge-обёртка), created/updated/supersedes, путь файла; body — `<MarkdownView>{entry.body}</MarkdownView>` (не `<pre>` — AC требует markdown-рендер);
- **Редактирование** (кнопка «Редактировать» → форма в Card): title (Input), tags (Input через запятую → `parseTags`), status (Select из LESSON_STATUSES), body (Textarea rows≈14) → `patchLesson(id, {title, tags, status, content})` → setEntry(updated), «Сохранено», выход из edit; ошибки в state; «Отмена» без сохранения;
- Все fetch в try/catch (lesson-16).

### 10. Документация

- **README.md** — раздел «Веб-интерфейс» (строка 81, блок комментариев ~86–96): после описания Documents добавить Lessons: «Lessons (#/lessons — список lessons (id/title/status/tags, фильтры по status и тегам); #/lesson/<id> — просмотр title/status/tags/body (markdown) и source_tasks/linked_tasks ссылками на задачи, редактирование title/tags/body/status через PATCH /api/lessons/:id, VL-182)»;
- **CHANGELOG.md** — в `## [Unreleased]` → `### Добавлено`, первая запись (перед VL-181): боллет VL-182 по образцу записей VL-181/VL-174 (роуты, эндпоинты, сайдбар, тесты, README).

### Порядок действий

1. `pnpm install` + `pnpm install` в web/ (lesson-6 — свежий worktree, без него web:build/typecheck падают);
2. Backend: api.ts → тесты → `pnpm build && pnpm test:fast` (в конце — полный `pnpm test`);
3. Роутинг: use-hash-route.ts → App.tsx → app-sidebar.tsx (иконку проверить ДО импорта!);
4. open-task.ts + kanban.tsx;
5. lessons/api.ts → lessons-page.tsx → lesson-detail.tsx;
6. `pnpm --dir web typecheck` + `pnpm web:build`;
7. Документация (README, CHANGELOG);
8. Браузерная верификация — **дробить шагами (lesson-27)**: `node bin/vibelog.mjs browser`, chrome-devtools: (а) #/lessons — список + оба фильтра, консоль без ошибок; (б) #/lesson/<id> — просмотр markdown + клик по source_tasks (модалка открылась), (в) PATCH — сохранение title/tags/status/body. После подтверждения AC — сразу закрывать фазу.

### Проверки

```bash
pnpm build && pnpm test           # сборка + все тесты (включая новый lessons-api.test.mjs)
pnpm --dir web typecheck          # strict-типизация веба
pnpm web:build                    # web/dist для статики/сервера
```

### Риски

1. **Иконка lucide** (lesson-15): `Lightbulb` может отсутствовать в lucide-react 1.x → проверить `ls web/node_modules/lucide-react/dist/esm/icons` до импорта, fallback `BookOpen`/`NotebookText`.
2. **Свежий worktree без web/node_modules** (lesson-6): `pnpm install` в web/ обязателен до web:build/typecheck.
3. **Конфликт web/dist при merge** (lesson-28): разрешать пересборкой `pnpm web:build` из слитых исходников.
4. **Порядок парсинга роутов**: `lessons` (список) — точным совпадением до `lesson/` (детальная); иначе список уйдёт в детальную ветку с пустым id.
5. **Пустой id на первом рендере** (lesson-22): route- и id-хуки обновляются разными слушателями hashchange → guard `if (!id) return` обязателен, иначе transient-GET `/api/lessons/` в сеть.
6. **normalizeLessonStatus бросает** → без предвалидации 500 вместо 400 и мусор в md-файле — предвалидация status/tags обязательна.
7. **Повторный клик по одной и той же задаче** (lesson-19): boolean-флаг не срабатывает повторно — монотонный seq в detail события.
8. **Событие до монтирования Kanban**: hash меняется позже dispatch — модульный pendingTaskId (как quick-create) переживает remount.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 15:30
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Веб-страницы lessons: список, просмотр, редактирование» (снят ведущий тег #web). Масштаб: task (одна фича: 3 эндпоинта + 2 роута + пункт сайдбара; по образцу VL-174 — references, тип task). Уточнено: из описания снят ведущий тег #web и убран дубль блока /spec, добавлены 3 проверяемых AC — (1) роут #/lessons со списком и фильтрами по status/tags; (2) роут #/lesson/<id> с просмотром всех полей (включая source_tasks/linked_tasks ссылками) и редактированием title/tags/body/status через PATCH; (3) эндпоинты GET /api/lessons, GET /api/lessons/:id, PATCH /api/lessons/:id с тестами + раздел Lessons на сайдбаре. Labels: web, core (тег #web из заголовка/описания перенесён в labels). References: нет (внешние источники не упомянуты; VL-153/VL-174 — внутренние задачи-контекст). Технические примечания: первые вызовы backlog_update_task падали с «Cannot read properties of undefined (reading 'toLowerCase')», пока type задачи был не определён — после записи type=task обновление прошло; AC записаны через manage_ac отдельными вызовами (передача массива add записывала JSON одним критерием). Вопросов нет.
---
author: @agent
created: 2026-10-25 19:19
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 12 файлов (3 новых фронт-компонента lessons + слой данных api.ts + open-task.ts, новый тест lessons-api.test.mjs, правки api.ts/роутинга/сайдбара/kanban/README/CHANGELOG). Ключевые решения: (1) бэкенд — по образцу VL-174/VL-181: GET /api/lessons (список без тел), GET/PATCH /api/lessons/:id с предвалидацией status ∈ LESSON_STATUSES и tags (иначе normalizeLessonStatus → 500), PATCH принимает только title/tags/status/content по AC; (2) роуты #/lessons и #/lesson/<id> через扩展 use-hash-route (Route += lessons|lesson, useLessonId с guard пустого id — lesson-22); (3) source_tasks/linked_tasks — ссылками на задачи через новый web/src/lib/open-task.ts (паттерн quick-create: CustomEvent с монотонным seq + модульный pendingTaskId — lesson-19) → Kanban открывает модалку просмотра задачи; (4) сайдбар Lessons с activeWhen по двум роутам (lesson-11), иконка — проверить наличие в lucide-react ДО импорта (lesson-15); (5) markdown-рендер body через MarkdownView. Риски: свежий worktree требует pnpm install в web/ (lesson-6), порядок парсинга роутов lessons vs lesson/, конфликт web/dist при merge (lesson-28). Браузерная верификация — дробить шагами (lesson-27).
---
author: @agent
created: 2026-10-25 19:51
---
Фаза 3 (Code) выполнена. Изменено: src/web/api.ts (3 эндпоинта lessons: GET /api/lessons — список без тел с предпроверкой findBacklogDir → 400; GET/PATCH /api/lessons/:id — предвалидация status ∈ LESSON_STATUSES и tags → 400, PATCH принимает только title/tags/status/content), src/web/lessons-api.test.mjs (новый, 8 тестов: список без body, детали/404, PATCH с переименованием файла при смене title и snapshot-проверкой нетронутости при 400, 400 без backlog на всех хендлерах), web/src/lib/use-hash-route.ts (Route += lessons|lesson, useLessonId), web/src/App.tsx (ветки роутинга LessonsPage/LessonDetail), web/src/components/layout/app-sidebar.tsx (пункт Lessons, иконка Lightbulb — наличие в lucide-react 1.49 проверено до импорта, lesson-15; activeWhen ["lessons","lesson"]), web/src/lib/open-task.ts (новый: CustomEvent с монотонным seq + модульный pendingTaskId — lesson-19), web/src/components/kanban/kanban.tsx (подписка на open-task → fetchTask → модалка view, тихий fallback — lesson-16), web/src/components/lessons/{api.ts,lessons-page.tsx,lesson-detail.tsx} (новые: список с клиентскими фильтрами status Select + tags через запятую; детальная с MarkdownView, ссылками source/linked_tasks на задачи и формой редактирования title/tags/status/body, guard пустого id — lesson-22), README.md (раздел «Веб-интерфейс» — Lessons), web/dist (пересборка). Коммит f16a4cd. Проверки: pnpm build; pnpm test:fast — все 70 файлов/1201 тест прошли; полный pnpm test дважды ловил флаки сетевого git clone в src/core/reference.test.mjs (41с clone, к правкам отношения не имеет — проходит отдельно и в test:fast); pnpm --dir web typecheck — чисто; pnpm web:build — собрано; стенд-проверка на живом сервере vibelog browser --port 6431: GET /api/lessons — список реальных lessons, GET :id — 200 с body, PATCH valid=200/invalid status=400/404=404, статика отдаёт свежий бандл (index-DI6cVtCW.js содержит open-task/Lessons). Что осталось: визуальная браузерная проверка UI (chrome-devtools MCP не подключён в сессии — рендер списка/фильтров/клик по задаче в реальном браузере не смотрел; автотестов фронтенда в проекте нет); CHANGELOG в Фазе 3 не обновлял по регламенту (пишет Close). References не использовались (только внутренние паттерны VL-174/VL-181); lessons из блока уже связаны.
---
author: @agent
created: 2026-10-25 20:21
---
Фаза Close выполнена. Ветка vb/vl-182 слита в master (1 коммит f16a4cd, merge без конфликтов), после слияния pnpm build и pnpm test прошли; worktree удалена (в ней были только untracked-симлинки node_modules/refs → --force), ветка vb/vl-182 удалена. DoD: «Тесты проходят» — pnpm build + полный pnpm test зелёные после merge; «Документация обновлена» — README (раздел «Веб-интерфейс» — Lessons) слит из ветки, CHANGELOG.md дополнен записью VL-182 (docs-коммит 52998ea); «Нет регрессий» — все тесты, включая новый lessons-api.test.mjs, прошли. Lessons learned: обновлён lesson-20 (флаки сетевого git clone в reference.test.mjs повторно подтвердились в полном прогоне, linked_tasks += VL-182), создан lesson-36 (предвалидация enum/массивных полей PATCH на границе хендлера до core-функций с normalize-бросками), задача связана с обоими (коммит 786a30d). References не менялись. Визуальная браузерная проверка UI (chrome-devtools) в Code выполнялась стенд-проверкой API и статики через живой сервер; автотестов фронтенда в проекте нет.
---
<!-- COMMENTS:END -->