---
id: VL-174
title: 'Веб-страницы references: список, просмотр, редактирование, sync'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 11:10'
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
  - src/web/references-api.test.mjs
  - web/src/lib/use-hash-route.ts
  - web/src/components/references/api.ts
  - web/src/components/references/references-page.tsx
  - web/src/components/references/reference-detail.tsx
  - web/src/App.tsx
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/layout/nav-main.tsx
  - README.md
  - web/dist/index.html
  - web/dist/assets/index-BqwLwE02.js
  - web/dist/assets/index-DNbS5KRm.css
lessons:
  - lesson-22
  - lesson-23
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Страницы references в вебе: список, просмотр, редактирование, sync.

References реализованы (VL-152): метаданные в backlog/references/, клоны репо в backlog/references/data/. Но в вебе не видны. Нужны страницы.

Что: роут #/references — список (type, url/path, tags, linked_tasks). Роут #/reference/<id> — просмотр: title, type (repo/url/file/doc/spec), url, path, tags, body, linked_tasks. Редактирование: title, tags, url, body. Кнопка Sync (POST /api/references/sync) — клонирует отсутствующие репо.

Backend: GET /api/references, GET /api/references/:id, PATCH /api/references/:id, POST /api/references/sync — новые эндпоинты.

Добавить на сайдбар соответствующий раздел
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ["Роут #/references показывает список всех references с полями type, url/path, tags, linked_tasks", "Роут #/reference/<id> показывает просмотр (title, type, url, path, tags, body, linked_tasks) и позволяет редактировать title, tags, url, body с сохранением через PATCH /api/references/:id", "Кнопка Sync вызывает POST /api/references/sync и запускает клонирование отсутствующих репо; раздел References добавлен на сайдбар"]
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: веб-страницы references (VL-174)

Тип: task — план в этой задаче. Контекст изучен: `src/core/reference.ts` (VL-152, готовые core-функции), `src/web/api.ts` (handleApi, if-цепочка), `src/web/server.ts:52` (всё `/api/*` уходит в handleApi — правки сервера НЕ нужны), `web/src/App.tsx` (хеш-роуты), `web/src/components/layout/*` (сайдбар/nav), паттерн слоя данных — `web/src/components/config/api.ts`.

## Файлы для изменения/создания

| Файл | Действие |
|---|---|
| `src/web/api.ts` | правка: doc-comment + импорты + блок эндпоинтов |
| `src/web/references-api.test.mjs` | новый: тесты API |
| `web/src/lib/use-hash-route.ts` | правка: маршруты references/reference + useReferenceId |
| `web/src/components/references/api.ts` | новый: слой данных (fetch) |
| `web/src/components/references/references-page.tsx` | новый: список + Sync |
| `web/src/components/references/reference-detail.tsx` | новый: просмотр/редактирование |
| `web/src/App.tsx` | правка: подключить 2 роута |
| `web/src/components/layout/app-sidebar.tsx` | правка: пункт «References» |
| `web/src/components/layout/nav-main.tsx` | правка: activeWhen (подсветка на детальной странице) |
| `README.md` | правка: раздел «Веб-интерфейс» (~строки 81–95) |

## Шаг 1. Подготовка worktree (lesson-6)

```bash
pnpm install            # в корне (node_modules уже есть — пропустить, если всё установлено)
pnpm --dir web install   # ОБЯЗАТЕЛЬНО: свежий worktree, без него web:build падает
pnpm build               # dist/ для тестов API
```

## Шаг 2. Backend: 4 эндпоинта в `src/web/api.ts`

1. Doc-comment файла (строки 6–15): добавить в список эндпоинтов:
   - `GET /api/references` — список references
   - `GET /api/references/:id` — детали reference
   - `PATCH /api/references/:id` — обновление полей/тела
   - `POST /api/references/sync` — клонирование отсутствующих репо
2. Импорт (после строки 16, рядом с импортом store.js):
   ```ts
   import { listReferences, getReference, updateReference, syncReferenceRepos, REFERENCE_TYPES } from '../core/reference.js';
   import type { UpdateReferenceInput } from '../core/reference.js';
   ```
