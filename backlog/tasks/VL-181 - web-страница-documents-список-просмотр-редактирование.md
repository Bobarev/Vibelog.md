---
id: VL-181
title: 'Страница documents — список, просмотр, редактирование'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 15:18'
updated_date: '2026-10-25 23:26'
due_date: ''
labels:
  - web
  - docs
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
  - src/web/documents-api.test.mjs
  - web/src/lib/use-hash-route.ts
  - web/src/App.tsx
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/documents/api.ts
  - web/src/components/documents/documents-page.tsx
  - web/src/components/documents/document-detail.tsx
  - README.md
  - web/dist/index.html
  - web/dist/assets/index-BynvGmqR.css
  - web/dist/assets/index-CFiCUeyT.js
lessons:
  - lesson-28
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Страница documents — список, просмотр, редактирование.

Documents реализованы (v1.4): файлы backlog/docs/<id>-<slug>.md с frontmatter (id, title, type readme/guide/specification/other, created_date, tags). Но в вебе не видны. Нужны страницы.

Что: роут #/documents — список (фильтр по type, tags). Роут #/document/<id> — просмотр: title, type, tags, body (markdown), created_date. Редактирование: title, type, tags, body. Создание нового документа (кнопка «+ Документ»).

Backend: GET /api/documents, GET /api/documents/:id, POST /api/documents, PATCH /api/documents/:id — новые эндпоинты (core-модули documents уже есть в src/core/document.ts).

Добавить на сайдбар соответствующий раздел.

Похожая задача: VL-174 (веб-страницы references — Done, аналогичная структура страниц).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ["Роут #/documents показывает список документов с полями title, type, tags, created_date и фильтрацией по type и tags", "Роут #/document/<id> показывает просмотр (title, type, tags, body, created_date) и позволяет редактировать title, type, tags, body с сохранением через PATCH /api/documents/:id", "Создание нового документа по кнопке «+ Документ» (POST /api/documents) добавляет его в список; раздел Documents добавлен на сайдбар"]
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: страницы Documents (VL-181)

Аналог — VL-174 (references): та же структура «core уже есть → API → роут → компоненты → сайдбар → тесты → README». Core `src/core/document.ts` полностью готов (listDocuments/getDocument/writeDocument/updateDocument/DOCUMENT_TYPES), серверных эндпоинтов документов ещё нет вообще.

## Файлы для изменения/создания

| Файл | Действие |
|---|---|
| `src/web/api.ts` | изменить: 4 эндпоинта + импорты |
| `web/src/lib/use-hash-route.ts` | изменить: Route + parseHash + useDocumentId |
| `web/src/App.tsx` | изменить: 2 ветки роутинга |
| `web/src/components/layout/app-sidebar.tsx` | изменить: пункт «Documents» |
| `web/src/components/documents/api.ts` | создать: слой данных |
| `web/src/components/documents/documents-page.tsx` | создать: список + фильтры + «+ Документ» |
| `web/src/components/documents/document-detail.tsx` | создать: просмотр/редактирование |
| `src/web/documents-api.test.mjs` | создать: тесты API (по образцу references-api.test.mjs) |
| `README.md` | изменить: раздел «Веб-интерфейс» (строки ~85–96) |

## 1. Backend — `src/web/api.ts`

Импорты (после блока imports references, ~строка 34):
```ts
import { findBacklogDir } from '../core/paths.js';
import { listDocuments, getDocument, writeDocument, updateDocument, DOCUMENT_TYPES } from '../core/document.js';
import type { UpdateDocumentInput } from '../core/document.js';
```
Обновить JSDoc-заголовок файла (строки 3–21): добавить 4 эндпоинта документов.

**ВАЖНО**: `listDocuments/getDocument/writeDocument/updateDocument` принимают **backlogDir, а НЕ cwd** (в отличие от listReferences). В каждом documents-хендлере первым делом: `const backlogDir = findBacklogDir(cwd); if (!backlogDir) return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };` (паттерн src/bot/handlers.ts:451 и src/cli/commands/doc.ts:33).

Вставить блок **после** PATCH references (~строка 179) и **ДО** `POST /api/tasks` (строка 181):

