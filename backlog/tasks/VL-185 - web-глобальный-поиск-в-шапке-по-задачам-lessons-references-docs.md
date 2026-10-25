---
id: VL-185
title: 'Глобальный поиск в шапке по задачам, lessons, references, docs'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 19:05'
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
  - src/core/search.ts
  - src/core/document.ts
  - src/web/server.ts
  - src/web/api.ts
  - src/web/search-api.test.mjs
  - web/src/components/header/search-api.ts
  - web/src/components/header/search.tsx
  - web/src/components/header/app-header.tsx
  - web/dist/index.html
  - README.md
lessons:
  - lesson-38
  - lesson-39
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас в шапке Web UI есть строка поиска (шаблон), но она не работает. Нужен глобальный поиск по: задачи (title, description, id, labels), lessons (title, body, tags), references (title, url, tags), documents (title, body, type).

Decisions НЕ включать — пока не используются активно.

Backend: GET /api/search?q=... — единый эндпоинт, возвращает результаты сгруппированные по типу (tasks, lessons, references, documents). Лимит 5 на тип, всего 20. Если общее меньше 20-ти, а задач больше 5-ти, то количество задач можно увеличить.

Frontend: input с debounce 300ms в шапке, dropdown с результатами (сгруппированы по типу), клик → переход на страницу сущности (#/task/<id>, #/lesson/<id>, #/reference/<id>, #/document/<id>).

Приоритет: высокий. Причина: 150+ задач, найти нужную сложно.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /api/search?q=... возвращает результаты, сгруппированные по типам (tasks, lessons, references, documents): лимит 5 на тип, не более 20 суммарно; при общем числе меньше 20 количество задач увеличивается до 20 − (lessons+references+documents)
- [x] #2 Поля поиска (substring, без учёта регистра): задачи — title/description/id/labels; lessons — title/body/tags; references — title/url/tags; documents — title/body/type
- [x] #3 UI: input в шапке с debounce 300ms, dropdown с результатами, сгруппированными по типам; клик по задаче открывает её (requestOpenTask → доска+модалка, т.к. маршрута #/task/<id> нет), по lesson/reference/document — переход на #/lesson/<id>, #/reference/<id>, #/document/<id>
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Архитектурные решения

1. **Единая core-функция `globalSearch` в `src/core/search.ts`** (lesson-37 — логику фаз/слоёв не дублировать): собирает и группирует результаты из уже существующих `searchTasks` / `searchLessons` / `searchReferences` / `searchDocuments`. API-хендлер только валидирует и отдаёт.
2. **Передача query string**: `src/web/server.ts:34` отрезает `?...` ДО вызова `handleApi`. Поэтому `handleApi` получает **5-й опциональный параметр `queryString: string = ''`** (обратно совместимо — все существующие тесты зовут с 4 аргументами), server передаёт хвост после `?`.
3. **Слим-ответ без тел** (паттерн списков VL-174/181/182 — экономия трафика): `{id, title, ...мета}` для каждой группы.
4. **Навигация по задаче**: маршрута `#/task/<id>` в web-роутере НЕ существует (use-hash-route.ts) — клик по задаче → `requestOpenTask(id)` (`web/src/lib/open-task.ts`, существующий паттерн: доска + модалка, как в lesson-detail). Lessons/references/documents → существующие hash-роуты `#/lesson/<id>`, `#/reference/<id>`, `#/document/<id>`.
5. Decisions не ищем.

## Формат ответа GET /api/search

```json
{
  "query": "...",
  "tasks":      [{"id","title","type","status","priority","labels"}],
  "lessons":    [{"id","title","status","tags"}],
  "references": [{"id","title","type","url","tags"}],
  "documents":  [{"id","title","type","tags"}]
}
```

Лимиты: `PER_TYPE = 5`, `TOTAL = 20`. `others = lessons + references + documents` (каждая группа уже ≤5); лимит задач = `min(всего_найдено_задач, TOTAL − others)` — при `others=15` даёт 5, при `others=0` — до 20 (спека: «если общее <20, а задач >5 — увеличить»).

## Файлы для изменения

1. **`src/web/server.ts`** (стр. 34, 61):
   - стр. 34: сохранить сырой URL: `const rawUrl = req.url ?? ''; const url = rawUrl.split('?')[0];`
   - стр. 61: `handleApi(method, url, parsed, cwd, rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '')`.
2. **`src/web/api.ts`**:
   - док-коммент (стр. 5–29): строка `* - GET /api/search — глобальный поиск по 4 типам сущностей (VL-185)`;
   - подпись `handleApi` (стр. 79–84): + параметр `queryString: string = ''`;
   - новый блок **после `GET /api/tasks` (после стр. 90)**:
     ```
     if (method === 'GET' && url === '/api/search') {
       if (!findBacklogDir(cwd)) → 400 {error: 'Backlog не найден...'} // паттерн VL-182
       const q = new URLSearchParams(queryString).get('q') ?? '';
       const results = globalSearch(cwd, q);   // пустой q → пустые группы, 200
       return { status: 200, body: results };
     }
     ```
   - импорт: `import { globalSearch } from '../core/search.js';`.
3. **`src/core/search.ts`** (дописать после `searchTasks`, стр. 99):
   - `const SEARCH_PER_TYPE_LIMIT = 5; const SEARCH_TOTAL_LIMIT = 20;`
   - интерфейсы `SearchTaskHit / SearchLessonHit / SearchReferenceHit / SearchDocumentHit / GlobalSearchResults`;
   - `export function globalSearch(cwd: string, query: string): GlobalSearchResults`:
     - `!findBacklogDir(cwd)` или пустой `query.trim()` → пустые группы;
     - `tasksAll = searchTasks(cwd, { query })`, `lessons = searchLessons(cwd, q).slice(0, PER_TYPE)`, аналогично `searchReferences`, `searchDocuments(findBacklogDir(cwd), q)`;
     - `others = lessons.length + refs.length + docs.length`; `tasks = tasksAll.slice(0, Math.min(tasksAll.length, TOTAL − others))`;
     - маппинг в слим-хиты (без `description`, `body`, `plan`, `finalSummary`).
4. **`src/web/search-api.test.mjs`** — новый тест (паттерн `src/web/lessons-api.test.mjs`: mkdtemp + `mkdir backlog/tasks`; фикстуры через `createTaskFile`, `createLessonFile`, `writeReference`, `writeDocument`):
   - 200 + группировка по 4 типам; вызов `handleApi('GET', '/api/search', null, cwd, 'q=...')` (5-й аргумент);
   - поля: задача находится по description/labels/id; lesson по body/tags; reference по url/tags; document по **type**/body (substring, case-insensitive);
   - лимиты: 7+ задач → не больше TOTAL; 15 «чужих» + 7 задач-матчей → задач ровно 5; groups ≤ PER_TYPE; при `others<15` задачи дорастают до `TOTAL−others`;
   - URL-encoded кириллица в `q`; пустой `q` → 200 + пустые группы; без backlog → 400.
5. **`web/src/components/header/search-api.ts`** — новый: типы `SearchResults` (зеркало core) + `fetchGlobalSearch(q)` через `fetch('/api/search?q=' + encodeURIComponent(q))`.
6. **`web/src/components/header/search.tsx`** — переписать (сейчас 34 строки — заглушка `SearchButton` из VL-166):
   - экспорт `GlobalSearch`: `Input` с иконкой `Search` (placeholder «Поиск (⌘J)…»), контейнер `relative`;
   - state `query` + `results` + `open`; `useEffect` с `setTimeout(300)` (debounce), cleanup таймера + guard по seq (опоздавший ответ не перетирает более свежий);
   - fetch в try/catch с тихим fallback (lesson-16 — консоль без ошибок);
   - dropdown: `absolute top-full left-0 z-50 mt-1 w-80 max-h-96 overflow-y-auto rounded-md border bg-popover shadow-md`, группы с заголовками «Задачи / Lessons / References / Документы», пустой ввод → dropdown закрыт, 0 результатов → «Ничего не найдено»;
   - закрытие: Escape, клик вне (document mousedown + ref.contains);
   - клик по пункту: задача → `requestOpenTask(id)`; иначе `window.location.hash = '#/lesson/' | '#/reference/' | '#/document/' + id` (encodeURIComponent); после — закрыть dropdown, очистить query.
7. **`web/src/components/header/app-header.tsx`** (стр. 14 импорт, стр. 27 использование): `SearchButton` → `GlobalSearch`.
8. **`README.md`** (стр. 82): «неактивный поиск» → «глобальный поиск (input с debounce 300ms, GET /api/search по задачам/lessons/references/documents, VL-185)».

## Порядок действий

1. `pnpm install` в worktree (он свежий) + `pnpm install` внутри `web/` (lesson-6).
2. Core: `src/core/search.ts` (интерфейсы + `globalSearch`).
3. Backend: `src/web/server.ts` → `src/web/api.ts`.
4. Тест: `src/web/search-api.test.mjs` → `pnpm build && pnpm test`.
5. Frontend: `search-api.ts` → `search.tsx` → `app-header.tsx` → `pnpm web:build`.
6. README.
7. Браузерная верификация (короткими шагами, lesson-27): `vibelog browser` → `chrome-devtools new_page` → `evaluate_script`: ввод «VL-1» → в dropdown группы; клик по задаче → модалка; запрос «уровень» → клик по lesson → hash `#/lesson/...`; `list_console_messages` / `list_network_requests` — `GET /api/search` 200, консоль чистая (вместо скриншотов — evaluate_script, VL-178).

## Как проверить

```bash
pnpm build            # tsc, strict
pnpm test             # build + vitest (новый search-api.test.mjs + регрессии)
pnpm web:build        # сборка UI
```
Ручной smoke: `vibelog browser` + chrome-devtools (evaluate_script, без скриншотов).

## Риски

- **Забытая передача query string** (server отрезает `?` до handleApi) — закрывается тестом с 5-м аргументом и браузерной проверкой network.
- **`searchLessons`/`searchReferences` бросают без backlog** (`requireBacklogDir`) — предпроверка `findBacklogDir` в хендлере (400) + защита в `globalSearch`.
- **Производительность**: каждый запрос читает все файлы сущностей (listTasks/listLessons/…); 150+ задач — приемлемо, смягчено debounce 300ms; при росте — кэш-индекс (вне масштаба).
- **Гонка ответов** при быстрой печати — seq-guard в useEffect.
- **Dropdown в шапке** — absolute-позиционирование поверх контента: контейнер `relative`, `z-50`; проверить, что нет overflow-clipping в header.
- **Свежий worktree**: без `pnpm install` (root и web/) сборка падает (lesson-6).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 19:06
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Глобальный поиск в шапке по задачам, lessons, references, docs» (снят ведущий тег #web). Масштаб: task (одна фича: backend-эндпоинт + UI поиска). Уточнено: тип task, добавлены 3 проверяемых AC (эндпоинт /api/search с лимитами и группировкой, покрытие полей поиска по 4 типам сущностей, UI — debounce 300ms, dropdown с группами, навигация по #/маршрутам), из описания снят тег #web. Labels: web (тег пользователя), core. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-25 21:29
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan (9 разделов: архитектурные решения, формат ответа, 8 файлов, порядок действий, команды проверки, риски). Ключевые решения: единая core-функция globalSearch в src/core/search.ts поверх существующих searchTasks/searchLessons/searchReferences/searchDocuments; 5-й опциональный параметр queryString в handleApi (server.ts отрезает '?' до вызова — обрабатывается на границе); слим-ответ без тел (паттерн VL-174/181/182); лимиты PER_TYPE=5/TOTAL=20 с добором задач до TOTAL−others; клик по задаче → requestOpenTask (маршрута #/task/<id> в роутере нет), lessons/references/documents → существующие hash-роуты. Файлы (8): src/core/search.ts, src/web/server.ts, src/web/api.ts, новый src/web/search-api.test.mjs, новый web/src/components/header/search-api.ts, переписывается web/src/components/header/search.tsx, web/src/components/header/app-header.tsx, README.md. Добавлены 3 AC. Риски: передача query string (закрывается тестом с 5-м аргументом), requireBacklogDir-броски (findBacklogDir-предпроверка → 400), производительность (debounce 300ms), гонка ответов (seq-guard), overflow dropdown (z-50), свежий worktree (pnpm install в root и web/ — lesson-6).
---
author: @agent
created: 2026-10-25 22:24
---
Фаза 3 (Code) выполнена. Изменено: src/core/search.ts (globalSearch + интерфейсы слим-хитов, лимиты PER_TYPE=5/TOTAL=20 с добором задач до TOTAL−others), src/core/document.ts (searchDocuments: добавлен поиск по type — требование AC2, которого не было), src/web/server.ts (rawUrl + передача query string 5-м аргументом в handleApi), src/web/api.ts (док-коммент, параметр queryString='', блок GET /api/search с предпроверкой findBacklogDir → 400), новый src/web/search-api.test.mjs (13 тестов: группировка, поля поиска, лимиты, кириллица URL-encoded, пустой q, без backlog), новый web/src/components/header/search-api.ts, переписан web/src/components/header/search.tsx (GlobalSearch: input + иконка, debounce 300ms, seq-guard против гонок, тихий fallback lesson-16, dropdown с 4 группами, Escape/клик-вне, навигация requestOpenTask/hash-роуты), web/src/components/header/app-header.tsx (SearchButton → GlobalSearch), README.md (строка 82), web/dist (пересборка). Коммит e0798ab (13 файлов). Проверки: pnpm build (tsc strict) OK; pnpm test — полный прогон без регрессий (72 файла, включая 13 новых тестов поиска); pnpm web:build OK; браузерная верификация (chrome-devtools, evaluate_script): ввод «VL-1» → dropdown с группами Задачи/Lessons/References/Документы (20 пунктов), клик по задаче → модалка VL-10 (hash не меняется, requestOpenTask), клик по lesson → #/lesson/lesson-11, по reference → #/reference/ref-1, по document → #/document/doc-1; все GET /api/search → 200, консоль чистая (добавлен id у input — ушёл a11y-issue). Отклонение от плана: в поиске lessons сценария «уровень» — слова нет в данных worktree (в задачах оно только в Implementation Plan, который по AC не ищется), проверено на «Collapsible» вместо него. DoD: тесты проходят, README обновлён, регрессий нет.
---
author: @agent
created: 2026-10-25 22:29
---
Фаза Close выполнена. Ветка vb/vl-185 слита в master (1 коммит e0798ab, merge --no-ff без конфликтов), worktree удалена, ветка удалена. Проверки после merge: pnpm build (tsc strict) OK, pnpm test — полный прогон без регрессий. Уроки: lesson-38 (прокидывай query string в handleApi отдельным параметром + тест с 5-м аргументом), lesson-39 (сверяй поля поиска из AC с реализацией core-функций) — оба созданы и связаны. DoD: все 3 пункта выполнены (тесты проходят, документация обновлена — README в ветке + CHANGELOG Unreleased, регрессий нет). Документация: docs-коммиты 5f5df55 (lessons) и b678bc6 (CHANGELOG).
---
<!-- COMMENTS:END -->