3. Новый блок — между концом `PUT /api/settings` (строка ~112) и `const triggerMatch` (строка 116). Порядок внутри блока важен (sync ДО `:id`, как trigger до getMatch):
   - **GET `/api/references`** → `listReferences(cwd)`, вернуть `{ status: 200, body: entries.map(e => ({ reference: e.reference, path: e.path })) }` — **без body** (список: type/url/path/tags/linked_tasks; тело грузится только на детальной странице).
   - **POST `/api/references/sync`** (точное совпадение `url === '/api/references/sync'`) → `syncReferenceRepos(cwd)` → 200 `{cloned, skipped, failed}` (SyncResult).
   - **regex** `^\/api\/references\/([^/]+)$` → `refMatch`:
     - GET: `getReference(cwd, refMatch[1])` → null ? 404 `{error:'Reference не найден'}` : 200 полный entry `{reference, body, path}`.
     - PATCH: валидация входа: `body.type` (если есть) ∈ `REFERENCE_TYPES` → иначе 400; `body.tags`/`body.linked_tasks` (если есть) — массивы строк → иначе 400; маппинг `content` (wire-поле для тела) → `UpdateReferenceInput`. `updateReference(cwd, id, updates)` → null ? 404 : 200 обновлённый entry. Ошибки валидации — 400 (не 500).

## Шаг 3. Тесты backend: `src/web/references-api.test.mjs`

Зеркало `src/web/config-api.test.mjs`: mkdtemp → `mkdirSync(backlog)` → `writeReference` из `../../dist/core/reference.js`. Кейсы (handleApi напрямую):
1. GET `/api/references` → 200, массив, есть `reference.tags`/`linked_tasks`, **нет** поля `body`.
2. GET `/api/references/:id` → 200 c `body`; несуществующий id → 404.
3. PATCH `{title, tags, url, content}` → 200, файл на диске обновлён (readFileSync), при смене title старый файл удалён; PATCH `{type:'evil'}` → 400 и файл не изменён; PATCH неизвестный id → 404.
4. POST `/api/references/sync` → 200 со shape `{cloned:[],skipped:[],failed:[]}`; для type=repo с заранее созданным каталогом `referenceCloneDir(cwd, ref)` → id в `skipped` (без сети); ref типа `url` не попадает в результат. Тест доказывает порядок роутов (sync не матчится как `:id`).

Промежуточная проверка: `pnpm build && vitest run src/web/references-api.test.mjs`.

## Шаг 4. Frontend: маршруты и слой данных

**`web/src/lib/use-hash-route.ts`**:
- строка 16: `export type Route = 'board' | 'settings' | 'config' | 'references' | 'reference';`
- `parseHash` (строки 19–24): добавить `if (path === 'references') return 'references'; if (path.startsWith('reference/')) return 'reference';` (до дефолта 'board').
- Новый экспорт `useReferenceId(): string | null` — парсит id из `window.location.hash` (`#/reference/<id>`), подписка на hashchange (тем же useEffect-паттерном).

**`web/src/components/references/api.ts`** (новый, по образцу `web/src/components/config/api.ts`):
- `interface ReferenceMeta` — поля из `src/core/reference.ts:31` (id, title, type, url?, path?, tags, created_date, linked_tasks).
- `fetchReferences(): Promise<{reference, path}[]>` — GET `/api/references`.
- `fetchReference(id): Promise<{reference, body, path}>` — GET; бросает с текстом сервера.
- `patchReference(id, patch: {title?, tags?, url?, content?})` — PATCH; бросает с `errBody.error` (как putConfig).
- `syncReferences(): Promise<SyncResult>` — POST `/api/references/sync`.

## Шаг 5. Frontend: страницы

**`web/src/components/references/references-page.tsx`** (новый):
- Состояние: `entries`, `loading`, `error`, `syncing`, `syncResult`.
- Загрузка в `useEffect` с try/catch (lesson-16: консоль без ошибок — ошибки в state, выводятся в UI).
- Таблица (или список Card): title → ссылка `#/reference/<id>`; type (Badge); url/path (обрезанный, с title); tags (Badge-список); linked_tasks (ссылки `#/VL-N` — как в Kanban задачах).
- Кнопка **Sync** (иконка `RefreshCw` — уже используется в проекте, безопасна): POST → показать итог inline (`cloned/skipped/failed`, ошибки из `failed[].error`), повторная загрузка списка; `disabled={syncing}`.