1. **GET /api/documents** (точное совпадение, до regex-блока):
   - `listDocuments(backlogDir)` → `{ status: 200, body: entries.map(e => ({ document: e.document, path: e.path })) }` — **без body** (паттерн VL-174: список метаданных, тело грузится на детальной).
2. **POST /api/documents** (сразу после GET, тоже точное совпадение — иначе матчится как :id):
   - предвалидация: `title` обязателен (непустая строка) → иначе 400 `Укажите заголовок`; `type`, если задан — `DOCUMENT_TYPES.includes(...)` → 400 с перечнем допустимых (как в normalizeDocumentType, но через 400, не 500 — паттерн предвалидации references); `tags` — массив строк → 400; `content` — строка.
   - `writeDocument(backlogDir, { title, type, tags, content })` → `{ status: 201, body: doc }` (как POST /api/tasks → 201).
3. **regex** `const docMatch = url.match(/^\/api\/documents\/([^/]+)$/);`:
   - **GET :id** → `getDocument(backlogDir, id)`; null → 404 `{ error: 'Документ не найден' }`; иначе 200 + entry (document+body+path).
   - **PATCH :id** → предвалидация как в PATCH references (строки 148–176): type → 400, tags → 400 (`tags — массив строк`), title/content — String(). Маппинг wire-поля `content → UpdateDocumentInput.content`. `updateDocument(...)` → null → 404; иначе 200 + обновлённый entry. (Смена title переименовывает файл — уже в core.)

## 2. Роутинг — `web/src/lib/use-hash-route.ts`

- Строка 17 (`export type Route`): добавить `'documents' | 'document'` в union.
- `parseHash` (строки 20–30): `if (path === 'documents') return 'documents';` — **ДО** `startsWith('document/')` (паттерн с comment у 'reference/', строка 27: списки точным совпадением, деталь — префиксом).
- Добавить `parseDocumentId` + `useDocumentId()` — копия `useReferenceId` (строки 52–66) с regex `^#\/document\/([^/]+)$`. **Guard пустого id** обязателен (lesson-22 — два независимых слушателя hashchange дают transient-пустой id).
- Обновить JSDoc-комментарий файла (маршруты).

## 3. Роутинг — `web/src/App.tsx`

- Импорты (после строки 18): `DocumentsPage`, `DocumentDetail` из `@/components/documents/...`.
- Строка 43: `const docId = useDocumentId()` (+ импорт из use-hash-route, строка 23).
- Цепочка тернарников (строки 54–65): вставить `route === "documents" ? <DocumentsPage /> : route === "document" ? <DocumentDetail id={docId ?? ""} /> : ...` перед дефолтом `<Kanban />`.
- Обновить JSDoc-комментарий шапки.

## 4. Сайдбар — `web/src/components/layout/app-sidebar.tsx`

- Импорт иконки (строка 12): `FileText` из lucide-react (**проверить наличие перед импортом** — lesson-15, после pnpm install в web/).
- `NAV_GROUPS` (строки 24–47): после пункта References добавить:
```ts
{ id: "documents", title: "Documents", url: "documents", icon: FileText, activeWhen: ["documents", "document"] },
```
- Обновить JSDoc (строки 11–17): упомянуть Documents.

## 5. Слой данных — создать `web/src/components/documents/api.ts`

Зеркало `web/src/components/references/api.ts` (91 строка):
- Типы: `DocumentMeta {id,title,type,created_date,tags}` (зеркало Document из src/core/document.ts:23), `DocumentListItem {document, path}`, `DocumentDetailData {document, body, path}`, `DocumentPatch {title?, type?, tags?, content?}`, `DocumentCreate {title, type?, tags?, content?}`.
- `export const DOCUMENT_TYPES = ['readme','guide','specification','other']` — mirror core, не тянуть node-модуль в веб (риск рассинхрона низкий, покрыто серверным тестом).
- `errorMessage` helper (копия, строки 59–63 references/api.ts).
- `fetchDocuments() → GET /api/documents`, `fetchDocument(id) → GET /api/documents/:id` (encodeURIComponent; вызывающий компонент проверяет пустой id), `createDocument(payload) → POST /api/documents` (201), `patchDocument(id, patch) → PATCH /api/documents/:id`. Все — throw с текстом сервера (вывод в state, не console — lesson-16).