**`web/src/components/references/reference-detail.tsx`** (новый, пропс `{ id: string }`):
- Загрузка `fetchReference(id)`; 404 → сообщение + ссылка «← к списку».
- Просмотр: title, type (Badge), url, path, tags, linked_tasks, body (в `<pre>`/textarea readOnly — body произвольный markdown).
- Кнопка «Редактировать» → режим формы: Input title, Input tags (через запятую → массив), Input url, Textarea body; «Сохранить» → `patchReference` (только title/tags/url/content — AC) → перезагрузка; «Отмена». Ошибки PATCH — inline. UI из `web/src/components/ui/` (button, input, textarea, badge, card, label — все есть).

## Шаг 6. Frontend: подключение роутов и сайдбара

**`web/src/App.tsx`** (строки 10–15 импорты, 46–54 роуты): добавить импорты `ReferencesPage`, `ReferenceDetail`; в тернарник:
```tsx
route === "references" ? <ReferencesPage /> :
route === "reference" ? <ReferenceDetail id={refId} /> : ...
```
где `const refId = useReferenceId()`. Ничего в layout/main не менять (lesson-14 неактуален — main уже flex-1 overflow-y-auto).

**`web/src/components/layout/nav-main.tsx`** (тип NavItem ~строки 44–53, isActive ~строка 91): в вариант без subItems добавить опциональное поле `activeWhen?: Route[]`; `isActive={route === item.url || item.activeWhen?.includes(route) ?? false}` — чтобы пункт подсвечивался и на `#/reference/<id>`.

**`web/src/components/layout/app-sidebar.tsx`** (импорт иконок строка 17, NAV_GROUPS строки 23–38): в группу `main` после `board` (строка 28):
```tsx
{ id: "references", title: "References", url: "references", icon: Library, activeWhen: ["references", "reference"] },
```
- Иконка: **перед импортом проверить наличие** (lesson-15): `ls web/node_modules/lucide-react/dist/esm/icons | grep -E "^(library|book-marked)"` → взять `Library`, иначе `BookMarked`, иначе `GitBranch` (уже в проекте). Никаких Github/brand-иконок.

## Шаг 7. Проверки

```bash
pnpm typecheck            # tsc --noEmit (backend)
pnpm build && vitest run src/web/references-api.test.mjs
pnpm web:build            # vite build (после pnpm --dir web install!)
pnpm test                 # полный прогон = build + vitest (DoD: тесты, нет регрессий)
```
Ручная проверка в браузере (AC1–AC3): `node bin/vibelog.mjs browser` → chrome-devtools MCP: открыть `#/references` (список, поля), `#/reference/ref-N` (просмотр + редактирование title/tags/url/body + PATCH в network-панели), кнопка Sync (POST `/api/references/sync`, ответ 200), пункт References на сайдбаре, консоль без ошибок.

## Шаг 8. Документация (DoD-2)

`README.md`, раздел «Веб-интерфейс» (~строки 81–95): добавить пункт про страницу References (`#/references`, `#/reference/<id>`, кнопка Sync) и 4 эндпоинта API.

## Риски

1. **Свежий worktree** (lesson-6): без `pnpm --dir web install` web:build падает — шаг 1 обязателен.
2. **lucide-react 1.x** (lesson-15): brand-иконки удалены; `Library`/`BookMarked` проверять наличие перед импортом (фолбэк `GitBranch`).
3. **Sync блокирует сервер**: `syncReferenceRepos` синхронный (`spawnSync git clone`) — долгое клонирование блокирует event loop; принимаем (локальный инструмент, как CLI), async-вариант вне масштаба.
4. **Валидация PATCH**: некорректный `type`/`tags` должен давать 400 и НЕ писать мусор в md-файл reference (предвалидация до `updateReference`).
5. **Консоль браузера без ошибок** (lesson-16): все fetch в страницах — в try/catch с выводом ошибки в state.
6. `web/dist` коммитится в git (static.ts:7) — после web:build закоммитить обновлённый dist вместе с исходниками.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 11:11
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Веб-страницы references: список, просмотр, редактирование, sync» (снят ведущий тег #web). Масштаб: task (одна фича: 4 эндпоинта + 2 роута + сайдбар). Уточнено: описание дополнено 3 проверяемыми AC — (1) роут #/references со списком (type, url/path, tags, linked_tasks); (2) роут #/reference/<id> с просмотром всех полей и редактированием title/tags/url/body через PATCH; (3) кнопка Sync (POST /api/references/sync) + раздел на сайдбаре. Labels: web, core (тег #web из заголовка/описания перенесён в labels). References: нет (внешние источники не упомянуты; VL-152 — внутренняя задача-контекст). Вопросов нет.
---
author: @agent
created: 2026-10-25 11:22
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 10 файлов (2 новых страницы + слой данных references/api.ts, правки src/web/api.ts — 4 эндпоинта, use-hash-route/App/sidebar/nav-main, новый тест references-api.test.mjs, README). Порядок: подготовка worktree (pnpm install в web/ — lesson-6) → backend-эндпоинты (sync до :id, как trigger) → тесты → frontend (роуты #/references и #/reference/<id>, список с Sync, просмотр/редактирование через PATCH) → сборки/тесты → ручная проверка в chrome-devtools → README. Риски: свежий worktree требует pnpm install в web/; иконку Library/BookMarked проверять в lucide-react 1.x перед импортом (lesson-15, фолбэк GitBranch); syncReferenceRepos синхронный — долгий git clone блокирует сервер (принято); PATCH валидировать (type ∈ REFERENCE_TYPES, tags — массив строк) до записи файла; fetch в страницах в try/catch (lesson-16); web/dist коммитится вместе с исходниками.
---
author: @agent
created: 2026-10-25 12:02
---
Фаза 3 (Code) выполнена. Изменено: src/web/api.ts (4 эндпоинта: GET /api/references — список без тел, GET/PATCH /api/references/:id — детали/обновление с предвалидацией type∈REFERENCE_TYPES и tags→400, POST /api/references/sync — до :id-роута), src/web/references-api.test.mjs (новый, 8 тестов: список/детали/PATCH-переименование файла/валидация 400/sync-порядок роутов), web/src/lib/use-hash-route.ts (маршруты references/reference + useReferenceId), web/src/components/references/{api.ts,references-page.tsx,reference-detail.tsx} (новые: список с кнопкой Sync, просмотр/редактирование title/tags/url/body через PATCH), web/src/App.tsx (2 роута), app-sidebar.tsx (пункт References, иконка Library — наличие проверено в lucide-react 1.x), nav-main.tsx (activeWhen — подсветка на #/reference/<id>), README.md (раздел «Веб-интерфейс»), web/dist (пересобран). Коммит e6cc6b3. Проверки: pnpm typecheck ✅; pnpm web:build ✅; pnpm test ✅ — 66+1 файлов, 1164 теста (при первом прогоне 6 флэков orchestrator.test.mjs — прошли отдельно и на повторе, не связаны с изменениями); ручная проверка в chrome-devtools ✅: #/references (список: type/url/tags/linked_tasks), #/reference/ref-1 (просмотр всех полей, редактирование → PATCH 200, «Сохранено», тег откатан после проверки), Sync → POST 200 «клонировано: 0, пропущено: 14, ошибок: 0», пункт References на сайдбаре, консоль без ошибок; найден и исправлен transient-404 GET /api/references/ (guard пустого id — lesson-22). DoD: тесты проходят ✅, документация обновлена (README) ✅, нет регрессий ✅. AC отмечен весь (3 условия verified в браузере).
---
author: @agent
created: 2026-10-25 12:07
---
Фаза Close выполнена. Ветка vb/vl-174 слита в master (1 коммит e6cc6b3, merge без конфликтов), worktree удалена (только untracked-симлинки → --force), ветка удалена. После merge: pnpm build ✅, pnpm test ✅ (66+ файлов, все зелёные). Lessons: обновлён lesson-22 (guard пустого id, linked_tasks += VL-174), создан lesson-23 (флэки orchestrator.test.mjs в полном прогоне — повторять отдельно перед вердиктом), оба связаны с задачей. Refs у задачи нет. Коммит refs/lessons: cecb853. Документация: CHANGELOG.md — запись VL-174 в Unreleased (коммит ad99f23 «docs: VL-174 — документация и CHANGELOG»); README обновлён в merge. DoD: тесты проходят ✅ (pnpm build + vitest), документация обновлена ✅ (README + CHANGELOG), нет регрессий ✅ (полный pnpm test зелёный). AC отмечены по отчёту Фазы 3 (все 3 условия verified в браузере).
---
<!-- COMMENTS:END -->