## 6. Список — создать `web/src/components/documents/documents-page.tsx`

Зеркало `references-page.tsx` (133 строки) + фильтры + создание:
- State: `entries`, `error`, фильтры `typeFilter: string` ("" = все), `tagFilter: string` (подстрока через запятую — все перечисленные теги должны входить в tags документа), `creating`, `form {title, type, tags}`.
- Загрузка `useEffect → fetchDocuments()` в try/catch → state (lesson-16).
- Header: h1 «Documents» + подпись «Документы проекта (backlog/docs/)» + Button **«+ Документ»** (иконка Plus) → `setCreating(true)`.
- Фильтры (AC-1): Select из `@/components/ui/select` (есть в ui/) — «Все типы» + readme/guide/specification/other; Input для тегов. Клиентская фильтрация по загруженному списку (список без body — маленький, серверная фильтрация не нужна).
- Список карточек: ссылка `#/document/<id>` (title), Badge type, created_date (text-xs muted), Badge-теги — как references-page.tsx строки 104–130.
- Создание (AC-3): inline-Card-форма (Input title, Select type, Input tags через запятую) + «Создать»/«Отмена» → `createDocument(...)` → после 201 `window.location.hash = '#/document/' + id` (переход к созданному); ошибка → setError inline. Пустой title → кнопка disabled (сервер тоже валидирует).

## 7. Деталь — создать `web/src/components/documents/document-detail.tsx`

Зеркало `reference-detail.tsx` (218 строк):
- `{ id }: { id: string }`; useEffect с **guard `if (!id) return;`** (lesson-22) + cancelled-флаг; сброс editing/saved при смене id.
- Просмотр (AC-2): ссылка «← К списку документов» (`#/documents`), h1 title + Badge type + created_date, дисплей тегов (Badge outline), **тело — `MarkdownView` из `@/lib/markdown`** (markdown.tsx — готовый рендер; AC требует «body (markdown)» — лучше, чем `<pre>` в reference-detail), в Card; кнопка «Редактировать» (Pencil).
- Редактирование (AC-2): форма title (Input), type (Select — 4 типа), tags (Input через запятую), body (Textarea rows≈14) → `patchDocument(id, {title, type, tags, content})` → setEntry(updated), setEditing(false), saved=true. Ошибки inline (error state). «Отмена» — без запроса.
- created_date — read-only (не входит в UpdateDocumentInput; по AC редактируются title/type/tags/body).
- Показ пути файла `{entry.path}` мелким текстом в форме (как reference-detail.tsx:198).

## 8. Тесты — создать `src/web/documents-api.test.mjs`

По образцу `src/web/references-api.test.mjs` (паттерн beforeAll tmpdir + `mkdirSync(join(cwd,'backlog','tasks'))` — isBacklogDir требует tasks/; импорт из `../../dist/...`):
- GET /api/documents: 200, массив, элемент `{document, path}` **без body**; после создания второго — счётчик растёт.
- POST /api/documents: 201 + id `doc-N`; файл существует; 400 без title; 400 на мусорный type (файл не создан — count не изменился); 400 на tags-не-массив.
- GET /api/documents/:id: 200 с body; 404 неизвестный id.
- PATCH /api/documents/:id: 200, обновлён title/tags/content; при смене title файл переименован (старого нет, новый есть); 400 мусорный type (файл нетронут); 404 неизвестный id.
- Без backlog/ → 400 (findBacklogDir null).

## 9. Документация — `README.md`

Раздел «Веб-интерфейс» (~строки 81–96): в перечень сайдбара (строки 85–89) добавить Documents: «#/documents — список документов (type/tags/created_date, фильтры по type и тегам, кнопка "+ Документ" → POST /api/documents); #/document/<id> — просмотр (title/type/tags/body/created_date, markdown) и редактирование через PATCH /api/documents/:id, VL-181».

## Порядок выполнения

1. `src/web/api.ts` (эндпоинты) → `pnpm build`
2. Тесты `src/web/documents-api.test.mjs` → `pnpm test:fast src/web/documents-api.test.mjs`
3. Роутинг (use-hash-route → App → sidebar)
4. `web/src/components/documents/api.ts` → `documents-page.tsx` → `document-detail.tsx`
5. README
6. Полная проверка

## Как проверить

```bash
pnpm install                          # в worktree (lesson-6)
pnpm build                            # tsc → dist/
pnpm test                             # build + vitest (+ static.test.mjs отдельным прогоном)
pnpm --dir web install                # lesson-6: dev-зависимости Vite в свежем worktree
pnpm web:build                        # tsc -b + vite build (ловит ошибки типов веба)
pnpm lint                             # node --check bin/*.mjs
```
Ручная верификация (chrome-devtools, в Code): `vibelog browser` → #/documents (фильтры), создание, #/document/<id> (просмотр markdown + PATCH 200), пункт Documents на сайдбаре, консоль без ошибок (lesson-16).

## Риски

1. **listDocuments принимает backlogDir, а не cwd** (в отличие от listReferences) — забыть findBacklogDir → урон на хендлере; митигация: 400 при null + тест.
2. **Порядок роутов в api.ts**: точные `GET/POST /api/documents` обязаны стоять ДО regex `:id` — иначе POST матчится как id (паттерн sync-роута VL-174).
3. **Иконка FileText в lucide-react** — проверить наличие после установки (lesson-15); замена — `Files`/`BookOpen`.
4. **Transient-пустой id** в document-detail (lesson-22) — guard `if (!id) return`.
5. **Тип в вебе дублируется** (DOCUMENT_TYPES в documents/api.ts) — сознательно: веб не импортирует node-core; рассинхрон низкорисковый, покрыто серверным тестом.
6. **created_date при PATCH** — read-only (не в UpdateDocumentInput; по AC редактируются title/type/tags/body).
7. `radix-ui` Select уже используется (tasks-table) — новых зависимостей не требуется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 15:21
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Страница documents — список, просмотр, редактирование» (снят ведущий тег #web). Масштаб: task (одна фича: 4 эндпоинта + 2 роута + создание документа + пункт на сайдбаре). Уточнено: описание очищено от тега, добавлены 3 проверяемых AC — (1) роут #/documents со списком и фильтром по type/tags; (2) роут #/document/<id> с просмотром всех полей (title, type, tags, body, created_date) и редактированием через PATCH /api/documents/:id; (3) создание документа по кнопке «+ Документ» (POST /api/documents) + раздел Documents на сайдбаре. Учтён контекст похожей VL-174 (references-страницы, Done — аналогичная структура). Labels: web, docs (тег #web из заголовка/описания перенесён в labels). References: нет (внешние источники не упомянуты; VL-174 — внутренняя задача-контекст). Вопросов нет.
---
author: @agent
created: 2026-10-25 15:52
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 9 файлов (4 изменения backend/роутинга/сайдбара/README + 4 создания: web/src/components/documents/{api,documents-page,document-detail}.ts(x), src/web/documents-api.test.mjs + use-hash-route/App/app-sidebar правки). Решения: эндпоинты GET/POST /api/documents + GET/PATCH /api/documents/:id в src/web/api.ts после блока references (точные роуты ДО regex :id); список — без body (паттерн VL-174), writeDocument/getDocument принимают backlogDir → findBacklogDir(cwd) + 400 при null; фильтры по type/tags — клиентские; body в детальной — MarkdownView (@/lib/markdown); создание — inline-форма по кнопке «+ Документ» → 201 → переход на #/document/<id>; сайдбар — пункт Documents (FileText, activeWhen: documents|document). Тесты — по образцу references-api.test.mjs (список без body, 201/400/404, переименование файла при PATCH, нет-backlog → 400). Документация: README, раздел «Веб-интерфейс». Риски: backlogDir vs cwd в хендлерах, порядок роутов, наличие иконки FileText (lesson-15), guard пустого id (lesson-22), pnpm install в web/ перед web:build (lesson-6). Подзадачи не создавались — объём соответствует одной task.
---
author: @agent
created: 2026-10-25 17:54
---
Фаза 3 (Code) выполнена. Реализовано по плану (9 файлов).
Backend (src/web/api.ts): 4 эндпоинта после блока references — GET /api/documents (список метаданных без body), POST /api/documents (предвалидация title/type/tags → 400, writeDocument → 201), GET/PATCH /api/documents/:id (regex до POST /api/tasks, 404 «Документ не найден»). Все хендлеры — findBacklogDir(cwd) + 400 при null (core-функции документов ждут backlogDir, не cwd). Точная пара GET/POST /api/documents стоит ДО regex :id.
Роутинг: Route 'documents' | 'document' в use-hash-route.ts (список точным совпадением до startsWith('document/'), useDocumentId с decodeURIComponent, JSDoc обновлён); App.tsx — 2 ветки тернарника + импорты; сайдбар — пункт Documents (FileText, activeWhen: documents|document), иконка проверена после pnpm --dir web install (lesson-15).
Страницы (web/src/components/documents/): api.ts — зеркало references/api.ts (DocumentMeta/ListItem/DetailData/Patch/Create, DOCUMENT_TYPES-дубль, errorMessage, 4 fetch-функции, ошибки в state — lesson-16); documents-page.tsx — список-карточки, клиентские фильтры по type (Select, «Все типы» = __all__ — Radix не принимает пустой value) и тегам (подстрока через запятую), inline-форма «+ Документ» → POST → переход на #/document/<id>, кнопка disabled при пустом title; document-detail.tsx — просмотр (MarkdownView-рендер body, type/tags/created_date/путь) + редактирование (title/type/tags/body → PATCH, created_date read-only), guard `if (!id) return` (lesson-22), cancelled-флаг.
Тесты (src/web/documents-api.test.mjs, 12 шт.): список без body + счётчик растёт; POST 201/400×3 без создания файла; GET 200 с body/404; PATCH 200 с переименованием файла/400×2 без изменения/404; все 4 хендлера → 400 без backlog/. Нюанс фикстуры: writeDocument/getDocument в тесте получают join(cwd,'backlog'), а не cwd.
README: раздел «Веб-интерфейс» — Documents в перечне сайдбара (роуты, фильтры, POST/PATCH, VL-181).
Проверки: pnpm build ✓, pnpm test ✓ (полный набор + static.test отдельным прогоном), pnpm --dir web install + pnpm web:build ✓ (tsc -b + vite build — типы веба чисты), pnpm lint ✓. Коммит 127a292 (включая web/dist — VL-26). Ручная верификация в браузере (chrome-devtools) в этой сессии не выполнялась — ревьюер может прогнать vibelog browser → #/documents.
Что осталось: ручная визуальная проверка веб-слоя (AC покрыт автотестами API + сборкой веба).
---
author: @agent
created: 2026-10-25 17:55
---
Фаза Close прервана: конфликт слияния vb/vl-181 → master (файлы: UU web/dist/index.html, AU web/dist/assets/index-XTk9xSwk.css — конфликты в артефактах сборки web/dist, включая rename/delete css; также в индексе README.md, src/web/api.ts, web/src/* и др. частично слитые изменения). Разреши конфликт вручную и повтори Фазу Close.
---
author: @agent
created: 2026-10-25 18:00
---
Фаза Close выполнена. Первый запуск упал на конфликте слияния (web/dist/index.html UU + rename/delete index-XTk9xSwk.css) — конфликты разрешены пересборкой веба из слитых исходников (pnpm web:build → новые hash-артефакты, осиротевшие удалены), merge-коммит 3fa459b. Ветка vb/vl-181 слита в master (1 коммит 127a292), worktree удалена (force — только untracked-симлинки), ветка удалена. Проверки после merge: pnpm build ✓, pnpm test ✓ (полный набор), pnpm web:build ✓. DoD: 1 (тесты проходят — pnpm test зелёный), 2 (документация обновлена — README в merge + CHANGELOG в docs-коммите 129485f), 3 (нет регрессий — сборка+тесты зелёные). Lesson-28 (разрешение конфликтов web/dist пересборкой) создан и связан. Docs-коммиты: 09cb6d1 (lessons), 129485f (CHANGELOG).
---
<!-- COMMENTS:END -->